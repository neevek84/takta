// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SuiviTable } from './SuiviTable'

function unCra(extra: Record<string, unknown> = {}) {
  return {
    id: 'cra-1',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    month: '2026-03',
    status: 'ENVOYE',
    invoiceNumber: null,
    invoicedAt: null,
    synthese: { totalCentiemes: 1250, joursServis: 13, lignes: [] },
    ...extra,
  }
}

describe('SuiviTable', () => {
  afterEach(cleanup)

  it('montre une ligne par CRA, avec son mois et ses jours', () => {
    render(<SuiviTable cras={[unCra()] as never} />)

    expect(screen.getByText('mars 2026')).toBeTruthy()
    expect(screen.getByText('ACME')).toBeTruthy()
    expect(screen.getByText('12,50')).toBeTruthy()
  })

  it('ouvre le detail du bon CRA', () => {
    render(<SuiviTable cras={[unCra({ id: 'cra-42' })] as never} />)

    expect(screen.getByRole('link', { name: /Ouvrir/ }).getAttribute('href')).toBe('/cra/cra-42')
  })

  it('affiche FACTURE pour un CRA valide portant un numero', () => {
    render(<SuiviTable cras={[unCra({ status: 'VALIDE', invoiceNumber: 'F-14' })] as never} />)

    expect(screen.getByTestId('cra-statut').textContent).toContain('Facturé')
  })

  // La liste montre et filtre ; le detail agit. Un bouton de transition ici
  // permettrait de valider sans avoir lu les deux avertissements qui vivent
  // sur la page de detail.
  it('n offre aucun bouton de transition', () => {
    render(<SuiviTable cras={[unCra()] as never} />)

    expect(screen.queryByRole('button', { name: 'Marquer validé' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('dit qu il n y a rien plutot que de rendre un tableau vide', () => {
    render(<SuiviTable cras={[]} />)

    expect(screen.getByText(/Aucun CRA/)).toBeTruthy()
  })
})
