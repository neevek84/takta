import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit, readAuditSince } from '@/services/audit'
import { verifySignature } from '@/core/webhooks/signature'
import {
  EN_TETE_EVENEMENT,
  EN_TETE_SEQ,
  EN_TETE_SIGNATURE,
  SEQ_ESSAI,
} from '@/core/webhooks/payload'
import type { AuditAction } from '@/core/audit/events'
import { createWebhook, updateWebhook } from './subscriptions'
import {
  distributeWebhooks,
  listDeliveries,
  resendDelivery,
  sendTestWebhook,
  MAX_TENTATIVES,
  RECULS_MINUTES,
  type FetchLike,
} from './delivery'

const SECRET = 'secret-de-test'
const NOW = new Date('2026-08-15T10:00:00.000Z')
let userId = ''

interface Appel {
  url: string
  corps: string
  entetes: Record<string, string>
}

/** Double d'appel sortant : enregistre tout, répond ce qu'on lui dit. */
function espion(reponses: Array<number | 'throw'>): { fetchFn: FetchLike; appels: Appel[] } {
  const appels: Appel[] = []
  let i = 0
  const fetchFn: FetchLike = async (url, init) => {
    const entetes: Record<string, string> = {}
    for (const [cle, valeur] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      entetes[cle] = valeur
    }
    appels.push({ url, corps: String(init.body ?? ''), entetes })

    const reponse = reponses[Math.min(i++, reponses.length - 1)]
    if (reponse === 'throw') throw new Error('ECONNREFUSED')
    return new Response('', { status: reponse })
  }
  return { fetchFn, appels }
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'deliv@test.local', name: 'K', passwordHash: 'x' } })
  ).id
})

beforeEach(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  // Écriture directe, et non `updateSettings` : celui-ci consigne
  // `reglage.modifie`, ce qui polluerait le journal que ces tests comptent.
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', webhookMaxEchecs: 10 },
    update: { webhookMaxEchecs: 10 },
  })
})

afterAll(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'deliv@test.local' } })
  await prisma.$disconnect()
})

function abonnement(events: AuditAction[] = []) {
  return createWebhook(userId, {
    label: 'n8n',
    url: 'https://exemple.test/hook',
    events,
    secret: SECRET,
  })
}

async function evenement(action: AuditAction = 'cra.valide', entityId = 'cra_1') {
  return appendAudit({
    ...ACTEUR_SYSTEME,
    action,
    entityType: 'Cra',
    entityId,
    payload: { month: '2026-07' },
  })
}

describe('constantes de reprise', () => {
  it('a un recul par reprise, pas un de plus', () => {
    // Cinq tentatives : la première est immédiate, les quatre suivantes
    // reculent. Un recul de trop laisserait une livraison en attente
    // éternelle après l'abandon.
    expect(RECULS_MINUTES).toHaveLength(MAX_TENTATIVES - 1)
    expect([...RECULS_MINUTES]).toEqual([1, 5, 15, 60])
  })
})

