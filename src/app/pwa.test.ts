import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const racine = process.cwd()

function lire(fichier: string): string {
  return readFileSync(path.join(racine, 'public', fichier), 'utf8')
}

describe('manifeste', () => {
  const manifeste = JSON.parse(lire('manifest.webmanifest')) as Record<string, unknown>

  it('se déclare installable sur l écran d accueil', () => {
    expect(manifeste.name).toBe('takta — le temps qui fait foi')
    expect(manifeste.short_name).toBe('takta')
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

describe('icône iOS', () => {
  // iOS ignore complètement les icônes du manifeste. Sans `apple-touch-icon`,
  // une application ajoutée à l'écran d'accueil affiche une capture d'écran de
  // la page — alors que `appleWebApp: { capable: true }` est déclaré.
  const fichier = path.join(racine, 'public/apple-touch-icon.png')

  it('existe en PNG, seul format qu iOS accepte', () => {
    expect(existsSync(fichier), 'public/apple-touch-icon.png absent').toBe(true)

    const png = readFileSync(fichier)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('mesure 180×180, la taille demandée par iOS', () => {
    // Les dimensions sont dans le bloc IHDR, qui suit la signature (8 octets)
    // et l'en-tête de bloc (4 octets de longueur + 4 de type).
    const png = readFileSync(fichier)
    expect(png.readUInt32BE(16)).toBe(180)
    expect(png.readUInt32BE(20)).toBe(180)
  })

  it('est annoncé par le layout', () => {
    const layout = readFileSync(path.join(racine, 'src/app/layout.tsx'), 'utf8')
    expect(layout).toContain("apple: '/apple-touch-icon.png'")
  })
})

// ————————————————————————————————————————————————————————————————————————
// Ce que l'application sert réellement à une URL donnée.
//
// La coquille du service worker est préchargée par `cache.addAll`, qui fait
// de vraies requêtes HTTP. Un test qui recopie la constante `COQUILLE` ne
// prouve rien : il faut savoir ce que chaque URL rend. On le déduit des
// fichiers du dépôt — un fichier de `public/` est servi tel quel, une route
// de l'App Router est servie par sa `page.tsx`, et une page qui appelle
// `redirect()` répond une redirection.
// ————————————————————————————————————————————————————————————————————————

/** Fichier de `public/` servant cette URL, s'il existe. */
function fichierStatique(url: string): string | null {
  const p = path.join(racine, 'public', url)
  return existsSync(p) && statSync(p).isFile() ? p : null
}

/** `page.tsx` servant cette URL, les groupes de routes `(x)` ne comptant pas. */
function pageDeRoute(url: string): string | null {
  const segments = url.split('/').filter(Boolean)
  const trouves: string[] = []

  const parcourir = (dossier: string, restants: string[]): void => {
    if (restants.length === 0) {
      const page = path.join(dossier, 'page.tsx')
      if (existsSync(page)) trouves.push(page)
      return
    }
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (!entree.isDirectory()) continue
      const chemin = path.join(dossier, entree.name)
      // Un groupe de routes `(app)` n'apparaît pas dans l'URL.
      if (/^\(.*\)$/.test(entree.name)) parcourir(chemin, restants)
      else if (entree.name === restants[0]) parcourir(chemin, restants.slice(1))
    }
  }

  parcourir(path.join(racine, 'src/app'), segments)
  return trouves[0] ?? null
}

/** Ce que renvoie l'application pour cette URL. */
function servi(url: string): { existe: boolean; redirige: boolean; par: string } {
  const statique = fichierStatique(url)
  if (statique) return { existe: true, redirige: false, par: `public${url}` }

  const page = pageDeRoute(url)
  if (!page) return { existe: false, redirige: false, par: 'rien' }

  return {
    existe: true,
    redirige: /\bredirect\(/.test(readFileSync(page, 'utf8')),
    par: path.relative(racine, page),
  }
}

describe('service worker', () => {
  /** Charge `public/sw.js` avec un `self` factice et rend ses écouteurs. */
  function charger(
    options: { reseau?: () => Promise<unknown>; enCache?: unknown } = {},
  ): {
    handlers: Record<string, (event: unknown) => void>
    journal: { ouvertes: string[]; precachees: string[]; interrogees: string[] }
  } {
    const handlers: Record<string, (event: unknown) => void> = {}
    const ouvertes: string[] = []
    const precachees: string[] = []
    const interrogees: string[] = []

    const fakeCaches = {
      open: async (nom: string) => {
        ouvertes.push(nom)
        return {
          // `cache.addAll` fait de vraies requêtes : il ne met en cache que ce
          // que le serveur rend. Une URL absente fait échouer l'installation
          // entière (`TypeError`), donc le service worker ne s'active jamais.
          // Une URL qui redirige est tout aussi inutilisable : la réponse
          // stockée porte la marque « redirigée », et une requête de
          // navigation — dont le mode de redirection est `manual` — la refuse.
          // Que l'échec tombe à l'installation ou à la navigation, l'entrée
          // préchargée ne servira jamais : on le traite ici comme un refus.
          addAll: async (urls: string[]) => {
            for (const url of urls) {
              const reponse = servi(url)
              if (!reponse.existe) throw new TypeError(`${url} n'est servi par rien`)
              if (reponse.redirige) throw new TypeError(`${url} redirige (${reponse.par})`)
              precachees.push(url)
            }
          },
        }
      },
      keys: async () => [],
      delete: async () => true,
      match: async (requete: { url: string }) => {
        interrogees.push(requete.url)
        return options.enCache
      },
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
      options.reseau ?? (async () => ({})),
      { error: () => ({}) },
    )

    return { handlers, journal: { ouvertes, precachees, interrogees } }
  }

  /** Joue l'installation et rend la promesse que le service worker attend. */
  async function installer(charge: ReturnType<typeof charger>): Promise<void> {
    const attentes: Array<Promise<unknown>> = []
    charge.handlers.install!({ waitUntil: (p: Promise<unknown>) => attentes.push(p) })
    await Promise.all(attentes)
  }

  it('écoute l installation, l activation et les requêtes', () => {
    const { handlers } = charger()
    expect(Object.keys(handlers).sort()).toEqual(['activate', 'fetch', 'install'])
  })

  it('met en cache une coquille que l application sert sans redirection', async () => {
    // `/saisie` est un `redirect()` vers `/saisie/AAAA-MM` : le précharger
    // faisait échouer l'installation, donc le service worker ne s'activait
    // jamais. Ce test refait le trajet de chaque URL de la coquille.
    const charge = charger()
    await expect(installer(charge)).resolves.toBeUndefined()

    expect(charge.journal.precachees.length).toBeGreaterThan(0)
    for (const url of charge.journal.precachees) {
      expect(servi(url), `${url} n'est pas un fichier servi tel quel`).toMatchObject({
        existe: true,
        redirige: false,
      })
    }
  })

  it('précharge le manifeste et l icône, seuls fichiers utiles au démarrage', async () => {
    const charge = charger()
    await installer(charge)

    expect(charge.journal.precachees).toContain('/manifest.webmanifest')
    expect(charge.journal.precachees).toContain('/icon.svg')
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

  it('sert la réponse du réseau et ne consulte pas le cache quand le réseau répond', async () => {
    const charge = charger({ reseau: async () => 'RÉPONSE DU RÉSEAU' })
    let rendue: Promise<unknown> | undefined
    charge.handlers.fetch!({
      request: { method: 'GET', url: 'https://exemple.test/saisie/2026-03' },
      respondWith: (p: Promise<unknown>) => {
        rendue = p
      },
    })

    await expect(rendue).resolves.toBe('RÉPONSE DU RÉSEAU')
    expect(charge.journal.interrogees).toEqual([])
  })

  it('ne se rabat sur le cache que lorsque le réseau échoue', async () => {
    const charge = charger({
      reseau: async () => {
        throw new Error('réseau injoignable')
      },
      enCache: 'RÉPONSE DU CACHE',
    })
    let rendue: Promise<unknown> | undefined
    charge.handlers.fetch!({
      request: { method: 'GET', url: 'https://exemple.test/icon.svg' },
      respondWith: (p: Promise<unknown>) => {
        rendue = p
      },
    })

    await expect(rendue).resolves.toBe('RÉPONSE DU CACHE')
    expect(charge.journal.interrogees).toEqual(['https://exemple.test/icon.svg'])
  })
})
