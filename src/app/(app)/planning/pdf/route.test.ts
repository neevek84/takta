import { describe, it, expect, vi, beforeEach } from 'vitest'

const { etat } = vi.hoisted(() => ({
  etat: {
    authentifie: true,
    erreur: null as Error | null,
    appels: [] as Array<{ userId: string; args: unknown }>,
  },
}))

vi.mock('@/auth', () => ({
  requireUser: vi.fn(async () => {
    if (!etat.authentifie) throw new Error('non')
    return { id: 'u1', role: 'ADMIN' as const }
  }),
}))
vi.mock('@/services/planning-pdf', () => {
  class PeriodeInvalide extends Error {}
  return {
    PeriodeInvalide,
    buildPlanningPdf: async (userId: string, args: unknown) => {
      etat.appels.push({ userId, args })
      if (etat.erreur !== null) throw etat.erreur
      return { fileName: 'Planning-ACME.pdf', bytes: new Uint8Array([0x25, 0x50]) }
    },
  }
})

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { GET } from './route'
// eslint-disable-next-line import/first
import { PeriodeInvalide } from '@/services/planning-pdf'

const URL_OK = 'http://local/planning/pdf?ligne=l1&du=2026-11-01&au=2027-06-30'

describe('GET /planning/pdf', () => {
  beforeEach(() => {
    etat.authentifie = true
    etat.erreur = null
    etat.appels.length = 0
  })

  it('sert le PDF en pièce jointe', async () => {
    const r = await GET(new Request(URL_OK))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="Planning-ACME.pdf"')
  })

  it('transmet la prestation, la période et le périmètre', async () => {
    await GET(new Request(`${URL_OK}&perimetre=MISSION`))
    expect(etat.appels[0]).toMatchObject({
      userId: 'u1',
      args: { lineId: 'l1', perimetre: 'MISSION', periode: { du: '2026-11-01', au: '2027-06-30' } },
    })
  })

  it('ramène tout périmètre inconnu à la prestation', async () => {
    await GET(new Request(`${URL_OK}&perimetre=TOUT`))
    expect(etat.appels[0]).toMatchObject({ args: { perimetre: 'PRESTATION' } })
  })

  it('rend 400 sur une période refusée', async () => {
    etat.erreur = new PeriodeInvalide('La date de fin précède la date de début.')
    const r = await GET(new Request(URL_OK))
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ erreur: 'La date de fin précède la date de début.' })
  })

  it('rend 404 sans distinguer inconnue et étrangère', async () => {
    etat.erreur = new Error('No MissionLine found')
    const r = await GET(new Request(URL_OK))
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ erreur: 'Prestation introuvable.' })
  })

  it('rend 401 sans session', async () => {
    etat.authentifie = false
    const r = await GET(new Request(URL_OK))
    expect(r.status).toBe(401)
    expect(etat.appels).toHaveLength(0)
  })
})
