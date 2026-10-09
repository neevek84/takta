import { describe, it, expect, vi, beforeEach } from 'vitest'

const { transitionCra, updateInvoiceTracking } = vi.hoisted(() => ({
  transitionCra: vi.fn(),
  updateInvoiceTracking: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser: async () => ({ id: 'u1', role: 'CONSULTANT' }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/services/cra', () => ({ transitionCra, updateInvoiceTracking }))
vi.mock('@/services/signature/send', () => ({ sendCraForSignature: vi.fn() }))
vi.mock('@/services/signature/refresh', () => ({ refreshSignatureStatus: vi.fn() }))
vi.mock('@/services/signature/annuler', () => ({ annulerEnvoi: vi.fn() }))
vi.mock('@/services/signature/lien-client', () => ({ nouveauLienManuel: vi.fn() }))

import { annoncer } from '@/services/annonce'
import { moveCra, saveTracking } from './actions'

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur)
  return fd
}

beforeEach(() => {
  vi.mocked(annoncer).mockClear()
  transitionCra.mockReset()
  updateInvoiceTracking.mockReset()
})

// Ces deux actions ne redirigent pas : sans annonce, la page revenait
// identique, et rien ne disait que le clic avait été pris en compte.
describe('retour à l’écran du suivi CRA', () => {
  it('annonce la transition appliquée', async () => {
    await moveCra(formulaire({ craId: 'c1', transition: 'VALIDER' }))
    expect(transitionCra).toHaveBeenCalledWith('u1', 'c1', 'VALIDER')
    expect(annoncer).toHaveBeenCalledWith('CRA marqué validé.')
  })

  it('n’annonce rien pour une transition forgée, qui n’a rien fait', async () => {
    await moveCra(formulaire({ craId: 'c1', transition: 'ANNULER_ENVOI' }))
    expect(transitionCra).not.toHaveBeenCalled()
    expect(annoncer).not.toHaveBeenCalled()
  })

  it('annonce l’enregistrement du suivi de facturation', async () => {
    await saveTracking(
      formulaire({ craId: 'c1', invoiceNumber: 'F-1', invoicedAt: '', paidAt: '' }),
    )
    expect(annoncer).toHaveBeenCalledWith('Suivi de facturation enregistré.')
  })
})
