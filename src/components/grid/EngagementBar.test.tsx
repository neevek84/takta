// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EngagementBar } from './EngagementBar'
import type { LineForGrid } from '@/services/missions'

const line: LineForGrid = {
  id: 'l1',
  label: 'Consultant ITSM',
  missionLabel: 'ITSM',
  clientName: 'ACME',
  displayUnit: 'JOUR',
  minutesParJour: 480,
  soldCentiemes: 3000, // 30 jours vendus
  allowedSlotIds: [],
}

function texte(): string {
  return screen.getByTestId('engagement-l1').textContent ?? ''
}

describe('EngagementBar', () => {
  afterEach(cleanup)

  // L'engagement se lit sur toute la durée de la ligne : le bandeau reçoit un
  // cumul déjà agrégé, jamais les seules saisies du mois affiché.
  it('déduit le reste du cumul réalisé et prévisionnel', () => {
    render(
      <EngagementBar
        line={line}
        totals={[
          { kind: 'REALISE', minutes: 480 * 18, minutesParJour: 480 },
          { kind: 'PREVISIONNEL', minutes: 480 * 7, minutesParJour: 480 },
        ]}
      />,
    )
    expect(texte()).toContain('30 vendus')
    expect(texte()).toContain('18 réalisés')
    expect(texte()).toContain('7 prévus')
    expect(texte()).toContain('5 restants')
  })

  it('affiche le vendu intégral quand la ligne n a aucune saisie', () => {
    render(<EngagementBar line={line} totals={[]} />)
    expect(texte()).toContain('30 restants')
  })

  it('signale le dépassement accumulé sur plusieurs mois', () => {
    render(
      <EngagementBar
        line={line}
        totals={[{ kind: 'REALISE', minutes: 480 * 32, minutesParJour: 480 }]}
      />,
    )
    expect(texte()).toContain('0 restants')
    expect(texte()).toContain('dépassement de 2 j')
  })

  // Le facteur qui compte est celui porté par chaque groupe de `totals`,
  // jamais `line.minutesParJour` — voir le test de gel ci-dessous.
  it('convertit chaque groupe avec le facteur figé sur ses saisies', () => {
    render(
      <EngagementBar
        line={{ ...line, minutesParJour: 480 }}
        totals={[{ kind: 'REALISE', minutes: 432 * 10, minutesParJour: 432 }]}
      />,
    )
    expect(texte()).toContain('10 réalisés')
  })

  it('cumule sans réinterpréter deux groupes écrits à des facteurs différents', () => {
    render(
      <EngagementBar
        line={line}
        totals={[
          { kind: 'REALISE', minutes: 480 * 10, minutesParJour: 480 }, // 10 j
          { kind: 'REALISE', minutes: 420 * 5, minutesParJour: 420 }, // 5 j
        ]}
      />,
    )
    expect(texte()).toContain('15 réalisés')
  })

  // Réalisé et prévisionnel se lisent en vision monochrome : le prévisionnel
  // porte une hachure et un intitulé, pas seulement une teinte plus claire.
  it('distingue le segment prévisionnel du réalisé sans la couleur', () => {
    render(
      <EngagementBar
        line={line}
        totals={[
          { kind: 'REALISE', minutes: 480 * 18, minutesParJour: 480 },
          { kind: 'PREVISIONNEL', minutes: 480 * 7, minutesParJour: 480 },
        ]}
      />,
    )
    const bandeau = screen.getByTestId('engagement-l1')
    // Les segments se repèrent par un attribut de données, pas par leur
    // `title` : un `title` sur un `<div>` n'est ni atteignable au clavier ni
    // annoncé, il ne peut donc pas être ce que le test tient pour un nommage.
    const prevu = bandeau.querySelector('[data-segment="prevu"]')
    const realise = bandeau.querySelector('[data-segment="realise"]')

    expect(realise).not.toBeNull()
    expect(prevu).not.toBeNull()
    expect(prevu!.className).toContain('pattern-hatch')
    expect(realise!.className).not.toContain('pattern-hatch')
  })

  // TROU (lot 1d) — comblé : le gel du facteur de conversion à l'écriture est
  // effectif dans computeEngagement et charge.ts, mais ne l'était pas ici. Le
  // bandeau reconvertissait des minutes brutes avec le facteur *courant* de la
  // ligne, si bien qu'un changement de réglage (donc du facteur courant, via
  // la cascade) réinterprétait le réalisé/prévisionnel déjà affiché —
  // exactement ce que ce lot interdit partout ailleurs. `totals` porte
  // désormais le facteur figé par groupe : faire varier `line.minutesParJour`
  // seul ne doit plus rien changer à l'affichage.
  it("ne réinterprète pas l'historique quand le facteur courant de la ligne change", () => {
    const totals = [{ kind: 'REALISE' as const, minutes: 480 * 18, minutesParJour: 480 }]
    const { rerender } = render(<EngagementBar line={line} totals={totals} />)
    expect(texte()).toContain('18 réalisés')

    // Simule un changement de réglage global qui fait passer le facteur
    // courant de la ligne de 480 à 420 (cascade Settings → client → mission →
    // ligne), sans toucher aux saisies déjà écrites (`totals` inchangé).
    rerender(<EngagementBar line={{ ...line, minutesParJour: 420 }} totals={totals} />)
    expect(texte()).toContain('18 réalisés')
  })
})
