# Lot 1c — Vue calendrier et saisie cyclique · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une seule vue mensuelle qui fonctionne au pouce comme à la souris — sept colonnes, une case qui change d'état au clic — sans qu'aucune règle métier ne soit réécrite dans la vue.

**Architecture:** La cinématique est une **fonction pure de `src/core/`** : on lui donne un état, elle rend le suivant. Le composant ne fait que l'appeler. L'écriture passe par un service qui remplace la case en bloc, réutilise `checkCapacity` et `isLocked`, et fige le facteur de conversion comme le lot 1d l'exige. La vue tableau du lot 1a n'est pas touchée : elle devient la seconde vue.

**Tech Stack:** Next.js 15 · TypeScript · Prisma 6 · SQLite en développement · Vitest · happy-dom

**Spec :** `docs/superpowers/specs/2026-08-15-lot-1c-calendrier-saisie-cyclique-design.md`

## Global Constraints

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.**
- **Aucun enum Prisma, aucun décimal persisté.** Entiers partout : temps en minutes, jours en centièmes, montants en centimes.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus.**
- **Aucune page ni server action n'interroge Prisma directement** en court-circuitant la couche service.
- **Une saisie porte son propre facteur de conversion, figé à l'écriture** ; aucun calcul ne lit `Settings.minutesParJour` pour réinterpréter une saisie existante.
- **La conversion prévisionnel → réalisé n'est jamais automatique.**
- **Un mois dont le CRA est validé refuse toute écriture** — cinématique, remplissage et vidage compris.
- **Aucune règle métier n'est réimplémentée dans les composants du calendrier** : ni capacité, ni engagement, ni conversion d'unité. Ils appellent `core/` ou reçoivent le résultat d'un service.
- **La vue tableau du lot 1a est conservée.** Les 307 tests verts de la suite actuelle restent verts : aucun n'est supprimé ni affaibli.
- `vitest.config.ts` est en `fileParallelism: false` — ne pas le modifier.
- Tests de composants : `// @vitest-environment happy-dom` en première ligne, `afterEach(cleanup)` explicite.
- **Ne jamais exécuter `npx next build`** : le serveur de développement du porteur du produit tourne sur cet arbre.
- Français pour les chaînes visibles, anglais pour le code et les messages de commit.
- Le lot 1e (système de design) n'est pas livré : ce plan reste sur les classes Tailwind utilitaires déjà employées (`slate`, `amber`), qu'un passage ultérieur remplacera par les jetons du système.

---

## Interfaces existantes

```ts
// src/core/types.ts
type TimeEntryKind = 'REALISE' | 'PREVISIONNEL'
type DisplayUnit = 'JOUR' | 'DEMI_JOUR' | 'HEURE'
type CraStatus = 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'

// src/core/time/slots.ts
interface Slot { id: string; label: string; startMinute: number; endMinute: number; centiemes: number }
crossesMidnight(slot: Slot): boolean

// src/core/time/units.ts
minutesToCentiemes(minutes: number, minutesParJour: number): number
centiemesToMinutes(centiemes: number, minutesParJour: number): number
formatQuantity(minutes: number, unit: DisplayUnit, minutesParJour: number): string
parseQuantity(input: string, unit: DisplayUnit, minutesParJour: number): number | null

// src/core/month/build.ts
interface MonthDay { date: string; dayOfWeek: number; isWorking: boolean; isHoliday: boolean }
buildMonthDays(month: string, workingDays: number[], holidays: string[]): MonthDay[]
shiftMonth(month: string, delta: number): string

// src/core/capacity/check.ts
type CapacityVerdict = { ok: true } | { ok: false; severity: 'warn' | 'block'; totalMinutes: number; capacityMinutes: number }
checkCapacity(args: { existingMinutes; addedMinutes; capacityMinutes; mode: CapacityMode }): CapacityVerdict

// src/core/cra/state-machine.ts
isLocked(status: CraStatus): boolean

// src/core/rates/cascade.ts
resolveMinutesParJour(levels: { line?; mission?; client?; global: number }): number

// src/services/settings.ts
DEFAULT_SLOTS: Slot[]   // matin 540→780 (50c), apres-midi 840→1080 (50c), nuit 1320→360 (50c)
interface AppSettings { minutesParJour; capacityMode; capacityCentiemes; workingDays; slots; holidays; defaultDisplayUnit; defaultEngagementSource; objectifCaExerciceCents; debutExerciceMois }
getSettings(): Promise<AppSettings>
updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>

// src/services/missions.ts
interface LineForGrid { id; label; missionLabel; clientName; displayUnit: DisplayUnit; minutesParJour: number; soldCentiemes: number; allowedSlotIds: string[] }
listActiveLines(userId: string): Promise<LineForGrid[]>
createLine(args: { missionId; userId; label; soldCentiemes; tjmCents; displayUnit?; minutesParJour?; allowedSlotIds? }): Promise<{ id: string }>
createMission(args: { clientId; label; minutesParJour? }): Promise<{ id: string }>
// src/services/clients.ts
createClient(name: string, minutesParJour?: number | null): Promise<{ id: string; name: string }>

// src/services/time-entries.ts
interface MonthEntry { id; lineId; date: string; minutes: number; kind: TimeEntryKind; slotId: string; minutesParJour: number }
interface CapacityWarning { totalMinutes: number; capacityMinutes: number }
type SaveResult =
  | { ok: true; minutes: number; warning?: CapacityWarning }
  | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number }
  | { ok: false; reason: 'VERROUILLE' }
  | { ok: false; reason: 'NON_AFFECTE' }
getMonthEntries(userId: string, month: string): Promise<MonthEntry[]>
getLineEngagementTotals(userId: string, lineIds: string[]): Promise<Record<string, LineEngagementTotals>>
saveEntry(args: { userId; lineId; date; minutes; kind; slotId? }): Promise<SaveResult>
toIsoDate(d: Date): string

// src/components/grid/useDragSelect.ts   — générique, réutilisé tel quel par le calendrier
interface DragSelection { lineId: string; dates: string[] }
useDragSelect(onApply: (sel: DragSelection, raw: string) => void): {
  selection: DragSelection | null
  isSelected(lineId: string, date: string): boolean
  handlers: { onMouseDown(lineId, date): void; onMouseEnter(lineId, date): void; onMouseUp(): void }
  applyToSelection(raw: string): void
  clear(): void
}
```

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/core/saisie/cycle.ts` | La cinématique, pure : état → état suivant, créneaux proposés |
| `src/core/saisie/cell-state.ts` | Saisies ↔ état de case, pur |
| `src/core/saisie/report.ts` | Comptes rendus de remplissage et de vidage, purs |
| `src/core/saisie/colors.ts` | Couleur stable d'une prestation |
| `src/core/saisie/selection.ts` | Client → Mission → Prestation, pur |
| `src/core/month/weeks.ts` | Découpage d'un mois en semaines de sept cases |
| `src/services/cells.ts` | Application d'un état de case en base |
| `src/services/month-fill.ts` | Remplir / vider le mois d'une prestation |
| `src/services/time-entries.ts` | *(modifié)* `resolveLineMinutesParJour` exportée |
| `src/services/missions.ts` | *(modifié)* `LineForGrid.minutesParJour` suit la cascade complète |
| `src/components/calendar/MonthCalendar.tsx` | La vue calendrier |
| `src/components/calendar/CellForm.tsx` | Le formulaire de valeur libre |
| `src/components/calendar/useLongPress.ts` | Appui long |
| `src/components/calendar/LineSelector.tsx` | Les trois sélecteurs |
| `src/components/calendar/selection-storage.ts` | Mémorisation de la dernière sélection |
| `src/app/(app)/saisie/[month]/SaisieClient.tsx` | *(réécrit)* deux vues, deux boutons, deux portées |
| `src/app/(app)/saisie/[month]/actions.ts` | *(modifié)* trois server actions de plus |
| `src/app/(app)/saisie/[month]/page.tsx` | *(modifié)* passe les créneaux et la date du jour |
| `public/manifest.webmanifest`, `public/icon.svg`, `public/sw.js` | PWA |
| `src/components/pwa/RegisterServiceWorker.tsx` | Enregistrement du service worker |

**Dépendances :** 1, 2, 5, 9 (partie `core/`) et 11 sont indépendantes. 3 consomme 1 et 2. 4 consomme 2 et 3. 6 consomme 1, 2 et 5. 7 consomme 1, 2 et 6. 8 consomme 5, 6 et 7. 10 consomme 3, 4, 6, 7, 8 et 9.

---

## Task 1: La cinématique, pure

**Files:** Create `src/core/saisie/cycle.ts`, `src/core/saisie/cycle.test.ts`

**Interfaces:**
- Consumes: `Slot`, `crossesMidnight` de `src/core/time/slots.ts` ; `DisplayUnit` de `src/core/types.ts`
- Produces:
  - `type CellState = { kind: 'VIDE' } | { kind: 'JOURNEE' } | { kind: 'DEMI'; slotId: string } | { kind: 'LIBRE'; minutes: number; slotId: string; eclatee: boolean }`
  - `type CycleStep = { action: 'ETAT'; state: CellState } | { action: 'FORMULAIRE' }`
  - `interface CycleOptions { demiSlotIds: readonly string[]; displayUnit: DisplayUnit }`
  - `nextCellState(current: CellState, options: CycleOptions): CycleStep`
  - `cycleSlotIds(slots: readonly Slot[], allowedSlotIds: readonly string[]): string[]`
  - `isSlotAllowed(slotId: string, allowedSlotIds: readonly string[]): boolean`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/saisie/cycle.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { nextCellState, cycleSlotIds, isSlotAllowed } from './cycle'
import type { CellState, CycleOptions } from './cycle'
import type { Slot } from '../time/slots'

const SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

const JOUR: CycleOptions = { demiSlotIds: ['matin', 'apres-midi'], displayUnit: 'JOUR' }

/** Enchaîne `n` clics et rend les états traversés. Échoue si un clic ouvre le formulaire. */
function clics(depart: CellState, n: number, options: CycleOptions): CellState[] {
  const parcours: CellState[] = []
  let courant = depart
  for (let i = 0; i < n; i++) {
    const step = nextCellState(courant, options)
    if (step.action !== 'ETAT') throw new Error(`clic ${i + 1} : formulaire au lieu d'un état`)
    courant = step.state
    parcours.push(courant)
  }
  return parcours
}

describe('nextCellState', () => {
  it('avance vide → 1 jour → ½ matin → ½ après-midi → vide', () => {
    expect(clics({ kind: 'VIDE' }, 4, JOUR)).toEqual([
      { kind: 'JOURNEE' },
      { kind: 'DEMI', slotId: 'matin' },
      { kind: 'DEMI', slotId: 'apres-midi' },
      { kind: 'VIDE' },
    ])
  })

  it('ramène la case à son état initial au bout de quatre clics', () => {
    const parcours = clics({ kind: 'VIDE' }, 4, JOUR)
    expect(parcours[parcours.length - 1]).toEqual({ kind: 'VIDE' })
  })

  // Le test qui protège contre la perte silencieuse : sans lui, un clic
  // distrait ramènerait trois heures à zéro, et le clic suivant les
  // remplacerait par une journée entière.
  it('ne cycle pas sur une case à valeur libre : elle rouvre son formulaire', () => {
    const libre: CellState = { kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false }
    expect(nextCellState(libre, JOUR)).toEqual({ action: 'FORMULAIRE' })
  })

  it('rouvre le formulaire d une journée éclatée en plusieurs créneaux', () => {
    const eclatee: CellState = { kind: 'LIBRE', minutes: 480, slotId: '', eclatee: true }
    expect(nextCellState(eclatee, JOUR)).toEqual({ action: 'FORMULAIRE' })
  })

  it('ouvre directement le formulaire sur une prestation facturée à l heure', () => {
    const heure: CycleOptions = { ...JOUR, displayUnit: 'HEURE' }
    // Aucun état de départ ne doit produire « 1 jour » : ça n'y veut rien dire.
    expect(nextCellState({ kind: 'VIDE' }, heure)).toEqual({ action: 'FORMULAIRE' })
    expect(nextCellState({ kind: 'JOURNEE' }, heure)).toEqual({ action: 'FORMULAIRE' })
    expect(nextCellState({ kind: 'DEMI', slotId: 'matin' }, heure)).toEqual({ action: 'FORMULAIRE' })
  })

  it('se réduit à vide → 1 jour → vide quand aucun créneau n est proposé', () => {
    const sansDemi: CycleOptions = { demiSlotIds: [], displayUnit: 'JOUR' }
    expect(clics({ kind: 'VIDE' }, 2, sansDemi)).toEqual([{ kind: 'JOURNEE' }, { kind: 'VIDE' }])
  })

  it('n offre que le créneau autorisé quand la prestation en restreint un seul', () => {
    const unSeul: CycleOptions = { demiSlotIds: ['matin'], displayUnit: 'JOUR' }
    expect(clics({ kind: 'VIDE' }, 3, unSeul)).toEqual([
      { kind: 'JOURNEE' },
      { kind: 'DEMI', slotId: 'matin' },
      { kind: 'VIDE' },
    ])
  })

  it('vide une demi-journée posée sur un créneau hors du cycle', () => {
    // Cas réel : la saisie a été faite au formulaire, ou la restriction a été
    // ajoutée après coup. Le créneau est traité comme le dernier du cycle.
    expect(nextCellState({ kind: 'DEMI', slotId: 'nuit' }, JOUR)).toEqual({
      action: 'ETAT',
      state: { kind: 'VIDE' },
    })
  })

  it('accepte une prestation en demi-journées comme une prestation en jours', () => {
    const demiJour: CycleOptions = { ...JOUR, displayUnit: 'DEMI_JOUR' }
    expect(nextCellState({ kind: 'VIDE' }, demiJour)).toEqual({
      action: 'ETAT',
      state: { kind: 'JOURNEE' },
    })
  })
})

describe('cycleSlotIds', () => {
  it('propose les deux moitiés de la journée et écarte la nuit', () => {
    // Un créneau qui franchit minuit s'étale sur deux jours : il ne peut pas
    // être l'une des deux moitiés de celui-ci.
    expect(cycleSlotIds(SLOTS, [])).toEqual(['matin', 'apres-midi'])
  })

  it('respecte la restriction portée par la prestation', () => {
    expect(cycleSlotIds(SLOTS, ['matin'])).toEqual(['matin'])
  })

  it('rend une liste vide quand seule la nuit est autorisée', () => {
    expect(cycleSlotIds(SLOTS, ['nuit'])).toEqual([])
  })

  it('garde l ordre des créneaux tel que les réglages les déclarent', () => {
    const inverses = [SLOTS[1]!, SLOTS[0]!, SLOTS[2]!]
    expect(cycleSlotIds(inverses, [])).toEqual(['apres-midi', 'matin'])
  })

  it('rend une liste vide sans aucun créneau réglé', () => {
    expect(cycleSlotIds([], [])).toEqual([])
  })
})

