import { describe, it, expect } from 'vitest'
import {
  SignatureConnectorError,
  type SignatureFetchLike,
} from '@/core/signature/connector'
import { createDocumensoConnector, parseDocumensoWebhook } from './documenso'

const BASE = 'https://documenso.test'
const CLE = 'api_cle_de_test'

interface Appel {
  url: string
  method: string
  headers: Record<string, string>
  body?: string | Uint8Array
  /** ce que le double a répondu — c'est lui qui dit si la charge était acceptable */
  statut: number
}

/**
 * Le double de l'API Documenso.
 *
 * **Il refuse ce que Documenso refuserait.** Un double complaisant valide un
 * connecteur qui ne marcherait pas : celui de Google a dû être durci deux
 * fois, la seconde parce qu'il acceptait du JSON là où l'API exige un
 * formulaire — un défaut qui laissait la suite entière au vert.
 *
 * Ce qu'il exige, et qui correspond à ce que refuse l'API réelle :
 *   - la clé d'API sur toute route `/api/`, et **seulement** sur celles-ci :
 *     les URL de téléversement et de téléchargement sont pré-signées et ne
 *     portent aucune clé ;
 *   - `Content-Type: application/json` **et** un corps JSON lisible sur les
 *     routes JSON ;
 *   - un titre et au moins un destinataire nommé, adressé et doté d'un rôle
 *     à la création ;
 *   - `Content-Type: application/pdf` **et des octets** au téléversement —
 *     une chaîne JSON y est refusée, c'est exactement le défaut du double
 *     Google ;
 *   - un document déjà téléversé avant l'envoi : Documenso refuse d'envoyer
 *     un document sans fichier, ce qui piège toute inversion de l'ordre ;
 *   - des destinataires existants à la relance ;
 *   - 404 sur toute route inconnue.
 *
 * **Aucun test n'appelle Documenso.** Seul le transport est un double ; le
 * vrai connecteur — ses URLs, ses en-têtes, sa traduction des statuts — est
 * exercé tel quel au-dessus.
 */
