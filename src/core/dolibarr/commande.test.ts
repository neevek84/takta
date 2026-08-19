import { describe, expect, it } from 'vitest'
import {
  LONGUEUR_MAX_TITRE,
  referenceExterneCommande,
  titreProjetDepuisCommande,
} from './commande'

describe('titreProjetDepuisCommande', () => {
  it('assemble référence client, nom du tiers, libellé et référence de commande', () => {
    expect(
      titreProjetDepuisCommande({
        refClient: 'BDC-2026-118',
        ref: 'CO2608-0042',
        label: 'AMOA ITSM',
        thirdpartyName: 'SILKHOM',
      }),
    ).toBe('BDC-2026-118 — SILKHOM — AMOA ITSM — CO2608-0042')
  })

  it('nomme le tiers même quand la commande n’a aucun libellé — le cas ordinaire', () => {
    // Aucune commande de l'instance du porteur ne porte de libellé : sans le
    // nom du tiers, le titre se réduirait à deux références opaques.
    expect(
      titreProjetDepuisCommande({
        refClient: '2419',
        ref: 'CO2410-0002',
        label: '',
        thirdpartyName: 'SILKHOM',
      }),
    ).toBe('2419 — SILKHOM — CO2410-0002')
  })

  it('ne répète pas la référence de la commande quand elle tient déjà la tête', () => {
    expect(
      titreProjetDepuisCommande({
        refClient: '',
        ref: 'CO2411-0001',
        label: '',
        thirdpartyName: 'SILKHOM',
      }),
    ).toBe('CO2411-0001 — SILKHOM')
  })

  it('retombe sur la référence de la commande quand elle ne porte aucun libellé', () => {
    expect(titreProjetDepuisCommande({ refClient: 'BDC-2026-118', ref: 'CO2608-0042', label: '' })).toBe(
      'BDC-2026-118 — CO2608-0042',
    )
  })

  it('ouvre sur la référence de la commande quand le client n’a pas donné la sienne', () => {
    expect(titreProjetDepuisCommande({ refClient: '', ref: 'CO2608-0042', label: 'AMOA ITSM' })).toBe(
      'CO2608-0042 — AMOA ITSM',
    )
  })

  it('se réduit à la référence de la commande quand il ne reste rien d’autre', () => {
    expect(titreProjetDepuisCommande({ refClient: '   ', ref: 'CO2608-0042', label: '  ' })).toBe(
      'CO2608-0042',
    )
  })

  it('replie les espaces et les sauts de ligne que Dolibarr laisse passer', () => {
    expect(
      titreProjetDepuisCommande({
        refClient: '  BDC 2026\n118 ',
        ref: 'CO2608-0042',
        label: ' AMOA\t ITSM ',
      }),
    ).toBe('BDC 2026 118 — AMOA ITSM — CO2608-0042')
  })

  it('tronque à la longueur que Dolibarr accepte, en gardant la référence en tête', () => {
    const titre = titreProjetDepuisCommande({
      refClient: 'BDC-2026-118',
      ref: 'CO2608-0042',
      label: 'A'.repeat(400),
    })
    expect(titre.length).toBe(LONGUEUR_MAX_TITRE)
    expect(titre.startsWith('BDC-2026-118 — ')).toBe(true)
  })

  it('ne laisse pas le titre finir sur un espace quand la coupe tombe dessus', () => {
    // « BDC-2026-118 — » fait 15 caractères : le 255ᵉ caractère du titre est
    // alors l'espace posé ici, et une troncature nue le laisserait pendre.
    const titre = titreProjetDepuisCommande({
      refClient: 'BDC-2026-118',
      ref: 'CO2608-0042',
      label: `${'A'.repeat(239)} ${'B'.repeat(20)}`,
    })
    expect(titre.endsWith(' ')).toBe(false)
    expect(titre.length).toBe(LONGUEUR_MAX_TITRE - 1)
  })

  it('refuse une commande sans référence : le titre n’aurait plus rien de stable', () => {
    expect(() => titreProjetDepuisCommande({ refClient: 'BDC', ref: '  ', label: 'x' })).toThrow(
      /référence/i,
    )
  })
})

describe('referenceExterneCommande', () => {
  it('rend la référence client, débarrassée de ses espaces', () => {
    expect(referenceExterneCommande({ refClient: '  BDC-2026-118 ' })).toBe('BDC-2026-118')
  })

  it('rend une chaîne vide quand la commande n’en porte aucune — rien à reporter', () => {
    expect(referenceExterneCommande({ refClient: '   ' })).toBe('')
  })
})