describe('distribution', () => {
  it('poste la charge utile signée, avec ses trois en-têtes', async () => {
    await abonnement()
    const entree = await evenement()
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(1)
    expect(appels[0]!.url).toBe('https://exemple.test/hook')
    expect(appels[0]!.entetes[EN_TETE_EVENEMENT]).toBe('cra.valide')
    expect(appels[0]!.entetes[EN_TETE_SEQ]).toBe(String(entree.seq))

    // Un consommateur recalcule le HMAC du corps brut et retrouve l'en-tête.
    expect(verifySignature(SECRET, appels[0]!.corps, appels[0]!.entetes[EN_TETE_SIGNATURE]!)).toBe(
      true,
    )
    // Un octet de plus, et ce n'est plus valide.
    expect(
      verifySignature(SECRET, `${appels[0]!.corps} `, appels[0]!.entetes[EN_TETE_SIGNATURE]!),
    ).toBe(false)
  })

  it('NE MET LE SECRET NI DANS LA CHARGE UTILE NI DANS LA TRACE', async () => {
    // Le secret sert à signer. S'il partait dans le corps, ou s'il se
    // retrouvait dans la ligne de livraison qu'un écran affiche, la
    // signature ne prouverait plus rien.
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([500])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels[0]!.corps).not.toContain(SECRET)
    expect(JSON.stringify(await prisma.webhookDelivery.findMany({}))).not.toContain(SECRET)
    expect(JSON.stringify(await listDeliveries(userId))).not.toContain(SECRET)
  })

  it('avance le curseur et ne renvoie jamais deux fois le même événement', async () => {
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })
    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(1)
  })

  it('FILTRE : un abonnement à cra.valide ne reçoit pas saisie.creee', async () => {
    await abonnement(['cra.valide'])
    await evenement('saisie.creee', 't1')
    await evenement('cra.valide', 'cra_1')
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(1)
    expect(appels[0]!.entetes[EN_TETE_EVENEMENT]).toBe('cra.valide')
  })

  it('FILTRE : un abonnement à liste vide reçoit tout', async () => {
    await abonnement([])
    await evenement('saisie.creee', 't1')
    await evenement('cra.valide', 'cra_1')
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels.map((a) => a.entetes[EN_TETE_EVENEMENT])).toEqual(['saisie.creee', 'cra.valide'])
  })

  it('n appelle pas un abonnement suspendu', async () => {
    const w = await abonnement()
    await updateWebhook(userId, w.id, { state: 'SUSPENDU' })
    await evenement()
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(0)
  })

  it('DISTRIBUE SUR UNE INSTANCE DONT LES RÉGLAGES N ONT JAMAIS ÉTÉ OUVERTS', async () => {
    // Sans ligne de réglages — l'état d'une installation neuve — la
    // distribution doit tourner sur le seuil par défaut du schéma, pas
    // échouer à chaque réveil : un travail en échec perpétuel noie les
    // vraies alertes.
    await abonnement()
    await evenement()
    await prisma.settings.deleteMany({})
    const { fetchFn, appels } = espion([200])

    const rapport = await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(1)
    expect(rapport).toMatchObject({ reussies: 1 })
  })

  it('rend un compte rendu chiffré', async () => {
    await abonnement()
    await evenement()
    const { fetchFn } = espion([200])

    expect(await distributeWebhooks({ fetchFn, now: NOW })).toMatchObject({
      abonnements: 1,
      creees: 1,
      tentees: 1,
      reussies: 1,
      echouees: 0,
      abandonnees: 0,
      suspendus: 0,
    })
  })
})

