# Lot 0 — Socle CRA · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer une application de CRA autoportante et utilisable — saisie mensuelle sur grille, missions et lignes de prestation, contrôle de capacité configurable, statuts de CRA manuels — déployable en Docker ou en local sur SQLite.

**Architecture:** Trois couches. `src/core/` contient le domaine pur, sans aucun import de Prisma ni de Next — c'est là que vit toute la logique et l'essentiel des tests. `src/services/` est la seule couche qui parle à la base, et scope systématiquement par utilisateur. `src/app/` et `src/components/` ne font que présenter. Aucun connecteur externe dans ce lot.

**Tech Stack:** Next.js 15 (App Router) · TypeScript strict · Prisma 6 · Postgres ou SQLite · Auth.js 5 · Tailwind 4 · Vitest · React Testing Library

## Global Constraints

Ces contraintes s'appliquent à **toutes** les tâches. Elles viennent de la spec `docs/superpowers/specs/2026-08-15-cra-app-design.md`.

- **Node.js ≥ 20.**
- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** Domaine pur, testable sans base ni réseau. Toute violation est un échec de revue.
- **Aucun enum Prisma.** SQLite ne les supporte pas. Les enums sont des `String` en base et des unions TypeScript dans `src/core/types.ts`.
- **Aucun `Decimal`, aucun flottant persisté.** Entiers partout : temps en **minutes**, `joursVendus` en **centièmes de jour**, `tjm` en **centimes**, `heuresParJour` en **minutes par jour** (7 h 12 → `432`).
- **Aucun tableau Prisma, aucune requête fine sur du JSON.** Le JSON n'est lu et écrit qu'en bloc (réglages).
- **`next.config.ts` doit déclarer `output: 'standalone'`** — requis par Docker et par l'empaquetage Tauri ultérieur.
- **Postgres utilise `prisma migrate`. SQLite utilise `prisma db push`** au premier lancement. Pas de migrations SQLite versionnées.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus**, même si l'application n'a qu'un utilisateur. Cette discipline est ce qui rendra le multi-consultants additif.
- **Français** pour toute chaîne visible par l'utilisateur. Anglais pour le code, les noms de fichiers et les messages de commit.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/core/types.ts` | Unions de chaînes partagées — l'unique source des valeurs d'enum |
| `src/core/time/units.ts` | Conversion minutes ↔ centièmes de jour, formatage et parsing par unité |
| `src/core/time/slots.ts` | Créneaux, durée, franchissement de minuit |
| `src/core/capacity/check.ts` | Contrôle de capacité, trois modes |
| `src/core/engagement/compute.ts` | vendu / réalisé / prévu / reste / dépassement |
| `src/core/cra/state-machine.ts` | Transitions du CRA et verrouillage |
| `prisma/schema.prisma` | Schéma canonique (Postgres) |
| `scripts/set-db-provider.mjs` | Bascule du provider pour les installations SQLite |
| `src/db/client.ts` | Singleton PrismaClient |
| `src/services/settings.ts` | Lecture/écriture des réglages |
| `src/services/clients.ts` | Clients |
| `src/services/missions.ts` | Missions, lignes, affectations |
| `src/services/time-entries.ts` | Lignes de temps + application du contrôle de capacité |
| `src/services/cra.ts` | CRA et transitions |
| `src/auth.ts` | Configuration Auth.js |
| `src/components/grid/MonthGrid.tsx` | Grille mensuelle |
| `src/components/grid/GridCell.tsx` | Cellule |
| `src/components/grid/useDragSelect.ts` | Sélection par glissement |
| `src/components/grid/TotalsRow.tsx` | Ligne de totaux journaliers |
| `src/components/grid/EngagementBar.tsx` | Bandeau d'engagement par ligne |

---

## Task 1: Socle du projet et conversion d'unités

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `src/core/types.ts`, `src/core/time/units.ts`
- Test: `src/core/time/units.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `src/core/types.ts` : `TimeEntryKind`, `CraStatus`, `DisplayUnit`, `Role`, `EngagementSource`, `CapacityMode`
  - `minutesToCentiemes(minutes: number, minutesParJour: number): number`
  - `centiemesToMinutes(centiemes: number, minutesParJour: number): number`
  - `formatQuantity(minutes: number, unit: DisplayUnit, minutesParJour: number): string`
  - `parseQuantity(input: string, unit: DisplayUnit, minutesParJour: number): number | null`

- [ ] **Step 1: Initialiser le projet**

```bash
npm init -y
npm i next@15 react react-dom
npm i -D typescript @types/node @types/react @types/react-dom vitest @vitejs/plugin-react tailwindcss @tailwindcss/postcss postcss
```

- [ ] **Step 2: Écrire les fichiers de configuration**

`tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "incremental": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts` :

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
}

export default config
```

`vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

Ajouter à `package.json` :

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Écrire les types du domaine**

`src/core/types.ts` :

```ts
export type TimeEntryKind = 'REALISE' | 'PREVISIONNEL'
export type CraStatus = 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'
export type DisplayUnit = 'JOUR' | 'DEMI_JOUR' | 'HEURE'
export type Role = 'ADMIN' | 'MANAGER' | 'CONSULTANT'
export type EngagementSource = 'MANUEL' | 'DOLIBARR_PROPALE' | 'DOLIBARR_PROJET'
export type CapacityMode = 'DESACTIVE' | 'AVERTISSEMENT' | 'BLOCAGE'

export const TIME_ENTRY_KINDS: readonly TimeEntryKind[] = ['REALISE', 'PREVISIONNEL']
export const CRA_STATUSES: readonly CraStatus[] = ['BROUILLON', 'ENVOYE', 'VALIDE', 'REFUSE']
export const DISPLAY_UNITS: readonly DisplayUnit[] = ['JOUR', 'DEMI_JOUR', 'HEURE']
export const CAPACITY_MODES: readonly CapacityMode[] = ['DESACTIVE', 'AVERTISSEMENT', 'BLOCAGE']
```

- [ ] **Step 4: Écrire le test qui échoue**

`src/core/time/units.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  minutesToCentiemes,
  centiemesToMinutes,
  formatQuantity,
  parseQuantity,
} from './units'

const J8 = 480 // 8 h
const J7_12 = 432 // 7 h 12

describe('minutesToCentiemes', () => {
  it('convertit une journée pleine en 100 centièmes', () => {
    expect(minutesToCentiemes(480, J8)).toBe(100)
  })

  it('convertit une demi-journée en 50 centièmes', () => {
    expect(minutesToCentiemes(240, J8)).toBe(50)
  })

  it('respecte un jour à 7 h 12', () => {
    expect(minutesToCentiemes(432, J7_12)).toBe(100)
    expect(minutesToCentiemes(216, J7_12)).toBe(50)
  })

  it('arrondit à l entier le plus proche', () => {
    expect(minutesToCentiemes(1, J8)).toBe(0)
    expect(minutesToCentiemes(3, J8)).toBe(1)
  })
})

describe('centiemesToMinutes', () => {
  it('fait l aller-retour sur les valeurs rondes', () => {
    expect(centiemesToMinutes(100, J8)).toBe(480)
    expect(centiemesToMinutes(50, J8)).toBe(240)
    expect(centiemesToMinutes(100, J7_12)).toBe(432)
  })
})

describe('formatQuantity', () => {
  it('formate en jours', () => {
    expect(formatQuantity(480, 'JOUR', J8)).toBe('1')
    expect(formatQuantity(240, 'JOUR', J8)).toBe('0,5')
    expect(formatQuantity(0, 'JOUR', J8)).toBe('')
  })

  it('formate en demi-journées comme en jours', () => {
    expect(formatQuantity(240, 'DEMI_JOUR', J8)).toBe('0,5')
  })

  it('formate en heures', () => {
    expect(formatQuantity(480, 'HEURE', J8)).toBe('8h')
    expect(formatQuantity(450, 'HEURE', J8)).toBe('7h30')
    expect(formatQuantity(0, 'HEURE', J8)).toBe('')
  })
})

describe('parseQuantity', () => {
  it('accepte la virgule et le point en jours', () => {
    expect(parseQuantity('0,5', 'JOUR', J8)).toBe(240)
    expect(parseQuantity('0.5', 'JOUR', J8)).toBe(240)
    expect(parseQuantity('1', 'JOUR', J8)).toBe(480)
  })

  it('accepte les formats horaires', () => {
    expect(parseQuantity('7h30', 'HEURE', J8)).toBe(450)
    expect(parseQuantity('8h', 'HEURE', J8)).toBe(480)
    expect(parseQuantity('8', 'HEURE', J8)).toBe(480)
  })

  it('traite le vide comme zéro', () => {
    expect(parseQuantity('', 'JOUR', J8)).toBe(0)
    expect(parseQuantity('   ', 'JOUR', J8)).toBe(0)
  })

  it('renvoie null sur une saisie invalide', () => {
    expect(parseQuantity('abc', 'JOUR', J8)).toBeNull()
    expect(parseQuantity('-1', 'JOUR', J8)).toBeNull()
  })
})
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/core/time/units.test.ts`
Expected: FAIL — `Failed to resolve import "./units"`

- [ ] **Step 6: Écrire l'implémentation minimale**

`src/core/time/units.ts` :

```ts
import type { DisplayUnit } from '../types'

export function minutesToCentiemes(minutes: number, minutesParJour: number): number {
  return Math.round((minutes / minutesParJour) * 100)
}

export function centiemesToMinutes(centiemes: number, minutesParJour: number): number {
  return Math.round((centiemes / 100) * minutesParJour)
}

