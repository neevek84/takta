# Lot 6 — Documentation · plan d'implémentation

**Date :** 2026-08-16
**Spec source :** `docs/superpowers/specs/2026-08-16-lot-6-documentation-design.md`
**Position :** lot final. Il documente le produit fini.
**Tâches :** 14.

---

## 0. Ce que ce lot livre, et pourquoi dans cet ordre

Le porteur veut **savoir où sont les appels aux API externes, quels paramètres chacun porte, et comment les mettre à jour**. Un chapitre en prose répondrait à la question aujourd'hui et mentirait dans trois mois.

Le lot livre donc, dans l'ordre :

1. **un catalogue en code**, à côté de chaque connecteur (`src/integrations/<système>/catalogue.ts`) ;
2. **trois tests qui l'empêchent de mentir** — aucun appel non catalogué, aucune entrée non prouvée, aucun écart entre le document publié et le catalogue ;
3. **une procédure de montée de version** adossée au test d'intégration sur instance jetable du lot 2 ;
4. **la documentation des trois publics** — qui déploie, qui reprend le code, le porteur — obtenue en **répartissant `ETAT.md` puis en la retirant**.

La règle qui borne tout : **on ne documente que ce que le code ne peut pas dire.** Une phrase qui paraphrase une signature ne s'écrit pas.

---

## 1. Contraintes globales, à porter dans chaque tâche

Elles ne sont pas rappelées à chaque étape ; elles s'appliquent partout.

- `src/core/` **n'importe jamais** `@prisma/client`, `next`, ni React. Les modules de catalogue et de génération posés en `src/core/integrations/` sont purs : types, chaînes, tableaux, `node:fs` **interdit** (la lecture de fichier vit dans le test, jamais dans le module).
- Seule `src/services/` touche la base, scopée par `userId`. **Aucune tâche de ce lot ne touche la base.**
- Aucun enum Prisma, aucun décimal, aucun tableau en base, aucune requête fine sur du JSON. Entiers partout.
- **Aucun secret, aucun jeton, aucune clé** dans la documentation ni dans le catalogue. Les valeurs d'exemple sont manifestement factices, et la tâche 1 pose la règle qui le vérifie par calcul.
- **Français** pour la documentation et les chaînes visibles, **anglais** pour le code. Les identifiants de type et de fonction de ce lot sont en français quand ils nomment du domaine documentaire (`AppelExterne`, `verifierCatalogue`) — c'est la convention déjà tenue par `src/services/dolibarr/` et `src/core/dolibarr/`, on ne l'ouvre pas ici.
- Tests de composants : `// @vitest-environment happy-dom` en **première** ligne, `afterEach(cleanup)` explicite. `jsdom` ne fonctionne pas dans cet environnement. **Aucune tâche de ce lot n'écrit de test de composant** — la contrainte est rappelée pour qui ajouterait un écran.
- Chaque exécution de vitest a sa propre base (`vitest.globalSetup.ts`, nommée d'après le PID). Ne pas y toucher.
- Chaque tâche suit : **écrire le test qui échoue → le voir échouer → implémenter le minimum → le voir passer → vérifier par mutation.** La mutation est écrite noir sur blanc dans chaque tâche ; elle doit faire **rougir** le test, puis être annulée.
- Ne rien committer sans que `npx vitest run` et `npx tsc --noEmit` soient verts.

---

## 2. Décisions tranchées dans ce plan

À contester si elles ne conviennent pas.

**D1 — Le catalogue vit en `src/integrations/<système>/`, le client HTTP Dolibarr reste où il est.**
La spec place le catalogue « à côté du connecteur ». Google est déjà là (`src/integrations/google/`) ; le client Dolibarr, lui, vit en `src/services/dolibarr/http.ts`. Le déplacer serait un remaniement d'imports sans rapport avec ce lot. On crée donc `src/integrations/dolibarr/` qui porte **le catalogue et le double d'API sévère au niveau HTTP**, exactement comme `src/integrations/google/` — et le lien entre les deux est tenu par un test, pas par la proximité de dossier. `src/services/dolibarr/fake.ts` reste en place : c'est un double **du port**, pas de l'API, et il ne voit passer aucune URL.

**D2 — L'identité d'une entrée est le couple `(méthode, gabarit)`, et rien d'autre.**
C'est tout ce qu'un double peut observer d'une requête sans inspecter son corps. Conséquence assumée : l'échange et le renouvellement de jeton Google, qui frappent la même route avec deux `grant_type`, forment **une seule entrée**, dont la ligne de paramètre `grant_type` porte les deux valeurs. Un discriminant sur le corps existerait pour ce seul cas et compliquerait les trois tests.

**D3 — La redirection de consentement Google est cataloguée, mais hors couverture.**
`GET https://accounts.google.com/o/oauth2/v2/auth` n'est jamais émise par le serveur : c'est le navigateur qui y va. Ses paramètres (`scope`, `access_type`, `prompt`) sont pourtant exactement ce qu'il faut savoir quand Google change ses règles de consentement. Elle porte donc `emis: false`, apparaît au document, et est exclue des tests de route et de couverture.

**D4 — Le double refuse une route non cataloguée en *levant*, jamais en rendant 404.**
Un 404 est traduit par le connecteur Google en `NOT_FOUND`, que `deleteEvent` **avale** délibérément. Un refus par 404 laisserait donc un appel non catalogué passer au vert sur ce chemin précis. Le refus lève une erreur qui nomme le fichier de catalogue à compléter.

**D5 — La génération s'exécute par vitest, pas par un script Node.**
Node ne lit pas TypeScript ici, et le projet n'embarque ni `tsx` ni `ts-node` ; en ajouter un pour engendrer un fichier Markdown serait une dépendance de plus à maintenir. `npm run doc:integrations` lance donc le test de non-divergence avec `CRA_DOC_ECRIRE=1`, qui réécrit `docs/integrations.md` au lieu de comparer. Limite connue : la forme `VAR=1 vitest` ne marche pas sous `cmd.exe`. Le poste de développement du projet est un shell POSIX ; l'archive portable, elle, n'engendre rien.

**D6 — Le document engendré ne porte aucune date de génération.**
Une date de génération ferait échouer le test de non-divergence dès le lendemain. Les dates qui comptent sont **dans le catalogue**, entrée par entrée : ce sont des dates de preuve, pas d'écriture.

**D7 — Le test des commandes d'installation est statique, et la vérification sur machine vierge reste manuelle.**
La spec veut que « les commandes du chapitre d'installation s'exécutent sur une machine qui n'a jamais vu le projet ». Docker n'est pas installé dans cet environnement et aucune CI n'y est branchée : prétendre l'automatiser ici produirait un test qui ne prouve rien. On livre donc (a) un test statique qui échoue si un `npm run X` du README n'existe pas dans `package.json` ou si un `node scripts/Y.mjs` désigne un fichier absent — c'est la rouille qui arrive vraiment — et (b) une liste de vérification explicitement manuelle, datée, dans le README.

**D8 — Sur `TIMESHEET_DAY_DURATION`, le plan suit le code et `ETAT.md`, pas la spec.**
La spec §5 écrit que ce réglage « rend les temps poussés faux d'un septième si on l'ignore ». **C'est faux**, et `ETAT.md` §9 corrige explicitement cette affirmation (commit `bafbf93`), confirmée par `src/core/dolibarr/timespent.ts` : `duration` est un nombre de **secondes**, huit heures valent 28 800 secondes quel que soit le réglage. Ce que le réglage change est **l'affichage jour/heure dans Dolibarr** — huit heures s'y lisent « 1,14 jour ». Cela **s'aligne** (écran Administration · Dolibarr, `previewDolibarrSetup`), cela ne se compense pas. La tâche 10 écrit l'encadré dans ce sens et le teste dans les deux directions.

**D9 — `ETAT.md` est répartie puis supprimée du dépôt.**
Comme la spec le demande. Les specs et les plans restent où ils sont : documents de travail, jamais réécrits en documentation. Le chapitre des décisions y renvoie par chemin relatif.

**D10 — Le test de couverture pilote le client HTTP, pas les services.**
Ce que le catalogue décrit, ce sont des requêtes HTTP. Le seul niveau où elles existent est le client (`createHttpDolibarrApi`, `createGoogleCalendarConnector`, `oauth.ts`). Piloter les services demanderait une base peuplée pour prouver une entrée de catalogue — un couplage sans contrepartie.

---

## 3. Répartition d'`ETAT.md`

Table de destination, à tenir pendant les tâches 11 à 13. Ce qui n'a plus de destinataire disparaît.

| Section d'`ETAT.md` | Destination | Tâche |
|---|---|---|
| §1 Ce qu'est ce produit | `README.md` (intro) et `docs/decisions.md` (préambule) | 13, 12 |
| §2 Les décisions qui ne se rouvrent pas | `docs/decisions.md` | 12 |
| §3 Les règles métier | `docs/reprise-du-code.md` | 11 |
| §4 État du code (tests, lots fusionnés) | **disparaît** — périmé par construction, `npx vitest run` le dit mieux | — |
| §5 Ce qui reste (lots, dépendances croisées) | **disparaît**, sauf la note `CREDENTIALS_KEY` → vérifier qu'elle est bien portée par `README.md` | 13 |
| §6 Méthode de travail | `docs/reprise-du-code.md` | 11 |
| §7 Pièges d'environnement | `docs/reprise-du-code.md` | 11 |
| §8 Dettes connues | `docs/decisions.md` | 12 |
| §9 Environnement du porteur — Dolibarr 23.0.1, `TIMESHEET_DAY_DURATION` | `docs/integrations.md` **par le catalogue et la prose de `chapitre.ts`** | 2, 10 |
| §9 Environnement du porteur — client OAuth, Documenso, n8n, identité de marque | `docs/decisions.md` | 12 |
| §9 bis Arbitrages du 16 août | `docs/decisions.md` | 12 |
| §10 Ce que le porteur a demandé en dernier | **disparaît** — daté, sans valeur dans six mois | — |

---

## 4. Ordre et parallélisme

```
T1
├── T2 ──> T5 ──> T6
├── T3 ──> T4 ──> T7
└── T8
T2 + T3 + T8 ──> T9 ──> T10 ──> T11 ┐
                                T13 ┼──> T12 ──> T14
```

T2 et T3 se parallélisent. T4/T5, puis T6/T7, se parallélisent par système. T11 et T13 se parallélisent (fichiers disjoints), **T12 vient après elles** parce qu'elle supprime `ETAT.md`, que les deux lisent. T14 vient en dernier : elle vérifie l'ensemble.

---

## Tâche 1 — Le type du catalogue et ses règles de forme

**But.** Poser, en domaine pur, ce qu'est une entrée de catalogue, ce qui la rend valide, comment on rapproche une URL réelle d'un gabarit, et comment on compare l'observé au catalogué. Les trois tests du lot s'appuient tous sur ce module.

**Fichiers créés**
- `src/core/integrations/catalogue.ts`
- `src/core/integrations/catalogue.test.ts`

**Interfaces consommées.** Aucune.

**Interfaces produites.**
`MethodeHttp`, `SourceValeur`, `ParametreAppel`, `ComportementEchec`, `PreuveAppel`, `AppelExterne`, `CatalogueSysteme`, `cleAppel`, `verifierCatalogue`, `gabaritCorrespondant`, `comparerCouverture`, `ressembleAUnSecret`.

### Étapes

**1. Écrire le test qui échoue** — `src/core/integrations/catalogue.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  cleAppel,
  comparerCouverture,
  gabaritCorrespondant,
  ressembleAUnSecret,
  verifierCatalogue,
  type CatalogueSysteme,
} from './catalogue'

const APPEL = {
  operation: 'Pousser un temps consommé sur une tâche',
  methode: 'POST' as const,
  gabarit: '/tasks/{taskId}/addtimespent',
  emis: true,
  emisPar: 'src/services/dolibarr/http.ts · addTimeSpent',
  parametres: [
    {
      nom: 'duration',
      source: 'CALCUL' as const,
      origine: 'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads',
      exemple: '28800',
    },
  ],
  preuve: { version: '23.0.1', date: '2026-08-16', moyen: 'DOUBLE' as const },
  echec: { comportement: 'REJOUE' as const, visible: 'La file rejoue ; l écran compte l échec.' },
  reglagesTiers: ['TIMESHEET_DAY_DURATION'],
}

const CATALOGUE: CatalogueSysteme = {
  systeme: 'Dolibarr',
  base: "{URL de l'instance}/api/index.php",
  appels: [APPEL],
}

describe('forme du catalogue', () => {
  it('accepte un catalogue complet', () => {
    expect(verifierCatalogue(CATALOGUE, '2026-08-16')).toEqual([])
  })

  it('refuse une date de preuve mal formée', () => {
    const casse = { ...CATALOGUE, appels: [{ ...APPEL, preuve: { ...APPEL.preuve, date: '16/08/2026' } }] }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      "POST /tasks/{taskId}/addtimespent : la date de preuve « 16/08/2026 » n'est pas au format AAAA-MM-JJ.",
    ])
  })

  it('refuse une date de preuve dans le futur', () => {
    const casse = { ...CATALOGUE, appels: [{ ...APPEL, preuve: { ...APPEL.preuve, date: '2026-09-01' } }] }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      'POST /tasks/{taskId}/addtimespent : la date de preuve 2026-09-01 est postérieure à 2026-08-16.',
    ])
  })

  it('refuse une version de preuve vide', () => {
    const casse = { ...CATALOGUE, appels: [{ ...APPEL, preuve: { ...APPEL.preuve, version: '' } }] }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      'POST /tasks/{taskId}/addtimespent : aucune version de preuve.',
    ])
  })

  it('refuse une opération qui récite la route au lieu de la dire en métier', () => {
    const casse = { ...CATALOGUE, appels: [{ ...APPEL, operation: 'POST /tasks/{id}/addtimespent' }] }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      "POST /tasks/{taskId}/addtimespent : l'opération doit se dire en langage métier, pas en méthode et chemin.",
    ])
  })

  it('refuse un paramètre sans origine', () => {
    const casse = {
      ...CATALOGUE,
      appels: [{ ...APPEL, parametres: [{ ...APPEL.parametres[0]!, origine: '  ' }] }],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      "POST /tasks/{taskId}/addtimespent : le paramètre « duration » ne dit pas d'où vient sa valeur.",
    ])
  })

  it('refuse deux entrées de même méthode et même gabarit', () => {
    const casse = { ...CATALOGUE, appels: [APPEL, { ...APPEL, operation: 'Autre chose' }] }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      'POST /tasks/{taskId}/addtimespent : deux entrées portent le même couple méthode et chemin.',
    ])
  })

  it('refuse un exemple qui ressemble à un secret', () => {
    const casse = {
      ...CATALOGUE,
      appels: [
        {
          ...APPEL,
          parametres: [{ ...APPEL.parametres[0]!, exemple: 'ya29.A0ARrdaM9kQq3xVbN7tLpZ' }],
        },
      ],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      'POST /tasks/{taskId}/addtimespent : le paramètre « duration » porte un exemple qui ressemble à un secret.',
    ])
  })

  it('refuse un exemple trop long pour être une illustration', () => {
    const casse = {
      ...CATALOGUE,
      appels: [
        { ...APPEL, parametres: [{ ...APPEL.parametres[0]!, exemple: 'x'.repeat(41) }] },
      ],
    }
    expect(verifierCatalogue(casse, '2026-08-16')[0]).toContain('exemple de plus de 40 caractères')
  })
})

describe('reconnaissance des secrets', () => {
  it.each([
    'ya29.A0ARrdaM9kQq3xVbN7tLpZ',
    '1//04dXfKq2mZpLrTvYnB8sQ9wE3',
    'aGVsbG9Xb3JsZFRoaXNJc0FMb25nQmFzZTY0VmFsdWU9',
    '9f8c1d2e3a4b5c6d7e8f9a0b1c2d3e4f',
  ])('reconnaît %s', (valeur) => {
    expect(ressembleAUnSecret(valeur)).toBe(true)
  })

  it.each(['28800', '2026-04-13', 'Client Exemple', 'Europe/Paris', 'CRA — disponibilités'])(
    'laisse passer %s',
    (valeur) => {
      expect(ressembleAUnSecret(valeur)).toBe(false)
    },
  )
})

describe('rapprochement d une URL et d un gabarit', () => {
  const base = 'https://erp.invalide.test/api/index.php'

  it('rapproche un chemin paramétré', () => {
    const trouve = gabaritCorrespondant({
      catalogue: CATALOGUE,
      base,
      methode: 'POST',
      url: `${base}/tasks/17/addtimespent`,
    })
    expect(trouve?.gabarit).toBe('/tasks/{taskId}/addtimespent')
  })

  it('ignore la chaîne de requête', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, methode: 'GET', gabarit: '/thirdparties' }],
    }
    expect(
      gabaritCorrespondant({ catalogue: c, base, methode: 'GET', url: `${base}/thirdparties?limit=1000` }),
    ).not.toBeNull()
  })

  it('ne confond pas deux chemins de même forme', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, methode: 'GET', gabarit: '/tasks' }],
    }
    expect(
      gabaritCorrespondant({ catalogue: c, base, methode: 'GET', url: `${base}/projects/3/tasks` }),
    ).toBeNull()
  })

  it('rapproche un gabarit absolu', () => {
    const c: CatalogueSysteme = {
      systeme: 'Google',
      base: 'https://www.googleapis.com/calendar/v3',
      appels: [{ ...APPEL, methode: 'POST', gabarit: 'https://oauth2.googleapis.com/token' }],
    }
    expect(
      gabaritCorrespondant({
        catalogue: c,
        base: c.base,
        methode: 'POST',
        url: 'https://oauth2.googleapis.com/token',
      }),
    ).not.toBeNull()
  })

  it('ne rapproche jamais une entrée non émise', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, emis: false, methode: 'GET', gabarit: '/thirdparties' }],
    }
    expect(
      gabaritCorrespondant({ catalogue: c, base, methode: 'GET', url: `${base}/thirdparties` }),
    ).toBeNull()
  })
})

describe('couverture', () => {
  it('nomme les entrées que rien n exerce', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [APPEL, { ...APPEL, methode: 'GET', gabarit: '/proposals/{proposalId}' }],
    }
    expect(comparerCouverture({ catalogue: c, observes: [cleAppel(APPEL)] })).toEqual({
      manquants: ['GET /proposals/{proposalId}'],
      inconnus: [],
    })
  })

  it('ignore les entrées non émises', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [APPEL, { ...APPEL, emis: false, methode: 'GET', gabarit: '/consentement' }],
    }
    expect(comparerCouverture({ catalogue: c, observes: [cleAppel(APPEL)] }).manquants).toEqual([])
  })
})
```

**2. Le voir échouer** — `npx vitest run src/core/integrations/catalogue.test.ts`. Le module n'existe pas.

**3. Implémenter le minimum** — `src/core/integrations/catalogue.ts` :

```ts
/**
 * Ce qu'un appel à une API externe déclare de lui-même.
 *
 * Domaine pur : ni Prisma, ni Next, ni React, ni `node:fs`. La lecture d'un
 * fichier vit dans les tests et dans la génération, jamais ici.
 *
 * Le champ qui sert vraiment est `origine` : quand un système tiers change le
 * format d'un champ, la question n'est pas de retrouver l'appel, c'est de
 * savoir quoi recalculer pour le remplir autrement.
 */

export type MethodeHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** D'où vient la valeur d'un paramètre. */
export type SourceValeur =
  /** un réglage de l'application, modifiable par l'utilisateur */
  | 'REGLAGE'
  /** une valeur saisie par l'utilisateur */
  | 'SAISIE'
  /** dérivée par le domaine à partir d'autre chose */
  | 'CALCUL'
  /** fixée dans le code, jamais paramétrable */
  | 'CONSTANTE'
  /** identifiant d'un objet distant, déjà connu par une correspondance */
  | 'IDENTIFIANT'
  /** variable d'environnement */
  | 'ENVIRONNEMENT'

export interface ParametreAppel {
  nom: string
  source: SourceValeur
  /** module, réglage ou constante qui produit la valeur. Jamais une valeur réelle. */
  origine: string
  /** valeur d'illustration, manifestement factice, 40 caractères au plus */
  exemple: string
}

/** Ce que devient un appel qui échoue. */
export type ComportementEchec =
  /** remis en file, rejoué avec recul progressif */
  | 'REJOUE'
  /** abandonné : le rejouer donnerait le même refus */
  | 'ABANDONNE'
  /** toléré : l'état visé est déjà atteint */
  | 'TOLERE'

export interface PreuveAppel {
  /** version du système tiers, ex. '23.0.1' */
  version: string
  /** 'AAAA-MM-JJ' */
  date: string
  moyen: 'DOUBLE' | 'INSTANCE_JETABLE' | 'INSTANCE_PORTEUR'
}

export interface AppelExterne {
  /** ce que l'appel fait, en langage métier */
  operation: string
  methode: MethodeHttp
  /** gabarit de chemin, paramètres entre accolades : '/tasks/{taskId}/addtimespent' */
  gabarit: string
  /** false = redirection du navigateur, jamais émise par le serveur (voir D3) */
  emis: boolean
  /** module et fonction qui l'émettent */
  emisPar: string
  parametres: ParametreAppel[]
  preuve: PreuveAppel
  echec: { comportement: ComportementEchec; visible: string }
  /** réglages du système tiers dont dépend le sens des données */
  reglagesTiers: string[]
  /** précision que ni la route ni les paramètres ne portent */
  note?: string
}

export interface CatalogueSysteme {
  systeme: string
  /** gabarit de base, le réglage entre accolades */
  base: string
  appels: AppelExterne[]
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/
const DEBUT_METHODE = /^(GET|POST|PUT|PATCH|DELETE)\b/
const LONGUEUR_EXEMPLE_MAX = 40

export function cleAppel(a: { methode: MethodeHttp; gabarit: string }): string {
  return `${a.methode} ${a.gabarit}`
}

/**
 * Vrai pour ce qui a la forme d'un jeton ou d'une clé.
 *
 * Deux familles : les préfixes que Google publie (`ya29.`, `1//`), et les
 * chaînes opaques — longues, mêlant casses et chiffres, ou hexadécimales.
 * Un exemple de catalogue est court et lisible ; c'est ce qui les sépare.
 */
export function ressembleAUnSecret(valeur: string): boolean {
  if (/^ya29\./.test(valeur)) return true
  if (/^1\/\/[A-Za-z0-9_-]{15,}/.test(valeur)) return true
  if (/^sk-[A-Za-z0-9]{16,}/.test(valeur)) return true
  if (/^[0-9a-f]{32,}$/.test(valeur)) return true

  const opaque = /^[A-Za-z0-9+/]{32,}={0,2}$/.test(valeur)
  const melange =
    /[a-z]/.test(valeur) && /[A-Z]/.test(valeur) && /[0-9]/.test(valeur)
  return opaque && melange
}

function construireMotif(gabarit: string): RegExp {
  const echappe = gabarit
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '{' || c === '}' ? c : `\\${c}`))
    .replace(/\{[^}]+\}/g, '[^/]+')
  return new RegExp(`^${echappe}$`)
}

