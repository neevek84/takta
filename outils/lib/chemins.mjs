import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Fichier présent à la racine de toute installation dézippée. */
const MARQUEUR = 'LISEZMOI.txt'

/**
 * Racine de l'installation (le dossier issu du dézippage).
 *
 * Les scripts d'entrée posent `CRA_RACINE` — ils sont les seuls à connaître le
 * dossier avec certitude. La remontée par marqueur n'est qu'un filet pour un
 * appel direct de `node app/outils/lancer.mjs`.
 */
export function racineDeLInstallation(depuis = fileURLToPath(import.meta.url)) {
  if (process.env.CRA_RACINE) return path.resolve(process.env.CRA_RACINE)

  let dossier = path.dirname(path.resolve(depuis))
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dossier, MARQUEUR))) return dossier
    const parent = path.dirname(dossier)
    if (parent === dossier) break
    dossier = parent
  }

  throw new Error(
    "Impossible de localiser la racine de l'installation : aucun LISEZMOI.txt trouvé en\n" +
      `remontant depuis ${depuis}. Lance ./demarrer.sh (ou demarrer.cmd) depuis le dossier dézippé.`,
  )
}

/**
 * Tous les chemins d'exploitation, dérivés de la racine. Rien hors de
 * `donnees/` : c'est ce qui rend vraie la phrase du LISEZMOI « copier
 * donnees/, c'est tout sauvegarder », et ce qui permet de dézipper une
 * nouvelle version par-dessus sans rien écraser.
 */
export function chemins(racine) {
  const donnees = path.join(racine, 'donnees')
  return {
    racine,
    app: path.join(racine, 'app'),
    donnees,
    base: path.join(donnees, 'cra.db'),
    pid: path.join(donnees, 'cra.pid'),
    env: path.join(donnees, 'cra.env'),
    journal: path.join(donnees, 'journal.log'),
    sauvegardes: path.join(donnees, 'sauvegardes'),
    migrations: path.join(racine, 'app', 'prisma', 'migrations-sqlite'),
  }
}

export function creerDossierDonnees(c) {
  mkdirSync(c.donnees, { recursive: true })
  mkdirSync(c.sauvegardes, { recursive: true })
}
