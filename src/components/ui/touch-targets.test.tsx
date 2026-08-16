// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { buildMonthDays } from '@/core/month/build'
import { Button } from './Button'
import { Field } from './Field'
import { Select } from './Select'
import { Checkbox } from './Checkbox'
import type { LineForGrid } from '@/services/missions'

afterEach(cleanup)

const lines: LineForGrid[] = [
  {
    id: 'l1',
    label: 'Consultant ITSM',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    displayUnit: 'JOUR',
    minutesParJour: 480,
    soldCentiemes: 3000,
    allowedSlotIds: [],
  },
]

// 44 points est la cible minimale de la spec, et le lot 1c en dépend.
// happy-dom ne calcule pas de mise en page : on vérifie le contrat de classe,
// dont `globals.css` garantit qu'il vaut 2,75rem, soit 44 px.
describe('cibles tactiles', () => {
  it('sur les contrôles de la bibliothèque', () => {
    render(
      <>
        <Button>Enregistrer</Button>
        <Field label="Seuil" name="seuil" />
        <Select label="Mission" name="missionId">
          <option value="m">M</option>
        </Select>
        <Checkbox label="Lundi" name="jours" value="1" />
      </>,
    )
    expect(screen.getByRole('button').className).toContain('touch-target')
    expect(screen.getByLabelText('Seuil').className).toContain('touch-target')
    expect(screen.getByLabelText('Mission').className).toContain('touch-target')
    // La cible tactile de la case à cocher est portée par son libellé, pas par
    // l'entrée elle-même (16 px) : `container.querySelector('label[for]')`
    // aurait accroché le premier libellé venu (celui de `Field`, qui n'a pas
    // besoin du jeton puisque c'est son champ qui le porte). On remonte donc
    // depuis la case à cocher jusqu'à son libellé englobant.
    expect(screen.getByRole('checkbox').closest('label')!.className).toContain('touch-target')
  })

  it('sur chaque cellule de la grille de saisie', () => {
    // La surface la plus dense de l'application : c'est là que la règle coûte
    // le plus, et qu'elle compte le plus. Comme ci-dessus, happy-dom ne calcule
    // aucune mise en page — ce test ne dit rien d'une largeur d'écran donnée,
    // il vérifie que chaque cellule porte le jeton qui vaut 44 points.
    render(
      <MonthGrid
        days={buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])}
        lines={lines}
        entries={[]}
        engagementTotals={{ l1: [] }}
        capacityCentiemes={100}
        capacityMode="BLOCAGE"
        onSave={vi.fn(async () => true)}
      />,
    )
    const champs = screen.getAllByLabelText(/^Consultant ITSM 2026-03-/)
    expect(champs).toHaveLength(31)
    for (const champ of champs) {
      expect(champ.className).toContain('touch-target')
    }
  })
})
