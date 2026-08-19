/**
 * Double de l'API Dolibarr **au niveau du transport**.
 *
 * `src/services/dolibarr/fake.ts` double le *port* : il ne voit passer aucune
 * URL et ne peut donc rien refuser d'une requête. Celui-ci double le HTTP, ce
 * qui en fait le seul endroit où le client réel (`createHttpDolibarrApi`) est
 * exercé tel quel — chemins, en-têtes, codes de retour compris.
 *
 * Il est le **gardien du catalogue** : toute requête dont le couple (méthode,
 * gabarit) n'est pas déclaré dans `./catalogue.ts` lève. Il lève au lieu de
 * rendre 404 parce qu'un 404 est un code que le client tolère sur plusieurs
 * routes — collection vide, temps déjà supprimé, constante absente : un refus
 * par 404 passerait donc au vert précisément là où il faut qu'il se voie.
 *
 * Il refuse enfin ce qu'une instance refuserait : clé d'API absente, date hors
 * format, durée qui n'est pas un entier de secondes, utilisateur sans
 * identifiant, tiers ou projet ou tâche inconnus. Un double complaisant
 * validerait un connecteur qui ne marcherait pas.
 *
 * Aucune valeur réelle : la base est un domaine `.test`, réservé et non
 * routable, et la clé qui la traverse dans les tests est manifestement fausse.
 */
import { cleAppel, gabaritCorrespondant } from '@/core/integrations/catalogue'
import { CATALOGUE_DOLIBARR } from './catalogue'

/** Base du double : `.test` est réservé par l'IANA et ne se résout nulle part. */
export const BASE_FACTICE = 'https://erp.invalide.test/api/index.php'

/** Le format de date de l'API Dolibarr, et le seul qu'elle interprète. */
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/

export interface FakeDolibarrHttp {
  fetchImpl: typeof fetch
  /** requêtes reçues, corps déjà décodé */
  appels: Array<{ methode: string; url: string; entetes: Headers; corps: unknown }>
  /** gabarits du catalogue réellement frappés, dans l'ordre */
  gabaritsObserves: string[]
  /** `client` : 1 client, 2 prospect, 3 les deux, 0 ni l'un ni l'autre. */
  seedThirdparty(name: string, client?: number): { id: number; name: string }
  seedProject(a: {
    ref: string
    title: string
    socid: number | null
    usageBillTime?: boolean
  }): { id: number }
  seedTask(a: { projectId: number; label: string }): { id: number }
  seedProposal(a: {
    ref: string
    socid: number
    lines: Array<{ label: string; qty: number; subpriceEuros: number }>
  }): { id: number }
  seedOrder(a: {
    ref: string
    socid: number
    refClient?: string
    label?: string
    statut?: number
    projectId?: number | null
    lines?: Array<{ label: string; qty: number; subpriceEuros: number }>
  }): { id: number }
  /** projets créés par l'API, pour vérifier ce que le client a réellement envoyé */
  projets: Array<{ id: number; ref: string; title: string; refExt: string; usageBillTime: boolean }>
  commandes: Array<{ id: number; ref: string; projectId: number | null }>
  seedSetup(constante: string, valeur: string): void
  timespents: Array<{
    id: number
    taskId: number
    date: string
    duration: number
    userId: number
    note: string
  }>
}

interface FauxProjet {
  id: number
  ref: string
  title: string
  socid: number | null
  usageBillTime: boolean
  refExt: string
}

interface FauxCommande {
  id: number
  ref: string
  refClient: string
  label: string
  socid: number
  statut: number
  projectId: number | null
  lines: Array<{ id: number; label: string; qty: number; subpriceEuros: number }>
}

interface FauxTache {
  id: number
  ref: string
  label: string
  projectId: number
}

interface FauxPropale {
  id: number
  ref: string
  socid: number
  lines: Array<{ id: number; label: string; qty: number; subpriceEuros: number }>
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

function entierPositif(valeur: unknown): boolean {
  return typeof valeur === 'number' && Number.isInteger(valeur) && valeur > 0
}

/**
 * Extrait les paramètres de chemin en rapprochant le gabarit **catalogué** du
 * chemin reçu. Écrire une seconde famille d'expressions régulières ici ferait
 * du double un juge indépendant du catalogue ; c'est précisément ce qu'il ne
 * doit pas être.
 */
function parametresDeChemin(gabarit: string, chemin: string): Record<string, string> {
  const attendus = gabarit.split('/')
  const recus = chemin.split('/')
  const out: Record<string, string> = {}

  for (const [i, segment] of attendus.entries()) {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      out[segment.slice(1, -1)] = decodeURIComponent(recus[i] ?? '')
    }
  }
  return out
}

