import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  requireUser,
  revalidatePath,
  redirect,
  getDolibarrApi,
  requestCraInvoice,
  getOrCreateCra,
  transitionCra,
  updateInvoiceTracking,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  getDolibarrApi: vi.fn(),
  requestCraInvoice: vi.fn(),
  getOrCreateCra: vi.fn(),
  transitionCra: vi.fn(),
  updateInvoiceTracking: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/services/dolibarr/resolve', () => ({ getDolibarrApi }))
vi.mock('@/services/dolibarr/invoicing', () => ({ requestCraInvoice }))
vi.mock('@/services/cra', () => ({ getOrCreateCra, transitionCra, updateInvoiceTracking }))

import { demanderFacture } from './actions'

const API = { marqueur: 'api' }

function formulaire(patch: Record<string, string> = {}): FormData {
  const f = new FormData()
  f.set('craId', 'cra-1')
  f.set('month', '2026-03')
  for (const [k, v] of Object.entries(patch)) f.set(k, v)
  return f
}

/** La destination de la redirection, décomposée. */
function destination(): { path: string; message: string; tone: string; month: string } {
  expect(redirect).toHaveBeenCalledTimes(1)
  const url = new URL(String(redirect.mock.calls[0]![0]), 'https://local.invalid')
  return {
    path: url.pathname,
    message: url.searchParams.get('message') ?? '',
    tone: url.searchParams.get('tone') ?? '',
    month: url.searchParams.get('month') ?? '',
  }
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  redirect.mockReset()
  getDolibarrApi.mockReset().mockResolvedValue(API)
  requestCraInvoice.mockReset()
})

describe('demanderFacture', () => {
  it('demande la facture du CRA visé, avec l API résolue', async () => {
    requestCraInvoice.mockResolvedValue({
      ok: true,
      dolibarrInvoiceId: 7,
      ref: '(PROV7)',
      deja: false,
    })

    await demanderFacture(formulaire())

    expect(requestCraInvoice).toHaveBeenCalledWith({ userId: 'u1', craId: 'cra-1', api: API })
    const d = destination()
    expect(d.path).toBe('/cra')
    expect(d.tone).toBe('success')
    expect(d.message).toContain('(PROV7)')
    // Sans le mois, répondre ramènerait l'utilisateur ailleurs que sur le CRA
    // dont il vient de parler.
    expect(d.month).toBe('2026-03')
  })

  it('n annonce pas une seconde facture quand elle était déjà demandée', async () => {
    requestCraInvoice.mockResolvedValue({
      ok: true,
      dolibarrInvoiceId: 7,
      ref: '(PROV7)',
      deja: true,
    })

    await demanderFacture(formulaire())

    const d = destination()
    // « Facture créée », coche verte, sur une demande qui n'a rien créé :
    // l'utilisateur irait chercher un second brouillon qui n'existe pas.
    expect(d.tone).toBe('info')
    expect(d.message).toContain('déjà')
  })

  it('rend un refus comme un refus, jamais comme un succès', async () => {
    requestCraInvoice.mockResolvedValue({
      ok: false,
      reason: 'SANS_LIGNE',
      message: 'Ce mois ne porte aucun temps réalisé : il n’y a rien à facturer.',
    })

    await demanderFacture(formulaire())

    const d = destination()
    expect(d.tone).toBe('danger')
    // Le message du service arrive intact : le réécrire ici ferait diverger
    // les deux explications.
    expect(d.message).toBe('Ce mois ne porte aucun temps réalisé : il n’y a rien à facturer.')
  })

  it('le dit, plutôt que de sortir en silence, quand Dolibarr n est pas connecté', async () => {
    getDolibarrApi.mockResolvedValue(null)

    await demanderFacture(formulaire())

    expect(requestCraInvoice).not.toHaveBeenCalled()
    const d = destination()
    expect(d.tone).toBe('danger')
    expect(d.message).toContain('pas connecté')
  })

  it('exige une session avant de toucher à Dolibarr', async () => {
    requireUser.mockRejectedValue(new Error('non authentifié'))

    await expect(demanderFacture(formulaire())).rejects.toThrow('non authentifié')
    expect(getDolibarrApi).not.toHaveBeenCalled()
    expect(requestCraInvoice).not.toHaveBeenCalled()
  })
})
