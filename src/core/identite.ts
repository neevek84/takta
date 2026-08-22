/**
 * Ce que le produit dit de lui-même, et l'obligation qui l'accompagne.
 *
 * Pur : aucune base, aucun réseau, aucun React.
 */

/** Le nom du produit, tel qu'il s'écrit partout. */
export const NOM = 'takta'

/** Sa devise, telle qu'elle figure au manifeste et sur l'écran de connexion. */
export const DEVISE = 'le temps qui fait foi'

/**
 * Où trouver le code source de **cette** installation.
 *
 * **Ce n'est pas un lien de courtoisie : c'est l'article 13 de l'AGPL.** La
 * licence oblige quiconque met à disposition une version modifiée du logiciel
 * **par un réseau** à offrir à ses utilisateurs le code source correspondant.
 * Un lien, visible depuis l'application, est la façon usuelle de s'en acquitter.
 *
 * **Si vous forkez ce produit et le modifiez, changez cette adresse.** La
 * laisser pointer vers le dépôt d'origine ferait dire à votre installation une
 * chose fausse — que son code est là-bas — et ne vous acquitterait de rien : la
 * source exigée est celle de la version que vos utilisateurs exécutent, pas
 * celle dont elle descend.
 */
export const SOURCE_URL = 'https://github.com/neevek84/takta'

/** La licence, telle qu'elle s'annonce à l'écran. */
export const LICENCE = 'AGPL v3'

/**
 * La version qui tourne, ou `''` si elle n'a pas été figée à la construction.
 *
 * **Ce qu'elle répare.** Une image déployée ne dit pas ce qu'elle est :
 * l'interface de Container Manager affiche l'identifiant *local* de l'image,
 * qui ne correspond à aucune empreinte du registre. Personne ne pouvait donc
 * dire quelle version tournait — ni pour vérifier une mise à jour reçue, ni
 * pour décrire un défaut.
 *
 * Chaîne vide plutôt que `'inconnue'` : l'écran n'affiche alors rien du tout.
 * Une version fausse est pire qu'une version absente.
 */
export function version(): string {
  return process.env.TAKTA_VERSION ?? ''
}

