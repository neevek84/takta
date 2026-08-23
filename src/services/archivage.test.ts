import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine, listActiveLines, listMissionsForUser } from '@/services/missions'
import { listClients } from '@/services/clients'
import { DOLIBARR } from './dolibarr/api'
import { readAuditSince } from './audit'
import {
  LIEN_COMMANDE,
  LIEN_LIGNE,
  LIEN_MISSION,
  LIEN_PROPALE,
  LIEN_TEMPS,
  LIEN_TEMPS_REPRIS,
} from './dolibarr/liens'
import {
  archiverClient,
  archiverMission,
  archiverPrestation,
  impactSuppressionClient,
  impactSuppressionMission,
  impactSuppressionPrestation,
  supprimerClient,
  supprimerMission,
  supprimerPrestation,
} from './archivage'

let userId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'archivage@test.local', name: 'A', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'ARC' } } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'ARC' } } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          'archivage@test.local',
          'archivage-archive@test.local',
          'archivage-suppression@test.local',
          'archivage-voisin@test.local',
        ],
      },
    },
  })
  await prisma.$disconnect()
})

/**
 * Une mission complète : prestation, saisie, CRA validé, et les quatre natures
 * de correspondance Dolibarr qu'elle peut porter.
 */
async function decor() {
  const client = await createClient('ARC ACME')
  const mission = await createMission({ clientId: client.id, label: 'ARC Mission' })
  const ligne = await createLine({
    missionId: mission.id,
    userId,
    label: 'Cadrage',
    soldCentiemes: 500,
    tjmCents: 0,
  })
  const cra = await prisma.cra.create({
    data: {
      missionId: mission.id,
      userId,
      month: new Date('2026-07-01T00:00:00Z'),
      status: 'VALIDE',
    },
  })
  const saisie = await prisma.timeEntry.create({
    data: {
      lineId: ligne.id,
      userId,
      date: new Date('2026-07-15T00:00:00Z'),
      minutes: 420,
      kind: 'REALISE',
      slotId: '',
      startMinute: 540,
      endMinute: 960,
      minutesParJour: 420,
    },
  })

  const lien = (entityType: string, entityId: string, externalId: string) =>
    prisma.externalLink.create({
      data: { userId, entityType, entityId, provider: DOLIBARR, externalId, syncState: 'SYNCED' },
    })
  await lien(LIEN_MISSION, mission.id, '178')
  await lien(LIEN_LIGNE, ligne.id, '34')
  await lien(LIEN_TEMPS_REPRIS, saisie.id, '1000')
  await lien(LIEN_TEMPS, `${cra.id}|${ligne.id}|2026-07-15|`, '381')

  return { client, mission, ligne, cra, saisie }
}

describe('impactSuppressionMission', () => {
  // L'impact est montré **avant**, pas raconté après : une suppression ne se
  // rattrape pas, et un compte rendu a posteriori ne sert plus à rien.
  it('compte tout ce que la suppression emporterait', async () => {
    const d = await decor()

    expect(await impactSuppressionMission(d.mission.id)).toEqual({
      prestations: 1,
      saisies: 1,
      cras: 1,
      // Un CRA validé a été envoyé au client, parfois signé : il compte à part.
      crasValides: 1,
      correspondances: 4,
    })
  })

  it('rend un impact vide pour une mission qui n existe pas', async () => {
    const impact = await impactSuppressionMission('inexistante')
    expect(impact.prestations).toBe(0)
    expect(impact.correspondances).toBe(0)
  })
})

describe('archiverMission', () => {
  it('range et déserange, sans rien détruire', async () => {
    const d = await decor()

    await archiverMission(d.mission.id, true)
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: d.mission.id } })).archived).toBe(
      true,
    )
    expect(await prisma.timeEntry.count({ where: { lineId: d.ligne.id } })).toBe(1)

    await archiverMission(d.mission.id, false)
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: d.mission.id } })).archived).toBe(
      false,
    )
  })
})

