import { describe, it, expect } from 'vitest'
import { SignatureConnectorError, type SignatureFetchLike } from '@/core/signature/connector'
import { createDocumensoConnector, parseDocumensoWebhook } from './documenso'

const BASE = 'https://documenso.test'
const CLE = 'api_cle_de_test'

interface Appel {
  url: string
  method: string
  headers: Record<string, string>
  body?: string | Uint8Array | FormData
  statut: number
}

interface Enveloppe {
  id: string
  secondaryId: number
  status: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'REJECTED'
  distributionMethod: 'EMAIL' | 'NONE' | ''
  recipients: Array<{ id: number; token: string; signingStatus: string; rejectionReason: string | null }>
  itemId: string
  annulee: boolean
  sansJeton?: boolean
}

/**
 * Le double de l'API v2 de Documenso. **Il refuse ce que Documenso
 * refuserait** — un double complaisant valide un connecteur qui ne marcherait
 * pas :
 *   - la clé d'API sur toute route ;
 *   - création en `multipart/form-data` avec un champ `payload` JSON et un
 *     fichier PDF non vide — un corps JSON y est refusé ;
 *   - `type: DOCUMENT`, un titre, un destinataire `SIGNER` adressé ;
 *   - des champs en pourcentages, dans [0, 100] ;
 *   - distribution d'une enveloppe existante, `distributionMethod` explicite ;
 *   - 404 sur toute route ou enveloppe inconnue.
 */
function faussApi() {
  const appels: Appel[] = []
  const enveloppes = new Map<string, Enveloppe>()
  let compteur = 0

  const refus = (m: string, s: number) => new Response(m, { status: s })
  const json = (v: unknown) =>
    new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })

  const fetchFn: SignatureFetchLike = async (url, init) => {
    const r = await repondre(url, init)
    appels.push({ url, method: init.method, headers: init.headers, body: init.body, statut: r.status })
    return r
  }

  async function lireJson(init: Parameters<SignatureFetchLike>[1]) {
    if (init.headers['Content-Type'] !== 'application/json' || typeof init.body !== 'string') return null
    return JSON.parse(init.body) as Record<string, unknown>
  }

  async function repondre(url: string, init: Parameters<SignatureFetchLike>[1]): Promise<Response> {
    if (!url.startsWith(`${BASE}/api/v2/`)) return refus('Inconnu', 404)
    if (init.headers.Authorization !== CLE) return refus('Clé absente', 401)
    const chemin = url.slice(`${BASE}/api/v2`.length)

    if (chemin === '/envelope/create' && init.method === 'POST') {
      if (!(init.body instanceof FormData)) return refus('multipart attendu', 415)
      const brut = init.body.get('payload')
      const fichier = init.body.get('files')
      if (typeof brut !== 'string') return refus('payload manquant', 400)
      if (!(fichier instanceof Blob) || fichier.size === 0) return refus('fichier manquant', 400)
      const p = JSON.parse(brut) as {
        title?: string; type?: string; externalId?: string
        recipients?: Array<{ email?: string; name?: string; role?: string; fields?: Array<Record<string, number | string>> }>
      }
      if (p.type !== 'DOCUMENT' || !p.title) return refus('type ou titre', 400)
      const r0 = p.recipients?.[0]
      if (!r0?.email || !r0.name || r0.role !== 'SIGNER') return refus('destinataire', 400)
      for (const f of r0.fields ?? []) {
        for (const k of ['positionX', 'positionY', 'width', 'height'] as const) {
          const v = f[k]
          if (typeof v !== 'number' || v < 0 || v > 100) return refus(`champ ${k}`, 400)
        }
      }
      compteur += 1
      const id = `envelope_${compteur}`
      enveloppes.set(id, {
        id, secondaryId: 1000 + compteur, status: 'DRAFT', distributionMethod: '',
        recipients: [{ id: compteur, token: `jeton-${compteur}`, signingStatus: 'NOT_SIGNED', rejectionReason: null }],
        itemId: `item_${compteur}`, annulee: false,
      })
      return json({ id })
    }

    if (chemin === '/envelope/distribute' && init.method === 'POST') {
      const corps = await lireJson(init)
      const e = corps && enveloppes.get(String(corps.envelopeId))
      if (!e) return refus('enveloppe', 404)
      const meta = corps.meta as { distributionMethod?: string } | undefined
      if (meta?.distributionMethod !== 'NONE' && meta?.distributionMethod !== 'EMAIL') return refus('distributionMethod', 400)
      e.status = 'PENDING'
      e.distributionMethod = meta.distributionMethod
      return json({ success: true, id: e.id, recipients: e.recipients.map((r) => ({ ...r, signingUrl: `${BASE}/sign/${r.token}` })) })
    }

    if (chemin === '/envelope/redistribute' && init.method === 'POST') {
      const corps = await lireJson(init)
      const e = corps && enveloppes.get(String(corps.envelopeId))
      if (!e) return refus('enveloppe', 404)
      if (!Array.isArray(corps.recipients) || corps.recipients.length === 0) return refus('recipients', 400)
      e.recipients = e.recipients.map((r) => ({ ...r, token: `${r.token}-r` }))
      if (e.sansJeton) return json({ success: true, id: e.id, recipients: [] })
      return json({ success: true, id: e.id, recipients: e.recipients })
    }

    if (chemin === '/envelope/cancel' && init.method === 'POST') {
      const corps = await lireJson(init)
      const e = corps && enveloppes.get(String(corps.envelopeId))
      if (!e) return refus('enveloppe', 404)
      e.annulee = true
      return json({ success: true })
    }

    const doc = /^\/document\/(\d+)$/.exec(chemin)
    if (doc && init.method === 'GET') {
      const e = [...enveloppes.values()].find((x) => x.secondaryId === Number(doc[1]))
      return e ? json({ id: e.secondaryId, envelopeId: e.id }) : refus('document', 404)
    }

    const tel = /^\/envelope\/item\/([^/]+)\/download\?version=signed$/.exec(chemin)
    if (tel && init.method === 'GET') {
      const e = [...enveloppes.values()].find((x) => x.itemId === tel[1])
      if (!e) return refus('item', 404)
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { 'Content-Type': 'application/pdf' } })
    }

    const get = /^\/envelope\/([^/?]+)$/.exec(chemin)
    if (get && init.method === 'GET') {
      const e = enveloppes.get(get[1]!)
      if (!e) return refus('enveloppe', 404)
      return json({ id: e.id, status: e.status, recipients: e.recipients, envelopeItems: [{ id: e.itemId }] })
    }

    return refus('Route inconnue', 404)
  }

  return { fetchFn, appels, enveloppes }
}

