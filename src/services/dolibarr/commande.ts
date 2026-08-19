/**
 * La commande client, source du projet Dolibarr.
 *
 * **Le flux réel du porteur** : propale → signature → **commande** → projet →
 * tâches → saisie des temps. La commande est le document ferme, et le seul qui
 * porte `ref_client`, la référence du bon de commande du client — celle qu'il
 * exige de retrouver sur sa facture.
 *
 * Jusqu'ici l'application ne savait que rattacher un projet **déjà créé** à la
 * main dans Dolibarr, et rien ne reliait la commande au projet. Ce module
 * ferme les deux manques.
 *
 * **Ce qui ne s'annule pas.** Un projet créé chez Dolibarr ne se supprime pas
 * d'ici : le port ne porte aucune suppression, et n'en portera pas. D'où
 * l'ordre imposé plus bas — lire, refuser, puis seulement écrire — et d'où le
 * compte rendu, qui dit ce qui a été fait même quand la fin a échoué.
 */
import { prisma } from '@/db/client'
import { verifierCoherenceTiers } from '@/core/dolibarr/coherence'
import {
  referenceExterneCommande,
  titreProjetDepuisCommande,
} from '@/core/dolibarr/commande'
import { reprendreLigneVendue } from '@/core/dolibarr/ligne-vendue'
import {
  DOLIBARR,
  DolibarrRequestError,
  type DolibarrApi,
  type DolibarrOrder,
  type DolibarrProject,
} from './api'
import {
  attachMission,
  createClientFromDolibarr,
  createMissionFromDolibarr,
  tiersAttendu,
  type AttachMissionResult,
} from './import'
import { LIEN_CLIENT, LIEN_COMMANDE } from './liens'

/** Une commande proposée à l'écran, avec ce qu'il faut pour la choisir. */
export interface CommandeCandidate {
  id: number
  ref: string
  refClient: string
  label: string
  socid: number
  /** projet déjà rattaché à la commande, `null` sinon */
  projectId: number | null
  lines: Array<{ id: number; label: string; qty: number; subpriceCents: number }>
}

/** Ce que la création a réellement fait — y compris ce qu'elle n'a pas fait. */
export interface CreationProjetResult {
  projet: DolibarrProject
  /**
   * La commande portait **déjà** un projet : aucun second n'a été créé.
   *
   * C'est la garde qui évite le doublon le plus coûteux du lot — deux projets
   * pour un même bon de commande, dont un seul reçoit les temps.
   */
  projetExistant: boolean
  /** La commande ne portait aucune référence client : il n'y avait rien à reporter. */
  sansReferenceClient: boolean
  /**
   * Le rattachement de la commande au projet a échoué — et **le projet existe
   * quand même**. Le dire est la moitié qui compte : un échec présenté comme
   * total ferait recommencer, donc créer un second projet.
   */
  commandeNonRattachee: string | null
  /** Ce que le rattachement de la mission a fait : repointage, rattrapage. */
  rattachement: AttachMissionResult
  missionId: string
}

/** Où la création doit poser le projet, côté local. */
export type CibleCommande =
  | { type: 'MISSION'; missionId: string }
  | { type: 'NOUVELLE_MISSION'; clientId: string }
  /**
   * Le client local est **déduit du tiers de la commande**, et créé s'il
   * n'existe pas encore.
   *
   * C'est ce que l'écran des missions demande : on choisit un tiers Dolibarr,
   * pas un client local. Exiger le rattachement préalable dans les réglages
   * obligeait à quitter la création de mission pour y revenir — et le tiers
   * n'apparaissait nulle part dans la page où l'on crée.
   */
  | { type: 'DEPUIS_LE_TIERS' }

/**
 * Les commandes que Dolibarr propose, brouillons et annulées exclus par le
 * port lui-même.
 *
 * Une panne remonte telle quelle : une liste vide se confondrait avec
 * « aucune commande », et l'écran inviterait à en créer une qui existe déjà.
 */
