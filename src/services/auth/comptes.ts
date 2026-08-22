/**
 * Ce qui fait exister un compte, et ce qui lui ouvre une porte.
 *
 * **La convention de l'empreinte vide.** `passwordHash = ''` signifie « pas de
 * mot de passe ». C'est l'état des comptes que la reprise des temps Dolibarr
 * crée pour porter l'attribution des saisies, et de ceux que la connexion
 * Google crée. `verifyPassword` refuse déjà cette empreinte — `verify('')`
 * lève, le `catch` rend `false` — mais rien ne le **disait**. Trois écrans
 * s'appuient maintenant dessus : il faut que ce soit une règle, pas un accident
 * heureux.
 */
import { prisma } from '@/db/client'
import { hashPassword } from '@/auth-password'

/** Ce compte peut-il entrer par la porte mot de passe ? */
export async function aUnMotDePasse(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  })
  return user !== null && user.passwordHash !== ''
}

/**
 * L'instance n'a aucun compte : c'est la seule fenêtre où l'écran de premier
 * démarrage s'ouvre.
 *
 * **Elle ne se reproduit jamais d'elle-même.** Vraie une fois, à
 * l'installation, et fausse pour toujours ensuite — la rouvrir exigerait de
 * supprimer tous les comptes, ce qu'aucun écran ne permet. C'est pourquoi cet
 * écran n'ajoute aucune surface d'attaque durable, même sur une installation
 * joignable depuis Internet.
 */
export async function aucunUtilisateur(): Promise<boolean> {
  return (await prisma.user.count()) === 0
}

/**
 * Crée le premier compte d'une instance neuve, **administrateur**.
 *
 * C'est le seul endroit du produit où un humain décide du rôle d'un compte, et
 * c'est bien un administrateur qu'il faut : lui seul pourra ensuite configurer
 * Dolibarr et Google. Le rôle est donc écrit explicitement — le contrôle de
 * `src/roles-explicites.test.ts` s'applique ici comme ailleurs.
 *
 * **Douze caractères au minimum.** Cet écran est la seule porte d'une instance
 * neuve, et il répond dès que l'installation est joignable : un mot de passe
 * court y serait la faille la plus banale qui soit.
 */
export async function creerPremierAdministrateur(args: {
  email: string
  name: string
  motDePasse: string
}): Promise<{ ok: boolean; motif: string }> {
  if (args.motDePasse.length < 12) {
    return { ok: false, motif: 'Choisissez un mot de passe d’au moins 12 caractères.' }
  }

  const empreinte = await hashPassword(args.motDePasse)

  try {
    await prisma.$transaction(async (tx) => {
      // Revérifié **dans** la transaction : deux requêtes simultanées sur une
      // base neuve ne doivent pas fabriquer deux administrateurs.
      if ((await tx.user.count()) > 0) throw new Error('DEJA_PEUPLEE')
      await tx.user.create({
        data: {
          email: args.email.trim().toLowerCase(),
          name: args.name.trim(),
          passwordHash: empreinte,
          role: 'ADMIN',
        },
      })
    })
  } catch {
    return {
      ok: false,
      motif: 'Cette instance a déjà un compte : la création du premier administrateur est close.',
    }
  }

  return { ok: true, motif: '' }
}

