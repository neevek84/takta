import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { listActiveLines } from '@/services/missions'
import {
  getLineEngagementTotals,
  getMonthEntries,
  getPastForecastWithLockStatus,
} from '@/services/time-entries'
import { getBusyDays } from '@/services/availability'
import { buildMonthDays } from '@/core/month/build'
import { MonthNav } from '@/components/MonthNav'
import { PageShell } from '@/components/ui/PageShell'
import { PastForecastNotice } from './PastForecastNotice'
import { SaisieClient } from './SaisieClient'

export default async function SaisiePage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  const user = await requireUser()

  const settings = await getSettings()
  const lines = await listActiveLines(user.id)
  const entries = await getMonthEntries(user.id, month)
  // L'engagement se lit sur toute la durée de la ligne, pas sur le mois affiché.
  const engagementTotals = await getLineEngagementTotals(
    user.id,
    lines.map((l) => l.id),
  )
  const days = buildMonthDays(month, settings.workingDays, settings.holidays)

  // Une lecture d'occupation à l'ouverture du mois. Elle ne lève jamais : un
  // agenda injoignable rend une liste vide et la page s'affiche normalement.
  const busyDates = await getBusyDays(user.id, month)

  // Rappel du prévisionnel échu : un simple encart, jamais une conversion
  // automatique — voir PastForecastNotice. Les deux chiffres viennent du même
  // partage que la conversion, dans la couche service : la page ne réimplémente
  // ni le filtre « prévisionnel échu », ni l'évaluation du verrou.
  const today = new Date().toISOString().slice(0, 10)
  const pastForecast = await getPastForecastWithLockStatus(user.id, month, today)

  return (
    <PageShell title="Saisie">
      <MonthNav month={month} />
      <PastForecastNotice
        month={month}
        entries={pastForecast.entries}
        lockedCount={pastForecast.lockedCount}
      />
      <SaisieClient
        month={month}
        days={days}
        lines={lines}
        entries={entries}
        engagementTotals={engagementTotals}
        // Transmise telle qu'elle est réglée : la convertir en minutes avec le
        // facteur global donnerait à la ligne de totaux un seuil qu'aucune
        // saisie ne partage forcément (voir `TotalsRow`).
        capacityCentiemes={settings.capacityCentiemes}
        // Le mode descend avec le seuil : sans lui, la ligne de totaux
        // marquerait un dépassement que le service ignore en `DESACTIVE`.
        capacityMode={settings.capacityMode}
        slots={settings.slots}
        // Le pré-remplissage du formulaire d'heures, et rien d'autre : une
        // saisie déjà écrite porte ses propres bornes, figées à l'écriture.
        journeeDebutMinute={settings.journeeDebutMinute}
        journeeFinMinute={settings.journeeFinMinute}
        // Un repère, jamais un verrou : la liste est vide quand l'agenda n'est
        // pas connecté ou pas joignable, et la saisie fonctionne à l'identique.
        busyDates={busyDates}
        // Le même jour que celui du rappel de prévisionnel échu, et calculé
        // une seule fois : la case du jour marque la frontière entre le
        // réalisé et le prévisionnel, et les deux ne peuvent pas la placer
        // ailleurs l'un que l'autre.
        aujourdhui={today}
      />
    </PageShell>
  )
}