describe('échec, recul et abandon', () => {
  it('réessaie avec un recul progressif puis abandonne CET événement', async () => {
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([500])

    let instant = NOW
    for (let tour = 1; tour <= MAX_TENTATIVES + 2; tour++) {
      await distributeWebhooks({ fetchFn, now: instant })
      instant = new Date(instant.getTime() + 24 * 60 * 60 * 1000)
    }

    // Cinq tentatives, pas une de plus : après l'abandon, on ne rappelle plus.
    expect(appels).toHaveLength(MAX_TENTATIVES)

    const livraisons = await listDeliveries(userId)
    expect(livraisons[0]).toMatchObject({ state: 'ABANDONNE', attempts: MAX_TENTATIVES })
  })

  it('ne réessaie pas avant l échéance de recul', async () => {
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([500])

    await distributeWebhooks({ fetchFn, now: NOW })
    // 30 secondes plus tard : le premier recul est d'une minute.
    await distributeWebhooks({ fetchFn, now: new Date(NOW.getTime() + 30_000) })

    expect(appels).toHaveLength(1)
  })

  it('traite un appel qui jette comme un échec, sans faire tomber la distribution', async () => {
    await abonnement()
    await evenement()
    const { fetchFn } = espion(['throw'])

    const rapport = await distributeWebhooks({ fetchFn, now: NOW })
    expect(rapport).toMatchObject({ tentees: 1, reussies: 0, echouees: 1 })
    expect((await listDeliveries(userId))[0]!.lastError).toContain('ECONNREFUSED')
  })

  it('un abonnement en échec n empêche pas les autres', async () => {
    const sain = await createWebhook(userId, {
      label: 'sain',
      url: 'https://sain.test/hook',
      events: [],
      secret: SECRET,
    })
    await createWebhook(userId, {
      label: 'mort',
      url: 'https://mort.test/hook',
      events: [],
      secret: SECRET,
    })
    await evenement()

    const appels: string[] = []
    const fetchFn: FetchLike = async (url) => {
      appels.push(url)
      if (url.includes('mort')) throw new Error('ECONNREFUSED')
      return new Response('', { status: 200 })
    }

    const rapport = await distributeWebhooks({ fetchFn, now: NOW })
    expect(appels).toHaveLength(2)
    expect(rapport).toMatchObject({ reussies: 1, echouees: 1 })
    expect((await listDeliveries(userId)).find((d) => d.webhookId === sain.id)!.state).toBe('SUCCES')
  })
})