export async function listerCommandes(api: DolibarrApi): Promise<CommandeCandidate[]> {
  const commandes = await api.listOrders()
  return commandes.map((c) => ({
    id: c.id,
    ref: c.ref,
    refClient: c.refClient,
    label: c.label,
    socid: c.socid,
    projectId: c.projectId,
    lines: c.lines,
  }))
}

/**
 * Les commandes sur lesquelles une mission peut naître, **rangées sous le
 * client local** auquel leur tiers est rattaché.
 *
 * C'est la forme dont l'écran des missions a besoin : on choisit un client,
 * puis on voit ce qu'il reste à faire chez lui. Une commande dont le tiers
 * n'est rattaché à aucun client local rend `clientId: null` — elle existe, mais
 * aucune mission ne peut encore naître dessus, et le dire vaut mieux que la
 * cacher.
 *
 * Les commandes qui portent déjà un projet sont écartées : la mission se
 * rattache alors au projet existant, ce qui est un autre geste.
 */
export async function listerCommandesRattachables(args: {
  api: DolibarrApi
}): Promise<Array<CommandeCandidate & { clientId: string | null; thirdpartyName: string }>> {
  const [commandes, tiers] = await Promise.all([
    listerCommandes(args.api).then((liste) => liste.filter((c) => c.projectId === null)),
    // Le nom du tiers ne vient pas de la commande — elle ne porte que `socid`.
    // Sans lui, l'écran ne proposerait que des numéros.
    args.api.listThirdparties(),
  ])
  const nomParTiers = new Map(tiers.map((t) => [t.id, t.name]))

  // Sans filtre sur `userId`, comme partout ailleurs : une correspondance
  // appartient à l'instance, pas à celui qui l'a posée.
  const liens = await prisma.externalLink.findMany({
    where: { entityType: LIEN_CLIENT, provider: DOLIBARR },
    select: { entityId: true, externalId: true },
  })
  const clientParTiers = new Map(liens.map((l) => [l.externalId, l.entityId]))

  return commandes.map((c) => ({
    ...c,
    clientId: clientParTiers.get(String(c.socid)) ?? null,
    thirdpartyName: nomParTiers.get(c.socid) ?? `Tiers n° ${c.socid}`,
  }))
}

/**
 * Le client local visé, et son nom — les deux que le refus de cohérence exige.
 *
 * Pour `DEPUIS_LE_TIERS`, le client est **créé** s'il n'existe pas, avec sa
 * correspondance. C'est une écriture locale posée avant l'appel distant qui
 * crée le projet : si celui-ci échoue, le client reste. Il est juste — il
 * correspond bien à un tiers réel — et la reprise le retrouvera au lieu d'en
 * créer un second, la correspondance étant unique par tiers.
 */
async function clientVise(args: {
  cible: CibleCommande
  userId: string
  socid: number
  nomTiers: string
}): Promise<{ id: string; name: string }> {
  if (args.cible.type === 'NOUVELLE_MISSION') {
    return prisma.client.findUniqueOrThrow({
      where: { id: args.cible.clientId },
      select: { id: true, name: true },
    })
  }

  if (args.cible.type === 'MISSION') {
    const mission = await prisma.mission.findUniqueOrThrow({
      where: { id: args.cible.missionId },
      select: { client: { select: { id: true, name: true } } },
    })
    return mission.client
  }

  const existant = await prisma.externalLink.findFirst({
    where: { entityType: LIEN_CLIENT, provider: DOLIBARR, externalId: String(args.socid) },
    select: { entityId: true },
  })
  if (existant !== null) {
    return prisma.client.findUniqueOrThrow({
      where: { id: existant.entityId },
      select: { id: true, name: true },
    })
  }

  const { clientId } = await createClientFromDolibarr({
    userId: args.userId,
    dolibarrThirdpartyId: args.socid,
    name: args.nomTiers,
  })
  return { id: clientId, name: args.nomTiers }
}

/**
 * Le projet que la commande porte déjà, retrouvé parmi ceux que le port
 * expose — c'est-à-dire parmi les **facturables au temps**.
 *
 * Absent de cette liste, le projet existe mais n'accepte aucun temps : le dire
 * vaut mieux que créer un doublon facturable à côté, qui laisserait la
 * commande pointer sur l'un et les temps partir dans l'autre.
 */
