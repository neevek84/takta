import { prisma } from '@/db/client'
import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { ensureDedicatedCalendar, type FetchLike } from '@/integrations/google/calendar'
import { exchangeCode } from '@/integrations/google/oauth'
import { revokeCredential, saveCredential, setCalendarId } from '@/services/credentials'

/** Libellé du calendrier dédié — jamais l'agenda principal. */
export const CALENDRIER_DEDIE = 'CRA — disponibilités'

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

  const jetons = await exchangeCode(fetchFn, args.code)
  await saveCredential(args.userId, PROVIDER_GOOGLE, { ...jetons, calendarId: '' })

  try {
    const calendarId = await ensureDedicatedCalendar(fetchFn, jetons.accessToken, CALENDRIER_DEDIE)
    await setCalendarId(args.userId, PROVIDER_GOOGLE, calendarId)
    return { calendarId }
  } catch (err) {
    await revokeCredential(args.userId, PROVIDER_GOOGLE)
    throw err
  }
}

export async function disconnectGoogle(userId: string): Promise<void> {
  // Les blocs déjà posés restent dans l'agenda : ils sont dans un calendrier
  // dédié, que l'utilisateur efface d'un geste s'il le souhaite.
  await revokeCredential(userId, PROVIDER_GOOGLE)
}

export async function getConnectionState(userId: string): Promise<{
  connected: boolean
  calendarId: string
  scope: string
  connectedAt: Date | null
}> {
  const row = await prisma.providerCredential.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER_GOOGLE } },
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
