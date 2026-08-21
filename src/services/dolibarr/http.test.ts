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
    const { vues, fetchImpl } = espion((vue) =>
      vue.url.endsWith('/addtimespent')
        ? reponse({ success: { code: 200, message: 'Time spent added' } })
        : reponse([
            {
              timespent_line_id: 88,
              timespent_line_fk_user: 7,
              timespent_line_duration: 12_600,
              timespent_line_note: 'Développement',
            },
          ]),
    )
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
      date: '2026-05-04 00:00:00',
      duration: 12_600,
      user_id: 7,
      note: 'Développement',
    })
  })

  // Le temps **est** enregistré chez Dolibarr quand on arrive ici : le POST a
  // réussi, seule la relecture n'a rien reconnu. La levée doit donc être un
  // refus et non une panne — un `DolibarrUnavailableError` ferait rejouer la
  // file, et le rejeu poserait un **second** temps, la route de création
  // n'étant pas idempotente.
  it('refuse sans rejeu quand la ligne posée reste introuvable', async () => {
    const { fetchImpl } = espion((vue) =>
      vue.url.endsWith('/addtimespent')
        ? reponse({ success: { code: 200, message: 'Time spent added' } })
        : reponse([]),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    const echec = api.addTimeSpent({
      taskId: 41,
      dolibarrUserId: 7,
      date: '2026-05-04',
      durationSeconds: 12_600,
      note: 'Développement',
    })

    await expect(echec).rejects.toBeInstanceOf(DolibarrRequestError)
    // Le message doit dire que le temps est passé, sinon on le ressaisira.
    await expect(echec).rejects.toThrow(/enregistré/)
  })

  // `POST /tasks/{id}/addtimespent` ne rend **pas** l'identifiant de la ligne
  // créée : son corps est `{success:{code,message}}`, en 23.0.1 comme en 23.0.4
  // — vérifié dans le code de l'API. Le connecteur relit donc la tâche pour
  // retrouver la ligne qu'il vient de poser.
  it('relit la ligne posée pour connaître son identifiant, que Dolibarr ne rend pas', async () => {
    const { vues, fetchImpl } = espion((vue) =>
      vue.url.endsWith('/addtimespent')
        ? reponse({ success: { code: 200, message: 'Time spent added' } })
        : reponse([
            {
              timespent_line_id: 12,
              timespent_line_fk_user: 7,
              timespent_line_duration: 3_600,
              timespent_line_note: 'Autre chose',
            },
            {
              timespent_line_id: 91,
              timespent_line_fk_user: 7,
              timespent_line_duration: 12_600,
              timespent_line_note: 'Développement',
            },
          ]),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    const { timespentId } = await api.addTimeSpent({
      taskId: 41,
      dolibarrUserId: 7,
      date: '2026-05-04',
      durationSeconds: 12_600,
      note: 'Développement',
    })

    expect(timespentId).toBe(91)
    expect(vues[1]!.method).toBe('GET')
    expect(vues[1]!.url).toBe(`${BASE}/tasks/41/timespent`)
  })

  // Deux saisies rigoureusement identiques le même jour sont légitimes — une
  // matinée notée deux fois, par exemple. La signature ne les distingue pas :
  // c'est le `rowid` qui tranche, et le plus grand est celui qu'on vient de
  // poser, puisque Dolibarr l'incrémente. Prendre le premier venu lierait la
  // cellule à la ligne de quelqu'un d'autre, et la modifierait à sa place.
  // Chaque leurre porte un `rowid` **plus grand** que la ligne cherchée et ne
  // s'en écarte que par un seul champ. Sans cela un filtre pourrait disparaître
  // sans que rien ne le signale : le plus grand `rowid` retomberait sur la
  // bonne ligne par accident. Ici, laisser tomber l'utilisateur, la durée ou la
  // note désigne un temps qui n'est pas le nôtre — et le modifier plus tard
  // écraserait la saisie d'un autre.
  it('écarte les lignes qui diffèrent par un seul champ, fût-ce la plus récente', async () => {
    const { fetchImpl } = espion((vue) =>
      vue.url.endsWith('/addtimespent')
        ? reponse({ success: { code: 200, message: 'Time spent added' } })
        : reponse([
            {
              timespent_line_id: 91,
              timespent_line_fk_user: 7,
              timespent_line_duration: 12_600,
              timespent_line_note: 'Développement',
            },
            // même note, autre durée
            {
              timespent_line_id: 200,
              timespent_line_fk_user: 7,
              timespent_line_duration: 3_600,
              timespent_line_note: 'Développement',
            },
            // même durée, autre note
            {
              timespent_line_id: 300,
              timespent_line_fk_user: 7,
              timespent_line_duration: 12_600,
              timespent_line_note: 'Autre chose',
            },
            // tout pareil, mais un autre utilisateur
            {
              timespent_line_id: 400,
              timespent_line_fk_user: 9,
              timespent_line_duration: 12_600,
              timespent_line_note: 'Développement',
            },
          ]),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    const { timespentId } = await api.addTimeSpent({
      taskId: 41,
      dolibarrUserId: 7,
      date: '2026-05-04',
      durationSeconds: 12_600,
      note: 'Développement',
    })

    expect(timespentId).toBe(91)
  })

  it('retient la ligne la plus récente quand deux sont indiscernables', async () => {
    const { fetchImpl } = espion((vue) =>
      vue.url.endsWith('/addtimespent')
        ? reponse({ success: { code: 200, message: 'Time spent added' } })
        : reponse([
            {
              timespent_line_id: 40,
              timespent_line_fk_user: 7,
              timespent_line_duration: 12_600,
              timespent_line_note: 'Développement',
            },
            {
              timespent_line_id: 91,
              timespent_line_fk_user: 7,
              timespent_line_duration: 12_600,
              timespent_line_note: 'Développement',
            },
          ]),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    const { timespentId } = await api.addTimeSpent({
      taskId: 41,
      dolibarrUserId: 7,
      date: '2026-05-04',
      durationSeconds: 12_600,
      note: 'Développement',
    })

    expect(timespentId).toBe(91)
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
      date: '2026-05-04 00:00:00',
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

    const tache = await api.createTask({
      projectId: 9,
      label: 'Développement',
      plannedWorkloadSeconds: null,
    })

    expect(vues[0]!.method).toBe('POST')
    expect(JSON.parse(vues[0]!.body!)).toMatchObject({ fk_project: 9, label: 'Développement' })
    expect(tache).toEqual({
      id: 51,
      ref: 'Développement',
      label: 'Développement',
      projectId: 9,
      plannedWorkloadSeconds: null,
    })
  })

  // Sans statut, Dolibarr retient `STATUS_DRAFT = 0` : la tâche naît en
  // brouillon, et une tâche brouillon n'est pas exploitable dans le projet.
  it('crée la tâche validée, jamais en brouillon', async () => {
    const { vues, fetchImpl } = espion(() => reponse(51))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    await api.createTask({ projectId: 9, label: 'Développement', plannedWorkloadSeconds: null })

    expect(JSON.parse(vues[0]!.body!)).toMatchObject({ status: 1 })
  })

  // `planned_workload` est stocké en **secondes** — vérifié dans
  // `projet/tasks/task.php`, qui compose `heures × 3600 + minutes × 60` et
  // relit par `convertSecondToTime`. Envoyer des heures y écrirait une charge
  // 3 600 fois trop petite, sans que rien ne le signale.
  it('envoie la charge prévue en secondes', async () => {
    const { vues, fetchImpl } = espion((vue) =>
      vue.url.endsWith('/contacts') && vue.method === 'GET' ? reponse([]) : reponse(51),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    // 5 jours vendus sur une journée de 7 h : 5 × 7 × 3600 = 126 000 s.
    await api.createTask({
      projectId: 9,
      label: 'Développement',
      plannedWorkloadSeconds: 126_000,
    })

    expect(JSON.parse(vues[0]!.body!)).toMatchObject({ planned_workload: 126_000 })
  })

  it("omet la charge prévue quand la prestation n'en porte pas", async () => {
    const { vues, fetchImpl } = espion((vue) =>
      vue.url.endsWith('/contacts') && vue.method === 'GET' ? reponse([]) : reponse(51),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    await api.createTask({ projectId: 9, label: 'X', plannedWorkloadSeconds: null })

    expect(JSON.parse(vues[0]!.body!)).not.toHaveProperty('planned_workload')
  })

  it("affecte l'utilisateur de la clé à la tâche créée, comme responsable", async () => {
    const { vues, fetchImpl } = espion((vue) =>
      vue.url.endsWith('/contacts') && vue.method === 'GET' ? reponse([]) : reponse(51),
    )
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      dolibarrUserId: 7,
      fetchImpl,
    })

    await api.createTask({ projectId: 9, label: 'Développement', plannedWorkloadSeconds: null })

    expect(vues[2]!.method).toBe('POST')
    expect(vues[2]!.url).toBe(`${BASE}/tasks/51/contacts`)
    expect(JSON.parse(vues[2]!.body!)).toEqual({
      fk_socpeople: 7,
      type_contact: 'TASKEXECUTIVE',
      source: 'internal',
    })
  })

  it('rattache les tâches lues au projet demandé', async () => {
    const { vues, fetchImpl } = espion(() =>
      reponse([{ id: 51, ref: 'TK0051', label: 'Développement' }]),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    expect(await api.listTasks(9)).toEqual([
      {
        id: 51,
        ref: 'TK0051',
        label: 'Développement',
        projectId: 9,
        // Absente de la réponse : la tâche ne porte pas de charge, elle n'en
        // porte pas **zéro**. C'est la reprise qui en dépend.
        plannedWorkloadSeconds: null,
      },
    ])
    expect(vues[0]!.url).toBe(`${BASE}/projects/9/tasks`)
  })

  // La reprise des tâches en prestations en tire les jours vendus : une charge
  // perdue à la lecture ferait naître des prestations sans engagement, et un
  // reste à consommer faux sur toute la mission.
  it('rapporte la charge prévue des tâches lues, en secondes', async () => {
    const { fetchImpl } = espion(() =>
      reponse([
        { id: 51, ref: 'TK0051', label: 'Développement', planned_workload: '126000' },
        { id: 52, ref: 'TK0052', label: 'Recette', planned_workload: '0' },
      ]),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    const taches = await api.listTasks(9)
    expect(taches[0]!.plannedWorkloadSeconds).toBe(126_000)
    // `'0'` chez Dolibarr veut dire « colonne vide », pas « charge nulle ».
    expect(taches[1]!.plannedWorkloadSeconds).toBeNull()
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
        {
          id: 1,
          label: 'Développement',
          qty: 20,
          subpriceCents: 80_010,
          service: true,
          dateStart: null,
        },
      ],
    })
  })

  // Dolibarr rend les dates en horodatage Unix. Les lignes de service portent
  // la période vendue (`date_start` / `date_end` de `llx_commandedet`) ; c'est
  // d'elle que le projet tire sa date de démarrage.
  it('reprend la période vendue des lignes de service', async () => {
    const { fetchImpl } = espion(() =>
      reponse({
        id: 7,
        ref: 'CO2605-0021',
        socid: '3',
        lines: [
          {
            id: 1,
            desc: 'Conseil',
            qty: '10',
            subprice: '800',
            product_type: '1',
            date_start: Date.UTC(2026, 8, 1) / 1000,
          },
          { id: 2, desc: 'Matériel', qty: '1', subprice: '50', product_type: '0', date_start: '' },
        ],
      }),
    )
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    const commande = await api.getOrder(7)
    expect(commande.lines.map((l) => l.dateStart)).toEqual(['2026-09-01', null])
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
      dateStart: null,
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

  // Sans cette affectation, `GET /projects/{id}/tasks` ne rend **rien** : le
  // projet est privé et l'utilisateur de la clé n'y a aucun rôle. Le connecteur
  // croit alors la tâche absente, la recrée, et Dolibarr refuse par
  // « Error creating task » puisque la référence est déjà prise.
  it("affecte l'utilisateur de la clé au projet créé, comme chef de projet", async () => {
    const { vues, fetchImpl } = espion((vue) => {
      if (vue.url.endsWith('/projects')) return reponse(12)
      // La lecture des contacts existants précède l'écriture : l'affectation
      // n'est pas idempotente chez Dolibarr.
      if (vue.url.endsWith('/contacts') && vue.method === 'GET') return reponse([])
      return reponse({ id: 12, ref: 'PJ2608-0007' })
    })
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      dolibarrUserId: 7,
      fetchImpl,
    })

    await api.createProject({
      socid: 3,
      ref: 'CO2605-0021',
      title: 'T',
      refExt: '',
      description: '',
      dateStart: null,
    })

    expect(vues[2]!.method).toBe('POST')
    expect(vues[2]!.url).toBe(`${BASE}/projects/12/contacts`)
    expect(JSON.parse(vues[2]!.body!)).toEqual({
      fk_socpeople: 7,
      type_contact: 'PROJECTLEADER',
      source: 'internal',
    })
  })

  // Sans identifiant d'utilisateur configuré, il n'y a personne à affecter :
  // le projet doit tout de même se créer, sans appel supplémentaire.
  // `Project::create` passe la valeur à `$this->db->idate()`, qui attend un
  // **horodatage Unix en secondes**. Une chaîne « 2026-09-01 » y produirait une
  // date fausse, silencieusement.
  it('envoie la date de démarrage en horodatage Unix, pas en chaîne', async () => {
    const { vues, fetchImpl } = espion(() => reponse({ id: 12, ref: 'PJ2608-0007' }))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    await api.createProject({
      socid: 3,
      ref: 'R',
      title: 'T',
      refExt: '',
      description: '',
      dateStart: '2026-09-01',
    })

    const corps = JSON.parse(vues[0]!.body!) as Record<string, unknown>
    expect(corps.date_start).toBe(Date.UTC(2026, 8, 1) / 1000)
  })

  it('omet la date de démarrage quand la mission n en porte pas', async () => {
    const { vues, fetchImpl } = espion(() => reponse({ id: 12, ref: 'PJ2608-0007' }))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    await api.createProject({
      socid: 3,
      ref: 'R',
      title: 'T',
      refExt: '',
      description: '',
      dateStart: null,
    })

    expect(JSON.parse(vues[0]!.body!)).not.toHaveProperty('date_start')
  })

  // **Mesuré sur l'instance du porteur.** `add_contact` rend `0` quand le
  // contact est déjà posé, et l'API traduit ce `0` en **500**. Réaffecter
  // quelqu'un qui l'est déjà fait donc échouer l'appel — ce qui arrivait à
  // chaque réparation sur un projet neuf, dont la liste de tâches est
  // légitimement vide.
  it("n'affecte pas deux fois quelqu'un qui l'est déjà", async () => {
    const { vues, fetchImpl } = espion((vue) =>
      vue.url.endsWith('/contacts')
        ? reponse([{ id: 7, code: 'PROJECTLEADER', source: 'internal' }])
        : reponse({ id: 12 }),
    )
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      dolibarrUserId: 7,
      fetchImpl,
    })

    await api.assignerAuProjet(12)

    expect(vues.map((v) => `${v.method} ${v.url}`)).toEqual([
      `GET ${BASE}/projects/12/contacts`,
    ])
  })

  it("affecte quand personne ne l'est encore", async () => {
    const { vues, fetchImpl } = espion((vue) =>
      vue.url.endsWith('/contacts') && (vue.method === 'GET' || vue.method === undefined)
        ? reponse([])
        : reponse({ success: { code: 200 } }),
    )
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      dolibarrUserId: 7,
      fetchImpl,
    })

    await api.assignerAuProjet(12)

    expect(vues.map((v) => v.method)).toEqual(['GET', 'POST'])
  })

  it("n'affecte personne quand l'identifiant utilisateur n'est pas renseigné", async () => {
    const { vues, fetchImpl } = espion(() => reponse({ id: 12, ref: 'PJ2608-0007' }))
    const api = createHttpDolibarrApi({ baseUrl: BASE, apiKey: 'k', fetchImpl })

    await api.createProject({ socid: 3, ref: 'R', title: 'T', refExt: '', description: '', dateStart: null })

    expect(vues.map((v) => v.url)).toEqual([`${BASE}/projects`, `${BASE}/projects/12`])
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
      api.createProject({ socid: 3, ref: 'CO-X', title: 'T', refExt: '', description: '', dateStart: null }),
    ).rejects.toThrow(/Ref is mandatory/)
  })

  it('reprend aussi le motif d une panne, pour savoir quoi rejouer', async () => {
    // Un 500 reste rejouable, mais il peut cacher une charge utile que
    // Dolibarr n'a pas su traiter : la file rejoue alors la même
    // indéfiniment, et sans sa phrase on ne sait jamais laquelle.
    const api = createHttpDolibarrApi({
      baseUrl: BASE,
      apiKey: 'k',
      fetchImpl: async () =>
        reponse({ error: { code: 500, message: 'Call to a member function on null' } }, 500),
    })

    const appel = () =>
      api.createTask({ projectId: 3, label: 'X', plannedWorkloadSeconds: null })
    await expect(appel()).rejects.toThrow(/Call to a member function/)
    await expect(appel()).rejects.toThrow(DolibarrUnavailableError)
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

describe('un 500 sans JSON', () => {
  it("reprend le texte de la page d'erreur au lieu de se taire", async () => {
    const api = createHttpDolibarrApi({
      baseUrl: 'https://exemple.test/api/index.php',
      apiKey: 'k',
      fetchImpl: async () =>
        new Response('<b>Fatal error</b>: Uncaught Error in task.class.php:1234', {
          status: 500,
        }),
    })

    await expect(api.listThirdparties()).rejects.toThrow(/Fatal error.*task\.class\.php:1234/)
  })
})

describe("la date d'un temps passé", () => {
  it("part au format horodaté que l'API exige, jamais en date nue", async () => {
    const envoyes: string[] = []
    const api = createHttpDolibarrApi({
      baseUrl: 'https://exemple.test/api/index.php',
      apiKey: 'k',
      fetchImpl: async (_url, init) => {
        const methode = (init as RequestInit).method ?? 'GET'
        if (methode === 'GET') {
          // La relecture de la tâche : elle rend la ligne qu'on vient de poser.
          return new Response(
            JSON.stringify([
              {
                timespent_line_id: 12,
                timespent_line_fk_user: 1,
                timespent_line_duration: 25_200,
                timespent_line_note: '',
              },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        envoyes.push(String((init as RequestInit).body))
        return new Response(JSON.stringify({ success: { code: 200 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    await api.addTimeSpent({
      taskId: 7,
      dolibarrUserId: 1,
      date: '2026-08-03',
      durationSeconds: 25200,
      note: '',
    })
    await api.updateTimeSpent({
      taskId: 7,
      timespentId: 12,
      date: '2026-08-03',
      durationSeconds: 25200,
      note: '',
    })

    expect(envoyes).toHaveLength(2)
    for (const corps of envoyes) {
      expect(JSON.parse(corps).date).toBe('2026-08-03 00:00:00')
    }
  })
})
