import type { Role } from '@/core/types'
import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: { id: string; email: string; name: string; role: Role }
  }
}
