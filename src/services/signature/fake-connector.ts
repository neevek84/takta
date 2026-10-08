import type {
  SignatureConnector,
  SignatureEnvoi,
  SignatureStatus,
} from '@/core/signature/connector'
import { SignatureConnectorError } from '@/core/signature/connector'

export interface FakeSignatureConnector extends SignatureConnector {
  readonly envois: SignatureEnvoi[]
  readonly annulations: string[]
  readonly renouvellements: string[]
  readonly telechargements: string[]
  /** références dont l'état a été demandé, dans l'ordre */
  readonly interrogations: string[]
  /** force l'état que `status()` rendra pour cette référence */
  regler(externalId: string, statut: SignatureStatus, motifRefus?: string): void
  poserPdfSigne(externalId: string, pdf: Uint8Array): void
  faireEchouerEnvoi(message: string): void
  faireEchouerTelechargement(message: string): void
  faireEchouerAnnulation(message: string): void
  faireEchouerStatut(message: string): void
}

/**
 * Le double du connecteur, partagé par les suites de services.
 *
 * Il double le **connecteur**, pas l'API : la sévérité de la frontière
 * Documenso est exercée par le double d'API de `documenso.test.ts`. Ici, ce
 * qui compte c'est le contrat : un envoi refusé lève, un statut inconnu vaut
 * `EN_ATTENTE`, un téléchargement ou une annulation peuvent échouer.
 */
export function createFakeSignatureConnector(): FakeSignatureConnector {
  const envois: SignatureEnvoi[] = []
  const annulations: string[] = []
  const renouvellements: string[] = []
  const telechargements: string[] = []
  const interrogations: string[] = []
  const etats = new Map<string, { statut: SignatureStatus; motifRefus: string | null }>()
  const signes = new Map<string, Uint8Array>()
  let echecEnvoi: string | null = null
  let echecTelechargement: string | null = null
  let echecAnnulation: string | null = null
  let echecStatut: string | null = null
  let compteur = 0

  return {
    provider: 'double',
    envois,
    annulations,
    renouvellements,
    telechargements,
    interrogations,

    regler(externalId, statut, motifRefus) {
      etats.set(externalId, { statut, motifRefus: motifRefus ?? null })
    },
    poserPdfSigne(externalId, pdf) {
      signes.set(externalId, pdf)
    },
    faireEchouerEnvoi(message) {
      echecEnvoi = message
    },
    faireEchouerTelechargement(message) {
      echecTelechargement = message
    },
    faireEchouerAnnulation(message) {
      echecAnnulation = message
    },
    faireEchouerStatut(message) {
      echecStatut = message
    },

    async send(envoi) {
      if (echecEnvoi !== null) throw new SignatureConnectorError(echecEnvoi, 502)
      if (envoi.titre.trim() === '') throw new SignatureConnectorError('Titre du document manquant.', 400)
      if (!envoi.destinataire.email.includes('@') || envoi.destinataire.nom.trim() === '') {
        throw new SignatureConnectorError('Destinataire invalide.', 400)
      }
      if (envoi.pdf.byteLength === 0) throw new SignatureConnectorError('Document vide.', 400)
      if (envoi.reference === '') throw new SignatureConnectorError('Référence manquante.', 400)

      envois.push(envoi)
      compteur += 1
      const externalId = `ext-${compteur}`
      etats.set(externalId, { statut: 'EN_ATTENTE', motifRefus: null })
      return { externalId, jetonSignataire: `jeton-${compteur}` }
    },

    async status(externalId) {
      if (echecStatut !== null) throw new SignatureConnectorError(echecStatut, 503)
      interrogations.push(externalId)
      return etats.get(externalId) ?? { statut: 'EN_ATTENTE', motifRefus: null }
    },

    async download(externalId) {
      if (echecTelechargement !== null) throw new SignatureConnectorError(echecTelechargement, 503)
      telechargements.push(externalId)
      return signes.get(externalId) ?? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53])
    },

    async renouveler(externalId) {
      renouvellements.push(externalId)
      return `jeton-renouvele-${renouvellements.length}`
    },

    async annuler(externalId) {
      if (echecAnnulation !== null) throw new SignatureConnectorError(echecAnnulation, 503)
      annulations.push(externalId)
    },

    urlEmbarquee(jeton) {
      return `https://signature.double/embed/sign/${jeton}`
    },
  }
}
