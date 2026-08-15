import { DataTable } from '@/components/ui/DataTable'
import type { ChargeMatrix } from '@/services/charge'

const MOIS_COURT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']

function moisCourt(month: string): string {
  return `${MOIS_COURT[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`
}

function jours(centiemes: number): string {
  return centiemes === 0 ? '' : String(centiemes / 100).replace('.', ',')
}

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

export function ChargeTable({ matrix }: { matrix: ChargeMatrix }) {
  if (matrix.rows.length === 0) {
    return <p className="text-muted">Aucune ligne de prestation active.</p>
  }

  return (
    <DataTable caption={`Plan de charge de ${matrix.fiscalYear.label}`}>
      <thead>
        <tr>
          <th scope="col" className="sticky left-0 bg-surface px-2 py-1 text-left">
            Ligne de prestation
          </th>
          {matrix.fiscalYear.months.map((m) => (
            <th key={m} scope="col" className="w-16 px-1 py-1 text-center text-xs font-normal">
              {moisCourt(m)}
            </th>
          ))}
          <th scope="col" className="px-3 py-1 text-right">Reste à planifier</th>
        </tr>
      </thead>

      <tbody>
        {matrix.rows.map((row) => (
          <tr key={row.lineId} className="border-t border-rule">
            <th scope="row" className="sticky left-0 bg-surface px-2 py-1 text-left font-normal">
              {row.label}
            </th>

            {row.cells.map((cell, i) => (
              <td
                key={i}
                data-testid={`cell-${row.lineId}-${matrix.fiscalYear.months[i]}`}
                className="px-1 py-1 text-center text-xs"
              >
                {cell.realiseCentiemes > 0 && (
                  <span title="Réalisé">{jours(cell.realiseCentiemes)}</span>
                )}
                {/* Hachure, italique et souligné pointillé : le prévisionnel se
                    distingue sans la teinte et sans rien ajouter au texte, que
                    les tests comparent au caractère près. */}
                {cell.prevuCentiemes > 0 && (
                  <span
                    title="Prévisionnel"
                    className="pattern-hatch italic text-muted underline decoration-dotted"
                  >
                    {cell.realiseCentiemes > 0 ? ' + ' : ''}
                    {jours(cell.prevuCentiemes)}
                  </span>
                )}
              </td>
            ))}

            <td data-testid={`reste-${row.lineId}`} className="px-3 py-1 text-right text-xs">
              {jours(row.engagement.resteCentiemes)} j · {euros(row.resteAVendreCents)} €
              {row.engagement.depassementCentiemes > 0 && (
                <span title="Dépassement" className="ml-1 font-medium text-warning-ink">
                  (+{jours(row.engagement.depassementCentiemes)} j)
                </span>
              )}
            </td>
          </tr>
        ))}

        <tr className="border-t-2 border-rule font-medium">
          <th scope="row" className="sticky left-0 bg-surface px-2 py-1 text-left">
            Total
          </th>
          {matrix.monthTotals.map((t, i) => (
            <td key={i} data-testid={`total-${matrix.fiscalYear.months[i]}`} className="px-1 py-1 text-center text-xs">
              <div>{jours(t.centiemes)}</div>
              <div className="text-muted">{t.caCents === 0 ? '' : `${euros(t.caCents)} €`}</div>
            </td>
          ))}
          <td />
        </tr>
      </tbody>
    </DataTable>
  )
}
