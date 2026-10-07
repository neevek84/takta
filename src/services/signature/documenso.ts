import {
  SignatureConnectorError,
  type SignatureConnector,
  type SignatureContact,
  type SignatureEnvoi,
  type SignatureEtat,
  type SignatureFetchLike,
  type SignatureStatus,
} from '@/core/signature/connector'
import { versDocumensoField } from '@/core/signature/documenso-champs'
import { PROVIDER_DOCUMENSO } from './constants'

/**
 * Implémentation de `SignatureConnector` sur l'**API v2** de Documenso
 * (« enveloppes », Documenso ≥ 2.0.0).
 *
 * Tout ce qui est propre à Documenso — URLs, en-têtes, vocabulaire de statuts,
 * forme des webhooks — est enfermé dans ce fichier.
 *
 * **Le prestataire n'écrit plus au client** (`distributionMethod: NONE`) :
 * c'est l'outil qui envoie le lien, et le client signe dans un cadre embarqué.
 *
 * Les envois antérieurs portent un identifiant **numérique** (API v1). Ils
 * sont résolus vers leur enveloppe par la route `document/{id}` — dépréciée
 * mais présente — puis servis comme les autres.
 */
export function createDocumensoConnector(args: {
  fetchFn: SignatureFetchLike
  baseUrl: string
  apiKey: string
}): SignatureConnector {
  const racine = args.baseUrl.replace(/\/+$/, '')
  const api = `${racine}/api/v2`

  async function appeler(
    url: string,
    init: { method: string; body?: string | FormData },
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: args.apiKey }
    // Pas de `Content-Type` sur un multipart : `fetch` le pose lui-même, avec
    // la frontière. L'imposer ici produirait un corps illisible.
    if (typeof init.body === 'string') headers['Content-Type'] = 'application/json'

    const reponse = await args.fetchFn(url, { method: init.method, headers, body: init.body })
    if (!reponse.ok) {
      // Le message ne reprend **rien** du corps de la réponse : un prestataire
      // qui renvoie la requête refusée y ferait remonter la clé d'API, et ce
      // message finit dans un journal.
      throw new SignatureConnectorError(
        `Le prestataire de signature a refusé la requête (${reponse.status}).`,
        reponse.status,
      )
    }
    return reponse
  }

  const poster = (chemin: string, corps: unknown) =>
    appeler(`${api}${chemin}`, { method: 'POST', body: JSON.stringify(corps) })

  /** Un identifiant v1 (numérique) devient l'identifiant de son enveloppe. */
  async function enveloppe(externalId: string): Promise<string> {
    if (!/^\d+$/.test(externalId)) return externalId
    const r = await appeler(`${api}/document/${externalId}`, { method: 'GET' })
    const { envelopeId } = (await r.json()) as { envelopeId?: string }
    if (typeof envelopeId !== 'string' || envelopeId === '') {
      throw new SignatureConnectorError('Document hérité sans enveloppe.', 0)
    }
    return envelopeId
  }

  interface EnveloppeLue {
    status: string
    recipients: Array<{ id: number; token: string; signingStatus: string; rejectionReason: string | null }>
    envelopeItems: Array<{ id: string }>
  }

  async function lire(externalId: string): Promise<EnveloppeLue> {
    const id = await enveloppe(externalId)
    const r = await appeler(`${api}/envelope/${encodeURIComponent(id)}`, { method: 'GET' })
    const e = (await r.json()) as Partial<EnveloppeLue>
    return { status: e.status ?? '', recipients: e.recipients ?? [], envelopeItems: e.envelopeItems ?? [] }
  }

  return {
    provider: PROVIDER_DOCUMENSO,

    async send(envoi: SignatureEnvoi) {
      const formulaire = new FormData()
      formulaire.append(
        'payload',
        JSON.stringify({
          title: envoi.titre,
          type: 'DOCUMENT',
          externalId: envoi.reference,
          recipients: [
            {
              name: envoi.destinataire.nom,
              email: envoi.destinataire.email,
              role: 'SIGNER',
              signingOrder: 1,
              // Sans champs, Documenso reçoit un PDF muet. La conversion
              // points → pourcentages vit dans `core/signature`, où elle est prouvée.
              fields: envoi.champs.map(versDocumensoField),
            },
          ],
          meta: { language: 'fr' },
        }),
      )
      formulaire.append(
        'files',
        new Blob([envoi.pdf], { type: 'application/pdf' }),
        envoi.fileName,
      )

      const creation = await appeler(`${api}/envelope/create`, { method: 'POST', body: formulaire })
      const { id } = (await creation.json()) as { id: string }

      const distribution = await poster('/envelope/distribute', {
        envelopeId: id,
        meta: { distributionMethod: 'NONE' },
      })
      const { recipients } = (await distribution.json()) as { recipients?: Array<{ token: string }> }
      const jeton = recipients?.[0]?.token ?? ''
      if (jeton === '') throw new SignatureConnectorError('Aucun jeton de signature rendu.', 0)

      return { externalId: id, jetonSignataire: jeton }
    },

    async status(externalId: string): Promise<SignatureEtat> {
      const e = await lire(externalId)
      const refus = e.recipients.find((r) => r.signingStatus === 'REJECTED')
      return {
        statut: traduireStatut(e.status, e.recipients.map((r) => r.signingStatus)),
        motifRefus: refus?.rejectionReason ?? null,
      }
    },

    async download(externalId: string): Promise<Uint8Array> {
      const e = await lire(externalId)
      const item = e.envelopeItems[0]
      if (item === undefined) throw new SignatureConnectorError('Enveloppe sans document.', 0)
      const r = await appeler(
        `${api}/envelope/item/${encodeURIComponent(item.id)}/download?version=signed`,
        { method: 'GET' },
      )
      return new Uint8Array(await r.arrayBuffer())
    },

    async renouveler(externalId: string): Promise<string> {
      const id = await enveloppe(externalId)
      const e = await lire(id)
      const r = await poster('/envelope/redistribute', {
        envelopeId: id,
        recipients: e.recipients.map((x) => x.id),
      })
      const { recipients } = (await r.json()) as { recipients?: Array<{ token: string }> }
      return recipients?.[0]?.token ?? ''
    },

    async annuler(externalId: string): Promise<void> {
      await poster('/envelope/cancel', { envelopeId: await enveloppe(externalId) })
    },

    urlEmbarquee(jetonSignataire: string, signataire: SignatureContact): string {
      // Le format du composant officiel `@documenso/embed-react` : options en
      // JSON, encodées URI puis base64, dans le fragment — qui ne part jamais
      // au serveur.
      const options = Buffer.from(
        encodeURIComponent(
          JSON.stringify({
            name: signataire.nom,
            lockName: true,
            email: signataire.email,
            lockEmail: true,
            allowDocumentRejection: true,
            language: 'fr',
            darkModeDisabled: true,
          }),
        ),
        'utf8',
      ).toString('base64')
      return `${racine}/embed/sign/${encodeURIComponent(jetonSignataire)}#${options}`
    },
  }
}

