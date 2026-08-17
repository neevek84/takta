# Lot 1g — Identité « Encre » · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à CRA une identité visuelle propre — palette vive validée par le calcul, matière, calendrier à plages fusionnées et navigation en rail groupé — sans entamer d'un pouce le contrat d'accessibilité acquis aux lots 1e et 1f.

**Architecture:** Trois jetons de couleur s'ajoutent aux 44 existants pour que le prévisionnel porte sa propre teinte. Deux préréglages « Encre » entrent dans `THEME_PRESETS` et deviennent le défaut. Le reste est de la valeur et de la forme : une échelle typographique, une échelle d'élévation, des cases carrées qui fusionnent en plages, et un rail de navigation à deux groupes qui remplace la barre horizontale débordante.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript 5.9 · Tailwind 4 (CSS-first) · Vitest 4 · happy-dom · `lucide-react` · `clsx` · `tailwind-merge`

**Spec :** `docs/superpowers/specs/2026-08-16-lot-1g-identite-encre-design.md`
**Référence visuelle :** https://claude.ai/code/artifact/299838ac-740b-4d02-880a-02ae930aa35e

## Global Constraints

- **Baseline remesurée le 2026-08-16 à 22 h : `main` porte 2 587 tests, tous verts, `tsc` à 0.** Les 2 échecs que la spec mentionnait en §11 n'existent plus — les lots 3 et 4 sont fusionnés et l'arbre est libre. **La porte de sortie de chaque tâche est donc : zéro échec, sans exception.**
- **Vérification par mutation, obligatoire à chaque tâche.** Un test qui décrit correctement une promesse sans la vérifier est pire qu'aucun test : vingt jeux de ce projet étaient dans ce cas. Après avoir fait passer un test, casser délibérément la ligne qu'il prétend protéger, **montrer quel test tombe**, restaurer immédiatement — avant la mutation suivante. Un agent interrompu en pleine vérification a laissé un `break` planté au milieu d'une boucle.
- **Quoter tout chemin contenant des crochets** — `"src/app/(app)/saisie/[month]/…"` — qu'un shell avale silencieusement. Deux mutations ont été crues muettes pour cette raison.
- **Aucun test ne disparaît.** Les assertions réécrites sont nommées explicitement dans les tâches 2, 3, 7, 8 et 9. Toute autre suppression est un défaut.
- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** Les jetons et le calcul de contraste y vivent.
- **Aucune migration Prisma.** Les palettes vivent dans le JSON de `Settings`, lu et écrit en bloc.
- **`@theme` classique, jamais `@theme inline`** — ce dernier substitue les valeurs à la compilation et rend le thème paramétrable inopérant. Un test du lot 1e monte la garde.
- **Ne jamais lancer `npx next build`** : le serveur de développement du porteur tourne sur cet arbre. Cela écrase son cache et le casse.
- **Ne jamais utiliser `git add -A`** — chemins explicites uniquement. Cette erreur a balayé du code d'agent deux fois.
- Tests de composants : `// @vitest-environment happy-dom` en **première ligne**, `afterEach(cleanup)` explicite. `jsdom` ne fonctionne pas ici (Node 22.11 < 22.12).
- **`vitest.config.ts` est en `fileParallelism: false`** — ne pas le modifier.
- Français pour les chaînes visibles, anglais pour le code et les messages de commit.
- **Aucune couleur en clair hors de `src/core/theme/tokens.ts` et `src/app/globals.css`.** `design-system.test.ts` le vérifie et doit rester vert.
- **Cibles tactiles à 44 pt.** `touch-targets.test.tsx` et le test de budget des sept colonnes à 375 px doivent rester verts.
- **À partir de la tâche 5, toute composition de `className` passe par `cn()`** — les nouvelles comme celles qu'une tâche modifie. Un gabarit de chaîne laissé en place est un conflit d'utilitaires en attente : c'est exactement ce que l'utilitaire existe pour empêcher, et l'introduire sans l'employer ne servirait à rien. Les tâches 8, 11 et 13 sont les plus concernées — ce sont elles qui composent le plus de classes conditionnelles.

---

## Décision : pourquoi `prevu` est un jeton et non une opacité

`SEGMENT_PREVU` vaut aujourd'hui `bg-accent/45 pattern-hatch`. Le lot 1f documente lui-même cette opacité comme un **angle mort assumé** du contrôle de contraste : 1,32:1 sur sa piste, compensé par la hachure.

Ce lot ferme l'angle mort au lieu de l'élargir. Une teinte opaque entre dans `TEXT_PAIRS` et dans `NON_TEXT_PAIRS`, donc dans le contrôle ; une opacité n'y entre pas. Et un prévisionnel dessiné comme « l'accent, en moins fort » est terne par construction — c'est précisément le reproche du porteur.

**Contrainte attachée, mesurée :** `prevuEdge` à `#c1860f` tient 3,14:1 sur blanc (exigence non textuelle) mais `prevuInk` posée dessus ne tiendrait que 3,93:1. Les deux sont incompatibles sur une teinte ambre. Le couple `prevuInk` sur `prevuEdge` **n'entre donc pas** dans `TEXT_PAIRS`, et **aucun composant ne remplit `prevuEdge` au survol** — contrairement au bouton `danger`, qui fait `hover:bg-danger-edge`.

---

## Décision : la fusion des plages se calcule dans `core/`, pas dans le composant

La fusion a besoin de savoir, pour chaque jour, si son voisin de gauche et son voisin de droite portent le même état **et** appartiennent à la même semaine de la grille. C'est une règle pure, testable sans DOM — donc `src/core/saisie/plage.ts`, à côté de `forme.ts` qui suit exactement ce parti.

Le composant ne fait qu'appliquer les classes que cette fonction lui rend. C'est ce qui permet de tester la règle sans monter une case à l'écran, comme `signatureDeForme` l'a permis au lot 1f.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `src/core/theme/tokens.ts` | +3 jetons, +2 préréglages, palette catégorielle | 1, 2, 3 |
| `src/core/saisie/plage.ts` | **créé** — bornes d'une plage de jours contigus | 8 |
| `src/core/saisie/colors.ts` | teinte d'aplat selon le mode, teinte du prévisionnel | 6, 7 |
| `src/app/globals.css` | jetons de repli, échelle typographique, rayons, ombres | 1, 4, 5 |
| `src/lib/cn.ts` | **créé** — `clsx` + `tailwind-merge` | 5 |
| `src/components/ui/icons.tsx` | **créé** — les icônes du système, tirées de `lucide-react` | 10 |
| `src/components/ui/Button.tsx`, `Card.tsx`, `Field.tsx`, `Badge.tsx`, `Banner.tsx` | matière et transitions | 5, 10 |
| `src/components/ui/PageShell.tsx` | gabarit unique | 4, 12 |
| `src/components/ui/DataTable.tsx` | chiffres tabulaires | 4 |
| `src/components/ui/SegmentLegend.tsx` | segments réalisé / prévisionnel | 7 |
| `src/components/ui/Aplat.tsx` | dégradé de l'aplat | 5 |
| `src/components/calendar/MonthCalendar.tsx` | mode d'aplat, plages, cases carrées, week-ends | 6, 7, 8, 9 |
| `src/components/grid/EngagementBar.tsx` | la réglette | 7, 13 |
| `src/components/nav/NavRail.tsx` | **créé** — rail à deux groupes | 11 |
| `src/app/(app)/layout.tsx` | pose du rail | 11 |
| `src/app/(app)/saisie/[month]/page.tsx`, `SaisieClient.tsx` | gabarit, réglette | 12, 13 |

---

## Task 1 : les trois jetons du prévisionnel

**Files:**
- Modify: `src/core/theme/tokens.ts`
- Modify: `src/app/globals.css`
- Test: `src/core/theme/tokens.test.ts`

**Interfaces:**
- Produces: `ThemeTokens` gagne `prevu`, `prevuInk`, `prevuEdge` — trois `string`. `THEME_TOKEN_KEYS` et `TOKEN_LABELS` les portent. `TEXT_PAIRS` gagne `{ text: 'prevuInk', background: 'prevu' }`. `NON_TEXT_PAIRS` gagne `prevuEdge` sur les quatre `FONDS_DE_TEXTE`.

- [ ] **Step 1 : écrire le test qui échoue**

Dans `src/core/theme/tokens.test.ts` :

