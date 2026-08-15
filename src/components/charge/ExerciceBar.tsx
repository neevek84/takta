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

  // Le réalisé est un fait acquis, sa largeur n'est jamais rabotée. Le
  // prévisionnel, lui, cède la place s'il faut pour que la somme des deux
  // segments ne dépasse jamais 100 % — sinon le flexbox les comprime tous
  // les deux et fausse le rapport visuel réalisé/prévu.
  const pctRealise = pct(progress.realiseCents)
  const pctPrevu = Math.min(pct(progress.prevuCents), 100 - pctRealise)

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-muted">
        {label} · objectif {euros(progress.objectifCents)} €
      </h2>

      <div className="mb-2 h-3 w-full overflow-hidden rounded-sm bg-off-strong">
        {/* Le prévisionnel se hachure et se nomme : sa teinte plus claire ne
            suffirait pas à le distinguer du réalisé sans la couleur. */}
        <div className="flex h-full">
          <div
            data-testid="bar-realise"
            title="Réalisé"
            className="bg-accent"
            style={{ width: `${pctRealise}%` }}
          />
          <div
            data-testid="bar-prevu"
            title="Prévisionnel"
            className="bg-accent/45 pattern-hatch"
            style={{ width: `${pctPrevu}%` }}
          />
        </div>
      </div>

      <p className="text-sm text-muted">
        {euros(progress.realiseCents)} € réalisés · {euros(progress.prevuCents)} € prévus ·{' '}
        {Math.round(progress.tauxCouverture * 100)} % de couverture
      </p>

      <p data-testid="reste-a-vendre" className="mt-1 text-base font-medium">
        {progress.depassementCents > 0 ? (
          <span className="text-success-ink">
            Objectif dépassé de {euros(progress.depassementCents)} €
          </span>
        ) : (
          <>
            Reste à vendre : {euros(progress.resteAVendreCents)} €
            {resteEnJoursCentiemes !== null && (
              <span className="text-muted">
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
