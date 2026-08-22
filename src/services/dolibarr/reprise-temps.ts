/**
 * Reprendre les temps déjà consommés dans Dolibarr, sur une mission qu'on
 * intègre en cours de route.
 *
 * **Le besoin.** Le porteur branche l'outil au milieu d'une commande. Sans
 * reprise, le premier CRA annonce un reste à consommer faux de tout ce qui a
 * déjà été servi — et c'est le chiffre que le client signe.
 *
 * **Les cinq arbitrages du porteur**, rendus les 20 et 21 août 2026 et
 * consignés dans `docs/superpowers/specs/2026-08-19-reprise-des-temps-dolibarr-design.md` :
 *
 * 1. le facteur figé sur les saisies reprises est **celui de Dolibarr** ;
 * 2. **tous** les temps sont importés, sans filtrer par utilisateur ;
 * 3. la coupure est le **dernier jour du mois précédent** ;
 * 4. l'heure est celle de Dolibarr si elle existe, **9 h** sinon ;
 * 5. l'application **ne supprime jamais** un temps chez Dolibarr — le porteur
 *    supprime lui-même ceux du mois en cours qu'il va ressaisir, et l'écran le
 *    lui rappelle.
 *
 * **Pourquoi les mois repris naissent validés.** « Les temps repris sont
 * considérés comme validés, c'est pour cela qu'on ne reprend pas le mois en
 * cours. » Un mois validé est verrouillé : plus de saisie, et surtout aucun
 * push — la file Dolibarr n'est alimentée qu'**à la transition** vers validé,
 * et la reprise ne passe pas par elle. Sans cette validation, générer puis
 * valider le CRA d'un mois repris renverrait tout chez Dolibarr, en double des
 * lignes d'origine, dont certaines sont peut-être déjà facturées.
 *
 * **Pourquoi les saisies sont écrites directement.** Le chemin normal
 * (`saveEntry`) met en file un événement d'agenda par saisie. Reprendre six
 * mois d'historique remplirait le calendrier du porteur de blocs passés que
 * personne n'a demandés.
 */
import { prisma } from '@/db/client'
import {
  dernierJourDuMoisPrecedent,
  minutesDepuisMinuitLocal,
  placerLesCreneaux,
  MINUTE_PAR_DEFAUT,
} from '@/core/dolibarr/reprise-temps'
import { getSettings } from '@/services/settings'
import { resolveLineMinutesParJour } from '@/services/time-entries'
import { DOLIBARR, type DolibarrApi, type DolibarrTimeSpent } from './api'
import { LIEN_LIGNE, LIEN_TEMPS_REPRIS, LIEN_UTILISATEUR } from './liens'

/** La constante Dolibarr qui dit combien d'heures vaut une journée. */
const CONSTANTE_JOURNEE = 'TIMESHEET_DAY_DURATION'

/** Ce que l'écran montre avant de reprendre quoi que ce soit. */
export interface EtatRepriseTemps {
  /** dernier jour repris, `'YYYY-MM-DD'` */
  coupure: string
  /** prestations reliées à une tâche : les seules où un temps peut atterrir */
  prestations: Array<{
    lineId: string
    label: string
    taskId: number
    /** temps antérieurs à la coupure et pas encore repris */
    aReprendre: number
    /** temps déjà repris lors d'un passage précédent */
    dejaRepris: number
    /** temps postérieurs à la coupure : ils se saisissent dans l'application */
    apresCoupure: number
  }>
  /** auteurs rencontrés chez Dolibarr, et s'ils ont déjà un utilisateur local */
  auteurs: Array<{ dolibarrUserId: number; connu: boolean }>
}

export interface RepriseTempsEffectuee {
  reprises: number
  /** utilisateurs locaux créés pour porter l'attribution */
  utilisateursCrees: number
  /** mois verrouillés par la reprise, `'YYYY-MM'` */
  moisVerrouilles: string[]
  ecartes: string[]
}

