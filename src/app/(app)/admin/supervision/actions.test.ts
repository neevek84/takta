import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireUser, revalidatePath, redirect, runJobNow, setJobEnabled, resendDelivery } =
  vi.hoisted(() => ({
    requireUser: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn(),
    runJobNow: vi.fn(),
    setJobEnabled: vi.fn(),
    resendDelivery: vi.fn(),
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
vi.mock('@/services/jobs/scheduler', () => ({ runJobNow, setJobEnabled }))
vi.mock('@/services/webhooks/delivery', () => ({ resendDelivery }))

import { basculerTravail, executerTravail, renvoyerLivraison } from './actions'

function form(champs: Record<string, string>): FormData {
  const f = new FormData()
  for (const [cle, valeur] of Object.entries(champs)) f.append(cle, valeur)
  return f
}

/** La cible de la redirection, décodée. */
function cible(): string {
  return decodeURIComponent(String(redirect.mock.calls[0]![0]))
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  redirect.mockReset()
  runJobNow.mockReset().mockResolvedValue({
    name: 'webhooks.distribute',
    state: 'SUCCES',
    message: '3 livraison(s) tentées.',
    durationMs: 12,
  })
  setJobEnabled.mockReset().mockResolvedValue({ name: 'rappel.saisie', enabled: false })
  resendDelivery.mockReset().mockResolvedValue({ id: 'd1', state: 'SUCCES', responseStatus: 200 })
})

describe('executerTravail', () => {
  it('exécute le travail nommé, pour l utilisateur de la session', async () => {
    await executerTravail(form({ name: 'webhooks.distribute' }))

    expect(runJobNow).toHaveBeenCalledWith('u1', 'webhooks.distribute')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/supervision')
  })

  it('annonce ce que le travail a fait', async () => {
    await executerTravail(form({ name: 'webhooks.distribute' }))

    expect(cible()).toContain('3 livraison(s) tentées.')
    expect(String(redirect.mock.calls[0]![0])).toContain('tone=success')
  })

  it('N AFFICHE PAS UN ÉCHEC EN VERT', async () => {
    // Un travail qui a échoué et qu'on annonce comme une réussite est pire
    // qu'un travail muet : on cesse de le surveiller.
    runJobNow.mockResolvedValue({
      name: 'webhooks.distribute',
      state: 'ECHEC',
      message: 'URL injoignable',
      durationMs: 3,
    })

    await executerTravail(form({ name: 'webhooks.distribute' }))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
    expect(cible()).toContain('URL injoignable')
  })

  it('n affiche pas non plus un travail indisponible comme une réussite', async () => {
    runJobNow.mockResolvedValue({
      name: 'signature.relance',
      state: 'INDISPONIBLE',
      message: 'Aucun traitement enregistré : ce travail est porté par le lot 3.',
      durationMs: 0,
    })

    await executerTravail(form({ name: 'signature.relance' }))

    expect(String(redirect.mock.calls[0]![0])).not.toContain('tone=success')
    expect(cible()).toContain('lot 3')
  })

  it('rapporte la panne au lieu de laisser tomber l écran', async () => {
    runJobNow.mockRejectedValue(new Error('Le travail « x » n’existe pas.'))

    await executerTravail(form({ name: 'x' }))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
    expect(cible()).toContain('n’existe pas')
  })
})

describe('basculerTravail', () => {
  it('active le travail nommé, pour l utilisateur de la session', async () => {
    await basculerTravail(form({ name: 'rappel.saisie', enabled: '1' }))

    expect(setJobEnabled).toHaveBeenCalledWith('u1', 'rappel.saisie', true)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/supervision')
  })

  it('désactive quand la valeur n est pas « 1 »', async () => {
    // L'absence vaut « non », et une valeur forgée aussi.
    await basculerTravail(form({ name: 'rappel.saisie', enabled: 'oui' }))

    expect(setJobEnabled).toHaveBeenCalledWith('u1', 'rappel.saisie', false)
  })

  it('rapporte le refus du service plutôt que de tomber', async () => {
    setJobEnabled.mockRejectedValue(new Error('Le travail « z » n’existe pas.'))

    await basculerTravail(form({ name: 'z', enabled: '1' }))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
  })
})

describe('renvoyerLivraison', () => {
  it('renvoie la livraison visée, pour l utilisateur de la session', async () => {
    await renvoyerLivraison(form({ id: 'd1', retour: '/admin/webhooks' }))

    expect(resendDelivery).toHaveBeenCalledWith('u1', 'd1')
    // Les deux écrans montrent les livraisons : les rafraîchir tous les deux.
    expect(revalidatePath).toHaveBeenCalledWith('/admin/supervision')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/webhooks')
  })

  it('rend la main sur l écran d où l on vient', async () => {
    await renvoyerLivraison(form({ id: 'd1', retour: '/admin/webhooks' }))

    expect(String(redirect.mock.calls[0]![0])).toContain('/admin/webhooks?message=')
  })

  it('REFUSE UNE DESTINATION FORGÉE', async () => {
    // Le champ vient du formulaire : le suivre tel quel ferait de ce bouton
    // une redirection ouverte vers n'importe quel site.
    await renvoyerLivraison(form({ id: 'd1', retour: 'https://ailleurs.test/vol' }))

    expect(String(redirect.mock.calls[0]![0])).toContain('/admin/supervision?message=')
    expect(String(redirect.mock.calls[0]![0])).not.toContain('ailleurs.test')
  })

  it('n annonce pas un renvoi encore en échec comme une réussite', async () => {
    resendDelivery.mockResolvedValue({ id: 'd1', state: 'ECHEC', responseStatus: 500 })

    await renvoyerLivraison(form({ id: 'd1', retour: '/admin/webhooks' }))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
  })

  it('rapporte la panne au lieu de laisser tomber l écran', async () => {
    resendDelivery.mockRejectedValue(new Error('Journal : l’entrée 12 est introuvable.'))

    await renvoyerLivraison(form({ id: 'd1', retour: '/admin/webhooks' }))

    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
    expect(cible()).toContain('introuvable')
  })
})
