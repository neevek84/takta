import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry } from './time-entries'
import { buildPlanningPdf, nomFichierPlanning, PeriodeInvalide } from './planning-pdf'

let userId = ''
let autreUserId = ''
let ligneA = ''
let ligneB = ''

const periode = { du: '2026-11-01', au: '2027-01-31' }

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'planning@test.local', name: 'P', passwordHash: 'x' } })
  ).id
  autreUserId = (
    await prisma.user.create({
      data: { email: 'planning-autre@test.local', name: 'A', passwordHash: 'x' },
    })
  ).id
  const c = await createClient('Planning « client »')
  const m = await createMission({ clientId: c.id, label: 'Transition' })
  ligneA = (await createLine({ missionId: m.id, userId, label: 'RSI', soldCentiemes: 5000, tjmCents: 0 })).id
  ligneB = (await createLine({ missionId: m.id, userId, label: 'PMO', soldCentiemes: 1000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await saveEntry({ userId, lineId: ligneA, date: '2026-11-24', minutes: 480, kind: 'PREVISIONNEL' })
  await saveEntry({ userId, lineId: ligneA, date: '2026-12-08', minutes: 480, kind: 'REALISE' })
  await saveEntry({ userId, lineId: ligneA, date: '2027-02-02', minutes: 480, kind: 'PREVISIONNEL' })
  await saveEntry({ userId, lineId: ligneB, date: '2026-12-10', minutes: 480, kind: 'PREVISIONNEL' })
})

describe('buildPlanningPdf', () => {
  it('ne lit que la prestation choisie, sur la période, réalisé et prévu confondus', async () => {
    const r = await buildPlanningPdf(userId, {
      lineId: ligneA,
      perimetre: 'PRESTATION',
      periode,
      aujourdhui: '2026-11-16',
    })
    expect(Object.keys(r.document.jours).sort()).toEqual(['2026-11-24', '2026-12-08'])
    expect(r.document.prestationLabel).toBe('RSI')
    expect(r.document.centiemes).toBe(200)
    expect(Buffer.from(r.bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
  })

  it('couvre toutes les prestations de la mission sur demande', async () => {
    const r = await buildPlanningPdf(userId, {
      lineId: ligneA,
      perimetre: 'MISSION',
      periode,
      aujourdhui: '2026-11-16',
    })
    expect(r.document.prestationLabel).toBe('')
    expect(r.document.centiemes).toBe(300)
  })

  it('refuse la prestation d’un autre consultant', async () => {
    await expect(
      buildPlanningPdf(autreUserId, {
        lineId: ligneA,
        perimetre: 'PRESTATION',
        periode,
        aujourdhui: '2026-11-16',
      }),
    ).rejects.toThrow()
  })

  it('refuse une période invalide avant toute lecture', async () => {
    await expect(
      buildPlanningPdf(userId, {
        lineId: ligneA,
        perimetre: 'PRESTATION',
        periode: { du: '2027-02-01', au: '2027-01-01' },
        aujourdhui: '2026-11-16',
      }),
    ).rejects.toBeInstanceOf(PeriodeInvalide)
  })

  it('nomme le fichier sans rien qui puisse casser l’en-tête', () => {
    expect(nomFichierPlanning('Planning « client »', 'Transition "x"', periode)).toBe(
      'Planning-Planning-client-Transition-x-2026-11-01-au-2027-01-31.pdf',
    )
  })
})
