/**
 * Les huit natures de correspondance que ce connecteur pose, et le seul
 * endroit qui les nomme.
 *
 * Elles vivaient dispersées — deux dans `push.ts`, une dans `propal.ts`, deux
 * en clair dans `import.ts` — et c'est ce qui a permis à la rupture de n'en
 * connaître que deux : rien ne rappelait les trois autres. La liste est
 * désormais close et unique, et `LIENS_DOLIBARR` la rend énumérable pour que
 * tout ce qui prétend les traiter toutes puisse le prouver.
 */
import { prisma } from '@/db/client'
import { DOLIBARR } from './api'

/** Un client local ↔ un tiers Dolibarr. `externalId` = identifiant du tiers. */
export const LIEN_CLIENT = 'Client'

/** Une mission ↔ un projet Dolibarr. `externalId` = identifiant du projet. */
export const LIEN_MISSION = 'Mission'

/** Une prestation ↔ une tâche du projet. `externalId` = identifiant de la tâche. */
export const LIEN_LIGNE = 'MissionLine'

/**
 * Une prestation ↔ une ligne de propale. `externalId` y porte **deux**
 * identifiants, `propaleId:ligneId` : la ligne seule ne suffit pas à retrouver
 * la propale dans l'API Dolibarr, qui n'expose les lignes que sous leur propale.
 */
export const LIEN_PROPALE = 'MissionLinePropalLine'

/**
 * Une prestation ↔ une ligne de commande. `externalId` y porte **deux**
 * identifiants, `commandeId:ligneId`, pour la même raison que la propale :
 * l'API Dolibarr n'expose les lignes que sous leur document.
 */
export const LIEN_COMMANDE = 'MissionLineOrderLine'

/**
 * Une correspondance par **cellule de grille**, pas par saisie : la clé est
 * `craId|lineId|date|slotId`. Une saisie supprimée puis ressaisie retombe donc
 * sur le même temps passé chez Dolibarr au lieu d'en créer un second, et le
 * préfixe `craId|` permet de retrouver d'un coup tout ce qui a été poussé pour
 * ce CRA — y compris ce qui n'a plus de saisie locale.
 *
 * C'est cette table qui porte **toute** l'idempotence du push : `addTimeSpent`
 * n'en a aucune côté Dolibarr, et deux appels produisent deux lignes de temps
 * consommé chez le client.
 */
export const LIEN_TEMPS = 'CraTimeSpent'

/** Sépare les quatre parts de la clé de cellule. Aucun `cuid` n'en contient. */
export const SEPARATEUR = '|'

/**
 * Un utilisateur local ↔ un utilisateur Dolibarr. `externalId` = son identifiant.
 *
 * Posée par la reprise des temps : un temps consommé chez Dolibarr porte son
 * auteur, et l'attribuer au porteur qui importe réécrirait l'histoire. L'auteur
 * devient donc un utilisateur de l'application — **sans mot de passe**, donc
 * incapable de se connecter : c'est une identité, pas un compte.
 */
export const LIEN_UTILISATEUR = 'User'

/**
 * Une saisie locale ↔ le temps consommé Dolibarr **dont elle est issue**.
 * `externalId` = `timespent_line_id`.
 *
 * À ne pas confondre avec `CraTimeSpent`, qui va dans l'autre sens : celui-là
 * dit « cette cellule a été poussée là-bas », celui-ci dit « cette saisie vient
 * de là-bas ». C'est lui qui rend la reprise rejouable sans importer deux fois
 * le même temps.
 */
export const LIEN_TEMPS_REPRIS = 'TimeEntryReprise'

export const LIENS_DOLIBARR = [
  LIEN_CLIENT,
  LIEN_MISSION,
  LIEN_LIGNE,
  LIEN_PROPALE,
  LIEN_COMMANDE,
  LIEN_TEMPS,
  LIEN_UTILISATEUR,
  LIEN_TEMPS_REPRIS,
] as const

export type LienDolibarr = (typeof LIENS_DOLIBARR)[number]

export interface RuptureDerivee {
  /** correspondances `prestation → tâche` rompues */
  lignes: number
  /** correspondances `cellule → temps consommé` rompues */
  temps: number
}

/**
 * Rompt tout ce que la correspondance `mission → projet` a engendré.
 *
 * **Pourquoi c'est indispensable.** Une prestation est mappée sur une tâche
 * *du projet rattaché*, et une cellule sur un temps consommé *de cette tâche*.
 * Les deux sont mémorisées par identifiant nu : elles ne disent pas de quel
 * projet elles viennent. Repointer la mission ailleurs sans les rompre laisse
 * donc le push retrouver ses tâches d'hier et y déverser tous les temps
 * suivants — dans l'ancien projet, et chez l'ancien tiers si le client a lui
 * aussi été repointé. Le nouveau projet, lui, reste vide et facture zéro.
 *
 * **Ce que la rupture ne fait pas.** Rien n'est supprimé chez Dolibarr : ce qui
 * y a été poussé y reste, parce que c'est l'historique déjà facturé de l'ancien
 * projet et que l'application n'est pas maîtresse de ce qu'elle a livré. Une
 * rupture est un oubli, pas une destruction — c'est déjà la promesse que porte
 * `detachEntity`.
 *
 * **Ce qu'elle laisse volontairement intact.** Les liens `MissionLinePropalLine` et
 * `MissionLineOrderLine` survivent : une propale et une commande appartiennent
 * à un tiers, pas à un projet, et repointer le projet ne rend pas faux
 * l'engagement repris.
 */
export async function rompreLiensDerives(missionId: string): Promise<RuptureDerivee> {
  const lignes = await prisma.missionLine.findMany({
    where: { missionId },
    select: { id: true },
  })
  const cras = await prisma.cra.findMany({ where: { missionId }, select: { id: true } })

  const rompues = await prisma.externalLink.deleteMany({
    where: {
      provider: DOLIBARR,
      entityType: LIEN_LIGNE,
      entityId: { in: lignes.map((l) => l.id) },
    },
  })

  // Les cellules ne se lisent que par leur préfixe : `entityId` y porte quatre
  // parts, dont le `craId` en tête. Un `in` est impossible, un `startsWith` par
  // CRA est exact.
  let temps = 0
  for (const cra of cras) {
    const r = await prisma.externalLink.deleteMany({
      where: {
        provider: DOLIBARR,
        entityType: LIEN_TEMPS,
        entityId: { startsWith: `${cra.id}${SEPARATEUR}` },
      },
    })
    temps += r.count
  }

  return { lignes: rompues.count, temps }
}