describe('isSlotAllowed', () => {
  it('autorise tout quand la prestation ne restreint rien', () => {
    expect(isSlotAllowed('nuit', [])).toBe(true)
  })

  it('autorise un créneau listé', () => {
    expect(isSlotAllowed('matin', ['matin', 'apres-midi'])).toBe(true)
  })

  it('refuse un créneau hors de la liste', () => {
    expect(isSlotAllowed('nuit', ['matin', 'apres-midi'])).toBe(false)
  })

  it('autorise toujours la journée entière, qui ne porte aucun créneau', () => {
    expect(isSlotAllowed('', ['matin'])).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/saisie/cycle.test.ts`
Expected: FAIL — `Failed to resolve import "./cycle"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/saisie/cycle.ts` :

```ts
import { crossesMidnight } from '../time/slots'
import type { Slot } from '../time/slots'
import type { DisplayUnit } from '../types'

/**
 * Les quatre états qu'une case peut porter.
 *
 * `LIBRE` n'appartient pas au cycle : c'est le fourre-tout de tout ce que la
 * cinématique n'a pas produit — durée en heures, créneau hors des trois
 * prédéfinis, journée éclatée en plusieurs créneaux. Le distinguer est la
 * seule façon d'empêcher un clic distrait d'écraser une saisie fine.
 */
export type CellState =
  | { kind: 'VIDE' }
  | { kind: 'JOURNEE' }
  | { kind: 'DEMI'; slotId: string }
  | {
      kind: 'LIBRE'
      minutes: number
      /** '' = journée entière */
      slotId: string
      /** vrai quand la case agrège plusieurs saisies */
      eclatee: boolean
    }

export type CycleStep = { action: 'ETAT'; state: CellState } | { action: 'FORMULAIRE' }

export interface CycleOptions {
  /** créneaux de demi-journée proposés, dans l'ordre du cycle */
  demiSlotIds: readonly string[]
  displayUnit: DisplayUnit
}

/** Une liste de créneaux autorisés vide vaut « tous ». */
export function isSlotAllowed(slotId: string, allowedSlotIds: readonly string[]): boolean {
  if (slotId === '') return true
  return allowedSlotIds.length === 0 || allowedSlotIds.includes(slotId)
}

/**
 * Créneaux que la cinématique d'une prestation propose, dans l'ordre.
 *
 * Un créneau qui franchit minuit est écarté : il s'étale sur deux jours, il ne
 * peut donc pas être l'une des deux moitiés de celui qu'on est en train de
 * saisir. Il reste atteignable par le formulaire.
 */
export function cycleSlotIds(
  slots: readonly Slot[],
  allowedSlotIds: readonly string[],
): string[] {
  return slots
    .filter((s) => !crossesMidnight(s))
    .filter((s) => isSlotAllowed(s.id, allowedSlotIds))
    .map((s) => s.id)
}

/**
 * Le cœur du lot : un clic fait avancer la case d'un cran.
 *
 * Pure et sans DOM — le composant ne fait que l'appeler. C'est ce qui permet
 * de tester la cinématique entière sans monter une seule case à l'écran.
 */
export function nextCellState(current: CellState, options: CycleOptions): CycleStep {
  // « 1 jour » ne veut rien dire sur une prestation facturée à l'heure.
  if (options.displayUnit === 'HEURE') return { action: 'FORMULAIRE' }

  // Une valeur libre ne cycle pas : elle rouvre son formulaire.
  if (current.kind === 'LIBRE') return { action: 'FORMULAIRE' }

  if (current.kind === 'VIDE') return { action: 'ETAT', state: { kind: 'JOURNEE' } }

  if (current.kind === 'JOURNEE') {
    const premier = options.demiSlotIds[0]
    return premier === undefined
      ? { action: 'ETAT', state: { kind: 'VIDE' } }
      : { action: 'ETAT', state: { kind: 'DEMI', slotId: premier } }
  }

  // DEMI : on avance dans les créneaux proposés puis on revient à vide. Un
  // créneau absent de la liste — restriction ajoutée après coup, saisie faite
  // au formulaire — est traité comme le dernier du cycle.
  const rang = options.demiSlotIds.indexOf(current.slotId)
  const suivant = rang === -1 ? undefined : options.demiSlotIds[rang + 1]
  return suivant === undefined
    ? { action: 'ETAT', state: { kind: 'VIDE' } }
    : { action: 'ETAT', state: { kind: 'DEMI', slotId: suivant } }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/saisie/cycle.test.ts`
Expected: PASS — 18 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer brièvement le garde `current.kind === 'LIBRE'` par un `return { action: 'ETAT', state: { kind: 'VIDE' } }` et confirmer que « ne cycle pas sur une case à valeur libre » échoue. Restaurer ensuite.

- [ ] **Step 6: Commit**

```bash
git add src/core/saisie/
git commit -m "feat(core): cinematique de saisie pure, etat par etat"
```

---

## Task 2: Lecture et écriture d'une case

**Files:** Create `src/core/saisie/cell-state.ts`, `src/core/saisie/cell-state.test.ts`

**Interfaces:**
- Consumes: `CellState` de la tâche 1, `Slot`, `centiemesToMinutes`
- Produces:
  - `interface CellEntry { minutes: number; slotId: string }`
  - `interface DatedCellEntry extends CellEntry { date: string; lineId: string }`
  - `interface CellContext { minutesParJour: number; slots: readonly Slot[] }`
  - `readCellState(entries: readonly CellEntry[], ctx: CellContext): CellState`
  - `cellStateToWrite(state: CellState, ctx: CellContext): CellEntry[]` — lève sur un créneau inconnu
  - `buildCellStates(entries: readonly DatedCellEntry[], lineId: string, ctx: CellContext): Map<string, CellState>`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/saisie/cell-state.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { readCellState, cellStateToWrite, buildCellStates } from './cell-state'
import type { CellContext } from './cell-state'
import type { Slot } from '../time/slots'

const SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

const CTX: CellContext = { minutesParJour: 480, slots: SLOTS }

describe('readCellState', () => {
  it('lit une case sans saisie comme vide', () => {
    expect(readCellState([], CTX)).toEqual({ kind: 'VIDE' })
  })

  it('ignore une saisie à zéro minute', () => {
    expect(readCellState([{ minutes: 0, slotId: '' }], CTX)).toEqual({ kind: 'VIDE' })
  })

  it('lit une journée pleine sans créneau comme JOURNEE', () => {
    expect(readCellState([{ minutes: 480, slotId: '' }], CTX)).toEqual({ kind: 'JOURNEE' })
  })

  it('lit une journée pleine à facteur court comme JOURNEE', () => {
    const court: CellContext = { minutesParJour: 432, slots: SLOTS }
    expect(readCellState([{ minutes: 432, slotId: '' }], court)).toEqual({ kind: 'JOURNEE' })
  })

  it('lit la valeur nominale d un créneau comme une demi-journée', () => {
    expect(readCellState([{ minutes: 240, slotId: 'matin' }], CTX)).toEqual({
      kind: 'DEMI',
      slotId: 'matin',
    })
  })

  it('lit une durée hors nominal sur un créneau comme une valeur libre', () => {
    expect(readCellState([{ minutes: 180, slotId: 'matin' }], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 180,
      slotId: 'matin',
      eclatee: false,
    })
  })

  it('lit une durée partielle sans créneau comme une valeur libre', () => {
    expect(readCellState([{ minutes: 180, slotId: '' }], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 180,
      slotId: '',
      eclatee: false,
    })
  })

  it('lit une saisie sur un créneau inconnu comme une valeur libre', () => {
    expect(readCellState([{ minutes: 240, slotId: 'inconnu' }], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 240,
      slotId: 'inconnu',
      eclatee: false,
    })
  })

  // Deux demi-journées font bien 480 minutes : les lire comme JOURNEE ferait
  // du clic suivant un remplacement de deux saisies par une seule, en silence.
  it('lit deux créneaux du même jour comme une valeur libre éclatée', () => {
    expect(
      readCellState(
        [
          { minutes: 240, slotId: 'matin' },
          { minutes: 240, slotId: 'apres-midi' },
        ],
        CTX,
      ),
    ).toEqual({ kind: 'LIBRE', minutes: 480, slotId: '', eclatee: true })
  })

  it('ne compte pas les saisies à zéro dans le total d une case éclatée', () => {
    const etat = readCellState(
      [
        { minutes: 240, slotId: 'matin' },
        { minutes: 0, slotId: 'apres-midi' },
      ],
      CTX,
    )
    expect(etat).toEqual({ kind: 'DEMI', slotId: 'matin' })
  })
})

describe('cellStateToWrite', () => {
  it('n écrit rien pour une case vide', () => {
    expect(cellStateToWrite({ kind: 'VIDE' }, CTX)).toEqual([])
  })

  it('écrit une journée entière sans créneau', () => {
    expect(cellStateToWrite({ kind: 'JOURNEE' }, CTX)).toEqual([{ minutes: 480, slotId: '' }])
  })

  it('écrit la valeur nominale du créneau pour une demi-journée', () => {
    expect(cellStateToWrite({ kind: 'DEMI', slotId: 'matin' }, CTX)).toEqual([
      { minutes: 240, slotId: 'matin' },
    ])
  })

  it('écrit une demi-journée au facteur figé de la prestation', () => {
    const court: CellContext = { minutesParJour: 420, slots: SLOTS }
    expect(cellStateToWrite({ kind: 'DEMI', slotId: 'apres-midi' }, court)).toEqual([
      { minutes: 210, slotId: 'apres-midi' },
    ])
  })

  it('écrit une valeur libre telle quelle, créneau compris', () => {
    expect(
      cellStateToWrite({ kind: 'LIBRE', minutes: 180, slotId: 'nuit', eclatee: false }, CTX),
    ).toEqual([{ minutes: 180, slotId: 'nuit' }])
  })

  it('remplace une case éclatée par une seule saisie', () => {
    expect(
      cellStateToWrite({ kind: 'LIBRE', minutes: 480, slotId: '', eclatee: true }, CTX),
    ).toEqual([{ minutes: 480, slotId: '' }])
  })

  it('lève sur un créneau inconnu plutôt que d écrire une durée arbitraire', () => {
    expect(() => cellStateToWrite({ kind: 'DEMI', slotId: 'inconnu' }, CTX)).toThrow()
  })

  it('fait l aller-retour sans perte pour les états du cycle', () => {
    for (const etat of [
      { kind: 'JOURNEE' } as const,
      { kind: 'DEMI', slotId: 'matin' } as const,
      { kind: 'DEMI', slotId: 'apres-midi' } as const,
    ]) {
      expect(readCellState(cellStateToWrite(etat, CTX), CTX)).toEqual(etat)
    }
  })
})

describe('buildCellStates', () => {
  const entries = [
    { lineId: 'l1', date: '2026-03-02', minutes: 480, slotId: '' },
    { lineId: 'l1', date: '2026-03-03', minutes: 240, slotId: 'matin' },
    { lineId: 'l2', date: '2026-03-02', minutes: 480, slotId: '' },
  ]

  it('indexe les états par date pour la seule prestation demandée', () => {
    const etats = buildCellStates(entries, 'l1', CTX)
    expect(etats.get('2026-03-02')).toEqual({ kind: 'JOURNEE' })
    expect(etats.get('2026-03-03')).toEqual({ kind: 'DEMI', slotId: 'matin' })
    expect(etats.size).toBe(2)
  })

  it('ne mêle jamais les saisies d une autre prestation', () => {
    const etats = buildCellStates(entries, 'l2', CTX)
    expect(etats.size).toBe(1)
    expect(etats.get('2026-03-02')).toEqual({ kind: 'JOURNEE' })
  })

  it('regroupe plusieurs créneaux du même jour dans une seule case', () => {
    const etats = buildCellStates(
      [
        { lineId: 'l1', date: '2026-03-04', minutes: 240, slotId: 'matin' },
        { lineId: 'l1', date: '2026-03-04', minutes: 240, slotId: 'apres-midi' },
      ],
      'l1',
      CTX,
    )
    expect(etats.get('2026-03-04')).toEqual({
      kind: 'LIBRE',
      minutes: 480,
      slotId: '',
      eclatee: true,
    })
  })

  it('ne pose aucune entrée pour une prestation sans saisie', () => {
    expect(buildCellStates(entries, 'l3', CTX).size).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/saisie/cell-state.test.ts`
Expected: FAIL — `Failed to resolve import "./cell-state"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/saisie/cell-state.ts` :

```ts
import { centiemesToMinutes } from '../time/units'
import type { Slot } from '../time/slots'
import type { CellState } from './cycle'

export interface CellEntry {
  minutes: number
  /** '' = journée entière */
  slotId: string
}

export interface DatedCellEntry extends CellEntry {
  /** 'YYYY-MM-DD' */
  date: string
  lineId: string
}

export interface CellContext {
  /** facteur de conversion de la prestation, en minutes */
  minutesParJour: number
  slots: readonly Slot[]
}

/**
 * Traduit les saisies d'une case en l'état que la cinématique manipule.
 *
 * Tout ce qui ne correspond pas exactement à une journée entière ou à la
 * valeur nominale d'un créneau connu devient `LIBRE` — y compris une journée
 * éclatée dont le total ferait pourtant illusion. C'est ce classement, et lui
 * seul, qui empêche le clic suivant d'écraser une saisie fine.
 */
export function readCellState(entries: readonly CellEntry[], ctx: CellContext): CellState {
  const utiles = entries.filter((e) => e.minutes > 0)
  if (utiles.length === 0) return { kind: 'VIDE' }

  if (utiles.length === 1) {
    const seule = utiles[0]!
    if (seule.slotId === '' && seule.minutes === ctx.minutesParJour) return { kind: 'JOURNEE' }

    const slot = ctx.slots.find((s) => s.id === seule.slotId)
    if (slot !== undefined && seule.minutes === centiemesToMinutes(slot.centiemes, ctx.minutesParJour)) {
      return { kind: 'DEMI', slotId: slot.id }
    }

    return { kind: 'LIBRE', minutes: seule.minutes, slotId: seule.slotId, eclatee: false }
  }

  const minutes = utiles.reduce((somme, e) => somme + e.minutes, 0)
  return { kind: 'LIBRE', minutes, slotId: '', eclatee: true }
}

/** Les saisies exactes que la case doit porter après application de `state`. */
export function cellStateToWrite(state: CellState, ctx: CellContext): CellEntry[] {
  switch (state.kind) {
    case 'VIDE':
      return []
    case 'JOURNEE':
      return [{ minutes: ctx.minutesParJour, slotId: '' }]
    case 'DEMI': {
      const slot = ctx.slots.find((s) => s.id === state.slotId)
      if (slot === undefined) {
        throw new Error(`Créneau inconnu : « ${state.slotId} ».`)
      }
      return [{ minutes: centiemesToMinutes(slot.centiemes, ctx.minutesParJour), slotId: slot.id }]
    }
    case 'LIBRE':
      return [{ minutes: state.minutes, slotId: state.slotId }]
  }
}

/** États de toutes les cases d'une prestation, indexés par date. */
export function buildCellStates(
  entries: readonly DatedCellEntry[],
  lineId: string,
  ctx: CellContext,
): Map<string, CellState> {
  const parDate = new Map<string, CellEntry[]>()
  for (const e of entries) {
    if (e.lineId !== lineId) continue
    const bucket = parDate.get(e.date)
    if (bucket === undefined) parDate.set(e.date, [{ minutes: e.minutes, slotId: e.slotId }])
    else bucket.push({ minutes: e.minutes, slotId: e.slotId })
  }

  const etats = new Map<string, CellState>()
  for (const [date, cellEntries] of parDate) {
    etats.set(date, readCellState(cellEntries, ctx))
  }
  return etats
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/saisie/cell-state.test.ts`
Expected: PASS — 22 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/saisie/
git commit -m "feat(core): lecture et ecriture d'un etat de case"
```

---

## Task 3: Appliquer un état de case en base

**Files:** Create `src/services/cells.ts`, `src/services/cells.test.ts`. Modify `src/services/time-entries.ts`, `src/services/missions.ts`, `src/services/missions.test.ts`

**Interfaces:**
- Consumes: `cellStateToWrite`, `isSlotAllowed`, `checkCapacity`, `isLocked`, `resolveMinutesParJour`
- Produces:
  - `src/services/time-entries.ts` exporte `resolveLineMinutesParJour(lineId: string, globalMinutesParJour: number): Promise<number>` *(l'actuelle `facteurDeLaLigne`, privée, renommée et exportée)*
  - `isMonthLocked(userId: string, lineId: string, month: string): Promise<boolean>`
  - ```ts
    type CellResult =
      | { ok: true; state: CellState; warning?: CapacityWarning; signalement?: string }
      | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number }
      | { ok: false; reason: 'VERROUILLE' }
      | { ok: false; reason: 'NON_AFFECTE' }
      | { ok: false; reason: 'SAISIE_INVALIDE' }
    applyCellState(args: { userId: string; lineId: string; date: string; kind: TimeEntryKind; state: CellState }): Promise<CellResult>
    ```
  - `LineForGrid.minutesParJour` suit désormais la cascade complète prestation → mission → client → global

**Ce que cette tâche corrige au passage.** `listActiveLines` calcule aujourd'hui `a.line.minutesParJour ?? settings.minutesParJour` : elle saute les surcharges de mission et de client livrées par le lot 1d. La case afficherait donc une durée que l'écriture ne fige pas. Les données de la cascade sont déjà chargées par la requête existante ; la correction tient en un appel.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/cells.test.ts` :

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings, DEFAULT_SLOTS } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { getMonthEntries } from './time-entries'
import { applyCellState, isMonthLocked } from './cells'

let userId = ''
let autreId = ''
let missionId = ''
let ligneJour = ''
let ligneNuit = ''
let ligneAutre = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'cells@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'cells-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('CELLS client')
  const m = await createMission({ clientId: c.id, label: 'CELLS mission' })
  missionId = m.id

  ligneJour = (await createLine({
    missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000,
  })).id
  ligneNuit = (await createLine({
    missionId, userId, label: 'Nuit', soldCentiemes: 1000, tjmCents: 120000,
    allowedSlotIds: ['matin', 'apres-midi'],
  })).id
  ligneAutre = (await createLine({
    missionId, userId: autreId, label: 'Autre', soldCentiemes: 1000, tjmCents: 0,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    capacityCentiemes: 100,
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    slots: DEFAULT_SLOTS,
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: ['cells@test.local', 'cells-autre@test.local'] } } })
  await prisma.client.deleteMany({ where: { name: 'CELLS client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function saisiesDu(lineId: string, date: string) {
  return prisma.timeEntry.findMany({
    where: { lineId, date: new Date(`${date}T00:00:00.000Z`) },
    orderBy: { slotId: 'asc' },
    select: { minutes: true, slotId: true, kind: true, minutesParJour: true, userId: true },
  })
}

describe('applyCellState', () => {
  it('pose une journée entière sur une case vide', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r.ok).toBe(true)
    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([
      { minutes: 480, slotId: '', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('remplace la journée par une demi-journée sans laisser de résidu', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })

    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([
      { minutes: 240, slotId: 'matin', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('vide la case sans rien laisser derrière', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'DEMI', slotId: 'apres-midi' } })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'VIDE' } })

    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([])
  })

  it('fige le facteur de conversion en vigueur à l écriture', async () => {
    await updateSettings({ minutesParJour: 420 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-03', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await saisiesDu(ligneJour, '2026-03-03')).toEqual([
      { minutes: 420, slotId: '', kind: 'REALISE', minutesParJour: 420, userId },
    ])
  })

  it('écrit le prévisionnel quand on le lui demande', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-04', kind: 'PREVISIONNEL', state: { kind: 'JOURNEE' } })
    const [saisie] = await saisiesDu(ligneJour, '2026-03-04')
    expect(saisie!.kind).toBe('PREVISIONNEL')
  })

  it('refuse un mois dont le CRA est validé, sans rien écrire', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await applyCellState({ userId, lineId: ligneJour, date: '2026-03-05', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
    expect(await saisiesDu(ligneJour, '2026-03-05')).toEqual([])
  })

  it('ne détruit pas la case existante quand le mois se verrouille', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-06', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-06', kind: 'REALISE', state: { kind: 'VIDE' } })
    expect(await saisiesDu(ligneJour, '2026-03-06')).toHaveLength(1)
  })

  it('refuse en mode BLOCAGE et laisse la case intacte', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-09', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({ userId, lineId: ligneNuit, date: '2026-03-09', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'CAPACITE', totalMinutes: 960, capacityMinutes: 480 })
    expect(await saisiesDu(ligneNuit, '2026-03-09')).toEqual([])
  })

  it('signale sans bloquer en mode AVERTISSEMENT', async () => {
    await updateSettings({ capacityMode: 'AVERTISSEMENT', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-10', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({ userId, lineId: ligneNuit, date: '2026-03-10', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r.ok).toBe(true)
    expect(r.ok && r.warning).toEqual({ totalMinutes: 960, capacityMinutes: 480 })
    expect(await saisiesDu(ligneNuit, '2026-03-10')).toHaveLength(1)
  })

  // La case qu'on remplace ne doit jamais se compter elle-même : corriger une
  // journée en demi-journée ferait sinon 1,5 j et se ferait refuser.
  it('ne compte pas la case remplacée dans le total du jour', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-11', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-11', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })
    expect(r.ok).toBe(true)
  })

  // Lot 0 : `allowedSlotIds` devient enfin applicable. Un créneau non autorisé
  // déclenche un signalement, pas un refus.
  it('signale un créneau non autorisé sans refuser la saisie', async () => {
    const r = await applyCellState({
      userId, lineId: ligneNuit, date: '2026-03-12', kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 180, slotId: 'nuit', eclatee: false },
    })

    expect(r.ok).toBe(true)
    expect(r.ok && r.signalement).toContain('Nuit')
    expect(await saisiesDu(ligneNuit, '2026-03-12')).toEqual([
      { minutes: 180, slotId: 'nuit', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('ne signale rien quand la prestation ne restreint aucun créneau', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-13', kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 180, slotId: 'nuit', eclatee: false },
    })
    expect(r.ok && r.signalement).toBeUndefined()
  })

  it('refuse un créneau inconnu des réglages', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-16', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'inexistant' },
    })
    expect(r).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
  })

  it('refuse une durée libre aberrante venue du client', async () => {
    for (const minutes of [0, -30, 1441, 12.5]) {
      const r = await applyCellState({
        userId, lineId: ligneJour, date: '2026-03-17', kind: 'REALISE',
        state: { kind: 'LIBRE', minutes, slotId: '', eclatee: false },
      })
      expect(r).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
    }
    expect(await saisiesDu(ligneJour, '2026-03-17')).toEqual([])
  })

  it('refuse une prestation à laquelle l utilisateur n est pas affecté', async () => {
    const r = await applyCellState({ userId, lineId: ligneAutre, date: '2026-03-18', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'NON_AFFECTE' })
  })

  // Même prestation, même jour, deux utilisateurs : c'est là que le scope se
  // vérifie vraiment, une suppression par (lineId, date) sans userId emporterait
  // la saisie du voisin.
  it('n efface jamais la case d un autre utilisateur sur la même prestation', async () => {
    await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId: autreId, date: new Date('2026-03-19T00:00:00.000Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480, slotId: '',
      },
    })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-19', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-19', kind: 'REALISE', state: { kind: 'VIDE' } })

    const restantes = await saisiesDu(ligneJour, '2026-03-19')
    expect(restantes).toHaveLength(1)
    expect(restantes[0]!.userId).toBe(autreId)
  })

  it('rend la case relisible par getMonthEntries', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-20', kind: 'REALISE', state: { kind: 'DEMI', slotId: 'apres-midi' } })
    const entries = await getMonthEntries(userId, '2026-03')
    expect(entries).toContainEqual(
      expect.objectContaining({ date: '2026-03-20', minutes: 240, slotId: 'apres-midi' }),
    )
  })
})

