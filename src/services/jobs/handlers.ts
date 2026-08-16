import { getSettings } from '@/services/settings'
import { getMonthEntries } from '@/services/time-entries'
import { listCrasNonClotures } from '@/services/cra'
import { verifyJournalChain } from '@/services/audit'
import { notify } from '@/services/notify'
import {
  gabaritRappelCloture,
  gabaritRappelSaisie,
  gabaritRuptureJournal,
} from '@/core/notify/templates'
import { distributeWebhooks } from '@/services/webhooks/delivery'
import { flushAllProviders } from '@/services/sync/drain'
import type { JobContext, JobHandler } from './registry'

/**
 * Aucun de ces traitements n'écrit dans `TimeEntry` ni dans `Cra`.
 * Ils signalent, ils poussent, ils consignent — **ils ne décident pas**.
 * `handlers.test.ts` le vérifie travail par travail, et balaie en plus cette
 * source pour qu'aucune écriture n'y soit réintroduite.
 */

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function moisDe(d: Date): string {
  return d.toISOString().slice(0, 7)
}

/** Jour de semaine 1 = lundi … 7 = dimanche, aligné sur `Settings.workingDays`. */
function jourDeSemaine(d: Date): number {
  const jour = d.getUTCDay()
  return jour === 0 ? 7 : jour
}

/**
 * Le double d'envoi éventuel du contexte, sous la forme qu'attend `notify`.
 * Absent en production : c'est alors la configuration SMTP qui décide.
 */
function depsEnvoi(ctx: JobContext) {
  return ctx.mailer === undefined ? {} : { mailer: ctx.mailer }
}

/**
 * Signale les jours ouvrés du mois en cours qui ne portent aucune saisie,
 * **strictement antérieurs à aujourd'hui** : rappeler à quelqu'un qu'il n'a
 * pas encore saisi sa journée en cours serait du bruit.
 */
export const rappelSaisie: JobHandler = async (ctx) => {
  const { now, userId } = ctx
  const mois = moisDe(now)
  const [reglages, saisies] = await Promise.all([getSettings(), getMonthEntries(userId, mois)])

  const ouvres = new Set(reglages.workingDays)
  const feries = new Set(reglages.holidays)
  const saisis = new Set(saisies.map((e) => e.date))
  const aujourdhui = isoDate(now)

  const manquants: string[] = []
  for (let jour = 1; jour <= 31; jour++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), jour))
    if (moisDe(date) !== mois) break // débordement de mois

    const iso = isoDate(date)
    if (iso >= aujourdhui) break
    if (!ouvres.has(jourDeSemaine(date))) continue
    if (feries.has(iso)) continue
    if (saisis.has(iso)) continue

    manquants.push(iso)
  }

  if (manquants.length === 0) {
    return { message: `Aucun jour ouvré sans saisie en ${mois}.` }
  }

  const envoi = await notify(gabaritRappelSaisie({ mois, jours: manquants }), depsEnvoi(ctx))
  return {
    message: `${manquants.length} jour(s) ouvré(s) sans saisie en ${mois}.${
      envoi.envoye ? '' : ` ${envoi.motif}`
    }`,
  }
}

/** Fenêtre de clôture : les cinq premiers jours du mois, pour le mois écoulé. */
const DERNIER_JOUR_DE_CLOTURE = 5

/**
 * Signale les CRA encore en brouillon — ou pas même ouverts — sur le mois
 * écoulé. **N'en envoie, n'en valide et n'en ouvre aucun** : seuls un geste
 * humain ou un retour de signature franchissent une transition de CRA.
 */
export const rappelCloture: JobHandler = async (ctx) => {
  const { now, userId } = ctx
  if (now.getUTCDate() > DERNIER_JOUR_DE_CLOTURE) {
    return {
      message: `Hors fenêtre de clôture (les ${DERNIER_JOUR_DE_CLOTURE} premiers jours du mois).`,
    }
  }

  const precedent = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const mois = moisDe(precedent)

  const aClôturer = await listCrasNonClotures(userId, mois)
  if (aClôturer.length === 0) {
    return { message: `Aucun CRA à clôturer pour ${mois}.` }
  }

  const envoi = await notify(
    gabaritRappelCloture({
      mois,
      missions: aClôturer.map((c) => ({
        label: `${c.clientName} — ${c.missionLabel}`,
        etat: c.status,
      })),
    }),
    depsEnvoi(ctx),
  )

  return {
    message: `${aClôturer.length} CRA à clôturer pour ${mois}.${
      envoi.envoye ? '' : ` ${envoi.motif}`
    }`,
  }
}

/**
 * Recalcule les empreintes et alerte à la première rupture.
 *
 * En cas de rupture, le travail **lève** après avoir notifié : l'ordonnanceur
 * le consigne alors en `travail.echoue` et la supervision l'affiche en tête.
 * Une rupture détectée mais rendue comme un succès n'aurait aucune valeur.
 */
export const verificationJournal: JobHandler = async (ctx) => {
  const verdict = await verifyJournalChain()

  if (verdict.ok) {
    return { message: `Chaîne intacte : ${verdict.verifiees} entrée(s) vérifiée(s).` }
  }

  await notify(gabaritRuptureJournal({ seq: verdict.seq, raison: verdict.raison }), depsEnvoi(ctx))

  throw new Error(
    `Rupture de la chaîne du journal à l'entrée ${verdict.seq} (${verdict.raison}). ` +
      `${verdict.verifiees} entrée(s) vérifiée(s) avant elle.`,
  )
}

/** Met en file et tente les appels sortants dus. */
export const distributionRappels: JobHandler = async ({ now, fetchFn }) => {
  const rapport = await distributeWebhooks({ now, ...(fetchFn !== undefined && { fetchFn }) })

  return {
    message:
      `${rapport.abonnements} abonnement(s) · ${rapport.creees} mise(s) en file · ` +
      `${rapport.reussies} réussie(s), ${rapport.echouees} en échec, ` +
      `${rapport.abandonnees} abandonnée(s), ${rapport.suspendus} suspendu(s).`,
  }
}

/**
 * Draine la file de sortie vers l'agenda et Dolibarr.
 *
 * `flushAllProviders`, et non le drainage d'un seul compte : un réveil
 * externe n'a pas de session, et un jeton d'agenda appartient à une personne
 * quand une clé d'API Dolibarr appartient à l'instance — c'est la file qui
 * dit quels comptes drainer. Drainer le seul « propriétaire de l'instance »
 * laisserait
 * les CRA validés des autres comptes dans la file, avec un cron qui aurait
 * l'air de tourner.
 *
 * Le `fetchFn` du contexte n'est pas transmis : celui de l'agenda a une
 * signature plus étroite (`{ method, headers, body? }`) que celle des appels
 * sortants, et les confondre ne tiendrait qu'au hasard des champs utilisés.
 */
export const vidageFileSortie: JobHandler = async ({ now }) => {
  const r = await flushAllProviders(undefined, { now })

  return {
    message:
      `Agenda : ${r.comptes} compte(s), ${r.traitees} ligne(s). ` +
      `File : ${r.comptesFile} compte(s), ${r.traiteesFile} traitée(s), ` +
      `${r.reussiesFile} réussie(s), ${r.echoueesFile} en échec, ${r.resteFile} en attente.`,
  }
}
