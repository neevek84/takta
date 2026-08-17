/**
 * Durabilité de la base portable — l'endroit où le serveur l'applique vraiment.
 *
 * Le mode d'emploi promet : « Fermer la fenetre, arreter le programme ou couper
 * l'ordinateur ne fait perdre aucune saisie deja enregistree. » Deux réglages
 * SQLite la portent, et ils n'ont pas du tout la même nature :
 *
 *  - `journal_mode=WAL` est une propriété **persistante du fichier** : posée une
 *    fois, retrouvée à chaque ouverture, par n'importe quel processus. C'est
 *    elle qui couvre l'arrêt du programme.
 *  - `synchronous=FULL` est une propriété **de la connexion** : elle ne franchit
 *    ni la fermeture, ni le processus voisin. C'est elle qui couvre la coupure
 *    de courant, en faisant attendre à SQLite la confirmation du disque.
 *
 * Le lanceur posait la seconde sur SA connexion, refermée avant le `spawn` du
 * serveur. Le serveur, autre processus, n'en posait aucune : la promesse tenait
 * par la valeur par défaut compilée de SQLite (2, mesuré) — c'est-à-dire par la
 * chose même que le commentaire du lanceur déclarait ne pas vouloir croire.
 *
 * **Une seule connexion.** Mesuré ici, et c'est ce qui commande tout le reste :
 * le pool SQLite de Prisma ouvre plusieurs connexions, et un `PRAGMA
 * synchronous=FULL` n'en atteint qu'une. Même envoyé soixante-quatre fois en
 * parallèle, il en laissait à leur valeur par défaut. Poser le pragma « côté
 * application au démarrage » n'a donc de sens qu'avec `connection_limit=1` — et
 * c'est sans coût ici : l'application portable sert une seule personne, et
 * SQLite ne sait de toute façon écrire que l'un après l'autre.
 */

/** Vrai si cette URL désigne un fichier SQLite (mise en page portable). */
export function estSqlite(url: string): boolean {
  return url.startsWith('file:')
}

/**
 * L'URL à donner à Prisma pour que le pragma de durabilité couvre réellement
 * toutes les requêtes. Sans effet hors SQLite : l'image Docker vise PostgreSQL,
 * qui gère sa durabilité tout seul et a besoin de son pool.
 */
export function urlSqliteDurable(url: string): string {
  if (!estSqlite(url)) return url
  if (/[?&]connection_limit=/.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`
}

type ClientSql = {
  $queryRawUnsafe: (sql: string) => Promise<unknown>
  $executeRawUnsafe: (sql: string) => Promise<unknown>
}

function premiereValeur(brut: unknown, champ: string): unknown {
  const lignes = brut as Record<string, unknown>[] | undefined
  return lignes?.[0]?.[champ]
}

/**
 * Pose la journalisation WAL et l'attente du disque sur la connexion de CE
 * processus, puis les **relit** pour refuser de continuer sur une promesse
 * fausse.
 *
 * La relecture n'est pas décorative : c'est elle qui distingue un garde-fou
 * d'une intention. Un SQLite compilé avec `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`
 * (beaucoup de constructions le font) ramènerait `synchronous` à NORMAL sans
 * rien dire, et la moitié « couper l'ordinateur » de la promesse tomberait en
 * silence.
 */
export async function poserDurabiliteSqlite(
  prisma: ClientSql,
  url: string = process.env.DATABASE_URL ?? '',
): Promise<void> {
  if (!estSqlite(url)) return

  // Hors transaction : SQLite refuse un changement de mode de journalisation à
  // l'intérieur d'une. En lecture (`$queryRawUnsafe`) : la commande rend le
  // mode effectivement en vigueur après coup, et SQLite refuse une écriture
  // qui rendrait des lignes.
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL')
  await prisma.$executeRawUnsafe('PRAGMA synchronous=FULL')

  const mode = String(
    premiereValeur(await prisma.$queryRawUnsafe('PRAGMA journal_mode'), 'journal_mode') ?? '',
  ).toLowerCase()
  if (mode !== 'wal') {
    throw new Error(
      `SQLite a refusé la journalisation WAL (mode obtenu : « ${mode} »). ` +
        "La durabilité annoncée dans le mode d'emploi ne serait plus garantie. " +
        'Cause la plus fréquente : la base est sur un partage réseau (SMB, NFS, Dropbox, ' +
        'OneDrive…). Déplace le dossier sur un disque local.',
    )
  }

  const attente = Number(
    premiereValeur(await prisma.$queryRawUnsafe('PRAGMA synchronous'), 'synchronous') ?? -1,
  )
  if (attente !== 2) {
    throw new Error(
      `SQLite n'a pas retenu « synchronous=FULL » (valeur obtenue : ${attente}). ` +
        "Une coupure de courant pourrait perdre les dernières saisies, ce que le mode d'emploi " +
        'promet le contraire : démarrage interrompu plutôt que promesse fausse.',
    )
  }
}
