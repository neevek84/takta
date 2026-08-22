import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WebhookValidationError } from '@/services/webhooks/subscriptions'

const {
  requireUser,
  revalidatePath,
  redirect,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  getWebhook,
  sendTestWebhook,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  getWebhook: vi.fn(),
  sendTestWebhook: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser,
  // Les gardes de rôle s'appuient sur la même session, et **appliquent la vraie
  // règle** : `peutAdministrer` est importée, pas recopiée. Un double qui
  // laisserait passer un consultant ferait passer au vert une action sans
  // garde — c'est arrivé, et c'est ce test-ci qui l'a dit.
  exigerAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer, MOTIF_REFUS_ADMIN } = await import('@/core/auth/roles')
    if (!peutAdministrer(u.role)) throw new Error(MOTIF_REFUS_ADMIN)
    return u
  },
  accesAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer } = await import('@/core/auth/roles')
    return { autorise: peutAdministrer(u.role), user: u }
  },
}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/services/webhooks/subscriptions', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/services/webhooks/subscriptions')>()
  return {
    WebhookValidationError: reel.WebhookValidationError,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    getWebhook,
  }
})
vi.mock('@/services/webhooks/delivery', () => ({ sendTestWebhook }))

import {
  creerAbonnement,
  essayerAbonnement,
  modifierAbonnement,
  supprimerAbonnement,
} from './actions'

function form(champs: Array<[string, string]>): FormData {
  const f = new FormData()
  for (const [cle, valeur] of champs) f.append(cle, valeur)
  return f
}

function cible(): string {
  return decodeURIComponent(String(redirect.mock.calls[0]![0]))
}

const ABONNEMENT = {
  id: 'w1',
  label: 'n8n',
  url: 'https://n8n.test/hook',
  events: [],
  state: 'SUSPENDU' as const,
  lastSeq: 4217,
  consecutiveFailures: 10,
  lastError: 'ECONNREFUSED',
  suspendedAt: new Date('2026-08-12T08:00:00.000Z'),
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  redirect.mockReset()
  createWebhook.mockReset().mockResolvedValue({ ...ABONNEMENT, state: 'ACTIF' })
  updateWebhook.mockReset().mockResolvedValue({ ...ABONNEMENT, state: 'ACTIF', lastSeq: 4300 })
  deleteWebhook.mockReset().mockResolvedValue(undefined)
  getWebhook.mockReset().mockResolvedValue(ABONNEMENT)
  sendTestWebhook.mockReset().mockResolvedValue({ ok: true, status: 200, durationMs: 42, erreur: '' })
})

describe('creerAbonnement', () => {
  it('crée pour l utilisateur de la session, avec les événements cochés', async () => {
    await creerAbonnement(
      form([
        ['label', ' n8n '],
        ['url', 'https://n8n.test/hook'],
        ['events', 'cra.valide'],
        ['events', 'saisie.creee'],
      ]),
    )

    expect(createWebhook).toHaveBeenCalledWith('u1', {
      label: ' n8n ',
      url: 'https://n8n.test/hook',
      events: ['cra.valide', 'saisie.creee'],
    })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/webhooks')
    expect(String(redirect.mock.calls[0]![0])).toContain('tone=success')
  })

  it('écarte un nom d événement hors catalogue plutôt que de le transmettre', async () => {
    await creerAbonnement(
      form([
        ['label', 'n8n'],
        ['url', 'https://n8n.test/hook'],
        ['events', 'cra.efface'],
        ['events', 'cra.valide'],
      ]),
    )

    expect(createWebhook).toHaveBeenCalledWith('u1', expect.objectContaining({ events: ['cra.valide'] }))
  })

  it('N AFFICHE PAS UN REFUS EN VERT', async () => {
    createWebhook.mockRejectedValue(
      new WebhookValidationError(["L'URL doit être une adresse http ou https absolue."]),
    )

    await creerAbonnement(form([['label', 'n8n'], ['url', 'pas-une-url']]))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
    expect(cible()).toContain('http ou https')
  })
})

describe('modifierAbonnement', () => {
  it('suspend l abonnement visé, pour l utilisateur de la session', async () => {
    getWebhook.mockResolvedValue({ ...ABONNEMENT, state: 'ACTIF' })
    updateWebhook.mockResolvedValue({ ...ABONNEMENT, state: 'SUSPENDU' })

    await modifierAbonnement(form([['id', 'w1'], ['state', 'SUSPENDU']]))

    expect(updateWebhook).toHaveBeenCalledWith('u1', 'w1', { state: 'SUSPENDU' })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/webhooks')
  })

  it('DONNE LE SEQ DE RATTRAPAGE en réactivant', async () => {
    // La réactivation repart de l'instant présent : sans ce numéro, les
    // événements de la période suspendue sont perdus pour le destinataire —
    // il ne sait plus depuis où relire.
    await modifierAbonnement(form([['id', 'w1'], ['state', 'ACTIF']]))

    expect(cible()).toContain('since=4217')
    expect(cible()).toContain('4300')
  })

  it('refuse un état forgé plutôt que de l écrire en base', async () => {
    await modifierAbonnement(form([['id', 'w1'], ['state', 'ZOMBIE']]))

    expect(updateWebhook).not.toHaveBeenCalled()
    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
  })

  it('rapporte le refus du service plutôt que de tomber', async () => {
    updateWebhook.mockRejectedValue(new Error('Aucun abonnement de cet identifiant.'))

    await modifierAbonnement(form([['id', 'w1'], ['state', 'ACTIF']]))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
  })
})

describe('supprimerAbonnement', () => {
  it('supprime l abonnement visé, pour l utilisateur de la session', async () => {
    await supprimerAbonnement(form([['id', 'w1']]))

    expect(deleteWebhook).toHaveBeenCalledWith('u1', 'w1')
    expect(String(redirect.mock.calls[0]![0])).toContain('tone=success')
  })

  it('rapporte le refus du service plutôt que de tomber', async () => {
    deleteWebhook.mockRejectedValue(new Error('introuvable'))

    await supprimerAbonnement(form([['id', 'w1']]))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
  })
})

describe('essayerAbonnement', () => {
  it('essaie l abonnement visé et annonce la réponse', async () => {
    await essayerAbonnement(form([['id', 'w1']]))

    expect(sendTestWebhook).toHaveBeenCalledWith('u1', 'w1')
    expect(String(redirect.mock.calls[0]![0])).toContain('tone=success')
    expect(cible()).toContain('200')
  })

  it('N ANNONCE PAS UNE URL MUETTE COMME UNE RÉUSSITE', async () => {
    // C'est le bouton dont le mensonge coûterait le plus cher : on l'appuie
    // précisément pour savoir si l'URL répond.
    sendTestWebhook.mockResolvedValue({
      ok: false,
      status: 0,
      durationMs: 5,
      erreur: 'fetch failed',
    })

    await essayerAbonnement(form([['id', 'w1']]))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
    expect(cible()).toContain('fetch failed')
  })

  it('rapporte la panne au lieu de laisser tomber l écran', async () => {
    sendTestWebhook.mockRejectedValue(new Error('Aucun abonnement de cet identifiant.'))

    await essayerAbonnement(form([['id', 'w1']]))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
  })
})