/**
 * Rend l'entrée du catalogue qui correspond à cette requête, ou `null`.
 *
 * La base est fournie par l'appelant — le double sait avec quelle base il a
 * été construit. Comparer par suffixe ferait passer `/projects/3/tasks` pour
 * `/tasks` : c'est précisément le genre de rapprochement approximatif qui
 * laisserait un appel non catalogué passer.
 */
export function gabaritCorrespondant(args: {
  catalogue: CatalogueSysteme
  base: string
  methode: string
  url: string
}): AppelExterne | null {
  const chemin = args.url.split('?')[0] ?? ''

  for (const appel of args.catalogue.appels) {
    if (!appel.emis) continue
    if (appel.methode !== args.methode) continue

    if (appel.gabarit.startsWith('https://')) {
      if (construireMotif(appel.gabarit).test(chemin)) return appel
      continue
    }

    if (!chemin.startsWith(args.base)) continue
    if (construireMotif(appel.gabarit).test(chemin.slice(args.base.length))) return appel
  }
  return null
}

/**
 * `manquants` : catalogué mais jamais exercé — une entrée inventée.
 * `inconnus` : exercé mais absent du catalogue — impossible si le double
 * refuse, gardé parce qu'un double mal branché doit se voir.
 */
export function comparerCouverture(args: {
  catalogue: CatalogueSysteme
  observes: ReadonlyArray<string>
}): { manquants: string[]; inconnus: string[] } {
  const vus = new Set(args.observes)
  const attendus = new Set(
    args.catalogue.appels.filter((a) => a.emis).map((a) => cleAppel(a)),
  )

  return {
    manquants: [...attendus].filter((c) => !vus.has(c)).sort(),
    inconnus: [...vus].filter((c) => !attendus.has(c)).sort(),
  }
}

/** Rend la liste des anomalies, vide quand le catalogue est en règle. */
export function verifierCatalogue(c: CatalogueSysteme, aujourdhui: string): string[] {
  const anomalies: string[] = []
  const vus = new Set<string>()

  if (c.systeme.trim() === '') anomalies.push('Le catalogue ne nomme pas son système.')
  if (c.base.trim() === '') anomalies.push(`${c.systeme} : le catalogue ne dit pas sa base.`)
  if (c.appels.length === 0) anomalies.push(`${c.systeme} : catalogue vide.`)

  for (const a of c.appels) {
    const cle = cleAppel(a)
    const dire = (message: string): void => void anomalies.push(`${cle} : ${message}`)

    if (vus.has(cle)) dire('deux entrées portent le même couple méthode et chemin.')
    vus.add(cle)

    if (!a.gabarit.startsWith('/') && !a.gabarit.startsWith('https://')) {
      dire('le chemin doit commencer par « / » ou être une URL absolue.')
    }
    if (a.operation.trim() === '') dire("l'opération n'est pas dite.")
    else if (DEBUT_METHODE.test(a.operation) || a.operation.includes('/')) {
      dire("l'opération doit se dire en langage métier, pas en méthode et chemin.")
    }
    if (!a.emisPar.includes('.ts')) dire('le module émetteur n est pas nommé.')

    if (a.preuve.version.trim() === '') dire('aucune version de preuve.')
    if (!DATE_ISO.test(a.preuve.date)) {
      dire(`la date de preuve « ${a.preuve.date} » n'est pas au format AAAA-MM-JJ.`)
    } else if (a.preuve.date > aujourdhui) {
      dire(`la date de preuve ${a.preuve.date} est postérieure à ${aujourdhui}.`)
    }

    if (a.echec.visible.trim() === '') dire("l'entrée ne dit pas ce que l'utilisateur voit en échec.")

    for (const p of a.parametres) {
      if (p.nom.trim() === '') dire('un paramètre est sans nom.')
      if (p.origine.trim() === '') dire(`le paramètre « ${p.nom} » ne dit pas d'où vient sa valeur.`)
      if (p.exemple.length > LONGUEUR_EXEMPLE_MAX) {
        dire(`le paramètre « ${p.nom} » porte un exemple de plus de ${LONGUEUR_EXEMPLE_MAX} caractères.`)
      } else if (ressembleAUnSecret(p.exemple)) {
        dire(`le paramètre « ${p.nom} » porte un exemple qui ressemble à un secret.`)
      }
    }
  }

  return anomalies
}
```

**4. Le voir passer** — `npx vitest run src/core/integrations/catalogue.test.ts`.

**5. Vérifier par mutation** — trois mutations, chacune doit faire rougir :
- dans `gabaritCorrespondant`, remplacer la comparaison exacte par un suffixe : `chemin.endsWith(appel.gabarit)`. Le test « ne confond pas deux chemins de même forme » doit rougir.
- dans `gabaritCorrespondant`, supprimer `if (!appel.emis) continue`. Le test « ne rapproche jamais une entrée non émise » doit rougir.
- dans `verifierCatalogue`, supprimer la branche `a.preuve.date > aujourdhui`. Le test de date future doit rougir.

Annuler les trois.

---

## Tâche 2 — Le catalogue Dolibarr

**But.** Déclarer les douze appels que l'application émet vers Dolibarr, avec la provenance de chaque paramètre.

**Fichiers créés**
- `src/integrations/dolibarr/catalogue.ts`
- `src/integrations/dolibarr/catalogue.test.ts`

**Interfaces consommées.** `AppelExterne`, `CatalogueSysteme`, `verifierCatalogue`, `cleAppel` de `@/core/integrations/catalogue`.

**Interfaces produites.** `CATALOGUE_DOLIBARR: CatalogueSysteme`.

**Source d'autorité.** Les douze appels sont ceux de `src/services/dolibarr/http.ts`, relus ligne à ligne. Ne rien ajouter que le client n'émette pas ; ne rien omettre qu'il émette.

### Étapes

**1. Écrire le test qui échoue** — `src/integrations/dolibarr/catalogue.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { cleAppel, verifierCatalogue } from '@/core/integrations/catalogue'
import { CATALOGUE_DOLIBARR } from './catalogue'

