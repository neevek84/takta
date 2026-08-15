# Lot 1a — Prévisionnel et plan de charge · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre exploitables les mois à venir — naviguer d'un mois à l'autre, convertir les jours prévus échus, et produire un plan de charge qui répond à « combien me reste-t-il à vendre sur l'exercice ».

**Architecture:** Tout le calcul nouveau vit dans `src/core/fiscal/`, pur et testable sans base. Les services agrègent, les écrans présentent. Deux réglages nouveaux, aucune table nouvelle : le reste est du calcul sur des données que le lot 0 produit déjà.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Prisma 6 · SQLite en développement · Vitest · Tailwind 4

**Spec :** `docs/superpowers/specs/2026-08-15-lot-1a-previsionnel-design.md`

## Global Constraints

Elles s'appliquent à **toutes** les tâches.

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** Domaine pur.
- **Aucun enum Prisma** — colonnes `String`, unions TypeScript dans `src/core/types.ts`.
- **Aucun décimal persisté.** Entiers partout : temps en **minutes**, jours en **centièmes de jour**, montants en **centimes**. Le seul flottant admis est `tauxCouverture`, calculé à l'affichage et jamais écrit en base.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus.**
- **L'application ne facture jamais.** Le TJM sert à projeter. Aucun document, aucune ligne de facture, aucune TVA.
- **La conversion prévisionnel → réalisé n'est jamais automatique.**
- **Un mois dont le CRA est `VALIDE` refuse toute écriture**, conversion comprise.
- **Le reste est plafonné à zéro, le dépassement exposé séparément** — même convention que `computeEngagement` du lot 0.
- Français pour les chaînes visibles, anglais pour le code et les messages de commit.
- `vitest.config.ts` est en `fileParallelism: false` (base SQLite partagée) — ne pas le modifier.
- Les tests de composants exigent `// @vitest-environment happy-dom` en première ligne et un `afterEach(cleanup)` explicite. `jsdom` ne fonctionne pas dans cet environnement.

---

## Interfaces existantes du lot 0

Relevées dans le code, à consommer sans les réécrire.

```ts
// src/core/engagement/compute.ts
interface EngagementSummary {
  venduCentiemes: number; realiseCentiemes: number; prevuCentiemes: number
  resteCentiemes: number; depassementCentiemes: number
}
computeEngagement(args: {
  venduCentiemes: number
  entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number }>
  minutesParJour: number
}): EngagementSummary

// src/core/time/units.ts
minutesToCentiemes(minutes: number, minutesParJour: number): number
centiemesToMinutes(centiemes: number, minutesParJour: number): number
formatQuantity(minutes: number, unit: DisplayUnit, minutesParJour: number): string

// src/core/month/build.ts
interface MonthDay { date: string; dayOfWeek: number; isWorking: boolean; isHoliday: boolean }
buildMonthDays(month: string, workingDays: number[], holidays: string[]): MonthDay[]

// src/services/missions.ts
interface LineForGrid {
  id: string; label: string; missionLabel: string; clientName: string
  displayUnit: DisplayUnit; minutesParJour: number; soldCentiemes: number
  allowedSlotIds: string[]
}
listActiveLines(userId: string): Promise<LineForGrid[]>

// src/services/time-entries.ts
interface MonthEntry {
  id: string; lineId: string; date: string; minutes: number
  kind: TimeEntryKind; slotId: string
}
getMonthEntries(userId: string, month: string): Promise<MonthEntry[]>

// src/services/settings.ts
interface AppSettings {
  minutesParJour: number; capacityMode: CapacityMode; capacityCentiemes: number
  workingDays: number[]; slots: Slot[]; holidays: string[]
  defaultDisplayUnit: DisplayUnit; defaultEngagementSource: EngagementSource
}
getSettings(): Promise<AppSettings>
updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>   // valide par zod, lève SettingsValidationError
```

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/core/fiscal/year.ts` | Bornes et libellé d'un exercice fiscal |
| `src/core/fiscal/revenue.ts` | CA depuis des saisies, avancement d'exercice, TJM moyen |
| `src/core/month/build.ts` | *(étendu)* décalage de mois |
| `src/services/settings.ts` | *(étendu)* les deux réglages nouveaux |
| `src/services/time-entries.ts` | *(étendu)* lecture et conversion du prévisionnel échu |
| `src/services/charge.ts` | Construction de la matrice de charge |
| `src/components/MonthNav.tsx` | Navigation entre mois |
| `src/components/charge/ExerciceBar.tsx` | Barre d'avancement de l'exercice |
| `src/components/charge/ChargeTable.tsx` | Matrice lignes × mois |
| `src/app/(app)/saisie/[month]/PastForecastNotice.tsx` | Encart de conversion |
| `src/app/(app)/charge/page.tsx` | Écran du plan de charge |

**Dépendances entre tâches :** 1, 2 et 3 sont indépendantes. 4 et 5 touchent toutes deux `saisie/[month]/page.tsx` et se suivent. 6 consomme 1, 2 et 3. 7 consomme 6.

---

## Task 1: Bornes de l'exercice fiscal

**Files:**
- Create: `src/core/fiscal/year.ts`
- Test: `src/core/fiscal/year.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `interface FiscalYear { start: string; end: string; label: string; months: string[] }`
  - `fiscalYearFromStartYear(startYear: number, debutMois: number): FiscalYear`
  - `fiscalYearBounds(date: string, debutMois: number): FiscalYear`

`start` et `end` sont au format `'YYYY-MM-DD'`, `months` contient exactement 12 entrées `'YYYY-MM'` dans l'ordre de l'exercice. `fiscalYearFromStartYear` existe pour le sélecteur d'exercice : reculer d'un an, c'est `startYear - 1`.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/fiscal/year.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { fiscalYearBounds, fiscalYearFromStartYear } from './year'

describe('fiscalYearBounds — exercice à cheval (avril, cas réel du projet)', () => {
  it('place août 2026 dans l exercice ouvert en avril 2026', () => {
    const fy = fiscalYearBounds('2026-08-15', 4)
    expect(fy.start).toBe('2026-04-01')
    expect(fy.end).toBe('2027-03-31')
    expect(fy.label).toBe('Exercice 2026-2027')
  })

  it('place février 2026 dans l exercice ouvert en avril 2025', () => {
    const fy = fiscalYearBounds('2026-02-10', 4)
    expect(fy.start).toBe('2025-04-01')
    expect(fy.end).toBe('2026-03-31')
    expect(fy.label).toBe('Exercice 2025-2026')
  })

  it('range le jour pivot dans l exercice qui s ouvre', () => {
    expect(fiscalYearBounds('2026-04-01', 4).start).toBe('2026-04-01')
  })

  it('range la veille du pivot dans l exercice précédent', () => {
    expect(fiscalYearBounds('2026-03-31', 4).start).toBe('2025-04-01')
  })
})

describe('fiscalYearBounds — exercice civil', () => {
  it('borne sur l année civile et nomme sans tiret', () => {
    const fy = fiscalYearBounds('2026-08-15', 1)
    expect(fy.start).toBe('2026-01-01')
    expect(fy.end).toBe('2026-12-31')
    expect(fy.label).toBe('Exercice 2026')
  })
})

describe('fiscalYearBounds — fin de mois et années bissextiles', () => {
  it('termine un exercice de mars au 28 février en année ordinaire', () => {
    expect(fiscalYearBounds('2024-05-01', 3).end).toBe('2025-02-28')
  })

  it('termine un exercice de mars au 29 février en année bissextile', () => {
    expect(fiscalYearBounds('2023-05-01', 3).end).toBe('2024-02-29')
  })
})

