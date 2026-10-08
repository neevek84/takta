import { describe, it, expect } from 'vitest'
import { cleVerrou, moisDe } from './verrou'

describe('cleVerrou', () => {
  it('associe une ligne et un mois', () => {
    expect(cleVerrou('l1', '2026-03')).toBe('l1|2026-03')
  })

  it('distingue deux mois de la même ligne', () => {
    expect(cleVerrou('l1', '2026-03')).not.toBe(cleVerrou('l1', '2026-04'))
  })
})

describe('moisDe', () => {
  it('lit le mois d une date', () => {
    expect(moisDe('2026-05-12')).toBe('2026-05')
  })
})
