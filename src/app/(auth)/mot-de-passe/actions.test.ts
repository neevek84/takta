import { describe, it, expect, vi, beforeEach } from 'vitest'

const { demanderReinitialisation, definirMotDePasse, headers, journalErreur } = vi.hoisted(() => ({
  demanderReinitialisation: vi.fn(),
  definirMotDePasse: vi.fn(),
  headers: vi.fn(),
  journalErreur: vi.fn(),
}))
vi.mock('@/services/auth/mot-de-passe', () => ({ demanderReinitialisation, definirMotDePasse }))
vi.mock('next/headers', () => ({ headers }))
vi.mock('@/services/log', () => ({ journalErreur }))

// `vi.mock` est hissé au-dessus des imports : ni Prisma, ni argon2, ni SMTP ne
// sont chargés — seul le contrat des deux actions avec le service l'est.
import { demanderLien, poserMotDePasse } from './actions'

/** Un jeu d'en-têtes minimal, tel que Next le rend. */
function entetes(valeurs: Record<string, string>) {
  return { get: (nom: string) => valeurs[nom.toLowerCase()] ?? null }
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [nom, valeur] of Object.entries(champs)) fd.set(nom, valeur)
  return fd
}

beforeEach(() => {
  demanderReinitialisation.mockReset().mockResolvedValue(undefined)
  definirMotDePasse.mockReset().mockResolvedValue({ ok: true, motif: '' })
  headers.mockReset().mockResolvedValue(entetes({ host: 'cra.exemple.fr' }))
  journalErreur.mockReset()
})

describe('demanderLien', () => {
  // Le formulaire d'oubli serait un annuaire du personnel s'il répondait
  // autrement à une adresse connue qu'à une inconnue.
  it('répond la même chose, que le compte existe ou non', async () => {
    const connue = await demanderLien(null, formulaire({ email: 'ada@exemple.test' }))
    const inconnue = await demanderLien(null, formulaire({ email: 'personne@exemple.test' }))

    expect(connue).toEqual(inconnue)
    expect(connue?.ok).toBe(true)
    expect(connue?.message).toMatch(/Si un compte porte cette adresse/)
  })

  // Une panne SMTP ne doit pas devenir un révélateur de comptes : l'adresse
  // connue lèverait (l'envoi échoue), l'inconnue rendrait un succès. Le
  // formulaire distinguerait alors les deux par la page d'erreur.
  it('ne trahit pas une adresse connue quand l’envoi échoue', async () => {
    demanderReinitialisation.mockRejectedValue(new Error('SMTP injoignable'))

    const r = await demanderLien(null, formulaire({ email: 'ada@exemple.test' }))

    expect(r?.ok).toBe(true)
    expect(r?.message).toMatch(/Si un compte porte cette adresse/)
    // Muet pour le visiteur, pas pour l'exploitant : sans cette trace, une
    // panne d'envoi serait indiscernable d'un fonctionnement normal.
    expect(journalErreur).toHaveBeenCalled()
  })

  it('transmet l’adresse saisie au service', async () => {
    await demanderLien(null, formulaire({ email: 'ada@exemple.test' }))

    expect(demanderReinitialisation.mock.calls[0]![0]).toMatchObject({
      email: 'ada@exemple.test',
    })
  })
})

/**
 * **L'origine vient de la requête.** L'application ne connaît pas sa propre URL
 * publique : la coder en dur produirait des liens morts derrière un proxy, et
 * un lien mort dans un courriel de dix minutes ne se rattrape pas.
 */
describe('l’origine du lien', () => {
  async function origine(valeurs: Record<string, string>): Promise<string> {
    headers.mockResolvedValue(entetes(valeurs))
    await demanderLien(null, formulaire({ email: 'ada@exemple.test' }))
    return (demanderReinitialisation.mock.calls.at(-1)![0] as { origine: string }).origine
  }

  it('suit l’en-tête du proxy avant celui de la requête', async () => {
    expect(
      await origine({
        host: 'interne:3000',
        'x-forwarded-host': 'cra.exemple.fr',
        'x-forwarded-proto': 'https',
      }),
    ).toBe('https://cra.exemple.fr')
  })

  // Un jeton de réinitialisation voyage dans cette URL. Sans protocole
  // déclaré, le supposer en clair enverrait la clé en clair : hors machine
  // locale, c'est `https` qu'on suppose.
  it('suppose https quand le proxy ne déclare pas le protocole', async () => {
    expect(await origine({ host: 'cra.exemple.fr' })).toBe('https://cra.exemple.fr')
  })

  it('laisse http à la machine locale, qui n’a pas de certificat', async () => {
    expect(await origine({ host: 'localhost:3000' })).toBe('http://localhost:3000')
  })

  // Le protocole déclaré l'emporte sur toute supposition : un tunnel qui
  // termine le TLS devant une machine locale sert bien du https.
  it('croit le protocole déclaré plutôt que son propre pronostic', async () => {
    expect(await origine({ host: 'localhost:3000', 'x-forwarded-proto': 'https' })).toBe(
      'https://localhost:3000',
    )
  })

  // Aucun en-tête : le rendu hors requête HTTP. Mieux vaut un lien local, qui
  // se corrige à la main, qu'une URL vide qui ne ressemble à rien.
  it('retombe sur la machine locale quand la requête ne dit pas son hôte', async () => {
    expect(await origine({})).toBe('http://localhost:3000')
  })

  // Une chaîne de proxys empile les valeurs séparées par des virgules ; la
  // première est celle que le visiteur a réellement demandée.
  it('ne retient que le premier maillon d’une chaîne de proxys', async () => {
    expect(
      await origine({
        'x-forwarded-host': 'cra.exemple.fr, interne',
        'x-forwarded-proto': 'https',
      }),
    ).toBe('https://cra.exemple.fr')
  })
})

describe('poserMotDePasse', () => {
  // Refusé ici avant d'atteindre le service : douze caractères est la règle du
  // produit, et l'écran doit la dire, pas la découvrir.
  it('refuse un mot de passe de moins de douze caractères, sans appeler le service', async () => {
    const r = await poserMotDePasse(null, formulaire({ jeton: 'abc', motDePasse: 'court' }))

    expect(r?.ok).toBe(false)
    expect(r?.message).toMatch(/12 caractères/)
    expect(definirMotDePasse).not.toHaveBeenCalled()
  })

  it('accepte douze caractères tout juste', async () => {
    await poserMotDePasse(null, formulaire({ jeton: 'abc', motDePasse: '123456789012' }))

    expect(definirMotDePasse).toHaveBeenCalledWith({ jeton: 'abc', motDePasse: '123456789012' })
  })

  it('annonce le succès quand le service a enregistré', async () => {
    const r = await poserMotDePasse(null, formulaire({ jeton: 'abc', motDePasse: 'assez-long-ca' }))

    expect(r?.ok).toBe(true)
    expect(r?.message).toMatch(/connecter/)
  })

  // Le motif du service — lien expiré, déjà servi — est ce que le visiteur doit
  // lire : un « échec » sans motif le laisserait recommencer à l'identique.
  it('relaie le motif du refus du service', async () => {
    definirMotDePasse.mockResolvedValue({ ok: false, motif: 'Ce lien n’est plus valable.' })

    const r = await poserMotDePasse(
      null,
      formulaire({ jeton: 'vieux', motDePasse: 'assez-long-ca' }),
    )

    expect(r?.ok).toBe(false)
    expect(r?.message).toBe('Ce lien n’est plus valable.')
  })
})
