import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'

// La session n'existe pas dans un test : on lui substitue l'utilisateur créé
// ci-dessous. `revalidatePath` exige un contexte de requête Next, hors sujet ici.
const { session } = vi.hoisted(() => ({ session: { id: '' } }))
vi.mock('@/auth', () => ({
  requireUser: async () => ({ id: session.id, role: 'ADMIN' as const }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { validerJoursPasses } from './actions'

/** Mois précédent : ses jours sont échus quelle que soit la date d'exécution. */
const now = new Date()
const jour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10))
const month = jour.toISOString().slice(0, 7)

let ligneOuverte = ''
let ligneVerrouillee = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'actions@test.local', name: 'A', passwordHash: 'x' },
  })
  session.id = u.id

  const c = await createClient('ACTIONS client')
  const ouverte = await createMission({ clientId: c.id, label: 'Ouverte' })
  const verrouillee = await createMission({ clientId: c.id, label: 'Verrouillée' })

  ligneOuverte = (
    await createLine({ missionId: ouverte.id, userId: u.id, label: 'O', soldCentiemes: 3000, tjmCents: 0 })
  ).id
  ligneVerrouillee = (
    await createLine({ missionId: verrouillee.id, userId: u.id, label: 'V', soldCentiemes: 3000, tjmCents: 0 })
  ).id

  await prisma.cra.create({
    data: {
      missionId: verrouillee.id,
      userId: u.id,
      month: new Date(`${month}-01T00:00:00.000Z`),
      status: 'VALIDE',
    },
  })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'actions@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'ACTIONS client' } })
  await prisma.$disconnect()
})

describe('validerJoursPasses', () => {
  // Défaut : l'action jetait le `{ converted, skippedLocked }` de
  // `convertPastForecast`. Si moins de jours sont convertis qu'annoncé,
  // l'utilisateur ne l'apprend jamais.
  it('rend compte du nombre de jours convertis et de ceux sautés', async () => {
    for (const lineId of [ligneOuverte, ligneVerrouillee]) {
      await prisma.timeEntry.create({
        data: {
          lineId,
          userId: session.id,
          date: new Date(`${jour.toISOString().slice(0, 10)}T00:00:00.000Z`),
          minutes: 240,
          kind: 'PREVISIONNEL',
        },
      })
    }

    const formData = new FormData()
    formData.set('month', month)

    const etat = await validerJoursPasses(null, formData)
    expect(etat).toEqual({ converted: 1, skippedLocked: 1 })
  })
})