function formatDays(minutes: number, minutesParJour: number): string {
  const days = minutes / minutesParJour
  const rounded = Math.round(days * 100) / 100
  return String(rounded).replace('.', ',')
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

export function formatQuantity(
  minutes: number,
  unit: DisplayUnit,
  minutesParJour: number,
): string {
  if (minutes === 0) return ''
  return unit === 'HEURE' ? formatHours(minutes) : formatDays(minutes, minutesParJour)
}

export function parseQuantity(
  input: string,
  unit: DisplayUnit,
  minutesParJour: number,
): number | null {
  const raw = input.trim()
  if (raw === '') return 0

  if (unit === 'HEURE') {
    const hm = /^(\d+)\s*h\s*(\d{1,2})?$/i.exec(raw)
    if (hm) {
      const h = Number(hm[1])
      const m = hm[2] === undefined ? 0 : Number(hm[2])
      if (m > 59) return null
      return h * 60 + m
    }
    const n = Number(raw.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return null
    return Math.round(n * 60)
  }

  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * minutesParJour)
}
```

- [ ] **Step 7: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/core/time/units.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): socle du projet et conversion d'unites de temps"
```

---

## Task 2: Créneaux et franchissement de minuit

**Files:**
- Create: `src/core/time/slots.ts`
- Test: `src/core/time/slots.test.ts`

**Interfaces:**
- Consumes: rien de Task 1 (module indépendant)
- Produces:
  - `interface Slot { id: string; label: string; startMinute: number; endMinute: number; centiemes: number }`
  - `slotDurationMinutes(slot: Slot): number`
  - `crossesMidnight(slot: Slot): boolean`
  - `slotInterval(slot: Slot, date: Date): { start: Date; end: Date }`

`startMinute` et `endMinute` sont des minutes depuis minuit (0–1439). Un créneau dont `endMinute <= startMinute` franchit minuit.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/time/slots.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { slotDurationMinutes, crossesMidnight, slotInterval, type Slot } from './slots'

const matin: Slot = { id: 'm', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 }
const nuit: Slot = { id: 'n', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 }

describe('crossesMidnight', () => {
  it('est faux pour un créneau de journée', () => {
    expect(crossesMidnight(matin)).toBe(false)
  })

  it('est vrai quand la fin est avant le début', () => {
    expect(crossesMidnight(nuit)).toBe(true)
  })
})

describe('slotDurationMinutes', () => {
  it('calcule une durée de journée', () => {
    expect(slotDurationMinutes(matin)).toBe(240)
  })

  it('calcule une durée franchissant minuit', () => {
    // 22:00 -> 06:00 = 8 h
    expect(slotDurationMinutes(nuit)).toBe(480)
  })
})

describe('slotInterval', () => {
  it('reste sur le même jour pour un créneau de journée', () => {
    const { start, end } = slotInterval(matin, new Date('2026-03-12T00:00:00Z'))
    expect(start.toISOString()).toBe('2026-03-12T09:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-12T13:00:00.000Z')
  })

  it('déborde sur le lendemain quand le créneau franchit minuit', () => {
    const { start, end } = slotInterval(nuit, new Date('2026-03-12T00:00:00Z'))
    expect(start.toISOString()).toBe('2026-03-12T22:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-13T06:00:00.000Z')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/core/time/slots.test.ts`
Expected: FAIL — `Failed to resolve import "./slots"`

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/core/time/slots.ts` :

```ts
const MINUTES_PER_DAY = 1440

export interface Slot {
  id: string
  label: string
  /** minutes depuis minuit, 0-1439 */
  startMinute: number
  /** minutes depuis minuit, 0-1439 */
  endMinute: number
  /** valeur du créneau en centièmes de jour */
  centiemes: number
}

export function crossesMidnight(slot: Slot): boolean {
  return slot.endMinute <= slot.startMinute
}

export function slotDurationMinutes(slot: Slot): number {
  return crossesMidnight(slot)
    ? MINUTES_PER_DAY - slot.startMinute + slot.endMinute
    : slot.endMinute - slot.startMinute
}

export function slotInterval(slot: Slot, date: Date): { start: Date; end: Date } {
  const start = new Date(date.getTime() + slot.startMinute * 60_000)
  const end = new Date(start.getTime() + slotDurationMinutes(slot) * 60_000)
  return { start, end }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/core/time/slots.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): creneaux horaires et franchissement de minuit"
```

---

## Task 3: Contrôle de capacité

**Files:**
- Create: `src/core/capacity/check.ts`
- Test: `src/core/capacity/check.test.ts`

**Interfaces:**
- Consumes: `CapacityMode` de `src/core/types.ts`
- Produces:
  - `type CapacityVerdict = { ok: true } | { ok: false; severity: 'warn' | 'block'; totalMinutes: number; capacityMinutes: number }`
  - `checkCapacity(args: { existingMinutes: number; addedMinutes: number; capacityMinutes: number; mode: CapacityMode }): CapacityVerdict`

`existingMinutes` est le total déjà posé pour cet utilisateur ce jour-là, **toutes lignes confondues, hors ligne en cours de modification**.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/capacity/check.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { checkCapacity } from './check'

const CAP = 480 // 1 jour à 8 h

describe('checkCapacity', () => {
  it('accepte un total sous la capacité', () => {
    const v = checkCapacity({ existingMinutes: 0, addedMinutes: 240, capacityMinutes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(true)
  })

  it('accepte un total exactement égal à la capacité', () => {
    const v = checkCapacity({ existingMinutes: 240, addedMinutes: 240, capacityMinutes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(true)
  })

  it('autorise deux demi-journées sur deux lignes différentes', () => {
    const v = checkCapacity({ existingMinutes: 240, addedMinutes: 240, capacityMinutes: CAP, mode: 'AVERTISSEMENT' })
    expect(v.ok).toBe(true)
  })

  it('bloque le dépassement en mode BLOCAGE', () => {
    const v = checkCapacity({ existingMinutes: 480, addedMinutes: 240, capacityMinutes: CAP, mode: 'BLOCAGE' })
    expect(v).toEqual({ ok: false, severity: 'block', totalMinutes: 720, capacityMinutes: 480 })
  })

  it('avertit sans bloquer en mode AVERTISSEMENT', () => {
    const v = checkCapacity({ existingMinutes: 480, addedMinutes: 240, capacityMinutes: CAP, mode: 'AVERTISSEMENT' })
    expect(v).toEqual({ ok: false, severity: 'warn', totalMinutes: 720, capacityMinutes: 480 })
  })

  it('ne dit jamais rien en mode DESACTIVE', () => {
    const v = checkCapacity({ existingMinutes: 4800, addedMinutes: 480, capacityMinutes: CAP, mode: 'DESACTIVE' })
    expect(v.ok).toBe(true)
  })

  it('applique la même règle un dimanche qu un mardi', () => {
    // la fonction ne connaît pas la date : c'est la garantie
    const v = checkCapacity({ existingMinutes: 480, addedMinutes: 1, capacityMinutes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/core/capacity/check.test.ts`
Expected: FAIL — `Failed to resolve import "./check"`

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/core/capacity/check.ts` :

```ts
import type { CapacityMode } from '../types'

export type CapacityVerdict =
  | { ok: true }
  | { ok: false; severity: 'warn' | 'block'; totalMinutes: number; capacityMinutes: number }

export function checkCapacity(args: {
  existingMinutes: number
  addedMinutes: number
  capacityMinutes: number
  mode: CapacityMode
}): CapacityVerdict {
  if (args.mode === 'DESACTIVE') return { ok: true }

  const totalMinutes = args.existingMinutes + args.addedMinutes
  if (totalMinutes <= args.capacityMinutes) return { ok: true }

  return {
    ok: false,
    severity: args.mode === 'BLOCAGE' ? 'block' : 'warn',
    totalMinutes,
    capacityMinutes: args.capacityMinutes,
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/core/capacity/check.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): controle de capacite journaliere en trois modes"
```

---

## Task 4: Calcul d'engagement

**Files:**
- Create: `src/core/engagement/compute.ts`
- Test: `src/core/engagement/compute.test.ts`

**Interfaces:**
- Consumes: `TimeEntryKind` de `src/core/types.ts`, `minutesToCentiemes` de `src/core/time/units.ts`
- Produces:
  - `interface EngagementSummary { venduCentiemes: number; realiseCentiemes: number; prevuCentiemes: number; resteCentiemes: number; depassementCentiemes: number }`
  - `computeEngagement(args: { venduCentiemes: number; entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number }>; minutesParJour: number }): EngagementSummary`

`resteCentiemes` ne descend jamais sous zéro. Le dépassement est exposé séparément, dans `depassementCentiemes`.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/engagement/compute.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { computeEngagement } from './compute'

const J8 = 480
const vendu30j = 3000 // 30 jours en centièmes

describe('computeEngagement', () => {
  it('ventile réalisé et prévisionnel', () => {
    const r = computeEngagement({
      venduCentiemes: vendu30j,
      entries: [
        { kind: 'REALISE', minutes: 480 * 18 },
        { kind: 'PREVISIONNEL', minutes: 480 * 7 },
      ],
      minutesParJour: J8,
    })
    expect(r.realiseCentiemes).toBe(1800)
    expect(r.prevuCentiemes).toBe(700)
    expect(r.resteCentiemes).toBe(500)
    expect(r.depassementCentiemes).toBe(0)
  })

  it('renvoie le vendu intégral sans aucune saisie', () => {
    const r = computeEngagement({ venduCentiemes: vendu30j, entries: [], minutesParJour: J8 })
    expect(r).toEqual({
      venduCentiemes: 3000,
      realiseCentiemes: 0,
      prevuCentiemes: 0,
      resteCentiemes: 3000,
      depassementCentiemes: 0,
    })
  })

  it('agrège les demi-journées', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [
        { kind: 'REALISE', minutes: 240 },
        { kind: 'REALISE', minutes: 240 },
      ],
      minutesParJour: J8,
    })
    expect(r.realiseCentiemes).toBe(100)
  })

  it('plafonne le reste à zéro et expose le dépassement', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [{ kind: 'REALISE', minutes: 480 * 12 }],
      minutesParJour: J8,
    })
    expect(r.resteCentiemes).toBe(0)
    expect(r.depassementCentiemes).toBe(200)
  })

  it('compte le prévisionnel dans le dépassement', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [
        { kind: 'REALISE', minutes: 480 * 8 },
        { kind: 'PREVISIONNEL', minutes: 480 * 5 },
      ],
      minutesParJour: J8,
    })
    expect(r.depassementCentiemes).toBe(300)
  })

  it('respecte un jour à 7 h 12', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [{ kind: 'REALISE', minutes: 432 }],
      minutesParJour: 432,
    })
    expect(r.realiseCentiemes).toBe(100)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/core/engagement/compute.test.ts`
Expected: FAIL — `Failed to resolve import "./compute"`

- [ ] **Step 3: Écrire l'implémentation minimale**

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

export function computeEngagement(args: {
  venduCentiemes: number
  entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number }>
  minutesParJour: number
}): EngagementSummary {
  let realiseMinutes = 0
  let prevuMinutes = 0

  for (const e of args.entries) {
    if (e.kind === 'REALISE') realiseMinutes += e.minutes
    else prevuMinutes += e.minutes
  }

  const realiseCentiemes = minutesToCentiemes(realiseMinutes, args.minutesParJour)
  const prevuCentiemes = minutesToCentiemes(prevuMinutes, args.minutesParJour)
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

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/core/engagement/compute.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): calcul d'engagement vendu/realise/prevu/reste"
```

---

## Task 5: Machine à états du CRA

**Files:**
- Create: `src/core/cra/state-machine.ts`
- Test: `src/core/cra/state-machine.test.ts`

**Interfaces:**
- Consumes: `CraStatus` de `src/core/types.ts`
- Produces:
  - `type CraTransition = 'ENVOYER' | 'VALIDER' | 'REFUSER' | 'ROUVRIR'`
  - `canTransition(from: CraStatus, t: CraTransition): boolean`
  - `applyTransition(from: CraStatus, t: CraTransition): CraStatus` — lève `InvalidTransitionError`
  - `isLocked(status: CraStatus): boolean`
  - `class InvalidTransitionError extends Error`

Un CRA `VALIDE` est verrouillé : les lignes de temps de son mois ne sont plus modifiables. `ROUVRIR` est la seule sortie, et elle est explicite.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/cra/state-machine.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  canTransition,
  applyTransition,
  isLocked,
  InvalidTransitionError,
} from './state-machine'

describe('canTransition', () => {
  it('autorise le parcours nominal', () => {
    expect(canTransition('BROUILLON', 'ENVOYER')).toBe(true)
    expect(canTransition('ENVOYE', 'VALIDER')).toBe(true)
  })

  it('autorise le refus depuis ENVOYE', () => {
    expect(canTransition('ENVOYE', 'REFUSER')).toBe(true)
  })

  it('autorise la réouverture depuis VALIDE et REFUSE', () => {
    expect(canTransition('VALIDE', 'ROUVRIR')).toBe(true)
    expect(canTransition('REFUSE', 'ROUVRIR')).toBe(true)
  })

  it('refuse de valider un brouillon sans envoi', () => {
    expect(canTransition('BROUILLON', 'VALIDER')).toBe(false)
  })

  it('refuse de rouvrir un brouillon', () => {
    expect(canTransition('BROUILLON', 'ROUVRIR')).toBe(false)
  })

  it('refuse de renvoyer un CRA validé', () => {
    expect(canTransition('VALIDE', 'ENVOYER')).toBe(false)
  })
})

describe('applyTransition', () => {
  it('renvoie le nouvel état', () => {
    expect(applyTransition('BROUILLON', 'ENVOYER')).toBe('ENVOYE')
    expect(applyTransition('ENVOYE', 'VALIDER')).toBe('VALIDE')
    expect(applyTransition('ENVOYE', 'REFUSER')).toBe('REFUSE')
    expect(applyTransition('VALIDE', 'ROUVRIR')).toBe('BROUILLON')
  })

  it('lève sur une transition interdite', () => {
    expect(() => applyTransition('BROUILLON', 'VALIDER')).toThrow(InvalidTransitionError)
  })
})

describe('isLocked', () => {
  it('verrouille uniquement le CRA validé', () => {
    expect(isLocked('VALIDE')).toBe(true)
    expect(isLocked('BROUILLON')).toBe(false)
    expect(isLocked('ENVOYE')).toBe(false)
    expect(isLocked('REFUSE')).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/core/cra/state-machine.test.ts`
Expected: FAIL — `Failed to resolve import "./state-machine"`

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/core/cra/state-machine.ts` :

```ts
import type { CraStatus } from '../types'

export type CraTransition = 'ENVOYER' | 'VALIDER' | 'REFUSER' | 'ROUVRIR'

export class InvalidTransitionError extends Error {
  constructor(from: CraStatus, transition: CraTransition) {
    super(`Transition ${transition} impossible depuis l'état ${from}`)
    this.name = 'InvalidTransitionError'
  }
}

const TRANSITIONS: Record<CraStatus, Partial<Record<CraTransition, CraStatus>>> = {
  BROUILLON: { ENVOYER: 'ENVOYE' },
  ENVOYE: { VALIDER: 'VALIDE', REFUSER: 'REFUSE' },
  VALIDE: { ROUVRIR: 'BROUILLON' },
  REFUSE: { ROUVRIR: 'BROUILLON' },
}

export function canTransition(from: CraStatus, t: CraTransition): boolean {
  return TRANSITIONS[from][t] !== undefined
}

export function applyTransition(from: CraStatus, t: CraTransition): CraStatus {
  const next = TRANSITIONS[from][t]
  if (next === undefined) throw new InvalidTransitionError(from, t)
  return next
}

export function isLocked(status: CraStatus): boolean {
  return status === 'VALIDE'
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/core/cra/state-machine.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Vérifier que `core/` reste pur**

Run: `! grep -rE "@prisma/client|from 'next|from \"next|from 'react|from \"react" src/core/`
Expected: aucune sortie, code de retour 0

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): machine a etats du CRA et verrouillage"
```

---

## Task 6: Schéma Prisma et portabilité SQLite/Postgres

**Files:**
- Create: `prisma/schema.prisma`, `scripts/set-db-provider.mjs`, `src/db/client.ts`, `.env.example`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: les unions de `src/core/types.ts` (les colonnes `String` doivent accepter exactement ces valeurs)
- Produces: `prisma` (client exporté depuis `src/db/client.ts`), et le schéma que toutes les tâches suivantes consomment

- [ ] **Step 1: Installer Prisma**

```bash
npm i @prisma/client
npm i -D prisma
```

- [ ] **Step 2: Écrire le schéma**

`prisma/schema.prisma` :

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("ADMIN")
  createdAt    DateTime @default(now())

  timeEntries TimeEntry[]
  assignments Assignment[]
  cras        Cra[]
}

model Client {
  id        String    @id @default(cuid())
  name      String
  createdAt DateTime  @default(now())
  missions  Mission[]
}

model Mission {
  id        String        @id @default(cuid())
  clientId  String
  label     String
  startDate DateTime?
  endDate   DateTime?
  archived  Boolean       @default(false)
  createdAt DateTime      @default(now())

  client Client        @relation(fields: [clientId], references: [id], onDelete: Cascade)
  lines  MissionLine[]
  cras   Cra[]

  @@index([clientId])
}

model MissionLine {
  id                String  @id @default(cuid())
  missionId         String
  label             String
  /// jours vendus, en centièmes de jour
  soldCentiemes     Int     @default(0)
  /// TJM en centimes — informatif, l'app ne facture pas
  tjmCents          Int     @default(0)
  /// 'JOUR' | 'DEMI_JOUR' | 'HEURE'
  displayUnit       String  @default("JOUR")
  /// surcharge de Settings.minutesParJour, null = hérite
  minutesParJour    Int?
  /// 'MANUEL' | 'DOLIBARR_PROPALE' | 'DOLIBARR_PROJET'
  engagementSource  String  @default("MANUEL")
  /// ids de créneaux autorisés, séparés par des virgules. Vide = tous.
  allowedSlotIds    String  @default("")
  archived          Boolean @default(false)
  position          Int     @default(0)

  mission     Mission      @relation(fields: [missionId], references: [id], onDelete: Cascade)
  assignments Assignment[]
  timeEntries TimeEntry[]

  @@index([missionId])
}

model Assignment {
  id            String    @id @default(cuid())
  lineId        String
  userId        String
  /// part allouée à cet utilisateur, en centièmes de jour
  soldCentiemes Int       @default(0)
  startDate     DateTime?
  endDate       DateTime?

  line MissionLine @relation(fields: [lineId], references: [id], onDelete: Cascade)
  user User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([lineId, userId])
  @@index([userId])
}

model TimeEntry {
  id        String   @id @default(cuid())
  lineId    String
  userId    String
  /// minuit UTC du jour concerné
  date      DateTime
  minutes   Int
  /// 'REALISE' | 'PREVISIONNEL'
  kind      String
  slotId    String?
  comment   String   @default("")
  updatedAt DateTime @updatedAt

  line MissionLine @relation(fields: [lineId], references: [id], onDelete: Cascade)
  user User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([lineId, userId, date, slotId])
  @@index([userId, date])
  @@index([lineId])
}

model Cra {
  id        String   @id @default(cuid())
  missionId String
  userId    String
  /// premier jour du mois, minuit UTC
  month     DateTime
  /// 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'
  status    String   @default("BROUILLON")

  invoiceNumber String?
  invoicedAt    DateTime?
  paidAt        DateTime?

  updatedAt DateTime @updatedAt

  mission Mission @relation(fields: [missionId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([missionId, userId, month])
  @@index([userId])
}

model ExternalLink {
  id         String    @id @default(cuid())
  entityType String
  entityId   String
  provider   String
  externalId String
  syncedAt   DateTime?
  syncState  String    @default("PENDING")

  @@unique([entityType, entityId, provider])
  @@index([provider, externalId])
}

model Settings {
  id String @id @default("singleton")

  /// durée d'une journée, en minutes (7 h 12 -> 432)
  minutesParJour Int    @default(480)
  /// 'DESACTIVE' | 'AVERTISSEMENT' | 'BLOCAGE'
  capacityMode   String @default("AVERTISSEMENT")
  /// seuil, en centièmes de jour
  capacityCentiemes Int @default(100)
  /// jours de semaine ouvrés, 1=lundi .. 7=dimanche, séparés par des virgules
  workingDays    String @default("1,2,3,4,5")
  /// JSON, lu et écrit en bloc uniquement
  slotsJson      String @default("[]")
  /// JSON, lu et écrit en bloc uniquement
  holidaysJson   String @default("[]")
  defaultDisplayUnit      String @default("JOUR")
  defaultEngagementSource String @default("MANUEL")
}
```

- [ ] **Step 3: Écrire le script de bascule de provider**

`scripts/set-db-provider.mjs` :

```js
import { readFileSync, writeFileSync } from 'node:fs'

const provider = process.argv[2]
if (provider !== 'sqlite' && provider !== 'postgresql') {
  console.error('Usage: node scripts/set-db-provider.mjs <sqlite|postgresql>')
  process.exit(1)
}

const path = 'prisma/schema.prisma'
const src = readFileSync(path, 'utf8')
const out = src.replace(/provider = "(sqlite|postgresql)"/, `provider = "${provider}"`)

if (out === src && !src.includes(`provider = "${provider}"`)) {
  console.error('Bloc datasource introuvable dans prisma/schema.prisma')
  process.exit(1)
}

writeFileSync(path, out)
console.log(`Provider Prisma : ${provider}`)
```

Ajouter à `package.json` :

```json
{
  "scripts": {
    "db:pg": "node scripts/set-db-provider.mjs postgresql && prisma generate",
    "db:sqlite": "node scripts/set-db-provider.mjs sqlite && prisma db push && prisma generate",
    "db:migrate": "prisma migrate dev"
  }
}
```

`.env.example` :

```
# Postgres (serveur)
DATABASE_URL="postgresql://cra:cra@localhost:5432/cra"

# SQLite (poste local) — utiliser npm run db:sqlite
# DATABASE_URL="file:./cra.db"

AUTH_SECRET="a-remplacer-par-une-valeur-aleatoire"
```

- [ ] **Step 4: Écrire le singleton Prisma**

`src/db/client.ts` :

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 5: Écrire le test qui échoue**

`src/db/schema.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './client'

describe('schéma', () => {
  let userId = ''
  let lineId = ''

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: 'schema@test.local', name: 'Test', passwordHash: 'x' },
    })
    userId = user.id

    const client = await prisma.client.create({ data: { name: 'Client test' } })
    const mission = await prisma.mission.create({
      data: { clientId: client.id, label: 'Mission test' },
    })
    const line = await prisma.missionLine.create({
      data: { missionId: mission.id, label: 'Consultant ITSM', soldCentiemes: 3000, tjmCents: 80000 },
    })
    lineId = line.id
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'schema@test.local' } })
    await prisma.client.deleteMany({ where: { name: 'Client test' } })
    await prisma.$disconnect()
  })

  it('stocke le temps en entiers', async () => {
    const entry = await prisma.timeEntry.create({
      data: { lineId, userId, date: new Date('2026-03-12T00:00:00Z'), minutes: 240, kind: 'REALISE' },
    })
    expect(entry.minutes).toBe(240)
    expect(Number.isInteger(entry.minutes)).toBe(true)
  })

  it('refuse un doublon sur (ligne, utilisateur, date, créneau)', async () => {
    const data = {
      lineId,
      userId,
      date: new Date('2026-03-13T00:00:00Z'),
      minutes: 480,
      kind: 'REALISE',
      slotId: null,
    }
    await prisma.timeEntry.create({ data })
    await expect(prisma.timeEntry.create({ data })).rejects.toThrow()
  })

  it('crée les réglages en singleton avec les valeurs par défaut', async () => {
    const s = await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: {},
      update: {},
    })
    expect(s.minutesParJour).toBe(480)
    expect(s.capacityMode).toBe('AVERTISSEMENT')
    expect(s.workingDays).toBe('1,2,3,4,5')
  })
})
```

- [ ] **Step 6: Préparer une base et lancer le test pour vérifier qu'il échoue**

```bash
cp .env.example .env
npm run db:pg
npx prisma migrate dev --name init
npm test -- src/db/schema.test.ts
```

Expected: le test échoue tant que la migration n'a pas tourné ; après migration il passe. Si `npx prisma migrate dev` échoue, aucune base Postgres n'écoute — lancer `docker run --rm -d -e POSTGRES_USER=cra -e POSTGRES_PASSWORD=cra -e POSTGRES_DB=cra -p 5432:5432 postgres:16`.

- [ ] **Step 7: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/db/schema.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 8: Vérifier que le schéma tourne aussi sur SQLite**

```bash
DATABASE_URL="file:./test.db" npm run db:sqlite
DATABASE_URL="file:./test.db" npm test -- src/db/schema.test.ts
node scripts/set-db-provider.mjs postgresql
rm -f prisma/test.db
```

Expected: PASS — 3 tests. C'est la vérification qui garantit la portabilité. Si elle échoue, le schéma est sorti de l'intersection.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(db): schema prisma portable sqlite/postgres"
```

---

## Task 7: Authentification

**Files:**
- Create: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/(auth)/login/page.tsx`, `src/middleware.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `scripts/create-user.mjs`
- Test: `src/auth.test.ts`

**Interfaces:**
- Consumes: `prisma` de `src/db/client.ts`, `Role` de `src/core/types.ts`
- Produces:
  - `auth()` — lit la session côté serveur, renvoie `{ user: { id: string; email: string; role: Role } } | null`
  - `signIn`, `signOut`
  - `requireUser(): Promise<{ id: string; role: Role }>` — lève si non connecté ; toutes les pages et actions serveur l'appellent

- [ ] **Step 1: Installer Auth.js et argon2**

```bash
npm i next-auth@beta @node-rs/argon2 zod
```

- [ ] **Step 2: Écrire le test qui échoue**

`src/auth.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './auth-password'

describe('mots de passe', () => {
  it('produit une empreinte différente du clair', async () => {
    const h = await hashPassword('motdepasse123')
    expect(h).not.toBe('motdepasse123')
    expect(h.length).toBeGreaterThan(20)
  })

  it('valide le bon mot de passe', async () => {
    const h = await hashPassword('motdepasse123')
    expect(await verifyPassword(h, 'motdepasse123')).toBe(true)
  })

  it('rejette un mauvais mot de passe', async () => {
    const h = await hashPassword('motdepasse123')
    expect(await verifyPassword(h, 'mauvais')).toBe(false)
  })

  it('produit deux empreintes différentes pour le même clair', async () => {
    const a = await hashPassword('identique')
    const b = await hashPassword('identique')
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/auth.test.ts`
Expected: FAIL — `Failed to resolve import "./auth-password"`

- [ ] **Step 4: Écrire l'implémentation**

`src/auth-password.ts` :

```ts
import { hash, verify } from '@node-rs/argon2'

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain)
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain)
  } catch {
    return false
  }
}
```

`src/auth.ts` :

```ts
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'
import { prisma } from '@/db/client'
import { verifyPassword } from './auth-password'
import type { Role } from '@/core/types'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
        if (!user) return null

        const ok = await verifyPassword(user.passwordHash, parsed.data.password)
        if (!ok) return null

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role: Role }).role
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as Role
      return session
    },
  },
})

export async function requireUser(): Promise<{ id: string; role: Role }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Non authentifié')
  return { id: session.user.id, role: session.user.role }
}
```

`src/app/api/auth/[...nextauth]/route.ts` :

```ts
import { handlers } from '@/auth'

export const { GET, POST } = handlers
```

`src/middleware.ts` :

```ts
import { auth } from '@/auth'

export default auth((req) => {
  const isLogin = req.nextUrl.pathname.startsWith('/login')
  if (!req.auth && !isLogin) {
    return Response.redirect(new URL('/login', req.nextUrl.origin))
  }
})

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
```

`src/app/(auth)/login/page.tsx` :

```tsx
import { signIn } from '@/auth'

export default function LoginPage() {
  async function login(formData: FormData) {
    'use server'
    await signIn('credentials', {
      email: String(formData.get('email')),
      password: String(formData.get('password')),
      redirectTo: '/saisie',
    })
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-4">
      <h1 className="mb-6 text-xl font-semibold">Connexion</h1>
      <form action={login} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="Adresse e-mail"
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Mot de passe"
          className="rounded border px-3 py-2"
        />
        <button type="submit" className="rounded bg-slate-900 px-3 py-2 text-white">
          Se connecter
        </button>
      </form>
    </main>
  )
}
```

`src/app/layout.tsx` :

```tsx
import './globals.css'
import type { ReactNode } from 'react'

export const metadata = { title: 'CRA' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  )
}
```

`src/app/globals.css` :

```css
@import "tailwindcss";
```

`scripts/create-user.mjs` :

```js
import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'

