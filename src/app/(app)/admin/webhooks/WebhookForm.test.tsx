// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WebhookForm } from './WebhookForm'
import { AUDIT_ACTIONS } from '@/core/audit/events'

afterEach(cleanup)

describe('formulaire d abonnement', () => {
  it('propose tout le catalogue à la souscription', () => {
    render(<WebhookForm />)
    for (const action of AUDIT_ACTIONS) {
      expect(screen.getByLabelText(action), action).toBeTruthy()
    }
  })

  it('explique ce que veut dire ne rien cocher', () => {
    render(<WebhookForm />)
    expect(screen.getByText(/aucun coché.*tous les événements/i)).toBeTruthy()
  })

  it('demande un libellé et une URL', () => {
    render(<WebhookForm />)
    expect(screen.getByLabelText(/libellé/i)).toBeTruthy()
    expect(screen.getByLabelText(/URL/i)).toBeTruthy()
  })

  it('n affiche jamais de secret', () => {
    const { container } = render(<WebhookForm />)
    expect(container.textContent).not.toMatch(/secret/i)
  })

  it('exige les deux champs sans lesquels rien ne peut être appelé', () => {
    render(<WebhookForm />)
    expect(screen.getByLabelText(/libellé/i).hasAttribute('required')).toBe(true)
    expect(screen.getByLabelText(/URL/i).hasAttribute('required')).toBe(true)
  })
})
