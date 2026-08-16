import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins } from './lib/chemins.mjs'
import { lireFichierPid, quelquUnEcoute } from './lib/processus.mjs'

const c = chemins(racineDeLInstallation(fileURLToPath(import.meta.url)))
const attendu = lireFichierPid(c.pid)

const RASSURANT =
  "Aucune donnée enregistrée n'est perdue : la base est en journalisation WAL, SQLite écrit\n" +
  'sur le disque à chaque saisie validée.'

if (attendu === null) {
  console.log("L'application n'est pas démarrée.")
  rmSync(c.pid, { force: true })
  process.exit(0)
}

// Un PID est recyclé par le système : celui inscrit dans le fichier peut
// désigner aujourd'hui un tout autre programme. On ne tue donc que si quelque
// chose écoute encore sur le port enregistré au démarrage.
if (!(await quelquUnEcoute(attendu.port))) {
  rmSync(c.pid, { force: true })
  console.log("L'application n'était plus en cours d'exécution. Repère périmé nettoyé.")
  console.log(RASSURANT)
  process.exit(0)
}

try {
  process.kill(attendu.pid, 'SIGTERM')
} catch (e) {
  if (e.code !== 'ESRCH') throw e
}

const limite = Date.now() + 10_000
let arrete = false
while (Date.now() < limite) {
  if (!(await quelquUnEcoute(attendu.port))) {
    arrete = true
    break
  }
  await new Promise((r) => setTimeout(r, 200))
}

if (!arrete) {
  console.log("L'arrêt en douceur n'a pas abouti en 10 secondes : arrêt forcé.")
  try {
    process.kill(attendu.pid, 'SIGKILL')
  } catch (e) {
    if (e.code !== 'ESRCH') throw e
  }
}

rmSync(c.pid, { force: true })
console.log('Application arrêtée.')
console.log(RASSURANT)
