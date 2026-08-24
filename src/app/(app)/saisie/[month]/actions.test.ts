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
import {
  appliquerCase,
  compterPrevisionnelDeLaLigne,
  genererCraAction,
  remplirMois,
  saveCell,
  validerJoursPasses,
  viderMois,
} from './actions'
import { updateSettings } from '@/services/settings'

/** Mois précédent : ses jours sont échus quelle que soit la date d'exécution. */
const now = new Date()
const jour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10))
const month = jour.toISOString().slice(0, 7)

/** Deux mois à venir, disjoints : leurs jours sont à venir, eux aussi toujours. */
function moisDecale(decalage: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + decalage, 10))
    .toISOString()
    .slice(0, 7)
}
const moisCase = moisDecale(1)
const moisRemplissage = moisDecale(2)

function bornes(m: string): { gte: Date; lt: Date } {
  const [y, mm] = m.split('-').map(Number) as [number, number]
  return { gte: new Date(Date.UTC(y, mm - 1, 1)), lt: new Date(Date.UTC(y, mm, 1)) }
}

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

  // Les réglages sont une ligne unique partagée par toute la suite : celle-ci
  // fixe la sienne plutôt que d'hériter de celle du fichier précédent.
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'AVERTISSEMENT',
    capacityCentiemes: 100,
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

/**
 * Le `kind` n'est jamais fourni par le client : c'est l'horloge du serveur qui
 * départage le réalisé du prévisionnel. Le laisser venir du navigateur
 * suffirait à faire passer pour réalisé un jour qui ne l'est pas.
 */
describe('appliquerCase', () => {
  it('écrit du réalisé sur un jour échu', async () => {
    const date = `${month}-12`
    const resultat = await appliquerCase({
      lineId: ligneOuverte,
      date,
      state: { kind: 'JOURNEE' },
      month,
    })
    expect(resultat.ok).toBe(true)

    const ecrites = await prisma.timeEntry.findMany({
      where: { userId: session.id, lineId: ligneOuverte, date: new Date(`${date}T00:00:00.000Z`) },
      select: { kind: true, minutes: true },
    })
    expect(ecrites).toEqual([{ kind: 'REALISE', minutes: 480 }])
  })

  it('écrit du prévisionnel sur un jour à venir', async () => {
    const date = `${moisCase}-12`
    const resultat = await appliquerCase({
      lineId: ligneOuverte,
      date,
      state: { kind: 'JOURNEE' },
      month: moisCase,
    })
    expect(resultat.ok).toBe(true)

    const ecrites = await prisma.timeEntry.findMany({
      where: { userId: session.id, lineId: ligneOuverte, date: new Date(`${date}T00:00:00.000Z`) },
      select: { kind: true },
    })
    expect(ecrites).toEqual([{ kind: 'PREVISIONNEL' }])
  })

  it('refuse un mois validé sans rien écrire', async () => {
    const date = `${month}-13`
    const resultat = await appliquerCase({
      lineId: ligneVerrouillee,
      date,
      state: { kind: 'JOURNEE' },
      month,
    })
    expect(resultat).toEqual({ ok: false, reason: 'VERROUILLE' })

    const ecrites = await prisma.timeEntry.count({
      where: { userId: session.id, lineId: ligneVerrouillee, date: new Date(`${date}T00:00:00.000Z`) },
    })
    expect(ecrites).toBe(0)
  })
})

/**
 * C3 — `saveCell` est la porte de la vue tableau. Elle dérive le `kind` de la
 * même horloge que `appliquerCase` : le réalisé est ce qui est attesté au
 * client et facturé, et la conversion du prévisionnel échu en réalisé n'est
 * jamais automatique dans ce produit. Un `kind` repris du client laisserait
 * n'importe quel appelant authentifié marquer « réalisé » un jour à venir et
 * court-circuiter `PastForecastNotice` / `validerJoursPasses`.
 */