describe('isMonthLocked', () => {
  it('rend faux sans CRA', async () => {
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(false)
  })

  it('rend faux sur un CRA en brouillon', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'BROUILLON' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(false)
  })

  it('rend vrai sur un CRA validé', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(true)
  })

  it('ne voit pas le verrou d un autre mois', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-04')).toBe(false)
  })
})
```

Ajouter à `src/services/missions.test.ts` :

```ts
describe('LineForGrid et la cascade du facteur', () => {
  it('applique la surcharge du client à la prestation affichée', async () => {
    await updateSettings({ minutesParJour: 480 })
    const c = await createClient('CASCADE client', 420)
    const m = await createMission({ clientId: c.id, label: 'CASCADE mission' })
    const l = await createLine({ missionId: m.id, userId, label: 'CASCADE ligne', soldCentiemes: 100, tjmCents: 0 })

    const ligne = (await listActiveLines(userId)).find((x) => x.id === l.id)
    // Sans la cascade, la ligne afficherait 480 alors que l'écriture fige 420.
    expect(ligne!.minutesParJour).toBe(420)
  })

  it('laisse la surcharge de la prestation l emporter sur celle du client', async () => {
    await updateSettings({ minutesParJour: 480 })
    const c = await createClient('CASCADE priorite', 420)
    const m = await createMission({ clientId: c.id, label: 'CASCADE mission 2' })
    const l = await createLine({
      missionId: m.id, userId, label: 'CASCADE ligne 2', soldCentiemes: 100, tjmCents: 0,
      minutesParJour: 400,
    })

    const ligne = (await listActiveLines(userId)).find((x) => x.id === l.id)
    expect(ligne!.minutesParJour).toBe(400)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/cells.test.ts src/services/missions.test.ts`
Expected: FAIL — `Failed to resolve import "./cells"`, et `minutesParJour` vaut 480 au lieu de 420 dans les deux tests de cascade

- [ ] **Step 3: Exporter le résolveur de facteur**

Dans `src/services/time-entries.ts`, renommer `facteurDeLaLigne` en `resolveLineMinutesParJour`, l'exporter, et mettre à jour son unique appel dans `saveEntry` :

```ts
/**
 * Facteur effectif d'une prestation, en remontant la cascade
 * prestation → mission → client → global.
 *
 * Exporté : le service des cases fige exactement le même facteur que
 * `saveEntry`, sans le recalculer autrement.
 */
export async function resolveLineMinutesParJour(
  lineId: string,
  globalMinutesParJour: number,
): Promise<number> {
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

- [ ] **Step 4: Aligner `listActiveLines` sur la cascade**

Dans `src/services/missions.ts`, remplacer `minutesParJour: a.line.minutesParJour ?? settings.minutesParJour` par :

```ts
    // La cascade complète, comme à l'écriture : afficher un facteur que le gel
    // ne figera pas ferait mentir chaque case du calendrier.
    minutesParJour: resolveMinutesParJour({
      line: a.line.minutesParJour,
      mission: a.line.mission.minutesParJour,
      client: a.line.mission.client.minutesParJour,
      global: settings.minutesParJour,
    }),
```

- [ ] **Step 5: Écrire le service des cases**

`src/services/cells.ts` :

```ts
import { prisma } from '@/db/client'
import { checkCapacity } from '@/core/capacity/check'
import { isLocked } from '@/core/cra/state-machine'
import { centiemesToMinutes } from '@/core/time/units'
import { cellStateToWrite } from '@/core/saisie/cell-state'
import { isSlotAllowed } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { getSettings } from './settings'
import { resolveLineMinutesParJour, type CapacityWarning } from './time-entries'

export type CellResult =
  | { ok: true; state: CellState; warning?: CapacityWarning; signalement?: string }
  | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number }
  | { ok: false; reason: 'VERROUILLE' }
  | { ok: false; reason: 'NON_AFFECTE' }
  | { ok: false; reason: 'SAISIE_INVALIDE' }

function monthStartOf(month: string): Date {
  return new Date(`${month.slice(0, 7)}-01T00:00:00.000Z`)
}

/**
 * Verrou du CRA d'une prestation sur un mois.
 *
 * Le statut n'est jamais comparé littéralement : `isLocked` est la seule
 * autorité, pour que le jour où un statut supplémentaire verrouille, la
 * cinématique, le remplissage et le vidage le voient tous les trois.
 */
export async function isMonthLocked(
  userId: string,
  lineId: string,
  month: string,
): Promise<boolean> {
  const line = await prisma.missionLine.findUnique({
    where: { id: lineId },
    select: { missionId: true },
  })
  if (line === null) return false

  const cra = await prisma.cra.findUnique({
    where: {
      missionId_userId_month: { missionId: line.missionId, userId, month: monthStartOf(month) },
    },
    select: { status: true },
  })

  return cra !== null && isLocked(cra.status as CraStatus)
}

/** Une durée libre venue du client n'est jamais crue sur parole. */
function dureeExploitable(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 1440
}

/**
 * Remplace en bloc les saisies d'une case (prestation, jour) par celles que
 * `state` décrit.
 *
 * Le remplacement en bloc — et non une suite d'écritures unitaires — est ce
 * qui rend la cinématique juste : passer de « 1 jour » à « ½ matin » supprime
 * la saisie sans créneau et écrit celle du matin, sans jamais laisser
 * coexister les deux, ni compter la case remplacée dans sa propre capacité.
 */
export async function applyCellState(args: {
  userId: string
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  kind: TimeEntryKind
  state: CellState
}): Promise<CellResult> {
  const settings = await getSettings()
  const date = new Date(`${args.date}T00:00:00.000Z`)

  // L'affectation est la porte d'entrée : le scope vit dans le service, jamais
  // dans le server action qui l'appelle.
  const assignment = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { line: { select: { allowedSlotIds: true } } },
  })
  if (assignment === null) return { ok: false, reason: 'NON_AFFECTE' }

  if (await isMonthLocked(args.userId, args.lineId, args.date.slice(0, 7))) {
    return { ok: false, reason: 'VERROUILLE' }
  }

  if (args.state.kind === 'LIBRE' && !dureeExploitable(args.state.minutes)) {
    return { ok: false, reason: 'SAISIE_INVALIDE' }
  }

  const minutesParJour = await resolveLineMinutesParJour(args.lineId, settings.minutesParJour)

  let cibles
  try {
    cibles = cellStateToWrite(args.state, { minutesParJour, slots: settings.slots })
  } catch {
    return { ok: false, reason: 'SAISIE_INVALIDE' }
  }

  // Total du jour hors la case qu'on remplace : toutes ses saisies partent,
  // les compter ferait refuser une correction qui allège pourtant la journée.
  const jour = await prisma.timeEntry.findMany({
    where: { userId: args.userId, date },
    select: { minutes: true, lineId: true },
  })
  const existingMinutes = jour
    .filter((e) => e.lineId !== args.lineId)
    .reduce((somme, e) => somme + e.minutes, 0)
  const addedMinutes = cibles.reduce((somme, c) => somme + c.minutes, 0)

  const verdict = checkCapacity({
    existingMinutes,
    addedMinutes,
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

  // Suppression et écriture dans la même transaction : deux requêtes séparées
  // laisseraient la case vide si la seconde échouait.
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.deleteMany({ where: { userId: args.userId, lineId: args.lineId, date } })
    for (const cible of cibles) {
      await tx.timeEntry.create({
        data: {
          lineId: args.lineId,
          userId: args.userId,
          date,
          slotId: cible.slotId,
          minutes: cible.minutes,
          kind: args.kind,
          minutesParJour,
        },
      })
    }
  })

  const allowed =
    assignment.line.allowedSlotIds === '' ? [] : assignment.line.allowedSlotIds.split(',')
  const horsCadre = cibles
    .map((c) => c.slotId)
    .filter((slotId) => !isSlotAllowed(slotId, allowed))
    .map((slotId) => settings.slots.find((s) => s.id === slotId)?.label ?? slotId)

  const warning: CapacityWarning | undefined =
    !verdict.ok && verdict.severity === 'warn'
      ? { totalMinutes: verdict.totalMinutes, capacityMinutes: verdict.capacityMinutes }
      : undefined

  // Signalement, jamais refus : la prestation restreint ce que la cinématique
  // propose, elle n'interdit pas ce que l'utilisateur choisit au formulaire.
  const signalement =
    horsCadre.length === 0
      ? undefined
      : `Créneau hors des créneaux autorisés pour cette prestation : ${horsCadre.join(', ')}. La saisie est conservée.`

  return {
    ok: true,
    state: args.state,
    ...(warning !== undefined && { warning }),
    ...(signalement !== undefined && { signalement }),
  }
}
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/cells.test.ts src/services/missions.test.ts`
Expected: PASS — 21 tests dans `cells.test.ts`, et `missions.test.ts` gagne 2 tests sans en perdre aucun

- [ ] **Step 7: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert — 307 tests d'origine plus les nouveaux, `tsc` à 0

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(saisie): application d'un etat de case en base"
```

---

## Task 4: Remplir et vider le mois

**Files:** Create `src/core/saisie/report.ts`, `src/core/saisie/report.test.ts`, `src/services/month-fill.ts`, `src/services/month-fill.test.ts`

**Interfaces:**
- Consumes: `applyCellState`, `isMonthLocked`, `buildMonthDays`, `getSettings`
- Produces:
  - `interface FillReport { poses: number; sautesCapacite: number; dejaSaisis: number; verrouille: boolean }`
  - `interface ClearReport { supprimees: number; verrouille: boolean }`
  - `formatFillReport(r: FillReport): string`
  - `formatClearReport(r: ClearReport): string`
  - `fillMonth(args: { userId: string; lineId: string; month: string; today: string }): Promise<FillReport>`
  - `clearMonth(args: { userId: string; lineId: string; month: string }): Promise<ClearReport>`

**Deux décisions à tenir.** « Remplir le CRA » **saute** un jour déjà saisi sur la prestation sélectionnée au lieu de l'écraser, et le compte au même titre qu'un jour sauté faute de capacité : un remplissage qui écrase en silence serait pire que pas de bouton du tout. Et `today` est un **paramètre**, jamais lu de l'horloge dans le service — c'est la convention déjà tenue par `listPastForecast`, sans laquelle le test devrait geler le temps.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/core/saisie/report.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { formatFillReport, formatClearReport } from './report'

describe('formatFillReport', () => {
  it('rend le compte rendu de la spec', () => {
    expect(
      formatFillReport({ poses: 18, sautesCapacite: 2, dejaSaisis: 0, verrouille: false }),
    ).toBe('18 jours posés, 2 sautés faute de capacité.')
  })

  it('accorde le singulier', () => {
    expect(
      formatFillReport({ poses: 1, sautesCapacite: 1, dejaSaisis: 1, verrouille: false }),
    ).toBe('1 jour posé, 1 sauté faute de capacité, 1 déjà saisi.')
  })

  it('compte les jours déjà saisis plutôt que de les écraser en silence', () => {
    expect(
      formatFillReport({ poses: 15, sautesCapacite: 0, dejaSaisis: 5, verrouille: false }),
    ).toBe('15 jours posés, 5 déjà saisis.')
  })

  it('ne mentionne que ce qui s est produit', () => {
    expect(
      formatFillReport({ poses: 20, sautesCapacite: 0, dejaSaisis: 0, verrouille: false }),
    ).toBe('20 jours posés.')
  })

  it('dit le verrou sans prétendre avoir posé quoi que ce soit', () => {
    expect(
      formatFillReport({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: true }),
    ).toBe("Le CRA de ce mois est validé : aucun jour n'a été posé.")
  })

  it('dit qu il n y avait rien à faire', () => {
    expect(
      formatFillReport({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: false }),
    ).toBe('Aucun jour ouvré à remplir sur ce mois.')
  })

  it('dit zéro posé quand tout a été sauté', () => {
    expect(
      formatFillReport({ poses: 0, sautesCapacite: 3, dejaSaisis: 0, verrouille: false }),
    ).toBe('0 jour posé, 3 sautés faute de capacité.')
  })
})

describe('formatClearReport', () => {
  it('compte les saisies retirées', () => {
    expect(formatClearReport({ supprimees: 3, verrouille: false })).toBe('3 saisies retirées.')
  })

  it('accorde le singulier', () => {
    expect(formatClearReport({ supprimees: 1, verrouille: false })).toBe('1 saisie retirée.')
  })

  it('dit qu il n y avait rien à retirer', () => {
    expect(formatClearReport({ supprimees: 0, verrouille: false })).toBe(
      'Aucune saisie à retirer sur ce mois pour cette prestation.',
    )
  })

  it('dit le verrou', () => {
    expect(formatClearReport({ supprimees: 0, verrouille: true })).toBe(
      "Le CRA de ce mois est validé : aucune saisie n'a été retirée.",
    )
  })
})
```

`src/services/month-fill.test.ts` :

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings, DEFAULT_SLOTS } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { applyCellState } from './cells'
import { getMonthEntries } from './time-entries'
import { fillMonth, clearMonth } from './month-fill'

let userId = ''
let missionId = ''
let ligneA = ''
let ligneB = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'fill@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('FILL client')
  const m = await createMission({ clientId: c.id, label: 'FILL mission' })
  missionId = m.id
  ligneA = (await createLine({ missionId, userId, label: 'A', soldCentiemes: 5000, tjmCents: 0 })).id
  ligneB = (await createLine({ missionId, userId, label: 'B', soldCentiemes: 5000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    capacityCentiemes: 100,
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    slots: DEFAULT_SLOTS,
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'fill@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'FILL client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('fillMonth', () => {
  // Mars 2026 commence un dimanche et compte 22 jours ouvrés sans férié.
  it('pose une journée sur chaque jour ouvré du mois', async () => {
    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 22, sautesCapacite: 0, dejaSaisis: 0, verrouille: false })

    const entries = await getMonthEntries(userId, '2026-03')
    expect(entries).toHaveLength(22)
    expect(entries.every((e) => e.minutes === 480 && e.slotId === '')).toBe(true)
  })

  it('laisse les week-ends et les fériés intacts', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    const dates = (await getMonthEntries(userId, '2026-03')).map((e) => e.date)
    // 2026-03-01 est un dimanche, 2026-03-07 un samedi.
    expect(dates).not.toContain('2026-03-01')
    expect(dates).not.toContain('2026-03-07')
  })

  it('saute un férié réglé', async () => {
    await updateSettings({ holidays: ['2026-03-02'] })
    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r.poses).toBe(21)
    expect((await getMonthEntries(userId, '2026-03')).map((e) => e.date)).not.toContain('2026-03-02')
  })

  it('écrit le réalisé sur le passé et le prévisionnel sur le futur', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-16' })
    const entries = await getMonthEntries(userId, '2026-03')
    const avant = entries.find((e) => e.date === '2026-03-13')
    const apres = entries.find((e) => e.date === '2026-03-17')
    expect(avant!.kind).toBe('REALISE')
    expect(apres!.kind).toBe('PREVISIONNEL')
  })

  // Le test central de la spec : jamais d'écrasement silencieux.
  it('saute les jours sans capacité et le dit', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneB, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneB, date: '2026-03-03', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 20, sautesCapacite: 2, dejaSaisis: 0, verrouille: false })

    // Les journées de l'autre prestation sont intactes.
    const surB = (await getMonthEntries(userId, '2026-03')).filter((e) => e.lineId === ligneB)
    expect(surB).toHaveLength(2)
    expect(surB.every((e) => e.minutes === 480)).toBe(true)
  })

  it('n écrase jamais une saisie déjà posée sur la prestation, et la compte', async () => {
    await applyCellState({
      userId, lineId: ligneA, date: '2026-03-02', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })

    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 21, sautesCapacite: 0, dejaSaisis: 1, verrouille: false })

    const conservee = (await getMonthEntries(userId, '2026-03')).find(
      (e) => e.lineId === ligneA && e.date === '2026-03-02',
    )
    expect(conservee).toMatchObject({ minutes: 240, slotId: 'matin' })
  })

  it('refuse un mois verrouillé sans rien écrire', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: true })
    expect(await getMonthEntries(userId, '2026-03')).toHaveLength(0)
  })

  it('ne pose rien sur un mois sans jour ouvré réglé', async () => {
    await updateSettings({ workingDays: [] })
    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: false })
  })

  it('rejette une prestation non affectée plutôt que de rendre un compte rendu vide', async () => {
    const autre = await prisma.user.create({
      data: { email: 'fill-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await expect(
      fillMonth({ userId: autre.id, lineId: ligneA, month: '2026-03', today: '2026-03-15' }),
    ).rejects.toThrow(/affect/i)
    await prisma.user.delete({ where: { id: autre.id } })
  })
})

describe('clearMonth', () => {
  it('retire les saisies du mois pour la seule prestation sélectionnée', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    await applyCellState({ userId, lineId: ligneB, date: '2026-03-02', kind: 'REALISE', state: { kind: 'DEMI', slotId: 'matin' } })

    const r = await clearMonth({ userId, lineId: ligneA, month: '2026-03' })
    expect(r).toEqual({ supprimees: 22, verrouille: false })

    const restantes = await getMonthEntries(userId, '2026-03')
    expect(restantes).toHaveLength(1)
    expect(restantes[0]!.lineId).toBe(ligneB)
  })

  it('ne touche pas aux autres mois', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    await fillMonth({ userId, lineId: ligneA, month: '2026-04', today: '2026-03-15' })

    await clearMonth({ userId, lineId: ligneA, month: '2026-03' })
    expect((await getMonthEntries(userId, '2026-04')).length).toBeGreaterThan(0)
  })

  it('refuse un mois verrouillé sans rien retirer', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await clearMonth({ userId, lineId: ligneA, month: '2026-03' })
    expect(r).toEqual({ supprimees: 0, verrouille: true })
    expect(await getMonthEntries(userId, '2026-03')).toHaveLength(22)
  })

  it('ne touche pas aux saisies d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'clear-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.timeEntry.create({
      data: {
        lineId: ligneA, userId: autre.id, date: new Date('2026-03-02T00:00:00.000Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480,
      },
    })

    await clearMonth({ userId, lineId: ligneA, month: '2026-03' })
    expect(await prisma.timeEntry.count({ where: { userId: autre.id } })).toBe(1)

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('rend zéro sur un mois déjà vide', async () => {
    expect(await clearMonth({ userId, lineId: ligneA, month: '2026-03' })).toEqual({
      supprimees: 0,
      verrouille: false,
    })
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/core/saisie/report.test.ts src/services/month-fill.test.ts`
Expected: FAIL — `Failed to resolve import "./report"` et `"./month-fill"`

- [ ] **Step 3: Écrire les comptes rendus**

`src/core/saisie/report.ts` :

```ts
export interface FillReport {
  poses: number
  sautesCapacite: number
  dejaSaisis: number
  verrouille: boolean
}

export interface ClearReport {
  supprimees: number
  verrouille: boolean
}

function accord(n: number, singulier: string, pluriel: string): string {
  return n > 1 ? pluriel : singulier
}

/**
 * Le compte rendu du remplissage.
 *
 * Il ne dit jamais seulement ce qui a été posé : ce qui a été sauté est la
 * moitié de l'information, et la taire ferait passer un remplissage partiel
 * pour un remplissage complet.
 */
export function formatFillReport(r: FillReport): string {
  if (r.verrouille) return "Le CRA de ce mois est validé : aucun jour n'a été posé."

  if (r.poses === 0 && r.sautesCapacite === 0 && r.dejaSaisis === 0) {
    return 'Aucun jour ouvré à remplir sur ce mois.'
  }

  const morceaux = [`${r.poses} ${accord(r.poses, 'jour', 'jours')} ${accord(r.poses, 'posé', 'posés')}`]
  if (r.sautesCapacite > 0) {
    morceaux.push(
      `${r.sautesCapacite} ${accord(r.sautesCapacite, 'sauté', 'sautés')} faute de capacité`,
    )
  }
  if (r.dejaSaisis > 0) {
    morceaux.push(`${r.dejaSaisis} ${accord(r.dejaSaisis, 'déjà saisi', 'déjà saisis')}`)
  }
  return `${morceaux.join(', ')}.`
}

export function formatClearReport(r: ClearReport): string {
  if (r.verrouille) return "Le CRA de ce mois est validé : aucune saisie n'a été retirée."
  if (r.supprimees === 0) return 'Aucune saisie à retirer sur ce mois pour cette prestation.'
  return `${r.supprimees} ${accord(r.supprimees, 'saisie', 'saisies')} ${accord(r.supprimees, 'retirée', 'retirées')}.`
}
```

- [ ] **Step 4: Écrire le service**

`src/services/month-fill.ts` :

```ts
import { prisma } from '@/db/client'
import { buildMonthDays } from '@/core/month/build'
import type { ClearReport, FillReport } from '@/core/saisie/report'
import { getSettings } from './settings'
import { applyCellState, isMonthLocked } from './cells'
import { toIsoDate } from './time-entries'

function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }
}

async function assertAffecte(userId: string, lineId: string): Promise<void> {
  const assignment = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId, userId } },
    select: { id: true },
  })
  if (assignment === null) {
    throw new Error("Cette prestation n'est pas affectée à cet utilisateur.")
  }
}

/**
 * Pose une journée sur chaque jour ouvré du mois pour une prestation.
 *
 * `today` est un paramètre et jamais l'horloge : c'est lui qui départage le
 * réalisé du prévisionnel, et le geler dans le service rendrait la fonction
 * intestable.
 *
 * Un jour déjà saisi sur cette prestation est **sauté**, jamais écrasé — c'est
 * la décision qui distingue ce bouton d'une perte de données déguisée en
 * confort.
 */
export async function fillMonth(args: {
  userId: string
  lineId: string
  /** 'YYYY-MM' */
  month: string
  /** 'YYYY-MM-DD' */
  today: string
}): Promise<FillReport> {
  await assertAffecte(args.userId, args.lineId)

  const vide: FillReport = { poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: false }

  // Le verrou se vérifie avant la boucle : le constater au troisième jour
  // laisserait deux journées écrites sur un mois validé.
  if (await isMonthLocked(args.userId, args.lineId, args.month)) {
    return { ...vide, verrouille: true }
  }

  const settings = await getSettings()
  const ouvres = buildMonthDays(args.month, settings.workingDays, settings.holidays).filter(
    (d) => d.isWorking && !d.isHoliday,
  )

  const { start, end } = monthBounds(args.month)
  const existantes = await prisma.timeEntry.findMany({
    where: { userId: args.userId, lineId: args.lineId, date: { gte: start, lt: end } },
    select: { date: true },
  })
  const dejaSaisies = new Set(existantes.map((e) => toIsoDate(e.date)))

  const report: FillReport = { ...vide }

  for (const jour of ouvres) {
    if (dejaSaisies.has(jour.date)) {
      report.dejaSaisis++
      continue
    }

    const resultat = await applyCellState({
      userId: args.userId,
      lineId: args.lineId,
      date: jour.date,
      kind: jour.date >= args.today ? 'PREVISIONNEL' : 'REALISE',
      state: { kind: 'JOURNEE' },
    })

    if (resultat.ok) {
      report.poses++
    } else if (resultat.reason === 'CAPACITE') {
      report.sautesCapacite++
    } else if (resultat.reason === 'VERROUILLE') {
      // Le verrou a été posé pendant la boucle : on s'arrête là plutôt que de
      // continuer à se faire refuser jour après jour.
      return { ...report, verrouille: true }
    } else {
      throw new Error(`Remplissage impossible le ${jour.date} : ${resultat.reason}.`)
    }
  }

  return report
}

