import type { NextAuthConfig } from 'next-auth'
import type { Role } from '@/core/types'

// Edge-safe Auth.js configuration: no Prisma, no @node-rs/argon2, nothing
// native. This is imported by both `src/middleware.ts` (edge runtime) and
// `src/auth.ts` (Node runtime), which adds the Credentials provider on top.
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    authorized({ auth: session, request }) {
      // Les deux seuls chemins ouverts sans session, et le second n'est pas
      // une commodité : le parcours du mot de passe s'adresse par
      // construction à qui ne peut PAS se connecter — celui qui a oublié le
      // sien, et celui qui n'en a jamais eu (reprise Dolibarr, Google).
      // Exiger une session y renverrait le porteur d'un lien valide vers la
      // porte qu'il ne sait justement pas ouvrir. Le jeton est le
      // laissez-passer : dix minutes, empreinte seule en base, consommé une
      // fois.
      const chemin = request.nextUrl.pathname
      if (chemin.startsWith('/login') || chemin.startsWith('/mot-de-passe')) return true
      return Boolean(session?.user)
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role: Role }).role
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as Role
      return session
    },
  },
} satisfies NextAuthConfig