const [email, name, password] = process.argv.slice(2)
if (!email || !name || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <nom> <motdepasse>')
  process.exit(1)
}

const prisma = new PrismaClient()
const passwordHash = await hash(password)

await prisma.user.upsert({
  where: { email },
  create: { email, name, passwordHash, role: 'ADMIN' },
  update: { passwordHash },
})

console.log(`Utilisateur ${email} créé.`)
await prisma.$disconnect()
```

Ajouter le type de session, `src/types/next-auth.d.ts` :

```ts
import type { Role } from '@/core/types'
import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: { id: string; email: string; name: string; role: Role }
  }
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/auth.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 6: Vérifier la connexion de bout en bout**

```bash
node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse123
npm run dev
```

Ouvrir `http://localhost:3000/saisie` : redirection vers `/login`. Se connecter : la redirection vers `/saisie` doit aboutir (page encore absente — un 404 après authentification est le résultat attendu à ce stade).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(auth): authentification par identifiants et garde de session"
```

---

## Task 8: Réglages

**Files:**
- Create: `src/services/settings.ts`, `src/app/(app)/admin/saisie/page.tsx`, `src/app/(app)/admin/saisie/actions.ts`
- Test: `src/services/settings.test.ts`

**Interfaces:**
- Consumes: `prisma`, `Slot` de `src/core/time/slots.ts`, `CapacityMode`/`DisplayUnit`/`EngagementSource` de `src/core/types.ts`
- Produces:
  - `interface AppSettings { minutesParJour: number; capacityMode: CapacityMode; capacityCentiemes: number; workingDays: number[]; slots: Slot[]; holidays: string[]; defaultDisplayUnit: DisplayUnit; defaultEngagementSource: EngagementSource }`
  - `getSettings(): Promise<AppSettings>` — crée le singleton avec les créneaux par défaut s'il est absent
  - `updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>`
  - `DEFAULT_SLOTS: Slot[]`

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/settings.test.ts` :

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getSettings, updateSettings, DEFAULT_SLOTS } from './settings'
import { prisma } from '@/db/client'

