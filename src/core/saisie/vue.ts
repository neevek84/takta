/**
 * Trois vues : le calendrier — la seule surface de saisie mobile —, le
 * tableau multi-CRA, et la vue 3 mois. Type partagé entre `SaisieClient`, qui
 * l'affiche, et le service de préférence de profil, qui la persiste : les
 * deux doivent reconnaître exactement les mêmes valeurs.
 */
export type Vue = 'CALENDRIER' | 'TROIS_MOIS' | 'TABLEAU'

const VUES: readonly Vue[] = ['CALENDRIER', 'TROIS_MOIS', 'TABLEAU']

/** Garde de type : une valeur lue en base ou postée par un formulaire n'est jamais une `Vue` de confiance. */
export function estVue(valeur: string): valeur is Vue {
  return (VUES as readonly string[]).includes(valeur)
}
