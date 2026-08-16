import { compareDayLength } from '@/core/dolibarr/timespent'
import { fiscalYearBounds } from '@/core/fiscal/year'
import { getSettings, updateSettings } from '@/services/settings'
import { previewRecalibration, recalibrateOpenMonths } from '@/services/rates'
import type { DolibarrApi } from './api'

const CONSTANTE_EXERCICE = 'SOCIETE_FISCAL_MONTH_START'
const CONSTANTE_JOURNEE = 'TIMESHEET_DAY_DURATION'

export const REGLAGE_EXERCICE = "mois de début d'exercice"
export const REGLAGE_JOURNEE = "durée d'une journée"

export interface SetupProposal {
  debutExerciceMois: { local: number; dolibarr: number | null; divergent: boolean }
  minutesParJour: {
    local: number
    dolibarr: number | null
    divergent: boolean
    /** ce que Dolibarr affichera pour une journée locale pleine */
    centiemesAffichesParDolibarr: number | null
  }
  /** bornes de l'exercice **après** reprise, null si rien à reprendre */
  exerciceApresReprise: { debut: string; fin: string; label: string } | null
  reetalonnage: { concernees: number; verrouillees: number }
}

/**
 * Lit une constante de configuration, `null` si elle manque ou si sa valeur est
 * inexploitable.
 *
 * Ce qui **n'est pas** ramené à `null` : une panne. Une instance éteinte ne
 * rend pas « constante absente », elle ne rend rien du tout, et l'erreur
 * remonte pour que l'écran dise qu'il n'a pas pu lire. L'avaler ferait afficher
 * « déjà aligné » à un écran qui n'a comparé rien du tout — le pire des deux
 * mensonges, parce qu'il rassure.
 */
async function lireConstante(api: DolibarrApi, nom: string): Promise<number | null> {
  const brut = await api.getSetupValue(nom)
  if (brut === null || brut.trim() === '') return null
  const n = Number(brut)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Un mois d'exercice n'existe qu'entre 1 et 12 ; le reste n'est pas un mois. */
function moisExploitable(valeur: number | null): number | null {
  return valeur !== null && Number.isInteger(valeur) && valeur >= 1 && valeur <= 12 ? valeur : null
}

/**
 * Ce que la reprise va changer **concrètement**, calculé avant toute écriture.
 *
 * Reprendre l'une ou l'autre de ces valeurs modifie des chiffres que
 * l'utilisateur croit acquis : le mois d'exercice déplace les bornes de son
 * objectif de chiffre d'affaires, la durée d'une journée change la conversion
 * des minutes en jours pour tout ce qui sera saisi ensuite. Une reprise
 * silencieuse serait une trahison de confiance (spec §8).
 *
 * Ce qu'elle ne change **jamais** : le calcul d'un CRA déjà validé. Chaque
 * saisie porte son facteur figé à l'écriture, et le réétalonnage ne touche que
 * les mois ouverts — voir `recalibrateOpenMonths`, dont cette fonction se
 * contente d'annoncer le décompte.
 */
export async function previewDolibarrSetup(args: {
  userId: string
  api: DolibarrApi
  /** 'YYYY-MM-DD' — paramètre pour rester testable sans geler l'horloge */
  today?: string
}): Promise<SetupProposal> {
  const settings = await getSettings()
  const today = args.today ?? new Date().toISOString().slice(0, 10)

  const moisDistant = await lireConstante(args.api, CONSTANTE_EXERCICE)
  const heuresDistantes = await lireConstante(args.api, CONSTANTE_JOURNEE)

  const moisValide = moisExploitable(moisDistant)

  const comparaison =
    heuresDistantes === null
      ? null
      : compareDayLength({
          minutesParJourLocal: settings.minutesParJour,
          heuresParJourDolibarr: heuresDistantes,
        })

  const exerciceDivergent = moisValide !== null && moisValide !== settings.debutExerciceMois
  const exercice = exerciceDivergent ? fiscalYearBounds(today, moisValide) : null

  // L'aperçu du réétalonnage se calcule avec la durée **hypothétique** : sans
  // cela, il annoncerait toujours zéro, puisque rien n'a encore changé.
  const reetalonnage =
    comparaison !== null && comparaison.divergent
      ? await previewRecalibration(args.userId, comparaison.minutesParJourDolibarr)
      : { concernees: 0, verrouillees: 0 }

  return {
    debutExerciceMois: {
      local: settings.debutExerciceMois,
      dolibarr: moisValide,
      divergent: exerciceDivergent,
    },
    minutesParJour: {
      local: settings.minutesParJour,
      dolibarr: comparaison?.minutesParJourDolibarr ?? null,
      divergent: comparaison?.divergent ?? false,
      centiemesAffichesParDolibarr: comparaison?.centiemesAffichesParDolibarr ?? null,
    },
    exerciceApresReprise:
      exercice === null
        ? null
        : { debut: exercice.start, fin: exercice.end, label: exercice.label },
    reetalonnage,
  }
}

/**
 * Applique la reprise, réglage par réglage, et seulement ce qui a été coché.
 *
 * Rien n'est repris que l'appelant n'ait demandé, et rien n'est repris qui ne
 * soit lisible : une constante absente laisse le réglage local en place plutôt
 * que d'écrire une valeur par défaut inventée ici.
 */
export async function applyDolibarrSetup(args: {
  userId: string
  api: DolibarrApi
  reprendreExercice: boolean
  reprendreDureeJournee: boolean
  reetalonner: boolean
}): Promise<{ reglagesRepris: string[]; recalibrees: number; sauteesVerrouillees: number }> {
  const reglagesRepris: string[] = []

  if (args.reprendreExercice) {
    const mois = moisExploitable(await lireConstante(args.api, CONSTANTE_EXERCICE))
    if (mois !== null) {
      await updateSettings({ debutExerciceMois: mois })
      reglagesRepris.push(REGLAGE_EXERCICE)
    }
  }

  let dureeReprise = false
  if (args.reprendreDureeJournee) {
    const heures = await lireConstante(args.api, CONSTANTE_JOURNEE)
    if (heures !== null) {
      const settings = await getSettings()
      const comparaison = compareDayLength({
        minutesParJourLocal: settings.minutesParJour,
        heuresParJourDolibarr: heures,
      })
      // `updateSettings` valide, et lève sur une durée que le réglage local
      // n'admet pas. On la laisse lever : écrire une valeur tronquée « pour
      // que ça passe » poserait un facteur aberrant sous lequel toute saisie
      // ultérieure serait fausse, sans que rien ne le dise.
      await updateSettings({ minutesParJour: comparaison.minutesParJourDolibarr })
      reglagesRepris.push(REGLAGE_JOURNEE)
      dureeReprise = true
    }
  }

  // Le réétalonnage vient **après** l'écriture du réglage : `recalibrateOpenMonths`
  // compare le facteur figé de chaque saisie à ce que la cascade donne
  // maintenant. Et il ne touche jamais un mois validé — c'est le mécanisme du
  // lot 1d, réutilisé tel quel, pas réécrit ici.
  //
  // Conditionné à `dureeReprise` : réétalonner sans avoir rien repris
  // alignerait les mois ouverts sur un réglage que l'utilisateur n'a pas
  // touché, ce qu'il n'a pas demandé.
  if (args.reetalonner && dureeReprise) {
    const r = await recalibrateOpenMonths(args.userId)
    return {
      reglagesRepris,
      recalibrees: r.recalibrees,
      sauteesVerrouillees: r.sauteesVerrouillees,
    }
  }

  return { reglagesRepris, recalibrees: 0, sauteesVerrouillees: 0 }
}
