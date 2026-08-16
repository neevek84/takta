import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** Horodatage triable, en heure locale : AAAAMMJJ-HHMMSS. */
export function horodatage(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/**
 * Copie cohérente de la base, par la commande d'archivage de SQLite.
 *
 * `VACUUM INTO` est la seule façon d'obtenir un fichier utilisable pendant que
 * l'application écrit : en journalisation WAL, une copie de fichier attraperait
 * un `-wal` désynchronisé, donc une base amputée des dernières écritures.
 * La commande refuse d'écrire par-dessus une cible existante, d'où la
 * dé-collision par suffixe.
 */
export async function sauvegarderBase(prisma, dossier, prefixe = 'sauvegarde') {
  mkdirSync(dossier, { recursive: true })

  const base = horodatage()
  let cible = path.join(dossier, `${prefixe}-${base}.db`)
  let n = 1
  while (existsSync(cible)) {
    cible = path.join(dossier, `${prefixe}-${base}-${n}.db`)
    n++
  }

  await prisma.$executeRawUnsafe(`VACUUM INTO '${cible.replace(/'/g, "''")}'`)
  return cible
}