function connecteur(api = faussApi()) {
  return { api, c: createDocumensoConnector({ fetchFn: api.fetchFn, baseUrl: `${BASE}/`, apiKey: CLE }) }
}

const ENVOI = {
  titre: 'CRA Client — ITSM — septembre 2026',
  fileName: 'CRA.pdf',
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  destinataire: { nom: 'Jeanne Martin', email: 'jeanne@client.test' },
  champs: [{
    nature: 'SIGNATURE' as const, ancre: '[[cra:signature]]', page: 1,
    x: 600, y: 60, largeur: 148, hauteur: 34, pageLargeur: 842, pageHauteur: 595,
  }],
  reference: 'cra_123',
}

describe('send — une enveloppe v2, distribuée sans courriel', () => {
  it('crée en multipart, distribue en NONE, et rend le jeton du signataire', async () => {
    const { api, c } = connecteur()
    const depot = await c.send(ENVOI)

    expect(depot).toEqual({ externalId: 'envelope_1', jetonSignataire: 'jeton-1' })
    expect(api.appels.map((a) => `${a.method} ${a.url.replace(BASE, '')}`)).toEqual([
      'POST /api/v2/envelope/create',
      'POST /api/v2/envelope/distribute',
    ])
    expect(api.enveloppes.get('envelope_1')!.distributionMethod).toBe('NONE')
  })

  it('porte notre référence, le destinataire et les champs en pourcentages', async () => {
    const { api, c } = connecteur()
    await c.send(ENVOI)
    const corps = api.appels[0]!.body as FormData
    const payload = JSON.parse(String(corps.get('payload')))
    expect(payload.externalId).toBe('cra_123')
    expect(payload.recipients[0]).toMatchObject({ name: 'Jeanne Martin', email: 'jeanne@client.test', role: 'SIGNER' })
    expect(payload.recipients[0].fields[0]).toMatchObject({ type: 'SIGNATURE', page: 1, identifier: 0 })
  })

  it("ne pose pas de Content-Type sur le multipart — c'est fetch qui fixe la frontière", async () => {
    const { api, c } = connecteur()
    await c.send(ENVOI)
    expect(api.appels[0]!.headers['Content-Type']).toBeUndefined()
  })

  it('lève une erreur typée, sans rien du corps de la réponse', async () => {
    const { c } = connecteur()
    const err = await c.send({ ...ENVOI, destinataire: { nom: '', email: 'x' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SignatureConnectorError)
    expect((err as SignatureConnectorError).statusCode).toBe(400)
    expect((err as Error).message).not.toContain('destinataire')
  })
})

describe('status', () => {
  it('traduit PENDING, COMPLETED, REJECTED avec son motif', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    expect(await c.status(externalId)).toEqual({ statut: 'EN_ATTENTE', motifRefus: null })

    api.enveloppes.get(externalId)!.status = 'COMPLETED'
    expect(await c.status(externalId)).toEqual({ statut: 'SIGNE', motifRefus: null })

    const e = api.enveloppes.get(externalId)!
    e.status = 'REJECTED'
    e.recipients[0]!.signingStatus = 'REJECTED'
    e.recipients[0]!.rejectionReason = 'Il manque le 15.'
    expect(await c.status(externalId)).toEqual({ statut: 'REFUSE', motifRefus: 'Il manque le 15.' })
  })

  it('rend EN_ATTENTE sur un statut inconnu, plutôt que d inventer une issue', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    ;(api.enveloppes.get(externalId)! as { status: string }).status = 'QUELQUE_CHOSE'
    expect((await c.status(externalId)).statut).toBe('EN_ATTENTE')
  })

  it('résout un identifiant numérique hérité de la v1 vers son enveloppe', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    api.enveloppes.get(externalId)!.status = 'COMPLETED'
    const numerique = String(api.enveloppes.get(externalId)!.secondaryId)
    expect((await c.status(numerique)).statut).toBe('SIGNE')
  })
})