afterAll(async () => {
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('réglages', () => {
  it('crée le singleton avec les créneaux par défaut', async () => {
    const s = await getSettings()
    expect(s.minutesParJour).toBe(480)
    expect(s.capacityMode).toBe('AVERTISSEMENT')
    expect(s.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(s.slots).toEqual(DEFAULT_SLOTS)
  })

  it('inclut un créneau de nuit par défaut', () => {
    const nuit = DEFAULT_SLOTS.find((s) => s.id === 'nuit')
    expect(nuit).toBeDefined()
    expect(nuit!.startMinute).toBe(1320)
    expect(nuit!.endMinute).toBe(360)
  })

  it('met à jour la durée d une journée', async () => {
    const s = await updateSettings({ minutesParJour: 432 })
    expect(s.minutesParJour).toBe(432)
    expect((await getSettings()).minutesParJour).toBe(432)
  })

  it('met à jour les jours ouvrés', async () => {
    const s = await updateSettings({ workingDays: [1, 2, 3, 4, 5, 6] })
    expect(s.workingDays).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('remplace intégralement les créneaux', async () => {
    const s = await updateSettings({
      slots: [{ id: 'x', label: 'Bloc', startMinute: 0, endMinute: 60, centiemes: 10 }],
    })
    expect(s.slots).toHaveLength(1)
    expect(s.slots[0]!.label).toBe('Bloc')
  })

  it('accepte les trois modes de capacité', async () => {
    for (const mode of ['DESACTIVE', 'AVERTISSEMENT', 'BLOCAGE'] as const) {
      const s = await updateSettings({ capacityMode: mode })
      expect(s.capacityMode).toBe(mode)
    }
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/services/settings.test.ts`
Expected: FAIL — `Failed to resolve import "./settings"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/settings.ts` :

```ts
import { prisma } from '@/db/client'
import type { Slot } from '@/core/time/slots'
import type { CapacityMode, DisplayUnit, EngagementSource } from '@/core/types'

export const DEFAULT_SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

export interface AppSettings {
  minutesParJour: number
  capacityMode: CapacityMode
  capacityCentiemes: number
  workingDays: number[]
  slots: Slot[]
  /** dates ISO 'YYYY-MM-DD' */
  holidays: string[]
  defaultDisplayUnit: DisplayUnit
  defaultEngagementSource: EngagementSource
}

function parseDays(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
}

type Row = Awaited<ReturnType<typeof prisma.settings.upsert>>

function toAppSettings(row: Row): AppSettings {
  const slots = JSON.parse(row.slotsJson) as Slot[]
  return {
    minutesParJour: row.minutesParJour,
    capacityMode: row.capacityMode as CapacityMode,
    capacityCentiemes: row.capacityCentiemes,
    workingDays: parseDays(row.workingDays),
    slots: slots.length > 0 ? slots : DEFAULT_SLOTS,
    holidays: JSON.parse(row.holidaysJson) as string[],
    defaultDisplayUnit: row.defaultDisplayUnit as DisplayUnit,
    defaultEngagementSource: row.defaultEngagementSource as EngagementSource,
  }
}

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', slotsJson: JSON.stringify(DEFAULT_SLOTS) },
    update: {},
  })
  return toAppSettings(row)
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  await getSettings() // garantit l'existence du singleton

  const row = await prisma.settings.update({
    where: { id: 'singleton' },
    data: {
      ...(patch.minutesParJour !== undefined && { minutesParJour: patch.minutesParJour }),
      ...(patch.capacityMode !== undefined && { capacityMode: patch.capacityMode }),
      ...(patch.capacityCentiemes !== undefined && { capacityCentiemes: patch.capacityCentiemes }),
      ...(patch.workingDays !== undefined && { workingDays: patch.workingDays.join(',') }),
      ...(patch.slots !== undefined && { slotsJson: JSON.stringify(patch.slots) }),
      ...(patch.holidays !== undefined && { holidaysJson: JSON.stringify(patch.holidays) }),
      ...(patch.defaultDisplayUnit !== undefined && { defaultDisplayUnit: patch.defaultDisplayUnit }),
      ...(patch.defaultEngagementSource !== undefined && {
        defaultEngagementSource: patch.defaultEngagementSource,
      }),
    },
  })
  return toAppSettings(row)
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/services/settings.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Écrire l'écran d'administration**

`src/app/(app)/admin/saisie/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { updateSettings } from '@/services/settings'
import type { CapacityMode } from '@/core/types'

export async function saveSettings(formData: FormData) {
  await requireUser()

  const heures = Number(formData.get('heures'))
  const minutesSup = Number(formData.get('minutes'))

  await updateSettings({
    minutesParJour: heures * 60 + minutesSup,
    capacityMode: String(formData.get('capacityMode')) as CapacityMode,
    capacityCentiemes: Math.round(Number(formData.get('capaciteJours')) * 100),
    workingDays: formData.getAll('workingDays').map((d) => Number(d)),
  })

  revalidatePath('/admin/saisie')
}
```

`src/app/(app)/admin/saisie/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { saveSettings } from './actions'

const JOURS = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' },
]

export default async function AdminSaisiePage() {
  await requireUser()
  const s = await getSettings()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Administration · Saisie</h1>

      <form action={saveSettings} className="flex flex-col gap-6">
        <fieldset>
          <legend className="mb-2 font-medium">Durée d’une journée</legend>
          <div className="flex items-center gap-2">
            <input
              name="heures"
              type="number"
              min={1}
              max={24}
              defaultValue={Math.floor(s.minutesParJour / 60)}
              className="w-20 rounded border px-2 py-1"
            />
            <span>h</span>
            <input
              name="minutes"
              type="number"
              min={0}
              max={59}
              defaultValue={s.minutesParJour % 60}
              className="w-20 rounded border px-2 py-1"
            />
            <span className="text-sm text-slate-500">min</span>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-medium">Contrôle de capacité</legend>
          <select
            name="capacityMode"
            defaultValue={s.capacityMode}
            className="rounded border px-2 py-1"
          >
            <option value="DESACTIVE">Désactivé</option>
            <option value="AVERTISSEMENT">Avertissement</option>
            <option value="BLOCAGE">Blocage</option>
          </select>
          <label className="ml-4 inline-flex items-center gap-2">
            <span className="text-sm">Seuil</span>
            <input
              name="capaciteJours"
              type="number"
              step="0.5"
              min="0.5"
              defaultValue={s.capacityCentiemes / 100}
              className="w-20 rounded border px-2 py-1"
            />
            <span className="text-sm text-slate-500">jour(s)</span>
          </label>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-medium">Jours ouvrés</legend>
          <div className="flex flex-wrap gap-3">
            {JOURS.map((j) => (
              <label key={j.value} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  name="workingDays"
                  value={j.value}
                  defaultChecked={s.workingDays.includes(j.value)}
                />
                <span className="text-sm">{j.label}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Les autres jours restent saisissables ; ils sont seulement grisés.
          </p>
        </fieldset>

        <button type="submit" className="self-start rounded bg-slate-900 px-4 py-2 text-white">
          Enregistrer
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 6: Vérifier l'écran**

```bash
npm run dev
```

Ouvrir `http://localhost:3000/admin/saisie`, passer la journée à 7 h 12, le mode à Blocage, cocher samedi. Recharger : les valeurs sont conservées.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): reglages de saisie et ecran d'administration"
```

---

## Task 9: Clients, missions et lignes de prestation

**Files:**
- Create: `src/services/clients.ts`, `src/services/missions.ts`, `src/app/(app)/missions/page.tsx`, `src/app/(app)/missions/actions.ts`
- Test: `src/services/missions.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getSettings` de `src/services/settings.ts`
- Produces:
  - `createClient(name: string): Promise<{ id: string; name: string }>`
  - `listClients(): Promise<Array<{ id: string; name: string }>>`
  - `createMission(args: { clientId: string; label: string }): Promise<{ id: string }>`
  - `createLine(args: { missionId: string; userId: string; label: string; soldCentiemes: number; tjmCents: number; displayUnit?: DisplayUnit; minutesParJour?: number | null }): Promise<{ id: string }>` — crée aussi l'`Assignment` de l'utilisateur
  - `listActiveLines(userId: string): Promise<LineForGrid[]>`
  - `interface LineForGrid { id: string; label: string; missionLabel: string; clientName: string; displayUnit: DisplayUnit; minutesParJour: number; soldCentiemes: number; allowedSlotIds: string[] }`

`createLine` crée systématiquement l'affectation — c'est la provision multi-consultants, invisible en mono-utilisateur.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/missions.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient, listClients } from './clients'
import { createMission, createLine, listActiveLines } from './missions'

let userId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'missions@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'missions@test.local' } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'ACME' } } })
  await prisma.$disconnect()
})

describe('clients et missions', () => {
  it('crée un client et le retrouve', async () => {
    const c = await createClient('ACME 38')
    expect(c.id).toBeTruthy()
    expect((await listClients()).some((x) => x.id === c.id)).toBe(true)
  })

  it('crée une ligne et son affectation automatiquement', async () => {
    const c = await createClient('ACME auto')
    const m = await createMission({ clientId: c.id, label: 'ITSM' })
    const l = await createLine({
      missionId: m.id,
      userId,
      label: 'Consultant ITSM',
      soldCentiemes: 3000,
      tjmCents: 80000,
    })

    const assignment = await prisma.assignment.findUnique({
      where: { lineId_userId: { lineId: l.id, userId } },
    })
    expect(assignment).not.toBeNull()
    expect(assignment!.soldCentiemes).toBe(3000)
  })

  it('porte deux lignes tarifées différemment sous une même mission', async () => {
    const c = await createClient('ACME deux lignes')
    const m = await createMission({ clientId: c.id, label: 'ITSM' })
    await createLine({ missionId: m.id, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })
    await createLine({ missionId: m.id, userId, label: 'Nuit', soldCentiemes: 1000, tjmCents: 120000 })

    const lines = (await listActiveLines(userId)).filter((l) => l.missionLabel === 'ITSM')
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.label).sort()).toEqual(['Jour', 'Nuit'])
  })

  it('hérite de minutesParJour des réglages quand la ligne ne le surcharge pas', async () => {
    const c = await createClient('ACME herit')
    const m = await createMission({ clientId: c.id, label: 'H' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const line = (await listActiveLines(userId)).find((l) => l.missionLabel === 'H')
    expect(line!.minutesParJour).toBe(480)
  })

  it('respecte la surcharge de minutesParJour au niveau de la ligne', async () => {
    const c = await createClient('ACME surcharge')
    const m = await createMission({ clientId: c.id, label: 'S' })
    await createLine({
      missionId: m.id,
      userId,
      label: 'L',
      soldCentiemes: 100,
      tjmCents: 0,
      minutesParJour: 432,
    })

    const line = (await listActiveLines(userId)).find((l) => l.missionLabel === 'S')
    expect(line!.minutesParJour).toBe(432)
  })

  it('ne renvoie que les lignes affectées à l utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre@test.local', name: 'A', passwordHash: 'x' },
    })
    const lines = await listActiveLines(autre.id)
    expect(lines).toHaveLength(0)
    await prisma.user.delete({ where: { id: autre.id } })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/services/missions.test.ts`
Expected: FAIL — `Failed to resolve import "./clients"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/clients.ts` :

```ts
import { prisma } from '@/db/client'

export async function createClient(name: string): Promise<{ id: string; name: string }> {
  const c = await prisma.client.create({ data: { name } })
  return { id: c.id, name: c.name }
}

export async function listClients(): Promise<Array<{ id: string; name: string }>> {
  return prisma.client.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
}
```

`src/services/missions.ts` :

```ts
import { prisma } from '@/db/client'
import { getSettings } from './settings'
import type { DisplayUnit } from '@/core/types'

export interface LineForGrid {
  id: string
  label: string
  missionLabel: string
  clientName: string
  displayUnit: DisplayUnit
  minutesParJour: number
  soldCentiemes: number
  allowedSlotIds: string[]
}

export async function createMission(args: {
  clientId: string
  label: string
}): Promise<{ id: string }> {
  const m = await prisma.mission.create({
    data: { clientId: args.clientId, label: args.label },
  })
  return { id: m.id }
}

export async function createLine(args: {
  missionId: string
  userId: string
  label: string
  soldCentiemes: number
  tjmCents: number
  displayUnit?: DisplayUnit
  minutesParJour?: number | null
  allowedSlotIds?: string[]
}): Promise<{ id: string }> {
  const settings = await getSettings()

  const line = await prisma.missionLine.create({
    data: {
      missionId: args.missionId,
      label: args.label,
      soldCentiemes: args.soldCentiemes,
      tjmCents: args.tjmCents,
      displayUnit: args.displayUnit ?? settings.defaultDisplayUnit,
      minutesParJour: args.minutesParJour ?? null,
      engagementSource: settings.defaultEngagementSource,
      allowedSlotIds: (args.allowedSlotIds ?? []).join(','),
    },
  })

  // Provision multi-consultants : l'affectation existe toujours, même à un seul.
  await prisma.assignment.create({
    data: { lineId: line.id, userId: args.userId, soldCentiemes: args.soldCentiemes },
  })

  return { id: line.id }
}

export async function listActiveLines(userId: string): Promise<LineForGrid[]> {
  const settings = await getSettings()

  const assignments = await prisma.assignment.findMany({
    where: { userId, line: { archived: false, mission: { archived: false } } },
    include: { line: { include: { mission: { include: { client: true } } } } },
    orderBy: [{ line: { position: 'asc' } }],
  })

  return assignments.map((a) => ({
    id: a.line.id,
    label: a.line.label,
    missionLabel: a.line.mission.label,
    clientName: a.line.mission.client.name,
    displayUnit: a.line.displayUnit as DisplayUnit,
    minutesParJour: a.line.minutesParJour ?? settings.minutesParJour,
    soldCentiemes: a.soldCentiemes,
    allowedSlotIds: a.line.allowedSlotIds === '' ? [] : a.line.allowedSlotIds.split(','),
  }))
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/services/missions.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Écrire l'écran de gestion**

`src/app/(app)/missions/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import type { DisplayUnit } from '@/core/types'

export async function addClient(formData: FormData) {
  await requireUser()
  await createClient(String(formData.get('name')))
  revalidatePath('/missions')
}

export async function addMission(formData: FormData) {
  await requireUser()
  await createMission({
    clientId: String(formData.get('clientId')),
    label: String(formData.get('label')),
  })
  revalidatePath('/missions')
}

export async function addLine(formData: FormData) {
  const user = await requireUser()
  await createLine({
    missionId: String(formData.get('missionId')),
    userId: user.id,
    label: String(formData.get('label')),
    soldCentiemes: Math.round(Number(formData.get('joursVendus')) * 100),
    tjmCents: Math.round(Number(formData.get('tjm')) * 100),
    displayUnit: String(formData.get('displayUnit')) as DisplayUnit,
  })
  revalidatePath('/missions')
  revalidatePath('/saisie')
}
```

`src/app/(app)/missions/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { prisma } from '@/db/client'
import { listClients } from '@/services/clients'
import { addClient, addMission, addLine } from './actions'

export default async function MissionsPage() {
  await requireUser()
  const clients = await listClients()
  const missions = await prisma.mission.findMany({
    where: { archived: false },
    include: { client: true, lines: { where: { archived: false } } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Missions</h1>

      <section className="mb-8 flex flex-wrap gap-8">
        <form action={addClient} className="flex items-end gap-2">
          <label className="flex flex-col text-sm">
            Nouveau client
            <input name="name" required className="rounded border px-2 py-1" />
          </label>
          <button className="rounded bg-slate-900 px-3 py-1 text-white">Créer</button>
        </form>

        <form action={addMission} className="flex items-end gap-2">
          <label className="flex flex-col text-sm">
            Nouvelle mission
            <input name="label" required className="rounded border px-2 py-1" />
          </label>
          <select name="clientId" required className="rounded border px-2 py-1">
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="rounded bg-slate-900 px-3 py-1 text-white">Créer</button>
        </form>
      </section>

      {missions.map((m) => (
        <section key={m.id} className="mb-8 rounded border p-4">
          <h2 className="mb-3 font-medium">
            {m.client.name} · {m.label}
          </h2>

          <ul className="mb-4 text-sm">
            {m.lines.map((l) => (
              <li key={l.id} className="flex gap-4 border-b py-1 last:border-0">
                <span className="flex-1">{l.label}</span>
                <span>{l.soldCentiemes / 100} j</span>
                <span>{l.tjmCents / 100} €</span>
                <span className="text-slate-500">{l.displayUnit}</span>
              </li>
            ))}
            {m.lines.length === 0 && <li className="text-slate-500">Aucune ligne</li>}
          </ul>

          <form action={addLine} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="missionId" value={m.id} />
            <label className="flex flex-col text-sm">
              Ligne
              <input name="label" required className="rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col text-sm">
              Jours vendus
              <input name="joursVendus" type="number" step="0.5" required className="w-28 rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col text-sm">
              TJM (€)
              <input name="tjm" type="number" step="1" defaultValue={0} className="w-28 rounded border px-2 py-1" />
            </label>
            <select name="displayUnit" className="rounded border px-2 py-1">
              <option value="JOUR">Jour</option>
              <option value="DEMI_JOUR">Demi-journée</option>
              <option value="HEURE">Heure</option>
            </select>
            <button className="rounded bg-slate-900 px-3 py-1 text-white">Ajouter</button>
          </form>
        </section>
      ))}
    </main>
  )
}
```

- [ ] **Step 6: Vérifier l'écran**

```bash
npm run dev
```

Sur `http://localhost:3000/missions` : créer un client, une mission, puis deux lignes — « Consultant ITSM » 30 j / 800 € et « Consultant ITSM Nuit » 10 j / 1200 €. Les deux apparaissent sous la même mission.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(missions): clients, missions et lignes de prestation"
```

---

## Task 10: Lecture d'un mois et calcul des totaux

**Files:**
- Create: `src/core/month/build.ts`, `src/services/time-entries.ts`
- Test: `src/core/month/build.test.ts`

**Interfaces:**
- Consumes: `Slot`, `LineForGrid`, `computeEngagement`, `minutesToCentiemes`
- Produces:
  - `interface MonthDay { date: string; dayOfWeek: number; isWorking: boolean; isHoliday: boolean }`
  - `buildMonthDays(month: string, workingDays: number[], holidays: string[]): MonthDay[]` — `month` au format `'YYYY-MM'`
  - `dailyTotals(entries: ReadonlyArray<{ date: string; minutes: number }>): Map<string, number>`
  - `getMonthEntries(userId: string, month: string): Promise<Array<{ id: string; lineId: string; date: string; minutes: number; kind: TimeEntryKind; slotId: string | null }>>`

`buildMonthDays` est pur et n'accède à rien — c'est la garantie qu'il se teste sans base.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/month/build.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { buildMonthDays, dailyTotals } from './build'

describe('buildMonthDays', () => {
  it('produit le bon nombre de jours', () => {
    expect(buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])).toHaveLength(31)
    expect(buildMonthDays('2026-02', [1, 2, 3, 4, 5], [])).toHaveLength(28)
    expect(buildMonthDays('2024-02', [1, 2, 3, 4, 5], [])).toHaveLength(29)
  })

  it('marque les jours ouvrés selon les réglages', () => {
    const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])
    // 2026-03-01 est un dimanche
    expect(days[0]!.date).toBe('2026-03-01')
    expect(days[0]!.dayOfWeek).toBe(7)
    expect(days[0]!.isWorking).toBe(false)
    // 2026-03-02 est un lundi
    expect(days[1]!.isWorking).toBe(true)
  })

  it('rend le samedi ouvré quand il est activé', () => {
    const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5, 6], [])
    const samedi = days.find((d) => d.date === '2026-03-07')
    expect(samedi!.dayOfWeek).toBe(6)
    expect(samedi!.isWorking).toBe(true)
  })

  it('marque les fériés sans les rendre non saisissables', () => {
    const days = buildMonthDays('2026-05', [1, 2, 3, 4, 5], ['2026-05-01'])
    const premierMai = days.find((d) => d.date === '2026-05-01')
    expect(premierMai!.isHoliday).toBe(true)
  })
})

describe('dailyTotals', () => {
  it('agrège toutes lignes confondues', () => {
    const totals = dailyTotals([
      { date: '2026-03-12', minutes: 240 },
      { date: '2026-03-12', minutes: 240 },
      { date: '2026-03-13', minutes: 480 },
    ])
    expect(totals.get('2026-03-12')).toBe(480)
    expect(totals.get('2026-03-13')).toBe(480)
  })

  it('renvoie une table vide sans saisie', () => {
    expect(dailyTotals([]).size).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/core/month/build.test.ts`
Expected: FAIL — `Failed to resolve import "./build"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/month/build.ts` :

```ts
export interface MonthDay {
  /** 'YYYY-MM-DD' */
  date: string
  /** 1 = lundi ... 7 = dimanche */
  dayOfWeek: number
  isWorking: boolean
  isHoliday: boolean
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function buildMonthDays(
  month: string,
  workingDays: number[],
  holidays: string[],
): MonthDay[] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const holidaySet = new Set(holidays)

  const out: MonthDay[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${pad(m)}-${pad(d)}`
    const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = dimanche
    const dayOfWeek = js === 0 ? 7 : js
    out.push({
      date,
      dayOfWeek,
      isWorking: workingDays.includes(dayOfWeek),
      isHoliday: holidaySet.has(date),
    })
  }
  return out
}

export function dailyTotals(
  entries: ReadonlyArray<{ date: string; minutes: number }>,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const e of entries) {
    totals.set(e.date, (totals.get(e.date) ?? 0) + e.minutes)
  }
  return totals
}
```

`src/services/time-entries.ts` :

```ts
import { prisma } from '@/db/client'
import type { TimeEntryKind } from '@/core/types'

export interface MonthEntry {
  id: string
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  minutes: number
  kind: TimeEntryKind
  slotId: string | null
}

function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  }
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function getMonthEntries(userId: string, month: string): Promise<MonthEntry[]> {
  const { start, end } = monthBounds(month)

  const rows = await prisma.timeEntry.findMany({
    where: { userId, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
  })

  return rows.map((r) => ({
    id: r.id,
    lineId: r.lineId,
    date: toIsoDate(r.date),
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
    slotId: r.slotId,
  }))
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/core/month/build.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): construction du mois et totaux journaliers"
```

---

## Task 11: Enregistrement d'une saisie avec contrôle de capacité

**Files:**
- Modify: `src/services/time-entries.ts`
- Test: `src/services/time-entries.test.ts`

**Interfaces:**
- Consumes: `checkCapacity`, `isLocked`, `getSettings`, `prisma`
- Produces:
  - `type SaveResult = { ok: true; minutes: number } | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number } | { ok: false; reason: 'VERROUILLE' }`
  - `saveEntry(args: { userId: string; lineId: string; date: string; minutes: number; kind: TimeEntryKind; slotId?: string | null }): Promise<SaveResult>`

`minutes: 0` supprime la ligne. Le contrôle de capacité exclut la valeur déjà posée sur la même clé — sinon corriger une saisie déclencherait une fausse alerte.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/time-entries.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry, getMonthEntries } from './time-entries'

let userId = ''
let lineA = ''
let lineB = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'entries@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id

  const c = await createClient('ENTRIES client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  lineA = (await createLine({ missionId: m.id, userId, label: 'A', soldCentiemes: 3000, tjmCents: 0 })).id
  lineB = (await createLine({ missionId: m.id, userId, label: 'B', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'entries@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'ENTRIES client' } })
  await prisma.$disconnect()
})

describe('saveEntry', () => {
  it('enregistre une demi-journée', async () => {
    const r = await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r).toEqual({ ok: true, minutes: 240 })
  })

  it('accepte deux demi-journées sur deux lignes le même jour', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r.ok).toBe(true)
  })

  it('bloque le dépassement en mode BLOCAGE', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'CAPACITE', totalMinutes: 720, capacityMinutes: 480 })
  })

  it('laisse passer le dépassement en mode AVERTISSEMENT', async () => {
    await updateSettings({ capacityMode: 'AVERTISSEMENT' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r.ok).toBe(true)
    expect((await getMonthEntries(userId, '2026-03')).length).toBe(2)
  })

  it('ne compte pas deux fois la valeur qu on est en train de corriger', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r).toEqual({ ok: true, minutes: 240 })
  })

  it('supprime la ligne quand on saisit zéro', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    expect(await getMonthEntries(userId, '2026-03')).toHaveLength(0)
  })

  it('applique la même règle un dimanche', async () => {
    // 2026-03-15 est un dimanche
    await saveEntry({ userId, lineId: lineA, date: '2026-03-15', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-15', minutes: 240, kind: 'REALISE' })
    expect(r.ok).toBe(false)
  })

  it('refuse toute écriture sur un mois dont le CRA est validé', async () => {
    const line = await prisma.missionLine.findUniqueOrThrow({ where: { id: lineA } })
    await prisma.cra.create({
      data: {
        missionId: line.missionId,
        userId,
        month: new Date('2026-04-01T00:00:00Z'),
        status: 'VALIDE',
      },
    })

    const r = await saveEntry({ userId, lineId: lineA, date: '2026-04-10', minutes: 480, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })

    await prisma.cra.deleteMany({ where: { userId } })
  })

  it('ignore le contrôle en mode DESACTIVE', async () => {
    await updateSettings({ capacityMode: 'DESACTIVE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/services/time-entries.test.ts`
Expected: FAIL — `saveEntry is not a function`

- [ ] **Step 3: Écrire l'implémentation**

Ajouter à `src/services/time-entries.ts` :

```ts
import { checkCapacity } from '@/core/capacity/check'
import { isLocked } from '@/core/cra/state-machine'
import { centiemesToMinutes } from '@/core/time/units'
import { getSettings } from './settings'
import type { CraStatus } from '@/core/types'

export type SaveResult =
  | { ok: true; minutes: number }
  | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number }
  | { ok: false; reason: 'VERROUILLE' }

function monthStartOf(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00.000Z`)
}

export async function saveEntry(args: {
  userId: string
  lineId: string
  date: string
  minutes: number
  kind: TimeEntryKind
  slotId?: string | null
}): Promise<SaveResult> {
  const slotId = args.slotId ?? null
  const date = new Date(`${args.date}T00:00:00.000Z`)
  const settings = await getSettings()

  const line = await prisma.missionLine.findUniqueOrThrow({
    where: { id: args.lineId },
    select: { missionId: true },
  })

  const cra = await prisma.cra.findUnique({
    where: {
      missionId_userId_month: {
        missionId: line.missionId,
        userId: args.userId,
        month: monthStartOf(args.date),
      },
    },
    select: { status: true },
  })

  if (cra && isLocked(cra.status as CraStatus)) {
    return { ok: false, reason: 'VERROUILLE' }
  }

  if (args.minutes === 0) {
    await prisma.timeEntry.deleteMany({
      where: { userId: args.userId, lineId: args.lineId, date, slotId },
    })
    return { ok: true, minutes: 0 }
  }

  // Total du jour hors la clé qu'on écrit : corriger une valeur ne doit pas
  // la compter deux fois.
  const sameDay = await prisma.timeEntry.findMany({
    where: { userId: args.userId, date },
    select: { minutes: true, lineId: true, slotId: true },
  })
  const existingMinutes = sameDay
    .filter((e) => !(e.lineId === args.lineId && e.slotId === slotId))
    .reduce((sum, e) => sum + e.minutes, 0)

  const verdict = checkCapacity({
    existingMinutes,
    addedMinutes: args.minutes,
    capacityMinutes: centiemesToMinutes(settings.capacityCentiemes, settings.minutesParJour),
    mode: settings.capacityMode,
  })

  if (!verdict.ok && verdict.severity === 'block') {
    return {
      ok: false,
      reason: 'CAPACITE',
      totalMinutes: verdict.totalMinutes,
      capacityMinutes: verdict.capacityMinutes,
    }
  }

  await prisma.timeEntry.upsert({
    where: {
      lineId_userId_date_slotId: { lineId: args.lineId, userId: args.userId, date, slotId },
    },
    create: {
      lineId: args.lineId,
      userId: args.userId,
      date,
      slotId,
      minutes: args.minutes,
      kind: args.kind,
    },
    update: { minutes: args.minutes, kind: args.kind },
  })

  return { ok: true, minutes: args.minutes }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/services/time-entries.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(saisie): enregistrement des temps avec controle de capacite"
```

---

## Task 12: Grille mensuelle — rendu, totaux et engagement

**Files:**
- Create: `src/components/grid/EngagementBar.tsx`, `src/components/grid/TotalsRow.tsx`, `src/components/grid/MonthGrid.tsx`, `src/app/(app)/saisie/page.tsx`, `src/app/(app)/saisie/[month]/page.tsx`
- Test: `src/components/grid/MonthGrid.test.tsx`

**Interfaces:**
- Consumes: `MonthDay`, `LineForGrid`, `MonthEntry`, `formatQuantity`, `computeEngagement`, `dailyTotals`
- Produces:
  - `<MonthGrid days={MonthDay[]} lines={LineForGrid[]} entries={MonthEntry[]} capacityMinutes={number} onSave={(lineId, date, raw) => void} />`
  - `<EngagementBar line={LineForGrid} entries={MonthEntry[]} />`
  - `<TotalsRow days={MonthDay[]} entries={MonthEntry[]} capacityMinutes={number} minutesParJour={number} />`

- [ ] **Step 1: Installer l'outillage de test des composants**

```bash
npm i -D @testing-library/react @testing-library/user-event jsdom
```

Ajouter à `vitest.config.ts`, dans `test` : `environmentMatchGlobs: [['src/components/**', 'jsdom']]`.

- [ ] **Step 2: Écrire le test qui échoue**

`src/components/grid/MonthGrid.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MonthGrid } from './MonthGrid'
import { buildMonthDays } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])

const lines: LineForGrid[] = [
  {
    id: 'l1',
    label: 'Consultant ITSM',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    displayUnit: 'JOUR',
    minutesParJour: 480,
    soldCentiemes: 3000,
    allowedSlotIds: [],
  },
  {
    id: 'l2',
    label: 'Consultant ITSM Nuit',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    displayUnit: 'HEURE',
    minutesParJour: 480,
    soldCentiemes: 1000,
    allowedSlotIds: ['nuit'],
  },
]

const entries: MonthEntry[] = [
  { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: null },
  { id: 'e2', lineId: 'l2', date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'nuit' },
]

function renderGrid() {
  return render(
    <MonthGrid
      days={days}
      lines={lines}
      entries={entries}
      capacityMinutes={480}
      onSave={vi.fn()}
    />,
  )
}

describe('MonthGrid', () => {
  it('affiche une ligne par ligne de prestation', () => {
    renderGrid()
    expect(screen.getByText('Consultant ITSM')).toBeDefined()
    expect(screen.getByText('Consultant ITSM Nuit')).toBeDefined()
  })

  it('affiche 31 colonnes de jours en mars', () => {
    renderGrid()
    expect(screen.getAllByRole('columnheader')).toHaveLength(32) // 31 jours + colonne de libellé
  })

  it('formate chaque cellule dans l unité de sa ligne', () => {
    renderGrid()
    expect(screen.getByDisplayValue('1')).toBeDefined() // ligne au jour
    expect(screen.getByDisplayValue('4h')).toBeDefined() // ligne à l heure
  })

  it('marque les jours non ouvrés', () => {
    renderGrid()
    // 2026-03-01 est un dimanche
    const header = screen.getByTestId('day-header-2026-03-01')
    expect(header.className).toContain('bg-slate-100')
  })

  it('signale le dépassement de capacité sur la ligne de totaux', () => {
    renderGrid()
    // 480 + 240 = 720 > 480
    const total = screen.getByTestId('total-2026-03-12')
    expect(total.className).toContain('text-red-600')
  })

  it('affiche le bandeau d engagement par ligne', () => {
    renderGrid()
    expect(screen.getByTestId('engagement-l1').textContent).toContain('30')
    expect(screen.getByTestId('engagement-l1').textContent).toContain('29')
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/components/grid/MonthGrid.test.tsx`
Expected: FAIL — `Failed to resolve import "./MonthGrid"`

- [ ] **Step 4: Écrire les composants**

`src/components/grid/EngagementBar.tsx` :

```tsx
'use client'

import { computeEngagement } from '@/core/engagement/compute'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

export function EngagementBar({
  line,
  entries,
}: {
  line: LineForGrid
  entries: MonthEntry[]
}) {
  const e = computeEngagement({
    venduCentiemes: line.soldCentiemes,
    entries: entries.filter((x) => x.lineId === line.id),
    minutesParJour: line.minutesParJour,
  })

  const pct = (v: number) => (e.venduCentiemes === 0 ? 0 : (v / e.venduCentiemes) * 100)

  return (
    <div data-testid={`engagement-${line.id}`} className="flex items-center gap-3 text-xs">
      <div className="h-2 w-40 overflow-hidden rounded bg-slate-200">
        <div className="flex h-full">
          <div className="bg-slate-800" style={{ width: `${pct(e.realiseCentiemes)}%` }} />
          <div className="bg-slate-400" style={{ width: `${pct(e.prevuCentiemes)}%` }} />
        </div>
      </div>
      <span className="text-slate-600">
        {e.venduCentiemes / 100} vendus · {e.realiseCentiemes / 100} réalisés ·{' '}
        {e.prevuCentiemes / 100} prévus · {e.resteCentiemes / 100} restants
      </span>
      {e.depassementCentiemes > 0 && (
        <span className="text-amber-600">dépassement de {e.depassementCentiemes / 100} j</span>
      )}
    </div>
  )
}
```

`src/components/grid/TotalsRow.tsx` :

```tsx
'use client'

import { dailyTotals } from '@/core/month/build'
import { formatQuantity } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { MonthEntry } from '@/services/time-entries'

export function TotalsRow({
  days,
  entries,
  capacityMinutes,
  minutesParJour,
}: {
  days: MonthDay[]
  entries: MonthEntry[]
  capacityMinutes: number
  minutesParJour: number
}) {
  const totals = dailyTotals(entries)

  return (
    <tr className="border-t-2 font-medium">
      <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left text-sm">
        Total
      </th>
      {days.map((d) => {
        const minutes = totals.get(d.date) ?? 0
        const over = capacityMinutes > 0 && minutes > capacityMinutes
        return (
          <td
            key={d.date}
            data-testid={`total-${d.date}`}
            className={`px-1 py-1 text-center text-xs ${over ? 'text-red-600' : 'text-slate-600'}`}
          >
            {formatQuantity(minutes, 'JOUR', minutesParJour)}
          </td>
        )
      })}
    </tr>
  )
}
```

`src/components/grid/MonthGrid.tsx` :

```tsx
'use client'

import { formatQuantity } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'
import { EngagementBar } from './EngagementBar'
import { TotalsRow } from './TotalsRow'

export function MonthGrid({
  days,
  lines,
  entries,
  capacityMinutes,
  onSave,
}: {
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  capacityMinutes: number
  onSave: (lineId: string, date: string, raw: string) => void
}) {
  const byKey = new Map(entries.map((e) => [`${e.lineId}|${e.date}`, e]))
  const minutesParJour = lines[0]?.minutesParJour ?? 480

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex flex-col gap-1">
        {lines.map((l) => (
          <EngagementBar key={l.id} line={l} entries={entries} />
        ))}
      </div>

      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-white px-2 py-1 text-left">
              Ligne
            </th>
            {days.map((d) => (
              <th
                key={d.date}
                scope="col"
                data-testid={`day-header-${d.date}`}
                className={`w-9 px-1 py-1 text-center text-xs font-normal ${
                  d.isWorking && !d.isHoliday ? '' : 'bg-slate-100'
                }`}
              >
                {Number(d.date.slice(8))}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t">
              <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left font-normal">
                {l.label}
              </th>
              {days.map((d) => {
                const entry = byKey.get(`${l.id}|${d.date}`)
                const value = entry ? formatQuantity(entry.minutes, l.displayUnit, l.minutesParJour) : ''
                return (
                  <td key={d.date} className={d.isWorking && !d.isHoliday ? '' : 'bg-slate-50'}>
                    <input
                      aria-label={`${l.label} ${d.date}`}
                      defaultValue={value}
                      onBlur={(ev) => onSave(l.id, d.date, ev.target.value)}
                      className={`h-8 w-9 border-0 bg-transparent text-center text-xs outline-none focus:bg-blue-50 ${
                        entry?.kind === 'PREVISIONNEL' ? 'text-slate-400 italic' : ''
                      }`}
                    />
                  </td>
                )
              })}
            </tr>
          ))}

          <TotalsRow
            days={days}
            entries={entries}
            capacityMinutes={capacityMinutes}
            minutesParJour={minutesParJour}
          />
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/components/grid/MonthGrid.test.tsx`
Expected: PASS — 6 tests

- [ ] **Step 6: Brancher la page de saisie**

`src/app/(app)/saisie/page.tsx` :

```tsx
import { redirect } from 'next/navigation'

export default function SaisieIndex() {
  const now = new Date()
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  redirect(`/saisie/${month}`)
}
```

`src/app/(app)/saisie/[month]/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { listActiveLines } from '@/services/missions'
import { getMonthEntries } from '@/services/time-entries'
import { buildMonthDays } from '@/core/month/build'
import { centiemesToMinutes } from '@/core/time/units'
import { SaisieClient } from './SaisieClient'

export default async function SaisiePage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  const user = await requireUser()

  const settings = await getSettings()
  const lines = await listActiveLines(user.id)
  const entries = await getMonthEntries(user.id, month)
  const days = buildMonthDays(month, settings.workingDays, settings.holidays)

  return (
    <main className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Saisie · {month}</h1>
      <SaisieClient
        month={month}
        days={days}
        lines={lines}
        entries={entries}
        capacityMinutes={centiemesToMinutes(settings.capacityCentiemes, settings.minutesParJour)}
      />
    </main>
  )
}
```

`src/app/(app)/saisie/[month]/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { saveEntry, type SaveResult } from '@/services/time-entries'
import { parseQuantity } from '@/core/time/units'
import { listActiveLines } from '@/services/missions'
import type { TimeEntryKind } from '@/core/types'

export async function saveCell(args: {
  lineId: string
  date: string
  raw: string
  kind: TimeEntryKind
  month: string
}): Promise<SaveResult | { ok: false; reason: 'SAISIE_INVALIDE' }> {
  const user = await requireUser()

  const line = (await listActiveLines(user.id)).find((l) => l.id === args.lineId)
  if (!line) return { ok: false, reason: 'SAISIE_INVALIDE' }

  const minutes = parseQuantity(args.raw, line.displayUnit, line.minutesParJour)
  if (minutes === null) return { ok: false, reason: 'SAISIE_INVALIDE' }

  const result = await saveEntry({
    userId: user.id,
    lineId: args.lineId,
    date: args.date,
    minutes,
    kind: args.kind,
  })

  if (result.ok) revalidatePath(`/saisie/${args.month}`)
  return result
}
```

`src/app/(app)/saisie/[month]/SaisieClient.tsx` :

```tsx
'use client'

import { useState, useTransition } from 'react'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { saveCell } from './actions'
import type { MonthDay } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

export function SaisieClient(props: {
  month: string
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  capacityMinutes: number
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleSave(lineId: string, date: string, raw: string) {
    const kind = date >= new Date().toISOString().slice(0, 10) ? 'PREVISIONNEL' : 'REALISE'

    startTransition(async () => {
      const r = await saveCell({ lineId, date, raw, kind, month: props.month })
      if (r.ok) {
        setMessage(null)
        return
      }
      if (r.reason === 'CAPACITE') {
        setMessage(
          `Capacité dépassée le ${date} : ${r.totalMinutes / 60} h saisies pour ${r.capacityMinutes / 60} h disponibles.`,
        )
      } else if (r.reason === 'VERROUILLE') {
        setMessage(`Le CRA de ce mois est validé. Rouvrez-le pour modifier la saisie.`)
      } else {
        setMessage(`Saisie invalide.`)
      }
    })
  }

  return (
    <>
      {message && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {message}
        </p>
      )}
      <MonthGrid
        days={props.days}
        lines={props.lines}
        entries={props.entries}
        capacityMinutes={props.capacityMinutes}
        onSave={handleSave}
      />
    </>
  )
}
```

- [ ] **Step 7: Vérifier la saisie de bout en bout**

```bash
npm run dev
```

Sur `http://localhost:3000/saisie` : saisir `1` sur la ligne au jour et `4h` sur la ligne à l'heure, le même jour. La ligne de totaux passe au rouge. Recharger : les valeurs sont persistées.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(grille): rendu mensuel, totaux journaliers et bandeau d'engagement"
```

---

## Task 13: Sélection par glissement

**Files:**
- Create: `src/components/grid/useDragSelect.ts`
- Modify: `src/components/grid/MonthGrid.tsx`
- Test: `src/components/grid/useDragSelect.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `interface DragSelection { lineId: string; dates: string[] }`
  - `useDragSelect(onApply: (sel: DragSelection, raw: string) => void)` renvoie `{ selection, isSelected(lineId, date), handlers: { onMouseDown, onMouseEnter, onMouseUp }, applyToSelection(raw), clear() }`

La sélection ne franchit jamais une ligne : elle est ancrée sur la ligne du premier clic.

- [ ] **Step 1: Écrire le test qui échoue**

`src/components/grid/useDragSelect.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragSelect } from './useDragSelect'

describe('useDragSelect', () => {
  it('sélectionne une seule cellule sur un clic simple', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.handlers.onMouseUp())

    expect(result.current.isSelected('l1', '2026-03-02')).toBe(true)
  })

  it('sélectionne une plage en glissant vers la droite', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.handlers.onMouseEnter('l1', '2026-03-06'))

    for (const d of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']) {
      expect(result.current.isSelected('l1', d)).toBe(true)
    }
  })

  it('sélectionne une plage en glissant vers la gauche', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-06'))
    act(() => result.current.handlers.onMouseEnter('l1', '2026-03-04'))

    expect(result.current.isSelected('l1', '2026-03-04')).toBe(true)
    expect(result.current.isSelected('l1', '2026-03-05')).toBe(true)
    expect(result.current.isSelected('l1', '2026-03-06')).toBe(true)
  })

  it('ne franchit jamais une ligne', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.handlers.onMouseEnter('l2', '2026-03-06'))

    expect(result.current.isSelected('l2', '2026-03-06')).toBe(false)
    expect(result.current.isSelected('l1', '2026-03-02')).toBe(true)
  })

  it('applique une valeur à toute la sélection', () => {
    const onApply = vi.fn()
    const { result } = renderHook(() => useDragSelect(onApply))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.handlers.onMouseEnter('l1', '2026-03-04'))
    act(() => result.current.handlers.onMouseUp())
    act(() => result.current.applyToSelection('1'))

    expect(onApply).toHaveBeenCalledWith(
      { lineId: 'l1', dates: ['2026-03-02', '2026-03-03', '2026-03-04'] },
      '1',
    )
  })

  it('vide la sélection', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.clear())

    expect(result.current.isSelected('l1', '2026-03-02')).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/components/grid/useDragSelect.test.ts`
Expected: FAIL — `Failed to resolve import "./useDragSelect"`

- [ ] **Step 3: Écrire l'implémentation**

`src/components/grid/useDragSelect.ts` :

```ts
'use client'

import { useCallback, useState } from 'react'

export interface DragSelection {
  lineId: string
  dates: string[]
}

interface DragState {
  lineId: string
  anchor: string
  head: string
  dragging: boolean
}

function rangeBetween(a: string, b: string): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a]
  const out: string[] = []
  const cursor = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)

  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

export function useDragSelect(onApply: (sel: DragSelection, raw: string) => void) {
  const [state, setState] = useState<DragState | null>(null)

  const onMouseDown = useCallback((lineId: string, date: string) => {
    setState({ lineId, anchor: date, head: date, dragging: true })
  }, [])

  const onMouseEnter = useCallback((lineId: string, date: string) => {
    setState((s) => {
      if (!s || !s.dragging) return s
      if (s.lineId !== lineId) return s // la sélection ne franchit pas une ligne
      return { ...s, head: date }
    })
  }, [])

  const onMouseUp = useCallback(() => {
    setState((s) => (s ? { ...s, dragging: false } : s))
  }, [])

  const clear = useCallback(() => setState(null), [])

  const selection: DragSelection | null = state
    ? { lineId: state.lineId, dates: rangeBetween(state.anchor, state.head) }
    : null

  const isSelected = useCallback(
    (lineId: string, date: string): boolean => {
      if (!state || state.lineId !== lineId) return false
      return rangeBetween(state.anchor, state.head).includes(date)
    },
    [state],
  )

  const applyToSelection = useCallback(
    (raw: string) => {
      if (selection) onApply(selection, raw)
    },
    [selection, onApply],
  )

  return { selection, isSelected, handlers: { onMouseDown, onMouseEnter, onMouseUp }, applyToSelection, clear }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/components/grid/useDragSelect.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Brancher le glissement dans la grille**

Dans `src/components/grid/MonthGrid.tsx`, remplacer la signature du composant et le corps de `<td>` :

```tsx
'use client'

import { useDragSelect } from './useDragSelect'
// … imports existants inchangés

export function MonthGrid({
  days,
  lines,
  entries,
  capacityMinutes,
  onSave,
}: {
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  capacityMinutes: number
  onSave: (lineId: string, date: string, raw: string) => void
}) {
  const byKey = new Map(entries.map((e) => [`${e.lineId}|${e.date}`, e]))
  const minutesParJour = lines[0]?.minutesParJour ?? 480

  const drag = useDragSelect((sel, raw) => {
    for (const date of sel.dates) onSave(sel.lineId, date, raw)
  })
```

Puis la cellule :

```tsx
<td
  key={d.date}
  onMouseDown={() => drag.handlers.onMouseDown(l.id, d.date)}
  onMouseEnter={() => drag.handlers.onMouseEnter(l.id, d.date)}
  onMouseUp={drag.handlers.onMouseUp}
  className={`${d.isWorking && !d.isHoliday ? '' : 'bg-slate-50'} ${
    drag.isSelected(l.id, d.date) ? 'ring-2 ring-inset ring-blue-400' : ''
  }`}
>
  <input
    aria-label={`${l.label} ${d.date}`}
    defaultValue={value}
    onBlur={(ev) => onSave(l.id, d.date, ev.target.value)}
    onKeyDown={(ev) => {
      if (ev.key === 'Enter' && drag.selection && drag.selection.dates.length > 1) {
        ev.preventDefault()
        drag.applyToSelection(ev.currentTarget.value)
        drag.clear()
      }
      if (ev.key === 'Escape') drag.clear()
    }}
    className={`h-8 w-9 border-0 bg-transparent text-center text-xs outline-none focus:bg-blue-50 ${
      entry?.kind === 'PREVISIONNEL' ? 'text-slate-400 italic' : ''
    }`}
  />
</td>
```

- [ ] **Step 6: Vérifier que la grille passe toujours ses tests**

Run: `npm test -- src/components/grid/`
Expected: PASS — 12 tests

- [ ] **Step 7: Vérifier le geste à la main**

```bash
npm run dev
```

Sur `/saisie` : cliquer sur le lundi d'une ligne, glisser jusqu'au vendredi, relâcher, taper `1`, presser Entrée. Les cinq jours se remplissent.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(grille): selection par glissement et remplissage en lot"
```

---

## Task 14: CRA et transitions manuelles

**Files:**
- Create: `src/services/cra.ts`, `src/app/(app)/cra/page.tsx`, `src/app/(app)/cra/actions.ts`
- Test: `src/services/cra.test.ts`

**Interfaces:**
- Consumes: `applyTransition`, `isLocked`, `prisma`
- Produces:
  - `getOrCreateCra(userId: string, missionId: string, month: string): Promise<CraView>`
  - `transitionCra(userId: string, craId: string, t: CraTransition): Promise<CraView>`
  - `updateInvoiceTracking(userId: string, craId: string, patch: { invoiceNumber?: string | null; invoicedAt?: Date | null; paidAt?: Date | null }): Promise<CraView>`
  - `listCras(userId: string, month: string): Promise<CraView[]>`
  - `interface CraView { id: string; missionId: string; missionLabel: string; clientName: string; month: string; status: CraStatus; invoiceNumber: string | null; invoicedAt: Date | null; paidAt: Date | null }`

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/cra.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { getOrCreateCra, transitionCra, listCras, updateInvoiceTracking } from './cra'
import { InvalidTransitionError } from '@/core/cra/state-machine'

let userId = ''
let missionId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'cra@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('CRA client')
  const m = await createMission({ clientId: c.id, label: 'ITSM' })
  missionId = m.id
  await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })
})

beforeEach(async () => {
  await prisma.cra.deleteMany({ where: { userId } })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'cra@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'CRA client' } })
  await prisma.$disconnect()
})

describe('CRA', () => {
  it('crée un CRA en brouillon', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    expect(cra.status).toBe('BROUILLON')
    expect(cra.month).toBe('2026-03')
    expect(cra.missionLabel).toBe('ITSM')
  })

  it('est idempotent sur le même mois', async () => {
    const a = await getOrCreateCra(userId, missionId, '2026-03')
    const b = await getOrCreateCra(userId, missionId, '2026-03')
    expect(a.id).toBe(b.id)
  })

  it('suit le parcours manuel jusqu à VALIDE', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const envoye = await transitionCra(userId, cra.id, 'ENVOYER')
    expect(envoye.status).toBe('ENVOYE')
    const valide = await transitionCra(userId, cra.id, 'VALIDER')
    expect(valide.status).toBe('VALIDE')
  })

  it('refuse une transition interdite', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await expect(transitionCra(userId, cra.id, 'VALIDER')).rejects.toThrow(InvalidTransitionError)
  })

  it('permet de rouvrir un CRA validé', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')
    const rouvert = await transitionCra(userId, cra.id, 'ROUVRIR')
    expect(rouvert.status).toBe('BROUILLON')
  })

  it('refuse d agir sur le CRA d un autre utilisateur', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const autre = await prisma.user.create({
      data: { email: 'autre-cra@test.local', name: 'A', passwordHash: 'x' },
    })
    await expect(transitionCra(autre.id, cra.id, 'ENVOYER')).rejects.toThrow()
    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('enregistre le suivi de facturation sans rien calculer', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const r = await updateInvoiceTracking(userId, cra.id, {
      invoiceNumber: 'FA2603-0012',
      invoicedAt: new Date('2026-04-02T00:00:00Z'),
    })
    expect(r.invoiceNumber).toBe('FA2603-0012')
    expect(r.invoicedAt?.toISOString()).toBe('2026-04-02T00:00:00.000Z')
    expect(r.paidAt).toBeNull()
  })

  it('liste les CRA d un mois', async () => {
    await getOrCreateCra(userId, missionId, '2026-03')
    const list = await listCras(userId, '2026-03')
    expect(list).toHaveLength(1)
    expect(list[0]!.clientName).toBe('CRA client')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/services/cra.test.ts`
Expected: FAIL — `Failed to resolve import "./cra"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/cra.ts` :

```ts
import { prisma } from '@/db/client'
import { applyTransition, type CraTransition } from '@/core/cra/state-machine'
import type { CraStatus } from '@/core/types'

export interface CraView {
  id: string
  missionId: string
  missionLabel: string
  clientName: string
  /** 'YYYY-MM' */
  month: string
  status: CraStatus
  invoiceNumber: string | null
  invoicedAt: Date | null
  paidAt: Date | null
}

const WITH_MISSION = { mission: { include: { client: true } } } as const

type Row = {
  id: string
  missionId: string
  month: Date
  status: string
  invoiceNumber: string | null
  invoicedAt: Date | null
  paidAt: Date | null
  mission: { label: string; client: { name: string } }
}

function toView(row: Row): CraView {
  return {
    id: row.id,
    missionId: row.missionId,
    missionLabel: row.mission.label,
    clientName: row.mission.client.name,
    month: row.month.toISOString().slice(0, 7),
    status: row.status as CraStatus,
    invoiceNumber: row.invoiceNumber,
    invoicedAt: row.invoicedAt,
    paidAt: row.paidAt,
  }
}

function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`)
}

export async function getOrCreateCra(
  userId: string,
  missionId: string,
  month: string,
): Promise<CraView> {
  const row = await prisma.cra.upsert({
    where: { missionId_userId_month: { missionId, userId, month: monthStart(month) } },
    create: { missionId, userId, month: monthStart(month) },
    update: {},
    include: WITH_MISSION,
  })
  return toView(row)
}

export async function transitionCra(
  userId: string,
  craId: string,
  t: CraTransition,
): Promise<CraView> {
  // Le scope par userId est la garantie qu'on n'agit jamais sur le CRA d'un autre.
  const current = await prisma.cra.findFirstOrThrow({ where: { id: craId, userId } })
  const next = applyTransition(current.status as CraStatus, t)

  const row = await prisma.cra.update({
    where: { id: craId },
    data: { status: next },
    include: WITH_MISSION,
  })
  return toView(row)
}

export async function updateInvoiceTracking(
  userId: string,
  craId: string,
  patch: { invoiceNumber?: string | null; invoicedAt?: Date | null; paidAt?: Date | null },
): Promise<CraView> {
  await prisma.cra.findFirstOrThrow({ where: { id: craId, userId } })

  const row = await prisma.cra.update({
    where: { id: craId },
    data: patch,
    include: WITH_MISSION,
  })
  return toView(row)
}

export async function listCras(userId: string, month: string): Promise<CraView[]> {
  const rows = await prisma.cra.findMany({
    where: { userId, month: monthStart(month) },
    include: WITH_MISSION,
    orderBy: { mission: { label: 'asc' } },
  })
  return rows.map(toView)
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/services/cra.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Écrire l'écran CRA**

`src/app/(app)/cra/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { getOrCreateCra, transitionCra, updateInvoiceTracking } from '@/services/cra'
import type { CraTransition } from '@/core/cra/state-machine'

export async function openCra(formData: FormData) {
  const user = await requireUser()
  await getOrCreateCra(user.id, String(formData.get('missionId')), String(formData.get('month')))
  revalidatePath('/cra')
}

export async function moveCra(formData: FormData) {
  const user = await requireUser()
  await transitionCra(user.id, String(formData.get('craId')), String(formData.get('transition')) as CraTransition)
  revalidatePath('/cra')
  revalidatePath('/saisie')
}

export async function saveTracking(formData: FormData) {
  const user = await requireUser()
  const invoicedAt = String(formData.get('invoicedAt'))
  const paidAt = String(formData.get('paidAt'))

  await updateInvoiceTracking(user.id, String(formData.get('craId')), {
    invoiceNumber: String(formData.get('invoiceNumber')) || null,
    invoicedAt: invoicedAt ? new Date(invoicedAt) : null,
    paidAt: paidAt ? new Date(paidAt) : null,
  })
  revalidatePath('/cra')
}
```

`src/app/(app)/cra/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { prisma } from '@/db/client'
import { listCras } from '@/services/cra'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { openCra, moveCra, saveTracking } from './actions'

const LABELS: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
}

const ALL: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR']

export default async function CraPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requireUser()
  const { month: raw } = await searchParams
  const month = raw ?? new Date().toISOString().slice(0, 7)

  const cras = await listCras(user.id, month)
  const missions = await prisma.mission.findMany({
    where: { archived: false },
    include: { client: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">CRA · {month}</h1>

      <form action={openCra} className="mb-8 flex items-end gap-2">
        <input type="hidden" name="month" value={month} />
        <select name="missionId" required className="rounded border px-2 py-1">
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.client.name} · {m.label}
            </option>
          ))}
        </select>
        <button className="rounded bg-slate-900 px-3 py-1 text-white">Ouvrir un CRA</button>
      </form>

      {cras.map((cra) => (
        <section key={cra.id} className="mb-6 rounded border p-4">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-medium">
              {cra.clientName} · {cra.missionLabel}
            </h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{cra.status}</span>
          </div>

          <div className="mb-4 flex gap-2">
            {ALL.filter((t) => canTransition(cra.status, t)).map((t) => (
              <form key={t} action={moveCra}>
                <input type="hidden" name="craId" value={cra.id} />
                <input type="hidden" name="transition" value={t} />
                <button className="rounded border px-3 py-1 text-sm">{LABELS[t]}</button>
              </form>
            ))}
          </div>

          <form action={saveTracking} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="craId" value={cra.id} />
            <label className="flex flex-col text-sm">
              N° de facture
              <input
                name="invoiceNumber"
                defaultValue={cra.invoiceNumber ?? ''}
                className="rounded border px-2 py-1"
              />
            </label>
            <label className="flex flex-col text-sm">
              Facturé le
              <input
                name="invoicedAt"
                type="date"
                defaultValue={cra.invoicedAt?.toISOString().slice(0, 10) ?? ''}
                className="rounded border px-2 py-1"
              />
            </label>
            <label className="flex flex-col text-sm">
              Payé le
              <input
                name="paidAt"
                type="date"
                defaultValue={cra.paidAt?.toISOString().slice(0, 10) ?? ''}
                className="rounded border px-2 py-1"
              />
            </label>
            <button className="rounded border px-3 py-1 text-sm">Enregistrer le suivi</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Champs de suivi uniquement — l’application ne produit aucune facture.
          </p>
        </section>
      ))}

      {cras.length === 0 && <p className="text-slate-500">Aucun CRA ouvert sur ce mois.</p>}
    </main>
  )
}
```

- [ ] **Step 6: Vérifier le verrouillage de bout en bout**

```bash
npm run dev
```

Sur `/cra` : ouvrir un CRA, le marquer envoyé puis validé. Revenir sur `/saisie` du même mois et tenter une saisie sur une ligne de cette mission — le bandeau doit afficher « Le CRA de ce mois est validé. Rouvrez-le pour modifier la saisie. » Rouvrir le CRA, la saisie redevient possible.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(cra): statuts manuels, verrouillage et suivi de facturation"
```

