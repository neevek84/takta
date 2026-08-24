import type { ReactElement } from 'react'
import {
  Briefcase,
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  CircleDashed,
  CircleSlash,
  Clock,
  Diamond,
  FileText,
  Hourglass,
  Info,
  Minus,
  Receipt,
  Send,
  Settings,
  TriangleAlert,
  X,
} from 'lucide-react'

/**
 * Les icônes du système, en un seul point.
 *
 * Les états se distinguaient jusqu'ici par des caractères — `◆ ✓ ▲ ✕ ℹ ◌ ▸ ⏳` —
 * rendus dans la police système, chacun avec sa métrique, son alignement et sa
 * disponibilité propres. L'`Horloge` du prévisionnel montrait déjà le bon
 * niveau : un tracé dessiné, aux dimensions choisies.
 *
 * Toutes sont masquées aux lecteurs d'écran : le libellé, le `role` ou le nom
 * accessible de la case porte déjà l'information en toutes lettres.
 *
 * Chacune porte un `data-icone` qui la nomme. C'est ce que les tests lisent
 * pour vérifier que deux tonalités ne se distinguent pas par la seule teinte :
 * un `svg` sans texte n'a pas de `textContent` à comparer, et deux icônes
 * différentes seraient sinon indiscernables d'une même icône rendue deux fois.
 */
export type IconeProps = { className?: string; testId?: string }

/** Le composant que reçoit `Badge`, `Banner` ou toute table d'états. */
export type Icone = (props: IconeProps) => ReactElement

/**
 * `aria-hidden` est posé **explicitement** : `lucide-react` le pose aussi de
 * lui-même sur une icône sans propriété d'accessibilité, mais c'est un défaut
 * de bibliothèque, révocable à la prochaine version. La promesse appartient à
 * ce fichier, et les tests la tiennent.
 */
const commun = { 'aria-hidden': true as const, strokeWidth: 2, size: 14 }

function fabrique(
  Glyphe: typeof Check,
  nom: string,
  taille = commun.size,
): Icone {
  const Composant = ({ className, testId }: IconeProps) => (
    <Glyphe
      {...commun}
      size={taille}
      data-icone={nom}
      data-testid={testId}
      className={className}
    />
  )
  Composant.displayName = `Icone(${nom})`
  return Composant
}

export const IconeSucces = fabrique(Check, 'succes')
export const IconeAvertissement = fabrique(TriangleAlert, 'avertissement')
export const IconeDanger = fabrique(X, 'danger')
export const IconeInfo = fabrique(Info, 'info')

/** « En attente », « en cours d'acheminement » — un temps qui passe. */
export const IconeAttente = fabrique(Hourglass, 'attente')
/** « Ignoré » — un travail qui a été vu et écarté. */
export const IconeIgnore = fabrique(CircleSlash, 'ignore')
/** « Jamais exécuté » — l'absence de fait, qui n'est ni un succès ni un échec. */
export const IconeAbsence = fabrique(Minus, 'absence')
/** Le CRA qu'on n'a pas encore envoyé. */
export const IconeBrouillon = fabrique(CircleDashed, 'brouillon')
/** Le CRA parti chez le client. */
export const IconeEnvoye = fabrique(Send, 'envoye')
/** Le CRA facturé — un fait saisi à la main, distinct du cycle du document. */
export const IconeFacture = fabrique(Receipt, 'facture')

/**
 * Les deux marqueurs de la case du calendrier. Plus petits : ils partagent la
 * ligne du numéro du jour, dont la largeur est tenue par un test de budget à
 * 375 points.
 */
export const IconeOccupation = fabrique(Diamond, 'occupation', 10)
export const IconePrevisionnel = fabrique(Clock, 'previsionnel', 10)

/** Les cinq entrées de la navigation. */
export const IconeSaisie = fabrique(CalendarDays, 'saisie', 16)
export const IconeCharge = fabrique(ChartNoAxesColumn, 'charge', 16)
export const IconeMissions = fabrique(Briefcase, 'missions', 16)
export const IconeCra = fabrique(FileText, 'cra', 16)
export const IconeReglages = fabrique(Settings, 'reglages', 16)
