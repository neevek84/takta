import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Les secrets que l'installation engendre pour elle-même, dans l'ordre où ils
 * sont écrits. Chacun est propre au poste : aucun n'est livré dans l'archive.
 *
 * - `AUTH_SECRET` signe les sessions. Le régénérer déconnecte tout le monde.
 * - `CREDENTIALS_KEY` chiffre au repos les jetons Google et la clé d'API
 *   Dolibarr. La régénérer rend ces secrets **définitivement illisibles** — il
 *   faudrait reconnecter Google et ressaisir la clé Dolibarr. Aucune donnée de
 *   CRA n'est perdue pour autant, mais la reconnexion est manuelle.
 * - `SYNC_FLUSH_TOKEN` protège le déclenchement externe de la synchronisation.
 *   Vide, l'endpoint est fermé ; ici on le remplit d'une valeur imprévisible,
 *   ce qui revient au même pour qui ne lit pas `donnees/cra.env`, et rend le
 *   déclenchement par n8n possible sans rien reconfigurer.
 *
 * Trente-deux octets aléatoires en base64 : c'est exactement ce que
 * `parseKey` (src/core/crypto/secret-box.ts) exige de `CREDENTIALS_KEY`, et
 * largement assez pour les deux autres.
 */
export const SECRETS_ENGENDRES = ['AUTH_SECRET', 'CREDENTIALS_KEY', 'SYNC_FLUSH_TOKEN']

/**
 * Une déclaration `CLE=valeur`, ou `null` si la ligne n'en est pas une.
 *
 * Ce fichier n'est modifié que par la main de la personne : c'est donc à ses
 * habitudes qu'il faut s'adapter, et non l'inverse. Trois d'entre elles étaient
 * mal lues, chacune avec la même conséquence — la ligne n'était pas reconnue,
 * le secret passait pour absent, et il était **régénéré** :
 *
 *  1. **Les fins de ligne Windows.** Le LISEZMOI vise explicitement le
 *     Bloc-notes ; l'y enregistrer convertit tout le fichier en CRLF. Or, en
 *     JavaScript, `.` ne correspond pas à `\r` : `AUTH_SECRET=valeur\r` ne
 *     correspondait à rien. `\s*$` avale désormais le retour chariot.
 *  2. **Les guillemets**, qui sont la convention écrite de `.env.example`
 *     (`AUTH_SECRET="…"`). Recopiés ici, ils faisaient partie de la valeur :
 *     mot de passe SMTP refusé sans explication, `CREDENTIALS_KEY` rejetée par
 *     `parseKey`.
 *  3. **Le préfixe `export`**, réflexe de qui a l'habitude du shell.
 *
 * Régénérer `CREDENTIALS_KEY` rend **définitivement illisibles** les jetons
 * Google et la clé Dolibarr déjà chiffrés : ces trois cas n'ont donc rien de
 * cosmétique.
 *
 * Les guillemets sont retirés, sans interprétation d'échappement : ce fichier
 * porte des secrets et des identifiants, pas du texte à mettre en forme.
 *
 * @param {string} ligne
 * @returns {{ nom: string, valeur: string } | null}
 */
function analyserLigne(ligne) {
  const m = ligne.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (!m) return null
  return { nom: m[1], valeur: retirerGuillemets(m[2]) }
}

function retirerGuillemets(valeur) {
  const q = valeur[0]
  if (valeur.length >= 2 && (q === '"' || q === "'") && valeur.endsWith(q)) {
    return valeur.slice(1, -1)
  }
  return valeur
}

/**
 * Lignes `CLE=valeur` d'un fichier d'environnement, commentaires ignorés.
 * @param {string} contenu
 * @returns {Record<string, string>}
 */
function lireValeurs(contenu) {
  /** @type {Record<string, string>} */
  const valeurs = {}
  for (const ligne of contenu.split(/\r?\n/)) {
    const d = analyserLigne(ligne)
    if (d) valeurs[d.nom] = d.valeur
  }
  return valeurs
}

/**
 * Charge `donnees/cra.env`, en engendrant les secrets qui y manquent.
 *
 * Deux propriétés, également indispensables :
 *
 *   1. **Complétion, jamais réécriture.** Un secret déjà présent est rendu tel
 *      quel, et le fichier n'est modifié que par ajout en fin. C'est ce qui
 *      permet de mettre à jour une installation existante sans déconnecter la
 *      personne ni perdre la lisibilité de ses jetons — et ce qui préserve les
 *      variables qu'elle a ajoutées à la main (identifiants Google, fuseau…)
 *      ainsi que ses commentaires.
 *   2. **Droits réduits au propriétaire.** Le fichier porte les seuls secrets
 *      de l'installation ; il est écrit et maintenu en 0600.
 *
 * @param {string} cheminEnv
 * @returns {Record<string, string>}
 */
export function chargerOuCreerEnv(cheminEnv) {
  const existe = existsSync(cheminEnv)
  const contenu = existe ? readFileSync(cheminEnv, 'utf8') : ''
  const valeurs = lireValeurs(contenu)

  const ajouts = []
  for (const nom of SECRETS_ENGENDRES) {
    if (typeof valeurs[nom] === 'string' && valeurs[nom].trim() !== '') continue
    valeurs[nom] = randomBytes(32).toString('base64')
    ajouts.push(`${nom}=${valeurs[nom]}`)
  }

  if (ajouts.length > 0) {
    // On complète le fichier dans les fins de ligne où il a été enregistré :
    // ajouter des lignes en LF à un fichier passé en CRLF le rendrait mixte,
    // donc illisible dans les éditeurs Windows les plus anciens — ceux-là mêmes
    // qui viennent de le convertir.
    const finDeLigne = contenu.includes('\r\n') ? '\r\n' : '\n'

    // Les déclarations vides (`SYNC_FLUSH_TOKEN=`) laissées par une version
    // antérieure sont retirées : gardées, elles écraseraient la valeur
    // engendrée selon l'ordre de lecture.
    const conserve = contenu
      .split(/\r?\n/)
      .filter((ligne) => {
        const d = analyserLigne(ligne)
        return !(d && SECRETS_ENGENDRES.includes(d.nom) && d.valeur.trim() === '')
      })
      .join(finDeLigne)
      .replace(/(\r?\n)*$/, '')

    const corps = conserve === '' ? '' : `${conserve}${finDeLigne}`
    writeFileSync(cheminEnv, `${corps}${ajouts.join(finDeLigne)}${finDeLigne}`, { mode: 0o600 })
  }

  // `writeFileSync` n'applique `mode` qu'à la création : un fichier venu d'une
  // version antérieure, ou recopié à la main, garderait des droits trop larges.
  chmodSync(cheminEnv, 0o600)

  return valeurs
}
