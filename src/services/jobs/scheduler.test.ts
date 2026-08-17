import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { readAuditSince } from '@/services/audit'
import { JOB_DEFINITIONS, JOB_HANDLERS, TRAVAUX_DIFFERES, type JobHandler } from './registry'
import { listJobs, runJobNow, setJobEnabled, syncJobDefinitions, tick } from './scheduler'

const NOW = new Date('2026-08-15T10:00:00.000Z')
let userId = ''

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'jobs@test.local', name: 'K', passwordHash: 'x' } })
  ).id
})

beforeEach(async () => {
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'jobs@test.local' } })
  await prisma.$disconnect()
})

/** Registre de test : déterministe, sans effet de bord. */
function registre(overrides: Record<string, JobHandler>): Record<string, JobHandler> {
  return { ...JOB_HANDLERS, ...overrides }
}

describe('le registre', () => {
  it('déclare les sept travaux de la spec', () => {
    expect(JOB_DEFINITIONS.map((d) => d.name)).toEqual([
      'outbox.flush',
      'webhooks.distribute',
      'rappel.saisie',
      'rappel.cloture',
      'signature.relance',
      'signature.rafraichissement',
      'journal.verification',
    ])
  })

  it('chaque travail déclaré est traité, ou explicitement différé', () => {
    // Le jour où un lot livre son travail, il retire son nom d'ici — et ce
    // test l'y oblige plutôt que de laisser pourrir un travail orphelin.
    for (const definition of JOB_DEFINITIONS) {
      const traite = definition.name in JOB_HANDLERS
      const differe = definition.name in TRAVAUX_DIFFERES
      expect(traite !== differe, `travail « ${definition.name} »`).toBe(true)
    }
  })

  it('les travaux différés sont désactivés par défaut', () => {
    for (const definition of JOB_DEFINITIONS) {
      if (definition.name in TRAVAUX_DIFFERES) {
        expect(definition.enabledByDefault, definition.name).toBe(false)
      }
    }
  })

  it('PLUS AUCUN TRAVAIL N EST DIFFÉRÉ : les sept sont portés', () => {
    // L'attente a changé, et c'est le fait de la livraison. Ce test figeait
    // `['signature.relance', 'signature.rafraichissement']` : il verrouillait
    // l'état exact que le lot 3 devait défaire, et livrer le raccordement le
    // faisait échouer. Tant que le tableau restait plein, la case « différé »
    // satisfaisait le garde-fou « traité, ou explicitement différé » — et
    // aucun CRA n'était jamais relancé, aucun webhook perdu jamais rattrapé.
    //
    // Ce qui reste gardé : chaque nom encore différé doit nommer son lot. Le
    // jour où un huitième travail est déclaré sans traitement, cette
    // assertion-là le reprend.
    expect(TRAVAUX_DIFFERES).toEqual({})
    for (const lot of Object.values(TRAVAUX_DIFFERES)) {
      expect(lot).toMatch(/lot/i)
    }
  })

  it('donne une récurrence exploitable à chacun', () => {
    for (const d of JOB_DEFINITIONS) {
      expect(Number.isInteger(d.intervalMinutes) && d.intervalMinutes > 0, d.name).toBe(true)
    }
  })
})

describe('synchronisation des déclarations', () => {
  it('crée une ligne par travail déclaré', async () => {
    await syncJobDefinitions()
    expect(await prisma.scheduledJob.count()).toBe(JOB_DEFINITIONS.length)
  })

  it('n écrase pas l état d un travail déjà connu', async () => {
    await syncJobDefinitions()
    await setJobEnabled(userId, 'rappel.saisie', false)
    await prisma.scheduledJob.update({
      where: { name: 'rappel.saisie' },
      data: { lastRunAt: NOW, lastState: 'SUCCES' },
    })

    await syncJobDefinitions()

    const relu = await prisma.scheduledJob.findUniqueOrThrow({ where: { name: 'rappel.saisie' } })
    expect(relu.enabled).toBe(false)
    expect(relu.lastState).toBe('SUCCES')
  })
})

