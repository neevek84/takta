import { describe, it, expect } from 'vitest'
import { cleAppel, verifierCatalogue } from '@/core/integrations/catalogue'
import { CATALOGUE_GOOGLE } from './catalogue'

const AUJOURDHUI = new Date().toISOString().slice(0, 10)

describe('catalogue Google', () => {
  it('est en règle', () => {
    expect(verifierCatalogue(CATALOGUE_GOOGLE, AUJOURDHUI)).toEqual([])
  })

  it('déclare exactement les appels émis par le connecteur et l échange de jetons', () => {
    expect(
      CATALOGUE_GOOGLE.appels
        .filter((a) => a.emis)
        .map(cleAppel)
        .sort(),
    ).toEqual([
      'DELETE /calendars/{calendarId}/events/{eventId}',
      'GET /calendars/primary',
      'GET /calendars/{calendarId}/acl',
      'GET /calendars/{calendarId}/events/{eventId}',
      'GET /users/me/calendarList',
      'POST /calendars',
      'POST /calendars/{calendarId}/acl',
      'POST /calendars/{calendarId}/events',
      'POST /freeBusy',
      'POST https://oauth2.googleapis.com/token',
      'PUT /calendars/{calendarId}/events/{eventId}',
    ])
  })

  it('catalogue la redirection de consentement sans la compter comme émise', () => {
    const consentement = CATALOGUE_GOOGLE.appels.find((a) => !a.emis)
    expect(cleAppel(consentement!)).toBe('GET https://accounts.google.com/o/oauth2/v2/auth')
    expect(consentement!.parametres.map((p) => p.nom)).toContain('access_type')
  })

  it('dit que le fuseau des blocs vient du réglage, et non d un fichier d environnement', () => {
    const pose = CATALOGUE_GOOGLE.appels.find(
      (a) => cleAppel(a) === 'POST /calendars/{calendarId}/events',
    )
    const fuseau = pose?.parametres.find((p) => p.nom === 'start.timeZone')
    expect(fuseau?.source).toBe('REGLAGE')
    expect(fuseau?.origine).toContain('Settings.timeZone')
  })

  it('dit que le client OAuth est saisi à l écran, jamais lu dans l environnement', () => {
    for (const appel of CATALOGUE_GOOGLE.appels) {
      const clientId = appel.parametres.find((p) => p.nom === 'client_id')
      if (clientId === undefined) continue
      expect(clientId.source).toBe('REGLAGE')
      expect(clientId.origine).toContain('Administration · Google')
    }
  })

  it('ne porte aucun jeton, même factice, en exemple', () => {
    for (const appel of CATALOGUE_GOOGLE.appels) {
      for (const p of appel.parametres) {
        expect(p.exemple.length).toBeLessThanOrEqual(40)
      }
    }
  })
})
