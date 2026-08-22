import { cache } from 'react'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { z } from 'zod'
import { prisma } from '@/db/client'
import { verifyPassword } from './auth-password'
import { MOTIF_REFUS_ADMIN, peutAdministrer } from '@/core/auth/roles'
import { readGoogleOAuthClient } from '@/services/google/oauth-client'
import { enregistrerEtPreparerAgenda } from '@/services/google/connect'
import { lierOuCreerCompteGoogle } from '@/services/auth/comptes'
import { authConfig } from './auth.config'
import type { Role } from '@/core/types'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

/**
 * La porte historique, et elle ne ferme pas : la connexion par mot de passe est
 * une propriété du produit, pas une étape vers autre chose. Elle est extraite
 * ici parce que la liste des fournisseurs se construit désormais par requête —
 * celui-ci n'a rien à lire en base pour exister, les suivants oui.
 */
function fournisseurMotDePasse() {
  return Credentials({
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
  })
}

/**
 * La configuration est construite **par requête**, et non figée au chargement.
 *
 * La raison est concrète : le client OAuth de l'instance — identifiant et
 * secret — est saisi dans Administration · Google et stocké chiffré en base. Un
 * fournisseur déclaré à l'import ne pourrait pas le lire. La bibliothèque
 * accepte une fonction là où on attendrait un objet ; c'est ce qui permet de
 * n'exposer une porte que lorsqu'elle mène quelque part.
 *
 * Le coût est d'une lecture par requête d'authentification — le même prix que
 * `requireUser()` paie déjà, pour la même raison : une configuration qui dit
 * vrai vaut mieux qu'une configuration figée au démarrage.
 */
/**
 * Le fournisseur Google, **ou rien**.
 *
 * Sans client OAuth enregistré, la liste ne le porte pas — et le bouton
 * disparaît de l'écran de connexion. Une porte qui ne mène nulle part ne
 * s'affiche pas grisée : elle ne s'affiche pas.
 */
async function fournisseurGoogle() {
  const client = await readGoogleOAuthClient()
  if (client === null) return []

  return [
    Google({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      authorization: {
        params: {
          // L'agenda dans le même consentement — arbitrage du porteur.
          //
          // **Quatre scopes ici, un seul dans le connecteur** : c'est voulu, et
          // `src/services/google/connect.test.ts` garde la règle inverse. Le
          // connecteur ne demande que le calendrier parce qu'il ne fait que ça ;
          // cette porte identifie **et** connecte, donc elle demande les deux.
          // Ce qu'aucune des deux ne fait, c'est `include_granted_scopes` :
          // mesuré le 22 août 2026 sur l'instance du porteur, il fait hériter le
          // jeton de tout ce que le projet Google a jamais obtenu — `gmail.send`
          // compris. Auth.js ne l'ajoute pas ; ne pas l'ajouter non plus.
          scope: 'openid email profile https://www.googleapis.com/auth/calendar',
          // `offline` demande un jeton de rafraîchissement ; `consent` garantit
          // qu'il revient **à chaque connexion**. Sans lui, Google ne le rend
          // qu'à la première autorisation, et un compte reconnecté après une
          // révocation resterait sans jeton, silencieusement.
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ]
}

export const { handlers, auth, signIn, signOut } = NextAuth(async () => ({
  ...authConfig,
  providers: [fournisseurMotDePasse(), ...(await fournisseurGoogle())],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile, user }) {
      if (account?.provider !== 'google') return true

      const compte = await lierOuCreerCompteGoogle({
        email: String(profile?.email ?? ''),
        emailVerifie: profile?.email_verified === true,
        nom: String(profile?.name ?? ''),
      })
      if (compte === null) return false

      // Le jeton d'agenda part vers `ProviderCredential`, là où le connecteur
      // Calendar le lit déjà. L'échec ne bloque pas l'entrée :
      // `enregistrerEtPreparerAgenda` annule alors son propre enregistrement,
      // Synchro affiche « non connecté », et son bouton répare. Entrer pour
      // saisir ses temps ne dépend pas de la santé de l'API Calendar.
      if (typeof account.access_token === 'string' && typeof account.refresh_token === 'string') {
        try {
          await enregistrerEtPreparerAgenda({
            userId: compte.id,
            jetons: {
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: new Date((account.expires_at ?? 0) * 1000),
              scope: String(account.scope ?? ''),
            },
          })
        } catch {
          // Déjà journalisé par `enregistrerEtPreparerAgenda`.
        }
      }

      // Le jeton de session doit porter **notre** identifiant, pas celui de
      // Google : tout le reste de l'application lit `User.id`.
      user.id = compte.id
      ;(user as { role?: string }).role = compte.role
      return true
    },
  },
}))

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
  prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, disabled: true },
  }),
)

/**
 * Un jeton valide ne prouve que sa propre signature, pas l'existence de son
 * porteur : après suppression (ou recréation) de la table `User`, la session
 * reste « valide » et l'application ne casse qu'au premier appel touchant une
 * clé étrangère. On confronte donc systématiquement l'identifiant à la base ;
 * supprimer un compte révoque du même coup ses sessions. Le rôle **et le
 * drapeau de désactivation** sont relus en base, le jeton pouvant porter l'un
 * comme l'autre périmés.
 */
export async function requireUser(): Promise<{ id: string; role: Role }> {
  const session = await auth()
  const id = session?.user?.id
  if (!id) throw new Error('Non authentifié')

  const user = await loadSessionUser(id)
  if (user === null) throw new Error('Non authentifié')

  // Un jeton signé survit à la désactivation : il ne prouve que sa propre
  // signature, pas que son porteur ait encore le droit d'entrer. Le drapeau est
  // donc relu à chaque requête, comme le rôle — couper un accès coupe la
  // session en cours, et pas seulement les suivantes.
  //
  // Le message est **identique** à celui d'un compte absent : distinguer les
  // deux apprendrait à un compte coupé qu'il existe encore, et à qui teste des
  // identifiants qu'une adresse est connue.
  if (user.disabled) throw new Error('Non authentifié')

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

