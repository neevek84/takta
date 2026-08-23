import { describe, it, expect, afterEach, vi } from 'vitest'
import { register } from '@/instrumentation'
import { prisma, assurerDurabilite } from '@/db/client'
import { estSqlite, poserDurabiliteSqlite } from '@/db/durabilite'
import { arreterHorloge, demarrerHorloge } from '@/services/jobs/horloge'

/**
 * Le crochet de démarrage du serveur. Sans lui, `synchronous=FULL` n'était posé
 * que par le lanceur, sur une connexion refermée avant le `spawn` : le serveur
 * — un autre processus — ne posait rien, et la promesse « couper l'ordinateur
 * ne perd rien » ne tenait que par la valeur par défaut compilée de SQLite.
 */

async function synchronous(): Promise<number> {
  const r = await prisma.$queryRawUnsafe<{ synchronous: bigint | number }[]>('PRAGMA synchronous')
  return Number(r[0]!.synchronous)
}

afterEach(async () => {
  vi.restoreAllMocks()
  // Le crochet remonte une vraie horloge : la laisser battre ferait tourner de
  // vrais travaux contre la base de test, pendant les fichiers suivants.
  arreterHorloge()
  delete process.env.NEXT_PHASE
  await poserDurabiliteSqlite(prisma, process.env.DATABASE_URL ?? '')
})

describe('register', () => {
  it("pose l'attente du disque sur la connexion du SERVEUR", async () => {
    if (!estSqlite(process.env.DATABASE_URL ?? '')) return
    // On part d'une connexion où le pragma ne vaut pas FULL : seule sa pose
    // effective par `register` peut le ramener à 2. Le test tombe donc si
    // l'appel disparaît — ce que ne faisait pas la simple lecture de la valeur
    // par défaut de SQLite.
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // Le pragma n'est plus posé à l'import : on part donc d'un état connu,
    // puis on le casse, pour que seule la pose faite par `register` puisse le
    // rétablir.
    await assurerDurabilite()
    await prisma.$executeRawUnsafe('PRAGMA synchronous=OFF')
    expect(await synchronous()).toBe(0)

    await register()

    expect(await synchronous()).toBe(2)
  })

  it("n'écrit aucun secret dans le journal", async () => {
    if (!estSqlite(process.env.DATABASE_URL ?? '')) return
    const journal = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await register()

    const ecrit = journal.mock.calls.flat().join('\n')
    expect(ecrit).not.toContain(process.env.DATABASE_URL)
    for (const nom of ['AUTH_SECRET', 'CREDENTIALS_KEY', 'SYNC_FLUSH_TOKEN'] as const) {
      const valeur = process.env[nom]
      if (valeur) expect(ecrit).not.toContain(valeur)
    }
  })

  it('ne fait rien hors runtime Node : le pool Prisma n y a pas sa place', async () => {
    const avant = process.env.NEXT_RUNTIME
    process.env.NEXT_RUNTIME = 'edge'
    try {
      await expect(register()).resolves.toBeUndefined()
    } finally {
      if (avant === undefined) delete process.env.NEXT_RUNTIME
      else process.env.NEXT_RUNTIME = avant
    }
  })
})

/**
 * **L'application porte sa propre horloge, et c'est le démarrage qui la
 * remonte.** L'ordonnanceur attendait auparavant un déclencheur extérieur —
 * un cron, une tâche planifiée de NAS. Une synchronisation qui ne part que si
 * quelqu'un y a pensé n'est pas une fonction du produit.
 */
describe("l'horloge de l'ordonnanceur", () => {
  it('est remontée au démarrage du serveur', async () => {
    arreterHorloge()

    await register()

    // Elle tourne : un second démarrage est donc refusé.
    expect(demarrerHorloge()).toBe(false)
  })

  // `next build` exécute lui aussi ce point d'entrée. Sans cette garde, chaque
  // construction ouvrirait la base de développement de qui construit et y
  // ferait tourner de vrais travaux — écritures sortantes comprises.
  it('reste au repos pendant la construction', async () => {
    arreterHorloge()
    process.env.NEXT_PHASE = 'phase-production-build'

    await register()

    expect(demarrerHorloge()).toBe(true)
  })
})
