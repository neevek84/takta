import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins } from './lib/chemins.mjs'
import { lireFichierPid, etatDuProcessus, processusVivant } from './lib/processus.mjs'

const c = chemins(racineDeLInstallation(fileURLToPath(import.meta.url)))
const attendu = lireFichierPid(c.pid)

/** La ligne de commande du serveur de CETTE installation contient ce chemin. */
const marqueur = path.join(c.app, 'server.js')

const RASSURANT =
  "Aucune donnée enregistrée n'est perdue : la base est en journalisation WAL, SQLite écrit\n" +
  'sur le disque à chaque saisie validée.'

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

if (attendu === null) {
  console.log("L'application n'est pas démarrée.")
  rmSync(c.pid, { force: true })
  process.exit(0)
}

// Le repère fait foi : on interroge le PROCESSUS, jamais le port. Un serveur
// vivant qui n'écoute pas encore (ou plus) doit être arrêté comme les autres —
// effacer son repère sans le tuer laissait un orphelin qu'aucune commande ne
// pouvait plus désigner, et le démarrage suivant en ajoutait un second sur le
// port voisin, sur la même base.
const etat = etatDuProcessus(attendu.pid, { marqueur, demarreLe: attendu.demarreLe })

if (etat === 'absent') {
  rmSync(c.pid, { force: true })
  console.log("L'application n'était plus en cours d'exécution. Repère périmé nettoyé.")
  console.log(RASSURANT)
  process.exit(0)
}

if (etat === 'etranger') {
  // Un PID est recyclé par le système : celui inscrit dans le repère désigne
  // aujourd'hui un tout autre programme. Le tuer serait bien pire que de ne
  // rien faire.
  rmSync(c.pid, { force: true })
  console.log(
    `Le numéro de processus ${attendu.pid} inscrit dans le repère appartient maintenant à un\n` +
      "autre programme : le système l'a recyclé. Rien n'a été arrêté, et le repère périmé a\n" +
      'été nettoyé.',
  )
  console.log(RASSURANT)
  process.exit(0)
}

// `notre`, ou `indetermine` (système qui ne dit pas la ligne de commande) : le
// repère est le seul lien qui reste vers ce processus, on l'honore.
try {
  process.kill(attendu.pid, 'SIGTERM')
} catch (e) {
  if (e.code !== 'ESRCH') throw e
}

const limite = Date.now() + 10_000
let arrete = false
while (Date.now() < limite) {
  if (!processusVivant(attendu.pid)) {
    arrete = true
    break
  }
  await attendre(200)
}

if (!arrete) {
  console.log("L'arrêt en douceur n'a pas abouti en 10 secondes : arrêt forcé.")
  try {
    process.kill(attendu.pid, 'SIGKILL')
  } catch (e) {
    if (e.code !== 'ESRCH') throw e
  }
  const limiteDure = Date.now() + 5_000
  while (Date.now() < limiteDure) {
    if (!processusVivant(attendu.pid)) {
      arrete = true
      break
    }
    await attendre(200)
  }
}

if (!arrete) {
  // On garde le repère : c'est le seul lien vers ce processus, et annoncer un
  // arrêt qui n'a pas eu lieu est exactement ce qu'il ne faut pas faire.
  console.error(
    `\nLe processus ${attendu.pid} n'a pas pu être arrêté, même de force.\n` +
      `Le repère ${c.pid} est conservé : il reste le seul moyen de le désigner.\n` +
      "Relance ./arreter.sh, ou termine ce processus depuis le moniteur d'activité.\n",
  )
  process.exit(1)
}

rmSync(c.pid, { force: true })
console.log('Application arrêtée.')
console.log(RASSURANT)
