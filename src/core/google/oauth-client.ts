/**
 * Le client OAuth Google, côté domaine : ce qu'il contient, et ce qui fait
 * qu'une URL de retour est acceptable.
 *
 * Pur, sans dépendance — ni Prisma, ni Next, ni React. C'est ce qui permet
 * d'exercer la validation et le calcul de l'URL de retour sans base ni
 * serveur, et surtout ce qui garantit qu'aucune de ces deux opérations ne peut
 * aller chercher une valeur dans l'environnement ou dans une requête HTTP :
 * elle n'a accès ni à l'un ni à l'autre.
 */

/**
 * Le chemin du retour de consentement, déclaré une seule fois.
 *
 * Il est servi par `src/app/api/google/callback/route.ts`, affiché par l'écran
 * d'administration et vérifié ici. Trois recopies d'une même chaîne auraient
 * fini par diverger, et Google compare au caractère près.
 */
export const GOOGLE_CALLBACK_PATH = '/api/google/callback'

/**
 * Les trois valeurs que l'utilisateur crée chez Google et recopie ici. Elles
 * vivent chiffrées en base, en portée instance — jamais dans un fichier.
 */
export interface GoogleOAuthClient {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type ValidationClient =
  | { ok: true; client: GoogleOAuthClient }
  | { ok: false; erreurs: string[] }

/**
 * L'URL de retour à enregistrer chez Google pour une adresse servie donnée.
 *
 * L'appelant passe l'adresse par laquelle l'application est réellement
 * atteinte ; seule son origine est retenue — Google refuse toute URL de retour
 * portant un chemin, une requête ou un fragment inattendus.
 *
 * Cette valeur est **une proposition à afficher**, pas la valeur employée :
 * celle qui sert à construire la redirection est la valeur enregistrée, lue en
 * base. Voir `buildConsentUrl`.
 */
export function redirectUriPour(adresseServie: string): string {
  let origine: string
  try {
    origine = new URL(adresseServie).origin
  } catch {
    // Une adresse illisible ne doit pas produire une URL plausible mais
    // fausse : personne ne remarquerait la différence avant le refus de Google.
    return ''
  }
  if (origine === 'null') return ''
  return `${origine}${GOOGLE_CALLBACK_PATH}`
}

/** Les hôtes pour lesquels Google tolère `http` : la machine locale, et elle seule. */
const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Vérifie ce qui peut l'être **avant** d'envoyer quelqu'un chez Google.
 *
 * Chaque refus rendu ici est un aller-retour évité vers une page d'erreur de
 * Google, sur laquelle l'application ne peut plus rien expliquer. Les refus
 * sont cumulés : corriger un champ pour en découvrir un second n'apprend rien
 * de plus et coûte une saisie.
 *
 * Aucun message ne recopie la valeur saisie — un refus part à l'écran, parfois
 * au journal, et un secret affiché une fois est un secret à changer.
 */
export function validerClientOAuth(brut: {
  clientId: string
  clientSecret: string
  redirectUri: string
}): ValidationClient {
  const client: GoogleOAuthClient = {
    clientId: brut.clientId.trim(),
    clientSecret: brut.clientSecret.trim(),
    redirectUri: brut.redirectUri.trim(),
  }

  const erreurs: string[] = []
  if (client.clientId === '') {
    erreurs.push("L'identifiant du client OAuth est requis.")
  }
  if (client.clientSecret === '') {
    erreurs.push('Le secret du client OAuth est requis.')
  }
  erreurs.push(...refusUrlRetour(client.redirectUri))

  if (erreurs.length > 0) return { ok: false, erreurs }
  return { ok: true, client }
}

/** Les raisons pour lesquelles Google refuserait cette URL de retour. */
function refusUrlRetour(valeur: string): string[] {
  if (valeur === '') return ["L'URL de retour est requise."]

  let url: URL
  try {
    url = new URL(valeur)
  } catch {
    return ["L'URL de retour doit être complète, protocole compris (https://…)."]
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return ["L'URL de retour doit être complète, protocole compris (https://…)."]
  }

  const erreurs: string[] = []
  if (url.protocol === 'http:' && !HOTES_LOCAUX.has(url.hostname)) {
    erreurs.push(
      "Google n'accepte http que sur la machine locale : ailleurs, l'URL de retour doit être en https.",
    )
  }
  if (url.pathname !== GOOGLE_CALLBACK_PATH) {
    erreurs.push(`L'URL de retour doit se terminer par ${GOOGLE_CALLBACK_PATH}.`)
  }
  if (url.search !== '' || url.hash !== '') {
    erreurs.push("L'URL de retour ne porte ni paramètre ni ancre.")
  }
  return erreurs
}
