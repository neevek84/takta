# Lot 1e — Système de design · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'application l'identité de KreativPM et une grammaire visuelle réutilisable, avec un garde-fou qui rend structurellement impossible de produire une palette illisible — le contraste est calculé, jamais jugé à l'œil, et une palette fautive est refusée à l'enregistrement.

**Architecture:** Un calcul de contraste pur dans `src/core/theme/`, un jeu de jetons par défaut vérifié par ce calcul, un thème paramétrable stocké en JSON dans les réglages et injecté en variables CSS sur la racine, une bibliothèque de composants limitée à ce que les écrans utilisent, et l'habillage des écrans existants.

**Tech Stack:** Next.js 15 · TypeScript · Tailwind 4 (CSS-first) · Prisma 6 · SQLite en développement · Vitest · happy-dom

**Spec :** `docs/superpowers/specs/2026-08-15-lot-1e-systeme-de-design-design.md`

## Global Constraints

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** Le calcul de contraste et les jetons y vivent : ils doivent être testables sans DOM ni base.
- **Aucun enum Prisma, aucun décimal persisté.** Entiers partout.
- **Portabilité SQLite/Postgres** : pas de tableau, pas de requête fine sur du JSON. **Le thème est lu et écrit en bloc**, comme les créneaux et les fériés.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus.** *Exception assumée et déjà en place :* `Settings` est un singleton (`id = 'singleton'`), et `getSettings`/`updateSettings` ne prennent pas de `userId`. Le thème vit dans cette même ligne : `getTheme`/`updateTheme`/`resetTheme` n'en prennent pas non plus. La règle porte sur les données scopées par utilisateur, pas sur le réglage global.
- **Validation zod dans le service, jamais dans le formulaire** — patron de `src/services/settings.ts`. Le formulaire transcrit et affiche ; il ne juge pas.
- Français pour les chaînes visibles, anglais pour le code et les messages de commit.
- `vitest.config.ts` est en `fileParallelism: false` — ne pas le modifier.
- Tests de composants : `// @vitest-environment happy-dom` en **première ligne**, `afterEach(cleanup)` explicite. `jsdom` ne fonctionne pas dans cet environnement (voir le commentaire de `vitest.config.ts`).
- `toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable U+202F : tout test comparant un montant formaté neutralise les espaces (`.replace(/\s/g, '')`).
- **Ne jamais exécuter `npx next build`** : le serveur de développement du porteur du produit tourne sur cet arbre.
- **307 tests passent aujourd'hui** (28 fichiers). Aucun ne disparaît. Deux assertions de classe, et deux seulement, sont réécrites — elles sont nommées en tâche 10.

---

## Décision : comment les variables CSS du thème cohabitent avec Tailwind 4

**État des lieux, vérifié dans l'arbre.** `src/app/globals.css` contient une seule ligne : `@import "tailwindcss";`. `postcss.config.mjs` ne charge que `@tailwindcss/postcss`. **Il n'existe aucun `tailwind.config.js`** — Tailwind 4 est en configuration CSS-first, et un fichier de configuration JS ne serait pas lu sans `@config`.

**Ce que produit Tailwind 4, vérifié en compilant un échantillon avec le `@tailwindcss/postcss` installé :**

```css
@layer theme {
  :root, :host {
    --color-page: #faf5ed;   /* les valeurs de @theme, telles quelles */
  }
}
@layer utilities {
  .bg-page { background-color: var(--color-page); }   /* la variable, pas la valeur */
}
```

**Décision : les jetons par défaut sont déclarés dans `@theme` (jamais `@theme inline`), et le thème enregistré est injecté en `style` inline sur `<html>` par le layout racine.**

Justification :

1. `@theme` fait référencer `var(--color-…)` par les utilitaires. Redéfinir la variable plus haut dans la cascade change la couleur **sans reconstruire quoi que ce soit** — c'est exactement l'exigence « un thème enregistré s'applique sans reconstruction ».
2. `@theme inline` substituerait la **valeur** dans chaque utilitaire (`background-color: #faf5ed`). Le thème paramétrable deviendrait alors impossible. C'est le piège de ce lot, et la raison pour laquelle la tâche 4 comporte un test qui échoue si `@theme inline` apparaît dans `globals.css`.
3. Les variables de `@theme` atterrissent dans `@layer theme`. Un `style` inline sur `<html>` l'emporte dans tous les cas, sans `!important`, sans guerre de spécificité, et sans second point de vérité. Une balise `<style>` générée aurait marché aussi, mais elle duplique la déclaration des jetons et ajoute un ordre d'insertion à surveiller.
4. Le layout racine est un composant serveur : les variables sont rendues côté serveur, dans le HTML initial. Pas de scintillement, pas d'effet client.

**Ce qui a été écarté :** un `tailwind.config.js` avec `theme.colors` (Tailwind 4 ne le lit pas sans `@config`, et ce serait un retour en arrière) ; `--color-*: initial` pour effacer la palette Tailwind par défaut (une classe `bg-slate-100` oubliée ne produirait alors **rien**, silencieusement — on préfère la garder valide et la faire échouer bruyamment dans le test de la tâche 11, qui nomme le fichier fautif).

---

## Décision : les jetons d'état et le rôle de l'or

La spec fixe `#D4943F` comme couleur de marque et constate qu'elle donne ~2,4:1 sur le crème. **Valeurs recalculées par la formule WCAG 2.1, à citer telles quelles :**

