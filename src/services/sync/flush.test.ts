import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { saveCredential } from '@/services/credentials'
import { createGoogleCalendarConnector } from '@/integrations/google/calendar'
import { createFakeGoogleApi, type FakeGoogleApi } from '@/integrations/google/fake-google-api'
import { TIME_ZONE } from './connector'
import { drainSyncOutbox, flushAllSyncOutboxes, flushSyncOutbox } from './flush'

const DEDIE = 'cra-dedie@group.calendar.google.com'
const NOW = new Date('2026-03-20T10:00:00.000Z')

let userId = ''
let autreId = ''
let lineA = ''
let api: FakeGoogleApi

function connector() {
  return createGoogleCalendarConnector({
    fetchFn: api.fetchFn,
    accessToken: 'ya29.acces',
    calendarId: DEDIE,
  })
}

function lien(entityId: string) {
  return prisma.externalLink.findFirst({
    where: { entityType: 'TimeEntry', entityId, provider: 'GOOGLE' },
  })
}

async function saisir(date: string, minutes = 240): Promise<string> {
  const r = await saveEntry({ userId, lineId: lineA, date, minutes, kind: 'REALISE' })
  expect(r.ok).toBe(true)
  const entry = await prisma.timeEntry.findFirstOrThrow({
    where: { userId, lineId: lineA, date: new Date(`${date}T00:00:00.000Z`) },
  })
  return entry.id
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'flush@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'flush-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('FLUSH client')
  const m = await createMission({ clientId: c.id, label: 'Refonte' })
  lineA = (
    await createLine({ missionId: m.id, userId, label: 'Dév', soldCentiemes: 3000, tjmCents: 0 })
  ).id
})

beforeEach(async () => {
  api = createFakeGoogleApi()
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
  })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['flush@test.local', 'flush-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'FLUSH client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('poussée', () => {
  it('pousse la saisie, enregistre l etag et vide la file', async () => {
    const entryId = await saisir('2026-03-12')

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r).toEqual({ nonConnecte: false, traitees: 1, reussies: 1, conflits: 0, echecs: 0 })

    const link = await lien(entryId)
    expect(link?.externalId).not.toBe('')
    expect(link?.etag).not.toBe('')
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('pousse un événement porteur du titre et des heures attendus', async () => {
    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const corps = api.dernierAppel().body as Record<string, unknown>
    expect(corps.summary).toBe('FLUSH client · Refonte · Dév')
    expect(corps.start).toEqual({ dateTime: '2026-03-12T09:00:00', timeZone: expect.any(String) })
  })

  // Les heures poussées sont des heures locales naïves : c'est le fuseau qui
  // les situe. Le drainage est le seul endroit du dépôt qui consomme
  // `CRA_TIMEZONE` — une régression y décalerait tous les blocs de l'agenda
  // d'une à deux heures sans qu'aucune minute ne bouge en base.
  it('pousse les heures dans le fuseau configuré', async () => {
    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const corps = api.dernierAppel().body as {
      start: { timeZone: string }
      end: { timeZone: string }
    }
    expect(corps.start.timeZone).toBe(TIME_ZONE)
    expect(corps.end.timeZone).toBe(TIME_ZONE)
    // Et le fuseau lui-même est celui du déploiement, métropole par défaut :
    // un `TIME_ZONE` fixé à 'UTC' passerait les deux assertions ci-dessus.
    expect(TIME_ZONE).toBe(process.env.CRA_TIMEZONE ?? 'Europe/Paris')
  })

  it('ne repousse rien au drainage suivant', async () => {
    await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const appels = api.calls.length

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.traitees).toBe(0)
    expect(api.calls.length).toBe(appels)
  })

  it('met à jour l événement existant au lieu d en créer un second', async () => {
    const entryId = await saisir('2026-03-12', 240)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(api.events.size).toBe(1)
    const link = await lien(entryId)
    expect(link?.etag).toBe('"2"')
  })

  it('consomme la ligne quand la saisie a disparu entre-temps', async () => {
    const entryId = await saisir('2026-03-12')
    await prisma.timeEntry.delete({ where: { id: entryId } })

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.reussies).toBe(1)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })
})

