import { crossesMidnight } from '../time/slots'
import type { Slot } from '../time/slots'
import type { DisplayUnit } from '../types'

/**
 * Les quatre états qu'une case peut porter.
 *
 * `LIBRE` n'appartient pas au cycle : c'est le fourre-tout de tout ce que la
 * cinématique n'a pas produit — durée en heures, créneau hors des trois
 * prédéfinis, journée éclatée en plusieurs créneaux. Le distinguer est la
 * seule façon d'empêcher un clic distrait d'écraser une saisie fine.
 */
export type CellState =
  | { kind: 'VIDE' }
  | { kind: 'JOURNEE' }
  | { kind: 'DEMI'; slotId: string }
  | {
      kind: 'LIBRE'
      minutes: number
      /** '' = journée entière */
      slotId: string
      /** vrai quand la case agrège plusieurs saisies */
      eclatee: boolean
    }

export type CycleStep = { action: 'ETAT'; state: CellState } | { action: 'FORMULAIRE' }

export interface CycleOptions {
  /** créneaux de demi-journée proposés, dans l'ordre du cycle */
  demiSlotIds: readonly string[]
  displayUnit: DisplayUnit
}

/** Une liste de créneaux autorisés vide vaut « tous ». */
export function isSlotAllowed(slotId: string, allowedSlotIds: readonly string[]): boolean {
  if (slotId === '') return true
  return allowedSlotIds.length === 0 || allowedSlotIds.includes(slotId)
}

/**
 * Créneaux que la cinématique d'une prestation propose, dans l'ordre.
 *
 * Un créneau qui franchit minuit est écarté : il s'étale sur deux jours, il ne
 * peut donc pas être l'une des deux moitiés de celui qu'on est en train de
 * saisir. Il reste atteignable par le formulaire.
 */
export function cycleSlotIds(
  slots: readonly Slot[],
  allowedSlotIds: readonly string[],
): string[] {
  return slots
    .filter((s) => !crossesMidnight(s))
    .filter((s) => isSlotAllowed(s.id, allowedSlotIds))
    .map((s) => s.id)
}

/**
 * Le cœur du lot : un clic fait avancer la case d'un cran.
 *
 * Pure et sans DOM — le composant ne fait que l'appeler. C'est ce qui permet
 * de tester la cinématique entière sans monter une seule case à l'écran.
 */
export function nextCellState(current: CellState, options: CycleOptions): CycleStep {
  // « 1 jour » ne veut rien dire sur une prestation facturée à l'heure.
  if (options.displayUnit === 'HEURE') return { action: 'FORMULAIRE' }

  // Une valeur libre ne cycle pas : elle rouvre son formulaire.
  if (current.kind === 'LIBRE') return { action: 'FORMULAIRE' }

  if (current.kind === 'VIDE') return { action: 'ETAT', state: { kind: 'JOURNEE' } }

  if (current.kind === 'JOURNEE') {
    const premier = options.demiSlotIds[0]
    return premier === undefined
      ? { action: 'ETAT', state: { kind: 'VIDE' } }
      : { action: 'ETAT', state: { kind: 'DEMI', slotId: premier } }
  }

  // DEMI : on avance dans les créneaux proposés puis on revient à vide. Un
  // créneau absent de la liste — restriction ajoutée après coup, saisie faite
  // au formulaire — est traité comme le dernier du cycle.
  const rang = options.demiSlotIds.indexOf(current.slotId)
  const suivant = rang === -1 ? undefined : options.demiSlotIds[rang + 1]
  return suivant === undefined
    ? { action: 'ETAT', state: { kind: 'VIDE' } }
    : { action: 'ETAT', state: { kind: 'DEMI', slotId: suivant } }
}