---

## Task 15: Déploiement Docker et installation locale

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: tout ce qui précède
- Produces: une image démarrable et un chemin d'installation local documenté

- [ ] **Step 1: Écrire le Dockerfile**

`.dockerignore` :

```
node_modules
.next
.git
*.db
.env
```

`Dockerfile` :

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/scripts ./scripts
EXPOSE 3000
CMD ["node", "server.js"]
```

`docker-compose.yml` :

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: cra
      POSTGRES_PASSWORD: cra
      POSTGRES_DB: cra
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cra"]
      interval: 5s
      retries: 10

  app:
    build: .
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://cra:cra@db:5432/cra
      AUTH_SECRET: ${AUTH_SECRET:?definir AUTH_SECRET}
      AUTH_TRUST_HOST: "true"
    ports:
      - "3000:3000"

volumes:
  db-data:
```

- [ ] **Step 2: Ajouter le script d'installation locale**

Ajouter à `package.json` :

```json
{
  "scripts": {
    "setup:local": "node scripts/set-db-provider.mjs sqlite && prisma db push && prisma generate"
  }
}
```

- [ ] **Step 3: Écrire le README**

`README.md` :

````markdown
# CRA

Application de compte-rendu d'activité autoportante. Elle ne facture pas :
son rôle s'arrête au CRA validé.