describe('supprimerMission', () => {
  it('détruit la mission, son contenu, et rend ce qu elle a emporté', async () => {
    const d = await decor()

    const impact = await supprimerMission(d.mission.id)

    expect(impact.saisies).toBe(1)
    expect(await prisma.mission.count({ where: { id: d.mission.id } })).toBe(0)
    expect(await prisma.missionLine.count({ where: { id: d.ligne.id } })).toBe(0)
    expect(await prisma.timeEntry.count({ where: { id: d.saisie.id } })).toBe(0)
    expect(await prisma.cra.count({ where: { id: d.cra.id } })).toBe(0)
  })

  // `ExternalLink.entityId` est une chaîne nue, reliée à rien : la cascade de
  // la base ne l'emporte pas. Une correspondance survivante désignerait le
  // vide, et la prochaine entité à recevoir le même identifiant en hériterait.
  it('emporte les quatre natures de correspondance, que la base ne relie à rien', async () => {
    const d = await decor()

    await supprimerMission(d.mission.id)

    expect(await prisma.externalLink.count({ where: { provider: DOLIBARR } })).toBe(0)
  })

  // Une ligne de file qui vise un CRA détruit ne pourra jamais aboutir : elle
  // resterait à réessayer indéfiniment dans l'écran de supervision.
  it('vide la file de ce qui visait la mission détruite', async () => {
    const d = await decor()
    await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'Cra',
        entityId: d.cra.id,
        provider: DOLIBARR,
        operation: 'UPSERT',
        payloadJson: '{}',
        state: 'PENDING',
        nextAttemptAt: new Date(),
      },
    })

    await supprimerMission(d.mission.id)

    expect(await prisma.syncOutbox.count({ where: { entityId: d.cra.id } })).toBe(0)
  })

  it('laisse les autres missions du même client intactes', async () => {
    const d = await decor()
    const autre = await createMission({ clientId: d.client.id, label: 'ARC Autre' })

    await supprimerMission(d.mission.id)

    expect(await prisma.mission.count({ where: { id: autre.id } })).toBe(1)
    expect(await prisma.client.count({ where: { id: d.client.id } })).toBe(1)
  })
})

describe('la portée de l archivage', () => {
  // Ranger sans faire disparaître ne range rien.
  it('sort la mission archivée de la liste', async () => {
    const d = await decor()
    expect((await listMissionsForUser(userId)).some((m) => m.id === d.mission.id)).toBe(true)

    await archiverMission(d.mission.id, true)

    expect((await listMissionsForUser(userId)).some((m) => m.id === d.mission.id)).toBe(false)
  })

  // Un client rangé emmène ses missions : sans cela, elles resteraient dans la
  // liste sous un client qui n'y est plus.
  it('sort le client archivé et ses missions', async () => {
    const d = await decor()

    await archiverClient(d.client.id, true)

    expect((await listClients(userId)).some((c) => c.id === d.client.id)).toBe(false)
    expect((await listMissionsForUser(userId)).some((m) => m.id === d.mission.id)).toBe(false)
  })
})

describe('supprimerClient', () => {
  it('emporte ses missions, et le dit', async () => {
    const d = await decor()
    await createMission({ clientId: d.client.id, label: 'ARC Autre' })

    const attendu = await impactSuppressionClient(d.client.id)
    const impact = await supprimerClient(d.client.id)

    expect(impact).toEqual(attendu)
    expect(impact.saisies).toBe(1)
    expect(await prisma.client.count({ where: { id: d.client.id } })).toBe(0)
    expect(await prisma.mission.count({ where: { clientId: d.client.id } })).toBe(0)
    expect(await prisma.externalLink.count({ where: { provider: DOLIBARR } })).toBe(0)
  })

  it('range un client sans toucher à ses missions', async () => {
    const d = await decor()

    await archiverClient(d.client.id, true)

    expect((await prisma.client.findUniqueOrThrow({ where: { id: d.client.id } })).archived).toBe(
      true,
    )
    expect(await prisma.mission.count({ where: { clientId: d.client.id } })).toBe(1)
  })
})

/**
 * Une seconde prestation dans la même mission, avec sa saisie et sa
 * correspondance de tâche. Elle sert de témoin : supprimer une prestation ne
 * doit rien emporter de sa voisine.
 */
