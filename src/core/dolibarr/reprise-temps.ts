/**
 * Les règles pures de la reprise des temps déjà saisis dans Dolibarr.
 *
 * Pur : aucune base, aucun réseau, aucun `Date.now()`. Le jour de référence est
 * toujours passé en argument — une coupure qui dépend de l'horloge de la
 * machine ne se teste pas, et se déplace toute seule.
 */

/**
 * L'heure par défaut d'un temps repris : **9 h**, exprimée en minutes depuis
 * minuit.
 *
 * Arbitrage du porteur, le 21 août 2026 : il n'a jamais renseigné l'heure d'un
 * temps passé, et l'heure d'une reprise n'engage rien — elle sert l'unicité,
 * pas la mesure. C'est aussi le défaut que porte déjà `TimeEntry.startMinute`,
 * et les deux doivent rester d'accord.
 */
export const MINUTE_PAR_DEFAUT = 540

/** La dernière minute d'une journée, bornant tout créneau. */
const DERNIERE_MINUTE = 1439

/**
 * Le dernier jour du mois précédent, `'YYYY-MM-DD'` — la coupure de la reprise.
 *
 * **Pourquoi cette borne et pas une autre.** Le mois en cours se saisit dans
 * l'application, qui le poussera ; le reprendre ferait exister le même temps
 * des deux côtés. Et comme le porteur doit supprimer lui-même, chez Dolibarr,
 * les temps du mois en cours qu'il va ressaisir, une coupure au mois près borne
 * ce travail à un mois au lieu de tout un historique.
 */
export function dernierJourDuMoisPrecedent(aujourdhui: string): string {
  const [annee, mois] = aujourdhui.split('-').map(Number)
  // Le jour 0 d'un mois est le dernier du mois d'avant — y compris en janvier,
  // où `Date.UTC` recule d'une année sans qu'on ait à le dire.
  const veille = new Date(Date.UTC(annee!, mois! - 1, 0))
  return veille.toISOString().slice(0, 10)
}

/**
 * L'heure d'un instant, en minutes depuis minuit **dans le fuseau donné**.
 *
 * Dolibarr range ses horodatages en GMT : un temps saisi à 7 h à Paris en
 * novembre revient à 6 h GMT. Lire l'heure en UTC décalerait donc toute la
 * reprise d'une heure l'hiver et de deux l'été — et le décalage changerait au
 * milieu d'un import couvrant mars ou octobre.
 */
export function minutesDepuisMinuitLocal(instantUnix: number, timeZone: string): number {
  const parties = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    // `hourCycle` explicite plutôt que `hour12: false`, dont le rendu de
    // minuit — « 00 » ou « 24 » — dépend de l'implémentation. `h23` le fixe.
    hourCycle: 'h23',
  }).formatToParts(new Date(instantUnix * 1000))

  const valeur = (type: string) => Number(parties.find((p) => p.type === type)?.value ?? 0)
  return valeur('hour') * 60 + valeur('minute')
}

/** Un temps à placer dans la journée, tel que la reprise le connaît. */
export interface TempsAPlacer {
  /** minute de début que Dolibarr porte, `null` quand il n'en porte pas */
  minuteProposee: number | null
  durationSeconds: number
}

export interface Creneau {
  startMinute: number
  endMinute: number
}

/**
 * Place les temps d'une même journée sur la même prestation, sans que deux
 * partagent une minute de début.
 *
 * **Pourquoi il faut placer.** La clé d'unicité d'une saisie porte l'heure de
 * début : deux temps du même jour sur la même prestation doivent en recevoir
 * deux distinctes, sans quoi le second remplacerait le premier. Dolibarr, lui,
 * ne connaît qu'une date et une durée.
 *
 * **Le décalage suit les durées, jamais un pas fixe.** Le suivant commence à la
 * fin du précédent : un pas d'une heure mentirait sur une saisie d'une
 * demi-journée, et ferait se chevaucher deux blocs que l'écran dessine.
 *
 * `dejaPrises` porte les minutes de début déjà occupées en base pour cette
 * journée — une reprise rejouée ne doit pas écraser ce qu'elle a posé la
 * première fois.
 */
export function placerLesCreneaux(
  temps: readonly TempsAPlacer[],
  dejaPrises: readonly number[] = [],
): Creneau[] {
  const prises = new Set(dejaPrises)
  const creneaux: Creneau[] = []

  // L'ordre est celui des heures proposées : sans tri, un temps de 14 h importé
  // avant un temps de 9 h repousserait celui de 9 h à 17 h.
  const ordonnes = [...temps].sort(
    (a, b) => (a.minuteProposee ?? MINUTE_PAR_DEFAUT) - (b.minuteProposee ?? MINUTE_PAR_DEFAUT),
  )

  let plancher = 0
  for (const t of ordonnes) {
    const duree = Math.max(1, Math.round(t.durationSeconds / 60))
    let debut = Math.max(t.minuteProposee ?? MINUTE_PAR_DEFAUT, plancher)
    while (prises.has(debut) && debut < DERNIERE_MINUTE) debut += 1
    // Une journée ne porte que 1 440 minutes : au-delà, le dernier créneau
    // s'appuie sur la fin de la journée plutôt que de déborder sur le lendemain,
    // qui appartient à une autre saisie.
    if (debut > DERNIERE_MINUTE) debut = DERNIERE_MINUTE

    const fin = Math.min(debut + duree, DERNIERE_MINUTE)
    creneaux.push({ startMinute: debut, endMinute: fin })
    prises.add(debut)
    plancher = fin
  }

  return creneaux
}
