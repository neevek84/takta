/**
 * La tâche Dolibarr d'une prestation, posée dès que la prestation existe.
 *
 * **L'incohérence que ce module ferme.** Une prestation née d'une commande
 * recevait sa tâche à l'ouverture du chantier ; une prestation ajoutée à la
 * main, non — sa tâche n'apparaissait qu'au premier envoi de temps. Le projet
 * montrait donc une partie de ce qui avait été vendu, et le reste surgissait
 * des semaines plus tard. Les deux chemins passent désormais ici.
 *
 * **Une tâche du même libellé est réutilisée, jamais doublée.** C'est ainsi que
 * le push la retrouve (`push.ts` la cherche par son libellé) : deux tâches
 * feraient partir les temps sur l'une et laisseraient l'autre vide.
 */
import { prisma } from '@/db/client'
import { DOLIBARR, type DolibarrApi, type DolibarrTask } from './api'
import { LIEN_LIGNE, LIEN_MISSION } from './liens'

/** Le projet Dolibarr d'une mission, ou `null` si elle n'en a pas. */
export async function projetDeLaMission(missionId: string): Promise<number | null> {
  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_MISSION,
        entityId: missionId,
        provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  return lien === null ? null : Number(lien.externalId)
}

/**
 * Pose la tâche d'une prestation dans le projet, et la correspondance qui va
 * avec.
 *
 * `connues` évite de relire la liste des tâches à chaque prestation quand on
 * en ouvre plusieurs d'affilée ; elle est **complétée** au passage, de sorte
 * que deux prestations de même libellé dans la même série retombent sur la
 * même tâche.
 */
export async function assurerLaTache(args: {
  userId: string
  lineId: string
  label: string
  projectId: number
  api: DolibarrApi
  connues?: DolibarrTask[]
}): Promise<{ tache: DolibarrTask; creee: boolean }> {
  const connues = args.connues ?? (await args.api.listTasks(args.projectId))

  const deja = connues.find((t) => t.label === args.label)
  let tache = deja
  if (tache === undefined) {
    try {
      tache = await args.api.createTask({ projectId: args.projectId, label: args.label })
    } catch (err) {
      // Le contexte que Dolibarr ne donne pas. Son refus de créer une tâche est
      // un « Error creating task » nu, et la cause la plus fréquente ne se
      // devine pas : la tâche **existe déjà** côté Dolibarr sans que l'API la
      // rende — mesuré sur l'instance du porteur, où `GET /projects/{id}/tasks`
      // rend une liste vide sur un projet qui en porte une à l'écran. On croit
      // alors devoir la créer, et sa référence est déjà prise.
      const motif = err instanceof Error ? err.message : String(err)
      throw new Error(
        `${motif} — tâche « ${args.label} » dans le projet n° ${args.projectId}. ` +
          'Deux causes connues, toutes deux côté Dolibarr : un **champ complémentaire des ' +
          'tâches dont la formule calculée est invalide** — il fait échouer la création et ' +
          'disparaître la tâche des listes, mesuré sur une instance 23.0.1 — ou un utilisateur ' +
          "de clé d'API qui ne voit pas les tâches de ce projet.",
      )
    }
  }
  if (deja === undefined) connues.push(tache)

  // `upsert` et non `create` : réouvrir une prestation déjà rattachée ne doit
  // pas échouer sur la clé d'unicité, elle doit simplement viser la même tâche.
  await prisma.externalLink.upsert({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_LIGNE,
        entityId: args.lineId,
        provider: DOLIBARR,
      },
    },
    create: {
      userId: args.userId,
      entityType: LIEN_LIGNE,
      entityId: args.lineId,
      provider: DOLIBARR,
      externalId: String(tache.id),
      syncedAt: new Date(),
      syncState: 'SYNCED',
    },
    update: { externalId: String(tache.id), syncedAt: new Date(), syncState: 'SYNCED' },
  })

  return { tache, creee: deja === undefined }
}

/**
 * La tâche d'une prestation qu'on vient de créer — **sans jamais faire échouer
 * la création**.
 *
 * La prestation est locale et valide : une instance Dolibarr injoignable, un
 * droit manquant ou une mission sans projet ne doivent pas empêcher de la
 * saisir. Le motif est rendu pour être dit à l'écran, jamais avalé — sans quoi
 * le porteur croirait sa tâche créée et ne la trouverait pas.
 */
export async function ouvrirLaTacheDeLaPrestation(args: {
  userId: string
  missionId: string
  lineId: string
  label: string
  /** `null` quand Dolibarr n'est pas connecté : il n'y a rien à ouvrir */
  api: DolibarrApi | null
}): Promise<{ creee: boolean; echec: string | null }> {
  if (args.api === null) return { creee: false, echec: null }

  const projectId = await projetDeLaMission(args.missionId)
  if (projectId === null) return { creee: false, echec: null }

  try {
    const { creee } = await assurerLaTache({
      userId: args.userId,
      lineId: args.lineId,
      label: args.label,
      projectId,
      api: args.api,
    })
    return { creee, echec: null }
  } catch (err) {
    return { creee: false, echec: err instanceof Error ? err.message : String(err) }
  }
}
