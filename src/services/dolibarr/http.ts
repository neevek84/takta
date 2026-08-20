import {
  DolibarrRequestError,
  DolibarrUnavailableError,
  type DolibarrApi,
  type DolibarrOrder,
  type DolibarrProject,
  type DolibarrProjectCreation,
  type DolibarrPropalLine,
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

/**
 * Le drapeau `client` d'un tiers Dolibarr : 0 ni l'un ni l'autre, 1 client,
 * 2 prospect, 3 client **et** prospect. Seuls 1 et 3 désignent un client.
 *
 * Le prospect seul est écarté volontairement : il n'a rien signé, donc aucune
 * mission ni aucun temps à recevoir. Il redeviendra visible le jour où
 * Dolibarr le passera client, ce qui est précisément le moment utile.
 */
function estClient(valeur: unknown): boolean {
  const n = Number(valeur)
  return n === 1 || n === 3
}

/** Vrai pour '1', 1, true — Dolibarr renvoie l'un ou l'autre selon les versions. */
function vrai(valeur: unknown): boolean {
  return valeur === 1 || valeur === '1' || valeur === true
}

function nombreOuNull(valeur: unknown): number | null {
  const n = Number(valeur)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Ce que Dolibarr dit de son refus, prêt à être accolé au message.
 *
 * Le corps d'erreur prend deux formes selon les versions : `{ error: { message } }`
 * ou `{ error: '…' }`. Une lecture qui échoue ne doit surtout pas masquer le
 * refus lui-même : on rend une chaîne vide et le code du statut suffit.
 */
async function motif(reponse: Response): Promise<string> {
  try {
    const brut = (await reponse.json()) as { error?: unknown }
    const erreur = brut.error
    const texte =
      typeof erreur === 'string'
        ? erreur
        : typeof erreur === 'object' && erreur !== null
          ? String((erreur as { message?: unknown }).message ?? '')
          : ''
    return texte === '' ? '' : ` : ${texte}`
  } catch {
    return ''
  }
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

  if (reponse.status === 401) {
    throw new DolibarrRequestError(
      "Dolibarr a refusé la clé d'API. Reconnectez le connecteur dans Administration · Dolibarr.",
    )
  }

  // 403 n'est pas 401, et les confondre produit un faux diagnostic : la clé est
  // bonne, c'est l'utilisateur auquel elle appartient qui n'a pas le droit sur
  // cette route-là. « Reconnectez le connecteur » ferait ressaisir une clé
  // valide, indéfiniment, sans jamais nommer le droit qui manque.
  if (reponse.status === 403) {
    throw new DolibarrRequestError(
      `L'utilisateur de la clé d'API n'a pas le droit d'accéder à ${chemin}. ` +
        'La clé, elle, est valide : ajoutez la permission à cet utilisateur dans Dolibarr, ' +
        "ou utilisez la clé d'un utilisateur qui l'a.",
    )
  }

  if (reponse.status >= 500) {
    // Le motif est repris ici **aussi**. Un 500 reste rejouable — c'est une
    // panne, pas un refus — mais il peut cacher une charge utile que Dolibarr
    // n'a pas su traiter, et la file rejouera alors indéfiniment la même. Sans
    // sa phrase, on ne saurait jamais laquelle : constaté sur `POST /tasks`,
    // rejoué en boucle sans qu'aucun écran ne dise pourquoi.
    throw new DolibarrUnavailableError(
      `Dolibarr a répondu ${reponse.status} sur ${chemin}${await motif(reponse)}. ` +
        'La synchronisation réessaiera.',
    )
  }

  if (!reponse.ok) {
    // Le motif de Dolibarr est **repris**, pas jeté. « Dolibarr a refusé la
    // requête /projects (400) » ne dit pas quel champ manque : c'est un mur.
    // Dolibarr, lui, le dit — et sans cette phrase il faut deviner.
    throw new DolibarrRequestError(
      `Dolibarr a refusé la requête ${chemin} (${reponse.status})${await motif(reponse)}`,
    )
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

/**
 * Les lignes d'un document vendeur, propale ou commande : Dolibarr les rend
 * sous la même forme, et les deux se reprennent avec la même règle.
 */
function lignesVendues(brut: Record<string, unknown>): DolibarrPropalLine[] {
  const lignes = (brut.lines ?? []) as Array<Record<string, unknown>>
  return lignes.map((l) => ({
    id: Number(l.id),
    label: String(l.desc ?? l.libelle ?? l.product_label ?? ''),
    qty: Number(l.qty),
    subpriceCents: Math.round(Number(l.subprice) * 100),
    service: Number(l.product_type) === 1,
  }))
}

function versCommande(brut: Record<string, unknown>): DolibarrOrder {
  return {
    id: Number(brut.id),
    ref: String(brut.ref ?? ''),
    // `ref_client` est nul sur l'immense majorité des commandes : c'est une
    // absence ordinaire, pas une anomalie. `ref_customer` est son alias sur
    // certaines versions, et les deux arrivent parfois côte à côte.
    refClient: String(brut.ref_client ?? brut.ref_customer ?? ''),
    socid: Number(brut.socid),
    label: String(brut.label ?? brut.libelle ?? ''),
    projectId: nombreOuNull(brut.fk_project ?? brut.fk_projet),
    lines: lignesVendues(brut),
  }
}

/**
 * Les statuts de commande sur lesquels un projet peut naître : **validée** et
 * **en cours**, rien d'autre.
 *
 * Un brouillon n'engage rien et une annulée n'engage plus — créer un projet
 * sur l'un ou l'autre fabriquerait un chantier sans commande. Une **livrée**
 * (statut 3) est close : le travail y est fini, et ouvrir un projet pour y
 * saisir des temps à venir n'a plus de sens.
 */
const STATUTS_COMMANDE_UTILISABLES = new Set([1, 2])

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
      // Le filtre vit ici, comme celui de `listProjects`, et pour la même
      // raison : un fournisseur ou un tiers neutre n'a pas de mission et ne
      // recevra jamais de temps. L'exposer n'inviterait qu'à un rattachement
      // qui n'a aucun sens.
      return brut
        .filter((t) => estClient(t.client))
        .map((t) => ({ id: Number(t.id), name: String(t.name ?? '') }))
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

    async createProject(a: DolibarrProjectCreation): Promise<DolibarrProject> {
      const id = (await appel(ctx, '/projects', {
        method: 'POST',
        body: JSON.stringify({
          ref: a.ref,
          title: a.title,
          socid: a.socid,
          // **Ouvert, pas brouillon.** Dolibarr crée un projet en statut 0 quand
          // on ne dit rien : son interface le montre « Brouillon », et un projet
          // brouillon n'accepte pas de temps consommé. Le porteur a validé un
          // CRA et n'a rien vu arriver — c'est ce champ qui manquait.
          status: 1,
          ref_ext: a.refExt,
          description: a.description,
          // Imposés, jamais paramétrables : sans eux le projet n'accepte
          // aucune tâche ni aucun temps facturable, et `listProjects` le
          // filtrerait aussitôt — l'application aurait créé ce qu'elle refuse.
          usage_task: 1,
          usage_bill_time: 1,
        }),
      })) as number | Record<string, unknown>

      const projectId = typeof id === 'number' ? id : Number(id.id)
      // La référence (`PJxxxx-nnnn`) est attribuée par Dolibarr : on la relit
      // au lieu de l'inventer, sans quoi tout refus ultérieur nommerait un
      // projet qui n'existe pas sous ce nom.
      const cree = (await appel(ctx, `/projects/${projectId}`)) as Record<string, unknown>
      return {
        id: projectId,
        ref: String(cree.ref ?? ''),
        title: String(cree.title ?? a.title),
        socid: nombreOuNull(cree.socid),
      }
    },

    async listOrders(): Promise<DolibarrOrder[]> {
      const brut = await liste(ctx, '/orders?limit=1000')
      return brut
        .filter((c) => STATUTS_COMMANDE_UTILISABLES.has(Number(c.statut ?? c.status)))
        // `billed` à 1 dit que la commande est **entièrement** facturée : il
        // n'y a plus rien à consommer dessus, et le projet qu'on ouvrirait ne
        // serait jamais facturé. Une commande partiellement facturée, elle,
        // reste proposée — c'est le cas courant d'une prestation en cours.
        .filter((c) => !vrai(c.billed))
        .map(versCommande)
    },

    async getOrder(id: number): Promise<DolibarrOrder> {
      const brut = (await appel(ctx, `/orders/${id}`)) as Record<string, unknown>
      return versCommande(brut)
    },

    async linkOrderToProject(a: { orderId: number; projectId: number }): Promise<void> {
      // Un seul champ est écrit. Renvoyer la commande entière la ferait
      // réenregistrer telle que l'API l'a rendue — et une valeur mal
      // retranscrite au passage modifierait un document commercial signé.
      await appel(ctx, `/orders/${a.orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ fk_project: a.projectId }),
      })
    },

    async getProposal(id: number): Promise<DolibarrProposal> {
      const brut = (await appel(ctx, `/proposals/${id}`)) as Record<string, unknown>
      return {
        id: Number(brut.id),
        ref: String(brut.ref ?? ''),
        socid: Number(brut.socid),
        lines: lignesVendues(brut),
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
      // 403 toléré au même titre que 404 : `/setup` est réservé aux
      // administrateurs sur la plupart des instances, et une clé d'API portée
      // par un utilisateur ordinaire ne doit pas faire tomber tout l'écran
      // pour une valeur facultative.
      const brut = (await appel(ctx, `/setup/conf/${encodeURIComponent(constant)}`, {
        statutsToleres: [404, 403],
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