describe('réveil', () => {
  it('exécute un travail échu', async () => {
    const vus: string[] = []
    const rapport = await tick({
      now: NOW,
      userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          vus.push('webhooks.distribute')
          return { message: 'ok' }
        },
      }),
    })

    expect(vus).toContain('webhooks.distribute')
    expect(rapport.executes.find((e) => e.name === 'webhooks.distribute')).toMatchObject({
      state: 'SUCCES',
      message: 'ok',
    })
  })

  it('n exécute pas un travail non échu', async () => {
    await syncJobDefinitions()
    await prisma.scheduledJob.update({
      where: { name: 'webhooks.distribute' },
      data: { nextRunAt: new Date(NOW.getTime() + 60 * 60 * 1000) },
    })

    const rapport = await tick({ now: NOW, userId })
    expect(rapport.executes.map((e) => e.name)).not.toContain('webhooks.distribute')
  })

  it('DEUX RÉVEILS RAPPROCHÉS N EXÉCUTENT PAS DEUX FOIS LE MÊME TRAVAIL', async () => {
    let appels = 0
    const handlers = registre({
      'webhooks.distribute': async () => {
        appels++
        return { message: 'ok' }
      },
    })

    await tick({ now: NOW, userId, handlers })
    await tick({ now: new Date(NOW.getTime() + 60_000), userId, handlers })

    // La récurrence est de cinq minutes : le second réveil est trop tôt.
    expect(appels).toBe(1)
  })

  it('n exécute pas un travail désactivé', async () => {
    await syncJobDefinitions()
    await setJobEnabled(userId, 'webhooks.distribute', false)

    let appels = 0
    await tick({
      now: NOW,
      userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          appels++
          return { message: '' }
        },
      }),
    })
    expect(appels).toBe(0)
  })

  it('UN TRAVAIL EN ÉCHEC N EMPÊCHE PAS LES SUIVANTS', async () => {
    // `rappel.saisie` est désactivé par défaut : sans cette activation, le
    // test ne prouverait rien — il n'y aurait qu'un seul travail à échouer.
    await syncJobDefinitions()
    await setJobEnabled(userId, 'rappel.saisie', true)

    const reussis: string[] = []
    const rapport = await tick({
      now: NOW,
      userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          throw new Error('URL injoignable')
        },
        'rappel.saisie': async () => {
          reussis.push('rappel.saisie')
          return { message: 'rien à signaler' }
        },
        'journal.verification': async () => {
          reussis.push('journal.verification')
          return { message: 'chaîne intacte' }
        },
      }),
    })

    expect(reussis).toEqual(['journal.verification', 'rappel.saisie'])
    expect(rapport.executes.find((e) => e.name === 'webhooks.distribute')).toMatchObject({
      state: 'ECHEC',
    })
    expect(
      rapport.executes
        .filter((e) => e.state === 'SUCCES')
        .map((e) => e.name)
        .sort(),
    ).toEqual(['journal.verification', 'rappel.saisie'])
  })

  it('consigne travail.echoue, une entrée par échec', async () => {
    await tick({
      now: NOW,
      userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          throw new Error('URL injoignable')
        },
      }),
    })

    const journal = (await readAuditSince({ since: 0 })).filter((e) => e.action === 'travail.echoue')
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      entityType: 'ScheduledJob',
      entityId: 'webhooks.distribute',
      actorId: '',
      actorLabel: 'SYSTEME',
    })
    expect(journal[0]!.payload).toMatchObject({ erreur: 'URL injoignable' })
  })

  it('retient la dernière erreur et repousse quand même l échéance', async () => {
    await tick({
      now: NOW,
      userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          throw new Error('URL injoignable')
        },
      }),
    })

    const relu = await prisma.scheduledJob.findUniqueOrThrow({
      where: { name: 'webhooks.distribute' },
    })
    expect(relu.lastState).toBe('ECHEC')
    expect(relu.lastError).toContain('URL injoignable')
    expect(relu.attempts).toBe(1)
    // Un travail périodique repassera : le marteler en boucle n'aide personne.
    expect(relu.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime())
    expect(relu.runningSince).toBeNull()
  })

  it('marque INDISPONIBLE un travail déclaré sans traitement, sans le compter en échec', async () => {
    // L'attente a changé de sujet, pas de fond. Ce test prenait
    // `signature.relance` comme exemple de travail non porté : plus aucun ne
    // l'est, et s'appuyer sur un trou du produit pour couvrir un mécanisme
    // faisait de sa disparition un échec de suite. Le registre est donc
    // **injecté vide** — le mécanisme reste exercé, et le jour où un huitième
    // travail est déclaré sans traitement, il se comportera comme ici.
    await syncJobDefinitions()
    await setJobEnabled(userId, 'signature.relance', true)

    const rapport = await tick({ now: NOW, userId, handlers: {} })

    const ligne = rapport.executes.find((e) => e.name === 'signature.relance')
    expect(ligne).toMatchObject({ state: 'INDISPONIBLE' })
    expect(ligne!.message).toMatch(/lot/i)
    expect(
      (await readAuditSince({ since: 0 })).filter((e) => e.action === 'travail.echoue'),
    ).toHaveLength(0)
  })

  it('saute un travail encore en cours', async () => {
    await syncJobDefinitions()
    await prisma.scheduledJob.update({
      where: { name: 'webhooks.distribute' },
      data: { runningSince: new Date(NOW.getTime() - 60_000) },
    })

    let appels = 0
    const rapport = await tick({
      now: NOW,
      userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          appels++
          return { message: '' }
        },
      }),
    })

    expect(appels).toBe(0)
    expect(rapport.executes.find((e) => e.name === 'webhooks.distribute')).toMatchObject({
      state: 'IGNORE',
    })
  })

  it('reprend un verrou périmé plutôt que de bloquer à jamais', async () => {
    await syncJobDefinitions()
    await prisma.scheduledJob.update({
      where: { name: 'webhooks.distribute' },
      data: { runningSince: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) },
    })

    let appels = 0
    await tick({
      now: NOW,
      userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          appels++
          return { message: '' }
        },
      }),
    })
    expect(appels).toBe(1)
  })
})

