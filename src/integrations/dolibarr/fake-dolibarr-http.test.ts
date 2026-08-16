import { describe, it, expect } from 'vitest'
import { createHttpDolibarrApi } from '@/services/dolibarr/http'
import { DolibarrRequestError } from '@/services/dolibarr/api'
import { BASE_FACTICE, createFakeDolibarrHttp } from './fake-dolibarr-http'

function apiSur(faux: ReturnType<typeof createFakeDolibarrHttp>) {
  return createHttpDolibarrApi({
    baseUrl: BASE_FACTICE,
    apiKey: 'cle-factice',
    fetchImpl: faux.fetchImpl,
  })
}

describe('double HTTP Dolibarr', () => {
  it('lève sur une route absente du catalogue', async () => {
    const faux = createFakeDolibarrHttp()
    await expect(
      faux.fetchImpl(`${BASE_FACTICE}/users`, { headers: { DOLAPIKEY: 'cle-factice' } }),
    ).rejects.toThrow(/non catalogué[\s\S]*src\/integrations\/dolibarr\/catalogue\.ts/)
  })

  it('enregistre le gabarit catalogué de chaque appel', async () => {
    const faux = createFakeDolibarrHttp()
    const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: 1 })
    await apiSur(faux).listTasks(projet.id)
    expect(faux.gabaritsObserves).toEqual(['GET /projects/{projectId}/tasks'])
  })

  it('refuse une requête sans clé d API', async () => {
    const faux = createFakeDolibarrHttp()
    const api = createHttpDolibarrApi({
      baseUrl: BASE_FACTICE,
      apiKey: '',
      fetchImpl: faux.fetchImpl,
    })
    await expect(api.listThirdparties()).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse une durée qui n est pas un entier de secondes', async () => {
    const faux = createFakeDolibarrHttp()
    const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: 1 })
    const tache = faux.seedTask({ projectId: projet.id, label: 'Conseil' })
    await expect(
      apiSur(faux).addTimeSpent({
        taskId: tache.id,
        dolibarrUserId: 42,
        date: '2026-04-13',
        durationSeconds: 28800.5,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse une date qui n est pas au format de Dolibarr', async () => {
    const faux = createFakeDolibarrHttp()
    const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: 1 })
    const tache = faux.seedTask({ projectId: projet.id, label: 'Conseil' })
    await expect(
      apiSur(faux).addTimeSpent({
        taskId: tache.id,
        dolibarrUserId: 42,
        date: '13/04/2026',
        durationSeconds: 28800,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse un temps passé sur une tâche inconnue', async () => {
    const faux = createFakeDolibarrHttp()
    await expect(
      apiSur(faux).addTimeSpent({
        taskId: 999,
        dolibarrUserId: 42,
        date: '2026-04-13',
        durationSeconds: 28800,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('rend 404 sur une collection vide, que le client traduit en liste vide', async () => {
    const faux = createFakeDolibarrHttp()
    expect(await apiSur(faux).listThirdparties()).toEqual([])
    expect(faux.appels[0]!.url).not.toContain('cle-factice')
    expect(faux.appels[0]!.entetes.get('DOLAPIKEY')).toBe('cle-factice')
  })

  it('ne rend que les projets facturables au temps consommé', async () => {
    const faux = createFakeDolibarrHttp()
    faux.seedProject({ ref: 'PJ001', title: 'Facturable', socid: 1 })
    faux.seedProject({ ref: 'PJ002', title: 'Interne', socid: 1, usageBillTime: false })
    const projets = await apiSur(faux).listProjects()
    expect(projets.map((p) => p.ref)).toEqual(['PJ001'])
  })

  it('rend la constante enveloppée quand elle est amorcée, rien sinon', async () => {
    const faux = createFakeDolibarrHttp()
    faux.seedSetup('TIMESHEET_DAY_DURATION', '7')
    const api = apiSur(faux)
    expect(await api.getSetupValue('TIMESHEET_DAY_DURATION')).toBe('7')
    expect(await api.getSetupValue('SOCIETE_FISCAL_MONTH_START')).toBeNull()
  })

  it('tolère la suppression d un temps déjà disparu', async () => {
    const faux = createFakeDolibarrHttp()
    const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: 1 })
    const tache = faux.seedTask({ projectId: projet.id, label: 'Conseil' })
    await expect(
      apiSur(faux).deleteTimeSpent({ taskId: tache.id, timespentId: 999 }),
    ).resolves.toBeUndefined()
  })

  it('relit une propale en convertissant ses prix en centimes', async () => {
    const faux = createFakeDolibarrHttp()
    const tiers = faux.seedThirdparty('Client Exemple')
    const propale = faux.seedProposal({
      ref: 'PR001',
      socid: tiers.id,
      lines: [{ label: 'Conseil', qty: 10, subpriceEuros: 800 }],
    })
    const relue = await apiSur(faux).getProposal(propale.id)
    expect(relue.lines[0]!.subpriceCents).toBe(80000)
  })
})