const AUJOURDHUI = new Date().toISOString().slice(0, 10)

describe('catalogue Dolibarr', () => {
  it('est en règle', () => {
    expect(verifierCatalogue(CATALOGUE_DOLIBARR, AUJOURDHUI)).toEqual([])
  })

  it('déclare exactement les douze appels du client HTTP', () => {
    expect(CATALOGUE_DOLIBARR.appels.map(cleAppel).sort()).toEqual([
      'DELETE /tasks/{taskId}/timespent/{timespentId}',
      'GET /invoices/{invoiceId}',
      'GET /projects',
      'GET /projects/{projectId}/tasks',
      'GET /proposals/{proposalId}',
      'GET /setup/conf/{constante}',
      'GET /thirdparties',
      'POST /invoices',
      'POST /tasks',
      'POST /tasks/{taskId}/addtimespent',
      'POST /thirdparties',
      'PUT /tasks/{taskId}/timespent/{timespentId}',
    ])
  })

  it('rattache le push des temps au réglage qui change le sens de ses données', () => {
    const push = CATALOGUE_DOLIBARR.appels.find(
      (a) => cleAppel(a) === 'POST /tasks/{taskId}/addtimespent',
    )
    expect(push?.reglagesTiers).toContain('TIMESHEET_DAY_DURATION')
    expect(push?.echec.comportement).toBe('REJOUE')
  })

  it('dit d où vient la durée poussée, pour savoir quoi recalculer', () => {
    const push = CATALOGUE_DOLIBARR.appels.find(
      (a) => cleAppel(a) === 'POST /tasks/{taskId}/addtimespent',
    )
    const duration = push?.parametres.find((p) => p.nom === 'duration')
    expect(duration?.source).toBe('CALCUL')
    expect(duration?.origine).toContain('src/core/dolibarr/timespent.ts')
  })

  it('tolère l absence d un temps déjà supprimé', () => {
    const suppression = CATALOGUE_DOLIBARR.appels.find(
      (a) => cleAppel(a) === 'DELETE /tasks/{taskId}/timespent/{timespentId}',
    )
    expect(suppression?.echec.comportement).toBe('TOLERE')
  })
})
```

**2. Le voir échouer.**

**3. Implémenter** — `src/integrations/dolibarr/catalogue.ts`. Douze entrées, dans l'ordre du client. Extrait normatif (les autres suivent la même forme, toutes écrites, aucune omise) :

```ts
/**
 * Ce que cette application appelle chez Dolibarr — et rien d'autre.
 *
 * Ce n'est ni une réécriture de la documentation de Dolibarr, ni un client
 * générique. Toute entrée doit correspondre à un appel réellement émis par
 * `src/services/dolibarr/http.ts` : le double HTTP refuse une route absente
 * d'ici, et un test de couverture refuse une entrée que rien n'exerce.
 *
 * Aucune valeur réelle n'entre ici. Les exemples sont factices.
 */
import type { CatalogueSysteme } from '@/core/integrations/catalogue'

/** Version contre laquelle l'environnement du porteur a été relevé. */
const VERSION = '23.0.1'
const DATE = '2026-08-16'
const PAR_LE_DOUBLE = { version: VERSION, date: DATE, moyen: 'DOUBLE' as const }