async function voisine(missionId: string, craId?: string) {
  const ligne = await createLine({
    missionId,
    userId,
    label: 'Voisine',
    soldCentiemes: 200,
    tjmCents: 0,
  })
  const saisie = await prisma.timeEntry.create({
    data: {
      lineId: ligne.id,
      userId,
      date: new Date('2026-07-16T00:00:00Z'),
      minutes: 420,
      kind: 'REALISE',
      slotId: '',
      startMinute: 540,
      endMinute: 960,
      minutesParJour: 420,
    },
  })
  await prisma.externalLink.create({
    data: {
      userId,
      entityType: LIEN_LIGNE,
      entityId: ligne.id,
      provider: DOLIBARR,
      externalId: '35',
      syncState: 'SYNCED',
    },
  })
  // Sa cellule poussée, quand le décor en fournit le CRA : les quatre parts de
  // `craId|lineId|jour|creneau` partagent le préfixe du CRA, et c'est la
  // deuxième qui distingue les deux prestations.
  if (craId !== undefined) {
    await prisma.externalLink.create({
      data: {
        userId,
        entityType: LIEN_TEMPS,
        entityId: `${craId}|${ligne.id}|2026-07-16|`,
        provider: DOLIBARR,
        externalId: '382',
        syncState: 'SYNCED',
      },
    })
  }
  return { ligne, saisie }
}

describe('impactSuppressionPrestation', () => {
  // Comme pour la mission : ce qu'une suppression emporte se montre **avant**.
  it('compte ce que la suppression de la prestation emporterait', async () => {
    const d = await decor()

    expect(await impactSuppressionPrestation(d.ligne.id)).toEqual({
      saisies: 1,
      // La saisie tombe dans un mois déjà validé : c'est une pièce comptable.
      saisiesValidees: 1,
      // Le CRA n'est PAS détruit — son contenu change, ce qui est pire à
      // taire : il a été envoyé au client, parfois signé.
      crasValides: 1,
      // La correspondance mission → projet n'est pas de la partie.
      correspondances: 3,
    })
  })

  it('compte aussi les engagements repris — propale et commande', async () => {
    const d = await decor()
    for (const [type, externe] of [
      [LIEN_PROPALE, '12:340'],
      [LIEN_COMMANDE, '13:341'],
    ] as const) {
      await prisma.externalLink.create({
        data: {
          userId,
          entityType: type,
          entityId: d.ligne.id,
          provider: DOLIBARR,
          externalId: externe,
          syncState: 'SYNCED',
        },
      })
    }

    expect((await impactSuppressionPrestation(d.ligne.id)).correspondances).toBe(5)
  })

  it('ne compte pas les saisies de la prestation voisine', async () => {
    const d = await decor()
    await voisine(d.mission.id)

    expect((await impactSuppressionPrestation(d.ligne.id)).saisies).toBe(1)
  })

  // Un mois en brouillon n'est pas une pièce comptable : le dire validé
  // ferait crier au loup à chaque suppression de brouillon.
  it('ne compte comme validé que ce qui l est', async () => {
    const d = await decor()
    await prisma.cra.update({ where: { id: d.cra.id }, data: { status: 'BROUILLON' } })

    const impact = await impactSuppressionPrestation(d.ligne.id)
    expect(impact.saisies).toBe(1)
    expect(impact.saisiesValidees).toBe(0)
    expect(impact.crasValides).toBe(0)
  })

  // Un CRA porte un mois : une saisie d'un autre mois n'y est pas.
  it('ne rattache pas une saisie au CRA validé d un autre mois', async () => {
    const d = await decor()
    await prisma.timeEntry.update({
      where: { id: d.saisie.id },
      data: { date: new Date('2026-08-15T00:00:00Z') },
    })

    expect((await impactSuppressionPrestation(d.ligne.id)).saisiesValidees).toBe(0)
  })

  // Un CRA appartient à un consultant. Rapprocher sur le seul mois
  // attribuerait à l'un le CRA validé de l'autre — et ferait crier au loup sur
  // une mission partagée.
  it('ne valide pas mes saisies avec le CRA validé d un autre consultant', async () => {
    const d = await decor()
    const autre = await prisma.user.create({
      data: {
        email: 'archivage-voisin@test.local',
        name: 'C',
        passwordHash: 'x',
        role: 'CONSULTANT',
      },
    })
    await prisma.cra.update({ where: { id: d.cra.id }, data: { userId: autre.id } })

    const impact = await impactSuppressionPrestation(d.ligne.id)
    expect(impact.saisies).toBe(1)
    expect(impact.saisiesValidees).toBe(0)
    expect(impact.crasValides).toBe(0)

    await prisma.cra.update({ where: { id: d.cra.id }, data: { userId } })
    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('rend un impact vide pour une prestation qui n existe pas', async () => {
    expect(await impactSuppressionPrestation('inexistante')).toEqual({
      saisies: 0,
      saisiesValidees: 0,
      crasValides: 0,
      correspondances: 0,
    })
  })
})

describe('archiverPrestation', () => {
  it('range et déserange, sans rien détruire', async () => {
    const d = await decor()

    expect(await archiverPrestation({ userId, lineId: d.ligne.id, archive: true })).toEqual({
      ok: true,
    })
    expect(
      (await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })).archived,
    ).toBe(true)
    expect(await prisma.timeEntry.count({ where: { lineId: d.ligne.id } })).toBe(1)

    expect(await archiverPrestation({ userId, lineId: d.ligne.id, archive: false })).toEqual({
      ok: true,
    })
    expect(
      (await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })).archived,
    ).toBe(false)
  })

  // Ranger sans faire disparaître ne range rien.
  it('sort la prestation archivée de la saisie et du détail de la mission', async () => {
    const d = await decor()
    expect((await listActiveLines(userId)).some((l) => l.id === d.ligne.id)).toBe(true)

    await archiverPrestation({ userId, lineId: d.ligne.id, archive: true })

    expect((await listActiveLines(userId)).some((l) => l.id === d.ligne.id)).toBe(false)
    const mission = (await listMissionsForUser(userId)).find((m) => m.id === d.mission.id)
    expect(mission?.lines.some((l) => l.id === d.ligne.id)).toBe(false)
  })

  // Même règle que `updateLine` : sans affectation, la prestation n'est pas la
  // sienne.
  it('refuse une prestation qui n est pas affectée, et n écrit rien', async () => {
    const d = await decor()
    const autre = await prisma.user.create({
      data: {
        email: 'archivage-archive@test.local',
        name: 'B',
        passwordHash: 'x',
        role: 'CONSULTANT',
      },
    })

    expect(
      await archiverPrestation({ userId: autre.id, lineId: d.ligne.id, archive: true }),
    ).toEqual({ ok: false, reason: 'NON_AFFECTE' })
    expect(
      (await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })).archived,
    ).toBe(false)

    await prisma.user.delete({ where: { id: autre.id } })
  })

  // Le verrou d'engagement porte sur les jours vendus et le TJM, pas sur le
  // rangement : une prestation reprise se range comme une autre.
  it('range une prestation dont l engagement vient de Dolibarr', async () => {
    const d = await decor()
    await prisma.missionLine.update({
      where: { id: d.ligne.id },
      data: { engagementSource: 'DOLIBARR_PROPALE' },
    })

    expect(await archiverPrestation({ userId, lineId: d.ligne.id, archive: true })).toEqual({
      ok: true,
    })
  })
})

