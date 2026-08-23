import Link from 'next/link'
import { DataTable } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/cra/StatusBadge'
import { etatSuivi } from '@/core/cra/etat-suivi'
import { formatJours, libelleMois } from '@/core/cra/document'
import type { CraView } from '@/services/cra'

/**
 * Le suivi, en lignes.
 *
 * **Aucune transition ici, et c'est un point de sûreté.** Les deux garde-fous
 * qui précèdent une validation — « ce CRA n'ira pas dans Dolibarr » et « du
 * prévisionnel sera annulé » — vivent sur la page de détail. Un bouton
 * « Valider » dans une ligne permettrait de valider sans les avoir lus.
 * La liste montre et filtre ; le détail agit.
 */
export function SuiviTable({ cras }: { cras: CraView[] }) {
  if (cras.length === 0) {
    return <p className="text-muted">Aucun CRA ne correspond à ce filtre.</p>
  }

  return (
    <DataTable caption="Suivi des CRA">
      <thead>
        <tr className="border-b border-rule text-left text-muted">
          <th className="px-2 py-1 font-medium">Mois</th>
          <th className="px-2 py-1 font-medium">Client</th>
          <th className="px-2 py-1 font-medium">Mission</th>
          <th className="px-2 py-1 text-right font-medium">Jours</th>
          <th className="px-2 py-1 font-medium">État</th>
          <th className="px-2 py-1 font-medium">N° facture</th>
          <th className="px-2 py-1 font-medium">Facturé le</th>
          <th className="px-2 py-1">
            <span className="sr-only">Détail</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {cras.map((cra) => (
          <tr key={cra.id} className="border-b border-rule">
            <td className="px-2 py-1">{libelleMois(cra.month)}</td>
            <td className="px-2 py-1">{cra.clientName}</td>
            <td className="px-2 py-1">{cra.missionLabel}</td>
            <td className="px-2 py-1 text-right">{formatJours(cra.synthese.totalCentiemes)}</td>
            <td className="px-2 py-1">
              <StatusBadge status={etatSuivi(cra)} />
            </td>
            <td className="px-2 py-1">{cra.invoiceNumber ?? '—'}</td>
            <td className="px-2 py-1">{cra.invoicedAt?.toISOString().slice(0, 10) ?? '—'}</td>
            <td className="px-2 py-1">
              <Link href={`/cra/${cra.id}`} className="text-link underline">
                Ouvrir
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  )
}