describe('saveCell', () => {
  async function kindsEcrits(lineId: string, date: string): Promise<string[]> {
    const lignes = await prisma.timeEntry.findMany({
      where: { userId: session.id, lineId, date: new Date(`${date}T00:00:00.000Z`) },
      select: { kind: true },
    })
    return lignes.map((l) => l.kind)
  }

  it('écrit du réalisé sur un jour échu', async () => {
    const date = `${month}-14`
    const resultat = await saveCell({ lineId: ligneOuverte, date, raw: '1', month })
    expect(resultat.ok).toBe(true)
    expect(await kindsEcrits(ligneOuverte, date)).toEqual(['REALISE'])
  })

  it('écrit du prévisionnel sur un jour à venir même si le client réclame du réalisé', async () => {
    const date = `${moisCase}-15`
    // Un appelant forgé — `fetch` monté à la main, client modifié — peut
    // poster ce qu'il veut : l'action ne lit pas ce champ.
    const forge = { lineId: ligneOuverte, date, raw: '1', month: moisCase, kind: 'REALISE' }
    const resultat = await saveCell(forge)
    expect(resultat.ok).toBe(true)
    expect(await kindsEcrits(ligneOuverte, date)).toEqual(['PREVISIONNEL'])
  })

  // Tâche 12 — l'action est le seul fil entre la cellule et le service : un
  // `slotId` reçu mais non transmis écrirait silencieusement la journée
  // entière, et rien à l'écran ne le montrerait.
  it('écrit sur le créneau demandé', async () => {
    const date = `${moisCase}-17`
    const resultat = await saveCell({
      lineId: ligneOuverte,
      date,
      raw: '0,5',
      month: moisCase,
      slotId: 'matin',
    })
    expect(resultat.ok).toBe(true)

    const ecrites = await prisma.timeEntry.findMany({
      where: { userId: session.id, lineId: ligneOuverte, date: new Date(`${date}T00:00:00.000Z`) },
      select: { slotId: true, minutes: true },
    })
    expect(ecrites).toEqual([{ slotId: 'matin', minutes: 240 }])
  })

  it('remonte le signalement d un créneau non prévu, sans refuser la saisie', async () => {
    const { missionId } = await prisma.missionLine.findUniqueOrThrow({
      where: { id: ligneOuverte },
      select: { missionId: true },
    })
    const ligneNuit = (
      await createLine({
        missionId,
        userId: session.id,
        label: 'Nuit seulement',
        soldCentiemes: 3000,
        tjmCents: 0,
        allowedSlotIds: ['nuit'],
      })
    ).id

    const date = `${moisCase}-18`
    const resultat = await saveCell({
      lineId: ligneNuit,
      date,
      raw: '0,5',
      month: moisCase,
      slotId: 'matin',
    })

    expect(resultat.ok).toBe(true)
    if (resultat.ok) {
      expect(resultat.slotWarning).toEqual({ slotId: 'matin', allowedSlotIds: ['nuit'] })
    }
    expect(await prisma.timeEntry.count({ where: { userId: session.id, lineId: ligneNuit } })).toBe(
      1,
    )
  })

  it('refuse un mois validé sans rien écrire', async () => {
    const date = `${month}-16`
    const resultat = await saveCell({ lineId: ligneVerrouillee, date, raw: '1', month })
    expect(resultat).toEqual({ ok: false, reason: 'VERROUILLE' })
    expect(await kindsEcrits(ligneVerrouillee, date)).toEqual([])
  })
})

describe('remplirMois et viderMois', () => {
  it('remplit le mois puis le vide, et rend compte de ce qui a été fait', async () => {
    // Le mois est à l'usage exclusif de ce test : ce qu'on y compte ne peut
    // venir que du remplissage.
    await prisma.timeEntry.deleteMany({
      where: { userId: session.id, lineId: ligneOuverte, date: bornes(moisRemplissage) },
    })

    const rapport = await remplirMois({ lineId: ligneOuverte, month: moisRemplissage })
    expect(rapport.verrouille).toBe(false)
    expect(rapport.poses).toBeGreaterThan(0)

    // Le compte rendu n'est pas cru sur parole : il est confronté à la base.
    const ecrites = await prisma.timeEntry.count({
      where: { userId: session.id, lineId: ligneOuverte, date: bornes(moisRemplissage) },
    })
    expect(ecrites).toBe(rapport.poses)

    const vidage = await viderMois({ lineId: ligneOuverte, month: moisRemplissage })
    expect(vidage).toEqual({ supprimees: rapport.poses, verrouille: false })

    const restantes = await prisma.timeEntry.count({
      where: { userId: session.id, lineId: ligneOuverte, date: bornes(moisRemplissage) },
    })
    expect(restantes).toBe(0)
  })

  it('dit le verrou et laisse le mois validé intact', async () => {
    const avant = await prisma.timeEntry.count({
      where: { userId: session.id, lineId: ligneVerrouillee, date: bornes(month) },
    })
    expect(avant).toBeGreaterThan(0)

    expect(await remplirMois({ lineId: ligneVerrouillee, month })).toEqual({
      poses: 0,
      sautesCapacite: 0,
      dejaSaisis: 0,
      verrouille: true,
    })
    expect(await viderMois({ lineId: ligneVerrouillee, month })).toEqual({
      supprimees: 0,
      verrouille: true,
    })

    const apres = await prisma.timeEntry.count({
      where: { userId: session.id, lineId: ligneVerrouillee, date: bornes(month) },
    })
    expect(apres).toBe(avant)
  })
})

