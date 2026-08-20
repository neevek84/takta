import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
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

/**
 * Ne garde que les `garder` sauvegardes les plus récentes, et rend celles qui
 * ont été retirées.
 *
 * **Une rotation, pas un archivage.** Ce mécanisme protège contre la perte de
 * quelques heures de travail : il ne conserve pas l'historique d'un trimestre.
 * Pour cela, c'est le dossier entier qu'il faut copier ailleurs.
 *
 * Le tri se fait sur le **nom**, pas sur la date du fichier : l'horodatage y
 * est triable par construction, et une date de fichier se laisse réécrire par
 * une copie ou une restauration.
 */
export function purgerAnciennes(dossier, prefixe, garder) {
  if (!existsSync(dossier)) return []
  if (!Number.isInteger(garder) || garder < 1) {
    throw new Error('Le nombre de sauvegardes à garder doit être un entier positif.')
  }

  const fichiers = readdirSync(dossier)
    .filter((n) => n.startsWith(`${prefixe}-`) && n.endsWith('.db'))
    .sort()

  const aRetirer = fichiers.slice(0, Math.max(0, fichiers.length - garder))
  for (const nom of aRetirer) rmSync(path.join(dossier, nom), { force: true })
  return aRetirer
}

/** Taille cumulée du dossier de sauvegardes, en octets. */
export function poidsDesSauvegardes(dossier, prefixe) {
  if (!existsSync(dossier)) return 0
  return readdirSync(dossier)
    .filter((n) => n.startsWith(`${prefixe}-`) && n.endsWith('.db'))
    .reduce((total, n) => total + statSync(path.join(dossier, n)).size, 0)
}
