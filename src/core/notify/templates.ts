export interface Gabarit {
  sujet: string
  corps: string
}

/**
 * Les gabarits **refusent le vide**. « Pas de notification pour ce qui
 * n'appelle aucune action » : un gabarit qui accepterait une liste vide
 * enverrait un courriel disant qu'il n'y a rien à faire, et on apprendrait
 * à l'ignorer. C'est l'appelant qui décide de ne pas notifier.
 */
export function gabaritRappelSaisie(args: { mois: string; jours: string[] }): Gabarit {
  if (args.jours.length === 0) {
    throw new Error('Rappel de saisie : aucun jour à signaler, il ne faut pas notifier.')
  }

  return {
    sujet: `CRA — ${args.jours.length} jour(s) ouvré(s) sans saisie en ${args.mois}`,
    corps: [
      `Les jours ouvrés suivants de ${args.mois} ne portent aucune saisie :`,
      '',
      ...args.jours.map((jour) => `  · ${jour}`),
      '',
      'Ce message ne modifie rien : la saisie reste entièrement à votre main.',
    ].join('\n'),
  }
}

export function gabaritRappelCloture(args: {
  mois: string
  missions: ReadonlyArray<{ label: string; etat: string }>
}): Gabarit {
  if (args.missions.length === 0) {
    throw new Error('Rappel de clôture : aucun CRA à signaler, il ne faut pas notifier.')
  }

  return {
    sujet: `CRA — ${args.missions.length} CRA à clôturer pour ${args.mois}`,
    corps: [
      `Ces CRA de ${args.mois} ne sont pas encore envoyés :`,
      '',
      ...args.missions.map((m) => `  · ${m.label} — ${m.etat}`),
      '',
      "Aucun automatisme ne les enverra : l'envoi reste un geste humain.",
    ].join('\n'),
  }
}

export function gabaritRuptureJournal(args: { seq: number; raison: string }): Gabarit {
  return {
    sujet: `CRA — rupture de la chaîne du journal à l’entrée ${args.seq}`,
    corps: [
      'La vérification quotidienne du journal de preuve a détecté une rupture.',
      '',
      `  Entrée en cause : ${args.seq}`,
      `  Nature          : ${args.raison}`,
      '',
      "Une entrée a été modifiée, supprimée ou insérée en dehors de l'application.",
      'Les entrées antérieures à celle-ci restent vérifiables.',
    ].join('\n'),
  }
}
