/**
 * Le catalogue est **exactement** la liste des actes consignés au journal :
 * un seul vocabulaire pour la preuve, pour l'API et pour les rappels
 * sortants — trois usages, une nomenclature, aucune divergence possible.
 *
 * C'est un **contrat public**. Un consommateur (n8n, un script, ce qui
 * remplacera n8n) s'abonne par ces noms : les renommer casse silencieusement
 * des flux qu'on ne voit pas depuis ce dépôt. Ajouter une valeur est une
 * décision de conception, pas un effet de bord — un catalogue qui grossit
 * sans discipline devient inutilisable pour celui qui doit choisir à quoi
 * s'abonner.
 *
 * **`facture.demandee` n'y figure pas**, contrairement à la table de la spec
 * du lot 4. La demande de facture a été retirée du produit (commit `c1aeb8c`) :
 * Dolibarr facture depuis ses propres écrans, son API REST n'expose pas
 * l'action, et notre demande créait une facture parallèle que Dolibarr ne
 * reliait à rien. Publier un événement pour un acte qui n'existe plus serait
 * une promesse fausse — un intégrateur s'y abonnerait et attendrait
 * indéfiniment. Ce qui subsiste, en revanche, c'est le suivi **manuel** porté
 * par le CRA (numéro de facture, date de facturation, date de paiement) :
 * c'est un acte, il engage, et c'est lui que `facturation.renseignee`
 * consigne. Le catalogue compte donc toujours 25 entrées.
 */
export const AUDIT_ACTIONS = [
  // Saisie
  'saisie.creee',
  'saisie.modifiee',
  'saisie.supprimee',
  'previsionnel.converti',
  // CRA
  'cra.ouvert',
  'cra.envoye',
  'cra.valide',
  'cra.refuse',
  'cra.rouvert',
  /// suivi de facturation saisi à la main sur le CRA — jamais un calcul
  'facturation.renseignee',
  // Référentiel
  'client.cree',
  'mission.creee',
  'prestation.creee',
  // Dolibarr — émis par le lot 2
  'temps.pousses',
  // Agenda — émis par le lot 1b
  'agenda.bloc.pousse',
  'agenda.conflit.detecte',
  // Signature — émis par le lot 3
  'signature.envoyee',
  'signature.recue',
  'signature.refusee',
  // Alertes
  'engagement.depasse',
  'capacite.depassee',
  // Exploitation
  'reglage.modifie',
  'reetalonnage.effectue',
  'synchro.echec',
  'travail.echoue',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

const CATALOGUE: ReadonlySet<string> = new Set(AUDIT_ACTIONS)

export function isAuditAction(valeur: string): valeur is AuditAction {
  return CATALOGUE.has(valeur)
}

/**
 * Les événements souscrits sont persistés en **chaîne séparée par des
 * virgules**, jamais en tableau : la portabilité SQLite/Postgres l'impose,
 * comme `Settings.workingDays` et `MissionLine.allowedSlotIds`.
 *
 * Les noms hors catalogue sont écartés silencieusement plutôt que de lever :
 * un abonnement enregistré avant le retrait d'un événement doit continuer de
 * fonctionner pour les autres noms qu'il porte.
 */
export function parseSubscription(brut: string): AuditAction[] {
  return brut
    .split(',')
    .map((nom) => nom.trim())
    .filter(isAuditAction)
}

export function serializeSubscription(actions: ReadonlyArray<AuditAction>): string {
  return actions.join(',')
}

/**
 * Une valeur vide signifie « tous les événements ». Une valeur **non vide
 * dont aucun nom n'est reconnu** ne reçoit rien : le repli sûr est le
 * silence, pas l'inondation d'une URL qui n'a rien demandé.
 */
export function matchesSubscription(brut: string, action: AuditAction): boolean {
  if (brut.trim() === '') return true
  return parseSubscription(brut).includes(action)
}
