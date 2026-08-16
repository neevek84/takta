import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import type { FetchLike } from '@/services/webhooks/delivery'
import type { Mailer } from '@/services/notify'
import {
  JOB_DEFINITIONS,
  JOB_HANDLERS,
  TRAVAUX_DIFFERES,
  type JobDefinition,
  type JobHandler,
} from './registry'

export type JobState = 'SUCCES' | 'ECHEC' | 'IGNORE' | 'INDISPONIBLE'

export interface JobReport {
  name: string
  state: JobState
  message: string
  durationMs: number
}

export interface TickReport {
  horodatage: string
  dus: number
  executes: JobReport[]
}

export interface JobView {
  name: string
  label: string
  intervalMinutes: number
  enabled: boolean
  /** faux tant qu'aucun traitement n'est enregistré pour ce nom */
  disponible: boolean
  lastRunAt: Date | null
  nextRunAt: Date
  lastState: string
  lastError: string
  /**
   * Le verrou d'exécution : non nul tant qu'un réveil travaille.
   *
   * Rendu à l'écran parce que la prise du verrou **n'est pas atomique** — la
   * lecture de `runningSince` et son écriture sont deux requêtes distinctes,
   * et un second déclenchement glissé entre les deux exécuterait le même
   * travail. Voir cet état, c'est au moins savoir qu'il ne faut pas cliquer
   * « Exécuter » maintenant.
   */
  enCoursDepuis: Date | null
}

/**
 * Au-delà, un verrou est réputé abandonné : un processus tué en plein
 * travail ne doit pas bloquer l'ordonnanceur pour toujours.
 */
const VERROU_PERIME_MINUTES = 60

const DEFINITION_PAR_NOM = new Map(JOB_DEFINITIONS.map((d) => [d.name, d]))

function messageDe(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  return brut.slice(0, 500)
}

/**
 * Aligne la table sur les déclarations, **sans écraser l'état** : la
 * récurrence et le libellé viennent du code, `enabled`, `lastRunAt` et
 * `nextRunAt` restent à la base.
 */
export async function syncJobDefinitions(): Promise<void> {
  for (const definition of JOB_DEFINITIONS) {
    await prisma.scheduledJob.upsert({
      where: { name: definition.name },
      create: {
        name: definition.name,
        intervalMinutes: definition.intervalMinutes,
        enabled: definition.enabledByDefault,
        // Un travail qui vient d'être déclaré est dû **tout de suite**.
        // L'échéance ne dépend ainsi jamais de l'horloge de la machine au
        // moment de la déclaration, mais du seul `now` qu'on lui passe —
        // c'est ce qui rend le réveil observable et reproductible.
        nextRunAt: new Date(0),
      },
      update: { intervalMinutes: definition.intervalMinutes },
    })
  }
}

/**
 * Le propriétaire de l'instance : le plus ancien compte.
 *
 * Un réveil externe n'a pas de session, et le produit est explicitement
 * mono-organisation — porter une notion d'utilisateur courant ici
 * réintroduirait un multi-tenant qu'aucune autre table ne connaît.
 *
 * **Exporté pour que la supervision le dise à l'écran**, et depuis cette
 * fonction-ci : un écran qui rejouerait la même requête de son côté
 * finirait par désigner un autre compte que celui qui travaille vraiment.
 * La conséquence à afficher est rude — un second consultant ne reçoit
 * aucun rappel, et rien d'autre ne le lui apprend.
 */
export async function instanceOwnerId(): Promise<string> {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  return user?.id ?? ''
}

type Ligne = Awaited<ReturnType<typeof prisma.scheduledJob.findFirstOrThrow>>

interface ContexteExecution {
  now: Date
  userId: string
  fetchFn?: FetchLike
  mailer?: Mailer
}

async function executer(
  ligne: Ligne,
  definition: JobDefinition,
  ctx: ContexteExecution,
  handlers: Readonly<Record<string, JobHandler>>,
): Promise<JobReport> {
  const debut = Date.now()
  const handler = handlers[definition.name]

  if (handler === undefined) {
    // Ni un succès, ni un échec : un travail dont le lot n'est pas livré.
    // Le faire échouer en boucle noierait les vraies alertes.
    const lot = TRAVAUX_DIFFERES[definition.name] ?? 'un lot ultérieur'
    const message = `Aucun traitement enregistré : ce travail est porté par le ${lot}.`
    await prisma.scheduledJob.update({
      where: { id: ligne.id },
      data: {
        lastState: 'INDISPONIBLE',
        lastError: '',
        nextRunAt: new Date(ctx.now.getTime() + definition.intervalMinutes * 60_000),
      },
    })
    return { name: definition.name, state: 'INDISPONIBLE', message, durationMs: 0 }
  }

  await prisma.scheduledJob.update({
    where: { id: ligne.id },
    data: { runningSince: ctx.now },
  })

  try {
    const resultat = await handler(ctx)

    await prisma.scheduledJob.update({
      where: { id: ligne.id },
      data: {
        lastState: 'SUCCES',
        lastError: '',
        lastRunAt: ctx.now,
        nextRunAt: new Date(ctx.now.getTime() + definition.intervalMinutes * 60_000),
        attempts: 0,
        runningSince: null,
      },
    })

    return {
      name: definition.name,
      state: 'SUCCES',
      message: resultat.message,
      durationMs: Date.now() - debut,
    }
  } catch (err) {
    const erreur = messageDe(err)

    await prisma.scheduledJob.update({
      where: { id: ligne.id },
      data: {
        lastState: 'ECHEC',
        lastError: erreur,
        lastRunAt: ctx.now,
        // Un travail périodique repassera de lui-même : le marteler
        // immédiatement n'apporterait rien qu'une charge inutile.
        nextRunAt: new Date(ctx.now.getTime() + definition.intervalMinutes * 60_000),
        attempts: { increment: 1 },
        runningSince: null,
      },
    })

    // Le journal doit garder la trace de l'échec — mais s'il est lui-même
    // en panne, cela ne doit pas transformer un travail raté en réveil raté.
    try {
      await appendAudit({
        ...ACTEUR_SYSTEME,
        action: 'travail.echoue',
        entityType: 'ScheduledJob',
        entityId: definition.name,
        payload: { travail: definition.name, erreur },
      })
    } catch {
      // consigné dans lastError, qui remonte dans la supervision
    }

    return {
      name: definition.name,
      state: 'ECHEC',
      message: erreur,
      durationMs: Date.now() - debut,
    }
  }
}

