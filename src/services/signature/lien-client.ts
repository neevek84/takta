import type { Prisma } from '@prisma/client'
import { empreinteJeton, fabriquerJeton } from '@/core/auth/reinitialisation'

/**
 * Le secret qui signe les sessions client et protège les empreintes de code.
 * `AUTH_SECRET` : celui qu'Auth.js exige déjà. Vide en dehors d'une
 * installation configurée — alors aucune session client n'est valide
 * (`lireSessionClient` refuse tout), jamais l'inverse.
 */
export function secretClient(): string {
  return process.env.AUTH_SECRET ?? ''
}

/**
 * Crée un lien pour l'envoi `numero` du CRA et rend **le jeton en clair**.
 *
 * C'est la seule fois qu'il existe en clair : il part dans un courriel, la base
 * n'en garde que l'empreinte — le procédé de la réinitialisation de mot de
 * passe, réutilisé tel quel. Plusieurs liens peuvent servir le même envoi
 * (courriel d'origine, relances, lien copié à la main) : aucun n'invalide les
 * autres ; seul un renvoi ou une annulation les révoque tous.
 */
export async function creerLienClient(
  tx: Prisma.TransactionClient,
  args: { craId: string; numero: number; jetonSignataire: string },
): Promise<string> {
  const jeton = fabriquerJeton()
  await tx.lienClient.create({
    data: {
      craId: args.craId,
      numero: args.numero,
      jetonEmpreinte: empreinteJeton(jeton),
      jetonSignataire: args.jetonSignataire,
    },
  })
  return jeton
}

/** Révoque tous les liens encore ouverts du CRA. */
export async function revoquerLiensDuCra(
  tx: Prisma.TransactionClient,
  craId: string,
  maintenant: Date,
): Promise<void> {
  await tx.lienClient.updateMany({ where: { craId, revokedAt: null }, data: { revokedAt: maintenant } })
}
