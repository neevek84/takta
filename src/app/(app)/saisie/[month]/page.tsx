import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { listActiveLines } from '@/services/missions'
import {
  getEntriesRange,
  getLineEngagementTotals,
  getPastForecastWithLockStatus,
} from '@/services/time-entries'
import { aUnConnecteurAgenda } from '@/services/credentials'
import { buildMonthDays, shiftMonth } from '@/core/month/build'
import { MonthNav } from '@/components/MonthNav'
import { PageShell } from '@/components/ui/PageShell'
import { PastForecastNotice } from './PastForecastNotice'
import { SaisieClient } from './SaisieClient'

export default async function SaisiePage({
  params,
  searchParams,
}: {
  params: Promise<{ month: string }>
  searchParams: Promise<{ vue?: string }>
}) {
  const { month } = await params
  // **Ce qu'on regarde vit dans l'adresse**, et il est résolu ici plutôt que
  // dans le composant : lu après le montage, la page s'afficherait d'abord en
  // calendrier avant de basculer, et ce clignotement porte sur toute la page.
  const { vue } = await searchParams
  const user = await requireUser()

  const settings = await getSettings()
  const lines = await listActiveLines(user.id)

  // Les deux mois suivants, pour la vue 3 mois. Construits toujours — ils ne
  // coûtent aucune requête, `buildMonthDays` est un calcul pur — et lus en une
  // seule requête de plage plutôt qu'en trois. Les vues calendrier et tableau
  // continuent d'afficher le premier mois seul (`days`) ; leurs composants
  // filtrent déjà les saisies par date, donc leur passer la plage entière ne
  // leur fait rien voir de plus.
  const mois = [month, shiftMonth(month, 1), shiftMonth(month, 2)]
  const joursParMois = mois.map((m) => buildMonthDays(m, settings.workingDays, settings.holidays))
  const dernierMois = joursParMois[2]!
  const entries = await getEntriesRange(user.id, {
    du: `${mois[0]}-01`,
    au: dernierMois[dernierMois.length - 1]!.date,
  })

  // L'engagement se lit sur toute la durée de la ligne, pas sur le mois affiché.
  const engagementTotals = await getLineEngagementTotals(
    user.id,
    lines.map((l) => l.id),
  )
  const days = joursParMois[0]!

  // Plus aucune lecture d'agenda ici : douze mois parcourus ne coûtaient pas
  // moins de douze appels freeBusy, pour un repère qu'on ne regardait peut-être
  // jamais. C'est désormais `BoutonAgenda` qui lit, à la demande, et seulement
  // sur la plage affichée (voir `actions.ts`). Cette lecture-ci est locale —
  // aucun réseau — et ne dit qu'une chose : y a-t-il quelque chose à vérifier.
  const agendaConnecte = await aUnConnecteurAgenda(user.id)

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
        vueInitiale={vue === '3mois' ? 'TROIS_MOIS' : vue === 'tableau' ? 'TABLEAU' : 'CALENDRIER'}
        month={month}
        days={days}
        mois={mois}
        joursParMois={joursParMois}
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
        // Une lecture locale, sans réseau : dit seulement si un connecteur
        // existe, pour que `BoutonAgenda` sache s'effacer plutôt que d'offrir
        // une vérification qui échouerait à tous les coups.
        agendaConnecte={agendaConnecte}
        // Le même jour que celui du rappel de prévisionnel échu, et calculé
        // une seule fois : la case du jour marque la frontière entre le
        // réalisé et le prévisionnel, et les deux ne peuvent pas la placer
        // ailleurs l'un que l'autre.
        aujourdhui={today}
      />
    </PageShell>
  )
}
