import { describe, it, expect, vi } from 'vitest'
import type { BusyInterval, CalendarConnector } from '@/core/calendar/connector'
import { getBusyRange } from './availability'

const PLAGE = { du: '2026-03-01', au: '2026-03-31' }

/** Une plage occupant intégralement la journée `jour` (UTC), pour les tests. */
function intervalPourJour(jour: string): BusyInterval {
  const debut = new Date(`${jour}T00:00:00.000Z`).getTime()
  return {
    startIso: new Date(debut).toISOString(),
    endIso: new Date(debut + 86_400_000).toISOString(),
  }
}

function connecteurAvec(jours: string[]): CalendarConnector {
  return {
    dedicatedCalendarId: 'dedie',
    freeBusy: async () => jours.map(intervalPourJour),
  } as unknown as CalendarConnector
}

const connecteurVide = connecteurAvec([])

const connecteurEnPanne = {
  dedicatedCalendarId: 'dedie',
  freeBusy: async () => {
    throw new Error('agenda en panne')
  },
} as unknown as CalendarConnector

const connecteurQuiExplose = {
  dedicatedCalendarId: 'dedie',
  freeBusy: () => {
    throw new Error('boom')
  },
} as unknown as CalendarConnector

const connecteurLent = {
  dedicatedCalendarId: 'dedie',
  freeBusy: () => new Promise<never>(() => {}),
} as unknown as CalendarConnector

const freeBusyEspion = vi.fn(async () => [] as BusyInterval[])
const connecteurEspion = {
  dedicatedCalendarId: 'espion-dedie@group.calendar.google.com',
  freeBusy: freeBusyEspion,
} as unknown as CalendarConnector

describe('getBusyRange', () => {
  // LE test de cette section : l'absence d'occupation et l'echec de lecture
  // rendaient tous deux une liste vide. Indistinguables. Des lors que
  // l'utilisateur CLIQUE pour savoir, une liste vide qui veut dire « Google
  // n'a pas repondu » est un mensonge.
  it('distingue l absence d occupation d un echec de lecture', async () => {
    expect(await getBusyRange('u1', PLAGE, { connector: connecteurVide })).toEqual({
      ok: true,
      jours: [],
    })
    expect(await getBusyRange('u1', PLAGE, { connector: connecteurEnPanne })).toEqual({
      ok: false,
      raison: 'ECHEC',
    })
  })

  it('dit quand aucun connecteur n est configure', async () => {
    expect(await getBusyRange('u1', PLAGE, { connector: null })).toEqual({
      ok: false,
      raison: 'PAS_DE_CONNECTEUR',
    })
  })

  // La garantie de fond ne change pas : la saisie doit fonctionner un jour ou
  // Google est en panne.
  it('ne leve jamais', async () => {
    await expect(getBusyRange('u1', PLAGE, { connector: connecteurQuiExplose })).resolves.toEqual({
      ok: false,
      raison: 'ECHEC',
    })
  })

  it('rend un echec plutot que d attendre un agenda lent', async () => {
    const r = await getBusyRange('u1', PLAGE, { connector: connecteurLent, delaiMs: 5 })

    expect(r).toEqual({ ok: false, raison: 'ECHEC' })
  })

  it('couvre toute la plage demandee, pas seulement son premier mois', async () => {
    const r = await getBusyRange(
      'u1',
      { du: '2026-03-01', au: '2026-05-31' },
      { connector: connecteurAvec(['2026-05-12']) },
    )

    expect(r).toEqual({ ok: true, jours: ['2026-05-12'] })
  })

  it('ecarte le calendrier dedie, comme avant', async () => {
    await getBusyRange('u1', PLAGE, { connector: connecteurEspion })

    expect(freeBusyEspion).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarIds: ['primary', connecteurEspion.dedicatedCalendarId],
      }),
    )
  })

  it('rend les jours tries et sans doublon', async () => {
    const r = await getBusyRange('u1', PLAGE, {
      connector: connecteurAvec(['2026-03-12', '2026-03-04', '2026-03-12']),
    })

    expect(r).toEqual({ ok: true, jours: ['2026-03-04', '2026-03-12'] })
  })
})
