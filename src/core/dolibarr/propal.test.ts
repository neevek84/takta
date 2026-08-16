import { describe, it, expect } from 'vitest'
import { reprendreLignePropale } from './propal'

describe('reprendreLignePropale', () => {
  it('reprend la quantité vendue en centièmes de jour et le prix unitaire tel quel', () => {
    expect(reprendreLignePropale({ qty: 30, subpriceCents: 80_000 })).toEqual({
      soldCentiemes: 3000,
      tjmCents: 80_000,
    })
  })

  it('porte l engagement ligne par ligne, jamais en total de propale', () => {
    // « Consultant ITSM 30 j TJM 800 » et « Consultant ITSM Nuit 10 j TJM 1200 »
    // sont deux engagements distincts : chacun se reprend seul, et rien ne les
    // additionne — un total ferait disparaître le tarif de nuit.
    const jour = reprendreLignePropale({ qty: 30, subpriceCents: 80_000 })
    const nuit = reprendreLignePropale({ qty: 10, subpriceCents: 120_000 })
    expect([jour, nuit]).toEqual([
      { soldCentiemes: 3000, tjmCents: 80_000 },
      { soldCentiemes: 1000, tjmCents: 120_000 },
    ])
  })

  it('accepte une demi-journée vendue', () => {
    expect(reprendreLignePropale({ qty: 10.5, subpriceCents: 70_000 }).soldCentiemes).toBe(1050)
  })

  it('rend un entier même quand le produit flottant tombe juste en dessous', () => {
    // 7.35 * 100 vaut 734.999… en binaire : tronquer écrirait 734 centièmes,
    // soit un centième de jour vendu perdu à chaque reprise.
    expect(reprendreLignePropale({ qty: 7.35, subpriceCents: 0 }).soldCentiemes).toBe(735)
    expect(Number.isInteger(reprendreLignePropale({ qty: 7.35, subpriceCents: 0 }).soldCentiemes)).toBe(
      true,
    )
  })

  it('accepte une ligne à quantité nulle', () => {
    expect(reprendreLignePropale({ qty: 0, subpriceCents: 0 })).toEqual({
      soldCentiemes: 0,
      tjmCents: 0,
    })
  })

  it('refuse une quantité négative ou illisible', () => {
    expect(() => reprendreLignePropale({ qty: -1, subpriceCents: 0 })).toThrow(/quantité/i)
    expect(() => reprendreLignePropale({ qty: Number.NaN, subpriceCents: 0 })).toThrow(/quantité/i)
  })

  it('refuse un prix unitaire qui n est pas un entier de centimes', () => {
    expect(() => reprendreLignePropale({ qty: 1, subpriceCents: 800.5 })).toThrow(/centimes/i)
    expect(() => reprendreLignePropale({ qty: 1, subpriceCents: -1 })).toThrow(/centimes/i)
  })
})
