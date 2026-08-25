import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  requireUser,
  revalidatePath,
  disconnectGoogle,
  definirIdentifiantDolibarr,
  oublierIdentifiantDolibarr,
  definirVueParDefaut,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  disconnectGoogle: vi.fn(),
  definirIdentifiantDolibarr: vi.fn(),
  oublierIdentifiantDolibarr: vi.fn(),
  definirVueParDefaut: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/google/connect', () => ({ disconnectGoogle }))
vi.mock('@/services/dolibarr/utilisateur', () => ({
  definirIdentifiantDolibarr,
  oublierIdentifiantDolibarr,
}))
vi.mock('@/services/saisie/vue-par-defaut', () => ({ definirVueParDefaut }))

import { deconnecterGoogle, enregistrerIdentifiantDolibarr, enregistrerVueParDefaut } from './actions'

function formulaire(identifiant: string): FormData {
  const fd = new FormData()
  fd.set('identifiant', identifiant)
  return fd
}

function formulaireVue(vue: string): FormData {
  const fd = new FormData()
  fd.set('vue', vue)
  return fd
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'CONSULTANT' })
  revalidatePath.mockReset()
  disconnectGoogle.mockReset().mockResolvedValue(undefined)
  definirIdentifiantDolibarr.mockReset().mockResolvedValue({ ok: true, motif: '' })
  oublierIdentifiantDolibarr.mockReset().mockResolvedValue(undefined)
  definirVueParDefaut.mockReset().mockResolvedValue(undefined)
})

/**
 * Une action serveur est un point d'entrée public : elle est appelable par
 * quiconque sait former la requête. Ces deux-là écrivent des réglages de
 * compte — sans session, elles écriraient ceux de personne, c'est-à-dire ceux
 * du premier identifiant qui passerait par le formulaire.
 */
describe('chaque action exige une session', () => {
  const actions: Array<[string, () => Promise<unknown>]> = [
    ['enregistrerIdentifiantDolibarr', () => enregistrerIdentifiantDolibarr(null, formulaire('3'))],
    ['deconnecterGoogle', () => deconnecterGoogle()],
    ['enregistrerVueParDefaut', () => enregistrerVueParDefaut(null, formulaireVue('TABLEAU'))],
  ]

  for (const [nom, appeler] of actions) {
    it(`${nom} refuse d agir sans session`, async () => {
      requireUser.mockRejectedValue(new Error('Non authentifié'))

      await expect(appeler()).rejects.toThrow('Non authentifié')

      expect(definirIdentifiantDolibarr).not.toHaveBeenCalled()
      expect(oublierIdentifiantDolibarr).not.toHaveBeenCalled()
      expect(disconnectGoogle).not.toHaveBeenCalled()
      expect(definirVueParDefaut).not.toHaveBeenCalled()
    })
  }
})

describe('enregistrerIdentifiantDolibarr', () => {
  // Le compte visé vient de la session, **jamais** du formulaire : un champ
  // caché suffirait sinon à s'attribuer l'utilisateur Dolibarr d'un collègue,
  // et à faire facturer ses journées au nom de quelqu'un d'autre.
  it('vise le compte de la session, et lui seul', async () => {
    const fd = formulaire('3')
    fd.set('userId', 'u2')

    await enregistrerIdentifiantDolibarr(null, fd)

    expect(definirIdentifiantDolibarr).toHaveBeenCalledWith('u1', 3)
  })

  it('rompt la correspondance quand le champ est vidé', async () => {
    const r = await enregistrerIdentifiantDolibarr(null, formulaire('  '))

    expect(oublierIdentifiantDolibarr).toHaveBeenCalledWith('u1')
    expect(definirIdentifiantDolibarr).not.toHaveBeenCalled()
    expect(r?.ok).toBe(true)
  })

  // « 3ter », « moi », « id=3 » : `Number()` en tirerait `NaN` ou 3, et les deux
  // sont pires qu'un refus — l'un pose un lien muet, l'autre en pose un faux.
  it("refuse ce qui n'est pas un nombre, sans rien écrire", async () => {
    const r = await enregistrerIdentifiantDolibarr(null, formulaire('moi'))

    expect(r?.ok).toBe(false)
    expect(definirIdentifiantDolibarr).not.toHaveBeenCalled()
    expect(oublierIdentifiantDolibarr).not.toHaveBeenCalled()
  })

  // Le refus du service nomme le compte qui tient déjà l'identifiant. Le
  // remplacer par un message générique effacerait la seule information utile.
  it('relaie le motif du refus tel quel', async () => {
    definirIdentifiantDolibarr.mockResolvedValue({
      ok: false,
      motif: 'L’utilisateur Dolibarr n° 3 est déjà celui de Camille (c@test.local).',
    })

    const r = await enregistrerIdentifiantDolibarr(null, formulaire('3'))

    expect(r).toEqual({
      ok: false,
      message: 'L’utilisateur Dolibarr n° 3 est déjà celui de Camille (c@test.local).',
    })
  })
})

describe('deconnecterGoogle', () => {
  it("déconnecte l'agenda du compte de la session", async () => {
    await deconnecterGoogle()
    expect(disconnectGoogle).toHaveBeenCalledWith('u1')
  })
})

describe('enregistrerVueParDefaut', () => {
  // Même règle que pour l'identifiant Dolibarr : la personne visée vient de
  // la session, jamais d'un champ du formulaire.
  it('vise le compte de la session, et lui seul', async () => {
    const fd = formulaireVue('TABLEAU')
    fd.set('userId', 'u2')

    await enregistrerVueParDefaut(null, fd)

    expect(definirVueParDefaut).toHaveBeenCalledWith('u1', 'TABLEAU')
  })

  it('accepte chacune des trois vues', async () => {
    for (const vue of ['CALENDRIER', 'TROIS_MOIS', 'TABLEAU']) {
      const r = await enregistrerVueParDefaut(null, formulaireVue(vue))
      expect(definirVueParDefaut).toHaveBeenLastCalledWith('u1', vue)
      expect(r?.ok).toBe(true)
    }
  })

  // Un champ de formulaire est toujours falsifiable : sans cette garde, une
  // valeur forgée écrirait une chaîne que `SaisieClient` ne reconnaîtrait pas.
  it("refuse une valeur qui n'est pas une vue, sans rien écrire", async () => {
    const r = await enregistrerVueParDefaut(null, formulaireVue('AUTRE'))

    expect(r?.ok).toBe(false)
    expect(definirVueParDefaut).not.toHaveBeenCalled()
  })
})
