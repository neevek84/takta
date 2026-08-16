import { readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Fichiers d'environnement qui n'ont rien à faire dans l'archive.
 *
 * `next build` recopie le `.env` du dépôt dans sa sortie `standalone` : mesuré
 * avant ce lot, `.next/standalone/.env` portait
 * `AUTH_SECRET="dev-secret-non-production"`, et le `.env` du dépôt porte
 * désormais aussi `CREDENTIALS_KEY`. Livrer l'archive telle quelle diffuserait
 * donc à tout le monde, à l'identique, la clé qui déchiffre les jetons Google
 * et la clé d'API Dolibarr de qui l'installe.
 *
 * Cette liste est partagée avec `outils/lancer.mjs`, qui la rejoue au
 * démarrage sur `app/` — seconde ligne pour une archive plus ancienne ou
 * assemblée à la main. Dans la mise en page portable, la configuration vit
 * dans `donnees/cra.env` et nulle part ailleurs : rien ici n'est une perte.
 *
 * `.env.example` n'y figure pas : il ne porte aucune valeur, et
 * `src/deploy/deployment-config.test.ts` s'en assure.
 */
export const FICHIERS_ENV_PARASITES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.development',
  '.env.development.local',
]

/** Dossiers exclus quel que soit leur emplacement, comparés segment entier. */
const DOSSIERS_EXCLUS = new Set(['donnees', '.git'])

/** Fichiers exclus quel que soit leur emplacement. */
const FICHIERS_EXCLUS = new Set(['.DS_Store', 'Thumbs.db', ...FICHIERS_ENV_PARASITES])

/**
 * Bases SQLite égarées hors de `donnees/` : `prisma/dev.db` et ses compagnons
 * `-wal`, `-shm`, `-journal`. Une base de développement livrée dans l'archive
 * exposerait les données de qui l'a construite.
 */
const BASE_SQLITE_RE = /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/

/**
 * Vrai si ce chemin relatif (séparateurs POSIX) ne doit pas entrer dans
 * l'archive. Le jugement porte sur des **segments entiers** : `donneesDeTest.md`
 * n'est pas `donnees/`.
 */
export function estExclu(cheminRelatif) {
  const segments = cheminRelatif.split('/').filter((s) => s !== '')
  if (segments.length === 0) return false

  for (const segment of segments) {
    if (DOSSIERS_EXCLUS.has(segment)) return true
    if (FICHIERS_EXCLUS.has(segment)) return true
  }

  const dernier = segments[segments.length - 1]
  if (BASE_SQLITE_RE.test(dernier)) return true

  return false
}

/**
 * Fichiers à empaqueter depuis `racine` : chemins relatifs POSIX, triés.
 * Un dossier exclu n'est pas parcouru — inutile de descendre dans `donnees/`.
 */
export function listerFichiersDuPaquet(racine) {
  const out = []

  const descendre = (absolu, prefixe) => {
    for (const entree of readdirSync(absolu, { withFileTypes: true })) {
      const relatif = prefixe === '' ? entree.name : `${prefixe}/${entree.name}`
      if (estExclu(relatif)) continue
      if (entree.isDirectory()) descendre(path.join(absolu, entree.name), relatif)
      else out.push(relatif)
    }
  }

  descendre(racine, '')
  return out.sort()
}
