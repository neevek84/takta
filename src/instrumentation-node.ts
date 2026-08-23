/**
 * Ce que le serveur Node fait à son démarrage, et que le runtime edge ne doit
 * jamais voir : la chaîne de l'ordonnanceur tire `nodemailer`, qui demande
 * `stream`.
 */

export async function demarrerLeServeur(): Promise<void> {
  await poserLaDurabiliteSqlite()
  await demarrerLOrdonnanceur()
}

async function poserLaDurabiliteSqlite(): Promise<void> {
  const { estSqlite } = await import('./db/durabilite')
  if (!estSqlite(process.env.DATABASE_URL ?? '')) return

  const { assurerDurabilite } = await import('./db/client')
  await assurerDurabilite()
  // Aucun secret ici : ni l'URL, ni le chemin de la base ne sont écrits.
  console.log('Base locale : journalisation WAL et attente du disque (synchronous=FULL) posées.')
}

/**
 * **L'application porte sa propre horloge**, et c'est ici qu'elle la remonte.
 *
 * L'ordonnanceur attendait auparavant qu'un déclencheur extérieur appelle
 * `POST /api/jobs/tick`. L'API existe pour que d'autres outils viennent parler
 * à l'application — pas pour que l'application se fasse marcher elle-même :
 * une synchronisation qui ne part que si quelqu'un a pensé à poser un cron
 * n'est pas une fonction du produit, et son oubli ne se voit qu'à l'absence de
 * ce qui aurait dû arriver.
 *
 * **La construction ne doit pas la remonter.** `next build` exécute lui aussi
 * ce point d'entrée : sans cette garde, chaque construction ouvrirait la base
 * de développement de qui construit, et y ferait tourner de vrais travaux.
 */
async function demarrerLOrdonnanceur(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { demarrerHorloge, INTERVALLE_MS } = await import('./services/jobs/horloge')
  if (demarrerHorloge()) {
    console.log(`Ordonnanceur : reveil interne toutes les ${INTERVALLE_MS / 60_000} minutes.`)
  }
}