async function projetDeLaCommande(api: DolibarrApi, commande: DolibarrOrder): Promise<DolibarrProject> {
  const projets = await api.listProjects()
  const p = projets.find((x) => x.id === commande.projectId)
  if (p === undefined) {
    throw new DolibarrRequestError(
      `La commande « ${commande.ref} » porte déjà le projet n° ${commande.projectId}, ` +
        `qui n'est pas facturable au temps. Ouvrez-le dans Dolibarr et cochez « Facturer le temps consommé », ` +
        `ou détachez-le de la commande.`,
    )
  }
  return p
}

/**
 * Le nom du tiers Dolibarr, ou le nom du client local à défaut.
 *
 * Le nom **de Dolibarr** est préféré parce que le projet vivra là-bas, et que
 * c'est ce nom-là que le porteur y lira. Le nom local ne sert que de secours :
 * la cohérence des tiers a déjà été vérifiée, les deux désignent le même
 * client.
 */
async function nomDuTiers(
  api: DolibarrApi,
  socid: number,
  nomLocal: string,
): Promise<string> {
  const tiers = await api.listThirdparties()
  return tiers.find((t) => t.id === socid)?.name ?? nomLocal
}

/**
 * Crée le projet Dolibarr d'une commande, et rattache la mission dessus.
 *
 * L'ordre n'est pas négociable :
 *
 * 1. lire la commande — l'appel distant d'abord, pour qu'une panne ne laisse
 *    rien derrière elle ;
 * 2. **refuser avant d'écrire** : la commande du tiers A ne crée pas de projet
 *    pour une mission du client B. Un refus après coup laisserait un projet
 *    orphelin, bien réel, chez le mauvais client ;
 * 3. si la commande porte déjà un projet, le réutiliser ;
 * 4. créer le projet, facturable au temps ;
 * 5. rattacher la mission — ce qui déclenche le rattrapage des CRA déjà
 *    validés, comme tout rattachement ;
 * 6. rattacher la commande au projet.
 */
export async function creerProjetDepuisCommande(args: {
  userId: string
  orderId: number
  cible: CibleCommande
  api: DolibarrApi
}): Promise<CreationProjetResult> {
  const commande = await args.api.getOrder(args.orderId)
  // Résolu une fois, et servant deux fois : à nommer le client créé, et à
  // nommer le projet. La commande ne porte que `socid`.
  const nomTiers = await nomDuTiers(args.api, commande.socid, '')
  const client = await clientVise({
    cible: args.cible,
    userId: args.userId,
    socid: commande.socid,
    nomTiers: nomTiers === '' ? `Tiers n° ${commande.socid}` : nomTiers,
  })

  verifierCoherenceTiers({
    elementLabel: 'La commande',
    projectRef: commande.ref,
    projectSocid: commande.socid,
    clientLabel: client.name,
    expectedThirdpartyId: await tiersAttendu(client.id),
  })

  const projetExistant = commande.projectId !== null
  // Le nom du tiers ne vient pas de la commande — elle ne porte que `socid`.
  // Il est résolu ici, et retombe sur le nom du client local si Dolibarr ne le
  // rend pas : un titre amputé vaut mieux qu'une création qui échoue.
  const titre = titreProjetDepuisCommande({
    ...commande,
    thirdpartyName: nomTiers === '' ? client.name : nomTiers,
  })
  const refExt = referenceExterneCommande(commande)

  const projet = projetExistant
    ? await projetDeLaCommande(args.api, commande)
    : await args.api.createProject({
        socid: commande.socid,
        title: titre,
        refExt,
        description: `Projet ouvert depuis la commande ${commande.ref}${
          refExt === '' ? '' : ` (référence client ${refExt})`
        }.`,
      })

  const rattachement =
    args.cible.type === 'MISSION'
      ? await attachMission({
          userId: args.userId,
          missionId: args.cible.missionId,
          dolibarrProjectId: projet.id,
          projectRef: projet.ref,
          projectSocid: projet.socid,
        })
      : null

  const missionId =
    args.cible.type === 'MISSION'
      ? args.cible.missionId
      : (
          await createMissionFromDolibarr({
            userId: args.userId,
            clientId: client.id,
            dolibarrProjectId: projet.id,
            projectRef: projet.ref,
            projectSocid: projet.socid,
            label: titre,
          })
        ).missionId

  // Le rattachement de la commande vient en dernier, et son échec n'annule
  // rien : le projet est créé et la mission pointe dessus. Le taire ferait
  // croire à un échec complet — et la reprise créerait un second projet.
  let commandeNonRattachee: string | null = null
  if (commande.projectId !== projet.id) {
    try {
      await args.api.linkOrderToProject({ orderId: commande.id, projectId: projet.id })
    } catch (err) {
      commandeNonRattachee = err instanceof Error ? err.message : String(err)
    }
  }

  return {
    projet,
    projetExistant,
    sansReferenceClient: refExt === '',
    commandeNonRattachee,
    // Une mission qui vient de naître n'a ni prestation, ni CRA, ni
    // correspondance dérivée : il n'y a rien à annoncer.
    rattachement: rattachement ?? { repointage: false, lignes: 0, temps: 0, craRattrapes: 0 },
    missionId,
  }
}