export function createFakeDolibarrHttp(): FakeDolibarrHttp {
  const appels: FakeDolibarrHttp['appels'] = []
  const gabaritsObserves: string[] = []

  const thirdparties: Array<{ id: number; name: string; client: number }> = []
  const projects: FauxProjet[] = []
  const tasks: FauxTache[] = []
  const proposals: FauxPropale[] = []
  const orders: FauxCommande[] = []
  const timespents: FakeDolibarrHttp['timespents'] = []
  const setup: Record<string, string> = {}

  let sequence = 0
  const suivant = (): number => {
    sequence += 1
    return sequence
  }

  function json(corps: unknown, status = 200): Response {
    return new Response(JSON.stringify(corps), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  /** Un refus de contenu : le client le traduit en `DolibarrRequestError`. */
  function refus(message: string): Response {
    return json({ error: { code: 400, message } }, 400)
  }

  /**
   * Collection vide ou objet absent. Dolibarr répond bien 404 sur une
   * collection vide — c'est ce que le client tolère sur les listes.
   */
  function absent(message: string): Response {
    return json({ error: { code: 404, message } }, 404)
  }

  const fetchImpl = (async (input, init) => {
    const url = String(input)
    const methode = init?.method ?? 'GET'
    const corps = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    appels.push({ methode, url, entetes: new Headers(init?.headers), corps })

    // Le catalogue passe avant tout le reste.
    const declare = gabaritCorrespondant({
      catalogue: CATALOGUE_DOLIBARR,
      base: BASE_FACTICE,
      methode,
      url,
    })
    if (declare === null) {
      throw new Error(
        `Appel non catalogué : ${methode} ${url}. Déclarez-le dans ` +
          `src/integrations/dolibarr/catalogue.ts avant de l'émettre.`,
      )
    }
    gabaritsObserves.push(cleAppel(declare))

    // La clé voyage dans un en-tête, jamais dans l'URL. Sans ce contrôle, un
    // client qui l'oublierait passerait toute la suite au vert.
    const cle = new Headers(init?.headers).get('DOLAPIKEY') ?? ''
    if (cle === '') return json({ error: { message: 'Wrong API key' } }, 401)

    const chemin = (url.split('?')[0] ?? '').slice(BASE_FACTICE.length)
    const params = parametresDeChemin(declare.gabarit, chemin)

    switch (cleAppel(declare)) {
      case 'GET /thirdparties': {
        if (thirdparties.length === 0) return absent('No thirdparty found')
        // Dolibarr rend **tous** les tiers avec leur drapeau ; le filtre sur
        // les clients est appliqué par le client HTTP, et c'est ce que ce
        // double permet d'exercer.
        return json(
          thirdparties.map((t) => ({ id: String(t.id), name: t.name, client: String(t.client) })),
        )
      }

      case 'POST /thirdparties': {
        if (!estObjet(corps) || String(corps.name ?? '').trim() === '') {
          return refus('Name is mandatory')
        }
        const tiers = { id: suivant(), name: String(corps.name), client: Number(corps.client ?? 0) }
        thirdparties.push(tiers)
        // Dolibarr rend un entier nu, pas un objet.
        return json(tiers.id)
      }

      case 'GET /projects': {
        if (projects.length === 0) return absent('No project found')
        return json(
          projects.map((p) => ({
            id: p.id,
            ref: p.ref,
            title: p.title,
            socid: p.socid,
            usage_bill_time: p.usageBillTime ? '1' : '0',
          })),
        )
      }

      case 'GET /projects/{projectId}/tasks': {
        const projet = projects.find((p) => p.id === Number(params.projectId))
        if (projet === undefined) return refus('Project not found')

        const siennes = tasks.filter((t) => t.projectId === projet.id)
        if (siennes.length === 0) return absent('No task found')
        return json(siennes.map((t) => ({ id: t.id, ref: t.ref, label: t.label })))
      }

      case 'POST /tasks': {
        if (!estObjet(corps)) return refus('Body is mandatory')
        const projet = projects.find((p) => p.id === Number(corps.fk_project))
        if (projet === undefined) return refus('Project not found')
        if (String(corps.label ?? '').trim() === '') return refus('Label is mandatory')

        const id = suivant()
        tasks.push({
          id,
          ref: String(corps.ref ?? corps.label),
          label: String(corps.label),
          projectId: projet.id,
        })
        return json(id)
      }

      case 'GET /proposals/{proposalId}': {
        const propale = proposals.find((p) => p.id === Number(params.proposalId))
        if (propale === undefined) return absent('Proposal not found')
        return json({
          id: propale.id,
          ref: propale.ref,
          socid: propale.socid,
          // Dolibarr rend les prix en euros ; la conversion en centimes vit
          // dans le client, et c'est ce que ce double permet d'exercer.
          lines: propale.lines.map((l) => ({
            id: l.id,
            desc: l.label,
            qty: l.qty,
            subprice: l.subpriceEuros,
          })),
        })
      }

      case 'POST /tasks/{taskId}/addtimespent': {
        const tache = tasks.find((t) => t.id === Number(params.taskId))
        if (tache === undefined) return refus('Task not found')
        if (!estObjet(corps)) return refus('Body is mandatory')

        const invalide = refusDuTemps(corps, { avecUtilisateur: true })
        if (invalide !== null) return refus(invalide)

        const id = suivant()
        timespents.push({
          id,
          taskId: tache.id,
          date: String(corps.date),
          duration: Number(corps.duration),
          userId: Number(corps.user_id),
          note: String(corps.note ?? ''),
        })
        return json(id)
      }

      case 'PUT /tasks/{taskId}/timespent/{timespentId}': {
        const tache = tasks.find((t) => t.id === Number(params.taskId))
        if (tache === undefined) return refus('Task not found')
        if (!estObjet(corps)) return refus('Body is mandatory')

        const invalide = refusDuTemps(corps, { avecUtilisateur: false })
        if (invalide !== null) return refus(invalide)

        const temps = timespents.find((t) => t.id === Number(params.timespentId))
        if (temps === undefined) return refus('Time spent not found')

        temps.date = String(corps.date)
        temps.duration = Number(corps.duration)
        temps.note = String(corps.note ?? '')
        return json(temps.id)
      }

      case 'DELETE /tasks/{taskId}/timespent/{timespentId}': {
        const tache = tasks.find((t) => t.id === Number(params.taskId))
        if (tache === undefined) return refus('Task not found')

        const i = timespents.findIndex((t) => t.id === Number(params.timespentId))
        // Déjà disparu : 404, que le client tolère — l'état visé est atteint.
        if (i < 0) return absent('Time spent not found')

        timespents.splice(i, 1)
        return json({ success: { code: 200 } })
      }

      case 'POST /projects': {
        if (!estObjet(corps)) return refus('Body is mandatory')
        if (String(corps.title ?? '').trim() === '') return refus('Title is mandatory')
        if (thirdparties.find((t) => t.id === Number(corps.socid)) === undefined) {
          return refus('Thirdparty not found')
        }
        const id = suivant()
        projects.push({
          id,
          // Dolibarr attribue la référence : le client la relit, il ne l'invente pas.
          ref: `PJ${String(id).padStart(4, '0')}`,
          title: String(corps.title),
          socid: Number(corps.socid),
          // Le client impose les deux drapeaux ; le double refuse un projet qui
          // n'en porterait pas, sans quoi il validerait un connecteur créant
          // des projets où aucun temps ne peut aller.
          usageBillTime: corps.usage_bill_time === 1 || corps.usage_bill_time === '1',
          refExt: String(corps.ref_ext ?? ''),
        })
        if (corps.usage_task !== 1 && corps.usage_task !== '1') {
          return refus('A project created for time tracking must set usage_task')
        }
        return json(id)
      }

      case 'GET /projects/{projectId}': {
        const projet = projects.find((p) => p.id === Number(params.projectId))
        if (projet === undefined) return absent('Project not found')
        return json({
          id: projet.id,
          ref: projet.ref,
          title: projet.title,
          socid: projet.socid,
          ref_ext: projet.refExt,
          usage_bill_time: projet.usageBillTime ? '1' : '0',
        })
      }

      case 'GET /orders': {
        if (orders.length === 0) return absent('No order found')
        return json(
          orders.map((c) => ({
            id: c.id,
            ref: c.ref,
            ref_client: c.refClient === '' ? null : c.refClient,
            socid: String(c.socid),
            label: c.label,
            statut: String(c.statut),
            fk_project: c.projectId === null ? null : String(c.projectId),
          })),
        )
      }

      case 'GET /orders/{orderId}': {
        const commande = orders.find((c) => c.id === Number(params.orderId))
        if (commande === undefined) return absent('Order not found')
        return json({
          id: commande.id,
          ref: commande.ref,
          ref_client: commande.refClient === '' ? null : commande.refClient,
          socid: String(commande.socid),
          label: commande.label,
          statut: String(commande.statut),
          fk_project: commande.projectId === null ? null : String(commande.projectId),
          lines: commande.lines.map((l) => ({
            id: l.id,
            desc: l.label,
            qty: l.qty,
            subprice: l.subpriceEuros,
          })),
        })
      }

      case 'PUT /orders/{orderId}': {
        const commande = orders.find((c) => c.id === Number(params.orderId))
        if (commande === undefined) return absent('Order not found')
        if (!estObjet(corps)) return refus('Body is mandatory')
        // Dolibarr refuse une clé étrangère qui ne désigne aucun projet.
        if (projects.find((p) => p.id === Number(corps.fk_project)) === undefined) {
          return refus('Project not found')
        }
        commande.projectId = Number(corps.fk_project)
        return json(commande.id)
      }

      case 'GET /setup/conf/{constante}': {
        const valeur = setup[params.constante ?? '']
        if (valeur === undefined) return absent('Constant not found')
        // Enveloppée : c'est l'une des deux formes que le client sait lire.
        return json({ value: valeur })
      }

      default:
        // Cataloguée mais non simulée ici : c'est un trou du double, pas un
        // comportement de Dolibarr. Le dire au lieu de rendre un 404 crédible.
        throw new Error(`Route cataloguée mais non simulée par le double : ${methode} ${url}`)
    }
  }) as typeof fetch

  /** Rend le message de refus, ou `null` quand le temps passé est acceptable. */
  function refusDuTemps(
    corps: Record<string, unknown>,
    options: { avecUtilisateur: boolean },
  ): string | null {
    if (typeof corps.date !== 'string' || !DATE_ISO.test(corps.date)) {
      return "Date must be 'YYYY-MM-DD'"
    }
    if (!entierPositif(corps.duration)) return 'Duration must be a positive integer of seconds'
    if (options.avecUtilisateur && !entierPositif(corps.user_id)) return 'User id is mandatory'
    return null
  }

  return {
    fetchImpl,
    appels,
    gabaritsObserves,
    timespents,
    projets: projects,
    commandes: orders,

    seedThirdparty(name, client = 1) {
      const tiers = { id: suivant(), name, client }
      thirdparties.push(tiers)
      return tiers
    },

    seedProject(a) {
      const projet: FauxProjet = {
        id: suivant(),
        ref: a.ref,
        title: a.title,
        socid: a.socid,
        usageBillTime: a.usageBillTime ?? true,
        refExt: '',
      }
      projects.push(projet)
      return { id: projet.id }
    },

    seedTask(a) {
      const id = suivant()
      tasks.push({ id, ref: `TK${String(id).padStart(4, '0')}`, label: a.label, projectId: a.projectId })
      return { id }
    },

    seedProposal(a) {
      const propale: FauxPropale = {
        id: suivant(),
        ref: a.ref,
        socid: a.socid,
        lines: a.lines.map((l) => ({ id: suivant(), ...l })),
      }
      proposals.push(propale)
      return { id: propale.id }
    },

    seedOrder(a) {
      const commande: FauxCommande = {
        id: suivant(),
        ref: a.ref,
        refClient: a.refClient ?? '',
        label: a.label ?? '',
        socid: a.socid,
        statut: a.statut ?? 1,
        projectId: a.projectId ?? null,
        lines: (a.lines ?? []).map((l) => ({ id: suivant(), ...l })),
      }
      orders.push(commande)
      return { id: commande.id }
    },

    seedSetup(constante, valeur) {
      setup[constante] = valeur
    },
  }
}
