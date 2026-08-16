/**
 * La reprise d'un engagement depuis une propale Dolibarr — **en lecture
 * seule**.
 *
 * L'application ne modifie jamais la propale : elle reste maîtresse chez
 * Dolibarr, et la synchronisation reste unidirectionnelle. Ce module ne fait
 * que lire une propale et recopier, ligne à ligne, ce qu'elle vend.
 *
 * Reprendre une propale, c'est importer **des lignes**, chacune avec sa
 * quantité vendue et son tarif — jamais un total : une même propale porte
 * couramment « Consultant ITSM 30 j TJM 800 » et « Consultant ITSM Nuit 10 j
 * TJM 1200 », et c'est sur la bonne ligne que le CRA se fait.
 *
 * Et c'est un **complément, pas une obligation** : une prestation reste
 * créable et modifiable à la main sans jamais passer par ici.
 */
import { prisma } from '@/db/client'
import { verifierCoherenceTiers } from '@/core/dolibarr/coherence'
import { reprendreLignePropale } from '@/core/dolibarr/propal'
import { DOLIBARR, DolibarrRequestError, type DolibarrApi } from './api'
import { tiersAttendu } from './import'

/**
 * Nature de correspondance propre à la reprise de propale : `externalId` y
 * porte **deux** identifiants, `propaleId:ligneId`. La ligne seule ne suffit
 * pas à retrouver la propale dans l'API Dolibarr, qui n'expose les lignes que
 * sous leur propale.
 */
const LIEN_PROPALE = 'MissionLinePropalLine'

/**
 * Rattache une prestation à une ligne de propale et en reprend l'engagement.
 *
 * Les jours vendus et le TJM sont **repris** de la propale et deviennent
 * lecture seule localement (voir `updateLine`) : deux sources de vérité pour
 * le même chiffre finissent toujours par diverger.
 *
 * Rien d'autre n'est repris. Le libellé local, l'unité d'affichage et les
 * saisies déjà enregistrées ne bougent pas — une reprise qui écraserait une
 * prestation déjà saisie détruirait du travail réel, et le facteur figé sur
 * chaque saisie n'a aucune raison de changer parce qu'une propale est arrivée.
 */
export async function attachPropalLine(args: {
  userId: string
  lineId: string
  proposalId: number
  propalLineId: number
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

  // L'appel distant précède toute écriture : une panne ou une propale absente
  // ne doit rien laisser derrière elle.
  const propale = await args.api.getProposal(args.proposalId)
  const ligne = propale.lines.find((l) => l.id === args.propalLineId)
  if (ligne === undefined) {
    throw new DolibarrRequestError(
      `La ligne ${args.propalLineId} est introuvable dans la propale ${propale.ref}.`,
    )
  }

  // La même garde que le rattachement des projets, et pour la même raison :
  // reprendre la propale du tiers A sur une mission du client B poserait
  // l'engagement — et plus tard la facture — chez le mauvais client.
  const client = affectation.line.mission.client
  verifierCoherenceTiers({
    elementLabel: 'La propale',
    projectRef: propale.ref,
    projectSocid: propale.socid,
    clientLabel: client.name,
    expectedThirdpartyId: await tiersAttendu(client.id),
  })

  const { soldCentiemes, tjmCents } = reprendreLignePropale(ligne)

  await prisma.$transaction(async (tx) => {
    await tx.missionLine.update({
      where: { id: args.lineId },
      data: { soldCentiemes, tjmCents, engagementSource: 'DOLIBARR_PROPALE' },
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
          entityType: LIEN_PROPALE,
          entityId: args.lineId,
          provider: DOLIBARR,
        },
      },
      create: {
        // `userId` est obligatoire au schéma : c'est l'auteur du rattachement.
        userId: args.userId,
        entityType: LIEN_PROPALE,
        entityId: args.lineId,
        provider: DOLIBARR,
        externalId: `${propale.id}:${ligne.id}`,
        syncedAt: new Date(),
        syncState: 'SYNCED',
      },
      update: {
        externalId: `${propale.id}:${ligne.id}`,
        syncedAt: new Date(),
        syncState: 'SYNCED',
      },
    })
  })

  return { soldCentiemes, tjmCents }
}
