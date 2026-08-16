import { signatureDeForme } from '@/core/saisie/forme'
import type { Forme } from '@/core/saisie/forme'
import type { LineColor } from '@/core/saisie/colors'

/**
 * La découpe qui donne sa moitié à l'aplat. Déclarée en utilitaires dans
 * `globals.css` : une découpe, jamais une opacité — le contrôle de contraste
 * porte sur des couleurs opaques, et un aplat à 45 % lui échapperait.
 */
const DECOUPE: Record<string, string> = {
  'MOITIE-AM': 'clip-half-am',
  'MOITIE-PM': 'clip-half-pm',
}

/**
 * Hauteur de l'aplat, en pourcentage de la case.
 *
 * L'arrondi n'est pas une coquetterie : `0,29 * 100` vaut
 * `28.999999999999996` en virgule flottante, et cette suite partait telle
 * quelle dans le style de la case. La fraction est déjà au centième près —
 * l'unité de la journée dans tout le domaine —, l'arrondi ne perd donc rien.
 */
function hauteur(forme: Forme): string {
  return forme.kind === 'PARTIELLE' ? `${Math.round(forme.fraction * 100)}%` : '100%'
}

/**
 * L'aplat d'une case de saisie — le cœur du lot 1f, partagé par les deux vues.
 *
 * Un nœud à part, sous le contenu et hors du flux : le chiffre reste par-dessus
 * la forme, jamais à sa place. `pointer-events-none` le retire du chemin du
 * pointeur, sans quoi il s'interposerait entre le doigt et la case pour tous
 * les gestes que le calendrier écoute — et entre le curseur et le champ de
 * saisie du tableau.
 *
 * Il n'ajoute **aucune largeur** : posé en absolu dans sa case, il ne pèse pas
 * sur le budget des sept colonnes à 375 points.
 *
 * La règle de forme n'est pas ici : elle vit dans `core/saisie/forme.ts`, pure
 * et sans DOM. Ce composant ne fait que la dessiner.
 */
export function Aplat({
  cle,
  forme,
  couleur,
}: {
  /** ce qui identifie la case : la date au calendrier, ligne et date au tableau */
  cle: string
  forme: Forme
  /** teinte de la prestation, jamais un jeton porteur de sens */
  couleur: LineColor
}) {
  if (forme.kind === 'AUCUNE') return null
  const signature = signatureDeForme(forme)
  return (
    <span
      aria-hidden="true"
      data-testid={`remplissage-${cle}`}
      data-forme={signature}
      className={`pointer-events-none absolute inset-x-0 bottom-0 ${couleur.bg} ${
        DECOUPE[signature] ?? ''
      }`}
      style={{ height: hauteur(forme) }}
    />
  )
}