/**
 * Tâche 9 — le bouton « Générer le CRA » de la Saisie. Les deux actions
 * partagent la résolution ligne → mission (`resoudreMissionAffectee`, dans
 * `cra-generation.ts`), déjà éprouvée par les tests de `genererCra` : ici on
 * vérifie le branchement, pas la logique métier qu'il délègue.
 */
describe('compterPrevisionnelDeLaLigne', () => {
  // `moisCase` porte déjà le prévisionnel d'autres tests de ce fichier, sur la
  // même mission : on vérifie l'écart qu'une saisie de plus y ajoute, pas un
  // total qu'un autre test ferait varier.
  it('compte le prévisionnel de la mission derrière la ligne, sur le mois demandé', async () => {
    const avant = await compterPrevisionnelDeLaLigne({ lineId: ligneOuverte, month: moisCase })

    await prisma.timeEntry.create({
      data: {
        lineId: ligneOuverte,
        userId: session.id,
        date: new Date(`${moisCase}-20T00:00:00.000Z`),
        minutes: 240,
        kind: 'PREVISIONNEL',
      },
    })

    expect(await compterPrevisionnelDeLaLigne({ lineId: ligneOuverte, month: moisCase })).toBe(
      avant + 1,
    )
  })

  // Le client ne décide pas seul sur quelle mission on lit : une ligne à
  // laquelle l'utilisateur n'est pas affecté ne rend rien, comme `genererCra`
  // refuserait d'y écrire.
  it('ne compte rien pour une ligne à laquelle l utilisateur courant n est pas affecté', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-actions@test.local', name: 'Autre', passwordHash: 'x' },
    })
    const c = await createClient('ACTIONS autre client')
    const m = await createMission({ clientId: c.id, label: 'Mission autrui' })
    const ligneAutrui = (
      await createLine({
        missionId: m.id,
        userId: autre.id,
        label: 'Autrui',
        soldCentiemes: 3000,
        tjmCents: 0,
      })
    ).id
    await prisma.timeEntry.create({
      data: {
        lineId: ligneAutrui,
        userId: autre.id,
        date: new Date(`${moisCase}-21T00:00:00.000Z`),
        minutes: 480,
        kind: 'PREVISIONNEL',
      },
    })

    expect(await compterPrevisionnelDeLaLigne({ lineId: ligneAutrui, month: moisCase })).toBe(0)
  })
})

describe('genererCraAction', () => {
  const moisGeneration = moisDecale(3)

  it('traite le prévisionnel selon le choix, et ouvre le CRA', async () => {
    const date = `${moisGeneration}-05`
    await prisma.timeEntry.create({
      data: {
        lineId: ligneOuverte,
        userId: session.id,
        date: new Date(`${date}T00:00:00.000Z`),
        minutes: 480,
        kind: 'PREVISIONNEL',
      },
    })
    expect(await compterPrevisionnelDeLaLigne({ lineId: ligneOuverte, month: moisGeneration })).toBe(1)

    const resultat = await genererCraAction({
      lineId: ligneOuverte,
      month: moisGeneration,
      previsionnel: 'VALIDER',
    })

    expect(resultat.ok).toBe(true)
    if (resultat.ok) expect(resultat.previsionnelTraite).toBe(1)

    const ecrite = await prisma.timeEntry.findFirst({
      where: { userId: session.id, lineId: ligneOuverte, date: new Date(`${date}T00:00:00.000Z`) },
      select: { kind: true },
    })
    expect(ecrite?.kind).toBe('REALISE')
  })

  // M5 (le principe qui traverse tout le produit) : un mois déjà validé se
  // refuse, il ne se régénère pas en silence.
  it('refuse un mois déjà validé', async () => {
    const resultat = await genererCraAction({
      lineId: ligneVerrouillee,
      month,
      previsionnel: 'SUPPRIMER',
    })

    expect(resultat.ok).toBe(false)
    if (!resultat.ok) expect(resultat.raison).toBe('MOIS_VALIDE')
  })
})
