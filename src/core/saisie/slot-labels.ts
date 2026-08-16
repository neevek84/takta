import type { Slot } from '../time/slots'

/**
 * Libellé d'un créneau, tel que réglé en administration. Un créneau retiré
 * des réglages après la saisie n'y figure plus : on retombe alors sur son
 * identifiant, jamais sur un message vide ou « undefined ».
 */
function libelleCreneau(slotId: string, slots: readonly Slot[]): string {
  return slots.find((s) => s.id === slotId)?.label ?? slotId
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
