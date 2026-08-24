import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { saveCredential } from '@/services/credentials'
import { createFakeGoogleApi, type FakeGoogleApi } from '@/integrations/google/fake-google-api'
import type { BusyInterval, CalendarConnector } from '@/core/calendar/connector'
import { getBusyRange } from './availability'

const PLAGE = { du: '2026-03-01', au: '2026-03-31' }

/** Une plage occupant intégralement la journée `jour` (UTC), pour les tests. */
function intervalPourJour(jour: string): BusyInterval {
  const debut = new Date(`${jour}T00:00:00.000Z`).getTime()
  return {
    startIso: new Date(debut).toISOString(),
    endIso: new Date(debut + 86_400_000).toISOString(),
  }
}

function connecteurAvec(jours: string[]): CalendarConnector {
  return {
    dedicatedCalendarId: 'dedie',
    freeBusy: async () => jours.map(intervalPourJour),
  } as unknown as CalendarConnector
}

const connecteurVide = connecteurAvec([])

const connecteurEnPanne = {
  dedicatedCalendarId: 'dedie',
  freeBusy: async () => {
    throw new Error('agenda en panne')
  },
} as unknown as CalendarConnector

const connecteurQuiExplose = {
  dedicatedCalendarId: 'dedie',
  freeBusy: () => {
    throw new Error('boom')
  },
} as unknown as CalendarConnector

const connecteurLent = {
  dedicatedCalendarId: 'dedie',
  freeBusy: () => new Promise<never>(() => {}),
} as unknown as CalendarConnector

const freeBusyEspion = vi.fn(async () => [] as BusyInterval[])
const connecteurEspion = {
  dedicatedCalendarId: 'espion-dedie@group.calendar.google.com',
  freeBusy: freeBusyEspion,
} as unknown as CalendarConnector

describe('getBusyRange', () => {
  // LE test de cette section : l'absence d'occupation et l'echec de lecture
  // rendaient tous deux une liste vide. Indistinguables. Des lors que
  // l'utilisateur CLIQUE pour savoir, une liste vide qui veut dire « Google
  // n'a pas repondu » est un mensonge.
  it('distingue l absence d occupation d un echec de lecture', async () => {
    expect(await getBusyRange('u1', PLAGE, { connector: connecteurVide })).toEqual({
      ok: true,
      jours: [],
    })
    expect(await getBusyRange('u1', PLAGE, { connector: connecteurEnPanne })).toEqual({
      ok: false,
      raison: 'ECHEC',
    })
  })

  it('dit quand aucun connecteur n est configure', async () => {
    expect(await getBusyRange('u1', PLAGE, { connector: null })).toEqual({
      ok: false,
      raison: 'PAS_DE_CONNECTEUR',
    })
  })

  // La garantie de fond ne change pas : la saisie doit fonctionner un jour ou
  // Google est en panne.
  it('ne leve jamais', async () => {
    await expect(getBusyRange('u1', PLAGE, { connector: connecteurQuiExplose })).resolves.toEqual({
      ok: false,
      raison: 'ECHEC',
    })
  })

  it('rend un echec plutot que d attendre un agenda lent', async () => {
    const r = await getBusyRange('u1', PLAGE, { connector: connecteurLent, delaiMs: 5 })

    expect(r).toEqual({ ok: false, raison: 'ECHEC' })
  })

  it('couvre toute la plage demandee, pas seulement son premier mois', async () => {
    const r = await getBusyRange(
      'u1',
      { du: '2026-03-01', au: '2026-05-31' },
      { connector: connecteurAvec(['2026-05-12']) },
    )

    expect(r).toEqual({ ok: true, jours: ['2026-05-12'] })
  })

  it('ecarte le calendrier dedie, comme avant', async () => {
    await getBusyRange('u1', PLAGE, { connector: connecteurEspion })

    expect(freeBusyEspion).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarIds: ['primary', connecteurEspion.dedicatedCalendarId],
      }),
    )
  })

  it('rend les jours tries et sans doublon', async () => {
    const r = await getBusyRange('u1', PLAGE, {
      connector: connecteurAvec(['2026-03-12', '2026-03-04', '2026-03-12']),
    })

    expect(r).toEqual({ ok: true, jours: ['2026-03-04', '2026-03-12'] })
  })
})

/**
 * Le pipeline reel, de bout en bout — pas un connecteur injecte.
 *
 * Le bloc `getBusyRange` ci-dessus verifie la logique de decoupage/tri/
 * exclusion contre des connecteurs fabriques a la main : il ne prouve pas que
 * `resolveConnector` sait vraiment lire un identifiant chiffre en base, le
 * dechiffrer, le rafraichir au besoin, et parler a une vraie couche HTTP (ici
 * doublee par `createFakeGoogleApi`). C'est pourtant exactement le chemin que
 * `verifierAgenda` emprunte a chaque clic sur `BoutonAgenda` : le seul chemin
 * qui reste vers Google depuis la suppression de `getBusyDays`.
 *
 * Portee volontairement etroite (pas de `createClient`/`createMission`/
 * `saveEntry` comme dans les tests supprimes) : le sujet ici est le pipeline
 * de lecture d'agenda lui-meme, pas la resilience de la saisie en general —
 * celle-ci reste couverte ailleurs (`SaisieClient.test.tsx`, `BoutonAgenda`
 * gere deja un `{ ok: false }` sans jamais bloquer la frappe).
 */
