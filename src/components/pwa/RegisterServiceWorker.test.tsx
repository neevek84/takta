// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { RegisterServiceWorker } from './RegisterServiceWorker'

describe('RegisterServiceWorker', () => {
  afterEach(() => {
    cleanup()
    // @ts-expect-error nettoyage du navigateur simulé
    delete navigator.serviceWorker
  })

  it('enregistre le service worker quand le navigateur le sait faire', () => {
    const register = vi.fn(async () => ({}))
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    })

    render(<RegisterServiceWorker />)
    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('ne casse rien quand le navigateur ne le sait pas', () => {
    expect(() => render(<RegisterServiceWorker />)).not.toThrow()
  })

  it('n affiche rien', () => {
    const { container } = render(<RegisterServiceWorker />)
    expect(container.innerHTML).toBe('')
  })
})
