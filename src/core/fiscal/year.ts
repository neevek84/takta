export interface FiscalYear {
  /** 'YYYY-MM-DD' */
  start: string
  /** 'YYYY-MM-DD' */
  end: string
  /** « Exercice 2026-2027 », ou « Exercice 2026 » si l'exercice est civil */
  label: string
  /** 12 mois 'YYYY-MM', de l'ouverture à la clôture */
  months: string[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * `debutMois` est un réglage utilisateur (`Settings.debutExerciceMois`) qui
 * traverse la validation zod sur le chemin réel de l'application, mais cette
 * fonction est pure et ne doit pas fabriquer silencieusement des dates
 * invalides si elle est appelée directement (tests, futurs appelants). On
 * lève une exception plutôt que de clamper ou normaliser : normaliser
 * masquerait une erreur d'appel au lieu de la signaler.
 */
function assertDebutMoisValide(debutMois: number): void {
  if (!Number.isInteger(debutMois) || debutMois < 1 || debutMois > 12) {
    throw new Error(
      `debutMois invalide : ${debutMois} (doit être un entier entre 1 et 12 inclus)`,
    )
  }
}

export function fiscalYearFromStartYear(startYear: number, debutMois: number): FiscalYear {
  assertDebutMoisValide(debutMois)
  const endMonth = debutMois === 1 ? 12 : debutMois - 1
  const endYear = debutMois === 1 ? startYear : startYear + 1
  // Jour 0 du mois suivant = dernier jour du mois courant. Gère février bissextile.
  const endDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()

  const months: string[] = []
  for (let i = 0; i < 12; i++) {
    const offset = debutMois - 1 + i
    months.push(`${startYear + Math.floor(offset / 12)}-${pad((offset % 12) + 1)}`)
  }

  return {
    start: `${startYear}-${pad(debutMois)}-01`,
    end: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
    label: debutMois === 1 ? `Exercice ${startYear}` : `Exercice ${startYear}-${startYear + 1}`,
    months,
  }
}

export function fiscalYearBounds(date: string, debutMois: number): FiscalYear {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const startYear = month >= debutMois ? year : year - 1
  return fiscalYearFromStartYear(startYear, debutMois)
}
