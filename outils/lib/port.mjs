import net from 'node:net'

/**
 * Port préféré, et de très loin.
 *
 * Google exige que l'URL de retour du consentement soit enregistrée à l'avance
 * et corresponde **exactement** — port compris. Un port qui change d'un
 * démarrage à l'autre casserait la connexion Google à chaque fois, avec un
 * message de Google et non de l'application. Le port stable est donc la règle ;
 * la bascule est une exception qui se dit à voix haute
 * (voir `docs/superpowers/specs/2026-08-16-configuration-application-vs-environnement-design.md`, §4).
 */
export const PORT_PREFERE = 3000

/** Vrai si l'on peut écouter sur ce port en local. */
export function portLibre(port) {
  return new Promise((resolve) => {
    const serveur = net.createServer()
    serveur.once('error', () => resolve(false))
    serveur.once('listening', () => serveur.close(() => resolve(true)))
    serveur.listen(port, '127.0.0.1')
  })
}

/**
 * Premier port libre à partir de `depuis`.
 *
 * Il subsiste une fenêtre entre la libération du port sondé et sa prise par le
 * serveur : un autre programme peut se glisser entre les deux. C'est
 * improbable sur un poste personnel, et le seul remède réel serait de passer
 * une socket déjà liée au serveur Next, ce que sa sortie standalone ne permet
 * pas. Le lanceur traite le cas par son message d'échec, pas en l'ignorant.
 */
export async function choisirPort(depuis = PORT_PREFERE, essais = 50) {
  for (let port = depuis; port < depuis + essais; port++) {
    if (await portLibre(port)) return port
  }
  throw new Error(
    `Aucun port libre entre ${depuis} et ${depuis + essais - 1}. ` +
      'Ferme un programme qui occupe ces ports, puis relance.',
  )
}

/**
 * Le port sur lequel démarrer, et s'il a fallu basculer.
 *
 * - `demande` (posé par `CRA_PORT`) est une exigence, pas une préférence :
 *   quelqu'un qui fixe le port a déclaré une URL de retour Google avec ce
 *   port. Basculer en douce casserait sa connexion Google sans rien dire, et
 *   la panne apparaîtrait bien plus tard, chez Google. On échoue à la place,
 *   en nommant le port occupé.
 * - Sinon, `prefere` d'abord, et seulement s'il est pris, le premier libre
 *   au-dessus — avec `bascule: true`, que le lanceur transforme en avertissement.
 *
 * @param {{ demande?: number | string | null, prefere?: number, essais?: number }} [options]
 * @returns {Promise<{ port: number, bascule: boolean, demande: boolean }>}
 */
export async function resoudrePort({ demande = null, prefere = PORT_PREFERE, essais = 50 } = {}) {
  if (demande !== null && demande !== undefined && demande !== '') {
    const port = Number(demande)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`CRA_PORT doit être un numéro de port entre 1 et 65535 (reçu : « ${demande} »).`)
    }
    if (!(await portLibre(port))) {
      throw new Error(
        `Le port ${port}, demandé par CRA_PORT, est déjà occupé.\n` +
          "L'application n'a pas démarré : changer de port à ta place casserait l'URL de retour\n" +
          'Google que tu as enregistrée sur ce port. Libère-le, ou choisis un autre CRA_PORT et\n' +
          "mets à jour l'URL de retour dans la console Google.",
      )
    }
    return { port, bascule: false, demande: true }
  }

  if (await portLibre(prefere)) return { port: prefere, bascule: false, demande: false }

  const port = await choisirPort(prefere + 1, Math.max(1, essais - 1))
  return { port, bascule: true, demande: false }
}

/**
 * L'avertissement à afficher quand le port préféré n'était pas libre.
 *
 * Il donne l'URL de retour **exacte**, prête à copier : Google refuse toute
 * URL qui ne correspond pas au caractère près, et personne ne doit avoir à la
 * deviner. `localhost` et non `127.0.0.1` : c'est la forme que Google accepte
 * pour une application de bureau, et celle qu'utilise `.env.example`.
 */
export function messageBascule(port) {
  return [
    `Le port ${PORT_PREFERE} était occupé : l'application démarre sur le port ${port}.`,
    '',
    'Si tu utilises la connexion Google, son URL de retour doit être mise à jour dans la',
    'console Google Cloud, à l’identique :',
    '',
    `    http://localhost:${port}/api/google/callback`,
    '',
    `et GOOGLE_REDIRECT_URI dans donnees/cra.env doit porter la même valeur.`,
    `Pour retrouver un port fixe, libère le port ${PORT_PREFERE} ou pose CRA_PORT.`,
  ].join('\n')
}