```ts
it('porte les trois jetons du prévisionnel', () => {
  expect(THEME_TOKEN_KEYS).toContain('prevu')
  expect(THEME_TOKEN_KEYS).toContain('prevuInk')
  expect(THEME_TOKEN_KEYS).toContain('prevuEdge')
  expect(THEME_TOKEN_KEYS).toHaveLength(47)
})

it("exige l'encre du prévisionnel sur son fond, jamais sur sa bordure", () => {
  expect(TEXT_PAIRS).toContainEqual({ text: 'prevuInk', background: 'prevu' })
  // Mesuré : prevuInk sur prevuEdge ne tient que 3,93:1. La bordure est tenue
  // comme élément non textuel (3:1), et aucun composant ne la remplit.
  expect(TEXT_PAIRS).not.toContainEqual({ text: 'prevuInk', background: 'prevuEdge' })
})

it('exige la bordure du prévisionnel à 3:1 sur les fonds de texte', () => {
  for (const background of FONDS_DE_TEXTE) {
    expect(NON_TEXT_PAIRS).toContainEqual({ text: 'prevuEdge', background })
  }
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/core/theme/tokens.test.ts`
Expected : FAIL — `THEME_TOKEN_KEYS` a 44 entrées, pas 47.

- [ ] **Step 3 : ajouter les jetons**

Dans `ThemeTokens`, après le bloc `info*` :

```ts
  /**
   * Le prévisionnel n'est pas un accent délavé : c'est un autre état, et il a
   * sa teinte. Le lot 1f le dessinait en `bg-accent/45`, une opacité que le
   * contrôle de contraste ne voit pas — angle mort qu'il documentait lui-même.
   * Une teinte opaque entre dans le contrôle ; une opacité n'y entre pas.
   */
  prevu: string
  prevuInk: string
  /** Jamais remplie au survol : `prevuInk` n'y tiendrait que 3,93:1. */
  prevuEdge: string
```

Ajouter `'prevu', 'prevuInk', 'prevuEdge'` à `THEME_TOKEN_KEYS`, et à `TOKEN_LABELS` :

```ts
  prevu: 'fond du prévisionnel',
  prevuInk: 'encre du prévisionnel',
  prevuEdge: 'bordure du prévisionnel',
```

Dans `TEXT_PAIRS`, après les couples d'état :

```ts
  // Aplat du prévisionnel : calendrier, grille, réglette et légende.
  { text: 'prevuInk', background: 'prevu' },
```

Dans `NON_TEXT_PAIRS` :

```ts
  ...FONDS_DE_TEXTE.map((background): TokenPair => ({ text: 'prevuEdge', background })),
```

- [ ] **Step 4 : donner une valeur aux trois jetons dans les trois palettes existantes**

Sans quoi `THEME_CLAIR`, `THEME_SOMBRE` et `THEME_KREATIVPM` ne compilent plus. Valeurs choisies pour passer le contrôle sur chaque palette :

```ts
// THEME_CLAIR
  prevu: '#f2b544', prevuInk: '#4a2f05', prevuEdge: '#c1860f',
// THEME_SOMBRE
  prevu: '#e0a83a', prevuInk: '#2a1c04', prevuEdge: '#966d16',
// THEME_KREATIVPM
  prevu: '#e8b45c', prevuInk: '#48300a', prevuEdge: '#bd8a1c',
```

- [ ] **Step 5 : déclarer les jetons de repli dans `globals.css`**

Dans le bloc `@theme`, après les jetons `info` :

```css
  /* Le prévisionnel a sa teinte, pas une opacité de l'accent. */
  --color-prevu: #f2b544;
  --color-prevu-ink: #4a2f05;
  --color-prevu-edge: #c1860f;
```

- [ ] **Step 6 : lancer les tests du module**

Run : `npx vitest run src/core/theme/`
Expected : PASS — y compris les contrôles de contraste des trois palettes existantes.

- [ ] **Step 7 : commit**

```bash
git add src/core/theme/tokens.ts src/core/theme/tokens.test.ts src/app/globals.css
git commit -m "feat(theme): le previsionnel porte sa propre teinte, pas une opacite"
```

---

## Task 2 : les préréglages « Encre » et leur passage en défaut

**Files:**
- Modify: `src/core/theme/tokens.ts`
- Test: `src/core/theme/tokens.test.ts`

**Interfaces:**
- Consumes: les trois jetons de la tâche 1.
- Produces: `THEME_ENCRE_CLAIR` et `THEME_ENCRE_SOMBRE` (`ThemeTokens`). `THEME_PRESETS` gagne les identifiants `'ENCRE_CLAIR'` et `'ENCRE_SOMBRE'`. `DEFAULT_THEME` vaut `THEME_ENCRE_CLAIR`, `DEFAULT_THEME_CONFIG` porte les deux.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
it('livre Encre sans aucune anomalie de contraste', () => {
  expect(findContrastIssues(THEME_ENCRE_CLAIR).map(describeContrastIssue)).toEqual([])
  expect(findContrastIssues(THEME_ENCRE_SOMBRE).map(describeContrastIssue)).toEqual([])
})

it('respecte la polarité de chaque versant', () => {
  expect(findPolarityIssues(THEME_ENCRE_CLAIR, 'clair')).toEqual([])
  expect(findPolarityIssues(THEME_ENCRE_SOMBRE, 'sombre')).toEqual([])
})

