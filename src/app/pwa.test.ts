import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const racine = process.cwd()

function lire(fichier: string): string {
  return readFileSync(path.join(racine, 'public', fichier), 'utf8')
}

describe('manifeste', () => {
  const manifeste = JSON.parse(lire('manifest.webmanifest')) as Record<string, unknown>

  it('se déclare installable sur l écran d accueil', () => {
    expect(manifeste.name).toBe('CRA — Compte rendu d’activité')
    expect(manifeste.short_name).toBe('CRA')
    expect(manifeste.display).toBe('standalone')
  })

  it('démarre sur la saisie, pas sur l accueil', () => {
    // L'écran qu'on ouvre trente fois par mois est celui qui doit s'ouvrir.
    expect(manifeste.start_url).toBe('/saisie')
    expect(manifeste.scope).toBe('/')
  })

  it('déclare une icône vectorielle utilisable comme icône masquée', () => {
    const icons = manifeste.icons as Array<Record<string, string>>
    expect(icons.length).toBeGreaterThan(0)
    expect(icons.every((i) => i.src === '/icon.svg' && i.type === 'image/svg+xml')).toBe(true)
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('livre bien l icône qu il déclare', () => {
    expect(lire('icon.svg')).toContain('<svg')
  })
})

describe('service worker', () => {
  /** Charge `public/sw.js` avec un `self` factice et rend ses écouteurs. */
  function charger(): {
    handlers: Record<string, (event: unknown) => void>
    caches: { ouvertes: string[]; precachees: string[] }
  } {
    const handlers: Record<string, (event: unknown) => void> = {}
    const ouvertes: string[] = []
    const precachees: string[] = []

    const fakeCaches = {
      open: async (nom: string) => {
        ouvertes.push(nom)
        return { addAll: async (urls: string[]) => void precachees.push(...urls) }
      },
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    }

    const fakeSelf = {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        handlers[type] = handler
      },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    }

    const source = lire('sw.js')
    // eslint-disable-next-line no-new-func
    new Function('self', 'caches', 'fetch', 'Response', source)(
      fakeSelf,
      fakeCaches,
      async () => ({}),
      { error: () => ({}) },
    )

    return { handlers, caches: { ouvertes, precachees } }
  }

  it('écoute l installation, l activation et les requêtes', () => {
    const { handlers } = charger()
    expect(Object.keys(handlers).sort()).toEqual(['activate', 'fetch', 'install'])
  })

  it('met la coquille en cache à l installation', async () => {
    const { handlers, caches } = charger()
    const attentes: Array<Promise<unknown>> = []
    handlers.install!({ waitUntil: (p: Promise<unknown>) => attentes.push(p) })
    await Promise.all(attentes)

    expect(caches.precachees).toContain('/saisie')
    expect(caches.precachees).toContain('/manifest.webmanifest')
  })

  // Hors ligne = lot 5. Intercepter une écriture sans file locale ferait
  // disparaître une saisie sans que personne le sache.
  it('n intercepte jamais une écriture', () => {
    const { handlers } = charger()
    const respondWith = vi.fn()
    handlers.fetch!({
      request: { method: 'POST', url: 'https://exemple.test/saisie/2026-03' },
      respondWith,
    })
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('n intercepte jamais une route d API', () => {
    const { handlers } = charger()
    const respondWith = vi.fn()
    handlers.fetch!({
      request: { method: 'GET', url: 'https://exemple.test/api/auth/session' },
      respondWith,
    })
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('sert les navigations par le réseau d abord', () => {
    const { handlers } = charger()
    const respondWith = vi.fn()
    handlers.fetch!({
      request: { method: 'GET', url: 'https://exemple.test/saisie/2026-03' },
      respondWith,
    })
    expect(respondWith).toHaveBeenCalledTimes(1)
  })
})
