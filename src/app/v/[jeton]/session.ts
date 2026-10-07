import { cookies } from 'next/headers'
import { lireSessionClient, signerSessionClient, SESSION_CLIENT_MINUTES } from '@/core/signature/code-client'
import { resoudreLien, secretClient } from '@/services/signature/lien-client'

export const COOKIE_CLIENT = 'cra_client'

/** Le lien que la session ouvre **pour ce jeton**, ou `null`. */
export async function lienDeLaSession(jeton: string): Promise<string | null> {
  const { etat, lienId } = await resoudreLien(jeton)
  if (lienId === null || etat === 'INCONNU') return null
  const valeur = (await cookies()).get(COOKIE_CLIENT)?.value ?? ''
  const ouvert = lireSessionClient(valeur, secretClient(), new Date())
  return ouvert === lienId ? lienId : null
}

/**
 * Le cookie est **limité au chemin du lien** : une session ouverte sur un CRA
 * n'est même pas présentée aux autres.
 */
export async function ouvrirSession(jeton: string, lienId: string): Promise<void> {
  const expire = new Date(Date.now() + SESSION_CLIENT_MINUTES * 60_000)
  ;(await cookies()).set(COOKIE_CLIENT, signerSessionClient(lienId, expire, secretClient()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/v/${jeton}`,
    expires: expire,
  })
}
