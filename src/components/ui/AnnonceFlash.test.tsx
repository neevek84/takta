// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { AnnonceFlash } from './AnnonceFlash'
import { COOKIE_ANNONCE } from '@/core/annonce/annonce'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AnnonceFlash', () => {
  it('n’affiche rien sans annonce', () => {
    render(<AnnonceFlash annonce={null} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('affiche un refus avec SA tonalité, et ne le retire pas tout seul', () => {
    vi.useFakeTimers()
    render(<AnnonceFlash annonce={{ id: 'a', message: 'Le travail a échoué.', ton: 'danger' }} />)
    act(() => vi.advanceTimersByTime(60_000))

    const bandeau = screen.getByRole('alert')
    expect(bandeau.textContent).toContain('Le travail a échoué.')
    expect(bandeau.querySelector('svg[data-icone="danger"]')).not.toBeNull()
  })

  it('retire un succès de lui-même', () => {
    vi.useFakeTimers()
    render(<AnnonceFlash annonce={{ id: 'a', message: 'Mission créée.', ton: 'success' }} />)
    expect(screen.getByRole('status').textContent).toContain('Mission créée.')

    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('efface le cookie dès l’affichage, pour ne pas ressortir à la page suivante', () => {
    document.cookie = `${COOKIE_ANNONCE}=x; path=/`
    render(<AnnonceFlash annonce={{ id: 'a', message: 'Créé.', ton: 'success' }} />)
    expect(document.cookie).not.toContain(`${COOKIE_ANNONCE}=x`)
  })

  it('se ferme à la demande', () => {
    render(<AnnonceFlash annonce={{ id: 'a', message: 'Refus.', ton: 'warning' }} />)
    act(() => screen.getByRole('button', { name: 'Fermer le message' }).click())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
