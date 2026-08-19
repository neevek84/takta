import {
  SignatureConnectorError,
  type SignatureConnector,
  type SignatureEnvoi,
  type SignatureFetchLike,
  type SignatureStatus,
} from '@/core/signature/connector'
import { versDocumensoField } from '@/core/signature/documenso-champs'
import { PROVIDER_DOCUMENSO } from './constants'

/**
 * Première implémentation de `SignatureConnector`.
 *
 * Tout ce qui est propre à Documenso — URLs, en-têtes, vocabulaire de statuts,
 * forme des webhooks — est enfermé dans ce fichier. Changer de prestataire,
 * c'est écrire un fichier voisin, pas toucher au reste du lot.
 */
export function createDocumensoConnector(args: {
  fetchFn: SignatureFetchLike
  baseUrl: string
  apiKey: string
}): SignatureConnector {
  const racine = args.baseUrl.replace(/\/+$/, '')

  const enTetes = (): Record<string, string> => ({
    Authorization: args.apiKey,
    'Content-Type': 'application/json',
  })

  async function appeler(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string | Uint8Array },
  ): Promise<Response> {
    const reponse = await args.fetchFn(url, init)
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

  async function lireDocument(externalId: string): Promise<{
    status: string
    recipients: Array<{ id: number; signingStatus: string }>
  }> {
    const reponse = await appeler(`${racine}/api/v1/documents/${externalId}`, {
      method: 'GET',
      headers: enTetes(),
    })
    return (await reponse.json()) as {
      status: string
      recipients: Array<{ id: number; signingStatus: string }>
    }
  }

  return {
    provider: PROVIDER_DOCUMENSO,

    async send(envoi: SignatureEnvoi): Promise<string> {
      const creation = await appeler(`${racine}/api/v1/documents`, {
        method: 'POST',
        headers: enTetes(),
        body: JSON.stringify({
          title: envoi.titre,
          fileName: envoi.fileName,
          recipients: [
            {
              name: envoi.destinataire.nom,
              email: envoi.destinataire.email,
              role: 'SIGNER',
              signingOrder: 1,
              // Sans champs, Documenso reçoit un PDF muet : le pavé « Bon pour
              // accord » n'est qu'un dessin, et il faut les poser à la main
              // dans son interface, sur chaque CRA, tous les mois. La
              // conversion points → pourcentages vit dans `core/signature`,
              // où elle est prouvée.
              fields: envoi.champs.map(versDocumensoField),
            },
          ],
        }),
      })

      const { documentId, uploadUrl } = (await creation.json()) as {
        documentId: number | string
        uploadUrl: string
      }

      // Les octets tels quels, et le type qui va avec : l'URL est pré-signée,
      // elle ne porte pas la clé d'API.
      await appeler(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: envoi.pdf,
      })

      await appeler(`${racine}/api/v1/documents/${documentId}/send`, {
        method: 'POST',
        headers: enTetes(),
        body: JSON.stringify({ sendEmail: true }),
      })

      return String(documentId)
    },

    async status(externalId: string): Promise<SignatureStatus> {
      const document = await lireDocument(externalId)
      return traduireStatut(
        document.status,
        (document.recipients ?? []).map((r) => r.signingStatus),
      )
    },

    async download(externalId: string): Promise<Uint8Array> {
      const lien = await appeler(`${racine}/api/v1/documents/${externalId}/download`, {
        method: 'GET',
        headers: enTetes(),
      })
      const { downloadUrl } = (await lien.json()) as { downloadUrl: string }

      const fichier = await appeler(downloadUrl, { method: 'GET', headers: {} })
      return new Uint8Array(await fichier.arrayBuffer())
    },

    async remind(externalId: string): Promise<void> {
      const document = await lireDocument(externalId)
      await appeler(`${racine}/api/v1/documents/${externalId}/resend`, {
        method: 'POST',
        headers: enTetes(),
        body: JSON.stringify({ recipients: (document.recipients ?? []).map((r) => r.id) }),
      })
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

const EVENEMENTS: Record<string, SignatureStatus> = {
  DOCUMENT_COMPLETED: 'SIGNE',
  DOCUMENT_SIGNED: 'SIGNE',
  DOCUMENT_REJECTED: 'REFUSE',
  DOCUMENT_CANCELLED: 'EXPIRE',
  DOCUMENT_EXPIRED: 'EXPIRE',
}

/**
 * Lecture d'une charge utile de webhook Documenso.
 *
 * La clé d'idempotence est délibérément **plus grossière** que l'identifiant
 * de livraison du prestataire : `{événement}:{document}`. Deux livraisons du
 * même événement pour le même document sont un rejeu, quel que soit ce que le
 * prestataire raconte de sa propre livraison. Un renvoi après refus crée un
 * nouveau document chez Documenso, donc une nouvelle clé.
 */
export function parseDocumensoWebhook(
  rawBody: string,
): { externalId: string; statut: SignatureStatus; eventId: string } | null {
  let charge: unknown
  try {
    charge = JSON.parse(rawBody)
  } catch {
    return null
  }

  if (typeof charge !== 'object' || charge === null || Array.isArray(charge)) return null
  const { event, payload } = charge as { event?: unknown; payload?: { id?: unknown } }

  if (typeof event !== 'string') return null
  const statut = EVENEMENTS[event]
  if (statut === undefined) return null

  const id = payload?.id
  if (typeof id !== 'string' && typeof id !== 'number') return null

  const externalId = String(id)
  return { externalId, statut, eventId: `${event}:${externalId}` }
}
