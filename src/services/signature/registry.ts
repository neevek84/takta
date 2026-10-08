import type { SignatureConnector, SignatureFetchLike } from '@/core/signature/connector'
import { createDocumensoConnector } from './documenso'
import { lireConfigurationDocumenso } from './reglages'

/**
 * Le connecteur configuré, ou `null`.
 *
 * `null` n'est pas une panne : c'est le mode nominal d'une instance sans outil
 * de signature. Le PDF se génère et se télécharge, les transitions du CRA
 * restent manuelles comme au lot 0. Tout appelant doit traiter ce cas.
 *
 * La configuration est celle d'Administration · Signature, sinon
 * `DOCUMENSO_URL` / `DOCUMENSO_API_KEY` — un repli pour les instances réglées
 * avant l'écran. Voir `lireConfigurationDocumenso`.
 */
export async function getSignatureConnector(
  deps: { fetchFn?: SignatureFetchLike } = {},
): Promise<SignatureConnector | null> {
  const { provenance, baseUrl, apiKey } = await lireConfigurationDocumenso()
  if (provenance === 'aucune') return null

  return createDocumensoConnector({
    // Un délai, toujours : un prestataire qui ne répond pas ne doit pas
    // suspendre l'envoi, le webhook ou la page client jusqu'à la coupure du
    // proxy — l'appel échoue et l'appelant dit ce qu'il sait dire.
    fetchFn:
      deps.fetchFn ??
      ((url, init) => fetch(url, { ...(init as RequestInit), signal: AbortSignal.timeout(30_000) })),
    baseUrl,
    apiKey,
  })
}
