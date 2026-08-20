import { describe, it, expect } from 'vitest'
import { DolibarrRequestError, DolibarrUnavailableError } from './api'
import { createHttpDolibarrApi } from './http'

const BASE = 'https://erp.invalide.test/api/index.php'

function reponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Vue {
  url: string
  method: string
  headers: Headers
  body: string | null
}

/** Enregistre les appels et rend toujours la même réponse. */
function espion(rendre: (vue: Vue) => Response): { vues: Vue[]; fetchImpl: typeof fetch } {
  const vues: Vue[] = []
  const fetchImpl = (async (input, init) => {
    const vue: Vue = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    }
    vues.push(vue)
    return rendre(vue)
  }) as typeof fetch
  return { vues, fetchImpl }
}

describe('client HTTP Dolibarr', () => {
  it('présente la clé dans l en-tête DOLAPIKEY, jamais dans l URL', async () => {
    const vues: Array<{ url: string; headers: Headers }> = []
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'SECRET',
      fetchImpl: async (input, init) => {
        vues.push({ url: String(input), headers: new Headers(init?.headers) })
        return reponse([])
      },
    })

    await api.listThirdparties()
    expect(vues[0]!.headers.get('DOLAPIKEY')).toBe('SECRET')
    expect(vues[0]!.url).not.toContain('SECRET')
  })

  it('filtre les projets sur usage_bill_time', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () =>
        reponse([
          { id: 1, ref: 'PJ001', title: 'Facturable', socid: 3, usage_bill_time: '1' },
          { id: 2, ref: 'PJ002', title: 'Interne', socid: 3, usage_bill_time: '0' },
        ]),
    })

    expect((await api.listProjects()).map((p) => p.id)).toEqual([1])
  })

  it('traite une panne serveur comme rejouable', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => reponse({ error: 'boom' }, 503),
    })
    await expect(api.listProjects()).rejects.toThrow(DolibarrUnavailableError)
  })

  it('traite un réseau injoignable comme rejouable', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      },
    })
    await expect(api.listProjects()).rejects.toThrow(DolibarrUnavailableError)
  })

  it('traite un refus de la requête comme non rejouable', async () => {
    // Rejouer indéfiniment une requête que Dolibarr refuse encombrerait la
    // file sans jamais aboutir.
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => reponse({ error: { message: 'Bad value for socid' } }, 400),
    })
    await expect(api.createThirdparty('X')).rejects.toThrow(DolibarrRequestError)
  })

  it('traite une clé refusée comme non rejouable, avec un message explicite', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'mauvaise',
      fetchImpl: async () => reponse({ error: 'Unauthorized' }, 401),
    })
    await expect(api.listProjects()).rejects.toThrow(/clé d'API/)
    await expect(api.listProjects()).rejects.toThrow(DolibarrRequestError)
  })

  it('distingue un droit manquant d une clé refusée, et nomme la route', async () => {
    // Confondre les deux produit un faux diagnostic : « Reconnectez le
    // connecteur » fait ressaisir indéfiniment une clé parfaitement valide.
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'valide-mais-sans-droits',
      fetchImpl: async () => reponse({ error: 'Forbidden' }, 403),
    })

    await expect(api.listProjects()).rejects.toThrow(/n'a pas le droit/)
    await expect(api.listProjects()).rejects.toThrow(/\/projects/)
    await expect(api.listProjects()).rejects.toThrow(/la clé, elle, est valide/i)
    await expect(api.listProjects()).rejects.toThrow(DolibarrRequestError)
  })

  it('ne fait pas tomber l écran quand une constante est réservée aux administrateurs', async () => {
    // `/setup` est réservé aux administrateurs sur la plupart des instances.
    // Une clé portée par un utilisateur ordinaire ne doit pas emporter tout
    // l'écran de reprise pour une valeur facultative.
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'ordinaire',
      fetchImpl: async () => reponse({ error: 'Forbidden' }, 403),
    })
    expect(await api.getSetupValue('TIMESHEET_DAY_DURATION')).toBeNull()
  })

  it('ne propose que les tiers qui sont des clients', async () => {
    // Un fournisseur ou un tiers neutre n'a pas de mission et ne recevra
    // jamais de temps : l'exposer n'invite qu'à un rattachement absurde.
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () =>
        reponse([
          { id: '1', name: 'Client', client: '1' },
          { id: '2', name: 'Client et prospect', client: '3' },
          { id: '3', name: 'Prospect seul', client: '2' },
          { id: '4', name: 'Fournisseur', client: '0', fournisseur: '1' },
          { id: '5', name: 'Ni l un ni l autre', client: '0' },
        ]),
    })

    expect((await api.listThirdparties()).map((t) => t.name)).toEqual([
      'Client',
      'Client et prospect',
    ])
  })

  it('rend null sur une constante absente plutôt que de lever', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => reponse({ error: 'not found' }, 404),
    })
    expect(await api.getSetupValue('TIMESHEET_DAY_DURATION')).toBeNull()
  })

  it('lit la constante, qu elle vienne enveloppée ou nue', async () => {
    const enveloppee = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => reponse({ name: 'TIMESHEET_DAY_DURATION', value: '7' }),
    })
    expect(await enveloppee.getSetupValue('TIMESHEET_DAY_DURATION')).toBe('7')

    const nue = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => reponse('7'),
    })
    expect(await nue.getSetupValue('TIMESHEET_DAY_DURATION')).toBe('7')
  })

  it('abandonne au bout du délai imparti, en rejouable', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      timeoutMs: 10,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    })
    await expect(api.listProjects()).rejects.toThrow(DolibarrUnavailableError)
  })

})

