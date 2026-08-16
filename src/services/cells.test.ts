import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings, DEFAULT_SLOTS } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { getMonthEntries } from './time-entries'
import { applyCellState, isMonthLocked } from './cells'

// Un interrupteur pour rendre la file indisponible à la demande. C'est le seul
// moyen d'observer le sens « pas d'écriture sans mise en file » : les tests de
// refus ci-dessous prouvent l'autre sens (« pas de mise en file sans
// écriture »), et celui-là survit intact à une mise en file simplement
// déplacée *après* la transaction. Sans cet interrupteur, découpler les deux
// laisserait la suite entièrement verte — exactement l'angle mort relevé sur
// la tâche 6.
const file = vi.hoisted(() => ({ indisponible: false }))

vi.mock('@/services/sync/outbox', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./sync/outbox')>()
  return {
    ...reel,
    enqueueTimeEntry: async (...args: Parameters<typeof reel.enqueueTimeEntry>) => {
      if (file.indisponible) throw new Error('file indisponible')
      await reel.enqueueTimeEntry(...args)
    },
  }
})

let userId = ''
let autreId = ''
let missionId = ''
let ligneJour = ''
let ligneNuit = ''
let ligneAutre = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'cells@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'cells-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('CELLS client')
  const m = await createMission({ clientId: c.id, label: 'CELLS mission' })
  missionId = m.id

  ligneJour = (await createLine({
    missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000,
  })).id
  ligneNuit = (await createLine({
    missionId, userId, label: 'Nuit', soldCentiemes: 1000, tjmCents: 120000,
    allowedSlotIds: ['matin', 'apres-midi'],
  })).id
  ligneAutre = (await createLine({
    missionId, userId: autreId, label: 'Autre', soldCentiemes: 1000, tjmCents: 0,
  })).id
})

