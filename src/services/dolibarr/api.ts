/**
 * Le port du connecteur Dolibarr : types, erreurs, et rien d'autre.
 *
 * **Ce module ne réexporte rien.** `http.ts`, `fake.ts` et `resolve.ts`
 * l'importent tous ; un `export … from './http'` en sens inverse fermerait le
 * cycle `api → http → api`, dont l'ordre d'initialisation finirait par faire
 * passer une classe d'erreur pour `undefined` — un `instanceof` toujours faux,
 * donc une erreur permanente rejouée sans fin. Chaque appelant importe depuis
 * le module qui définit ce dont il a besoin.
 */

/** Nom du fournisseur, tel qu'il est stocké dans `ProviderCredential`. */
export const DOLIBARR = 'DOLIBARR'

export interface DolibarrThirdparty {
  id: number
  name: string
}

export interface DolibarrProject {
  id: number
  ref: string
  title: string
  /** tiers rattaché au projet, null si le projet n'en porte pas */
  socid: number | null
}

export interface DolibarrTask {
  id: number
  ref: string
  label: string
  projectId: number
}

export interface DolibarrPropalLine {
  id: number
  label: string
  /** quantité vendue, en jours */
  qty: number
  /** prix unitaire, en centimes */
  subpriceCents: number
  /**
   * `product_type = 1` chez Dolibarr : la ligne vend du **service**, donc du
   * temps. Une ligne de produit vend des objets — la reprendre en prestation
   * ferait « 5 jours vendus » d'une commande de cinq t-shirts.
   */
  service: boolean
}

export interface DolibarrProposal {
  id: number
  ref: string
  socid: number
  lines: DolibarrPropalLine[]
}

/** Une ligne de commande client. Même forme qu'une ligne de propale, à dessein. */
export type DolibarrOrderLine = DolibarrPropalLine

/**
 * Une commande client — le document ferme du flux du porteur, et le seul qui
 * porte la référence du bon de commande du client (`ref_client`).
 */
export interface DolibarrOrder {
  id: number
  /** référence Dolibarr, du genre `CO2608-0042` */
  ref: string
  /** `ref_client` : la référence du BDC du client, `''` quand elle manque */
  refClient: string
  socid: number
  /** libellé ou objet de la commande, `''` quand il manque */
  label: string
  /** projet déjà rattaché à la commande, `null` sinon */
  projectId: number | null
  lines: DolibarrOrderLine[]
}

/** Ce qu'il faut à Dolibarr pour créer un projet facturable au temps. */
export interface DolibarrProjectCreation {
  socid: number
  /**
   * `ref` du projet. **Obligatoire** : l'interface de Dolibarr la fabrique par
   * son module de numérotation, son API non — elle refuse la création par
   * « Bad Request: ref field missing ». Mesuré sur l'instance 23.0.1 du
   * porteur le 19 août 2026.
   */
  ref: string
  title: string
  /** `ref_ext` : la référence client reportée, `''` quand la commande n'en porte pas */
  refExt: string
  description: string
}

/**
 * Le port du connecteur. Tout ce que l'application sait faire avec Dolibarr
 * passe par là — ce qui rend le double suffisant pour tester le lot entier
 * sans jamais toucher une instance.
 *
 * Il ne porte **aucune** méthode de facturation — ni création, ni validation,
 * ni émission, ni envoi. Dolibarr facture, pas le CRA : l'application pousse
 * les temps consommés, et le porteur les facture depuis le projet Dolibarr,
 * qui est le seul endroit où une ligne de temps passe de « Facturée : Non » à
 * la référence de sa facture. Une facture créée d'ici serait parallèle à ce
 * flux et laisserait les temps poussés refacturables sans que rien ne le dise.
 */
export interface DolibarrApi {
  listThirdparties(): Promise<DolibarrThirdparty[]>
  createThirdparty(name: string): Promise<DolibarrThirdparty>
  /** déjà filtrés sur `usage_bill_time = 1` */
  listProjects(): Promise<DolibarrProject[]>
  listTasks(projectId: number): Promise<DolibarrTask[]>
  createTask(args: { projectId: number; label: string }): Promise<DolibarrTask>
  /**
   * Crée un projet **facturable au temps**, et rien d'autre.
   *
   * `usage_task` et `usage_bill_time` ne sont pas des paramètres : un projet
   * créé sans eux n'a aucune tâche où pousser un temps, et l'application
   * viendrait de fabriquer elle-même le cas qu'elle refuse de rattacher.
   */
  createProject(args: DolibarrProjectCreation): Promise<DolibarrProject>
  /** déjà filtrées : ni brouillon, ni annulée */
  listOrders(): Promise<DolibarrOrder[]>
  getOrder(id: number): Promise<DolibarrOrder>
  /**
   * Pose `fk_project` sur la commande. C'est ce rattachement, et lui seul, qui
   * fait apparaître la commande sous le projet dans Dolibarr et permet à la
   * facturation des temps consommés de retrouver le bon de commande.
   */
  linkOrderToProject(args: { orderId: number; projectId: number }): Promise<void>
  getProposal(id: number): Promise<DolibarrProposal>
  addTimeSpent(args: {
    taskId: number
    dolibarrUserId: number
    /** 'YYYY-MM-DD' */
    date: string
    durationSeconds: number
    note: string
  }): Promise<{ timespentId: number }>
  updateTimeSpent(args: {
    taskId: number
    timespentId: number
    date: string
    durationSeconds: number
    note: string
  }): Promise<void>
  deleteTimeSpent(args: { taskId: number; timespentId: number }): Promise<void>
  getSetupValue(constant: string): Promise<string | null>
}

/** Dolibarr est injoignable ou en panne : la file rejouera. */
export class DolibarrUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DolibarrUnavailableError'
  }
}

/** Dolibarr a refusé la requête : la rejouer telle quelle n'aboutira jamais. */
export class DolibarrRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DolibarrRequestError'
  }
}

/** Une correspondance locale manque : rien à rejouer tant qu'elle n'existe pas. */
export class DolibarrMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DolibarrMappingError'
  }
}
