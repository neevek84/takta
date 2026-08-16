import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { appendAudit, ACTEUR_SYSTEME } from '@/services/audit'
import { GET } from './route'

const JETON = 'jeton-de-test-events'
const ORIGINAL = process.env.CRA_API_TOKEN

beforeAll(() => {
  process.env.CRA_API_TOKEN = JETON
})

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({})
  if (ORIGINAL === undefined) delete process.env.CRA_API_TOKEN
  else process.env.CRA_API_TOKEN = ORIGINAL
  await prisma.$disconnect()
})

function appel(query: string, jeton: string | null = JETON): Promise<Response> {
  return GET(
    new Request(`https://exemple.test/api/events${query}`, {
      headers: jeton === null ? {} : { authorization: `Bearer ${jeton}` },
    }),
  )
}

async function peupler(n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await appendAudit({
      ...ACTEUR_SYSTEME,
      action: i % 2 === 1 ? 'saisie.creee' : 'cra.valide',
      entityType: 'TimeEntry',
      entityId: `e${i}`,
      payload: { n: i },
    })
  }
}

describe('GET /api/events', () => {
  it('refuse sans jeton', async () => {
    expect((await appel('', null)).status).toBe(401)
  })

  it('rend les événements dans l ordre, avec le curseur de reprise', async () => {
    await peupler(3)
    const reponse = await appel('?since=0')
    expect(reponse.status).toBe(200)

    const corps = await reponse.json()
    expect(corps.nombre).toBe(3)
    expect(corps.derniereSeq).toBe(3)
    expect(corps.events.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3])
  })

  it('rend la charge utile exactement à la forme de la spec', async () => {
    await peupler(1)
    const corps = await (await appel('?since=0')).json()
    expect(Object.keys(corps.events[0])).toEqual([
      'event',
      'seq',
      'occurredAt',
      'actor',
      'entity',
      'data',
    ])
    expect(corps.events[0]).toMatchObject({
      event: 'saisie.creee',
      seq: 1,
      actor: { id: '', label: 'SYSTEME' },
      entity: { type: 'TimeEntry', id: 'e1' },
      data: { n: 1 },
    })
  })

  it('NE PERD NI NE RÉPÈTE AUCUN ÉVÉNEMENT quand un consommateur boucle', async () => {
    // La garantie centrale du modèle. Un consommateur mémorise derniereSeq
    // et reprend là où il s'était arrêté, même après plusieurs jours d'arrêt.
    await peupler(7)

    const vus: number[] = []
    let curseur = 0
    for (let tour = 0; tour < 10; tour++) {
      const corps = await (await appel(`?since=${curseur}&limit=3`)).json()
      if (corps.nombre === 0) break
      vus.push(...corps.events.map((e: { seq: number }) => e.seq))
      curseur = corps.derniereSeq
    }

    expect(vus).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(new Set(vus).size).toBe(vus.length)
  })

  it('conserve le curseur du consommateur quand il n y a rien de neuf', async () => {
    await peupler(2)
    const corps = await (await appel('?since=2')).json()
    expect(corps).toMatchObject({ nombre: 0, derniereSeq: 2, events: [] })
  })

  it('filtre par événement', async () => {
    await peupler(4)
    const corps = await (await appel('?since=0&event=cra.valide')).json()
    expect(corps.events.map((e: { seq: number }) => e.seq)).toEqual([2, 4])
  })

  it('refuse un événement hors catalogue', async () => {
    const reponse = await appel('?event=cra.validee')
    expect(reponse.status).toBe(400)
    expect((await reponse.json()).erreur).toContain('catalogue')
  })

  it('refuse un since ou un limit absurde', async () => {
    expect((await appel('?since=-1')).status).toBe(400)
    expect((await appel('?since=abc')).status).toBe(400)
    expect((await appel('?limit=0')).status).toBe(400)
    expect((await appel('?limit=abc')).status).toBe(400)
  })

  it('accepte un limit supérieur au plafond sans échouer', async () => {
    // Le plafond lui-même (500) n'est pas observable ici sans peupler le
    // journal de plus de 500 entrées : ce que ce test protège, c'est qu'une
    // demande démesurée soit ramenée au plafond plutôt que refusée.
    await peupler(5)
    const reponse = await appel('?since=0&limit=99999')
    expect(reponse.status).toBe(200)
    expect((await reponse.json()).nombre).toBe(5)
  })

  it('borne réellement le lot rendu', async () => {
    await peupler(5)
    expect((await (await appel('?since=0&limit=2')).json()).nombre).toBe(2)
  })

  it('ne consigne rien : lire n est pas un acte', async () => {
    await peupler(2)
    await appel('?since=0')
    expect(await prisma.auditEvent.count()).toBe(2)
  })
})