describe('détection de divergence', () => {
  // Le cœur du dispositif : on lit avant d'écrire, et on n'écrase jamais.
  it('un etag différent crée un conflit et n écrit rien', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const link = await lien(entryId)
    api.toucherEvenement(link?.externalId as string, { summary: 'Déplacé à la main' })
    await saisir('2026-03-12', 480)

    const avant = api.calls.length
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.conflits).toBe(1)
    const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId } })
    expect({ kind: conflit.kind, resolvedAt: conflit.resolvedAt }).toEqual({
      kind: 'REMOTE_MODIFIED',
      resolvedAt: null,
    })

    // Aucune écriture : seul le GET de détection est parti.
    const nouveaux = api.calls.slice(avant)
    expect(nouveaux.map((c) => c.method)).toEqual(['GET'])
    expect((api.events.get(link?.externalId as string)?.body as { summary: string }).summary).toBe(
      'Déplacé à la main',
    )
  })

  it('garde l instantané de ce que Google porte', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const link = await lien(entryId)
    api.toucherEvenement(link?.externalId as string, { summary: 'Déplacé à la main' })
    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId } })
    const snapshot = JSON.parse(conflit.remoteSnapshotJson) as Record<string, string>
    expect(snapshot.summary).toBe('Déplacé à la main')
    expect(snapshot.etag).toBe('"2"')
  })

  it('ne rouvre pas un second conflit sur la même divergence', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const link = await lien(entryId)
    api.toucherEvenement(link?.externalId as string)

    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    await saisir('2026-03-12', 300)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(await prisma.syncConflict.count({ where: { userId, resolvedAt: null } })).toBe(1)
  })

  it('un événement supprimé chez Google crée un conflit REMOTE_DELETED', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const link = await lien(entryId)
    api.supprimerEvenement(link?.externalId as string, { gone: true })

    await saisir('2026-03-12', 480)
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.conflits).toBe(1)
    const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId } })
    expect(conflit.kind).toBe('REMOTE_DELETED')
    // Le lien survit : l'arbitrage en a besoin pour rétablir ou détacher.
    expect(await lien(entryId)).not.toBeNull()
  })
})

describe('suppression', () => {
  it('supprime l événement puis le lien', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.reussies).toBe(1)
    expect(api.events.size).toBe(0)
    expect(await lien(entryId)).toBeNull()
  })

  it('consomme la ligne quand la saisie n avait jamais été poussée', async () => {
    await saisir('2026-03-12')
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.reussies).toBe(1)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })
})

describe('échecs et recul progressif', () => {
  it('recule sans perdre la ligne', async () => {
    await saisir('2026-03-12')
    api.failNext('RESEAU')

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r).toEqual({ nonConnecte: false, traitees: 1, reussies: 0, conflits: 0, echecs: 0 })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect(ligne.attempts).toBe(1)
    expect(ligne.state).toBe('PENDING')
    expect(ligne.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000))
    expect(ligne.lastError).toContain('Agenda injoignable')
  })

  it('ne rejoue pas la ligne avant sa date d éligibilité', async () => {
    await saisir('2026-03-12')
    api.failNext('RESEAU')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.traitees).toBe(0)
  })

  // La ligne remonte dans l'écran de synchronisation au lieu de disparaître.
  it('cinq échecs passent l état à FAILED sans perdre la ligne', async () => {
    await saisir('2026-03-12')

    let instant = NOW
    for (let i = 0; i < 5; i++) {
      api.failNext('SERVEUR')
      await flushSyncOutbox({ userId, now: instant, connector: connector() })
      const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
      instant = new Date(ligne.nextAttemptAt.getTime())
    }

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ state: ligne.state, attempts: ligne.attempts }).toEqual({
      state: 'FAILED',
      attempts: 5,
    })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(1)
  })
})

describe('résilience — une panne Google ne bloque jamais la saisie', () => {
  it('compte non connecté : la file reste intacte et rien n est marqué en échec', async () => {
    await saisir('2026-03-12')

    const r = await flushSyncOutbox({ userId, now: NOW, fetchFn: api.fetchFn })
    expect(r).toEqual({ nonConnecte: true, traitees: 0, reussies: 0, conflits: 0, echecs: 0 })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ state: ligne.state, attempts: ligne.attempts }).toEqual({
      state: 'PENDING',
      attempts: 0,
    })
  })

  it('jeton expiré et non rafraîchissable : se lit comme non connecté', async () => {
    await saveCredential(userId, 'GOOGLE', {
      accessToken: 'ya29.perime',
      refreshToken: '1//perime',
      expiresAt: new Date(NOW.getTime() - 60_000),
      scope: 'calendar',
      calendarId: DEDIE,
    })
    api.oauth.refusRefresh = true
    await saisir('2026-03-12')

    const r = await flushSyncOutbox({ userId, now: NOW, fetchFn: api.fetchFn })
    expect(r.nonConnecte).toBe(true)
  })

  it('jeton expiré mais rafraîchissable : renouvelé, puis la poussée aboutit', async () => {
    await saveCredential(userId, 'GOOGLE', {
      accessToken: 'ya29.perime',
      refreshToken: '1//valide',
      expiresAt: new Date(NOW.getTime() - 60_000),
      scope: 'calendar',
      calendarId: DEDIE,
    })
    await saisir('2026-03-12')

    const r = await flushSyncOutbox({ userId, now: NOW, fetchFn: api.fetchFn })
    expect(r.reussies).toBe(1)
    expect(api.appelsVers('oauth2.googleapis.com/token').length).toBe(1)
    expect(api.dernierAppel().headers.authorization).toBe('Bearer ya29.nouveau')
  })

  // Le test qui protège le cas d'usage quotidien.
  it('la saisie reste possible pendant que Google est en panne', async () => {
    api.failNext('EXPIRE')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const r = await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-13',
      minutes: 480,
      kind: 'REALISE',
    })
    expect(r).toEqual({ ok: true, minutes: 480 })
    expect(await prisma.timeEntry.count({ where: { userId } })).toBe(1)
  })

  // Le test ci-dessus arme la panne sur une file vide : le drainage n'a rien à
  // pousser, la panne n'est donc jamais rencontrée et la promesse n'est pas
  // éprouvée. Celui-ci fait rencontrer la panne pour de bon avant de saisir.
  it('la saisie reste possible après un drainage réellement en panne', async () => {
    await saisir('2026-03-12')
    api.failNext('EXPIRE')

    const drainage = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect({ traitees: drainage.traitees, reussies: drainage.reussies }).toEqual({
      traitees: 1,
      reussies: 0,
    })

    const r = await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-13',
      minutes: 480,
      kind: 'REALISE',
    })
    expect(r).toEqual({ ok: true, minutes: 480 })
    expect(await prisma.timeEntry.count({ where: { userId } })).toBe(2)
  })
})

