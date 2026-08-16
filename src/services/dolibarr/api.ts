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
export const DOLIBARR = 'dolibarr'

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
}

export interface DolibarrProposal {
  id: number
  ref: string
  socid: number
  lines: DolibarrPropalLine[]
}

export interface DolibarrInvoiceRequest {
  socid: number
  lines: Array<{ label: string; qteCentiemes: number; subpriceCents: number }>
}

/**
 * Le port du connecteur. Tout ce que l'application sait faire avec Dolibarr
 * passe par là — ce qui rend le double suffisant pour tester le lot entier
 * sans jamais toucher une instance.
 *
 * Il ne porte aucune méthode de validation, d'émission ni d'envoi de facture :
 * Dolibarr facture, pas le CRA. L'application demande un brouillon, un point.
 */
export interface DolibarrApi {
  listThirdparties(): Promise<DolibarrThirdparty[]>
  createThirdparty(name: string): Promise<DolibarrThirdparty>
  /** déjà filtrés sur `usage_bill_time = 1` */
  listProjects(): Promise<DolibarrProject[]>
  listTasks(projectId: number): Promise<DolibarrTask[]>
  createTask(args: { projectId: number; label: string }): Promise<DolibarrTask>
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
  createDraftInvoice(req: DolibarrInvoiceRequest): Promise<{ id: number; ref: string }>
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
