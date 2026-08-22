import { cache } from 'react'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'
import { prisma } from '@/db/client'
import { verifyPassword } from './auth-password'
import { MOTIF_REFUS_ADMIN, peutAdministrer } from '@/core/auth/roles'
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

/**
 * Une session valide qui n'a pas le rôle. Levée par `exigerAdministration`, et
 * par elle seule.
 *
 * Un type propre, et non un `Error` nu : les actions serveur rendent presque
 * toutes un état `{ ok: false, erreur }`, et elles doivent pouvoir distinguer
 * « vous n'avez pas le droit » — qui ne se réessaie pas — de « la base est
 * tombée » — qui se réessaie.
 */
export class AccesRefuseError extends Error {
  constructor(message: string = MOTIF_REFUS_ADMIN) {
    super(message)
    this.name = 'AccesRefuseError'
  }
}

/**
 * Le verdict, pour une **page**. Ne lève jamais.
 *
 * Les pages ne lèvent pas : en production, Next remplace le message d'une
 * exception de composant serveur par un condensé opaque, et le refus nommé se
 * perdrait en route. La page reçoit donc un verdict et rend `<AccesRefuse/>`
 * elle-même, **avant** d'appeler le moindre service : rien de ce qu'elle allait
 * lire n'est lu.
 */
export async function accesAdministration(): Promise<{
  autorise: boolean
  user: { id: string; role: Role }
}> {
  const user = await requireUser()
  return { autorise: peutAdministrer(user.role), user }
}

/**
 * La garde, pour une **action serveur**. Lève `AccesRefuseError`.
 *
 * Une action ne rend rien à peindre : le seul refus qui ait du sens est une
 * interruption. Et elle est indispensable **en plus** de celle de la page — une
 * action serveur est un point d'entrée HTTP à part entière, atteignable sans
 * jamais avoir affiché l'écran qui la déclare.
 */
export async function exigerAdministration(): Promise<{ id: string; role: Role }> {
  const user = await requireUser()
  if (!peutAdministrer(user.role)) throw new AccesRefuseError()
  return user
}

