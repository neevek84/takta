import { prisma } from '@/db/client'

/**
 * Une personne à qui un travail périodique s'adresse.
 *
 * Le courriel est celui du compte, et pas le destinataire de notification
 * réglé dans l'instance : celui-ci désigne **une** boîte, et une boîte ne
 * peut pas être le rappel de saisie de trois personnes.
 */
export interface Destinataire {
  id: string
  email: string
  nom: string
}

/**
 * Les comptes que les rappels doivent servir, du plus ancien au plus récent.
 *
 * **Les comptes désactivés sont écartés.** Réclamer sa saisie à quelqu'un dont
 * on vient de couper l'accès serait au mieux absurde, au pire une fuite : le
 * courriel confirmerait que le compte existe encore.
 *
 * L'ordre est celui de la création, pour que le compte rendu de la
 * supervision soit lisible deux fois de suite de la même façon.
 */
export async function destinatairesActifs(): Promise<Destinataire[]> {
  const lignes = await prisma.user.findMany({
    where: { disabled: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  })

  // Une adresse vide ne se rattrape pas ici : la porter jusqu'à `notify`
  // ferait retomber l'envoi sur le destinataire d'instance, c'est-à-dire sur
  // quelqu'un d'autre.
  return lignes
    .filter((l) => l.email.trim() !== '')
    .map((l) => ({ id: l.id, email: l.email, nom: l.name }))
}