/** Les prestations de la mission qui visent une tâche Dolibarr. */
async function prestationsLiees(
  missionId: string,
): Promise<Array<{ lineId: string; label: string; taskId: number }>> {
  const lignes = await prisma.missionLine.findMany({
    where: { missionId, archived: false },
    select: { id: true, label: true },
    orderBy: { position: 'asc' },
  })
  const liens = await prisma.externalLink.findMany({
    where: {
      provider: DOLIBARR,
      entityType: LIEN_LIGNE,
      entityId: { in: lignes.map((l) => l.id) },
    },
    select: { entityId: true, externalId: true },
  })

  const labels = new Map(lignes.map((l) => [l.id, l.label]))
  return liens
    .map((l) => ({
      lineId: l.entityId,
      label: labels.get(l.entityId) ?? '',
      taskId: Number(l.externalId),
    }))
    .filter((p) => Number.isFinite(p.taskId) && p.taskId > 0)
}

/** Les identifiants Dolibarr des temps déjà repris, quelle que soit la mission. */
async function dejaRepris(): Promise<Set<string>> {
  const liens = await prisma.externalLink.findMany({
    where: { provider: DOLIBARR, entityType: LIEN_TEMPS_REPRIS },
    select: { externalId: true },
  })
  return new Set(liens.map((l) => l.externalId))
}

/**
 * Ce que l'écran montre : combien de temps chaque prestation peut recevoir, et
 * ce que la coupure écarte.
 *
 * `aujourdhui` est passé, jamais lu de l'horloge : une coupure qui se déplace
 * toute seule ne se teste pas.
 */
export async function tempsReprenables(args: {
  missionId: string
  api: DolibarrApi | null
  aujourdhui: string
}): Promise<EtatRepriseTemps> {
  const coupure = dernierJourDuMoisPrecedent(args.aujourdhui)
  const prestations = await prestationsLiees(args.missionId)
  if (args.api === null || prestations.length === 0) {
    return { coupure, prestations: [], auteurs: [] }
  }

  const repris = await dejaRepris()
  const auteurs = new Set<number>()
  const lignes: EtatRepriseTemps['prestations'] = []

  for (const p of prestations) {
    const temps = await args.api.listTimeSpent(p.taskId)
    let aReprendre = 0
    let dejaFait = 0
    let apres = 0
    for (const t of temps) {
      if (t.date > coupure) {
        apres += 1
        continue
      }
      if (repris.has(String(t.id))) {
        dejaFait += 1
        continue
      }
      aReprendre += 1
      auteurs.add(t.dolibarrUserId)
    }
    lignes.push({ ...p, aReprendre, dejaRepris: dejaFait, apresCoupure: apres })
  }

  const connus = await utilisateursConnus([...auteurs])
  return {
    coupure,
    prestations: lignes,
    auteurs: [...auteurs].map((id) => ({ dolibarrUserId: id, connu: connus.has(id) })),
  }
}

/** `dolibarrUserId` → identifiant d'utilisateur local, pour ceux qui en ont un. */
async function utilisateursConnus(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map()
  const liens = await prisma.externalLink.findMany({
    where: {
      provider: DOLIBARR,
      entityType: LIEN_UTILISATEUR,
      externalId: { in: ids.map(String) },
    },
    select: { entityId: true, externalId: true },
  })
  return new Map(liens.map((l) => [Number(l.externalId), l.entityId]))
}

/**
 * L'utilisateur local d'un auteur Dolibarr, créé au besoin.
 *
 * **Sans mot de passe.** `verifyPassword` refuse une empreinte vide — `verify`
 * lève et le `catch` rend `false` — donc cet utilisateur ne peut pas se
 * connecter. Il existe pour porter l'attribution, pas pour ouvrir un accès ; le
 * jour où les rôles arrivent, il suffira de lui en donner un.
 */
