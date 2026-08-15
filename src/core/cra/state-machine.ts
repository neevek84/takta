import type { CraStatus } from '../types'

export type CraTransition = 'ENVOYER' | 'VALIDER' | 'REFUSER' | 'ROUVRIR'

export class InvalidTransitionError extends Error {
  constructor(from: CraStatus, transition: CraTransition) {
    super(`Transition ${transition} impossible depuis l'état ${from}`)
    this.name = 'InvalidTransitionError'
  }
}

const TRANSITIONS: Record<CraStatus, Partial<Record<CraTransition, CraStatus>>> = {
  BROUILLON: { ENVOYER: 'ENVOYE' },
  ENVOYE: { VALIDER: 'VALIDE', REFUSER: 'REFUSE' },
  VALIDE: { ROUVRIR: 'BROUILLON' },
  REFUSE: { ROUVRIR: 'BROUILLON' },
}

export function canTransition(from: CraStatus, t: CraTransition): boolean {
  return TRANSITIONS[from][t] !== undefined
}

export function applyTransition(from: CraStatus, t: CraTransition): CraStatus {
  const next = TRANSITIONS[from][t]
  if (next === undefined) throw new InvalidTransitionError(from, t)
  return next
}

export function isLocked(status: CraStatus): boolean {
  return status === 'VALIDE'
}
