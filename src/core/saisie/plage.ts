/**
 * Nombre de colonnes de la grille mensuelle. Une plage ne le franchit pas.
 *
 * Les indices reçus sont donc ceux de la **grille**, sept cases par ligne,
 * cases hors mois comprises — jamais ceux du mois, dont le premier jour tombe
 * rarement un lundi : `Math.floor(index / 7)` n'y désignerait pas des semaines.
 */
const COLONNES = 7

export type Position = 'SEULE' | 'DEBUT' | 'MILIEU' | 'FIN'

/**
 * Où se situe un jour dans sa suite de jours contigus au même état.
 *
 * Des jours contigus au même état sont **un seul fait** : un consultant ne
 * pense pas « lundi, mardi, mercredi » mais « j'étais chez eux toute la
 * semaine ». Les cases d'une suite fusionnent donc en un bloc.
 *
 * `cles[i]` vaut `null` dès que la case ne fusionne pas — vide, week-end,
 * demi-journée, hors mois — et deux jours ne fusionnent que si leurs clés sont
 * égales **et** s'ils appartiennent à la même ligne de la grille.
 *
 * La règle vit ici et non dans le composant pour la même raison que
 * `formeDeLaCase` : elle est pure, et se vérifie sans monter une case à
 * l'écran.
 */
export function positionDansLaPlage(
  index: number,
  cles: readonly (string | null)[],
): Position {
  const cle = cles[index]
  if (cle === null || cle === undefined) return 'SEULE'

  const memeSemaine = (a: number, b: number) =>
    Math.floor(a / COLONNES) === Math.floor(b / COLONNES)

  const avant = index > 0 && memeSemaine(index - 1, index) && cles[index - 1] === cle
  const apres =
    index + 1 < cles.length && memeSemaine(index, index + 1) && cles[index + 1] === cle

  if (avant && apres) return 'MILIEU'
  if (avant) return 'FIN'
  if (apres) return 'DEBUT'
  return 'SEULE'
}
