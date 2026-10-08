/**
 * Quatre vues : le calendrier — la seule surface de saisie mobile —, le
 * tableau multi-CRA, la vue 3 mois, et le tableau 3 mois — le tableau
 * multi-CRA étendu au mois choisi et aux deux suivants. Type partagé entre
 * `SaisieClient`, qui l'affiche, et le service de préférence de profil, qui la
 * persiste : les deux doivent reconnaître exactement les mêmes valeurs.
 */
export type Vue = 'CALENDRIER' | 'TROIS_MOIS' | 'TABLEAU' | 'TABLEAU_TROIS_MOIS'

const VUES: readonly Vue[] = ['CALENDRIER', 'TROIS_MOIS', 'TABLEAU', 'TABLEAU_TROIS_MOIS']

/** Garde de type : une valeur lue en base ou postée par un formulaire n'est jamais une `Vue` de confiance. */
export function estVue(valeur: string): valeur is Vue {
  return (VUES as readonly string[]).includes(valeur)
}
