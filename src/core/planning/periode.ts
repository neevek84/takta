/**
 * La période d'un export de planning : bornes, raccourcis, validation.
 *
 * Module pur, importable côté client : le panneau d'export propose les
 * raccourcis et vérifie la saisie avant de lancer le téléchargement, la route
 * revérifie à l'arrivée. Une seule règle, deux appelants.
 */

/** Au-delà, la bande de synthèse ne tient plus sur la largeur de la page. */
export const MOIS_MAXIMUM = 12

export type PeriodePredefinie = 'MOIS' | 'TROIS_MOIS' | 'SIX_MOIS' | 'DOUZE_MOIS'

export const PERIODES_PREDEFINIES: ReadonlyArray<{
  code: PeriodePredefinie
  libelle: string
  mois: number
}> = [
  { code: 'MOIS', libelle: 'Ce mois-ci', mois: 1 },
  { code: 'TROIS_MOIS', libelle: '3 mois', mois: 3 },
  { code: 'SIX_MOIS', libelle: '6 mois', mois: 6 },
  { code: 'DOUZE_MOIS', libelle: '12 mois', mois: 12 },
]

export interface Periode {
  /** 'YYYY-MM-DD', inclus */
  du: string
  /** 'YYYY-MM-DD', inclus */
  au: string
}

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

/** Vrai pour une date 'YYYY-MM-DD' qui existe au calendrier — pas de 31 février. */
export function estDateIso(valeur: string): boolean {
  const m = DATE_ISO.exec(valeur)
  if (m === null) return false
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(annee, mois - 1, jour))
  return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour
}

const pad = (n: number): string => String(n).padStart(2, '0')

function dernierJourDuMois(annee: number, mois1a12: number): number {
  return new Date(Date.UTC(annee, mois1a12, 0)).getUTCDate()
}

/**
 * Une période prédéfinie, ouverte au premier jour de `moisDepart` ('YYYY-MM')
 * et fermée au dernier jour du n-ième mois.
 */
export function periodePredefinie(code: PeriodePredefinie, moisDepart: string): Periode {
  const nombre = PERIODES_PREDEFINIES.find((p) => p.code === code)?.mois ?? 1
  const [annee, mois] = moisDepart.split('-').map(Number) as [number, number]
  const fin = new Date(Date.UTC(annee, mois - 1 + nombre - 1, 1))
  const anneeFin = fin.getUTCFullYear()
  const moisFin = fin.getUTCMonth() + 1
  return {
    du: `${annee}-${pad(mois)}-01`,
    au: `${anneeFin}-${pad(moisFin)}-${pad(dernierJourDuMois(anneeFin, moisFin))}`,
  }
}

/** Les mois 'YYYY-MM' que la période touche, dans l'ordre. */
export function moisDeLaPeriode(periode: Periode): string[] {
  const [a1, m1] = periode.du.split('-').map(Number) as [number, number]
  const [a2, m2] = periode.au.split('-').map(Number) as [number, number]
  const out: string[] = []
  let annee = a1
  let mois = m1
  while (annee < a2 || (annee === a2 && mois <= m2)) {
    out.push(`${annee}-${pad(mois)}`)
    mois += 1
    if (mois === 13) {
      mois = 1
      annee += 1
    }
  }
  return out
}

/**
 * Rend un message d'erreur lisible, ou `null` si la période est exportable.
 *
 * Le plafond porte sur les **mois touchés**, pas sur la durée : du 15 janvier
 * au 14 janvier suivant, c'est treize mois de calendrier à dessiner.
 */
export function erreurDePeriode(periode: Periode): string | null {
  if (!estDateIso(periode.du)) return 'La date de début est invalide.'
  if (!estDateIso(periode.au)) return 'La date de fin est invalide.'
  if (periode.au < periode.du) return 'La date de fin précède la date de début.'
  if (moisDeLaPeriode(periode).length > MOIS_MAXIMUM) {
    return `La période ne peut pas couvrir plus de ${MOIS_MAXIMUM} mois.`
  }
  return null
}

/** '2026-11-24' → '24/11/2026' */
export function dateFr(iso: string): string {
  const [a, m, j] = iso.split('-')
  return `${j}/${m}/${a}`
}
