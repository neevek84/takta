// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ChargeTable } from './ChargeTable'
// La teinte du prévisionnel, prise à la source que le calendrier emploie.
import { PREVU_COLOR } from '@/core/saisie/colors'
import type { ChargeMatrix } from '@/services/charge'

afterEach(cleanup)

const fiscalYear = {
  start: '2026-01-01',
  end: '2026-02-28',
  label: 'Exercice 2026',
  months: ['2026-01', '2026-02'],
}

function buildMatrix(overrides: Partial<ChargeMatrix> = {}): ChargeMatrix {
  return {
    fiscalYear,
    rows: [],
    monthTotals: [
      { centiemes: 0, caCents: 0 },
      { centiemes: 0, caCents: 0 },
    ],
    progress: {
      objectifCents: 0,
      realiseCents: 0,
      prevuCents: 0,
      resteAVendreCents: 0,
      depassementCents: 0,
      tauxCouverture: 0,
    },
    resteEnJoursCentiemes: null,
    ...overrides,
  }
}

describe('ChargeTable', () => {
  it('affiche un message quand il n y a aucune ligne', () => {
    render(<ChargeTable matrix={buildMatrix()} />)
    expect(screen.getByText(/Aucune ligne de prestation/)).toBeDefined()
  })

  it('combine réalisé et prévu dans la même cellule', () => {
    const matrix = buildMatrix({
      rows: [
        {
          lineId: 'l1',
          label: 'ACME · ITSM · Consultant',
          tjmCents: 50_000,
          cells: [
            { realiseCentiemes: 200, prevuCentiemes: 100 },
            { realiseCentiemes: 0, prevuCentiemes: 0 },
          ],
          engagement: {
            venduCentiemes: 1000,
            realiseCentiemes: 200,
            prevuCentiemes: 100,
            resteCentiemes: 700,
            depassementCentiemes: 0,
          },
          resteAVendreCents: 350_000,
        },
      ],
    })
    render(<ChargeTable matrix={matrix} />)
    const cell = screen.getByTestId('cell-l1-2026-01')
    expect(cell.textContent).toBe('2 + 1')

    const emptyCell = screen.getByTestId('cell-l1-2026-02')
    expect(emptyCell.textContent).toBe('')
  })

  // Le prévisionnel se distingue du réalisé sans recourir à la teinte — et
  // sans rien ajouter au texte, que les deux assertions ci-dessus comparent
  // au caractère près.
  it('distingue le prévisionnel du réalisé sans la couleur ni le texte', () => {
    const matrix = buildMatrix({
      rows: [
        {
          lineId: 'l1',
          label: 'ACME · ITSM · Consultant',
          tjmCents: 50_000,
          cells: [
            { realiseCentiemes: 200, prevuCentiemes: 100 },
            { realiseCentiemes: 0, prevuCentiemes: 0 },
          ],
          engagement: {
            venduCentiemes: 1000,
            realiseCentiemes: 200,
            prevuCentiemes: 100,
            resteCentiemes: 700,
            depassementCentiemes: 0,
          },
          resteAVendreCents: 350_000,
        },
      ],
    })
    render(<ChargeTable matrix={matrix} />)
    const cell = screen.getByTestId('cell-l1-2026-01')

    const prevu = cell.querySelector('[title="Prévisionnel"]')
    expect(prevu).not.toBeNull()
    // Le tireté a remplacé la hachure du lot 1f : c'est lui, désormais, qui
    // porte l'état sans la teinte — ici comme au calendrier.
    expect(prevu!.className).toContain('border-dashed')
    expect(prevu!.className).toContain('italic')

    // Le marqueur reste hors du DOM textuel : le texte de la cellule ne bouge pas.
    expect(cell.textContent).toBe('2 + 1')
  })

  /**
   * La même loi que le calendrier et que la grille : le passé est froid, le
   * futur est chaud. Le prévisionnel prend sa teinte — `PREVU_COLOR`, celle
   * des aplats de `MonthCalendar` — et porte le contour tireté qui la double
   * en vision monochrome. Le plan de charge était resté aux hachures du lot
   * 1f, si bien que le même fait avait deux apparences selon l'écran.
   */
  it('emprunte au prévisionnel du calendrier sa teinte et son contour tireté', () => {
    const matrix = buildMatrix({
      rows: [
        {
          lineId: 'l1',
          label: 'ACME · ITSM · Consultant',
          tjmCents: 50_000,
          cells: [
            { realiseCentiemes: 200, prevuCentiemes: 100 },
            { realiseCentiemes: 0, prevuCentiemes: 0 },
          ],
          engagement: {
            venduCentiemes: 1000,
            realiseCentiemes: 200,
            prevuCentiemes: 100,
            resteCentiemes: 700,
            depassementCentiemes: 0,
          },
          resteAVendreCents: 350_000,
        },
      ],
    })
    render(<ChargeTable matrix={matrix} />)
    const cell = screen.getByTestId('cell-l1-2026-01')

    const prevu = cell.querySelector('[title="Prévisionnel"]')!
    // Les classes une à une : `toContain` sur la chaîne accepterait
    // `bg-prevu-edge` là où l'on exige `bg-prevu`.
    const classes = prevu.className.split(/\s+/).filter((c) => c !== '')
    expect(classes).toContain(PREVU_COLOR.bg)
    expect(classes).toContain('border-dashed')
    expect(classes).toContain(PREVU_COLOR.border)
    // La hachure a servi de marqueur non chromatique jusqu'au lot 1f ; c'est
    // le tireté qui le porte désormais, et deux marqueurs pour un état se
    // contrediraient dès que l'un des deux évoluerait.
    expect(classes).not.toContain('pattern-hatch')

    // Et le texte ne bouge toujours pas.
    expect(cell.textContent).toBe('2 + 1')
  })

  // Constat revue C.3 — la marge « Reste à planifier » doit utiliser le
  // même helper `jours()` (virgule française) que le reste du tableau,
  // pas une division brute qui laisse passer le point décimal JS.
  it('affiche le reste à planifier avec une virgule française, pas un point', () => {
    const matrix = buildMatrix({
      rows: [
        {
          lineId: 'l1',
          label: 'ACME · ITSM · Consultant',
          tjmCents: 50_000,
          cells: [
            { realiseCentiemes: 0, prevuCentiemes: 0 },
            { realiseCentiemes: 0, prevuCentiemes: 0 },
          ],
          engagement: {
            venduCentiemes: 2000,
            realiseCentiemes: 750,
            prevuCentiemes: 0,
            resteCentiemes: 1250,
            depassementCentiemes: 0,
          },
          resteAVendreCents: 625_000,
        },
      ],
    })
    render(<ChargeTable matrix={matrix} />)
    const reste = screen.getByTestId('reste-l1')
    expect(reste.textContent).toContain('12,5')
    expect(reste.textContent).not.toContain('12.5')
  })

  it('affiche le dépassement du reste à planifier avec une virgule française', () => {
    const matrix = buildMatrix({
      rows: [
        {
          lineId: 'l1',
          label: 'ACME · ITSM · Consultant',
          tjmCents: 50_000,
          cells: [
            { realiseCentiemes: 0, prevuCentiemes: 0 },
            { realiseCentiemes: 0, prevuCentiemes: 0 },
          ],
          engagement: {
            venduCentiemes: 1000,
            realiseCentiemes: 1150,
            prevuCentiemes: 0,
            resteCentiemes: 0,
            depassementCentiemes: 150,
          },
          resteAVendreCents: 0,
        },
      ],
    })
    render(<ChargeTable matrix={matrix} />)
    const reste = screen.getByTestId('reste-l1')
    expect(reste.textContent).toContain('1,5')
    expect(reste.textContent).not.toContain('1.5')
  })

  it('affiche le total mensuel et le chiffre d affaires en marge basse', () => {
    const matrix = buildMatrix({
      rows: [
        {
          lineId: 'l1',
          label: 'ACME · ITSM · Consultant',
          tjmCents: 50_000,
          cells: [
            { realiseCentiemes: 200, prevuCentiemes: 0 },
            { realiseCentiemes: 0, prevuCentiemes: 0 },
          ],
          engagement: {
            venduCentiemes: 1000,
            realiseCentiemes: 200,
            prevuCentiemes: 0,
            resteCentiemes: 800,
            depassementCentiemes: 0,
          },
          resteAVendreCents: 400_000,
        },
      ],
      monthTotals: [
        { centiemes: 200, caCents: 150_000 },
        { centiemes: 0, caCents: 0 },
      ],
    })
    render(<ChargeTable matrix={matrix} />)
    const total = screen.getByTestId('total-2026-01')
    expect(total.textContent!.replace(/\s/g, '')).toContain('1500€')

    const totalVide = screen.getByTestId('total-2026-02')
    expect(totalVide.textContent).toBe('')
  })
})
