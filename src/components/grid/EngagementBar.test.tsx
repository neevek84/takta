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
  // porte un contour tireté et un intitulé, pas seulement sa propre teinte.
  // Le tireté a remplacé la hachure — deux teintes désormais opaques ne se
  // distingueraient pas davantage l'une de l'autre sans lui.
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
    expect(prevu!.className).toContain('border-dashed')
    expect(realise!.className).not.toContain('border-dashed')
  })

  // Un contour occupe sa largeur même quand le segment n'en a aucune : posé
  // sans condition, il laisserait un liseré tireté de deux points sur une
  // ligne sans le moindre prévisionnel — un état annoncé qui n'existe pas.
  it('ne laisse aucun liseré quand il n y a rien de prévisionnel', () => {
    render(
      <EngagementBar
        line={line}
        totals={[{ kind: 'REALISE', minutes: 480 * 18, minutesParJour: 480 }]}
      />,
    )
    const prevu = screen.getByTestId('engagement-l1').querySelector('[data-segment="prevu"]')
    expect(prevu!.className).not.toContain('border-dashed')
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

/**
 * La réglette du mois : le même bandeau, sous le calendrier, à sa largeur.
 *
 * Le calendrier n'affichait aucun total — on saisissait douze jours sans jamais
 * voir combien —, et l'engagement, la seule chose que cet outil fait et que
 * Timizer ne fait pas, ne vivait que dans la vue tableau.
 */
describe('EngagementBar en pleine largeur', () => {
  afterEach(cleanup)

  const dixHuitEtSept = [
    { kind: 'REALISE' as const, minutes: 480 * 18, minutesParJour: 480 },
    { kind: 'PREVISIONNEL' as const, minutes: 480 * 7, minutesParJour: 480 },
  ]

  function piste(): HTMLElement {
    return screen.getByTestId('piste-engagement-l1')
  }

  it('garde sa piste compacte par défaut, pour ne rien changer au tableau', () => {
    render(<EngagementBar line={line} totals={dixHuitEtSept} />)
    expect(piste().className).toContain('w-40')
    expect(piste().className).not.toContain('w-full')
  })

  it('prend toute la largeur et de la hauteur quand on la lui demande', () => {
    render(<EngagementBar line={line} totals={dixHuitEtSept} pleineLargeur />)
    // `cn()` résout le conflit : `w-40` et `h-2` ne survivent pas à `w-full`
    // et `h-5`, quel que soit l'ordre d'insertion des règles CSS.
    expect(piste().className).toContain('w-full')
    expect(piste().className).not.toContain('w-40')
    expect(piste().className).toContain('h-5')
    expect(piste().className).not.toContain('h-2')
  })

  it('pose le trait d aujourd hui à la frontière du réalisé', () => {
    render(<EngagementBar line={line} totals={dixHuitEtSept} pleineLargeur />)
    const trait = piste().querySelector('[data-testid="trait-aujourdhui"]')
    expect(trait).not.toBeNull()
    // 18 réalisés sur 30 vendus : la frontière est à 60 %, pas ailleurs.
    expect((trait as HTMLElement).style.left).toBe('60%')
  })

  it('ne confie au trait aucune information qui ne soit écrite en toutes lettres', () => {
    // Le commentaire de ce trait affirmait qu'il « tranche sur l'accent comme
    // sur l'ambre par construction ». C'est faux et rien ne le vérifiait :
    // `MIN_LIGHTNESS_GAP` vaut 4 unités de L*, ce n'est pas un rapport de
    // contraste, et il ne porte que sur `surface`/`off`/`offStrong` — jamais
    // sur `accent` ni sur `prevu`. Mesuré, le trait tient 1,36 à 1,45:1 sur la
    // piste vide et 1,83:1 sur l'ambre de trois préréglages.
    //
    // Le contrat honnête est donc celui-ci, et c'est lui qu'on vérifie : le
    // trait est **redondant**. Il est masqué aux lecteurs d'écran parce que la
    // frontière qu'il désigne est déjà écrite en chiffres juste dessous ; le
    // jour où ces chiffres disparaîtraient, un repère de 2 points à 1,4:1
    // resterait seul à porter l'information.
    render(<EngagementBar line={line} totals={dixHuitEtSept} pleineLargeur />)

    const trait = piste().querySelector('[data-testid="trait-aujourdhui"]')!
    expect(trait.getAttribute('aria-hidden')).toBe('true')
    // La frontière que le trait désigne : le réalisé, et ce qui reste après.
    expect(texte()).toContain('18 réalisés')
    expect(texte()).toContain('7 prévus')
  })

  it('ne pose aucun trait sur la barre compacte du tableau', () => {
    render(<EngagementBar line={line} totals={dixHuitEtSept} />)
    expect(piste().querySelector('[data-testid="trait-aujourdhui"]')).toBeNull()
  })

  it('ne change pas le calcul de l engagement', () => {
    // `computeEngagement` ne bouge pas d'une ligne : la réglette change de
    // place et de largeur, jamais de logique.
    render(<EngagementBar line={line} totals={dixHuitEtSept} pleineLargeur />)
    expect(texte()).toContain('30 vendus')
    expect(texte()).toContain('18 réalisés')
    expect(texte()).toContain('7 prévus')
    expect(texte()).toContain('5 restants')
  })
})
