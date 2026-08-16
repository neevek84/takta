import type {
  SignatureConnector,
  SignatureEnvoi,
  SignatureStatus,
} from '@/core/signature/connector'
import { SignatureConnectorError } from '@/core/signature/connector'

export interface FakeSignatureConnector extends SignatureConnector {
  readonly envois: SignatureEnvoi[]
  readonly relances: string[]
  readonly telechargements: string[]
  /** force l'état que `status()` rendra pour cette référence */
  regler(externalId: string, statut: SignatureStatus): void
  /** pose le document signé que `download()` rendra */
  poserPdfSigne(externalId: string, pdf: Uint8Array): void
  /** fait échouer le prochain `send()` */
  faireEchouerEnvoi(message: string): void
  /** fait échouer tout `download()` — un archivage impossible ne doit rien bloquer */
  faireEchouerTelechargement(message: string): void
}

/**
 * Le double du connecteur, partagé par les tests des tâches 10 à 13.
 *
 * Il vit dans un fichier ordinaire et non dans un `*.test.ts` parce que
 * plusieurs suites en ont besoin. Il n'est importé par aucun code applicatif.
 *
 * Il double le **connecteur**, pas l'API : la sévérité de la frontière
 * Documenso — clé d'API, `Content-Type`, ordre des routes — est exercée par le
 * double d'API de `documenso.test.ts`, au-dessus duquel tourne le vrai
 * connecteur. Ici, ce sont les services qui sont sous test, et ce qu'ils
 * doivent respecter c'est le contrat : un envoi refusé lève, un statut inconnu
 * vaut `EN_ATTENTE`, un téléchargement peut échouer.
 */
export function createFakeSignatureConnector(): FakeSignatureConnector {
  const envois: SignatureEnvoi[] = []
  const relances: string[] = []
  const telechargements: string[] = []
  const statuts = new Map<string, SignatureStatus>()
  const signes = new Map<string, Uint8Array>()
  let echecEnvoi: string | null = null
  let echecTelechargement: string | null = null
  let compteur = 0

  return {
    provider: 'double',
    envois,
    relances,
    telechargements,

    regler(externalId, statut) {
      statuts.set(externalId, statut)
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

    async send(envoi) {
      if (echecEnvoi !== null) throw new SignatureConnectorError(echecEnvoi, 502)
      // Le double refuse ce que le connecteur réel ne pourrait pas confier :
      // Documenso exige un titre, un destinataire adressé et un document non
      // vide. Un double qui accepterait un envoi sans destinataire validerait
      // un service qui enverrait dans le vide.
      if (envoi.titre.trim() === '') {
        throw new SignatureConnectorError('Titre du document manquant.', 400)
      }
      if (!envoi.destinataire.email.includes('@') || envoi.destinataire.nom.trim() === '') {
        throw new SignatureConnectorError('Destinataire invalide.', 400)
      }
      if (envoi.pdf.byteLength === 0) {
        throw new SignatureConnectorError('Document vide.', 400)
      }

      envois.push(envoi)
      compteur += 1
      const externalId = `ext-${compteur}`
      statuts.set(externalId, 'EN_ATTENTE')
      return externalId
    },

    async status(externalId) {
      return statuts.get(externalId) ?? 'EN_ATTENTE'
    },

    async download(externalId) {
      if (echecTelechargement !== null) {
        throw new SignatureConnectorError(echecTelechargement, 503)
      }
      telechargements.push(externalId)
      return signes.get(externalId) ?? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53])
    },

    async remind(externalId) {
      relances.push(externalId)
    },
  }
}
