import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { verifyPassword } from '@/auth-password'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import { LIEN_LIGNE, LIEN_TEMPS_REPRIS, LIEN_UTILISATEUR } from './liens'
import { tempsReprenables, reprendreLesTemps } from './reprise-temps'

/** Le jour de référence de tous ces tests : la coupure tombe au 31 juillet. */
const AUJOURDHUI = '2026-08-21'

let userId = ''
let api: FakeDolibarr

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'reprise-temps@test.local', name: 'R', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'RTP' } } })
  await prisma.user.deleteMany({ where: { email: { contains: 'reprise.local' } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'camille' } } })
  api = new FakeDolibarr()
  api.setup.TIMESHEET_DAY_DURATION = '7'
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'RTP' } } })
  await prisma.user.deleteMany({ where: { email: { contains: 'reprise.local' } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'camille' } } })
  await prisma.user.deleteMany({ where: { email: 'reprise-temps@test.local' } })
  await prisma.$disconnect()
})

/** Une mission dont la prestation vise une tâche qui porte déjà des temps. */
async function decor() {
  const tiers = api.seedThirdparty('RTP ACME')
  const client = await createClient('RTP ACME')
  const mission = await createMission({ clientId: client.id, label: 'RTP Mission' })
  const projet = api.seedProject({ ref: 'PJ-RTP', title: 'En cours', socid: tiers.id })
  const tache = await api.createTask({
    projectId: projet.id,
    label: 'Cadrage',
    plannedWorkloadSeconds: null,
  })
  const ligne = await createLine({
    missionId: mission.id,
    userId,
    label: 'Cadrage',
    soldCentiemes: 1000,
    tjmCents: 0,
  })
  await prisma.externalLink.create({
    data: {
      userId,
      entityType: LIEN_LIGNE,
      entityId: ligne.id,
      provider: DOLIBARR,
      externalId: String(tache.id),
      syncState: 'SYNCED',
    },
  })
  const auteur = api.seedUser({ nom: 'Camille Dupont', email: 'camille@exemple.test' })
  return { mission, ligne, tache, auteur, client }
}

/** Pose un temps chez Dolibarr, sans passer par le push. */
function seedTemps(args: {
  taskId: number
  dolibarrUserId: number
  date: string
  durationSeconds: number
  note?: string
  debutUnix?: number | null
}) {
  api.timespents.push({
    id: api.timespents.length + 1000,
    taskId: args.taskId,
    dolibarrUserId: args.dolibarrUserId,
    date: args.date,
    durationSeconds: args.durationSeconds,
    note: args.note ?? '',
    debutUnix: args.debutUnix ?? null,
  })
}

describe('tempsReprenables', () => {
  it('compte ce qui est reprenable et ce que la coupure écarte', async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 25_200 })
    // Le mois en cours se saisit dans l'application : il ne se reprend pas.
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-08-03', durationSeconds: 25_200 })

    const etat = await tempsReprenables({ missionId: d.mission.id, api, aujourdhui: AUJOURDHUI })

    expect(etat.coupure).toBe('2026-07-31')
    expect(etat.prestations).toHaveLength(1)
    expect(etat.prestations[0]).toMatchObject({ aReprendre: 1, dejaRepris: 0, apresCoupure: 1 })
    expect(etat.auteurs).toEqual([{ dolibarrUserId: d.auteur.id, connu: false }])
  })

  // Sans prestation liée, un temps n'a nulle part où atterrir : l'écran doit
  // le dire au lieu de proposer une reprise qui ne fera rien.
  it('ne propose rien quand aucune prestation ne vise une tâche', async () => {
    const tiers = api.seedThirdparty('RTP SEUL')
    const client = await createClient('RTP SEUL')
    const mission = await createMission({ clientId: client.id, label: 'RTP Sans tâche' })
    api.seedProject({ ref: 'PJ-RTP2', title: 'X', socid: tiers.id })

    const etat = await tempsReprenables({ missionId: mission.id, api, aujourdhui: AUJOURDHUI })

    expect(etat.prestations).toEqual([])
  })
})

