import { describe, it, expect } from 'vitest'
import { buildInvoiceDraft } from '@/core/dolibarr/invoice'
import { buildTimeSpentPayloads, type PushableEntry } from '@/core/dolibarr/timespent'
import {
  DolibarrMappingError,
  DolibarrRequestError,
  DolibarrUnavailableError,
} from './api'
import { FakeDolibarr } from './fake'

describe('double de l API Dolibarr', () => {
  it('crée une tâche et la retrouve', async () => {
    const api = new FakeDolibarr()
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: 1 })
    const t = await api.createTask({ projectId: projet.id, label: 'Développement' })

    expect(await api.listTasks(projet.id)).toEqual([t])
  })

  it('enregistre et met à jour un temps passé', async () => {
    const api = new FakeDolibarr()
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: 1 })
    const t = await api.createTask({ projectId: projet.id, label: 'Dev' })

    const { timespentId } = await api.addTimeSpent({
      taskId: t.id,
      dolibarrUserId: 7,
      date: '2026-05-04',
      durationSeconds: 28_800,
      note: '',
    })
    await api.updateTimeSpent({
      taskId: t.id,
      timespentId,
      date: '2026-05-04',
      durationSeconds: 14_400,
      note: '',
    })

    expect(api.timespents).toHaveLength(1)
    expect(api.timespents[0]!.durationSeconds).toBe(14_400)
    expect(api.appels).toMatchObject({ createTask: 1, addTimeSpent: 1, updateTimeSpent: 1 })
  })

  it('simule une panne sur tous les appels', async () => {
    const api = new FakeDolibarr()
    api.panne = true
    await expect(api.listProjects()).rejects.toThrow(DolibarrUnavailableError)
    await expect(api.createThirdparty('X')).rejects.toThrow(DolibarrUnavailableError)
  })

  it('ne rend que les projets facturables au temps', async () => {
    const api = new FakeDolibarr()
    api.seedProject({ ref: 'PJ001', title: 'Facturable', socid: 1 })
    api.seedProject({ ref: 'PJ002', title: 'Interne', socid: 1, usageBillTime: false })

    expect((await api.listProjects()).map((p) => p.ref)).toEqual(['PJ001'])
  })

  it('rend les constantes de configuration semées', async () => {
    const api = new FakeDolibarr()
    api.setup.TIMESHEET_DAY_DURATION = '7'
    expect(await api.getSetupValue('TIMESHEET_DAY_DURATION')).toBe('7')
    expect(await api.getSetupValue('INCONNUE')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Un double complaisant valide un connecteur qui ne marcherait pas. Le double
// Google a dû être durci deux fois pour cette raison ; celui-ci refuse d'emblée
// ce qu'une instance refuserait, et chaque refus est non rejouable — rejouer
// une requête que Dolibarr n'acceptera jamais encombre la file sans aboutir.
// ---------------------------------------------------------------------------

describe('double de l API Dolibarr — ce qu il refuse', () => {
  it('refuse un tiers sans nom', async () => {
    const api = new FakeDolibarr()
    await expect(api.createThirdparty('  ')).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse une tâche sur un projet inconnu', async () => {
    const api = new FakeDolibarr()
    await expect(api.createTask({ projectId: 4242, label: 'Dev' })).rejects.toThrow(
      DolibarrRequestError,
    )
  })

  it('refuse une tâche sans libellé', async () => {
    const api = new FakeDolibarr()
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: 1 })
    await expect(api.createTask({ projectId: projet.id, label: '' })).rejects.toThrow(
      DolibarrRequestError,
    )
  })

  it('refuse de lister les tâches d un projet inconnu', async () => {
    const api = new FakeDolibarr()
    await expect(api.listTasks(4242)).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse un temps passé sur une tâche inconnue', async () => {
    const api = new FakeDolibarr()
    await expect(
      api.addTimeSpent({
        taskId: 4242,
        dolibarrUserId: 7,
        date: '2026-05-04',
        durationSeconds: 3600,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse une date qui n est pas au format de Dolibarr', async () => {
    const api = new FakeDolibarr()
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: 1 })
    const t = await api.createTask({ projectId: projet.id, label: 'Dev' })

    await expect(
      api.addTimeSpent({
        taskId: t.id,
        dolibarrUserId: 7,
        date: '04/05/2026',
        durationSeconds: 3600,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
    expect(api.timespents).toHaveLength(0)
  })

  it('refuse une durée qui n est pas un nombre entier de secondes', async () => {
    // `llx_projet_task_time.task_duration` est un entier de secondes : une
    // durée fractionnaire trahit une conversion oubliée en amont.
    const api = new FakeDolibarr()
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: 1 })
    const t = await api.createTask({ projectId: projet.id, label: 'Dev' })

    for (const durationSeconds of [0, -60, 90.5]) {
      await expect(
        api.addTimeSpent({
          taskId: t.id,
          dolibarrUserId: 7,
          date: '2026-05-04',
          durationSeconds,
          note: '',
        }),
      ).rejects.toThrow(DolibarrRequestError)
    }
    expect(api.timespents).toHaveLength(0)
  })

  it('refuse un temps passé sans utilisateur Dolibarr', async () => {
    const api = new FakeDolibarr()
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: 1 })
    const t = await api.createTask({ projectId: projet.id, label: 'Dev' })

    await expect(
      api.addTimeSpent({
        taskId: t.id,
        dolibarrUserId: 0,
        date: '2026-05-04',
        durationSeconds: 3600,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse la mise à jour d un temps passé introuvable, sans inviter à rejouer', async () => {
    const api = new FakeDolibarr()
    await expect(
      api.updateTimeSpent({
        taskId: 1,
        timespentId: 999,
        date: '2026-05-04',
        durationSeconds: 3600,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('accepte la suppression d un temps passé déjà absent', async () => {
    // L'état visé est atteint : lever ici bloquerait la file sur une cible
    // déjà conforme. C'est le pendant du 404 toléré côté HTTP.
    const api = new FakeDolibarr()
    await expect(api.deleteTimeSpent({ taskId: 1, timespentId: 999 })).resolves.toBeUndefined()
    expect(api.appels.deleteTimeSpent).toBe(1)
  })

  it('refuse une propale introuvable, sans inviter à rejouer', async () => {
    const api = new FakeDolibarr()
    await expect(api.getProposal(999)).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse une facture sur un tiers inconnu', async () => {
    const api = new FakeDolibarr()
    await expect(
      api.createDraftInvoice({
        socid: 4242,
        lines: [{ label: 'Développement', qteCentiemes: 2000, subpriceCents: 80_000 }],
      }),
    ).rejects.toThrow(DolibarrRequestError)
    expect(api.invoices).toHaveLength(0)
  })

  it('refuse une ligne de facture dont les entiers ne sont pas entiers', async () => {
    const api = new FakeDolibarr()
    const tiers = api.seedThirdparty('ACME')

    await expect(
      api.createDraftInvoice({
        socid: tiers.id,
        lines: [{ label: 'Dev', qteCentiemes: 20.5, subpriceCents: 80_000 }],
      }),
    ).rejects.toThrow(DolibarrRequestError)
    await expect(
      api.createDraftInvoice({
        socid: tiers.id,
        lines: [{ label: 'Dev', qteCentiemes: 2000, subpriceCents: 800.5 }],
      }),
    ).rejects.toThrow(DolibarrRequestError)
    await expect(
      api.createDraftInvoice({
        socid: tiers.id,
        lines: [{ label: '', qteCentiemes: 2000, subpriceCents: 80_000 }],
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('n enregistre jamais qu un brouillon', async () => {
    const api = new FakeDolibarr()
    const tiers = api.seedThirdparty('ACME')
    const { id, ref } = await api.createDraftInvoice({
      socid: tiers.id,
      lines: [{ label: 'Développement', qteCentiemes: 2000, subpriceCents: 80_000 }],
    })

    expect(ref).toBe(`(PROV${id})`)
    expect(api.invoices[0]!.status).toBe(0)
    expect(api.invoices[0]!.lines).toEqual([{ label: 'Développement', qty: 20, subprice: 800 }])
  })

  it('nomme ses erreurs, pour que les journaux les distinguent', () => {
    expect(new DolibarrUnavailableError('x').name).toBe('DolibarrUnavailableError')
    expect(new DolibarrRequestError('x').name).toBe('DolibarrRequestError')
    expect(new DolibarrMappingError('x').name).toBe('DolibarrMappingError')
    expect(new DolibarrMappingError('x')).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// Garde-fou inverse. Un double trop sévère est un mensonge dans l'autre sens :
// il ferait échouer un connecteur correct. Ce bloc lui présente la charge utile
// réellement produite par le domaine — celle des tâches 1 et 2, journée réglée
// à 7 heures comme chez le porteur — et exige qu'il l'accepte telle quelle.
// ---------------------------------------------------------------------------

/** 7 h par jour : le réglage du Dolibarr du porteur, pas le défaut local. */
const MINUTES_PAR_JOUR = 420

const SAISIES: PushableEntry[] = [
  {
    id: 'e1',
    lineId: 'l1',
    date: '2026-05-04',
    slotId: '',
    minutes: 420,
    kind: 'REALISE',
    minutesParJour: MINUTES_PAR_JOUR,
    comment: 'Développement  ',
  },
  {
    id: 'e2',
    lineId: 'l1',
    date: '2026-05-05',
    slotId: 'AM',
    minutes: 210,
    kind: 'REALISE',
    minutesParJour: MINUTES_PAR_JOUR,
    comment: '',
  },
]

describe('double de l API Dolibarr — garde-fou inverse', () => {
  it('accepte la charge utile réelle du connecteur', async () => {
    const api = new FakeDolibarr()
    const tiers = api.seedThirdparty('ACME')
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: tiers.id })
    const tache = await api.createTask({ projectId: projet.id, label: 'Développement' })

    for (const p of buildTimeSpentPayloads(SAISIES)) {
      await api.addTimeSpent({
        taskId: tache.id,
        dolibarrUserId: 7,
        date: p.date,
        durationSeconds: p.durationSeconds,
        note: p.note,
      })
    }

    expect(api.timespents.map((t) => t.durationSeconds)).toEqual([25_200, 12_600])

    const brouillon = buildInvoiceDraft({
      socid: tiers.id,
      month: '2026-05',
      entries: SAISIES,
      lines: [{ id: 'l1', label: 'Développement', tjmCents: 80_000 }],
    })

    await api.createDraftInvoice({
      socid: brouillon.socid,
      lines: brouillon.lines.map((l) => ({
        label: l.label,
        qteCentiemes: l.qteCentiemes,
        subpriceCents: l.tjmCents,
      })),
    })

    // 1,5 jour de 7 h : la conversion vient du facteur figé de la saisie, pas
    // d'un défaut à 480 minutes qui gonflerait la quantité d'un septième.
    expect(api.invoices[0]!.lines).toEqual([{ label: 'Développement', qty: 1.5, subprice: 800 }])
  })
})