describe('fiscalYearBounds — les douze mois', () => {
  it('produit toujours douze mois', () => {
    for (const m of [1, 4, 7, 12]) {
      expect(fiscalYearBounds('2026-06-15', m).months).toHaveLength(12)
    }
  })

  it('ordonne les mois depuis l ouverture jusqu à la clôture', () => {
    const fy = fiscalYearBounds('2026-08-15', 4)
    expect(fy.months[0]).toBe('2026-04')
    expect(fy.months[8]).toBe('2026-12')
    expect(fy.months[9]).toBe('2027-01')
    expect(fy.months[11]).toBe('2027-03')
  })

  it('reste sur une seule année civile pour un exercice de janvier', () => {
    const fy = fiscalYearBounds('2026-08-15', 1)
    expect(fy.months[0]).toBe('2026-01')
    expect(fy.months[11]).toBe('2026-12')
  })

  it('gère une ouverture en décembre', () => {
    const fy = fiscalYearBounds('2026-08-15', 12)
    expect(fy.start).toBe('2025-12-01')
    expect(fy.end).toBe('2026-11-30')
    expect(fy.months[0]).toBe('2025-12')
    expect(fy.months[1]).toBe('2026-01')
    expect(fy.months[11]).toBe('2026-11')
  })
})

describe('fiscalYearFromStartYear', () => {
  it('donne le même résultat que fiscalYearBounds pour une date interne', () => {
    expect(fiscalYearFromStartYear(2026, 4)).toEqual(fiscalYearBounds('2026-08-15', 4))
  })

  it('permet de reculer d un exercice', () => {
    expect(fiscalYearFromStartYear(2025, 4).label).toBe('Exercice 2025-2026')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/fiscal/year.test.ts`
Expected: FAIL — `Failed to resolve import "./year"`

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/core/fiscal/year.ts` :

```ts
export interface FiscalYear {
  /** 'YYYY-MM-DD' */
  start: string
  /** 'YYYY-MM-DD' */
  end: string
  /** « Exercice 2026-2027 », ou « Exercice 2026 » si l'exercice est civil */
  label: string
  /** 12 mois 'YYYY-MM', de l'ouverture à la clôture */
  months: string[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function fiscalYearFromStartYear(startYear: number, debutMois: number): FiscalYear {
  const endMonth = debutMois === 1 ? 12 : debutMois - 1
  const endYear = debutMois === 1 ? startYear : startYear + 1
  // Jour 0 du mois suivant = dernier jour du mois courant. Gère février bissextile.
  const endDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()

  const months: string[] = []
  for (let i = 0; i < 12; i++) {
    const offset = debutMois - 1 + i
    months.push(`${startYear + Math.floor(offset / 12)}-${pad((offset % 12) + 1)}`)
  }

  return {
    start: `${startYear}-${pad(debutMois)}-01`,
    end: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
    label: debutMois === 1 ? `Exercice ${startYear}` : `Exercice ${startYear}-${startYear + 1}`,
    months,
  }
}

export function fiscalYearBounds(date: string, debutMois: number): FiscalYear {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const startYear = month >= debutMois ? year : year - 1
  return fiscalYearFromStartYear(startYear, debutMois)
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/fiscal/year.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/fiscal/year.ts src/core/fiscal/year.test.ts
git commit -m "feat(core): bornes et libelle d'un exercice fiscal"
```

---

## Task 2: Chiffre d'affaires et avancement d'exercice

**Files:**
- Create: `src/core/fiscal/revenue.ts`
- Test: `src/core/fiscal/revenue.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `caFromEntries(entries, lines): number` — centimes
  - `interface ExerciceProgress { objectifCents; realiseCents; prevuCents; resteAVendreCents; depassementCents; tauxCouverture }`
  - `exerciceProgress(objectifCents: number, realiseCents: number, prevuCents: number): ExerciceProgress`
  - `tjmMoyenPondere(lines): number | null`
  - `resteEnCentiemes(resteAVendreCents: number, tjmMoyenCents: number | null): number | null`

Une entrée dont le `lineId` ne figure pas dans `lines` contribue **zéro**. Ce n'est pas un oubli mais une décision : l'appelant filtre déjà par utilisateur, et une exception ici ferait tomber un écran entier pour une donnée orpheline. Le comportement est testé.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/fiscal/revenue.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  caFromEntries,
  exerciceProgress,
  tjmMoyenPondere,
  resteEnCentiemes,
} from './revenue'

// Deux lignes de la même mission, tarifées différemment — le cas réel.
const LINES = [
  { id: 'jour', tjmCents: 80000, minutesParJour: 480 },
  { id: 'nuit', tjmCents: 120000, minutesParJour: 480 },
]

describe('caFromEntries', () => {
  it('valorise une journée pleine au TJM de sa ligne', () => {
    expect(caFromEntries([{ lineId: 'jour', minutes: 480 }], LINES)).toBe(80000)
  })

  it('valorise une demi-journée à la moitié', () => {
    expect(caFromEntries([{ lineId: 'jour', minutes: 240 }], LINES)).toBe(40000)
  })

  it('applique à chaque entrée le TJM de SA ligne', () => {
    const ca = caFromEntries(
      [
        { lineId: 'jour', minutes: 480 },
        { lineId: 'nuit', minutes: 480 },
      ],
      LINES,
    )
    expect(ca).toBe(200000)
  })

  it('respecte un minutesParJour surchargé par ligne', () => {
    const ca = caFromEntries([{ lineId: 'sept', minutes: 420 }], [
      { id: 'sept', tjmCents: 70000, minutesParJour: 420 },
    ])
    expect(ca).toBe(70000)
  })

  it('renvoie zéro sans entrée', () => {
    expect(caFromEntries([], LINES)).toBe(0)
  })

  it('ignore une entrée dont la ligne est inconnue', () => {
    expect(caFromEntries([{ lineId: 'fantome', minutes: 480 }], LINES)).toBe(0)
  })

  it('ne dérive pas sur un cumul de nombreuses demi-journées', () => {
    const entries = Array.from({ length: 300 }, () => ({ lineId: 'jour', minutes: 240 }))
    expect(caFromEntries(entries, LINES)).toBe(300 * 40000)
  })
})

describe('exerciceProgress', () => {
  it('calcule le reste à vendre', () => {
    const p = exerciceProgress(15_000_000, 4_000_000, 3_000_000)
    expect(p.resteAVendreCents).toBe(8_000_000)
    expect(p.depassementCents).toBe(0)
  })

  it('plafonne le reste à zéro et expose le dépassement', () => {
    const p = exerciceProgress(10_000_000, 8_000_000, 5_000_000)
    expect(p.resteAVendreCents).toBe(0)
    expect(p.depassementCents).toBe(3_000_000)
  })

  it('traite l égalité stricte comme un reste nul sans dépassement', () => {
    const p = exerciceProgress(10_000_000, 6_000_000, 4_000_000)
    expect(p.resteAVendreCents).toBe(0)
    expect(p.depassementCents).toBe(0)
  })

  it('renvoie un taux de couverture nul quand l objectif n est pas défini', () => {
    const p = exerciceProgress(0, 4_000_000, 0)
    expect(p.tauxCouverture).toBe(0)
    expect(p.resteAVendreCents).toBe(0)
  })

  it('calcule le taux sur le réalisé plus le prévu', () => {
    const p = exerciceProgress(10_000_000, 4_000_000, 1_000_000)
    expect(p.tauxCouverture).toBeCloseTo(0.5, 10)
  })
})

describe('tjmMoyenPondere', () => {
  it('pondère par les jours vendus, pas par le nombre de lignes', () => {
    // Moyenne arithmétique = 100 000. Pondérée = 90 000.
    const moyen = tjmMoyenPondere([
      { tjmCents: 80000, soldCentiemes: 3000 },
      { tjmCents: 120000, soldCentiemes: 1000 },
    ])
    expect(moyen).toBe(90000)
  })

  it('renvoie le TJM tel quel avec une seule ligne', () => {
    expect(tjmMoyenPondere([{ tjmCents: 80000, soldCentiemes: 3000 }])).toBe(80000)
  })

  it('renvoie null sans aucune ligne', () => {
    expect(tjmMoyenPondere([])).toBeNull()
  })

  it('renvoie null quand aucun jour n est vendu', () => {
    expect(tjmMoyenPondere([{ tjmCents: 80000, soldCentiemes: 0 }])).toBeNull()
  })
})

describe('resteEnCentiemes', () => {
  it('traduit un reste en centièmes de jour', () => {
    // 42 000 € à 800 € par jour = 52,5 jours
    expect(resteEnCentiemes(4_200_000, 80000)).toBe(5250)
  })

  it('renvoie null sans TJM moyen', () => {
    expect(resteEnCentiemes(4_200_000, null)).toBeNull()
  })

  it('renvoie null sur un TJM moyen nul', () => {
    expect(resteEnCentiemes(4_200_000, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/fiscal/revenue.test.ts`
Expected: FAIL — `Failed to resolve import "./revenue"`

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/core/fiscal/revenue.ts` :

```ts
export function caFromEntries(
  entries: ReadonlyArray<{ lineId: string; minutes: number }>,
  lines: ReadonlyArray<{ id: string; tjmCents: number; minutesParJour: number }>,
): number {
  const byId = new Map(lines.map((l) => [l.id, l]))
  let cents = 0

  for (const e of entries) {
    const line = byId.get(e.lineId)
    // Entrée orpheline : contribue zéro plutôt que de faire tomber l'écran.
    if (line === undefined || line.minutesParJour <= 0) continue
    cents += Math.round((e.minutes * line.tjmCents) / line.minutesParJour)
  }

  return cents
}

export interface ExerciceProgress {
  objectifCents: number
  realiseCents: number
  prevuCents: number
  /** plafonné à zéro */
  resteAVendreCents: number
  depassementCents: number
  /** ratio d'affichage, jamais persisté */
  tauxCouverture: number
}

export function exerciceProgress(
  objectifCents: number,
  realiseCents: number,
  prevuCents: number,
): ExerciceProgress {
  const solde = objectifCents - realiseCents - prevuCents

  return {
    objectifCents,
    realiseCents,
    prevuCents,
    resteAVendreCents: Math.max(0, solde),
    depassementCents: Math.max(0, -solde),
    tauxCouverture: objectifCents === 0 ? 0 : (realiseCents + prevuCents) / objectifCents,
  }
}

export function tjmMoyenPondere(
  lines: ReadonlyArray<{ tjmCents: number; soldCentiemes: number }>,
): number | null {
  let poids = 0
  let cumul = 0

  for (const l of lines) {
    poids += l.soldCentiemes
    cumul += l.tjmCents * l.soldCentiemes
  }

  return poids === 0 ? null : Math.round(cumul / poids)
}

export function resteEnCentiemes(
  resteAVendreCents: number,
  tjmMoyenCents: number | null,
): number | null {
  if (tjmMoyenCents === null || tjmMoyenCents <= 0) return null
  return Math.round((resteAVendreCents * 100) / tjmMoyenCents)
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/fiscal/revenue.test.ts`
Expected: PASS — 19 tests

- [ ] **Step 5: Vérifier que `core/` reste pur**

Run: `! grep -rE "@prisma/client|from ['\"]next|from ['\"]react" src/core/`
Expected: aucune sortie, code de retour 0

- [ ] **Step 6: Commit**

```bash
git add src/core/fiscal/revenue.ts src/core/fiscal/revenue.test.ts
git commit -m "feat(core): chiffre d'affaires projete et avancement d'exercice"
```

---

## Task 3: Les deux réglages d'exercice

**Files:**
- Modify: `prisma/schema.prisma` (modèle `Settings`), `src/services/settings.ts`, `src/app/(app)/admin/saisie/SettingsForm.tsx`, `src/app/(app)/admin/saisie/actions.ts`
- Test: `src/services/settings.test.ts`

**Interfaces:**
- Consumes: `getSettings`, `updateSettings`, `SettingsValidationError` existants
- Produces: `AppSettings.objectifCaExerciceCents: number` et `AppSettings.debutExerciceMois: number`

`objectifCaExerciceCents = 0` signifie « objectif non défini » : les écrans masquent la barre d'exercice plutôt que d'afficher un taux vide de sens.

- [ ] **Step 1: Étendre le schéma Prisma**

Dans `prisma/schema.prisma`, modèle `Settings`, ajouter :

```prisma
  /// objectif de CA sur l'exercice, en centimes. 0 = non défini.
  objectifCaExerciceCents Int @default(0)
  /// mois de début d'exercice, 1-12
  debutExerciceMois       Int @default(1)
```

Puis appliquer :

```bash
npm run db:sqlite
```

- [ ] **Step 2: Écrire le test qui échoue**

Ajouter à `src/services/settings.test.ts` :

```ts
describe('réglages d exercice', () => {
  it('expose des valeurs par défaut neutres', async () => {
    // Les tests précédents du fichier ont muté le singleton : on repart
    // d'une base vierge, sinon ce test dépendrait de l'ordre d'exécution.
    await prisma.settings.deleteMany({})

    const s = await getSettings()
    expect(s.objectifCaExerciceCents).toBe(0)
    expect(s.debutExerciceMois).toBe(1)
  })

  it('persiste un objectif et un mois de début', async () => {
    const s = await updateSettings({ objectifCaExerciceCents: 15_000_000, debutExerciceMois: 4 })
    expect(s.objectifCaExerciceCents).toBe(15_000_000)
    expect(s.debutExerciceMois).toBe(4)

    const relu = await getSettings()
    expect(relu.objectifCaExerciceCents).toBe(15_000_000)
    expect(relu.debutExerciceMois).toBe(4)
  })

  it('refuse un mois de début hors de 1-12 et ne le persiste jamais', async () => {
    await updateSettings({ debutExerciceMois: 4 })

    await expect(updateSettings({ debutExerciceMois: 0 })).rejects.toThrow()
    await expect(updateSettings({ debutExerciceMois: 13 })).rejects.toThrow()

    expect((await getSettings()).debutExerciceMois).toBe(4)
  })

  it('refuse un mois de début non entier', async () => {
    await expect(updateSettings({ debutExerciceMois: 4.5 })).rejects.toThrow()
  })

  it('refuse un objectif négatif', async () => {
    await expect(updateSettings({ objectifCaExerciceCents: -1 })).rejects.toThrow()
  })

  it('accepte un objectif nul, qui signifie non défini', async () => {
    const s = await updateSettings({ objectifCaExerciceCents: 0 })
    expect(s.objectifCaExerciceCents).toBe(0)
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/settings.test.ts`
Expected: FAIL — les nouveaux champs sont `undefined` et les validations ne rejettent pas

- [ ] **Step 4: Étendre le service**

Dans `src/services/settings.ts` :

Ajouter à l'interface `AppSettings` :

```ts
  /** objectif de CA sur l'exercice, en centimes. 0 = non défini. */
  objectifCaExerciceCents: number
  /** mois de début d'exercice, 1-12 */
  debutExerciceMois: number
```

Ajouter au schéma zod de validation du patch, à côté des autres clés :

```ts
    objectifCaExerciceCents: z
      .number()
      .int("L'objectif de chiffre d'affaires doit être un entier de centimes.")
      .min(0, "L'objectif de chiffre d'affaires ne peut pas être négatif."),
    debutExerciceMois: z
      .number()
      .int('Le mois de début d’exercice doit être un entier.')
      .min(1, 'Le mois de début d’exercice doit être compris entre 1 et 12.')
      .max(12, 'Le mois de début d’exercice doit être compris entre 1 et 12.'),
```

Ajouter à `toAppSettings` :

```ts
    objectifCaExerciceCents: row.objectifCaExerciceCents,
    debutExerciceMois: row.debutExerciceMois,
```

Ajouter au `data` de `updateSettings`, selon le même motif conditionnel que les champs existants :

```ts
      ...(patch.objectifCaExerciceCents !== undefined && {
        objectifCaExerciceCents: patch.objectifCaExerciceCents,
      }),
      ...(patch.debutExerciceMois !== undefined && { debutExerciceMois: patch.debutExerciceMois }),
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/settings.test.ts`
Expected: PASS — les 6 tests nouveaux plus tous les existants

- [ ] **Step 6: Exposer les réglages dans l'écran d'administration**

Dans `src/app/(app)/admin/saisie/SettingsForm.tsx`, ajouter une section, **dans le formulaire des réglages** (pas dans celui du rechargement des fériés — deux formulaires HTML ne s'imbriquent pas) :

```tsx
<fieldset className="border-t pt-4">
  <legend className="mb-2 font-medium">Exercice</legend>

  <label className="mb-3 flex flex-col text-sm">
    Mois de début d’exercice
    <select
      name="debutExerciceMois"
      defaultValue={String(settings.debutExerciceMois)}
      className="w-48 rounded border px-2 py-1"
    >
      {['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
        .map((label, i) => (
          <option key={label} value={i + 1}>{label}</option>
        ))}
    </select>
  </label>

  <label className="flex flex-col text-sm">
    Objectif de chiffre d’affaires sur l’exercice (€)
    <input
      name="objectifCaEuros"
      type="number"
      min="0"
      step="100"
      defaultValue={settings.objectifCaExerciceCents / 100}
      className="w-48 rounded border px-2 py-1"
    />
    <span className="mt-1 text-xs text-slate-500">
      0 masque la barre d’exercice sur le plan de charge.
    </span>
  </label>
</fieldset>
```

Dans `src/app/(app)/admin/saisie/actions.ts`, ajouter au patch construit par `saveSettings` :

```ts
    objectifCaExerciceCents: Math.round(Number(formData.get('objectifCaEuros')) * 100),
    debutExerciceMois: Number(formData.get('debutExerciceMois')),
```

- [ ] **Step 7: Vérifier de bout en bout**

Run:

```bash
npx vitest run && npx tsc --noEmit && npx next build
```

Expected: suite entièrement verte, `tsc` à 0, build abouti.

Puis vérifier programmatiquement que la saisie en euros arrive bien en centimes :

```bash
node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.settings.upsert({where:{id:'singleton'},create:{id:'singleton'},update:{}})
 .then(s=>console.log('objectif:',s.objectifCaExerciceCents,'debut:',s.debutExerciceMois))
 .finally(()=>p.\$disconnect())"
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(settings): objectif de CA et mois de debut d'exercice"
```

---

## Task 4: Navigation entre mois

**Files:**
- Modify: `src/core/month/build.ts`, `src/core/month/build.test.ts`, `src/app/(app)/saisie/[month]/page.tsx`
- Create: `src/components/MonthNav.tsx`

**Interfaces:**
- Consumes: `buildMonthDays` existant
- Produces: `shiftMonth(month: string, delta: number): string` dans `src/core/month/build.ts`, et `<MonthNav month={string} />`

C'est le trou principal laissé par le lot 0 : la route `/saisie/[month]` fonctionne, mais rien dans l'interface ne permet d'atteindre un autre mois.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/core/month/build.test.ts` :

```ts
import { shiftMonth } from './build'

describe('shiftMonth', () => {
  it('avance d un mois', () => {
    expect(shiftMonth('2026-08', 1)).toBe('2026-09')
  })

  it('recule d un mois', () => {
    expect(shiftMonth('2026-08', -1)).toBe('2026-07')
  })

  it('franchit décembre vers janvier', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('franchit janvier vers décembre', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('accepte un décalage de plusieurs mois', () => {
    expect(shiftMonth('2026-08', 12)).toBe('2027-08')
    expect(shiftMonth('2026-08', -12)).toBe('2025-08')
    expect(shiftMonth('2026-02', -14)).toBe('2024-12')
  })

  it('renvoie le mois inchangé pour un décalage nul', () => {
    expect(shiftMonth('2026-08', 0)).toBe('2026-08')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/month/build.test.ts`
Expected: FAIL — `shiftMonth is not a function`

- [ ] **Step 3: Écrire l'implémentation minimale**

Ajouter à `src/core/month/build.ts` :

```ts
/** Décale un mois 'YYYY-MM' de `delta` mois, positif ou négatif. */
export function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const offset = year * 12 + (m - 1) + delta
  const outYear = Math.floor(offset / 12)
  const outMonth = (offset % 12) + 1
  return `${outYear}-${String(outMonth).padStart(2, '0')}`
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/month/build.test.ts`
Expected: PASS — les 6 tests nouveaux plus les 6 existants

- [ ] **Step 5: Écrire le composant de navigation**

`src/components/MonthNav.tsx` :

```tsx
import Link from 'next/link'
import { shiftMonth } from '@/core/month/build'

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7))
  return `${MOIS[m - 1]} ${month.slice(0, 4)}`
}

export function MonthNav({ month }: { month: string }) {
  const today = new Date().toISOString().slice(0, 7)

  return (
    <nav className="mb-4 flex items-center gap-2 text-sm">
      <Link
        href={`/saisie/${shiftMonth(month, -1)}`}
        aria-label="Mois précédent"
        className="rounded border px-2 py-1"
      >
        ←
      </Link>

      <span className="min-w-44 text-center font-medium">{monthLabel(month)}</span>

      <Link
        href={`/saisie/${shiftMonth(month, 1)}`}
        aria-label="Mois suivant"
        className="rounded border px-2 py-1"
      >
        →
      </Link>

      {month !== today && (
        <Link href={`/saisie/${today}`} className="ml-2 rounded border px-2 py-1">
          Mois courant
        </Link>
      )}
    </nav>
  )
}
```

- [ ] **Step 6: Brancher la navigation dans la page de saisie**

Dans `src/app/(app)/saisie/[month]/page.tsx`, importer `MonthNav` et `monthLabel`, puis remplacer le titre :

```tsx
      <h1 className="mb-4 text-xl font-semibold">Saisie · {month}</h1>
```

par :

```tsx
      <h1 className="mb-4 text-xl font-semibold">Saisie</h1>
      <MonthNav month={month} />
```

- [ ] **Step 7: Vérifier**

Run:

```bash
npx vitest run && npx tsc --noEmit && npx next build
```

Expected: suite verte, `tsc` à 0, build abouti.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(saisie): navigation entre les mois"
```

---

## Task 5: Valider les jours passés

**Files:**
- Modify: `src/services/time-entries.ts`, `src/services/time-entries.test.ts`, `src/app/(app)/saisie/[month]/page.tsx`, `src/app/(app)/saisie/[month]/actions.ts`
- Create: `src/app/(app)/saisie/[month]/PastForecastNotice.tsx`

**Interfaces:**
- Consumes: `prisma`, `isLocked` de `src/core/cra/state-machine.ts`, `MonthEntry`
- Produces:
  - `listPastForecast(userId: string, month: string, today: string): Promise<MonthEntry[]>`
  - `convertPastForecast(userId: string, month: string, today: string): Promise<{ converted: number; skippedLocked: number }>`

**Précision par rapport à la spec.** La spec annonçait un refus binaire `{ ok: false, reason: 'VERROUILLE' }`. Le verrou du CRA porte en réalité sur un couple *(mission, mois)* : un même mois peut contenir une mission verrouillée et une autre ouverte. La conversion traite donc les missions ouvertes et **compte** celles qu'elle a sautées, au lieu de tout refuser en bloc. C'est un raffinement délibéré, pas une dérive.

`today` est passé en paramètre plutôt que lu de l'horloge : c'est ce qui rend la fonction testable sans geler le temps.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/services/time-entries.test.ts` :

```ts
import { listPastForecast, convertPastForecast } from './time-entries'

describe('conversion du prévisionnel échu', () => {
  it('ne retient que le prévisionnel strictement passé', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-20', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineB, date: '2026-03-05', minutes: 240, kind: 'REALISE' })

    const past = await listPastForecast(userId, '2026-03', '2026-03-15')
    expect(past.map((e) => e.date)).toEqual(['2026-03-10'])
  })

  it('exclut le jour même', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-15', minutes: 480, kind: 'PREVISIONNEL' })
    expect(await listPastForecast(userId, '2026-03', '2026-03-15')).toHaveLength(0)
  })

  it('convertit le passé et laisse le futur intact', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-20', minutes: 480, kind: 'PREVISIONNEL' })

    const r = await convertPastForecast(userId, '2026-03', '2026-03-15')
    expect(r).toEqual({ converted: 1, skippedLocked: 0 })

    const entries = await getMonthEntries(userId, '2026-03')
    const byDate = new Map(entries.map((e) => [e.date, e.kind]))
    expect(byDate.get('2026-03-10')).toBe('REALISE')
    expect(byDate.get('2026-03-20')).toBe('PREVISIONNEL')
  })

  it('ne modifie jamais les minutes', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 240, kind: 'PREVISIONNEL' })
    await convertPastForecast(userId, '2026-03', '2026-03-15')

    const entry = (await getMonthEntries(userId, '2026-03')).find((e) => e.date === '2026-03-10')
    expect(entry!.minutes).toBe(240)
  })

  it('saute une mission dont le CRA est validé, sans toucher aux autres', async () => {
    const line = await prisma.missionLine.findUniqueOrThrow({ where: { id: lineA } })
    await prisma.cra.create({
      data: {
        missionId: line.missionId,
        userId,
        month: new Date('2026-03-01T00:00:00Z'),
        status: 'VALIDE',
      },
    })

    // lineA et lineB appartiennent à la même mission dans ce fichier de test :
    // les deux entrées sont donc sautées.
    await prisma.timeEntry.create({
      data: { lineId: lineA, userId, date: new Date('2026-03-10T00:00:00Z'), minutes: 480, kind: 'PREVISIONNEL' },
    })

    const r = await convertPastForecast(userId, '2026-03', '2026-03-15')
    expect(r.converted).toBe(0)
    expect(r.skippedLocked).toBe(1)

    const entry = (await getMonthEntries(userId, '2026-03')).find((e) => e.date === '2026-03-10')
    expect(entry!.kind).toBe('PREVISIONNEL')

    await prisma.cra.deleteMany({ where: { userId } })
  })

  it('ne touche pas au prévisionnel d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-conv@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.timeEntry.create({
      data: { lineId: lineA, userId: autre.id, date: new Date('2026-03-10T00:00:00Z'), minutes: 480, kind: 'PREVISIONNEL' },
    })

    const r = await convertPastForecast(userId, '2026-03', '2026-03-15')
    expect(r.converted).toBe(0)

    const restant = await prisma.timeEntry.findFirst({ where: { userId: autre.id } })
    expect(restant!.kind).toBe('PREVISIONNEL')

    await prisma.user.delete({ where: { id: autre.id } })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/time-entries.test.ts`
Expected: FAIL — `listPastForecast is not a function`

- [ ] **Step 3: Écrire l'implémentation minimale**

Ajouter à `src/services/time-entries.ts` :

```ts
export async function listPastForecast(
  userId: string,
  month: string,
  today: string,
): Promise<MonthEntry[]> {
  const entries = await getMonthEntries(userId, month)
  return entries.filter((e) => e.kind === 'PREVISIONNEL' && e.date < today)
}

export async function convertPastForecast(
  userId: string,
  month: string,
  today: string,
): Promise<{ converted: number; skippedLocked: number }> {
  const candidates = await listPastForecast(userId, month, today)
  if (candidates.length === 0) return { converted: 0, skippedLocked: 0 }

  // Le verrou porte sur (mission, mois) : un même mois peut mêler une mission
  // verrouillée et une mission ouverte. On résout mission par mission.
  const lines = await prisma.missionLine.findMany({
    where: { id: { in: [...new Set(candidates.map((e) => e.lineId))] } },
    select: { id: true, missionId: true },
  })
  const missionByLine = new Map(lines.map((l) => [l.id, l.missionId]))

  const cras = await prisma.cra.findMany({
    where: {
      userId,
      month: new Date(`${month}-01T00:00:00.000Z`),
      missionId: { in: [...new Set(lines.map((l) => l.missionId))] },
    },
    select: { missionId: true, status: true },
  })
  const lockedMissions = new Set(
    cras.filter((c) => isLocked(c.status as CraStatus)).map((c) => c.missionId),
  )

  const convertibles = candidates.filter((e) => {
    const missionId = missionByLine.get(e.lineId)
    return missionId !== undefined && !lockedMissions.has(missionId)
  })

  if (convertibles.length > 0) {
    await prisma.timeEntry.updateMany({
      where: { id: { in: convertibles.map((e) => e.id) }, userId },
      data: { kind: 'REALISE' },
    })
  }

  return {
    converted: convertibles.length,
    skippedLocked: candidates.length - convertibles.length,
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/time-entries.test.ts`
Expected: PASS — les 7 tests nouveaux plus tous les existants

- [ ] **Step 5: Écrire l'encart et son action**

Ajouter à `src/app/(app)/saisie/[month]/actions.ts` :

```ts
import { convertPastForecast } from '@/services/time-entries'

export async function validerJoursPasses(formData: FormData) {
  const user = await requireUser()
  const month = String(formData.get('month'))
  const today = new Date().toISOString().slice(0, 10)

  await convertPastForecast(user.id, month, today)
  revalidatePath(`/saisie/${month}`)
}
```

`src/app/(app)/saisie/[month]/PastForecastNotice.tsx` :

```tsx
import { validerJoursPasses } from './actions'
import type { MonthEntry } from '@/services/time-entries'

export function PastForecastNotice({
  month,
  entries,
  lockedCount,
}: {
  month: string
  entries: MonthEntry[]
  lockedCount: number
}) {
  if (entries.length === 0) return null

  const convertibles = entries.length - lockedCount

  return (
    <section className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      <p className="mb-2 text-amber-900">
        {entries.length === 1
          ? '1 jour prévu est déjà passé.'
          : `${entries.length} jours prévus sont déjà passés.`}{' '}
        Ils ne deviendront du temps réalisé que si tu le décides.
      </p>

      <ul className="mb-2 flex flex-wrap gap-2 text-xs text-amber-800">
        {entries.map((e) => (
          <li key={e.id} className="rounded bg-amber-100 px-2 py-0.5">
            {e.date}
          </li>
        ))}
      </ul>

      {convertibles > 0 ? (
        <form action={validerJoursPasses}>
          <input type="hidden" name="month" value={month} />
          <button className="rounded border border-amber-400 bg-white px-3 py-1">
            Valider {convertibles === 1 ? 'ce jour' : `ces ${convertibles} jours`}
          </button>
        </form>
      ) : null}

      {lockedCount > 0 && (
        <p className="mt-1 text-xs text-amber-800">
          {lockedCount === 1 ? '1 jour appartient' : `${lockedCount} jours appartiennent`} à une
          mission dont le CRA est validé. Rouvre-le pour pouvoir les convertir.
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Brancher l'encart dans la page**

Dans `src/app/(app)/saisie/[month]/page.tsx`, après le calcul des `entries` :

```tsx
  const today = new Date().toISOString().slice(0, 10)
  const pastForecast = entries.filter((e) => e.kind === 'PREVISIONNEL' && e.date < today)

  const lockedMissions = await prisma.cra.findMany({
    where: { userId: user.id, month: new Date(`${month}-01T00:00:00.000Z`), status: 'VALIDE' },
    select: { missionId: true },
  })
  const lockedIds = new Set(lockedMissions.map((c) => c.missionId))
  const lineMissions = await prisma.missionLine.findMany({
    where: { id: { in: [...new Set(pastForecast.map((e) => e.lineId))] } },
    select: { id: true, missionId: true },
  })
  const missionByLine = new Map(lineMissions.map((l) => [l.id, l.missionId]))
  const lockedCount = pastForecast.filter((e) => lockedIds.has(missionByLine.get(e.lineId) ?? '')).length
```

Puis, entre `<MonthNav />` et `<SaisieClient />` :

```tsx
      <PastForecastNotice month={month} entries={pastForecast} lockedCount={lockedCount} />
```

Ajouter les imports de `prisma` et `PastForecastNotice`.

- [ ] **Step 7: Vérifier**

Run:

```bash
npx vitest run && npx tsc --noEmit && npx next build
```

Expected: suite verte, `tsc` à 0, build abouti.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(saisie): conversion explicite du previsionnel echu"
```

---

## Task 6: Construction de la matrice de charge

**Files:**
- Create: `src/services/charge.ts`, `src/services/charge.test.ts`

**Interfaces:**
- Consumes: `fiscalYearBounds`, `caFromEntries`, `exerciceProgress`, `tjmMoyenPondere`, `resteEnCentiemes`, `computeEngagement`, `listActiveLines`, `getSettings`, `prisma`
- Produces:
  - `interface ChargeCell { realiseCentiemes: number; prevuCentiemes: number }`
  - `interface ChargeRow { lineId; label; tjmCents; cells: ChargeCell[]; engagement: EngagementSummary; resteAVendreCents }`
  - `interface ChargeMatrix { fiscalYear; rows; monthTotals; progress; resteEnJoursCentiemes }`
  - `buildChargeMatrix(userId: string, startYear: number): Promise<ChargeMatrix>`

**Le reste à planifier n'est pas recalculé** : c'est `computeEngagement` du lot 0, déjà testé, appliqué à toutes les entrées de la ligne. Une seconde implémentation du même calcul divergerait tôt ou tard.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/charge.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry } from './time-entries'
import { buildChargeMatrix } from './charge'

let userId = ''
let lineJour = ''
let lineNuit = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'charge@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id

  const c = await createClient('CHARGE client')
  const m = await createMission({ clientId: c.id, label: 'ITSM' })
  lineJour = (await createLine({
    missionId: m.id, userId, label: 'Consultant ITSM',
    soldCentiemes: 3000, tjmCents: 80000,
  })).id
  lineNuit = (await createLine({
    missionId: m.id, userId, label: 'Consultant ITSM Nuit',
    soldCentiemes: 1000, tjmCents: 120000,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    debutExerciceMois: 4,
    objectifCaExerciceCents: 15_000_000,
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'charge@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'CHARGE client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('buildChargeMatrix', () => {
  it('couvre les douze mois de l exercice, d avril à mars', async () => {
    const m = await buildChargeMatrix(userId, 2026)
    expect(m.fiscalYear.label).toBe('Exercice 2026-2027')
    expect(m.fiscalYear.months).toHaveLength(12)
    expect(m.fiscalYear.months[0]).toBe('2026-04')
    expect(m.fiscalYear.months[11]).toBe('2027-03')
    expect(m.rows[0]!.cells).toHaveLength(12)
  })

  it('range chaque saisie dans la colonne de son mois', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineJour, date: '2027-01-08', minutes: 240, kind: 'PREVISIONNEL' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells[1]!.realiseCentiemes).toBe(100)   // 2026-05
    expect(row.cells[9]!.prevuCentiemes).toBe(50)      // 2027-01
    expect(row.cells[0]!.realiseCentiemes).toBe(0)
  })

  it('ignore les saisies hors de l exercice demandé', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-03-10', minutes: 480, kind: 'REALISE' })
    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells.every((c) => c.realiseCentiemes === 0)).toBe(true)
  })

  it('calcule le CA du mois avec le TJM de chaque ligne', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineNuit, date: '2026-05-13', minutes: 480, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    expect(m.monthTotals[1]!.caCents).toBe(200000)
    expect(m.monthTotals[1]!.centiemes).toBe(200)
  })

  it('reprend computeEngagement pour le reste à planifier par ligne', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 18, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.engagement.venduCentiemes).toBe(3000)
    expect(row.engagement.realiseCentiemes).toBe(1800)
    expect(row.engagement.resteCentiemes).toBe(1200)
  })

  it('compte l engagement d une ligne sur toutes les périodes, pas seulement l exercice', async () => {
    // Saisie dans l exercice précédent : elle ne doit pas apparaître dans les
    // cellules, mais doit bien compter dans l engagement de la ligne.
    await saveEntry({ userId, lineId: lineJour, date: '2026-03-10', minutes: 480 * 5, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells.every((c) => c.realiseCentiemes === 0)).toBe(true)
    expect(row.engagement.realiseCentiemes).toBe(500)
  })

  it('calcule l avancement de l exercice et le reste à vendre', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 10, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    // 10 jours × 800 € = 8 000 € = 800 000 centimes
    expect(m.progress.objectifCents).toBe(15_000_000)
    expect(m.progress.realiseCents).toBe(800_000)
    expect(m.progress.prevuCents).toBe(0)
    expect(m.progress.resteAVendreCents).toBe(14_200_000)
  })

  it('traduit le reste à vendre en jours au TJM moyen pondéré', async () => {
    const m = await buildChargeMatrix(userId, 2026)
    // (80000*3000 + 120000*1000) / 4000 = 90 000 centimes par jour
    // 15 000 000 / 90 000 = 166,66... jours
    expect(m.resteEnJoursCentiemes).toBe(16667)
  })

  it('ne renvoie aucune ligne pour un utilisateur sans affectation', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-charge@test.local', name: 'A', passwordHash: 'x' },
    })
    const m = await buildChargeMatrix(autre.id, 2026)
    expect(m.rows).toHaveLength(0)
    expect(m.monthTotals.every((t) => t.caCents === 0)).toBe(true)
    await prisma.user.delete({ where: { id: autre.id } })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/charge.test.ts`
Expected: FAIL — `Failed to resolve import "./charge"`

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/services/charge.ts` :

```ts
import { prisma } from '@/db/client'
import { fiscalYearFromStartYear, type FiscalYear } from '@/core/fiscal/year'
import {
  caFromEntries,
  exerciceProgress,
  tjmMoyenPondere,
  resteEnCentiemes,
  type ExerciceProgress,
} from '@/core/fiscal/revenue'
import { computeEngagement, type EngagementSummary } from '@/core/engagement/compute'
import { minutesToCentiemes } from '@/core/time/units'
import { listActiveLines } from './missions'
import { getSettings } from './settings'
import { toIsoDate } from './time-entries'
import type { TimeEntryKind } from '@/core/types'

export interface ChargeCell {
  realiseCentiemes: number
  prevuCentiemes: number
}

export interface ChargeRow {
  lineId: string
  label: string
  tjmCents: number
  /** un élément par mois de l'exercice, dans l'ordre */
  cells: ChargeCell[]
  engagement: EngagementSummary
  resteAVendreCents: number
}

export interface ChargeMatrix {
  fiscalYear: FiscalYear
  rows: ChargeRow[]
  monthTotals: Array<{ centiemes: number; caCents: number }>
  progress: ExerciceProgress
  /** reste à vendre traduit en centièmes de jour, null sans TJM moyen */
  resteEnJoursCentiemes: number | null
}

export async function buildChargeMatrix(
  userId: string,
  startYear: number,
): Promise<ChargeMatrix> {
  const settings = await getSettings()
  const fiscalYear = fiscalYearFromStartYear(startYear, settings.debutExerciceMois)
  const lines = await listActiveLines(userId)

  const emptyTotals = fiscalYear.months.map(() => ({ centiemes: 0, caCents: 0 }))

  if (lines.length === 0) {
    return {
      fiscalYear,
      rows: [],
      monthTotals: emptyTotals,
      progress: exerciceProgress(settings.objectifCaExerciceCents, 0, 0),
      resteEnJoursCentiemes: null,
    }
  }

  const lineIds = lines.map((l) => l.id)
  const monthIndex = new Map(fiscalYear.months.map((m, i) => [m, i]))

  // Toutes les entrées de l'utilisateur sur ces lignes, sans borne de date :
  // les cellules sont filtrées par mois, mais l'engagement se calcule sur
  // toute la durée de la ligne — comme au lot 0.
  const rows = await prisma.timeEntry.findMany({
    where: { userId, lineId: { in: lineIds } },
    select: { lineId: true, date: true, minutes: true, kind: true },
  })

  const entries = rows.map((r) => ({
    lineId: r.lineId,
    date: toIsoDate(r.date),
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
  }))

  const priced = lines.map((l) => ({
    id: l.id,
    tjmCents: 0,
    minutesParJour: l.minutesParJour,
  }))
  const tjmByLine = await prisma.missionLine.findMany({
    where: { id: { in: lineIds } },
    select: { id: true, tjmCents: true },
  })
  const tjmMap = new Map(tjmByLine.map((l) => [l.id, l.tjmCents]))
  for (const p of priced) p.tjmCents = tjmMap.get(p.id) ?? 0

  const monthTotals = emptyTotals.map(() => ({ centiemes: 0, caCents: 0 }))

  const chargeRows: ChargeRow[] = lines.map((line) => {
    const lineEntries = entries.filter((e) => e.lineId === line.id)
    const cells: ChargeCell[] = fiscalYear.months.map(() => ({
      realiseCentiemes: 0,
      prevuCentiemes: 0,
    }))

    for (const e of lineEntries) {
      const i = monthIndex.get(e.date.slice(0, 7))
      if (i === undefined) continue
      const c = minutesToCentiemes(e.minutes, line.minutesParJour)
      if (e.kind === 'REALISE') cells[i]!.realiseCentiemes += c
      else cells[i]!.prevuCentiemes += c
      monthTotals[i]!.centiemes += c
    }

    const engagement = computeEngagement({
      venduCentiemes: line.soldCentiemes,
      entries: lineEntries,
      minutesParJour: line.minutesParJour,
    })

    const tjmCents = tjmMap.get(line.id) ?? 0

    return {
      lineId: line.id,
      label: `${line.clientName} · ${line.missionLabel} · ${line.label}`,
      tjmCents,
      cells,
      engagement,
      resteAVendreCents: Math.round((engagement.resteCentiemes * tjmCents) / 100),
    }
  })

  for (const [i, month] of fiscalYear.months.entries()) {
    const ofMonth = entries.filter((e) => e.date.slice(0, 7) === month)
    monthTotals[i]!.caCents = caFromEntries(ofMonth, priced)
  }

  const inYear = entries.filter((e) => monthIndex.has(e.date.slice(0, 7)))
  const realiseCents = caFromEntries(inYear.filter((e) => e.kind === 'REALISE'), priced)
  const prevuCents = caFromEntries(inYear.filter((e) => e.kind === 'PREVISIONNEL'), priced)
  const progress = exerciceProgress(settings.objectifCaExerciceCents, realiseCents, prevuCents)

  const tjmMoyen = tjmMoyenPondere(
    lines.map((l) => ({ tjmCents: tjmMap.get(l.id) ?? 0, soldCentiemes: l.soldCentiemes })),
  )

  return {
    fiscalYear,
    rows: chargeRows,
    monthTotals,
    progress,
    resteEnJoursCentiemes: resteEnCentiemes(progress.resteAVendreCents, tjmMoyen),
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/charge.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Lancer toute la suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: suite entièrement verte, `tsc` à 0

- [ ] **Step 6: Commit**

```bash
git add src/services/charge.ts src/services/charge.test.ts
git commit -m "feat(charge): matrice lignes x mois et avancement d'exercice"
```

---

## Task 7: L'écran du plan de charge

**Files:**
- Create: `src/components/charge/ExerciceBar.tsx`, `src/components/charge/ChargeTable.tsx`, `src/app/(app)/charge/page.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `buildChargeMatrix`, `ChargeMatrix`, `requireUser`, `fiscalYearBounds`, `getSettings`
- Produces: la route `/charge`, avec un sélecteur d'exercice par `?ex=YYYY`

- [ ] **Step 1: Écrire le test qui échoue**

`src/components/charge/ExerciceBar.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ExerciceBar } from './ExerciceBar'

afterEach(cleanup)

const base = {
  objectifCents: 15_000_000,
  realiseCents: 4_000_000,
  prevuCents: 3_000_000,
  resteAVendreCents: 8_000_000,
  depassementCents: 0,
  tauxCouverture: 7 / 15,
}

describe('ExerciceBar', () => {
  it('affiche le libellé de l exercice', () => {
    render(<ExerciceBar label="Exercice 2026-2027" progress={base} resteEnJoursCentiemes={8889} />)
    expect(screen.getByText(/Exercice 2026-2027/)).toBeDefined()
  })

  it('met le reste à vendre en avant, en euros et en jours', () => {
    render(<ExerciceBar label="Exercice 2026-2027" progress={base} resteEnJoursCentiemes={8889} />)
    const reste = screen.getByTestId('reste-a-vendre')
    // `toLocaleString('fr-FR')` sépare les milliers par une espace fine
    // insécable (U+202F), pas par une espace ordinaire : comparer au texte
    // brut produirait un test faux. On neutralise donc toutes les espaces.
    const sansEspaces = reste.textContent!.replace(/\s/g, '')
    expect(sansEspaces).toContain('80000')
    expect(sansEspaces).toContain('88,89')
  })

  it('masque la conversion en jours sans TJM moyen', () => {
    render(<ExerciceBar label="Exercice 2026-2027" progress={base} resteEnJoursCentiemes={null} />)
    expect(screen.getByTestId('reste-a-vendre').textContent).not.toContain('jours')
  })

  it('ne rend rien quand l objectif n est pas défini', () => {
    const sansObjectif = { ...base, objectifCents: 0, resteAVendreCents: 0, tauxCouverture: 0 }
    const { container } = render(
      <ExerciceBar label="Exercice 2026-2027" progress={sansObjectif} resteEnJoursCentiemes={null} />,
    )
    expect(container.textContent).toBe('')
  })

  it('signale un dépassement d objectif', () => {
    const depasse = { ...base, resteAVendreCents: 0, depassementCents: 2_000_000 }
    render(<ExerciceBar label="Exercice 2026-2027" progress={depasse} resteEnJoursCentiemes={null} />)
    expect(screen.getByText(/dépassé/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/components/charge/ExerciceBar.test.tsx`
Expected: FAIL — `Failed to resolve import "./ExerciceBar"`

- [ ] **Step 3: Écrire la barre d'exercice**

`src/components/charge/ExerciceBar.tsx` :

```tsx
import type { ExerciceProgress } from '@/core/fiscal/revenue'

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

function jours(centiemes: number): string {
  return (centiemes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })
}

export function ExerciceBar({
  label,
  progress,
  resteEnJoursCentiemes,
}: {
  label: string
  progress: ExerciceProgress
  resteEnJoursCentiemes: number | null
}) {
  // Sans objectif, un taux de couverture ne veut rien dire : on n'affiche rien
  // plutôt que des pourcentages vides de sens.
  if (progress.objectifCents === 0) return null

  const pct = (v: number) => Math.min(100, (v / progress.objectifCents) * 100)

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-slate-600">
        {label} · objectif {euros(progress.objectifCents)} €
      </h2>

      <div className="mb-2 h-3 w-full overflow-hidden rounded bg-slate-200">
        <div className="flex h-full">
          <div className="bg-slate-800" style={{ width: `${pct(progress.realiseCents)}%` }} />
          <div className="bg-slate-400" style={{ width: `${pct(progress.prevuCents)}%` }} />
        </div>
      </div>

      <p className="text-sm text-slate-600">
        {euros(progress.realiseCents)} € réalisés · {euros(progress.prevuCents)} € prévus ·{' '}
        {Math.round(progress.tauxCouverture * 100)} % de couverture
      </p>

      <p data-testid="reste-a-vendre" className="mt-1 text-base font-medium">
        {progress.depassementCents > 0 ? (
          <span className="text-emerald-700">
            Objectif dépassé de {euros(progress.depassementCents)} €
          </span>
        ) : (
          <>
            Reste à vendre : {euros(progress.resteAVendreCents)} €
            {resteEnJoursCentiemes !== null && (
              <span className="text-slate-500">
                {' '}
                — environ {jours(resteEnJoursCentiemes)} jours
              </span>
            )}
          </>
        )}
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/components/charge/ExerciceBar.test.tsx`
Expected: PASS — 5 tests

- [ ] **Step 5: Écrire la matrice**

`src/components/charge/ChargeTable.tsx` :

```tsx
import type { ChargeMatrix } from '@/services/charge'

const MOIS_COURT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']

function moisCourt(month: string): string {
  return `${MOIS_COURT[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`
}

function jours(centiemes: number): string {
  return centiemes === 0 ? '' : String(centiemes / 100).replace('.', ',')
}

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

export function ChargeTable({ matrix }: { matrix: ChargeMatrix }) {
  if (matrix.rows.length === 0) {
    return <p className="text-slate-500">Aucune ligne de prestation active.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-white px-2 py-1 text-left">
              Ligne de prestation
            </th>
            {matrix.fiscalYear.months.map((m) => (
              <th key={m} scope="col" className="w-16 px-1 py-1 text-center text-xs font-normal">
                {moisCourt(m)}
              </th>
            ))}
            <th scope="col" className="px-3 py-1 text-right">Reste à planifier</th>
          </tr>
        </thead>

        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.lineId} className="border-t">
              <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left font-normal">
                {row.label}
              </th>

              {row.cells.map((cell, i) => (
                <td key={i} className="px-1 py-1 text-center text-xs">
                  {cell.realiseCentiemes > 0 && <span>{jours(cell.realiseCentiemes)}</span>}
                  {cell.prevuCentiemes > 0 && (
                    <span className="text-slate-400 italic">
                      {cell.realiseCentiemes > 0 ? ' + ' : ''}
                      {jours(cell.prevuCentiemes)}
                    </span>
                  )}
                </td>
              ))}

              <td className="px-3 py-1 text-right text-xs">
                {row.engagement.resteCentiemes / 100} j · {euros(row.resteAVendreCents)} €
                {row.engagement.depassementCentiemes > 0 && (
                  <span className="ml-1 text-amber-600">
                    (+{row.engagement.depassementCentiemes / 100} j)
                  </span>
                )}
              </td>
            </tr>
          ))}

          <tr className="border-t-2 font-medium">
            <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left">
              Total
            </th>
            {matrix.monthTotals.map((t, i) => (
              <td key={i} data-testid={`total-${matrix.fiscalYear.months[i]}`} className="px-1 py-1 text-center text-xs">
                <div>{jours(t.centiemes)}</div>
                <div className="text-slate-500">{t.caCents === 0 ? '' : `${euros(t.caCents)} €`}</div>
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Écrire la page et le lien de navigation**

`src/app/(app)/charge/page.tsx` :

```tsx
import Link from 'next/link'
import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { buildChargeMatrix } from '@/services/charge'
import { fiscalYearBounds } from '@/core/fiscal/year'
import { ExerciceBar } from '@/components/charge/ExerciceBar'
import { ChargeTable } from '@/components/charge/ChargeTable'

export default async function ChargePage({
  searchParams,
}: {
  searchParams: Promise<{ ex?: string }>
}) {
  const user = await requireUser()
  const { ex } = await searchParams
  const settings = await getSettings()

  const courant = fiscalYearBounds(
    new Date().toISOString().slice(0, 10),
    settings.debutExerciceMois,
  )
  const startYear = ex ? Number(ex) : Number(courant.start.slice(0, 4))

  const matrix = await buildChargeMatrix(user.id, startYear)

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Plan de charge</h1>
        <Link href={`/charge?ex=${startYear - 1}`} className="rounded border px-2 py-1 text-sm">
          ← Exercice précédent
        </Link>
        <Link href={`/charge?ex=${startYear + 1}`} className="rounded border px-2 py-1 text-sm">
          Exercice suivant →
        </Link>
      </div>

      <ExerciceBar
        label={matrix.fiscalYear.label}
        progress={matrix.progress}
        resteEnJoursCentiemes={matrix.resteEnJoursCentiemes}
      />

      {settings.objectifCaExerciceCents === 0 && (
        <p className="mb-4 text-sm text-slate-500">
          Aucun objectif de chiffre d’affaires n’est défini.{' '}
          <Link href="/admin/saisie" className="underline">
            En saisir un
          </Link>{' '}
          fait apparaître le reste à vendre.
        </p>
      )}

      <ChargeTable matrix={matrix} />
    </main>
  )
}
```

Dans `src/app/(app)/layout.tsx`, ajouter le lien dans la navigation, entre « Saisie » et « Missions » :

```tsx
<Link href="/charge">Charge</Link>
```

- [ ] **Step 7: Vérifier**

Run:

```bash
npx vitest run && npx tsc --noEmit && npx next build
```

Expected: suite entièrement verte, `tsc` à 0, build abouti avec la route `/charge`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(charge): ecran du plan de charge et barre d'exercice"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche |
|---|---|
| `fiscalYearBounds`, libellé, 12 mois | 1 |
| `caFromEntries` | 2 |
| `exerciceProgress`, plafonnement et dépassement | 2 |
| `tjmMoyenPondere`, `resteEnCentiemes` | 2 |
| `objectifCaExerciceCents`, `debutExerciceMois` | 3 |
| Objectif à zéro = barre masquée | 3, 7 |
| Navigation entre mois | 4 |
| `listPastForecast`, `convertPastForecast` | 5 |
| Conversion jamais automatique | 5 |
| Mois verrouillé refuse la conversion | 5 |
| `buildChargeMatrix`, `ChargeMatrix` | 6 |
| Réutilisation de `computeEngagement` | 6 |
| Barre d'exercice, reste à vendre en € et en jours | 7 |
| Matrice lignes × mois, marges droite et basse | 7 |
| Sélecteur d'exercice | 7 |
| Scope par `userId` sur tous les services | 5, 6, testé |
| Entiers partout, `tauxCouverture` seul flottant non persisté | 2 |

**Écart assumé par rapport à la spec** — §5 annonçait pour `convertPastForecast` un refus binaire `{ ok: false, reason: 'VERROUILLE' }`. Le verrou portant sur un couple *(mission, mois)*, un même mois peut mêler une mission verrouillée et une mission ouverte. La tâche 5 traite donc les missions ouvertes et compte celles qu'elle saute : `{ converted, skippedLocked }`. La spec sera alignée à la fin du lot.

**Hors périmètre, conformément à la spec :** moteur de répartition automatique, objectif mensuel, facturation, Google Calendar (lot 1b), surface mobile (lot 1c).
