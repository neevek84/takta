/**
 * Ce qu'un CRA couvre : toute une mission, ou une seule de ses prestations.
 *
 * **Le besoin.** Un projet renouvelé par commandes successives est suivi dans
 * une seule mission — c'est le même projet Dolibarr, le même client, le même
 * interlocuteur —, chaque commande y étant une prestation. Mais chaque commande
 * se facture à part, et pas en même temps : il lui faut son CRA, son envoi, sa
 * validation et sa facture.
 *
 * C'est un **réglage de la mission** (`Mission.modeCra`), et non une question
 * posée à chaque génération : laisser choisir à chaque fois permettrait de
 * générer en octobre un CRA de mission puis un CRA de prestation sur les mêmes
 * jours — et de les facturer deux fois.
 *
 * Le CRA porte la prestation qu'il couvre dans `Cra.lineId`, vide pour toute la
 * mission. Un CRA déjà envoyé ou validé garde ce qu'il couvrait quand la
 * mission change de réglage : c'est pourquoi tout ce qui juge du verrou d'une
 * saisie passe par `couvreLaLigne`, qui accepte les deux formes.
 */

export type ModeCra = 'MISSION' | 'PRESTATION'

export const MODES_CRA: readonly ModeCra[] = ['MISSION', 'PRESTATION']

export const LIBELLES_MODE_CRA: Record<ModeCra, string> = {
  MISSION: 'Un CRA pour la mission',
  PRESTATION: 'Un CRA par prestation',
}

/** `Cra.lineId` d'un CRA qui couvre toute sa mission. */
export const TOUTE_LA_MISSION = ''

export function estModeCra(valeur: unknown): valeur is ModeCra {
  return valeur === 'MISSION' || valeur === 'PRESTATION'
}

/**
 * Le `Cra.lineId` que porte le CRA d'une saisie sur `lineId`, selon le réglage
 * de sa mission. Une valeur inconnue en base vaut le défaut : un CRA pour la
 * mission, le comportement historique.
 */
export function perimetreDuCra(modeCra: string, lineId: string): string {
  return modeCra === 'PRESTATION' ? lineId : TOUTE_LA_MISSION
}

/** Ce CRA (par son `lineId`) couvre-t-il les saisies de cette prestation ? */
export function couvreLaLigne(craLineId: string, lineId: string): boolean {
  return craLineId === TOUTE_LA_MISSION || craLineId === lineId
}

/**
 * Le libellé d'un CRA, tel qu'il s'imprime, s'envoie et se relance : sa
 * mission, suivie de sa prestation quand il n'en couvre qu'une. Deux commandes
 * d'un même projet, le même mois, se confondraient sinon dans le titre du
 * courriel, le nom du fichier et l'en-tête du document.
 */
export function libelleDuCra(cra: {
  lineId: string
  mission: { label: string; lines: ReadonlyArray<{ id: string; label: string }> }
}): string {
  if (cra.lineId === TOUTE_LA_MISSION) return cra.mission.label
  const prestation = cra.mission.lines.find((l) => l.id === cra.lineId)?.label
  return prestation === undefined ? cra.mission.label : `${cra.mission.label} · ${prestation}`
}
