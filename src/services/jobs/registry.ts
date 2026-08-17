import type { FetchLike } from '@/services/webhooks/delivery'
import type { Mailer } from '@/services/notify'
import {
  distributionRappels,
  rafraichissementSignatures,
  rappelCloture,
  rappelSaisie,
  relanceSignatures,
  verificationJournal,
  vidageFileSortie,
} from './handlers'

export interface JobContext {
  now: Date
  /** propriétaire de l'instance sous un réveil externe, appelant sous un clic */
  userId: string
  /** injecté par les tests ; la production n'en passe aucun */
  fetchFn?: FetchLike
  /** injecté par les tests ; en production, la configuration SMTP décide */
  mailer?: Mailer
}

export interface JobResult {
  /** ce que la supervision affichera : un travail muet n'apprend rien */
  message: string
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>

export interface JobDefinition {
  name: string
  label: string
  intervalMinutes: number
  enabledByDefault: boolean
}

const JOUR = 24 * 60

/**
 * **Liste en dur**, et volontairement : un moteur de règles configurable
 * serait un produit dans le produit, et l'API d'événements existe
 * précisément pour que les enchaînements vivent dehors.
 *
 * Les sept travaux de la spec y figurent, y compris ceux dont le traitement
 * appartient à un autre lot — les omettre ferait mentir l'écran de
 * supervision par le silence.
 */
export const JOB_DEFINITIONS: readonly JobDefinition[] = [
  {
    name: 'outbox.flush',
    label: 'Vidage de la file de sortie',
    intervalMinutes: 5,
    // Désactivé par défaut bien qu'il soit porté : il **écrit chez autrui**
    // (agenda Google, Dolibarr). Le bouton « Synchroniser maintenant » et
    // `POST /api/sync/flush` suffisent à l'autoportance ; automatiser une
    // écriture sortante se décide, cela ne s'hérite pas d'une installation.
    enabledByDefault: false,
  },
  {
    name: 'webhooks.distribute',
    label: 'Distribution des rappels sortants',
    intervalMinutes: 5,
    enabledByDefault: true,
  },
  { name: 'rappel.saisie', label: 'Rappel de saisie', intervalMinutes: JOUR, enabledByDefault: false },
  {
    name: 'rappel.cloture',
    label: 'Rappel de clôture',
    intervalMinutes: JOUR,
    enabledByDefault: false,
  },
  {
    name: 'signature.relance',
    label: 'Relance de signature',
    intervalMinutes: JOUR,
    enabledByDefault: false,
  },
  {
    name: 'signature.rafraichissement',
    label: 'Rafraîchissement des signatures',
    intervalMinutes: JOUR,
    enabledByDefault: false,
  },
  {
    name: 'journal.verification',
    label: 'Vérification de la chaîne du journal',
    intervalMinutes: JOUR,
    enabledByDefault: true,
  },
]

/**
 * Les travaux déclarés dont le traitement viendra d'un autre lot. Un lot qui
 * livre le sien ajoute son entrée à `JOB_HANDLERS` **et** retire son nom
 * d'ici — le test « chaque travail déclaré est traité, ou explicitement
 * différé » l'y oblige.
 *
 * **Le tableau est vide, et c'est le fait de la livraison.** Il portait encore
 * les deux travaux de signature alors que `runSignatureReminders` et
 * `refreshPendingSignatures` étaient écrits, testés et exportés : la case
 * « différé » satisfaisait le garde-fou, l'écran de supervision affichait
 * indéfiniment « ce travail est porté par le lot 3 », et **aucun CRA n'était
 * jamais relancé, aucun webhook perdu jamais rattrapé**. Un travail écrit mais
 * non inscrit ici ne se voit d'aucune autre façon.
 */
export const TRAVAUX_DIFFERES: Readonly<Record<string, string>> = {}

/** Les travaux portés — les sept de la spec, sans exception. */
export const JOB_HANDLERS: Readonly<Record<string, JobHandler>> = {
  'outbox.flush': vidageFileSortie,
  'webhooks.distribute': distributionRappels,
  'rappel.saisie': rappelSaisie,
  'rappel.cloture': rappelCloture,
  'signature.relance': relanceSignatures,
  'signature.rafraichissement': rafraichissementSignatures,
  'journal.verification': verificationJournal,
}
