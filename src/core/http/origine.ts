/**
 * L'origine publique d'une requête, telle que le visiteur l'a tapée.
 *
 * **Pourquoi cette fonction existe.** L'application ne connaît pas sa propre
 * adresse publique. Derrière un proxy — Cloudflare, un reverse proxy Synology,
 * un ingress — l'hôte de la requête telle qu'elle arrive au conteneur est une
 * adresse interne : `localhost:3000`, ou le nom du service. Construire une
 * redirection ou un lien de courriel à partir de là envoie le visiteur sur une
 * adresse qu'il ne peut pas atteindre, ou dépose la clé d'un lien en clair.
 *
 * **Le protocole non déclaré est supposé `https` hors machine locale.** Un
 * proxy qui ne pose pas `x-forwarded-proto` est un proxy qui parle en clair à
 * son amont, pas un site en clair : supposer `http` ferait voyager des jetons
 * de réinitialisation en clair. En local, où il n'y a ni proxy ni certificat,
 * c'est `http`.
 *
 * **La chaîne de proxys est coupée au premier maillon.** `x-forwarded-host`
 * peut porter `a, b, c` ; le premier est celui que le visiteur a demandé.
 *
 * Rend `''` quand aucun hôte n'est lisible — l'appelant décide alors de son
 * repli, qui n'est pas le même selon qu'on affiche une suggestion ou qu'on
 * fabrique un lien.
 *
 * Pur : aucun `next/headers`, aucune requête. L'appelant fournit la lecture.
 */
export function origineDepuisEntetes(lire: (nom: string) => string | null): string {
  const brut = lire('x-forwarded-host') ?? lire('host') ?? ''
  const hote = brut.split(',')[0]?.trim() ?? ''
  if (hote === '') return ''

  const declare = (lire('x-forwarded-proto') ?? '').split(',')[0]?.trim() ?? ''
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(hote)
  const schema = declare !== '' ? declare : local ? 'http' : 'https'
  return `${schema}://${hote}`
}

/**
 * L'origine publique, en préférant ce que l'exploitant a **déclaré**.
 *
 * **Pourquoi la déclaration l'emporte.** Tous les proxys ne posent pas
 * `x-forwarded-host` : certains réécrivent simplement `Host` avec l'adresse
 * interne de l'amont. Le conteneur n'a alors **aucun** moyen de deviner son
 * adresse publique — et il l'a payé cher : le retour d'un consentement Google
 * réussi renvoyait vers `https://203f0699dc63:3000/profil`, l'identifiant du
 * conteneur, une adresse qui n'existe nulle part hors de sa machine. La
 * connexion avait abouti ; l'écran disait « site inaccessible ».
 *
 * `AUTH_URL` est la variable qu'Auth.js lit déjà pour la même raison. La
 * réutiliser évite deux sources de vérité qui divergeraient un jour — et la
 * déclaration passe **avant** les en-têtes, qui se forgent.
 *
 * Rend `''` quand rien n'est déclaré ni lisible.
 */
export function originePublique(
  declaree: string | undefined,
  lire: (nom: string) => string | null,
): string {
  const brut = (declaree ?? '').trim()
  if (brut !== '') {
    try {
      return new URL(brut).origin
    } catch {
      // Une valeur illisible ne doit pas faire tomber une redirection : on
      // retombe sur les en-têtes, qui valent mieux que rien.
    }
  }
  return origineDepuisEntetes(lire)
}