it('fait d Encre le défaut, et garde KreativPM comme préréglage', () => {
  expect(DEFAULT_THEME).toBe(THEME_ENCRE_CLAIR)
  expect(DEFAULT_THEME_CONFIG.clair).toBe(THEME_ENCRE_CLAIR)
  expect(DEFAULT_THEME_CONFIG.sombre).toBe(THEME_ENCRE_SOMBRE)
  expect(THEME_PRESETS.map((p) => p.id)).toContain('KREATIVPM')
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/core/theme/tokens.test.ts`
Expected : FAIL — `THEME_ENCRE_CLAIR` n'existe pas.

- [ ] **Step 3 : écrire les deux palettes**

```ts
/**
 * Encre — l'identité propre de CRA, distincte de la marque comme du neutre.
 *
 * `onAccent` n'est plus blanc : l'accent est vif et clair (L*55), et le blanc
 * n'y tiendrait pas 4,5:1. Une encre teal très sombre autorise un accent bien
 * plus lumineux qu'un teal sombre à texte blanc — c'est ce choix, et lui seul,
 * qui retire la grisaille que le porteur a constatée.
 */
export const THEME_ENCRE_CLAIR: ThemeTokens = {
  page: '#eaf2ef', surface: '#ffffff', off: '#dbe8e3', offStrong: '#c8dad4',
  ink: '#12211d', inkDeep: '#0a1512', muted: '#485853',
  onAccent: '#031c18', onDark: '#eaf2ef',
  accent: '#0e9480', accentDark: '#0b7566', link: '#0a6355',
  rule: '#aec5bd', focus: '#0b7566',
  success: '#dff0e2', successInk: '#1e5232', successEdge: '#98c9a8',
  warning: '#fbecd0', warningInk: '#6b4708', warningEdge: '#e5bf72',
  danger: '#fbe3dc', dangerInk: '#7f2c17', dangerEdge: '#e8a894',
  info: '#dfebef', infoInk: '#24454f', infoEdge: '#aac6ce',
  prevu: '#f2b544', prevuInk: '#4a2f05', prevuEdge: '#c1860f',
  ...CATEGORIES_CLAIR,
}

/** Construite, pas inversée : son chroma catégoriel est inférieur au clair. */
export const THEME_ENCRE_SOMBRE: ThemeTokens = {
  page: '#121a18', surface: '#1e2a27', off: '#111917', offStrong: '#050807',
  ink: '#e2ece9', inkDeep: '#060a09', muted: '#9fb0ab',
  onAccent: '#04211c', onDark: '#e2ece9',
  accent: '#3fc9b0', accentDark: '#2ba792', link: '#5fd8c0',
  rule: '#33443f', focus: '#5fd8c0',
  success: '#14291c', successInk: '#86d09a', successEdge: '#294733',
  warning: '#2b2513', warningInk: '#e0bf6e', warningEdge: '#4b3e1c',
  danger: '#2c1b16', dangerInk: '#f0a189', dangerEdge: '#4e2f25',
  info: '#16242a', infoInk: '#a2c7d0', infoEdge: '#2d454e',
  prevu: '#e0a83a', prevuInk: '#2a1c04', prevuEdge: '#966d16',
  ...CATEGORIES_SOMBRE,
}
```

- [ ] **Step 4 : les inscrire et les faire défaut**

```ts
export const DEFAULT_THEME: ThemeTokens = THEME_ENCRE_CLAIR

export const THEME_PRESETS: ReadonlyArray<{
  id: 'ENCRE_CLAIR' | 'ENCRE_SOMBRE' | 'CLAIR' | 'SOMBRE' | 'KREATIVPM'
  label: string
  nature: ThemeNature
  tokens: ThemeTokens
}> = [
  { id: 'ENCRE_CLAIR', label: 'Encre clair', nature: 'clair', tokens: THEME_ENCRE_CLAIR },
  { id: 'ENCRE_SOMBRE', label: 'Encre sombre', nature: 'sombre', tokens: THEME_ENCRE_SOMBRE },
  { id: 'CLAIR', label: 'Neutre clair', nature: 'clair', tokens: THEME_CLAIR },
  { id: 'SOMBRE', label: 'Neutre sombre', nature: 'sombre', tokens: THEME_SOMBRE },
  { id: 'KREATIVPM', label: 'KreativPM', nature: 'clair', tokens: THEME_KREATIVPM },
]

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'systeme',
  clair: THEME_ENCRE_CLAIR,
  sombre: THEME_ENCRE_SOMBRE,
}
```

- [ ] **Step 5 : reporter les valeurs d'Encre clair dans `globals.css`**

Le bloc `@theme` est le **plancher** : il ne porte qu'un seul thème, le clair, et c'est désormais Encre clair. Remplacer les valeurs des jetons de base par celles de `THEME_ENCRE_CLAIR`. Ne pas toucher aux échelles non chromatiques, traitées en tâches 4 et 5.

- [ ] **Step 6 : réécrire les assertions qui nomment l'ancien défaut**

Chercher `#f6f6f5`, `#3f4744`, `'CLAIR'` et `THEME_CLAIR` dans les tests :

Run : `grep -rn "f6f6f5\|3f4744\|THEME_CLAIR" src --include=*.test.ts --include=*.test.tsx`

Réécrire les assertions trouvées pour qu'elles nomment Encre. **Aucune n'est supprimée** — chacune change de valeur attendue.

- [ ] **Step 7 : lancer la suite complète**

Run : `npx vitest run`
Expected : les 2 échecs de baseline du lot 3, et aucun autre.

- [ ] **Step 8 : commit**

```bash
git add src/core/theme/tokens.ts src/core/theme/tokens.test.ts src/app/globals.css
git commit -m "feat(theme): Encre devient l identite par defaut de CRA"
```

---

## Task 3 : la palette catégorielle passe à C\* 39

**Files:**
- Modify: `src/core/theme/tokens.ts` (`CATEGORIES_CLAIR`, `CATEGORIES_SOMBRE`)
- Test: `src/core/theme/tokens.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: les 36 valeurs catégorielles changent. Les cinq préréglages les partagent, donc les cinq sont revérifiés.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
it('tient les six teintes entre le criard et le terne', () => {
  const fonds = CATEGORY_BACKGROUNDS.map((k) => THEME_ENCRE_CLAIR[k])
  const moyen = fonds.reduce((s, h) => s + chroma(h), 0) / fonds.length
  // 62 était criard (lot 1f), 24 était terne (première tentative de ce lot).
  expect(moyen).toBeGreaterThan(33)
  expect(moyen).toBeLessThan(45)
})

it('construit le sombre au lieu de l inverser', () => {
  const c = (t: ThemeTokens) =>
    CATEGORY_BACKGROUNDS.reduce((s, k) => s + chroma(t[k]), 0) / CATEGORY_BACKGROUNDS.length
  expect(c(THEME_ENCRE_SOMBRE)).toBeLessThan(c(THEME_ENCRE_CLAIR))
})

it('laisse les cinq préréglages sans anomalie', () => {
  for (const preset of THEME_PRESETS) {
    expect(findContrastIssues(preset.tokens).map(describeContrastIssue)).toEqual([])
  }
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/core/theme/tokens.test.ts`
Expected : FAIL — le chroma moyen vaut ≈62.

- [ ] **Step 3 : remplacer les deux blocs**

```ts
/**
 * Reconstruite en LCh sur les mêmes principes que le lot 1f — clarté commune,
 * six secteurs de teinte répartis — mais à C*≈39. Le lot 1f était à 62, ce que
 * son propre `ETAT.md` listait « à soumettre au porteur » ; il a jugé criard.
 * Une première correction à 24 a été jugée terne. 39 est le point retenu.
 *
 * Clair : L*78 / C*40 (fond), L*22 / C*28 (encre), L*68 / C*46 (bordure).
 */
const CATEGORIES_CLAIR = {
  catA: '#ffa5a9', catAInk: '#5a2228', catAEdge: '#f5858c',
  catB: '#e5ba78', catBInk: '#463108', catBEdge: '#cb9f53',
  catC: '#96cf90', catCInk: '#193c19', catCEdge: '#73b56f',
  catD: '#36d5d9', catDInk: '#003f42', catDEdge: '#00bbc1',
  catE: '#77c8ff', catEInk: '#00395d', catEEdge: '#3baef7',
  catF: '#e4aef1', catFInk: '#472950', catFEdge: '#cc90dc',
} as const

/** Sombre : L*38 / C*30 (fond), L*91 / C*8 (encre), L*41 / C*34 (bordure). */
const CATEGORIES_SOMBRE = {
  catA: '#87464a', catAInk: '#f6e0e0', catAEdge: '#954a4f',
  catB: '#6f5529', catBInk: '#eee4d6', catBEdge: '#795c28',
  catC: '#3c6339', catCInk: '#dde8db', catCEdge: '#3e6b3c',
  catD: '#006669', catDInk: '#d3eaea', catDEdge: '#006f73',
  catE: '#1a5e89', catEInk: '#dbe7f4', catEEdge: '#076697',
  catF: '#704d79', catFInk: '#ede2ef', catFEdge: '#7a5285',
} as const
```

- [ ] **Step 4 : reporter les six fonds catégoriels dans `globals.css`**

- [ ] **Step 5 : lancer les tests**

Run : `npx vitest run src/core/theme/`
Expected : PASS. **Si un préréglage échoue, ne pas baisser un seuil** : ajuster la clarté du jeton fautif et remesurer. C'est ainsi que `catD` et `catE` ont été réglées.

- [ ] **Step 6 : commit**

```bash
git add src/core/theme/tokens.ts src/core/theme/tokens.test.ts src/app/globals.css
git commit -m "feat(theme): la palette categorielle trouve son point entre criard et terne"
```

---

## Task 4 : l'échelle typographique et les chiffres tabulaires

**Files:**
- Modify: `src/app/globals.css`, `src/components/ui/PageShell.tsx`, `src/components/ui/Card.tsx`, `src/components/ui/DataTable.tsx`
- Test: `src/components/ui/surfaces.test.tsx`

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// @vitest-environment happy-dom
it('donne au titre de page la taille du jeton 2xl', () => {
  render(<PageShell title="Saisie">contenu</PageShell>)
  expect(screen.getByRole('heading', { level: 1 }).className).toContain('text-2xl')
})

it('aligne les chiffres du tableau', () => {
  render(<DataTable caption="Plan de charge"><tbody><tr><td>1</td></tr></tbody></DataTable>)
  expect(document.querySelector('table')!.className).toContain('tabular-nums')
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/components/ui/surfaces.test.tsx`
Expected : FAIL — le `h1` porte `text-xl`.

- [ ] **Step 3 : régler l'échelle dans `globals.css`**

```css
  /* Le corps reste à 14 px : une grille de saisie a besoin de sa densité.
     Ce qui change, c'est le haut de l'échelle — un titre à ×1,29 du corps
     n'est pas un titre, c'est une étiquette en gras. */
  --text-2xl: 1.375rem;
  --text-2xl--line-height: 1.75rem;
```

Et dans `@layer base`, remplacer la graisse des titres :

```css
  h1, h2, h3 {
    font-family: var(--font-display);
    /* 800 compensait une taille trop petite en criant. La taille porte
       désormais la hiérarchie ; la graisse redescend. */
    font-weight: 700;
    letter-spacing: -0.02em;
  }
```

- [ ] **Step 4 : appliquer aux composants**

`PageShell` : `<h1 className="text-2xl">`. `Card` : `<h2 className="mb-3 text-xl">`. `DataTable` : `className="border-collapse text-sm text-ink tabular-nums"`.

- [ ] **Step 5 : lancer les tests**

Run : `npx vitest run src/components/`
Expected : PASS.

- [ ] **Step 6 : commit**

```bash
git add src/app/globals.css src/components/ui/PageShell.tsx src/components/ui/Card.tsx src/components/ui/DataTable.tsx src/components/ui/surfaces.test.tsx
git commit -m "feat(design): monter dans l echelle typographique, redescendre en graisse"
```

---

## Task 5 : la matière — rayons, ombres, transitions

**Files:**
- Create: `src/lib/cn.ts`
- Modify: `src/app/globals.css`, `src/components/ui/Button.tsx`, `src/components/ui/Card.tsx`, `src/components/ui/Field.tsx`, `src/components/ui/Aplat.tsx`
- Modify: `package.json`
- Test: `src/components/ui/controls.test.tsx`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` depuis `src/lib/cn.ts`.

- [ ] **Step 1 : installer les deux paquets**

```bash
npm install clsx tailwind-merge
```

- [ ] **Step 2 : écrire le test qui échoue**

```ts
// @vitest-environment happy-dom
import { cn } from '@/lib/cn'

it('résout un conflit d utilitaire standard sans toucher aux jetons du projet', () => {
  expect(cn('px-4', 'px-2')).toBe('px-2')
  // tailwind-merge ne connaît pas nos jetons : il les laisse intacts.
  expect(cn('bg-accent', 'text-on-accent')).toBe('bg-accent text-on-accent')
})

it('donne au bouton une transition et un état survolé élevé', () => {
  render(<Button variant="primary">Enregistrer</Button>)
  const b = screen.getByRole('button')
  expect(b.className).toContain('transition')
  expect(b.className).toContain('duration-150')
})
```

- [ ] **Step 3 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/components/ui/controls.test.tsx`
Expected : FAIL — `@/lib/cn` n'existe pas.

- [ ] **Step 4 : écrire `src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compose des classes et résout les conflits d'utilitaires.
 *
 * Le besoin est réel et non théorique : chaque primitive concatène ses propres
 * classes avec celles de l'appelant en gabarit de chaîne. Un appelant qui passe
 * `px-2` à un `Button` portant déjà `px-4` produisait un résultat dépendant de
 * l'ordre d'insertion CSS.
 *
 * `tailwind-merge` ne connaît que les utilitaires standard. Nos jetons —
 * `bg-accent`, `text-on-accent`, `bg-cat-a` — lui sont inconnus et traversent
 * inchangés : aucune configuration n'est nécessaire, et aucun jeton ne peut
 * être écrasé par erreur.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5 : régler les échelles de matière dans `globals.css`**

```css
  /* Des rayons timides et une ombre indétectable produisent un plan, pas une
     interface. L'ombre est en trois couches : contact, diffusion, ambiante. */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --shadow-card:
    0 1px 2px color-mix(in srgb, var(--color-ink) 10%, transparent),
    0 6px 18px color-mix(in srgb, var(--color-ink) 8%, transparent),
    0 18px 40px color-mix(in srgb, var(--color-ink) 5%, transparent);
  --shadow-lift:
    0 2px 6px color-mix(in srgb, var(--color-ink) 12%, transparent),
    0 14px 34px color-mix(in srgb, var(--color-ink) 10%, transparent);
  --shadow-float: 0 12px 32px color-mix(in srgb, var(--color-ink) 22%, transparent);
```

Et, toujours dans `@layer base` :

```css
  /* Le mouvement sert la lecture ; il ne s'impose à personne. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }
```

- [ ] **Step 6 : appliquer aux primitives**

`Button` — remplacer la concaténation par `cn(...)` et ajouter la transition :

```tsx
className={cn(
  'touch-target inline-flex items-center justify-center gap-2 rounded-md px-4 text-sm font-medium',
  'transition-[background-color,color,box-shadow] duration-150',
  'disabled:opacity-60',
  VARIANTS[variant],
  className,
)}
```

`Card` : `shadow-card hover:shadow-lift transition-shadow duration-150`. `Field` : `transition-colors duration-150` sur l'input.

`Aplat` — donner de l'épaisseur à l'aplat, quelle que soit sa teinte :

```tsx
// Un voile de 8 % du haut vers le bas : assez pour que la case ait une
// épaisseur, pas assez pour évoquer un bouton de 2008. Il se pose sur la
// teinte quelle qu'elle soit — accent, prévisionnel ou catégorielle — donc
// `LineColor` n'a aucun champ à gagner.
className={cn(
  'pointer-events-none absolute inset-x-0 bottom-0',
  'bg-linear-to-b from-white/8 to-transparent',
  couleur.bg,
  DECOUPE[signature] ?? '',
)}
```

**Attention à l'ordre :** `couleur.bg` pose une `background-color`, le voile une
`background-image`. Les deux propriétés ne se recouvrent pas, `tailwind-merge`
ne les fusionne donc pas — le voile se superpose bien à la teinte.

- [ ] **Step 7 : lancer la suite complète**

Run : `npx vitest run`
Expected : les 2 échecs de baseline, et aucun autre.

- [ ] **Step 8 : commit**

```bash
git add package.json package-lock.json src/lib/cn.ts src/app/globals.css src/components/ui/
git commit -m "feat(design): sortir du plan — rayons, ombres, transitions"
```

---

## Task 6 : l'aplat suit le mode d'affichage

**Files:**
- Modify: `src/core/saisie/colors.ts`, `src/components/calendar/MonthCalendar.tsx`
- Test: `src/core/saisie/colors.test.ts`, `src/components/calendar/MonthCalendar.test.tsx`

**Interfaces:**
- Produces: `ACCENT_COLOR: LineColor` et `couleurDAplat(lineId: string, toutLeMois: boolean): LineColor` depuis `colors.ts`.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
it("n'attribue pas de teinte catégorielle quand il n'y a qu'une catégorie", () => {
  expect(couleurDAplat('ligne-1', false)).toBe(ACCENT_COLOR)
  expect(ACCENT_COLOR.bg).toBe('bg-accent')
})

it('rend la teinte catégorielle dès que plusieurs prestations coexistent', () => {
  expect(couleurDAplat('ligne-1', true)).toEqual(colorForLine('ligne-1'))
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/core/saisie/colors.test.ts`
Expected : FAIL — `couleurDAplat` n'existe pas.

- [ ] **Step 3 : écrire la règle**

```ts
/**
 * L'aplat de la prestation saisie quand elle est seule à l'écran.
 *
 * Une couleur catégorielle ne distingue rien s'il n'y a qu'une catégorie :
 * `MonthCalendar` appelait pourtant `colorForLine(line.id)` sans condition, et
 * la seule prestation affichée recevait une teinte tirée au hachage. C'est la
 * cause du « tout est saumon » constaté à l'écran, et c'est aussi pourquoi
 * l'unique couleur de l'application se trouvait affectée à l'information qui,
 * par construction, ne juge rien.
 */
export const ACCENT_COLOR: LineColor = {
  bg: 'bg-accent',
  text: 'text-on-accent',
  border: 'border-accent-dark',
}

export function couleurDAplat(lineId: string, toutLeMois: boolean): LineColor {
  return toutLeMois ? colorForLine(lineId) : ACCENT_COLOR
}
```

- [ ] **Step 4 : brancher `MonthCalendar`**

Remplacer `const couleur = colorForLine(line.id)` par `const couleur = couleurDAplat(line.id, toutLeMois)`. Les libellés des **autres** prestations gardent `colorForLine(a.id)` : elles ne sont rendues qu'en mode `toutLeMois`, où la teinte porte bien une information.

- [ ] **Step 5 : lancer les tests**

Run : `npx vitest run src/core/saisie/ src/components/calendar/`
Expected : PASS. **Les assertions de `MonthCalendar.test.tsx` qui attendent `bg-cat-*` en mode ligne unique changent de valeur attendue** — elles ne sont pas supprimées.

- [ ] **Step 6 : commit**

```bash
git add src/core/saisie/colors.ts src/core/saisie/colors.test.ts src/components/calendar/
git commit -m "fix(saisie): une teinte categorielle ne distingue rien quand il n y a qu une categorie"
```

---

## Task 7 : le prévisionnel prend sa teinte, partout

**Files:**
- Modify: `src/core/saisie/colors.ts`, `src/components/ui/SegmentLegend.tsx`, `src/components/calendar/MonthCalendar.tsx`, `src/components/grid/EngagementBar.tsx`
- Test: `src/components/ui/surfaces.test.tsx`, `src/components/calendar/MonthCalendar.test.tsx`

**Interfaces:**
- Consumes: `ACCENT_COLOR` de la tâche 6.
- Produces: `PREVU_COLOR: LineColor`. `SEGMENT_PREVU` devient `'bg-prevu'`.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
it('donne au prévisionnel une teinte opaque, pas une opacité', () => {
  expect(SEGMENT_PREVU).toBe('bg-prevu')
  expect(SEGMENT_PREVU).not.toContain('/')
})

it('dessine une case prévisionnelle en ambre et en tireté', () => {
  // ... rendu d'un mois portant une saisie PREVISIONNEL au 27
  const remplissage = screen.getByTestId('remplissage-2026-08-27')
  expect(remplissage.className).toContain('bg-prevu')
  expect(screen.getByTestId('case-2026-08-27').className).toContain('border-dashed')
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/components/ui/surfaces.test.tsx`
Expected : FAIL — `SEGMENT_PREVU` vaut `bg-accent/45 pattern-hatch`.

- [ ] **Step 3 : écrire la teinte du prévisionnel**

Dans `colors.ts` :

```ts
/**
 * L'aplat d'un jour prévisionnel. Le passé est froid, le futur est chaud :
 * le réalisé est acquis et refroidi, le prévisionnel est encore en mouvement.
 * Le contour tireté porte la même information sans la teinte.
 */
export const PREVU_COLOR: LineColor = {
  bg: 'bg-prevu',
  text: 'text-prevu-ink',
  border: 'border-prevu-edge',
}
```

- [ ] **Step 4 : mettre `SegmentLegend` à jour**

```ts
export const SEGMENT_REALISE = 'bg-accent'
// Une teinte opaque, et non plus `bg-accent/45 pattern-hatch` : l'opacité
// était un angle mort documenté du contrôle de contraste (1,32:1 sur sa
// piste). Le tireté remplace la hachure comme marqueur non chromatique.
export const SEGMENT_PREVU = 'bg-prevu'
export const SEGMENT_PREVU_BORDURE = 'border border-dashed border-prevu-edge'
```

- [ ] **Step 5 : brancher `MonthCalendar`**

La case choisit sa teinte selon `previsionnel` :

```tsx
const couleurDeLaCase = previsionnel ? PREVU_COLOR : couleur
```

et ajoute `border-dashed` à son `className` quand `previsionnel`. **L'horloge reste** : elle nomme l'état dans l'infobulle et le nom accessible, et un marqueur de plus ne coûte rien.

- [ ] **Step 6 : brancher `EngagementBar`** — le segment `prevu` porte `SEGMENT_PREVU`.

- [ ] **Step 7 : lancer la suite complète**

Run : `npx vitest run`
Expected : les 2 échecs de baseline. **Les assertions nommant `bg-accent/45` ou `pattern-hatch` changent de valeur attendue.**

- [ ] **Step 8 : commit**

```bash
git add src/core/saisie/colors.ts src/components/ui/SegmentLegend.tsx src/components/calendar/ src/components/grid/EngagementBar.tsx src/components/ui/surfaces.test.tsx
git commit -m "feat(saisie): le previsionnel est chaud, le realise est froid"
```

---

## Task 8 : cases carrées et plages fusionnées

**Files:**
- Create: `src/core/saisie/plage.ts`, `src/core/saisie/plage.test.ts`
- Modify: `src/components/calendar/MonthCalendar.tsx`
- Test: `src/components/calendar/MonthCalendar.test.tsx`

**Interfaces:**
- Produces: `type Position = 'SEULE' | 'DEBUT' | 'MILIEU' | 'FIN'` et `positionDansLaPlage(index: number, cles: readonly (string | null)[]): Position` depuis `src/core/saisie/plage.ts`. `cles[i]` est `null` quand le jour ne fusionne pas (vide, week-end, demi-journée, hors mois) ; deux jours fusionnent si leurs clés sont égales **et** s'ils sont dans la même semaine de sept colonnes.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
it('fusionne trois jours contigus au même état', () => {
  const cles = ['R', 'R', 'R', null, null, null, null]
  expect(positionDansLaPlage(0, cles)).toBe('DEBUT')
  expect(positionDansLaPlage(1, cles)).toBe('MILIEU')
  expect(positionDansLaPlage(2, cles)).toBe('FIN')
})

it('ne fusionne jamais deux états différents', () => {
  expect(positionDansLaPlage(1, ['R', 'P', 'P'])).toBe('DEBUT')
})

it('isole un jour qui ne fusionne pas', () => {
  expect(positionDansLaPlage(0, [null, 'R'])).toBe('SEULE')
  expect(positionDansLaPlage(1, ['R', 'R', null])).toBe('FIN')
})

it('ne franchit pas la fin de semaine de la grille', () => {
  // sept colonnes : l'indice 6 est un dimanche, l'indice 7 un lundi
  const cles = [null, null, null, null, null, null, 'R', 'R']
  expect(positionDansLaPlage(6, cles)).toBe('SEULE')
  expect(positionDansLaPlage(7, cles)).toBe('SEULE')
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/core/saisie/plage.test.ts`
Expected : FAIL — le module n'existe pas.

- [ ] **Step 3 : écrire la règle**

```ts
/** Nombre de colonnes de la grille mensuelle. Une plage ne le franchit pas. */
const COLONNES = 7

export type Position = 'SEULE' | 'DEBUT' | 'MILIEU' | 'FIN'

/**
 * Où se situe un jour dans sa suite de jours contigus au même état.
 *
 * Des jours contigus au même état sont **un seul fait** : un consultant ne
 * pense pas « lundi, mardi, mercredi » mais « j'étais chez eux toute la
 * semaine ». Les cases d'une suite fusionnent donc en un bloc.
 *
 * La règle vit ici et non dans le composant pour la même raison que
 * `formeDeLaCase` : elle est pure, et se vérifie sans monter une case à
 * l'écran.
 */
export function positionDansLaPlage(
  index: number,
  cles: readonly (string | null)[],
): Position {
  const cle = cles[index]
  if (cle === null || cle === undefined) return 'SEULE'

  const memeSemaine = (a: number, b: number) =>
    Math.floor(a / COLONNES) === Math.floor(b / COLONNES)

  const avant = index > 0 && memeSemaine(index - 1, index) && cles[index - 1] === cle
  const apres =
    index + 1 < cles.length && memeSemaine(index, index + 1) && cles[index + 1] === cle

  if (avant && apres) return 'MILIEU'
  if (avant) return 'FIN'
  if (apres) return 'DEBUT'
  return 'SEULE'
}
```

- [ ] **Step 4 : lancer le test et vérifier qu'il passe**

Run : `npx vitest run src/core/saisie/plage.test.ts`
Expected : PASS.

- [ ] **Step 5 : écrire le test du composant**

```ts
it('rend les cases carrées', () => {
  // ... rendu d'un mois
  expect(screen.getByTestId('case-2026-08-03').className).toContain('aspect-square')
})

it('supprime les filets intérieurs d une plage de trois jours pleins', () => {
  // 10, 11, 12 août portent chacun une journée entière
  expect(screen.getByTestId('case-2026-08-10').dataset.plage).toBe('DEBUT')
  expect(screen.getByTestId('case-2026-08-11').dataset.plage).toBe('MILIEU')
  expect(screen.getByTestId('case-2026-08-12').dataset.plage).toBe('FIN')
})

it('rompt la plage sur une demi-journée', () => {
  // 11 août en demi-journée entre deux journées entières
  expect(screen.getByTestId('case-2026-08-11').dataset.plage).toBe('SEULE')
})
```

- [ ] **Step 6 : brancher le composant**

Construire les clés depuis les jours affichés — `null` dès que la case ne fusionne pas :

```tsx
// Une plage ne réunit que des journées entières de même nature. Une
// demi-journée n'est pas le même fait que le jour d'à côté : elle garde ses
// quatre filets, son rayon et ses marges.
const clesDePlage = useMemo(
  () =>
    days.map((jour) => {
      if (etatJour(jour) !== 'ouvre') return null
      const etat = etatDe(jour.date)
      if (etat.kind !== 'JOURNEE') return null
      return previsionnelles.has(jour.date) ? 'PREVU' : 'REALISE'
    }),
  [days, etatDe, previsionnelles],
)
```

Et les classes de la case :

```tsx
// Aucune marge, aucune bordure retirée : seulement des rayons et des faces
// rendues transparentes. La boîte de la case est identique dans les quatre cas.
const PLAGE_CLASSES: Record<Position, string> = {
  SEULE: 'rounded-sm',
  DEBUT: 'rounded-l-sm rounded-r-none border-r-transparent',
  MILIEU: 'rounded-none border-x-transparent',
  FIN: 'rounded-r-sm rounded-l-none border-l-transparent',
}
```

**La fusion ne consomme aucune largeur — c'est la contrainte qui commande tout
le reste de cette tâche.**

À 375 px, la colonne vaut aujourd'hui `(375 − 2×24 − 6×2) / 7 = 45,0` points,
pour une cible de 44 : **il reste un point de marge**. Et le test qui le mesure
(`MonthCalendar.test.tsx`, « laisse à chaque case ses 44 points sur un écran de
375 ») ne compte que la gouttière déclarée par `gap-*` — **il ne voit pas les
marges d'une case**. Ajouter `mx-0.5` aux bouts de plage ferait tomber la
colonne réelle à 42,7 points **en laissant le test vert à 46,7**. C'est
exactement le faux test que ce projet a payé vingt fois.

**Donc : ni marge, ni gouttière modifiée, ni bordure retirée.** La grille garde
`gap-0.5`. La fusion se dessine par deux moyens qui n'occupent aucune place :

1. **La bordure devient transparente sur les faces intérieures** — `border-r-transparent`, jamais `border-r-0`. Une bordure transparente occupe toujours sa largeur : la boîte est strictement inchangée.
2. **L'aplat déborde la gouttière.** `Aplat` est posé en absolu et son propre commentaire dit qu'il « n'ajoute aucune largeur » : lui donner `-mr-0.5` sur un `DEBUT` ou un `MILIEU` le fait couvrir la gouttière et souder visuellement les deux cases, sans peser d'un point sur le budget des sept colonnes.

```tsx
const PLAGE_APLAT: Record<Position, string> = {
  SEULE: '',
  DEBUT: '-mr-0.5',
  MILIEU: '-mx-0.5',
  FIN: '-ml-0.5',
}
```

Le `className` de la case, qui empilait sept fragments conditionnels en gabarit
de chaîne, passe par `cn()` — c'est le site où le conflit d'utilitaires est le
plus probable, puisque `PLAGE_CLASSES` neutralise des bordures que la base vient
de poser :

```tsx
className={cn(
  'touch-target relative flex aspect-square flex-col items-center justify-center',
  'overflow-hidden text-sm tabular-nums transition-colors duration-150',
  FOND_JOUR[jourDit],
  aujourdhui ? 'border-2 border-ink' : 'border border-rule',
  previsionnel && 'border-dashed',
  etat.kind === 'LIBRE' && etat.eclatee && 'ring-1 ring-inset ring-warning-edge',
  remplie ? 'text-ink' : 'text-muted',
  previsionnel && 'italic',
  selected && 'ring-2 ring-inset ring-focus',
  PLAGE_CLASSES[position],
)}
```

`PLAGE_CLASSES` vient **en dernier** : c'est lui qui doit l'emporter sur les
bordures et les rayons posés plus haut. La case porte aussi `data-plage={position}`.
**La gouttière de la grille ne change pas** : elle reste `gap-0.5`, et c'est elle
qui laisse aux sept colonnes leurs 45,0 points.

- [ ] **Step 7 : vérifier le budget, puis le vérifier par mutation**

Run : `npx vitest run src/components/ui/touch-targets.test.tsx src/components/calendar/`
Expected : PASS — la colonne vaut toujours 45,0 points, la gouttière n'ayant pas bougé.

Puis la mutation qui prouve que ce test sert à quelque chose : remplacer
`gap-0.5` par `gap-2` sur la grille, relancer, **montrer que le test de budget
tombe** (la colonne descend à 40,7), restaurer immédiatement.

Et la mutation qui prouve que la fusion est bien dessinée : forcer
`PLAGE_CLASSES.MILIEU` à `''`, relancer, montrer que le test de plage tombe,
restaurer. **Si l'un des deux survit, le test ne protège rien et doit être
réécrit avant d'aller plus loin.**

- [ ] **Step 8 : commit**

```bash
git add src/core/saisie/plage.ts src/core/saisie/plage.test.ts src/components/calendar/
git commit -m "feat(calendrier): la plage, pas la case"
```

---

## Task 9 : les week-ends perdent leurs hachures

**Files:**
- Modify: `src/components/calendar/MonthCalendar.tsx`, `src/components/grid/MonthGrid.tsx`
- Test: `src/components/calendar/MonthCalendar.test.tsx`

- [ ] **Step 1 : écrire le test qui échoue**

```ts
it('distingue le week-end par la clarté, sans motif', () => {
  const c = screen.getByTestId('case-2026-08-08').className
  expect(c).toContain('bg-off')
  expect(c).not.toContain('pattern-stripes')
})

it('garde le motif sur les fériés, qui sont rares', () => {
  expect(screen.getByTestId('case-2026-08-15').className).toContain('pattern-dots')
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/components/calendar/MonthCalendar.test.tsx`
Expected : FAIL — la case du 8 porte `pattern-stripes`.

- [ ] **Step 3 : retirer la hachure du week-end**

```ts
// Le motif de dithering était le signal d'ancienneté le plus fort du dessin.
// Le contrat non chromatique tient sans lui : l'écart de clarté entre
// `surface`, `off` et `offStrong` (100 / 91,2 / 85,4 en L*) porte
// l'information, et `MIN_LIGHTNESS_GAP` le vérifie déjà.
//
// Le férié garde le sien : dix jours par an, une information plus forte, et un
// marqueur si rare ne fatigue personne.
const FOND_JOUR: Record<EtatJour, string> = {
  ouvre: 'bg-surface',
  weekend: 'bg-off',
  ferie: 'bg-off-strong pattern-dots',
}
```

Appliquer le même retrait dans `MonthGrid.tsx` si la constante y est dupliquée.

- [ ] **Step 4 : mettre la légende à jour** — l'échantillon « Jour non ouvré » ne montre plus de hachure.

- [ ] **Step 5 : lancer les tests**

Run : `npx vitest run src/components/`
Expected : PASS.

- [ ] **Step 6 : commit**

```bash
git add src/components/calendar/ src/components/grid/MonthGrid.tsx
git commit -m "feat(calendrier): l absence suffit a dire le week-end"
```

---

## Task 10 : les glyphes deviennent des icônes

**Files:**
- Create: `src/components/ui/icons.tsx`
- Modify: `src/components/ui/Badge.tsx`, `src/components/ui/Banner.tsx`, `src/components/calendar/MonthCalendar.tsx`, `package.json`
- Test: `src/components/ui/surfaces.test.tsx`

**Interfaces:**
- Produces: depuis `src/components/ui/icons.tsx` — `IconeSucces`, `IconeAvertissement`, `IconeDanger`, `IconeInfo`, `IconeOccupation`, `IconePrevisionnel`, et les icônes de rail `IconeSaisie`, `IconeCharge`, `IconeMissions`, `IconeCra`, `IconeReglages`. Chacune accepte `{ className?: string }` et porte `aria-hidden="true"`.

- [ ] **Step 1 : installer**

```bash
npm install lucide-react
```

- [ ] **Step 2 : écrire le test qui échoue**

```ts
it('rend un glyphe dessiné, pas un caractère de la police système', () => {
  render(<Banner tone="danger">Dépassement</Banner>)
  const svg = document.querySelector('[role="alert"] svg')
  expect(svg).not.toBeNull()
  expect(svg!.getAttribute('aria-hidden')).toBe('true')
  expect(screen.getByRole('alert').textContent).not.toContain('✕')
})
```

- [ ] **Step 3 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/components/ui/surfaces.test.tsx`
Expected : FAIL — le bandeau rend le caractère `✕`.

- [ ] **Step 4 : écrire `icons.tsx`**

```tsx
import {
  Check, TriangleAlert, X, Info, Diamond, Clock,
  CalendarDays, ChartNoAxesColumn, Briefcase, FileText, Settings,
} from 'lucide-react'

/**
 * Les icônes du système, en un seul point.
 *
 * Les états se distinguaient jusqu'ici par des caractères — `◆ ✓ ▲ ✕ ℹ` —
 * rendus dans la police système, chacun avec sa métrique et son alignement
 * propres. L'`Horloge` du prévisionnel montrait déjà le bon niveau : un tracé
 * dessiné, aux dimensions choisies.
 *
 * Toutes sont masquées aux lecteurs d'écran : le libellé, le `role` ou le nom
 * accessible de la case portent déjà l'information en toutes lettres.
 */
type Props = { className?: string }
const commun = { 'aria-hidden': true as const, strokeWidth: 2, size: 14 }

export const IconeSucces = ({ className }: Props) => <Check {...commun} className={className} />
export const IconeAvertissement = ({ className }: Props) => <TriangleAlert {...commun} className={className} />
export const IconeDanger = ({ className }: Props) => <X {...commun} className={className} />
export const IconeInfo = ({ className }: Props) => <Info {...commun} className={className} />
export const IconeOccupation = ({ className }: Props) => <Diamond {...commun} size={10} className={className} />
export const IconePrevisionnel = ({ className }: Props) => <Clock {...commun} size={10} className={className} />

export const IconeSaisie = ({ className }: Props) => <CalendarDays {...commun} size={16} className={className} />
export const IconeCharge = ({ className }: Props) => <ChartNoAxesColumn {...commun} size={16} className={className} />
export const IconeMissions = ({ className }: Props) => <Briefcase {...commun} size={16} className={className} />
export const IconeCra = ({ className }: Props) => <FileText {...commun} size={16} className={className} />
export const IconeReglages = ({ className }: Props) => <Settings {...commun} size={16} className={className} />
```

- [ ] **Step 5 : brancher `Badge` et `Banner`**

`Banner` remplace `GLYPHES` par un `Record<BannerTone, ComponentType<Props>>`. La prop `glyph` de `Badge` devient `icone: ComponentType<Props>` — **le contrat ne change pas** : il en reste toujours une, l'appelant peut la remplacer et jamais la supprimer.

`MonthCalendar` remplace `MARQUEUR_OCCUPATION` par `<IconeOccupation />` et son `Horloge` local par `IconePrevisionnel`. **Conserver `data-testid={\`previsionnel-${date}\`}`** — des tests s'y accrochent.

- [ ] **Step 6 : lancer la suite complète**

Run : `npx vitest run`
Expected : les 2 échecs de baseline. **Les assertions nommant `◆ ✓ ▲ ✕ ℹ` changent de forme** : elles vérifient désormais la présence d'un `svg`.

- [ ] **Step 7 : commit**

```bash
git add package.json package-lock.json src/components/ui/icons.tsx src/components/ui/Badge.tsx src/components/ui/Banner.tsx src/components/calendar/
git commit -m "feat(design): des icones dessinees, plus des caracteres de police systeme"
```

---

## Task 11 : le rail de navigation à deux groupes

**Files:**
- Create: `src/components/nav/NavRail.tsx`, `src/components/nav/NavRail.test.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Test: `src/app/(app)/layout.test.tsx`

**Interfaces:**
- Consumes: les icônes de la tâche 10.
- Produces: `<NavRail onSignOut={...} />`, composant client. Le `layout` reste serveur et lui passe l'action de déconnexion.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// @vitest-environment happy-dom
vi.mock('next/navigation', () => ({ usePathname: () => '/saisie/2026-08' }))

it('groupe le travail et les réglages, et les nomme', () => {
  render(<NavRail onSignOut={async () => {}} />)
  expect(screen.getByRole('navigation', { name: 'Travail' })).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'Réglages' })).toBeTruthy()
})

it('marque la page courante', () => {
  render(<NavRail onSignOut={async () => {}} />)
  expect(screen.getByRole('link', { name: /Saisie/ }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('link', { name: /Charge/ }).getAttribute('aria-current')).toBeNull()
})

it('nomme les réglages par ce qu ils contrôlent, pas par leur route', () => {
  render(<NavRail onSignOut={async () => {}} />)
  expect(screen.getByRole('link', { name: /Règles de saisie/ })).toBeTruthy()
  expect(screen.getByRole('link', { name: /Apparence/ })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Thème' })).toBeNull()
})

it('rend les réglages atteignables, dépliés comme repliés', () => {
  render(<NavRail onSignOut={async () => {}} />)
  const bascule = screen.getByRole('button', { name: /Réglages/ })
  expect(bascule.getAttribute('aria-expanded')).toBe('true')
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/components/nav/NavRail.test.tsx`
Expected : FAIL — le composant n'existe pas.

- [ ] **Step 3 : écrire le composant**

```tsx
'use client'

const TRAVAIL = [
  { href: '/saisie', label: 'Saisie', Icone: IconeSaisie },
  { href: '/charge', label: 'Charge', Icone: IconeCharge },
  { href: '/missions', label: 'Missions', Icone: IconeMissions },
  { href: '/cra', label: 'CRA', Icone: IconeCra },
]

/**
 * Les libellés nomment ce que la personne contrôle, jamais la route.
 * « Admin » pointait vers les règles de saisie, « Thème » vers l'apparence,
 * « Synchro » vers un écran de supervision.
 */
const REGLAGES = [
  { href: '/admin/saisie', label: 'Règles de saisie' },
  { href: '/admin/theme', label: 'Apparence' },
  { href: '/admin/dolibarr', label: 'Dolibarr' },
  { href: '/admin/google', label: 'Google' },
  { href: '/admin/sync', label: 'Synchro' },
  { href: '/admin/webhooks', label: 'Abonnements' },
  { href: '/admin/supervision', label: 'Supervision' },
]
```

**Sept écrans, pas quatre.** `src/app/(app)/admin/` contient `dolibarr`, `google`,
`saisie`, `supervision`, `sync`, `theme`, `webhooks`. `layout.test.tsx` **lit ce
dossier** et exige un lien par écran ; son commentaire vise nommément « un plan
[qui] a proposé de remplacer la liste des liens au lieu de l'étendre ». Ce lot
**étend** : il regroupe et renomme deux entrées, il n'en retire aucune.

**Deux libellés seulement changent**, et ce sont les deux qui nommaient la route
plutôt que ce que la personne contrôle : « Admin » → « Règles de saisie »,
« Thème » → « Apparence ». **`Synchro`, `Supervision`, `Abonnements` et
`Dolibarr` gardent leur nom exact** : quatre tests de `layout.test.tsx` les
cherchent par `getByRole('link', { name: … })`, et ces tests décrivent une
exigence réelle — sans le lien, l'écran n'est atteignable qu'en connaissant son URL.

**Le groupe est déplié par défaut et ses liens sont toujours dans le DOM.** Un
tiroir replié qui ne rendrait pas ses `<a>` ferait tomber le contrôle de couverture.

**La barre mobile ne rend aucun lien d'administration ni aucun lien de travail
en double.** Les quatre tests ci-dessus utilisent `getByRole` au singulier :
un lien rendu deux fois lève « found multiple elements ». La barre basse rend
donc les quatre entrées de travail **et le rail est masqué en dessous de `md`**
(`hidden md:flex`), jamais les deux à la fois. Le bouton « Réglages » de la barre
est un `<button>`, pas un lien.

L'état actif se lit par `usePathname()` et un préfixe : `/saisie/2026-08` active « Saisie ». Chaque lien actif porte `aria-current="page"`, un filet latéral et `font-medium` — **jamais la seule teinte** :

```tsx
<Link
  href={href}
  aria-current={actif ? 'page' : undefined}
  className={cn(
    'touch-target flex items-center gap-2 rounded-md px-3 text-sm',
    'border-l-2 transition-colors duration-150',
    actif
      ? 'border-l-accent bg-accent/10 font-medium text-accent'
      : 'border-l-transparent text-muted hover:bg-off hover:text-ink',
  )}
>
  <Icone />
  {label}
</Link>
```

Le groupe « Réglages » est un `<button aria-expanded>` suivi d'une liste. Aucun popover : un groupe qui se déplie n'en a pas besoin, et c'est plus accessible qu'un menu flottant.

Sur mobile (`md:hidden`), le rail devient une barre d'onglets basse à cinq entrées : les quatre du travail, plus « Réglages » qui ouvre la liste. Chaque entrée porte `touch-target`.

- [ ] **Step 4 : poser le rail dans le layout**

```tsx
<div className="min-h-screen md:flex">
  <NavRail onSignOut={handleSignOut} />
  <div className="min-w-0 flex-1 pb-20 md:pb-0">{children}</div>
</div>
```

Le `pb-20` réserve la hauteur de la barre basse sur mobile, sans quoi elle recouvre le bas du contenu.

- [ ] **Step 5 : vérifier qu'aucune entrée ne déborde à 375 px**

```ts
it('tient les cinq onglets dans 375 points', () => {
  // 5 entrées à 44 pt minimum = 220 pt, très en dessous de 375
  render(<NavRail onSignOut={async () => {}} />)
  const onglets = screen.getAllByTestId('onglet-mobile')
  expect(onglets).toHaveLength(5)
  for (const o of onglets) expect(o.className).toContain('touch-target')
})
```

- [ ] **Step 6 : lancer la suite complète**

Run : `npx vitest run`
Expected : les 2 échecs de baseline. **Les assertions de `layout.test.tsx` qui comptent huit liens à plat changent** — elles vérifient désormais deux groupes nommés.

- [ ] **Step 7 : commit**

```bash
git add src/components/nav/ src/app/\(app\)/layout.tsx src/app/\(app\)/layout.test.tsx
git commit -m "feat(nav): un rail a deux groupes, et quatre ecrans redeviennent atteignables au doigt"
```

---

## Task 12 : un seul gabarit de page

**Files:**
- Modify: `src/app/(app)/saisie/[month]/page.tsx`, `src/app/(app)/admin/theme/page.tsx`
- Test: `src/app/(app)/saisie/[month]/page.test.tsx`

- [ ] **Step 1 : écrire le test qui échoue**

```ts
it('rend la saisie dans le gabarit commun', async () => {
  render(await SaisiePage({ params: Promise.resolve({ month: '2026-08' }) }))
  expect(screen.getByRole('heading', { level: 1, name: 'Saisie' }).className).toContain('text-2xl')
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run "src/app/(app)/saisie/[month]/page.test.tsx"`
Expected : FAIL — le `h1` porte `text-xl font-semibold`.

- [ ] **Step 3 : appliquer `PageShell`**

Remplacer `<main className="p-6"><h1 className="mb-4 text-xl font-semibold">Saisie</h1>…</main>` par `<PageShell title="Saisie">…</PageShell>`. Faire de même sur `/admin/theme`, aujourd'hui en `max-w-3xl`.

- [ ] **Step 3 bis : réapprendre au test de budget où lire la marge**

**Sans cette étape, la tâche 12 casse la tâche 8.** Le test des sept colonnes ne
lit pas le DOM pour connaître la marge de page : il lit **la source de
`page.tsx`** avec `/<main className="p-(\d+)"/` puis déréférence
`.exec(...)![1]`. Retirer ce `<main>` fait lever le test sur un `null`, avec un
message qui ne dit rien de la cause.

Dans `src/components/calendar/MonthCalendar.test.tsx`, faire lire la marge à
`PageShell` — qui est désormais le seul endroit où elle est déclarée :

```ts
// La marge de la page de saisie, telle que le gabarit commun la déclare.
// Elle vivait dans `page.tsx` tant que cet écran portait son propre `<main>` ;
// depuis le lot 1g, tous les écrans passent par `PageShell`, et c'est lui qui
// fait foi. Lire ailleurs mesurerait un budget que personne n'applique.
const SHELL = readFileSync('src/components/ui/PageShell.tsx', 'utf8')
const MARGE = Number(/<main className="[^"]*\bp-(\d+)\b/.exec(SHELL)![1]!) * PAS
```

`PageShell` déclare `p-6`, la même valeur : **le budget reste à 45,0 points** et
aucune assertion ne change de valeur attendue — seule la source de lecture change.

- [ ] **Step 4 : lancer les tests, budget compris**

Run : `npx vitest run "src/app/(app)/" src/components/calendar/`
Expected : PASS — le test des sept colonnes inclus.

Mutation : porter `p-6` à `p-10` dans `PageShell`, relancer, **montrer que le
test de budget tombe** (la colonne descend à 40,4), restaurer immédiatement.
S'il survit, c'est que la lecture pointe encore sur un fichier qui ne fait plus foi.

- [ ] **Step 5 : commit**

```bash
git add "src/app/(app)/saisie/[month]/page.tsx" "src/app/(app)/admin/theme/page.tsx" "src/app/(app)/saisie/[month]/page.test.tsx"
git commit -m "refactor(ui): un seul gabarit, un seul bord gauche"
```

---

## Task 13 : la réglette du mois

**Files:**
- Modify: `src/components/grid/EngagementBar.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.tsx`
- Test: `src/components/grid/EngagementBar.test.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.test.tsx`

**Interfaces:**
- Consumes: `SEGMENT_REALISE` et `SEGMENT_PREVU` de la tâche 7.
- Produces: `EngagementBar` gagne `pleineLargeur?: boolean` (défaut `false`, ce qui préserve son rendu actuel dans la vue tableau).

- [ ] **Step 1 : écrire le test qui échoue**

```ts
it('pose la réglette sous le calendrier, en pleine largeur', () => {
  // ... rendu de SaisieClient en vue calendrier
  const reglette = screen.getByTestId('engagement-ligne-1')
  expect(reglette).toBeTruthy()
  expect(reglette.className).toContain('w-full')
})

it('ne change pas le calcul de l engagement', () => {
  render(<EngagementBar line={ligne} totals={totaux} pleineLargeur />)
  expect(screen.getByText(/120 vendus/)).toBeTruthy()
  expect(screen.getByText(/49,2 réalisés/)).toBeTruthy()
})
```

- [ ] **Step 2 : lancer le test et vérifier qu'il échoue**

Run : `npx vitest run src/components/grid/EngagementBar.test.tsx`
Expected : FAIL — la piste est en `w-40` fixe.

- [ ] **Step 3 : donner à la réglette sa pleine largeur**

La piste passe de `h-2 w-40` à `h-5 w-full` quand `pleineLargeur` — `cn()` résout le conflit de largeur et de hauteur sans qu'on ait à ordonner les fragments à la main :

```tsx
className={cn(
  'relative overflow-hidden rounded-sm border border-rule bg-off-strong',
  'h-2 w-40',
  pleineLargeur === true && 'h-5 w-full',
)}
```

Ajouter le trait d'aujourd'hui, positionné sur la fraction réalisée :

```tsx
{/* Le trait d'aujourd'hui : c'est là que passe la frontière entre le réalisé
    et le prévisionnel, et elle ne se lit pas sans repère. */}
<span aria-hidden="true" className="absolute -inset-y-1 w-0.5 bg-ink"
      style={{ left: `${pct(e.realiseCentiemes)}%` }} />
```

**Aucune ligne de `computeEngagement` ne change.** Le cumul reste sur toute la durée de la ligne, sous les facteurs figés à l'écriture — la règle du lot 1d n'est pas touchée.

- [ ] **Step 4 : la poser dans `SaisieClient`**

Sous le calendrier, dans la vue calendrier, à la largeur de la grille. La vue tableau garde sa barre compacte : `pleineLargeur` y reste à `false`.

- [ ] **Step 5 : lancer la suite complète**

Run : `npx vitest run`
Expected : les 2 échecs de baseline, et aucun autre.

- [ ] **Step 6 : vérifier à l'écran**

Le serveur du porteur tourne déjà. Ouvrir `/saisie/2026-08` en 1280 px puis en 375 px et vérifier : cases carrées, plages fusionnées, prévisionnel ambre, réglette pleine largeur sous la grille, rail replié sur mobile en barre basse. **Ne pas lancer `npx next build`.**

- [ ] **Step 7 : commit**

```bash
git add src/components/grid/EngagementBar.tsx src/components/grid/EngagementBar.test.tsx "src/app/(app)/saisie/[month]/"
git commit -m "feat(saisie): la reglette du mois, sous le calendrier"
```

---

## Porte de sortie du lot

- [ ] `npx vitest run` — **aucun échec au-delà des 2 de baseline du lot 3**
- [ ] `npx tsc --noEmit` — 0 erreur
- [ ] `design-system.test.ts` vert : aucune couleur en clair hors des deux fichiers exemptés
- [ ] `tokens.test.ts` vert : les 5 préréglages sans anomalie
- [ ] `touch-targets.test.tsx` vert : cibles à 44 pt et budget des sept colonnes
- [ ] Les 9 entrées de navigation atteignables à 375 px, déconnexion comprise
- [ ] Aucune migration Prisma dans le diff
- [ ] Revue adversariale, selon la méthode `ETAT.md` §6 — c'est elle qui a trouvé 5 défauts au lot 1e dans du code qui compilait et passait tous ses tests

## Ce qui reste hors de ce lot

- Le plan de charge à 12 colonnes dont 9 vides : question d'information, pas d'identité.
- Le doublon de sélection du mois (`← août 2026 →` puis un champ natif `août 2026`, à 8 px l'un de l'autre).
- Le total du mois dans la vue tableau, que la réglette ne couvre que côté calendrier.