export const CATALOGUE_DOLIBARR: CatalogueSysteme = {
  systeme: 'Dolibarr',
  base: "{URL de l'instance, enregistrée dans Administration · Dolibarr}/api/index.php",
  appels: [
    {
      operation: 'Lister les tiers connus de Dolibarr',
      methode: 'GET',
      gabarit: '/thirdparties',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · listThirdparties',
      parametres: [
        {
          nom: 'limit',
          source: 'CONSTANTE',
          origine: 'src/services/dolibarr/http.ts · listThirdparties',
          exemple: '1000',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran Administration · Dolibarr affiche l'erreur ; rien n'est mis en file.",
      },
      reglagesTiers: [],
      note: 'Un 404 signifie « collection vide » et rend une liste vide, jamais une panne.',
    },
    {
      operation: 'Pousser un temps consommé sur une tâche',
      methode: 'POST',
      gabarit: '/tasks/{taskId}/addtimespent',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · addTimeSpent',
      parametres: [
        {
          nom: 'taskId',
          source: 'IDENTIFIANT',
          origine: "ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts",
          exemple: '17',
        },
        {
          nom: 'date',
          source: 'CALCUL',
          origine: 'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads',
          exemple: '2026-04-13',
        },
        {
          nom: 'duration',
          source: 'CALCUL',
          origine:
            'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads — minutes × 60, en secondes',
          exemple: '28800',
        },
        {
          nom: 'user_id',
          source: 'REGLAGE',
          origine: "ProviderCredential.metadata.dolibarrUserId, saisi dans Administration · Dolibarr",
          exemple: '42',
        },
        {
          nom: 'note',
          source: 'SAISIE',
          origine: 'commentaire de la saisie de temps',
          exemple: 'Atelier de cadrage',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible:
          "L'écran de synchronisation compte l'échec ; la file rejoue avec recul progressif.",
      },
      reglagesTiers: ['TIMESHEET_DAY_DURATION'],
      note:
        '`duration` est un nombre de secondes. TIMESHEET_DAY_DURATION ne change que la lecture ' +
        'jour/heure dans Dolibarr, jamais la valeur envoyée.',
    },
    // … dix autres entrées, écrites en entier :
    //  POST   /thirdparties                              createThirdparty
    //  GET    /projects                                  listProjects
    //  GET    /projects/{projectId}/tasks                listTasks
    //  POST   /tasks                                     createTask
    //  GET    /proposals/{proposalId}                    getProposal
    //  PUT    /tasks/{taskId}/timespent/{timespentId}    updateTimeSpent
    //  DELETE /tasks/{taskId}/timespent/{timespentId}    deleteTimeSpent  (TOLERE)
    //  POST   /invoices                                  createDraftInvoice
    //  GET    /invoices/{invoiceId}                      createDraftInvoice, relecture de la ref
    //  GET    /setup/conf/{constante}                    getSetupValue    (TOLERE)
  ],
}
```

Précisions à porter, entrée par entrée, sans en inventer d'autres :

- `POST /thirdparties` — `name` : `SAISIE`, origine « `Client.name`, via `src/services/dolibarr/import.ts · pushClientToDolibarr` », exemple `Client Exemple` ; `client` : `CONSTANTE`, exemple `1`. Échec `ABANDONNE`.
- `GET /projects` — `limit` `CONSTANTE` `1000`. `reglagesTiers: ['usage_bill_time du projet (« Facturer le temps consommé »)']`. Note : le filtre est appliqué **localement** par le client, Dolibarr rend tous les projets.
- `GET /projects/{projectId}/tasks` — `projectId` `IDENTIFIANT`, origine « `ExternalLink` (mission → projet) ».
- `POST /tasks` — `fk_project` `IDENTIFIANT` ; `label` et `ref` `CALCUL`, origine « libellé de la ligne de mission, `src/services/dolibarr/push.ts` », exemple `Consultant ITSM`. Note : `ref` reçoit le même libellé que `label`.
- `GET /proposals/{proposalId}` — `proposalId` `SAISIE`, origine « référence de propale saisie au rattachement d'un engagement ». Note : `subprice` est relu en euros et converti en centimes (`× 100`) par le client. **Note supplémentaire, à écrire telle quelle** : « Aucun service n'appelle encore cette opération ; seul le client HTTP la porte. » — c'est vrai en l'état du dépôt, et c'est exactement le genre de fait que le code ne dit pas.
- `PUT /tasks/{taskId}/timespent/{timespentId}` — mêmes paramètres que le push, moins `user_id`. Échec `REJOUE`.
- `DELETE …` — échec `TOLERE`, `visible` : « Rien. Un temps déjà disparu est un objectif atteint. »
- `POST /invoices` — `socid` `IDENTIFIANT` ; `status` `CONSTANTE` `0` (brouillon) ; `lines[].desc` `CALCUL` (`src/core/dolibarr/invoice.ts · buildInvoiceDraft`) ; `lines[].qty` `CALCUL` « centièmes de jour ÷ 100 » ; `lines[].subprice` `CALCUL` « centimes ÷ 100 ». `reglagesTiers: ['Taux de TVA par défaut du tiers']`. Note : aucun taux de TVA n'est transmis, l'application ne valide jamais la facture.
- `GET /invoices/{invoiceId}` — `invoiceId` `IDENTIFIANT`, origine « identifiant rendu par `POST /invoices` ». Note : appelé uniquement pour relire `ref`.
- `GET /setup/conf/{constante}` — `constante` `CONSTANTE`, origine « `src/services/dolibarr/setup.ts` — `SOCIETE_FISCAL_MONTH_START`, `TIMESHEET_DAY_DURATION` », exemple `TIMESHEET_DAY_DURATION`. Échec `TOLERE` : « L'écran de reprise ne propose simplement pas la valeur. » `reglagesTiers: ['SOCIETE_FISCAL_MONTH_START', 'TIMESHEET_DAY_DURATION']`.

**4. Le voir passer.**

**5. Vérifier par mutation** — retirer `'TIMESHEET_DAY_DURATION'` des `reglagesTiers` du push : le test de rattachement doit rougir. Remplacer l'`origine` de `duration` par `'calculé ailleurs'` : le test de provenance doit rougir. Annuler.

---

## Tâche 3 — Le catalogue Google

**But.** Déclarer les huit appels émis vers Google et la redirection de consentement.

**Fichiers créés**
- `src/integrations/google/catalogue.ts`
- `src/integrations/google/catalogue.test.ts`

**Interfaces consommées.** `CatalogueSysteme`, `verifierCatalogue`, `cleAppel`.

**Interfaces produites.** `CATALOGUE_GOOGLE: CatalogueSysteme`, `BASE_GOOGLE: string`.

**Source d'autorité.** `src/integrations/google/calendar.ts` et `src/integrations/google/oauth.ts`.

### Étapes

**1. Écrire le test qui échoue** — `src/integrations/google/catalogue.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { cleAppel, verifierCatalogue } from '@/core/integrations/catalogue'
import { CATALOGUE_GOOGLE } from './catalogue'

const AUJOURDHUI = new Date().toISOString().slice(0, 10)

describe('catalogue Google', () => {
  it('est en règle', () => {
    expect(verifierCatalogue(CATALOGUE_GOOGLE, AUJOURDHUI)).toEqual([])
  })

  it('déclare exactement les appels émis par le connecteur et l échange de jetons', () => {
    expect(CATALOGUE_GOOGLE.appels.filter((a) => a.emis).map(cleAppel).sort()).toEqual([
      'DELETE /calendars/{calendarId}/events/{eventId}',
      'GET /calendars/{calendarId}/events/{eventId}',
      'GET /users/me/calendarList',
      'POST /calendars',
      'POST /calendars/{calendarId}/events',
      'POST /freeBusy',
      'POST https://oauth2.googleapis.com/token',
      'PUT /calendars/{calendarId}/events/{eventId}',
    ])
  })

  it('catalogue la redirection de consentement sans la compter comme émise', () => {
    const consentement = CATALOGUE_GOOGLE.appels.find((a) => !a.emis)
    expect(cleAppel(consentement!)).toBe('GET https://accounts.google.com/o/oauth2/v2/auth')
    expect(consentement!.parametres.map((p) => p.nom)).toContain('access_type')
  })

  it('dit que le fuseau des blocs vient de l environnement', () => {
    const pose = CATALOGUE_GOOGLE.appels.find(
      (a) => cleAppel(a) === 'POST /calendars/{calendarId}/events',
    )
    const fuseau = pose?.parametres.find((p) => p.nom === 'start.timeZone')
    expect(fuseau?.source).toBe('ENVIRONNEMENT')
    expect(fuseau?.origine).toContain('CRA_TIMEZONE')
  })

  it('ne porte aucun jeton, même factice, en exemple', () => {
    for (const appel of CATALOGUE_GOOGLE.appels) {
      for (const p of appel.parametres) {
        expect(p.exemple.length).toBeLessThanOrEqual(40)
      }
    }
  })
})
```

**2. Le voir échouer.**

**3. Implémenter** — `src/integrations/google/catalogue.ts`. Neuf entrées.

```ts
import type { CatalogueSysteme } from '@/core/integrations/catalogue'

export const BASE_GOOGLE = 'https://www.googleapis.com/calendar/v3'

const VERSION = 'Google Calendar API v3'
const DATE = '2026-08-16'
const PAR_LE_DOUBLE = { version: VERSION, date: DATE, moyen: 'DOUBLE' as const }

export const CATALOGUE_GOOGLE: CatalogueSysteme = {
  systeme: 'Google Calendar',
  base: BASE_GOOGLE,
  appels: [
    {
      operation: 'Poser un bloc de disponibilité dans le calendrier dédié',
      methode: 'POST',
      gabarit: '/calendars/{calendarId}/events',
      emis: true,
      emisPar: 'src/integrations/google/calendar.ts · createEvent',
      parametres: [
        {
          nom: 'calendarId',
          source: 'IDENTIFIANT',
          origine: 'ProviderCredential.calendarId, posé au consentement par ensureDedicatedCalendar',
          exemple: 'cal-exemple@group.calendar.google.com',
        },
        {
          nom: 'summary',
          source: 'CALCUL',
          origine: 'src/core/calendar/event.ts · CalendarEventDraft.summary',
          exemple: 'Client Exemple — Conseil',
        },
        {
          nom: 'start.dateTime',
          source: 'CALCUL',
          origine: 'src/core/calendar/event.ts — heure locale naïve, sans décalage',
          exemple: '2026-04-13T09:00:00',
        },
        {
          nom: 'start.timeZone',
          source: 'ENVIRONNEMENT',
          origine: 'CRA_TIMEZONE',
          exemple: 'Europe/Paris',
        },
        {
          nom: 'transparency',
          source: 'CONSTANTE',
          origine: 'src/core/calendar/event.ts',
          exemple: 'opaque',
        },
        {
          nom: 'colorId',
          source: 'REGLAGE',
          origine: 'palette catégorielle de la prestation (lot 1e)',
          exemple: '5',
        },
        {
          nom: 'extendedProperties.private.craEntryId',
          source: 'IDENTIFIANT',
          origine: 'identifiant de la saisie locale — sert à retrouver le bloc',
          exemple: 'entry-exemple',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible: "L'écran de synchronisation compte l'échec ; la file rejoue.",
      },
      reglagesTiers: [],
      note:
        "Une heure locale naïve sans `timeZone` est refusée par Google : l'instant n'existe pas " +
        'sans fuseau.',
    },
    {
      operation: "Obtenir puis renouveler l'autorisation d'accès à l'agenda",
      methode: 'POST',
      gabarit: 'https://oauth2.googleapis.com/token',
      emis: true,
      emisPar: 'src/integrations/google/oauth.ts · exchangeCode, refreshAccessToken',
      parametres: [
        {
          nom: 'client_id',
          source: 'ENVIRONNEMENT',
          origine: 'GOOGLE_CLIENT_ID',
          exemple: 'exemple.apps.googleusercontent.com',
        },
        {
          nom: 'client_secret',
          source: 'ENVIRONNEMENT',
          origine: 'GOOGLE_CLIENT_SECRET — jamais journalisé, jamais documenté',
          exemple: 'valeur-factice',
        },
        {
          nom: 'redirect_uri',
          source: 'ENVIRONNEMENT',
          origine: 'GOOGLE_REDIRECT_URI',
          exemple: 'http://localhost:3000/api/…',
        },
        {
          nom: 'grant_type',
          source: 'CONSTANTE',
          origine: "authorization_code au consentement, refresh_token au renouvellement",
          exemple: 'refresh_token',
        },
        {
          nom: 'code',
          source: 'SAISIE',
          origine: 'code rendu par la redirection de consentement',
          exemple: 'code-factice',
        },
        {
          nom: 'refresh_token',
          source: 'IDENTIFIANT',
          origine: 'ProviderCredential, chiffré au repos par CREDENTIALS_KEY',
          exemple: 'jeton-factice',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible:
          "L'écran de synchronisation annonce une autorisation expirée et propose de reconnecter.",
      },
      reglagesTiers: ["Scopes accordés au client OAuth dans la console Google Cloud"],
      note:
        'Corps de formulaire obligatoire : du JSON sur cette route reçoit un `invalid_request`. ' +
        "Une seule entrée pour les deux `grant_type` — l'identité d'une entrée est le couple " +
        'méthode et chemin (D2).',
    },
    {
      operation: "Envoyer l'utilisateur donner son consentement",
      methode: 'GET',
      gabarit: 'https://accounts.google.com/o/oauth2/v2/auth',
      emis: false,
      emisPar: 'src/integrations/google/oauth.ts · buildConsentUrl',
      parametres: [
        { nom: 'client_id', source: 'ENVIRONNEMENT', origine: 'GOOGLE_CLIENT_ID', exemple: 'exemple.apps.googleusercontent.com' },
        { nom: 'redirect_uri', source: 'ENVIRONNEMENT', origine: 'GOOGLE_REDIRECT_URI', exemple: 'http://localhost:3000/api/…' },
        { nom: 'scope', source: 'CONSTANTE', origine: 'src/integrations/google/oauth.ts', exemple: '…/auth/calendar' },
        { nom: 'access_type', source: 'CONSTANTE', origine: 'offline — pour obtenir un jeton de rafraîchissement', exemple: 'offline' },
        { nom: 'prompt', source: 'CONSTANTE', origine: 'consent — sans quoi une reconnexion ne rend aucun jeton de rafraîchissement', exemple: 'consent' },
        { nom: 'state', source: 'CALCUL', origine: 'jeton anti-rejeu posé par la route de connexion', exemple: 'etat-factice' },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "Le retour de consentement affiche l'échec sans conseiller de réessayer.",
      },
      reglagesTiers: ["URI de redirection autorisées dans la console Google Cloud"],
      note:
        "Redirection du navigateur, jamais émise par le serveur : hors du test de route et du " +
        'test de couverture (D3).',
    },
    // … six autres entrées, écrites en entier :
    //  GET    /users/me/calendarList                          ensureDedicatedCalendar (maxResults=250)
    //  POST   /calendars                                      ensureDedicatedCalendar (summary)
    //  PUT    /calendars/{calendarId}/events/{eventId}        updateEvent
    //  GET    /calendars/{calendarId}/events/{eventId}        getEvent
    //  DELETE /calendars/{calendarId}/events/{eventId}        deleteEvent  (TOLERE)
    //  POST   /freeBusy                                       freeBusy (timeMin, timeMax, items)
  ],
}
```

Précisions pour les six entrées résumées :

- `GET /users/me/calendarList` — `maxResults` `CONSTANTE` `250`. Note : le calendrier dédié est retrouvé **par son libellé** (`CRA — disponibilités`), pas par un identifiant stocké.
- `POST /calendars` — `summary` `CONSTANTE`, origine « `src/services/google/connect.ts · CALENDRIER_DEDIE` », exemple `CRA — disponibilités`. Note : jamais l'agenda principal.
- `PUT …/events/{eventId}` — mêmes paramètres que la pose, plus `eventId` `IDENTIFIANT` (origine « `ExternalLink` (saisie → événement) »). Note : mise à jour plutôt que suppression puis recréation, pour garder l'identifiant (arbitrage du porteur du 16 août).
- `GET …/events/{eventId}` — `eventId` `IDENTIFIANT`. Note : un événement `status: cancelled` revient en 200 ; le connecteur le traite en `NOT_FOUND`.
- `DELETE …/events/{eventId}` — échec `TOLERE`, `visible` : « Rien. Un événement déjà disparu est un objectif atteint. »
- `POST /freeBusy` — `timeMin` / `timeMax` `CALCUL` (instants absolus RFC 3339, exemples `2026-04-13T00:00:00Z`) ; `items[].id` `IDENTIFIANT` (« calendriers de l'utilisateur, **moins** le calendrier dédié »). Note : l'exclusion du calendrier dédié vit dans le connecteur, sans quoi les blocs posés entreraient en conflit avec eux-mêmes.

**4. Le voir passer.**

**5. Vérifier par mutation** — passer `emis: true` sur la redirection de consentement : le test de liste des appels émis doit rougir. Remplacer l'`origine` de `start.timeZone` par `'réglage local'` : le test du fuseau doit rougir. Annuler.

---

## Tâche 4 — Le double Google refuse une route non cataloguée

**But.** Faire du double d'API Google le gardien du catalogue : une requête vers une route absente du catalogue **lève**, et les gabarits réellement frappés sont enregistrés.

**Fichiers modifiés**
- `src/integrations/google/fake-google-api.ts`
- `src/integrations/google/calendar.test.ts` (ajout de tests, aucune suppression)

**Interfaces consommées.** `CATALOGUE_GOOGLE`, `BASE_GOOGLE`, `gabaritCorrespondant`, `cleAppel`.

**Interfaces produites.** `FakeGoogleApi.gabaritsObserves: string[]`, `AppelNonCatalogueError`.

### Étapes

**1. Écrire le test qui échoue** — dans `src/integrations/google/calendar.test.ts` :

```ts
describe('le double refuse ce que le catalogue ne déclare pas', () => {
  it('lève sur une route absente du catalogue, sans la traduire en 404', async () => {
    const api = createFakeGoogleApi()
    await expect(
      api.fetchFn('https://www.googleapis.com/calendar/v3/settings', {
        method: 'GET',
        headers: { authorization: 'Bearer jeton-factice' },
      }),
    ).rejects.toThrow(/non catalogué.*src\/integrations\/google\/catalogue\.ts/s)
  })

  it('enregistre le gabarit catalogué de chaque appel reçu', async () => {
    const api = createFakeGoogleApi()
    const connecteur = createGoogleCalendarConnector({
      fetchFn: api.fetchFn,
      accessToken: 'jeton-factice',
      calendarId: 'cal-exemple@group.calendar.google.com',
    })
    await connecteur.createEvent(brouillon())
    expect(api.gabaritsObserves).toEqual(['POST /calendars/{calendarId}/events'])
  })

  it('refuse aussi une route non cataloguée quand une panne est armée', async () => {
    const api = createFakeGoogleApi()
    api.failNext('SERVEUR')
    await expect(
      api.fetchFn('https://www.googleapis.com/calendar/v3/settings', {
        method: 'GET',
        headers: { authorization: 'Bearer jeton-factice' },
      }),
    ).rejects.toThrow(/non catalogué/)
  })
})
```

(`brouillon()` : l'assistant de `CalendarEventDraft` déjà utilisé dans ce fichier ; le réemployer, ne pas en écrire un second.)

**2. Le voir échouer** — aujourd'hui le double rend `404 Route non simulée`, donc `rejects` ne se produit pas.

**3. Implémenter** — dans `fake-google-api.ts` :

```ts
import { cleAppel, gabaritCorrespondant } from '@/core/integrations/catalogue'
import { BASE_GOOGLE, CATALOGUE_GOOGLE } from './catalogue'

export class AppelNonCatalogueError extends Error {
  constructor(methode: string, url: string) {
    super(
      `Appel non catalogué : ${methode} ${url}. Déclarez-le dans ` +
        `src/integrations/google/catalogue.ts avant de l'émettre.`,
    )
    this.name = 'AppelNonCatalogueError'
  }
}
```

et, dans `fetchFn`, **immédiatement après `calls.push(...)` et avant le traitement de `prochainEchec`** :

```ts
    // Le catalogue passe avant tout le reste, panne armée comprise : une
    // route non déclarée doit se voir même sur le chemin d'échec.
    //
    // On lève, on ne rend pas 404 : le connecteur traduit 404 en NOT_FOUND,
    // et `deleteEvent` avale délibérément NOT_FOUND. Un refus par 404
    // laisserait donc un appel non catalogué passer au vert sur ce chemin.
    const declare = gabaritCorrespondant({
      catalogue: CATALOGUE_GOOGLE,
      base: BASE_GOOGLE,
      methode: init.method,
      url,
    })
    if (declare === null) throw new AppelNonCatalogueError(init.method, url)
    gabaritsObserves.push(cleAppel(declare))
```

Déclarer `const gabaritsObserves: string[] = []` à côté de `calls`, l'exposer dans l'objet rendu, et l'ajouter à l'interface `FakeGoogleApi` :

```ts
  /** gabarits du catalogue réellement frappés, dans l'ordre */
  gabaritsObserves: string[]
```

La ligne finale `return erreur(404, 'Route non simulée : …')` devient inatteignable pour une route cataloguée mal simulée ; la remplacer par une levée explicite :

```ts
    // Cataloguée mais non simulée ici : c'est un trou du double, pas un
    // comportement de Google. Le dire au lieu de rendre un 404 crédible.
    throw new Error(`Route cataloguée mais non simulée par le double : ${init.method} ${url}`)
```

**4. Le voir passer** — `npx vitest run src/integrations/google` puis la suite entière : tout appel que les tests existants émettent doit être catalogué. Si un test frappe une route absente du catalogue, **c'est le catalogue qu'il faut compléter en tâche 3**, jamais le test qu'il faut adoucir.

**5. Vérifier par mutation** — remplacer `throw new AppelNonCatalogueError(...)` par `return erreur(404, 'Route non simulée')` : le premier test doit rougir. Déplacer le bloc de catalogue **après** le traitement de `prochainEchec` : le troisième test doit rougir. Annuler.

---

## Tâche 5 — Le double HTTP Dolibarr, sévère et adossé au catalogue

**But.** Donner à Dolibarr ce que Google a déjà : un double **au niveau du transport**, qui refuse une route non cataloguée et qui refuse ce qu'une instance refuserait. `src/services/dolibarr/fake.ts` reste ce qu'il est — un double du port, qui ne voit passer aucune URL.

**Fichiers créés**
- `src/integrations/dolibarr/fake-dolibarr-http.ts`
- `src/integrations/dolibarr/fake-dolibarr-http.test.ts`

**Interfaces consommées.** `CATALOGUE_DOLIBARR`, `gabaritCorrespondant`, `cleAppel`, `createHttpDolibarrApi`, `DolibarrRequestError`, `DolibarrUnavailableError`.

**Interfaces produites.**

```ts
export const BASE_FACTICE = 'https://erp.invalide.test/api/index.php'

export interface FakeDolibarrHttp {
  fetchImpl: typeof fetch
  /** requêtes reçues, corps déjà décodé */
  appels: Array<{ methode: string; url: string; entetes: Headers; corps: unknown }>
  /** gabarits du catalogue réellement frappés, dans l'ordre */
  gabaritsObserves: string[]
  seedThirdparty(name: string): { id: number; name: string }
  seedProject(a: { ref: string; title: string; socid: number | null; usageBillTime?: boolean }): { id: number }
  seedTask(a: { projectId: number; label: string }): { id: number }
  seedProposal(a: { ref: string; socid: number; lines: Array<{ label: string; qty: number; subpriceEuros: number }> }): { id: number }
  seedSetup(constante: string, valeur: string): void
  timespents: Array<{ id: number; taskId: number; date: string; duration: number; userId: number; note: string }>
  invoices: Array<{ id: number; ref: string; socid: number; status: number }>
}

export function createFakeDolibarrHttp(): FakeDolibarrHttp
```

### Étapes

**1. Écrire le test qui échoue** — `src/integrations/dolibarr/fake-dolibarr-http.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { createHttpDolibarrApi } from '@/services/dolibarr/http'
import { DolibarrRequestError } from '@/services/dolibarr/api'
import { BASE_FACTICE, createFakeDolibarrHttp } from './fake-dolibarr-http'

function apiSur(faux: ReturnType<typeof createFakeDolibarrHttp>) {
  return createHttpDolibarrApi({ baseUrl: BASE_FACTICE, apiKey: 'cle-factice', fetchImpl: faux.fetchImpl })
}

describe('double HTTP Dolibarr', () => {
  it('lève sur une route absente du catalogue', async () => {
    const faux = createFakeDolibarrHttp()
    await expect(
      faux.fetchImpl(`${BASE_FACTICE}/users`, { headers: { DOLAPIKEY: 'cle-factice' } }),
    ).rejects.toThrow(/non catalogué.*src\/integrations\/dolibarr\/catalogue\.ts/s)
  })

  it('enregistre le gabarit catalogué de chaque appel', async () => {
    const faux = createFakeDolibarrHttp()
    const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: 1 })
    await apiSur(faux).listTasks(projet.id)
    expect(faux.gabaritsObserves).toEqual(['GET /projects/{projectId}/tasks'])
  })

  it('refuse une requête sans clé d API', async () => {
    const faux = createFakeDolibarrHttp()
    const api = createHttpDolibarrApi({ baseUrl: BASE_FACTICE, apiKey: '', fetchImpl: faux.fetchImpl })
    await expect(api.listThirdparties()).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse une durée qui n est pas un entier de secondes', async () => {
    const faux = createFakeDolibarrHttp()
    const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: 1 })
    const tache = faux.seedTask({ projectId: projet.id, label: 'Conseil' })
    await expect(
      apiSur(faux).addTimeSpent({
        taskId: tache.id,
        dolibarrUserId: 42,
        date: '2026-04-13',
        durationSeconds: 28800.5,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('refuse une date qui n est pas au format de Dolibarr', async () => {
    const faux = createFakeDolibarrHttp()
    const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: 1 })
    const tache = faux.seedTask({ projectId: projet.id, label: 'Conseil' })
    await expect(
      apiSur(faux).addTimeSpent({
        taskId: tache.id,
        dolibarrUserId: 42,
        date: '13/04/2026',
        durationSeconds: 28800,
        note: '',
      }),
    ).rejects.toThrow(DolibarrRequestError)
  })

  it('rend 404 sur une collection vide, que le client traduit en liste vide', async () => {
    const faux = createFakeDolibarrHttp()
    expect(await apiSur(faux).listThirdparties()).toEqual([])
    expect(faux.appels[0]!.url).not.toContain('cle-factice')
    expect(faux.appels[0]!.entetes.get('DOLAPIKEY')).toBe('cle-factice')
  })

  it('rend la référence provisoire d une facture créée en brouillon', async () => {
    const faux = createFakeDolibarrHttp()
    const tiers = faux.seedThirdparty('Client Exemple')
    const facture = await apiSur(faux).createDraftInvoice({
      socid: tiers.id,
      lines: [{ label: 'Conseil', qteCentiemes: 250, subpriceCents: 80000 }],
    })
    expect(facture.ref).toMatch(/^\(PROV\d+\)$/)
    expect(faux.invoices[0]!.status).toBe(0)
    expect(faux.gabaritsObserves).toEqual(['POST /invoices', 'GET /invoices/{invoiceId}'])
  })
})
```

**2. Le voir échouer.**

**3. Implémenter** — `src/integrations/dolibarr/fake-dolibarr-http.ts`. Structure imposée :

- garde de catalogue **en tête** de `fetchImpl`, identique à celle de Google (levée, jamais 404), nommant `src/integrations/dolibarr/catalogue.ts` ;
- puis contrôle de l'en-tête `DOLAPIKEY` : vide ou absent → `new Response(JSON.stringify({ error: { message: 'Wrong API key' } }), { status: 401 })`, que le client traduit en `DolibarrRequestError` ;
- puis routage par gabarit **catalogué** (`declare.gabarit`), jamais par expression régulière écrite une seconde fois — c'est le rapprochement du catalogue qui décide, ce qui garantit qu'une entrée mal écrite se voit ;
- sévérité, calquée sur `src/services/dolibarr/fake.ts` : date `^\d{4}-\d{2}-\d{2}$`, durée entière et strictement positive, `user_id` entier positif, tiers/projet/tâche inconnus refusés en 400, ligne de facture sans libellé refusée en 400 ;
- collections vides rendues en **404** avec un corps `{ error: { message: 'No … found' } }` — c'est le comportement réel de Dolibarr, et c'est ce que le client tolère ;
- `POST /thirdparties`, `POST /tasks`, `POST /invoices` rendent un **entier nu**, comme Dolibarr ;
- `GET /setup/conf/{constante}` rend la valeur **enveloppée** (`{ value: '7' }`) quand elle est amorcée, **404** sinon — les deux formes que le client sait lire.

Squelette de la garde :

```ts
const fetchImpl = (async (input, init) => {
  const url = String(input)
  const methode = init?.method ?? 'GET'
  const corps = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  appels.push({ methode, url, entetes: new Headers(init?.headers), corps })

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
  // … routage sur declare.gabarit
}) as typeof fetch
```

Attention : `CATALOGUE_DOLIBARR.base` porte un gabarit lisible par un humain (`{URL de l'instance}/api/index.php`) ; le rapprochement se fait contre `BASE_FACTICE`, la base **réelle** de ce double. C'est exactement pourquoi `gabaritCorrespondant` prend la base en paramètre.

**4. Le voir passer.**

**5. Vérifier par mutation** — supprimer le contrôle `DOLAPIKEY` : le test « refuse une requête sans clé d'API » doit rougir. Remplacer la levée de la garde par `new Response(null, { status: 404 })` : le premier test doit rougir. Accepter une durée non entière : le test correspondant doit rougir. Annuler.

---

## Tâche 6 — Aucune entrée non prouvée, côté Dolibarr

**But.** Exercer les douze opérations du client HTTP et comparer l'ensemble des gabarits réellement frappés à celui du catalogue. Une entrée que rien n'exerce est une entrée inventée.

**Fichier créé**
- `src/integrations/dolibarr/couverture.test.ts`

**Interfaces consommées.** `createFakeDolibarrHttp`, `BASE_FACTICE`, `createHttpDolibarrApi`, `CATALOGUE_DOLIBARR`, `comparerCouverture`.

**Interfaces produites.** Aucune.

### Étapes

**1. Écrire le test qui échoue** :

```ts
import { describe, it, expect } from 'vitest'
import { comparerCouverture } from '@/core/integrations/catalogue'
import { createHttpDolibarrApi } from '@/services/dolibarr/http'
import { CATALOGUE_DOLIBARR } from './catalogue'
import { BASE_FACTICE, createFakeDolibarrHttp } from './fake-dolibarr-http'

/**
 * Exerce **toutes** les opérations du client. Ajouter une entrée au catalogue
 * sans l'exercer ici fait échouer le test ; c'est le seul moyen d'empêcher un
 * catalogue de décrire des appels que l'application n'émet pas.
 */
async function exercerTout(): Promise<string[]> {
  const faux = createFakeDolibarrHttp()
  const api = createHttpDolibarrApi({
    baseUrl: BASE_FACTICE,
    apiKey: 'cle-factice',
    fetchImpl: faux.fetchImpl,
  })

  const tiers = faux.seedThirdparty('Client Exemple')
  const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: tiers.id })
  const propale = faux.seedProposal({
    ref: 'PR001',
    socid: tiers.id,
    lines: [{ label: 'Conseil', qty: 10, subpriceEuros: 800 }],
  })
  faux.seedSetup('TIMESHEET_DAY_DURATION', '7')

  await api.listThirdparties()
  await api.createThirdparty('Autre Client Exemple')
  await api.listProjects()
  await api.listTasks(projet.id)
  const tache = await api.createTask({ projectId: projet.id, label: 'Conseil' })
  await api.getProposal(propale.id)
  const { timespentId } = await api.addTimeSpent({
    taskId: tache.id,
    dolibarrUserId: 42,
    date: '2026-04-13',
    durationSeconds: 28800,
    note: 'Atelier de cadrage',
  })
  await api.updateTimeSpent({
    taskId: tache.id,
    timespentId,
    date: '2026-04-13',
    durationSeconds: 25200,
    note: 'Atelier de cadrage',
  })
  await api.deleteTimeSpent({ taskId: tache.id, timespentId })
  await api.createDraftInvoice({
    socid: tiers.id,
    lines: [{ label: 'Conseil', qteCentiemes: 250, subpriceCents: 80000 }],
  })
  await api.getSetupValue('TIMESHEET_DAY_DURATION')

  return faux.gabaritsObserves
}

describe('couverture du catalogue Dolibarr', () => {
  it('n a aucune entrée que rien n exerce', async () => {
    const { manquants, inconnus } = comparerCouverture({
      catalogue: CATALOGUE_DOLIBARR,
      observes: await exercerTout(),
    })
    expect(manquants).toEqual([])
    expect(inconnus).toEqual([])
  })
})
```

**2. Le voir échouer** — au premier jet, `manquants` ne sera pas vide tant que `GET /invoices/{invoiceId}` n'est pas frappé ; il l'est par `createDraftInvoice`, qui relit la référence. C'est justement ce que le test prouve.

**3. Implémenter le minimum** — aucun code de production n'est écrit par cette tâche. Si `manquants` n'est pas vide, deux issues, et **une seule est acceptable selon le cas** : soit l'opération existe et n'est pas exercée ici — l'exercer ; soit l'entrée décrit un appel que le client n'émet pas — **la retirer du catalogue** (tâche 2). Ne jamais assouplir la comparaison.

**4. Le voir passer.**

**5. Vérifier par mutation** — ajouter au catalogue une entrée `GET /users` que rien n'émet : `manquants` doit la nommer et le test rougir. Retirer `await api.getProposal(...)` de l'exercice : `manquants` doit nommer `GET /proposals/{proposalId}`. Annuler les deux.

---

## Tâche 7 — Aucune entrée non prouvée, côté Google

**But.** Le pendant de la tâche 6 pour Google : exercer le connecteur et l'échange de jetons, comparer au catalogue.

**Fichier créé**
- `src/integrations/google/couverture.test.ts`

**Interfaces consommées.** `createFakeGoogleApi`, `createGoogleCalendarConnector`, `ensureDedicatedCalendar`, `exchangeCode`, `refreshAccessToken`, `CATALOGUE_GOOGLE`, `comparerCouverture`.

### Étapes

**1. Écrire le test qui échoue** :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { comparerCouverture } from '@/core/integrations/catalogue'
import { createFakeGoogleApi } from './fake-google-api'
import { createGoogleCalendarConnector, ensureDedicatedCalendar } from './calendar'
import { exchangeCode, refreshAccessToken } from './oauth'
import { CATALOGUE_GOOGLE } from './catalogue'

describe('couverture du catalogue Google', () => {
  beforeEach(() => {
    // `oauth.ts` lit ces variables ; des valeurs factices suffisent, et le
    // double n'en vérifie pas le contenu.
    process.env.GOOGLE_CLIENT_ID = 'exemple.apps.googleusercontent.com'
    process.env.GOOGLE_CLIENT_SECRET = 'valeur-factice'
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/google/callback'
  })

  it('n a aucune entrée que rien n exerce', async () => {
    const api = createFakeGoogleApi()

    await exchangeCode(api.fetchFn, 'code-factice')
    await refreshAccessToken(api.fetchFn, 'jeton-factice')

    const calendarId = await ensureDedicatedCalendar(
      api.fetchFn,
      'jeton-factice',
      'CRA — disponibilités',
    )
    const connecteur = createGoogleCalendarConnector({
      fetchFn: api.fetchFn,
      accessToken: 'jeton-factice',
      calendarId,
    })

    const { externalId } = await connecteur.createEvent(brouillon())
    await connecteur.updateEvent(externalId, brouillon())
    await connecteur.getEvent(externalId)
    await connecteur.freeBusy({
      startIso: '2026-04-13T00:00:00Z',
      endIso: '2026-04-14T00:00:00Z',
      calendarIds: ['principal@exemple.test'],
    })
    await connecteur.deleteEvent(externalId)

    const { manquants, inconnus } = comparerCouverture({
      catalogue: CATALOGUE_GOOGLE,
      observes: api.gabaritsObserves,
    })
    expect(manquants).toEqual([])
    expect(inconnus).toEqual([])
  })
})
```

`brouillon()` : réécrire ici l'assistant minimal de `CalendarEventDraft` (ce fichier ne doit pas importer de `calendar.test.ts`), avec `summary`, `description`, `startLocal`, `endLocal`, `timeZone: 'Europe/Paris'`, `transparency: 'opaque'`, `colorId: '5'`, `craEntryId: 'entry-exemple'`.

Deux points à noter dans un commentaire du fichier : `ensureDedicatedCalendar` frappe `GET /users/me/calendarList` **puis** `POST /calendars` seulement si le libellé est absent — c'est le cas au premier appel sur un double neuf, donc les deux gabarits sont couverts ; et la redirection de consentement, `emis: false`, est hors comparaison par construction (D3).

**2. Le voir échouer.**

**3. Implémenter le minimum** — aucun code de production. Même règle qu'en tâche 6 : compléter l'exercice, ou retirer l'entrée.

**4. Le voir passer.**

**5. Vérifier par mutation** — retirer `await connecteur.freeBusy(...)` : `manquants` doit nommer `POST /freeBusy`. Passer `emis: true` sur l'entrée de consentement : `manquants` doit la nommer. Annuler.

---

## Tâche 8 — Le générateur du chapitre

**But.** Transformer un ou plusieurs catalogues en Markdown, de façon déterministe, sans horloge et sans système de fichiers.

**Fichiers créés**
- `src/core/integrations/document.ts`
- `src/core/integrations/document.test.ts`

**Interfaces consommées.** `CatalogueSysteme`, `AppelExterne`, `cleAppel`, `SourceValeur`.

**Interfaces produites.**

```ts
export interface SectionProse { titre: string; corps: string }
export function engendrerChapitre(args: {
  titre: string
  preambule: SectionProse[]
  catalogues: ReadonlyArray<CatalogueSysteme>
  final: SectionProse[]
}): string
```

### Étapes

**1. Écrire le test qui échoue** :

```ts
import { describe, it, expect } from 'vitest'
import { engendrerChapitre } from './document'
import type { CatalogueSysteme } from './catalogue'

const CATALOGUE: CatalogueSysteme = {
  systeme: 'Dolibarr',
  base: "{URL de l'instance}/api/index.php",
  appels: [
    {
      operation: 'Pousser un temps consommé sur une tâche',
      methode: 'POST',
      gabarit: '/tasks/{taskId}/addtimespent',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · addTimeSpent',
      parametres: [
        {
          nom: 'duration',
          source: 'CALCUL',
          origine: 'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads',
          exemple: '28800',
        },
      ],
      preuve: { version: '23.0.1', date: '2026-08-16', moyen: 'INSTANCE_JETABLE' },
      echec: { comportement: 'REJOUE', visible: 'La file rejoue.' },
      reglagesTiers: ['TIMESHEET_DAY_DURATION'],
    },
    {
      operation: 'Lister les tiers connus de Dolibarr',
      methode: 'GET',
      gabarit: '/thirdparties',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · listThirdparties',
      parametres: [],
      preuve: { version: '23.0.1', date: '2026-08-16', moyen: 'DOUBLE' },
      echec: { comportement: 'ABANDONNE', visible: "L'écran affiche l'erreur." },
      reglagesTiers: [],
    },
  ],
}

const ARGS = {
  titre: 'Intégrations',
  preambule: [{ titre: 'À quoi sert ce chapitre', corps: 'Prose.' }],
  catalogues: [CATALOGUE],
  final: [{ titre: 'Monter de version', corps: 'Procédure.' }],
}

describe('génération du chapitre', () => {
  it('avertit que le fichier est engendré', () => {
    expect(engendrerChapitre(ARGS).split('\n')[0]).toBe(
      '<!-- ENGENDRÉ depuis les catalogues — ne pas modifier à la main. Voir npm run doc:integrations. -->',
    )
  })

  it('trie les appels par méthode et chemin, pas par ordre de déclaration', () => {
    const rendu = engendrerChapitre(ARGS)
    expect(rendu.indexOf('`GET /thirdparties`')).toBeLessThan(
      rendu.indexOf('`POST /tasks/{taskId}/addtimespent`'),
    )
  })

  it('dit d où vient la valeur de chaque paramètre', () => {
    expect(engendrerChapitre(ARGS)).toContain(
      '| `duration` | calcul | `src/core/dolibarr/timespent.ts · buildTimeSpentPayloads` | `28800` |',
    )
  })

  it('dit contre quelle version et à quelle date l appel a été prouvé', () => {
    expect(engendrerChapitre(ARGS)).toContain(
      'Prouvé contre Dolibarr 23.0.1 le 2026-08-16, sur instance jetable.',
    )
  })

  it('nomme le réglage tiers dont l appel dépend', () => {
    expect(engendrerChapitre(ARGS)).toContain('Réglage tiers : `TIMESHEET_DAY_DURATION`.')
  })

  it('ne porte aucune date de génération', () => {
    const premier = engendrerChapitre(ARGS)
    const second = engendrerChapitre(ARGS)
    expect(premier).toBe(second)
    expect(premier).not.toContain(new Date().getFullYear().toString() + '-')
    // (la seule année qui apparaît est celle des dates de preuve, dans le corps
    //  des entrées : la vérification porte sur l'en-tête, comparée ci-dessus)
  })

  it('signale une opération non émise pour ce qu elle est', () => {
    const avecRedirection: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...CATALOGUE.appels[1]!, emis: false }],
    }
    expect(engendrerChapitre({ ...ARGS, catalogues: [avecRedirection] })).toContain(
      'Redirection du navigateur — jamais émise par le serveur.',
    )
  })
})
```

(La dernière assertion du test « aucune date de génération » est trop large telle quelle ; la remplacer par une comparaison de l'en-tête seul : `expect(premier.split('\n').slice(0, 4).join('\n')).not.toMatch(/\d{4}-\d{2}-\d{2}/)`. Écrire cette version, pas la première.)

**2. Le voir échouer.**

**3. Implémenter** — `src/core/integrations/document.ts` :

```ts
/**
 * Engendre le chapitre des intégrations depuis les catalogues.
 *
 * Pur et déterministe : aucune horloge, aucun système de fichiers. Une date
 * de génération dans le fichier ferait échouer le test de non-divergence dès
 * le lendemain — les dates qui comptent sont dans le catalogue, entrée par
 * entrée, et ce sont des dates de preuve.
 */
import { cleAppel, type AppelExterne, type CatalogueSysteme, type SourceValeur } from './catalogue'

const AVERTISSEMENT =
  '<!-- ENGENDRÉ depuis les catalogues — ne pas modifier à la main. Voir npm run doc:integrations. -->'

const LIBELLE_SOURCE: Record<SourceValeur, string> = {
  REGLAGE: 'réglage',
  SAISIE: 'saisie',
  CALCUL: 'calcul',
  CONSTANTE: 'constante',
  IDENTIFIANT: 'identifiant externe',
  ENVIRONNEMENT: 'environnement',
}

const LIBELLE_ECHEC = {
  REJOUE: 'Rejoué par la file de synchronisation',
  ABANDONNE: 'Abandonné — le rejouer donnerait le même refus',
  TOLERE: "Toléré — l'état visé est déjà atteint",
} as const

const LIBELLE_MOYEN = {
  DOUBLE: 'contre le double d’API',
  INSTANCE_JETABLE: 'sur instance jetable',
  INSTANCE_PORTEUR: "sur l'instance du porteur",
} as const

function rendreAppel(a: AppelExterne): string[] {
  const lignes: string[] = []
  lignes.push(`### ${a.operation}`, '')
  lignes.push(`\`${cleAppel(a)}\` — émis par \`${a.emisPar}\``, '')
  if (!a.emis) lignes.push('Redirection du navigateur — jamais émise par le serveur.', '')

  if (a.parametres.length > 0) {
    lignes.push("| Paramètre | Source | D'où vient la valeur | Exemple |", '|---|---|---|---|')
    for (const p of a.parametres) {
      lignes.push(
        `| \`${p.nom}\` | ${LIBELLE_SOURCE[p.source]} | \`${p.origine}\` | \`${p.exemple}\` |`,
      )
    }
    lignes.push('')
  }

  lignes.push(
    `Prouvé contre ${a.preuve.version} le ${a.preuve.date}, ${LIBELLE_MOYEN[a.preuve.moyen]}.`,
    '',
  )
  lignes.push(`En échec : ${LIBELLE_ECHEC[a.echec.comportement]}. ${a.echec.visible}`, '')
  if (a.reglagesTiers.length > 0) {
    lignes.push(
      `Réglage tiers : ${a.reglagesTiers.map((r) => `\`${r}\``).join(', ')}.`,
      '',
    )
  }
  if (a.note !== undefined) lignes.push(`> ${a.note}`, '')
  return lignes
}
```

`rendreAppel` reçoit la version **préfixée du nom du système** : le test attend `Prouvé contre Dolibarr 23.0.1`. Composer dans le corps de section : `version: `${c.systeme} ${a.preuve.version}`` n'est pas acceptable si `preuve.version` porte déjà le nom (cas Google, `Google Calendar API v3`). Règle retenue, à écrire dans le module : **si `preuve.version` commence par le nom du système, on ne le préfixe pas.** Fonction dédiée, testée :

```ts
export function versionAffichee(systeme: string, version: string): string {
  return version.startsWith(systeme) ? version : `${systeme} ${version}`
}
```

et son test : `versionAffichee('Dolibarr', '23.0.1') === 'Dolibarr 23.0.1'`, `versionAffichee('Google Calendar', 'Google Calendar API v3') === 'Google Calendar API v3'`.

Le corps de `engendrerChapitre` assemble : avertissement, `# titre`, sections de préambule (`## titre` + corps), puis par catalogue `## systeme` + `Base : \`base\`` + appels **triés par `cleAppel`**, puis sections finales.

**4. Le voir passer.**

**5. Vérifier par mutation** — retirer le `sort` sur `cleAppel` : le test d'ordre doit rougir. Retirer la colonne « D'où vient la valeur » du tableau : le test de provenance doit rougir. Remplacer `LIBELLE_MOYEN[a.preuve.moyen]` par une chaîne fixe : le test de preuve doit rougir. Annuler.

---

## Tâche 9 — Le document publié est celui du catalogue

**But.** Assembler le chapitre, le publier dans `docs/integrations.md`, et faire échouer un test si le fichier committé diverge de ce que la génération produirait — le même geste que le garde-fou de dérive du schéma.

**Fichiers créés**
- `src/integrations/chapitre.ts`
- `src/integrations/chapitre.test.ts`
- `docs/integrations.md` (engendré, committé)

**Fichier modifié**
- `package.json` (script `doc:integrations`)

**Interfaces consommées.** `engendrerChapitre`, `CATALOGUE_DOLIBARR`, `CATALOGUE_GOOGLE`.

**Interfaces produites.** `construireChapitre(): string`, `CHEMIN_CHAPITRE = 'docs/integrations.md'`.

### Étapes

**1. Écrire le test qui échoue** — `src/integrations/chapitre.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CHEMIN_CHAPITRE, construireChapitre } from './chapitre'

const fichier = path.resolve(process.cwd(), CHEMIN_CHAPITRE)

describe('docs/integrations.md', () => {
  it('est exactement ce que la génération produit', () => {
    const attendu = construireChapitre()

    // Mode écriture : `npm run doc:integrations`. Le test devient alors la
    // génération elle-même — un seul chemin de code, donc aucun écart
    // possible entre ce qui écrit et ce qui vérifie.
    if (process.env.CRA_DOC_ECRIRE === '1') {
      writeFileSync(fichier, attendu, 'utf8')
      return
    }

    const publie = readFileSync(fichier, 'utf8')
    expect(publie).toBe(attendu)
  })

  it('ne porte aucun secret, même factice', () => {
    expect(readFileSync(fichier, 'utf8')).not.toMatch(/ya29\.|1\/\/[A-Za-z0-9_-]{15,}/)
  })

  it('couvre les deux systèmes', () => {
    const publie = readFileSync(fichier, 'utf8')
    expect(publie).toContain('## Dolibarr')
    expect(publie).toContain('## Google Calendar')
  })
})
```

**2. Le voir échouer** — `docs/integrations.md` n'existe pas.

**3. Implémenter** — `src/integrations/chapitre.ts` :

```ts
/**
 * Le chapitre des intégrations : catalogues + la prose que les catalogues ne
 * portent pas.
 *
 * La prose vit ici et non dans le fichier Markdown parce que le fichier est
 * **engendré**. Écrire dans `docs/integrations.md` à la main fait échouer
 * `chapitre.test.ts` — c'est voulu.
 */
import { engendrerChapitre } from '@/core/integrations/document'
import { CATALOGUE_DOLIBARR } from './dolibarr/catalogue'
import { CATALOGUE_GOOGLE } from './google/catalogue'

export const CHEMIN_CHAPITRE = 'docs/integrations.md'

export function construireChapitre(): string {
  return engendrerChapitre({
    titre: 'Intégrations',
    preambule: [
      {
        titre: 'À quoi sert ce chapitre',
        corps: [
          "Il dit **où sont les appels aux API externes, quels paramètres chacun porte, et",
          "d'où vient la valeur de chacun** — pour suivre les évolutions des systèmes tiers",
          'sans relire tout le code.',
          '',
          'Il est **engendré** depuis `src/integrations/<système>/catalogue.ts`. Trois tests',
          "l'empêchent de mentir : le double d'API refuse une route absente du catalogue, un",
          "test de couverture refuse une entrée que rien n'exerce, et ce fichier est comparé",
          'à ce que la génération produirait.',
          '',
          "Ce qu'il n'est pas : une réécriture de la documentation de Dolibarr ou de Google.",
          'Il décrit **les appels que cette application émet**, et rien de plus.',
        ].join('\n'),
      },
    ],
    catalogues: [CATALOGUE_DOLIBARR, CATALOGUE_GOOGLE],
    final: [], // rempli par la tâche 10
  })
}
```

Puis engendrer et committer le fichier : `npm run doc:integrations`.

`package.json`, dans `scripts` :

```json
    "doc:integrations": "CRA_DOC_ECRIRE=1 vitest run src/integrations/chapitre.test.ts",
```

**4. Le voir passer** — `npx vitest run src/integrations/chapitre.test.ts` sans la variable.

**5. Vérifier par mutation** — ajouter une ligne à la main dans `docs/integrations.md` : le test doit rougir en montrant l'écart. Retirer une entrée du catalogue Dolibarr sans régénérer : le test doit rougir. Annuler, régénérer, vérifier que le fichier est identique à celui d'avant (`git diff` vide).

---

## Tâche 10 — La procédure de montée de version et l'encadré des réglages tiers

**But.** Donner au chapitre ce qu'un catalogue ne porte pas : **comment on met à jour**. Et corriger, à sa source, l'affirmation fausse sur `TIMESHEET_DAY_DURATION` (D8).

**Fichiers modifiés**
- `src/integrations/chapitre.ts` (section `final`)
- `src/integrations/chapitre.test.ts` (ajout de tests)
- `docs/integrations.md` (régénéré)

**Interfaces consommées.** Celles de la tâche 9.

### Étapes

**1. Écrire le test qui échoue** — dans `chapitre.test.ts` :

```ts
describe('procédure de montée de version', () => {
  const publie = (): string => readFileSync(fichier, 'utf8')

  it('renvoie au test d intégration sur instance jetable', () => {
    expect(publie()).toContain('instance jetable')
    expect(publie()).toContain('npm run test:integration:dolibarr')
  })

  it('dit ce qu on fait de ce qui passe et de ce qui casse', () => {
    const texte = publie()
    expect(texte).toContain('met à jour sa version et sa date dans le catalogue')
    expect(texte).toContain("nommé avec l'appel et le champ fautifs")
  })

  it('dit que TIMESHEET_DAY_DURATION s aligne et ne se compense pas', () => {
    const texte = publie()
    expect(texte).toContain('Cela s’aligne ; cela ne se compense pas.')
    expect(texte).toContain('`duration` est un nombre de secondes')
  })

  it('ne répète pas l affirmation fausse du septième', () => {
    expect(publie()).not.toMatch(/septième|1\/7/)
  })
})
```

**2. Le voir échouer.**

**3. Implémenter** — remplir `final` dans `construireChapitre()` avec deux sections. Texte à écrire, mot pour mot pour les phrases que le test fige :

```
## Suivre les évolutions d'un système tiers

1. Le catalogue dit contre quelle version chaque appel a été prouvé, et à quelle date.
   L'environnement du porteur est aujourd'hui **Dolibarr 23.0.1**.
2. Le lot 2 livre un test d'intégration sur **instance jetable** : un vrai Dolibarr, lancé
   le temps du test — `npm run test:integration:dolibarr`.
3. Après une montée de version, relancer ce test contre la nouvelle instance.
4. Ce qui passe **met à jour sa version et sa date dans le catalogue**
   (`src/integrations/dolibarr/catalogue.ts`, champ `preuve`, `moyen: 'INSTANCE_JETABLE'`).
   Ce qui casse est **nommé avec l'appel et le champ fautifs**, jamais résumé en « la
   synchronisation ne marche plus ».
5. Régénérer le chapitre : `npm run doc:integrations`.

C'est ce qui transforme « je crois que ça marche encore » en « c'est prouvé contre telle
version, à telle date ».

## Les réglages tiers qui changent le sens des données

### `TIMESHEET_DAY_DURATION`

Réglé à **7 heures** chez le porteur, quand le réglage local par défaut est de 480 minutes.

**Ce réglage ne rend aucun temps faux.** `duration` est un nombre de secondes : huit heures
travaillées valent 28 800 secondes quelle que soit sa valeur. Compenser ferait passer huit
heures pour sept.

Ce qu'il change est **la lecture jour/heure dans Dolibarr** : huit heures s'y lisent
« 1,14 jour ». Cela s’aligne ; cela ne se compense pas. L'écran Administration · Dolibarr
propose la reprise (`previewDolibarrSetup`), qui n'écrit rien sans décision, et ne touche
jamais un CRA validé.

### `SOCIETE_FISCAL_MONTH_START`

Réglé à **4** chez le porteur — exercice d'avril à mars. Il déplace les bornes de l'objectif
de chiffre d'affaires. Même écran, même règle : proposé, jamais imposé.
```

Le nom de commande `npm run test:integration:dolibarr` **doit correspondre à ce que le lot 2 a livré**. Le vérifier dans `package.json` avant d'écrire la phrase ; s'il porte un autre nom, écrire le nom réel dans le texte **et** dans le test. S'il n'existe pas encore, écrire le nom réel du chemin du fichier de test d'intégration et le dire tel quel — jamais une commande inventée.

Régénérer : `npm run doc:integrations`. Committer `docs/integrations.md`.

**4. Le voir passer.**

**5. Vérifier par mutation** — remplacer « Cela s’aligne ; cela ne se compense pas. » par « Les temps poussés sont faux d'un septième si on l'ignore. » puis régénérer : les deux derniers tests doivent rougir. Retirer l'étape 4 de la procédure : le test « ce qu'on fait de ce qui passe » doit rougir. Annuler, régénérer.

---

## Tâche 11 — `docs/reprise-du-code.md`, pour qui reprend le code

**But.** Écrire ce qu'un développeur qui reprend le projet ne peut pas déduire du code : l'architecture en trois couches et **pourquoi**, les règles métier qu'on n'enfreint pas, les pièges d'environnement durement acquis, la méthode de travail et ce qu'elle a coûté d'apprendre.

**Fichier créé**
- `docs/reprise-du-code.md`

**Fichier lu (non modifié à cette tâche)**
- `docs/superpowers/ETAT.md` — §3, §6, §7

**Interfaces consommées / produites.** Aucune : c'est de la prose. Le test de cette tâche est celui de la tâche 14 ; elle porte néanmoins sa propre vérification (étape 4).

### Étapes

**1. Écrire le squelette et la vérification** — créer le fichier avec ces sections, dans cet ordre :

1. **Les trois couches** — `src/core/` (domaine pur), `src/services/` (base, scopée par `userId`), `src/app/` + `src/components/` (Next). Une phrase par couche, et **pourquoi** le cœur n'importe jamais Prisma : le domaine se teste sans base, sans serveur, sans navigateur, et c'est ce qui rend la suite rapide au point qu'on la lance. Renvoyer aux fichiers, ne pas les paraphraser.
2. **Les règles métier qu'on n'enfreint pas** — reprendre `ETAT.md` §3 **intégralement**, réécrit pour un lecteur humain. Ne rien retirer : chacune de ces lignes a un coût de découverte. Garder en particulier le paragraphe « le gel du facteur se casse en lecture, pas en écriture », qui est la règle la plus contre-intuitive du projet, et la liste des lecteurs déjà couverts.
3. **Les pièges d'environnement** — `ETAT.md` §7, tel quel dans le fond : `jsdom` inutilisable (Node 22.11 < 22.12) et `// @vitest-environment happy-dom` en première ligne, `afterEach(cleanup)` explicite, `fileParallelism: false`, base par PID, `next build` pendant `next dev`, jamais `git add -A`, TypeScript épinglé en `^5.9`, `@theme` sans `inline`, `page.tsx` et ses exports, `signIn` qui lève en cas de succès, l'espace fine insécable de `toLocaleString('fr-FR')`, `npm run db:sqlite` et `--accept-data-loss`.
4. **La méthode de travail, et ce qu'elle a coûté d'apprendre** — `ETAT.md` §6 : spec → plan → implémentation → revue adversariale → correction. Et surtout la phrase qui vaut d'être retenue : **la vérification par mutation est la seule preuve qu'un test sert à quelque chose**, avec les trois exemples concrets (isolation par utilisateur sortant par un retour anticipé, six mutations vertes au lot 1e, arrondi qui n'arrondissait jamais).
5. **Où lire la suite** — liens relatifs vers `docs/integrations.md`, `docs/decisions.md`, `README.md`, et vers `docs/superpowers/specs/` et `docs/superpowers/plans/` **comme documents de travail**, en le disant.

**2. Écrire ce que le code ne peut pas dire, et rien d'autre.** Passe de relecture obligatoire : supprimer toute phrase qui paraphrase une signature, un nom de fonction ou une structure de dossier évidente. Si une phrase se vérifie en ouvrant un fichier, elle n'a pas sa place.

**3. Vérifier les faits, un par un.** Chaque affirmation d'environnement est **relue contre le dépôt** : `vitest.config.ts` pour `fileParallelism`, `vitest.globalSetup.ts` pour la base par PID, `package.json` pour la version de TypeScript et les scripts. Une affirmation qui ne se vérifie pas est corrigée, pas recopiée.

**4. Vérification propre à la tâche** — `npx vitest run` reste vert (aucun code touché), et :

```bash
grep -n "ETAT.md" docs/reprise-du-code.md   # doit ne rien rendre
```

**5. Vérifier par mutation** — le garde de cette tâche est celui de la tâche 14 ; y revenir après elle et vérifier qu'un lien relatif cassé dans ce fichier (`docs/inexistant.md`) fait rougir `src/docs/documentation.test.ts`. Annuler.

---

## Tâche 12 — `docs/decisions.md`, pour le porteur, et retrait d'`ETAT.md`

**But.** Écrire ce qui a le plus de valeur dans six mois : les décisions structurantes et **leur pourquoi** — ce qu'aucune lecture du code ne redonne. Puis retirer `ETAT.md`, dont tout le contenu utile est désormais réparti.

**Fichier créé**
- `docs/decisions.md`

**Fichier supprimé**
- `docs/superpowers/ETAT.md`

**Prérequis.** Les tâches 11 et 13 sont terminées : elles lisent `ETAT.md`.

### Étapes

**1. Écrire le fichier** — sections, dans cet ordre :

1. **Ce qu'est ce produit** — deux paragraphes : CRA pour consultant indépendant, autoportant, connecteurs optionnels et additifs. Porteur : Keveen Plante, KREATIV PROJECT MANAGEMENT SASU.
2. **Les décisions qui ne se rouvrent pas** — le tableau d'`ETAT.md` §2, décision et pourquoi, **sans en retirer une seule** : l'application est le produit et Dolibarr le back-office ; l'application ne facture pas ; mono-organisation ; l'engagement porté par la ligne de prestation ; synchronisation unidirectionnelle ; la conversion prévisionnel → réalisé jamais automatique ; le facteur de conversion figé à l'écriture ; pas de portail client ; aucun montant sur le CRA.
3. **Arbitrages rendus en cours de route** — `ETAT.md` §9 bis : déconnexion Google honnête plutôt que révocation à moitié ; l'écran de supervision attend le lot 4 ; mise à jour d'événement plutôt que suppression/recréation, et le bouton « sauvegarder » écarté avec sa raison ; `ownerScope` dans la contrainte d'unicité de `ProviderCredential`, et **pourquoi `NULL` ne pouvait pas jouer ce rôle** (`NULL` n'est jamais égal à `NULL`, la contrainte d'unicité ne mordait pas).
4. **L'environnement du porteur** — client OAuth Google existant réutilisable en ajoutant le scope ; Documenso auto-hébergé ; n8n disponible, consommateur de l'API, jamais une dépendance ; identité de marque relevée sur `kreativpm.fr` (crème `#FAF5ED`, encre `#342820`, accent or `#D4943F`, Manrope 800 et Inter), et la remarque qui compte : le bleu du thème Dolibarr n'est pas l'identité. **Les réglages Dolibarr ne sont pas repris ici** : ils vivent dans `docs/integrations.md`, engendré, et les y dupliquer serait recréer exactement le mensonge que ce lot combat. Y renvoyer par lien.
5. **Dettes connues, non bloquantes** — `ETAT.md` §8, réécrit pour un lecteur : `today` dérivé de l'heure UTC ; le middleware edge et la session orpheline ; `month` non validé côté service ; la ligne archivée portant du réalisé ; `theme.ts` qui tire les fériés ; la grille à 1364 px ; les couples de contraste non balayés ; Docker et Postgres jamais exécutés ici ; les vulnérabilités npm transitives ; `manifest.webmanifest` et `icon.svg` aux couleurs en dur. Ajouter la dette restée ouverte du lot 1c : **le glissement au doigt n'est prouvé par aucun test** (`releasePointerCapture`, la mutation survit sous `happy-dom`) — à essayer sur un téléphone.
6. **Où lire le détail** — renvoyer aux specs et aux plans **par chemin relatif**, en disant ce qu'ils sont : des documents de travail, datés, non tenus à jour. Ne pas les résumer.

**2. Retirer `ETAT.md`** :

```bash
git rm docs/superpowers/ETAT.md
```

**3. Vérifier qu'il ne reste aucun renvoi** :

```bash
grep -rn "ETAT.md" --include="*.md" --include="*.ts" --include="*.json" . \
  | grep -v node_modules | grep -v docs/superpowers/plans | grep -v docs/superpowers/specs
```

Doit ne rien rendre. Les plans et les specs antérieurs y renvoient : ce sont des documents datés, on ne les réécrit pas (D9) — mais **ce plan-ci** et les documents publiés ne doivent porter aucun renvoi vivant.

**4. Vérification** — `npx vitest run` vert, `npx tsc --noEmit` à 0.

**5. Vérifier par mutation** — restaurer `ETAT.md` et ajouter un lien vers elle depuis `docs/decisions.md` : le test de liens de la tâche 14, une fois écrite, doit rougir sur la règle « aucun renvoi vers un document retiré ». Annuler.

---

## Tâche 13 — `README.md`, pour qui déploie et exploite

**But.** Rendre le README utilisable par quelqu'un qui n'a jamais vu le projet : installer, activer un connecteur optionnel, et surtout **sauvegarder, arrêter, relancer, mettre à jour sans perdre la base**. C'est le vrai sujet d'exploitation.

**Fichier modifié**
- `README.md`

**Fichier lu**
- `docs/superpowers/ETAT.md` (§5, note `CREDENTIALS_KEY`), `docs/superpowers/specs/2026-08-15-lot-5-distribution-portable-design.md`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `package.json`.

### Étapes

**1. Réorganiser, ne pas réécrire ce qui est juste.** Le README actuel est exact et détaillé ; il est organisé par mécanisme, pas par besoin. Ordre cible :

1. Ce qu'est l'application, en trois phrases.
2. **Installer** — Docker Compose, poste local, et **l'archive portable seulement si le lot 5 l'a livrée** : vérifier dans le dépôt que `demarrer.sh` et son empaquetage existent avant d'écrire une seule ligne à leur sujet. Décrire une archive qui n'existe pas serait le premier mensonge de ce README. Les blocs de commandes existants sont conservés tels quels ; ils sont justes.
3. **Les variables d'environnement** — le tableau existant, conservé, précédé d'une phrase qui dit **lesquelles sont obligatoires** et pourquoi `CREDENTIALS_KEY` l'est au démarrage alors que Google est optionnel.
4. **Activer un connecteur optionnel** — Google Calendar (client OAuth, scope, URI de redirection au caractère près) et Dolibarr (URL d'instance et clé d'API saisies dans Administration · Dolibarr, jamais dans l'environnement). Renvoyer à `docs/integrations.md` pour ce que chaque connecteur appelle.
5. **Exploiter** — la section neuve, à écrire :
   - **Sauvegarder** : ce qu'est la base selon la cible (fichier `prisma/cra.db` en SQLite, volume `db-data` en Postgres), la commande de sauvegarde pour chacune, et le fait qu'une copie de la base ne donne accès à aucun agenda — les jetons y sont chiffrés et la clé vit dans l'environnement.
   - **Ce qu'il faut sauvegarder en plus de la base** : `CREDENTIALS_KEY` et `AUTH_SECRET`. Perdre `CREDENTIALS_KEY` impose de reconnecter Google **et** de ressaisir la clé d'API Dolibarr. **Il n'existe aucune rotation de clé** : la changer déconnecte tout le monde en silence.
   - **Arrêter et relancer** : par cible.
   - **Mettre à jour sans perdre la base** : sauvegarder d'abord, puis mettre à jour, puis `prisma migrate deploy` (Docker : automatique au démarrage du conteneur) ; et le rappel que `npm run db:sqlite` passe par `db push`, qui n'exécute aucune migration — d'où les deux scripts de reprise `backfill:rates` et `backfill:heures`, qui sont des scripts de **reprise**, pas d'entretien.
6. **Journaux** — la section existante, conservée : préfixe `[cra]`, aucun secret, `src/core/log/redact.ts`.
7. **Développement** — la section existante, réduite à ce qui sert, et renvoi vers `docs/reprise-du-code.md`.
8. **Vérification manuelle de l'installation** (D7) — une liste de cases à cocher, datée de sa dernière exécution, disant explicitement : *ces commandes n'ont pas été exécutées sur une machine vierge dans cet environnement ; Docker n'y est pas installé.* Mentir sur ce point serait pire que ne rien écrire — le README le fait déjà correctement aujourd'hui pour Docker, garder ce ton.

**2. Retirer ce qui n'a plus de destinataire** — la section « État vérifié de ce lot » est un instantané daté du lot 0/5 ; en garder **les seuls faits durables** (Postgres jamais exécuté ici, `deployment-config.test.ts` et ce qu'il prouve, `schema-migration-sync.test.ts` et ce qu'il prouve) et supprimer les décomptes de tests, qui mentent dès le commit suivant.

**3. Vérifier chaque commande** — pour chaque bloc de code du README : le `npm run X` existe-t-il dans `package.json` ? Le `node scripts/Y.mjs` existe-t-il ? Le service `docker compose` porte-t-il ce nom dans `docker-compose.yml` ? Corriger, ne pas recopier.

**4. Vérification** — `npx vitest run` vert (`src/deploy/deployment-config.test.ts` compris : il lit `.env.example`, le `Dockerfile` et le `docker-compose.yml`, qui ne sont pas modifiés ici).

**5. Vérifier par mutation** — écrire `npm run demarrer` (script inexistant) dans un bloc du README : le test de la tâche 14 doit rougir en le nommant. Annuler.

---

## Tâche 14 — Les gardes de la documentation

**But.** Trois garanties que la prose ne tient pas toute seule : **aucun secret**, **aucun lien mort**, **aucune commande inventée**.

**Fichier créé**
- `src/docs/documentation.test.ts`

**Interfaces consommées.** `ressembleAUnSecret` de `@/core/integrations/catalogue`, `node:fs`, `node:path`.

**Interfaces produites.** Aucune.

### Étapes

**1. Écrire le test qui échoue** :

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { ressembleAUnSecret } from '@/core/integrations/catalogue'

const RACINE = process.cwd()

/** La documentation publiée : le README et tout `docs/*.md`. Pas `docs/superpowers/` — documents de travail. */
function documentsPublies(): string[] {
  const dansDocs = readdirSync(path.join(RACINE, 'docs'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join('docs', e.name))
  return ['README.md', ...dansDocs]
}

describe('documentation publiée', () => {
  it('ne porte aucun secret', () => {
    const trouves: string[] = []
    for (const doc of documentsPublies()) {
      const texte = readFileSync(path.join(RACINE, doc), 'utf8')
      // Les mots isolés du texte : un secret se reconnaît à sa forme, pas à
      // son voisinage. Les délimiteurs Markdown sont retirés d'abord.
      for (const mot of texte.split(/[\s`"'(),;:<>|]+/)) {
        if (mot.length >= 20 && ressembleAUnSecret(mot)) trouves.push(`${doc} : ${mot}`)
      }
    }
    expect(trouves).toEqual([])
  })

  it('n a aucun lien relatif mort', () => {
    const morts: string[] = []
    for (const doc of documentsPublies()) {
      const texte = readFileSync(path.join(RACINE, doc), 'utf8')
      for (const [, cible] of texte.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (cible.startsWith('http://') || cible.startsWith('https://')) continue
        const resolu = path.resolve(RACINE, path.dirname(doc), cible)
        if (!existsSync(resolu)) morts.push(`${doc} → ${cible}`)
      }
    }
    expect(morts).toEqual([])
  })

  it('ne renvoie vers aucun document retiré', () => {
    for (const doc of documentsPublies()) {
      expect(readFileSync(path.join(RACINE, doc), 'utf8')).not.toContain('ETAT.md')
    }
  })

  it('ne cite aucune commande npm qui n existe pas', () => {
    const scripts = Object.keys(
      (JSON.parse(readFileSync(path.join(RACINE, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }).scripts,
    )
    const inconnues: string[] = []
    for (const doc of documentsPublies()) {
      const texte = readFileSync(path.join(RACINE, doc), 'utf8')
      for (const [, nom] of texte.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
        if (!scripts.includes(nom)) inconnues.push(`${doc} : npm run ${nom}`)
      }
    }
    expect(inconnues).toEqual([])
  })

  it('ne cite aucun script qui n existe pas', () => {
    const absents: string[] = []
    for (const doc of documentsPublies()) {
      const texte = readFileSync(path.join(RACINE, doc), 'utf8')
      for (const [, fichier] of texte.matchAll(/node (scripts\/[A-Za-z0-9._-]+)/g)) {
        if (!existsSync(path.join(RACINE, fichier))) absents.push(`${doc} : ${fichier}`)
      }
    }
    expect(absents).toEqual([])
  })

  it('rattache chaque document publié à un public', () => {
    // Un document que rien ne référence est un document que personne ne lira.
    const references = documentsPublies()
      .map((d) => readFileSync(path.join(RACINE, d), 'utf8'))
      .join('\n')
    for (const doc of documentsPublies()) {
      if (doc === 'README.md') continue
      expect(references).toContain(path.basename(doc))
    }
  })
})
```

**2. Le voir échouer** — au premier jet, plusieurs de ces tests rougissent réellement : c'est leur intérêt. Corriger la documentation, jamais le test — sauf sur un faux positif démontré du détecteur de secret, auquel cas c'est `ressembleAUnSecret` (tâche 1) qui est resserrée, avec son propre test.

**3. Corriger la documentation** jusqu'au vert.

**4. Le voir passer** — `npx vitest run`, suite entière.

**5. Vérifier par mutation** — quatre mutations, chacune doit faire rougir :
- insérer `ya29.A0ARrdaM9kQq3xVbN7tLpZ` dans `README.md` ;
- insérer `[voir](docs/inexistant.md)` dans `docs/decisions.md` ;
- insérer `npm run inexistant` dans `README.md` ;
- insérer `node scripts/inexistant.mjs` dans `README.md`.

Annuler les quatre. Vérifier `git status` propre en dehors des fichiers du lot.

---

## 5. Vérification finale du lot

Avant de déclarer le lot fini :

```bash
npx vitest run
npx tsc --noEmit
npm run doc:integrations && git diff --exit-code docs/integrations.md
```

La troisième ligne est celle qui compte : elle prouve que le document committé est **exactement** celui du catalogue. Un `git diff` non vide signifie que quelqu'un a écrit dans `docs/integrations.md` à la main, ou qu'une régénération a été oubliée.

Puis, à la main et une seule fois, la liste de vérification d'installation du README (D7), sur une machine où Docker existe. Ce qui n'a pas été exécuté est écrit comme n'ayant pas été exécuté.

---

## 6. Ce que l'auto-relecture de ce plan a corrigé

- **Le refus par 404 était un piège.** La première rédaction faisait refuser une route non cataloguée par un `404` du double. Le connecteur Google traduit 404 en `NOT_FOUND` et `deleteEvent` avale `NOT_FOUND` : un appel non catalogué serait passé au vert sur ce chemin précis. Devenu D4, et la mutation de la tâche 4 le prouve.
- **Le rapprochement par suffixe confondait deux routes.** `chemin.endsWith(gabarit)` fait passer `/projects/3/tasks` pour `/tasks`. `gabaritCorrespondant` prend donc la base en paramètre et compare exactement ; c'est une mutation explicite de la tâche 1.
- **Deux entrées Google partageaient la même clé.** L'échange et le renouvellement de jeton frappent la même route ; deux entrées auraient rendu la comparaison de couverture ambiguë. Devenu D2, une seule entrée dont `grant_type` porte les deux valeurs.
- **La date de génération aurait cassé le test dès le lendemain.** Devenu D6 et une assertion de déterminisme en tâche 8.
- **Le catalogue Dolibarr n'avait que onze entrées** : `createDraftInvoice` relit la référence par `GET /invoices/{invoiceId}`, appel bien réel, ajouté. Le test de couverture de la tâche 6 l'aurait de toute façon fait tomber, mais après coup.
- **La spec et `ETAT.md` se contredisent sur `TIMESHEET_DAY_DURATION`.** La spec §5 dit « faux d'un septième » ; `ETAT.md` §9 corrige explicitement cette affirmation, et `src/core/dolibarr/timespent.ts` la contredit. Le plan suit le code (D8), et la tâche 10 teste **les deux directions** : ce qu'il faut lire, et ce qui ne doit pas réapparaître.
- **`getProposal` n'est appelé par aucun service.** Plutôt que d'omettre l'entrée ou de la faire passer pour utilisée, la tâche 2 lui impose une note qui le dit — c'est exactement ce que le code ne dit pas.
- **Le catalogue Dolibarr n'avait aucun double au bon niveau.** `src/services/dolibarr/fake.ts` double le **port**, il ne voit passer aucune URL et ne peut donc rien refuser. D'où la tâche 5 et sa place dans `src/integrations/dolibarr/` (D1).
- **Le générateur préfixait deux fois le nom du système.** `Google Calendar API v3` serait devenu `Google Calendar Google Calendar API v3` ; `versionAffichee` et son test ont été ajoutés en tâche 8.
- **Une assertion de la tâche 8 était trop large** (« ne contient pas l'année en cours ») : les dates de preuve la portent légitimement. Remplacée par une vérification portant sur les seules quatre premières lignes, et la substitution est écrite dans la tâche pour que l'implémenteur n'écrive pas la mauvaise version.
- **L'ordre des trois tâches de documentation était faux** : les tâches 11 et 13 lisent `ETAT.md`, que la tâche 12 supprime. La 12 passe après.
