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
  /**
   * La personne pour qui ce passage travaille.
   *
   * Pour un travail d'instance, le propriétaire sous un réveil externe et
   * l'appelant sous un clic. Pour un travail `parPersonne`, chacun à son
   * tour : l'ordonnanceur rappelle le traitement une fois par compte actif.
   */
  userId: string
  /**
   * L'adresse de cette personne-là, quand le travail s'adresse à quelqu'un.
   *
   * Absente pour un travail d'instance : `notify` retombe alors sur le
   * destinataire réglé dans l'instance, qui est le bon pour ce qui
   * n'appartient à personne.
   */
  destinataire?: string
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
  /**
   * Vrai quand le travail s'adresse à **une personne** et doit donc tourner
   * une fois par compte actif.
   *
   * **Obligatoire, jamais optionnel** : un champ facultatif ferait hériter un
   * travail ajouté demain de « instance » sans que personne ne l'ait décidé —
   * c'est-à-dire exactement du défaut qui a produit ce défaut. Un test fige en
   * plus la liste des deux, pour qu'un troisième se remarque.
   */
  parPersonne: boolean
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
    // La file porte déjà le `userId` de chaque ligne : la vider une fois les
    // vide toutes. La rejouer par personne rejouerait les mêmes lignes.
    parPersonne: false,
  },
  {
    name: 'webhooks.distribute',
    label: 'Distribution des rappels sortants',
    intervalMinutes: 5,
    enabledByDefault: true,
    parPersonne: false,
  },
  {
    name: 'rappel.saisie',
    label: 'Rappel de saisie',
    intervalMinutes: JOUR,
    enabledByDefault: false,
    // Les jours ouvrés sans saisie sont ceux **de quelqu'un**.
    parPersonne: true,
  },
  {
    name: 'rappel.cloture',
    label: 'Rappel de clôture',
    intervalMinutes: JOUR,
    enabledByDefault: false,
    // Un CRA appartient à une personne, et c'est elle qui doit le clôturer.
    parPersonne: true,
  },
  {
    name: 'signature.relance',
    label: 'Relance de signature',
    intervalMinutes: JOUR,
    enabledByDefault: false,
    // La relance part vers le **client**, pas vers le consultant : la balayer
    // par personne enverrait autant de relances que de comptes.
    parPersonne: false,
  },
  {
    name: 'signature.rafraichissement',
    label: 'Rafraîchissement des signatures',
    intervalMinutes: JOUR,
    enabledByDefault: false,
    parPersonne: false,
  },
  {
    name: 'journal.verification',
    label: 'Vérification de la chaîne du journal',
    intervalMinutes: JOUR,
    enabledByDefault: true,
    // La chaîne est celle de l'instance, indivise.
    parPersonne: false,
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