describe('getBusyRange — pipeline reel', () => {
  let userId = ''
  let autreId = ''
  let api: FakeGoogleApi

  /** Un identifiant d'agenda, chiffre et pose en base comme `saveCredential` le ferait pour un vrai compte. */
  async function connecter(expiresAt = new Date('2026-12-31T00:00:00.000Z')): Promise<void> {
    await saveCredential(userId, 'GOOGLE', {
      accessToken: 'ya29.acces',
      refreshToken: '1//valide',
      expiresAt,
      scope: 'calendar',
      calendarId: 'cra-dedie@group.calendar.google.com',
    })
  }

  beforeAll(async () => {
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

    const u = await prisma.user.create({
      data: { email: 'pipeline-availability@test.local', name: 'T', passwordHash: 'x' },
    })
    userId = u.id
    const a = await prisma.user.create({
      data: { email: 'pipeline-availability-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    autreId = a.id
  })

  beforeEach(async () => {
    api = createFakeGoogleApi()
    await prisma.providerCredential.deleteMany({})
  })

  afterAll(async () => {
    await prisma.providerCredential.deleteMany({})
    await prisma.user.deleteMany({
      where: { email: { in: ['pipeline-availability@test.local', 'pipeline-availability-autre@test.local'] } },
    })
    await prisma.$disconnect()
  })

  // Le chemin heureux d'abord : la preuve que le pipeline ne fait pas que
  // degrader proprement, il sait aussi vraiment lire — dechiffrement et appel
  // HTTP reels compris.
  it('lit les jours occupes via un identifiant chiffre en base et un vrai appel freeBusy', async () => {
    await connecter()
    api.busy.set('primary', [
      { start: '2026-03-12T08:00:00.000Z', end: '2026-03-12T10:00:00.000Z' },
    ])

    expect(await getBusyRange(userId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
      ok: true,
      jours: ['2026-03-12'],
    })
  })

  /**
   * Deux familles d'echec, pas une seule — et `getBusyRange` doit les
   * distinguer correctement, pas seulement retomber sur un `ok: false`
   * indifferencie :
   *
   * - `resolveConnector` lui-meme rend `null` (rien a essayer) : compte
   *   jamais connecte, rafraichissement refuse par Google, ou dechiffrement
   *   impossible (`getCredential` degrade deja en `null` en interne). Dans
   *   ces trois cas, aucun appel `freeBusy` ne part — `PAS_DE_CONNECTEUR`.
   * - un connecteur a bien ete obtenu, mais l'appel `freeBusy` lui-meme
   *   echoue : panne serveur, delai depasse, reseau coupe, ou jeton refuse en
   *   plein appel (401 detecte hors du controle d'expiration de
   *   `resolveConnector`, qui ne connait que l'echeance stockee en base).
   *   `getBusyRange` traduit chacun en `ECHEC`.
   */
  describe('la panne ne casse jamais la lecture — et ne ment jamais sur sa cause', () => {
    it('compte jamais connecte : PAS_DE_CONNECTEUR, aucun appel', async () => {
      expect(await getBusyRange(userId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
        ok: false,
        raison: 'PAS_DE_CONNECTEUR',
      })
      expect(api.calls.length).toBe(0)
    })

    it('jeton expire en base et rafraichissement refuse par Google : PAS_DE_CONNECTEUR', async () => {
      // `resolveConnector` voit l'echeance passee, tente de rafraichir, et
      // Google la refuse (`invalid_grant`) : aucun connecteur n'en sort.
      await connecter(new Date('2020-01-01T00:00:00.000Z'))
      api.oauth.refusRefresh = true

      expect(await getBusyRange(userId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
        ok: false,
        raison: 'PAS_DE_CONNECTEUR',
      })
    })

    it('cle de chiffrement perdue : PAS_DE_CONNECTEUR, sans lever', async () => {
      await connecter()
      const cle = process.env.CREDENTIALS_KEY
      process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
      try {
        expect(await getBusyRange(userId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
          ok: false,
          raison: 'PAS_DE_CONNECTEUR',
        })
      } finally {
        process.env.CREDENTIALS_KEY = cle
      }
    })

    it('panne serveur au moment de l appel freeBusy : ECHEC', async () => {
      await connecter()
      api.failNext('SERVEUR')

      expect(await getBusyRange(userId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
        ok: false,
        raison: 'ECHEC',
      })
    })

    it('delai depasse au moment de l appel freeBusy : ECHEC', async () => {
      await connecter()
      api.failNext('EXPIRE')

      expect(await getBusyRange(userId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
        ok: false,
        raison: 'ECHEC',
      })
    })

    it('reseau coupe au moment de l appel freeBusy : ECHEC', async () => {
      await connecter()
      api.failNext('RESEAU')

      expect(await getBusyRange(userId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
        ok: false,
        raison: 'ECHEC',
      })
    })

    // Le jeton parait valide en base (echeance future), mais Google le
    // refuse en plein appel : `resolveConnector` n'a rien pu anticiper, c'est
    // `freeBusy` qui echoue — pas une absence de connecteur.
    it('autorisation revoquee cote Google, detectee en plein appel : ECHEC', async () => {
      await connecter()
      api.expirerJeton()

      expect(await getBusyRange(userId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
        ok: false,
        raison: 'ECHEC',
      })
    })
  })

  describe('isolation par utilisateur — pipeline reel', () => {
    it('ne lit pas l agenda d un autre utilisateur', async () => {
      await connecter()
      // L'autre utilisateur n'a aucun compte connecte : aucune requete ne part.
      expect(await getBusyRange(autreId, PLAGE, { fetchFn: api.fetchFn })).toEqual({
        ok: false,
        raison: 'PAS_DE_CONNECTEUR',
      })
      expect(api.calls.length).toBe(0)
    })
  })
})
