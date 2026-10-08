import NextAuth from 'next-auth'
import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from 'next/server'
import { authConfig } from './auth.config'

// Edge runtime: built from auth.config.ts only, which is free of Prisma and
// @node-rs/argon2. Do not import from '@/auth' here.
//
// `auth` est un middleware Next.js quand on l'appelle avec (requête,
// événement) — c'est la forme `export default auth` documentée par Auth.js —
// mais ses surcharges publiques ne décrivent pas cet appel direct.
const protege = NextAuth(authConfig).auth as unknown as NextMiddleware

/**
 * Fichiers que le navigateur demande *avant* toute session, et qu'il demande
 * lui-même — pas la page.
 *
 *   - `/manifest.webmanifest` : un `<link rel="manifest">` sans
 *     `crossorigin="use-credentials"` part sans cookie. Derrière
 *     l'authentification, il reçoit une redirection puis du `text/html` : le
 *     manifeste n'est jamais analysé et l'invite « Installer l'application »
 *     n'apparaît jamais.
 *   - `/sw.js` : le service worker est enregistré depuis le layout racine,
 *     donc aussi depuis `/login`, où il n'y a par définition pas de session.
 *     Une inscription refuse une réponse redirigée, par spécification.
 *   - les icônes : lues par le navigateur et par le système, sans cookie.
 *
 * Aucune donnée utilisateur ici : ce sont des fichiers statiques de
 * `public/`, identiques pour tout le monde.
 */
const FICHIERS_PUBLICS = new Set([
  '/manifest.webmanifest',
  '/sw.js',
  '/icon.svg',
  '/apple-touch-icon.png',
  // Le logotype est affiché par l'écran de connexion, donc **avant** toute
  // session. Sans lui ici, la page de login demanderait une image que le
  // middleware renverrait vers la page de login.
  '/takta.svg',
])

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (FICHIERS_PUBLICS.has(request.nextUrl.pathname)) return NextResponse.next()

  // **La seule page de l'outil sans session** (lot 3b) : le client n'a pas de
  // compte. Sa garde est le jeton du lien, puis un code à usage unique — voir
  // `src/services/signature/lien-client.ts`. `/v/` et pas `/v` : `/vue` ou
  // `/v` seuls restent derrière l'authentification.
  if (request.nextUrl.pathname.startsWith('/v/')) return reponseClient()

  return protege(request, event)
}

/**
 * Les en-têtes de la page client.
 *
 *   - `frame-ancestors 'none'` : personne n'encadre la page du client.
 *   - `no-referrer` : le jeton est dans l'URL, il ne doit fuir vers personne.
 *   - `noindex` : un lien privé n'a rien à faire dans un moteur.
 *
 * **Pas de `frame-src` ici.** L'instance Documenso se règle à l'écran et vit
 * en base ; l'Edge n'a pas Prisma et ne peut pas la lire. C'est la page
 * elle-même (`src/app/v/[jeton]/page.tsx`) qui pose `frame-src` par une
 * balise meta, depuis l'instance en vigueur. En poser un second ici le
 * restreindrait — deux politiques s'intersectent — et un `DOCUMENSO_URL`
 * resté dans l'environnement bloquerait le cadre de l'instance de l'écran.
 */
function reponseClient(): NextResponse {
  const reponse = NextResponse.next()
  reponse.headers.set('Content-Security-Policy', "frame-ancestors 'none'")
  reponse.headers.set('Referrer-Policy', 'no-referrer')
  reponse.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return reponse
}

/**
 * `/api/` est exclu **en entier**, et non route par route.
 *
 * Aucun appelant de ces routes ne porte de cookie de session : un cron, n8n ou
 * `curl` portent un jeton d'instance (`api/sync`, `api/events`,
 * `api/jobs/tick`), le prestataire de signature porte la **signature HMAC de
 * sa charge utile** (`api/webhooks`), et Auth.js gère lui-même `api/auth`.
 * Gatées, ces routes répondraient une redirection 307 vers `/login` puis du
 * `text/html` : un client HTTP n'en tire rien, et le refus ressemble à un
 * succès — Documenso compterait la livraison comme réussie et le CRA ne se
 * validerait jamais.
 *
 * L'exclusion est celle du **routage**, pas de l'autorisation : chaque route
 * refuse elle-même toute requête non authentifiée (voir
 * `src/services/api-token.ts`, `src/app/api/sync/flush/route.ts` et
 * `src/app/api/webhooks/signature/route.ts`), et elles ne s'ouvrent pas pour
 * autant — sans `CRA_API_TOKEN`, `SYNC_FLUSH_TOKEN` ni secret de webhook
 * (Administration · Signature, ou `SIGNATURE_WEBHOOK_SECRET`), elles restent
 * fermées. Une nouvelle route d'API
 * hérite donc de l'exclusion, jamais de l'ouverture : elle doit porter sa
 * garde, comme ses voisines.
 *
 * Elle ne touche pas aux fichiers publics de la PWA ci-dessus, qui passent,
 * eux, par le middleware et en ressortent aussitôt.
 */
export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
}
