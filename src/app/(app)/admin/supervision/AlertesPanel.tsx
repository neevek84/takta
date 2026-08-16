import { Banner } from '@/components/ui/Banner'
import { Card } from '@/components/ui/Card'
import type { Alerte, CodeAlerte } from '@/services/supervision'

/** La rupture de chaîne est d'un autre ordre que le reste : elle met en cause la preuve. */
const TONALITES: Record<CodeAlerte, 'danger' | 'warning'> = {
  JOURNAL_ROMPU: 'danger',
  TRAVAIL_ECHEC: 'danger',
  ABONNEMENT_SUSPENDU: 'warning',
  LIVRAISON_ABANDONNEE: 'warning',
}

export function AlertesPanel({ alertes }: { alertes: Alerte[] }) {
  if (alertes.length === 0) {
    return (
      <Card title="À traiter">
        <p className="text-sm text-muted">
          Rien ne demande d’action : les travaux passent, les abonnements répondent, la
          chaîne du journal est intacte.
        </p>
      </Card>
    )
  }

  return (
    <Card title={`À traiter — ${alertes.length}`}>
      <ul className="flex flex-col gap-2">
        {alertes.map((alerte, index) => (
          <li key={`${alerte.code}-${index}`}>
            <Banner tone={TONALITES[alerte.code]} title={alerte.libelle}>
              <p className="text-sm">{alerte.detail}</p>
            </Banner>
          </li>
        ))}
      </ul>
    </Card>
  )
}