| Couple | Rapport |
|---|---|
| `#D4943F` sur `#FAF5ED` (l'or en texte) | **2,38:1** — refusé |
| `#FFFFFF` sur `#D4943F` (blanc sur l'or) | **2,59:1** — refusé |
| `#2A211A` sur `#D4943F` (brun profond sur l'or) | **6,09:1** — retenu |
| `#342820` sur `#FAF5ED` (l'encre) | **13,15:1** |
| `#B57730` sur `#FAF5ED` | **3,42:1** — insuffisant pour du texte |

Conséquences, toutes tenues par le calcul et non par le goût :

- **L'or (`accent`) ne porte jamais de texte autrement qu'en `onAccent = #2A211A`.** Le blanc sur l'or est écarté par le calcul, pas par préférence.
- **`#B57730` (`accentDark`) n'est jamais un fond de texte ni une couleur de texte.** Il sert aux bordures, à l'anneau de focus et aux remplissages de barres — usages non textuels, vérifiés à 3:1 (3,42 sur le crème, 3,71 sur le blanc). La spec l'envisageait pour du texte à 3,3:1 en corps 16 px ; la règle « tout couple texte/fond atteint 4,5:1 » prime, donc le texte interactif reçoit son propre jeton.
- **`link = #8C5A23`** — ambre assombri, **5,37:1** sur le crème, **5,83:1** sur le blanc. C'est lui qui porte les liens et les libellés d'action, à toutes les tailles.
- **Le survol d'un bouton plein n'assombrit pas l'or** (le couple `onAccent`/or assombri tombe à 4,24:1) : il **inverse** le bouton en `inkDeep` + `onDark`, à 14,53:1. Un survol lisible, et perceptible sans distinguer les teintes.

Les quatre couleurs d'état sont inventées dans la famille chaude, comme la spec l'exige, et chacune atteint au moins 5,99:1 de son encre sur son propre fond.

---

## Interfaces existantes

```ts
// src/services/settings.ts — patron à suivre pour le thème
interface AppSettings { minutesParJour; capacityMode; capacityCentiemes; workingDays;
                        slots; holidays; defaultDisplayUnit; defaultEngagementSource;
                        objectifCaExerciceCents; debutExerciceMois }
getSettings(): Promise<AppSettings>
updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>   // valide en zod, jette SettingsValidationError
class SettingsValidationError extends Error { errors: string[] }
validateSettingsPatch(patch): { ok: true } | { ok: false; errors: string[] }

// src/services/missions.ts
interface LineForGrid { id; label; missionLabel; clientName; displayUnit;
                        minutesParJour; soldCentiemes; allowedSlotIds }

// src/services/time-entries.ts
interface MonthEntry { id; lineId; date; minutes; kind; slotId; minutesParJour }
type LineEngagementTotals = ReadonlyArray<{ kind: TimeEntryKind; minutes: number; minutesParJour: number }>

// src/services/rates.ts
previewRecalibration(userId): Promise<{ concernees: number; verrouillees: number }>
recalibrateOpenMonths(userId): Promise<{ recalibrees: number; sauteesVerrouillees: number }>

// src/core/types.ts
type CraStatus = 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'
type TimeEntryKind = 'REALISE' | 'PREVISIONNEL'

// src/core/month/build.ts
interface MonthDay { date: string; isWorking: boolean; isHoliday: boolean; /* … */ }
```

**Composants existants et leurs points d'ancrage de test** — à ne pas casser :

| Composant | `data-testid` exposés |
|---|---|
| `src/components/grid/MonthGrid.tsx` | `day-header-{date}` |
| `src/components/grid/TotalsRow.tsx` | `total-{date}` |
| `src/components/grid/EngagementBar.tsx` | `engagement-{lineId}` |
| `src/components/charge/ChargeTable.tsx` | `cell-{lineId}-{month}`, `reste-{lineId}`, `total-{month}` |
| `src/components/charge/ExerciceBar.tsx` | `bar-realise`, `bar-prevu`, `reste-a-vendre` |

**Les seules assertions de classe de toute la suite** (relevées par recherche, pas supposées) :

- `src/components/grid/MonthGrid.test.tsx:91` — `expect(header.className).toContain('bg-slate-100')`
- `src/components/grid/MonthGrid.test.tsx:98` — `expect(total.className).toContain('text-red-600')`

Tout le reste s'appuie sur du texte, des rôles ARIA ou des `data-testid`. Le remplacement de classes est donc sans risque **partout ailleurs**.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/core/theme/contrast.ts` | Calcul de contraste WCAG, pur |
| `src/core/theme/tokens.ts` | Jetons, préréglages, couples vérifiés, validation de palette |
| `src/core/theme/css-vars.ts` | Jetons → variables CSS, pur |
| `src/services/theme.ts` | Lecture/écriture du thème en réglages, zod + refus au contraste |
| `prisma/schema.prisma` | *(modifié)* `Settings.themeJson` |
| `src/app/globals.css` | *(modifié)* jetons par défaut, échelles, motifs, focus |
| `scripts/sync-fonts.mjs` | Copie des `woff2` depuis les paquets fontsource |
| `src/app/fonts/` | Inter et Manrope embarquées |
| `src/app/layout.tsx` | *(modifié)* polices + injection du thème |
| `src/components/ui/*` | Bibliothèque : Button, Field, Select, Checkbox, Card, DataTable, Badge, Banner, ConfirmDialog, PageShell |
| `src/components/cra/StatusBadge.tsx` | Badge de statut de CRA |
| `src/app/(app)/admin/theme/*` | Écran d'administration du thème |
| `src/design-system.test.ts` | Garde-fous : couleurs en dur, focus, cibles tactiles |

**Dépendances :** 1 → 2 → {4, 5} ; 3 → 4 ; 5 → 6 ; 4 → 7 → 8 → {9, 10} ; toutes → 11.

---

## Task 1: Le calcul de contraste

**Files:** Create `src/core/theme/contrast.ts`, `src/core/theme/contrast.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `parseHexColor(hex: string): { r: number; g: number; b: number }`
  - `relativeLuminance(hex: string): number`
  - `contrastRatio(a: string, b: string): number`
  - `formatRatio(value: number): string`
  - `AA_TEXT_RATIO = 4.5`, `NON_TEXT_RATIO = 3`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/theme/contrast.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  parseHexColor,
  relativeLuminance,
  contrastRatio,
  formatRatio,
  AA_TEXT_RATIO,
  NON_TEXT_RATIO,
} from './contrast'

describe('parseHexColor', () => {
  it('lit une notation à six chiffres', () => {
    expect(parseHexColor('#342820')).toEqual({ r: 0x34, g: 0x28, b: 0x20 })
  })

  it('accepte les minuscules comme les majuscules', () => {
    expect(parseHexColor('#faf5ed')).toEqual(parseHexColor('#FAF5ED'))
  })

  it('refuse une notation à trois chiffres', () => {
    // Accepter #fff obligerait chaque appelant à normaliser avant de comparer
    // deux jetons ; une seule forme canonique évite toute ambiguïté.
    expect(() => parseHexColor('#fff')).toThrow()
  })

  it('refuse ce qui n est pas une couleur', () => {
    expect(() => parseHexColor('FAF5ED')).toThrow()
    expect(() => parseHexColor('#GGGGGG')).toThrow()
    expect(() => parseHexColor('rouge')).toThrow()
    expect(() => parseHexColor('')).toThrow()
  })
})

describe('relativeLuminance', () => {
  it('donne 0 pour le noir et 1 pour le blanc', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#FFFFFF')).toBe(1)
  })

  it('applique la correction gamma, pas une moyenne linéaire', () => {
    // Un gris à mi-course (128/255 = 0,502) ne rend pas 0,5 de luminance :
    // la courbe sRGB le ramène à ~0,216. Une implémentation qui rendrait 0,5
    // aurait sauté la linéarisation.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4)
  })
})

describe('contrastRatio', () => {
  it('donne 21 entre le noir et le blanc', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10)
  })

  it('donne 1 entre une couleur et elle-même', () => {
    expect(contrastRatio('#342820', '#342820')).toBeCloseTo(1, 10)
  })

  it('est symétrique', () => {
    expect(contrastRatio('#D4943F', '#FAF5ED')).toBeCloseTo(
      contrastRatio('#FAF5ED', '#D4943F'),
      10,
    )
  })

  it('encadre le seuil AA sur les valeurs de référence WCAG', () => {
    // #767676 sur blanc est le gris le plus clair qui passe AA ; #777777 échoue.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.5422, 4)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.4781, 4)
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT_RATIO)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(AA_TEXT_RATIO)
  })

  it('confirme par calcul les couples que la spec énonce', () => {
    // L'or de la marque en texte sur le crème : le cas que le lot doit refuser.
    expect(contrastRatio('#D4943F', '#FAF5ED')).toBeCloseTo(2.3866, 4)
    // L'encre de la marque sur le crème : confortable.
    expect(contrastRatio('#342820', '#FAF5ED')).toBeCloseTo(13.1589, 4)
    // Le blanc sur l'or échoue ; le brun profond sur l'or passe.
    expect(contrastRatio('#FFFFFF', '#D4943F')).toBeCloseTo(2.5903, 4)
    expect(contrastRatio('#2A211A', '#D4943F')).toBeCloseTo(6.0914, 4)
  })

  it('propage le refus d une couleur illisible plutôt que de rendre NaN', () => {
    expect(() => contrastRatio('#zzzzzz', '#FFFFFF')).toThrow()
  })
})

describe('formatRatio', () => {
  it('tronque vers le bas et sépare à la française', () => {
    // Tronquer, pas arrondir : un rapport de 4,499 affiché « 4,50 » ferait
    // croire à l'utilisateur que sa palette est passée à un cheveu près
    // alors qu'elle a été refusée.
    expect(formatRatio(4.4999)).toBe('4,49')
    expect(formatRatio(2.3866)).toBe('2,38')
    expect(formatRatio(21)).toBe('21,00')
  })
})

describe('seuils', () => {
  it('expose les seuils WCAG AA', () => {
    expect(AA_TEXT_RATIO).toBe(4.5)
    expect(NON_TEXT_RATIO).toBe(3)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/theme/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "./contrast"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/theme/contrast.ts` :

```ts
/** Seuil WCAG 2.1 AA pour du texte. */
export const AA_TEXT_RATIO = 4.5
/** Seuil WCAG 2.1 AA pour un élément non textuel (bordure, anneau de focus). */
export const NON_TEXT_RATIO = 3

export interface Rgb {
  r: number
  g: number
  b: number
}

const HEX_SIX = /^#[0-9a-fA-F]{6}$/

/**
 * Seule forme acceptée : `#RRGGBB`. La notation à trois chiffres et les noms
 * CSS sont refusés — deux écritures d'une même couleur rendraient toute
 * comparaison de jetons ambiguë, et `<input type="color">` ne produit de
 * toute façon que cette forme.
 */
export function parseHexColor(hex: string): Rgb {
  if (!HEX_SIX.test(hex)) {
    throw new Error(`Couleur invalide : « ${hex} ». Format attendu : #RRGGBB.`)
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

/** Linéarisation sRGB d'un canal 0-255, formule WCAG 2.1. */
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** Rapport de contraste WCAG 2.1, entre 1 et 21. Symétrique. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const clair = Math.max(la, lb)
  const sombre = Math.min(la, lb)
  return (clair + 0.05) / (sombre + 0.05)
}

/**
 * Rapport prêt à afficher, tronqué vers le bas. Arrondir ferait afficher
 * « 4,50 » pour un rapport de 4,4999 refusé : le message contredirait la
 * décision.
 */
export function formatRatio(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2).replace('.', ',')
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/theme/contrast.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer temporairement `linearize` par `c => channel / 255` (pas de correction gamma) et confirmer que « applique la correction gamma » **et** les valeurs de référence WCAG échouent. Restaurer ensuite.

- [ ] **Step 6: Commit**

```bash
git add src/core/theme/
git commit -m "feat(core): WCAG contrast ratio computation"
```

---

## Task 2: Les jetons, les préréglages et la validation de palette

**Files:** Create `src/core/theme/tokens.ts`, `src/core/theme/tokens.test.ts`

**Interfaces:**
- Consumes: `contrastRatio`, `relativeLuminance`, `formatRatio`, `AA_TEXT_RATIO`, `NON_TEXT_RATIO` de la tâche 1
- Produces:
  - `interface ThemeTokens` — 26 clés, toutes `string` en `#RRGGBB`
  - `THEME_TOKEN_KEYS: readonly (keyof ThemeTokens)[]`
  - `TOKEN_LABELS: Record<keyof ThemeTokens, string>` — libellés français
  - `THEME_KREATIVPM: ThemeTokens`, `THEME_NEUTRE: ThemeTokens`, `DEFAULT_THEME: ThemeTokens`
  - `THEME_PRESETS: ReadonlyArray<{ id: 'KREATIVPM' | 'NEUTRE'; label: string; tokens: ThemeTokens }>`
  - `TEXT_PAIRS`, `NON_TEXT_PAIRS: ReadonlyArray<{ text: keyof ThemeTokens; background: keyof ThemeTokens }>`
  - `interface ContrastIssue { text; background; ratio: number; required: number }`
  - `findContrastIssues(tokens: ThemeTokens): ContrastIssue[]`
  - `describeContrastIssue(issue: ContrastIssue): string`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/theme/tokens.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { contrastRatio, relativeLuminance, AA_TEXT_RATIO, NON_TEXT_RATIO } from './contrast'
import {
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  THEME_KREATIVPM,
  THEME_NEUTRE,
  THEME_PRESETS,
  DEFAULT_THEME,
  TEXT_PAIRS,
  NON_TEXT_PAIRS,
  findContrastIssues,
  describeContrastIssue,
  type ThemeTokens,
} from './tokens'

const PALETTES: ReadonlyArray<[string, ThemeTokens]> = [
  ['KreativPM', THEME_KREATIVPM],
  ['Neutre', THEME_NEUTRE],
]

describe('inventaire des jetons', () => {
  it('énumère exactement les clés du type', () => {
    expect([...THEME_TOKEN_KEYS].sort()).toEqual(Object.keys(THEME_KREATIVPM).sort())
  })

  it('donne un libellé français à chaque jeton', () => {
    for (const key of THEME_TOKEN_KEYS) {
      expect(TOKEN_LABELS[key]).toBeTruthy()
    }
  })

  it('définit chaque jeton en #RRGGBB dans chaque préréglage', () => {
    for (const [nom, palette] of PALETTES) {
      for (const key of THEME_TOKEN_KEYS) {
        expect(palette[key], `${nom}.${key}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('prend KreativPM pour défaut', () => {
    expect(DEFAULT_THEME).toEqual(THEME_KREATIVPM)
  })

  it('expose les deux préréglages annoncés', () => {
    expect(THEME_PRESETS.map((p) => p.id)).toEqual(['KREATIVPM', 'NEUTRE'])
    expect(THEME_PRESETS[0]!.tokens).toEqual(THEME_KREATIVPM)
    expect(THEME_PRESETS[1]!.tokens).toEqual(THEME_NEUTRE)
  })
})

// C'est le test que la spec réclame : il parcourt les couples texte/fond des
// jetons par défaut et échoue sous 4,5:1. Il empêche la dérive au fil des
// ajouts, y compris ceux des lots suivants.
describe('contraste des palettes livrées', () => {
  it('déclare 24 couples texte/fond', () => {
    expect(TEXT_PAIRS).toHaveLength(24)
  })

  for (const [nom, palette] of PALETTES) {
    it(`${nom} : chaque couple texte/fond atteint 4,5:1`, () => {
      for (const pair of TEXT_PAIRS) {
        const ratio = contrastRatio(palette[pair.text], palette[pair.background])
        expect(ratio, `${pair.text} sur ${pair.background}`).toBeGreaterThanOrEqual(AA_TEXT_RATIO)
      }
    })

    it(`${nom} : chaque couple non textuel atteint 3:1`, () => {
      for (const pair of NON_TEXT_PAIRS) {
        const ratio = contrastRatio(palette[pair.text], palette[pair.background])
        expect(ratio, `${pair.text} sur ${pair.background}`).toBeGreaterThanOrEqual(NON_TEXT_RATIO)
      }
    })

    it(`${nom} : ne présente aucun défaut`, () => {
      expect(findContrastIssues(palette)).toEqual([])
    })
  }

  it('garde une marge réelle, pas un passage de justesse', () => {
    const pire = Math.min(
      ...TEXT_PAIRS.map((p) => contrastRatio(THEME_KREATIVPM[p.text], THEME_KREATIVPM[p.background])),
    )
    // Le pire couple de la palette KreativPM est `muted` sur `offStrong`.
    expect(pire).toBeCloseTo(4.7624, 3)
  })
})

describe("l'or n'est jamais une couleur de texte", () => {
  it('ne figure dans aucun couple comme texte', () => {
    expect(TEXT_PAIRS.some((p) => p.text === 'accent')).toBe(false)
    expect(TEXT_PAIRS.some((p) => p.text === 'accentDark')).toBe(false)
  })

  it('serait refusé s il l était', () => {
    expect(contrastRatio(THEME_KREATIVPM.accent, THEME_KREATIVPM.page)).toBeLessThan(AA_TEXT_RATIO)
  })

  it('porte du brun profond sur son aplat, jamais du blanc', () => {
    expect(THEME_KREATIVPM.onAccent).toBe('#2a211a')
    expect(contrastRatio('#ffffff', THEME_KREATIVPM.accent)).toBeLessThan(AA_TEXT_RATIO)
    expect(
      contrastRatio(THEME_KREATIVPM.onAccent, THEME_KREATIVPM.accent),
    ).toBeGreaterThanOrEqual(AA_TEXT_RATIO)
  })
})

describe('findContrastIssues', () => {
  it('nomme le couple fautif et son rapport', () => {
    const fautive: ThemeTokens = { ...THEME_KREATIVPM, ink: '#d4943f' }
    const issues = findContrastIssues(fautive)

    const surPage = issues.find((i) => i.text === 'ink' && i.background === 'page')
    expect(surPage).toBeDefined()
    expect(surPage!.ratio).toBeCloseTo(2.3866, 4)
    expect(surPage!.required).toBe(AA_TEXT_RATIO)
  })

  it('remonte tous les couples fautifs, pas seulement le premier', () => {
    // L'or en encre casse ses quatre fonds : page, surface, off, offStrong.
    const fautive: ThemeTokens = { ...THEME_KREATIVPM, ink: '#d4943f' }
    expect(findContrastIssues(fautive).filter((i) => i.text === 'ink')).toHaveLength(4)
  })

  it('contrôle aussi les couples non textuels, à 3:1', () => {
    const fautive: ThemeTokens = { ...THEME_KREATIVPM, focus: '#faf5ed' }
    const issue = findContrastIssues(fautive).find((i) => i.text === 'focus')
    expect(issue).toBeDefined()
    expect(issue!.required).toBe(NON_TEXT_RATIO)
  })
})

describe('describeContrastIssue', () => {
  it('écrit un message français qui nomme le couple et le rapport', () => {
    const message = describeContrastIssue({
      text: 'ink',
      background: 'page',
      ratio: 2.3866,
      required: AA_TEXT_RATIO,
    })
    expect(message).toContain('encre')
    expect(message).toContain('fond de page')
    expect(message).toContain('2,38')
    expect(message).toContain('4,50')
  })
})

// Aucune information n'est portée par la seule couleur : les trois fonds de
// cellule de la grille doivent rester distincts en vision monochrome.
describe('lisibilité monochrome des fonds de grille', () => {
  for (const [nom, palette] of PALETTES) {
    it(`${nom} : surface, off et offStrong se séparent en luminance`, () => {
      const l = {
        surface: relativeLuminance(palette.surface),
        off: relativeLuminance(palette.off),
        offStrong: relativeLuminance(palette.offStrong),
      }
      expect(l.surface - l.off).toBeGreaterThanOrEqual(0.05)
      expect(l.off - l.offStrong).toBeGreaterThanOrEqual(0.05)
    })
  }
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/theme/tokens.test.ts`
Expected: FAIL — `Failed to resolve import "./tokens"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/theme/tokens.ts` :

```ts
import {
  contrastRatio,
  formatRatio,
  AA_TEXT_RATIO,
  NON_TEXT_RATIO,
} from './contrast'

/**
 * Les 26 jetons de couleur du système. Toutes les autres échelles — espacement,
 * rayons, ombres, typographie — sont figées dans `globals.css` : la spec rend
 * les couleurs paramétrables, rien d'autre.
 */
export interface ThemeTokens {
  /** fond de page */
  page: string
  /** fond des surfaces posées sur la page : cartes, cellules ouvrées */
  surface: string
  /** fond des jours non ouvrés */
  off: string
  /** fond des jours fériés */
  offStrong: string

  /** texte principal */
  ink: string
  /** surfaces sombres */
  inkDeep: string
  /** texte secondaire */
  muted: string
  /** texte posé sur un aplat d'accent */
  onAccent: string
  /** texte posé sur une surface sombre */
  onDark: string

  /** aplats : boutons pleins, cellules remplies, barres */
  accent: string
  /** bordures, anneau de focus, survol — jamais un fond de texte */
  accentDark: string
  /** liens et libellés d'action */
  link: string
  /** filets et séparateurs */
  rule: string
  /** anneau de focus */
  focus: string

  success: string
  successInk: string
  successEdge: string
  warning: string
  warningInk: string
  warningEdge: string
  danger: string
  dangerInk: string
  dangerEdge: string
  info: string
  infoInk: string
  infoEdge: string
}

export const THEME_TOKEN_KEYS: readonly (keyof ThemeTokens)[] = [
  'page', 'surface', 'off', 'offStrong',
  'ink', 'inkDeep', 'muted', 'onAccent', 'onDark',
  'accent', 'accentDark', 'link', 'rule', 'focus',
  'success', 'successInk', 'successEdge',
  'warning', 'warningInk', 'warningEdge',
  'danger', 'dangerInk', 'dangerEdge',
  'info', 'infoInk', 'infoEdge',
]

export const TOKEN_LABELS: Record<keyof ThemeTokens, string> = {
  page: 'fond de page',
  surface: 'surface',
  off: 'fond des jours non ouvrés',
  offStrong: 'fond des jours fériés',
  ink: 'encre',
  inkDeep: 'encre profonde',
  muted: 'encre secondaire',
  onAccent: 'encre sur aplat d’accent',
  onDark: 'encre sur fond sombre',
  accent: 'accent',
  accentDark: 'accent foncé',
  link: 'lien',
  rule: 'filet',
  focus: 'anneau de focus',
  success: 'fond de succès',
  successInk: 'encre de succès',
  successEdge: 'bordure de succès',
  warning: 'fond d’avertissement',
  warningInk: 'encre d’avertissement',
  warningEdge: 'bordure d’avertissement',
  danger: 'fond de danger',
  dangerInk: 'encre de danger',
  dangerEdge: 'bordure de danger',
  info: 'fond d’information',
  infoInk: 'encre d’information',
  infoEdge: 'bordure d’information',
}

/**
 * Identité KreativPM, relevée sur kreativpm.fr puis corrigée par le calcul :
 * l'or n'est jamais du texte (2,38:1 sur le crème), et le texte interactif
 * reçoit un ambre assombri à 5,37:1.
 */
export const THEME_KREATIVPM: ThemeTokens = {
  page: '#faf5ed',
  surface: '#ffffff',
  off: '#efeae0',
  offStrong: '#e4dccc',

  ink: '#342820',
  inkDeep: '#2a211a',
  muted: '#5f5e5a',
  onAccent: '#2a211a',
  onDark: '#faf5ed',

  accent: '#d4943f',
  accentDark: '#b57730',
  link: '#8c5a23',
  rule: '#d8cfbf',
  focus: '#b57730',

  success: '#e9f0de',
  successInk: '#3b5322',
  successEdge: '#b9ce9b',
  warning: '#fbefd8',
  warningInk: '#7a5313',
  warningEdge: '#e6c68a',
  danger: '#fae7e0',
  dangerInk: '#8a3418',
  dangerEdge: '#edb9a4',
  info: '#efeae0',
  infoInk: '#4f4636',
  infoEdge: '#d8cfbf',
}

/** Préréglage sobre, pour qui déploie l'application sans la marque. */
export const THEME_NEUTRE: ThemeTokens = {
  page: '#f6f6f5',
  surface: '#ffffff',
  off: '#eeeeed',
  offStrong: '#e2e2e1',

  ink: '#1f2321',
  inkDeep: '#161917',
  muted: '#5a5f5c',
  onAccent: '#ffffff',
  onDark: '#f6f6f5',

  accent: '#3f4744',
  accentDark: '#2c3230',
  link: '#2f4a45',
  rule: '#d5d7d6',
  focus: '#3f4744',

  success: '#e7efe7',
  successInk: '#2f4a33',
  successEdge: '#b7cdb9',
  warning: '#f3eee2',
  warningInk: '#5e4c22',
  warningEdge: '#d8c89e',
  danger: '#f3e7e5',
  dangerInk: '#7a2e24',
  dangerEdge: '#dcb2ac',
  info: '#eaedef',
  infoInk: '#33414a',
  infoEdge: '#c3ccd2',
}

export const DEFAULT_THEME: ThemeTokens = THEME_KREATIVPM

export const THEME_PRESETS: ReadonlyArray<{
  id: 'KREATIVPM' | 'NEUTRE'
  label: string
  tokens: ThemeTokens
}> = [
  { id: 'KREATIVPM', label: 'KreativPM', tokens: THEME_KREATIVPM },
  { id: 'NEUTRE', label: 'Neutre', tokens: THEME_NEUTRE },
]

export interface TokenPair {
  text: keyof ThemeTokens
  background: keyof ThemeTokens
}

const STATES = ['success', 'warning', 'danger', 'info'] as const

/**
 * Contrat d'usage : un composant ne pose une encre que sur un fond listé ici.
 * Chaque couple est vérifié à 4,5:1 — sur les palettes livrées par le test de
 * ce module, sur toute palette enregistrée par le service de thème.
 */
export const TEXT_PAIRS: readonly TokenPair[] = [
  { text: 'ink', background: 'page' },
  { text: 'ink', background: 'surface' },
  { text: 'ink', background: 'off' },
  { text: 'ink', background: 'offStrong' },
  { text: 'muted', background: 'page' },
  { text: 'muted', background: 'surface' },
  { text: 'muted', background: 'off' },
  { text: 'muted', background: 'offStrong' },
  { text: 'link', background: 'page' },
  { text: 'link', background: 'surface' },
  { text: 'onAccent', background: 'accent' },
  { text: 'onDark', background: 'inkDeep' },
  ...STATES.flatMap((s): TokenPair[] => [
    { text: `${s}Ink` as keyof ThemeTokens, background: s },
    { text: `${s}Ink` as keyof ThemeTokens, background: 'page' },
    { text: `${s}Ink` as keyof ThemeTokens, background: 'surface' },
  ]),
]

/**
 * `accentDark` et `focus` ne portent jamais de texte : bordures, anneau de
 * focus, remplissage de barres. Le seuil qui s'applique est celui des
 * éléments non textuels. `rule` en est absent volontairement : un filet
 * décoratif ne porte aucune information, et l'exiger à 3:1 obligerait à
 * remplacer le beige de la marque par un gris qui n'est pas le sien.
 */
export const NON_TEXT_PAIRS: readonly TokenPair[] = [
  { text: 'focus', background: 'page' },
  { text: 'focus', background: 'surface' },
  { text: 'accentDark', background: 'page' },
  { text: 'accentDark', background: 'surface' },
]

export interface ContrastIssue {
  text: keyof ThemeTokens
  background: keyof ThemeTokens
  ratio: number
  required: number
}

export function findContrastIssues(tokens: ThemeTokens): ContrastIssue[] {
  const issues: ContrastIssue[] = []

  for (const [pairs, required] of [
    [TEXT_PAIRS, AA_TEXT_RATIO],
    [NON_TEXT_PAIRS, NON_TEXT_RATIO],
  ] as const) {
    for (const pair of pairs) {
      const ratio = contrastRatio(tokens[pair.text], tokens[pair.background])
      if (ratio < required) {
        issues.push({ text: pair.text, background: pair.background, ratio, required })
      }
    }
  }

  return issues
}

export function describeContrastIssue(issue: ContrastIssue): string {
  return (
    `Le couple « ${TOKEN_LABELS[issue.text]} » sur « ${TOKEN_LABELS[issue.background]} » ` +
    `n’atteint que ${formatRatio(issue.ratio)}:1 ; le minimum exigé est ` +
    `${formatRatio(issue.required)}:1.`
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/theme/tokens.test.ts`
Expected: PASS — 22 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer `link: '#8c5a23'` par `link: '#b57730'` (la valeur que la spec envisageait pour le texte interactif) et confirmer que « KreativPM : chaque couple texte/fond atteint 4,5:1 » échoue en nommant `link sur page` à 3,42. Restaurer ensuite.

- [ ] **Step 6: Commit**

```bash
git add src/core/theme/
git commit -m "feat(core): design tokens, presets and palette contrast validation"
```

---

## Task 3: Les polices, embarquées

**Files:** Modify `package.json`. Create `scripts/sync-fonts.mjs`, `src/app/fonts/` (3 fichiers `woff2`), `src/app/fonts/fonts.test.ts`

**Interfaces:**
- Consumes: rien
- Produces: `src/app/fonts/inter-variable.woff2`, `inter-variable-italic.woff2`, `manrope-variable.woff2`

**Pourquoi un script et pas un `@import` de paquet.** Les fichiers doivent être **dans le dépôt** : le mode portable du lot 5 doit fonctionner sans `node_modules`. Les paquets fontsource ne servent qu'à obtenir les `woff2` sous licence OFL, une fois ; c'est le script qui les recopie, et ce sont les copies qui sont versionnées.

- [ ] **Step 1: Installer les paquets sources**

```bash
npm i -D @fontsource-variable/inter @fontsource-variable/manrope
```

- [ ] **Step 2: Écrire le script de copie**

`scripts/sync-fonts.mjs` :

```js
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
const cible = join(racine, 'src', 'app', 'fonts')

// Sous-ensemble « latin » uniquement : il couvre le français, œ et ligatures
// comprises (U+0152-0153). Les sous-ensembles cyrillique, grec et vietnamien
// pèseraient sans rien servir.
const FICHIERS = [
  ['@fontsource-variable/inter', 'inter-latin-wght-normal.woff2', 'inter-variable.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-wght-italic.woff2', 'inter-variable-italic.woff2'],
  ['@fontsource-variable/manrope', 'manrope-latin-wght-normal.woff2', 'manrope-variable.woff2'],
]

mkdirSync(cible, { recursive: true })

for (const [paquet, source, destination] of FICHIERS) {
  const chemin = join(racine, 'node_modules', paquet, 'files', source)
  if (!existsSync(chemin)) {
    // Échouer bruyamment : une police manquante qui passerait inaperçue
    // ferait retomber l'application sur une police système, exactement ce
    // que ce lot cherche à éviter.
    throw new Error(`Police introuvable : ${chemin}. Lancez d'abord « npm install ».`)
  }
  copyFileSync(chemin, join(cible, destination))
  console.log(`${destination} ← ${paquet}/files/${source}`)
}
```

Ajouter à `package.json` : `"fonts:sync": "node scripts/sync-fonts.mjs"`

- [ ] **Step 3: Écrire le test qui échoue**

`src/app/fonts/fonts.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(process.cwd(), 'src')
const DOSSIER = join(RACINE, 'app', 'fonts')

const ATTENDUS = ['inter-variable.woff2', 'inter-variable-italic.woff2', 'manrope-variable.woff2']

function fichiersSource(dossier: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) out.push(...fichiersSource(chemin))
    // Les fichiers de test sont exclus : celui-ci contient les chaînes
    // recherchées, et se trouverait lui-même.
    else if (/\.(ts|tsx|css)$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) {
      out.push(chemin)
    }
  }
  return out
}

describe('polices embarquées', () => {
  it('livre les trois fichiers dans le dépôt', () => {
    for (const nom of ATTENDUS) {
      const chemin = join(DOSSIER, nom)
      expect(statSync(chemin).size, nom).toBeGreaterThan(10_000)
    }
  })

  it('livre de vrais woff2, pas des marqueurs vides', () => {
    for (const nom of ATTENDUS) {
      // Signature du conteneur WOFF2 : les quatre premiers octets valent « wOF2 ».
      const entete = readFileSync(join(DOSSIER, nom)).subarray(0, 4).toString('latin1')
      expect(entete, nom).toBe('wOF2')
    }
  })

  it('ne charge aucune police depuis un service tiers', () => {
    const fautifs = fichiersSource(RACINE).filter((chemin) => {
      const contenu = readFileSync(chemin, 'utf8')
      return (
        contenu.includes('fonts.googleapis.com') ||
        contenu.includes('fonts.gstatic.com') ||
        contenu.includes('next/font/google')
      )
    })
    expect(fautifs).toEqual([])
  })
})
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/app/fonts/fonts.test.ts`
Expected: FAIL — `ENOENT` sur `src/app/fonts/inter-variable.woff2`

- [ ] **Step 5: Exécuter la copie et vérifier que le test passe**

```bash
npm run fonts:sync
npx vitest run src/app/fonts/fonts.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 6: Vérifier que les polices sont bien versionnées**

```bash
git check-ignore -v src/app/fonts/inter-variable.woff2 || echo "non ignoré, bon"
```
Expected: `non ignoré, bon`. Si une règle de `.gitignore` les exclut, ajouter `!src/app/fonts/*.woff2`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(fonts): embed Inter and Manrope, no third-party loading"
```

---

## Task 4: La feuille de jetons et l'injection au runtime

**Files:** Create `src/core/theme/css-vars.ts`, `src/core/theme/css-vars.test.ts`, `src/app/globals.test.ts`. Modify `src/app/globals.css`, `src/app/layout.tsx`

**Interfaces:**
- Consumes: `ThemeTokens`, `THEME_TOKEN_KEYS`, `DEFAULT_THEME` (tâche 2) ; les `woff2` (tâche 3) ; `getTheme` (tâche 5, câblé au Step 6)
- Produces:
  - `cssVarName(key: keyof ThemeTokens): string` — `accentDark` → `--color-accent-dark`
  - `themeToCssVars(tokens: ThemeTokens): Record<string, string>`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/core/theme/css-vars.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { cssVarName, themeToCssVars } from './css-vars'
import { THEME_KREATIVPM, THEME_NEUTRE, THEME_TOKEN_KEYS } from './tokens'

describe('cssVarName', () => {
  it('passe du camelCase au kebab-case', () => {
    expect(cssVarName('page')).toBe('--color-page')
    expect(cssVarName('accentDark')).toBe('--color-accent-dark')
    expect(cssVarName('offStrong')).toBe('--color-off-strong')
    expect(cssVarName('successEdge')).toBe('--color-success-edge')
  })

  it('ne produit jamais deux fois le même nom', () => {
    const noms = THEME_TOKEN_KEYS.map(cssVarName)
    expect(new Set(noms).size).toBe(noms.length)
  })
})

describe('themeToCssVars', () => {
  it('produit une variable par jeton', () => {
    const vars = themeToCssVars(THEME_KREATIVPM)
    expect(Object.keys(vars)).toHaveLength(THEME_TOKEN_KEYS.length)
    expect(vars['--color-page']).toBe('#faf5ed')
    expect(vars['--color-accent-dark']).toBe('#b57730')
    expect(vars['--color-off-strong']).toBe('#e4dccc')
  })

  it('rend une palette différente pour un thème différent', () => {
    expect(themeToCssVars(THEME_NEUTRE)['--color-page']).toBe('#f6f6f5')
  })

  it('n émet que des noms de variables CSS', () => {
    for (const nom of Object.keys(themeToCssVars(THEME_KREATIVPM))) {
      expect(nom).toMatch(/^--color-[a-z-]+$/)
    }
  })
})
```

`src/app/globals.test.ts` — le test qui empêche la feuille et les jetons TypeScript de diverger :

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_THEME, THEME_TOKEN_KEYS } from '@/core/theme/tokens'
import { cssVarName } from '@/core/theme/css-vars'

const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')

function valeurDeclaree(variable: string): string | null {
  const m = new RegExp(`${variable}\\s*:\\s*([^;]+);`).exec(css)
  return m === null ? null : m[1]!.trim()
}

describe('globals.css', () => {
  it('déclare chaque jeton avec la valeur du thème par défaut', () => {
    for (const key of THEME_TOKEN_KEYS) {
      expect(valeurDeclaree(cssVarName(key)), key).toBe(DEFAULT_THEME[key])
    }
  })

  it('n utilise pas @theme inline', () => {
    // `@theme inline` substituerait la valeur dans chaque utilitaire : le
    // thème paramétrable deviendrait inopérant, et personne ne s'en
    // apercevrait avant de changer une couleur en production.
    expect(css).not.toMatch(/@theme\s+inline/)
  })

  it('déclare un état de focus visible', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('var(--color-focus)')
  })

  it('déclare les motifs qui distinguent sans la couleur', () => {
    for (const motif of ['pattern-stripes', 'pattern-dots', 'pattern-hatch']) {
      expect(css).toContain(motif)
    }
  })

  it('déclare une cible tactile de 44 points', () => {
    expect(css).toContain('touch-target')
    expect(css).toContain('2.75rem')
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/core/theme/css-vars.test.ts src/app/globals.test.ts`
Expected: FAIL — import irrésolu pour `./css-vars`, et `globals.css` ne déclare aucun jeton

- [ ] **Step 3: Écrire `css-vars.ts`**

`src/core/theme/css-vars.ts` :

```ts
import { THEME_TOKEN_KEYS, type ThemeTokens } from './tokens'

/** `accentDark` → `--color-accent-dark`, le nom que Tailwind attend pour `bg-accent-dark`. */
export function cssVarName(key: keyof ThemeTokens): string {
  return `--color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

/**
 * Palette prête à poser en `style` sur `<html>`. Les variables ainsi injectées
 * l'emportent sur celles de `@layer theme`, sans `!important` : c'est ce qui
 * rend un thème enregistré immédiat, sans reconstruction.
 */
export function themeToCssVars(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const key of THEME_TOKEN_KEYS) {
    vars[cssVarName(key)] = tokens[key]
  }
  return vars
}
```

- [ ] **Step 4: Écrire `globals.css`**

Remplacer intégralement `src/app/globals.css` :

```css
@import "tailwindcss";

/* Jetons par défaut — identité KreativPM.
   `@theme` et non `@theme inline` : les utilitaires doivent référencer
   `var(--color-…)` pour que le thème enregistré, injecté sur <html>, les
   change sans reconstruction. Voir la décision en tête du plan 1e. */
@theme {
  --color-page: #faf5ed;
  --color-surface: #ffffff;
  --color-off: #efeae0;
  --color-off-strong: #e4dccc;

  --color-ink: #342820;
  --color-ink-deep: #2a211a;
  --color-muted: #5f5e5a;
  --color-on-accent: #2a211a;
  --color-on-dark: #faf5ed;

  --color-accent: #d4943f;
  --color-accent-dark: #b57730;
  --color-link: #8c5a23;
  --color-rule: #d8cfbf;
  --color-focus: #b57730;

  --color-success: #e9f0de;
  --color-success-ink: #3b5322;
  --color-success-edge: #b9ce9b;
  --color-warning: #fbefd8;
  --color-warning-ink: #7a5313;
  --color-warning-edge: #e6c68a;
  --color-danger: #fae7e0;
  --color-danger-ink: #8a3418;
  --color-danger-edge: #edb9a4;
  --color-info: #efeae0;
  --color-info-ink: #4f4636;
  --color-info-edge: #d8cfbf;

  /* Polices embarquées, exposées par next/font/local dans le layout racine. */
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-manrope), ui-sans-serif, system-ui, sans-serif;

  /* Échelle typographique resserrée : une grille de saisie a besoin de
     densité. Le corps courant est à 14 px, pas à 16. */
  --text-xs: 0.6875rem;
  --text-xs--line-height: 1rem;
  --text-sm: 0.8125rem;
  --text-sm--line-height: 1.125rem;
  --text-base: 0.875rem;
  --text-base--line-height: 1.25rem;
  --text-lg: 1rem;
  --text-lg--line-height: 1.5rem;
  --text-xl: 1.125rem;
  --text-xl--line-height: 1.5rem;
  --text-2xl: 1.375rem;
  --text-2xl--line-height: 1.75rem;

  --spacing: 0.25rem;

  --radius-sm: 3px;
  --radius-md: 5px;
  --radius-lg: 8px;

  --shadow-card: 0 1px 2px color-mix(in srgb, var(--color-ink) 10%, transparent);
  --shadow-float: 0 6px 16px color-mix(in srgb, var(--color-ink) 18%, transparent);
}

@layer base {
  body {
    background-color: var(--color-page);
    color: var(--color-ink);
    font-family: var(--font-sans);
  }

  h1, h2, h3 {
    font-family: var(--font-display);
    font-weight: 800;
  }

  /* Un focus visible partout, déclaré une fois. Le retirer pour l'esthétique
     rendrait l'application inutilisable au clavier ; le déclarer ici évite
     d'avoir à y penser sur chaque composant. */
  :where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
}

/* Marqueurs non chromatiques : ils portent l'information quand la teinte
   n'est pas perçue. `color-mix` les garde thématisés. */
@utility pattern-stripes {
  background-image: repeating-linear-gradient(
    45deg,
    transparent 0 4px,
    color-mix(in srgb, var(--color-ink) 10%, transparent) 4px 5px
  );
}

@utility pattern-dots {
  background-image: radial-gradient(
    color-mix(in srgb, var(--color-ink) 22%, transparent) 1px,
    transparent 1px
  );
  background-size: 5px 5px;
}

@utility pattern-hatch {
  background-image: repeating-linear-gradient(
    -45deg,
    transparent 0 3px,
    color-mix(in srgb, var(--color-ink) 14%, transparent) 3px 4px
  );
}

/* 44 points : la cible tactile minimale dont le lot 1c dépend. */
@utility touch-target {
  min-height: 2.75rem;
  min-width: 2.75rem;
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/core/theme/css-vars.test.ts src/app/globals.test.ts`
Expected: PASS — 5 + 5 tests

- [ ] **Step 6: Câbler le layout racine**

*Cette étape consomme `getTheme` de la tâche 5 ; l'exécuter après elle.*

`src/app/layout.tsx` :

```tsx
import './globals.css'
import localFont from 'next/font/local'
import type { CSSProperties, ReactNode } from 'react'
import { getTheme } from '@/services/theme'
import { themeToCssVars } from '@/core/theme/css-vars'

const inter = localFont({
  src: [
    { path: './fonts/inter-variable.woff2', style: 'normal' },
    { path: './fonts/inter-variable-italic.woff2', style: 'italic' },
  ],
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
})

const manrope = localFont({
  src: './fonts/manrope-variable.woff2',
  weight: '200 800',
  variable: '--font-manrope',
  display: 'swap',
})

export const metadata = { title: 'CRA' }

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Le thème est lu à chaque rendu : l'enregistrer suffit à le voir appliqué,
  // sans reconstruction. Les variables posées ici l'emportent sur celles de
  // `@layer theme` produites par `@theme`.
  const theme = await getTheme()

  return (
    <html
      lang="fr"
      className={`${inter.variable} ${manrope.variable}`}
      // React accepte les propriétés personnalisées ; le type CSSProperties
      // ne les décrit pas, d'où la conversion.
      style={themeToCssVars(theme) as CSSProperties}
    >
      <body className="bg-page text-ink antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 7: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0. Aucun test ne charge `src/app/layout.tsx` (vérifié : `next/font/local` ne s'exécute que dans le pipeline Next).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(theme): token stylesheet and runtime CSS variable injection"
```

---

## Task 5: Le thème en réglages

**Files:** Modify `prisma/schema.prisma`. Create `src/services/theme.ts`, `src/services/theme.test.ts`

**Interfaces:**
- Consumes: `ThemeTokens`, `THEME_TOKEN_KEYS`, `TOKEN_LABELS`, `DEFAULT_THEME`, `findContrastIssues`, `describeContrastIssue` (tâche 2)
- Produces:
  - `class ThemeValidationError extends Error { errors: string[] }`
  - `validateTheme(input: unknown): { ok: true; theme: ThemeTokens } | { ok: false; errors: string[] }`
  - `getTheme(): Promise<ThemeTokens>`
  - `updateTheme(input: unknown): Promise<ThemeTokens>`
  - `resetTheme(): Promise<ThemeTokens>`

- [ ] **Step 1: Étendre le schéma**

Dans `prisma/schema.prisma`, modèle `Settings` :

```prisma
  /// palette du thème, JSON lu et écrit en bloc uniquement.
  /// "{}" = jamais configuré, le thème par défaut s'applique.
  themeJson String @default("{}")
```

Puis appliquer :

```bash
npm run db:sqlite
```

- [ ] **Step 2: Écrire le test qui échoue**

`src/services/theme.test.ts` :

```ts
import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { getTheme, updateTheme, resetTheme, validateTheme, ThemeValidationError } from './theme'
import { THEME_KREATIVPM, THEME_NEUTRE, THEME_TOKEN_KEYS } from '@/core/theme/tokens'

beforeEach(async () => {
  await prisma.settings.deleteMany({})
})

afterAll(async () => {
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('lecture du thème', () => {
  it('rend la palette KreativPM sur une base vierge', async () => {
    expect(await getTheme()).toEqual(THEME_KREATIVPM)
  })

  it('rend le thème enregistré à la relecture suivante', async () => {
    await updateTheme(THEME_NEUTRE)
    // Relecture depuis la base : c'est ce qui survit à un redémarrage.
    expect(await getTheme()).toEqual(THEME_NEUTRE)
  })

  it('ne casse pas la page quand la colonne est illisible', async () => {
    await getTheme() // crée le singleton
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { themeJson: 'ceci n est pas du JSON' },
    })
    // Refuser de rendre l'application entière pour une couleur corrompue
    // serait pire que de retomber sur le défaut. La ligne n'est pas réécrite.
    expect(await getTheme()).toEqual(THEME_KREATIVPM)
  })

  it('complète une palette partielle par le défaut', async () => {
    await getTheme()
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { themeJson: JSON.stringify({ page: '#f0f0f0' }) },
    })
    const theme = await getTheme()
    expect(theme.page).toBe('#f0f0f0')
    expect(theme.ink).toBe(THEME_KREATIVPM.ink)
  })
})

describe('écriture du thème', () => {
  it('écrit la palette en bloc, jamais champ par champ', async () => {
    await updateTheme(THEME_NEUTRE)
    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    const stocke = JSON.parse(row.themeJson) as Record<string, string>
    expect(Object.keys(stocke).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
  })

  it('rend la palette enregistrée', async () => {
    expect(await updateTheme(THEME_NEUTRE)).toEqual(THEME_NEUTRE)
  })

  it('ne touche pas aux autres réglages', async () => {
    const { updateSettings, getSettings } = await import('./settings')
    await updateSettings({ minutesParJour: 432 })
    await updateTheme(THEME_NEUTRE)
    expect((await getSettings()).minutesParJour).toBe(432)
  })
})

describe("l'éditeur refuse ce qui serait illisible", () => {
  it("refuse l'or de la marque en couleur de texte, avec le couple et le rapport", async () => {
    const fautive = { ...THEME_KREATIVPM, ink: '#d4943f' }

    await expect(updateTheme(fautive)).rejects.toThrow(ThemeValidationError)

    let message = ''
    try {
      await updateTheme(fautive)
    } catch (err) {
      expect(err).toBeInstanceOf(ThemeValidationError)
      message = (err as ThemeValidationError).errors.join(' ')
    }
    expect(message).toContain('encre')
    expect(message).toContain('fond de page')
    expect(message).toContain('2,38')
    expect(message).toContain('4,50')
  })

  it("n'enregistre rien quand la palette est refusée", async () => {
    await updateTheme(THEME_NEUTRE)
    await updateTheme({ ...THEME_KREATIVPM, ink: '#d4943f' }).catch(() => undefined)
    // La palette refusée ne doit pas être passée « en avertissement ».
    expect(await getTheme()).toEqual(THEME_NEUTRE)
  })

  it('refuse une couleur mal écrite', async () => {
    await expect(updateTheme({ ...THEME_KREATIVPM, page: 'crème' })).rejects.toThrow(
      ThemeValidationError,
    )
    await expect(updateTheme({ ...THEME_KREATIVPM, page: '#fff' })).rejects.toThrow(
      ThemeValidationError,
    )
  })

  it('refuse une palette incomplète', async () => {
    const { ink, ...sansEncre } = THEME_KREATIVPM
    void ink
    await expect(updateTheme(sansEncre)).rejects.toThrow(ThemeValidationError)
  })

  it('accepte les deux préréglages livrés', async () => {
    expect(validateTheme(THEME_KREATIVPM).ok).toBe(true)
    expect(validateTheme(THEME_NEUTRE).ok).toBe(true)
  })

  it('valide sans écrire quand on le lui demande', () => {
    const verdict = validateTheme({ ...THEME_KREATIVPM, ink: '#d4943f' })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.errors.length).toBeGreaterThan(0)
  })
})

describe('retour au défaut', () => {
  it('restaure exactement la palette KreativPM', async () => {
    await updateTheme(THEME_NEUTRE)
    expect(await resetTheme()).toEqual(THEME_KREATIVPM)
    expect(await getTheme()).toEqual(THEME_KREATIVPM)
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/theme.test.ts`
Expected: FAIL — `Failed to resolve import "./theme"`

- [ ] **Step 4: Écrire l'implémentation**

`src/services/theme.ts` :

```ts
import { z } from 'zod'
import { prisma } from '@/db/client'
import {
  DEFAULT_THEME,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  describeContrastIssue,
  findContrastIssues,
  type ThemeTokens,
} from '@/core/theme/tokens'

// --- Validation ------------------------------------------------------------
//
// Même règle que pour les réglages : le service est la seule barrière qui
// compte. L'écran de thème ne juge rien, il transcrit et affiche. Un futur
// endpoint API, un script de reprise ou une requête forgée passent par ici.

function hexSchema(label: string): z.ZodString {
  return z
    .string({ message: `La couleur « ${label} » est requise.` })
    .regex(/^#[0-9a-f]{6}$/i, `La couleur « ${label} » doit s’écrire #RRGGBB.`)
}

// `z.object` attend un objet de schémas ; le construire depuis la liste des
// jetons évite d'écrire 26 lignes qui pourraient diverger du type.
const themeSchema = z.object(
  Object.fromEntries(
    THEME_TOKEN_KEYS.map((key) => [key, hexSchema(TOKEN_LABELS[key])]),
  ) as Record<keyof ThemeTokens, z.ZodString>,
)

export class ThemeValidationError extends Error {
  errors: string[]

  constructor(errors: string[]) {
    super(errors.join(' '))
    this.name = 'ThemeValidationError'
    this.errors = errors
  }
}

/**
 * Valide une palette sans l'écrire : forme d'abord, contraste ensuite.
 * Un couple sous le seuil est un refus, pas un avertissement — offrir un
 * thème sans cette barrière reviendrait à offrir le moyen de rendre
 * l'application illisible.
 */
export function validateTheme(
  input: unknown,
): { ok: true; theme: ThemeTokens } | { ok: false; errors: string[] } {
  const parsed = themeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: [...new Set(parsed.error.issues.map((i) => i.message))] }
  }

  const theme = normalise(parsed.data as ThemeTokens)
  const issues = findContrastIssues(theme)
  if (issues.length > 0) {
    return { ok: false, errors: issues.map(describeContrastIssue) }
  }

  return { ok: true, theme }
}

/** Les couleurs sont comparées entre elles : une seule casse, la minuscule. */
function normalise(theme: ThemeTokens): ThemeTokens {
  const out = {} as ThemeTokens
  for (const key of THEME_TOKEN_KEYS) out[key] = theme[key].toLowerCase()
  return out
}

async function readRow(): Promise<{ themeJson: string }> {
  const row = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
    select: { themeJson: true },
  })
  return row
}

/**
 * Lecture en bloc, tolérante par construction : le défaut comble ce qui
 * manque, une colonne illisible retombe entièrement sur lui. Un thème est un
 * habillage — refuser de rendre l'application parce qu'une couleur est
 * corrompue serait un remède pire que le mal. La ligne n'est jamais réécrite
 * en douce : seul `updateTheme` écrit, et lui valide.
 */
export async function getTheme(): Promise<ThemeTokens> {
  const { themeJson } = await readRow()

  let brut: unknown
  try {
    brut = JSON.parse(themeJson)
  } catch {
    return DEFAULT_THEME
  }

  if (typeof brut !== 'object' || brut === null) return DEFAULT_THEME
  const stocke = brut as Record<string, unknown>

  const theme = {} as ThemeTokens
  for (const key of THEME_TOKEN_KEYS) {
    const valeur = stocke[key]
    theme[key] =
      typeof valeur === 'string' && /^#[0-9a-f]{6}$/i.test(valeur)
        ? valeur.toLowerCase()
        : DEFAULT_THEME[key]
  }
  return theme
}

export async function updateTheme(input: unknown): Promise<ThemeTokens> {
  const verdict = validateTheme(input)
  if (!verdict.ok) throw new ThemeValidationError(verdict.errors)

  await readRow() // garantit l'existence du singleton

  await prisma.settings.update({
    where: { id: 'singleton' },
    // En bloc : jamais une requête sur une clé du JSON, portabilité oblige.
    data: { themeJson: JSON.stringify(verdict.theme) },
  })

  return verdict.theme
}

export async function resetTheme(): Promise<ThemeTokens> {
  return updateTheme(DEFAULT_THEME)
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/theme.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 6: Vérifier par mutation**

Remplacer dans `validateTheme` le refus par un simple `console.warn` et confirmer que « refuse l'or de la marque en couleur de texte » et « n'enregistre rien quand la palette est refusée » échouent tous deux. Restaurer ensuite.

- [ ] **Step 7: Vérifier la suite complète, puis câbler le layout**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert. Exécuter ensuite le **Step 6 de la tâche 4** (layout racine), puis relancer.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(settings): themeable palette stored as JSON, rejected below 4.5:1"
```

---

## Task 6: L'écran d'administration du thème

**Files:** Create `src/app/(app)/admin/theme/page.tsx`, `src/app/(app)/admin/theme/actions.ts`, `src/app/(app)/admin/theme/ThemeForm.tsx`, `src/app/(app)/admin/theme/ThemeForm.test.tsx`. Modify `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getTheme`, `updateTheme`, `resetTheme`, `ThemeValidationError` (tâche 5) ; `THEME_TOKEN_KEYS`, `TOKEN_LABELS`, `THEME_PRESETS`, `DEFAULT_THEME` (tâche 2)
- Produces:
  - `type SaveThemeState = { ok: true } | { ok: false; errors: string[] } | null`
  - `saveTheme(prev: SaveThemeState, formData: FormData): Promise<SaveThemeState>`
  - `restoreDefaultTheme(): Promise<void>`

- [ ] **Step 1: Écrire le test qui échoue**

`src/app/(app)/admin/theme/ThemeForm.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { THEME_KREATIVPM, THEME_NEUTRE, THEME_TOKEN_KEYS, TOKEN_LABELS } from '@/core/theme/tokens'

const { saveTheme, restoreDefaultTheme } = vi.hoisted(() => ({
  saveTheme: vi.fn(),
  restoreDefaultTheme: vi.fn(),
}))
vi.mock('./actions', () => ({ saveTheme, restoreDefaultTheme }))

// `vi.mock` est hissé au-dessus des imports : les server actions ne sont
// jamais chargés, seul le composant l'est.
import { ThemeForm } from './ThemeForm'

beforeEach(() => {
  saveTheme.mockReset()
  restoreDefaultTheme.mockReset()
})
afterEach(cleanup)

function champ(key: keyof typeof THEME_KREATIVPM): HTMLInputElement {
  return screen.getByLabelText(TOKEN_LABELS[key]) as HTMLInputElement
}

describe('ThemeForm', () => {
  it('expose un champ par jeton, libellé en français', () => {
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ(key).value, key).toBe(THEME_KREATIVPM[key])
    }
  })

  it('affiche la valeur hexadécimale à côté du sélecteur', () => {
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    expect(screen.getAllByText('#d4943f').length).toBeGreaterThan(0)
  })

  it('remplit les champs depuis le préréglage neutre', () => {
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    fireEvent.click(screen.getByRole('button', { name: /Neutre/ }))
    expect(champ('page').value).toBe(THEME_NEUTRE.page)
    expect(champ('accent').value).toBe(THEME_NEUTRE.accent)
  })

  it('remplit les champs depuis le préréglage KreativPM', () => {
    render(<ThemeForm theme={THEME_NEUTRE} />)
    fireEvent.click(screen.getByRole('button', { name: /KreativPM/ }))
    expect(champ('page').value).toBe(THEME_KREATIVPM.page)
  })

  it('propose un retour au défaut', () => {
    render(<ThemeForm theme={THEME_NEUTRE} />)
    expect(screen.getByRole('button', { name: /Revenir au thème par défaut/ })).toBeDefined()
  })

  it('ne juge pas la palette lui-même', () => {
    // Aucun champ « required » ni « pattern » : la validation vit dans le
    // service. Le formulaire qui doublerait la règle la ferait diverger.
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ(key).required, key).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run "src/app/(app)/admin/theme/ThemeForm.test.tsx"`
Expected: FAIL — `Failed to resolve import "./ThemeForm"`

- [ ] **Step 3: Écrire les server actions**

`src/app/(app)/admin/theme/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { updateTheme, resetTheme, ThemeValidationError } from '@/services/theme'
import { THEME_TOKEN_KEYS } from '@/core/theme/tokens'

export type SaveThemeState = { ok: true } | { ok: false; errors: string[] } | null

/**
 * Transcrit le formulaire et relaie le verdict. Aucune règle de couleur ici :
 * elles vivent toutes dans `validateTheme`, côté service.
 */
export async function saveTheme(
  _prevState: SaveThemeState,
  formData: FormData,
): Promise<SaveThemeState> {
  await requireUser()

  const brut: Record<string, unknown> = {}
  for (const key of THEME_TOKEN_KEYS) {
    brut[key] = formData.get(key)
  }

  try {
    await updateTheme(brut)
  } catch (err) {
    if (err instanceof ThemeValidationError) return { ok: false, errors: err.errors }
    throw err
  }

  // Le thème est lu par le layout racine : c'est la racine qu'il faut revalider.
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function restoreDefaultTheme(): Promise<void> {
  await requireUser()
  await resetTheme()
  revalidatePath('/', 'layout')
}
```

- [ ] **Step 4: Écrire le formulaire**

`src/app/(app)/admin/theme/ThemeForm.tsx` :

```tsx
'use client'

import { useActionState, useState } from 'react'
import { saveTheme, restoreDefaultTheme, type SaveThemeState } from './actions'
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  type ThemeTokens,
} from '@/core/theme/tokens'

export function ThemeForm({ theme }: { theme: ThemeTokens }) {
  const [state, formAction, pending] = useActionState<SaveThemeState, FormData>(saveTheme, null)
  const [values, setValues] = useState<ThemeTokens>(theme)

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-md border border-danger-edge bg-danger px-3 py-2 text-sm text-danger-ink"
        >
          <p className="font-medium">La palette n’a pas été enregistrée :</p>
          <ul className="mt-1 list-disc pl-5">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {state?.ok && (
        <p
          role="status"
          className="rounded-md border border-success-edge bg-success px-3 py-2 text-sm text-success-ink"
        >
          Palette enregistrée.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Préréglages :</span>
        {THEME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => setValues(preset.tokens)}
            className="touch-target rounded-md border border-rule px-3 text-sm text-link hover:bg-off"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {THEME_TOKEN_KEYS.map((key) => (
          // Volontairement un `div` et non un `label` : le nom accessible du
          // champ vient de son `aria-label` seul. Un `label` enveloppant y
          // ajouterait la valeur hexadécimale, et « fond de page » ne
          // désignerait plus rien.
          <div key={key} className="flex items-center gap-3 text-sm">
            <input
              type="color"
              name={key}
              aria-label={TOKEN_LABELS[key]}
              value={values[key]}
              onChange={(ev) => setValues((v) => ({ ...v, [key]: ev.target.value }))}
              className="h-9 w-12 rounded-sm border border-rule"
            />
            <span aria-hidden="true" className="flex flex-col">
              <span>{TOKEN_LABELS[key]}</span>
              <span className="font-mono text-xs text-muted">{values[key]}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="touch-target rounded-md bg-accent px-4 font-medium text-on-accent hover:bg-ink-deep hover:text-on-dark"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer la palette'}
        </button>
        <button
          type="button"
          onClick={() => {
            setValues(DEFAULT_THEME)
            void restoreDefaultTheme()
          }}
          className="touch-target rounded-md border border-rule px-4 text-link hover:bg-off"
        >
          Revenir au thème par défaut
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 5: Écrire la page et l'entrée de navigation**

`src/app/(app)/admin/theme/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { getTheme } from '@/services/theme'
import { ThemeForm } from './ThemeForm'

export default async function AdminThemePage() {
  await requireUser()
  const theme = await getTheme()

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-xl">Administration · Thème</h1>
      <p className="mb-6 text-sm text-muted">
        Chaque couple texte/fond est vérifié au moment d’enregistrer. Une palette dont un couple
        descend sous 4,5:1 est refusée, avec le couple fautif et son rapport.
      </p>
      <ThemeForm theme={theme} />
    </main>
  )
}
```

Dans `src/app/(app)/layout.tsx`, ajouter au tableau `LIENS` : `{ href: '/admin/theme', label: 'Thème' }`.

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run "src/app/(app)/admin/theme/ThemeForm.test.tsx"`
Expected: PASS — 6 tests

- [ ] **Step 7: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(admin): theme editor with presets and default restore"
```

---

## Task 7: Les contrôles de la bibliothèque

**Files:** Create `src/components/ui/Button.tsx`, `Field.tsx`, `Select.tsx`, `Checkbox.tsx` et `src/components/ui/controls.test.tsx`

**Interfaces:**
- Consumes: les classes issues des jetons (tâche 4)
- Produces:
  - `type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'`
  - `Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; ref?: Ref<HTMLButtonElement> })`
  - `Field(props: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string })`
  - `Select(props: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string })`
  - `Checkbox(props: InputHTMLAttributes<HTMLInputElement> & { label: string })`

**Les quatre composants portent `'use client'`.** `Field`, `Select` et `Checkbox` appellent `useId`, qui n'existe pas côté serveur ; `Button` reçoit des gestionnaires d'événements. Un composant client rendu par un composant serveur est parfaitement légitime — l'inverse ne l'est pas.

- [ ] **Step 1: Écrire le test qui échoue**

`src/components/ui/controls.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Button } from './Button'
import { Field } from './Field'
import { Select } from './Select'
import { Checkbox } from './Checkbox'

afterEach(cleanup)

describe('Button', () => {
  it('rend son libellé et réagit au clic', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Enregistrer</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('porte une cible tactile de 44 points quelle que soit la variante', () => {
    render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="secondary">B</Button>
        <Button variant="quiet">C</Button>
        <Button variant="danger">D</Button>
      </>,
    )
    for (const bouton of screen.getAllByRole('button')) {
      expect(bouton.className).toContain('touch-target')
    }
  })

  it('n habille aucune variante d une couleur en dur', () => {
    render(<Button variant="danger">Supprimer</Button>)
    expect(screen.getByRole('button').className).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(screen.getByRole('button').className).toMatch(/danger/)
  })

  it('annonce le chargement autrement que par la couleur', () => {
    render(<Button loading>Enregistrer</Button>)
    const bouton = screen.getByRole('button')
    expect(bouton.getAttribute('aria-busy')).toBe('true')
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.textContent).toContain('…')
  })

  it('reste cliquable hors chargement', () => {
    render(<Button>Enregistrer</Button>)
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('false')
  })
})

describe('Field', () => {
  it('lie le libellé au champ', () => {
    render(<Field label="N° de facture" name="invoiceNumber" />)
    const input = screen.getByLabelText('N° de facture') as HTMLInputElement
    expect(input.name).toBe('invoiceNumber')
  })

  it('rend l erreur et la rattache au champ', () => {
    render(<Field label="Seuil" name="seuil" error="Le seuil doit être positif." />)
    const input = screen.getByLabelText('Seuil')
    const erreur = screen.getByText('Le seuil doit être positif.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(erreur.id)
  })

  it('ne signale rien quand il n y a pas d erreur', () => {
    render(<Field label="Seuil" name="seuil" />)
    expect(screen.getByLabelText('Seuil').getAttribute('aria-invalid')).toBeNull()
  })

  it('affiche l indication sans la confondre avec une erreur', () => {
    render(<Field label="Durée" name="duree" hint="Vide = hérité" />)
    expect(screen.getByText('Vide = hérité')).toBeDefined()
    expect(screen.getByLabelText('Durée').getAttribute('aria-invalid')).toBeNull()
  })

  it('donne des identifiants distincts à deux champs de même libellé', () => {
    render(
      <>
        <Field label="Durée" name="a" />
        <Field label="Durée" name="b" />
      </>,
    )
    const [a, b] = screen.getAllByLabelText('Durée')
    expect(a!.id).not.toBe(b!.id)
  })
})

describe('Select', () => {
  it('lie le libellé et rend ses options', () => {
    render(
      <Select label="Mission" name="missionId">
        <option value="m1">ACME · ITSM</option>
      </Select>,
    )
    const select = screen.getByLabelText('Mission') as HTMLSelectElement
    expect(select.name).toBe('missionId')
    expect(screen.getByRole('option', { name: 'ACME · ITSM' })).toBeDefined()
  })

  it('porte une cible tactile de 44 points', () => {
    render(
      <Select label="Mission" name="missionId">
        <option value="m1">M</option>
      </Select>,
    )
    expect(screen.getByLabelText('Mission').className).toContain('touch-target')
  })
})

describe('Checkbox', () => {
  it('lie le libellé et bascule', () => {
    render(<Checkbox label="Lundi" name="workingDays" value="1" />)
    const case_ = screen.getByLabelText('Lundi') as HTMLInputElement
    expect(case_.type).toBe('checkbox')
    fireEvent.click(case_)
    expect(case_.checked).toBe(true)
  })

  it('offre une zone cliquable de 44 points', () => {
    const { container } = render(<Checkbox label="Lundi" name="workingDays" value="1" />)
    expect(container.querySelector('label')!.className).toContain('touch-target')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/components/ui/controls.test.tsx`
Expected: FAIL — `Failed to resolve import "./Button"`

- [ ] **Step 3: Écrire les composants**

`src/components/ui/Button.tsx` :

```tsx
'use client'

import type { ButtonHTMLAttributes, Ref } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

/**
 * Le survol du bouton plein **inverse** le bouton au lieu d'assombrir l'or :
 * l'or assombri ne porte plus son encre à 4,5:1 (4,24), l'inversion tient à
 * 14,53. Un survol lisible, et perceptible sans distinguer les teintes.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-ink-deep hover:text-on-dark',
  secondary: 'border border-rule bg-surface text-ink hover:bg-off',
  quiet: 'text-link hover:bg-off',
  danger: 'border border-danger-edge bg-danger text-danger-ink hover:bg-danger-edge',
}

export function Button({
  variant = 'secondary',
  loading = false,
  disabled,
  children,
  className = '',
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  loading?: boolean
  /** React 19 transmet `ref` comme une prop ordinaire ; `ConfirmDialog` en a
   *  besoin pour donner le focus au bouton de confirmation à l'ouverture. */
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      {...rest}
      ref={ref}
      disabled={disabled === true || loading}
      aria-busy={loading}
      className={`touch-target inline-flex items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
    >
      {/* L'état de chargement se lit dans le texte, pas seulement dans une
          teinte atténuée : l'atténuation seule n'est pas perceptible par tous. */}
      {loading ? <>{children}…</> : children}
    </button>
  )
}
```

`src/components/ui/Field.tsx` :

```tsx
'use client'

import { useId, type InputHTMLAttributes } from 'react'

export function Field({
  label,
  error,
  hint,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  hint?: string
}) {
  const id = useId()
  const errorId = `${id}-erreur`
  const hintId = `${id}-aide`

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-ink">
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error !== undefined ? errorId : hint !== undefined ? hintId : undefined}
        className={`touch-target rounded-md border bg-surface px-3 text-ink ${
          error === undefined ? 'border-rule' : 'border-danger-edge'
        } ${className}`}
      />
      {hint !== undefined && error === undefined && (
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span id={errorId} className="text-xs text-danger-ink">
          {error}
        </span>
      )}
    </div>
  )
}
```

`src/components/ui/Select.tsx` :

```tsx
'use client'

import { useId, type SelectHTMLAttributes } from 'react'

export function Select({
  label,
  error,
  children,
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  const id = useId()
  const errorId = `${id}-erreur`

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-ink">
        {label}
      </label>
      <select
        {...rest}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        className={`touch-target rounded-md border bg-surface px-3 text-ink ${
          error === undefined ? 'border-rule' : 'border-danger-edge'
        } ${className}`}
      >
        {children}
      </select>
      {error !== undefined && (
        <span id={errorId} className="text-xs text-danger-ink">
          {error}
        </span>
      )}
    </div>
  )
}
```

`src/components/ui/Checkbox.tsx` :

```tsx
'use client'

import { useId, type InputHTMLAttributes } from 'react'

export function Checkbox({
  label,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId()

  return (
    // La cible tactile est portée par le libellé : cocher une case de 16 px
    // au doigt est une loterie, cliquer un libellé de 44 points ne l'est pas.
    <label
      htmlFor={id}
      className={`touch-target inline-flex items-center gap-2 text-sm text-ink ${className}`}
    >
      <input
        {...rest}
        id={id}
        type="checkbox"
        className="h-4 w-4 rounded-sm border border-rule accent-accent"
      />
      {label}
    </label>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/components/ui/controls.test.tsx`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/
git commit -m "feat(ui): button, field, select and checkbox on design tokens"
```

---

## Task 8: Les surfaces de la bibliothèque

**Files:** Create `src/components/ui/Card.tsx`, `DataTable.tsx`, `Badge.tsx`, `Banner.tsx`, `ConfirmDialog.tsx`, `PageShell.tsx` et `src/components/ui/surfaces.test.tsx`

**Interfaces:**
- Consumes: `Button` (tâche 7)
- Produces:
  - `Card(props: { title?: string; children: ReactNode; className?: string })`
  - `DataTable(props: { caption: string; children: ReactNode })`
  - `type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'`
  - `Badge(props: { tone: Tone; glyph: string; children: ReactNode; testId?: string })`
  - `Banner(props: { tone: Exclude<Tone, 'neutral'>; title?: string; children: ReactNode })`
  - `ConfirmDialog(props: { trigger: string; title: string; message: string; confirmLabel: string; action: () => void | Promise<void> })`
  - `PageShell(props: { title: string; actions?: ReactNode; children: ReactNode })`

- [ ] **Step 1: Écrire le test qui échoue**

`src/components/ui/surfaces.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Card } from './Card'
import { DataTable } from './DataTable'
import { Badge } from './Badge'
import { Banner } from './Banner'
import { ConfirmDialog } from './ConfirmDialog'
import { PageShell } from './PageShell'

afterEach(cleanup)

describe('Card', () => {
  it('rend son titre et son contenu', () => {
    render(<Card title="Suivi">contenu</Card>)
    expect(screen.getByRole('heading', { name: 'Suivi' })).toBeDefined()
    expect(screen.getByText('contenu')).toBeDefined()
  })

  it('se passe de titre', () => {
    render(<Card>seul</Card>)
    expect(screen.queryByRole('heading')).toBeNull()
  })
})

describe('DataTable', () => {
  it('porte une légende accessible et laisse défiler horizontalement', () => {
    const { container } = render(
      <DataTable caption="Plan de charge">
        <tbody>
          <tr>
            <td>1</td>
          </tr>
        </tbody>
      </DataTable>,
    )
    expect(screen.getByText('Plan de charge')).toBeDefined()
    expect(container.firstElementChild!.className).toContain('overflow-x-auto')
  })
})

describe('Badge', () => {
  it('porte un glyphe en plus de la teinte', () => {
    // Quatre statuts qui ne se distingueraient que par la couleur seraient
    // indiscernables pour un daltonien.
    render(
      <Badge tone="success" glyph="✓">
        Validé
      </Badge>,
    )
    const badge = screen.getByText(/Validé/)
    expect(badge.textContent).toContain('✓')
  })

  it('cache le glyphe aux lecteurs d écran, qui lisent déjà le libellé', () => {
    const { container } = render(
      <Badge tone="danger" glyph="✕">
        Refusé
      </Badge>,
    )
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('✕')
  })

  it('habille chaque teinte par des jetons', () => {
    const { container } = render(
      <Badge tone="warning" glyph="▲">
        Attention
      </Badge>,
    )
    expect(container.firstElementChild!.className).toMatch(/warning/)
  })
})

describe('Banner', () => {
  it('annonce son contenu aux lecteurs d écran', () => {
    render(<Banner tone="danger">Le CRA est validé.</Banner>)
    expect(screen.getByRole('alert').textContent).toContain('Le CRA est validé.')
  })

  it('utilise un statut, pas une alerte, pour l information', () => {
    render(<Banner tone="info">Prévisionnel</Banner>)
    expect(screen.getByRole('status').textContent).toContain('Prévisionnel')
  })

  it('rend son titre quand il en a un', () => {
    render(
      <Banner tone="warning" title="Capacité dépassée">
        720 h saisies.
      </Banner>,
    )
    expect(screen.getByText('Capacité dépassée')).toBeDefined()
  })
})

describe('ConfirmDialog', () => {
  it('ne montre rien avant le clic', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner les saisies"
        message="Les mois validés ne seront pas touchés."
        confirmLabel="Réétalonner"
        action={vi.fn()}
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ouvre une boîte de dialogue nommée', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner les saisies"
        message="Les mois validés ne seront pas touchés."
        confirmLabel="Réétalonner"
        action={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    const dialogue = screen.getByRole('dialog')
    expect(dialogue.getAttribute('aria-modal')).toBe('true')
    expect(dialogue.textContent).toContain('Les mois validés ne seront pas touchés.')
  })

  it('se referme sur Annuler sans rien déclencher', () => {
    const action = vi.fn()
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner les saisies"
        message="Irréversible."
        confirmLabel="Réétalonner"
        action={action}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })

  it('se referme sur Échap', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner"
        message="Irréversible."
        confirmLabel="Confirmer"
        action={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('PageShell', () => {
  it('rend un titre de niveau 1 et son contenu', () => {
    render(<PageShell title="Missions">liste</PageShell>)
    expect(screen.getByRole('heading', { level: 1, name: 'Missions' })).toBeDefined()
    expect(screen.getByText('liste')).toBeDefined()
  })

  it('accueille des actions à côté du titre', () => {
    render(
      <PageShell title="Plan de charge" actions={<span>exercice</span>}>
        contenu
      </PageShell>,
    )
    expect(screen.getByText('exercice')).toBeDefined()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/components/ui/surfaces.test.tsx`
Expected: FAIL — `Failed to resolve import "./Card"`

- [ ] **Step 3: Écrire les composants**

`src/components/ui/Card.tsx` :

```tsx
import type { ReactNode } from 'react'

export function Card({
  title,
  children,
  className = '',
}: {
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-lg border border-rule bg-surface p-4 shadow-card ${className}`}
    >
      {title !== undefined && <h2 className="mb-3 text-lg">{title}</h2>}
      {children}
    </section>
  )
}
```

`src/components/ui/DataTable.tsx` :

```tsx
import type { ReactNode } from 'react'

/** Tableau dense : la grille de saisie et le plan de charge lisent des chiffres,
 *  pas de la prose. Le défilement horizontal est porté par l'enveloppe. */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm text-ink">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}
```

`src/components/ui/Badge.tsx` :

```tsx
import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'border-rule bg-off text-ink',
  success: 'border-success-edge bg-success text-success-ink',
  warning: 'border-warning-edge bg-warning text-warning-ink',
  danger: 'border-danger-edge bg-danger text-danger-ink',
  info: 'border-info-edge bg-info text-info-ink',
}

/**
 * Le glyphe n'est pas une décoration : c'est lui qui distingue les états
 * quand la teinte n'est pas perçue. Il est masqué aux lecteurs d'écran, qui
 * lisent déjà le libellé.
 */
export function Badge({
  tone,
  glyph,
  children,
  testId,
}: {
  tone: Tone
  glyph: string
  children: ReactNode
  testId?: string
}) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      <span aria-hidden="true">{glyph}</span>
      {children}
    </span>
  )
}
```

`src/components/ui/Banner.tsx` :

```tsx
import type { ReactNode } from 'react'
import type { Tone } from './Badge'

const TONES: Record<Exclude<Tone, 'neutral'>, string> = {
  success: 'border-success-edge bg-success text-success-ink',
  warning: 'border-warning-edge bg-warning text-warning-ink',
  danger: 'border-danger-edge bg-danger text-danger-ink',
  info: 'border-info-edge bg-info text-info-ink',
}

export function Banner({
  tone,
  title,
  children,
}: {
  tone: Exclude<Tone, 'neutral'>
  title?: string
  children: ReactNode
}) {
  return (
    // `alert` interrompt, `status` attend le moment opportun : un dépassement
    // ou un refus doit être annoncé, une information non.
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}
    >
      {title !== undefined && <p className="font-medium">{title}</p>}
      {children}
    </div>
  )
}
```

`src/components/ui/ConfirmDialog.tsx` :

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'

/**
 * Superposition simple plutôt que `<dialog>` : `showModal()` n'est pas
 * uniformément implémenté par happy-dom, et une boîte de confirmation dont
 * on ne peut pas tester la fermeture ne vaut rien.
 */
export function ConfirmDialog({
  trigger,
  title,
  message,
  confirmLabel,
  action,
}: {
  trigger: string
  title: string
  message: string
  confirmLabel: string
  action: () => void | Promise<void>
}) {
  const [ouvert, setOuvert] = useState(false)
  const confirmer = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (ouvert) confirmer.current?.focus()
  }, [ouvert])

  return (
    <>
      <Button type="button" onClick={() => setOuvert(true)}>
        {trigger}
      </Button>

      {ouvert && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') setOuvert(false)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-deep/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-rule bg-surface p-4 shadow-float">
            <h2 className="mb-2 text-lg">{title}</h2>
            <p className="mb-4 text-sm text-muted">{message}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="quiet" onClick={() => setOuvert(false)}>
                Annuler
              </Button>
              <form action={action}>
                <Button ref={confirmer} type="submit" variant="primary">
                  {confirmLabel}
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

`src/components/ui/PageShell.tsx` :

```tsx
import type { ReactNode } from 'react'

export function PageShell({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl">{title}</h1>
        {actions}
      </div>
      {children}
    </main>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/components/ui/surfaces.test.tsx`
Expected: PASS — 15 tests

- [ ] **Step 5: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): card, table, badge, banner, confirm dialog and page shell"
```

---

## Task 9: Les écrans qui ne demandent qu'un habillage

**Files:** Modify `src/app/(auth)/login/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/missions/page.tsx`, `src/app/(app)/cra/page.tsx`, `src/app/(app)/admin/saisie/page.tsx`, `src/app/(app)/admin/saisie/SettingsForm.tsx`, `src/app/(app)/charge/page.tsx`, `src/app/(app)/saisie/[month]/page.tsx`, `src/app/(app)/saisie/[month]/PastForecastNotice.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.tsx`, `src/components/MonthNav.tsx`, `src/components/charge/ExerciceBar.tsx`

**Interfaces:**
- Consumes: `Button`, `Field`, `Select`, `Checkbox`, `Card`, `Banner`, `ConfirmDialog`, `PageShell` (tâches 7 et 8)
- Produces: aucune nouvelle interface

**Aucun test de ces fichiers ne s'appuie sur une classe.** Vérifié : `SaisieClient.test.tsx`, `PastForecastNotice.test.tsx`, `MonthNav.test.tsx`, `ExerciceBar.test.tsx` interrogent des textes, des rôles et des `data-testid`. Le remplacement est donc sans risque — **à condition de ne changer ni les textes, ni les `data-testid`, ni les `role`, ni les `aria-label`.**

- [ ] **Step 1: Établir la table de correspondance**

Elle vaut pour toute la tâche, et pour la tâche 10 :

| Ancienne classe | Nouvelle classe |
|---|---|
| `bg-white` (surface) | `bg-surface` |
| `bg-slate-50` / `bg-slate-100` | `bg-off` |
| `bg-slate-200` (fond de barre) | `bg-off-strong` |
| `bg-slate-800` (segment réalisé) | `bg-accent` |
| `bg-slate-400` (segment prévu) | `bg-accent/45 pattern-hatch` |
| `bg-slate-900 text-white` (bouton plein) | *(remplacé par `<Button variant="primary">`)* |
| `text-slate-900` | `text-ink` |
| `text-slate-700` / `text-slate-600` | `text-ink` (corps) ou `text-muted` (secondaire) |
| `text-slate-500` / `text-slate-400` | `text-muted` |
| `border` / `border-slate-200` / `border-slate-300` | `border border-rule` |
| `text-red-600` / `text-red-700` / `text-red-800` | `text-danger-ink` |
| `border-red-300` / `bg-red-50` | `border-danger-edge` / `bg-danger` |
| `text-amber-600` / `text-amber-800` / `text-amber-900` | `text-warning-ink` |
| `border-amber-300` / `border-amber-400` / `bg-amber-50` / `bg-amber-100` | `border-warning-edge` / `bg-warning` |
| `text-emerald-700` / `border-green-300` / `bg-green-50` / `text-green-800` | `text-success-ink` / `border-success-edge` / `bg-success` |
| `ring-blue-400` / `focus:bg-blue-50` | `ring-focus` / `focus:bg-off` |
| `rounded` | `rounded-md` |

- [ ] **Step 2: Habiller la connexion**

`src/app/(auth)/login/page.tsx` : remplacer les deux `<input>` par `<Field label="Adresse e-mail" name="email" type="email" required />` et `<Field label="Mot de passe" name="password" type="password" required />` — les `placeholder` deviennent des libellés, ce qui rend le formulaire utilisable au lecteur d'écran. Le bouton devient `<Button type="submit" variant="primary">Se connecter</Button>`. Le tout est enveloppé dans `<Card>`.

**`required` est conservé sur les deux champs.** Ce lot change des classes, jamais un comportement : retirer `required` modifierait ce que fait le formulaire. Aucun test ne rend cette page (vérifié : il n'existe pas de fichier de test pour `login`), ce qui rend d'autant plus important de ne rien changer d'autre que l'habillage.

- [ ] **Step 3: Habiller l'ossature et la navigation**

`src/app/(app)/layout.tsx` : `bg-slate-50` → `bg-surface`, `border-slate-200` → `border-rule`, les liens passent en `text-ink hover:text-link`, le lien courant n'est pas distingué (hors périmètre). Chaque lien reçoit `touch-target inline-flex items-center px-2`. Le bouton de déconnexion devient `<Button variant="secondary" type="submit">`.

`src/components/MonthNav.tsx` : les trois `Link` et l'`input[type=month]` reçoivent `touch-target` et `border-rule`. **Ne toucher ni aux `aria-label` (`Mois précédent`, `Mois suivant`, `Aller directement à un mois`), ni au texte `Mois courant`** — `MonthNav.test.tsx` s'appuie dessus.

- [ ] **Step 4: Habiller missions, CRA et administration**

- `missions/page.tsx` : `<PageShell title="Missions">`, chaque formulaire de création dans une `<Card>`, `<Field>` pour les saisies, `<Select>` pour les listes, `<Button variant="primary">` pour « Créer ». Le champ de surcharge devient `<Field label="Durée d’une journée (h)" name="heuresParJour" type="number" step="0.25" min="0.25" max="24" placeholder={String(settings.minutesParJour / 60)} hint={\`Vide = hérité (${settings.minutesParJour / 60} h)\`} />` — la valeur héritée reste affichée, comme le lot 1d l'exige.
- `cra/page.tsx` : `<PageShell title={\`CRA · ${month}\`}>`, chaque CRA dans une `<Card>`, `<Field>` pour les trois champs de suivi, `<Button>` pour les transitions. Le `<span>` du statut devient le `StatusBadge` de la tâche 10 — **cette ligne attend la tâche 10**, la laisser telle quelle ici.
- `admin/saisie/page.tsx` et `SettingsForm.tsx` : `<PageShell>`, `<Card>` par `fieldset`, `<Field>` / `<Select>` / `<Checkbox>` pour les contrôles, `<Banner tone="danger">` et `<Banner tone="success">` pour les retours de `saveSettings` (les textes « Les réglages n'ont pas été enregistrés : » et « Réglages enregistrés. » sont conservés mot pour mot). Le bouton de réétalonnage devient un `<ConfirmDialog>` :

```tsx
<ConfirmDialog
  trigger={`Réétalonner les ${preview.concernees} saisie(s)`}
  title="Réétalonner les saisies des mois ouverts"
  message={`${preview.concernees} saisie(s) vont adopter la durée de journée en vigueur. Les saisies des mois validés ne sont jamais modifiées.`}
  confirmLabel="Réétalonner"
  action={lancerReetalonnage}
/>
```

- `charge/page.tsx` : les deux liens d'exercice passent en actions de l'ossature —

```tsx
<PageShell
  title="Plan de charge"
  actions={
    <>
      <Link href={`/charge?ex=${startYear - 1}`} className="touch-target inline-flex items-center rounded-md border border-rule px-3 text-sm text-link">
        ← Exercice précédent
      </Link>
      <Link href={`/charge?ex=${startYear + 1}`} className="touch-target inline-flex items-center rounded-md border border-rule px-3 text-sm text-link">
        Exercice suivant →
      </Link>
    </>
  }
>
```

  et le message « Aucun objectif de chiffre d'affaires n'est défini. » devient un `<Banner tone="info">`, son lien « En saisir un » conservé tel quel.
- `saisie/[month]/page.tsx` : `<PageShell title="Saisie">`.
- `PastForecastNotice.tsx` : la `<section className="mb-4 rounded border border-amber-300 bg-amber-50 …">` devient `<div className="mb-4"><Banner tone="warning">…</Banner></div>`, **avec son contenu inchangé** — les deux paragraphes, la liste des dates, le formulaire et le compte rendu. Les puces de dates passent de `bg-amber-100` à `bg-warning-edge`, le bouton devient `<Button type="submit" disabled={enCours}>`. **Le `role="status"` du compte rendu est conservé** : `PastForecastNotice.test.tsx` l'interroge et compare le texte au caractère près. `Banner` porte lui aussi un `role` — c'est sans conséquence, `getByRole('status')` ne remontera pas le bandeau `warning`, qui est un `alert`.
- `SaisieClient.tsx` : le message devient `<Banner tone="warning">{message}</Banner>`. **Les textes des messages ne changent pas** — quatre tests les recherchent par expression régulière.
- `ExerciceBar.tsx` : `bg-slate-200` → `bg-off-strong`, `bg-slate-800` → `bg-accent`, `bg-slate-400` → `bg-accent/45 pattern-hatch` (le prévisionnel se distingue du réalisé par la hachure, pas par la seule teinte), `text-emerald-700` → `text-success-ink`, `text-slate-500/600` → `text-muted`. **`bar-realise`, `bar-prevu`, `reste-a-vendre` restent en place**, et les `style={{ width }}` aussi : `ExerciceBar.test.tsx` compare les largeurs.

- [ ] **Step 5: Vérifier qu'aucun test n'est perdu**

Run: `npx vitest run && npx tsc --noEmit`
Expected: **les 307 tests d'origine passent tous**, plus ceux des tâches 1 à 8. `tsc` à 0. Si un test échoue, c'est qu'un texte, un rôle ou un `data-testid` a bougé : le remettre, pas adapter le test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(screens): apply design tokens to login, nav, missions, cra, admin and charge"
```

---

## Task 10: Les trois endroits où la couleur porte du sens

**Files:** Create `src/components/cra/StatusBadge.tsx`, `src/components/cra/StatusBadge.test.tsx`. Modify `src/components/grid/MonthGrid.tsx`, `src/components/grid/MonthGrid.test.tsx`, `src/components/grid/TotalsRow.tsx`, `src/components/grid/EngagementBar.tsx`, `src/components/charge/ChargeTable.tsx`, `src/app/(app)/cra/page.tsx`

**Interfaces:**
- Consumes: `Badge`, `DataTable` (tâche 8)
- Produces:
  - `craStatusBadge(status: CraStatus): { tone: Tone; glyph: string; label: string }`
  - `StatusBadge(props: { status: CraStatus })`
  - Sur les cellules de la grille : `data-jour` ∈ `ouvre | weekend | ferie`, `data-saisie` ∈ `vide | realise | previsionnel`, `data-depassement` sur le total

**Les deux assertions de classe à réécrire, et elles seulement :**

| Fichier | Ligne | Avant | Après |
|---|---|---|---|
| `MonthGrid.test.tsx` | 91 | `toContain('bg-slate-100')` | `toContain('bg-off')` |
| `MonthGrid.test.tsx` | 98 | `toContain('text-red-600')` | `toContain('text-danger-ink')` |

Chacune est **renforcée** par une assertion supplémentaire sur le marqueur non chromatique, écrite au Step 1. Aucune assertion n'est retirée.

- [ ] **Step 1: Écrire les tests qui échouent**

Remplacer dans `src/components/grid/MonthGrid.test.tsx` les deux tests concernés, et ajouter le bloc des six états :

```tsx
  it('marque les jours non ouvrés', () => {
    renderGrid()
    // 2026-03-01 est un dimanche
    const header = screen.getByTestId('day-header-2026-03-01')
    expect(header.className).toContain('bg-off')
    expect(header.getAttribute('data-jour')).toBe('weekend')
  })

  it('signale le dépassement de capacité sur la ligne de totaux', () => {
    renderGrid()
    // 480 + 240 = 720 > 480
    const total = screen.getByTestId('total-2026-03-12')
    expect(total.className).toContain('text-danger-ink')
    expect(total.getAttribute('data-depassement')).toBe('true')
  })

  // Six états sur une même cellule, et aucun porté par la seule couleur.
  describe('états de la cellule, distinguables sans la couleur', () => {
    const joursAvecFerie = buildMonthDays('2026-03', [1, 2, 3, 4, 5], ['2026-03-02'])

    it('distingue ouvré, week-end et férié par un attribut et un motif', () => {
      renderGrid({ days: joursAvecFerie })

      const ouvre = screen.getByTestId('day-header-2026-03-03')
      const weekend = screen.getByTestId('day-header-2026-03-01')
      const ferie = screen.getByTestId('day-header-2026-03-02')

      expect(ouvre.getAttribute('data-jour')).toBe('ouvre')
      expect(weekend.getAttribute('data-jour')).toBe('weekend')
      expect(ferie.getAttribute('data-jour')).toBe('ferie')

      // Le motif porte l'information là où la teinte ne suffit pas.
      expect(ouvre.className).not.toMatch(/pattern-/)
      expect(weekend.className).toContain('pattern-stripes')
      expect(ferie.className).toContain('pattern-dots')
    })

    it('nomme le férié autrement que par sa teinte', () => {
      renderGrid({ days: joursAvecFerie })
      expect(screen.getByTestId('day-header-2026-03-02').getAttribute('title')).toContain('érié')
    })

    it('distingue réalisé, prévisionnel et vide sur la saisie', () => {
      renderGrid({
        entries: [
          { id: 'r', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', minutesParJour: 480 },
          { id: 'p', lineId: 'l1', date: '2026-03-13', minutes: 480, kind: 'PREVISIONNEL', slotId: '', minutesParJour: 480 },
        ],
      })

      const realise = cell('Consultant ITSM', '2026-03-12')
      const prevu = cell('Consultant ITSM', '2026-03-13')
      const vide = cell('Consultant ITSM', '2026-03-16')

      expect(realise.getAttribute('data-saisie')).toBe('realise')
      expect(prevu.getAttribute('data-saisie')).toBe('previsionnel')
      expect(vide.getAttribute('data-saisie')).toBe('vide')

      // Hachures et italique : le prévisionnel se lit en vision monochrome.
      expect(prevu.className).toContain('pattern-hatch')
      expect(prevu.className).toContain('italic')
      expect(realise.className).not.toContain('pattern-hatch')
    })

    it('offre des cellules de 44 points', () => {
      renderGrid()
      expect(cell('Consultant ITSM', '2026-03-12').className).toContain('touch-target')
    })

    it('ne supprime pas l anneau de focus', () => {
      renderGrid()
      // `outline-none` sans remplacement rendrait la grille inutilisable au clavier.
      expect(cell('Consultant ITSM', '2026-03-12').className).not.toContain('outline-none')
    })
  })
```

`src/components/cra/StatusBadge.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusBadge, craStatusBadge } from './StatusBadge'
import { CRA_STATUSES } from '@/core/types'

afterEach(cleanup)

describe('StatusBadge', () => {
  it('couvre les quatre statuts', () => {
    for (const status of CRA_STATUSES) {
      expect(craStatusBadge(status).label).toBeTruthy()
    }
  })

  it('donne à chaque statut un glyphe distinct', () => {
    const glyphes = CRA_STATUSES.map((s) => craStatusBadge(s).glyph)
    expect(new Set(glyphes).size).toBe(CRA_STATUSES.length)
  })

  it('donne à chaque statut une teinte distincte', () => {
    const teintes = CRA_STATUSES.map((s) => craStatusBadge(s).tone)
    expect(new Set(teintes).size).toBe(CRA_STATUSES.length)
  })

  it('écrit le libellé en français, pas la constante', () => {
    render(<StatusBadge status="VALIDE" />)
    expect(screen.getByTestId('cra-statut').textContent).toContain('Validé')
    expect(screen.getByTestId('cra-statut').textContent).not.toContain('VALIDE')
  })

  it('reste lisible sans la couleur', () => {
    render(<StatusBadge status="REFUSE" />)
    expect(screen.getByTestId('cra-statut').textContent).toContain('✕')
    expect(screen.getByTestId('cra-statut').textContent).toContain('Refusé')
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/components/grid/MonthGrid.test.tsx src/components/cra/`
Expected: FAIL — `bg-off` absent, `data-jour` nul, import `./StatusBadge` irrésolu

- [ ] **Step 3: Réécrire la grille de saisie**

Dans `src/components/grid/MonthGrid.tsx` :

```tsx
type EtatJour = 'ouvre' | 'weekend' | 'ferie'

function etatJour(d: MonthDay): EtatJour {
  if (d.isHoliday) return 'ferie'
  return d.isWorking ? 'ouvre' : 'weekend'
}

// Fond ET motif : la teinte porte la lecture rapide, le motif porte
// l'information pour qui ne la distingue pas.
const FOND_JOUR: Record<EtatJour, string> = {
  ouvre: 'bg-surface',
  weekend: 'bg-off pattern-stripes',
  ferie: 'bg-off-strong pattern-dots',
}

const TITRE_JOUR: Record<EtatJour, string | undefined> = {
  ouvre: undefined,
  weekend: 'Jour non ouvré',
  ferie: 'Jour férié',
}
```

En-tête de colonne :

```tsx
<th
  key={d.date}
  scope="col"
  data-testid={`day-header-${d.date}`}
  data-jour={etatJour(d)}
  title={TITRE_JOUR[etatJour(d)]}
  className={`w-11 px-1 py-1 text-center text-xs font-normal text-ink ${FOND_JOUR[etatJour(d)]}`}
>
```

Cellule et champ :

```tsx
<td
  key={d.date}
  data-jour={etatJour(d)}
  onMouseDown={() => drag.handlers.onMouseDown(l.id, d.date)}
  onMouseEnter={() => drag.handlers.onMouseEnter(l.id, d.date)}
  onMouseUp={drag.handlers.onMouseUp}
  className={`${FOND_JOUR[etatJour(d)]} ${
    drag.isSelected(l.id, d.date) ? 'ring-2 ring-inset ring-focus' : ''
  }`}
>
  <input
    aria-label={`${l.label} ${d.date}`}
    data-saisie={cell === undefined ? 'vide' : cell.kind === 'REALISE' ? 'realise' : 'previsionnel'}
    /* … value, readOnly, title, onChange, onFocus, onBlur, onKeyDown inchangés … */
    className={`touch-target w-11 border-0 bg-transparent text-center text-xs text-ink focus:bg-off ${
      cell?.kind === 'PREVISIONNEL' ? 'pattern-hatch italic text-muted' : ''
    } ${parCreneaux ? 'bg-warning text-warning-ink' : ''}`}
  />
</td>
```

Quatre points de vigilance :

1. **`outline-none` disparaît.** Il était sur le champ — c'est la seule occurrence de tout `src/` (vérifié). Le supprimer laisse jouer la règle `:focus-visible` de `globals.css`. Un test du Step 1 le vérifie.
2. **`w-9` devient `w-11`** (36 → 44 points). Trente et une colonnes font alors 1364 px : l'enveloppe est déjà en `overflow-x-auto`, rien d'autre ne change.
3. **Les deux en-têtes collants** (`<th scope="col">Ligne</th>` et le `<th scope="row">` de chaque ligne) passent de `bg-white` à `bg-surface`.
4. **Les `data-testid`, `aria-label`, `title` et le comportement de `commit` ne bougent pas.** Les 18 tests actuels de `MonthGrid.test.tsx` en dépendent.

Dans `src/components/grid/TotalsRow.tsx`, le `<th>` collant passe de `bg-white` à `bg-surface`, et la cellule de total devient :

```tsx
<td
  key={d.date}
  data-testid={`total-${d.date}`}
  data-depassement={over ? 'true' : 'false'}
  title={over ? 'Capacité dépassée' : undefined}
  className={`px-1 py-1 text-center text-xs ${
    over ? 'font-bold text-danger-ink underline decoration-2' : 'text-muted'
  }`}
>
  {over && <span aria-hidden="true">! </span>}
  {formatQuantity(minutes, 'JOUR', minutesParJour)}
</td>
```

Le dépassement est ainsi porté par trois signaux — teinte, graisse soulignée, glyphe — dont deux survivent à une vision monochrome.

**Le glyphe est ici sans danger, contrairement au cas de `ChargeTable`, et c'est vérifié.** Trois tests comparent le `textContent` d'un total : « accorde la cellule et la ligne de totaux » (480 min pour 480 de capacité), « formate avec le minutesParJour global » (480 pour 480) et « donne le même total quel que soit l'ordre » (idem). Aucun n'est en dépassement, donc aucun ne voit le glyphe. Le seul test en dépassement — « signale le dépassement de capacité » — n'interroge que la classe et l'attribut.

Dans `src/components/grid/EngagementBar.tsx` : `bg-slate-200` → `bg-off-strong`, `bg-slate-800` → `bg-accent`, `bg-slate-400` → `bg-accent/45 pattern-hatch`, `text-slate-600` → `text-muted`, `text-amber-600` → `text-warning-ink`. **Les textes (`vendus`, `réalisés`, `prévus`, `restants`, `dépassement de … j`) ne changent pas** : neuf assertions les recherchent.

- [ ] **Step 4: Réécrire la matrice de charge et les badges**

`src/components/charge/ChargeTable.tsx` :

- L'enveloppe `<div className="overflow-x-auto"><table>` devient `<DataTable caption={\`Plan de charge de ${matrix.fiscalYear.label}\`}>` — la `<caption className="sr-only">` actuelle disparaît au profit de celle du composant, avec **le même texte**.
- `bg-white` → `bg-surface`, `border-t` → `border-t border-rule`, `text-slate-500` → `text-muted`, `text-amber-600` → `text-warning-ink`.
- Le segment prévisionnel des cellules devient :

```tsx
<span
  title="Prévisionnel"
  className="pattern-hatch italic text-muted underline decoration-dotted"
>
```

**Le marqueur non chromatique ne passe pas par le DOM textuel, et c'est vérifié.** `ChargeTable.test.tsx:67` compare `cell.textContent` à `'2 + 1'` au caractère près, et `:69` exige `''` pour une cellule vide. Un glyphe ajouté dans le DOM casserait ces deux assertions. La hachure, l'italique et le souligné pointillé distinguent le prévisionnel sans toucher au texte ; le `title` le nomme.

`src/components/cra/StatusBadge.tsx` :

```tsx
import { Badge, type Tone } from '@/components/ui/Badge'
import type { CraStatus } from '@/core/types'

const BADGES: Record<CraStatus, { tone: Tone; glyph: string; label: string }> = {
  BROUILLON: { tone: 'neutral', glyph: '◌', label: 'Brouillon' },
  ENVOYE: { tone: 'info', glyph: '▸', label: 'Envoyé' },
  VALIDE: { tone: 'success', glyph: '✓', label: 'Validé' },
  REFUSE: { tone: 'danger', glyph: '✕', label: 'Refusé' },
}

export function craStatusBadge(status: CraStatus): { tone: Tone; glyph: string; label: string } {
  return BADGES[status]
}

/** Quatre états qui doivent se distinguer d'un coup d'œil, sans dépendre de
 *  la seule teinte : chacun porte un glyphe qui lui est propre. */
export function StatusBadge({ status }: { status: CraStatus }) {
  const { tone, glyph, label } = BADGES[status]
  return (
    <Badge tone={tone} glyph={glyph} testId="cra-statut">
      {label}
    </Badge>
  )
}
```

Dans `src/app/(app)/cra/page.tsx`, remplacer `<span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{cra.status}</span>` par `<StatusBadge status={cra.status} />`.

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/components/ src/app/`
Expected: PASS — `MonthGrid.test.tsx` au complet (**23 tests** : les 18 d'aujourd'hui, dont 2 réécrits, plus les 5 nouveaux), `StatusBadge.test.tsx` (5 tests), `ChargeTable.test.tsx` et `ExerciceBar.test.tsx` inchangés

- [ ] **Step 6: Vérifier par mutation**

Retirer `pattern-hatch` de la cellule prévisionnelle et confirmer que « distingue réalisé, prévisionnel et vide sur la saisie » échoue. Restaurer ensuite.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(grid): six cell states and four cra statuses distinguishable without colour"
```

---

## Task 11: Les garde-fous

**Files:** Create `src/design-system.test.ts`, `src/components/ui/touch-targets.test.tsx`

**Interfaces:**
- Consumes: tout ce qui précède
- Produces: aucun code applicatif — des tests qui empêchent la dérive

**État de départ, relevé avant d'écrire ces tests :** `src/` ne contient **aucune** valeur hexadécimale hors fichiers de test, et **une seule** occurrence de `outline-none` — `MonthGrid.tsx:207`, que la tâche 10 supprime. Les seules corrections attendues au Step 2 portent donc sur les classes de la palette Tailwind par défaut oubliées aux tâches 9 et 10.

- [ ] **Step 1: Écrire le test**

`src/design-system.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const RACINE = join(process.cwd(), 'src')

// Les seuls endroits où une couleur a le droit d'être écrite en clair : la
// définition des jetons, et les tests qui la vérifient.
const EXEMPTS = [
  join('core', 'theme', 'tokens.ts'),
  join('app', 'globals.css'),
]

function sources(dossier: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) out.push(...sources(chemin))
    else if (/\.(ts|tsx|css)$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) {
      out.push(chemin)
    }
  }
  return out
}

const FICHIERS = sources(RACINE).filter(
  (chemin) => !EXEMPTS.some((exempt) => chemin.endsWith(exempt)),
)

const PALETTE_TAILWIND =
  /\b(?:bg|text|border|ring|from|via|to|decoration|outline|accent|fill|stroke|divide|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

describe('aucune couleur en dur', () => {
  it('ne laisse aucune valeur hexadécimale hors de la définition des jetons', () => {
    const fautifs = FICHIERS.filter((chemin) =>
      /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(chemin, 'utf8')),
    ).map((chemin) => relative(RACINE, chemin))
    expect(fautifs).toEqual([])
  })

  it('ne laisse aucune classe de la palette Tailwind par défaut', () => {
    // Une classe `bg-slate-100` oubliée n'est pas une faute de goût : c'est
    // une couleur qu'on ne pourra ni changer ni thématiser.
    const fautifs = FICHIERS.filter((chemin) =>
      PALETTE_TAILWIND.test(readFileSync(chemin, 'utf8')),
    ).map((chemin) => relative(RACINE, chemin))
    expect(fautifs).toEqual([])
  })
})

describe('focus visible', () => {
  it('ne supprime nulle part le contour sans le remplacer', () => {
    const fautifs = FICHIERS.filter((chemin) => {
      const contenu = readFileSync(chemin, 'utf8')
      const supprime = /outline-none|outline:\s*none/.test(contenu)
      const remplace = /focus-visible|ring-focus|outline-focus/.test(contenu)
      return supprime && !remplace
    }).map((chemin) => relative(RACINE, chemin))
    expect(fautifs).toEqual([])
  })
})
```

- [ ] **Step 2: Lancer le test et corriger ce qu'il remonte**

Run: `npx vitest run src/design-system.test.ts`
Expected: le premier passage **échoue en nommant les fichiers restants**. Corriger chacun avec la table de correspondance de la tâche 9, puis relancer jusqu'à obtenir `[]`.

Deux points à ne pas confondre avec des fautes :

- `src/components/ui/ConfirmDialog.tsx` utilise `bg-ink-deep/40` — c'est un jeton avec un modificateur d'opacité, la regex de la palette ne le voit pas. Rien à faire.
- Si un `#` légitime apparaît un jour hors couleur, **resserrer la regex à `#[0-9a-fA-F]{6}\b`** plutôt qu'exempter un fichier : exempter un fichier entier rouvrirait la porte à toutes ses couleurs.

- [ ] **Step 3: Écrire le test des cibles tactiles**

Créer `src/components/ui/touch-targets.test.tsx` — un fichier à part, parce qu'il rend du JSX et exige donc `happy-dom` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { buildMonthDays } from '@/core/month/build'
import { Button } from './Button'
import { Field } from './Field'
import { Select } from './Select'
import { Checkbox } from './Checkbox'
import type { LineForGrid } from '@/services/missions'

afterEach(cleanup)

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
]

// 44 points est la cible minimale de la spec, et le lot 1c en dépend.
// happy-dom ne calcule pas de mise en page : on vérifie le contrat de classe,
// dont `globals.css` garantit qu'il vaut 2,75rem, soit 44 px.
describe('cibles tactiles', () => {
  it('sur les contrôles de la bibliothèque', () => {
    const { container } = render(
      <>
        <Button>Enregistrer</Button>
        <Field label="Seuil" name="seuil" />
        <Select label="Mission" name="missionId">
          <option value="m">M</option>
        </Select>
        <Checkbox label="Lundi" name="jours" value="1" />
      </>,
    )
    expect(screen.getByRole('button').className).toContain('touch-target')
    expect(screen.getByLabelText('Seuil').className).toContain('touch-target')
    expect(screen.getByLabelText('Mission').className).toContain('touch-target')
    expect(container.querySelector('label[for]')!.className).toContain('touch-target')
  })

  it('sur chaque cellule de la grille de saisie', () => {
    // La surface la plus dense de l'application, à 375 px de large comme
    // ailleurs : c'est là que la règle coûte le plus, et qu'elle compte le plus.
    render(
      <MonthGrid
        days={buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])}
        lines={lines}
        entries={[]}
        engagementTotals={{ l1: [] }}
        capacityMinutes={480}
        minutesParJour={480}
        onSave={vi.fn(async () => true)}
      />,
    )
    const champs = screen.getAllByLabelText(/^Consultant ITSM 2026-03-/)
    expect(champs).toHaveLength(31)
    for (const champ of champs) {
      expect(champ.className).toContain('touch-target')
    }
  })
})
```

- [ ] **Step 4: Lancer les deux fichiers**

Run: `npx vitest run src/design-system.test.ts src/components/ui/touch-targets.test.tsx`
Expected: PASS — 3 + 2 tests

- [ ] **Step 5: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert. **Les 307 tests d'origine sont tous présents** — le vérifier explicitement :

```bash
npx vitest run 2>&1 | tail -5
```
Le total doit être **supérieur** à 307, jamais inférieur. Si le compte a baissé, un fichier de test a été perdu : `git diff --stat HEAD~11 -- 'src/**/*.test.*'` le montre.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(design): guard against hard-coded colours, missing focus and small targets"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche |
|---|---|
| §2 Identité relevée sur kreativpm.fr | 2 (`THEME_KREATIVPM`) |
| §3 L'or n'est jamais du texte, réservé aux aplats | 2 (`TEXT_PAIRS` sans `accent`), 10 |
| §3 Texte interactif lisible (`link` à 5,37:1) | 2, 9 |
| §3 Tout jeton vérifié par calcul, pas à l'œil | 1, 2 |
| §4 Couleurs d'état dans la famille chaude | 2 |
| §4 Prévisionnel distinct du réalisé sans la couleur seule | 9 (`ExerciceBar`), 10 (grille, `ChargeTable`) |
| §5 Jetons en variables CSS consommées par Tailwind | 4 |
| §5 Espacement, rayons, ombres, échelle typographique resserrée | 4 |
| §5 Polices embarquées, pas de service tiers | 3 |
| §6 Couleurs paramétrables, stockées en réglages, JSON en bloc | 5 |
| §6 Injection en variables CSS à l'affichage | 4 |
| §6 Deux préréglages : KreativPM et neutre | 2, 6 |
| §6 Retour au défaut en un geste | 5 (`resetTheme`), 6 |
| §6 Palette sous 4,5:1 refusée, couple et rapport nommés | 2 (`describeContrastIssue`), 5 |
| §6 Polices non paramétrables | 3, 5 (le schéma zod ne porte que des couleurs) |
| §7 Bouton avec variantes et chargement | 7 |
| §7 Champ avec libellé et erreur, liste déroulante, case à cocher | 7 |
| §7 Carte, tableau dense, badge, bandeau, dialogue, ossature | 8 |
| §7 Aucun composant qu'aucun écran n'utilise | 9 (chacun est câblé), 10 |
| §8 Écrans repris : connexion, saisie, missions, CRA, charge, admin | 9 |
| §8 Grille de saisie, six états | 10 |
| §8 Matrice de charge | 10 |
| §8 Badges de statut de CRA, quatre états | 10 |
| §9 Aucune couleur en dur | 11 |
| §9 Aucune information portée par la seule couleur | 10, 11 |
| §9 Cible tactile de 44 points | 7, 10, 11 |
| §9 État de focus visible partout | 4 (`globals.css`), 11 |
| §11 Test parcourant les couples de jetons | 2 |
| §11 L'éditeur refuse une palette illisible | 5 |
| §11 Un thème enregistré s'applique et survit à un redémarrage | 4, 5 |
| §11 Le retour au défaut restaure exactement KreativPM | 5 |
| §11 Les états de la grille se distinguent sans la couleur | 2 (luminances), 10 (marqueurs) |
| §11 Les polices se chargent sans réseau sortant | 3 |
| §11 Les tests existants ne sont pas affaiblis | 9, 10, 11 (Step 5) |
| §12 L'identité du site prime sur le thème Dolibarr | 2 — aucun bleu dans `THEME_KREATIVPM` |
| §12 L'or cantonné aux aplats, imposé par le contraste | Décision en tête de plan, tenue par 2 |
| §12 Couleurs d'état inventées dans la famille chaude | 2 |
| §12 Pas de thème sombre | Aucune tâche — `globals.css` ne déclare aucun `prefers-color-scheme` |
| §12 Polices non paramétrables, couleurs oui | 3, 5 |
| §12 Bibliothèque limitée à ce que les écrans utilisent | 7, 8 — chaque composant est câblé en 9 ou 10 |

**Hors périmètre, conformément à la spec :** thème sombre, animations et transitions élaborées, refonte de l'architecture des écrans. Le lot 1c reconstruira la surface de saisie **contre ce système**, pas contre du Tailwind par défaut : c'est la raison pour laquelle ce lot passe avant lui.
