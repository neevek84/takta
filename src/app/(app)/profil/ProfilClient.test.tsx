// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { enregistrerIdentifiantDolibarr, deconnecterGoogle } = vi.hoisted(() => ({
  enregistrerIdentifiantDolibarr: vi.fn(),
  deconnecterGoogle: vi.fn(),
}))
vi.mock('./actions', () => ({ enregistrerIdentifiantDolibarr, deconnecterGoogle }))

import { ProfilClient } from './ProfilClient'

const CONNECTE = { connected: true, calendarId: 'cal-1', scope: '', connectedAt: null }
const ABSENT = { connected: false, calendarId: '', scope: '', connectedAt: null }

beforeEach(() => {
  enregistrerIdentifiantDolibarr.mockReset()
  deconnecterGoogle.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('l identifiant Dolibarr', () => {
  it('montre celui de la personne quand elle en a un', () => {
    render(<ProfilClient identifiant={3} suggestion={null} connection={ABSENT} />)

    const champ = screen.getByLabelText('Identifiant utilisateur Dolibarr') as HTMLInputElement
    expect(champ.value).toBe('3')
  })

  // Le porteur avait déjà saisi cette valeur, du temps où elle était d'instance.
  // La lui redemander sans la lui montrer serait lui faire chercher un nombre
  // que l'application connaît.
  it("propose l'ancien réglage d'instance, en disant d'où il vient", () => {
    render(<ProfilClient identifiant={null} suggestion={4} connection={ABSENT} />)

    const champ = screen.getByLabelText('Identifiant utilisateur Dolibarr') as HTMLInputElement
    expect(champ.value).toBe('4')
    expect(document.body.textContent).toMatch(/réglages de l’instance/i)
  })

  // Une suggestion n'est pas un réglage : tant qu'elle n'est pas confirmée, rien
  // ne part. L'écran doit donc dire que le geste reste à faire.
  it('ne fait pas passer la suggestion pour un réglage enregistré', () => {
    render(<ProfilClient identifiant={null} suggestion={4} connection={ABSENT} />)

    expect(document.body.textContent).toMatch(/n’est pas encore enregistré/i)
  })

  // Un réglage enregistré fait taire la suggestion. Sans ce cas, `propose`
  // pourrait ne regarder que la suggestion : l'écran afficherait alors « n° 4
  // vous est proposé » au-dessus d'un champ qui porte 3, et rien ne dirait
  // lequel des deux part réellement chez Dolibarr.
  it('se tait sur la suggestion quand la personne a déjà le sien', () => {
    render(<ProfilClient identifiant={3} suggestion={4} connection={ABSENT} />)

    expect(document.body.textContent).not.toMatch(/réglages de l’instance/i)
    expect(document.body.textContent).not.toMatch(/n’est pas encore enregistré/i)
  })

  it('dit quand rien n est renseigné, et ce que ça empêche', () => {
    render(<ProfilClient identifiant={null} suggestion={null} connection={ABSENT} />)

    const champ = screen.getByLabelText('Identifiant utilisateur Dolibarr') as HTMLInputElement
    expect(champ.value).toBe('')
    expect(document.body.textContent).toMatch(/ne partiront pas/i)
  })
})

describe("l'agenda Google", () => {
  it('propose de connecter quand aucun agenda ne l est', () => {
    render(<ProfilClient identifiant={null} suggestion={null} connection={ABSENT} />)

    expect(screen.getByRole('link', { name: /Connecter Google Calendar/ }).getAttribute('href')).toBe(
      '/api/google/connect',
    )
  })

  it('affiche le calendrier dédié et propose de se déconnecter', () => {
    render(<ProfilClient identifiant={null} suggestion={null} connection={CONNECTE} />)

    expect(screen.getByText('cal-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Déconnecter' })).toBeTruthy()
  })

  // `disconnectGoogle` n'appelle aucun point de révocation chez Google : sans
  // cette phrase, la personne croit avoir tout coupé alors que l'application
  // reste autorisée dans son compte Google.
  it("dit que l'autorisation reste active côté Google", async () => {
    render(<ProfilClient identifiant={null} suggestion={null} connection={CONNECTE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Déconnecter' }))

    expect(document.body.textContent).toMatch(/reste autorisée/i)
  })
})
