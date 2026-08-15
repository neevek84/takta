# Lot 1d — Gel du facteur de conversion · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre impossible qu'un changement de réglage réécrive l'histoire — chaque saisie porte le facteur qui convertit ses minutes en jours, figé à l'écriture, et ce facteur se résout par une cascade client → mission → prestation.

**Architecture:** Une colonne sur `TimeEntry`, deux colonnes nullables sur `Client` et `Mission`, une fonction pure de résolution dans `core/`, et le remplacement partout du réglage global par le facteur porté par la saisie.

**Tech Stack:** Next.js 15 · TypeScript · Prisma 6 · SQLite en développement · Vitest

**Spec :** `docs/superpowers/specs/2026-08-15-lot-1d-gel-facteur-conversion-design.md`

## Global Constraints

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.**
- **Aucun enum Prisma, aucun décimal persisté.** Entiers partout : minutes, centièmes de jour, centimes.
- **Portabilité SQLite/Postgres** : pas de tableau, pas de requête fine sur du JSON.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus.**
- **Une saisie porte son propre facteur de conversion, figé à l'écriture.**
- **Aucun changement de réglage ne réécrit une saisie existante.**
- **Les saisies d'un mois validé ne sont jamais réétalonnées** — ni automatiquement, ni manuellement, ni sur demande.
- **Tout calcul lit le facteur de la saisie**, jamais `Settings.minutesParJour`, qui ne sert plus qu'à la résolution de la cascade au moment de l'écriture.
- **La convention d'arrondi reste « cumuler les minutes, convertir une fois »** — mais l'accumulation ne peut se faire qu'**à facteur constant**. Grouper par facteur, convertir chaque groupe, sommer les centièmes.
- Français pour les chaînes visibles, anglais pour le code.
- `vitest.config.ts` est en `fileParallelism: false` — ne pas le modifier.
- Tests de composants : `// @vitest-environment happy-dom` en première ligne, `afterEach(cleanup)` explicite.
- **Ne jamais exécuter `npx next build`** : le serveur de développement du porteur du produit tourne sur cet arbre.

---

## Interfaces existantes

```ts
// src/core/engagement/compute.ts
interface EngagementSummary { venduCentiemes; realiseCentiemes; prevuCentiemes; resteCentiemes; depassementCentiemes }
computeEngagement(args: { venduCentiemes: number
                          entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number }>
                          minutesParJour: number }): EngagementSummary

// src/core/time/units.ts
minutesToCentiemes(minutes: number, minutesParJour: number): number

// src/core/fiscal/revenue.ts
caFromEntries(entries: ReadonlyArray<{ lineId: string; minutes: number }>,
              lines: ReadonlyArray<{ id: string; tjmCents: number; minutesParJour: number }>): number

// src/services/time-entries.ts
interface MonthEntry { id; lineId; date; minutes; kind; slotId }
getMonthEntries(userId: string, month: string): Promise<MonthEntry[]>
saveEntry(args: { userId; lineId; date; minutes; kind; slotId? }): Promise<SaveResult>

// src/services/missions.ts
interface LineForGrid { id; label; missionLabel; clientName; displayUnit; minutesParJour; soldCentiemes; allowedSlotIds }
listActiveLines(userId: string): Promise<LineForGrid[]>
createLine(args: { missionId; userId; label; soldCentiemes; tjmCents; displayUnit?; minutesParJour?; allowedSlotIds? })
createMission(args: { clientId; label })
// src/services/clients.ts
createClient(name: string)
```

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/core/rates/cascade.ts` | Résolution du facteur, pure |
| `src/core/engagement/compute.ts` | *(modifié)* facteur porté par chaque saisie |
| `src/core/fiscal/revenue.ts` | *(modifié)* idem |
| `prisma/schema.prisma` | *(modifié)* 3 colonnes |
| `scripts/backfill-minutes-par-jour.mjs` | Reprise des saisies existantes |
| `src/services/time-entries.ts` | *(modifié)* gel à l'écriture, restitution en lecture |
| `src/services/rates.ts` | Réétalonnage des mois ouverts |
| `src/services/missions.ts`, `clients.ts` | *(modifiés)* surcharges |

**Dépendances :** 1 et 2 sont indépendantes. 3 et 6 consomment 1 et 2. 4 et 5 consomment 3.

---

## Task 1: Résolution de la cascade

**Files:** Create `src/core/rates/cascade.ts`, `src/core/rates/cascade.test.ts`

**Interfaces:**
- Consumes: rien
- Produces: `resolveMinutesParJour(levels: { line?: number | null; mission?: number | null; client?: number | null; global: number }): number`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/rates/cascade.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { resolveMinutesParJour } from './cascade'

describe('resolveMinutesParJour', () => {
  it('retombe sur le réglage global quand rien n est surchargé', () => {
    expect(resolveMinutesParJour({ global: 480 })).toBe(480)
  })

  it('le client l emporte sur le global', () => {
    expect(resolveMinutesParJour({ client: 420, global: 480 })).toBe(420)
  })

  it('la mission l emporte sur le client', () => {
    expect(resolveMinutesParJour({ mission: 450, client: 420, global: 480 })).toBe(450)
  })

  it('la prestation l emporte sur tout', () => {
    expect(resolveMinutesParJour({ line: 400, mission: 450, client: 420, global: 480 })).toBe(400)
  })

  it('traite null et undefined comme non renseignés', () => {
    expect(resolveMinutesParJour({ line: null, mission: undefined, client: 420, global: 480 })).toBe(420)
  })

  it('ne saute pas un niveau intermédiaire non renseigné', () => {
    expect(resolveMinutesParJour({ line: null, mission: null, client: 420, global: 480 })).toBe(420)
    expect(resolveMinutesParJour({ line: 400, mission: null, client: null, global: 480 })).toBe(400)
  })

  it('rejette un facteur global non exploitable', () => {
    expect(() => resolveMinutesParJour({ global: 0 })).toThrow()
    expect(() => resolveMinutesParJour({ global: -1 })).toThrow()
  })

  it('rejette une surcharge non exploitable plutôt que de la sauter', () => {
    // Sauter silencieusement ferait passer une donnée corrompue pour un héritage.
    expect(() => resolveMinutesParJour({ client: 0, global: 480 })).toThrow()
    expect(() => resolveMinutesParJour({ line: -5, global: 480 })).toThrow()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/rates/cascade.test.ts`
