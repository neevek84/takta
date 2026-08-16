import {
  DolibarrRequestError,
  DolibarrUnavailableError,
  type DolibarrApi,
  type DolibarrProject,
  type DolibarrProposal,
  type DolibarrTask,
  type DolibarrThirdparty,
} from './api'

const DELAI_PAR_DEFAUT_MS = 15_000

interface Contexte {
  baseUrl: string
  apiKey: string
  fetchImpl: typeof fetch
  timeoutMs: number
}

/**
 * Les seules options qu'un appel a besoin de porter. Volontairement plus
 * pauvre que `RequestInit` : les en-têtes ne sont pas négociables — la clé
 * d'API va dans `DOLAPIKEY` et nulle part ailleurs.
 */
interface Options {
  method?: string
  body?: string
  /** codes rendus comme `null` au lieu de lever (404 sur une liste vide, par exemple) */
  statutsToleres?: number[]
}

/** Vrai pour '1', 1, true — Dolibarr renvoie l'un ou l'autre selon les versions. */
function vrai(valeur: unknown): boolean {
  return valeur === 1 || valeur === '1' || valeur === true
}

function nombreOuNull(valeur: unknown): number | null {
  const n = Number(valeur)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function appel(ctx: Contexte, chemin: string, options: Options = {}): Promise<unknown> {
  const { statutsToleres = [], method, body } = options
  const controller = new AbortController()
  const minuterie = setTimeout(() => controller.abort(), ctx.timeoutMs)

  let reponse: Response
  try {
    reponse = await ctx.fetchImpl(`${ctx.baseUrl}${chemin}`, {
      method,
      body,
      signal: controller.signal,
      headers: {
        // La clé voyage dans un en-tête, jamais dans l'URL : une URL finit
        // dans les journaux du serveur web, l'en-tête non.
        DOLAPIKEY: ctx.apiKey,
        'Content-Type': 'application/json',
      },
    })
  } catch {
    // Réseau coupé, DNS, TLS, expiration : rejouable sans distinction. La
    // cause exacte n'aiderait pas la file à décider autre chose.
    throw new DolibarrUnavailableError(
      `Dolibarr est injoignable (${chemin}). La synchronisation réessaiera.`,
    )
  } finally {
    clearTimeout(minuterie)
  }

  if (statutsToleres.includes(reponse.status)) return null

  if (reponse.status === 401 || reponse.status === 403) {
    throw new DolibarrRequestError(
      "Dolibarr a refusé la clé d'API. Reconnectez le connecteur dans Administration · Dolibarr.",
    )
  }

  if (reponse.status >= 500) {
    throw new DolibarrUnavailableError(
      `Dolibarr a répondu ${reponse.status} sur ${chemin}. La synchronisation réessaiera.`,
    )
  }

  if (!reponse.ok) {
    throw new DolibarrRequestError(`Dolibarr a refusé la requête ${chemin} (${reponse.status}).`)
  }

  // Une suppression rend parfois un corps vide : `json()` lèverait, et la
  // levée passerait pour une panne alors que l'appel a réussi.
  if (reponse.status === 204) return null
  return reponse.json()
}

/**
 * Dolibarr répond 404 quand une collection est vide — « No thirdparty found »
 * n'est pas un refus. Ces routes tolèrent donc le 404 et rendent une liste
 * vide ; toute autre forme est un refus, jamais un silence.
 */
async function liste(ctx: Contexte, chemin: string): Promise<Array<Record<string, unknown>>> {
  const brut = await appel(ctx, chemin, { statutsToleres: [404] })
  if (brut === null) return []
  if (!Array.isArray(brut)) {
    throw new DolibarrRequestError(`Dolibarr a rendu une réponse inattendue sur ${chemin}.`)
  }
  return brut as Array<Record<string, unknown>>
}

export function createHttpDolibarrApi(args: {
  baseUrl: string
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): DolibarrApi {
  const ctx: Contexte = {
    baseUrl: args.baseUrl.replace(/\/$/, ''),
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl ?? fetch,
    timeoutMs: args.timeoutMs ?? DELAI_PAR_DEFAUT_MS,
  }

  return {
    async listThirdparties(): Promise<DolibarrThirdparty[]> {
      const brut = await liste(ctx, '/thirdparties?limit=1000')
      return brut.map((t) => ({ id: Number(t.id), name: String(t.name ?? '') }))
    },

    async createThirdparty(name: string): Promise<DolibarrThirdparty> {
      const id = (await appel(ctx, '/thirdparties', {
        method: 'POST',
        body: JSON.stringify({ name, client: 1 }),
      })) as number
      return { id: Number(id), name }
    },

    async listProjects(): Promise<DolibarrProject[]> {
      const brut = await liste(ctx, '/projects?limit=1000')
      // Le filtre vit ici et non chez l'appelant : un projet non facturable au
      // temps n'a aucune tâche où pousser, l'exposer ne ferait qu'inviter à
      // une correspondance qui échouerait plus tard.
      return brut
        .filter((p) => vrai(p.usage_bill_time))
        .map((p) => ({
          id: Number(p.id),
          ref: String(p.ref ?? ''),
          title: String(p.title ?? ''),
          socid: nombreOuNull(p.socid),
        }))
    },

    async listTasks(projectId: number): Promise<DolibarrTask[]> {
      const brut = await liste(ctx, `/projects/${projectId}/tasks`)
      return brut.map((t) => ({
        id: Number(t.id),
        ref: String(t.ref ?? ''),
        label: String(t.label ?? ''),
        projectId,
      }))
    },

    async createTask(a: { projectId: number; label: string }): Promise<DolibarrTask> {
      const id = (await appel(ctx, '/tasks', {
        method: 'POST',
        body: JSON.stringify({ fk_project: a.projectId, label: a.label, ref: a.label }),
      })) as number
      return { id: Number(id), ref: a.label, label: a.label, projectId: a.projectId }
    },

    async getProposal(id: number): Promise<DolibarrProposal> {
      const brut = (await appel(ctx, `/proposals/${id}`)) as Record<string, unknown>
      const lignes = (brut.lines ?? []) as Array<Record<string, unknown>>
      return {
        id: Number(brut.id),
        ref: String(brut.ref ?? ''),
        socid: Number(brut.socid),
        lines: lignes.map((l) => ({
          id: Number(l.id),
          label: String(l.desc ?? l.libelle ?? l.product_label ?? ''),
          qty: Number(l.qty),
          subpriceCents: Math.round(Number(l.subprice) * 100),
        })),
      }
    },

    async addTimeSpent(a: {
      taskId: number
      dolibarrUserId: number
      date: string
      durationSeconds: number
      note: string
    }): Promise<{ timespentId: number }> {
      const id = (await appel(ctx, `/tasks/${a.taskId}/addtimespent`, {
        method: 'POST',
        // `duration` est un nombre de secondes, tel quel : ni le réglage local
        // ni `TIMESHEET_DAY_DURATION` n'entrent ici (voir core/dolibarr/timespent).
        body: JSON.stringify({
          date: a.date,
          duration: a.durationSeconds,
          user_id: a.dolibarrUserId,
          note: a.note,
        }),
      })) as number | Record<string, unknown>

      const timespentId = typeof id === 'number' ? id : Number(id.id)
      return { timespentId }
    },

    async updateTimeSpent(a: {
      taskId: number
      timespentId: number
      date: string
      durationSeconds: number
      note: string
    }): Promise<void> {
      await appel(ctx, `/tasks/${a.taskId}/timespent/${a.timespentId}`, {
        method: 'PUT',
        body: JSON.stringify({ date: a.date, duration: a.durationSeconds, note: a.note }),
      })
    },

    async deleteTimeSpent(a: { taskId: number; timespentId: number }): Promise<void> {
      // 404 toléré : le temps a déjà disparu côté Dolibarr, l'état visé est
      // atteint. Lever ici bloquerait la file sur une cible déjà conforme.
      await appel(ctx, `/tasks/${a.taskId}/timespent/${a.timespentId}`, {
        method: 'DELETE',
        statutsToleres: [404],
      })
    },

    async getSetupValue(constant: string): Promise<string | null> {
      // `GET /setup/conf/{constant}` n'existe pas sur toutes les versions :
      // un 404 signifie « constante non lisible ici », pas « instance en
      // panne ». On rend null et l'écran de reprise n'en propose simplement
      // pas la valeur — le connecteur ne doit jamais tomber parce qu'une
      // constante facultative manque.
      const brut = (await appel(ctx, `/setup/conf/${encodeURIComponent(constant)}`, {
        statutsToleres: [404],
      })) as unknown

      if (brut === null || brut === undefined) return null
      // Selon les versions, la valeur arrive nue ou enveloppée dans un objet.
      if (typeof brut === 'object') {
        const valeur = (brut as { value?: unknown }).value
        return valeur === undefined || valeur === null ? null : String(valeur)
      }
      return String(brut)
    },
  }
}
