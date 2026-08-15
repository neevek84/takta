import { validerJoursPasses } from './actions'
import type { MonthEntry } from '@/services/time-entries'

/**
 * Rappel du prévisionnel échu. Simple encart informatif : aucune conversion
 * n'a lieu tant que l'utilisateur n'a pas cliqué sur le bouton — la
 * conversion n'est jamais automatique.
 */
export function PastForecastNotice({
  month,
  entries,
  lockedCount,
}: {
  month: string
  entries: MonthEntry[]
  lockedCount: number
}) {
  if (entries.length === 0) return null

  const convertibles = entries.length - lockedCount

  return (
    <section className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      <p className="mb-2 text-amber-900">
        {entries.length === 1
          ? '1 jour prévu est déjà passé.'
          : `${entries.length} jours prévus sont déjà passés.`}{' '}
        Ils ne deviendront du temps réalisé que si tu le décides.
      </p>

      <ul className="mb-2 flex flex-wrap gap-2 text-xs text-amber-800">
        {entries.map((e) => (
          <li key={e.id} className="rounded bg-amber-100 px-2 py-0.5">
            {e.date}
          </li>
        ))}
      </ul>

      {convertibles > 0 ? (
        <form action={validerJoursPasses}>
          <input type="hidden" name="month" value={month} />
          <button className="rounded border border-amber-400 bg-white px-3 py-1">
            Valider {convertibles === 1 ? 'ce jour' : `ces ${convertibles} jours`}
          </button>
        </form>
      ) : null}

      {lockedCount > 0 && (
        <p className="mt-1 text-xs text-amber-800">
          {lockedCount === 1 ? '1 jour appartient' : `${lockedCount} jours appartiennent`} à une
          mission dont le CRA est validé. Rouvre-le pour pouvoir les convertir.
        </p>
      )}
    </section>
  )
}
