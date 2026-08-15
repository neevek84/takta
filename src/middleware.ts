import NextAuth from 'next-auth'
import { authConfig } from './auth.config'

// Edge runtime: built from auth.config.ts only, which is free of Prisma and
// @node-rs/argon2. Do not import from '@/auth' here.
export default NextAuth(authConfig).auth

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
