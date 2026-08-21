import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import { LIEN_LIGNE, LIEN_MISSION } from './liens'
import { tachesReprenables, reprendreLesTaches } from './reprise-taches'

let userId = ''
let api: FakeDolibarr

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'reprise-taches@test.local', name: 'R', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'RPT' } } })
  api = new FakeDolibarr()
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'RPT' } } })
  await prisma.user.deleteMany({ where: { email: 'reprise-taches@test.local' } })
  await prisma.$disconnect()
})

/** Une mission rattachée à un projet Dolibarr qui vit déjà, tâches comprises. */
async function decor(options: { rattachee?: boolean } = {}) {
  const tiers = api.seedThirdparty('RPT ACME')
  const client = await createClient('RPT ACME')
  // 7 h par jour sur le client : la déduction des jours vendus doit suivre la
  // cascade, pas une constante.
  await prisma.client.update({ where: { id: client.id }, data: { minutesParJour: 420 } })
  const mission = await createMission({ clientId: client.id, label: 'RPT Mission' })
  const projet = api.seedProject({ ref: 'PJ-RPT', title: 'Chantier en cours', socid: tiers.id })

  if (options.rattachee !== false) {
    await prisma.externalLink.create({
      data: {
        userId,
        entityType: LIEN_MISSION,
        entityId: mission.id,
        provider: DOLIBARR,
        externalId: String(projet.id),
        syncState: 'SYNCED',
      },
    })
  }
  return { mission, projet, client }
}

