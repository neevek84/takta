import type { TimeEntryKind } from '../types'
// Le groupement par facteur vit dans le module de conversion du domaine : le
// contrôle de capacité le consomme aussi, et deux copies de cette règle
// finiraient par diverger.
import { centiemesParFacteur } from '../time/units'

export interface EngagementSummary {
  venduCentiemes: number
  realiseCentiemes: number
  prevuCentiemes: number
  resteCentiemes: number
  depassementCentiemes: number
}

export function computeEngagement(args: {
  venduCentiemes: number
  entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number; minutesParJour: number }>
}): EngagementSummary {
  const realiseCentiemes = centiemesParFacteur(args.entries.filter((e) => e.kind === 'REALISE'))
  const prevuCentiemes = centiemesParFacteur(args.entries.filter((e) => e.kind === 'PREVISIONNEL'))
  const solde = args.venduCentiemes - realiseCentiemes - prevuCentiemes

  return {
    venduCentiemes: args.venduCentiemes,
    realiseCentiemes,
    prevuCentiemes,
    resteCentiemes: Math.max(0, solde),
    depassementCentiemes: Math.max(0, -solde),
  }
}

/**
 * L'engagement d'une prestation tel que le CRA l'imprime : le réalisé y est
 * coupé en deux selon le statut du CRA du mois où il a été saisi.
 *
 * La règle couvre tout le vendu, sans trou ni recouvrement — c'est ce qui
 * permet à `reste` d'être juste :
 *
 * - `valide` : le réalisé des mois dont le CRA est en statut `VALIDE` ;
 * - `enValidation` : le réalisé des mois qui ne le sont pas **encore**, le
 *   mois du présent document compris — c'est ce que le client accepte en le
 *   signant ;
 * - `planifie` : le prévisionnel.
 *
 * Ranger le réalisé non validé ailleurs que dans `enValidation` le ferait
 * disparaître des trois segments, et gonflerait `reste` d'autant.
 */
export interface EngagementDetaille {
  venduCentiemes: number
  valideCentiemes: number
  enValidationCentiemes: number
  planifieCentiemes: number
  /** la somme des trois premiers, sans bornage */
  consommeCentiemes: number
  resteCentiemes: number
  depassementCentiemes: number
}

export function detaillerEngagement(args: {
  venduCentiemes: number
  valideCentiemes: number
  enValidationCentiemes: number
  planifieCentiemes: number
}): EngagementDetaille {
  const consomme = args.valideCentiemes + args.enValidationCentiemes + args.planifieCentiemes
  const solde = args.venduCentiemes - consomme

  return {
    ...args,
    consommeCentiemes: consomme,
    resteCentiemes: Math.max(0, solde),
    depassementCentiemes: Math.max(0, -solde),
  }
}

/**
 * Le cumul d'une mission, somme des **valeurs brutes** de ses prestations.
 *
 * Jamais la somme des `reste` déjà bornés à zéro : une ligne en dépassement
 * rendrait alors un reste global trop grand de son dépassement. Le bornage se
 * fait une fois, à la fin, sur le cumul.
 */
export function cumulerEngagements(
  lignes: ReadonlyArray<EngagementDetaille>,
): EngagementDetaille {
  return detaillerEngagement({
    venduCentiemes: lignes.reduce((s, l) => s + l.venduCentiemes, 0),
    valideCentiemes: lignes.reduce((s, l) => s + l.valideCentiemes, 0),
    enValidationCentiemes: lignes.reduce((s, l) => s + l.enValidationCentiemes, 0),
    planifieCentiemes: lignes.reduce((s, l) => s + l.planifieCentiemes, 0),
  })
}
