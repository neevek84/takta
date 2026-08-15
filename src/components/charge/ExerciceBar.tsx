import type { ExerciceProgress } from '@/core/fiscal/revenue'

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

function jours(centiemes: number): string {
  return (centiemes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })
}

export function ExerciceBar({
  label,
  progress,
  resteEnJoursCentiemes,
}: {
  label: string
  progress: ExerciceProgress
  resteEnJoursCentiemes: number | null
}) {
  // Sans objectif, un taux de couverture ne veut rien dire : on n'affiche rien
  // plutôt que des pourcentages vides de sens.
  if (progress.objectifCents === 0) return null

  const pct = (v: number) => Math.min(100, (v / progress.objectifCents) * 100)

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-slate-600">
        {label} · objectif {euros(progress.objectifCents)} €
      </h2>

      <div className="mb-2 h-3 w-full overflow-hidden rounded bg-slate-200">
        <div className="flex h-full">
          <div className="bg-slate-800" style={{ width: `${pct(progress.realiseCents)}%` }} />
          <div className="bg-slate-400" style={{ width: `${pct(progress.prevuCents)}%` }} />
        </div>
      </div>

      <p className="text-sm text-slate-600">
        {euros(progress.realiseCents)} € réalisés · {euros(progress.prevuCents)} € prévus ·{' '}
        {Math.round(progress.tauxCouverture * 100)} % de couverture
      </p>

      <p data-testid="reste-a-vendre" className="mt-1 text-base font-medium">
        {progress.depassementCents > 0 ? (
          <span className="text-emerald-700">
            Objectif dépassé de {euros(progress.depassementCents)} €
          </span>
        ) : (
          <>
            Reste à vendre : {euros(progress.resteAVendreCents)} €
            {resteEnJoursCentiemes !== null && (
              <span className="text-slate-500">
                {' '}
                — environ {jours(resteEnJoursCentiemes)} jours
              </span>
            )}
          </>
        )}
      </p>
    </section>
  )
}
