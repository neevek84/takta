import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  requireUser,
  revalidatePath,
  redirect,
  saveInstanceCredential,
  revokeInstanceCredential,
  createHttpDolibarrApi,
  getDolibarrApi,
  attachClient,
  attachMission,
  createClientFromDolibarr,
  createMissionFromDolibarr,
  pushClientToDolibarr,
  detachEntity,
  listProjects,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  saveInstanceCredential: vi.fn(),
  revokeInstanceCredential: vi.fn(),
  createHttpDolibarrApi: vi.fn(),
  getDolibarrApi: vi.fn(),
  attachClient: vi.fn(),
  attachMission: vi.fn(),
  createClientFromDolibarr: vi.fn(),
  createMissionFromDolibarr: vi.fn(),
  pushClientToDolibarr: vi.fn(),
  detachEntity: vi.fn(),
  listProjects: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/services/credentials', () => ({ saveInstanceCredential, revokeInstanceCredential }))
vi.mock('@/services/dolibarr/http', () => ({ createHttpDolibarrApi }))
vi.mock('@/services/dolibarr/resolve', () => ({ getDolibarrApi }))
vi.mock('@/services/dolibarr/import', () => ({
  attachClient,
  attachMission,
  createClientFromDolibarr,
  createMissionFromDolibarr,
  pushClientToDolibarr,
  detachEntity,
}))

import {
  connecterDolibarr,
  deconnecterDolibarr,
  rattacherTiers,
  rattacherProjet,
  detacher,
  pousserClient,
} from './actions'

/**
 * Aucune vraie clé, aucune vraie URL : cette chaîne n'ouvre rien, elle sert
 * seulement à vérifier qu'on ne la retrouve nulle part.
 */
const CLE_FICTIVE = 'cle-api-de-test-0000'
const URL_FICTIVE = 'https://erp.invalid/api/index.php'

function formulaireConnexion(patch: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const champs: Record<string, string> = {
    baseUrl: URL_FICTIVE,
    apiKey: CLE_FICTIVE,
    dolibarrUserId: '3',
    ...patch,
  }
  for (const [k, v] of Object.entries(champs)) fd.set(k, v)
  return fd
}

function form(champs: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(champs)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  redirect.mockReset()
  saveInstanceCredential.mockReset().mockResolvedValue(undefined)
  revokeInstanceCredential.mockReset().mockResolvedValue(undefined)
  listProjects.mockReset().mockResolvedValue([])
  createHttpDolibarrApi.mockReset().mockReturnValue({ listProjects })
  getDolibarrApi.mockReset().mockResolvedValue({ listProjects })
  attachClient.mockReset().mockResolvedValue(undefined)
  attachMission.mockReset().mockResolvedValue(undefined)
  createClientFromDolibarr.mockReset().mockResolvedValue({ clientId: 'c-neuf' })
  createMissionFromDolibarr.mockReset().mockResolvedValue({ missionId: 'm-neuf' })
  pushClientToDolibarr.mockReset().mockResolvedValue({ dolibarrThirdpartyId: 42 })
  detachEntity.mockReset().mockResolvedValue(undefined)
})

/**
 * Une action serveur est un point d'entrée public : elle est appelable par
 * quiconque sait former la requête. Sans `requireUser`, n'importe qui poserait
 * une clé d'API sur l'instance, rattacherait les clients d'un autre, ou
 * créerait des tiers dans le Dolibarr du porteur.
 */
describe('chaque action exige une session', () => {
  const actions: Array<[string, () => Promise<unknown>]> = [
    ['connecterDolibarr', () => connecterDolibarr(null, formulaireConnexion())],
    ['deconnecterDolibarr', () => deconnecterDolibarr()],
    ['rattacherTiers', () => rattacherTiers(form({ dolibarrId: '1', clientId: 'c1' }))],
    [
      'rattacherProjet',
      () => rattacherProjet(form({ dolibarrId: '1', missionId: 'm1', ref: 'PJ001', socid: '5' })),
    ],
    ['detacher', () => detacher(form({ entityType: 'Client', entityId: 'c1' }))],
    ['pousserClient', () => pousserClient(form({ clientId: 'c1' }))],
  ]

  for (const [nom, appeler] of actions) {
    it(`${nom} refuse d agir sans session`, async () => {
      requireUser.mockRejectedValue(new Error('Non authentifié'))

      await expect(appeler()).rejects.toThrow('Non authentifié')

      expect(saveInstanceCredential).not.toHaveBeenCalled()
      expect(revokeInstanceCredential).not.toHaveBeenCalled()
      expect(attachClient).not.toHaveBeenCalled()
      expect(attachMission).not.toHaveBeenCalled()
      expect(createClientFromDolibarr).not.toHaveBeenCalled()
      expect(createMissionFromDolibarr).not.toHaveBeenCalled()
      expect(pushClientToDolibarr).not.toHaveBeenCalled()
      expect(detachEntity).not.toHaveBeenCalled()
    })
  }
})