describe('suspension d un abonnement', () => {
  beforeEach(async () => {
    await prisma.settings.update({ where: { id: 'singleton' }, data: { webhookMaxEchecs: 3 } })
  })

  it('suspend après N échecs consécutifs et le signale', async () => {
    await abonnement()
    for (let i = 1; i <= 3; i++) await evenement('cra.valide', `cra_${i}`)
    const { fetchFn } = espion([500])

    const rapport = await distributeWebhooks({ fetchFn, now: NOW })

    expect(rapport.suspendus).toBe(1)
    const w = await prisma.webhook.findFirstOrThrow({ where: { userId } })
    expect(w.state).toBe('SUSPENDU')
    expect(w.consecutiveFailures).toBeGreaterThanOrEqual(3)
    expect(w.lastError).not.toBe('')
    expect(w.suspendedAt).not.toBeNull()
  })

  it('un envoi réussi remet le compteur à zéro', async () => {
    const w = await abonnement()
    await prisma.webhook.update({ where: { id: w.id }, data: { consecutiveFailures: 2 } })
    await evenement()
    const { fetchFn } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    const relu = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(relu.consecutiveFailures).toBe(0)
    expect(relu.lastError).toBe('')
    expect(relu.state).toBe('ACTIF')
  })

  it('UN ABONNEMENT SUSPENDU NE FAIT PERDRE AUCUN ÉVÉNEMENT', async () => {
    // Le test qui protège la promesse centrale du modèle.
    await abonnement()
    for (let i = 1; i <= 3; i++) await evenement('cra.valide', `cra_${i}`)
    const { fetchFn } = espion([500])

    await distributeWebhooks({ fetchFn, now: NOW })
    expect((await prisma.webhook.findFirstOrThrow({ where: { userId } })).state).toBe('SUSPENDU')

    // Trois événements de plus pendant la suspension.
    for (let i = 4; i <= 6; i++) await evenement('cra.valide', `cra_${i}`)

    // Tout est là, du premier au dernier, lisible par tirage.
    const tout = await readAuditSince({ since: 0, limit: 500 })
    expect(tout.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('renvoi à la main', () => {
  it('produit le même corps et la même signature', async () => {
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([500, 200])

    await distributeWebhooks({ fetchFn, now: NOW })
    const livraison = (await listDeliveries(userId))[0]!

    await resendDelivery(userId, livraison.id, { fetchFn, now: NOW })

    expect(appels).toHaveLength(2)
    expect(appels[1]!.corps).toBe(appels[0]!.corps)
    expect(appels[1]!.entetes[EN_TETE_SIGNATURE]).toBe(appels[0]!.entetes[EN_TETE_SIGNATURE])
  })

  it('rouvre une livraison abandonnée', async () => {
    await abonnement()
    await evenement()
    const { fetchFn } = espion([500, 500, 500, 500, 500, 200])

    let instant = NOW
    for (let tour = 1; tour <= MAX_TENTATIVES; tour++) {
      await distributeWebhooks({ fetchFn, now: instant })
      instant = new Date(instant.getTime() + 24 * 60 * 60 * 1000)
    }
    const abandonnee = (await listDeliveries(userId))[0]!
    expect(abandonnee.state).toBe('ABANDONNE')

    const renvoyee = await resendDelivery(userId, abandonnee.id, { fetchFn, now: instant })
    expect(renvoyee.state).toBe('SUCCES')
  })

  it('refuse de renvoyer la livraison d un autre', async () => {
    const autre = await prisma.user.create({
      data: { email: 'deliv-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await createWebhook(autre.id, {
      label: 'a',
      url: 'https://exemple.test/h',
      events: [],
      secret: SECRET,
    })
    await evenement()
    const { fetchFn } = espion([200])
    await distributeWebhooks({ fetchFn, now: NOW })

    const livraison = (await listDeliveries(autre.id))[0]!
    await expect(resendDelivery(userId, livraison.id, { fetchFn, now: NOW })).rejects.toThrow()

    await prisma.user.delete({ where: { id: autre.id } })
  })
})

describe('bouton d essai', () => {
  it('appelle l URL sans rien écrire au journal ni en file', async () => {
    const w = await abonnement()
    await evenement()
    const avantJournal = await prisma.auditEvent.count()
    const { fetchFn, appels } = espion([200])

    const r = await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })

    expect(r).toMatchObject({ ok: true, status: 200 })
    expect(appels).toHaveLength(1)
    expect(await prisma.auditEvent.count()).toBe(avantJournal)
    expect(await prisma.webhookDelivery.count()).toBe(0)
  })

  it('marque l essai par un numéro d ordre nul et une entité dédiée', async () => {
    const w = await abonnement()
    const { fetchFn, appels } = espion([200])

    await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })

    const corps = JSON.parse(appels[0]!.corps)
    expect(corps.seq).toBe(SEQ_ESSAI)
    expect(corps.entity).toEqual({ type: 'Essai', id: 'essai' })
    expect(corps.data).toMatchObject({ essai: true })
  })

  it('signe l essai comme un vrai événement', async () => {
    const w = await abonnement()
    const { fetchFn, appels } = espion([200])
    await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })

    expect(verifySignature(SECRET, appels[0]!.corps, appels[0]!.entetes[EN_TETE_SIGNATURE]!)).toBe(
      true,
    )
  })

  it('refuse d essayer l abonnement d un autre', async () => {
    const w = await createWebhook(userId, {
      label: 'a',
      url: 'https://exemple.test/h',
      events: [],
      secret: SECRET,
    })
    const { fetchFn, appels } = espion([200])

    await expect(sendTestWebhook('utilisateur-inconnu', w.id, { fetchFn, now: NOW })).rejects.toThrow()
    expect(appels).toHaveLength(0)
  })

  it('rapporte l échec sans suspendre ni compter', async () => {
    const w = await abonnement()
    const { fetchFn } = espion(['throw'])

    const r = await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })
    expect(r.ok).toBe(false)
    expect(r.erreur).toContain('ECONNREFUSED')

    const relu = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(relu.consecutiveFailures).toBe(0)
    expect(relu.state).toBe('ACTIF')
  })

  it('essaie même un abonnement suspendu — c est justement à ça qu il sert', async () => {
    const w = await abonnement()
    await updateWebhook(userId, w.id, { state: 'SUSPENDU' })
    const { fetchFn, appels } = espion([200])

    expect((await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })).ok).toBe(true)
    expect(appels).toHaveLength(1)
  })
})
