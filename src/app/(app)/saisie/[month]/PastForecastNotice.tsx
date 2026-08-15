'use client'

import { useActionState } from 'react'
import { validerJoursPasses, type ConversionEtat } from './actions'
import type { MonthEntry } from '@/services/time-entries'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'

function messageConversion(etat: NonNullable<ConversionEtat>): string {
  const { converted, skippedLocked } = etat

  const converti =
    converted === 0
      ? 'Aucun jour converti'
      : converted === 1
        ? '1 jour converti en réalisé'
        : `${converted} jours convertis en réalisé`

  if (skippedLocked === 0) return `${converti}.`

  const saute =
    skippedLocked === 1
      ? "1 jour n'a pas pu l'être"
      : `${skippedLocked} jours n'ont pas pu l'être`

  return `${converti}. ${saute} : le CRA de leur mission est validé.`
}

/**
 * Rappel du prévisionnel échu. Simple encart informatif : aucune conversion
 * n'a lieu tant que l'utilisateur n'a pas cliqué sur le bouton — la
 * conversion n'est jamais automatique.
 *
 * Après le clic, l'encart rend compte de ce qui a réellement été converti : le
 * nombre annoncé et le nombre traité peuvent différer (un jour qui bascule
 * entre le rendu et le clic, un CRA validé entre-temps).
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
  const [etat, convertir, enCours] = useActionState(validerJoursPasses, null)

  // Une fois la conversion faite, il ne reste plus de prévisionnel échu : on
  // garde l'encart le temps d'afficher son compte rendu, sans quoi le message
  // disparaîtrait avec les jours qu'il commente.
  if (entries.length === 0 && etat === null) return null

  const convertibles = entries.length - lockedCount

  return (
    <div className="mb-4">
      <Banner tone="warning">
        {entries.length > 0 && (
          <>
            <p className="mb-2">
              {entries.length === 1
                ? '1 jour prévu est déjà passé.'
                : `${entries.length} jours prévus sont déjà passés.`}{' '}
              Ils ne deviendront du temps réalisé que si tu le décides.
            </p>

            <ul className="mb-2 flex flex-wrap gap-2 text-xs">
              {entries.map((e) => (
                <li key={e.id} className="rounded bg-surface px-2 py-0.5">
                  {e.date}
                </li>
              ))}
            </ul>
          </>
        )}

        {convertibles > 0 ? (
          <form action={convertir}>
            <input type="hidden" name="month" value={month} />
            <Button variant="secondary" disabled={enCours}>
              {enCours
                ? 'Conversion en cours…'
                : `Valider ${convertibles === 1 ? 'ce jour' : `ces ${convertibles} jours`}`}
            </Button>
          </form>
        ) : null}

        {lockedCount > 0 && (
          <p className="mt-1 text-xs">
            {lockedCount === 1 ? '1 jour appartient' : `${lockedCount} jours appartiennent`} à une
            mission dont le CRA est validé. Rouvre-le pour pouvoir les convertir.
          </p>
        )}

        {etat !== null && (
          <p role="status" className="mt-1">
            {messageConversion(etat)}
          </p>
        )}
      </Banner>
    </div>
  )
}