Expected: FAIL — `Failed to resolve import "./cascade"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/rates/cascade.ts` :

```ts
export interface RateLevels {
  /** surcharge portée par la prestation */
  line?: number | null
  /** surcharge portée par la mission */
  mission?: number | null
  /** surcharge portée par le client */
  client?: number | null
  /** réglage global, toujours renseigné */
  global: number
}

function assertExploitable(valeur: number, niveau: string): void {
  if (!Number.isInteger(valeur) || valeur <= 0) {
    throw new Error(
      `La durée d'une journée définie au niveau ${niveau} doit être un entier de minutes strictement positif.`,
    )
  }
}

/**
 * Résout le facteur effectif du plus spécifique au plus général.
 * Une surcharge renseignée mais aberrante lève, plutôt que d'être sautée :
 * la sauter ferait passer une donnée corrompue pour un héritage volontaire.
 */
export function resolveMinutesParJour(levels: RateLevels): number {
  assertExploitable(levels.global, 'global')

  for (const [niveau, valeur] of [
    ['prestation', levels.line],
    ['mission', levels.mission],
    ['client', levels.client],
  ] as const) {
    if (valeur === null || valeur === undefined) continue
    assertExploitable(valeur, niveau)
    return valeur
  }

  return levels.global
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/rates/cascade.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/rates/
git commit -m "feat(core): resolution en cascade de la duree d'une journee"
```

---

## Task 2: Schéma et reprise des données

**Files:** Modify `prisma/schema.prisma`. Create `scripts/backfill-minutes-par-jour.mjs`, `src/db/rates-schema.test.ts`

**Interfaces:**
- Consumes: `resolveMinutesParJour` de la tâche 1
- Produces: `TimeEntry.minutesParJour Int`, `Client.minutesParJour Int?`, `Mission.minutesParJour Int?`

- [ ] **Step 1: Étendre le schéma**

Dans `prisma/schema.prisma` :

```prisma
model Client {
  // … champs existants
  /// surcharge de la durée d'une journée, en minutes. null = hérite du global.
  minutesParJour Int?
}

model Mission {
  // … champs existants
  /// surcharge de la durée d'une journée, en minutes. null = hérite du client.
  minutesParJour Int?
}

model TimeEntry {
  // … champs existants
  /// durée d'une journée au moment de l'écriture, en minutes.
  /// Le défaut n'existe que pour permettre la migration d'une table peuplée :
  /// le chemin d'écriture renseigne TOUJOURS cette colonne explicitement.
  minutesParJour Int @default(480)
}
```

Puis appliquer :

```bash
npm run db:sqlite
```

- [ ] **Step 2: Écrire le script de reprise**

`scripts/backfill-minutes-par-jour.mjs` :

```js
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
const global = settings?.minutesParJour ?? 480

const entries = await prisma.timeEntry.findMany({
  select: {
    id: true,
    line: {
      select: {
        minutesParJour: true,
        mission: { select: { minutesParJour: true, client: { select: { minutesParJour: true } } } },
      },
    },
  },
})

let repris = 0
for (const e of entries) {
  const effectif =
    e.line.minutesParJour ??
    e.line.mission.minutesParJour ??
    e.line.mission.client.minutesParJour ??
    global

  await prisma.timeEntry.update({ where: { id: e.id }, data: { minutesParJour: effectif } })
  repris++
}

console.log(`${repris} saisie(s) reprise(s).`)
await prisma.$disconnect()
```

Ajouter à `package.json` : `"backfill:rates": "node scripts/backfill-minutes-par-jour.mjs"`

- [ ] **Step 3: Écrire le test qui échoue**

`src/db/rates-schema.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './client'

let userId = ''
let clientId = ''
let missionId = ''
let lineId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'rates@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await prisma.client.create({ data: { name: 'RATES client', minutesParJour: 420 } })
  clientId = c.id
  const m = await prisma.mission.create({ data: { clientId, label: 'RATES mission' } })
  missionId = m.id
  const l = await prisma.missionLine.create({
    data: { missionId, label: 'L', soldCentiemes: 1000, tjmCents: 80000 },
  })
  lineId = l.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'rates@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'RATES client' } })
  await prisma.$disconnect()
})

