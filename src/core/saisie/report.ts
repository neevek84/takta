export interface FillReport {
  poses: number
  sautesCapacite: number
  dejaSaisis: number
  verrouille: boolean
}

export interface ClearReport {
  supprimees: number
  verrouille: boolean
}

function accord(n: number, singulier: string, pluriel: string): string {
  return n > 1 ? pluriel : singulier
}

/**
 * Le compte rendu du remplissage.
 *
 * Il ne dit jamais seulement ce qui a été posé : ce qui a été sauté est la
 * moitié de l'information, et la taire ferait passer un remplissage partiel
 * pour un remplissage complet.
 */
export function formatFillReport(r: FillReport): string {
  if (r.verrouille) return "Le CRA de ce mois est validé : aucun jour n'a été posé."

  if (r.poses === 0 && r.sautesCapacite === 0 && r.dejaSaisis === 0) {
    return 'Aucun jour ouvré à remplir sur ce mois.'
  }

  const morceaux = [`${r.poses} ${accord(r.poses, 'jour', 'jours')} ${accord(r.poses, 'posé', 'posés')}`]
  if (r.sautesCapacite > 0) {
    morceaux.push(
      `${r.sautesCapacite} ${accord(r.sautesCapacite, 'sauté', 'sautés')} faute de capacité`,
    )
  }
  if (r.dejaSaisis > 0) {
    morceaux.push(`${r.dejaSaisis} ${accord(r.dejaSaisis, 'déjà saisi', 'déjà saisis')}`)
  }
  return `${morceaux.join(', ')}.`
}

export function formatClearReport(r: ClearReport): string {
  if (r.verrouille) return "Le CRA de ce mois est validé : aucune saisie n'a été retirée."
  if (r.supprimees === 0) return 'Aucune saisie à retirer sur ce mois pour cette prestation.'
  return `${r.supprimees} ${accord(r.supprimees, 'saisie', 'saisies')} ${accord(r.supprimees, 'retirée', 'retirées')}.`
}