/**
 * Un statut inconnu devient `EN_ATTENTE`, jamais une issue inventée : croire
 * qu'un document est signé sur la foi d'un mot qu'on ne comprend pas
 * verrouillerait un mois à tort.
 */
function traduireStatut(statutDocument: string, statutsSignataires: string[]): SignatureStatus {
  if (statutsSignataires.includes('REJECTED')) return 'REFUSE'
  if (statutDocument === 'REJECTED') return 'REFUSE'
  if (statutDocument === 'COMPLETED') return 'SIGNE'
  if (statutDocument === 'EXPIRED' || statutDocument === 'CANCELLED') return 'EXPIRE'
  return 'EN_ATTENTE'
}

const EVENEMENTS = new Set([
  'DOCUMENT_COMPLETED',
  'DOCUMENT_SIGNED',
  'DOCUMENT_REJECTED',
  'DOCUMENT_CANCELLED',
  'DOCUMENT_EXPIRED',
])

/**
 * Lecture d'une charge utile de webhook Documenso.
 *
 * **La charge n'est plus crue** : elle désigne une enveloppe, et le service
 * relit son état chez le prestataire. On n'en tire donc que l'identifiant —
 * l'enveloppe d'abord, l'identifiant numérique ensuite pour un envoi antérieur
 * au lot 3b — et une clé d'idempotence `{événement}:{enveloppe}`.
 */
export function parseDocumensoWebhook(
  rawBody: string,
): { candidats: string[]; eventId: string } | null {
  let charge: unknown
  try {
    charge = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (typeof charge !== 'object' || charge === null || Array.isArray(charge)) return null

  const { event, payload } = charge as {
    event?: unknown
    payload?: { id?: unknown; envelopeId?: unknown }
  }
  if (typeof event !== 'string' || !EVENEMENTS.has(event)) return null

  const candidats: string[] = []
  if (typeof payload?.envelopeId === 'string' && payload.envelopeId !== '') {
    candidats.push(payload.envelopeId)
  }
  if (typeof payload?.id === 'number' || typeof payload?.id === 'string') {
    candidats.push(String(payload.id))
  }
  if (candidats.length === 0) return null

  return { candidats, eventId: `${event}:${candidats[0]}` }
}
