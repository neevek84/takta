// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EngagementBar } from './EngagementBar'
import type { LineForGrid } from '@/services/missions'

const line: LineForGrid = {
  id: 'l1',
  label: 'Consultant ITSM',
  missionLabel: 'ITSM',
  clientName: 'ACME',
  displayUnit: 'JOUR',
  minutesParJour: 480,
  soldCentiemes: 3000, // 30 jours vendus
  allowedSlotIds: [],
}

function texte(): string {
  return screen.getByTestId('engagement-l1').textContent ?? ''
}

describe('EngagementBar', () => {
  afterEach(cleanup)

  // L'engagement se lit sur toute la durée de la ligne : le bandeau reçoit un
  // cumul déjà agrégé, jamais les seules saisies du mois affiché.
  it('déduit le reste du cumul réalisé et prévisionnel', () => {
    render(
      <EngagementBar line={line} totals={{ realiseMinutes: 480 * 18, prevuMinutes: 480 * 7 }} />,
    )
    expect(texte()).toContain('30 vendus')
    expect(texte()).toContain('18 réalisés')
    expect(texte()).toContain('7 prévus')
    expect(texte()).toContain('5 restants')
  })

  it('affiche le vendu intégral quand la ligne n a aucune saisie', () => {
    render(<EngagementBar line={line} totals={{ realiseMinutes: 0, prevuMinutes: 0 }} />)
    expect(texte()).toContain('30 restants')
  })

  it('signale le dépassement accumulé sur plusieurs mois', () => {
    render(<EngagementBar line={line} totals={{ realiseMinutes: 480 * 32, prevuMinutes: 0 }} />)
    expect(texte()).toContain('0 restants')
    expect(texte()).toContain('dépassement de 2 j')
  })

  it('respecte le minutesParJour de la ligne', () => {
    render(
      <EngagementBar
        line={{ ...line, minutesParJour: 432 }}
        totals={{ realiseMinutes: 432 * 10, prevuMinutes: 0 }}
      />,
    )
    expect(texte()).toContain('10 réalisés')
  })
})
