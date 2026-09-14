import { minutesBetween } from '../time/slots'

const MINUIT = 1440

/** Un intervalle de la journée, en minutes depuis minuit. */
export interface Intervalle {
  startMinute: number
  /** une fin inférieure ou égale au début franchit minuit */
  endMinute: number
}

/** Les bornes en minutes absolues du jour : la fin peut dépasser minuit. */
function deplier(i: Intervalle): { debut: number; fin: number } {
  return { debut: i.startMinute, fin: i.startMinute + minutesBetween(i.startMinute, i.endMinute) }
}

/**
 * Les trajets à poser autour d'une saisie chez le client : un aller collé à son
 * début, un retour collé à sa fin.
 *
 * Chacun est **raccourci** pour ne recouvrir ni un trajet déjà posé, ni un
 * autre bloc de travail, et n'est pas posé du tout s'il ne reste rien. C'est ce
 * qui tient ensemble deux choix du porteur : les trajets sont posés puis
 * oubliés — un trajet posé ne se modifie jamais —, et deux trajets qui se
 * touchent ne se superposent pas. Le prix : deux blocs contigus là où un seul
 * aurait suffi, l'agenda restant occupé sur toute la plage, ce qui est le but.
 *
 * Un trajet ne franchit jamais minuit : il est tronqué, et un bloc qui finit à
 * minuit ou au-delà n'a pas de retour — il appartiendrait au lendemain.
 */
export function trajetsAPoser(args: {
  bloc: Intervalle
  dureeMinutes: number
  dejaPoses: readonly Intervalle[]
  autresBlocs: readonly Intervalle[]
}): Intervalle[] {
  if (args.dureeMinutes <= 0) return []

  const bloc = deplier(args.bloc)
  const obstacles = [...args.dejaPoses, ...args.autresBlocs].map(deplier)
  const trajets: Intervalle[] = []

  // L'aller se raccourcit par la gauche : il reste collé au début du bloc.
  let debutAller = Math.max(0, bloc.debut - args.dureeMinutes)
  for (const o of obstacles) {
    if (o.debut < bloc.debut && o.fin > debutAller) debutAller = Math.max(debutAller, o.fin)
  }
  if (debutAller < bloc.debut) trajets.push({ startMinute: debutAller, endMinute: bloc.debut })

  // Le retour se raccourcit par la droite : il reste collé à la fin du bloc.
  if (bloc.fin < MINUIT) {
    let finRetour = Math.min(MINUIT, bloc.fin + args.dureeMinutes)
    for (const o of obstacles) {
      if (o.fin > bloc.fin && o.debut < finRetour) finRetour = Math.min(finRetour, o.debut)
    }
    // Minuit se note 0, comme la fin de toute saisie.
    if (finRetour > bloc.fin) trajets.push({ startMinute: bloc.fin, endMinute: finRetour % MINUIT })
  }

  return trajets
}
