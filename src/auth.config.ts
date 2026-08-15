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
      const isLogin = request.nextUrl.pathname.startsWith('/login')
      if (isLogin) return true
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
