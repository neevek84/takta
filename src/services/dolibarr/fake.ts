/**
 * Double en mémoire de l'API Dolibarr.
 *
 * **Aucun test n'appelle Dolibarr.** Ce fichier est le seul « Dolibarr » que la
 * suite connaisse pour tout ce qui passe par le port.
 *
 * Il refuse ce qu'une instance refuserait : tiers sans nom, tâche sur un projet
 * inexistant, temps passé sur une tâche inconnue, date hors format, durée qui
 * n'est pas un entier de secondes. Un double complaisant validerait un
 * connecteur qui ne marcherait pas —
 * le double Google a dû être durci deux fois pour cette raison, la seconde
 * ayant laissé plus de mille tests au vert sur un défaut réel.
 *
 * Symétriquement, tout refus est un `DolibarrRequestError`, jamais un
 * `DolibarrUnavailableError` : ce qui manque ne réapparaîtra pas parce qu'on
 * réessaie, et la file doit abandonner au lieu de rejouer cinq fois.
 *
 * Vit dans `src/services` et non dans un dossier de tests parce que plusieurs
 * fichiers de test s'en servent, et parce que le seul moyen de garantir qu'il
 * reste conforme au port est qu'il l'implémente au sens de TypeScript.
 */
import {
  DolibarrRequestError,
  DolibarrUnavailableError,
  type DolibarrApi,
  type DolibarrProject,
  type DolibarrProposal,
  type DolibarrTask,
  type DolibarrThirdparty,
} from './api'

interface FakeProject extends DolibarrProject {
  usageBillTime: boolean
}

export interface FakeTimeSpent {
  id: number
  taskId: number
  dolibarrUserId: number
  date: string
  durationSeconds: number
  note: string
}

/** Le format de date de l'API Dolibarr, et le seul qu'elle interprète. */
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/

function entierPositif(valeur: number): boolean {
  return Number.isInteger(valeur) && valeur > 0
}

export class FakeDolibarr implements DolibarrApi {
  /** Bascule toutes les méthodes en panne, comme une instance éteinte. */
  panne = false

  readonly thirdparties: DolibarrThirdparty[] = []
  readonly projects: FakeProject[] = []
  readonly tasks: DolibarrTask[] = []
  readonly proposals: DolibarrProposal[] = []
  readonly timespents: FakeTimeSpent[] = []
  setup: Record<string, string> = {}

  /**
   * Compteurs d'appels, pour les tests d'idempotence — et pour ceux qui
   * vérifient qu'une garde a bien tranché **avant** d'appeler Dolibarr : un
   * refus qui parle après coup a déjà lu, et parfois écrit, à distance.
   */
  readonly appels = {
    createTask: 0,
    addTimeSpent: 0,
    updateTimeSpent: 0,
    deleteTimeSpent: 0,
    getProposal: 0,
  }

  private sequence = 0

  private next(): number {
    this.sequence += 1
    return this.sequence
  }

  private garde(): void {
    if (this.panne) {
      throw new DolibarrUnavailableError('Instance Dolibarr injoignable (double de test).')
    }
  }

  // --- amorçage ------------------------------------------------------------

  seedThirdparty(name: string): DolibarrThirdparty {
    const t = { id: this.next(), name }
    this.thirdparties.push(t)
    return t
  }

  seedProject(args: {
    ref: string
    title: string
    socid: number | null
    usageBillTime?: boolean
  }): DolibarrProject {
    const p: FakeProject = {
      id: this.next(),
      ref: args.ref,
      title: args.title,
      socid: args.socid,
      usageBillTime: args.usageBillTime ?? true,
    }
    this.projects.push(p)
    return { id: p.id, ref: p.ref, title: p.title, socid: p.socid }
  }

  seedProposal(args: {
    ref: string
    socid: number
    lines: Array<{ label: string; qty: number; subpriceCents: number }>
  }): DolibarrProposal {
    const p: DolibarrProposal = {
      id: this.next(),
      ref: args.ref,
      socid: args.socid,
      lines: args.lines.map((l) => ({ id: this.next(), ...l })),
    }
    this.proposals.push(p)
    return p
  }

  // --- port ----------------------------------------------------------------

  async listThirdparties(): Promise<DolibarrThirdparty[]> {
    this.garde()
    return [...this.thirdparties]
  }

