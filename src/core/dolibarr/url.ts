/**
 * L'adresse de l'instance Dolibarr, et le chemin de son API.
 *
 * Pur : aucune base, aucun réseau.
 *
 * **Pourquoi ce module existe.** L'écran de connexion réclamait « l'URL de
 * l'API », c'est-à-dire à l'utilisateur de connaître et de recopier
 * `/api/index.php`. Ce chemin est le même sur **toutes** les instances
 * Dolibarr : le demander, c'est faire porter une constante par une saisie —
 * donc offrir une faute de frappe sur la seule partie qui n'en admet aucune,
 * et la faire découvrir sous la forme d'un 404 opaque.
 *
 * L'utilisateur saisit l'adresse de son instance, celle qu'il a dans son
 * navigateur. Le chemin de l'API est ajouté ici, une fois.
 */

/** Le chemin de l'API, identique sur toute instance Dolibarr. */
export const CHEMIN_API = '/api/index.php'

/**
 * L'URL de base des appels, construite depuis l'adresse de l'instance.
 *
 * Tolérante par conception, parce qu'elle reçoit un copier-coller : barres
 * obliques en trop, protocole absent, chemin d'API déjà présent ou à moitié
 * présent. Tout ce qui décrit la même instance doit aboutir à la même base —
 * sans quoi deux saisies équivalentes produiraient deux enregistrements
 * différents, et un rattachement fait sous l'une serait invisible sous l'autre.
 *
 * Lève sur ce qui n'est pas une adresse web : un diagnostic ici vaut mieux
 * qu'un appel réseau qui échouera sans dire pourquoi.
 */
export function baseApiDepuisInstance(saisie: string): string {
  const brut = saisie.trim()
  if (brut === '') {
    throw new Error("L'adresse de l'instance Dolibarr est requise.")
  }

  // Personne ne tape son protocole. `https` par défaut, jamais `http` : on ne
  // dégrade pas silencieusement le transport d'une clé d'API.
  const avecProtocole = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(brut) ? brut : `https://${brut}`

  let url: URL
  try {
    url = new URL(avecProtocole)
  } catch {
    throw new Error(`« ${brut} » n'est pas une adresse web.`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`« ${brut} » doit être une adresse http ou https.`)
  }

  let chemin = url.pathname.replace(/\/+$/, '')
  if (chemin.endsWith(CHEMIN_API)) {
    // Déjà complète : ne rien redoubler.
  } else if (chemin.endsWith('/api')) {
    chemin += '/index.php'
  } else {
    chemin += CHEMIN_API
  }

  // Reconstruit depuis `origin`, et non depuis `href` : `origin` ne porte ni
  // identifiant d'URL — qui partirait à chaque appel et finirait dans les
  // journaux de tout ce qui se trouve sur le chemin — ni requête ni ancre, qui
  // casseraient tous les chemins concaténés derrière. Deux essais de mutation
  // l'ont établi : les quatre lignes qui effaçaient ces champs à la main ne
  // changeaient rien, et leur retrait ne change rien non plus.
  return `${url.origin}${chemin}`
}

/**
 * Le chemin inverse : l'adresse de l'instance, telle que l'utilisateur l'a
 * saisie, pour la lui réafficher.
 *
 * Ce que le formulaire montre doit être ce qu'il accepte. Réafficher la base
 * d'API dans un champ qui demande l'instance apprendrait au porteur à saisir
 * l'API — et la tolérance de `baseApiDepuisInstance` rendrait la faute
 * invisible.
 */
export function instanceDepuisBaseApi(base: string): string {
  const brut = base.trim().replace(/\/+$/, '')
  return brut.endsWith(CHEMIN_API) ? brut.slice(0, -CHEMIN_API.length) : brut
}
