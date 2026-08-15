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
    return <p className="text-slate-500">Aucune ligne de prestation active.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-white px-2 py-1 text-left">
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
            <tr key={row.lineId} className="border-t">
              <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left font-normal">
                {row.label}
              </th>

              {row.cells.map((cell, i) => (
                <td key={i} className="px-1 py-1 text-center text-xs">
                  {cell.realiseCentiemes > 0 && <span>{jours(cell.realiseCentiemes)}</span>}
                  {cell.prevuCentiemes > 0 && (
                    <span className="text-slate-400 italic">
                      {cell.realiseCentiemes > 0 ? ' + ' : ''}
                      {jours(cell.prevuCentiemes)}
                    </span>
                  )}
                </td>
              ))}

              <td className="px-3 py-1 text-right text-xs">
                {row.engagement.resteCentiemes / 100} j · {euros(row.resteAVendreCents)} €
                {row.engagement.depassementCentiemes > 0 && (
                  <span className="ml-1 text-amber-600">
                    (+{row.engagement.depassementCentiemes / 100} j)
                  </span>
                )}
              </td>
            </tr>
          ))}

          <tr className="border-t-2 font-medium">
            <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left">
              Total
            </th>
            {matrix.monthTotals.map((t, i) => (
              <td key={i} data-testid={`total-${matrix.fiscalYear.months[i]}`} className="px-1 py-1 text-center text-xs">
                <div>{jours(t.centiemes)}</div>
                <div className="text-slate-500">{t.caCents === 0 ? '' : `${euros(t.caCents)} €`}</div>
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