## Serveur (Docker)

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse
```

L'application écoute sur http://localhost:3000

## Poste local (sans Docker)

Prérequis : Node.js 20 ou plus.

```bash
npm install
echo 'DATABASE_URL="file:./cra.db"' > .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
npm run setup:local
npm run build
node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse
npm start
```

La base est le fichier `prisma/cra.db` — le sauvegarder, c'est sauvegarder
toutes les données.

## Développement

```bash
npm run db:pg
npx prisma migrate dev
npm run dev
npm test
```

## Portabilité SQLite / Postgres

Le schéma reste dans l'intersection des deux moteurs :

- pas d'enum Prisma — des `String` et des unions TypeScript dans `src/core/types.ts` ;
- pas de décimal — entiers partout (minutes, centièmes de jour, centimes) ;
- pas de tableau, pas de requête fine sur du JSON.

La suite d'intégration tourne contre les deux moteurs. Ne pas contourner
ces règles : elles conditionnent le mode local et l'empaquetage à venir.
````

- [ ] **Step 4: Vérifier la construction Docker**

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse123
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/login
```

Expected: `200`

- [ ] **Step 5: Vérifier l'installation locale SQLite**

```bash
docker compose down
rm -rf .next
echo 'DATABASE_URL="file:./cra-local.db"' > .env.local.test
env $(cat .env.local.test) AUTH_SECRET=test npm run setup:local
env $(cat .env.local.test) AUTH_SECRET=test npm run build
```

