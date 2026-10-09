// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { CraDocument } from '@/core/cra/document'
import { CraLecture } from './CraLecture'

afterEach(cleanup)

const doc = {
  emetteur: { nom: 'Kreativ', adresse: '', siret: '', email: '' },
  clientNom: 'Client SA', missionLabel: 'ITSM', mois: '2026-09', moisLibelle: 'septembre 2026',
  signataireNom: 'Jeanne', signataireEmail: 'j@c.fr',
  lignes: [{ label: 'Consultant', jours: [{ date: '2026-09-01', centiemes: 100 }], totalCentiemes: 100, engagement: {} }],
  totalCentiemes: 100, joursDuMois: ['2026-09-01', '2026-09-05'], feries: [], engagementMission: {},
} as unknown as CraDocument

describe('CraLecture', () => {
  it('affiche le client, le mois, le total et la ligne', () => {
    render(<CraLecture document={doc} />)
    expect(screen.getByText(/Client SA · ITSM/)).toBeTruthy()
    expect(screen.getAllByText(/septembre 2026/).length).toBeGreaterThan(0)
    // Le libellé revient dans le bloc d'engagement : on le cherche au tableau.
    expect(within(screen.getByRole('table')).getByText('Consultant')).toBeTruthy()
  })

  it('nomme le week-end au lieu de seulement le griser', () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.textContent).toMatch(/sam\./)
  })

  it("n'affiche aucun montant", () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.textContent).not.toMatch(/€|EUR|montant/i)
  })

  it("n'offre aucun champ de saisie", () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.querySelectorAll('input, textarea, select, button')).toHaveLength(0)
  })
})

const eng = (vendu: number, valide: number, enValidation: number, planifie: number) => {
  const consomme = valide + enValidation + planifie
  return {
    venduCentiemes: vendu, valideCentiemes: valide, enValidationCentiemes: enValidation,
    planifieCentiemes: planifie, consommeCentiemes: consomme,
    resteCentiemes: Math.max(0, vendu - consomme), depassementCentiemes: Math.max(0, consomme - vendu),
  }
}

const octobre = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)

function docOctobre(lignes: CraDocument['lignes']): CraDocument {
  return {
    ...doc,
    mois: '2026-10', moisLibelle: 'octobre 2026',
    lignes,
    totalCentiemes: lignes.reduce((s, l) => s + l.totalCentiemes, 0),
    joursDuMois: octobre, feries: [],
    engagementMission: eng(3000, 500, 250, 400),
  } as CraDocument
}

const conseil = {
  label: 'Conseil',
  jours: [{ date: '2026-10-01', centiemes: 100 }, { date: '2026-10-02', centiemes: 50 }],
  totalCentiemes: 150,
  engagement: eng(2000, 500, 150, 400),
}
const formation = {
  label: 'Formation',
  jours: [{ date: '2026-10-01', centiemes: 100 }],
  totalCentiemes: 100,
  engagement: eng(1000, 0, 100, 0),
}

describe('CraLecture — les jours dessinés', () => {
  it('dessine une journée pleine en aplat, dans la teinte de la prestation', () => {
    render(<CraLecture document={docOctobre([conseil])} />)
    const aplat = screen.getByTestId('remplissage-0-2026-10-01')
    expect(aplat.getAttribute('data-forme')).toBe('PLEINE')
    // Seule à l'écran, la prestation prend l'aplat « saisi », comme au calendrier.
    expect(aplat.className).toMatch(/\bbg-saisie\b/)
  })

  it('dessine une demi-quantité en aplat partiel à 50 %', () => {
    render(<CraLecture document={docOctobre([conseil])} />)
    const aplat = screen.getByTestId('remplissage-0-2026-10-02')
    expect(aplat.getAttribute('data-forme')).toBe('PARTIELLE')
    expect(aplat.style.height).toBe('50%')
  })

  it('partage la case en deux bandes quand deux prestations se servent le même jour', () => {
    render(<CraLecture document={docOctobre([conseil, formation])} />)
    const a = screen.getByTestId('bande-0-2026-10-01')
    const b = screen.getByTestId('bande-1-2026-10-01')
    expect([a.getAttribute('data-bande'), a.getAttribute('data-bandes')]).toEqual(['0', '2'])
    expect([b.getAttribute('data-bande'), b.getAttribute('data-bandes')]).toEqual(['1', '2'])
    expect(screen.getByTestId('remplissage-0-2026-10-01').className).toMatch(/\bbg-cat-a\b/)
    expect(screen.getByTestId('remplissage-1-2026-10-01').className).toMatch(/\bbg-cat-b\b/)
    // Un jour servi par une seule prestation garde toute la largeur.
    expect(screen.getByTestId('bande-0-2026-10-02').getAttribute('data-bandes')).toBe('1')
  })

  it('pose une pastille de la teinte devant chaque prestation du tableau', () => {
    render(<CraLecture document={docOctobre([conseil, formation])} />)
    expect(screen.getByTestId('pastille-0').className).toMatch(/\bbg-cat-a\b/)
    expect(screen.getByTestId('pastille-1').className).toMatch(/\bbg-cat-b\b/)
  })

  it('donne à chaque jour un nom accessible avec sa date et ses quantités par prestation', () => {
    render(<CraLecture document={docOctobre([conseil, formation])} />)
    const jour = screen.getByTestId('jour-2026-10-01')
    expect(jour.textContent).toMatch(/jeu\. 01 octobre 2026/)
    expect(jour.textContent).toMatch(/Conseil : 1,00 j/)
    expect(jour.textContent).toMatch(/Formation : 1,00 j/)
  })
})

