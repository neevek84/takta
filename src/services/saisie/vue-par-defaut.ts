/**
 * La vue ouverte par défaut sur `/saisie`, réglée depuis « Mon profil ».
 *
 * Une colonne directe de `User` — et non un `ExternalLink` comme
 * `identifiantDolibarrDe` — parce qu'il ne s'agit pas ici de faire
 * correspondre un compte local à une identité chez un tiers : c'est une
 * simple préférence d'affichage, propre au compte, sans second lieu de
 * vérité à concilier.
 */
import { prisma } from '@/db/client'
import { estVue, type Vue } from '@/core/saisie/vue'

/** La vue par défaut d'un compte, `null` si rien n'est réglé (ou si la valeur en base n'est plus reconnue). */
export async function vueParDefautDe(userId: string): Promise<Vue | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultVue: true } })
  const valeur = user?.defaultVue ?? null
  return valeur !== null && estVue(valeur) ? valeur : null
}

/** Déclare la vue par défaut d'un compte. */
export async function definirVueParDefaut(userId: string, vue: Vue): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { defaultVue: vue } })
}
