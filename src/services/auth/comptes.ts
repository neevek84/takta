/**
 * Ce qui fait exister un compte, et ce qui lui ouvre une porte.
 *
 * **La convention de l'empreinte vide.** `passwordHash = ''` signifie « pas de
 * mot de passe ». C'est l'état des comptes que la reprise des temps Dolibarr
 * crée pour porter l'attribution des saisies, et de ceux que la connexion
 * Google crée. `verifyPassword` refuse déjà cette empreinte — `verify('')`
 * lève, le `catch` rend `false` — mais rien ne le **disait**. Trois écrans
 * s'appuient maintenant dessus : il faut que ce soit une règle, pas un accident
 * heureux.
 */
import { prisma } from '@/db/client'

/** Ce compte peut-il entrer par la porte mot de passe ? */
export async function aUnMotDePasse(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  })
  return user !== null && user.passwordHash !== ''
}
