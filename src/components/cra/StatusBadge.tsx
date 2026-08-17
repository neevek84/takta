import { Badge, type Tone } from '@/components/ui/Badge'
import {
  IconeBrouillon,
  IconeDanger,
  IconeEnvoye,
  IconeSucces,
  type Icone,
} from '@/components/ui/icons'
import type { CraStatus } from '@/core/types'

const BADGES: Record<CraStatus, { tone: Tone; icone: Icone; label: string }> = {
  BROUILLON: { tone: 'neutral', icone: IconeBrouillon, label: 'Brouillon' },
  ENVOYE: { tone: 'info', icone: IconeEnvoye, label: 'Envoyé' },
  VALIDE: { tone: 'success', icone: IconeSucces, label: 'Validé' },
  REFUSE: { tone: 'danger', icone: IconeDanger, label: 'Refusé' },
}

export function craStatusBadge(status: CraStatus): { tone: Tone; icone: Icone; label: string } {
  return BADGES[status]
}

/** Quatre états qui doivent se distinguer d'un coup d'œil, sans dépendre de
 *  la seule teinte : chacun porte une icône qui lui est propre. */
export function StatusBadge({ status }: { status: CraStatus }) {
  const { tone, icone, label } = BADGES[status]
  return (
    <Badge tone={tone} icone={icone} testId="cra-statut">
      {label}
    </Badge>
  )
}
