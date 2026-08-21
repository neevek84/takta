import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import { LIEN_LIGNE, LIEN_MISSION } from './liens'
import { ouvrirLaTacheDeLaPrestation, projetDeLaMission } from './taches'

let userId = ''
let api: FakeDolibarr

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'taches@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'TAC' } } })
  api = new FakeDolibarr()
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'TAC' } } })
  await prisma.user.deleteMany({ where: { email: 'taches@test.local' } })
  await prisma.$disconnect()
})

/** Une mission rattachée à un projet Dolibarr, et une prestation dessous. */
async function decor(options: { rattachee?: boolean } = {}) {
  const tiers = api.seedThirdparty('TAC ACME')
  const client = await createClient('TAC ACME local')
  const mission = await createMission({ clientId: client.id, label: 'TAC Mission' })
  const projet = api.seedProject({ ref: 'PJ-TAC', title: 'Chantier', socid: tiers.id })

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

  const ligne = await createLine({
    missionId: mission.id,
    userId,
    label: 'Consultant',
    soldCentiemes: 1000,
    tjmCents: 0,
  })
  return { mission, projet, ligne }
}

describe('ouvrirLaTacheDeLaPrestation', () => {
  // `planned_workload` renseigne l'avancement dans Dolibarr. Sans elle, la
  // tâche affiche « Charge de travail non définie » et aucun pourcentage de
  // consommation — constaté sur l'instance du porteur.
  it('porte la charge prévue de la prestation sur la tâche créée', async () => {
    const { mission, ligne } = await decor()
    // Facteur posé sur la prestation elle-même : le test ne doit pas dépendre
    // du réglage global, qui vaut 8 h sur cette base et 7 h ailleurs.
    await prisma.missionLine.update({
      where: { id: ligne.id },
      data: { minutesParJour: 420 },
    })

    await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    // `decor()` vend 1000 centièmes, soit 10 jours ; la journée vaut 7 h par
    // défaut : 10 × 420 × 60 = 252 000 s.
    expect(api.dernierePlannedWorkload).toBe(252_000)
  })

  // **Le piège que ce comportement ferme.** Un projet privé ne rend ses tâches
  // qu'aux utilisateurs qui y ont un rôle : `getTasksArray` écarte tout le
  // reste. Une tâche existante devenait donc invisible, le connecteur la
  // croyait absente, la recréait, et Dolibarr refusait par « Error creating
  // task » puisque la référence était déjà prise. Plutôt que de demander au
  // porteur de poser l'affectation à la main, on la pose.
  it('affecte au projet puis relit quand la liste des tâches revient vide', async () => {
    const { mission, projet, ligne } = await decor()
    const existante = await api.createTask({ projectId: projet.id, label: 'Consultant', plannedWorkloadSeconds: null })
    api.masquerTachesSansAffectation()

    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    expect(r.echec).toBeNull()
    // Retrouvée, pas recréée : c'est toute la différence.
    expect(r.creee).toBe(false)
    const lien = await prisma.externalLink.findFirst({
      where: { entityType: LIEN_LIGNE, entityId: ligne.id, provider: DOLIBARR },
    })
    expect(lien?.externalId).toBe(String(existante.id))
  })

  it('crée la tâche dès que la prestation existe', async () => {
    // Sans cela, une prestation ajoutée à la main attendait le premier envoi
    // de temps : le projet ne montrait qu'une partie de ce qui a été vendu.
    const { mission, projet, ligne } = await decor()

    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    expect(r.creee).toBe(true)
    expect(r.echec).toBeNull()
    const taches = await api.listTasks(projet.id)
    expect(taches.map((t) => t.label)).toEqual(['Consultant'])

    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_LIGNE,
          entityId: ligne.id,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien?.externalId).toBe(String(taches[0]!.id))
  })

  it('réutilise la tâche du projet qui porte déjà ce libellé', async () => {
    // Le push la cherche par son libellé : deux tâches feraient partir les
    // temps sur l'une et laisseraient l'autre vide.
    const { mission, projet, ligne } = await decor()
    const dejaLa = await api.createTask({ projectId: projet.id, label: 'Consultant', plannedWorkloadSeconds: null })
    const avant = api.appels.createTask

    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    expect(r.creee).toBe(false)
    expect(api.appels.createTask).toBe(avant)
    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_LIGNE,
          entityId: ligne.id,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien?.externalId).toBe(String(dejaLa.id))
  })

  it('ne fait rien quand la mission n’est rattachée à aucun projet', async () => {
    const { mission, ligne } = await decor({ rattachee: false })

    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    expect(r).toEqual({ creee: false, echec: null })
    expect(api.appels.createTask).toBe(0)
  })

  it('ne fait rien quand Dolibarr n’est pas connecté', async () => {
    const { mission, ligne } = await decor()
    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api: null,
    })
    expect(r).toEqual({ creee: false, echec: null })
  })

  it('rend le motif au lieu de faire échouer l’ajout de la prestation', async () => {
    // La prestation est locale et valide : une instance injoignable ne doit
    // pas empêcher de la saisir. Mais croire sa tâche créée et ne pas la
    // trouver est pire que de savoir qu'elle manque.
    const { mission, ligne } = await decor()
    api.panne = true

    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    expect(r.creee).toBe(false)
    expect(r.echec).toMatch(/injoignable/i)
  })
})