describe('échec permanent contre échec transitoire', () => {
  // Une requête définitivement mal formée ne guérit pas en attendant : la
  // rejouer cinq fois ne produit que du bruit dans l'écran de synchronisation,
  // exactement là où les vraies pannes doivent rester visibles.
  it('abandonne dès la première tentative une requête refusée pour de bon', async () => {
    await saisir('2026-03-12')
    api.failNext('REQUETE')

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r).toEqual({ nonConnecte: false, traitees: 1, reussies: 0, conflits: 0, echecs: 1 })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ state: ligne.state, attempts: ligne.attempts }).toEqual({
      state: 'FAILED',
      attempts: 1,
    })
    expect(ligne.lastError).toContain('refusée')
  })

  it('ne rejoue plus une ligne abandonnée, et ne la perd pas', async () => {
    await saisir('2026-03-12')
    api.failNext('REQUETE')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const plusTard = new Date(NOW.getTime() + 30 * 86_400_000)
    const r = await flushSyncOutbox({ userId, now: plusTard, connector: connector() })
    expect(r.traitees).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(1)
  })

  // Le pendant du test ci-dessus : un 503 reste transitoire et garde son quota.
  it('garde le recul progressif pour une panne transitoire', async () => {
    await saisir('2026-03-12')
    api.failNext('SERVEUR')

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.echecs).toBe(0)

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect(ligne.state).toBe('PENDING')
  })
})

describe('isolation par utilisateur', () => {
  it('ne draine que la file de l utilisateur demandé', async () => {
    await saisir('2026-03-12')
    await prisma.syncOutbox.create({
      data: {
        userId: autreId,
        entityType: 'TimeEntry',
        entityId: 'entry-autre',
        provider: 'GOOGLE',
        operation: 'UPSERT',
      },
    })

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.traitees).toBe(1)
    expect(await prisma.syncOutbox.count({ where: { userId: autreId } })).toBe(1)
  })
})

/** Lignes visant des saisies absentes : consommées sans le moindre appel réseau. */
async function fileFantome(id: string, combien: number): Promise<void> {
  await prisma.syncOutbox.createMany({
    data: Array.from({ length: combien }, (_, i) => ({
      userId: id,
      entityType: 'TimeEntry',
      entityId: `fantome-${id}-${i}`,
      provider: 'GOOGLE',
      operation: 'UPSERT',
    })),
  })
}

