import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { requireUser, saveGoogleOAuthClient, forgetGoogleOAuthClient, revalidatePath } = vi.hoisted(
  () => ({
    requireUser: vi.fn(),
    saveGoogleOAuthClient: vi.fn(),
    forgetGoogleOAuthClient: vi.fn(),
    revalidatePath: vi.fn(),
  }),
)

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/google/oauth-client', () => ({
  saveGoogleOAuthClient,
  forgetGoogleOAuthClient,
}))

import { enregistrerClientGoogle, oublierClientGoogle } from './actions'

const VALIDE = {
  clientId: '1234.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-le-secret-du-client',
  redirectUri: 'http://localhost:3000/api/google/callback',
}

function formulaire(valeurs: Partial<typeof VALIDE> = {}): FormData {
  const fd = new FormData()
  const complet = { ...VALIDE, ...valeurs }
  fd.set('clientId', complet.clientId)
  fd.set('clientSecret', complet.clientSecret)
  fd.set('redirectUri', complet.redirectUri)
  return fd
}

let journal: string[]

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  saveGoogleOAuthClient.mockReset().mockResolvedValue(undefined)
  forgetGoogleOAuthClient.mockReset().mockResolvedValue(undefined)
  revalidatePath.mockReset()

  journal = []
  for (const canal of ['error', 'warn', 'info'] as const) {
    vi.spyOn(console, canal).mockImplementation((...a: unknown[]) => {
      journal.push(a.map(String).join(' '))
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('enregistrement du client OAuth', () => {
  it('enregistre le client saisi', async () => {
    const state = await enregistrerClientGoogle(null, formulaire())

    expect(saveGoogleOAuthClient).toHaveBeenCalledWith(VALIDE)
    expect(state).toEqual({ ok: true, message: expect.stringContaining('enregistré') })
  })

  it('exige une session avant toute écriture', async () => {
    // La mutation qui compte : retirer `requireUser` de cette action laisse
    // n'importe qui poser le client OAuth de l'instance.
    requireUser.mockRejectedValue(new Error('non authentifié'))

    await expect(enregistrerClientGoogle(null, formulaire())).rejects.toThrow()
    expect(saveGoogleOAuthClient).not.toHaveBeenCalled()
  })

  it('vérifie la session AVANT de lire le formulaire', async () => {
    // Un ordre inverse laisserait passer les valeurs par la validation, et un
    // message d'erreur détaillé renseignerait un visiteur non authentifié.
    requireUser.mockRejectedValue(new Error('non authentifié'))

    await expect(enregistrerClientGoogle(null, formulaire({ clientId: '' }))).rejects.toThrow()
    expect(saveGoogleOAuthClient).not.toHaveBeenCalled()
  })

  it('refuse un formulaire incomplet sans rien écrire', async () => {
    const state = await enregistrerClientGoogle(null, formulaire({ clientId: '', clientSecret: '' }))

    expect(saveGoogleOAuthClient).not.toHaveBeenCalled()
    expect(state?.ok).toBe(false)
    if (state !== null && !state.ok) expect(state.erreurs).toHaveLength(2)
  })

  it('refuse une URL de retour que Google rejetterait', async () => {
    const state = await enregistrerClientGoogle(
      null,
      formulaire({ redirectUri: 'https://cra.exemple.fr/pas-le-bon-chemin' }),
    )

    expect(saveGoogleOAuthClient).not.toHaveBeenCalled()
    expect(state?.ok).toBe(false)
  })

  it('ne recopie jamais le secret saisi dans un message de retour', async () => {
    const state = await enregistrerClientGoogle(null, formulaire({ redirectUri: 'n-importe-quoi' }))

    expect(JSON.stringify(state)).not.toContain(VALIDE.clientSecret)
  })

  it('expurge le secret d un message d erreur qui le recopierait', async () => {
    // Cas réel : une bibliothèque tierce recopie la valeur fautive dans son
    // message, et ce message part droit à l'écran. Sans l'expurgation, le
    // secret qu'on vient de saisir s'affiche.
    saveGoogleOAuthClient.mockRejectedValue(
      new Error(`refus du client_secret=${VALIDE.clientSecret} par le magasin`),
    )

    const state = await enregistrerClientGoogle(null, formulaire())

    expect(state?.ok).toBe(false)
    if (state !== null && !state.ok) {
      expect(state.erreurs.join(' ')).not.toContain(VALIDE.clientSecret)
      // Ce qui reste doit rester diagnosticable : on masque la valeur, pas la
      // phrase.
      expect(state.erreurs.join(' ')).toContain('magasin')
    }
    expect(journal.join('\n')).not.toContain(VALIDE.clientSecret)
  })

  it('rend un refus lisible quand l enregistrement échoue', async () => {
    // Typiquement `CREDENTIALS_KEY` absente : recommencer ne changera rien, et
    // laisser l'exception remonter afficherait la page d'erreur de Next.
    saveGoogleOAuthClient.mockRejectedValue(new Error('CREDENTIALS_KEY est absente.'))

    const state = await enregistrerClientGoogle(null, formulaire())

    expect(state?.ok).toBe(false)
    if (state !== null && !state.ok) expect(state.erreurs.join(' ')).toContain('CREDENTIALS_KEY')
  })

  it('rafraîchit l écran après une écriture, jamais après un refus', async () => {
    await enregistrerClientGoogle(null, formulaire())
    expect(revalidatePath).toHaveBeenCalledWith('/admin/google')

    revalidatePath.mockClear()
    await enregistrerClientGoogle(null, formulaire({ clientId: '' }))
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('oubli du client OAuth', () => {
  it('efface le client', async () => {
    await oublierClientGoogle()
    expect(forgetGoogleOAuthClient).toHaveBeenCalledTimes(1)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/google')
  })

  it('exige une session', async () => {
    requireUser.mockRejectedValue(new Error('non authentifié'))

    await expect(oublierClientGoogle()).rejects.toThrow()
    expect(forgetGoogleOAuthClient).not.toHaveBeenCalled()
  })
})
