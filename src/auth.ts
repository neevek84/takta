import { cache } from 'react'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'
import { prisma } from '@/db/client'
import { verifyPassword } from './auth-password'
import { authConfig } from './auth.config'
import type { Role } from '@/core/types'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
        if (!user) return null

        const ok = await verifyPassword(user.passwordHash, parsed.data.password)
        if (!ok) return null

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
})

/**
 * Lecture de l'utilisateur porté par le jeton, mémoïsée **par requête**.
 *
 * `requireUser()` est appelé par chaque page, chaque layout et chaque server
 * action : sans mémoïsation, un même rendu ferait autant de requêtes qu'il y a
 * d'appels. `cache()` de React les ramène à une seule par requête (et se
 * comporte comme un simple passe-plat hors contexte de rendu, tests compris).
 * Le coût résiduel — une lecture par clé primaire, sur une connexion déjà
 * ouverte — est le prix d'une session qui dit vrai.
 */
const loadSessionUser = cache(async (id: string) =>
  prisma.user.findUnique({ where: { id }, select: { id: true, role: true } }),
)

/**
 * Un jeton valide ne prouve que sa propre signature, pas l'existence de son
 * porteur : après suppression (ou recréation) de la table `User`, la session
 * reste « valide » et l'application ne casse qu'au premier appel touchant une
 * clé étrangère. On confronte donc systématiquement l'identifiant à la base ;
 * supprimer un compte révoque du même coup ses sessions. Le rôle est lui aussi
 * relu en base, le jeton pouvant porter un rôle périmé.
 */
export async function requireUser(): Promise<{ id: string; role: Role }> {
  const session = await auth()
  const id = session?.user?.id
  if (!id) throw new Error('Non authentifié')

  const user = await loadSessionUser(id)
  if (user === null) throw new Error('Non authentifié')

  return { id: user.id, role: user.role as Role }
}
