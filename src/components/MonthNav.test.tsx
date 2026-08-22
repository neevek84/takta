// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const { push, parametres } = vi.hoisted(() => ({
  push: vi.fn(),
  parametres: { valeur: new URLSearchParams() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => parametres.valeur,
}))

import { MonthNav, monthLabel } from './MonthNav'

afterEach(() => {
  cleanup()
  push.mockReset()
  parametres.valeur = new URLSearchParams()
})

describe('monthLabel', () => {
  it('affiche le mois en toutes lettres, en français', () => {
    expect(monthLabel('2026-08')).toBe('août 2026')
  })
})

describe('MonthNav', () => {
  it('affiche le mois courant en toutes lettres', () => {
    render(<MonthNav month="2026-08" />)
    expect(screen.getByText('août 2026')).toBeDefined()
  })

  it('pointe les flèches vers le mois précédent et le mois suivant', () => {
    render(<MonthNav month="2026-08" />)
    expect(screen.getByLabelText('Mois précédent').getAttribute('href')).toBe('/saisie/2026-07')
    expect(screen.getByLabelText('Mois suivant').getAttribute('href')).toBe('/saisie/2026-09')
  })

  // Constat revue C.4 — la spec §6 exige un sélecteur direct de mois en plus
  // des flèches et du retour au mois courant : sans lui, atteindre un mois
  // distant demande autant de clics que de mois d'écart.
  it('propose un sélecteur direct de mois', () => {
    render(<MonthNav month="2026-08" />)
    const input = screen.getByLabelText(/aller directement à un mois/i) as HTMLInputElement
    expect(input.type).toBe('month')
    expect(input.value).toBe('2026-08')
  })

  it('navigue vers le mois choisi dans le sélecteur direct', () => {
    render(<MonthNav month="2026-08" />)
    const input = screen.getByLabelText(/aller directement à un mois/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '2027-03' } })
    expect(push).toHaveBeenCalledWith('/saisie/2027-03')
  })

  it('masque le lien « Mois courant » quand on y est déjà', () => {
    const today = new Date().toISOString().slice(0, 7)
    render(<MonthNav month={today} />)
    expect(screen.queryByText('Mois courant')).toBeNull()
  })

  it('affiche le lien « Mois courant » sur un autre mois', () => {
    render(<MonthNav month="2020-01" />)
    expect(screen.getByText('Mois courant')).toBeDefined()
  })
})

/**
 * **Changer de mois ne doit rien effacer de ce qu'on regarde.**
 *
 * Le porteur travaillait en tableau multi-CRA : au mois suivant, il retombait
 * en calendrier. Chaque mois se sert par une route à part, et l'état du
 * composant ne survit pas à la navigation. Ce qu'on regarde vit donc dans
 * l'adresse — ce qui le rend au passage partageable et rechargeable.
 */
describe('la navigation garde ce qu on regarde', () => {
  it('reporte les paramètres sur les flèches et sur le mois courant', () => {
    parametres.valeur = new URLSearchParams('vue=tableau')
    // Un mois qui n'est **pas** le mois courant : le retour au mois courant ne
    // s'affiche qu'à cette condition, et c'est lui qu'on veut vérifier ici.
    render(<MonthNav month="2020-05" />)

    expect(screen.getByLabelText('Mois précédent').getAttribute('href')).toBe(
      '/saisie/2020-04?vue=tableau',
    )
    expect(screen.getByLabelText('Mois suivant').getAttribute('href')).toBe(
      '/saisie/2020-06?vue=tableau',
    )
    expect(screen.getByText('Mois courant').getAttribute('href')).toContain('?vue=tableau')
  })

  it('les reporte aussi sur le choix direct d un mois', () => {
    parametres.valeur = new URLSearchParams('vue=tableau')
    render(<MonthNav month="2026-08" />)

    fireEvent.change(screen.getByLabelText('Aller directement à un mois'), {
      target: { value: '2026-11' },
    })

    expect(push).toHaveBeenCalledWith('/saisie/2026-11?vue=tableau')
  })

  // Sans paramètre, l'adresse reste nue : un `?` orphelin dans la barre
  // d'adresse donne l'air d'un lien fabriqué à la main.
  it('ne laisse aucun point d interrogation orphelin', () => {
    render(<MonthNav month="2026-08" />)

    expect(screen.getByLabelText('Mois suivant').getAttribute('href')).toBe('/saisie/2026-09')
  })
})