beforeEach(async () => {
  file.indisponible = false
  // La file n'a aucune clé étrangère sur `entityId` : elle survit à la saisie
  // qu'elle vise, et doit donc être purgée avant elle.
  await prisma.syncOutbox.deleteMany({})
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    capacityCentiemes: 100,
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    slots: DEFAULT_SLOTS,
    // Remises d'un test à l'autre comme le reste : plusieurs cas ci-dessous
    // déplacent la journée de travail pour éprouver le gel des heures.
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
  })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: ['cells@test.local', 'cells-autre@test.local'] } } })
  await prisma.client.deleteMany({ where: { name: 'CELLS client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function saisiesDu(lineId: string, date: string) {
  return prisma.timeEntry.findMany({
    where: { lineId, date: new Date(`${date}T00:00:00.000Z`) },
    orderBy: { slotId: 'asc' },
    select: { minutes: true, slotId: true, kind: true, minutesParJour: true, userId: true },
  })
}

describe('applyCellState', () => {
  it('pose une journée entière sur une case vide', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r.ok).toBe(true)
    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([
      { minutes: 480, slotId: '', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('remplace la journée par une demi-journée sans laisser de résidu', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })

    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([
      { minutes: 240, slotId: 'matin', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('vide la case sans rien laisser derrière', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'DEMI', slotId: 'apres-midi' } })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'VIDE' } })

    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([])
  })

  it('fige le facteur de conversion en vigueur à l écriture', async () => {
    await updateSettings({ minutesParJour: 420 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-03', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await saisiesDu(ligneJour, '2026-03-03')).toEqual([
      { minutes: 420, slotId: '', kind: 'REALISE', minutesParJour: 420, userId },
    ])
  })

  // Les heures se figent à l'écriture, exactement comme le facteur de
  // conversion — et le gel se casse **en lecture**, jamais en écriture : une
  // colonne intacte en base ne protège rien si un lecteur la recalcule. Les
  // deux chemins sont donc vérifiés : ce que la base porte, et ce que le
  // service en relit.
  it('fige les bornes de la journée de travail en vigueur à l écriture', async () => {
    await updateSettings({ journeeDebutMinute: 480, journeeFinMinute: 1020 })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-05', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })

    await updateSettings({ journeeDebutMinute: 600, journeeFinMinute: 1140 })

    const ecrite = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: ligneJour, date: new Date('2026-03-05T00:00:00.000Z') },
    })
    expect([ecrite.startMinute, ecrite.endMinute]).toEqual([480, 960])

    const [relue] = (await getMonthEntries(userId, '2026-03')).filter(
      (e) => e.date === '2026-03-05',
    )
    expect([relue!.startMinute, relue!.endMinute]).toEqual([480, 960])
  })

  it('fige les bornes du créneau en vigueur à l écriture', async () => {
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-06', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })

    // « Matin » est redéfini en administration : la saisie ne bouge pas.
    await updateSettings({
      slots: [
        { id: 'matin', label: 'Matin', startMinute: 300, endMinute: 480, centiemes: 50 },
        { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
      ],
    })

    const ecrite = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: ligneJour, date: new Date('2026-03-06T00:00:00.000Z') },
    })
    expect([ecrite.startMinute, ecrite.endMinute]).toEqual([540, 780])

    const [relue] = (await getMonthEntries(userId, '2026-03')).filter(
      (e) => e.date === '2026-03-06',
    )
    expect([relue!.startMinute, relue!.endMinute]).toEqual([540, 780])
  })

  // Le pendant du gel : une case **retouchée** est une écriture, et prend donc
  // les réglages du moment. Sans quoi le gel deviendrait un enfermement.
  it('réécrit les bornes quand la case est retouchée', async () => {
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-07', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })
    await updateSettings({
      slots: [
        { id: 'matin', label: 'Matin', startMinute: 300, endMinute: 480, centiemes: 50 },
        { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
      ],
    })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-07', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })

    const ecrite = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: ligneJour, date: new Date('2026-03-07T00:00:00.000Z') },
    })
    expect([ecrite.startMinute, ecrite.endMinute]).toEqual([300, 480])
  })

  it('écrit les bornes qu une saisie libre porte, franchissement de minuit compris', async () => {
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-08', kind: 'REALISE',
      state: {
        kind: 'LIBRE', minutes: 180, slotId: '', startMinute: 1320, endMinute: 60, eclatee: false,
      },
    })

    const ecrite = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: ligneJour, date: new Date('2026-03-08T00:00:00.000Z') },
    })
    expect([ecrite.startMinute, ecrite.endMinute, ecrite.minutes]).toEqual([1320, 60, 180])
  })

  it('écrit le prévisionnel quand on le lui demande', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-04', kind: 'PREVISIONNEL', state: { kind: 'JOURNEE' } })
    const [saisie] = await saisiesDu(ligneJour, '2026-03-04')
    expect(saisie!.kind).toBe('PREVISIONNEL')
  })

  it('refuse un mois dont le CRA est validé, sans rien écrire', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await applyCellState({ userId, lineId: ligneJour, date: '2026-03-05', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
    expect(await saisiesDu(ligneJour, '2026-03-05')).toEqual([])
  })

  it('ne détruit pas la case existante quand le mois se verrouille', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-06', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-06', kind: 'REALISE', state: { kind: 'VIDE' } })
    expect(await saisiesDu(ligneJour, '2026-03-06')).toHaveLength(1)
  })

  it('refuse en mode BLOCAGE et laisse la case intacte', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-09', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({ userId, lineId: ligneNuit, date: '2026-03-09', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'CAPACITE', totalCentiemes: 200, capacityCentiemes: 100 })
    expect(await saisiesDu(ligneNuit, '2026-03-09')).toEqual([])
  })

  it('signale sans bloquer en mode AVERTISSEMENT', async () => {
    await updateSettings({ capacityMode: 'AVERTISSEMENT', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-10', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({ userId, lineId: ligneNuit, date: '2026-03-10', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r.ok).toBe(true)
    expect(r.ok && r.warning).toEqual({ totalCentiemes: 200, capacityCentiemes: 100 })
    expect(await saisiesDu(ligneNuit, '2026-03-10')).toHaveLength(1)
  })

  // La case qu'on remplace ne doit jamais se compter elle-même : corriger une
  // journée en demi-journée ferait sinon 1,5 j et se ferait refuser.
  it('ne compte pas la case remplacée dans le total du jour', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-11', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-11', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })
    expect(r.ok).toBe(true)
  })

  // Tâche 12 — la capacité se contrôle en centièmes de jour. Une saisie déjà
  // écrite porte son facteur figé (lot 1d) : changer le réglage global ne doit
  // pas la faire recompter autrement, sans quoi un CRA validé changerait de
  // calcul.
  it('compte une saisie existante à son facteur figé, pas au réglage du jour', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100, minutesParJour: 600 })
    // 300 minutes figées à 600, soit une demi-journée pour toujours.
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-23', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })

    await updateSettings({ minutesParJour: 420 })
    // 210 minutes à 420, soit l'autre demi-journée : 0,50 + 0,50 = 1,00 j.
    // Comparées en minutes (510 min contre un seuil converti à 420), les deux
    // demi-journées se faisaient refuser.
    const r = await applyCellState({
      userId, lineId: ligneNuit, date: '2026-03-23', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })
    expect(r.ok).toBe(true)
    expect(await saisiesDu(ligneNuit, '2026-03-23')).toEqual([
      { minutes: 210, slotId: 'matin', kind: 'REALISE', minutesParJour: 420, userId },
    ])
  })

  // I6 (revue adversariale lot 1b) — les 33 tests précédents ne réglaient le
  // facteur que par `updateSettings` : la cascade prestation → mission →
  // client valait toujours le réglage global, donc écrire `settings.minutesParJour`
  // au lieu du facteur résolu par la cascade serait passé inaperçu. Ici la
  // prestation surcharge le facteur (420) alors que le réglage global reste à
  // 480 (posé par `beforeEach`) : les deux valeurs se distinguent réellement.
  it('fige le facteur résolu par la cascade prestation → mission → client, pas le réglage global', async () => {
    const ligneSurchargee = (await createLine({
      missionId, userId, label: 'Surchargée', soldCentiemes: 1000, tjmCents: 50000,
      minutesParJour: 420,
    })).id

    const r = await applyCellState({
      userId, lineId: ligneSurchargee, date: '2026-03-29', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r.ok).toBe(true)
    expect(await saisiesDu(ligneSurchargee, '2026-03-29')).toEqual([
      { minutes: 420, slotId: '', kind: 'REALISE', minutesParJour: 420, userId },
    ])

    // Le réglage global change ensuite : la saisie déjà écrite ne doit pas
    // suivre — c'est le gel exigé par le commanditaire (« si changement du
    // nombre d'heures IL NE FAUT SURTOUT PAS QUE LES CRA VALIDÉS CHANGENT DE
    // CALCUL »).
    await updateSettings({ minutesParJour: 600 })
    expect(await saisiesDu(ligneSurchargee, '2026-03-29')).toEqual([
      { minutes: 420, slotId: '', kind: 'REALISE', minutesParJour: 420, userId },
    ])
  })

  // Le gel porte sur l'**écriture**, pas sur l'identifiant : depuis que la case
  // retouchée conserve sa saisie, celle-ci est *mise à jour* et doit donc
  // refiger le facteur du moment, comme le fait `saveEntry`. L'oublier
  // laisserait une saisie de 600 minutes marquée `minutesParJour: 480` — une
  // journée entière qui se relit en 1,25 j et se réaffiche en saisie libre.
  // Les deux moitiés de la règle tiennent ici : ce que personne ne retouche ne
  // bouge pas, ce qu'on retouche refige.
  it('refige le facteur quand elle met à jour une saisie, sans toucher à celle que personne ne retouche', async () => {
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-14', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-15', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })

    await updateSettings({ minutesParJour: 600 })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-15', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })

    // Retouchée : la saisie survit sous son identifiant, mais refige le facteur
    // du moment — minutes et facteur restent cohérents entre eux.
    expect(await saisiesDu(ligneJour, '2026-03-15')).toEqual([
      { minutes: 600, slotId: '', kind: 'REALISE', minutesParJour: 600, userId },
    ])
    // Jamais retouchée : rien n'a bougé, réglage global changé ou non.
    expect(await saisiesDu(ligneJour, '2026-03-14')).toEqual([
      { minutes: 480, slotId: '', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('refuse un dépassement réel malgré des facteurs différents dans la journée', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100, minutesParJour: 420 })
    // Une journée pleine figée à 420 : 1,00 j.
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-24', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })

    await updateSettings({ minutesParJour: 600 })
    // Une demi-journée à 600 par-dessus : 1,50 j au total.
    const r = await applyCellState({
      userId, lineId: ligneNuit, date: '2026-03-24', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })
    expect(r).toEqual({ ok: false, reason: 'CAPACITE', totalCentiemes: 150, capacityCentiemes: 100 })
    expect(await saisiesDu(ligneNuit, '2026-03-24')).toEqual([])
  })

  // Lot 0 : `allowedSlotIds` devient enfin applicable. Un créneau non autorisé
  // déclenche un signalement, pas un refus.
  it('signale un créneau non autorisé sans refuser la saisie', async () => {
    const r = await applyCellState({
      userId, lineId: ligneNuit, date: '2026-03-12', kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 180, slotId: 'nuit', startMinute: 1320, endMinute: 60, eclatee: false },
    })

    expect(r.ok).toBe(true)
    expect(r.ok && r.signalement).toContain('Nuit')
    expect(await saisiesDu(ligneNuit, '2026-03-12')).toEqual([
      { minutes: 180, slotId: 'nuit', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('ne signale rien quand la prestation ne restreint aucun créneau', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-13', kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 180, slotId: 'nuit', startMinute: 1320, endMinute: 60, eclatee: false },
    })
    expect(r.ok && r.signalement).toBeUndefined()
  })

  it('refuse un créneau inconnu des réglages', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-16', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'inexistant' },
    })
    expect(r).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
  })

  it('refuse une durée libre aberrante venue du client', async () => {
    for (const minutes of [0, -30, 1441, 12.5]) {
      const r = await applyCellState({
        userId, lineId: ligneJour, date: '2026-03-17', kind: 'REALISE',
        state: { kind: 'LIBRE', minutes, slotId: '', startMinute: 540, endMinute: 720, eclatee: false },
      })
      expect(r).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
    }
    expect(await saisiesDu(ligneJour, '2026-03-17')).toEqual([])
  })

  it('refuse une prestation à laquelle l utilisateur n est pas affecté', async () => {
    const r = await applyCellState({ userId, lineId: ligneAutre, date: '2026-03-18', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'NON_AFFECTE' })
  })

  // Même prestation, même jour, deux utilisateurs : c'est là que le scope se
  // vérifie vraiment, une suppression par (lineId, date) sans userId emporterait
  // la saisie du voisin.
  it('n efface jamais la case d un autre utilisateur sur la même prestation', async () => {
    await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId: autreId, date: new Date('2026-03-19T00:00:00.000Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480, slotId: '',
      },
    })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-19', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-19', kind: 'REALISE', state: { kind: 'VIDE' } })

    const restantes = await saisiesDu(ligneJour, '2026-03-19')
    expect(restantes).toHaveLength(1)
    expect(restantes[0]!.userId).toBe(autreId)
  })

  it('rend la case relisible par getMonthEntries', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-20', kind: 'REALISE', state: { kind: 'DEMI', slotId: 'apres-midi' } })
    const entries = await getMonthEntries(userId, '2026-03')
    expect(entries).toContainEqual(
      expect.objectContaining({ date: '2026-03-20', minutes: 240, slotId: 'apres-midi' }),
    )
  })

  // I4 — le total du jour qui alimente le contrôle de capacité doit être
  // scopé par userId : sans ce scope, la journée pleine d'un autre
  // utilisateur, sur une prestation qui lui est propre, se compterait dans
  // la capacité de celui-ci et le ferait refuser à tort en mode BLOCAGE.
  it('ne compte pas la saisie d un autre utilisateur dans la capacité du jour', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    const r1 = await applyCellState({
      userId: autreId, lineId: ligneAutre, date: '2026-03-21', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r1.ok).toBe(true)

    const r2 = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-21', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r2.ok).toBe(true)
    expect(await saisiesDu(ligneJour, '2026-03-21')).toEqual([
      { minutes: 480, slotId: '', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })
})

// Tâche 13 — `applyCellState` est le chemin d'écriture de la vue calendrier :
// celle qui s'affiche par défaut, et la seule disponible sous la largeur `md`.
// Une saisie qui n'entre pas en file ne partira jamais vers l'agenda, et rien
// ne le dira.
describe('applyCellState et la file de synchronisation', () => {
  async function file_(pourUserId: string) {
    const lignes = await prisma.syncOutbox.findMany({
      where: { userId: pourUserId },
      orderBy: [{ operation: 'asc' }, { entityId: 'asc' }],
    })
    return lignes.map((l) => ({
      entityType: l.entityType,
      entityId: l.entityId,
      provider: l.provider,
      operation: l.operation,
      state: l.state,
    }))
  }

  function cible(entityId: string, operation: 'UPSERT' | 'DELETE') {
    return { entityType: 'TimeEntry', entityId, provider: 'GOOGLE', operation, state: 'PENDING' }
  }

  it('met en file la saisie qu elle écrit', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r.ok).toBe(true)

    const ecrite = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: ligneJour } })
    expect(await file_(userId)).toEqual([cible(ecrite.id, 'UPSERT')])
  })

  // Le remplacement en bloc détruit puis récrit : la saisie emportée porte un
  // autre identifiant que celle qui la remplace, et son bloc d'agenda ne
  // disparaîtra que si sa suppression entre elle aussi en file.
  it('met en file la suppression que le remplacement emporte', async () => {
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    const avant = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: ligneJour } })
    await prisma.syncOutbox.deleteMany({})

    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })
    const apres = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: ligneJour } })
    expect(apres.id).not.toBe(avant.id)

    const lignes = await file_(userId)
    expect(lignes).toHaveLength(2)
    expect(lignes).toContainEqual(cible(avant.id, 'DELETE'))
    expect(lignes).toContainEqual(cible(apres.id, 'UPSERT'))
  })

  // Une journée éclatée en créneaux (saisie au tableau) emporte plusieurs
  // saisies d'un coup : chacune tient sa propre place dans l'agenda, donc
  // chacune sa propre ligne en file.
  it('met en file une suppression par saisie emportée quand la case est vidée', async () => {
    const matin = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId, date: new Date('2026-03-25T00:00:00.000Z'),
        minutes: 240, kind: 'REALISE', minutesParJour: 480, slotId: 'matin', startMinute: 540, endMinute: 780,
      },
    })
    const apresMidi = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId, date: new Date('2026-03-25T00:00:00.000Z'),
        minutes: 240, kind: 'REALISE', minutesParJour: 480, slotId: 'apres-midi', startMinute: 840, endMinute: 1080,
      },
    })

    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-25', kind: 'REALISE', state: { kind: 'VIDE' },
    })
    expect(r.ok).toBe(true)

    const lignes = await file_(userId)
    expect(lignes).toHaveLength(2)
    expect(lignes).toContainEqual(cible(matin.id, 'DELETE'))
    expect(lignes).toContainEqual(cible(apresMidi.id, 'DELETE'))
  })

  // Pas de mise en file sans écriture : un mois validé ne pousse rien.
  it('ne met rien en file quand le mois est verrouillé', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-05', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
    expect(await file_(userId)).toEqual([])
  })

  it('ne met rien en file quand la capacité refuse', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-09', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    await prisma.syncOutbox.deleteMany({})

    const r = await applyCellState({
      userId, lineId: ligneNuit, date: '2026-03-09', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r.ok).toBe(false)
    expect(await file_(userId)).toEqual([])
  })

  it('ne met rien en file pour une prestation non affectée ni pour une saisie invalide', async () => {
    await applyCellState({
      userId, lineId: ligneAutre, date: '2026-03-18', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-17', kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 0, slotId: '', startMinute: 540, endMinute: 540, eclatee: false },
    })

    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  // Le scope de la file est celui de l'écriture, sinon rien : la saisie d'un
  // autre utilisateur sur la même prestation et le même jour n'est ni
  // supprimée (test plus haut) ni, donc, mise en file — la pousser reviendrait
  // à effacer un bloc de l'agenda de quelqu'un d'autre.
  it('ne met jamais en file la saisie d un autre utilisateur sur la même case', async () => {
    const voisine = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId: autreId, date: new Date('2026-03-28T00:00:00.000Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480, slotId: '',
      },
    })

    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-28', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })

    const lignes = await prisma.syncOutbox.findMany({})
    expect(lignes.map((l) => l.entityId)).not.toContain(voisine.id)
    expect(lignes.every((l) => l.userId === userId)).toBe(true)
  })

  // Arbitrage du porteur (suite de l'inquiétude 1 de la tâche 13) : une case
  // retouchée ne doit **pas** faire tourner l'identifiant de sa saisie, sans
  // quoi l'événement de l'agenda est supprimé puis recréé à chaque correction
  // — et dix corrections laissent dix lignes en file là où `saveEntry` n'en
  // laisse qu'une, la file dédoublonnant par (entityType, entityId, provider).
  it('garde le même identifiant et une seule ligne en file après dix retouches de la même case', async () => {
    let premierId = ''
    for (let i = 1; i <= 10; i++) {
      const r = await applyCellState({
        userId, lineId: ligneJour, date: '2026-03-30', kind: 'REALISE',
        state: { kind: 'LIBRE', minutes: 60 * i, slotId: 'matin', startMinute: 540, endMinute: 540 + 60 * i, eclatee: false },
      })
      expect(r.ok).toBe(true)

      const saisies = await prisma.timeEntry.findMany({
        where: { userId, lineId: ligneJour, date: new Date('2026-03-30T00:00:00.000Z') },
      })
      expect(saisies).toHaveLength(1)
      if (i === 1) premierId = saisies[0]!.id
      // L'identifiant est vérifié à **chaque** tour : le constater seulement à
      // la fin laisserait passer une rotation qui reviendrait par hasard.
      expect(saisies[0]!.id).toBe(premierId)
      expect(saisies[0]!.minutes).toBe(60 * i)
    }

    expect(await file_(userId)).toEqual([cible(premierId, 'UPSERT')])
  })

  // Ce qui doit continuer de disparaître : la cible qui n'existe plus. Deux
  // créneaux ramenés à une journée entière, c'est un changement de forme —
  // les deux saisies partent pour de bon, avec leurs deux blocs d'agenda.
  it('supprime réellement les saisies dont la cible disparaît lors d un changement de forme', async () => {
    const matin = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId, date: new Date('2026-03-31T00:00:00.000Z'),
        minutes: 240, kind: 'REALISE', minutesParJour: 480, slotId: 'matin', startMinute: 540, endMinute: 780,
      },
    })
    const apresMidi = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId, date: new Date('2026-03-31T00:00:00.000Z'),
        minutes: 240, kind: 'REALISE', minutesParJour: 480, slotId: 'apres-midi', startMinute: 840, endMinute: 1080,
      },
    })

    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-31', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r.ok).toBe(true)

    const restantes = await prisma.timeEntry.findMany({
      where: { userId, lineId: ligneJour, date: new Date('2026-03-31T00:00:00.000Z') },
    })
    expect(restantes).toHaveLength(1)
    expect(restantes[0]!.slotId).toBe('')
    expect([matin.id, apresMidi.id]).not.toContain(restantes[0]!.id)

    const lignes = await file_(userId)
    expect(lignes).toHaveLength(3)
    expect(lignes).toContainEqual(cible(matin.id, 'DELETE'))
    expect(lignes).toContainEqual(cible(apresMidi.id, 'DELETE'))
    expect(lignes).toContainEqual(cible(restantes[0]!.id, 'UPSERT'))
  })

  // Le cas mixte, celui qui départage vraiment les deux règles : sur la même
  // case, une saisie dont la cible survit et une dont la cible disparaît.
  it('met à jour la saisie dont la cible survit tout en supprimant l autre', async () => {
    const matin = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId, date: new Date('2026-04-01T00:00:00.000Z'),
        minutes: 120, kind: 'PREVISIONNEL', minutesParJour: 480, slotId: 'matin', startMinute: 540, endMinute: 780,
      },
    })
    const apresMidi = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId, date: new Date('2026-04-01T00:00:00.000Z'),
        minutes: 240, kind: 'REALISE', minutesParJour: 480, slotId: 'apres-midi', startMinute: 840, endMinute: 1080,
      },
    })

    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-04-01', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })
    expect(r.ok).toBe(true)

    expect(await saisiesDu(ligneJour, '2026-04-01')).toEqual([
      { minutes: 240, slotId: 'matin', kind: 'REALISE', minutesParJour: 480, userId },
    ])
    const restantes = await prisma.timeEntry.findMany({
      where: { userId, lineId: ligneJour, date: new Date('2026-04-01T00:00:00.000Z') },
    })
    expect(restantes.map((e) => e.id)).toEqual([matin.id])

    const lignes = await file_(userId)
    expect(lignes).toHaveLength(2)
    expect(lignes).toContainEqual(cible(apresMidi.id, 'DELETE'))
    expect(lignes).toContainEqual(cible(matin.id, 'UPSERT'))
  })

  // Pas d'écriture sans mise en file — le sens que seule la file indisponible
  // révèle, et le seul qui tombe quand la mise en file sort de la transaction.
  it('une mise en file en échec annule l écriture de la case', async () => {
    file.indisponible = true

    await expect(
      applyCellState({
        userId, lineId: ligneJour, date: '2026-03-26', kind: 'REALISE', state: { kind: 'JOURNEE' },
      }),
    ).rejects.toThrow(/file indisponible/)

    expect(await saisiesDu(ligneJour, '2026-03-26')).toEqual([])
    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  // La mise à jour est un chemin d'écriture à part entière, et son annulation
  // ne se déduit pas de celle d'une création : les deux tests voisins ne
  // couvrent que des saisies *créées*. Ici la saisie préexiste et c'est sa
  // valeur qui doit revenir en arrière.
  it('une mise en file en échec annule la mise à jour de la saisie qu elle accompagne', async () => {
    const avant = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId, date: new Date('2026-04-02T00:00:00.000Z'),
        minutes: 120, kind: 'PREVISIONNEL', minutesParJour: 480, slotId: 'matin', startMinute: 540, endMinute: 780,
      },
    })
    file.indisponible = true

    await expect(
      applyCellState({
        userId, lineId: ligneJour, date: '2026-04-02', kind: 'REALISE',
        state: { kind: 'DEMI', slotId: 'matin' },
      }),
    ).rejects.toThrow(/file indisponible/)

    const restantes = await prisma.timeEntry.findMany({
      where: { lineId: ligneJour, date: new Date('2026-04-02T00:00:00.000Z') },
    })
    expect(restantes).toHaveLength(1)
    expect(restantes[0]!.id).toBe(avant.id)
    expect(restantes[0]!.minutes).toBe(120)
    expect(restantes[0]!.kind).toBe('PREVISIONNEL')
    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it('une mise en file en échec annule la suppression que le remplacement avait commencée', async () => {
    const avant = await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId, date: new Date('2026-03-27T00:00:00.000Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480, slotId: '',
      },
    })
    file.indisponible = true

    await expect(
      applyCellState({
        userId, lineId: ligneJour, date: '2026-03-27', kind: 'REALISE',
        state: { kind: 'DEMI', slotId: 'matin' },
      }),
    ).rejects.toThrow(/file indisponible/)

    const restantes = await prisma.timeEntry.findMany({
      where: { lineId: ligneJour, date: new Date('2026-03-27T00:00:00.000Z') },
    })
    expect(restantes.map((e) => e.id)).toEqual([avant.id])
    expect(await prisma.syncOutbox.count()).toBe(0)
  })
})

describe('isMonthLocked', () => {
  it('rend faux sans CRA', async () => {
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(false)
  })

  it('rend faux sur un CRA en brouillon', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'BROUILLON' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(false)
  })

  it('rend vrai sur un CRA validé', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(true)
  })

  it('ne voit pas le verrou d un autre mois', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-04')).toBe(false)
  })
})