describe('schéma des facteurs', () => {
  it('accepte une surcharge sur le client', async () => {
    const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId } })
    expect(c.minutesParJour).toBe(420)
  })

  it('laisse la surcharge de mission nulle par défaut', async () => {
    const m = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })
    expect(m.minutesParJour).toBeNull()
  })

  it('stocke le facteur sur la saisie', async () => {
    const e = await prisma.timeEntry.create({
      data: {
        lineId,
        userId,
        date: new Date('2026-05-04T00:00:00Z'),
        minutes: 420,
        kind: 'REALISE',
        minutesParJour: 420,
      },
    })
    expect(e.minutesParJour).toBe(420)
    expect(Number.isInteger(e.minutesParJour)).toBe(true)
  })

  it('conserve des facteurs différents sur deux saisies du même mois', async () => {
    const base = { lineId, userId, minutes: 240, kind: 'REALISE' }
    const a = await prisma.timeEntry.create({
      data: { ...base, date: new Date('2026-05-05T00:00:00Z'), minutesParJour: 420 },
    })
    const b = await prisma.timeEntry.create({
      data: { ...base, date: new Date('2026-05-06T00:00:00Z'), minutesParJour: 480 },
    })
    expect([a.minutesParJour, b.minutesParJour]).toEqual([420, 480])
  })
})
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/db/rates-schema.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Exécuter la reprise et vérifier**

```bash
npm run backfill:rates
```

Puis vérifier qu'aucune saisie ne conserve la valeur par défaut alors que sa cascade dit autre chose :

```bash
node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.timeEntry.findMany({select:{id:true,minutesParJour:true}}).then(r=>{
  console.log('saisies:',r.length,'facteurs distincts:',[...new Set(r.map(e=>e.minutesParJour))]);
}).finally(()=>p.\$disconnect())"
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): facteur de conversion sur la saisie et surcharges client/mission"
```

---

## Task 3: Gel à l'écriture, restitution en lecture

**Files:** Modify `src/services/time-entries.ts`, `src/services/time-entries.test.ts`

**Interfaces:**
- Consumes: `resolveMinutesParJour`, les colonnes de la tâche 2
- Produces: `MonthEntry` gagne `minutesParJour: number` ; `saveEntry` renseigne toujours la colonne

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/services/time-entries.test.ts` :

```ts
import { resolveMinutesParJour } from '@/core/rates/cascade'

