import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest, type NextFetchEvent } from 'next/server'

// Auth.js lit le secret au moment où `NextAuth()` est appelé, c'est-à-dire à
// l'import du middleware. Sans secret il journalise une erreur rouge à chaque
// requête : le verdict resterait le bon (pas de session, donc redirection),
// mais le bruit masquerait un vrai échec. `vi.hoisted` place l'affectation
// avant les imports, seul endroit où elle sert encore à quelque chose.
vi.hoisted(() => {
  process.env.AUTH_SECRET ??= 'secret-de-test-du-middleware'
})

import middleware, { config } from './middleware'

// Le middleware réel est exercé ici : la requête traverse `src/middleware.ts`,
// NextAuth et `authorized()` de `auth.config.ts` comme en production. Aucune
// règle n'est recopiée — c'est la réponse rendue qui est observée.
type Middleware = (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<Response | undefined> | Response | undefined

const evenement = { waitUntil: () => {} } as unknown as NextFetchEvent

/** Réponse du middleware à une requête sans cookie de session. */
async function sansSession(chemin: string): Promise<Response | undefined> {
  const requete = new NextRequest(new URL(chemin, 'https://cra.test'))
  return await (middleware as unknown as Middleware)(requete, evenement)
}

/** Vrai si la réponse redirige (307 vers `/login`, typiquement). */
function redirige(reponse: Response | undefined): boolean {
  return reponse !== undefined && reponse.headers.get('location') !== null
}

const racine = process.cwd()

describe('middleware — fichiers publics de la PWA', () => {
  // Ces trois-là sont demandés par un navigateur qui n'a pas encore de
  // session : le manifeste part sans cookie (un `<link rel="manifest">` sans
  // `crossorigin` n'en envoie pas), le script du service worker est chargé
  // depuis `/login`, et l'icône est lue par le navigateur lui-même. Les
  // gater derrière l'authentification rend l'application non installable.
  for (const chemin of ['/manifest.webmanifest', '/sw.js', '/icon.svg', '/apple-touch-icon.png']) {
    it(`sert ${chemin} sans redirection vers /login`, async () => {
      const reponse = await sansSession(chemin)

      expect(reponse?.headers.get('location')).toBeNull()
      expect(reponse?.status ?? 200).toBe(200)
    })
  }

  it('sert le script que RegisterServiceWorker enregistre réellement', async () => {
    const source = readFileSync(
      path.join(racine, 'src/components/pwa/RegisterServiceWorker.tsx'),
      'utf8',
    )
    const trouve = /serviceWorker\.register\(\s*'([^']+)'/.exec(source)
    expect(trouve, "aucun appel à serviceWorker.register trouvé").not.toBeNull()

    expect(redirige(await sansSession(trouve![1]!))).toBe(false)
  })

  it('sert toutes les icônes que le manifeste déclare', async () => {
    const manifeste = JSON.parse(
      readFileSync(path.join(racine, 'public/manifest.webmanifest'), 'utf8'),
    ) as { icons: Array<{ src: string }> }
    const sources = [...new Set(manifeste.icons.map((i) => i.src))]
    expect(sources.length).toBeGreaterThan(0)

    for (const src of sources) {
      expect(redirige(await sansSession(src)), `${src} redirige`).toBe(false)
    }
  })
})

describe('middleware — routes protégées', () => {
  it('redirige une page applicative sans session vers /login', async () => {
    const reponse = await sansSession('/saisie/2026-03')

    expect(reponse?.status).toBe(307)
    expect(reponse?.headers.get('location')).toContain('/login')
  })

  it('redirige la racine sans session vers /login', async () => {
    expect(redirige(await sansSession('/'))).toBe(true)
  })

  it('laisse passer /login sans session', async () => {
    expect(redirige(await sansSession('/login'))).toBe(false)
  })
})

describe('middleware — le déclenchement externe n est pas gaté par la session', () => {
  // Le matcher est appliqué par Next avant d'entrer dans le fichier : aucun
  // appel au middleware ne peut le prouver. On l'évalue donc tel qu'il est
  // écrit — c'est une expression régulière — sur les chemins qui comptent.
  const matcher = new RegExp(`^${config.matcher[0] as string}$`)

  it('laisse POST /api/sync/flush hors du champ du middleware', () => {
    // n8n, un cron système ou curl portent un jeton, jamais un cookie de
    // session : gaté, l'endpoint leur répondrait une page de connexion en
    // HTML avec un 307, que rien côté appelant ne sait interpréter.
    expect(matcher.test('/api/sync/flush')).toBe(false)
  })

  it('laisse POST /api/webhooks/signature hors du champ du middleware', () => {
    // Le prestataire de signature n'a pas de compte et ne porte aucun cookie :
    // il est authentifié par la signature HMAC de sa charge utile. Gaté, il
    // recevrait un 307 vers /login — que Documenso compterait comme une
    // livraison réussie, et le CRA ne se validerait jamais.
    expect(matcher.test('/api/webhooks/signature')).toBe(false)
  })

  it('laisse GET /api/events hors du champ du middleware', () => {
    // Un intégrateur porte le jeton d'instance, jamais un cookie de session :
    // gaté, il recevrait une page de connexion en HTML à la place de ses
    // événements, et son client la compterait comme une réponse valide.
    expect(matcher.test('/api/events')).toBe(false)
  })

  it('laisse POST /api/jobs/tick hors du champ du middleware', () => {
    // Le réveil de l'ordonnanceur vient d'un cron, d'un timer systemd ou de
    // n8n : aucun d'eux n'a de session, tous portent le même jeton.
    expect(matcher.test('/api/jobs/tick')).toBe(false)
  })

  it('garde les pages applicatives dans le champ du middleware', () => {
    // Le garde-fou de l'exclusion ci-dessus : une exclusion trop large
    // ouvrirait l'application entière sans qu'aucune assertion ne bouge.
    expect(matcher.test('/saisie/2026-03')).toBe(true)
    expect(matcher.test('/admin/sync')).toBe(true)
    expect(matcher.test('/')).toBe(true)
    // « webhooks » n'ouvre pas tout ce qui y ressemble ailleurs.
    expect(matcher.test('/missions/webhooks')).toBe(true)
  })

  it('redirige la page de supervision sans session vers /login', async () => {
    const reponse = await sansSession('/admin/sync')

    expect(reponse?.status).toBe(307)
    expect(reponse?.headers.get('location')).toContain('/login')
  })
})