// ---------------------------------------------------------------------------
// Ce que le connecteur envoie réellement sur le fil. Sans ces vérifications,
// une route ou une unité fausse laisserait la suite au vert : les tests
// ci-dessus n'observent que le code de retour.
// ---------------------------------------------------------------------------

describe('client HTTP Dolibarr — la charge utile sur le fil', () => {
  it('pousse un temps passé en secondes, à la date et à l utilisateur donnés', async () => {
    const { vues, fetchImpl } = espion(() => reponse(88))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    // 3 h 30 sur une journée de 7 h : ce sont bien des secondes qui partent,
    // jamais des minutes ni des centièmes de jour.
    const { timespentId } = await api.addTimeSpent({
      taskId: 41,
      dolibarrUserId: 7,
      date: '2026-05-04',
      durationSeconds: 12_600,
      note: 'Développement',
    })

    expect(timespentId).toBe(88)
    expect(vues[0]!.method).toBe('POST')
    expect(vues[0]!.url).toBe(`${BASE}/tasks/41/addtimespent`)
    expect(JSON.parse(vues[0]!.body!)).toEqual({
      date: '2026-05-04',
      duration: 12_600,
      user_id: 7,
      note: 'Développement',
    })
  })

  it('accepte un identifiant de temps passé rendu sous forme d objet', async () => {
    const { fetchImpl } = espion(() => reponse({ id: 88 }))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    expect(
      await api.addTimeSpent({
        taskId: 41,
        dolibarrUserId: 7,
        date: '2026-05-04',
        durationSeconds: 12_600,
        note: '',
      }),
    ).toEqual({ timespentId: 88 })
  })

  it('met à jour un temps passé sur sa propre route', async () => {
    const { vues, fetchImpl } = espion(() => reponse({ success: true }))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    await api.updateTimeSpent({
      taskId: 41,
      timespentId: 88,
      date: '2026-05-04',
      durationSeconds: 3600,
      note: 'corrigé',
    })

    expect(vues[0]!.method).toBe('PUT')
    expect(vues[0]!.url).toBe(`${BASE}/tasks/41/timespent/88`)
    expect(JSON.parse(vues[0]!.body!)).toEqual({
      date: '2026-05-04',
      duration: 3600,
      note: 'corrigé',
    })
  })

  it('tolère un temps passé déjà supprimé', async () => {
    // 404 : la cible est déjà dans l'état voulu. Lever bloquerait la file sur
    // une suppression qui n'a plus rien à supprimer.
    const absent = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => reponse({ error: 'Not Found' }, 404),
    })
    await expect(absent.deleteTimeSpent({ taskId: 41, timespentId: 88 })).resolves.toBeUndefined()

    const vide = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => new Response(null, { status: 204 }),
    })
    await expect(vide.deleteTimeSpent({ taskId: 41, timespentId: 88 })).resolves.toBeUndefined()
  })

  it('supprime un temps passé sur sa propre route', async () => {
    const { vues, fetchImpl } = espion(() => reponse({ success: true }))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    await api.deleteTimeSpent({ taskId: 41, timespentId: 88 })
    expect(vues[0]!.method).toBe('DELETE')
    expect(vues[0]!.url).toBe(`${BASE}/tasks/41/timespent/88`)
  })

  it('crée une tâche rattachée à son projet', async () => {
    const { vues, fetchImpl } = espion(() => reponse(51))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    const tache = await api.createTask({ projectId: 9, label: 'Développement' })

    expect(vues[0]!.method).toBe('POST')
    expect(JSON.parse(vues[0]!.body!)).toMatchObject({ fk_project: 9, label: 'Développement' })
    expect(tache).toEqual({ id: 51, ref: 'Développement', label: 'Développement', projectId: 9 })
  })

  it('rattache les tâches lues au projet demandé', async () => {
    const { vues, fetchImpl } = espion(() =>
      reponse([{ id: 51, ref: 'TK0051', label: 'Développement' }]),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    expect(await api.listTasks(9)).toEqual([
      { id: 51, ref: 'TK0051', label: 'Développement', projectId: 9 },
    ])
    expect(vues[0]!.url).toBe(`${BASE}/projects/9/tasks`)
  })

  it('convertit les euros d une propale en centimes', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () =>
        reponse({
          id: 7,
          ref: 'PR2605-0001',
          socid: '3',
          lines: [
            { id: 1, desc: 'Développement', qty: '20', subprice: '800.10', product_type: '1' },
          ],
        }),
    })

    expect(await api.getProposal(7)).toEqual({
      id: 7,
      ref: 'PR2605-0001',
      socid: 3,
      lines: [
        { id: 1, label: 'Développement', qty: 20, subpriceCents: 80_010, service: true },
      ],
    })
  })

  it('envoie la référence du projet, que Dolibarr exige', async () => {
    const { vues, fetchImpl } = espion(() => reponse(12))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    await api.createProject({
      socid: 3,
      ref: 'CO2605-0021',
      title: 'T',
      refExt: 'BDC-9',
      description: 'd',
    })

    const corps = JSON.parse(vues[0]!.body ?? '{}') as Record<string, unknown>
    expect(corps.ref).toBe('CO2605-0021')
    expect(corps.usage_task).toBe(1)
    expect(corps.usage_bill_time).toBe(1)
    // **Ouvert, pas brouillon.** Sans statut, Dolibarr crée le projet en
    // « Brouillon », et un brouillon n'accepte aucun temps consommé : le CRA
    // part, et rien n'arrive.
    expect(corps.status).toBe(1)
  })

  it('reprend le motif de Dolibarr au lieu de le jeter', async () => {
    // « Dolibarr a refusé la requête /projects (400) » ne dit pas quel champ
    // manque : c'est un mur. Dolibarr, lui, le dit.
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () =>
        reponse({ error: { code: 400, message: 'Ref is mandatory' } }, 400),
    })

    await expect(
      api.createProject({ socid: 3, ref: 'CO-X', title: 'T', refExt: '', description: '' }),
    ).rejects.toThrow(/Ref is mandatory/)
  })

  it('reste lisible quand le refus n a pas de corps exploitable', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => new Response('pas du json', { status: 400 }),
    })

    await expect(api.listProjects()).rejects.toThrow(/refusé la requête/)
  })

  it('distingue une ligne de service d une ligne de produit', async () => {
    // Une ligne de produit vend des objets : la reprendre en prestation ferait
    // « 5 jours vendus » d'une commande de cinq t-shirts.
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () =>
        reponse({
          id: 8,
          ref: 'CO2605-0021',
          socid: '3',
          statut: '1',
          lines: [
            { id: 1, desc: 'Consultant', qty: '20', subprice: '800', product_type: '1' },
            { id: 2, desc: 'T-shirt', qty: '5', subprice: '8', product_type: '0' },
          ],
        }),
    })

    expect((await api.getOrder(8)).lines.map((l) => l.service)).toEqual([true, false])
  })

  it('lit une liste vide là où Dolibarr répond 404', async () => {
    // Dolibarr rend 404 quand une collection est vide. Le prendre pour un
    // refus ferait échouer la première synchronisation d'une instance neuve.
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => reponse({ error: { message: 'No thirdparty found' } }, 404),
    })

    expect(await api.listThirdparties()).toEqual([])
    expect(await api.listProjects()).toEqual([])
    expect(await api.listTasks(9)).toEqual([])
  })

  it('ne liste que les commandes qui restent a faire', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () =>
        reponse([
          { id: '1', ref: 'CO-VALIDEE', socid: '3', statut: '1', billed: '0' },
          { id: '2', ref: 'CO-EN-COURS', socid: '3', statut: '2', billed: '0' },
          { id: '3', ref: 'CO-LIVREE', socid: '3', statut: '3', billed: '0' },
          { id: '4', ref: 'CO-BROUILLON', socid: '3', statut: '0', billed: '0' },
          { id: '5', ref: 'CO-ANNULEE', socid: '3', statut: '-1', billed: '0' },
          { id: '6', ref: 'CO-FACTUREE', socid: '3', statut: '1', billed: '1' },
        ]),
    })

    expect((await api.listOrders()).map((c) => c.ref)).toEqual(['CO-VALIDEE', 'CO-EN-COURS'])
  })

  it('refuse une réponse qui n a pas la forme attendue', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () => reponse({ pas: 'une liste' }),
    })
    await expect(api.listProjects()).rejects.toThrow(DolibarrRequestError)
  })

  it('recolle une base d URL terminée par une barre oblique', async () => {
    const { vues, fetchImpl } = espion(() => reponse([]))
    const api = createHttpDolibarrApi({ baseUrl: `${BASE}/`, apiKey: 'k', fetchImpl })

    await api.listThirdparties()
    expect(vues[0]!.url).toBe(`${BASE}/thirdparties?limit=1000`)
  })

  it('laisse le projet sans tiers quand Dolibarr n en rattache aucun', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () =>
        reponse([{ id: 1, ref: 'PJ001', title: 'Interne', socid: '0', usage_bill_time: 1 }]),
    })
    expect((await api.listProjects())[0]!.socid).toBeNull()
  })
})
