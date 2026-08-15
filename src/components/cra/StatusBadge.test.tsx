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

  it('donne à chaque statut un glyphe distinct', () => {
    const glyphes = CRA_STATUSES.map((s) => craStatusBadge(s).glyph)
    expect(new Set(glyphes).size).toBe(CRA_STATUSES.length)
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
    expect(screen.getByTestId('cra-statut').textContent).toContain('✕')
    expect(screen.getByTestId('cra-statut').textContent).toContain('Refusé')
  })
})
