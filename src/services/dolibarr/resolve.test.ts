import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { saveInstanceCredential } from '@/services/credentials'
import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { DOLIBARR } from './api'
import { getDolibarrApi } from './resolve'

const CLE_FACTICE = 'cle-api-factice-0000'
const URL_FACTICE = 'https://erp.invalide.test/api/index.php'

let cleDeChiffrement = ''

beforeAll(() => {
  cleDeChiffrement = randomBytes(32).toString('base64')
  process.env.CREDENTIALS_KEY = cleDeChiffrement
})

beforeEach(async () => {
  process.env.CREDENTIALS_KEY = cleDeChiffrement
  await prisma.providerCredential.deleteMany({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await prisma.providerCredential.deleteMany({})
  await prisma.$disconnect()
})

describe('résolution du client Dolibarr', () => {
  it('rend null quand rien n est connecté', async () => {
    // Le connecteur est additif : l'absence n'est pas une panne, et toute
    // l'application fonctionne sans lui.
    expect(await getDolibarrApi()).toBeNull()
  })

  it('rend null quand la clé est enregistrée sans URL d instance', async () => {
    await saveInstanceCredential({ provider: DOLIBARR, secret: CLE_FACTICE })
    expect(await getDolibarrApi()).toBeNull()
  })

  it('rend null quand la clé de chiffrement ne déscelle plus rien', async () => {
    await saveInstanceCredential({
      provider: DOLIBARR,
      secret: CLE_FACTICE,
      baseUrl: URL_FACTICE,
    })
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

    expect(await getDolibarrApi()).toBeNull()
  })

  it('construit un client qui parle à l instance enregistrée, avec la clé enregistrée', async () => {
    await saveInstanceCredential({
      provider: DOLIBARR,
      secret: CLE_FACTICE,
      baseUrl: URL_FACTICE,
    })

    const vues: Array<{ url: string; headers: Headers }> = []
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      vues.push({ url: String(input), headers: new Headers(init?.headers) })
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const api = await getDolibarrApi()
    expect(api).not.toBeNull()
    await api!.listThirdparties()

    expect(vues[0]!.url.startsWith(URL_FACTICE)).toBe(true)
    expect(vues[0]!.headers.get('DOLAPIKEY')).toBe(CLE_FACTICE)
  })

  // Sans cet identifiant, le client ne peut affecter personne aux projets qu'il
  // crée — et un projet privé sans rôle ne rend aucune tâche à la clé qui vient
  // de le créer.
  it("transmet au client l identifiant Dolibarr de l utilisateur de la cle", async () => {
    await saveInstanceCredential({
      provider: DOLIBARR,
      secret: CLE_FACTICE,
      baseUrl: URL_FACTICE,
      metadata: { dolibarrUserId: '7' },
    })

    const urls: string[] = []
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      // La lecture des contacts existants précède l'affectation.
      const corps =
        url.endsWith('/contacts') && (init?.method ?? 'GET') === 'GET'
          ? []
          : { id: 12, ref: 'PJ2608-0007' }
      return new Response(JSON.stringify(corps), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const api = await getDolibarrApi()
    await api!.createProject({ socid: 3, ref: 'R', title: 'T', refExt: '', description: '', dateStart: null })

    expect(urls).toContain(`${URL_FACTICE}/projects/12/contacts`)
  })

  it('ne confond pas le fournisseur Dolibarr avec un autre', async () => {
    await saveInstanceCredential({
      provider: 'autre-fournisseur',
      secret: CLE_FACTICE,
      baseUrl: URL_FACTICE,
    })
    expect(await getDolibarrApi()).toBeNull()
  })
})

// Le fournisseur s'écrivait `'dolibarr'` en minuscules quand Google s'écrit
// `'GOOGLE'`. Rien ne cassait : un appelant qui aurait écrit la clé en dur
// l'aurait simplement rangée sous un fournisseur que la lecture ne regarde
// pas, et l'échec aurait été muet — pas d'erreur, pas de jeton, pas
// d'explication. La convention est donc verrouillée plutôt que rappelée.
describe('convention des clés de fournisseur', () => {
  it('écrit tous les fournisseurs en capitales', () => {
    for (const provider of [DOLIBARR, PROVIDER_GOOGLE]) {
      expect(provider).toBe(provider.toUpperCase())
    }
  })

  it('ne confond pas deux fournisseurs', () => {
    expect(DOLIBARR).not.toBe(PROVIDER_GOOGLE)
  })
})