async function utilisateurLocal(args: {
  dolibarrUserId: number
  api: DolibarrApi
  createur: string
}): Promise<{ userId: string; cree: boolean } | null> {
  const connus = await utilisateursConnus([args.dolibarrUserId])
  const deja = connus.get(args.dolibarrUserId)
  if (deja !== undefined) return { userId: deja, cree: false }

  const distant = await args.api.getUser(args.dolibarrUserId)
  if (distant === null) return null

  // Dolibarr n'impose pas d'adresse à ses utilisateurs, et la nôtre est unique.
  // Une adresse fabriquée vaut mieux qu'un import qui échoue : elle est
  // reconnaissable, et le porteur pourra la corriger.
  const email =
    distant.email.trim() === ''
      ? `dolibarr-${args.dolibarrUserId}@reprise.local`
      : distant.email.trim().toLowerCase()

  const existant = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  const user =
    existant ??
    (await prisma.user.create({
      data: {
        email,
        name: distant.nom === '' ? distant.login : distant.nom,
        passwordHash: '',
      },
      select: { id: true },
    }))

  await prisma.externalLink.upsert({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_UTILISATEUR,
        entityId: user.id,
        provider: DOLIBARR,
      },
    },
    create: {
      userId: args.createur,
      entityType: LIEN_UTILISATEUR,
      entityId: user.id,
      provider: DOLIBARR,
      externalId: String(args.dolibarrUserId),
      syncedAt: new Date(),
      syncState: 'SYNCED',
    },
    update: { externalId: String(args.dolibarrUserId), syncState: 'SYNCED' },
  })

  return { userId: user.id, cree: existant === null }
}

/**
 * Le facteur à figer sur les saisies reprises : celui de **Dolibarr**.
 *
 * Arbitrage du porteur : les temps viennent de là-bas, leur durée y a été
 * comprise avec la journée de là-bas. Retomber sur la cascade locale
 * convertirait des heures avec un facteur qui n'a jamais servi à les écrire.
 * La cascade ne sert que de secours, quand la constante manque.
 */
async function facteurDolibarr(api: DolibarrApi, lineId: string): Promise<number> {
  const brut = await api.getSetupValue(CONSTANTE_JOURNEE)
  const heures = Number(brut)
  if (Number.isFinite(heures) && heures > 0 && heures <= 24) return Math.round(heures * 60)

  const settings = await getSettings()
  return resolveLineMinutesParJour(lineId, settings.minutesParJour)
}

/** `'YYYY-MM'` d'un jour. */
function moisDe(jour: string): string {
  return jour.slice(0, 7)
}

/**
 * Importe les temps, verrouille les mois qu'ils touchent, et rend compte.
 *
 * Rejouable : un temps déjà repris est reconnu par sa correspondance et
 * n'entre pas deux fois.
 */
