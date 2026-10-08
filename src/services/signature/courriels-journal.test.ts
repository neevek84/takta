import { describe, it, expect, vi } from 'vitest'

const { appendAudit, journalErreur } = vi.hoisted(() => ({
  appendAudit: vi.fn(),
  journalErreur: vi.fn(),
}))
vi.mock('@/services/audit', () => ({ appendAudit, ACTEUR_SYSTEME: { actorType: 'SYSTEM', actorId: null } }))
vi.mock('@/services/log', () => ({ journalErreur }))
vi.mock('@/services/notify', () => ({ notify: vi.fn().mockResolvedValue({ envoye: true, motif: '' }) }))

import { envoyerCourriel } from './courriels'

describe('envoyerCourriel quand le journal est en panne', () => {
  it('rend le résultat de l’envoi sans lever, et le consigne sans contenu', async () => {
    appendAudit.mockRejectedValue(new Error('base indisponible jeanne@client.test'))
    const r = await envoyerCourriel({
      craId: 'c1',
      raison: 'ENVOI',
      to: 'jeanne@client.test',
      gabarit: { sujet: 'S', corps: 'C' },
    })
    expect(r).toEqual({ envoye: true, motif: '' })
    expect(journalErreur).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(journalErreur.mock.calls)).not.toContain('jeanne')
  })
})