describe('download, renouveler, annuler', () => {
  it('télécharge la version signée du seul fichier de l enveloppe', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    const octets = await c.download(externalId)
    expect(Buffer.from(octets).toString('latin1')).toBe('%PDF')
    expect(api.appels.at(-1)!.url).toBe(`${BASE}/api/v2/envelope/item/item_1/download?version=signed`)
  })

  it('renouvelle et rend le jeton à jour', async () => {
    const { c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    expect(await c.renouveler(externalId)).toBe('jeton-1-r')
  })

  it('lève si le renouvellement ne rend aucun jeton', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    api.enveloppes.get(externalId)!.sansJeton = true
    await expect(c.renouveler(externalId)).rejects.toBeInstanceOf(SignatureConnectorError)
  })

  it('annule l enveloppe', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    await c.annuler(externalId)
    expect(api.enveloppes.get(externalId)!.annulee).toBe(true)
  })
})

describe('urlEmbarquee', () => {
  it('pointe /embed/sign/{jeton} sur l instance, avec nom et adresse verrouillés et refus permis', () => {
    const { c } = connecteur()
    const url = c.urlEmbarquee('jeton-1', { nom: 'Jeanne Martin', email: 'jeanne@client.test' })
    const [adresse, fragment] = url.split('#')
    expect(adresse).toBe(`${BASE}/embed/sign/jeton-1`)
    const options = JSON.parse(decodeURIComponent(Buffer.from(fragment!, 'base64').toString('utf8')))
    expect(options).toMatchObject({
      name: 'Jeanne Martin', lockName: true, email: 'jeanne@client.test', lockEmail: true,
      allowDocumentRejection: true,
    })
  })
})

describe('parseDocumensoWebhook', () => {
  const charge = (event: string, payload: Record<string, unknown>) => JSON.stringify({ event, payload })

  it('propose l enveloppe puis l identifiant numérique, pour les envois hérités', () => {
    expect(parseDocumensoWebhook(charge('DOCUMENT_COMPLETED', { id: 42, envelopeId: 'envelope_9' }))).toEqual({
      candidats: ['envelope_9', '42'],
      eventId: 'DOCUMENT_COMPLETED:envelope_9',
    })
  })

  it('reconnaît refus, annulation et expiration ; ignore le reste', () => {
    for (const ev of ['DOCUMENT_REJECTED', 'DOCUMENT_CANCELLED', 'DOCUMENT_EXPIRED', 'DOCUMENT_SIGNED']) {
      expect(parseDocumensoWebhook(charge(ev, { id: 1, envelopeId: 'e' }))).not.toBeNull()
    }
    expect(parseDocumensoWebhook(charge('DOCUMENT_OPENED', { id: 1, envelopeId: 'e' }))).toBeNull()
  })

  it('rend null sur une charge illisible', () => {
    expect(parseDocumensoWebhook('pas du json')).toBeNull()
    expect(parseDocumensoWebhook('[]')).toBeNull()
    expect(parseDocumensoWebhook(charge('DOCUMENT_COMPLETED', {}))).toBeNull()
  })
})
