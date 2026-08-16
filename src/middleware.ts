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
 * Aucune donnée utilisateur ici : ce sont trois fichiers statiques de
 * `public/`, identiques pour tout le monde.
 */
const FICHIERS_PUBLICS = new Set([
  '/manifest.webmanifest',
  '/sw.js',
  '/icon.svg',
  '/apple-touch-icon.png',
])

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (FICHIERS_PUBLICS.has(request.nextUrl.pathname)) return NextResponse.next()

  return protege(request, event)
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
