import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireUser, revalidatePath, enregistrerReglagesCourriel, envoyerCourrielTest } = vi.hoisted(
  () => ({
    requireUser: vi.fn(),
    revalidatePath: vi.fn(),
    enregistrerReglagesCourriel: vi.fn(),
    envoyerCourrielTest: vi.fn(),
  }),
)

vi.mock('@/auth', () => ({
  requireUser,
  // La vraie règle, importée et non recopiée : un double qui laisserait passer
  // un consultant ferait passer au vert une action sans garde.
  exigerAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer, MOTIF_REFUS_ADMIN } = await import('@/core/auth/roles')
    if (!peutAdministrer(u.role)) throw new Error(MOTIF_REFUS_ADMIN)
    return u
  },
}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/courriel/reglages', () => ({ enregistrerReglagesCourriel, envoyerCourrielTest }))

import { enregistrerCourriel, testerCourriel } from './actions'

const MDP_FICTIF = 'mdp-application-de-test'

function form(champs: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(champs)) fd.set(k, v)
  return fd
}

const CHAMPS = {
  host: ' smtp.gmail.com ',
  port: '465',
  chiffrement: 'tls',
  user: 'cra@exemple.test',
  from: 'cra@exemple.test',
  motDePasse: MDP_FICTIF,
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  enregistrerReglagesCourriel.mockReset().mockResolvedValue({ ok: true })
  envoyerCourrielTest.mockReset().mockResolvedValue({ ok: true, message: 'Envoyé.' })
})

const ACTIONS: Array<[string, () => Promise<unknown>]> = [
  ['enregistrerCourriel', () => enregistrerCourriel(null, form(CHAMPS))],
  ['testerCourriel', () => testerCourriel(null, form({ destinataire: 'a@b.test' }))],
]

describe('chaque action exige le rôle d administration', () => {
  it.each(ACTIONS)('%s refuse un consultant, sans rien toucher', async (_nom, appel) => {
    requireUser.mockResolvedValue({ id: 'u2', role: 'CONSULTANT' })
    await expect(appel()).rejects.toThrow()
    expect(enregistrerReglagesCourriel).not.toHaveBeenCalled()
    expect(envoyerCourrielTest).not.toHaveBeenCalled()
  })

  it.each(ACTIONS)('%s refuse sans session', async (_nom, appel) => {
    requireUser.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(appel()).rejects.toThrow()
    expect(enregistrerReglagesCourriel).not.toHaveBeenCalled()
    expect(envoyerCourrielTest).not.toHaveBeenCalled()
  })
})

describe('enregistrerCourriel', () => {
  it('transmet la saisie au service, au nom de la session', async () => {
    const r = await enregistrerCourriel(null, form(CHAMPS))
    expect(enregistrerReglagesCourriel).toHaveBeenCalledWith({
      userId: 'u1',
      host: ' smtp.gmail.com ',
      port: '465',
      chiffrement: 'tls',
      user: 'cra@exemple.test',
      from: 'cra@exemple.test',
      motDePasse: MDP_FICTIF,
    })
    expect(r).toMatchObject({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/courriel')
  })

  it('rend les refus du service', async () => {
    enregistrerReglagesCourriel.mockResolvedValue({ ok: false, erreurs: ['Le serveur SMTP est requis.'] })
    expect(await enregistrerCourriel(null, form(CHAMPS))).toEqual({
      ok: false,
      erreurs: ['Le serveur SMTP est requis.'],
    })
  })

  it('expurge le mot de passe saisi d un message d erreur', async () => {
    enregistrerReglagesCourriel.mockRejectedValue(new Error(`échec avec ${MDP_FICTIF}`))
    const r = await enregistrerCourriel(null, form(CHAMPS))
    expect(r).toMatchObject({ ok: false })
    expect(JSON.stringify(r)).not.toContain(MDP_FICTIF)
  })
})

describe('testerCourriel', () => {
  it('envoie au destinataire saisi et rend le verdict du service', async () => {
    envoyerCourrielTest.mockResolvedValue({ ok: false, message: 'Serveur injoignable.' })
    const r = await testerCourriel(null, form({ destinataire: 'a@b.test' }))
    expect(envoyerCourrielTest).toHaveBeenCalledWith({ destinataire: 'a@b.test' })
    expect(r).toEqual({ ok: false, message: 'Serveur injoignable.' })
  })

  it('une panne inattendue se dit sans être recopiée', async () => {
    envoyerCourrielTest.mockRejectedValue(new Error('pass=secret-brut'))
    const r = await testerCourriel(null, form({ destinataire: 'a@b.test' }))
    expect(r).toMatchObject({ ok: false })
    expect(JSON.stringify(r)).not.toContain('secret-brut')
  })
})
