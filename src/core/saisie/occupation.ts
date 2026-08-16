/**
 * Ce que l'application dit d'un jour déjà pris dans l'agenda de l'utilisateur.
 *
 * Les deux vues de la saisie — calendrier et tableau — et le bandeau de
 * message reprennent ces mêmes mots. Les écrire trois fois les ferait diverger
 * au premier ajustement, et le même jour serait alors nommé de trois façons
 * sur le même écran.
 *
 * L'occupation ne bloque jamais rien : elle se marque comme le week-end se
 * grise. Les phrases le disent, et rien dans le code qui les consomme ne
 * refuse une saisie à cause d'elles.
 */
export const OCCUPATION_TITRE = 'Occupation dans votre agenda'

export function phraseOccupation(date: string): string {
  return `Votre agenda est déjà occupé le ${date}. La saisie est conservée.`
}
