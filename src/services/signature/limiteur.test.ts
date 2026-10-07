import { describe, it, expect, beforeEach } from 'vitest'
import { autoriser, reinitialiserLimiteur } from './limiteur'

beforeEach(() => reinitialiserLimiteur())

describe('limiteur par IP', () => {
  it('autorise vingt essais par quart d heure, puis refuse', () => {
    const t = 1_000_000
    for (let i = 0; i < 20; i += 1) expect(autoriser('1.2.3.4', t)).toBe(true)
    expect(autoriser('1.2.3.4', t)).toBe(false)
    expect(autoriser('5.6.7.8', t)).toBe(true)
  })

  it('rouvre après la fenêtre', () => {
    const t = 1_000_000
    for (let i = 0; i < 21; i += 1) autoriser('1.2.3.4', t)
    expect(autoriser('1.2.3.4', t + 15 * 60_000)).toBe(true)
  })
})
