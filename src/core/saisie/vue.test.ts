import { describe, it, expect } from 'vitest'
import { estVue } from './vue'

describe('estVue', () => {
  it.each(['CALENDRIER', 'TROIS_MOIS', 'TABLEAU'])('reconnaît %s', (valeur) => {
    expect(estVue(valeur)).toBe(true)
  })

  it("rejette une valeur qui n'est pas une vue", () => {
    expect(estVue('AUTRE')).toBe(false)
  })

  it('rejette la chaîne vide', () => {
    expect(estVue('')).toBe(false)
  })
})