/**
 * Le réveil. Exécute les travaux échus, un par un, et rend un compte rendu.
 *
 * **L'échec de l'un n'interrompt jamais les autres** : chaque exécution est
 * enveloppée, et la boucle continue.
 */
export async function tick(
  args: {
    now?: Date
    userId?: string
    handlers?: Readonly<Record<string, JobHandler>>
    fetchFn?: FetchLike
    mailer?: Mailer
  } = {},
): Promise<TickReport> {
  const now = args.now ?? new Date()
  const handlers = args.handlers ?? JOB_HANDLERS

  await syncJobDefinitions()
  const userId = args.userId ?? (await instanceOwnerId())

  const dus = await prisma.scheduledJob.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { name: 'asc' },
  })

  const executes: JobReport[] = []
  const verrouPerime = new Date(now.getTime() - VERROU_PERIME_MINUTES * 60_000)

  for (const ligne of dus) {
    const definition = DEFINITION_PAR_NOM.get(ligne.name)
    if (definition === undefined) continue // ligne orpheline : la déclaration fait foi

    if (ligne.runningSince !== null && ligne.runningSince > verrouPerime) {
      executes.push({
        name: ligne.name,
        state: 'IGNORE',
        message: 'Déjà en cours depuis le réveil précédent.',
        durationMs: 0,
      })
      continue
    }

    executes.push(
      await executer(
        ligne,
        definition,
        {
          now,
          userId,
          ...(args.fetchFn !== undefined && { fetchFn: args.fetchFn }),
          ...(args.mailer !== undefined && { mailer: args.mailer }),
        },
        handlers,
      ),
    )
  }

  return { horodatage: now.toISOString(), dus: dus.length, executes }
}

/**
 * Exécution immédiate depuis la supervision. Ignore l'échéance **et**
 * l'activation : un automatisme qu'on ne peut pas déclencher soi-même est un
 * automatisme qu'on ne peut pas déboguer.
 */
export async function runJobNow(
  userId: string,
  name: string,
  args: {
    now?: Date
    handlers?: Readonly<Record<string, JobHandler>>
    fetchFn?: FetchLike
    mailer?: Mailer
  } = {},
): Promise<JobReport> {
  const definition = DEFINITION_PAR_NOM.get(name)
  if (definition === undefined) {
    throw new Error(`Le travail « ${name} » n'existe pas.`)
  }

  await syncJobDefinitions()
  const ligne = await prisma.scheduledJob.findUniqueOrThrow({ where: { name } })

  return executer(
    ligne,
    definition,
    {
      now: args.now ?? new Date(),
      userId,
      ...(args.fetchFn !== undefined && { fetchFn: args.fetchFn }),
      ...(args.mailer !== undefined && { mailer: args.mailer }),
    },
    args.handlers ?? JOB_HANDLERS,
  )
}

export async function listJobs(): Promise<JobView[]> {
  await syncJobDefinitions()
  const lignes = await prisma.scheduledJob.findMany({ orderBy: { name: 'asc' } })
  const parNom = new Map(lignes.map((l) => [l.name, l]))

  return JOB_DEFINITIONS.map((definition) => {
    const ligne = parNom.get(definition.name)
    return {
      name: definition.name,
      label: definition.label,
      intervalMinutes: definition.intervalMinutes,
      enabled: ligne?.enabled ?? definition.enabledByDefault,
      disponible: definition.name in JOB_HANDLERS,
      lastRunAt: ligne?.lastRunAt ?? null,
      nextRunAt: ligne?.nextRunAt ?? new Date(0),
      lastState: ligne?.lastState ?? '',
      lastError: ligne?.lastError ?? '',
      enCoursDepuis: ligne?.runningSince ?? null,
    }
  })
}

/**
 * `userId` par cohérence avec la règle du projet, bien que `ScheduledJob`
 * soit une table d'instance : la signature reste alignée sur celle qu'un
 * futur multi-consultants exigerait, sans coût aujourd'hui.
 */
export async function setJobEnabled(
  userId: string,
  name: string,
  enabled: boolean,
): Promise<JobView> {
  if (!DEFINITION_PAR_NOM.has(name)) {
    throw new Error(`Le travail « ${name} » n'existe pas.`)
  }

  await syncJobDefinitions()
  await prisma.scheduledJob.update({ where: { name }, data: { enabled } })

  const vues = await listJobs()
  return vues.find((v) => v.name === name)!
}
