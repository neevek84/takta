import type { CraSignatureView } from '@/services/cra'
import { Badge, type Tone } from '@/components/ui/Badge'

const ETATS: Record<CraSignatureView['status'], { tone: Tone; glyph: string; label: string }> = {
  EN_ATTENTE: { tone: 'info', glyph: '⏳', label: 'En attente de signature' },
  SIGNE: { tone: 'success', glyph: '✓', label: 'Signé par le client' },
  REFUSE: { tone: 'danger', glyph: '✕', label: 'Refusé par le client' },
  EXPIRE: { tone: 'warning', glyph: '▲', label: 'Demande expirée' },
}

function jour(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * L'état de la demande de signature, en toutes lettres.
 *
 * Le glyphe et le libellé portent l'information ; la teinte ne fait que la
 * renforcer. Aucune information n'est portée par la seule couleur.
 */
export function SignatureCard({ signature }: { signature: CraSignatureView }) {
  const etat = ETATS[signature.status]

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <Badge tone={etat.tone} glyph={etat.glyph}>
        {etat.label}
      </Badge>
      <span className="text-muted">Envoyé le {jour(signature.sentAt)}</span>
      <span className="text-muted">
        {signature.relances} relance{signature.relances > 1 ? 's' : ''}
        {signature.lastRelanceAt === null ? '' : ` · dernière le ${jour(signature.lastRelanceAt)}`}
      </span>
      {signature.abandoned && (
        <span className="text-warning-ink">Relances abandonnées — CRA en souffrance</span>
      )}
      {signature.archive && <span className="text-muted">Document signé archivé</span>}
    </div>
  )
}
