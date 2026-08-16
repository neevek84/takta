/**
 * Forme minimale d'une prestation pour les sélecteurs.
 *
 * Déclarée ici plutôt qu'importée de `services/missions` : `core/` ne dépend
 * d'aucune couche au-dessus de lui. `LineForGrid` la satisfait structurellement.
 */
export interface SelectableLine {
  id: string
  label: string
  missionLabel: string
  clientName: string
}

export interface Selection {
  clientName: string
  missionLabel: string
  lineId: string
}

function uniques(valeurs: readonly string[]): string[] {
  return [...new Set(valeurs)]
}

export function clientsOf(lines: readonly SelectableLine[]): string[] {
  return uniques(lines.map((l) => l.clientName))
}

export function missionsOf(lines: readonly SelectableLine[], clientName: string): string[] {
  return uniques(lines.filter((l) => l.clientName === clientName).map((l) => l.missionLabel))
}

export function linesOf(
  lines: readonly SelectableLine[],
  clientName: string,
  missionLabel: string,
): SelectableLine[] {
  return lines.filter((l) => l.clientName === clientName && l.missionLabel === missionLabel)
}

/**
 * La sélection à ouvrir : celle qu'on a quittée, ou la première disponible.
 *
 * Une mémoire qui pointe une prestation archivée ou désaffectée ne doit jamais
 * bloquer l'écran : on retombe silencieusement sur la première. `lines` sort
 * déjà de `listActiveLines`, scopé sur l'utilisateur et filtré des lignes et
 * missions archivées — une prestation supprimée, désaffectée ou appartenant à
 * un autre utilisateur n'y figure donc jamais, et `find` échoue naturellement
 * dessus.
 */
export function resolveSelection(
  lines: readonly SelectableLine[],
  memorise: string | null,
): Selection | null {
  const ligne = lines.find((l) => l.id === memorise) ?? lines[0]
  if (ligne === undefined) return null
  return { clientName: ligne.clientName, missionLabel: ligne.missionLabel, lineId: ligne.id }
}