function faussApi(options: { statutDocument?: string; signingStatus?: string } = {}) {
  const appels: Appel[] = []
  const documents = new Map<
    string,
    { status: string; signingStatus: string; televerse: boolean }
  >()

  function refus(message: string, statut: number): Response {
    return new Response(message, { status: statut })
  }

  /** Rend le corps JSON, ou une réponse d'erreur si la requête n'est pas conforme. */
  function lireJson(init: {
    headers: Record<string, string>
    body?: string | Uint8Array
  }): { valeur: Record<string, unknown> } | { erreur: Response } {
    if (init.headers['Content-Type'] !== 'application/json') {
      return { erreur: refus('Content-Type application/json attendu.', 415) }
    }
    if (typeof init.body !== 'string') {
      return { erreur: refus('Corps JSON attendu.', 400) }
    }
    try {
      const valeur = JSON.parse(init.body) as unknown
      if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) {
        return { erreur: refus('Corps JSON attendu.', 400) }
      }
      return { valeur: valeur as Record<string, unknown> }
    } catch {
      return { erreur: refus('Corps JSON illisible.', 400) }
    }
  }

  const fetchFn: SignatureFetchLike = async (url, init) => {
    const reponse = await repondre(url, init)
    appels.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
      statut: reponse.status,
    })
    return reponse
  }

  async function repondre(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string | Uint8Array },
  ): Promise<Response> {
    // La clé d'API garde les routes de l'API, et elles seules : les URL
    // pré-signées de téléversement et de téléchargement n'en portent pas.
    if (url.startsWith(`${BASE}/api/`) && init.headers['Authorization'] !== CLE) {
      return refus('Clé d’API absente ou invalide.', 401)
    }

    if (url === `${BASE}/api/v1/documents` && init.method === 'POST') {
      const lu = lireJson(init)
      if ('erreur' in lu) return lu.erreur

      const titre = lu.valeur.title
      if (typeof titre !== 'string' || titre.trim() === '') {
        return refus('Titre du document manquant.', 400)
      }

      const destinataires = lu.valeur.recipients
      if (!Array.isArray(destinataires) || destinataires.length === 0) {
        return refus('Au moins un destinataire est requis.', 400)
      }
      for (const brut of destinataires) {
        const d = brut as Record<string, unknown>
        if (typeof d.email !== 'string' || !d.email.includes('@')) {
          return refus('Adresse électronique du destinataire invalide.', 400)
        }
        if (typeof d.name !== 'string' || d.name.trim() === '') {
          return refus('Nom du destinataire manquant.', 400)
        }
        if (d.role !== 'SIGNER') {
          return refus('Rôle du destinataire invalide.', 400)
        }
      }

      documents.set('42', {
        status: options.statutDocument ?? 'DRAFT',
        signingStatus: options.signingStatus ?? 'NOT_SIGNED',
        televerse: false,
      })
      return Response.json({ documentId: 42, uploadUrl: `${BASE}/upload/42` })
    }

    if (url === `${BASE}/upload/42` && init.method === 'PUT') {
      // Le pendant du défaut « JSON là où l'API exige un formulaire » : ici,
      // c'est du PDF binaire ou rien.
      if (init.headers['Content-Type'] !== 'application/pdf') {
        return refus('Content-Type application/pdf attendu.', 415)
      }
      if (!(init.body instanceof Uint8Array) || init.body.byteLength === 0) {
        return refus('Octets du document attendus.', 400)
      }
      const doc = documents.get('42')
      if (doc !== undefined) doc.televerse = true
      return new Response(null, { status: 200 })
    }

    if (url === `${BASE}/api/v1/documents/42/send` && init.method === 'POST') {
      const lu = lireJson(init)
      if ('erreur' in lu) return lu.erreur
      const doc = documents.get('42')
      // Documenso refuse d'envoyer un document sans fichier : transitionner
      // ou envoyer avant d'avoir téléversé se voit ici, pas en production.
      if (doc === undefined || !doc.televerse) {
        return refus('Le document n’a pas encore de fichier.', 400)
      }
      return Response.json({ ok: true })
    }

    if (url === `${BASE}/api/v1/documents/42` && init.method === 'GET') {
      const doc = documents.get('42') ?? {
        status: options.statutDocument ?? 'DRAFT',
        signingStatus: options.signingStatus ?? 'NOT_SIGNED',
        televerse: false,
      }
      return Response.json({
        id: 42,
        status: doc.status,
        recipients: [{ id: 7, email: 'claire@acme.test', signingStatus: doc.signingStatus }],
      })
    }

    if (url === `${BASE}/api/v1/documents/42/download` && init.method === 'GET') {
      return Response.json({ downloadUrl: `${BASE}/fichiers/42.pdf` })
    }

    if (url === `${BASE}/fichiers/42.pdf` && init.method === 'GET') {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53]), { status: 200 })
    }

    if (url === `${BASE}/api/v1/documents/42/resend` && init.method === 'POST') {
      const lu = lireJson(init)
      if ('erreur' in lu) return lu.erreur
      const destinataires = lu.valeur.recipients
      if (!Array.isArray(destinataires) || destinataires.length === 0) {
        return refus('Aucun destinataire à relancer.', 400)
      }
      if (destinataires.some((id) => id !== 7)) {
        return refus('Destinataire inconnu de ce document.', 400)
      }
      return Response.json({ ok: true })
    }

    return refus('non trouvé', 404)
  }

  return { appels, fetchFn, documents }
}

function connecteur(fetchFn: SignatureFetchLike) {
  return createDocumensoConnector({ fetchFn, baseUrl: BASE, apiKey: CLE })
}