/** Retire les saisies du mois pour la prestation sélectionnée, elle seule. */
export async function clearMonth(args: {
  userId: string
  lineId: string
  month: string
}): Promise<ClearReport> {
  await assertAffecte(args.userId, args.lineId)

  if (await isMonthLocked(args.userId, args.lineId, args.month)) {
    return { supprimees: 0, verrouille: true }
  }

  const { start, end } = monthBounds(args.month)
  const { count } = await prisma.timeEntry.deleteMany({
    where: { userId: args.userId, lineId: args.lineId, date: { gte: start, lt: end } },
  })

  return { supprimees: count, verrouille: false }
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/core/saisie/report.test.ts src/services/month-fill.test.ts`
Expected: PASS — 11 tests dans `report.test.ts`, 14 dans `month-fill.test.ts`

- [ ] **Step 6: Vérifier par mutation**

Remplacer brièvement le `continue` du branchement `dejaSaisies.has(jour.date)` par un appel à `applyCellState` et confirmer que « n'écrase jamais une saisie déjà posée » échoue. Restaurer ensuite.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(saisie): remplir et vider le mois avec compte rendu"
```

---

## Task 5: Semaines et couleurs

**Files:** Create `src/core/month/weeks.ts`, `src/core/month/weeks.test.ts`, `src/core/saisie/colors.ts`, `src/core/saisie/colors.test.ts`

**Interfaces:**
- Consumes: `MonthDay` de `src/core/month/build.ts`
- Produces:
  - `buildWeeks(days: readonly MonthDay[]): Array<Array<MonthDay | null>>` — semaines de 7 cases, lundi en tête, `null` pour les cases hors mois
  - `interface LineColor { bg: string; text: string; border: string }`
  - `LINE_COLORS: readonly LineColor[]`
  - `colorForLine(lineId: string): LineColor`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/core/month/weeks.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { buildWeeks } from './weeks'
import { buildMonthDays } from './build'

const OUVRES = [1, 2, 3, 4, 5]

describe('buildWeeks', () => {
  it('rend toujours des semaines de sept cases', () => {
    for (const mois of ['2026-03', '2026-06', '2026-02', '2026-12']) {
      const semaines = buildWeeks(buildMonthDays(mois, OUVRES, []))
      expect(semaines.every((s) => s.length === 7)).toBe(true)
    }
  })

  it('ne perd aucun jour du mois', () => {
    const days = buildMonthDays('2026-03', OUVRES, [])
    const aplaties = buildWeeks(days).flat().filter((c) => c !== null)
    expect(aplaties).toEqual(days)
  })

  it('cale le premier jour sur sa colonne : mars 2026 commence un dimanche', () => {
    const semaines = buildWeeks(buildMonthDays('2026-03', OUVRES, []))
    expect(semaines[0]!.slice(0, 6).every((c) => c === null)).toBe(true)
    expect(semaines[0]![6]?.date).toBe('2026-03-01')
    expect(semaines).toHaveLength(6)
  })

  it('ne laisse aucune case vide en tête d un mois commençant un lundi', () => {
    // 2026-06-01 est un lundi.
    const semaines = buildWeeks(buildMonthDays('2026-06', OUVRES, []))
    expect(semaines[0]![0]?.date).toBe('2026-06-01')
    expect(semaines).toHaveLength(5)
  })

  it('complète la dernière semaine par des cases vides', () => {
    const semaines = buildWeeks(buildMonthDays('2026-06', OUVRES, []))
    const derniere = semaines[semaines.length - 1]!
    expect(derniere[0]?.date).toBe('2026-06-29')
    expect(derniere[1]?.date).toBe('2026-06-30')
    expect(derniere.slice(2).every((c) => c === null)).toBe(true)
  })

  it('rend une liste vide sans aucun jour', () => {
    expect(buildWeeks([])).toEqual([])
  })

  it('conserve l ordre des jours à l intérieur d une semaine', () => {
    const semaines = buildWeeks(buildMonthDays('2026-06', OUVRES, []))
    expect(semaines[0]!.map((c) => c?.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
```

`src/core/saisie/colors.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { colorForLine, LINE_COLORS } from './colors'

describe('colorForLine', () => {
  it('rend la même couleur à chaque appel pour un même identifiant', () => {
    // « Une couleur qui change entre deux visites ne sert à rien. »
    const premier = colorForLine('ckz7prestation42')
    const second = colorForLine('ckz7prestation42')
    expect(second).toEqual(premier)
  })

  it('ne dépend d aucun contexte : ni ordre, ni liste, ni rang', () => {
    const seule = colorForLine('l2')
    const dansUnLot = ['l9', 'l1', 'l2', 'l7'].map((id) => colorForLine(id))[2]
    const dansLOrdreInverse = ['l7', 'l2', 'l1', 'l9'].map((id) => colorForLine(id))[1]
    expect(dansUnLot).toEqual(seule)
    expect(dansLOrdreInverse).toEqual(seule)
  })

  it('rend toujours une couleur de la palette', () => {
    for (let i = 0; i < 200; i++) {
      expect(LINE_COLORS).toContainEqual(colorForLine(`line-${i}`))
    }
  })

  it('répartit les prestations sur toute la palette', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `line-${i}`)
    const distinctes = new Set(ids.map((id) => colorForLine(id).bg))
    expect(distinctes.size).toBe(LINE_COLORS.length)
  })

  it('rend une couleur même pour un identifiant vide', () => {
    expect(LINE_COLORS).toContainEqual(colorForLine(''))
  })

  it('déclare une palette non vide, sans doublon de fond', () => {
    expect(LINE_COLORS.length).toBeGreaterThan(1)
    expect(new Set(LINE_COLORS.map((c) => c.bg)).size).toBe(LINE_COLORS.length)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/core/month/weeks.test.ts src/core/saisie/colors.test.ts`
Expected: FAIL — `Failed to resolve import "./weeks"` et `"./colors"`

- [ ] **Step 3: Écrire les semaines**

`src/core/month/weeks.ts` :

```ts
import type { MonthDay } from './build'

/**
 * Découpe un mois en semaines de sept cases, lundi en tête.
 *
 * Les cases hors du mois valent `null` plutôt que d'être omises : sept
 * colonnes en toutes circonstances est ce qui fait tenir la vue sur un
 * téléphone, et une semaine plus courte que les autres briserait l'alignement
 * des jours sur leur colonne.
 */
export function buildWeeks(days: readonly MonthDay[]): Array<Array<MonthDay | null>> {
  const premier = days[0]
  if (premier === undefined) return []

  const semaines: Array<Array<MonthDay | null>> = []
  let courante: Array<MonthDay | null> = Array<MonthDay | null>(premier.dayOfWeek - 1).fill(null)

  for (const jour of days) {
    courante.push(jour)
    if (jour.dayOfWeek === 7) {
      semaines.push(courante)
      courante = []
    }
  }

  if (courante.length > 0) {
    while (courante.length < 7) courante.push(null)
    semaines.push(courante)
  }

  return semaines
}
```

- [ ] **Step 4: Écrire les couleurs**

`src/core/saisie/colors.ts` :

```ts
export interface LineColor {
  /** classe Tailwind de fond */
  bg: string
  /** classe Tailwind de texte */
  text: string
  /** classe Tailwind de bordure */
  border: string
}

export const LINE_COLORS: readonly LineColor[] = [
  { bg: 'bg-sky-100', text: 'text-sky-900', border: 'border-sky-300' },
  { bg: 'bg-emerald-100', text: 'text-emerald-900', border: 'border-emerald-300' },
  { bg: 'bg-violet-100', text: 'text-violet-900', border: 'border-violet-300' },
  { bg: 'bg-amber-100', text: 'text-amber-900', border: 'border-amber-300' },
  { bg: 'bg-rose-100', text: 'text-rose-900', border: 'border-rose-300' },
  { bg: 'bg-teal-100', text: 'text-teal-900', border: 'border-teal-300' },
]

/** FNV-1a 32 bits — court, déterministe, bien réparti sur des identifiants cuid. */
function hash(texte: string): number {
  let h = 2166136261
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Couleur d'une prestation, dérivée de son seul identifiant.
 *
 * Volontairement sans liste ni index : une couleur attribuée par rang dans un
 * tableau changerait dès qu'une prestation est ajoutée, archivée ou triée
 * autrement — c'est précisément ce que la spec écarte.
 */
export function colorForLine(lineId: string): LineColor {
  return LINE_COLORS[hash(lineId) % LINE_COLORS.length]!
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/core/month/weeks.test.ts src/core/saisie/colors.test.ts`
Expected: PASS — 7 tests dans `weeks.test.ts`, 6 dans `colors.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/core/
git commit -m "feat(core): semaines de sept cases et couleur stable par prestation"
```

---

## Task 6: La grille du calendrier et la cinématique au clic

**Files:** Create `src/components/calendar/useLongPress.ts`, `src/components/calendar/useLongPress.test.ts`, `src/components/calendar/MonthCalendar.tsx`, `src/components/calendar/MonthCalendar.test.tsx`

**Interfaces:**
- Consumes: `buildWeeks`, `buildCellStates`, `nextCellState`, `cycleSlotIds`, `formatQuantity`, `LineForGrid`, `MonthEntry`, `Slot`
- Produces:
  - `useLongPress(onLongPress: () => void, delayMs?: number): { handlers: { onPointerDown; onPointerUp; onPointerLeave; onPointerCancel }; consommerAppuiLong(): boolean }`
  - ```ts
    MonthCalendar(props: {
      days: MonthDay[]
      line: LineForGrid
      slots: Slot[]
      entries: MonthEntry[]
      onApply: (date: string, state: CellState) => Promise<boolean>
      onFormulaire: (date: string, etat: CellState) => void
    })
    ```

**Ce que le composant n'a pas le droit de faire.** Aucun calcul de capacité, d'engagement ni de conversion d'unité : il appelle `nextCellState` pour savoir quoi écrire, `formatQuantity` pour l'afficher, et rien d'autre. Le test « aucune règle métier dans la vue » de la spec se vérifie par `grep` en fin de lot.

**La cible tactile.** happy-dom ne fait aucune mise en page : la mesure des 44 points ne peut pas être lue à l'exécution. Le test vérifie donc la classe qui la garantit — `min-h-11 min-w-11`, soit 44 px en Tailwind — et la grille à sept colonnes fixes qui empêche une case de se replier en dessous.

- [ ] **Step 1: Écrire le test de l'appui long**

`src/components/calendar/useLongPress.test.ts` :

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useLongPress } from './useLongPress'

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('déclenche après le délai', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress, 500))

    act(() => result.current.handlers.onPointerDown())
    expect(onLongPress).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(500))
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('ne déclenche pas si le doigt se relève avant le délai', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress, 500))

    act(() => result.current.handlers.onPointerDown())
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.handlers.onPointerUp())
    act(() => vi.advanceTimersByTime(500))

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('ne déclenche pas si le doigt quitte la case', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress, 500))

    act(() => result.current.handlers.onPointerDown())
    act(() => result.current.handlers.onPointerLeave())
    act(() => vi.advanceTimersByTime(500))

    expect(onLongPress).not.toHaveBeenCalled()
  })

  // Sans ce drapeau, l'appui long ouvrirait le formulaire et le clic qui suit
  // ferait avancer la case d'un cran derrière lui.
  it('signale une fois, et une seule, que le clic suivant doit être ignoré', () => {
    const { result } = renderHook(() => useLongPress(vi.fn(), 500))

    act(() => result.current.handlers.onPointerDown())
    act(() => vi.advanceTimersByTime(500))

    expect(result.current.consommerAppuiLong()).toBe(true)
    expect(result.current.consommerAppuiLong()).toBe(false)
  })

  it('ne signale rien après un appui court', () => {
    const { result } = renderHook(() => useLongPress(vi.fn(), 500))

    act(() => result.current.handlers.onPointerDown())
    act(() => result.current.handlers.onPointerUp())

    expect(result.current.consommerAppuiLong()).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/components/calendar/useLongPress.test.ts`
Expected: FAIL — `Failed to resolve import "./useLongPress"`

- [ ] **Step 3: Écrire l'appui long**

`src/components/calendar/useLongPress.ts` :

```ts
'use client'

import { useCallback, useRef } from 'react'

/**
 * Appui long — l'équivalent au pouce du clic droit de la souris.
 *
 * Le drapeau `consommerAppuiLong` existe parce que relever le doigt après un
 * appui long produit aussi un `click` : sans lui, le formulaire s'ouvrirait
 * puis la case avancerait d'un cran derrière lui.
 */
export function useLongPress(
  onLongPress: () => void,
  delayMs = 500,
): {
  handlers: {
    onPointerDown: () => void
    onPointerUp: () => void
    onPointerLeave: () => void
    onPointerCancel: () => void
  }
  consommerAppuiLong: () => boolean
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const declenche = useRef(false)

  const annuler = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const demarrer = useCallback(() => {
    annuler()
    declenche.current = false
    timer.current = setTimeout(() => {
      timer.current = null
      declenche.current = true
      onLongPress()
    }, delayMs)
  }, [annuler, delayMs, onLongPress])

  const consommerAppuiLong = useCallback((): boolean => {
    const oui = declenche.current
    declenche.current = false
    return oui
  }, [])

  return {
    handlers: {
      onPointerDown: demarrer,
      onPointerUp: annuler,
      onPointerLeave: annuler,
      onPointerCancel: annuler,
    },
    consommerAppuiLong,
  }
}
```

- [ ] **Step 4: Écrire le test du calendrier**

`src/components/calendar/MonthCalendar.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MonthCalendar } from './MonthCalendar'
import { buildMonthDays } from '@/core/month/build'
import { DEFAULT_SLOTS } from '@/services/settings'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5], ['2026-03-02'])

const ligneJour: LineForGrid = {
  id: 'l1',
  label: 'Consultant ITSM',
  missionLabel: 'ITSM',
  clientName: 'ACME',
  displayUnit: 'JOUR',
  minutesParJour: 480,
  soldCentiemes: 3000,
  allowedSlotIds: [],
}

const ligneHeure: LineForGrid = { ...ligneJour, id: 'l2', label: 'Astreinte', displayUnit: 'HEURE' }

function entree(over: Partial<MonthEntry>): MonthEntry {
  return {
    id: 'e', lineId: 'l1', date: '2026-03-10', minutes: 480,
    kind: 'REALISE', slotId: '', minutesParJour: 480, ...over,
  }
}

function renderCalendar(
  overrides: Partial<React.ComponentProps<typeof MonthCalendar>> = {},
): ReturnType<typeof render> {
  return render(
    <MonthCalendar
      days={days}
      line={ligneJour}
      slots={DEFAULT_SLOTS}
      entries={[]}
      onApply={vi.fn(async () => true)}
      onFormulaire={vi.fn()}
      {...overrides}
    />,
  )
}

function caseDu(date: string): HTMLButtonElement {
  return screen.getByTestId(`case-${date}`) as HTMLButtonElement
}

/** La valeur seule, sans le numéro du jour qui la précède dans la case. */
function valeurDu(date: string): HTMLElement {
  return screen.getByTestId(`valeur-${date}`)
}

describe('MonthCalendar', () => {
  afterEach(cleanup)

  it('affiche sept en-têtes de jours', () => {
    renderCalendar()
    expect(screen.getAllByTestId(/^entete-jour-/)).toHaveLength(7)
  })

  it('abrège les en-têtes pour le téléphone tout en gardant la forme longue', () => {
    renderCalendar()
    const lundi = screen.getByTestId('entete-jour-1')
    expect(lundi.textContent).toContain('L')
    expect(lundi.textContent).toContain('Lun')
  })

  it('affiche une case par jour du mois', () => {
    renderCalendar()
    expect(screen.getAllByTestId(/^case-2026-03-/)).toHaveLength(31)
  })

  it('range la grille en sept colonnes fixes', () => {
    const { container } = renderCalendar()
    expect(container.querySelector('[data-testid="grille-calendrier"]')!.className).toContain(
      'grid-cols-7',
    )
  })

  it('garde une cible tactile d au moins 44 points', () => {
    renderCalendar()
    // 44 px = min-h-11 / min-w-11 en Tailwind. En dessous, on rate une case
    // sur trois au pouce.
    expect(caseDu('2026-03-10').className).toContain('min-h-11')
    expect(caseDu('2026-03-10').className).toContain('min-w-11')
  })

  it('grise les week-ends et les fériés sans les interdire', () => {
    renderCalendar()
    const dimanche = caseDu('2026-03-01')
    const ferie = caseDu('2026-03-02')
    expect(dimanche.className).toContain('bg-slate-100')
    expect(ferie.className).toContain('bg-slate-100')
    expect(dimanche.disabled).toBe(false)
    expect(ferie.disabled).toBe(false)
  })

  describe('cinématique au clic', () => {
    it('pose une journée sur une case vide', async () => {
      const onApply = vi.fn(async () => true)
      renderCalendar({ onApply })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'JOURNEE' }))
    })

    it('passe d une journée à la demi-journée du matin', async () => {
      const onApply = vi.fn(async () => true)
      renderCalendar({ onApply, entries: [entree({ minutes: 480, slotId: '' })] })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() =>
        expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'DEMI', slotId: 'matin' }),
      )
    })

    it('vide la case après la dernière demi-journée', async () => {
      const onApply = vi.fn(async () => true)
      renderCalendar({ onApply, entries: [entree({ minutes: 240, slotId: 'apres-midi' })] })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'VIDE' }))
    })

    // Le test qui protège contre la perte silencieuse.
    it('n applique rien sur une case à valeur libre : elle rouvre son formulaire', async () => {
      const onApply = vi.fn(async () => true)
      const onFormulaire = vi.fn()
      renderCalendar({ onApply, onFormulaire, entries: [entree({ minutes: 180, slotId: '' })] })

      fireEvent.click(caseDu('2026-03-10'))

      await waitFor(() =>
        expect(onFormulaire).toHaveBeenCalledWith('2026-03-10', {
          kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false,
        }),
      )
      expect(onApply).not.toHaveBeenCalled()
    })

    it('ouvre le formulaire d une prestation facturée à l heure, sans passer par 1 jour', async () => {
      const onApply = vi.fn(async () => true)
      const onFormulaire = vi.fn()
      renderCalendar({ line: ligneHeure, entries: [], onApply, onFormulaire })

      fireEvent.click(caseDu('2026-03-10'))

      await waitFor(() =>
        expect(onFormulaire).toHaveBeenCalledWith('2026-03-10', { kind: 'VIDE' }),
      )
      expect(onApply).not.toHaveBeenCalled()
    })

    it('ouvre le formulaire au clic droit', () => {
      const onFormulaire = vi.fn()
      const onApply = vi.fn(async () => true)
      renderCalendar({ onApply, onFormulaire })

      fireEvent.contextMenu(caseDu('2026-03-11'))

      expect(onFormulaire).toHaveBeenCalledWith('2026-03-11', { kind: 'VIDE' })
      expect(onApply).not.toHaveBeenCalled()
    })

    it('n ouvre pas de menu contextuel du navigateur', () => {
      renderCalendar()
      const evenement = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      caseDu('2026-03-11').dispatchEvent(evenement)
      expect(evenement.defaultPrevented).toBe(true)
    })
  })

  describe('affichage des états', () => {
    it('affiche 1 pour une journée entière', () => {
      renderCalendar({ entries: [entree({ minutes: 480, slotId: '' })] })
      // Sur la valeur seule : le numéro du jour, « 10 », contient déjà un « 1 ».
      expect(valeurDu('2026-03-10').textContent).toBe('1')
    })

    it('affiche l initiale du créneau pour une demi-journée', () => {
      renderCalendar({ entries: [entree({ minutes: 240, slotId: 'apres-midi' })] })
      expect(valeurDu('2026-03-10').textContent).toBe('½ A')
      expect(caseDu('2026-03-10').title).toContain('Après-midi')
    })

    it('affiche les heures d une valeur libre', () => {
      renderCalendar({ entries: [entree({ minutes: 180, slotId: 'nuit' })] })
      expect(valeurDu('2026-03-10').textContent).toBe('3h')
    })

    it('distingue le prévisionnel du réalisé', () => {
      renderCalendar({ entries: [entree({ kind: 'PREVISIONNEL' })] })
      expect(caseDu('2026-03-10').className).toContain('italic')
    })

    it('laisse vide une case sans saisie', () => {
      renderCalendar()
      expect(valeurDu('2026-03-10').textContent).toBe('')
    })
  })

  describe('affichage optimiste', () => {
    it('montre le cran suivant sans attendre le serveur', async () => {
      renderCalendar({ onApply: vi.fn(async () => true) })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(valeurDu('2026-03-10').textContent).toBe('1'))
    })

    it('revient à l état serveur quand l écriture est refusée', async () => {
      renderCalendar({ onApply: vi.fn(async () => false) })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(valeurDu('2026-03-10').textContent).toBe(''))
    })

    it('reprend les saisies du serveur quand elles changent', () => {
      const { rerender } = renderCalendar()
      expect(valeurDu('2026-03-10').textContent).toBe('')

      rerender(
        <MonthCalendar
          days={days}
          line={ligneJour}
          slots={DEFAULT_SLOTS}
          entries={[entree({ minutes: 240, slotId: 'matin' })]}
          onApply={vi.fn(async () => true)}
          onFormulaire={vi.fn()}
        />,
      )
      expect(valeurDu('2026-03-10').textContent).toBe('½ M')
    })
  })
})
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/components/calendar/MonthCalendar.test.tsx`
Expected: FAIL — `Failed to resolve import "./MonthCalendar"`

- [ ] **Step 6: Écrire le calendrier**

`src/components/calendar/MonthCalendar.tsx` :

```tsx
'use client'

import { useCallback, useMemo, useState } from 'react'
import { buildWeeks } from '@/core/month/weeks'
import { buildCellStates } from '@/core/saisie/cell-state'
import { cycleSlotIds, nextCellState } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import { formatQuantity } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { Slot } from '@/core/time/slots'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'
import { useLongPress } from './useLongPress'

const VIDE: CellState = { kind: 'VIDE' }

const EN_TETES = [
  { dayOfWeek: 1, court: 'L', long: 'Lun' },
  { dayOfWeek: 2, court: 'M', long: 'Mar' },
  { dayOfWeek: 3, court: 'M', long: 'Mer' },
  { dayOfWeek: 4, court: 'J', long: 'Jeu' },
  { dayOfWeek: 5, court: 'V', long: 'Ven' },
  { dayOfWeek: 6, court: 'S', long: 'Sam' },
  { dayOfWeek: 7, court: 'D', long: 'Dim' },
]

function libelleSlot(slotId: string, slots: readonly Slot[]): string {
  return slots.find((s) => s.id === slotId)?.label ?? slotId
}

/** Ce que la case affiche. Aucune conversion maison : `formatQuantity` sait le faire. */
function contenu(etat: CellState, slots: readonly Slot[], minutesParJour: number): string {
  switch (etat.kind) {
    case 'VIDE':
      return ''
    case 'JOURNEE':
      return '1'
    case 'DEMI':
      return `½ ${libelleSlot(etat.slotId, slots).slice(0, 1).toUpperCase()}`
    case 'LIBRE':
      return formatQuantity(etat.minutes, 'HEURE', minutesParJour)
  }
}

function description(etat: CellState, slots: readonly Slot[]): string {
  switch (etat.kind) {
    case 'VIDE':
      return 'Aucune saisie'
    case 'JOURNEE':
      return 'Journée entière'
    case 'DEMI':
      return `Demi-journée — ${libelleSlot(etat.slotId, slots)}`
    case 'LIBRE':
      return etat.eclatee
        ? 'Journée saisie en plusieurs créneaux'
        : `Durée libre${etat.slotId === '' ? '' : ` — ${libelleSlot(etat.slotId, slots)}`}`
  }
}

/**
 * La vue mensuelle : sept colonnes, une case par jour, un clic par cran.
 *
 * Le composant ne décide de rien — il demande à `nextCellState` ce que le clic
 * signifie et transmet le résultat. Aucune règle de capacité, d'engagement ni
 * de conversion d'unité ne vit ici.
 */
export function MonthCalendar({
  days,
  line,
  slots,
  entries,
  onApply,
  onFormulaire,
}: {
  days: MonthDay[]
  /** la prestation saisie : la seule que ce composant rend cliquable */
  line: LineForGrid
  slots: Slot[]
  entries: MonthEntry[]
  /** renvoie `true` quand l'état a bien été enregistré */
  onApply: (date: string, state: CellState) => Promise<boolean>
  onFormulaire: (date: string, etat: CellState) => void
}) {
  const semaines = useMemo(() => buildWeeks(days), [days])

  const ctx = useMemo(
    () => ({ minutesParJour: line.minutesParJour, slots }),
    [line.minutesParJour, slots],
  )
  const options = useMemo(
    () => ({ demiSlotIds: cycleSlotIds(slots, line.allowedSlotIds), displayUnit: line.displayUnit }),
    [slots, line.allowedSlotIds, line.displayUnit],
  )

  const serveur = useMemo(() => buildCellStates(entries, line.id, ctx), [entries, line.id, ctx])

  // Affichage optimiste : le cran suivant s'affiche avant l'aller-retour
  // serveur, et disparaît si l'écriture est refusée.
  const [optimiste, setOptimiste] = useState<Map<string, CellState>>(new Map())
  const [seed, setSeed] = useState(serveur)
  if (seed !== serveur) {
    setSeed(serveur)
    setOptimiste(new Map())
  }

  const etatDe = useCallback(
    (date: string): CellState => optimiste.get(date) ?? serveur.get(date) ?? VIDE,
    [optimiste, serveur],
  )

  const cliquer = useCallback(
    async (date: string) => {
      const etat = etatDe(date)
      const step = nextCellState(etat, options)

      if (step.action === 'FORMULAIRE') {
        onFormulaire(date, etat)
        return
      }

      setOptimiste((prev) => new Map(prev).set(date, step.state))
      const enregistre = await onApply(date, step.state)
      if (!enregistre) {
        setOptimiste((prev) => {
          const suivant = new Map(prev)
          suivant.delete(date)
          return suivant
        })
      }
    },
    [etatDe, onFormulaire, onApply, options],
  )

  return (
    <div>
      <div data-testid="grille-calendrier" className="grid grid-cols-7 gap-1">
        {EN_TETES.map((e) => (
          <div
            key={e.dayOfWeek}
            data-testid={`entete-jour-${e.dayOfWeek}`}
            className="py-1 text-center text-xs font-medium text-slate-500"
          >
            <span className="sm:hidden">{e.court}</span>
            <span className="hidden sm:inline">{e.long}</span>
          </div>
        ))}

        {semaines.map((semaine, i) =>
          semaine.map((jour, j) =>
            jour === null ? (
              <div key={`vide-${i}-${j}`} aria-hidden="true" className="min-h-11" />
            ) : (
              <Case
                key={jour.date}
                jour={jour}
                etat={etatDe(jour.date)}
                slots={slots}
                minutesParJour={line.minutesParJour}
                label={line.label}
                onClick={() => void cliquer(jour.date)}
                onFormulaire={() => onFormulaire(jour.date, etatDe(jour.date))}
              />
            ),
          ),
        )}
      </div>
    </div>
  )
}

function Case({
  jour,
  etat,
  slots,
  minutesParJour,
  label,
  onClick,
  onFormulaire,
}: {
  jour: MonthDay
  etat: CellState
  slots: Slot[]
  minutesParJour: number
  label: string
  onClick: () => void
  onFormulaire: () => void
}) {
  const appuiLong = useLongPress(onFormulaire)

  // Week-ends et fériés : grisés, jamais interdits.
  const grise = !jour.isWorking || jour.isHoliday

  return (
    <button
      type="button"
      data-testid={`case-${jour.date}`}
      aria-label={`${label} le ${jour.date} — ${description(etat, slots)}`}
      title={description(etat, slots)}
      {...appuiLong.handlers}
      onClick={() => {
        // L'appui long a déjà ouvert le formulaire : le clic qui le suit ne
        // doit pas faire avancer la case d'un cran derrière lui.
        if (appuiLong.consommerAppuiLong()) return
        onClick()
      }}
      onContextMenu={(ev) => {
        ev.preventDefault()
        onFormulaire()
      }}
      className={`flex min-h-11 min-w-11 flex-col items-center justify-center rounded border text-sm ${
        grise ? 'border-slate-200 bg-slate-100' : 'border-slate-300 bg-white'
      } ${etat.kind === 'LIBRE' && etat.eclatee ? 'ring-1 ring-amber-400' : ''} ${
        etat.kind === 'VIDE' ? 'text-slate-400' : 'text-slate-900'
      }`}
    >
      <span className="text-[10px] leading-none text-slate-500">{Number(jour.date.slice(8))}</span>
      {/* Le numéro du jour et la valeur sont deux nœuds distincts : les mêler
          rendrait « la case est vide » indistinguable de « la case affiche 10 ». */}
      <span data-testid={`valeur-${jour.date}`} className="leading-tight">
        {contenu(etat, slots, minutesParJour)}
      </span>
    </button>
  )
}
```

**Note sur le prévisionnel.** Le test « distingue le prévisionnel du réalisé » attend `italic` sur la case. `CellState` ne porte pas le `kind` : ajouter à `MonthCalendar` un ensemble des dates prévisionnelles, dérivé de `entries` et calculé dans le même `useMemo` que `serveur` :

```tsx
  const previsionnelles = useMemo(
    () =>
      new Set(
        entries.filter((e) => e.lineId === line.id && e.kind === 'PREVISIONNEL').map((e) => e.date),
      ),
    [entries, line.id],
  )
```

et passer `previsionnel={previsionnelles.has(jour.date)}` à `Case`, qui ajoute `previsionnel ? 'italic text-slate-500' : ''` à ses classes. Le `kind` reste hors de la cinématique : il décrit comment la case s'affiche, jamais ce que le clic suivant écrit.

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/components/calendar/`
Expected: PASS — 5 tests dans `useLongPress.test.ts`, 21 dans `MonthCalendar.test.tsx`

- [ ] **Step 8: Vérifier qu'aucune règle métier n'a fui dans la vue**

```bash
grep -nE "capacityMinutes|checkCapacity|computeEngagement|minutesToCentiemes|centiemesToMinutes|isLocked" src/components/calendar/
```
Expected: aucune correspondance.

- [ ] **Step 9: Commit**

```bash
git add src/components/calendar/
git commit -m "feat(calendrier): grille mensuelle et cinematique au clic"
```

---

## Task 7: Le formulaire de valeur libre

**Files:** Create `src/components/calendar/CellForm.tsx`, `src/components/calendar/CellForm.test.tsx`

**Interfaces:**
- Consumes: `CellState`, `isSlotAllowed`, `parseQuantity`, `Slot`, `LineForGrid`
- Produces:
  ```ts
  CellForm(props: {
    date: string
    etat: CellState
    line: LineForGrid
    slots: Slot[]
    onSubmit: (minutes: number, slotId: string) => void
    onDelete: () => void
    onCancel: () => void
  })
  ```

**Le point du lot.** C'est ici que `allowedSlotIds` se voit : un créneau non autorisé reste **choisissable**, marqué et accompagné d'un avertissement. Le désactiver serait un refus, et la spec dit signalement.

- [ ] **Step 1: Écrire le test qui échoue**

`src/components/calendar/CellForm.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CellForm } from './CellForm'
import { DEFAULT_SLOTS } from '@/services/settings'
import type { LineForGrid } from '@/services/missions'

const ligne: LineForGrid = {
  id: 'l1',
  label: 'Consultant ITSM',
  missionLabel: 'ITSM',
  clientName: 'ACME',
  displayUnit: 'JOUR',
  minutesParJour: 480,
  soldCentiemes: 3000,
  allowedSlotIds: [],
}

const ligneRestreinte: LineForGrid = { ...ligne, allowedSlotIds: ['matin', 'apres-midi'] }

function renderForm(
  overrides: Partial<React.ComponentProps<typeof CellForm>> = {},
): {
  onSubmit: ReturnType<typeof vi.fn>
  onDelete: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
} {
  const onSubmit = vi.fn()
  const onDelete = vi.fn()
  const onCancel = vi.fn()
  render(
    <CellForm
      date="2026-03-10"
      etat={{ kind: 'VIDE' }}
      line={ligne}
      slots={DEFAULT_SLOTS}
      onSubmit={onSubmit}
      onDelete={onDelete}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onDelete, onCancel }
}

function duree(): HTMLInputElement {
  return screen.getByLabelText('Durée (heures)') as HTMLInputElement
}

function creneau(): HTMLSelectElement {
  return screen.getByLabelText('Créneau') as HTMLSelectElement
}

function enregistrer(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
}

describe('CellForm', () => {
  afterEach(cleanup)

  it('rappelle la date saisie', () => {
    renderForm()
    expect(screen.getByText(/2026-03-10/)).toBeDefined()
  })

  it('part d une durée vide et de la journée entière sur une case vide', () => {
    renderForm()
    expect(duree().value).toBe('')
    expect(creneau().value).toBe('')
  })

  it('pré-remplit la durée et le créneau d une valeur libre', () => {
    renderForm({ etat: { kind: 'LIBRE', minutes: 210, slotId: 'nuit', eclatee: false } })
    expect(duree().value).toBe('3,5')
    expect(creneau().value).toBe('nuit')
  })

  it('pré-remplit une demi-journée avec ses minutes réelles', () => {
    renderForm({ etat: { kind: 'DEMI', slotId: 'matin' } })
    expect(duree().value).toBe('4')
    expect(creneau().value).toBe('matin')
  })

  it('convertit la durée saisie en minutes', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(duree(), { target: { value: '3,5' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(210, '')
  })

  it('accepte la notation en heures et minutes', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(duree(), { target: { value: '3h30' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(210, '')
  })

  it('transmet le créneau choisi', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(duree(), { target: { value: '8' } })
    fireEvent.change(creneau(), { target: { value: 'nuit' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(480, 'nuit')
  })

  it('refuse une durée inexploitable sans rien transmettre', () => {
    const { onSubmit } = renderForm()
    for (const valeur of ['', '0', '-2', 'abc', '25']) {
      fireEvent.change(duree(), { target: { value: valeur } })
      enregistrer()
    }
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('durée')
  })

  it('propose les créneaux hors des trois prédéfinis, la nuit comprise', () => {
    renderForm()
    const valeurs = Array.from(creneau().options).map((o) => o.value)
    expect(valeurs).toEqual(['', 'matin', 'apres-midi', 'nuit'])
  })

  // `allowedSlotIds` : signalement, jamais refus.
  it('signale un créneau non autorisé sans le rendre inchoisissable', () => {
    const { onSubmit } = renderForm({ line: ligneRestreinte })
    const option = Array.from(creneau().options).find((o) => o.value === 'nuit')!
    expect(option.disabled).toBe(false)
    expect(option.textContent).toContain('hors créneaux autorisés')

    fireEvent.change(duree(), { target: { value: '3' } })
    fireEvent.change(creneau(), { target: { value: 'nuit' } })
    expect(screen.getByTestId('signalement-creneau').textContent).toContain('autorisé')

    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(180, 'nuit')
  })

  it('ne signale rien sur un créneau autorisé', () => {
    renderForm({ line: ligneRestreinte })
    fireEvent.change(creneau(), { target: { value: 'matin' } })
    expect(screen.queryByTestId('signalement-creneau')).toBeNull()
  })

  it('avertit avant de remplacer une journée éclatée en plusieurs créneaux', () => {
    renderForm({ etat: { kind: 'LIBRE', minutes: 480, slotId: '', eclatee: true } })
    expect(screen.getByTestId('avertissement-eclatee').textContent).toContain('plusieurs créneaux')
  })

  it('n avertit pas sur une case ordinaire', () => {
    renderForm({ etat: { kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false } })
    expect(screen.queryByTestId('avertissement-eclatee')).toBeNull()
  })

  it('supprime la saisie sur demande', () => {
    const { onDelete } = renderForm({ etat: { kind: 'JOURNEE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la saisie' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('n offre pas de supprimer une case déjà vide', () => {
    renderForm({ etat: { kind: 'VIDE' } })
    expect(screen.queryByRole('button', { name: 'Supprimer la saisie' })).toBeNull()
  })

  it('annule sans rien transmettre', () => {
    const { onSubmit, onCancel, onDelete } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/components/calendar/CellForm.test.tsx`
Expected: FAIL — `Failed to resolve import "./CellForm"`

- [ ] **Step 3: Écrire le formulaire**

`src/components/calendar/CellForm.tsx` :

```tsx
'use client'

import { useState } from 'react'
import { isSlotAllowed } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import { cellStateToWrite } from '@/core/saisie/cell-state'
import { parseQuantity } from '@/core/time/units'
import type { Slot } from '@/core/time/slots'
import type { LineForGrid } from '@/services/missions'

/** Durée initiale, en heures, telle que le champ l'affiche. */
function dureeInitiale(etat: CellState, minutesParJour: number, slots: Slot[]): string {
  if (etat.kind === 'VIDE') return ''
  const minutes = cellStateToWrite(etat, { minutesParJour, slots }).reduce(
    (somme, e) => somme + e.minutes,
    0,
  )
  if (minutes === 0) return ''
  return String(Math.round((minutes / 60) * 100) / 100).replace('.', ',')
}

function creneauInitial(etat: CellState): string {
  if (etat.kind === 'DEMI') return etat.slotId
  if (etat.kind === 'LIBRE') return etat.slotId
  return ''
}

/**
 * Saisie d'une durée libre et d'un créneau, ouverte par appui long ou clic droit.
 *
 * Un créneau non autorisé par la prestation reste choisissable : la spec parle
 * de signalement, pas de refus. Le désactiver reviendrait à interdire à
 * l'utilisateur de décrire ce qu'il a réellement fait.
 */
export function CellForm({
  date,
  etat,
  line,
  slots,
  onSubmit,
  onDelete,
  onCancel,
}: {
  /** 'YYYY-MM-DD' */
  date: string
  etat: CellState
  line: LineForGrid
  slots: Slot[]
  onSubmit: (minutes: number, slotId: string) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [heures, setHeures] = useState(() => dureeInitiale(etat, line.minutesParJour, slots))
  const [slotId, setSlotId] = useState(() => creneauInitial(etat))
  const [erreur, setErreur] = useState<string | null>(null)

  const creneauSignale = !isSlotAllowed(slotId, line.allowedSlotIds)
  const eclatee = etat.kind === 'LIBRE' && etat.eclatee

  function valider(): void {
    const minutes = parseQuantity(heures, 'HEURE', line.minutesParJour)
    if (minutes === null || minutes <= 0 || minutes > 1440) {
      setErreur('Indiquez une durée comprise entre 1 minute et 24 heures.')
      return
    }
    setErreur(null)
    onSubmit(minutes, slotId)
  }

  return (
    <div
      role="dialog"
      aria-label={`Saisie libre du ${date}`}
      className="mt-3 rounded border border-slate-300 bg-white p-3 text-sm"
    >
      <p className="mb-2 font-medium">Saisie du {date}</p>

      {eclatee && (
        <p
          data-testid="avertissement-eclatee"
          className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800"
        >
          Cette journée est saisie en plusieurs créneaux. Enregistrer la remplacera par une
          seule saisie.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col">
          Durée (heures)
          <input
            aria-label="Durée (heures)"
            value={heures}
            onChange={(ev) => setHeures(ev.target.value)}
            placeholder="3,5 ou 3h30"
            className="w-32 rounded border border-slate-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col">
          Créneau
          <select
            aria-label="Créneau"
            value={slotId}
            onChange={(ev) => setSlotId(ev.target.value)}
            className="w-52 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">Journée entière</option>
            {slots.map((s) => (
              <option key={s.id} value={s.id}>
                {isSlotAllowed(s.id, line.allowedSlotIds)
                  ? s.label
                  : `${s.label} (hors créneaux autorisés)`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {creneauSignale && (
        <p
          data-testid="signalement-creneau"
          className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800"
        >
          Ce créneau n’est pas autorisé sur cette prestation. La saisie sera tout de même
          enregistrée.
        </p>
      )}

      {erreur !== null && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {erreur}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={valider}
          className="rounded bg-slate-800 px-3 py-1 text-white"
        >
          Enregistrer
        </button>
        {etat.kind !== 'VIDE' && (
          <button type="button" onClick={onDelete} className="rounded border border-slate-300 px-3 py-1">
            Supprimer la saisie
          </button>
        )}
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-1">
          Annuler
        </button>
      </div>
    </div>
  )
}
```

**Vérification des valeurs attendues.** `DEMI matin` avec `minutesParJour = 480` donne 240 minutes, soit `4` heures — d'où `duree().value === '4'`. `LIBRE 210` donne 3,5 → `'3,5'`. `parseQuantity('25', 'HEURE', 480)` rend 1500, au-delà de 1440 : refusé.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/components/calendar/CellForm.test.tsx`
Expected: PASS — 16 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/
git commit -m "feat(calendrier): formulaire de valeur libre et signalement de creneau"
```

---

## Task 8: Tout le mois, couleurs et sélection par glissement

**Files:** Modify `src/components/calendar/MonthCalendar.tsx`, `src/components/calendar/MonthCalendar.test.tsx`

**Interfaces:**
- Consumes: `colorForLine`, `useDragSelect` *(réutilisé tel quel depuis `src/components/grid/`, non modifié)*
- Produces: `MonthCalendar` gagne trois propriétés
  ```ts
  autresLignes: LineForGrid[]     // affichées en lecture seule quand `toutLeMois`
  toutLeMois: boolean
  onRange: (dates: string[], state: CellState) => Promise<void>
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `src/components/calendar/MonthCalendar.test.tsx` — et compléter `renderCalendar` avec les trois nouvelles propriétés par défaut (`autresLignes={[]}`, `toutLeMois={false}`, `onRange={vi.fn(async () => {})}`), ainsi que le `rerender` explicite du test « reprend les saisies du serveur » :

```tsx
const ligneB: LineForGrid = {
  ...ligneJour,
  id: 'lB',
  label: 'Consultant ITSM Nuit',
  soldCentiemes: 1000,
}

const surLigneB: MonthEntry[] = [
  { id: 'b1', lineId: 'lB', date: '2026-03-10', minutes: 480, kind: 'REALISE', slotId: '', minutesParJour: 480 },
]

describe('Cette prestation ou tout le mois', () => {
  it('n affiche que la prestation sélectionnée par défaut', () => {
    renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: false })
    expect(screen.queryByTestId('autre-lB-2026-03-10')).toBeNull()
  })

  it('affiche les autres prestations en mode « Tout le mois »', () => {
    renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true })
    const badge = screen.getByTestId('autre-lB-2026-03-10')
    expect(badge.textContent).toContain('Consultant ITSM Nuit')
  })

  it('rend les autres prestations non cliquables', async () => {
    const onApply = vi.fn(async () => true)
    renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true, onApply })

    const badge = screen.getByTestId('autre-lB-2026-03-10')
    // Un élément non interactif ne peut pas devenir cliquable par accident.
    expect(badge.tagName).toBe('SPAN')
    fireEvent.click(badge)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('laisse la prestation sélectionnée cliquable en mode « Tout le mois »', async () => {
    const onApply = vi.fn(async () => true)
    renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true, onApply })

    fireEvent.click(caseDu('2026-03-11'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-11', { kind: 'JOURNEE' }))
  })

  it('n affiche pas d autre prestation les jours où elle n a rien saisi', () => {
    renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true })
    expect(screen.queryByTestId('autre-lB-2026-03-11')).toBeNull()
  })

  it('donne à une prestation la même couleur entre deux chargements', () => {
    renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true })
    const premiere = screen.getByTestId('autre-lB-2026-03-10').className
    cleanup()

    // Second chargement : la liste des prestations a changé d'ordre et de taille.
    renderCalendar({
      entries: surLigneB,
      autresLignes: [{ ...ligneJour, id: 'lZ', label: 'Autre' }, ligneB],
      toutLeMois: true,
    })
    expect(screen.getByTestId('autre-lB-2026-03-10').className).toBe(premiere)
  })
})

describe('sélection par glissement', () => {
  function glisser(de: string, versLesDates: string[]): void {
    fireEvent.mouseDown(caseDu(de))
    for (const date of versLesDates) fireEvent.mouseEnter(caseDu(date))
    fireEvent.mouseUp(caseDu(versLesDates[versLesDates.length - 1] ?? de))
  }

  it('n affiche aucune barre tant qu un seul jour est sélectionné', () => {
    renderCalendar()
    glisser('2026-03-09', [])
    expect(screen.queryByTestId('barre-selection')).toBeNull()
  })

  it('propose d appliquer une valeur à toute la plage', () => {
    renderCalendar()
    glisser('2026-03-09', ['2026-03-10', '2026-03-11'])

    const barre = screen.getByTestId('barre-selection')
    expect(barre.textContent).toContain('3 jours')
    expect(screen.getByRole('button', { name: '1 jour' })).toBeDefined()
    expect(screen.getByRole('button', { name: '½ Matin' })).toBeDefined()
    expect(screen.getByRole('button', { name: '½ Après-midi' })).toBeDefined()
  })

  it('applique la valeur choisie à tous les jours de la plage', async () => {
    const onRange = vi.fn(async () => {})
    renderCalendar({ onRange })
    glisser('2026-03-09', ['2026-03-10', '2026-03-11'])

    fireEvent.click(screen.getByRole('button', { name: '1 jour' }))
    await waitFor(() =>
      expect(onRange).toHaveBeenCalledWith(
        ['2026-03-09', '2026-03-10', '2026-03-11'],
        { kind: 'JOURNEE' },
      ),
    )
  })

  it('vide toute la plage sur demande', async () => {
    const onRange = vi.fn(async () => {})
    renderCalendar({ onRange })
    glisser('2026-03-09', ['2026-03-10'])

    fireEvent.click(screen.getByRole('button', { name: 'Vider ces jours' }))
    await waitFor(() =>
      expect(onRange).toHaveBeenCalledWith(['2026-03-09', '2026-03-10'], { kind: 'VIDE' }),
    )
  })

  it('referme la barre sans rien appliquer sur Annuler', () => {
    const onRange = vi.fn(async () => {})
    renderCalendar({ onRange })
    glisser('2026-03-09', ['2026-03-10'])

    fireEvent.click(screen.getByRole('button', { name: 'Annuler la sélection' }))
    expect(screen.queryByTestId('barre-selection')).toBeNull()
    expect(onRange).not.toHaveBeenCalled()
  })

  it('n offre aucune demi-journée quand la prestation n en propose pas', () => {
    renderCalendar({ line: { ...ligneJour, allowedSlotIds: ['nuit'] } })
    glisser('2026-03-09', ['2026-03-10'])

    expect(screen.queryByRole('button', { name: '½ Matin' })).toBeNull()
    expect(screen.getByRole('button', { name: '1 jour' })).toBeDefined()
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/components/calendar/MonthCalendar.test.tsx`
Expected: FAIL — propriétés inconnues, `autre-lB-2026-03-10` et `barre-selection` introuvables

- [ ] **Step 3: Ajouter le mode « Tout le mois »**

Dans `src/components/calendar/MonthCalendar.tsx`, ajouter aux propriétés :

```tsx
  /** autres prestations, affichées en lecture seule quand `toutLeMois` */
  autresLignes: LineForGrid[]
  toutLeMois: boolean
  onRange: (dates: string[], state: CellState) => Promise<void>
```

et calculer les occupations des autres prestations :

```tsx
  // Les autres prestations ne servent qu'à voir si un jour est déjà pris
  // ailleurs : on n'a besoin que de leur présence, jamais de leur détail.
  const autresParDate = useMemo(() => {
    if (!toutLeMois) return new Map<string, LineForGrid[]>()

    const parId = new Map(autresLignes.map((l) => [l.id, l]))
    const parDate = new Map<string, LineForGrid[]>()
    for (const e of entries) {
      const autre = parId.get(e.lineId)
      if (autre === undefined || e.minutes === 0) continue
      const bucket = parDate.get(e.date)
      if (bucket === undefined) parDate.set(e.date, [autre])
      else if (!bucket.some((l) => l.id === autre.id)) bucket.push(autre)
    }
    return parDate
  }, [toutLeMois, autresLignes, entries])
```

`Case` — le même composant qu'à la tâche 6, sans changement de nom — gagne trois propriétés :

```tsx
  /** autres prestations occupant ce jour, en lecture seule */
  autres: LineForGrid[]
  selected: boolean
  dragHandlers: { onMouseDown: () => void; onMouseEnter: () => void; onMouseUp: () => void }
```

Son `return` enveloppe le bouton existant dans un conteneur ; les autres prestations sont rendues **hors du bouton**, pour qu'aucune d'elles ne puisse devenir cliquable :

```tsx
  return (
    <div className="flex flex-col gap-0.5">
      <button /* … la case cliquable de la tâche 6, plus les handlers de glissement … */ />
      {autres.map((a) => {
        const couleur = colorForLine(a.id)
        return (
          <span
            key={a.id}
            data-testid={`autre-${a.id}-${jour.date}`}
            title={`${a.label} — lecture seule`}
            className={`truncate rounded px-1 text-[10px] ${couleur.bg} ${couleur.text}`}
          >
            {a.label}
          </span>
        )
      })}
    </div>
  )
```

Et `MonthCalendar` passe `autres={autresParDate.get(jour.date) ?? []}` à chaque case.

La couleur vient de `colorForLine(a.id)` — jamais du rang dans `autresLignes`, ce qui la rendrait instable dès qu'une prestation est ajoutée ou archivée.

- [ ] **Step 4: Ajouter la sélection par glissement**

Toujours dans `MonthCalendar.tsx`, réutiliser le hook du lot 1a **sans le modifier** :

```tsx
import { useDragSelect } from '@/components/grid/useDragSelect'

  // `useDragSelect` applique une chaîne brute dans la vue tableau ; ici on ne
  // se sert que de la plage qu'il calcule, l'état à appliquer venant des
  // boutons de la barre.
  const drag = useDragSelect(() => {})
  const plage = drag.selection?.dates ?? []
  const barreVisible = plage.length > 1
```

`MonthCalendar` passe à chaque case :

```tsx
      selected={drag.isSelected(line.id, jour.date)}
      dragHandlers={{
        onMouseDown: () => drag.handlers.onMouseDown(line.id, jour.date),
        onMouseEnter: () => drag.handlers.onMouseEnter(line.id, jour.date),
        onMouseUp: drag.handlers.onMouseUp,
      }}
```

et le `<button>` de `Case` les étale (`{...dragHandlers}`) puis ajoute à ses classes
`selected ? 'ring-2 ring-inset ring-blue-400' : ''`.

La barre, rendue sous la grille :

```tsx
      {barreVisible && (
        <div
          data-testid="barre-selection"
          className="mt-2 flex flex-wrap items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
        >
          <span className="font-medium">{plage.length} jours sélectionnés</span>
          <button type="button" onClick={() => void appliquerPlage({ kind: 'JOURNEE' })} className={BOUTON}>
            1 jour
          </button>
          {options.demiSlotIds.map((slotId) => (
            <button
              key={slotId}
              type="button"
              onClick={() => void appliquerPlage({ kind: 'DEMI', slotId })}
              className={BOUTON}
            >
              ½ {libelleSlot(slotId, slots)}
            </button>
          ))}
          <button type="button" onClick={() => void appliquerPlage({ kind: 'VIDE' })} className={BOUTON}>
            Vider ces jours
          </button>
          <button type="button" onClick={drag.clear} className={BOUTON}>
            Annuler la sélection
          </button>
        </div>
      )}
```

avec, au-dessus du rendu :

```tsx
  const BOUTON = 'rounded border border-slate-300 bg-white px-2 py-1'

  const appliquerPlage = useCallback(
    async (state: CellState) => {
      const dates = drag.selection?.dates ?? []
      drag.clear()
      if (dates.length === 0) return
      // Optimiste sur toute la plage, comme sur une case seule.
      setOptimiste((prev) => {
        const suivant = new Map(prev)
        for (const date of dates) suivant.set(date, state)
        return suivant
      })
      await onRange(dates, state)
    },
    [drag, onRange],
  )
```

**Pourquoi la plage ne rejoue pas la cinématique.** Appliquer « le cran suivant » à trente jours dont les états diffèrent produirait trente résultats différents pour un seul geste. La barre nomme la valeur ; le geste choisit les jours.

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/components/calendar/MonthCalendar.test.tsx`
Expected: PASS — 33 tests, dont les 21 de la tâche 6 inchangés

- [ ] **Step 6: Vérifier que le hook partagé n'a pas bougé**

Run: `npx vitest run src/components/grid/`
Expected: PASS — `useDragSelect.test.ts` et `MonthGrid.test.tsx` intacts

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/
git commit -m "feat(calendrier): tout le mois en lecture seule et selection par glissement"
```

---

## Task 9: Les trois sélecteurs, mémorisés

**Files:** Create `src/core/saisie/selection.ts`, `src/core/saisie/selection.test.ts`, `src/components/calendar/selection-storage.ts`, `src/components/calendar/LineSelector.tsx`, `src/components/calendar/LineSelector.test.tsx`

**Interfaces:**
- Consumes: rien de nouveau ; `core/` déclare sa propre forme structurelle plutôt que d'importer `LineForGrid` d'un service
- Produces:
  - `interface SelectableLine { id: string; label: string; missionLabel: string; clientName: string }`
  - `clientsOf(lines): string[]`, `missionsOf(lines, clientName): string[]`, `linesOf(lines, clientName, missionLabel): SelectableLine[]`
  - `resolveSelection(lines, memorise: string | null): { clientName: string; missionLabel: string; lineId: string } | null`
  - `readSelection(): string | null`, `writeSelection(lineId: string): void`
  - `LineSelector(props: { lines: LineForGrid[]; lineId: string; onChange: (lineId: string) => void })`

- [ ] **Step 1: Écrire le test du cœur**

`src/core/saisie/selection.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { clientsOf, missionsOf, linesOf, resolveSelection } from './selection'
import type { SelectableLine } from './selection'

// Le cas de la spec : une mission portant deux prestations qu'on distingue au
// sélecteur, jamais en devinant à quelle ligne appartient une case.
const LIGNES: SelectableLine[] = [
  { id: 'l1', label: 'Consultant ITSM', missionLabel: 'ITSM', clientName: 'ACME' },
  { id: 'l2', label: 'Consultant ITSM Nuit', missionLabel: 'ITSM', clientName: 'ACME' },
  { id: 'l3', label: 'Audit', missionLabel: 'Audit 2026', clientName: 'ACME' },
  { id: 'l4', label: 'Run', missionLabel: 'Infogérance', clientName: 'BETA' },
]

describe('clientsOf', () => {
  it('dédoublonne en gardant l ordre d arrivée', () => {
    expect(clientsOf(LIGNES)).toEqual(['ACME', 'BETA'])
  })

  it('rend une liste vide sans prestation', () => {
    expect(clientsOf([])).toEqual([])
  })
})

describe('missionsOf', () => {
  it('ne rend que les missions du client demandé', () => {
    expect(missionsOf(LIGNES, 'ACME')).toEqual(['ITSM', 'Audit 2026'])
    expect(missionsOf(LIGNES, 'BETA')).toEqual(['Infogérance'])
  })

  it('rend une liste vide pour un client inconnu', () => {
    expect(missionsOf(LIGNES, 'GAMMA')).toEqual([])
  })
})

describe('linesOf', () => {
  it('rend les deux prestations d une même mission', () => {
    expect(linesOf(LIGNES, 'ACME', 'ITSM').map((l) => l.id)).toEqual(['l1', 'l2'])
  })

  it('ne franchit jamais la frontière du client', () => {
    expect(linesOf(LIGNES, 'BETA', 'ITSM')).toEqual([])
  })
})

describe('resolveSelection', () => {
  it('retombe sur la sélection mémorisée', () => {
    expect(resolveSelection(LIGNES, 'l3')).toEqual({
      clientName: 'ACME',
      missionLabel: 'Audit 2026',
      lineId: 'l3',
    })
  })

  it('retombe sur la première prestation quand rien n est mémorisé', () => {
    expect(resolveSelection(LIGNES, null)).toEqual({
      clientName: 'ACME',
      missionLabel: 'ITSM',
      lineId: 'l1',
    })
  })

  it('retombe sur la première prestation quand la mémoire pointe une prestation disparue', () => {
    // Prestation archivée, affectation retirée : la mémoire ne doit pas rendre
    // l'écran inutilisable.
    expect(resolveSelection(LIGNES, 'supprimee')?.lineId).toBe('l1')
  })

  it('rend null quand l utilisateur n a aucune prestation', () => {
    expect(resolveSelection([], 'l1')).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/saisie/selection.test.ts`
Expected: FAIL — `Failed to resolve import "./selection"`

- [ ] **Step 3: Écrire le cœur**

`src/core/saisie/selection.ts` :

```ts
/**
 * Forme minimale d'une prestation pour les sélecteurs.
 *
 * Déclarée ici plutôt qu'importée de `services/missions` : `core/` ne dépend
 * d'aucune couche au-dessus de lui. `LineForGrid` la satisfait structurellement.
 */
export interface SelectableLine {
  id: string
  label: string
  missionLabel: string
  clientName: string
}

export interface Selection {
  clientName: string
  missionLabel: string
  lineId: string
}

function uniques(valeurs: readonly string[]): string[] {
  return [...new Set(valeurs)]
}

export function clientsOf(lines: readonly SelectableLine[]): string[] {
  return uniques(lines.map((l) => l.clientName))
}

export function missionsOf(lines: readonly SelectableLine[], clientName: string): string[] {
  return uniques(lines.filter((l) => l.clientName === clientName).map((l) => l.missionLabel))
}

export function linesOf(
  lines: readonly SelectableLine[],
  clientName: string,
  missionLabel: string,
): SelectableLine[] {
  return lines.filter((l) => l.clientName === clientName && l.missionLabel === missionLabel)
}

/**
 * La sélection à ouvrir : celle qu'on a quittée, ou la première disponible.
 *
 * Une mémoire qui pointe une prestation archivée ou désaffectée ne doit jamais
 * bloquer l'écran : on retombe silencieusement sur la première.
 */
export function resolveSelection(
  lines: readonly SelectableLine[],
  memorise: string | null,
): Selection | null {
  const ligne = lines.find((l) => l.id === memorise) ?? lines[0]
  if (ligne === undefined) return null
  return { clientName: ligne.clientName, missionLabel: ligne.missionLabel, lineId: ligne.id }
}
```

- [ ] **Step 4: Écrire le test des sélecteurs**

`src/components/calendar/LineSelector.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LineSelector } from './LineSelector'
import { readSelection, writeSelection } from './selection-storage'
import type { LineForGrid } from '@/services/missions'

function ligne(over: Partial<LineForGrid>): LineForGrid {
  return {
    id: 'l1', label: 'Consultant ITSM', missionLabel: 'ITSM', clientName: 'ACME',
    displayUnit: 'JOUR', minutesParJour: 480, soldCentiemes: 3000, allowedSlotIds: [], ...over,
  }
}

const lines: LineForGrid[] = [
  ligne({}),
  ligne({ id: 'l2', label: 'Consultant ITSM Nuit' }),
  ligne({ id: 'l3', label: 'Run', missionLabel: 'Infogérance', clientName: 'BETA' }),
  ligne({ id: 'l4', label: 'Audit', missionLabel: 'Audit 2026' }),
]

function client(): HTMLSelectElement {
  return screen.getByLabelText('Client') as HTMLSelectElement
}
function mission(): HTMLSelectElement {
  return screen.getByLabelText('Mission') as HTMLSelectElement
}
function prestation(): HTMLSelectElement {
  return screen.getByLabelText('Prestation') as HTMLSelectElement
}

describe('selection-storage', () => {
  beforeEach(() => window.localStorage.clear())

  it('ne rend rien avant toute mémorisation', () => {
    expect(readSelection()).toBeNull()
  })

  it('relit ce qu il a écrit', () => {
    writeSelection('l2')
    expect(readSelection()).toBe('l2')
  })
})

describe('LineSelector', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(cleanup)

  it('affiche les trois sélecteurs', () => {
    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    expect(client()).toBeDefined()
    expect(mission()).toBeDefined()
    expect(prestation()).toBeDefined()
  })

  it('positionne les trois sélecteurs sur la prestation sélectionnée', () => {
    render(<LineSelector lines={lines} lineId="l3" onChange={vi.fn()} />)
    expect(client().value).toBe('BETA')
    expect(mission().value).toBe('Infogérance')
    expect(prestation().value).toBe('l3')
  })

  it('offre les deux prestations d une même mission', () => {
    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    expect(Array.from(prestation().options).map((o) => o.value)).toEqual(['l1', 'l2'])
  })

  it('ne propose que les missions du client choisi', () => {
    render(<LineSelector lines={lines} lineId="l3" onChange={vi.fn()} />)
    expect(Array.from(mission().options).map((o) => o.value)).toEqual(['Infogérance'])
    cleanup()

    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    expect(Array.from(mission().options).map((o) => o.value)).toEqual(['ITSM', 'Audit 2026'])
  })

  it('bascule sur la première prestation du client choisi', () => {
    const onChange = vi.fn()
    render(<LineSelector lines={lines} lineId="l1" onChange={onChange} />)

    fireEvent.change(client(), { target: { value: 'BETA' } })
    expect(onChange).toHaveBeenCalledWith('l3')
  })

  it('bascule sur la première prestation de la mission choisie', () => {
    const onChange = vi.fn()
    render(<LineSelector lines={lines} lineId="l1" onChange={onChange} />)

    fireEvent.change(mission(), { target: { value: 'Audit 2026' } })
    expect(onChange).toHaveBeenCalledWith('l4')
  })

  it('revient sur la première prestation en changeant de client', () => {
    const onChange = vi.fn()
    render(<LineSelector lines={lines} lineId="l3" onChange={onChange} />)

    fireEvent.change(client(), { target: { value: 'ACME' } })
    expect(onChange).toHaveBeenCalledWith('l1')
  })

  it('transmet le changement de prestation', () => {
    const onChange = vi.fn()
    render(<LineSelector lines={lines} lineId="l1" onChange={onChange} />)

    fireEvent.change(prestation(), { target: { value: 'l2' } })
    expect(onChange).toHaveBeenCalledWith('l2')
  })

  it('mémorise la prestation choisie', () => {
    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    fireEvent.change(prestation(), { target: { value: 'l2' } })
    expect(readSelection()).toBe('l2')
  })

  // Écrire au montage écraserait la mémoire avec la valeur par défaut avant
  // que la page ait eu le temps de la relire : les effets de l'enfant partent
  // toujours avant ceux du parent.
  it('n écrit rien au simple affichage', () => {
    window.localStorage.setItem('cra.saisie.prestation', 'l2')
    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    expect(readSelection()).toBe('l2')
  })

  it('le dit quand l utilisateur n a aucune prestation', () => {
    render(<LineSelector lines={[]} lineId="" onChange={vi.fn()} />)
    expect(screen.getByText(/aucune prestation/i)).toBeDefined()
  })
})
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/components/calendar/LineSelector.test.tsx`
Expected: FAIL — `Failed to resolve import "./LineSelector"`

- [ ] **Step 6: Écrire la mémorisation et les sélecteurs**

`src/components/calendar/selection-storage.ts` :

```ts
'use client'

const CLE = 'cra.saisie.prestation'

/**
 * Dernière prestation saisie.
 *
 * Une préférence d'affichage, pas une donnée métier : le stockage local
 * suffit, et l'absence de `window` (rendu serveur) n'est jamais une erreur.
 */
export function readSelection(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(CLE)
  } catch {
    return null
  }
}

export function writeSelection(lineId: string): void {
  if (typeof window === 'undefined' || lineId === '') return
  try {
    window.localStorage.setItem(CLE, lineId)
  } catch {
    // Navigation privée, quota plein : perdre la mémoire n'empêche pas de saisir.
  }
}
```

`src/components/calendar/LineSelector.tsx` :

```tsx
'use client'

import { clientsOf, linesOf, missionsOf } from '@/core/saisie/selection'
import type { LineForGrid } from '@/services/missions'
import { writeSelection } from './selection-storage'

const SELECT = 'rounded border border-slate-300 px-2 py-1 text-sm'

/** Client → Mission → Prestation. On choisit ce qu'on saisit, puis on saisit. */
export function LineSelector({
  lines,
  lineId,
  onChange,
}: {
  lines: LineForGrid[]
  lineId: string
  onChange: (lineId: string) => void
}) {
  const trouvee = lines.find((l) => l.id === lineId)

  if (trouvee === undefined) {
    return (
      <p className="text-sm text-slate-500">
        Aucune prestation ne vous est affectée. Créez-en une depuis l’écran Missions.
      </p>
    )
  }

  // Liée après la garde : TypeScript ne conserve pas le rétrécissement d'un
  // `find` à l'intérieur des fonctions déclarées plus bas.
  const courante = trouvee

  /**
   * On ne mémorise que ce que l'utilisateur choisit, jamais ce qu'il regarde :
   * écrire au montage écraserait la mémoire avec la valeur par défaut avant
   * que la page ait eu le temps de la relire — les effets de l'enfant partent
   * toujours avant ceux du parent.
   */
  function choisir(id: string): void {
    writeSelection(id)
    onChange(id)
  }

  function choisirClient(clientName: string): void {
    const mission = missionsOf(lines, clientName)[0] ?? ''
    const premiere = linesOf(lines, clientName, mission)[0]
    if (premiere !== undefined) choisir(premiere.id)
  }

  function choisirMission(missionLabel: string): void {
    const premiere = linesOf(lines, courante.clientName, missionLabel)[0]
    if (premiere !== undefined) choisir(premiere.id)
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex flex-col text-xs text-slate-600">
        Client
        <select
          aria-label="Client"
          value={courante.clientName}
          onChange={(ev) => choisirClient(ev.target.value)}
          className={SELECT}
        >
          {clientsOf(lines).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-xs text-slate-600">
        Mission
        <select
          aria-label="Mission"
          value={courante.missionLabel}
          onChange={(ev) => choisirMission(ev.target.value)}
          className={SELECT}
        >
          {missionsOf(lines, courante.clientName).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-xs text-slate-600">
        Prestation
        <select
          aria-label="Prestation"
          value={courante.id}
          onChange={(ev) => choisir(ev.target.value)}
          className={SELECT}
        >
          {linesOf(lines, courante.clientName, courante.missionLabel).map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/core/saisie/selection.test.ts src/components/calendar/LineSelector.test.tsx`
Expected: PASS — 10 tests dans `selection.test.ts`, 13 dans `LineSelector.test.tsx` (2 de mémorisation, 11 de sélecteurs)

- [ ] **Step 8: Commit**

```bash
git add src/core/saisie/ src/components/calendar/
git commit -m "feat(saisie): selecteurs client-mission-prestation memorises"
```

---

## Task 10: La page de saisie — deux vues, deux portées, deux boutons

**Files:** Modify `src/app/(app)/saisie/[month]/actions.ts`, `src/app/(app)/saisie/[month]/page.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.test.tsx`

**Interfaces:**
- Consumes: `applyCellState`, `fillMonth`, `clearMonth`, `formatFillReport`, `formatClearReport`, `resolveSelection`, `readSelection`, `MonthCalendar`, `CellForm`, `LineSelector`, `MonthGrid` *(inchangé)*
- Produces:
  - `appliquerCase(args: { lineId: string; date: string; state: CellState; month: string }): Promise<CellResult>`
  - `remplirMois(args: { lineId: string; month: string }): Promise<FillReport>`
  - `viderMois(args: { lineId: string; month: string }): Promise<ClearReport>`
  - `SaisieClient` gagne `slots: Slot[]`

**Ce qui arrive aux tests existants.** `SaisieClient.test.tsx` interroge aujourd'hui les cellules de `MonthGrid` par `getByLabelText('Consultant ITSM 2026-03-12')`. La vue tableau n'étant plus la vue par défaut, ces six tests l'ouvrent d'abord par un clic sur la bascule. **Aucune assertion n'est modifiée, aucun test n'est supprimé.** `MonthGrid.test.tsx`, `useDragSelect.test.ts`, `EngagementBar.test.tsx` et `PastForecastNotice.test.tsx` rendent leurs composants directement : ils ne sont pas concernés.

**Pourquoi pas `window.confirm`.** Il bloque le fil d'exécution, n'existe pas dans happy-dom et ne se teste qu'à coups d'espion global. La confirmation est un panneau en ligne — testable, et plus supportable au pouce.

- [ ] **Step 1: Écrire les tests qui échouent**

Réécrire l'en-tête de `src/app/(app)/saisie/[month]/SaisieClient.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { buildMonthDays } from '@/core/month/build'
import { DEFAULT_SLOTS } from '@/services/settings'
import type { LineForGrid } from '@/services/missions'

const { saveCell, appliquerCase, remplirMois, viderMois } = vi.hoisted(() => ({
  saveCell: vi.fn(),
  appliquerCase: vi.fn(),
  remplirMois: vi.fn(),
  viderMois: vi.fn(),
}))
vi.mock('./actions', () => ({ saveCell, appliquerCase, remplirMois, viderMois }))

// `vi.mock` est hissé au-dessus des imports : les server actions ne sont
// jamais chargées, seul le composant l'est.
import { SaisieClient } from './SaisieClient'

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
    displayUnit: 'JOUR',
    minutesParJour: 480,
    soldCentiemes: 1000,
    allowedSlotIds: [],
  },
]

function renderClient(): void {
  render(
    <SaisieClient
      month="2026-03"
      days={buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])}
      lines={lines}
      entries={[]}
      engagementTotals={{ l1: [], l2: [] }}
      capacityMinutes={480}
      minutesParJour={480}
      slots={DEFAULT_SLOTS}
    />,
  )
}

/** La vue tableau n'est plus la vue par défaut : ces tests l'ouvrent d'abord. */
function ouvrirTableau(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Tableau' }))
}

function saisir(valeur: string): HTMLInputElement {
  const input = screen.getByLabelText('Consultant ITSM 2026-03-12') as HTMLInputElement
  fireEvent.change(input, { target: { value: valeur } })
  fireEvent.blur(input)
  return input
}
```

Puis, dans le `describe('SaisieClient')` existant, ajouter `ouvrirTableau()` juste après chaque `renderClient()` des six tests déjà là, sans toucher à leurs assertions. Exemple pour le premier :

```tsx
  it('affiche le dépassement signalé sans effacer la saisie', async () => {
    saveCell.mockResolvedValue({
      ok: true,
      minutes: 240,
      warning: { totalMinutes: 720, capacityMinutes: 480 },
    })
    renderClient()
    ouvrirTableau()
    const input = saisir('0,5')

    await waitFor(() => expect(screen.getByText(/Capacité dépassée/)).toBeDefined())
    expect(input.value).toBe('0,5')
  })
```

Et ajouter le `beforeEach` des nouvelles simulations ainsi que les tests du lot :

```tsx
  beforeEach(() => {
    saveCell.mockReset()
    appliquerCase.mockReset()
    remplirMois.mockReset()
    viderMois.mockReset()
    window.localStorage.clear()
  })

describe('SaisieClient — calendrier', () => {
  beforeEach(() => {
    appliquerCase.mockReset()
    remplirMois.mockReset()
    viderMois.mockReset()
    window.localStorage.clear()
  })
  afterEach(cleanup)

  it('ouvre la vue calendrier par défaut', () => {
    renderClient()
    expect(screen.getByTestId('grille-calendrier')).toBeDefined()
    expect(screen.queryByLabelText('Consultant ITSM 2026-03-12')).toBeNull()
  })

  it('bascule vers la vue tableau et la ramène', () => {
    renderClient()
    ouvrirTableau()
    expect(screen.getByLabelText('Consultant ITSM 2026-03-12')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Calendrier' }))
    expect(screen.getByTestId('grille-calendrier')).toBeDefined()
  })

  it('réserve la vue tableau au poste', () => {
    renderClient()
    // Sept colonnes tiennent sur un téléphone ; trente et une, non.
    expect(screen.getByRole('button', { name: 'Tableau' }).className).toContain('hidden')
    expect(screen.getByRole('button', { name: 'Tableau' }).className).toContain('md:inline-flex')
  })

  it('applique la cinématique par le server action', async () => {
    appliquerCase.mockResolvedValue({ ok: true, state: { kind: 'JOURNEE' } })
    renderClient()

    fireEvent.click(screen.getByTestId('case-2026-03-12'))
    await waitFor(() =>
      expect(appliquerCase).toHaveBeenCalledWith({
        lineId: 'l1',
        date: '2026-03-12',
        state: { kind: 'JOURNEE' },
        month: '2026-03',
      }),
    )
  })

  it('affiche le signalement d un créneau non autorisé sans effacer la saisie', async () => {
    appliquerCase.mockResolvedValue({
      ok: true,
      state: { kind: 'JOURNEE' },
      signalement: 'Créneau hors des créneaux autorisés pour cette prestation : Nuit. La saisie est conservée.',
    })
    renderClient()

    fireEvent.click(screen.getByTestId('case-2026-03-12'))
    await waitFor(() => expect(screen.getByText(/hors des créneaux autorisés/)).toBeDefined())
    expect(screen.getByTestId('valeur-2026-03-12').textContent).toBe('1')
  })

  it('affiche le refus d un mois verrouillé', async () => {
    appliquerCase.mockResolvedValue({ ok: false, reason: 'VERROUILLE' })
    renderClient()

    fireEvent.click(screen.getByTestId('case-2026-03-12'))
    await waitFor(() => expect(screen.getByText(/CRA de ce mois est validé/)).toBeDefined())
  })

  it('bascule entre « Cette prestation » et « Tout le mois »', () => {
    renderClient()
    expect(screen.getByRole('button', { name: 'Cette prestation' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Tout le mois' }))
    expect(screen.getByRole('button', { name: 'Tout le mois' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('change de prestation par le sélecteur', () => {
    renderClient()
    fireEvent.change(screen.getByLabelText('Prestation'), { target: { value: 'l2' } })
    expect((screen.getByLabelText('Prestation') as HTMLSelectElement).value).toBe('l2')
  })

  describe('Remplir le CRA', () => {
    it('rend compte de ce qui a été posé et sauté', async () => {
      remplirMois.mockResolvedValue({ poses: 18, sautesCapacite: 2, dejaSaisis: 0, verrouille: false })
      renderClient()

      fireEvent.click(screen.getByRole('button', { name: 'Remplir le CRA' }))
      await waitFor(() =>
        expect(screen.getByText('18 jours posés, 2 sautés faute de capacité.')).toBeDefined(),
      )
      expect(remplirMois).toHaveBeenCalledWith({ lineId: 'l1', month: '2026-03' })
    })

    it('dit le verrou plutôt que de laisser croire à un remplissage', async () => {
      remplirMois.mockResolvedValue({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: true })
      renderClient()

      fireEvent.click(screen.getByRole('button', { name: 'Remplir le CRA' }))
      await waitFor(() =>
        expect(screen.getByText("Le CRA de ce mois est validé : aucun jour n'a été posé.")).toBeDefined(),
      )
    })
  })

  describe('Vider le CRA', () => {
    it('demande confirmation avant de rien retirer', () => {
      renderClient()
      fireEvent.click(screen.getByRole('button', { name: 'Vider le CRA' }))

      expect(screen.getByRole('button', { name: 'Confirmer le vidage' })).toBeDefined()
      expect(viderMois).not.toHaveBeenCalled()
    })

    it('renonce sans rien retirer', () => {
      renderClient()
      fireEvent.click(screen.getByRole('button', { name: 'Vider le CRA' }))
      fireEvent.click(screen.getByRole('button', { name: 'Annuler le vidage' }))

      expect(screen.queryByRole('button', { name: 'Confirmer le vidage' })).toBeNull()
      expect(viderMois).not.toHaveBeenCalled()
    })

    it('vide et rend compte après confirmation', async () => {
      viderMois.mockResolvedValue({ supprimees: 22, verrouille: false })
      renderClient()

      fireEvent.click(screen.getByRole('button', { name: 'Vider le CRA' }))
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer le vidage' }))

      await waitFor(() => expect(screen.getByText('22 saisies retirées.')).toBeDefined())
      expect(viderMois).toHaveBeenCalledWith({ lineId: 'l1', month: '2026-03' })
    })

    it('dit le verrou', async () => {
      viderMois.mockResolvedValue({ supprimees: 0, verrouille: true })
      renderClient()

      fireEvent.click(screen.getByRole('button', { name: 'Vider le CRA' }))
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer le vidage' }))

      await waitFor(() =>
        expect(screen.getByText("Le CRA de ce mois est validé : aucune saisie n'a été retirée.")).toBeDefined(),
      )
    })
  })

  it('restaure la prestation mémorisée au montage', async () => {
    window.localStorage.setItem('cra.saisie.prestation', 'l2')
    renderClient()
    await waitFor(() =>
      expect((screen.getByLabelText('Prestation') as HTMLSelectElement).value).toBe('l2'),
    )
  })

  it('ouvre le formulaire au clic droit et l applique', async () => {
    appliquerCase.mockResolvedValue({ ok: true, state: { kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false } })
    renderClient()

    fireEvent.contextMenu(screen.getByTestId('case-2026-03-12'))
    fireEvent.change(screen.getByLabelText('Durée (heures)'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() =>
      expect(appliquerCase).toHaveBeenCalledWith({
        lineId: 'l1',
        date: '2026-03-12',
        state: { kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false },
        month: '2026-03',
      }),
    )
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run "src/app/(app)/saisie/"`
Expected: FAIL — `grille-calendrier` introuvable, `SaisieClient` n'accepte pas `slots`, `appliquerCase` non exporté

- [ ] **Step 3: Écrire les server actions**

Ajouter à `src/app/(app)/saisie/[month]/actions.ts` :

```ts
import { applyCellState, type CellResult } from '@/services/cells'
import { fillMonth, clearMonth } from '@/services/month-fill'
import type { CellState } from '@/core/saisie/cycle'
import type { ClearReport, FillReport } from '@/core/saisie/report'

/**
 * Applique un état de case.
 *
 * Le `kind` n'est jamais fourni par le client : c'est l'horloge du serveur qui
 * départage le réalisé du prévisionnel, comme pour `validerJoursPasses`.
 */
export async function appliquerCase(args: {
  lineId: string
  date: string
  state: CellState
  month: string
}): Promise<CellResult> {
  const user = await requireUser()
  const today = new Date().toISOString().slice(0, 10)

  const result = await applyCellState({
    userId: user.id,
    lineId: args.lineId,
    date: args.date,
    kind: args.date >= today ? 'PREVISIONNEL' : 'REALISE',
    state: args.state,
  })

  if (result.ok) revalidatePath(`/saisie/${args.month}`)
  return result
}

export async function remplirMois(args: { lineId: string; month: string }): Promise<FillReport> {
  const user = await requireUser()
  const report = await fillMonth({
    userId: user.id,
    lineId: args.lineId,
    month: args.month,
    today: new Date().toISOString().slice(0, 10),
  })
  revalidatePath(`/saisie/${args.month}`)
  return report
}

export async function viderMois(args: { lineId: string; month: string }): Promise<ClearReport> {
  const user = await requireUser()
  const report = await clearMonth({ userId: user.id, lineId: args.lineId, month: args.month })
  revalidatePath(`/saisie/${args.month}`)
  return report
}
```

- [ ] **Step 4: Réécrire `SaisieClient`**

`src/app/(app)/saisie/[month]/SaisieClient.tsx` :

```tsx
'use client'

import { useEffect, useState } from 'react'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { MonthCalendar } from '@/components/calendar/MonthCalendar'
import { CellForm } from '@/components/calendar/CellForm'
import { LineSelector } from '@/components/calendar/LineSelector'
import { readSelection } from '@/components/calendar/selection-storage'
import { resolveSelection } from '@/core/saisie/selection'
import { formatClearReport, formatFillReport } from '@/core/saisie/report'
import type { CellState } from '@/core/saisie/cycle'
import type { MonthDay } from '@/core/month/build'
import type { Slot } from '@/core/time/slots'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'
import { appliquerCase, remplirMois, saveCell, viderMois } from './actions'

function heures(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100).replace('.', ',')
}

const BASCULE = 'rounded border px-3 py-1 text-sm'
const ACTIF = 'border-slate-800 bg-slate-800 text-white'
const INACTIF = 'border-slate-300 bg-white text-slate-700'

export function SaisieClient(props: {
  month: string
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  engagementTotals: Record<string, LineEngagementTotals>
  capacityMinutes: number
  minutesParJour: number
  slots: Slot[]
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [vue, setVue] = useState<'CALENDRIER' | 'TABLEAU'>('CALENDRIER')
  const [toutLeMois, setToutLeMois] = useState(false)
  const [confirmationVidage, setConfirmationVidage] = useState(false)
  const [formulaire, setFormulaire] = useState<{ date: string; etat: CellState } | null>(null)

  // La sélection mémorisée ne peut être lue qu'après le montage : la lire dans
  // l'initialiseur ferait diverger le rendu serveur du rendu client.
  const [lineId, setLineId] = useState(() => resolveSelection(props.lines, null)?.lineId ?? '')
  useEffect(() => {
    const memorise = resolveSelection(props.lines, readSelection())?.lineId
    if (memorise !== undefined) setLineId(memorise)
  }, [props.lines])

  const ligne = props.lines.find((l) => l.id === lineId)

  /** Renvoie `true` quand la valeur a bien été enregistrée. — vue tableau */
  async function handleSave(lineIdCellule: string, date: string, raw: string): Promise<boolean> {
    const kind = date >= new Date().toISOString().slice(0, 10) ? 'PREVISIONNEL' : 'REALISE'
    const r = await saveCell({ lineId: lineIdCellule, date, raw, kind, month: props.month })

    if (r.ok) {
      setMessage(
        r.warning
          ? `Capacité dépassée le ${date} : ${heures(r.warning.totalMinutes)} h saisies pour ${heures(r.warning.capacityMinutes)} h disponibles. La saisie est conservée.`
          : null,
      )
      return true
    }

    if (r.reason === 'CAPACITE') {
      setMessage(
        `Capacité dépassée le ${date} : ${heures(r.totalMinutes)} h saisies pour ${heures(r.capacityMinutes)} h disponibles. La saisie est refusée.`,
      )
    } else if (r.reason === 'VERROUILLE') {
      setMessage(`Le CRA de ce mois est validé. Rouvrez-le pour modifier la saisie.`)
    } else if (r.reason === 'NON_AFFECTE') {
      setMessage(`Vous n'êtes pas affecté à cette ligne de prestation.`)
    } else {
      setMessage(`Saisie invalide.`)
    }
    return false
  }

  /** Renvoie `true` quand l'état a bien été enregistré. — vue calendrier */
  async function handleApply(date: string, state: CellState): Promise<boolean> {
    const r = await appliquerCase({ lineId, date, state, month: props.month })

    if (r.ok) {
      setMessage(
        r.signalement ??
          (r.warning
            ? `Capacité dépassée le ${date} : ${heures(r.warning.totalMinutes)} h saisies pour ${heures(r.warning.capacityMinutes)} h disponibles. La saisie est conservée.`
            : null),
      )
      return true
    }

    if (r.reason === 'CAPACITE') {
      setMessage(
        `Capacité dépassée le ${date} : ${heures(r.totalMinutes)} h saisies pour ${heures(r.capacityMinutes)} h disponibles. La saisie est refusée.`,
      )
    } else if (r.reason === 'VERROUILLE') {
      setMessage(`Le CRA de ce mois est validé. Rouvrez-le pour modifier la saisie.`)
    } else if (r.reason === 'NON_AFFECTE') {
      setMessage(`Vous n'êtes pas affecté à cette prestation.`)
    } else {
      setMessage(`Saisie invalide.`)
    }
    return false
  }

  async function handleRange(dates: string[], state: CellState): Promise<void> {
    for (const date of dates) await handleApply(date, state)
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={vue === 'CALENDRIER'}
          onClick={() => setVue('CALENDRIER')}
          className={`${BASCULE} ${vue === 'CALENDRIER' ? ACTIF : INACTIF}`}
        >
          Calendrier
        </button>
        {/* Sept colonnes tiennent sur un téléphone ; trente et une, non. */}
        <button
          type="button"
          aria-pressed={vue === 'TABLEAU'}
          onClick={() => setVue('TABLEAU')}
          className={`hidden md:inline-flex ${BASCULE} ${vue === 'TABLEAU' ? ACTIF : INACTIF}`}
        >
          Tableau
        </button>

        <span className="mx-2 h-5 w-px bg-slate-300" aria-hidden="true" />

        <button
          type="button"
          aria-pressed={!toutLeMois}
          onClick={() => setToutLeMois(false)}
          className={`${BASCULE} ${toutLeMois ? INACTIF : ACTIF}`}
        >
          Cette prestation
        </button>
        <button
          type="button"
          aria-pressed={toutLeMois}
          onClick={() => setToutLeMois(true)}
          className={`${BASCULE} ${toutLeMois ? ACTIF : INACTIF}`}
        >
          Tout le mois
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <LineSelector lines={props.lines} lineId={lineId} onChange={setLineId} />

        {ligne !== undefined && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                setMessage(formatFillReport(await remplirMois({ lineId, month: props.month })))
              }}
              className={`${BASCULE} ${INACTIF}`}
            >
              Remplir le CRA
            </button>
            <button
              type="button"
              onClick={() => setConfirmationVidage(true)}
              className={`${BASCULE} ${INACTIF}`}
            >
              Vider le CRA
            </button>
          </div>
        )}
      </div>

      {/* C'est destructeur et ça doit se dire. */}
      {confirmationVidage && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="mb-2">
            Retirer toutes les saisies de « {ligne?.label} » sur {props.month} ? Cette action est
            irréversible.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                setConfirmationVidage(false)
                setMessage(formatClearReport(await viderMois({ lineId, month: props.month })))
              }}
              className="rounded border border-red-400 bg-white px-3 py-1"
            >
              Confirmer le vidage
            </button>
            <button
              type="button"
              onClick={() => setConfirmationVidage(false)}
              className="rounded border border-slate-300 bg-white px-3 py-1"
            >
              Annuler le vidage
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {message}
        </p>
      )}

      {vue === 'CALENDRIER' && ligne !== undefined && (
        <>
          <MonthCalendar
            days={props.days}
            line={ligne}
            slots={props.slots}
            entries={props.entries}
            autresLignes={props.lines.filter((l) => l.id !== ligne.id)}
            toutLeMois={toutLeMois}
            onApply={handleApply}
            onRange={handleRange}
            onFormulaire={(date, etat) => setFormulaire({ date, etat })}
          />
          {formulaire !== null && (
            <CellForm
              date={formulaire.date}
              etat={formulaire.etat}
              line={ligne}
              slots={props.slots}
              onSubmit={async (minutes, slotId) => {
                setFormulaire(null)
                await handleApply(formulaire.date, {
                  kind: 'LIBRE', minutes, slotId, eclatee: false,
                })
              }}
              onDelete={async () => {
                setFormulaire(null)
                await handleApply(formulaire.date, { kind: 'VIDE' })
              }}
              onCancel={() => setFormulaire(null)}
            />
          )}
        </>
      )}

      {vue === 'TABLEAU' && (
        <MonthGrid
          days={props.days}
          lines={props.lines}
          entries={props.entries}
          engagementTotals={props.engagementTotals}
          capacityMinutes={props.capacityMinutes}
          minutesParJour={props.minutesParJour}
          onSave={handleSave}
        />
      )}
    </>
  )
}
```

- [ ] **Step 5: Passer les créneaux depuis la page**

Dans `src/app/(app)/saisie/[month]/page.tsx`, ajouter `slots={settings.slots}` à `<SaisieClient …>`. La page ne change pas autrement : elle interroge déjà les services et jamais Prisma.

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run "src/app/(app)/saisie/"`
Expected: PASS — les 6 tests d'origine de `SaisieClient.test.tsx` plus 16 nouveaux, `actions.test.ts` et `PastForecastNotice.test.tsx` inchangés

- [ ] **Step 7: Vérifier la suite complète et les types**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, aucun des 307 tests d'origine perdu, `tsc` à 0

- [ ] **Step 8: Vérifier qu'aucune règle métier n'a fui dans la vue**

```bash
grep -rnE "checkCapacity|computeEngagement|minutesToCentiemes|centiemesToMinutes|isLocked|resolveMinutesParJour" src/components/calendar/
```
Expected: aucune correspondance — `CellForm` n'utilise que `parseQuantity` et `cellStateToWrite`, qui sont des conversions d'affichage, pas des règles.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(saisie): vue calendrier par defaut, vue tableau en seconde vue"
```

---

## Task 11: PWA — manifeste, icône, coquille en cache

**Files:** Create `public/manifest.webmanifest`, `public/icon.svg`, `public/sw.js`, `src/components/pwa/RegisterServiceWorker.tsx`, `src/components/pwa/RegisterServiceWorker.test.tsx`, `src/app/pwa.test.ts`. Modify `src/app/layout.tsx`

**Interfaces:**
- Consumes: rien
- Produces: `RegisterServiceWorker()` — composant client sans rendu

**Ce que ce lot ne fait pas.** Le fonctionnement **hors ligne** relève du lot 5 : il demande une file locale et un arbitrage au retour du réseau. Le service worker ne touche donc jamais à une écriture, et le test l'exige.

- [ ] **Step 1: Écrire le test qui échoue**

`src/app/pwa.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const racine = process.cwd()

function lire(fichier: string): string {
  return readFileSync(path.join(racine, 'public', fichier), 'utf8')
}

describe('manifeste', () => {
  const manifeste = JSON.parse(lire('manifest.webmanifest')) as Record<string, unknown>

  it('se déclare installable sur l écran d accueil', () => {
    expect(manifeste.name).toBe('CRA — Compte rendu d’activité')
    expect(manifeste.short_name).toBe('CRA')
    expect(manifeste.display).toBe('standalone')
  })

  it('démarre sur la saisie, pas sur l accueil', () => {
    // L'écran qu'on ouvre trente fois par mois est celui qui doit s'ouvrir.
    expect(manifeste.start_url).toBe('/saisie')
    expect(manifeste.scope).toBe('/')
  })

  it('déclare une icône vectorielle utilisable comme icône masquée', () => {
    const icons = manifeste.icons as Array<Record<string, string>>
    expect(icons.length).toBeGreaterThan(0)
    expect(icons.every((i) => i.src === '/icon.svg' && i.type === 'image/svg+xml')).toBe(true)
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('livre bien l icône qu il déclare', () => {
    expect(lire('icon.svg')).toContain('<svg')
  })
})

describe('service worker', () => {
  /** Charge `public/sw.js` avec un `self` factice et rend ses écouteurs. */
  function charger(): {
    handlers: Record<string, (event: unknown) => void>
    caches: { ouvertes: string[]; precachees: string[] }
  } {
    const handlers: Record<string, (event: unknown) => void> = {}
    const ouvertes: string[] = []
    const precachees: string[] = []

    const fakeCaches = {
      open: async (nom: string) => {
        ouvertes.push(nom)
        return { addAll: async (urls: string[]) => void precachees.push(...urls) }
      },
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    }

    const fakeSelf = {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        handlers[type] = handler
      },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    }

    const source = lire('sw.js')
    // eslint-disable-next-line no-new-func
    new Function('self', 'caches', 'fetch', 'Response', source)(
      fakeSelf,
      fakeCaches,
      async () => ({}),
      { error: () => ({}) },
    )

    return { handlers, caches: { ouvertes, precachees } }
  }

  it('écoute l installation, l activation et les requêtes', () => {
    const { handlers } = charger()
    expect(Object.keys(handlers).sort()).toEqual(['activate', 'fetch', 'install'])
  })

  it('met la coquille en cache à l installation', async () => {
    const { handlers, caches } = charger()
    const attentes: Array<Promise<unknown>> = []
    handlers.install!({ waitUntil: (p: Promise<unknown>) => attentes.push(p) })
    await Promise.all(attentes)

    expect(caches.precachees).toContain('/saisie')
    expect(caches.precachees).toContain('/manifest.webmanifest')
  })

  // Hors ligne = lot 5. Intercepter une écriture sans file locale ferait
  // disparaître une saisie sans que personne le sache.
  it('n intercepte jamais une écriture', () => {
    const { handlers } = charger()
    const respondWith = vi.fn()
    handlers.fetch!({
      request: { method: 'POST', url: 'https://exemple.test/saisie/2026-03' },
      respondWith,
    })
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('n intercepte jamais une route d API', () => {
    const { handlers } = charger()
    const respondWith = vi.fn()
    handlers.fetch!({
      request: { method: 'GET', url: 'https://exemple.test/api/auth/session' },
      respondWith,
    })
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('sert les navigations par le réseau d abord', () => {
    const { handlers } = charger()
    const respondWith = vi.fn()
    handlers.fetch!({
      request: { method: 'GET', url: 'https://exemple.test/saisie/2026-03' },
      respondWith,
    })
    expect(respondWith).toHaveBeenCalledTimes(1)
  })
})
```

`src/components/pwa/RegisterServiceWorker.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { RegisterServiceWorker } from './RegisterServiceWorker'

describe('RegisterServiceWorker', () => {
  afterEach(() => {
    cleanup()
    // @ts-expect-error nettoyage du navigateur simulé
    delete navigator.serviceWorker
  })

  it('enregistre le service worker quand le navigateur le sait faire', () => {
    const register = vi.fn(async () => ({}))
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    })

    render(<RegisterServiceWorker />)
    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('ne casse rien quand le navigateur ne le sait pas', () => {
    expect(() => render(<RegisterServiceWorker />)).not.toThrow()
  })

  it('n affiche rien', () => {
    const { container } = render(<RegisterServiceWorker />)
    expect(container.innerHTML).toBe('')
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/app/pwa.test.ts src/components/pwa/`
Expected: FAIL — `ENOENT` sur `public/manifest.webmanifest`, import `./RegisterServiceWorker` irrésoluble

- [ ] **Step 3: Écrire le manifeste et l'icône**

`public/manifest.webmanifest` :

```json
{
  "name": "CRA — Compte rendu d’activité",
  "short_name": "CRA",
  "description": "Saisie mensuelle des comptes rendus d’activité.",
  "lang": "fr",
  "start_url": "/saisie",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#ffffff",
  "theme_color": "#1e293b",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
  ]
}
```

`public/icon.svg` — vectoriel, donc une seule ressource pour toutes les tailles :

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="CRA">
  <rect width="512" height="512" rx="96" fill="#1e293b"/>
  <rect x="112" y="136" width="288" height="256" rx="24" fill="#ffffff"/>
  <rect x="112" y="136" width="288" height="56" rx="24" fill="#94a3b8"/>
  <g fill="#1e293b">
    <rect x="148" y="224" width="48" height="40" rx="8"/>
    <rect x="232" y="224" width="48" height="40" rx="8"/>
    <rect x="316" y="224" width="48" height="40" rx="8"/>
    <rect x="148" y="296" width="48" height="40" rx="8"/>
    <rect x="232" y="296" width="48" height="40" rx="8"/>
  </g>
</svg>
```

- [ ] **Step 4: Écrire le service worker**

`public/sw.js` :

```js
const CACHE = 'cra-coquille-v1'
const COQUILLE = ['/saisie', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(COQUILLE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n)))),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Le fonctionnement hors ligne relève du lot 5 : il demande une file locale
  // et un arbitrage au retour du réseau. Tant qu'ils n'existent pas, ce
  // service worker ne touche à aucune écriture ni à aucune route d'API — une
  // saisie mise en cache et jamais rejouée serait une perte silencieuse.
  if (request.method !== 'GET') return
  if (new URL(request.url).pathname.startsWith('/api/')) return

  // Réseau d'abord : la coquille en cache ne sert qu'au démarrage instantané,
  // jamais à servir des données périmées.
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((reponse) => reponse ?? Response.error()),
    ),
  )
})
```

- [ ] **Step 5: Écrire l'enregistrement et brancher le manifeste**

`src/components/pwa/RegisterServiceWorker.tsx` :

```tsx
'use client'

import { useEffect } from 'react'

/** Enregistre la coquille. N'affiche rien et n'échoue jamais bruyamment. */
export function RegisterServiceWorker(): null {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Un enregistrement refusé (http non sécurisé, navigation privée) ne
      // doit pas empêcher d'utiliser l'application.
    })
  }, [])

  return null
}
```

`src/app/layout.tsx` :

```tsx
import './globals.css'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { RegisterServiceWorker } from '@/components/pwa/RegisterServiceWorker'

export const metadata: Metadata = {
  title: 'CRA',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'CRA', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  themeColor: '#1e293b',
  width: 'device-width',
  initialScale: 1,
  // Pas de `maximumScale` : brider le zoom rend l'application inutilisable
  // pour qui en a besoin.
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-white text-slate-900 antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  )
}
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/app/pwa.test.ts src/components/pwa/`
Expected: PASS — 10 tests dans `pwa.test.ts`, 3 dans `RegisterServiceWorker.test.tsx`

- [ ] **Step 7: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0. **Ne pas lancer `npx next build`.**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(pwa): manifeste, icone et mise en cache de la coquille"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche | Test qui la tient |
|---|---|---|
| Vue mensuelle unique, identique poste et téléphone | 6 | « affiche une case par jour du mois », « range la grille en sept colonnes fixes » |
| Sélecteurs Client → Mission → Prestation | 9 | « positionne les trois sélecteurs sur la prestation sélectionnée » |
| Deux prestations d'une même mission se distinguent au sélecteur | 9 | « offre les deux prestations d une même mission » |
| Dernière sélection mémorisée | 9, 10 | « mémorise la prestation affichée », « restaure la prestation mémorisée au montage » |
| Cinématique `vide → 1 jour → ½ matin → ½ après-midi → vide` | 1, 6 | « avance vide → 1 jour → … », « ramène la case à son état initial au bout de quatre clics » |
| Chaque état écrit bien ce qu'il annonce, créneau compris | 2, 3 | « écrit la valeur nominale du créneau », « remplace la journée par une demi-journée sans laisser de résidu » |
| Toute demi-journée porte un créneau | 2, 3 | « écrit la valeur nominale du créneau pour une demi-journée » |
| Appui long / clic droit ouvrent le formulaire | 6, 7 | `useLongPress` (5 tests), « ouvre le formulaire au clic droit » |
| Une case à valeur libre ne cycle pas | 1, 6 | « ne cycle pas sur une case à valeur libre », « n applique rien sur une case à valeur libre » |
| Prestation à l'heure : formulaire au clic, jamais « 1 jour » | 1, 6 | « ouvre directement le formulaire sur une prestation facturée à l heure » |
| Remplir le CRA saute les jours sans capacité et rend compte | 4 | « saute les jours sans capacité et le dit », « rend le compte rendu de la spec » |
| Remplir n'écrase jamais | 4 | « n écrase jamais une saisie déjà posée sur la prestation, et la compte » |
| Vider demande confirmation | 10 | « demande confirmation avant de rien retirer », « renonce sans rien retirer » |
| Remplir et vider refusent un mois verrouillé | 4, 10 | « refuse un mois verrouillé sans rien écrire » ×2, « dit le verrou » ×2 |
| Bascule « Cette prestation \| Tout le mois » | 8, 10 | « bascule entre « Cette prestation » et « Tout le mois » » |
| Les autres prestations ne sont pas cliquables | 8 | « rend les autres prestations non cliquables » |
| Couleurs automatiques et stables entre deux chargements | 5, 8 | « rend la même couleur à chaque appel », « donne à une prestation la même couleur entre deux chargements » |
| Calendrier = vue par défaut | 10 | « ouvre la vue calendrier par défaut » |
| Vue tableau conservée, sur poste, en seconde vue | 10 | « bascule vers la vue tableau et la ramène », « réserve la vue tableau au poste » |
| Sélection par glissement dans les deux vues, sur poste | 8 | « applique la valeur choisie à tous les jours de la plage » (calendrier) ; `MonthGrid.test.tsx` inchangé (tableau) |
| Sept colonnes, cible tactile ≥ 44 points | 6 | « garde une cible tactile d au moins 44 points », « range la grille en sept colonnes fixes » |
| En-têtes de jours abrégés, sélecteurs empilés | 6, 9 | « abrège les en-têtes pour le téléphone », `flex-col sm:flex-row` du `LineSelector` |
| PWA : manifeste, icône, coquille en cache | 11 | 10 tests de `pwa.test.ts` |
| Hors ligne exclu, renvoyé au lot 5 | 11 | « n intercepte jamais une écriture », « n intercepte jamais une route d API » |
| Contrôle de capacité identique, trois modes | 3 | « refuse en mode BLOCAGE », « signale sans bloquer en mode AVERTISSEMENT » |
| Week-ends et fériés saisissables, jamais bloquants | 6 | « grise les week-ends et les fériés sans les interdire » |
| Un mois validé refuse l'écriture, cinématique comprise | 3 | « refuse un mois dont le CRA est validé, sans rien écrire » |
| Conversion du prévisionnel jamais automatique | — | inchangé : `convertPastForecast` reste à l'initiative de l'utilisateur, aucune tâche n'y touche |
| Aucune règle métier réimplémentée dans la vue | 6, 10 | le `grep` des étapes de vérification |
| `allowedSlotIds` enfin applicable | 1, 3, 7 | « respecte la restriction portée par la prestation », « signale un créneau non autorisé sans refuser la saisie » |
| Un créneau non autorisé signale, ne refuse pas | 3, 7 | « signale un créneau non autorisé sans le rendre inchoisissable » |
| Les 307 tests du lot 1a restent verts | 10 | `npx vitest run` en étape 7 de la tâche 10 |

**Hors périmètre, conformément à la spec :** fonctionnement hors ligne, notifications poussées, application native, administration et gestion des missions sur téléphone.

**Décisions reprises de la spec, à contester si elles ne conviennent pas :** une case à valeur libre rouvre son formulaire ; « Remplir le CRA » saute les jours sans capacité ; la vue tableau est conservée sur poste ; la bascule s'appelle « Cette prestation | Tout le mois » ; les couleurs sont attribuées automatiquement.

**Décisions prises par ce plan, au-delà de la spec :**

- **Un créneau qui franchit minuit ne fait pas partie du cycle.** Il s'étale sur deux jours ; il reste atteignable au formulaire. Sans cette règle, « la nuit » s'insérerait entre le matin et l'après-midi dans la cinématique par défaut.
- **« Remplir le CRA » saute aussi les jours déjà saisis sur la prestation**, et les compte séparément. Le remplacement d'une demi-journée par une journée entière serait exactement l'écrasement silencieux que la spec proscrit.
- **La sélection par glissement ne rejoue pas la cinématique** : la barre nomme la valeur à appliquer. Appliquer « le cran suivant » à trente jours d'états différents produirait trente résultats pour un seul geste.
- **La confirmation du vidage est un panneau en ligne, pas `window.confirm`**, qui bloque le fil, n'existe pas dans happy-dom et se prête mal au pouce.
- **`listActiveLines` est corrigée pour suivre la cascade complète** du lot 1d. Elle affichait un facteur que l'écriture ne fige pas ; chaque case du calendrier en aurait hérité.
- **Le `kind` d'une case est décidé côté serveur**, à partir de l'horloge du serveur, comme `validerJoursPasses` — le client ne déclare pas ce qui est déjà réalisé.
