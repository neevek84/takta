import { describe, it, expect } from 'vitest'
import { comparerCouverture } from '@/core/integrations/catalogue'
import type { CalendarEventDraft } from '@/core/calendar/event'
import type { GoogleOAuthClient } from '@/core/google/oauth-client'
import { createFakeGoogleApi } from './fake-google-api'
import {
  createGoogleCalendarConnector,
  ensureDedicatedCalendar,
  getPrimaryCalendarEmail,
} from './calendar'
import { exchangeCode, refreshAccessToken } from './oauth'
import { CATALOGUE_GOOGLE } from './catalogue'

/**
 * Le pendant de `dolibarr/couverture.test.ts` : une entrée que rien n'exerce
 * est une entrée inventée.
 *
 * Deux points que le code seul ne dit pas :
 *
 * - `ensureDedicatedCalendar` frappe `GET /users/me/calendarList` **puis**
 *   `POST /calendars` seulement si le libellé est absent. C'est le cas au
 *   premier appel sur un double neuf, donc les deux gabarits sont couverts.
 * - la redirection de consentement porte `emis: false` et sort de la
 *   comparaison par construction (D3) : c'est le navigateur qui y va, jamais
 *   le serveur.
 *
 * Le client OAuth est un objet passé en argument, jamais une variable
 * d'environnement : ces trois valeurs se saisissent à l'écran et vivent
 * chiffrées en base. Celles d'ici sont manifestement fausses.
 */
const CLIENT_FACTICE: GoogleOAuthClient = {
  clientId: 'exemple.apps.googleusercontent.com',
  clientSecret: 'valeur-factice',
  redirectUri: 'http://localhost:3000/api/google/callback',
}

/**
 * Assistant local — ce fichier n'importe pas `calendar.test.ts` : un fichier
 * de test qui en importe un autre exécute deux fois ses effets de bord.
 */
function brouillon(): CalendarEventDraft {
  return {
    summary: 'Client Exemple · Conseil',
    description: 'Bloc de disponibilité',
    startLocal: '2026-04-13T09:00:00',
    endLocal: '2026-04-13T17:00:00',
    timeZone: 'Europe/Paris',
    transparency: 'opaque',
    colorId: '5',
    craEntryId: 'entry-exemple',
  }
}

describe('couverture du catalogue Google', () => {
  it('n a aucune entrée que rien n exerce', async () => {
    const api = createFakeGoogleApi()

    await exchangeCode(api.fetchFn, CLIENT_FACTICE, 'code-factice')
    await refreshAccessToken(api.fetchFn, CLIENT_FACTICE, 'jeton-factice')

    const ownerEmail = await getPrimaryCalendarEmail(api.fetchFn, 'jeton-factice')
    const calendarId = await ensureDedicatedCalendar(
      api.fetchFn,
      'jeton-factice',
      'CRA — disponibilités',
    )
    const connecteur = createGoogleCalendarConnector({
      fetchFn: api.fetchFn,
      accessToken: 'jeton-factice',
      calendarId,
      ownerEmail,
    })

    const { externalId } = await connecteur.createEvent(brouillon())
    await connecteur.updateEvent(externalId, brouillon())
    await connecteur.getEvent(externalId)
    await connecteur.freeBusy({
      startIso: '2026-04-13T00:00:00Z',
      endIso: '2026-04-14T00:00:00Z',
      calendarIds: ['principal@exemple.test'],
    })
    await connecteur.deleteEvent(externalId)

    const { manquants, inconnus } = comparerCouverture({
      catalogue: CATALOGUE_GOOGLE,
      observes: api.gabaritsObserves,
    })
    expect(manquants).toEqual([])
    expect(inconnus).toEqual([])
  })
})
