'use client'

const CLE = 'cra.saisie.prestation'

/**
 * Dernière prestation saisie.
 *
 * Une préférence d'affichage, pas une donnée métier : le stockage local
 * suffit, et l'absence de `window` (rendu serveur) n'est jamais une erreur.
 */
export function readSelection(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(CLE)
  } catch {
    return null
  }
}

export function writeSelection(lineId: string): void {
  if (typeof window === 'undefined' || lineId === '') return
  try {
    window.localStorage.setItem(CLE, lineId)
  } catch {
    // Navigation privée, quota plein : perdre la mémoire n'empêche pas de saisir.
  }
}
