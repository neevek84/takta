import Link from 'next/link'
import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { buildChargeMatrix } from '@/services/charge'
import { fiscalYearBounds } from '@/core/fiscal/year'
import { ExerciceBar } from '@/components/charge/ExerciceBar'
import { ChargeTable } from '@/components/charge/ChargeTable'
import { PageShell } from '@/components/ui/PageShell'
import { Banner } from '@/components/ui/Banner'

export default async function ChargePage({
  searchParams,
}: {
  searchParams: Promise<{ ex?: string }>
}) {
  const user = await requireUser()
  const { ex } = await searchParams
  const settings = await getSettings()

  const courant = fiscalYearBounds(
    new Date().toISOString().slice(0, 10),
    settings.debutExerciceMois,
  )
  const startYear = ex ? Number(ex) : Number(courant.start.slice(0, 4))

  const matrix = await buildChargeMatrix(user.id, startYear)

  return (
    <PageShell
      title="Plan de charge"
      actions={
        <>
          <Link
            href={`/charge?ex=${startYear - 1}`}
            className="touch-target inline-flex items-center rounded-md border border-rule px-3 text-sm text-link"
          >
            ← Exercice précédent
          </Link>
          <Link
            href={`/charge?ex=${startYear + 1}`}
            className="touch-target inline-flex items-center rounded-md border border-rule px-3 text-sm text-link"
          >
            Exercice suivant →
          </Link>
        </>
      }
    >
      <ExerciceBar
        label={matrix.fiscalYear.label}
        progress={matrix.progress}
        resteEnJoursCentiemes={matrix.resteEnJoursCentiemes}
      />

      {settings.objectifCaExerciceCents === 0 && (
        <div className="mb-4">
          <Banner tone="info">
            Aucun objectif de chiffre d’affaires n’est défini.{' '}
            <Link href="/admin/saisie" className="underline">
              En saisir un
            </Link>{' '}
            fait apparaître le reste à vendre.
          </Banner>
        </div>
      )}

      <ChargeTable matrix={matrix} />
    </PageShell>
  )
}
