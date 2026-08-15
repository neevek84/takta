import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry } from './time-entries'
import { buildChargeMatrix } from './charge'

let userId = ''
let voisinId = ''
let missionId = ''
let lineJour = ''
let lineNuit = ''

/**
 * Crée une ligne jetable sur la mission du jeu d'essai. Les lignes du
 * `beforeAll` sont partagées par tous les tests (le TJM moyen pondéré les
 * agrège toutes) : tout ce qui a besoin d'une ligne aux réglages particuliers
 * la crée et la supprime dans son propre test.
 */
async function withTempLine<T>(
  args: { soldCentiemes: number; tjmCents: number; minutesParJour?: number },
  fn: (lineId: string) => Promise<T>,
): Promise<T> {
  const line = await createLine({
    missionId,
    userId,
    label: 'Ligne jetable',
    soldCentiemes: args.soldCentiemes,
    tjmCents: args.tjmCents,
    minutesParJour: args.minutesParJour ?? null,
  })
  try {
    return await fn(line.id)
  } finally {
    // Cascade : affectations et saisies de la ligne partent avec elle.
    await prisma.missionLine.delete({ where: { id: line.id } })
  }
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'charge@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id

  const v = await prisma.user.create({
    data: { email: 'voisin-charge@test.local', name: 'V', passwordHash: 'x' },
  })
  voisinId = v.id

  const c = await createClient('CHARGE client')
  const m = await createMission({ clientId: c.id, label: 'ITSM' })
  missionId = m.id
  lineJour = (await createLine({
    missionId: m.id, userId, label: 'Consultant ITSM',
    soldCentiemes: 3000, tjmCents: 80000,
  })).id
  lineNuit = (await createLine({
    missionId: m.id, userId, label: 'Consultant ITSM Nuit',
    soldCentiemes: 1000, tjmCents: 120000,
  })).id

  // Le voisin partage *la même ligne* : c'est la seule configuration qui
  // amène `buildChargeMatrix` jusqu'à sa requête de saisies pour les deux
  // utilisateurs. Un second utilisateur sans affectation sortirait par le
  // retour anticipé et ne testerait aucun scope.
  await prisma.assignment.create({
    data: { lineId: lineJour, userId: voisinId, soldCentiemes: 3000 },
  })
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, voisinId] } } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    debutExerciceMois: 4,
    objectifCaExerciceCents: 15_000_000,
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, voisinId] } } })
  await prisma.user.deleteMany({
    where: { email: { in: ['charge@test.local', 'voisin-charge@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'CHARGE client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('buildChargeMatrix', () => {
  it('couvre les douze mois de l exercice, d avril à mars', async () => {
    const m = await buildChargeMatrix(userId, 2026)
    expect(m.fiscalYear.label).toBe('Exercice 2026-2027')
    expect(m.fiscalYear.months).toHaveLength(12)
    expect(m.fiscalYear.months[0]).toBe('2026-04')
    expect(m.fiscalYear.months[11]).toBe('2027-03')
    expect(m.rows[0]!.cells).toHaveLength(12)
  })

  it('range chaque saisie dans la colonne de son mois', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineJour, date: '2027-01-08', minutes: 240, kind: 'PREVISIONNEL' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells[1]!.realiseCentiemes).toBe(100)   // 2026-05
    expect(row.cells[9]!.prevuCentiemes).toBe(50)      // 2027-01
    expect(row.cells[0]!.realiseCentiemes).toBe(0)
  })

  it('ignore les saisies hors de l exercice demandé', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-03-10', minutes: 480, kind: 'REALISE' })
    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells.every((c) => c.realiseCentiemes === 0)).toBe(true)
  })

  it('calcule le CA du mois avec le TJM de chaque ligne', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineNuit, date: '2026-05-13', minutes: 480, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    expect(m.monthTotals[1]!.caCents).toBe(200000)
    expect(m.monthTotals[1]!.centiemes).toBe(200)
  })

  it('reprend computeEngagement pour le reste à planifier par ligne', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 18, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.engagement.venduCentiemes).toBe(3000)
    expect(row.engagement.realiseCentiemes).toBe(1800)
    expect(row.engagement.resteCentiemes).toBe(1200)
  })

  it('compte l engagement d une ligne sur toutes les périodes, pas seulement l exercice', async () => {
    // Saisie dans l exercice précédent : elle ne doit pas apparaître dans les
    // cellules, mais doit bien compter dans l engagement de la ligne.
    await saveEntry({ userId, lineId: lineJour, date: '2026-03-10', minutes: 480 * 5, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells.every((c) => c.realiseCentiemes === 0)).toBe(true)
    expect(row.engagement.realiseCentiemes).toBe(500)
  })

  it('calcule l avancement de l exercice et le reste à vendre', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 10, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    // 10 jours × 800 € = 8 000 € = 800 000 centimes
    expect(m.progress.objectifCents).toBe(15_000_000)
    expect(m.progress.realiseCents).toBe(800_000)
    expect(m.progress.prevuCents).toBe(0)
    expect(m.progress.resteAVendreCents).toBe(14_200_000)
  })

  it('traduit le reste à vendre en jours au TJM moyen pondéré', async () => {
    const m = await buildChargeMatrix(userId, 2026)
    // (80000*3000 + 120000*1000) / 4000 = 90 000 centimes par jour
    // 15 000 000 / 90 000 = 166,66... jours
    expect(m.resteEnJoursCentiemes).toBe(16667)
  })

  it('ne renvoie aucune ligne pour un utilisateur sans affectation', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-charge@test.local', name: 'A', passwordHash: 'x' },
    })
    const m = await buildChargeMatrix(autre.id, 2026)
    expect(m.rows).toHaveLength(0)
    expect(m.monthTotals.every((t) => t.caCents === 0)).toBe(true)
    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('ne montre à un utilisateur que ses saisies sur une ligne partagée', async () => {
    // Les deux utilisateurs sont affectés à `lineJour`. La matrice du voisin
    // doit donc bien contenir la ligne — sinon le test sortirait par le
    // retour anticipé sans jamais atteindre la requête de saisies.
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 3, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineJour, date: '2026-06-10', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId: voisinId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 7, kind: 'REALISE' })

    const mien = await buildChargeMatrix(userId, 2026)
    const maLigne = mien.rows.find((r) => r.lineId === lineJour)!
    expect(maLigne.cells[1]!.realiseCentiemes).toBe(300)
    expect(maLigne.cells[2]!.prevuCentiemes).toBe(100)
    expect(maLigne.engagement.realiseCentiemes).toBe(300)
    expect(mien.progress.realiseCents).toBe(240_000)
    expect(mien.monthTotals[1]!.centiemes).toBe(300)

    const sien = await buildChargeMatrix(voisinId, 2026)
    const saLigne = sien.rows.find((r) => r.lineId === lineJour)
    expect(saLigne).toBeDefined()
    expect(saLigne!.cells[1]!.realiseCentiemes).toBe(700)
    expect(saLigne!.cells[2]!.prevuCentiemes).toBe(0)
    expect(saLigne!.engagement.realiseCentiemes).toBe(700)
    expect(saLigne!.engagement.prevuCentiemes).toBe(0)
    expect(sien.progress.realiseCents).toBe(560_000)
    expect(sien.progress.prevuCents).toBe(0)
    expect(sien.monthTotals[1]!.centiemes).toBe(700)
    expect(sien.monthTotals[2]!.centiemes).toBe(0)
  })

  it('cumule les minutes avant de convertir : cellules, total mensuel et engagement concordent', async () => {
    // Journée à 420 min : dix saisies d une heure valent 143 centièmes en
    // cumulant les minutes, 140 en convertissant chaque saisie séparément.
    await withTempLine({ soldCentiemes: 2000, tjmCents: 84000, minutesParJour: 420 }, async (lineId) => {
      for (let j = 1; j <= 10; j++) {
        await saveEntry({
          userId, lineId, date: `2026-05-${String(j).padStart(2, '0')}`,
          minutes: 60, kind: 'REALISE',
        })
      }

      const m = await buildChargeMatrix(userId, 2026)
      const row = m.rows.find((r) => r.lineId === lineId)!
      const sommeCellules = row.cells.reduce((s, c) => s + c.realiseCentiemes, 0)

      expect(row.engagement.realiseCentiemes).toBe(143)
      expect(sommeCellules).toBe(143)
      expect(sommeCellules).toBe(row.engagement.realiseCentiemes)
      expect(row.cells[1]!.realiseCentiemes).toBe(143)
      expect(m.monthTotals[1]!.centiemes).toBe(143)
      // Le pied de colonne ne doit pas contredire son propre CA :
      // 120 000 centimes pour 1,43 j, soit le TJM réel de 840 €.
      expect(m.monthTotals[1]!.caCents).toBe(120_000)
    })
  })

  it('cumule aussi le prévisionnel en minutes avant de convertir', async () => {
    await withTempLine({ soldCentiemes: 2000, tjmCents: 84000, minutesParJour: 420 }, async (lineId) => {
      for (let j = 1; j <= 10; j++) {
        await saveEntry({
          userId, lineId, date: `2026-05-${String(j).padStart(2, '0')}`,
          minutes: 60, kind: 'PREVISIONNEL',
        })
      }

      const m = await buildChargeMatrix(userId, 2026)
      const row = m.rows.find((r) => r.lineId === lineId)!
      expect(row.cells[1]!.prevuCentiemes).toBe(143)
      expect(row.engagement.prevuCentiemes).toBe(143)
      expect(m.monthTotals[1]!.centiemes).toBe(143)
    })
  })

  it('additionne les totaux mensuels de lignes aux journées différentes', async () => {
    // 420 min/j et 480 min/j dans la même colonne : les minutes brutes ne
    // sont pas commensurables, le total est la somme des cellules converties.
    await withTempLine({ soldCentiemes: 2000, tjmCents: 84000, minutesParJour: 420 }, async (lineId) => {
      await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 60, kind: 'REALISE' })
      await saveEntry({ userId, lineId: lineJour, date: '2026-05-05', minutes: 240, kind: 'REALISE' })

      const m = await buildChargeMatrix(userId, 2026)
      const courte = m.rows.find((r) => r.lineId === lineId)!
      const jour = m.rows.find((r) => r.lineId === lineJour)!
      expect(courte.cells[1]!.realiseCentiemes).toBe(14)
      expect(jour.cells[1]!.realiseCentiemes).toBe(50)
      expect(m.monthTotals[1]!.centiemes).toBe(64)
    })
  })

  it('somme exactement : le CA de l exercice égale la somme des totaux mensuels', async () => {
    // 100 000 centimes pour 420 min : 238,095… centimes la minute. Un appel
    // global à `caFromEntries` arrondirait 42 857, la somme des douze mois
    // 42 858. Les deux chiffres sont affichés sur le même écran.
    await withTempLine({ soldCentiemes: 2000, tjmCents: 100000, minutesParJour: 420 }, async (lineId) => {
      await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 60, kind: 'REALISE' })
      await saveEntry({ userId, lineId, date: '2026-06-04', minutes: 60, kind: 'REALISE' })
      await saveEntry({ userId, lineId, date: '2026-07-06', minutes: 60, kind: 'REALISE' })

      const m = await buildChargeMatrix(userId, 2026)
      const sommeMois = m.monthTotals.reduce((s, t) => s + t.caCents, 0)
      expect(sommeMois).toBe(42_858)
      expect(m.progress.realiseCents + m.progress.prevuCents).toBe(sommeMois)
      expect(m.progress.realiseCents).toBe(42_858)
    })
  })

  it('somme exactement aussi quand réalisé et prévisionnel se mélangent', async () => {
    await withTempLine({ soldCentiemes: 2000, tjmCents: 100000, minutesParJour: 420 }, async (lineId) => {
      await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 60, kind: 'REALISE' })
      await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 90, kind: 'PREVISIONNEL' })
      await saveEntry({ userId, lineId, date: '2026-09-14', minutes: 30, kind: 'PREVISIONNEL' })
      await saveEntry({ userId, lineId: lineJour, date: '2026-05-06', minutes: 480, kind: 'REALISE' })

      const m = await buildChargeMatrix(userId, 2026)
      const sommeMois = m.monthTotals.reduce((s, t) => s + t.caCents, 0)
      expect(m.progress.realiseCents + m.progress.prevuCents).toBe(sommeMois)
    })
  })

  it('chiffre le reste à planifier de la ligne en euros', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 18, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.tjmCents).toBe(80_000)
    expect(row.engagement.resteCentiemes).toBe(1200)
    // 12 jours restants × 800 € = 9 600 € = 960 000 centimes
    expect(row.resteAVendreCents).toBe(960_000)
  })

  it('exclut du CA de l exercice les saisies des autres exercices', async () => {
    // 2026-03 précède l exercice avril-mars : la ligne garde son engagement,
    // mais ni le CA de l exercice ni les totaux mensuels ne doivent bouger.
    await saveEntry({ userId, lineId: lineJour, date: '2026-03-10', minutes: 480 * 5, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineJour, date: '2027-04-02', minutes: 480 * 2, kind: 'PREVISIONNEL' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.engagement.realiseCentiemes).toBe(500)
    expect(row.engagement.prevuCentiemes).toBe(200)
    expect(m.progress.realiseCents).toBe(0)
    expect(m.progress.prevuCents).toBe(0)
    expect(m.progress.resteAVendreCents).toBe(15_000_000)
    expect(m.monthTotals.every((t) => t.caCents === 0)).toBe(true)
    expect(m.monthTotals.every((t) => t.centiemes === 0)).toBe(true)
  })

  it('garde le CA réalisé d une ligne archivée en cours d exercice', async () => {
    await withTempLine({ soldCentiemes: 4000, tjmCents: 80000 }, async (lineId) => {
      await saveEntry({ userId, lineId, date: '2026-04-15', minutes: 480 * 40, kind: 'REALISE' })

      const avant = await buildChargeMatrix(userId, 2026)
      expect(avant.progress.realiseCents).toBe(3_200_000)
      expect(avant.progress.resteAVendreCents).toBe(11_800_000)

      await prisma.missionLine.update({ where: { id: lineId }, data: { archived: true } })

      const apres = await buildChargeMatrix(userId, 2026)
      // Le CA d un exercice est un fait comptable : l archivage ne l efface pas.
      expect(apres.progress.realiseCents).toBe(3_200_000)
      expect(apres.progress.resteAVendreCents).toBe(11_800_000)
      expect(apres.monthTotals[0]!.caCents).toBe(3_200_000)
      // La ligne reste affichée, sinon le pied de colonne compterait des
      // jours qu aucune cellule visible ne justifie.
      const row = apres.rows.find((r) => r.lineId === lineId)
      expect(row).toBeDefined()
      expect(row!.cells[0]!.realiseCentiemes).toBe(4000)
      expect(apres.monthTotals[0]!.centiemes).toBe(4000)
    })
  })

  it('garde le CA réalisé quand c est la mission qui est archivée', async () => {
    const c = await createClient('CHARGE client')
    const autreMission = await createMission({ clientId: c.id, label: 'ITSM clos' })
    const line = await createLine({
      missionId: autreMission.id, userId, label: 'Ligne close',
      soldCentiemes: 1000, tjmCents: 80000,
    })
    try {
      await saveEntry({ userId, lineId: line.id, date: '2026-04-15', minutes: 480 * 10, kind: 'REALISE' })
      await prisma.mission.update({ where: { id: autreMission.id }, data: { archived: true } })

      const m = await buildChargeMatrix(userId, 2026)
      expect(m.progress.realiseCents).toBe(800_000)
      expect(m.rows.some((r) => r.lineId === line.id)).toBe(true)
    } finally {
      await prisma.mission.delete({ where: { id: autreMission.id } })
    }
  })

  it('ne fait pas réapparaître une ligne archivée sans aucune saisie de l exercice', async () => {
    await withTempLine({ soldCentiemes: 4000, tjmCents: 80000 }, async (lineId) => {
      // Une saisie, mais sur l exercice précédent : elle ne rouvre pas la ligne.
      await saveEntry({ userId, lineId, date: '2026-03-10', minutes: 480, kind: 'REALISE' })
      await prisma.missionLine.update({ where: { id: lineId }, data: { archived: true } })

      const m = await buildChargeMatrix(userId, 2026)
      expect(m.rows.some((r) => r.lineId === lineId)).toBe(false)
      expect(m.progress.realiseCents).toBe(0)
    })
  })

  it('ne rouvre une ligne archivée que sur les saisies de l utilisateur', async () => {
    // Les deux sont affectés à `lineNuit`, archivée, mais seul le titulaire y
    // a saisi : la ligne ne doit reparaître que dans sa matrice à lui.
    await prisma.assignment.create({
      data: { lineId: lineNuit, userId: voisinId, soldCentiemes: 1000 },
    })
    await saveEntry({ userId, lineId: lineNuit, date: '2026-05-12', minutes: 480, kind: 'REALISE' })
    await prisma.missionLine.update({ where: { id: lineNuit }, data: { archived: true } })
    try {
      const mien = await buildChargeMatrix(userId, 2026)
      expect(mien.rows.some((r) => r.lineId === lineNuit)).toBe(true)
      expect(mien.progress.realiseCents).toBe(120_000)

      const sien = await buildChargeMatrix(voisinId, 2026)
      expect(sien.rows.some((r) => r.lineId === lineNuit)).toBe(false)
      expect(sien.progress.realiseCents).toBe(0)
    } finally {
      await prisma.missionLine.update({ where: { id: lineNuit }, data: { archived: false } })
      await prisma.assignment.deleteMany({ where: { lineId: lineNuit, userId: voisinId } })
    }
  })
})
