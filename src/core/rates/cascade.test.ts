import { describe, it, expect } from 'vitest'
import { resolveMinutesParJour } from './cascade'

describe('resolveMinutesParJour', () => {
  it('retombe sur le réglage global quand rien n est surchargé', () => {
    expect(resolveMinutesParJour({ global: 480 })).toBe(480)
  })

  it('le client l emporte sur le global', () => {
    expect(resolveMinutesParJour({ client: 420, global: 480 })).toBe(420)
  })

  it('la mission l emporte sur le client', () => {
    expect(resolveMinutesParJour({ mission: 450, client: 420, global: 480 })).toBe(450)
  })

  it('la prestation l emporte sur tout', () => {
    expect(resolveMinutesParJour({ line: 400, mission: 450, client: 420, global: 480 })).toBe(400)
  })

  it('traite null et undefined comme non renseignés', () => {
    expect(resolveMinutesParJour({ line: null, mission: undefined, client: 420, global: 480 })).toBe(420)
  })

  it('ne saute pas un niveau intermédiaire non renseigné', () => {
    expect(resolveMinutesParJour({ line: null, mission: null, client: 420, global: 480 })).toBe(420)
    expect(resolveMinutesParJour({ line: 400, mission: null, client: null, global: 480 })).toBe(400)
  })

  it('rejette un facteur global non exploitable', () => {
    expect(() => resolveMinutesParJour({ global: 0 })).toThrow()
    expect(() => resolveMinutesParJour({ global: -1 })).toThrow()
  })

  it('rejette une surcharge non exploitable plutôt que de la sauter', () => {
    // Sauter silencieusement ferait passer une donnée corrompue pour un héritage.
    expect(() => resolveMinutesParJour({ client: 0, global: 480 })).toThrow()
    expect(() => resolveMinutesParJour({ line: -5, global: 480 })).toThrow()
  })
})
