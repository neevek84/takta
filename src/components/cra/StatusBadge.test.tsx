// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusBadge, craStatusBadge } from './StatusBadge'
import { CRA_STATUSES } from '@/core/types'

afterEach(cleanup)

describe('StatusBadge', () => {
  it('couvre les quatre statuts', () => {
    for (const status of CRA_STATUSES) {
      expect(craStatusBadge(status).label).toBeTruthy()
    }
  })

  it('donne à chaque statut une icône distincte', () => {
    const icones = CRA_STATUSES.map((s) => craStatusBadge(s).icone)
    expect(new Set(icones).size).toBe(CRA_STATUSES.length)
  })

  it('donne à chaque statut une teinte distincte', () => {
    const teintes = CRA_STATUSES.map((s) => craStatusBadge(s).tone)
    expect(new Set(teintes).size).toBe(CRA_STATUSES.length)
  })

  it('écrit le libellé en français, pas la constante', () => {
    render(<StatusBadge status="VALIDE" />)
    expect(screen.getByTestId('cra-statut').textContent).toContain('Validé')
    expect(screen.getByTestId('cra-statut').textContent).not.toContain('VALIDE')
  })

  it('reste lisible sans la couleur', () => {
    render(<StatusBadge status="REFUSE" />)
    const badge = screen.getByTestId('cra-statut')
    // Un tracé, pas un caractère de la police système : `data-icone` le nomme,
    // et il distingue « Refusé » de « Validé » en vision monochrome.
    expect(badge.querySelector('svg[data-icone="danger"]')).not.toBeNull()
    expect(badge.textContent).toContain('Refusé')
  })
})