describe('supprimerPrestation', () => {
  it('détruit la prestation, ses saisies et son affectation', async () => {
    const d = await decor()

    const r = await supprimerPrestation({ userId, lineId: d.ligne.id })

    expect(r.ok).toBe(true)
    expect(await prisma.missionLine.count({ where: { id: d.ligne.id } })).toBe(0)
    expect(await prisma.timeEntry.count({ where: { id: d.saisie.id } })).toBe(0)
    expect(await prisma.assignment.count({ where: { lineId: d.ligne.id } })).toBe(0)
  })

  // Supprimer une prestation n'est pas supprimer la mission : le CRA du mois
  // reste, son contenu change.
  it('laisse la mission, ses CRA et sa prestation voisine intacts', async () => {
    const d = await decor()
    const v = await voisine(d.mission.id)

    await supprimerPrestation({ userId, lineId: d.ligne.id })

    expect(await prisma.mission.count({ where: { id: d.mission.id } })).toBe(1)
    expect(await prisma.cra.count({ where: { id: d.cra.id } })).toBe(1)
    expect(await prisma.missionLine.count({ where: { id: v.ligne.id } })).toBe(1)
    expect(await prisma.timeEntry.count({ where: { id: v.saisie.id } })).toBe(1)
  })

  // `ExternalLink.entityId` est une chaîne nue, reliée à rien : la cascade de
  // la base ne l'emporte pas. Une correspondance survivante désignerait le
  // vide, et la prochaine prestation à recevoir le même identifiant en
  // hériterait.
  it('emporte les correspondances de la prestation, que la base ne relie à rien', async () => {
    const d = await decor()
    for (const [type, externe] of [
      [LIEN_PROPALE, '12:340'],
      [LIEN_COMMANDE, '13:341'],
    ] as const) {
      await prisma.externalLink.create({
        data: {
          userId,
          entityType: type,
          entityId: d.ligne.id,
          provider: DOLIBARR,
          externalId: externe,
          syncState: 'SYNCED',
        },
      })
    }
    const v = await voisine(d.mission.id, d.cra.id)

    await supprimerPrestation({ userId, lineId: d.ligne.id })

    expect(await prisma.externalLink.count({ where: { entityId: d.ligne.id } })).toBe(0)
    expect(await prisma.externalLink.count({ where: { entityId: d.saisie.id } })).toBe(0)
    // La cellule poussée : `craId|lineId|jour|creneau`, illisible autrement que
    // par préfixe.
    expect(
      await prisma.externalLink.count({
        where: { entityId: { startsWith: `${d.cra.id}|${d.ligne.id}|` } },
      }),
    ).toBe(0)
    // Et rien de ce qui n'était pas à elle : la mission garde son projet, la
    // voisine sa tâche **et sa cellule** — le CRA du mois survit, et ce qui a
    // été poussé pour les autres prestations reste retrouvable.
    expect(await prisma.externalLink.count({ where: { entityId: d.mission.id } })).toBe(1)
    expect(await prisma.externalLink.count({ where: { entityId: v.ligne.id } })).toBe(1)
    expect(
      await prisma.externalLink.count({
        where: { entityId: { startsWith: `${d.cra.id}|${v.ligne.id}|` } },
      }),
    ).toBe(1)
  })

  // Une ligne de file qui vise une saisie détruite ne pourra jamais aboutir :
  // elle resterait à réessayer indéfiniment dans l'écran de supervision.
  it('vide la file de ce qui visait les saisies détruites', async () => {
    const d = await decor()
    const v = await voisine(d.mission.id)
    for (const saisie of [d.saisie, v.saisie]) {
      await prisma.syncOutbox.create({
        data: {
          userId,
          entityType: 'TimeEntry',
          entityId: saisie.id,
          provider: DOLIBARR,
          operation: 'UPSERT',
          payloadJson: '{}',
          state: 'PENDING',
          nextAttemptAt: new Date(),
        },
      })
    }

    await supprimerPrestation({ userId, lineId: d.ligne.id })

    expect(await prisma.syncOutbox.count({ where: { entityId: d.saisie.id } })).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { entityId: v.saisie.id } })).toBe(1)
  })

  it('rend ce qu elle a emporté, compté avant destruction', async () => {
    const d = await decor()
    const attendu = await impactSuppressionPrestation(d.ligne.id)

    const r = await supprimerPrestation({ userId, lineId: d.ligne.id })

    expect(r).toEqual({ ok: true, impact: attendu })
  })

  /**
   * **La décision de conception.** Une prestation dont les saisies sont déjà
   * parties chez Dolibarr se supprime quand même — on compte, on ne refuse
   * pas. C'est ce que fait déjà la suppression d'une mission, qui emporte des
   * CRA validés après les avoir comptés. Refuser ici et accepter un niveau
   * au-dessus pousserait à supprimer la mission entière pour se débarrasser
   * d'une prestation : bien pire. Et rien n'est supprimé chez Dolibarr, où
   * l'historique reste.
   */
  it('ne refuse pas une prestation déjà poussée : elle la compte', async () => {
    const d = await decor()

    const r = await supprimerPrestation({ userId, lineId: d.ligne.id })

    expect(r).toEqual({
      ok: true,
      impact: { saisies: 1, saisiesValidees: 1, crasValides: 1, correspondances: 3 },
    })
    expect(await prisma.missionLine.count({ where: { id: d.ligne.id } })).toBe(0)
  })

  it('supprime une prestation dont l engagement vient de Dolibarr', async () => {
    const d = await decor()
    await prisma.missionLine.update({
      where: { id: d.ligne.id },
      data: { engagementSource: 'DOLIBARR_COMMANDE' },
    })

    expect((await supprimerPrestation({ userId, lineId: d.ligne.id })).ok).toBe(true)
    expect(await prisma.missionLine.count({ where: { id: d.ligne.id } })).toBe(0)
  })

  it('refuse une prestation qui n est pas affectée, et ne détruit rien', async () => {
    const d = await decor()
    const autre = await prisma.user.create({
      data: {
        email: 'archivage-suppression@test.local',
        name: 'B',
        passwordHash: 'x',
        role: 'CONSULTANT',
      },
    })

    expect(await supprimerPrestation({ userId: autre.id, lineId: d.ligne.id })).toEqual({
      ok: false,
      reason: 'NON_AFFECTE',
    })
    expect(await prisma.missionLine.count({ where: { id: d.ligne.id } })).toBe(1)
    expect(await prisma.timeEntry.count({ where: { id: d.saisie.id } })).toBe(1)

    await prisma.user.delete({ where: { id: autre.id } })
  })
})

