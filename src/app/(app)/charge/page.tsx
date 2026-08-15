import Link from 'next/link'
import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { buildChargeMatrix } from '@/services/charge'
import { fiscalYearBounds } from '@/core/fiscal/year'
import { ExerciceBar } from '@/components/charge/ExerciceBar'
import { ChargeTable } from '@/components/charge/ChargeTable'

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
    <main className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Plan de charge</h1>
        <Link href={`/charge?ex=${startYear - 1}`} className="rounded border px-2 py-1 text-sm">
          ← Exercice précédent
        </Link>
        <Link href={`/charge?ex=${startYear + 1}`} className="rounded border px-2 py-1 text-sm">
          Exercice suivant →
        </Link>
      </div>

      <ExerciceBar
        label={matrix.fiscalYear.label}
        progress={matrix.progress}
        resteEnJoursCentiemes={matrix.resteEnJoursCentiemes}
      />

      {settings.objectifCaExerciceCents === 0 && (
        <p className="mb-4 text-sm text-slate-500">
          Aucun objectif de chiffre d’affaires n’est défini.{' '}
          <Link href="/admin/saisie" className="underline">
            En saisir un
          </Link>{' '}
          fait apparaître le reste à vendre.
        </p>
      )}

      <ChargeTable matrix={matrix} />
    </main>
  )
}
