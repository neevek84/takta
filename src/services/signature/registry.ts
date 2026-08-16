import type { SignatureConnector } from '@/core/signature/connector'
import { createDocumensoConnector } from './documenso'

/**
 * Le connecteur configuré, ou `null`.
 *
 * `null` n'est pas une panne : c'est le mode nominal d'une instance sans outil
 * de signature. Le PDF se génère et se télécharge, les transitions du CRA
 * restent manuelles comme au lot 0. Tout appelant doit traiter ce cas.
 */
export async function getSignatureConnector(): Promise<SignatureConnector | null> {
  const baseUrl = process.env.DOCUMENSO_URL ?? ''
  const apiKey = process.env.DOCUMENSO_API_KEY ?? ''
  if (baseUrl === '' || apiKey === '') return null

  return createDocumensoConnector({
    fetchFn: (url, init) => fetch(url, init as RequestInit),
    baseUrl,
    apiKey,
  })
}
