/**
 * Remet la base de développement à l'état d'une sauvegarde.
 *
 * Écrit **à côté** de la base actuelle avant de la remplacer : une
 * restauration qui écrase sans filet est le meilleur moyen de perdre deux
 * états au lieu d'un.
 *
 *   node outils/restaurer-dev.mjs                 → liste les sauvegardes
 *   node outils/restaurer-dev.mjs <nom-du-fichier> → restaure celle-là
 */
import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { horodatage } from './lib/sauvegarde.mjs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = path.join(RACINE, 'prisma', 'dev.db')
const DOSSIER = process.env.CRA_SAUVEGARDES ?? path.join(homedir(), 'Sauvegardes-CRA')

const disponibles = existsSync(DOSSIER)
  ? readdirSync(DOSSIER).filter((n) => n.startsWith('dev-') && n.endsWith('.db')).sort().reverse()
  : []

const voulue = process.argv[2]
if (voulue === undefined) {
  console.log(`Sauvegardes dans ${DOSSIER} :\n`)
  for (const n of disponibles.slice(0, 20)) console.log(`  ${n}`)
  console.log(`\nPour en restaurer une :\n  node outils/restaurer-dev.mjs ${disponibles[0] ?? '<fichier>'}`)
  process.exit(0)
}

const source = path.join(DOSSIER, path.basename(voulue))
if (!existsSync(source)) {
  console.error(`Sauvegarde introuvable : ${source}`)
  process.exit(1)
}

// L'état actuel est mis de côté avant tout, et son nom le dit.
if (existsSync(BASE)) {
  const filet = path.join(DOSSIER, `avant-restauration-${horodatage()}.db`)
  copyFileSync(BASE, filet)
  console.log(`État actuel mis de côté : ${filet}`)
}

// Le journal WAL de l'ancienne base ne doit pas survivre : il porterait des
// pages qui ne correspondent plus au fichier restauré.
for (const suffixe of ['-wal', '-shm']) rmSync(`${BASE}${suffixe}`, { force: true })
copyFileSync(source, BASE)

console.log(`Base restaurée depuis ${source}`)
console.log('Redémarre le serveur : il tient la base ouverte.')
