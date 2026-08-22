import { prisma } from '@/db/client'
import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { ensureDedicatedCalendar, type FetchLike } from '@/integrations/google/calendar'
import { exchangeCode } from '@/integrations/google/oauth'
import {
  OWNER_SCOPE_USER,
  revokeCredential,
  saveCredential,
  setCalendarId,
} from '@/services/credentials'
import { journalErreur } from '@/services/log'
import { readGoogleOAuthClient } from './oauth-client'

/**
 * Libellé du calendrier dédié — jamais l'agenda principal.
 *
 * **Ne pas le renommer avec le produit.** Le connecteur retrouve le calendrier
 * **par ce libellé** : le changer ferait créer un second calendrier à toute
 * installation existante, et abandonnerait le premier avec les événements
 * qu'il porte. Le mot désigne d'ailleurs le document, pas le produit — ce sont
 * bien les disponibilités d'un CRA que ce calendrier expose.
 */
export const CALENDRIER_DEDIE = 'CRA — disponibilités'

/**
 * Levée quand aucun client OAuth n'est enregistré. Un type propre, et non un
 * `null` de plus : au retour du consentement, « Google a refusé » et « ce
 * serveur n'a plus de client OAuth » appellent deux messages différents, et
 * seul le second se répare depuis l'écran d'administration.
 */
export class GoogleClientAbsentError extends Error {
  constructor() {
    super(
      "Aucun client OAuth Google n'est enregistré : la connexion se configure dans Administration · Google.",
    )
    this.name = 'GoogleClientAbsentError'
  }
}

/**
 * Au retour du consentement : le jeton de rafraîchissement est chiffré et
 * stocké, puis le calendrier dédié est créé s'il n'existe pas.
 *
 * Si la seconde étape échoue, la première est annulée : un compte enregistré
 * sans calendrier afficherait « connecté » tout en étant inutilisable, et
 * l'utilisateur n'aurait aucune raison de recommencer.
 */
export async function connectGoogle(args: {
  userId: string
  code: string
  fetchFn?: FetchLike
}): Promise<{ calendarId: string }> {
  const fetchFn = args.fetchFn ?? (globalThis.fetch as unknown as FetchLike)

  // Le client vient de la base, jamais de l'environnement ni de la requête de
  // retour. Absent, on lève au lieu d'envoyer chez Google un échange qui ne
  // peut produire qu'un `invalid_client` illisible.
  const client = await readGoogleOAuthClient()
  if (client === null) throw new GoogleClientAbsentError()

  const jetons = await exchangeCode(fetchFn, client, args.code)
  await saveCredential(args.userId, PROVIDER_GOOGLE, { ...jetons, calendarId: '' })

  try {
    const calendarId = await ensureDedicatedCalendar(fetchFn, jetons.accessToken, CALENDRIER_DEDIE)
    await setCalendarId(args.userId, PROVIDER_GOOGLE, calendarId)
    return { calendarId }
  } catch (err) {
    // L'annulation efface sa propre trace : sans cette ligne, un compte qui
    // n'arrive jamais à se connecter ne laisse rien derrière lui, ni en base
    // ni ailleurs.
    journalErreur('google.connexion', err, { userId: args.userId, etape: 'calendrier-dedie' })
    await revokeCredential(args.userId, PROVIDER_GOOGLE)
    throw err
  }
}

/**
 * Supprime uniquement les jetons stockés ici : aucun appel n'est fait au
 * point de révocation de Google. L'autorisation accordée à l'application
 * reste donc active côté compte Google jusqu'à ce que l'utilisateur la
 * retire lui-même — le porteur a tranché en faveur d'un comportement limité
 * mais honnête plutôt qu'un appel réseau qui peut échouer à moitié. C'est
 * pourquoi cette fonction ne s'appelle pas « revoke » : elle déconnecte
 * l'application, elle ne révoque rien. Dire cette limite à l'écran est la
 * responsabilité de l'appelant (voir `SyncClient`), pas la sienne.
 *
 * Les blocs déjà posés restent dans l'agenda : ils sont dans un calendrier
 * dédié, que l'utilisateur efface d'un geste s'il le souhaite.
 */
export async function disconnectGoogle(userId: string): Promise<void> {
  await revokeCredential(userId, PROVIDER_GOOGLE)
}

export async function getConnectionState(userId: string): Promise<{
  connected: boolean
  calendarId: string
  scope: string
  connectedAt: Date | null
}> {
  const row = await prisma.providerCredential.findUnique({
    where: {
      ownerScope_userId_provider: {
        ownerScope: OWNER_SCOPE_USER,
        userId,
        provider: PROVIDER_GOOGLE,
      },
    },
    select: { calendarId: true, scope: true, connectedAt: true },
  })

  if (row === null) return { connected: false, calendarId: '', scope: '', connectedAt: null }
  return {
    connected: row.calendarId !== '',
    calendarId: row.calendarId,
    scope: row.scope,
    connectedAt: row.connectedAt,
  }
}