Expected: la construction aboutit. Restaurer ensuite le provider Postgres :

```bash
node scripts/set-db-provider.mjs postgresql
rm -f .env.local.test prisma/cra-local.db
```

- [ ] **Step 6: Lancer toute la suite**

Run: `npm test`
Expected: PASS — l'intégralité des tests des tâches 1 à 14

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(deploy): image docker, installation locale sqlite et documentation"
```

---

## Task 16: Jours fériés français

Réalisable dès que la tâche 8 est terminée. Placée en fin de plan parce
qu'elle n'en bloque aucune autre.

**Files:**
- Create: `src/core/calendar/holidays-fr.ts`
- Modify: `src/services/settings.ts`, `src/app/(app)/admin/saisie/page.tsx`, `src/app/(app)/admin/saisie/actions.ts`
- Test: `src/core/calendar/holidays-fr.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `easterSunday(year: number): string` — 'YYYY-MM-DD'
  - `frenchHolidays(year: number): Array<{ date: string; label: string }>`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/calendar/holidays-fr.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { easterSunday, frenchHolidays } from './holidays-fr'

describe('easterSunday', () => {
  it('calcule Pâques', () => {
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
    expect(easterSunday(2024)).toBe('2024-03-31')
  })
})

describe('frenchHolidays', () => {
  it('renvoie onze jours fériés', () => {
    expect(frenchHolidays(2026)).toHaveLength(11)
  })

  it('contient les fériés à date fixe', () => {
    const dates = frenchHolidays(2026).map((h) => h.date)
    for (const d of [
      '2026-01-01',
      '2026-05-01',
      '2026-05-08',
      '2026-07-14',
      '2026-08-15',
      '2026-11-01',
      '2026-11-11',
      '2026-12-25',
    ]) {
      expect(dates).toContain(d)
    }
  })

  it('contient les fériés mobiles', () => {
    const dates = frenchHolidays(2026).map((h) => h.date)
    expect(dates).toContain('2026-04-06') // lundi de Pâques
    expect(dates).toContain('2026-05-14') // Ascension
    expect(dates).toContain('2026-05-25') // lundi de Pentecôte
  })

  it('renvoie les dates triées', () => {
    const dates = frenchHolidays(2026).map((h) => h.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('nomme chaque férié', () => {
    const noel = frenchHolidays(2026).find((h) => h.date === '2026-12-25')
    expect(noel!.label).toBe('Noël')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/core/calendar/holidays-fr.test.ts`
Expected: FAIL — `Failed to resolve import "./holidays-fr"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/calendar/holidays-fr.ts` :

```ts
function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/** Algorithme de Meeus/Jones/Butcher, calendrier grégorien. */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return iso(new Date(Date.UTC(year, month - 1, day)))
}

export function frenchHolidays(year: number): Array<{ date: string; label: string }> {
  const easter = easterSunday(year)
  const pad = (n: number) => String(n).padStart(2, '0')
  const fixed = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`

  const all = [
    { date: fixed(1, 1), label: "Jour de l'an" },
    { date: addDays(easter, 1), label: 'Lundi de Pâques' },
    { date: fixed(5, 1), label: 'Fête du Travail' },
    { date: fixed(5, 8), label: 'Victoire 1945' },
    { date: addDays(easter, 39), label: 'Ascension' },
    { date: addDays(easter, 50), label: 'Lundi de Pentecôte' },
    { date: fixed(7, 14), label: 'Fête nationale' },
    { date: fixed(8, 15), label: 'Assomption' },
    { date: fixed(11, 1), label: 'Toussaint' },
    { date: fixed(11, 11), label: 'Armistice 1918' },
    { date: fixed(12, 25), label: 'Noël' },
  ]

  return all.sort((x, y) => x.date.localeCompare(y.date))
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/core/calendar/holidays-fr.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Précharger les fériés dans les réglages**

Dans `src/services/settings.ts`, ajouter l'import et la fonction :

```ts
import { frenchHolidays } from '@/core/calendar/holidays-fr'

/** Recharge les fériés français sur une plage d'années, en remplaçant les existants. */
export async function loadFrenchHolidays(fromYear: number, toYear: number): Promise<AppSettings> {
  const dates: string[] = []
  for (let y = fromYear; y <= toYear; y++) {
    dates.push(...frenchHolidays(y).map((h) => h.date))
  }
  return updateSettings({ holidays: dates })
}
```

Dans `src/app/(app)/admin/saisie/actions.ts`, ajouter :

```ts
import { loadFrenchHolidays } from '@/services/settings'

export async function reloadHolidays() {
  await requireUser()
  const y = new Date().getUTCFullYear()
  await loadFrenchHolidays(y - 1, y + 2)
  revalidatePath('/admin/saisie')
}
```

Dans `src/app/(app)/admin/saisie/page.tsx`, ajouter l'import `reloadHolidays` et ce bloc juste avant le bouton « Enregistrer » — **hors du `<form action={saveSettings}>`**, deux formulaires ne pouvant pas être imbriqués :

```tsx
<section className="border-t pt-4">
  <h2 className="mb-2 font-medium">Jours fériés</h2>
  <p className="mb-2 text-sm text-slate-600">
    {s.holidays.length} jour(s) férié(s) enregistré(s). Ils sont grisés dans la grille
    mais restent saisissables.
  </p>
  <form action={reloadHolidays}>
    <button className="rounded border px-3 py-1 text-sm">
      Charger les fériés français (année précédente à N+2)
    </button>
  </form>
</section>
```

- [ ] **Step 6: Vérifier l'écran**

```bash
npm run dev
```

Sur `/admin/saisie` : cliquer sur le bouton de chargement. Le compteur passe à 44 fériés. Sur `/saisie/2026-05`, le 1er et le 8 mai apparaissent grisés — et restent saisissables.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(calendrier): jours feries francais precharges"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche |
|---|---|
| Cœur pur, sans Prisma ni Next | 1–5, vérifié en 5 étape 5 |
| Stockage en minutes, `heuresParJour` réglable et surchargeable | 1, 8, 9 |
| Créneaux configurables, franchissement de minuit | 2, 8 |
| Contrôle de capacité en trois modes | 3, 8, 11 |
| Engagement par ligne de prestation | 4, 9, 12 |
| Machine à états du CRA, transitions manuelles | 5, 14 |
| Verrouillage après validation | 5, 11, 14 |
| Portabilité SQLite/Postgres | 6, 15 |
| Aucun enum, aucun décimal | 6, vérifié en 6 étape 8 |
| Auth et scope par utilisateur | 7, et chaque service |
| Provisions multi-consultants (`Assignment`, clé `(user, ligne, date)`) | 6, 9, 11 |
| Week-ends et fériés grisés mais saisissables | 10, 12 |
| Calendrier des fériés français préchargé | 16 |
| Grille : une ligne = une ligne de prestation | 12 |
| Ligne de totaux, signalement du dépassement | 12 |
| Bandeau d'engagement pendant la saisie | 12 |
| Sélection par glissement | 13 |
| Champs de suivi de facturation, aucun calcul | 14 |
| Sortie `standalone`, Docker, local sans Docker | 1, 15 |

**Hors périmètre de ce lot, conformément à la spec :** prévisionnel et plan de charge (lot 1), surface mobile et PWA (lot 1), connecteur Dolibarr (lot 2), PDF et signature (lot 3), automatisations n8n (lot 4), empaquetage Tauri (lot 5).

Le champ `TimeEntry.kind` accepte `PREVISIONNEL` dès le lot 0 et la grille affiche déjà ces cellules en italique grisé, mais la planification à venir, la validation des jours passés et le calcul du reste à planifier relèvent du lot 1.

**Une exigence de la spec est sciemment reportée :** les **créneaux autorisés par ligne** (§4 de la spec — la ligne « Nuit » n'accepte que le créneau Nuit). Le champ `allowedSlotIds` est présent en base dès la tâche 6 et exposé dans `LineForGrid` en tâche 9, mais aucun contrôle ne s'applique : la grille du lot 0 saisit à la journée, `slotId` vaut toujours `null`, et il n'y a donc rien à restreindre. Le contrôle arrive avec la saisie par créneau, en lot 1, en même temps que les blocs d'agenda qui en dépendent.