describe('reprendreLesTemps', () => {
  it('crée la saisie, au facteur de Dolibarr, et mémorise son origine', async () => {
    const d = await decor()
    seedTemps({
      taskId: d.tache.id,
      dolibarrUserId: d.auteur.id,
      date: '2026-07-15',
      durationSeconds: 25_200,
      note: 'Atelier',
    })

    const r = await reprendreLesTemps({
      missionId: d.mission.id,
      userId,
      api,
      aujourdhui: AUJOURDHUI,
    })

    expect(r.reprises).toBe(1)
    const saisie = await prisma.timeEntry.findFirstOrThrow({ where: { lineId: d.ligne.id } })
    expect(saisie.minutes).toBe(420)
    expect(saisie.kind).toBe('REALISE')
    expect(saisie.comment).toBe('Atelier')
    // Le facteur est celui de Dolibarr — 7 h — et non la cascade locale.
    expect(saisie.minutesParJour).toBe(420)

    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: LIEN_TEMPS_REPRIS, entityId: saisie.id },
    })
    expect(lien.externalId).toBe('1000')
  })

  // Le mois repris est verrouillé, sinon générer puis valider son CRA
  // renverrait tout chez Dolibarr, en double des lignes d'origine.
  it('verrouille le mois repris en validant son CRA', async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 25_200 })

    const r = await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    expect(r.moisVerrouilles).toEqual(['2026-07'])
    const cra = await prisma.cra.findFirstOrThrow({ where: { missionId: d.mission.id } })
    expect(cra.status).toBe('VALIDE')
  })

  // La file Dolibarr n'est alimentée qu'à la transition vers validé. La reprise
  // ne doit pas y passer : les temps sont déjà là-bas.
  it('ne met aucun push en file', async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 25_200 })

    await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it("crée l'utilisateur de l'auteur, sans mot de passe utilisable", async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 25_200 })

    const r = await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    expect(r.utilisateursCrees).toBe(1)
    const cree = await prisma.user.findUniqueOrThrow({ where: { email: 'camille@exemple.test' } })
    expect(cree.name).toBe('Camille Dupont')
    // Une identité, pas un compte : aucune empreinte ne peut être vérifiée.
    expect(await verifyPassword(cree.passwordHash, '')).toBe(false)
    expect(await verifyPassword(cree.passwordHash, 'motdepasse')).toBe(false)

    // La saisie appartient à l'auteur, pas au porteur qui importe.
    const saisie = await prisma.timeEntry.findFirstOrThrow({ where: { lineId: d.ligne.id } })
    expect(saisie.userId).toBe(cree.id)

    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: LIEN_UTILISATEUR, entityId: cree.id },
    })
    expect(lien.externalId).toBe(String(d.auteur.id))
  })

  it("ne recrée pas deux fois le même auteur", async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 25_200 })
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-06-10', durationSeconds: 25_200 })

    const r = await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    expect(r.reprises).toBe(2)
    expect(r.utilisateursCrees).toBe(1)
  })

  // L'heure d'un autre fait foi ; l'absence vaut 9 h. Arbitrage du porteur.
  it("garde l'heure de Dolibarr quand il en porte une", async () => {
    const d = await decor()
    // 2026-07-15 05:00 GMT = 07:00 à Paris.
    seedTemps({
      taskId: d.tache.id,
      dolibarrUserId: d.auteur.id,
      date: '2026-07-15',
      durationSeconds: 3_600,
      debutUnix: Date.parse('2026-07-15T05:00:00Z') / 1000,
    })

    await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    const saisie = await prisma.timeEntry.findFirstOrThrow({ where: { lineId: d.ligne.id } })
    expect(saisie.startMinute).toBe(7 * 60)
  })

  it('pose à 9 h ce que Dolibarr ne situe pas', async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 3_600 })

    await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    const saisie = await prisma.timeEntry.findFirstOrThrow({ where: { lineId: d.ligne.id } })
    expect(saisie.startMinute).toBe(540)
  })

  // Deux temps du même jour sur la même prestation partagent la clé d'unicité
  // à l'heure près : sans décalage, le second remplacerait le premier.
  it('décale deux temps du même jour au lieu de les confondre', async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 12_600 })
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 3_600 })

    const r = await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    expect(r.reprises).toBe(2)
    const saisies = await prisma.timeEntry.findMany({
      where: { lineId: d.ligne.id },
      orderBy: { startMinute: 'asc' },
    })
    expect(saisies.map((s) => s.startMinute)).toEqual([540, 750])
  })

  // Rejouable : le porteur peut relancer la reprise sans doubler ses saisies.
  it("n'importe pas deux fois le même temps", async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 25_200 })

    await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })
    const second = await reprendreLesTemps({
      missionId: d.mission.id,
      userId,
      api,
      aujourdhui: AUJOURDHUI,
    })

    expect(second.reprises).toBe(0)
    expect(await prisma.timeEntry.count({ where: { lineId: d.ligne.id } })).toBe(1)
  })

  // Une reprise rejouée après qu'un temps s'est ajouté le même jour ne doit pas
  // retomber sur une minute déjà occupée : la clé d'unicité la refuserait, et
  // c'est tout l'import qui échouerait sur une seule ligne.
  it("évite les minutes qu'une reprise précédente a déjà posées", async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 3_600 })
    await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 3_600 })
    const second = await reprendreLesTemps({
      missionId: d.mission.id,
      userId,
      api,
      aujourdhui: AUJOURDHUI,
    })

    expect(second.reprises).toBe(1)
    const saisies = await prisma.timeEntry.findMany({
      where: { lineId: d.ligne.id },
      orderBy: { startMinute: 'asc' },
    })
    expect(saisies).toHaveLength(2)
    expect(saisies[0]!.startMinute).toBe(540)
    expect(saisies[1]!.startMinute).toBeGreaterThan(540)
  })

  it('laisse le mois en cours à la saisie', async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-08-03', durationSeconds: 25_200 })

    const r = await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    expect(r.reprises).toBe(0)
    expect(await prisma.cra.count({ where: { missionId: d.mission.id } })).toBe(0)
  })

  // Attribuer le temps d'un inconnu au porteur réécrirait l'histoire ; mieux
  // vaut l'écarter et le dire.
  it("écarte les temps dont l'auteur n'existe plus, et le dit une seule fois", async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: 9999, date: '2026-07-15', durationSeconds: 25_200 })
    seedTemps({ taskId: d.tache.id, dolibarrUserId: 9999, date: '2026-06-10', durationSeconds: 25_200 })

    const r = await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    expect(r.reprises).toBe(0)
    expect(r.ecartes).toHaveLength(1)
    expect(r.ecartes[0]).toMatch(/9999/)
  })

  it("refuse quand aucune prestation ne vise une tâche", async () => {
    const client = await createClient('RTP VIDE')
    const mission = await createMission({ clientId: client.id, label: 'RTP Vide' })

    const r = await reprendreLesTemps({ missionId: mission.id, userId, api, aujourdhui: AUJOURDHUI })

    expect(r.reprises).toBe(0)
    expect(r.ecartes).toHaveLength(1)
    expect(r.ecartes[0]).toMatch(/Reprenez d'abord les tâches/)
  })
})
