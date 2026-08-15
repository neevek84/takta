import { Badge, type Tone } from '@/components/ui/Badge'
import type { CraStatus } from '@/core/types'

const BADGES: Record<CraStatus, { tone: Tone; glyph: string; label: string }> = {
  BROUILLON: { tone: 'neutral', glyph: '◌', label: 'Brouillon' },
  ENVOYE: { tone: 'info', glyph: '▸', label: 'Envoyé' },
  VALIDE: { tone: 'success', glyph: '✓', label: 'Validé' },
  REFUSE: { tone: 'danger', glyph: '✕', label: 'Refusé' },
}

export function craStatusBadge(status: CraStatus): { tone: Tone; glyph: string; label: string } {
  return BADGES[status]
}

/** Quatre états qui doivent se distinguer d'un coup d'œil, sans dépendre de
 *  la seule teinte : chacun porte un glyphe qui lui est propre. */
export function StatusBadge({ status }: { status: CraStatus }) {
  const { tone, glyph, label } = BADGES[status]
  return (
    <Badge tone={tone} glyph={glyph} testId="cra-statut">
      {label}
    </Badge>
  )
}
