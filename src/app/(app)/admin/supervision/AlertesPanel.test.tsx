// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AlertesPanel } from './AlertesPanel'
import type { Alerte } from '@/services/supervision'

afterEach(cleanup)

describe('panneau des alertes', () => {
  it('DIT EXPLICITEMENT que rien ne cloche', () => {
    // Sans cette phrase, un écran vide se confond avec un chargement raté.
    render(<AlertesPanel alertes={[]} />)
    expect(screen.getByText(/rien ne demande d’action/i)).toBeTruthy()
  })

  it('affiche chaque alerte avec son libellé et son détail', () => {
    const alertes: Alerte[] = [
      { code: 'JOURNAL_ROMPU', libelle: 'Rupture de la chaîne du journal', detail: 'Entrée 412 — EMPREINTE.' },
      { code: 'ABONNEMENT_SUSPENDU', libelle: 'Abonnement suspendu : n8n', detail: '12 échec(s).' },
    ]
    render(<AlertesPanel alertes={alertes} />)

    expect(screen.getByText('Rupture de la chaîne du journal')).toBeTruthy()
    expect(screen.getByText(/Entrée 412/)).toBeTruthy()
    expect(screen.getByText('Abonnement suspendu : n8n')).toBeTruthy()
  })

  it('ne porte jamais l information par la seule couleur', () => {
    render(
      <AlertesPanel
        alertes={[{ code: 'TRAVAIL_ECHEC', libelle: 'Travail en échec : X', detail: 'boum' }]}
      />,
    )
    // Le bandeau porte un glyphe, et un rôle d'alerte lu par les lecteurs d'écran.
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/[✕▲]/)
  })

  it('annonce le nombre d alertes dans le titre', () => {
    render(
      <AlertesPanel
        alertes={[
          { code: 'TRAVAIL_ECHEC', libelle: 'a', detail: 'x' },
          { code: 'LIVRAISON_ABANDONNEE', libelle: 'b', detail: 'y' },
        ]}
      />,
    )
    expect(screen.getByRole('heading', { name: /à traiter — 2/i })).toBeTruthy()
  })
})