describe('quand Dolibarr refuse de créer la tâche', () => {
  it('nomme la tâche, le projet, et la cause la plus fréquente', async () => {
    // Le refus de Dolibarr est un « Error creating task » nu. La cause la plus
    // fréquente ne se devine pas : la tâche existe déjà chez lui sans que
    // l'API la rende — mesuré sur l'instance du porteur, où
    // `GET /projects/{id}/tasks` rend une liste vide sur un projet qui en
    // porte une à l'écran.
    const { mission, ligne } = await decor()
    api.createTask = async () => {
      throw new Error('Dolibarr a répondu 500 sur /tasks : Error creating task')
    }

    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    expect(r.echec).toContain('Error creating task')
    expect(r.echec).toContain('« Consultant »')
    expect(r.echec).toMatch(/projet n° \d+/)
    // La cause nommée doit être la **vraie** : le rôle sur le projet, pas
    // l'affectation à la tâche — c'est `getUserRolesForProjectsOrTasks` sur le
    // projet que `getTasksArray` interroge.
    expect(r.echec).toContain("l'utilisateur de la clé d'API n'est renseigné nulle part")
    expect(r.echec).toContain('non public')
  })
})

describe('projetDeLaMission', () => {
  it('rend le projet rattaché, et null quand il n’y en a pas', async () => {
    const { mission, projet } = await decor()
    expect(await projetDeLaMission(mission.id)).toBe(projet.id)

    const orpheline = await decor({ rattachee: false })
    expect(await projetDeLaMission(orpheline.mission.id)).toBeNull()
  })
})

describe('une tâche que la liste de Dolibarr ne rend pas', () => {
  it("est retrouvée par la correspondance mémorisée, au lieu d'être recréée", async () => {
    const { mission, projet, ligne } = await decor()

    // La tâche existe et la correspondance la vise ; mais la liste du projet ne
    // la rend pas — ce que fait Dolibarr quand l'utilisateur de la clé n'y est
    // pas affecté.
    const tache = await api.createTask({ projectId: projet.id, label: 'Consultant', plannedWorkloadSeconds: null })
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
    api.tasks.length = 0
    api.tasks.push({ ...tache })
    api.listTasks = async () => []
    const creationsAvant = api.appels.createTask

    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    expect(r.echec).toBeNull()
    expect(api.appels.createTask).toBe(creationsAvant)
  })

  it('est recréée si elle a été déplacée dans un autre projet', async () => {
    const { mission, projet, ligne } = await decor()
    const ailleurs = api.seedProject({ ref: 'PJ-AUTRE', title: 'Ailleurs', socid: projet.socid })
    const tache = await api.createTask({ projectId: ailleurs.id, label: 'Consultant', plannedWorkloadSeconds: null })
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
    api.listTasks = async () => []

    const r = await ouvrirLaTacheDeLaPrestation({
      userId,
      missionId: mission.id,
      lineId: ligne.id,
      label: 'Consultant',
      api,
    })

    expect(r.creee).toBe(true)
    const lien = await prisma.externalLink.findFirst({
      where: { entityType: LIEN_LIGNE, entityId: ligne.id, provider: DOLIBARR },
    })
    expect(lien?.externalId).not.toBe(String(tache.id))
  })
})
