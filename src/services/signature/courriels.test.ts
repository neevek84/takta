import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import type { Mailer } from '@/services/notify'
import { envoyerCourriel } from './courriels'

const CRA = 'cra-courriels-test'

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: CRA } })
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: CRA } })
  await prisma.$disconnect()
})

async function journal() {
  // `payloadJson` : la charge utile est une chaîne JSON, lue en bloc.
  return prisma.auditEvent.findMany({ where: { entityId: CRA }, orderBy: { seq: 'asc' } })
}

describe('envoyerCourriel', () => {
  it('envoie et journalise sans adresse ni contenu', async () => {
    const recus: string[] = []
    const mailer: Mailer = async (m) => {
      recus.push(m.to)
    }
    const r = await envoyerCourriel({
      craId: CRA,
      raison: 'ENVOI',
      to: 'jeanne@client.test',
      gabarit: { sujet: 'S', corps: 'C secret' },
      mailer,
    })

    expect(r).toEqual({ envoye: true, motif: '' })
    expect(recus).toEqual(['jeanne@client.test'])
    const [e] = await journal()
    expect(e!.action).toBe('signature.courriel.envoye')
    expect(e!.payloadJson).not.toContain('jeanne')
    expect(e!.payloadJson).not.toContain('secret')
    expect(e!.payloadJson).toContain('ENVOI')
  })

  it('ne lève JAMAIS : une panne SMTP devient un échec journalisé', async () => {
    const mailer: Mailer = async () => {
      throw new Error('connexion refusée par smtp.exemple')
    }
    const r = await envoyerCourriel({
      craId: CRA,
      raison: 'VALIDE_CLIENT',
      to: 'x@y.test',
      gabarit: { sujet: 'S', corps: 'C' },
      mailer,
    })
    expect(r.envoye).toBe(false)
    expect(r.motif).not.toContain('smtp.exemple')
    expect((await journal())[0]!.action).toBe('signature.courriel.echoue')
  })

  it("sans SMTP configuré, rend l'échec et le journalise", async () => {
    await prisma.settings.deleteMany({})
    const r = await envoyerCourriel({
      craId: CRA,
      raison: 'CODE',
      to: 'x@y.test',
      gabarit: { sujet: 'S', corps: 'C' },
    })
    expect(r.envoye).toBe(false)
    expect((await journal())[0]!.action).toBe('signature.courriel.echoue')
  })

  it('refuse un destinataire vide sans rien tenter', async () => {
    let appels = 0
    const mailer: Mailer = async () => {
      appels += 1
    }
    const r = await envoyerCourriel({
      craId: CRA,
      raison: 'ENVOI',
      to: '',
      gabarit: { sujet: 'S', corps: 'C' },
      mailer,
    })
    expect(r.envoye).toBe(false)
    expect(appels).toBe(0)
  })
})
