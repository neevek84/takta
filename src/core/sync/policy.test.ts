import { describe, it, expect } from 'vitest'
import { MAX_ATTEMPTS, RETRY_DELAYS_MINUTES, nextAttempt } from './policy'

const NOW = new Date('2026-03-10T10:00:00.000Z')

function apres(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000)
}

describe('nextAttempt', () => {
  it('respecte la séquence 1, 5, 15, 60, 360 minutes', () => {
    expect(nextAttempt(0, NOW).nextAttemptAt).toEqual(apres(1))
    expect(nextAttempt(1, NOW).nextAttemptAt).toEqual(apres(5))
    expect(nextAttempt(2, NOW).nextAttemptAt).toEqual(apres(15))
    expect(nextAttempt(3, NOW).nextAttemptAt).toEqual(apres(60))
    expect(nextAttempt(4, NOW).nextAttemptAt).toEqual(apres(360))
  })

  it('compte la tentative consommée', () => {
    expect(nextAttempt(0, NOW).attempts).toBe(1)
    expect(nextAttempt(3, NOW).attempts).toBe(4)
  })

  it('reste PENDING tant que le quota n est pas épuisé', () => {
    expect(nextAttempt(0, NOW).state).toBe('PENDING')
    expect(nextAttempt(3, NOW).state).toBe('PENDING')
  })

  it('passe à FAILED à la cinquième tentative', () => {
    // La ligne ne disparaît pas pour autant : elle remonte dans l'écran de
    // synchronisation, où elle se rejoue.
    expect(nextAttempt(4, NOW).state).toBe('FAILED')
    expect(nextAttempt(4, NOW).attempts).toBe(MAX_ATTEMPTS)
  })

  it('reste FAILED au-delà, sans plafonner le compteur au mauvais endroit', () => {
    const suite = nextAttempt(9, NOW)
    expect(suite.state).toBe('FAILED')
    expect(suite.attempts).toBe(10)
    expect(suite.nextAttemptAt).toEqual(apres(360))
  })

  it('ne planifie jamais une tentative dans le passé', () => {
    for (let i = 0; i < 8; i++) {
      expect(nextAttempt(i, NOW).nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime())
    }
  })

  it('expose une séquence de longueur cohérente avec le quota', () => {
    expect(RETRY_DELAYS_MINUTES).toEqual([1, 5, 15, 60, 360])
    expect(MAX_ATTEMPTS).toBe(5)
  })
})
