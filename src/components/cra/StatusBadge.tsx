import { Badge, type Tone } from '@/components/ui/Badge'
import {
  IconeBrouillon,
  IconeDanger,
  IconeEnvoye,
  IconeFacture,
  IconeSucces,
  type Icone,
} from '@/components/ui/icons'
import { libelleEtat, type EtatSuivi } from '@/core/cra/etat-suivi'

// Le libellé n'est pas dupliqué ici : `libelleEtat` le porte déjà, et c'est
// lui que `craStatusBadge` interroge plus bas.
const BADGES: Record<EtatSuivi, { tone: Tone; icone: Icone }> = {
  BROUILLON: { tone: 'neutral', icone: IconeBrouillon },
  ENVOYE: { tone: 'info', icone: IconeEnvoye },
  VALIDE: { tone: 'success', icone: IconeSucces },
  REFUSE: { tone: 'danger', icone: IconeDanger },
  // Le cycle est allé jusqu'au bout : ni une alerte, ni une réussite de plus à
  // fêter. `neutral` est la teinte de ce qui est classé.
  FACTURE: { tone: 'neutral', icone: IconeFacture },
}

export function craStatusBadge(status: EtatSuivi): { tone: Tone; icone: Icone; label: string } {
  return { ...BADGES[status], label: libelleEtat(status) }
}

/** Cinq états qui doivent se distinguer d'un coup d'œil, sans dépendre de
 *  la seule teinte : chacun porte une icône qui lui est propre. */
export function StatusBadge({ status }: { status: EtatSuivi }) {
  const { tone, icone, label } = craStatusBadge(status)
  return (
    <Badge tone={tone} icone={icone} testId="cra-statut">
      {label}
    </Badge>
  )
}
