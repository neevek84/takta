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
import { createLine, createMission } from '@/services/missions'
import { verifierCoherenceTiers } from '@/core/dolibarr/coherence'
import {
  referenceExterneCommande,
  referenceProjetDepuisCommande,
  referenceProjetDepuisMission,
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
import { LIEN_CLIENT, LIEN_COMMANDE, LIEN_MISSION } from './liens'
import { assurerLaTache } from './taches'

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
  /** prestations créées depuis les lignes de service de la commande */
  prestationsCreees: number
  /** tâches Dolibarr créées pour ces prestations */
  tachesCreees: number
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
 * **Une commande qui porte déjà un projet reste proposée.** L'écarter était une
 * erreur mesurée sur l'instance du porteur : ses deux seules commandes en cours
 * — validées, non facturées — pointent chacune vers un projet créé à la main
 * dans Dolibarr, et n'apparaissaient donc nulle part. Or c'est le cas normal de
 * son flux : le projet existe, il manque la mission. `creerProjetDepuisCommande`
 * sait déjà réutiliser ce projet au lieu d'en créer un second.
 *
 * En revanche, une commande dont le projet est **déjà suivi par une mission
 * locale** porte le nom de cette mission : en créer une seconde sur le même
 * projet ferait partir deux CRA vers les mêmes tâches.
 */
export async function listerCommandesRattachables(args: {
  userId: string
  api: DolibarrApi
}): Promise<
  Array<
    CommandeCandidate & {
      clientId: string | null
      thirdpartyName: string
      /** mission locale suivant déjà le projet de cette commande, `null` sinon */
      missionId: string | null
      missionLabel: string | null
    }
  >
> {
  const [commandes, tiers] = await Promise.all([
    listerCommandes(args.api),
    // Le nom du tiers ne vient pas de la commande — elle ne porte que `socid`.
    // Sans lui, l'écran ne proposerait que des numéros.
    args.api.listThirdparties(),
  ])
  const nomParTiers = new Map(tiers.map((t) => [t.id, t.name]))

  // Sans filtre sur `userId`, comme partout ailleurs : une correspondance
  // appartient à l'instance, pas à celui qui l'a posée.
  const liens = await prisma.externalLink.findMany({
    where: { entityType: { in: [LIEN_CLIENT, LIEN_MISSION] }, provider: DOLIBARR },
    select: { entityType: true, entityId: true, externalId: true },
  })
  const clientParTiers = new Map(
    liens.filter((l) => l.entityType === LIEN_CLIENT).map((l) => [l.externalId, l.entityId]),
  )
  const missionParProjet = new Map(
    liens.filter((l) => l.entityType === LIEN_MISSION).map((l) => [l.externalId, l.entityId]),
  )

  // Les libellés restent scopés : on dit qu'un projet est pris, jamais sous
  // quel nom un autre consultant l'a rangé.
  const missions = await prisma.mission.findMany({
    where: {
      id: { in: [...missionParProjet.values()] },
      OR: [{ lines: { none: {} } }, { lines: { some: { assignments: { some: { userId: args.userId } } } } }],
    },
    select: { id: true, label: true },
  })
  const libelleMission = new Map(missions.map((m) => [m.id, m.label]))

  return commandes.map((c) => {
    const missionId = c.projectId === null ? null : (missionParProjet.get(String(c.projectId)) ?? null)
    return {
      ...c,
      clientId: clientParTiers.get(String(c.socid)) ?? null,
      thirdpartyName: nomParTiers.get(c.socid) ?? `Tiers n° ${c.socid}`,
      missionId,
      /** `null` aussi quand la mission appartient à un autre consultant */
      missionLabel: missionId === null ? null : (libelleMission.get(missionId) ?? null),
    }
  })
}

/**
 * Le tiers Dolibarr de chaque client local, quand il en a un.
 *
 * Lu pour lui-même, et non déduit des commandes : un client sans commande en
 * cours n'apparaissait alors nulle part, et **ses projets non plus** — on ne
 * pouvait pas rattacher une mission à un projet qui n'était né d'aucun bon de
 * commande.
 */
export async function tiersParClient(): Promise<Map<string, number>> {
  const liens = await prisma.externalLink.findMany({
    where: { entityType: LIEN_CLIENT, provider: DOLIBARR },
    select: { entityId: true, externalId: true },
  })
  return new Map(liens.map((l) => [l.entityId, Number(l.externalId)]))
}

/** Un projet Dolibarr proposable à une mission, avec son tiers. */
export interface ProjetCandidat {
  id: number
  ref: string
  title: string
  socid: number | null
  /** mission locale qui le suit déjà, `null` sinon */
  missionId: string | null
}

/**
 * Les projets facturables au temps, avec la mission qui les suit déjà.
 *
 * Rendus **tous**, tiers compris : c'est l'écran qui les rapproche du client
 * choisi, parce que le client se change sans recharger la page. Le refus de
 * cohérence reste posé côté service — l'écran filtre pour aider, il ne garde
 * rien.
 */
export async function listerProjetsCandidats(api: DolibarrApi): Promise<ProjetCandidat[]> {
  const projets = await api.listProjects()
  const liens = await prisma.externalLink.findMany({
    where: { entityType: LIEN_MISSION, provider: DOLIBARR },
    select: { entityId: true, externalId: true },
  })
  const missionParProjet = new Map(liens.map((l) => [l.externalId, l.entityId]))

  return projets.map((p) => ({
    id: p.id,
    ref: p.ref,
    title: p.title,
    socid: p.socid,
    missionId: missionParProjet.get(String(p.id)) ?? null,
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
        // La référence de la commande : unique par construction, elle dit d'où
        // le projet vient, et une seconde tentative se heurte à elle plutôt que
        // d'ouvrir un doublon.
        ref: referenceProjetDepuisCommande(commande),
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

  // Les prestations et leurs tâches n'ouvrent que pour une mission qui vient de
  // naître : une mission existante a déjà les siennes, et les redoubler
  // ferait deux fois le même engagement.
  const ouverture =
    args.cible.type === 'MISSION'
      ? { prestationsCreees: 0, tachesCreees: 0 }
      : await ouvrirLesPrestations({
          userId: args.userId,
          missionId,
          commande,
          projectId: projet.id,
          api: args.api,
        })

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
    ...ouverture,
  }
}

/**
 * Crée une prestation par **ligne de service** de la commande, et sa tâche
 * Dolibarr.
 *
 * **Pourquoi maintenant et pas au premier envoi de temps.** La tâche était
 * créée paresseusement, au moment du push : le projet naissait vide, et rien
 * dans Dolibarr ne disait ce qui avait été vendu tant qu'aucun temps n'était
 * parti. Le flux du porteur va propale → commande → projet → **tâches** →
 * saisie : les tâches appartiennent à l'ouverture du chantier.
 *
 * **Les lignes de produit sont écartées.** Une commande peut vendre des objets
 * autant que du temps ; reprendre une ligne de cinq t-shirts donnerait une
 * prestation de « 5 jours vendus ».
 *
 * **Idempotent côté Dolibarr** : une tâche portant déjà ce libellé dans le
 * projet est réutilisée, jamais doublée. C'est exactement ce que fait le push,
 * et les deux doivent se retrouver sur la même tâche.
 */
async function ouvrirLesPrestations(args: {
  userId: string
  missionId: string
  commande: DolibarrOrder
  projectId: number
  api: DolibarrApi
}): Promise<{ prestationsCreees: number; tachesCreees: number }> {
  const services = args.commande.lines.filter((l) => l.service)
  if (services.length === 0) return { prestationsCreees: 0, tachesCreees: 0 }

  const existantes = await args.api.listTasks(args.projectId)
  let tachesCreees = 0

  for (const ligne of services) {
    const { soldCentiemes, tjmCents } = reprendreLigneVendue(ligne, 'commande')
    const label = ligne.label.replace(/\s+/g, ' ').trim() || `Ligne ${ligne.id}`

    const prestation = await createLine({
      missionId: args.missionId,
      userId: args.userId,
      label,
      soldCentiemes,
      tjmCents,
    })

    // La tâche passe par le même chemin qu'une prestation ajoutée à la main :
    // deux implémentations auraient fini par diverger sur la réutilisation.
    const { creee } = await assurerLaTache({
      userId: args.userId,
      lineId: prestation.id,
      label,
      projectId: args.projectId,
      api: args.api,
      connues: existantes,
    })
    if (creee) tachesCreees += 1

    await prisma.$transaction(async (tx) => {
      await tx.missionLine.update({
        where: { id: prestation.id },
        data: { engagementSource: 'DOLIBARR_COMMANDE' },
      })
      await tx.externalLink.create({
        data: {
          userId: args.userId,
          entityType: LIEN_COMMANDE,
          entityId: prestation.id,
          provider: DOLIBARR,
          externalId: `${args.commande.id}:${ligne.id}`,
          syncedAt: new Date(),
          syncState: 'SYNCED',
        },
      })
    })
  }

  return { prestationsCreees: services.length, tachesCreees }
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

/** Ce que la création d'une mission demande à Dolibarr, quand elle lui demande. */
export type ProjetVoulu =
  /** rien : la mission reste locale, et le reste de l'application marche pareil */
  | { type: 'AUCUN' }
  /** un projet Dolibarr qui existe déjà */
  | { type: 'EXISTANT'; projectId: number; projectRef: string; projectSocid: number | null }
  /** un projet à ouvrir pour cette mission */
  | { type: 'CREER' }

export interface MissionCreeeResult {
  missionId: string
  /** le projet rattaché, `null` quand la mission reste locale */
  projet: DolibarrProject | null
  projetCree: boolean
}

/**
 * Crée une mission « à la main », avec le projet Dolibarr que l'utilisateur a
 * demandé — ou sans, ce qui reste le cas ordinaire d'une instance sans ERP.
 *
 * **Pourquoi le projet se décide ici.** Une mission créée sans projet ne
 * pousse jamais rien : `isDolibarrPushArmed` exige la correspondance, et un
 * CRA validé sans elle n'entre même pas en file. Le rattachement se faisait
 * donc plus tard, dans les réglages, et il fallait y penser — sans quoi
 * l'historique restait hors de Dolibarr sans qu'un mot le dise.
 *
 * **Créer le projet exige un tiers.** Si le client local n'en a pas encore, il
 * est poussé chez Dolibarr : refuser ici obligerait à sortir de la création de
 * mission pour y revenir, exactement ce qu'on vient de retirer du parcours.
 */
export async function creerMissionAvecProjet(args: {
  userId: string
  clientId: string
  label: string
  minutesParJour: number | null
  signataireNom: string
  signataireEmail: string
  projet: ProjetVoulu
  /** `null` quand Dolibarr n'est pas connecté : seul `AUCUN` est alors possible */
  api: DolibarrApi | null
}): Promise<MissionCreeeResult> {
  if (args.projet.type !== 'AUCUN' && args.api === null) {
    throw new DolibarrRequestError(
      "Dolibarr n'est pas connecté : la mission peut être créée, mais aucun projet ne peut l'être.",
    )
  }

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: args.clientId },
    select: { id: true, name: true },
  })

  // Tout ce qui peut être refusé l'est **avant** la création de la mission :
  // un refus après coup laisserait une mission orpheline, jamais rattachée,
  // mais bien réelle en base.
  let projet: DolibarrProject | null = null

  if (args.projet.type === 'EXISTANT') {
    verifierCoherenceTiers({
      projectRef: args.projet.projectRef,
      projectSocid: args.projet.projectSocid,
      clientLabel: client.name,
      expectedThirdpartyId: await tiersAttendu(client.id),
    })
  }

  if (args.projet.type === 'CREER') {
    const api = args.api as DolibarrApi
    const socid = await tiersAttendu(client.id)
    // Un client qui ne vient pas de Dolibarr **reste local**. Le pousser
    // d'ici créerait un tiers en douce, depuis un écran qui ne parle pas de
    // ça — et le porteur découvrirait dans son ERP un client qu'il n'a pas
    // demandé. Le rattachement et la création passent par Administration ·
    // Dolibarr, et par là seulement.
    if (socid === null) {
      throw new DolibarrRequestError(
        `« ${client.name} » n'est rattaché à aucun tiers Dolibarr : aucun projet ne peut être ` +
          'ouvert pour lui. Rattachez-le, ou créez-le, dans Administration · Dolibarr — ' +
          'puis revenez. La mission reste créable sans projet.',
      )
    }

    projet = await api.createProject({
      socid,
      ref: referenceProjetDepuisMission({ label: args.label }),
      title: args.label,
      // Aucune référence client à reporter : cette mission ne vient d'aucun
      // document. Inventer une valeur ferait passer pour un report ce qui n'en
      // est pas un.
      refExt: '',
      description: `Projet ouvert pour la mission « ${args.label} ».`,
    })
  }

  const mission = await createMission({
    clientId: args.clientId,
    label: args.label,
    minutesParJour: args.minutesParJour,
    signataireNom: args.signataireNom,
    signataireEmail: args.signataireEmail,
    userId: args.userId,
  })

  if (args.projet.type === 'EXISTANT') {
    await attachMission({
      userId: args.userId,
      missionId: mission.id,
      dolibarrProjectId: args.projet.projectId,
      projectRef: args.projet.projectRef,
      projectSocid: args.projet.projectSocid,
    })
  }

  if (projet !== null) {
    await attachMission({
      userId: args.userId,
      missionId: mission.id,
      dolibarrProjectId: projet.id,
      projectRef: projet.ref,
      projectSocid: projet.socid,
    })
  }

  return {
    missionId: mission.id,
    projet,
    projetCree: projet !== null,
  }
}