describe('gel du facteur de conversion', () => {
  it('fige le facteur effectif au moment de l écriture', async () => {
    await updateSettings({ minutesParJour: 480 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-01', minutes: 480, kind: 'REALISE' })

    const avant = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-06-01T00:00:00.000Z') },
    })
    expect(avant.minutesParJour).toBe(480)
  })

  it('n écrit jamais le défaut du schéma quand le réglage vaut autre chose', async () => {
    // Si le chemin d'écriture oubliait de renseigner la colonne, ce test
    // verrait 480 — le défaut du schéma — au lieu de 420.
    await updateSettings({ minutesParJour: 420 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-02', minutes: 420, kind: 'REALISE' })

    const e = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-06-02T00:00:00.000Z') },
    })
    expect(e.minutesParJour).toBe(420)
  })

  it('ne réécrit jamais une saisie existante quand le réglage change', async () => {
    await updateSettings({ minutesParJour: 480 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-03', minutes: 480, kind: 'REALISE' })

    await updateSettings({ minutesParJour: 420 })

    const e = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-06-03T00:00:00.000Z') },
    })
    expect(e.minutesParJour).toBe(480)
  })

  it('laisse coexister deux facteurs dans le même mois', async () => {
    await updateSettings({ minutesParJour: 480 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-04', minutes: 480, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 420 })
    await saveEntry({ userId, lineId: lineB, date: '2026-06-05', minutes: 420, kind: 'REALISE' })

    const entries = await getMonthEntries(userId, '2026-06')
    const facteurs = entries.map((e) => e.minutesParJour).sort()
    expect(facteurs).toEqual([420, 480])
  })

  it('restitue le facteur dans MonthEntry', async () => {
    await updateSettings({ minutesParJour: 450 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-06', minutes: 450, kind: 'REALISE' })

    const entry = (await getMonthEntries(userId, '2026-06')).find((e) => e.date === '2026-06-06')
    expect(entry!.minutesParJour).toBe(450)
  })

  it('respecte une surcharge portée par le client', async () => {
    const line = await prisma.missionLine.findUniqueOrThrow({
      where: { id: lineA },
      select: { mission: { select: { clientId: true } } },
    })
    await prisma.client.update({
      where: { id: line.mission.clientId },
      data: { minutesParJour: 400 },
    })
    await updateSettings({ minutesParJour: 480 })

    await saveEntry({ userId, lineId: lineA, date: '2026-06-07', minutes: 400, kind: 'REALISE' })

    const e = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-06-07T00:00:00.000Z') },
    })
    expect(e.minutesParJour).toBe(400)

    await prisma.client.update({
      where: { id: line.mission.clientId },
      data: { minutesParJour: null },
    })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/time-entries.test.ts`
Expected: FAIL — `minutesParJour` vaut 480 par défaut au lieu de la valeur résolue, et `MonthEntry` ne le porte pas

- [ ] **Step 3: Écrire l'implémentation**

Dans `src/services/time-entries.ts` :

Ajouter à l'interface `MonthEntry` :

```ts
  /** durée d'une journée figée à l'écriture, en minutes */
  minutesParJour: number
```

Ajouter la fonction de résolution et l'utiliser dans `saveEntry` :

```ts
import { resolveMinutesParJour } from '@/core/rates/cascade'

/** Résout le facteur effectif d'une prestation en remontant la cascade. */
async function facteurDeLaLigne(lineId: string, globalMinutesParJour: number): Promise<number> {
  const line = await prisma.missionLine.findUniqueOrThrow({
    where: { id: lineId },
    select: {
      minutesParJour: true,
      mission: {
        select: { minutesParJour: true, client: { select: { minutesParJour: true } } },
      },
    },
  })

  return resolveMinutesParJour({
    line: line.minutesParJour,
    mission: line.mission.minutesParJour,
    client: line.mission.client.minutesParJour,
    global: globalMinutesParJour,
  })
}
```

Dans `saveEntry`, après la lecture des réglages et avant l'écriture, calculer `const minutesParJour = await facteurDeLaLigne(args.lineId, settings.minutesParJour)`, puis l'ajouter au `create` **et** au `update` de l'`upsert` :

```ts
    create: {
      lineId: args.lineId,
      userId: args.userId,
      date,
      slotId,
      minutes: args.minutes,
      kind: args.kind,
      minutesParJour,
    },
    update: { minutes: args.minutes, kind: args.kind, minutesParJour },
```

Ajouter enfin `minutesParJour: r.minutesParJour` au mappage de `getMonthEntries`.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/time-entries.test.ts`
Expected: PASS — les 6 tests nouveaux plus tous les existants

- [ ] **Step 5: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(saisie): fige le facteur de conversion a l'ecriture"
```

---

## Task 4: Les calculs lisent le facteur de la saisie

**Files:** Modify `src/core/engagement/compute.ts` + test, `src/core/fiscal/revenue.ts` + test, `src/services/charge.ts` + test, `src/components/charge/EngagementBar.tsx`

**Interfaces:**
- Consumes: `MonthEntry.minutesParJour` de la tâche 3
- Produces:
  - `computeEngagement(args: { venduCentiemes: number; entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number; minutesParJour: number }> }): EngagementSummary` — le paramètre `minutesParJour` de premier niveau **disparaît**
  - `caFromEntries(entries: ReadonlyArray<{ lineId: string; minutes: number; minutesParJour: number }>, lines: ReadonlyArray<{ id: string; tjmCents: number }>): number` — `minutesParJour` **quitte** `lines`

**La subtilité de cette tâche.** La convention établie est « cumuler les minutes, convertir une fois ». Elle ne tient qu'**à facteur constant** : additionner 420 minutes converties à 420/jour et 480 minutes converties à 480/jour n'a aucun sens. Il faut donc **grouper par facteur**, convertir chaque groupe, puis sommer les centièmes. Dans la pratique un groupe est presque toujours seul ; le regroupement n'est là que pour que le cas mixte soit juste.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `src/core/engagement/compute.test.ts` :

```ts
describe('facteur porté par chaque saisie', () => {
  it('convertit chaque saisie avec son propre facteur', () => {
    const r = computeEngagement({
      venduCentiemes: 3000,
      entries: [
        { kind: 'REALISE', minutes: 420, minutesParJour: 420 },
        { kind: 'REALISE', minutes: 480, minutesParJour: 480 },
      ],
    })
    // Deux journées pleines, comptées à leurs facteurs respectifs.
    expect(r.realiseCentiemes).toBe(200)
  })

  it('cumule avant de convertir, à facteur constant', () => {
    // 10 saisies d'une heure à 420 min/jour : 600 minutes cumulées puis
    // converties donnent 143, quand 10 conversions séparées donneraient 140.
    const entries = Array.from({ length: 10 }, () => ({
      kind: 'REALISE' as const,
      minutes: 60,
      minutesParJour: 420,
    }))
    expect(computeEngagement({ venduCentiemes: 3000, entries }).realiseCentiemes).toBe(143)
  })

  it('groupe par facteur sans mélanger les minutes', () => {
    const r = computeEngagement({
      venduCentiemes: 3000,
      entries: [
        { kind: 'REALISE', minutes: 60, minutesParJour: 420 },
        { kind: 'REALISE', minutes: 60, minutesParJour: 420 },
        { kind: 'REALISE', minutes: 60, minutesParJour: 480 },
      ],
    })
    // 120/420 = 29 (arrondi) ; 60/480 = 13 (arrondi) ; total 42.
    expect(r.realiseCentiemes).toBe(42)
  })
})
```

Ajouter à `src/core/fiscal/revenue.test.ts` :

```ts
describe('caFromEntries — facteur porté par la saisie', () => {
  it('valorise chaque saisie au facteur qu elle porte', () => {
    const ca = caFromEntries(
      [
        { lineId: 'a', minutes: 420, minutesParJour: 420 },
        { lineId: 'a', minutes: 480, minutesParJour: 480 },
      ],
      [{ id: 'a', tjmCents: 80000 }],
    )
    // Deux journées pleines à 800 €.
    expect(ca).toBe(160000)
  })

  it('ignore une saisie dont la ligne est inconnue', () => {
    expect(caFromEntries([{ lineId: 'x', minutes: 480, minutesParJour: 480 }], [
      { id: 'a', tjmCents: 80000 },
    ])).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/core/engagement/ src/core/fiscal/`
Expected: FAIL — erreurs de type et résultats faux

- [ ] **Step 3: Réécrire `computeEngagement`**

`src/core/engagement/compute.ts` :

```ts
import type { TimeEntryKind } from '../types'
import { minutesToCentiemes } from '../time/units'

export interface EngagementSummary {
  venduCentiemes: number
  realiseCentiemes: number
  prevuCentiemes: number
  resteCentiemes: number
  depassementCentiemes: number
}

/**
 * Cumule les minutes avant de convertir — mais seulement à facteur constant :
 * des minutes converties à 420/jour et à 480/jour ne s'additionnent pas.
 */
function centiemesParFacteur(
  entries: ReadonlyArray<{ minutes: number; minutesParJour: number }>,
): number {
  const parFacteur = new Map<number, number>()
  for (const e of entries) {
    parFacteur.set(e.minutesParJour, (parFacteur.get(e.minutesParJour) ?? 0) + e.minutes)
  }

  let centiemes = 0
  for (const [facteur, minutes] of parFacteur) {
    centiemes += minutesToCentiemes(minutes, facteur)
  }
  return centiemes
}

export function computeEngagement(args: {
  venduCentiemes: number
  entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number; minutesParJour: number }>
}): EngagementSummary {
  const realiseCentiemes = centiemesParFacteur(args.entries.filter((e) => e.kind === 'REALISE'))
  const prevuCentiemes = centiemesParFacteur(args.entries.filter((e) => e.kind === 'PREVISIONNEL'))
  const solde = args.venduCentiemes - realiseCentiemes - prevuCentiemes

  return {
    venduCentiemes: args.venduCentiemes,
    realiseCentiemes,
    prevuCentiemes,
    resteCentiemes: Math.max(0, solde),
    depassementCentiemes: Math.max(0, -solde),
  }
}
```

- [ ] **Step 4: Réécrire `caFromEntries`**

Dans `src/core/fiscal/revenue.ts`, remplacer `caFromEntries` :

```ts
export function caFromEntries(
  entries: ReadonlyArray<{ lineId: string; minutes: number; minutesParJour: number }>,
  lines: ReadonlyArray<{ id: string; tjmCents: number }>,
): number {
  const tjmById = new Map(lines.map((l) => [l.id, l.tjmCents]))

  // Cumul des minutes par (ligne, facteur) : un seul arrondi par groupe.
  const parGroupe = new Map<string, { lineId: string; facteur: number; minutes: number }>()
  for (const e of entries) {
    if (!tjmById.has(e.lineId) || e.minutesParJour <= 0) continue
    const cle = `${e.lineId}|${e.minutesParJour}`
    const g = parGroupe.get(cle) ?? { lineId: e.lineId, facteur: e.minutesParJour, minutes: 0 }
    g.minutes += e.minutes
    parGroupe.set(cle, g)
  }

  let cents = 0
  for (const g of parGroupe.values()) {
    cents += Math.round((g.minutes * (tjmById.get(g.lineId) ?? 0)) / g.facteur)
  }
  return cents
}
```

Adapter les tests existants de `revenue.test.ts` qui passaient `minutesParJour` dans `lines` : le déplacer sur chaque entrée. **Ne pas affaiblir leurs assertions.**

- [ ] **Step 5: Adapter les consommateurs**

Dans `src/services/charge.ts`, trois changements :

1. La requête `prisma.timeEntry.findMany` sélectionne aussi `minutesParJour`, et le mappage des entrées le conserve.
2. Les objets passés à `caFromEntries` comme `lines` ne portent plus que `{ id, tjmCents }` — le facteur vient des entrées.
3. Les accumulateurs de cellules **cumulent des minutes par (cellule, facteur)** puis convertissent chaque groupe, exactement comme `centiemesParFacteur`. Un accumulateur de minutes indifférent au facteur produirait à nouveau un total faux dès qu'un mois mélange deux durées de journée.

L'appel à `computeEngagement` perd son argument `minutesParJour` : les entrées de la ligne le portent.

Dans `src/components/charge/EngagementBar.tsx` : retirer l'argument `minutesParJour` de l'appel à `computeEngagement`. Le composant reçoit des `MonthEntry`, qui portent désormais le facteur.

- [ ] **Step 6: Écrire le test central de la spec**

C'est le défaut que le porteur du produit a constaté en usage. Ajouter à `src/services/charge.test.ts` :

```ts
it('un mois validé garde ses jours après un changement de réglage', async () => {
  // 20 journées de 480 minutes, saisies alors que le réglage vaut 480.
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  for (let j = 1; j <= 20; j++) {
    const jour = String(j).padStart(2, '0')
    await saveEntry({ userId, lineId: lineJour, date: `2026-05-${jour}`, minutes: 480, kind: 'REALISE' })
  }

  const avant = await buildChargeMatrix(userId, 2026)
  const ligneAvant = avant.rows.find((r) => r.lineId === lineJour)!
  expect(ligneAvant.engagement.realiseCentiemes).toBe(2000)

  // Le réglage passe à 7 h. Aucune saisie ne doit être réinterprétée.
  await updateSettings({ minutesParJour: 420 })

  const apres = await buildChargeMatrix(userId, 2026)
  const ligneApres = apres.rows.find((r) => r.lineId === lineJour)!
  expect(ligneApres.engagement.realiseCentiemes).toBe(2000)
  expect(apres.progress.realiseCents).toBe(avant.progress.realiseCents)
})
```

Sans le gel, ce test verrait 2286 centièmes — 22,86 jours au lieu de 20 — et un chiffre d'affaires gonflé d'autant.

- [ ] **Step 7: Lancer toute la suite**

- [ ] **Step 8: Vérifier par mutation**

Réintroduire brièvement, dans `centiemesParFacteur`, une conversion par saisie au lieu du cumul par groupe, et confirmer que le test « cumule avant de convertir » échoue. Restaurer ensuite.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(calculs): chaque saisie est convertie avec le facteur qu'elle porte"
```

---

## Task 5: Réétalonnage des mois ouverts

**Files:** Create `src/services/rates.ts`, `src/services/rates.test.ts`. Modify `src/app/(app)/admin/saisie/actions.ts`, `src/app/(app)/admin/saisie/SettingsForm.tsx`

**Interfaces:**
- Consumes: `resolveMinutesParJour`, `isLocked`, `prisma`
- Produces:
  - `previewRecalibration(userId: string): Promise<{ concernees: number; verrouillees: number }>`
  - `recalibrateOpenMonths(userId: string): Promise<{ recalibrees: number; sauteesVerrouillees: number }>`

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/rates.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry } from './time-entries'
import { previewRecalibration, recalibrateOpenMonths } from './rates'

let userId = ''
let missionId = ''
let lineId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'recal@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('RECAL client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineId = (await createLine({
    missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 80000,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'recal@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'RECAL client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('réétalonnage', () => {
  it('réétalonne une saisie d un mois ouvert', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-01', minutes: 480, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 420 })

    const r = await recalibrateOpenMonths(userId)
    expect(r).toEqual({ recalibrees: 1, sauteesVerrouillees: 0 })

    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(e.minutesParJour).toBe(420)
  })

  it('ne touche JAMAIS une saisie d un mois validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-02', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })
    await updateSettings({ minutesParJour: 420 })

    const r = await recalibrateOpenMonths(userId)
    expect(r).toEqual({ recalibrees: 0, sauteesVerrouillees: 1 })

    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(e.minutesParJour).toBe(480)
  })

  it('traite le mois ouvert et saute le mois validé du même utilisateur', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-03', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })
    await updateSettings({ minutesParJour: 420 })

    const r = await recalibrateOpenMonths(userId)
    expect(r).toEqual({ recalibrees: 1, sauteesVerrouillees: 1 })
  })

  it('annonce à l avance ce qu il va faire', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-04', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })
    await updateSettings({ minutesParJour: 420 })

    expect(await previewRecalibration(userId)).toEqual({ concernees: 1, verrouillees: 1 })
  })

  it('ne touche pas aux saisies d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-recal@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.timeEntry.create({
      data: {
        lineId, userId: autre.id, date: new Date('2026-07-05T00:00:00Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480,
      },
    })
    await updateSettings({ minutesParJour: 420 })

    const r = await recalibrateOpenMonths(userId)
    expect(r.recalibrees).toBe(0)

    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId: autre.id } })
    expect(e.minutesParJour).toBe(480)

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('ne fait rien quand aucun facteur n a changé', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-06', minutes: 480, kind: 'REALISE' })
    expect(await recalibrateOpenMonths(userId)).toEqual({ recalibrees: 0, sauteesVerrouillees: 0 })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/rates.test.ts`
Expected: FAIL — `Failed to resolve import "./rates"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/rates.ts` :

```ts
import { prisma } from '@/db/client'
import { resolveMinutesParJour } from '@/core/rates/cascade'
import { isLocked } from '@/core/cra/state-machine'
import { getSettings } from './settings'
import type { CraStatus } from '@/core/types'

interface Candidate {
  id: string
  actuel: number
  cible: number
  verrouille: boolean
}

/**
 * Liste les saisies dont le facteur figé diffère du facteur que la cascade
 * donnerait aujourd'hui, en marquant celles qui appartiennent à un mois validé.
 */
async function candidats(userId: string): Promise<Candidate[]> {
  const settings = await getSettings()

  const entries = await prisma.timeEntry.findMany({
    where: { userId },
    select: {
      id: true,
      date: true,
      minutesParJour: true,
      line: {
        select: {
          missionId: true,
          minutesParJour: true,
          mission: {
            select: { minutesParJour: true, client: { select: { minutesParJour: true } } },
          },
        },
      },
    },
  })

  if (entries.length === 0) return []

  const cras = await prisma.cra.findMany({
    where: { userId },
    select: { missionId: true, month: true, status: true },
  })
  const verrous = new Set(
    cras
      .filter((c) => isLocked(c.status as CraStatus))
      .map((c) => `${c.missionId}|${c.month.toISOString().slice(0, 7)}`),
  )

  const out: Candidate[] = []
  for (const e of entries) {
    const cible = resolveMinutesParJour({
      line: e.line.minutesParJour,
      mission: e.line.mission.minutesParJour,
      client: e.line.mission.client.minutesParJour,
      global: settings.minutesParJour,
    })
    if (cible === e.minutesParJour) continue

    const cle = `${e.line.missionId}|${e.date.toISOString().slice(0, 7)}`
    out.push({ id: e.id, actuel: e.minutesParJour, cible, verrouille: verrous.has(cle) })
  }
  return out
}

export async function previewRecalibration(
  userId: string,
): Promise<{ concernees: number; verrouillees: number }> {
  const liste = await candidats(userId)
  return {
    concernees: liste.filter((c) => !c.verrouille).length,
    verrouillees: liste.filter((c) => c.verrouille).length,
  }
}

export async function recalibrateOpenMonths(
  userId: string,
): Promise<{ recalibrees: number; sauteesVerrouillees: number }> {
  const liste = await candidats(userId)
  const aTraiter = liste.filter((c) => !c.verrouille)

  for (const c of aTraiter) {
    await prisma.timeEntry.update({
      where: { id: c.id },
      data: { minutesParJour: c.cible },
    })
  }

  return {
    recalibrees: aTraiter.length,
    sauteesVerrouillees: liste.length - aTraiter.length,
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/rates.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Exposer dans l'écran d'administration**

Dans `src/app/(app)/admin/saisie/actions.ts` :

```ts
import { previewRecalibration, recalibrateOpenMonths } from '@/services/rates'

export async function lancerReetalonnage() {
  const user = await requireUser()
  const r = await recalibrateOpenMonths(user.id)
  revalidatePath('/admin/saisie')
  return r
}
```

Dans `src/app/(app)/admin/saisie/page.tsx`, appeler `previewRecalibration(user.id)` et passer le résultat au formulaire. Dans `SettingsForm.tsx`, ajouter — **hors du formulaire des réglages**, dans son propre `<form>` — une section :

```tsx
<section className="border-t pt-4">
  <h2 className="mb-2 font-medium">Réétalonnage</h2>
  {preview.concernees === 0 && preview.verrouillees === 0 ? (
    <p className="text-sm text-slate-500">
      Toutes les saisies utilisent déjà la durée de journée en vigueur.
    </p>
  ) : (
    <>
      <p className="mb-2 text-sm text-slate-600">
        {preview.concernees} saisie(s) d’un mois ouvert utilisent une durée de journée
        différente de celle en vigueur.
        {preview.verrouillees > 0 && (
          <> {preview.verrouillees} autre(s) appartiennent à un mois validé et ne seront
          jamais modifiées.</>
        )}
      </p>
      {preview.concernees > 0 && (
        <form action={lancerReetalonnage}>
          <button className="rounded border px-3 py-1 text-sm">
            Réétalonner les {preview.concernees} saisie(s)
          </button>
        </form>
      )}
    </>
  )}
</section>
```

- [ ] **Step 6: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(reglages): reetalonnage explicite des mois ouverts"
```

---

## Task 6: Surcharges sur le client et la mission

**Files:** Modify `src/services/clients.ts`, `src/services/missions.ts`, `src/services/missions.test.ts`, `src/app/(app)/missions/page.tsx`, `src/app/(app)/missions/actions.ts`

**Interfaces:**
- Consumes: les colonnes de la tâche 2, `resolveMinutesParJour`
- Produces:
  - `createClient(name: string, minutesParJour?: number | null)`
  - `createMission(args: { clientId; label; minutesParJour?: number | null })`
  - `MissionForUser` gagne `minutesParJourEffectif: number` et `minutesParJourSurcharge: number | null`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/services/missions.test.ts` :

```ts
describe('surcharges de durée de journée', () => {
  it('crée un client avec sa surcharge', async () => {
    const c = await createClient('SURCHARGE client', 420)
    const relu = await prisma.client.findUniqueOrThrow({ where: { id: c.id } })
    expect(relu.minutesParJour).toBe(420)
  })

  it('crée un client sans surcharge par défaut', async () => {
    const c = await createClient('SURCHARGE sans')
    const relu = await prisma.client.findUniqueOrThrow({ where: { id: c.id } })
    expect(relu.minutesParJour).toBeNull()
  })

  it('crée une mission avec sa surcharge', async () => {
    const c = await createClient('SURCHARGE mission')
    const m = await createMission({ clientId: c.id, label: 'M', minutesParJour: 450 })
    const relu = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relu.minutesParJour).toBe(450)
  })

  it('expose la valeur effective et la surcharge propre de la mission', async () => {
    await updateSettings({ minutesParJour: 480 })
    const c = await createClient('SURCHARGE effectif', 420)
    const m = await createMission({ clientId: c.id, label: 'ME' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'ME')
    // Héritée du client, pas surchargée sur la mission.
    expect(mission!.minutesParJourEffectif).toBe(420)
    expect(mission!.minutesParJourSurcharge).toBeNull()
  })

  it('la surcharge de mission l emporte sur celle du client', async () => {
    await updateSettings({ minutesParJour: 480 })
    const c = await createClient('SURCHARGE priorite', 420)
    const m = await createMission({ clientId: c.id, label: 'MP', minutesParJour: 450 })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'MP')
    expect(mission!.minutesParJourEffectif).toBe(450)
    expect(mission!.minutesParJourSurcharge).toBe(450)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/missions.test.ts`
Expected: FAIL — `createClient` n'accepte qu'un argument, `minutesParJourEffectif` est `undefined`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/clients.ts` — élargir `createClient` :

```ts
export async function createClient(
  name: string,
  minutesParJour?: number | null,
): Promise<{ id: string; name: string }> {
  const c = await prisma.client.create({ data: { name, minutesParJour: minutesParJour ?? null } })
  return { id: c.id, name: c.name }
}
```

`src/services/missions.ts` — élargir `createMission`, puis ajouter à `MissionForUser` :

```ts
  /** durée d'une journée réellement appliquée, après cascade */
  minutesParJourEffectif: number
  /** surcharge portée par la mission elle-même, null si héritée */
  minutesParJourSurcharge: number | null
```

et les renseigner dans `listMissionsForUser` en résolvant la cascade avec `resolveMinutesParJour` à partir de `mission.minutesParJour`, `mission.client.minutesParJour` et `settings.minutesParJour`.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/missions.test.ts`
Expected: PASS — les 5 tests nouveaux plus tous les existants

- [ ] **Step 5: Exposer dans l'écran des missions**

Dans `src/app/(app)/missions/actions.ts`, lire le champ et le transmettre :

```ts
function surchargeOuNull(brut: FormDataEntryValue | null): number | null {
  const s = String(brut ?? '').trim()
  if (s === '') return null
  const heures = Number(s)
  if (!Number.isFinite(heures) || heures <= 0 || heures > 24) return null
  return Math.round(heures * 60)
}
```

et l'utiliser dans `addClient` (`surchargeOuNull(formData.get('heuresParJour'))`) et `addMission`.

Dans `src/app/(app)/missions/page.tsx`, ajouter à chaque formulaire de création un champ optionnel, **avec la valeur héritée affichée à côté** — un champ de surcharge qui ne montre pas ce qu'il remplace invite à l'erreur :

```tsx
<label className="flex flex-col text-sm">
  Durée d’une journée (h)
  <input
    name="heuresParJour"
    type="number"
    step="0.25"
    min="0.25"
    max="24"
    placeholder={String(settings.minutesParJour / 60)}
    className="w-36 rounded border px-2 py-1"
  />
  <span className="mt-1 text-xs text-slate-500">
    Vide = hérité ({settings.minutesParJour / 60} h)
  </span>
</label>
```

Et afficher, sur chaque mission listée, sa durée effective : `{m.minutesParJourEffectif / 60} h{m.minutesParJourSurcharge === null ? ' (hérité)' : ''}`.

- [ ] **Step 6: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(missions): surcharge de la duree d'une journee par client et par mission"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche |
|---|---|
| `TimeEntry.minutesParJour`, figé à l'écriture | 2, 3 |
| Reprise des saisies existantes | 2 |
| Cascade prestation → mission → client → global | 1, 3, 6 |
| `Client.minutesParJour`, `Mission.minutesParJour` | 2, 6 |
| Tout calcul lit le facteur de la saisie | 4 |
| Convention « cumuler puis convertir », à facteur constant | 4 |
| Réétalonnage explicite des mois ouverts | 5 |
| Les mois validés ne sont jamais réétalonnés | 5 |
| Compte rendu du réétalonnage | 5 |
| Valeur héritée affichée à côté du champ de surcharge | 6 |
| Le test central : un CRA validé ne change pas | 5, test « ne touche JAMAIS une saisie d'un mois validé » |

**Hors périmètre, conformément à la spec :** historisation du réglage global, surcharge au niveau du CRA ou du mois, réétalonnage automatique sous quelque condition que ce soit.
