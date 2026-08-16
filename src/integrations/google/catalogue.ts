/**
 * Ce que cette application appelle chez Google — et rien d'autre.
 *
 * Toute entrée doit correspondre à un appel réellement émis par
 * `src/integrations/google/calendar.ts` ou `src/integrations/google/oauth.ts` :
 * le double d'API refuse une route absente d'ici, et un test de couverture
 * refuse une entrée que rien n'exerce.
 *
 * Aucune valeur réelle n'entre ici — ni identifiant de client, ni secret, ni
 * jeton. Les exemples sont manifestement factices.
 */
import type { CatalogueSysteme } from '@/core/integrations/catalogue'

export const BASE_GOOGLE = 'https://www.googleapis.com/calendar/v3'

const VERSION = 'Google Calendar API v3'
const DATE = '2026-08-16'
const PAR_LE_DOUBLE = { version: VERSION, date: DATE, moyen: 'DOUBLE' as const }

/**
 * Le client OAuth se saisit à l'écran et vit chiffré en base : il ne se lit
 * ni dans l'environnement, ni dans la requête de retour. Voir
 * `src/services/google/oauth-client.ts`.
 */
const ORIGINE_CLIENT = 'client OAuth d’instance, saisi dans Administration · Google'

export const CATALOGUE_GOOGLE: CatalogueSysteme = {
  systeme: 'Google Calendar',
  base: BASE_GOOGLE,
  appels: [
    {
      operation: 'Poser un bloc de disponibilité dans le calendrier dédié',
      methode: 'POST',
      gabarit: '/calendars/{calendarId}/events',
      emis: true,
      emisPar: 'src/integrations/google/calendar.ts · createEvent',
      parametres: [
        {
          nom: 'calendarId',
          source: 'IDENTIFIANT',
          origine: 'ProviderCredential.calendarId, posé au consentement par ensureDedicatedCalendar',
          exemple: 'cal-exemple@group.calendar.google',
        },
        {
          nom: 'summary',
          source: 'CALCUL',
          origine: 'src/core/calendar/event.ts · buildCalendarEvent',
          exemple: 'Client Exemple · Conseil',
        },
        {
          nom: 'start.dateTime',
          source: 'CALCUL',
          origine: 'src/core/calendar/event.ts — heure locale naïve, sans décalage',
          exemple: '2026-04-13T09:00:00',
        },
        {
          nom: 'start.timeZone',
          source: 'REGLAGE',
          origine: 'Settings.timeZone, lu par src/services/sync/flush.ts',
          exemple: 'Europe/Paris',
        },
        {
          nom: 'transparency',
          source: 'CONSTANTE',
          origine: 'src/core/calendar/event.ts',
          exemple: 'opaque',
        },
        {
          nom: 'colorId',
          source: 'CALCUL',
          origine: 'src/core/calendar/event.ts — COULEUR_REALISE ou COULEUR_PREVISIONNEL',
          exemple: '9',
        },
        {
          nom: 'extendedProperties.private.craEntryId',
          source: 'IDENTIFIANT',
          origine: 'identifiant de la saisie locale — sert à retrouver le bloc',
          exemple: 'entry-exemple',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible: "L'écran de synchronisation compte l'échec ; la file rejoue.",
      },
      reglagesTiers: [],
      note:
        "Une heure locale naïve sans `timeZone` est refusée par Google : l'instant n'existe pas " +
        'sans fuseau.',
    },
    {
      operation: 'Corriger un bloc déjà posé, sans changer son identifiant',
      methode: 'PUT',
      gabarit: '/calendars/{calendarId}/events/{eventId}',
      emis: true,
      emisPar: 'src/integrations/google/calendar.ts · updateEvent',
      parametres: [
        {
          nom: 'calendarId',
          source: 'IDENTIFIANT',
          origine: 'ProviderCredential.calendarId',
          exemple: 'cal-exemple@group.calendar.google',
        },
        {
          nom: 'eventId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (saisie → événement), posé par src/services/sync/flush.ts',
          exemple: 'evt-exemple',
        },
        {
          nom: 'summary',
          source: 'CALCUL',
          origine: 'src/core/calendar/event.ts · buildCalendarEvent',
          exemple: 'Client Exemple · Conseil',
        },
        {
          nom: 'start.dateTime',
          source: 'CALCUL',
          origine: 'src/core/calendar/event.ts — heure locale naïve, sans décalage',
          exemple: '2026-04-13T09:00:00',
        },
        {
          nom: 'start.timeZone',
          source: 'REGLAGE',
          origine: 'Settings.timeZone, lu par src/services/sync/flush.ts',
          exemple: 'Europe/Paris',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible: "L'écran de synchronisation compte l'échec ; la file rejoue.",
      },
      reglagesTiers: [],
      note:
        'Mise à jour plutôt que suppression puis recréation, pour garder l’identifiant ' +
        '(arbitrage du porteur du 16 août). L’etag rendu sert à détecter une divergence.',
    },
    {
      operation: 'Relire un bloc pour savoir s il a été touché à la main',
      methode: 'GET',
      gabarit: '/calendars/{calendarId}/events/{eventId}',
      emis: true,
      emisPar: 'src/integrations/google/calendar.ts · getEvent',
      parametres: [
        {
          nom: 'calendarId',
          source: 'IDENTIFIANT',
          origine: 'ProviderCredential.calendarId',
          exemple: 'cal-exemple@group.calendar.google',
        },
        {
          nom: 'eventId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (saisie → événement), posé par src/services/sync/flush.ts',
          exemple: 'evt-exemple',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible: "L'écran de synchronisation compte l'échec ; la file rejoue.",
      },
      reglagesTiers: [],
      note:
        'Un événement `status: cancelled` revient en 200 ; le connecteur le traite en NOT_FOUND, ' +
        'sans quoi une suppression passerait pour une simple modification.',
    },
    {
      operation: 'Retirer un bloc qui n a plus lieu d être',
      methode: 'DELETE',
      gabarit: '/calendars/{calendarId}/events/{eventId}',
      emis: true,
      emisPar: 'src/integrations/google/calendar.ts · deleteEvent',
      parametres: [
        {
          nom: 'calendarId',
          source: 'IDENTIFIANT',
          origine: 'ProviderCredential.calendarId',
          exemple: 'cal-exemple@group.calendar.google',
        },
        {
          nom: 'eventId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (saisie → événement), posé par src/services/sync/flush.ts',
          exemple: 'evt-exemple',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'TOLERE',
        visible: 'Rien. Un événement déjà disparu est un objectif atteint.',
      },
      reglagesTiers: [],
      note: 'Le connecteur avale NOT_FOUND — 404 comme 410. Toute autre erreur remonte.',
    },
    {
      operation: 'Interroger les plages occupées des agendas de l utilisateur',
      methode: 'POST',
      gabarit: '/freeBusy',
      emis: true,
      emisPar: 'src/integrations/google/calendar.ts · freeBusy',
      parametres: [
        {
          nom: 'timeMin',
          source: 'CALCUL',
          origine: 'src/services/availability.ts — instant absolu RFC 3339',
          exemple: '2026-04-13T00:00:00Z',
        },
        {
          nom: 'timeMax',
          source: 'CALCUL',
          origine: 'src/services/availability.ts — instant absolu RFC 3339',
          exemple: '2026-04-14T00:00:00Z',
        },
        {
          nom: 'items[].id',
          source: 'IDENTIFIANT',
          origine: "calendriers de l'utilisateur, moins le calendrier dédié",
          exemple: 'principal@exemple.test',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran de disponibilités annonce que l'agenda n'a pas pu être interrogé.",
      },
      reglagesTiers: [],
      note:
        "L'exclusion du calendrier dédié vit dans le connecteur, sans quoi les blocs posés " +
        'entreraient en conflit avec eux-mêmes.',
    },
    {
      operation: 'Retrouver le calendrier dédié parmi ceux de l utilisateur',
      methode: 'GET',
      gabarit: '/users/me/calendarList',
      emis: true,
      emisPar: 'src/integrations/google/calendar.ts · ensureDedicatedCalendar',
      parametres: [
        {
          nom: 'maxResults',
          source: 'CONSTANTE',
          origine: 'src/integrations/google/calendar.ts · ensureDedicatedCalendar',
          exemple: '250',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "Le retour de consentement annule la connexion et invite à recommencer.",
      },
      reglagesTiers: [],
      note:
        'Le calendrier dédié est retrouvé par son libellé (`CRA — disponibilités`), pas par un ' +
        'identifiant stocké : un identifiant perdu se retrouve, un libellé renommé se recrée.',
    },
    {
      operation: 'Créer le calendrier dédié quand il n existe pas encore',
      methode: 'POST',
      gabarit: '/calendars',
      emis: true,
      emisPar: 'src/integrations/google/calendar.ts · ensureDedicatedCalendar',
      parametres: [
        {
          nom: 'summary',
          source: 'CONSTANTE',
          origine: 'src/services/google/connect.ts · CALENDRIER_DEDIE',
          exemple: 'CRA — disponibilités',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "Le retour de consentement annule la connexion et invite à recommencer.",
      },
      reglagesTiers: [],
      note:
        "Jamais l'agenda principal : le calendrier dédié est masquable d'un clic et effaçable " +
        "d'un geste, ce qui est la condition pour que l'application ait le droit d'y écrire.",
    },
    {
      operation: "Obtenir puis renouveler l autorisation d accès à l agenda",
      methode: 'POST',
      gabarit: 'https://oauth2.googleapis.com/token',
      emis: true,
      emisPar: 'src/integrations/google/oauth.ts · exchangeCode, refreshAccessToken',
      parametres: [
        {
          nom: 'client_id',
          source: 'REGLAGE',
          origine: ORIGINE_CLIENT,
          exemple: 'exemple.apps.googleusercontent.com',
        },
        {
          nom: 'client_secret',
          source: 'REGLAGE',
          origine: `${ORIGINE_CLIENT} — chiffré au repos, jamais journalisé`,
          exemple: 'valeur-factice',
        },
        {
          nom: 'redirect_uri',
          source: 'REGLAGE',
          origine: `${ORIGINE_CLIENT} — se termine par /api/google/callback`,
          exemple: 'http://localhost:3000/api/…',
        },
        {
          nom: 'grant_type',
          source: 'CONSTANTE',
          origine: 'authorization_code au consentement, refresh_token au renouvellement',
          exemple: 'refresh_token',
        },
        {
          nom: 'code',
          source: 'SAISIE',
          origine: 'code rendu par la redirection de consentement',
          exemple: 'code-factice',
        },
        {
          nom: 'refresh_token',
          source: 'IDENTIFIANT',
          origine: 'ProviderCredential, chiffré au repos par CREDENTIALS_KEY',
          exemple: 'jeton-factice',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible:
          "L'écran de synchronisation annonce une autorisation expirée et propose de reconnecter.",
      },
      reglagesTiers: ['Scopes accordés au client OAuth dans la console Google Cloud'],
      note:
        'Corps de formulaire obligatoire : du JSON sur cette route reçoit un `invalid_request`. ' +
        "Une seule entrée pour les deux `grant_type` — l'identité d'une entrée est le couple " +
        'méthode et chemin (D2).',
    },
    {
      operation: "Envoyer l utilisateur donner son consentement",
      methode: 'GET',
      gabarit: 'https://accounts.google.com/o/oauth2/v2/auth',
      emis: false,
      emisPar: 'src/integrations/google/oauth.ts · buildConsentUrl',
      parametres: [
        {
          nom: 'client_id',
          source: 'REGLAGE',
          origine: ORIGINE_CLIENT,
          exemple: 'exemple.apps.googleusercontent.com',
        },
        {
          nom: 'redirect_uri',
          source: 'REGLAGE',
          origine: `${ORIGINE_CLIENT} — recomparée par Google au caractère près`,
          exemple: 'http://localhost:3000/api/…',
        },
        {
          nom: 'response_type',
          source: 'CONSTANTE',
          origine: 'src/integrations/google/oauth.ts',
          exemple: 'code',
        },
        {
          nom: 'scope',
          source: 'CONSTANTE',
          origine: 'src/integrations/google/oauth.ts · SCOPES',
          exemple: '…/auth/calendar',
        },
        {
          nom: 'access_type',
          source: 'CONSTANTE',
          origine: 'offline — pour obtenir un jeton de rafraîchissement',
          exemple: 'offline',
        },
        {
          nom: 'prompt',
          source: 'CONSTANTE',
          origine: 'consent — sans quoi une reconnexion ne rend aucun jeton de rafraîchissement',
          exemple: 'consent',
        },
        {
          nom: 'include_granted_scopes',
          source: 'CONSTANTE',
          origine: 'src/integrations/google/oauth.ts',
          exemple: 'true',
        },
        {
          nom: 'state',
          source: 'CALCUL',
          origine: 'jeton anti-rejeu posé par la route de connexion',
          exemple: 'etat-factice',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "Le retour de consentement affiche l'échec sans conseiller de réessayer.",
      },
      reglagesTiers: ['URI de redirection autorisées dans la console Google Cloud'],
      note:
        'Redirection du navigateur, jamais émise par le serveur : hors du test de route et du ' +
        'test de couverture (D3).',
    },
  ],
}
