/**
 * Point d'entrée que Next appelle une fois, au démarrage du serveur.
 *
 * C'est ici — et nulle part ailleurs — que la durabilité SQLite peut être posée
 * pour de bon. `synchronous=FULL` est une propriété de connexion : le lanceur la
 * posait sur la sienne, refermée avant même le `spawn`, si bien que le serveur
 * (un autre processus) n'en posait aucune. Le mode d'emploi promet pourtant que
 * « couper l'ordinateur » ne perd aucune saisie enregistrée.
 *
 * Next garantit que `register` s'achève avant que la moindre requête ne soit
 * servie : c'est donc le seul endroit qui pose le pragma, et le seul moment où
 * le poser a un sens. Le faire à l'import du client le ferait aussi pendant
 * `next build`, qui écrirait alors dans la base de développement de qui
 * construit.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== undefined && process.env.NEXT_RUNTIME !== 'nodejs') return

  const { assurerDurabilite } = await import('./db/client')
  const { estSqlite } = await import('./db/durabilite')
  const url = process.env.DATABASE_URL ?? ''
  if (!estSqlite(url)) return

  await assurerDurabilite()
  // Aucun secret ici : ni l'URL, ni le chemin de la base ne sont écrits.
  console.log('Base locale : journalisation WAL et attente du disque (synchronous=FULL) posées.')
}