describe('drainage d un compte, jusqu au bout', () => {
  // `flushSyncOutbox` s'arrête à `limit` lignes. Le déclenchement manuel est le
  // SEUL drainage disponible par défaut : s'il n'enchaîne pas, le consultant
  // clique, lit un compte rendu vert, et son agenda garde des journées libres
  // qu'il croit bloquées. Trois prestations remplies sur un mois produisent
  // déjà ~66 lignes.
  it('enchaîne les passes jusqu à vider une file plus longue que la limite', async () => {
    await fileFantome(userId, 55)

    const r = await drainSyncOutbox({ userId, now: NOW, connector: connector() })

    expect({ traitees: r.traitees, reussies: r.reussies, reste: r.reste }).toEqual({
      traitees: 55,
      reussies: 55,
      reste: 0,
    })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  // Et quand il en reste vraiment, le compte rendu le dit : un rapport sans
  // indicateur de reste est strictement indiscernable d'une file vidée.
  it('annonce le reste quand il en reste', async () => {
    await fileFantome(userId, 5)

    const r = await drainSyncOutbox({
      userId,
      now: NOW,
      connector: connector(),
      limit: 2,
      maxPasses: 2,
    })

    expect({ traitees: r.traitees, reste: r.reste }).toEqual({ traitees: 4, reste: 1 })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(1)
  })

  // Une ligne reculée après échec n'est pas « du reste à drainer maintenant » :
  // la compter ferait recliquer l'utilisateur pour rien, indéfiniment.
  it('ne compte pas dans le reste une ligne reculée après échec', async () => {
    await saisir('2026-03-12')
    api.failNext('RESEAU')

    const r = await drainSyncOutbox({ userId, now: NOW, connector: connector() })

    expect({ traitees: r.traitees, reste: r.reste }).toEqual({ traitees: 1, reste: 0 })
    expect((await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })).state).toBe('PENDING')
  })

  it('ne draine que la file du compte demandé', async () => {
    await fileFantome(userId, 2)
    await fileFantome(autreId, 3)

    const r = await drainSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.traitees).toBe(2)
    expect(await prisma.syncOutbox.count({ where: { userId: autreId } })).toBe(3)
  })

  it('rend le cas non connecté tel quel, sans rien marquer en échec', async () => {
    await fileFantome(userId, 2)

    const r = await drainSyncOutbox({ userId, now: NOW, connector: null })

    expect({ nonConnecte: r.nonConnecte, traitees: r.traitees, reste: r.reste }).toEqual({
      nonConnecte: true,
      traitees: 0,
      reste: 2,
    })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(2)
  })
})

describe('drainage de tous les comptes', () => {

  async function connecter(id: string): Promise<void> {
    await saveCredential(id, 'GOOGLE', {
      accessToken: 'ya29.acces',
      refreshToken: '1//valide',
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      scope: 'calendar',
      calendarId: DEDIE,
    })
  }

  it('ne draine que les comptes connectés', async () => {
    await saisir('2026-03-12')

    // Personne n'est connecté : rien n'est tenté, rien n'est marqué en échec.
    expect(await flushAllSyncOutboxes()).toEqual({ comptes: 0, traitees: 0 })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect(ligne.state).toBe('PENDING')
  })

  // La table des jetons est générique et accueillera d'autres fournisseurs :
  // les drainer avec le connecteur Google pousserait des événements dans le
  // mauvais agenda, ou tenterait de le faire.
  it('ne draine que les comptes du fournisseur Google', async () => {
    await prisma.providerCredential.create({
      data: {
        userId: autreId,
        provider: 'AUTRE',
        accessTokenEnc: 'x',
        refreshTokenEnc: 'x',
        expiresAt: new Date(NOW.getTime() + 3_600_000),
        scope: 'calendar',
        calendarId: 'un-autre-agenda',
      },
    })
    await fileFantome(autreId, 1)

    expect(await flushAllSyncOutboxes(50, { now: NOW, fetchFn: api.fetchFn })).toEqual({
      comptes: 0,
      traitees: 0,
    })
  })

  // Un consentement donné sans calendrier dédié n'est pas une connexion : le
  // compte rendu qui l'annoncerait comme drainé ferait passer une file
  // intacte pour une file partie.
  it('ne compte pas un consentement sans calendrier dédié', async () => {
    await saveCredential(userId, 'GOOGLE', {
      accessToken: 'ya29.acces',
      refreshToken: '1//valide',
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      scope: 'calendar',
      calendarId: '',
    })
    await saisir('2026-03-12')

    expect(await flushAllSyncOutboxes(50, { now: NOW, fetchFn: api.fetchFn })).toEqual({
      comptes: 0,
      traitees: 0,
    })
    expect((await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })).state).toBe('PENDING')
  })

  it('draine chaque compte connecté, pas seulement le premier', async () => {
    await connecter(userId)
    await connecter(autreId)
    await fileFantome(userId, 1)
    await fileFantome(autreId, 1)

    expect(await flushAllSyncOutboxes(50, { now: NOW, fetchFn: api.fetchFn })).toEqual({
      comptes: 2,
      traitees: 2,
    })
    expect(await prisma.syncOutbox.count({})).toBe(0)
  })

  // `flushSyncOutbox` traite au plus `limit` lignes et ne s'enchaîne pas :
  // sans reprise ici, un déclenchement laisserait 5 lignes derrière lui à
  // chaque passage, et une file de 200 mettrait quatre déclenchements à partir.
  it('enchaîne les passes jusqu à vider une file plus longue que la limite', async () => {
    await connecter(userId)
    await fileFantome(userId, 55)

    expect(await flushAllSyncOutboxes(50, { now: NOW, fetchFn: api.fetchFn })).toEqual({
      comptes: 1,
      traitees: 55,
    })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })
})
