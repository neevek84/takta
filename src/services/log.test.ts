import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { estCleSensible } from '@/core/log/redact'
import {
  journalAvertissement,
  journalErreur,
  journalInfo,
  confierSecret,
  oublierSecretsConfies,
  VARIABLES_SECRETES,
} from './log'

let erreurs: string[]
let avertissements: string[]
let infos: string[]

beforeEach(() => {
  erreurs = []
  avertissements = []
  infos = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    erreurs.push(a.map(String).join(' '))
  })
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    avertissements.push(a.map(String).join(' '))
  })
  vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => {
    infos.push(a.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('forme de la ligne', () => {
  it('écrit une seule ligne préfixée, sur le canal du niveau', () => {
    journalErreur('google.callback', new Error('boum'), { userId: 'u1' })
    journalAvertissement('sync.connecteur', { userId: 'u1', raison: 'non-connecte' })
    journalInfo('sync.drainage', { traites: 3 })

    expect(erreurs).toHaveLength(1)
    expect(avertissements).toHaveLength(1)
    expect(infos).toHaveLength(1)
    expect(erreurs[0]).toMatch(/^\[cra] error google\.callback /)
    expect(avertissements[0]).toMatch(/^\[cra] warn sync\.connecteur /)
    expect(infos[0]).toMatch(/^\[cra] info sync\.drainage /)
    for (const ligne of [...erreurs, ...avertissements, ...infos]) {
      expect(ligne).not.toContain('\n')
    }
  })

  it('porte le contexte en paires lisibles', () => {
    journalAvertissement('sync.connecteur', { userId: 'u1', raison: 'rafraichissement-refuse' })

    expect(avertissements[0]).toContain('userId=u1')
    expect(avertissements[0]).toContain('raison=rafraichissement-refuse')
  })

  it('nomme la classe de l erreur et son message', () => {
    class GoogleOAuthError extends Error {
      constructor(m: string) {
        super(m)
        this.name = 'GoogleOAuthError'
      }
    }
    journalErreur('google.callback', new GoogleOAuthError('Google a refusé (HTTP 400).'))

    expect(erreurs[0]).toContain('erreur=GoogleOAuthError')
    expect(erreurs[0]).toContain('Google a refusé (HTTP 400).')
  })

  it('ne recopie jamais la pile', () => {
    const err = new Error('boum')
    journalErreur('google.callback', err)

    expect(erreurs[0]).not.toContain('at ')
    expect(erreurs[0]).not.toContain('log.test.ts')
  })

  it('supporte une levée qui n est pas une Error', () => {
    expect(() => journalErreur('google.callback', 'juste une chaîne')).not.toThrow()
    expect(() => journalErreur('google.callback', null)).not.toThrow()
    expect(erreurs[0]).toContain('juste une chaîne')
  })

  it('replie un message multiligne sur une seule ligne', () => {
    journalErreur('google.callback', new Error('première ligne\nseconde ligne'))

    expect(erreurs[0]).not.toContain('\n')
    expect(erreurs[0]).toContain('seconde ligne')
  })
})

describe('aucun secret ne sort', () => {
  it('efface la valeur d une clé de contexte sensible', () => {
    journalErreur('google.callback', new Error('boum'), {
      userId: 'u1',
      accessToken: 'ya29-un-jeton-bien-reel',
      client_id: '1234-abc.apps.googleusercontent.com',
    })

    expect(erreurs[0]).not.toContain('ya29-un-jeton-bien-reel')
    expect(erreurs[0]).not.toContain('googleusercontent')
    expect(erreurs[0]).toContain('[secret]')
    // Le contexte utile survit.
    expect(erreurs[0]).toContain('userId=u1')
  })

  // Ce test posait `GOOGLE_CLIENT_SECRET` dans l'environnement. Il n'y vit plus
  // — il se saisit à l'écran et vit chiffré en base — et rien ne le couvrait
  // alors : un secret recopié dans un message de refus n'a ni la forme d'une
  // paire nommée, ni forcément celle d'une chaîne opaque, qui exige des
  // chiffres. Il serait sorti en clair. Le service qui le lit le confie donc.
  it('efface un secret confié par le service qui vient de le lire', () => {
    confierSecret('GOCSPX-valeur-de-deploiement')
    try {
      journalErreur(
        'google.callback',
        new Error('refus de GOCSPX-valeur-de-deploiement par Google'),
      )
    } finally {
      oublierSecretsConfies()
    }

    expect(erreurs[0]).not.toContain('GOCSPX-valeur-de-deploiement')
    expect(erreurs[0]).toContain('[secret]')
  })

  it('ne confie pas une valeur trop courte, qui découperait les messages', () => {
    confierSecret('abc')
    try {
      journalErreur('google.callback', new Error('abc est absent du contexte'))
    } finally {
      oublierSecretsConfies()
    }

    expect(erreurs[0]).toContain('abc est absent')
  })

  it('efface la clé de chiffrement si elle atterrissait dans un message', () => {
    const ancienne = process.env.CREDENTIALS_KEY
    process.env.CREDENTIALS_KEY = 'aB+cD/eFgH1jK2lM3nO4pQ5rS6tU7vW8xY9zA0b='
    try {
      journalErreur('credentials', new Error(`clé refusée : ${process.env.CREDENTIALS_KEY}`))
    } finally {
      if (ancienne === undefined) delete process.env.CREDENTIALS_KEY
      else process.env.CREDENTIALS_KEY = ancienne
    }

    expect(erreurs[0]).not.toContain('aB+cD/eFgH1jK2lM3nO4pQ5rS6tU7vW8xY9zA0b=')
    // Le nom de la variable, lui, doit rester : c'est ce qui rend la panne
    // diagnosticable, et le README le promet.
    journalErreur('credentials', new Error('CREDENTIALS_KEY est absente.'))
    expect(erreurs[1]).toContain('CREDENTIALS_KEY est absente.')
  })

  it('efface un jeton nommé dans le message, sans valeur connue du processus', () => {
    journalErreur('google.oauth', new Error('réponse: {"refresh_token":"1//05aBcDeFgHiJk"}'))

    expect(erreurs[0]).not.toContain('1//05aBcDeFgHiJk')
  })
})

// Le journal est devenu bavard — un evenement par saisie poussee — et il part
// desormais vers des URL tierces par les webhooks sortants. Quatre secrets de
// l'environnement n'etaient pas dans la liste expurgee : celui qui signe les
// webhooks, la cle Documenso, le jeton d'API et le mot de passe SMTP. Un
// message d'erreur les recopiant les aurait emportes chez le destinataire.
describe('tous les secrets de l environnement sont expurges', () => {
  const CAS = [
    ['SIGNATURE_WEBHOOK_SECRET', 'secret-webhook-de-test-0123456789'],
    ['DOCUMENSO_API_KEY', 'api-documenso-de-test-0123456789'],
    ['CRA_API_TOKEN', 'jeton-api-de-test-0123456789'],
    ['SMTP_PASSWORD', 'motdepasse-smtp-de-test-01234567'],
  ] as const

  for (const [nom, valeur] of CAS) {
    it(`efface la valeur de ${nom} recopiee dans un message`, () => {
      const ancienne = process.env[nom]
      process.env[nom] = valeur
      try {
        journalErreur('essai', new Error(`echec avec ${valeur} refuse`))
      } finally {
        if (ancienne === undefined) delete process.env[nom]
        else process.env[nom] = ancienne
      }

      expect(erreurs[0]).not.toContain(valeur)
      expect(erreurs[0]).toContain('[secret]')
    })
  }
})

// Le vrai garde-fou : la liste ci-dessus se maintient a la main, et c'est
// exactement ainsi que ces quatre-la ont manque. Le test derive donc les noms
// depuis .env.example plutot que de les enumerer.
describe('la liste expurgee suit .env.example', () => {
  it('couvre toute variable dont le nom annonce un secret', () => {
    const exemple = readFileSync(join(process.cwd(), '.env.example'), 'utf8')
    const noms = [...new Set(exemple.match(/^[A-Z][A-Z0-9_]*(?==)/gm) ?? [])]
    const sensibles = noms.filter((n) => estCleSensible(n))

    const oublies = sensibles.filter((n) => !VARIABLES_SECRETES.includes(n as never))

    expect(
      oublies,
      `${oublies.join(', ')} nomment un secret dans .env.example sans etre expurges du journal`,
    ).toEqual([])
  })
})