describe('CraLecture — les jours de la semaine', () => {
  it('pose le 1er octobre 2026 sous le jeudi, après trois cases vides', () => {
    render(<CraLecture document={docOctobre([conseil])} />)
    const entetes = screen.getByTestId('entete-semaine')
    expect(entetes.textContent).toBe('lun.mar.mer.jeu.ven.sam.dim.')
    const grille = screen.getByTestId('grille-mois')
    const cases = Array.from(grille.children)
    expect(cases.slice(0, 3).every((c) => c.getAttribute('data-vide') === 'true')).toBe(true)
    expect(cases[3]!.getAttribute('data-testid')).toBe('jour-2026-10-01')
  })

  it("n'ajoute aucune case vide quand le mois commence un lundi", () => {
    const juin = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`)
    render(<CraLecture document={{ ...docOctobre([]), joursDuMois: juin }} />)
    expect(screen.getByTestId('grille-mois').children[0]!.getAttribute('data-testid')).toBe('jour-2026-06-01')
  })
})

describe('CraLecture — où en est la mission', () => {
  it('rend la piste de chaque prestation avec ses chiffres en toutes lettres', () => {
    render(<CraLecture document={docOctobre([conseil, formation])} />)
    const bloc = screen.getByRole('region', { name: 'Où en est la mission' })
    const c = within(bloc).getByTestId('engagement-0')
    expect(c.textContent).toMatch(/Conseil/)
    expect(c.textContent).toMatch(/20,00 j vendus/)
    expect(c.textContent).toMatch(/5,00 validés · 1,50 en validation · 4,00 planifiés/)
    expect(c.textContent).toMatch(/9,50 restants/)
    expect(within(c).getByTestId('piste').querySelector('[data-segment="planifie"]')!.className).toMatch(/border-dashed/)
    expect(bloc.textContent).toMatch(/au moment de l’envoi/)
  })

  it('nomme les segments dans une légende visible', () => {
    render(<CraLecture document={docOctobre([conseil])} />)
    const legende = screen.getByTestId('legende-engagement')
    for (const nom of ['Validé', 'En validation', 'Planifié', 'Restant']) expect(legende.textContent).toContain(nom)
  })

  it("n'affiche le total de la mission que s'il y a plus d'une prestation", () => {
    render(<CraLecture document={docOctobre([conseil])} />)
    expect(screen.queryByTestId('engagement-mission')).toBeNull()
    cleanup()
    render(<CraLecture document={docOctobre([conseil, formation])} />)
    const total = screen.getByTestId('engagement-mission')
    expect(total.textContent).toMatch(/30,00 j vendus/)
    expect(total.textContent).toMatch(/11,50 jours consommés/)
  })

  it('dit le dépassement en toutes lettres', () => {
    const deborde = { ...formation, engagement: eng(100, 100, 50, 0) }
    render(<CraLecture document={docOctobre([deborde])} />)
    expect(screen.getByTestId('engagement-0').textContent).toMatch(/dépassement de 0,50 j/)
    expect(screen.getByTestId('legende-engagement').textContent).toContain('Dépassement')
  })

  it("n'affiche toujours aucun montant", () => {
    const { container } = render(<CraLecture document={docOctobre([conseil, formation])} />)
    expect(container.textContent).not.toMatch(/€|EUR|montant/i)
    expect(container.querySelectorAll('input, textarea, select, button')).toHaveLength(0)
  })
})