describe('tachesReprenables', () => {
  it('déduit les jours vendus de la charge prévue, au facteur de la mission', async () => {
    const { mission, projet } = await decor()
    // 126 000 s = 5 jours à 7 h. À 8 h, ce serait 4,38 — le facteur compte.
    await api.createTask({
      projectId: projet.id,
      label: 'Cadrage',
      plannedWorkloadSeconds: 126_000,
    })

    const etat = await tachesReprenables({ missionId: mission.id, api })

    expect(etat.projectId).toBe(projet.id)
    expect(etat.taches).toHaveLength(1)
    expect(etat.taches[0]!.joursVendusCentiemes).toBe(500)
    expect(etat.taches[0]!.sansCharge).toBe(false)
    expect(etat.taches[0]!.dejaLiee).toBeNull()
  })

  // La mission prime sur le client, comme partout ailleurs. Sans ce test, une
  // surcharge posée sur la mission serait ignorée et les jours vendus déduits
  // au facteur du client — faux dès qu'un chantier tourne à un autre rythme.
  it('laisse la mission surcharger le facteur de son client', async () => {
    const { mission, projet } = await decor()
    await prisma.mission.update({ where: { id: mission.id }, data: { minutesParJour: 480 } })
    await api.createTask({
      projectId: projet.id,
      label: 'Cadrage',
      plannedWorkloadSeconds: 126_000,
    })

    const etat = await tachesReprenables({ missionId: mission.id, api })

    // 126 000 s valent 5 jours à 7 h — le client — mais 4,38 à 8 h — la mission.
    expect(etat.taches[0]!.joursVendusCentiemes).toBe(438)
  })

  it('signale la tâche qui ne porte aucune charge, au lieu de la donner pour nulle', async () => {
    const { mission, projet } = await decor()
    await api.createTask({ projectId: projet.id, label: 'Suivi', plannedWorkloadSeconds: null })

    const etat = await tachesReprenables({ missionId: mission.id, api })

    expect(etat.taches[0]!.sansCharge).toBe(true)
    expect(etat.taches[0]!.joursVendusCentiemes).toBe(0)
  })

  it('montre quelle prestation reprend déjà une tâche', async () => {
    const { mission, projet } = await decor()
    const tache = await api.createTask({
      projectId: projet.id,
      label: 'Cadrage',
      plannedWorkloadSeconds: null,
    })
    const ligne = await createLine({
      missionId: mission.id,
      userId,
      label: 'Cadrage',
      soldCentiemes: 0,
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

    const etat = await tachesReprenables({ missionId: mission.id, api })

    expect(etat.taches[0]!.dejaLiee).toEqual({ lineId: ligne.id, label: 'Cadrage' })
    expect(etat.prestations).toEqual([{ lineId: ligne.id, label: 'Cadrage', dejaLiee: true }])
  })

  // Rien à reprendre n'est pas une panne : l'écran doit pouvoir s'ouvrir et le
  // dire, plutôt que de casser sur une mission locale.
  it("rend un état vide quand la mission n'a pas de projet", async () => {
    const { mission } = await decor({ rattachee: false })

    const etat = await tachesReprenables({ missionId: mission.id, api })

    expect(etat).toEqual({ projectId: null, taches: [], prestations: [] })
  })
})

describe('reprendreLesTaches', () => {
  it('crée la prestation, ses jours vendus, et la correspondance déjà synchronisée', async () => {
    const { mission, projet } = await decor()
    const tache = await api.createTask({
      projectId: projet.id,
      label: 'Cadrage',
      plannedWorkloadSeconds: 126_000,
    })

    const r = await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: tache.id, action: 'CREER' }],
      api,
    })

    expect(r).toMatchObject({ creees: 1, appariees: 0, sansCharge: 0, ecartees: [] })

    const ligne = await prisma.missionLine.findFirstOrThrow({
      where: { missionId: mission.id },
    })
    expect(ligne.label).toBe('Cadrage')
    expect(ligne.soldCentiemes).toBe(500)
    // L'engagement vient de Dolibarr : il ne se modifie pas ici.
    expect(ligne.engagementSource).toBe('DOLIBARR_PROJET')

    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: LIEN_LIGNE, entityId: ligne.id, provider: DOLIBARR },
    })
    expect(lien.externalId).toBe(String(tache.id))
    // Rien n'est à pousser : les deux côtés sont déjà d'accord.
    expect(lien.syncState).toBe('SYNCED')
  })

  it('compte les prestations nées sans jours vendus, pour que le porteur les complète', async () => {
    const { mission, projet } = await decor()
    const tache = await api.createTask({
      projectId: projet.id,
      label: 'Suivi',
      plannedWorkloadSeconds: null,
    })

    const r = await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: tache.id, action: 'CREER' }],
      api,
    })

    expect(r.creees).toBe(1)
    expect(r.sansCharge).toBe(1)
  })

  it('apparie une prestation existante sans en créer une seconde', async () => {
    const { mission, projet } = await decor()
    const tache = await api.createTask({
      projectId: projet.id,
      label: 'Cadrage',
      plannedWorkloadSeconds: 126_000,
    })
    const ligne = await createLine({
      missionId: mission.id,
      userId,
      label: 'Pilotage',
      soldCentiemes: 1000,
      tjmCents: 50_000,
    })

    const r = await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: tache.id, action: 'APPARIER', lineId: ligne.id }],
      api,
    })

    expect(r).toMatchObject({ creees: 0, appariees: 1, ecartees: [] })
    expect(await prisma.missionLine.count({ where: { missionId: mission.id } })).toBe(1)

    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: LIEN_LIGNE, entityId: ligne.id, provider: DOLIBARR },
    })
    expect(lien.externalId).toBe(String(tache.id))
    // L'engagement de la prestation appariée n'est pas réécrit : elle vient
    // d'ailleurs, et ses jours vendus ne sont pas ceux de la tâche.
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.soldCentiemes).toBe(1000)
  })

  // La contrainte d'unicité porte sur la prestation : un `upsert` remplacerait
  // son lien en silence, et ses temps déjà poussés viseraient une autre tâche.
  it('refuse d apparier une prestation qui vise déjà une autre tâche', async () => {
    const { mission, projet } = await decor()
    const premiere = await api.createTask({
      projectId: projet.id,
      label: 'Cadrage',
      plannedWorkloadSeconds: null,
    })
    const seconde = await api.createTask({
      projectId: projet.id,
      label: 'Recette',
      plannedWorkloadSeconds: null,
    })
    const ligne = await createLine({
      missionId: mission.id,
      userId,
      label: 'Pilotage',
      soldCentiemes: 0,
      tjmCents: 0,
    })

    await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: premiere.id, action: 'APPARIER', lineId: ligne.id }],
      api,
    })
    const r = await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: seconde.id, action: 'APPARIER', lineId: ligne.id }],
      api,
    })

    expect(r.appariees).toBe(0)
    expect(r.ecartees).toHaveLength(1)
    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: LIEN_LIGNE, entityId: ligne.id, provider: DOLIBARR },
    })
    expect(lien.externalId).toBe(String(premiere.id))
  })

  it('refuse de reprendre deux fois la même tâche', async () => {
    const { mission, projet } = await decor()
    const tache = await api.createTask({
      projectId: projet.id,
      label: 'Cadrage',
      plannedWorkloadSeconds: null,
    })

    await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: tache.id, action: 'CREER' }],
      api,
    })
    const r = await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: tache.id, action: 'CREER' }],
      api,
    })

    expect(r.creees).toBe(0)
    expect(r.ecartees).toHaveLength(1)
    expect(await prisma.missionLine.count({ where: { missionId: mission.id } })).toBe(1)
  })

  it('ne fait rien de ce qui est ignoré', async () => {
    const { mission, projet } = await decor()
    const tache = await api.createTask({
      projectId: projet.id,
      label: 'Cadrage',
      plannedWorkloadSeconds: 126_000,
    })

    const r = await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: tache.id, action: 'IGNORER' }],
      api,
    })

    expect(r).toMatchObject({ creees: 0, appariees: 0, ignorees: 1 })
    expect(await prisma.missionLine.count({ where: { missionId: mission.id } })).toBe(0)
  })

  it("refuse quand la mission n'est rattachée à aucun projet", async () => {
    const { mission } = await decor({ rattachee: false })

    const r = await reprendreLesTaches({
      missionId: mission.id,
      userId,
      decisions: [{ taskId: 1, action: 'CREER' }],
      api,
    })

    expect(r.creees).toBe(0)
    expect(r.ecartees).toHaveLength(1)
  })
})
