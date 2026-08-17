/**
 * Le coin d'une cellule qui **totalise les créneaux d'un jour**.
 *
 * Ce n'est pas le même fait que la journée éclatée de `CoinEclate`, et c'est
 * tout l'objet de ce composant. Les deux conditions ont chacune raison dans
 * leur vue, mais elles ne disent pas la même chose :
 *
 * - le calendrier marque une journée saisie en **deux créneaux ou plus** —
 *   ouvrir le formulaire les remplacera toutes par une seule ;
 * - le tableau marque une cellule qui totalise des créneaux **dès le
 *   premier**, et qui refuse la frappe pour cette raison (`readOnly`).
 *
 * Un jour à un seul créneau porte donc la marque du tableau, pas celle du
 * calendrier. Tant que les deux vues employaient le même glyphe, le lecteur
 * qui bascule concluait à un même état et cherchait une seconde saisie qui
 * n'existe pas.
 *
 * Le dessin diffère donc, mais le **contrat**, lui, est identique — il n'y a
 * aucune raison de le rejouer autrement :
 *
 * - peint en `currentColor`, c'est-à-dire de l'encre de la cellule, que
 *   `TEXT_PAIRS` tient à 4,5:1 sur les onze fonds possibles. Une teinte propre
 *   aurait à tenir contre un ambre et six aplats catégoriels inconnus d'avance,
 *   ce qu'aucune valeur de bordure ne sait faire — c'est la mesure qui a coûté
 *   le liseré `warning-edge`, à 1,63 de L\* sur le préréglage par défaut ;
 * - posé en absolu : le champ recouvre exactement la cellule de 44 points, et
 *   un glyphe entré dans ce flux ferait tomber le budget des sept colonnes.
 *
 * Deux barres empilées plutôt qu'un triangle plein : la forme dit « plusieurs
 * choses additionnées », qui est exactement ce que la cellule fait.
 */
const COTE_DU_COIN = 9

export function CoinAgrege({ cle }: {
  /** ce qui identifie la cellule : ligne et date */
  cle: string
}) {
  return (
    <svg
      aria-hidden="true"
      data-testid={`agrege-${cle}`}
      width={COTE_DU_COIN}
      height={COTE_DU_COIN}
      viewBox={`0 0 ${COTE_DU_COIN} ${COTE_DU_COIN}`}
      className="pointer-events-none absolute top-0 left-0"
    >
      <path
        d="M0 1.5H9M0 4.5H6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  )
}
