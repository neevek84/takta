/**
 * Définir ou réinitialiser un mot de passe par courriel.
 *
 * **Ce parcours ne sert pas que l'oubli.** C'est par lui qu'un compte né *sans*
 * mot de passe s'en donne un : ceux que la connexion Google crée, ceux que la
 * reprise des temps Dolibarr a créés. Sans lui, la seconde porte leur resterait
 * fermée à jamais.
 *
 * **Rien ne dit si le compte existe.** `demanderReinitialisation` se tait dans
 * tous les cas — même signature, même absence de retour. Distinguer les deux
 * ferait du formulaire d'oubli un annuaire du personnel.
 */
import { prisma } from '@/db/client'
import { hashPassword } from '@/auth-password'
import {
  DUREE_LIEN_MINUTES,
  empreinteJeton,
  expirationDepuis,
  fabriquerJeton,
  lienExpire,
} from '@/core/auth/reinitialisation'
import { gabaritReinitialisation } from '@/core/notify/templates'
import { notify } from '@/services/notify'

export async function demanderReinitialisation(args: {
  email: string
  /** origine de l'application, sans barre finale : `https://cra.exemple.fr` */
  origine: string
  maintenant?: Date
}): Promise<void> {
  const maintenant = args.maintenant ?? new Date()
  const user = await prisma.user.findUnique({
    where: { email: args.email.trim().toLowerCase() },
    select: { id: true, email: true },
  })
  // Aucun retour, aucune levée : l'appelant ne peut pas distinguer ce cas.
  if (user === null) return

  const jeton = fabriquerJeton()
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: empreinteJeton(jeton),
      expiresAt: expirationDepuis(maintenant),
    },
  })

  await notify(
    gabaritReinitialisation({
      lien: `${args.origine}/mot-de-passe?jeton=${jeton}`,
      minutes: DUREE_LIEN_MINUTES,
    }),
    // Au compte visé, jamais au destinataire des notifications d'instance :
    // celui-ci recevrait les liens de tout le monde.
    { destinataire: user.email },
  )
}

export async function definirMotDePasse(args: {
  jeton: string
  motDePasse: string
  maintenant?: Date
}): Promise<{ ok: boolean; motif: string }> {
  const maintenant = args.maintenant ?? new Date()
  const refus = {
    ok: false,
    motif: 'Ce lien n’est plus valable. Demandez-en un nouveau depuis l’écran de connexion.',
  }

  const ligne = await prisma.passwordReset.findUnique({
    where: { tokenHash: empreinteJeton(args.jeton) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  })
  if (ligne === null) return refus
  if (ligne.usedAt !== null) return refus
  if (lienExpire(ligne.expiresAt, maintenant)) return refus

  const empreinte = await hashPassword(args.motDePasse)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ligne.userId }, data: { passwordHash: empreinte } })
    await tx.passwordReset.update({ where: { id: ligne.id }, data: { usedAt: maintenant } })
    // Les autres liens en attente tombent avec celui-ci : en laisser un ouvert
    // laisserait une seconde clé en circulation après le changement.
    await tx.passwordReset.updateMany({
      where: { userId: ligne.userId, usedAt: null },
      data: { usedAt: maintenant },
    })
  })

  return { ok: true, motif: '' }
}
