import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { compterPrevisionnelParMission, validerPrevisionnelDuMois } from './cra-previsionnel'

let userId = ''
let clientId = ''
let missionId = ''
let lineId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'prev@test.local', name: 'P', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'PREV' } } })
  const client = await createClient('PREV Client')
  clientId = client.id
  const mission = await createMission({ clientId: client.id, label: 'PREV Mission' })
  missionId = mission.id
  const ligne = await createLine({
    missionId,
    label: 'Consultant',
    userId,
    soldCentiemes: 3000,
    tjmCents: 0,
  })
  lineId = ligne.id
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'PREV' } } })
  await prisma.user.deleteMany({ where: { email: 'prev@test.local' } })
  await prisma.$disconnect()
})

async function saisirSur(
  cibleLineId: string,
  date: string,
  kind: 'REALISE' | 'PREVISIONNEL',
): Promise<string> {
  const e = await prisma.timeEntry.create({
    data: {
      lineId: cibleLineId,
      userId,
      date: new Date(`${date}T00:00:00.000Z`),
      minutes: 420,
      minutesParJour: 420,
      kind,
      slotId: kind,
      startMinute: kind === 'REALISE' ? 540 : 600,
    },
  })
  return e.id
}

async function saisir(date: string, kind: 'REALISE' | 'PREVISIONNEL'): Promise<string> {
  return saisirSur(lineId, date, kind)
}

/**
 * Le mois en cours, avec son premier et son dernier jour, et le mois qui le
 * suit. Utilisé pour vérifier que `validerPrevisionnelDuMois` convertit aussi
 * bien l'échu que l'à venir, ce qu'un mois figé dans le passé (comme '2026-03'
 * ailleurs dans ce fichier) ne démontrerait pas : elle ne consulte jamais
 * l'horloge, un jour avant aujourd'hui ou après passe par le même chemin.
 */
function moisCourant(): {
  month: string
  premier: string
  dernier: string
  moisSuivant: string
} {
  const maintenant = new Date()
  const annee = maintenant.getUTCFullYear()
  const mois = maintenant.getUTCMonth() + 1
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const mm = String(mois).padStart(2, '0')
  const suivant = new Date(Date.UTC(annee, mois, 1))
  return {
    month: `${annee}-${mm}`,
    premier: `${annee}-${mm}-01`,
    dernier: `${annee}-${mm}-${String(dernierJour).padStart(2, '0')}`,
    moisSuivant: `${suivant.getUTCFullYear()}-${String(suivant.getUTCMonth() + 1).padStart(2, '0')}-05`,
  }
}

describe('le prévisionnel emporté par la validation', () => {
  it('annule le prévisionnel du mois, et laisse le réalisé intact', async () => {
    // Un jour prévu qui n'a pas eu lieu au moment où le mois se ferme n'aura
    // plus lieu : le laisser vivre le figerait pour toujours, tout en le
    // comptant comme consommé sur l'engagement de la mission.
    await saisir('2026-03-02', 'REALISE')
    await saisir('2026-03-03', 'PREVISIONNEL')
    await saisir('2026-03-04', 'PREVISIONNEL')

    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    const restantes = await prisma.timeEntry.findMany({ where: { lineId }, select: { kind: true } })
    expect(restantes.map((e) => e.kind)).toEqual(['REALISE'])
  })

  it('ne touche pas au prévisionnel des autres mois', async () => {
    await saisir('2026-03-03', 'PREVISIONNEL')
    const suivant = await saisir('2026-04-03', 'PREVISIONNEL')

    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    expect(await prisma.timeEntry.findUnique({ where: { id: suivant } })).not.toBeNull()
  })

  it('met en file la disparition des blocs d’agenda', async () => {
    // Sans cela, le bloc du jour prévu resterait dans Google pour l'éternité,
    // sur un jour qui n'aura pas lieu.
    const prevu = await saisir('2026-03-03', 'PREVISIONNEL')
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    const enFile = await prisma.syncOutbox.findFirst({
      where: { entityType: 'TimeEntry', entityId: prevu, operation: 'DELETE' },
    })
    expect(enFile).not.toBeNull()
  })

  it('consigne au journal ce que la validation a emporté', async () => {
    await saisir('2026-03-03', 'PREVISIONNEL')
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    const evenement = await prisma.auditEvent.findFirst({
      where: { entityType: 'Cra', entityId: cra.id },
      orderBy: { seq: 'desc' },
    })
    expect(String(evenement?.payloadJson ?? '')).toContain('"previsionnelAnnule":1')
  })

  it('ne compte le prévisionnel que du mois et de la mission demandés', async () => {
    await saisir('2026-03-03', 'PREVISIONNEL')
    await saisir('2026-03-04', 'PREVISIONNEL')
    await saisir('2026-04-03', 'PREVISIONNEL')
    await saisir('2026-03-05', 'REALISE')

    const par = await compterPrevisionnelParMission({ userId, missionIds: [missionId], month: '2026-03' })
    expect(par.get(missionId)).toBe(2)
  })

  it('ne compte rien quand aucune mission n’est demandée', async () => {
    await saisir('2026-03-03', 'PREVISIONNEL')
    const par = await compterPrevisionnelParMission({ userId, missionIds: [], month: '2026-03' })
    expect(par.size).toBe(0)
  })
})