  async createThirdparty(name: string): Promise<DolibarrThirdparty> {
    this.garde()
    if (name.trim() === '') {
      throw new DolibarrRequestError('Dolibarr refuse un tiers sans nom.')
    }
    return this.seedThirdparty(name)
  }

  async listProjects(): Promise<DolibarrProject[]> {
    this.garde()
    return this.projects
      .filter((p) => p.usageBillTime)
      .map((p) => ({ id: p.id, ref: p.ref, title: p.title, socid: p.socid }))
  }

  async listTasks(projectId: number): Promise<DolibarrTask[]> {
    this.garde()
    this.projet(projectId)
    return this.tasks.filter((t) => t.projectId === projectId)
  }

  async createTask(args: { projectId: number; label: string }): Promise<DolibarrTask> {
    this.garde()
    this.appels.createTask += 1
    this.projet(args.projectId)
    if (args.label.trim() === '') {
      throw new DolibarrRequestError('Dolibarr refuse une tâche sans libellé.')
    }

    const id = this.next()
    const t: DolibarrTask = {
      id,
      ref: `TK${String(id).padStart(4, '0')}`,
      label: args.label,
      projectId: args.projectId,
    }
    this.tasks.push(t)
    return t
  }

  async getProposal(id: number): Promise<DolibarrProposal> {
    this.garde()
    this.appels.getProposal += 1
    const p = this.proposals.find((x) => x.id === id)
    if (p === undefined) {
      // Non rejouable : une propale absente ne réapparaît pas d'elle-même.
      throw new DolibarrRequestError(`Propale ${id} introuvable dans Dolibarr.`)
    }
    return p
  }

  async addTimeSpent(args: {
    taskId: number
    dolibarrUserId: number
    date: string
    durationSeconds: number
    note: string
  }): Promise<{ timespentId: number }> {
    this.garde()
    this.appels.addTimeSpent += 1
    this.tache(args.taskId)
    this.verifierTemps(args)

    const ts: FakeTimeSpent = { id: this.next(), ...args }
    this.timespents.push(ts)
    return { timespentId: ts.id }
  }

  async updateTimeSpent(args: {
    taskId: number
    timespentId: number
    date: string
    durationSeconds: number
    note: string
  }): Promise<void> {
    this.garde()
    this.appels.updateTimeSpent += 1
    this.verifierTemps(args)

    const ts = this.timespents.find((x) => x.id === args.timespentId)
    if (ts === undefined) {
      throw new DolibarrRequestError(`Temps passé ${args.timespentId} introuvable.`)
    }
    ts.date = args.date
    ts.durationSeconds = args.durationSeconds
    ts.note = args.note
  }

  async deleteTimeSpent(args: { taskId: number; timespentId: number }): Promise<void> {
    this.garde()
    this.appels.deleteTimeSpent += 1
    // Absence tolérée : l'état visé est atteint. C'est le pendant du 404
    // toléré par le client HTTP.
    const i = this.timespents.findIndex((x) => x.id === args.timespentId)
    if (i >= 0) this.timespents.splice(i, 1)
  }

  async getSetupValue(constant: string): Promise<string | null> {
    this.garde()
    return this.setup[constant] ?? null
  }

  // --- contrôles -----------------------------------------------------------

  private projet(projectId: number): FakeProject {
    const p = this.projects.find((x) => x.id === projectId)
    if (p === undefined) {
      throw new DolibarrRequestError(`Projet ${projectId} introuvable dans Dolibarr.`)
    }
    return p
  }

  private tache(taskId: number): DolibarrTask {
    const t = this.tasks.find((x) => x.id === taskId)
    if (t === undefined) {
      throw new DolibarrRequestError(`Tâche ${taskId} introuvable dans Dolibarr.`)
    }
    return t
  }

  private verifierTemps(args: {
    dolibarrUserId?: number
    date: string
    durationSeconds: number
  }): void {
    if (!DATE_ISO.test(args.date)) {
      throw new DolibarrRequestError(`Date « ${args.date} » : Dolibarr attend 'YYYY-MM-DD'.`)
    }
    if (!entierPositif(args.durationSeconds)) {
      throw new DolibarrRequestError(
        `Durée « ${args.durationSeconds} » : Dolibarr attend un entier de secondes.`,
      )
    }
    if (args.dolibarrUserId !== undefined && !entierPositif(args.dolibarrUserId)) {
      throw new DolibarrRequestError("Dolibarr refuse un temps passé sans utilisateur.")
    }
  }
}