/**
 * Rattache une prestation à une ligne de commande et en reprend l'engagement.
 *
 * Jumelle d'`attachPropalLine`, et pour la même raison : les jours vendus et le
 * TJM sont **repris** du document et deviennent lecture seule localement. Deux
 * sources de vérité pour le même chiffre finissent toujours par diverger.
 *
 * La propale sert avant signature, la commande après — les deux coexistent, et
 * la dernière reprise gagne.
 */
export async function attachOrderLine(args: {
  userId: string
  lineId: string
  orderId: number
  orderLineId: number
  api: DolibarrApi
}): Promise<{ soldCentiemes: number; tjmCents: number }> {
  // Scope : on ne touche qu'à une ligne sur laquelle l'utilisateur est affecté.
  const affectation = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: {
      line: { select: { mission: { select: { client: { select: { id: true, name: true } } } } } },
    },
  })
  if (affectation === null) {
    throw new DolibarrRequestError('Cette prestation ne vous est pas affectée.')
  }

  // L'appel distant précède toute écriture : une panne ou une commande absente
  // ne doit rien laisser derrière elle.
  const commande = await args.api.getOrder(args.orderId)
  const ligne = commande.lines.find((l) => l.id === args.orderLineId)
  if (ligne === undefined) {
    throw new DolibarrRequestError(
      `La ligne ${args.orderLineId} est introuvable dans la commande ${commande.ref}.`,
    )
  }

  const client = affectation.line.mission.client
  verifierCoherenceTiers({
    elementLabel: 'La commande',
    projectRef: commande.ref,
    projectSocid: commande.socid,
    clientLabel: client.name,
    expectedThirdpartyId: await tiersAttendu(client.id),
  })

  const { soldCentiemes, tjmCents } = reprendreLigneVendue(ligne, 'commande')

  await prisma.$transaction(async (tx) => {
    await tx.missionLine.update({
      where: { id: args.lineId },
      data: { soldCentiemes, tjmCents, engagementSource: 'DOLIBARR_COMMANDE' },
    })

    // La part affectée suit les jours vendus, comme à la création : les
    // laisser diverger ferait mentir l'engagement affiché au consultant.
    await tx.assignment.update({
      where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
      data: { soldCentiemes },
    })

    await tx.externalLink.upsert({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_COMMANDE,
          entityId: args.lineId,
          provider: DOLIBARR,
        },
      },
      create: {
        // `userId` est obligatoire au schéma : c'est l'auteur du rattachement.
        userId: args.userId,
        entityType: LIEN_COMMANDE,
        entityId: args.lineId,
        provider: DOLIBARR,
        externalId: `${commande.id}:${ligne.id}`,
        syncedAt: new Date(),
        syncState: 'SYNCED',
      },
      update: {
        externalId: `${commande.id}:${ligne.id}`,
        syncedAt: new Date(),
        syncState: 'SYNCED',
      },
    })
  })

  return { soldCentiemes, tjmCents }
}
