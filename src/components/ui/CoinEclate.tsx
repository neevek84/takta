/**
 * Le coin d'une journée éclatée — une journée saisie en plusieurs créneaux.
 *
 * Partagé par les deux vues de `/saisie/[month]`, et pour la même raison
 * qu'`Aplat` l'est déjà : c'est le même fait, sur le même écran, et une
 * bascule de vue ne doit pas en montrer deux dessins. Le calendrier l'a reçu
 * le premier ; le tableau est resté au liseré seul, c'est-à-dire au défaut
 * corrigé ici.
 *
 * C'est un avertissement, et il doit se voir sur **n'importe quel** fond de
 * case : `surface`, `off`, `off-strong`, l'aplat de saisie, celui du
 * prévisionnel et les six aplats catégoriels, dans les cinq préréglages.
 *
 * Le liseré `warning-edge` ne le pouvait pas. Mesuré entre `warningEdge` et
 * `prevu` : ΔL\* = 1,63 en Encre clair — le préréglage par défaut —, contre
 * 3,46 en Neutre clair et 4,90 en KreativPM, quand le projet s'impose
 * `MIN_LIGHTNESS_GAP` = 4 pour qu'un état se lise sans distinguer les teintes.
 * Aucune valeur de bordure ne pouvait le sauver : elle aurait à tenir contre
 * onze fonds inconnus d'avance, dont un ambre et six teintes catégorielles.
 * C'est la leçon du lot 1f, qui a remplacé les hachures du prévisionnel par
 * une horloge pour exactement cette raison.
 *
 * Ce coin ne repose donc sur aucun rapport de clarté contre un fond inconnu :
 * il est peint en `currentColor`, c'est-à-dire de **l'encre de la case** —
 * celle qui écrit déjà le chiffre du jour, et que `TEXT_PAIRS` tient à 4,5:1
 * sur les onze fonds. Il change de couleur avec le fond au lieu de le subir.
 *
 * Posé en absolu, comme l'aplat : au calendrier, la ligne du numéro du jour
 * porte déjà le losange d'occupation et l'horloge du prévisionnel ; au
 * tableau, le champ recouvre exactement la cellule de 44 points. Un glyphe
 * dans l'un ou l'autre de ces flux ferait tomber le budget des colonnes.
 *
 * Le liseré, lui, reste — comme renfort là où il se voit, jamais comme le seul
 * porteur de l'information.
 */
const COTE_DU_COIN = 9

export function CoinEclate({ cle }: {
  /** ce qui identifie la case : la date au calendrier, ligne et date au tableau */
  cle: string
}) {
  return (
    <svg
      aria-hidden="true"
      data-testid={`eclatement-${cle}`}
      width={COTE_DU_COIN}
      height={COTE_DU_COIN}
      viewBox={`0 0 ${COTE_DU_COIN} ${COTE_DU_COIN}`}
      className="pointer-events-none absolute top-0 left-0"
    >
      <path d={`M0 0H${COTE_DU_COIN}L0 ${COTE_DU_COIN}Z`} fill="currentColor" />
    </svg>
  )
}
