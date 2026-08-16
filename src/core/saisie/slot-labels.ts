import { crossesMidnight } from '../time/slots'
import type { Slot } from '../time/slots'

/** Midi, en minutes depuis minuit : la frontière entre les deux moitiés. */
const MIDI = 720

/**
 * La moitié de journée d'un créneau — celle que le dessin de la case range
 * au-dessus ou en dessous de la diagonale, et que l'interface nomme « AM » ou
 * « PM ».
 *
 * `null` pour un créneau qui franchit minuit : il est des deux côtés de midi à
 * la fois, et le ranger d'un côté mentirait. Il reste saisissable, et se
 * dessine à sa proportion (voir `formeDeLaCase`).
 */
export type MomentDeJournee = 'AM' | 'PM'

export function momentDeJournee(slot: Slot): MomentDeJournee | null {
  if (crossesMidnight(slot)) return null
  return slot.startMinute < MIDI ? 'AM' : 'PM'
}

/**
 * Libellé d'un créneau, tel que réglé en administration. Un créneau retiré
 * des réglages après la saisie n'y figure plus : on retombe alors sur son
 * identifiant, jamais sur un message vide ou « undefined ».
 */
function libelleCreneau(slotId: string, slots: readonly Slot[]): string {
  return slots.find((s) => s.id === slotId)?.label ?? slotId
}

/**
 * Ce qu'une demi-journée affiche, en court : « ½ AM » ou « ½ PM ».
 *
 * Le porteur les veut partout — cinématique, formulaire, légende, infobulle —
 * pour lever l'ambiguïté des initiales : « ½ M » et « ½ A » se ressemblent
 * trop dans une case de 44 points, et « M » pouvait aussi bien dire « Matin »
 * que « Midi ». AM et PM sont universels.
 *
 * Un créneau sans moitié — celui qui franchit minuit, ou un créneau
 * supplémentaire réglé en administration — garde son libellé : lui coller
 * « AM » ou « PM » dirait quelque chose de faux.
 */
export function libelleDemiJournee(slotId: string, slots: readonly Slot[]): string {
  const slot = slots.find((s) => s.id === slotId)
  const moment = slot === undefined ? null : momentDeJournee(slot)
  return `½ ${moment ?? libelleCreneau(slotId, slots)}`
}

/**
 * Un créneau nommé, avec sa moitié de journée en précision : « Matin (AM) ».
 *
 * Pas « ½ AM » : le formulaire de durée libre n'écrit pas forcément une
 * demi-journée — on y saisit trois heures sur le créneau du matin —, et la
 * fraction y annoncerait une quantité que la saisie ne porte pas.
 */
export function libelleCreneauAvecMoment(slotId: string, slots: readonly Slot[]): string {
  const slot = slots.find((s) => s.id === slotId)
  const moment = slot === undefined ? null : momentDeJournee(slot)
  const libelle = libelleCreneau(slotId, slots)
  return moment === null ? libelle : `${libelle} (${moment})`
}

/**
 * Le même, en long : l'abréviation universelle **et** le libellé réglé en
 * administration, pour l'infobulle et le formulaire, où la place ne manque
 * pas. Un créneau sans moitié n'a qu'un seul nom : on ne le redit pas deux
 * fois.
 */
export function libelleDemiJourneeDetaille(slotId: string, slots: readonly Slot[]): string {
  const court = libelleDemiJournee(slotId, slots)
  const libelle = libelleCreneau(slotId, slots)
  return court === `½ ${libelle}` ? court : `${court} — ${libelle}`
}

/**
 * Le signalement d'un créneau que la ligne ne prévoit pas — vue tableau.
 *
 * Même fait, mêmes mots que la vue calendrier (`applyCellState`, lot 0) : les
 * deux vues affichaient jusqu'ici le même écart sous deux vocabulaires,
 * libellés réglés en administration d'un côté, identifiants bruts de
 * l'autre — cette fonction est le point unique que les deux doivent
 * désormais appeler pour rester d'accord.
 */
export function phraseCreneauNonPrevu(
  allowedSlotIds: readonly string[],
  slots: readonly Slot[],
): string {
  const libelles = allowedSlotIds.map((id) => libelleCreneau(id, slots)).join(', ')
  return `Ce créneau n’est pas prévu pour cette ligne (créneaux prévus : ${libelles}). La saisie est conservée.`
}
