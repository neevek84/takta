// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { requireUser, vueReglagesSignature, enTetes } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  vueReglagesSignature: vi.fn(),
  enTetes: { valeurs: new Map<string, string>() },
}))

vi.mock('@/auth', () => ({
  requireUser,
  accesAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer } = await import('@/core/auth/roles')
    return { autorise: peutAdministrer(u.role), user: u }
  },
}))
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (nom: string) => enTetes.valeurs.get(nom) ?? null }),
}))
vi.mock('@/services/signature/reglages', () => ({ vueReglagesSignature }))
vi.mock('./actions', () => ({
  enregistrerSignature: vi.fn(),
  deconnecterSignature: vi.fn(),
  genererSecret: vi.fn(),
  testerSignature: vi.fn(),
}))

import AdminSignaturePage from './page'

const initialAuthUrl = process.env.AUTH_URL

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  vueReglagesSignature.mockReset().mockResolvedValue({
    connexion: {
      provenance: 'ecran',
      baseUrl: 'https://sign.invalid',
      enregistreLe: new Date('2026-10-01T08:00:00.000Z'),
    },
    webhook: { provenance: 'ecran', genereLe: new Date('2026-10-02T08:00:00.000Z') },
  })
  process.env.AUTH_URL = 'https://cra.exemple.test'
  enTetes.valeurs = new Map([['host', 'interne:3000']])
})
afterEach(() => {
  cleanup()
  if (initialAuthUrl === undefined) delete process.env.AUTH_URL
  else process.env.AUTH_URL = initialAuthUrl
})

async function rendre() {
  render(await AdminSignaturePage({ searchParams: Promise.resolve({}) }))
}

describe('page Administration · Signature', () => {
  it('refuse un consultant sans rien lire', async () => {
    requireUser.mockResolvedValue({ id: 'u2', role: 'CONSULTANT' })
    await rendre()
    expect(vueReglagesSignature).not.toHaveBeenCalled()
    expect(screen.queryByLabelText("Clé d'API")).toBeNull()
  })

  it('dit que la configuration vient de l écran, et rappelle l URL', async () => {
    await rendre()
    expect(document.body.textContent).toContain('Configuration en vigueur : saisie sur cet écran')
    expect((screen.getByLabelText("URL de l'instance Documenso") as HTMLInputElement).value).toBe(
      'https://sign.invalid',
    )
    // La clé ne se relit jamais.
    expect((screen.getByLabelText("Clé d'API") as HTMLInputElement).value).toBe('')
  })

  it('dit quand la configuration vient des variables d environnement', async () => {
    vueReglagesSignature.mockResolvedValue({
      connexion: { provenance: 'env', baseUrl: 'https://env.invalid', enregistreLe: null },
      webhook: { provenance: 'env', genereLe: null },
    })
    await rendre()
    expect(document.body.textContent).toContain(
      "Configuration en vigueur : variables d'environnement",
    )
    // Un repli n'est pas un réglage de l'écran : rien à « déconnecter ».
    expect(screen.queryByRole('button', { name: 'Déconnecter' })).toBeNull()
  })

  it('dit quand rien n est configuré', async () => {
    vueReglagesSignature.mockResolvedValue({
      connexion: { provenance: 'aucune', baseUrl: '', enregistreLe: null },
      webhook: { provenance: 'aucune', genereLe: null },
    })
    await rendre()
    expect(document.body.textContent).toContain('Configuration en vigueur : aucune')
    expect(screen.getByRole('button', { name: 'Générer le secret' })).toBeTruthy()
  })

  it('affiche l URL du webhook à déclarer, depuis l origine publique, et ses événements', async () => {
    await rendre()
    expect(screen.getByText('https://cra.exemple.test/api/webhooks/signature')).toBeTruthy()
    for (const e of ['DOCUMENT_COMPLETED', 'DOCUMENT_REJECTED', 'DOCUMENT_CANCELLED']) {
      expect(screen.getByText(e)).toBeTruthy()
    }
  })

  it('propose de régénérer un secret existant, et de tester', async () => {
    await rendre()
    expect(screen.getByRole('button', { name: 'Régénérer le secret' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tester' })).toBeTruthy()
  })
})