/**
 * **Ce qui disparaît laisse une trace.**
 *
 * Le référentiel ne consignait que les créations. Une prestation et ses
 * saisies — jusqu'à des heures déjà poussées chez Dolibarr et figurant dans un
 * CRA validé — pouvaient s'effacer sans qu'aucun événement ne le dise. Le CRA,
 * lui, reste : son contenu ne concorde alors plus avec le document envoyé au
 * client, et c'est cette ligne de journal qui permettra un jour de l'expliquer.
 */
describe('le journal des suppressions', () => {
  /** Le dernier `seq`. `readAuditSince` plafonne, et le plafond ment vite. */
  async function derniereSeq(): Promise<number> {
    const tete = await prisma.auditEvent.findFirst({
      orderBy: { seq: 'desc' },
      select: { seq: true },
    })
    return tete?.seq ?? 0
  }

  it('CONSIGNE LA SUPPRESSION D UNE PRESTATION, et ce qu elle emportait', async () => {
    const d = await decor()
    const avant = await derniereSeq()

    await supprimerPrestation({ userId, lineId: d.ligne.id })

    const traces = await readAuditSince({ since: avant, action: 'prestation.supprimee' })
    expect(traces).toHaveLength(1)
    expect(traces[0]!.entityId).toBe(d.ligne.id)
    // Le libellé et la mission : après coup il ne reste qu'un identifiant, et
    // un journal qui ne nomme pas ce qui a disparu n'apprend rien.
    expect(traces[0]!.payload).toMatchObject({ libelle: 'Cadrage', mission: 'ARC Mission' })
    // Et le décompte de ce qui est parti : c'est la seule occasion de le savoir.
    expect((traces[0]!.payload as { saisies: number }).saisies).toBeGreaterThan(0)
  })

  it('CONSIGNE LA SUPPRESSION D UNE MISSION', async () => {
    const d = await decor()
    const avant = await derniereSeq()

    await supprimerMission(d.mission.id, userId)

    const traces = await readAuditSince({ since: avant, action: 'mission.supprimee' })
    expect(traces).toHaveLength(1)
    expect(traces[0]!.payload).toMatchObject({ libelle: 'ARC Mission', client: 'ARC ACME' })
  })

  it('CONSIGNE LA SUPPRESSION D UN CLIENT, et celle de chaque mission emportée', async () => {
    const d = await decor()
    const avant = await derniereSeq()

    await supprimerClient(d.client.id, userId)

    expect(await readAuditSince({ since: avant, action: 'client.supprime' })).toHaveLength(1)
    // Sans les traces de chaque mission, le journal dirait qu'un client a
    // disparu sans dire ce qu'il emportait.
    expect(await readAuditSince({ since: avant, action: 'mission.supprimee' })).toHaveLength(1)
  })

  // L'archivage est réversible et ne détruit rien : lui donner un événement
  // ferait grossir un catalogue que des intégrateurs doivent pouvoir lire.
  it('ne consigne pas un archivage, qui ne détruit rien', async () => {
    const d = await decor()
    const avant = await derniereSeq()

    await archiverMission(d.mission.id, true)
    await archiverPrestation({ userId, lineId: d.ligne.id, archive: true })

    expect(await readAuditSince({ since: avant })).toEqual([])
  })
})
