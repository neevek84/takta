'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { saveEntry, convertPastForecast, type SaveResult } from '@/services/time-entries'
import { applyCellState, type CellResult } from '@/services/cells'
import { clearMonth, fillMonth } from '@/services/month-fill'
import { parseQuantity } from '@/core/time/units'
import { listActiveLines } from '@/services/missions'
import type { CellState } from '@/core/saisie/cycle'
import type { ClearReport, FillReport } from '@/core/saisie/report'

/** Aujourd'hui, côté serveur : l'horloge du navigateur ne décide de rien. */
function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Enregistre une valeur brute sur une case — la vue tableau.
 *
 * Le `kind` n'est pas un paramètre, exactement comme dans `appliquerCase` :
 * l'horloge du serveur fait foi. Le reprendre du client laisserait n'importe
 * quel appelant authentifié — `fetch` forgé, extension, client modifié —
 * marquer « réalisé » un jour à venir, c'est-à-dire créer du temps engageant
 * sans décision humaine, et court-circuiter `PastForecastNotice` /
 * `validerJoursPasses`, dont toute la raison d'être est que la conversion du
 * prévisionnel échu soit un geste explicite.
 */
export async function saveCell(args: {
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  raw: string
  /** 'YYYY-MM' — le mois affiché, celui qu'on rafraîchit */
  month: string
  /**
   * créneau visé, chaîne vide (ou absent) = journée entière.
   *
   * Contrairement au `kind`, c'est bien au client de le dire : il décrit *ce
   * que la personne a fait*, pas la nature engageante du temps. Un créneau que
   * la prestation ne prévoit pas est signalé par le service, jamais refusé.
   */
  slotId?: string
}): Promise<SaveResult | { ok: false; reason: 'SAISIE_INVALIDE' }> {
  const user = await requireUser()

  const line = (await listActiveLines(user.id)).find((l) => l.id === args.lineId)
  if (!line) return { ok: false, reason: 'SAISIE_INVALIDE' }

  const minutes = parseQuantity(args.raw, line.displayUnit, line.minutesParJour)
  if (minutes === null) return { ok: false, reason: 'SAISIE_INVALIDE' }

  const result = await saveEntry({
    userId: user.id,
    lineId: args.lineId,
    date: args.date,
    minutes,
    kind: args.date >= aujourdhui() ? 'PREVISIONNEL' : 'REALISE',
    slotId: args.slotId ?? '',
  })

  if (result.ok) revalidatePath(`/saisie/${args.month}`)
  return result
}

/**
 * Applique un état de case — la cinématique de la vue calendrier.
 *
 * Le `kind` n'est jamais fourni par le client : c'est l'horloge du serveur qui
 * départage le réalisé du prévisionnel, comme pour `validerJoursPasses`.
 *
 * L'action ne connaît ni le verrou, ni la capacité, ni l'affectation : elle
 * passe la main à `applyCellState`, qui scope tout sur `userId`. Aucune
 * requête Prisma ne part d'ici.
 */
export async function appliquerCase(args: {
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  state: CellState
  /** 'YYYY-MM' — le mois affiché, celui qu'on rafraîchit */
  month: string
}): Promise<CellResult> {
  const user = await requireUser()

  const result = await applyCellState({
    userId: user.id,
    lineId: args.lineId,
    date: args.date,
    kind: args.date >= aujourdhui() ? 'PREVISIONNEL' : 'REALISE',
    state: args.state,
  })

  if (result.ok) revalidatePath(`/saisie/${args.month}`)
  return result
}

/** Pose une journée sur chaque jour ouvré encore libre du mois. */
export async function remplirMois(args: {
  lineId: string
  month: string
}): Promise<FillReport> {
  const user = await requireUser()

  const report = await fillMonth({
    userId: user.id,
    lineId: args.lineId,
    month: args.month,
    today: aujourdhui(),
  })

  revalidatePath(`/saisie/${args.month}`)
  return report
}

/** Retire les saisies du mois pour la prestation sélectionnée, elle seule. */
export async function viderMois(args: {
  lineId: string
  month: string
}): Promise<ClearReport> {
  const user = await requireUser()

  const report = await clearMonth({ userId: user.id, lineId: args.lineId, month: args.month })

  revalidatePath(`/saisie/${args.month}`)
  return report
}

/** Compte rendu de la dernière conversion, `null` avant tout clic. */
export type ConversionEtat = { converted: number; skippedLocked: number } | null

/**
 * Convertit le prévisionnel échu en réalisé — jamais déclenché seul, toujours
 * à l'initiative de l'utilisateur via le bouton de `PastForecastNotice`.
 *
 * Rend compte de ce qu'elle a réellement fait : le nombre annoncé au rendu et
 * le nombre converti au clic peuvent différer (un jour qui bascule entre les
 * deux, un CRA validé entre-temps). Sans ce retour, l'écart resterait invisible.
 */
export async function validerJoursPasses(
  _etatPrecedent: ConversionEtat,
  formData: FormData,
): Promise<ConversionEtat> {
  const user = await requireUser()
  const month = String(formData.get('month'))

  const resultat = await convertPastForecast(user.id, month, aujourdhui())
  revalidatePath(`/saisie/${month}`)
  return resultat
}
