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
 * Lignes `CLE=valeur` d'un fichier d'environnement, commentaires ignorés.
 * @param {string} contenu
 * @returns {Record<string, string>}
 */
function lireValeurs(contenu) {
  /** @type {Record<string, string>} */
  const valeurs = {}
  for (const ligne of contenu.split('\n')) {
    const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) valeurs[m[1]] = m[2]
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
    // Les déclarations vides (`SYNC_FLUSH_TOKEN=`) laissées par une version
    // antérieure sont retirées : gardées, elles écraseraient la valeur
    // engendrée selon l'ordre de lecture.
    const conserve = contenu
      .split('\n')
      .filter((ligne) => {
        const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/)
        return !(m && SECRETS_ENGENDRES.includes(m[1]) && m[2].trim() === '')
      })
      .join('\n')
      .replace(/\n*$/, '')

    const corps = conserve === '' ? '' : `${conserve}\n`
    writeFileSync(cheminEnv, `${corps}${ajouts.join('\n')}\n`, { mode: 0o600 })
  }

  // `writeFileSync` n'applique `mode` qu'à la création : un fichier venu d'une
  // version antérieure, ou recopié à la main, garderait des droits trop larges.
  chmodSync(cheminEnv, 0o600)

  return valeurs
}
