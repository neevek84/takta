import { Badge, type Tone } from '@/components/ui/Badge'
import {
  IconeBrouillon,
  IconeDanger,
  IconeEnvoye,
  IconeFacture,
  IconeSucces,
  type Icone,
} from '@/components/ui/icons'
import type { EtatSuivi } from '@/core/cra/etat-suivi'

const BADGES: Record<EtatSuivi, { tone: Tone; icone: Icone; label: string }> = {
  BROUILLON: { tone: 'neutral', icone: IconeBrouillon, label: 'Brouillon' },
  ENVOYE: { tone: 'info', icone: IconeEnvoye, label: 'Envoyé' },
  VALIDE: { tone: 'success', icone: IconeSucces, label: 'Validé' },
  REFUSE: { tone: 'danger', icone: IconeDanger, label: 'Refusé' },
  // Le cycle est allé jusqu'au bout : ni une alerte, ni une réussite de plus à
  // fêter. `neutral` est la teinte de ce qui est classé.
  FACTURE: { tone: 'neutral', icone: IconeFacture, label: 'Facturé' },
}

export function craStatusBadge(status: EtatSuivi): { tone: Tone; icone: Icone; label: string } {
  return BADGES[status]
}

/** Cinq états qui doivent se distinguer d'un coup d'œil, sans dépendre de
 *  la seule teinte : chacun porte une icône qui lui est propre. */
export function StatusBadge({ status }: { status: EtatSuivi }) {
  const { tone, icone, label } = BADGES[status]
  return (
    <Badge tone={tone} icone={icone} testId="cra-statut">
      {label}
    </Badge>
  )
}
