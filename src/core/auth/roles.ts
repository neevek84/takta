/**
 * Qui a le droit d'administrer, et rien d'autre.
 *
 * Pur : ni base, ni session, ni React. La décision tient en une comparaison,
 * mais elle vit ici pour une raison précise — elle est lue par une page serveur,
 * par une action serveur et par un contrôle structurel, et trois écritures de la
 * même règle divergent le jour où un quatrième rôle apparaît.
 *
 * **`User.role` est une colonne `String`, pas une énumération de la base.** Une
 * valeur inventée à la main en SQL y entre sans que rien ne la refuse : d'où
 * `estRole`, qui est le seul chemin vers le type `Role`.
 */
import type { Role } from '@/core/types'

/** Les trois rôles, dans l'ordre décroissant de ce qu'ils peuvent. */
export const ROLES = ['ADMIN', 'MANAGER', 'CONSULTANT'] as const

export function estRole(valeur: string): valeur is Role {
  return (ROLES as readonly string[]).includes(valeur)
}

/**
 * L'administration est réservée à `ADMIN`, et à lui seul.
 *
 * `MANAGER` n'est pas une demi-administration : il n'a aujourd'hui aucun écran
 * qui lui soit propre, et lui ouvrir la clé d'API de l'instance ou les rôles des
 * autres serait décider à la place du porteur. Le jour où un écran lui revient,
 * c'est ici que ça se dira — et le test de couverture des rôles le verra.
 */
export function peutAdministrer(role: Role): boolean {
  return role === 'ADMIN'
}

/**
 * Ce que le refus dit. Il ne renvoie nulle part : une redirection apprend que
 * l'écran n'existe pas, un refus apprend à qui demander.
 */
export const MOTIF_REFUS_ADMIN =
  'Cet écran est réservé aux administrateurs de cette installation. ' +
  'Demandez à l’un d’eux de faire le réglage, ou de vous donner le rôle depuis Réglages · Comptes.'
