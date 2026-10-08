import { describe, it, expect, beforeEach } from 'vitest'
import { autoriser, reinitialiserLimiteur, tailleLimiteur } from './limiteur'

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

  it('balaie les fenêtres échues au-delà du seuil, et garde les actives', () => {
    const t = 1_000_000
    for (let i = 0; i < 1001; i += 1) autoriser(`vieille-${i}`, t)
    autoriser('active', t + 14 * 60_000)
    expect(tailleLimiteur()).toBe(1002)
    // Les 1001 premières ont plus de quinze minutes ; « active » en a une.
    autoriser('autre', t + 16 * 60_000)
    expect(tailleLimiteur()).toBe(2)
    // « active » a gardé son compteur (1 essai) : dix-neuf de plus la mènent à vingt.
    for (let i = 0; i < 19; i += 1) autoriser('active', t + 16 * 60_000)
    expect(autoriser('active', t + 16 * 60_000)).toBe(false)
  })
})
