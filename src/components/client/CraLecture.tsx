import { formatJours, libelleJour, type CraDocument } from '@/core/cra/document'

function estWeekEnd(date: string): boolean {
  const j = new Date(`${date}T00:00:00Z`).getUTCDay()
  return j === 0 || j === 6
}

/**
 * Le CRA tel que le client l'a reçu — **en lecture seule, depuis le contenu
 * figé**. Aucun montant : le type `CraDocument` n'en porte pas.
 *
 * Week-ends et fériés sont **nommés** (« sam. », « férié »), pas seulement
 * grisés : aucune information par la seule couleur.
 */
export function CraLecture({ document }: { document: CraDocument }) {
  const feries = new Set(document.feries)
  const parJour = new Map<string, number>()
  for (const l of document.lignes) for (const j of l.jours) parJour.set(j.date, (parJour.get(j.date) ?? 0) + j.centiemes)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">{document.emetteur.nom}</p>
        <h1 className="text-xl">
          {document.clientNom} · {document.missionLabel}
        </h1>
        <p className="text-muted">Compte-rendu d’activité — {document.moisLibelle}</p>
      </header>

      <p>
        <span className="text-2xl font-medium">{formatJours(document.totalCentiemes)} j</span>{' '}
        <span className="text-muted">réalisés sur le mois</span>
      </p>

      <section aria-label="Calendrier du mois">
        <ol className="grid grid-cols-7 gap-1 text-center text-xs">
          {document.joursDuMois.map((date) => {
            const c = parJour.get(date) ?? 0
            // `libelleJour` rend « sam. 05 » : l'abréviation est le premier mot.
            const repere = feries.has(date) ? 'férié' : estWeekEnd(date) ? libelleJour(date).split(' ')[0] : ''
            return (
              <li key={date} className={`rounded-md border border-rule p-1 ${c > 0 ? 'bg-off' : ''}`}>
                <span className="block text-muted">{Number(date.slice(8))}</span>
                <span className="block font-medium">{c > 0 ? formatJours(c) : '–'}</span>
                {repere !== '' && <span className="block text-muted">{repere}</span>}
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-label="Détail par prestation">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-4">Prestation</th>
                <th className="py-1 pr-4">Jours</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {document.lignes.map((l) => (
                <tr key={l.label} className="border-b border-rule align-top">
                  <td className="py-1 pr-4">{l.label}</td>
                  <td className="py-1 pr-4">
                    {l.jours.map((j) => `${libelleJour(j.date)} : ${formatJours(j.centiemes)}`).join(' · ')}
                  </td>
                  <td className="py-1 text-right">{formatJours(l.totalCentiemes)} j</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
