import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Découpe un fichier de migration en instructions exécutables.
 *
 * Volontairement naïf : commentaires de ligne retirés, découpe sur ';'. Le SQL
 * produit par `prisma migrate diff` ne contient aucun point-virgule à
 * l'intérieur d'un littéral — et `src/distribution/migrations-sqlite.test.ts`
 * échoue si cela venait à changer. Rien de plus riche n'est nécessaire, et un
 * analyseur complet serait du code non couvert par l'usage réel.
 */
export function decouperSql(sql) {
  return sql
    .split('\n')
    .map((ligne) => (ligne.trimStart().startsWith('--') ? '' : ligne))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Dossiers de migration, triés — le préfixe horodaté fait du tri lexical un tri chronologique. */
export function migrationsDisponibles(dossier) {
  return readdirSync(dossier, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

/**
 * Pose la journalisation WAL et vérifie qu'elle a bien pris.
 *
 * Hors transaction : SQLite refuse un changement de mode de journalisation à
 * l'intérieur d'une. WAL est une propriété persistante du fichier, donc écrite
 * une fois et retrouvée à chaque ouverture — on la (re)pose quand même à chaque
 * démarrage, c'est gratuit et cela rattrape un fichier restauré depuis une
 * sauvegarde prise autrement.
 *
 * La valeur rendue par `PRAGMA journal_mode=WAL` est le mode effectivement en
 * vigueur après la commande, et non un accusé de réception : SQLite refuse
 * silencieusement le passage en WAL sur certains systèmes de fichiers (partages
 * réseau, notamment) et rend alors l'ancien mode. On la relit donc, et on
 * refuse de continuer si ce n'est pas `wal` : le LISEZMOI promet qu'éteindre ne
 * perd rien, et cette promesse ne tient que par la journalisation.
 */
async function poserWal(prisma) {
  const pose = await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL')

  // WAL seul ne suffit pas à la phrase « couper l'ordinateur ne perd rien » :
  // avec `synchronous=NORMAL`, un commit survit à l'arrêt du processus mais pas
  // forcément à une coupure de courant, SQLite n'attendant plus la confirmation
  // du disque. Prisma laisse aujourd'hui la valeur par défaut FULL (mesuré : 2)
  // — mais c'est une valeur par défaut, pas un engagement. On la pose donc
  // explicitement. Le coût, un fsync par transaction, est sans objet pour une
  // application de bureau à un seul utilisateur.
  await prisma.$executeRawUnsafe('PRAGMA synchronous=FULL')

  const relu = await prisma.$queryRawUnsafe('PRAGMA journal_mode')
  const mode = String(relu?.[0]?.journal_mode ?? pose?.[0]?.journal_mode ?? '').toLowerCase()

  if (mode !== 'wal') {
    throw new Error(
      `SQLite a refusé la journalisation WAL (mode obtenu : « ${mode} »).\n` +
        "La durabilité annoncée dans le LISEZMOI ne serait plus garantie : démarrage interrompu.\n" +
        "Cause la plus fréquente : le dossier est sur un partage réseau (SMB, NFS, Dropbox,\n" +
        'OneDrive…), où SQLite ne peut pas poser WAL. Déplace le dossier sur un disque local.',
    )
  }
}

/**
 * Met la base en WAL puis applique les migrations en attente.
 *
 * `avantMigration` n'est appelé que si des migrations restent à jouer ET que la
 * base en a déjà vu passer : à la toute première création il n'y a rien à
 * perdre. Une migration ratée se rattrape depuis la copie ; sans copie, non.
 *
 * @param {{
 *   prisma: any,
 *   dossier: string,
 *   avantMigration?: (() => string | Promise<string>) | null,
 * }} options
 * @returns {Promise<{ appliquees: string[], sauvegarde: string | null }>}
 */
export async function appliquerMigrations({ prisma, dossier, avantMigration = null }) {
  await poserWal(prisma)

  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "_cra_migrations" (' +
      '"nom" TEXT NOT NULL PRIMARY KEY, "appliqueeLe" TEXT NOT NULL)',
  )

  const deja = new Set(
    (await prisma.$queryRawUnsafe('SELECT nom FROM "_cra_migrations"')).map((r) => r.nom),
  )
  const attente = migrationsDisponibles(dossier).filter((nom) => !deja.has(nom))
  if (attente.length === 0) return { appliquees: [], sauvegarde: null }

  const sauvegarde = deja.size > 0 && avantMigration ? await avantMigration() : null

  for (const nom of attente) {
    const sql = readFileSync(path.join(dossier, nom, 'migration.sql'), 'utf8')
    await prisma.$transaction([
      ...decouperSql(sql).map((instruction) => prisma.$executeRawUnsafe(instruction)),
      prisma.$executeRawUnsafe(
        'INSERT INTO "_cra_migrations" ("nom","appliqueeLe") VALUES (?, ?)',
        nom,
        new Date().toISOString(),
      ),
    ])
  }

  return { appliquees: attente, sauvegarde }
}