describe('connecteur Documenso — aucun test ne touche le réseau', () => {
  it('ne fait aucun appel tant qu on ne lui demande rien', () => {
    const jamais: SignatureFetchLike = () => {
      throw new Error('Le réseau est interdit dans les tests.')
    }
    expect(() =>
      createDocumensoConnector({ fetchFn: jamais, baseUrl: BASE, apiKey: CLE }),
    ).not.toThrow()
  })

  it('s annonce sous le nom du prestataire', () => {
    expect(connecteur(faussApi().fetchFn).provider).toBe('documenso')
  })

  it('tolère une base terminée par une barre oblique', async () => {
    const api = faussApi({ statutDocument: 'COMPLETED', signingStatus: 'SIGNED' })
    const c = createDocumensoConnector({
      fetchFn: api.fetchFn,
      baseUrl: `${BASE}/`,
      apiKey: CLE,
    })
    expect(await c.status('42')).toBe('SIGNE')
    expect(api.appels[0]!.url).toBe(`${BASE}/api/v1/documents/42`)
  })
})

describe('le double refuse ce que Documenso refuserait', () => {
  it('refuse une clé d API absente', async () => {
    const api = faussApi()
    const sansCle = createDocumensoConnector({
      fetchFn: api.fetchFn,
      baseUrl: BASE,
      apiKey: '',
    })
    await expect(sansCle.status('42')).rejects.toBeInstanceOf(SignatureConnectorError)
    expect(api.appels[0]!.statut).toBe(401)
  })

  it('refuse une création sans destinataire, sans titre, ou de rôle inconnu', async () => {
    const api = faussApi()
    const creer = (corps: unknown) =>
      api.fetchFn(`${BASE}/api/v1/documents`, {
        method: 'POST',
        headers: { Authorization: CLE, 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      })

    expect((await creer({ title: 'x', recipients: [] })).status).toBe(400)
    expect((await creer({ recipients: [{ name: 'C', email: 'c@acme.test', role: 'SIGNER' }] })).status).toBe(400)
    expect((await creer({ title: 'x', recipients: [{ name: 'C', email: 'pas-une-adresse', role: 'SIGNER' }] })).status).toBe(400)
    expect((await creer({ title: 'x', recipients: [{ name: '', email: 'c@acme.test', role: 'SIGNER' }] })).status).toBe(400)
    expect((await creer({ title: 'x', recipients: [{ name: 'C', email: 'c@acme.test', role: 'VIEWER' }] })).status).toBe(400)
  })

  it('refuse un téléversement en JSON là où l API exige des octets de PDF', async () => {
    // Le défaut exact qui a laissé le double Google au vert : le double doit
    // distinguer un corps JSON d'un corps binaire, sinon il valide un
    // connecteur qui ne marcherait pas.
    const api = faussApi()
    await api.fetchFn(`${BASE}/api/v1/documents`, {
      method: 'POST',
      headers: { Authorization: CLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 't',
        recipients: [{ name: 'C', email: 'c@acme.test', role: 'SIGNER' }],
      }),
    })

    const enJson = await api.fetchFn(`${BASE}/upload/42`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdf: 'JVBERi0=' }),
    })
    expect(enJson.status).toBe(415)

    const vide = await api.fetchFn(`${BASE}/upload/42`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array([]),
    })
    expect(vide.status).toBe(400)
  })

  it('refuse d envoyer un document dont le fichier n a pas été téléversé', async () => {
    const api = faussApi()
    await api.fetchFn(`${BASE}/api/v1/documents`, {
      method: 'POST',
      headers: { Authorization: CLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 't',
        recipients: [{ name: 'C', email: 'c@acme.test', role: 'SIGNER' }],
      }),
    })

    const envoi = await api.fetchFn(`${BASE}/api/v1/documents/42/send`, {
      method: 'POST',
      headers: { Authorization: CLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendEmail: true }),
    })
    expect(envoi.status).toBe(400)
  })

  it('refuse une relance sans destinataire connu', async () => {
    const api = faussApi()
    const relance = (corps: unknown) =>
      api.fetchFn(`${BASE}/api/v1/documents/42/resend`, {
        method: 'POST',
        headers: { Authorization: CLE, 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      })
    expect((await relance({ recipients: [] })).status).toBe(400)
    expect((await relance({ recipients: [999] })).status).toBe(400)
  })

  it('refuse une route inconnue', async () => {
    const api = faussApi()
    const r = await api.fetchFn(`${BASE}/api/v1/documents/42/inconnu`, {
      method: 'POST',
      headers: { Authorization: CLE, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(r.status).toBe(404)
  })

  it('GARDE-FOU INVERSE : la charge utile réelle du connecteur passe partout', async () => {
    // Le pendant obligatoire d'un double sévère. Un double qui refuserait
    // aussi la vraie charge utile serait tout aussi faux qu'un double
    // complaisant : ici, le connecteur parcourt les cinq routes et **aucune**
    // ne rend un code d'erreur.
    const api = faussApi({ statutDocument: 'COMPLETED', signingStatus: 'SIGNED' })
    const c = connecteur(api.fetchFn)

    await c.send({
      titre: 'CRA ACME — juin 2026',
      fileName: 'CRA-ACME-2026-06.pdf',
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      destinataire: { nom: 'Claire Martin', email: 'claire@acme.test' },
      champs: [
        {
          nature: 'SIGNATURE' as const,
          ancre: '[[cra:signature]]',
          page: 1,
          x: 600,
          y: 120,
          largeur: 148,
          hauteur: 34,
          pageLargeur: 842,
          pageHauteur: 595,
        },
      ],
    })
    await c.status('42')
    await c.download('42')
    await c.remind('42')

    expect(api.appels.length).toBeGreaterThan(0)
    expect(api.appels.filter((a) => a.statut >= 400)).toEqual([])
  })
})

describe('send', () => {
  it('place les champs de signature, sans quoi Documenso reçoit un PDF muet', async () => {
    // Le pavé « Bon pour accord » n'est qu'un dessin : sans champ, il faut les
    // poser à la main dans l'interface, sur chaque CRA, tous les mois.
    const api = faussApi()
    await connecteur(api.fetchFn).send({
      titre: 'CRA ACME — juin 2026',
      fileName: 'CRA-ACME-2026-06.pdf',
      pdf: new Uint8Array([0x25]),
      destinataire: { nom: 'Claire Martin', email: 'claire@acme.test' },
      champs: [
        {
          nature: 'SIGNATURE' as const,
          ancre: '[[cra:signature]]',
          page: 1,
          x: 600,
          y: 120,
          largeur: 148,
          hauteur: 34,
          pageLargeur: 842,
          pageHauteur: 595,
        },
        {
          nature: 'DATE' as const,
          ancre: '[[cra:date]]',
          page: 1,
          x: 521,
          y: 138,
          largeur: 70,
          hauteur: 16,
          pageLargeur: 842,
          pageHauteur: 595,
        },
      ],
    })

    const creation = api.appels.find((a) => a.url.endsWith('/api/v1/documents'))
    const corps = JSON.parse(String(creation?.body ?? '{}')) as {
      recipients: Array<{ fields?: Array<{ formType: string; pageY: number }> }>
    }
    const champs = corps.recipients[0]?.fields ?? []
    expect(champs.map((c) => c.formType)).toEqual(['SIGNATURE', 'DATE'])
    // Et les coordonnées sont retournées : Documenso compte depuis le haut.
    expect(champs[0]!.pageY).toBeCloseTo(((595 - 154) / 595) * 100, 1)
  })

  it('crée le document, téléverse le PDF, puis l envoie — dans cet ordre', async () => {
    const api = faussApi()
    const externalId = await connecteur(api.fetchFn).send({
      titre: 'CRA ACME — juin 2026',
      fileName: 'CRA-ACME-2026-06.pdf',
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      destinataire: { nom: 'Claire Martin', email: 'claire@acme.test' },
      champs: [
        {
          nature: 'SIGNATURE' as const,
          ancre: '[[cra:signature]]',
          page: 1,
          x: 600,
          y: 120,
          largeur: 148,
          hauteur: 34,
          pageLargeur: 842,
          pageHauteur: 595,
        },
      ],
    })

    expect(externalId).toBe('42')
    expect(api.appels.map((a) => `${a.method} ${a.url}`)).toEqual([
      `POST ${BASE}/api/v1/documents`,
      `PUT ${BASE}/upload/42`,
      `POST ${BASE}/api/v1/documents/42/send`,
    ])
  })

  it('porte la clé d API et le destinataire', async () => {
    const api = faussApi()
    await connecteur(api.fetchFn).send({
      titre: 'CRA ACME — juin 2026',
      fileName: 'CRA-ACME-2026-06.pdf',
      pdf: new Uint8Array([0x25]),
      destinataire: { nom: 'Claire Martin', email: 'claire@acme.test' },
      champs: [
        {
          nature: 'SIGNATURE' as const,
          ancre: '[[cra:signature]]',
          page: 1,
          x: 600,
          y: 120,
          largeur: 148,
          hauteur: 34,
          pageLargeur: 842,
          pageHauteur: 595,
        },
      ],
    })

    expect(api.appels[0]!.headers['Authorization']).toBe(CLE)
    expect(String(api.appels[0]!.body)).toContain('claire@acme.test')
    expect(String(api.appels[0]!.body)).toContain('CRA ACME')
    expect(api.appels[1]!.headers['Content-Type']).toBe('application/pdf')
  })

  it('téléverse les octets du PDF, pas une transcription', async () => {
    const api = faussApi()
    await connecteur(api.fetchFn).send({
      titre: 't',
      fileName: 'f.pdf',
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      destinataire: { nom: 'C', email: 'c@acme.test' },
      champs: [
        {
          nature: 'SIGNATURE' as const,
          ancre: '[[cra:signature]]',
          page: 1,
          x: 600,
          y: 120,
          largeur: 148,
          hauteur: 34,
          pageLargeur: 842,
          pageHauteur: 595,
        },
      ],
    })
    expect(Array.from(api.appels[1]!.body as Uint8Array)).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d])
  })

  it('lève une erreur typée quand le prestataire refuse', async () => {
    const refus: SignatureFetchLike = async () => new Response('clé invalide', { status: 401 })
    await expect(
      connecteur(refus).send({
        titre: 't',
        fileName: 'f.pdf',
        pdf: new Uint8Array([1]),
        destinataire: { nom: 'C', email: 'c@acme.test' },
        champs: [
          {
            nature: 'SIGNATURE' as const,
            ancre: '[[cra:signature]]',
            page: 1,
            x: 600,
            y: 120,
            largeur: 148,
            hauteur: 34,
            pageLargeur: 842,
            pageHauteur: 595,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(SignatureConnectorError)
  })

  it('porte le code HTTP dans l erreur, pour que l appelant sache s il peut réessayer', async () => {
    const refus: SignatureFetchLike = async () => new Response('indisponible', { status: 503 })
    await expect(
      connecteur(refus).send({
        titre: 't',
        fileName: 'f.pdf',
        pdf: new Uint8Array([1]),
        destinataire: { nom: 'C', email: 'c@acme.test' },
        champs: [
          {
            nature: 'SIGNATURE' as const,
            ancre: '[[cra:signature]]',
            page: 1,
            x: 600,
            y: 120,
            largeur: 148,
            hauteur: 34,
            pageLargeur: 842,
            pageHauteur: 595,
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('status', () => {
  it('traduit un document achevé en SIGNE', async () => {
    const api = faussApi({ statutDocument: 'COMPLETED', signingStatus: 'SIGNED' })
    expect(await connecteur(api.fetchFn).status('42')).toBe('SIGNE')
  })

  it('traduit un refus du destinataire en REFUSE', async () => {
    const api = faussApi({ statutDocument: 'PENDING', signingStatus: 'REJECTED' })
    expect(await connecteur(api.fetchFn).status('42')).toBe('REFUSE')
  })

  it('traduit une expiration en EXPIRE', async () => {
    const api = faussApi({ statutDocument: 'EXPIRED', signingStatus: 'NOT_SIGNED' })
    expect(await connecteur(api.fetchFn).status('42')).toBe('EXPIRE')
  })

  it('traduit tout le reste en EN_ATTENTE plutôt que d inventer une issue', async () => {
    const api = faussApi({ statutDocument: 'PENDING', signingStatus: 'NOT_SIGNED' })
    expect(await connecteur(api.fetchFn).status('42')).toBe('EN_ATTENTE')

    const inconnu = faussApi({ statutDocument: 'QUELQUE_CHOSE_DE_NOUVEAU' })
    expect(await connecteur(inconnu.fetchFn).status('42')).toBe('EN_ATTENTE')
  })
})

describe('download', () => {
  it('suit le lien de téléchargement et rend les octets', async () => {
    const api = faussApi({ statutDocument: 'COMPLETED', signingStatus: 'SIGNED' })
    const octets = await connecteur(api.fetchFn).download('42')
    expect(Array.from(octets)).toEqual([0x25, 0x50, 0x44, 0x46, 0x53])
  })
})

describe('remind', () => {
  it('relance les destinataires du document', async () => {
    const api = faussApi({ statutDocument: 'PENDING' })
    await connecteur(api.fetchFn).remind('42')
    const resend = api.appels.find((a) => a.url.endsWith('/resend'))
    expect(resend).toBeDefined()
    expect(String(resend!.body)).toContain('7')
  })
})

describe('parseDocumensoWebhook', () => {
  it('reconnaît une signature achevée', () => {
    const charge = JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42 } })
    expect(parseDocumensoWebhook(charge)).toEqual({
      externalId: '42',
      statut: 'SIGNE',
      eventId: 'DOCUMENT_COMPLETED:42',
    })
  })

  it('reconnaît un refus et une expiration', () => {
    expect(
      parseDocumensoWebhook(JSON.stringify({ event: 'DOCUMENT_REJECTED', payload: { id: 7 } }))!
        .statut,
    ).toBe('REFUSE')
    expect(
      parseDocumensoWebhook(JSON.stringify({ event: 'DOCUMENT_CANCELLED', payload: { id: 7 } }))!
        .statut,
    ).toBe('EXPIRE')
  })

  it('construit une clé d idempotence indépendante du prestataire', () => {
    // Deux livraisons du même événement pour le même document portent la même
    // clé, quoi qu en dise l identifiant de livraison de Documenso.
    const a = parseDocumensoWebhook(
      JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42 }, webhookEventId: 'x' }),
    )
    const b = parseDocumensoWebhook(
      JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42 }, webhookEventId: 'y' }),
    )
    expect(a!.eventId).toBe(b!.eventId)
  })

  it('distingue deux documents et deux événements', () => {
    const cle = (event: string, id: number) =>
      parseDocumensoWebhook(JSON.stringify({ event, payload: { id } }))!.eventId
    expect(cle('DOCUMENT_COMPLETED', 42)).not.toBe(cle('DOCUMENT_COMPLETED', 43))
    expect(cle('DOCUMENT_COMPLETED', 42)).not.toBe(cle('DOCUMENT_REJECTED', 42))
  })

  it('rend null sur une charge illisible ou sans intérêt', () => {
    expect(parseDocumensoWebhook('pas du json')).toBeNull()
    expect(parseDocumensoWebhook('{}')).toBeNull()
    expect(parseDocumensoWebhook(JSON.stringify({ event: 'DOCUMENT_OPENED', payload: { id: 1 } }))).toBeNull()
    expect(parseDocumensoWebhook(JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: {} }))).toBeNull()
  })

  it('rend null sur un JSON qui n est pas un objet', () => {
    expect(parseDocumensoWebhook('null')).toBeNull()
    expect(parseDocumensoWebhook('[]')).toBeNull()
    expect(parseDocumensoWebhook('"DOCUMENT_COMPLETED"')).toBeNull()
  })
})
