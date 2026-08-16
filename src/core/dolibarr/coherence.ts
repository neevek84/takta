/**
 * Le danger fermé ici : rien n'empêchait de rattacher un projet Dolibarr du
 * tiers A à une mission d'un client B. Les temps seraient quand même partis,
 * chez le mauvais client — et c'est sur eux que la facturation se fait dans
 * Dolibarr. `socid` porte l'identifiant du tiers auquel Dolibarr rattache le
 * projet ; c'est ce qu'on compare au tiers déjà rattaché au client de la
 * mission.
 *
 * Pur : aucune base, aucun réseau. L'appelant (`services/dolibarr/import.ts`)
 * résout les deux identifiants et les libellés avant d'appeler cette
 * fonction, qui ne fait que trancher et rédiger le refus.
 */
export function verifierCoherenceTiers(args: {
  /** référence du projet Dolibarr, pour le nommer dans un refus */
  projectRef: string
  /** tiers auquel Dolibarr rattache le projet ; null si le projet n'en porte aucun */
  projectSocid: number | null
  /** nom du client local de la mission visée, pour le nommer dans un refus */
  clientLabel: string
  /**
   * tiers déjà rattaché au client de la mission ; null si ce client n'est pas
   * encore rattaché à un tiers Dolibarr
   */
  expectedThirdpartyId: number | null
}): void {
  // Un projet sans tiers ne peut contredire personne : Dolibarr l'autorise
  // (un projet interne, par exemple), et il n'y a rien ici à affirmer.
  if (args.projectSocid === null) return

  // Le projet porte un tiers réel, mais le client de la mission n'est pas
  // encore rattaché à Dolibarr : aucune comparaison n'est possible. Autoriser
  // silencieusement laisserait passer exactement le danger qu'on ferme —
  // l'ordre est donc imposé : le client se rattache d'abord.
  if (args.expectedThirdpartyId === null) {
    throw new Error(
      `Le projet « ${args.projectRef} » appartient au tiers Dolibarr n° ${args.projectSocid}, ` +
        `mais « ${args.clientLabel} » n'est encore rattaché à aucun tiers Dolibarr. ` +
        `Rattachez d'abord le tiers de « ${args.clientLabel} » avant de rattacher ce projet.`,
    )
  }

  if (args.projectSocid !== args.expectedThirdpartyId) {
    throw new Error(
      `Le projet « ${args.projectRef} » appartient au tiers Dolibarr n° ${args.projectSocid}, ` +
        `mais « ${args.clientLabel} » est rattaché au tiers Dolibarr n° ${args.expectedThirdpartyId}. ` +
        `Rattachement refusé : les temps partiraient chez le mauvais client.`,
    )
  }
}
