// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { HistoriqueEnvois } from './HistoriqueEnvois'

afterEach(cleanup)

describe('HistoriqueEnvois', () => {
  it('rend chaque envoi, son état en toutes lettres et le motif du refus', () => {
    render(
      <HistoriqueEnvois
        envois={[
          { numero: 2, status: 'SIGNE', sentAt: new Date('2026-10-06T09:00:00Z'), completedAt: new Date('2026-10-06T10:00:00Z'), motifRefus: '', signataireNom: 'Jeanne Martin', empreinte: '3f9a00000000c21e', enCours: true },
          { numero: 1, status: 'REFUSE', sentAt: new Date('2026-10-01T09:00:00Z'), completedAt: new Date('2026-10-03T09:00:00Z'), motifRefus: 'Il manque le 15.', signataireNom: 'Jeanne Martin', empreinte: '', enCours: false },
        ]}
      />,
    )
    expect(screen.getByText('Envoi n° 2')).toBeTruthy()
    expect(screen.getByText(/signé/)).toBeTruthy()
    expect(screen.getByText('« Il manque le 15. »')).toBeTruthy()
    expect(screen.getByText(/3f9a…c21e/)).toBeTruthy()
  })

  it('ne rend rien sans envoi', () => {
    const { container } = render(<HistoriqueEnvois envois={[]} />)
    expect(container.textContent).toBe('')
  })
})
