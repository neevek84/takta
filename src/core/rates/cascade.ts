export interface RateLevels {
  /** surcharge portée par la prestation */
  line?: number | null
  /** surcharge portée par la mission */
  mission?: number | null
  /** surcharge portée par le client */
  client?: number | null
  /** réglage global, toujours renseigné */
  global: number
}

function assertExploitable(valeur: number, niveau: string): void {
  if (!Number.isInteger(valeur) || valeur <= 0) {
    throw new Error(
      `La durée d'une journée définie au niveau ${niveau} doit être un entier de minutes strictement positif.`,
    )
  }
}

/**
 * Résout le facteur effectif du plus spécifique au plus général.
 * Une surcharge renseignée mais aberrante lève, plutôt que d'être sautée :
 * la sauter ferait passer une donnée corrompue pour un héritage volontaire.
 */
export function resolveMinutesParJour(levels: RateLevels): number {
  assertExploitable(levels.global, 'global')

  for (const [niveau, valeur] of [
    ['prestation', levels.line],
    ['mission', levels.mission],
    ['client', levels.client],
  ] as const) {
    if (valeur === null || valeur === undefined) continue
    assertExploitable(valeur, niveau)
    return valeur
  }

  return levels.global
}