describe('exécution à la main', () => {
  it('exécute un travail même hors échéance', async () => {
    await syncJobDefinitions()
    await prisma.scheduledJob.update({
      where: { name: 'rappel.saisie' },
      data: { nextRunAt: new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000) },
    })

    let appels = 0
    const rapport = await runJobNow(userId, 'rappel.saisie', {
      now: NOW,
      handlers: registre({
        'rappel.saisie': async () => {
          appels++
          return { message: 'fait' }
        },
      }),
    })

    expect(appels).toBe(1)
    expect(rapport).toMatchObject({ name: 'rappel.saisie', state: 'SUCCES', message: 'fait' })
  })

  it('exécute même un travail désactivé — un automatisme qu on ne peut pas déclencher soi-même ne se débogue pas', async () => {
    await syncJobDefinitions()
    await setJobEnabled(userId, 'rappel.cloture', false)

    let appels = 0
    await runJobNow(userId, 'rappel.cloture', {
      now: NOW,
      handlers: registre({
        'rappel.cloture': async () => {
          appels++
          return { message: '' }
        },
      }),
    })
    expect(appels).toBe(1)
  })

  it('refuse un nom inconnu', async () => {
    await expect(runJobNow(userId, 'travail.inexistant', { now: NOW })).rejects.toThrow()
  })
})

describe('vue des travaux', () => {
  it('expose l état de chacun, disponibilité comprise', async () => {
    await syncJobDefinitions()
    const vues = await listJobs()

    expect(vues).toHaveLength(JOB_DEFINITIONS.length)
    // L'attente a changé : les deux travaux de signature sont portés, donc
    // disponibles. L'écran n'affiche plus « Aucun traitement enregistré » pour
    // eux — c'était le symptôme visible du défaut.
    for (const v of vues) {
      expect(v.disponible, v.name).toBe(true)
      expect(v.label.length).toBeGreaterThan(0)
    }
  })
})