export async function reprendreLesTemps(args: {
  missionId: string
  userId: string
  api: DolibarrApi | null
  aujourdhui: string
}): Promise<RepriseTempsEffectuee> {
  const resultat: RepriseTempsEffectuee = {
    reprises: 0,
    utilisateursCrees: 0,
    moisVerrouilles: [],
    ecartes: [],
  }

  const coupure = dernierJourDuMoisPrecedent(args.aujourdhui)
  const prestations = await prestationsLiees(args.missionId)
  if (args.api === null || prestations.length === 0) {
    resultat.ecartes.push(
      "Aucune prestation de cette mission ne vise une tâche Dolibarr : les temps n'auraient nulle part où atterrir. Reprenez d'abord les tâches.",
    )
    return resultat
  }
  const api = args.api

  const repris = await dejaRepris()
  const settings = await getSettings()
  const moisTouches = new Set<string>()
  // Un auteur introuvable n'est signalé qu'une fois, pas une fois par temps.
  const introuvables = new Set<number>()

  for (const p of prestations) {
    const minutesParJour = await facteurDolibarr(api, p.lineId)
    const temps = (await api.listTimeSpent(p.taskId)).filter(
      (t) => t.date <= coupure && !repris.has(String(t.id)) && t.durationSeconds > 0,
    )
    if (temps.length === 0) continue

    // Les temps se placent par journée et par auteur : c'est la portée de la
    // clé d'unicité d'une saisie, donc celle du décalage des heures.
    const groupes = new Map<string, DolibarrTimeSpent[]>()
    for (const t of temps) {
      const cle = `${t.dolibarrUserId}|${t.date}`
      groupes.set(cle, [...(groupes.get(cle) ?? []), t])
    }

    for (const [cle, dansLeGroupe] of groupes) {
      const [auteurBrut, jour] = cle.split('|')
      const auteurDolibarr = Number(auteurBrut)

      const local = await utilisateurLocal({
        dolibarrUserId: auteurDolibarr,
        api,
        createur: args.userId,
      })
      if (local === null) {
        if (!introuvables.has(auteurDolibarr)) {
          introuvables.add(auteurDolibarr)
          resultat.ecartes.push(
            `L'utilisateur Dolibarr n° ${auteurDolibarr} n'existe plus : ses temps ont été écartés plutôt qu'attribués à quelqu'un d'autre.`,
          )
        }
        continue
      }
      if (local.cree) resultat.utilisateursCrees += 1

      const date = new Date(`${jour}T00:00:00Z`)
      const dejaPrises = (
        await prisma.timeEntry.findMany({
          where: { lineId: p.lineId, userId: local.userId, date },
          select: { startMinute: true },
        })
      ).map((e) => e.startMinute)

      const creneaux = placerLesCreneaux(
        dansLeGroupe.map((t) => ({
          minuteProposee:
            t.debutUnix === null ? null : minutesDepuisMinuitLocal(t.debutUnix, settings.timeZone),
          durationSeconds: t.durationSeconds,
        })),
        dejaPrises,
      )

      // `placerLesCreneaux` trie par heure proposée : les temps doivent être
      // parcourus dans le même ordre, sinon un créneau serait attribué au
      // mauvais temps et l'heure ne correspondrait plus à sa durée.
      const ordonnes = [...dansLeGroupe].sort(
        (a, b) =>
          (a.debutUnix === null
            ? MINUTE_PAR_DEFAUT
            : minutesDepuisMinuitLocal(a.debutUnix, settings.timeZone)) -
          (b.debutUnix === null
            ? MINUTE_PAR_DEFAUT
            : minutesDepuisMinuitLocal(b.debutUnix, settings.timeZone)),
      )

      for (const [i, t] of ordonnes.entries()) {
        const creneau = creneaux[i]!
        await prisma.$transaction(async (tx) => {
          const saisie = await tx.timeEntry.create({
            data: {
              lineId: p.lineId,
              userId: local.userId,
              date,
              minutes: Math.round(t.durationSeconds / 60),
              kind: 'REALISE',
              slotId: '',
              startMinute: creneau.startMinute,
              endMinute: creneau.endMinute,
              comment: t.note,
              minutesParJour,
            },
          })
          await tx.externalLink.create({
            data: {
              userId: args.userId,
              entityType: LIEN_TEMPS_REPRIS,
              entityId: saisie.id,
              provider: DOLIBARR,
              externalId: String(t.id),
              syncedAt: new Date(),
              syncState: 'SYNCED',
            },
          })
        })
        repris.add(String(t.id))
        resultat.reprises += 1
        moisTouches.add(moisDe(jour!))
      }
    }
  }

  // Le verrouillage vient en dernier, et **jamais** par `transitionCra` : c'est
  // cette transition qui met le push en file. Un CRA validé ici ne pousse rien,
  // ce qui est exactement le propos — les temps sont déjà chez Dolibarr.
  for (const mois of [...moisTouches].sort()) {
    await prisma.cra.upsert({
      where: {
        missionId_userId_month: {
          missionId: args.missionId,
          userId: args.userId,
          month: new Date(`${mois}-01T00:00:00Z`),
        },
      },
      create: {
        missionId: args.missionId,
        userId: args.userId,
        month: new Date(`${mois}-01T00:00:00Z`),
        status: 'VALIDE',
      },
      update: { status: 'VALIDE' },
    })
    resultat.moisVerrouilles.push(mois)
  }

  return resultat
}