describe('validerPrevisionnelDuMois', () => {
  // Tout le mois, échu ET à venir : c'est ce qui permet d'envoyer un CRA en
  // cours de mois avec les jours déjà comptés — la projection que le client
  // demande.
  it('convertit le prévisionnel échu comme celui à venir', async () => {
    const { month, premier, dernier } = moisCourant()
    await saisir(premier, 'PREVISIONNEL')
    await saisir(dernier, 'PREVISIONNEL')

    const compte = await prisma.$transaction((tx) =>
      validerPrevisionnelDuMois(tx, { userId, missionId, month }),
    )

    expect(compte).toBe(2)
    const saisies = await prisma.timeEntry.findMany({
      where: { lineId },
      select: { kind: true },
    })
    expect(saisies).toHaveLength(2)
    expect(saisies.every((s) => s.kind === 'REALISE')).toBe(true)
  })

  it('laisse le réalisé intact, et hors du compte rendu', async () => {
    const { month, premier, dernier } = moisCourant()
    await saisir(premier, 'REALISE')
    await saisir(dernier, 'PREVISIONNEL')

    const compte = await prisma.$transaction((tx) =>
      validerPrevisionnelDuMois(tx, { userId, missionId, month }),
    )

    expect(compte).toBe(1)
    const saisies = await prisma.timeEntry.findMany({
      where: { lineId },
      orderBy: { date: 'asc' },
      select: { kind: true },
    })
    expect(saisies.map((s) => s.kind)).toEqual(['REALISE', 'REALISE'])
  })

  // La question a été posée sur UNE mission. Convertir le prévisionnel des
  // autres missions serait une écriture que personne n'a demandée.
  it('ne sort jamais de la mission visée', async () => {
    const { month, premier } = moisCourant()
    const autreMission = await createMission({ clientId, label: 'PREV Autre mission' })
    const autreLigne = await createLine({
      missionId: autreMission.id,
      label: 'Consultant',
      userId,
      soldCentiemes: 3000,
      tjmCents: 0,
    })

    await saisir(premier, 'PREVISIONNEL')
    const ailleurs = await saisirSur(autreLigne.id, premier, 'PREVISIONNEL')

    const compte = await prisma.$transaction((tx) =>
      validerPrevisionnelDuMois(tx, { userId, missionId, month }),
    )

    expect(compte).toBe(1)
    const entree = await prisma.timeEntry.findUnique({ where: { id: ailleurs } })
    expect(entree?.kind).toBe('PREVISIONNEL')
  })

  // Un mois voisin n'a pas été demandé : le laisser vivre est le pendant de
  // ne pas sortir de la mission.
  it('ne touche pas au prévisionnel des mois voisins', async () => {
    const { month, premier, moisSuivant } = moisCourant()
    await saisir(premier, 'PREVISIONNEL')
    const voisin = await saisir(moisSuivant, 'PREVISIONNEL')

    const compte = await prisma.$transaction((tx) =>
      validerPrevisionnelDuMois(tx, { userId, missionId, month }),
    )

    expect(compte).toBe(1)
    const entree = await prisma.timeEntry.findUnique({ where: { id: voisin } })
    expect(entree?.kind).toBe('PREVISIONNEL')
  })

  // Le prévisionnel converti change de couleur dans l'agenda : chaque saisie
  // repart donc en file, dans la transaction qui la convertit.
  it('remet chaque saisie convertie en file UPSERT', async () => {
    const { month, premier, dernier } = moisCourant()
    const id1 = await saisir(premier, 'PREVISIONNEL')
    const id2 = await saisir(dernier, 'PREVISIONNEL')

    await prisma.$transaction((tx) =>
      validerPrevisionnelDuMois(tx, { userId, missionId, month }),
    )

    const enFile = await prisma.syncOutbox.findMany({
      where: { entityType: 'TimeEntry', entityId: { in: [id1, id2] } },
    })
    expect(enFile).toHaveLength(2)
    expect(enFile.every((j) => j.operation === 'UPSERT')).toBe(true)
  })

  it('ne touche à rien quand le mois ne porte aucun prévisionnel', async () => {
    const { month, premier } = moisCourant()
    const realise = await saisir(premier, 'REALISE')

    const compte = await prisma.$transaction((tx) =>
      validerPrevisionnelDuMois(tx, { userId, missionId, month }),
    )

    expect(compte).toBe(0)
    const enFile = await prisma.syncOutbox.findMany({
      where: { entityType: 'TimeEntry', entityId: realise },
    })
    expect(enFile).toHaveLength(0)
  })
})
