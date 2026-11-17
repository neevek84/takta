import { describe, it, expect } from 'vitest'
import { extraireTextes, renderPdf } from '../pdf/writer'
import { buildPlanningDocument } from './document'
import { layoutPlanningDocument } from './layout'

function planning(du: string, au: string) {
  return buildPlanningDocument({
    clientNom: 'SPIE ICS',
    missionLabel: 'STTHOMAS',
    prestationLabel: 'RSI de Transition',
    periode: { du, au },
    editeLe: '2026-11-16',
    saisies: [
      { date: '2026-11-24', minutes: 480, minutesParJour: 480, startMinute: 540 },
      { date: '2026-12-01', minutes: 240, minutesParJour: 480, startMinute: 840 },
      { date: '2027-01-05', minutes: 480, minutesParJour: 480, startMinute: 540 },
    ],
  })
}

describe('layoutPlanningDocument', () => {
  it('pose deux mois par page, en A4 couché', () => {
    const pages = layoutPlanningDocument(planning('2026-11-01', '2027-03-31'))
    expect(pages).toHaveLength(3)
    expect(pages[0]?.width).toBeGreaterThan(pages[0]?.height ?? 0)
  })

  it('imprime l’en-tête, les mois, les étiquettes et le total', () => {
    const textes = extraireTextes(
      renderPdf(layoutPlanningDocument(planning('2026-11-01', '2027-01-31'))),
    )
    expect(textes).toContain('SPIE ICS')
    expect(textes).toContain('Mission STTHOMAS — RSI de Transition')
    expect(textes).toContain('Du 01/11/2026 au 31/01/2027')
    expect(textes).toContain('Novembre')
    expect(textes).toContain('Janvier')
    expect(textes.filter((t) => t === 'Journée')).toHaveLength(2)
    expect(textes).toContain('½ après-midi')
    expect(textes).toContain('2,5 j')
    expect(textes).toContain('Noël')
  })

  it('n’imprime aucun montant ni aucun jour vendu', () => {
    const textes = extraireTextes(
      renderPdf(layoutPlanningDocument(planning('2026-11-01', '2027-01-31'))),
    ).join(' ')
    expect(textes).not.toMatch(/€|vendu|restant|TJM/i)
  })

  it('ne pose aucune étiquette hors de la période', () => {
    const textes = extraireTextes(
      renderPdf(layoutPlanningDocument(planning('2026-11-25', '2026-12-31'))),
    )
    expect(textes).not.toContain('Journée')
    expect(textes).toContain('½ après-midi')
  })
})