describe('connecterDolibarr', () => {
  it('refuse une saisie incomplète sans rien enregistrer', async () => {
    const state = await connecterDolibarr(
      null,
      formulaireConnexion({ baseUrl: '', apiKey: '', dolibarrUserId: 'moi' }),
    )

    expect(state?.ok).toBe(false)
    expect(state !== null && state.ok === false ? state.erreurs : []).toHaveLength(3)
    expect(saveInstanceCredential).not.toHaveBeenCalled()
    // Et surtout : aucun appel réseau sur une saisie qu'on sait déjà fausse.
    expect(createHttpDolibarrApi).not.toHaveBeenCalled()
  })

  it('refuse une adresse qui n est pas une URL absolue', async () => {
    // `fetch('erp.invalid/api')` lève un « Invalid URL » que le client
    // traduirait en « Dolibarr est injoignable » : un diagnostic faux.
    const state = await connecterDolibarr(null, formulaireConnexion({ baseUrl: 'erp.invalid/api' }))

    expect(state?.ok).toBe(false)
    expect(saveInstanceCredential).not.toHaveBeenCalled()
  })

  it('essaie la connexion avant d enregistrer quoi que ce soit', async () => {
    // Une clé fausse acceptée en silence ne se manifesterait qu'au premier
    // push, plusieurs jours plus tard, sur un CRA déjà validé.
    const state = await connecterDolibarr(null, formulaireConnexion())

    expect(createHttpDolibarrApi).toHaveBeenCalledWith({
      baseUrl: URL_FICTIVE,
      apiKey: CLE_FICTIVE,
    })
    expect(listProjects).toHaveBeenCalledTimes(1)
    expect(state?.ok).toBe(true)
  })

  it('n enregistre rien quand Dolibarr refuse la clé', async () => {
    listProjects.mockRejectedValue(new Error("Dolibarr a refusé la clé d'API."))

    const state = await connecterDolibarr(null, formulaireConnexion())

    expect(state?.ok).toBe(false)
    expect(state !== null && state.ok === false ? state.erreurs.join(' ') : '').toContain('refusé')
    expect(saveInstanceCredential).not.toHaveBeenCalled()
  })

  it('accepte une instance qui n a encore aucun projet', async () => {
    // Dolibarr répond 404 sur une collection vide et le client HTTP le traduit
    // en liste vide : une instance neuve doit pouvoir être connectée.
    listProjects.mockResolvedValue([])

    const state = await connecterDolibarr(null, formulaireConnexion())
    expect(state?.ok).toBe(true)
  })

  it('enregistre la clé en portée instance, avec l identifiant utilisateur en métadonnée', async () => {
    await connecterDolibarr(null, formulaireConnexion({ dolibarrUserId: '7' }))

    expect(saveInstanceCredential).toHaveBeenCalledWith({
      provider: 'DOLIBARR',
      secret: CLE_FICTIVE,
      baseUrl: URL_FICTIVE,
      metadata: { dolibarrUserId: '7' },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/dolibarr')
  })

  it('ne renvoie jamais la clé à l écran, même portée par une erreur', async () => {
    // Une bibliothèque tierce recopie volontiers l'en-tête fautif dans son
    // message. Ce qui remonte à l'écran est expurgé, sans exception.
    listProjects.mockRejectedValue(new Error(`Requête refusée (DOLAPIKEY: ${CLE_FICTIVE})`))

    const state = await connecterDolibarr(null, formulaireConnexion())

    expect(state?.ok).toBe(false)
    const rendu = JSON.stringify(state)
    expect(rendu).not.toContain(CLE_FICTIVE)
  })

  it('ne renvoie jamais la clé dans le message de succès', async () => {
    const state = await connecterDolibarr(null, formulaireConnexion())
    expect(JSON.stringify(state)).not.toContain(CLE_FICTIVE)
  })
})

describe('deconnecterDolibarr', () => {
  it('révoque l identifiant d instance, pas celui d une personne', async () => {
    await deconnecterDolibarr()

    expect(revokeInstanceCredential).toHaveBeenCalledWith('DOLIBARR')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/dolibarr')
  })
})

describe('rattachement des tiers', () => {
  it('crée le client local quand aucun existant n est choisi', async () => {
    await rattacherTiers(form({ dolibarrId: '12', clientId: '', nom: 'ACME' }))

    expect(createClientFromDolibarr).toHaveBeenCalledWith({
      userId: 'u1',
      dolibarrThirdpartyId: 12,
      name: 'ACME',
    })
    expect(attachClient).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/admin/dolibarr')
  })

  it('rattache au client choisi sans jamais en créer un second', async () => {
    await rattacherTiers(form({ dolibarrId: '12', clientId: 'c1', nom: 'ACME' }))

    expect(attachClient).toHaveBeenCalledWith({
      userId: 'u1',
      clientId: 'c1',
      dolibarrThirdpartyId: 12,
    })
    expect(createClientFromDolibarr).not.toHaveBeenCalled()
  })
})

describe('rattachement des projets', () => {
  it('crée la mission sous le client choisi quand aucune mission n est visée', async () => {
    await rattacherProjet(
      form({ dolibarrId: '30', missionId: '', clientId: 'c1', titre: 'ITSM', ref: 'PJ030', socid: '5' }),
    )

    expect(createMissionFromDolibarr).toHaveBeenCalledWith({
      userId: 'u1',
      clientId: 'c1',
      dolibarrProjectId: 30,
      projectRef: 'PJ030',
      projectSocid: 5,
      label: 'ITSM',
    })
    expect(attachMission).not.toHaveBeenCalled()
  })

  it('refuse de créer une mission sans client, au lieu d en poser une orpheline', async () => {
    await rattacherProjet(form({ dolibarrId: '30', missionId: '', clientId: '', titre: 'ITSM' }))

    expect(createMissionFromDolibarr).not.toHaveBeenCalled()
  })

  it('rattache à la mission choisie', async () => {
    await rattacherProjet(form({ dolibarrId: '30', missionId: 'm1', clientId: 'c1', ref: 'PJ030', socid: '5' }))

    expect(attachMission).toHaveBeenCalledWith({
      userId: 'u1',
      missionId: 'm1',
      dolibarrProjectId: 30,
      projectRef: 'PJ030',
      projectSocid: 5,
    })
    expect(createMissionFromDolibarr).not.toHaveBeenCalled()
  })

  it('transmet l absence de tiers du projet comme null, pas comme une chaîne vide', async () => {
    // Un projet sans tiers Dolibarr existe : le champ caché arrive vide, et ce
    // n'est pas la même chose qu'un tiers 0.
    await rattacherProjet(form({ dolibarrId: '30', missionId: 'm1', ref: 'PJ030', socid: '' }))

    expect(attachMission).toHaveBeenCalledWith({
      userId: 'u1',
      missionId: 'm1',
      dolibarrProjectId: 30,
      projectRef: 'PJ030',
      projectSocid: null,
    })
  })

  it('annonce le refus du service au lieu de laisser planter la page', async () => {
    // Le service (`attachMission`) porte la règle de cohérence tiers ; cette
    // action se contente de rapporter son refus à l'écran, comme
    // `pousserClient` le fait déjà pour une panne Dolibarr.
    attachMission.mockRejectedValue(
      new Error(
        'Le projet « PJ030 » appartient au tiers Dolibarr n° 5, mais « ACME » est rattaché au tiers Dolibarr n° 7.',
      ),
    )

    await rattacherProjet(form({ dolibarrId: '30', missionId: 'm1', ref: 'PJ030', socid: '5' }))

    expect(redirect).toHaveBeenCalledTimes(1)
    const cible = decodeURIComponent(String(redirect.mock.calls[0]![0]))
    expect(cible).toContain('PJ030')
    expect(cible).toContain('tiers Dolibarr n° 5')
    expect(cible).toContain('tone=danger')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('detacher', () => {
  it('rompt la correspondance visée, pour l utilisateur de la session', async () => {
    await detacher(form({ entityType: 'Mission', entityId: 'm1' }))

    expect(detachEntity).toHaveBeenCalledWith({
      userId: 'u1',
      entityType: 'Mission',
      entityId: 'm1',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/dolibarr')
  })

  it('refuse un type d entité qu elle ne sait pas rattacher', async () => {
    // Le champ vient du formulaire : rien n'empêche de le forger. Le laisser
    // passer effacerait des correspondances d'un tout autre type.
    await detacher(form({ entityType: 'TimeEntry', entityId: 'e1' }))

    expect(detachEntity).not.toHaveBeenCalled()
  })
})

describe('pousserClient', () => {
  it('pousse le client de la session et annonce le résultat', async () => {
    await pousserClient(form({ clientId: 'c1' }))

    expect(pushClientToDolibarr).toHaveBeenCalledWith({
      userId: 'u1',
      clientId: 'c1',
      api: { listProjects },
    })
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(String(redirect.mock.calls[0]![0])).toContain('/admin/dolibarr?message=')
    // Un succès s'affiche en succès, jamais en alerte.
    expect(String(redirect.mock.calls[0]![0])).toContain('tone=success')
  })

  it('dit que Dolibarr n est pas connecté au lieu de ne rien faire', async () => {
    // Un `return` muet laisserait l'utilisateur cliquer indéfiniment sur un
    // bouton qui n'a jamais rien poussé.
    getDolibarrApi.mockResolvedValue(null)

    await pousserClient(form({ clientId: 'c1' }))

    expect(pushClientToDolibarr).not.toHaveBeenCalled()
    // Une panne ne s'affiche pas comme un succès : la tonalité le distingue,
    // et pas seulement la couleur — le texte le dit aussi.
    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(String(redirect.mock.calls[0]![0]))).toContain('pas connecté')
  })

  it('rapporte la panne au lieu de laisser tomber l écran', async () => {
    pushClientToDolibarr.mockRejectedValue(new Error('Dolibarr est injoignable.'))

    await pousserClient(form({ clientId: 'c1' }))

    expect(redirect).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(String(redirect.mock.calls[0]![0]))).toContain('injoignable')
    expect(String(redirect.mock.calls[0]![0])).toContain('tone=danger')
  })
})
