import { cookies } from 'next/headers'
import { COOKIE_ANNONCE, type TonAnnonce } from '@/core/annonce/annonce'

/**
 * Dit à l'utilisateur ce que son action vient de faire.
 *
 * À appeler depuis une server action, **avant** un éventuel `redirect` : le
 * bandeau s'affiche en tête de la page suivante, que l'action redirige ou se
 * contente de revalider. Écrire un cookie depuis une action fait de toute
 * façon re-rendre la page et ses gabarits — c'est ce qui l'y fait apparaître.
 *
 * Une minute de vie : assez pour traverser une redirection lente, trop peu
 * pour resurgir le lendemain si l'écran ne l'a jamais lu.
 */
export async function annoncer(message: string, ton: TonAnnonce = 'success'): Promise<void> {
  ;(await cookies()).set(
    COOKIE_ANNONCE,
    JSON.stringify({ id: crypto.randomUUID(), message, ton }),
    // Lisible par le navigateur : c'est lui qui l'efface, une fois affichée.
    { path: '/', maxAge: 60, sameSite: 'lax', httpOnly: false },
  )
}
