// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { CraDocument } from '@/core/cra/document'
import { CraLecture } from './CraLecture'

afterEach(cleanup)

const doc = {
  emetteur: { nom: 'Kreativ', adresse: '', siret: '', email: '' },
  clientNom: 'Client SA', missionLabel: 'ITSM', mois: '2026-09', moisLibelle: 'septembre 2026',
  signataireNom: 'Jeanne', signataireEmail: 'j@c.fr',
  lignes: [{ label: 'Consultant', jours: [{ date: '2026-09-01', centiemes: 100 }], totalCentiemes: 100, engagement: {} }],
  totalCentiemes: 100, joursDuMois: ['2026-09-01', '2026-09-05'], feries: [], engagementMission: {},
} as unknown as CraDocument

describe('CraLecture', () => {
  it('affiche le client, le mois, le total et la ligne', () => {
    render(<CraLecture document={doc} />)
    expect(screen.getByText(/Client SA · ITSM/)).toBeTruthy()
    expect(screen.getAllByText(/septembre 2026/).length).toBeGreaterThan(0)
    expect(screen.getByText('Consultant')).toBeTruthy()
  })

  it('nomme le week-end au lieu de seulement le griser', () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.textContent).toMatch(/sam\./)
  })

  it("n'affiche aucun montant", () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.textContent).not.toMatch(/€|EUR|montant/i)
  })

  it("n'offre aucun champ de saisie", () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.querySelectorAll('input, textarea, select, button')).toHaveLength(0)
  })
})
