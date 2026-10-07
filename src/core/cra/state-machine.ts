import type { CraStatus } from '../types'

export type CraTransition =
  | 'ENVOYER'
  | 'VALIDER'
  | 'REFUSER'
  | 'ROUVRIR'
  /** corriger un refus et repartir en un geste, sans « Rouvrir » puis « Envoyer » */
  | 'RENVOYER'
  /**
   * Retirer un CRA envoyé avant la réponse du client. N'est franchie que par
   * `annulerEnvoi`, qui annule aussi l'enveloppe chez le prestataire : un CRA
   * rouvert chez nous mais encore signable ailleurs validerait un mois en cours
   * de modification.
   */
  | 'ANNULER_ENVOI'

export class InvalidTransitionError extends Error {
  constructor(from: CraStatus, transition: CraTransition) {
    super(`Transition ${transition} impossible depuis l'état ${from}`)
    this.name = 'InvalidTransitionError'
  }
}

const TRANSITIONS: Record<CraStatus, Partial<Record<CraTransition, CraStatus>>> = {
  BROUILLON: { ENVOYER: 'ENVOYE' },
  ENVOYE: { VALIDER: 'VALIDE', REFUSER: 'REFUSE', ANNULER_ENVOI: 'BROUILLON' },
  VALIDE: { ROUVRIR: 'BROUILLON' },
  REFUSE: { ROUVRIR: 'BROUILLON', RENVOYER: 'ENVOYE' },
}

/**
 * Les transitions qu'un formulaire peut demander. `ANNULER_ENVOI` n'en est
 * pas : elle doit retirer l'enveloppe chez le prestataire, et seul
 * `annulerEnvoi` le fait. La laisser passer par le bouton générique rouvrirait
 * un mois encore signable ailleurs.
 */
export const TRANSITIONS_MANUELLES: readonly CraTransition[] = [
  'ENVOYER',
  'VALIDER',
  'REFUSER',
  'ROUVRIR',
  'RENVOYER',
]

/** Garde de saisie : une chaîne venue d'un formulaire est-elle une transition manuelle ? */
export function estTransitionManuelle(valeur: string): valeur is CraTransition {
  return (TRANSITIONS_MANUELLES as readonly string[]).includes(valeur)
}

export function canTransition(from: CraStatus, t: CraTransition): boolean {
  return TRANSITIONS[from][t] !== undefined
}

export function applyTransition(from: CraStatus, t: CraTransition): CraStatus {
  const next = TRANSITIONS[from][t]
  if (next === undefined) throw new InvalidTransitionError(from, t)
  return next
}

/**
 * **La saisie du mois est fermée.**
 *
 * `ENVOYE` en fait partie depuis le lot 3b : sans ce verrou, le consultant
 * modifiait ses jours pendant que le client relisait, et une signature
 * arrivée ensuite validait des chiffres que le client n'avait pas vus.
 *
 * À ne pas confondre avec `isArrete` : un mois fermé n'est pas forcément un
 * mois dont les temps peuvent partir.
 */
export function isLocked(status: CraStatus): boolean {
  return status === 'ENVOYE' || status === 'VALIDE'
}

/**
 * **Le mois est arrêté : ses temps peuvent partir chez Dolibarr.**
 *
 * Séparé de `isLocked` au lot 3b. Le push et son rattrapage lisaient
 * `isLocked` dans ce sens-là ; l'élargir à `ENVOYE` leur aurait fait pousser
 * des temps **avant** la signature du client.
 */
export function isArrete(status: CraStatus): boolean {
  return status === 'VALIDE'
}
