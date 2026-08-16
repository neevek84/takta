import { describe, it, expect } from 'vitest'
import { buildInvoiceDraft } from './invoice'
import type { PushableEntry } from './timespent'

function saisie(over: Partial<PushableEntry> = {}): PushableEntry {
  return {
    id: 'e1',
    lineId: 'l1',
    date: '2026-05-04',
    slotId: '',
    minutes: 480,
    kind: 'REALISE',
    minutesParJour: 480,
    comment: '',
    ...over,
  }
}

const LIGNES = [{ id: 'l1', label: 'Développement', tjmCents: 80_000 }]

describe('buildInvoiceDraft', () => {
  it('facture les jours validés au TJM de la ligne', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      saisie({ id: `e${i}`, date: `2026-05-${String(i + 1).padStart(2, '0')}` }),
    )
    const draft = buildInvoiceDraft({ socid: 42, month: '2026-05', entries, lines: LIGNES })

    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0]!.qteCentiemes).toBe(2000) // 20,00 jours
    expect(draft.lines[0]!.totalHtCents).toBe(1_600_000) // 20 × 800 €
    expect(draft.totalHtCents).toBe(1_600_000)
  })

  it('convertit chaque groupe de facteur séparément', () => {
    // 120 min à 420/jour = 29 centièmes ; 60 min à 480/jour = 13 ; total 42.
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [
        saisie({ id: 'a', date: '2026-05-04', minutes: 60, minutesParJour: 420 }),
        saisie({ id: 'b', date: '2026-05-05', minutes: 60, minutesParJour: 420 }),
        saisie({ id: 'c', date: '2026-05-06', minutes: 60, minutesParJour: 480 }),
      ],
      lines: LIGNES,
    })
    expect(draft.lines[0]!.qteCentiemes).toBe(42)
  })

  it('ne facture aucun prévisionnel', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ id: 'p', kind: 'PREVISIONNEL' })],
      lines: LIGNES,
    })
    expect(draft.lines).toEqual([])
    expect(draft.totalHtCents).toBe(0)
  })

  it('ignore une saisie dont la ligne est inconnue', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ lineId: 'inconnue' })],
      lines: LIGNES,
    })
    expect(draft.lines).toEqual([])
  })

  it('omet une ligne sans réalisé plutôt que d en produire une à zéro', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ lineId: 'l1' })],
      lines: [...LIGNES, { id: 'l2', label: 'Recette', tjmCents: 70_000 }],
    })
    expect(draft.lines.map((l) => l.lineId)).toEqual(['l1'])
  })

  it('conserve l ordre des lignes fourni par l appelant', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [
        saisie({ id: 'a', lineId: 'l2' }),
        saisie({ id: 'b', lineId: 'l1', date: '2026-05-05' }),
      ],
      lines: [...LIGNES, { id: 'l2', label: 'Recette', tjmCents: 70_000 }],
    })
    expect(draft.lines.map((l) => l.lineId)).toEqual(['l1', 'l2'])
  })

  it('ne produit ni numéro, ni TVA, ni mention légale', () => {
    // Dolibarr facture, pas le CRA. Le jour où quelqu'un ajoutera un champ
    // `tva` ou `ref` ici, ce test tombera — et c'est le but.
    const draft = buildInvoiceDraft({ socid: 42, month: '2026-05', entries: [saisie()], lines: LIGNES })
    expect(Object.keys(draft).sort()).toEqual(['lines', 'month', 'socid', 'totalHtCents'])
    expect(Object.keys(draft.lines[0]!).sort()).toEqual([
      'label',
      'lineId',
      'qteCentiemes',
      'tjmCents',
      'totalHtCents',
    ])
  })

  it('ignore une saisie à minutesParJour inexploitable plutôt que de planter la facture', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ minutesParJour: 0 }), saisie({ id: 'e2', minutesParJour: -420 })],
      lines: LIGNES,
    })
    expect(draft.lines).toEqual([])
    expect(draft.totalHtCents).toBe(0)
  })

  it('additionne le HT de plusieurs lignes sans jamais mélanger leurs quantités', () => {
    // Deux lignes à TJM différents : un total qui tomberait juste par coïncidence
    // masquerait un mélange de qteCentiemes entre lignes.
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [
        saisie({ id: 'a', lineId: 'l1', minutes: 480, minutesParJour: 480 }), // 100 centièmes
        saisie({ id: 'b', lineId: 'l2', date: '2026-05-05', minutes: 240, minutesParJour: 480 }), // 50 centièmes
      ],
      lines: [{ id: 'l1', label: 'Développement', tjmCents: 80_000 }, { id: 'l2', label: 'Recette', tjmCents: 70_000 }],
    })
    const l1 = draft.lines.find((l) => l.lineId === 'l1')!
    const l2 = draft.lines.find((l) => l.lineId === 'l2')!
    expect(l1.totalHtCents).toBe(80_000) // 1,00 jour × 800 €
    expect(l2.totalHtCents).toBe(35_000) // 0,50 jour × 700 €
    expect(draft.totalHtCents).toBe(115_000)
  })

  it('omet une ligne dont les minutes existent mais s arrondissent à zéro centième', () => {
    // 1 minute sur une journée de 100 000 min arrondit à 0 centième : la
    // ligne a bien une saisie « réalisée », mais rien de facturable — elle ne
    // doit pas apparaître avec une quantité et un total à zéro.
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ minutes: 1, minutesParJour: 100_000 })],
      lines: LIGNES,
    })
    expect(draft.lines).toEqual([])
    expect(draft.totalHtCents).toBe(0)
  })

  it('arrondit le HT d une ligne au centime le plus proche, jamais vers le bas par troncature', () => {
    // 158 min à 480/jour = 33 centièmes (32,9166… arrondi). 33 × 800,50 € =
    // 26 416,50 € pile : un arrondi qui tombe à .5 tranche entre round et
    // floor/troncature, ce qu'aucune valeur qui « tombe juste » ne peut faire.
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ minutes: 158, minutesParJour: 480 })],
      lines: [{ id: 'l1', label: 'Développement', tjmCents: 80_050 }],
    })
    expect(draft.lines[0]!.qteCentiemes).toBe(33)
    expect(draft.lines[0]!.totalHtCents).toBe(26_417)
    expect(draft.totalHtCents).toBe(26_417)
  })
})
