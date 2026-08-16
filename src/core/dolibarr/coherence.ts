/**
 * Le danger fermé ici : rien n'empêchait de rattacher un projet Dolibarr du
 * tiers A à une mission d'un client B. Les temps seraient quand même partis,
 * chez le mauvais client — et c'est sur eux que la facturation se fait dans
 * Dolibarr. `socid` porte l'identifiant du tiers auquel Dolibarr rattache
 * l'élément ; c'est ce qu'on compare au tiers déjà rattaché au client de la
 * mission.
 *
 * La garde ne vaut pas que pour les projets : reprendre la propale du tiers A
 * sur une mission du client B poserait le même engagement chez le mauvais
 * client. `elementLabel` ne change que la façon de nommer l'élément dans le
 * refus — le refus lui-même est le même, et c'est bien le but.
 *
 * Pur : aucune base, aucun réseau. L'appelant (`services/dolibarr/import.ts`,
 * `services/dolibarr/propal.ts`) résout les deux identifiants et les libellés
 * avant d'appeler cette fonction, qui ne fait que trancher et rédiger le refus.
 */
export function verifierCoherenceTiers(args: {
  /**
   * Désignation de l'élément rattaché, en tête de phrase, article compris —
   * « Le projet » par défaut, « La propale » pour une reprise de propale.
   */
  elementLabel?: string
  /** référence de l'élément Dolibarr, pour le nommer dans un refus */
  projectRef: string
  /** tiers auquel Dolibarr rattache l'élément ; null s'il n'en porte aucun */
  projectSocid: number | null
  /** nom du client local de la mission visée, pour le nommer dans un refus */
  clientLabel: string
  /**
   * tiers déjà rattaché au client de la mission ; null si ce client n'est pas
   * encore rattaché à un tiers Dolibarr
   */
  expectedThirdpartyId: number | null
}): void {
  const element = args.elementLabel ?? 'Le projet'

  // Un élément sans tiers ne peut contredire personne : Dolibarr l'autorise
  // (un projet interne, par exemple), et il n'y a rien ici à affirmer.
  if (args.projectSocid === null) return

  // L'élément porte un tiers réel, mais le client de la mission n'est pas
  // encore rattaché à Dolibarr : aucune comparaison n'est possible. Autoriser
  // silencieusement laisserait passer exactement le danger qu'on ferme —
  // l'ordre est donc imposé : le client se rattache d'abord.
  if (args.expectedThirdpartyId === null) {
    throw new Error(
      `${element} « ${args.projectRef} » appartient au tiers Dolibarr n° ${args.projectSocid}, ` +
        `mais « ${args.clientLabel} » n'est encore rattaché à aucun tiers Dolibarr. ` +
        `Rattachez d'abord le tiers de « ${args.clientLabel} » avant ce rattachement.`,
    )
  }

  if (args.projectSocid !== args.expectedThirdpartyId) {
    throw new Error(
      `${element} « ${args.projectRef} » appartient au tiers Dolibarr n° ${args.projectSocid}, ` +
        `mais « ${args.clientLabel} » est rattaché au tiers Dolibarr n° ${args.expectedThirdpartyId}. ` +
        `Rattachement refusé : les temps partiraient chez le mauvais client.`,
    )
  }
}
