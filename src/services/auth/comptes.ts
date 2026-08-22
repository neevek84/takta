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
import { estRole } from '@/core/auth/roles'
import type { Role } from '@/core/types'
import { identifiantDolibarrDe } from '@/services/dolibarr/utilisateur'

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


/**
 * Donner un rôle, couper un accès.
 *
 * **Pourquoi cet écran existe.** La porte Google crée des comptes au rôle le
 * moins doté, la reprise des temps Dolibarr aussi. Sans un endroit où élever
 * l'un d'eux, un `CONSULTANT` le reste pour toujours, et la première personne
 * qui rejoint l'installation ne peut jamais administrer quoi que ce soit.
 *
 * **Deux règles gardent l'instance de se murer** : on ne se retire pas son
 * propre rôle, et on ne retire pas le dernier administrateur. Sans elles, un
 * seul clic ferme définitivement l'administration — il n'existe aucun écran pour
 * la rouvrir, et l'écran de premier démarrage ne se rouvre que sur une base sans
 * aucun compte.
 *
 * **Désactiver n'est pas supprimer.** Un compte porte des saisies, des CRA et
 * l'attribution de tout ce qui a été poussé chez Dolibarr : le supprimer pour
 * fermer une porte détruirait cet historique. Le drapeau ferme la porte et ne
 * touche à rien.
 */

/** Ce que l'écran des comptes montre — et rien de plus. */
export interface CompteVue {
  id: string
  name: string
  email: string
  role: Role
  disabled: boolean
  createdAt: Date
  /** son utilisateur Dolibarr, pour voir d'un coup d'œil qui n'en a pas */
  identifiantDolibarr: number | null
}

export async function listerComptes(): Promise<CompteVue[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ disabled: 'asc' }, { createdAt: 'asc' }],
    // Jamais `passwordHash` : une vue qui le porte finit par le peindre.
    select: { id: true, name: true, email: true, role: true, disabled: true, createdAt: true },
  })

  const vues: CompteVue[] = []
  for (const u of users) {
    vues.push({
      ...u,
      // `role` est une colonne `String` : une valeur écrite à la main en SQL y
      // entre sans que rien ne la refuse. Ce qui n'est pas un rôle connu se lit
      // donc comme le moins doté — jamais comme un droit qu'on n'a pas donné.
      role: estRole(u.role) ? u.role : 'CONSULTANT',
      identifiantDolibarr: await identifiantDolibarrDe(u.id),
    })
  }
  return vues
}

/** Combien d'administrateurs **actifs** l'instance compte, en dehors d'un compte donné. */
async function autresAdministrateurs(sauf: string): Promise<number> {
  return prisma.user.count({ where: { role: 'ADMIN', disabled: false, id: { not: sauf } } })
}

export async function definirRole(args: {
  userId: string
  role: Role
  parId: string
}): Promise<{ ok: boolean; motif: string }> {
  if (!estRole(args.role)) {
    return { ok: false, motif: 'Ce rôle n’existe pas.' }
  }

  const cible = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { role: true },
  })
  if (cible === null) return { ok: false, motif: 'Ce compte n’existe plus.' }

  const perdLAdministration = cible.role === 'ADMIN' && args.role !== 'ADMIN'

  if (perdLAdministration && args.userId === args.parId) {
    return {
      ok: false,
      motif:
        'Vous ne pouvez pas vous retirer votre propre rôle d’administrateur. Demandez à un autre ' +
        'administrateur de le faire.',
    }
  }

  if (perdLAdministration && (await autresAdministrateurs(args.userId)) === 0) {
    return {
      ok: false,
      motif:
        'Ce compte est le dernier administrateur actif : le rétrograder fermerait l’administration ' +
        'de cette installation, et aucun écran ne permettrait de la rouvrir.',
    }
  }

  await prisma.user.update({ where: { id: args.userId }, data: { role: args.role } })
  return { ok: true, motif: '' }
}

export async function definirActivation(args: {
  userId: string
  actif: boolean
  parId: string
}): Promise<{ ok: boolean; motif: string }> {
  const cible = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { role: true },
  })
  if (cible === null) return { ok: false, motif: 'Ce compte n’existe plus.' }

  if (!args.actif && args.userId === args.parId) {
    return {
      ok: false,
      motif: 'Vous ne pouvez pas désactiver votre propre compte : vous seriez aussitôt déconnecté.',
    }
  }

  if (!args.actif && cible.role === 'ADMIN' && (await autresAdministrateurs(args.userId)) === 0) {
    return {
      ok: false,
      motif:
        'Ce compte est le dernier administrateur actif : le désactiver fermerait l’administration ' +
        'de cette installation.',
    }
  }

  await prisma.user.update({ where: { id: args.userId }, data: { disabled: !args.actif } })
  return { ok: true, motif: '' }
}

/**
 * La règle de fusion : un compte Google et un compte local qui portent la même
 * adresse sont **le même compte**.
 *
 * Auth.js sait parler à Google ; il ne sait pas, seul, fusionner deux comptes.
 * L'application n'ayant pas d'adaptateur de base, il n'existe pas de table
 * `Account` dont le comportement par défaut refuserait une adresse déjà prise :
 * la règle est ici, en clair, et elle s'éprouve.
 *
 * **L'adresse vérifiée n'est pas une formalité.** Toute la fusion repose sur
 * elle : accepter une adresse non vérifiée reviendrait à laisser quiconque
 * prendre le compte d'un autre en la déclarant.
 *
 * `null` est le seul refus : l'appelant en fait un « non » d'Auth.js, sans
 * distinguer les motifs. Dire lequel apprendrait à qui essaie si l'adresse est
 * connue, et si le compte qui la porte a été coupé.
 */
export async function lierOuCreerCompteGoogle(args: {
  email: string
  emailVerifie: boolean
  nom: string
}): Promise<{ id: string; role: string } | null> {
  if (!args.emailVerifie) return null

  // Google rend l'adresse telle que l'utilisateur l'a écrite ; la nôtre est
  // unique. Sans normalisation, une majuscule créerait un second compte.
  const email = args.email.trim().toLowerCase()
  if (email === '') return null

  const existant = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, disabled: true },
  })
  if (existant !== null) {
    // Un compte coupé reste coupé, quelle que soit la porte. Sans ce refus,
    // `definirActivation` ne fermerait qu'une moitié de l'application :
    // `requireUser()` couperait la session en cours, et Google en ouvrirait
    // aussitôt une neuve.
    if (existant.disabled) return null
    return { id: existant.id, role: existant.role }
  }

  const cree = await prisma.user.create({
    data: {
      email,
      name: args.nom.trim() === '' ? email : args.nom.trim(),
      // Pas de mot de passe : la porte locale reste fermée jusqu'à ce qu'il en
      // définisse un par courriel.
      passwordHash: '',
      // Jamais le défaut de la colonne, qui vaut `ADMIN`.
      role: 'CONSULTANT',
    },
    select: { id: true, role: true },
  })
  return cree
}
