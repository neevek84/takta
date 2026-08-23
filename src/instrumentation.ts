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
  // **La forme positive est obligatoire.** Next compile ce fichier pour les
  // deux runtimes et remplace `NEXT_RUNTIME` par une constante dans chacun :
  // c'est ce qui lui permet d'éliminer la branche entière du paquet edge, avec
  // tout ce qu'elle importe. Écrite en sortie anticipée — « si ce n'est pas
  // Node, on s'en va » — l'élimination ne se fait pas, et la construction
  // échoue sur `nodemailer`, qui demande `stream`.
  //
  // `undefined` couvre les tests, où Next ne pose rien.
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === undefined) {
    const { demarrerLeServeur } = await import('./instrumentation-node')
    await demarrerLeServeur()
  }
}
