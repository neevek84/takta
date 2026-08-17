/**
 * Le rattrapage des CRA déjà validés.
 *
 * **Le défaut qu'il ferme.** La mise en file est décidée à l'instant de la
 * validation (`services/cra.ts`), et cet instant est le seul : un CRA validé
 * **avant** que Dolibarr soit connecté — ou avant que sa mission soit
 * rattachée à un projet — n'entrait jamais dans la file, et aucun chemin ne
 * l'y ramenait. C'est pourtant l'ordre naturel d'adoption du produit : on
 * saisit, on valide ses mois, puis on découvre l'écran Administration ·
 * Dolibarr. Tout l'historique validé restait dehors, sans un mot : la file
 * vide, l'écran de synchronisation annonçant « 0 en attente », et le projet
 * Dolibarr sans un temps consommé jusqu'à la facture manquante.
 *
 * **Pourquoi ici et pas dans `cra.ts`.** Mettre en file inconditionnellement à
 * la validation remplirait la file de lignes vouées à l'échec sur une
 * installation sans Dolibarr — c'est-à-dire l'immense majorité — et la suite de
 * tests fige délibérément ce refus. Le rattrapage prend le problème par
 * l'autre bout : il ne s'exécute qu'aux deux instants où l'armement change,
 * la connexion de l'instance et le rattachement d'une mission.
 *
 * **Il ne pousse rien lui-même.** Il inscrit dans la file, un point : une
 * instance Dolibarr éteinte ne doit jamais faire échouer un rattachement, et
 * c'est le drainage qui rejouera.
 */
import { prisma } from '@/db/client'
import { isLocked } from '@/core/cra/state-machine'
import { ENTITY_CRA } from '@/core/sync/policy'
import type { CraStatus } from '@/core/types'
import { getInstanceCredential } from '@/services/credentials'
import { enqueueSync } from '@/services/sync/outbox'
import { DOLIBARR } from './api'
import { LIEN_MISSION, LIEN_TEMPS, SEPARATEUR } from './liens'

/**
 * Inscrit dans la file les CRA validés qui n'y sont jamais entrés, et rend
 * leur nombre.
 *
 * `missionId` borne le rattrapage à une mission — ce que veut le rattachement
 * d'un projet. Sans lui, ce sont toutes les missions rattachées de l'instance :
 * ce que veut la connexion de l'instance, qui arme d'un coup tout ce qui était
 * déjà rattaché.
 *
 * **Pas de `userId`, et c'est délibéré.** Une clé d'API Dolibarr et une
 * correspondance `mission → projet` sont de portée instance ; le CRA, lui, ne
 * l'est jamais, et chaque ligne de file part sous le compte de son propriétaire
 * — c'est ce `userId`-là que le drainage relira pour ne pousser que ses
 * saisies. Scoper le balayage sur l'appelant laisserait les mois validés des
 * autres consultants hors de Dolibarr pour toujours, sans que rien ne le dise :
 * le défaut qu'on ferme, à peine déplacé.
 *
 * **Idempotent.** Un CRA déjà en file, ou déjà poussé et toujours mappé, n'est
 * pas recompté : rejouer le rattrapage n'annonce pas deux fois le même travail.
 * Un CRA dont les correspondances de temps ont été rompues — repointage de la
 * mission — est en revanche bien repris : c'est précisément ce qu'il faut
 * repousser vers son nouveau projet.
 */
export async function rattraperCraValides(missionId?: string): Promise<number> {
  // Dolibarr non connecté : rien à rattraper, et surtout rien à mettre en file.
  // Le rattrapage se rejouera à la connexion.
  if ((await getInstanceCredential(DOLIBARR)) === null) return 0

  const liens = await prisma.externalLink.findMany({
    where: {
      entityType: LIEN_MISSION,
      provider: DOLIBARR,
      ...(missionId === undefined ? {} : { entityId: missionId }),
    },
    select: { entityId: true },
  })
  if (liens.length === 0) return 0

  const cras = await prisma.cra.findMany({
    where: { missionId: { in: liens.map((l) => l.entityId) } },
    select: { id: true, userId: true, status: true },
  })
  // Le verrou vient du noyau, jamais d'une comparaison recopiée : pousser un
  // brouillon enverrait du temps qui n'est pas arrêté.
  const valides = cras.filter((c) => isLocked(c.status as CraStatus))
  if (valides.length === 0) return 0

  const ids = valides.map((c) => c.id)

  const enFile = await prisma.syncOutbox.findMany({
    where: { provider: DOLIBARR, entityType: ENTITY_CRA, entityId: { in: ids } },
    select: { entityId: true },
  })
  const deja = new Set(enFile.map((l) => l.entityId))

  // Déjà poussé **et toujours mappé** : le compter ferait annoncer un
  // rattrapage qui n'en est pas un. Les cellules se lisent par leur préfixe,
  // `craId|`, comme partout ailleurs.
  const pousses = await prisma.externalLink.findMany({
    where: { provider: DOLIBARR, entityType: LIEN_TEMPS },
    select: { entityId: true },
  })
  for (const lien of pousses) {
    const craId = lien.entityId.split(SEPARATEUR)[0]
    if (craId !== undefined) deja.add(craId)
  }

  let misEnFile = 0
  for (const cra of valides) {
    if (deja.has(cra.id)) continue
    await prisma.$transaction(async (tx) => {
      await enqueueSync(tx, {
        userId: cra.userId,
        entityType: ENTITY_CRA,
        entityId: cra.id,
        provider: DOLIBARR,
      })
    })
    misEnFile += 1
  }
  return misEnFile
}
