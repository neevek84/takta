// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { requireUser, vueReglagesCourriel } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  vueReglagesCourriel: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser,
  accesAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer } = await import('@/core/auth/roles')
    return { autorise: peutAdministrer(u.role), user: u }
  },
}))
vi.mock('@/services/courriel/reglages', () => ({ vueReglagesCourriel }))
vi.mock('./actions', () => ({ enregistrerCourriel: vi.fn(), testerCourriel: vi.fn() }))

import AdminCourrielPage from './page'

const VUE = {
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  user: 'cra@exemple.test',
  from: 'Kreativ <cra@exemple.test>',
  motDePasse: { provenance: 'ecran', illisible: false, enregistreLe: new Date('2026-10-01T08:00:00Z') },
  complete: true,
  adresseAdministrateur: 'admin@exemple.test',
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  vueReglagesCourriel.mockReset().mockResolvedValue(VUE)
})
afterEach(cleanup)

async function rendre() {
  render(await AdminCourrielPage({ searchParams: Promise.resolve({}) }))
}

describe('page Administration · Courriel', () => {
  it('refuse un consultant sans rien lire', async () => {
    requireUser.mockResolvedValue({ id: 'u2', role: 'CONSULTANT' })
    await rendre()
    expect(vueReglagesCourriel).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Mot de passe')).toBeNull()
  })

  it('propose les préréglages', async () => {
    await rendre()
    const options = Array.from(
      (screen.getByLabelText('Fournisseur') as HTMLSelectElement).options,
    ).map((o) => o.textContent)
    expect(options).toEqual([
      "Google Workspace — mot de passe d'application",
      'Google Workspace — relais SMTP',
      'Microsoft 365',
      'Autre serveur',
    ])
  })

  it('réaffiche les réglages, dit la provenance du mot de passe, sans jamais le relire', async () => {
    await rendre()
    expect(vueReglagesCourriel).toHaveBeenCalledWith('u1')
    expect((screen.getByLabelText('Serveur SMTP') as HTMLInputElement).value).toBe('smtp.gmail.com')
    expect((screen.getByLabelText('Fournisseur') as HTMLSelectElement).value).toBe('google-app')
    expect(document.body.textContent).toContain('Mot de passe en vigueur : enregistré sur cet écran')
    expect((screen.getByLabelText('Mot de passe') as HTMLInputElement).value).toBe('')
    expect(document.body.textContent).toContain('Prêt à envoyer')
    expect((screen.getByLabelText('Destinataire du test') as HTMLInputElement).value).toBe(
      'admin@exemple.test',
    )
  })

  it('dit quand l envoi n est pas configuré, et quand le mot de passe vient de l environnement', async () => {
    vueReglagesCourriel.mockResolvedValue({
      ...VUE,
      motDePasse: { provenance: 'env', illisible: false, enregistreLe: null },
      complete: false,
    })
    await rendre()
    expect(document.body.textContent).toContain('Mot de passe en vigueur : variable SMTP_PASSWORD')
    expect(document.body.textContent).toMatch(/Aucun courriel ne part/)
  })
})
