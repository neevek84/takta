/**
 * Le point d'extension déclaré dès le lot 0. **C'est lui le livrable du lot
 * 3**, pas Documenso : le cœur ne doit jamais savoir quel prestataire de
 * signature est branché, ni même s'il y en a un.
 *
 * Module pur : aucune dépendance à Prisma, à Next ni au réseau.
 */

export type SignatureStatus = 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE'

export const SIGNATURE_STATUSES: readonly SignatureStatus[] = [
  'EN_ATTENTE',
  'SIGNE',
  'REFUSE',
  'EXPIRE',
]

export function estStatutDeSignature(valeur: string): valeur is SignatureStatus {
  return (SIGNATURE_STATUSES as readonly string[]).includes(valeur)
}

export interface SignatureContact {
  nom: string
  email: string
}

export interface SignatureEnvoi {
  titre: string
  fileName: string
  pdf: Uint8Array
  destinataire: SignatureContact
}

export interface SignatureConnector {
  /** identifiant du prestataire, tel qu'il sera écrit dans `ExternalLink.provider` */
  readonly provider: string
  /** confie le document et rend la référence externe */
  send(envoi: SignatureEnvoi): Promise<string>
  /** l'état courant, interrogé à la demande — c'est le rattrapage d'un webhook perdu */
  status(externalId: string): Promise<SignatureStatus>
  /** le document signé, à archiver tel quel */
  download(externalId: string): Promise<Uint8Array>
  /** relance le destinataire */
  remind(externalId: string): Promise<void>
}

/**
 * Le transport, toujours injecté. C'est ce qui permet de tester le vrai
 * connecteur — ses URLs, ses en-têtes, sa traduction des statuts — sans
 * qu'aucun test ne touche le réseau.
 *
 * Nommé `SignatureFetchLike` et non `FetchLike` : `@/integrations/google/calendar`
 * exporte déjà un `FetchLike` au corps strictement JSON. Les deux signatures
 * diffèrent (le téléversement d'un PDF passe des octets), et deux types
 * homonymes importés côte à côte dans un même service auraient obligé à
 * renommer à l'import, là où la collision se lit mal.
 */
export type SignatureFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | Uint8Array },
) => Promise<Response>

export class SignatureConnectorError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 0) {
    super(message)
    this.name = 'SignatureConnectorError'
    this.statusCode = statusCode
  }
}
