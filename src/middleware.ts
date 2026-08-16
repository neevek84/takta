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

/**
 * `api/sync` rejoint `api/auth` hors du champ : le déclenchement externe porte
 * son propre jeton et n'a pas de session. Gaté, il recevrait une redirection
 * 307 vers `/login` puis du `text/html` — un cron ou n8n n'en tirerait rien,
 * et le refus ressemblerait à un succès.
 *
 * `api/webhooks` en sort pour la même raison, et pas une autre : le
 * prestataire de signature n'a pas de compte et ne porte aucun cookie. Il est
 * authentifié par la **signature HMAC de sa charge utile**, jamais par un
 * jeton d'URL ni par une session. Gaté, il recevrait un 307 vers `/login` que
 * son client HTTP compterait comme une livraison réussie — le CRA ne se
 * validerait jamais, et rien ne le dirait.
 *
 * L'exclusion est celle du **routage**, pas de l'autorisation : chaque route
 * refuse elle-même toute requête non authentifiée (voir
 * `src/app/api/sync/flush/route.ts` et
 * `src/app/api/webhooks/signature/route.ts`), et elles ne s'ouvrent pas pour
 * autant — sans `SYNC_FLUSH_TOKEN` ni `SIGNATURE_WEBHOOK_SECRET`, elles
 * restent fermées.
 *
 * Elle ne touche pas aux fichiers publics de la PWA ci-dessus, qui passent,
 * eux, par le middleware et en ressortent aussitôt.
 */
export const config = {
  matcher: ['/((?!api/auth|api/sync|api/webhooks|_next/static|_next/image|favicon.ico).*)'],
}
