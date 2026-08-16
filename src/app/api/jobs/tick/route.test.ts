import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { POST } from './route'

const JETON = 'jeton-de-test-tick'
const ORIGINAL = process.env.CRA_API_TOKEN

beforeAll(async () => {
  process.env.CRA_API_TOKEN = JETON
  await prisma.user.create({ data: { email: 'tick@test.local', name: 'K', passwordHash: 'x' } })
})

beforeEach(async () => {
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'tick@test.local' } })
  if (ORIGINAL === undefined) delete process.env.CRA_API_TOKEN
  else process.env.CRA_API_TOKEN = ORIGINAL
  await prisma.$disconnect()
})

function appel(jeton: string | null = JETON): Promise<Response> {
  return POST(
    new Request('https://exemple.test/api/jobs/tick', {
      method: 'POST',
      headers: jeton === null ? {} : { authorization: `Bearer ${jeton}` },
    }),
  )
}

describe('POST /api/jobs/tick', () => {
  it('refuse sans jeton', async () => {
    expect((await appel(null)).status).toBe(401)
  })

  it('N EXÉCUTE RIEN quand le jeton est refusé', async () => {
    // Un réveil qui travaillerait avant de vérifier son jeton offrirait à
    // n'importe qui le droit de déclencher les traitements de fond.
    await appel('mauvais-jeton')
    expect(await prisma.scheduledJob.count()).toBe(0)
  })

  it('rend un compte rendu', async () => {
    const reponse = await appel()
    expect(reponse.status).toBe(200)

    const corps = await reponse.json()
    expect(corps).toMatchObject({ horodatage: expect.any(String) })
    expect(Array.isArray(corps.executes)).toBe(true)
  })

  it('déclare les travaux au premier réveil', async () => {
    await appel()
    expect(await prisma.scheduledJob.count()).toBeGreaterThan(0)
  })
})
