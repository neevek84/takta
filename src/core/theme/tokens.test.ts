import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { contrastRatio, relativeLuminance, AA_TEXT_RATIO, NON_TEXT_RATIO } from './contrast'
import {
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  THEME_KREATIVPM,
  THEME_CLAIR,
  THEME_SOMBRE,
  THEME_PRESETS,
  THEME_MODES,
  THEME_MODE_LABELS,
  DEFAULT_THEME,
  DEFAULT_THEME_CONFIG,
  TEXT_PAIRS,
  NON_TEXT_PAIRS,
  MIN_LIGHTNESS_GAP,
  FONDS_DE_TEXTE,
  ENCRES_ETAT,
  CATEGORY_BACKGROUNDS,
  DISTINCTION_PAIRS,
  MIN_CATEGORY_DISTANCE,
  colorDistance,
  lightness,
  chroma,
  findContrastIssues,
  findConfigIssues,
  describeContrastIssue,
  type ThemeTokens,
  type ContrastIssue,
  type SeparationIssue,
  type DistinctionIssue,
  type PolarityIssue,
  type ThemeIssue,
} from './tokens'

const contrastes = (issues: ThemeIssue[]): ContrastIssue[] =>
  issues.filter((i): i is ContrastIssue => i.kind === 'contraste')
const separations = (issues: ThemeIssue[]): SeparationIssue[] =>
  issues.filter((i): i is SeparationIssue => i.kind === 'separation')
const distinctions = (issues: ThemeIssue[]): DistinctionIssue[] =>
  issues.filter((i): i is DistinctionIssue => i.kind === 'distinction')
const polarites = (issues: ThemeIssue[]): PolarityIssue[] =>
  issues.filter((i): i is PolarityIssue => i.kind === 'polarite')

const PALETTES: ReadonlyArray<[string, ThemeTokens]> = [
  ['Clair', THEME_CLAIR],
  ['Sombre', THEME_SOMBRE],
  ['KreativPM', THEME_KREATIVPM],
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

  it('prend le clair pour défaut, la marque n’étant plus qu’un préréglage', () => {
    expect(DEFAULT_THEME).toEqual(THEME_CLAIR)
    expect(DEFAULT_THEME).not.toEqual(THEME_KREATIVPM)
  })

  it('expose les trois préréglages annoncés, chacun avec son versant', () => {
    expect(THEME_PRESETS.map((p) => [p.id, p.nature])).toEqual([
      ['CLAIR', 'clair'],
      ['SOMBRE', 'sombre'],
      ['KREATIVPM', 'clair'],
    ])
    expect(THEME_PRESETS[0]!.tokens).toEqual(THEME_CLAIR)
    expect(THEME_PRESETS[1]!.tokens).toEqual(THEME_SOMBRE)
    expect(THEME_PRESETS[2]!.tokens).toEqual(THEME_KREATIVPM)
  })

  // Le versant annoncé n'est pas une étiquette : c'est ce que `findConfigIssues`
  // contrôlera. Un préréglage rangé du mauvais côté serait refusé au moment
  // même où l'écran propose de l'appliquer.
  it('range chaque préréglage du côté que le contrôle lui donnerait', () => {
    for (const preset of THEME_PRESETS) {
      const clair = lightness(preset.tokens.page) > lightness(preset.tokens.ink)
      expect(clair, preset.id).toBe(preset.nature === 'clair')
    }
  })

  it('part de la préférence du système, avec les deux palettes livrées', () => {
    expect(DEFAULT_THEME_CONFIG).toEqual({
      mode: 'systeme',
      clair: THEME_CLAIR,
      sombre: THEME_SOMBRE,
    })
  })

  it('donne un libellé français à chacun des trois modes', () => {
    expect([...THEME_MODES]).toEqual(['systeme', 'clair', 'sombre'])
    for (const mode of THEME_MODES) expect(THEME_MODE_LABELS[mode]).toBeTruthy()
  })
})

// C'est le test que la spec réclame : il parcourt les couples texte/fond des
// jetons par défaut et échoue sous 4,5:1. Il empêche la dérive au fil des
// ajouts, y compris ceux des lots suivants.
// Assertion de contenu, pas de cardinal : un `toHaveLength` survit au
// remplacement d'un couple réel par un couple inoffensif, et laisse donc un
// couple sortir du garde-fou en silence. Chaque entrée ci-dessous est adossée
// à une classe rendue — voir le commentaire de `TEXT_PAIRS`.
const COUPLES_TEXTE_ATTENDUS = [
  'ink/page', 'ink/surface', 'ink/off', 'ink/offStrong',
  'muted/page', 'muted/surface', 'muted/off', 'muted/offStrong',
  'link/page', 'link/surface', 'link/off',
  'onAccent/accent', 'onDark/inkDeep',
  'successInk/success', 'successInk/successEdge', 'successInk/page', 'successInk/surface',
  'successInk/off', 'successInk/offStrong',
  'warningInk/warning', 'warningInk/warningEdge', 'warningInk/page', 'warningInk/surface',
  'warningInk/off', 'warningInk/offStrong',
  'dangerInk/danger', 'dangerInk/dangerEdge', 'dangerInk/page', 'dangerInk/surface',
  'dangerInk/off', 'dangerInk/offStrong',
  'infoInk/info', 'infoInk/infoEdge', 'infoInk/page', 'infoInk/surface',
  'catAInk/catA', 'catAInk/catAEdge',
  'catBInk/catB', 'catBInk/catBEdge',
  'catCInk/catC', 'catCInk/catCEdge',
  'catDInk/catD', 'catDInk/catDEdge',
  'catEInk/catE', 'catEInk/catEEdge',
  'catFInk/catF', 'catFInk/catFEdge',
]

const COUPLES_NON_TEXTUELS_ATTENDUS = [
  'focus/page', 'focus/surface', 'focus/off', 'focus/offStrong',
  'accentDark/page', 'accentDark/surface',
]

const nomme = (pairs: readonly { text: string; background: string }[]): string[] =>
  pairs.map((p) => `${p.text}/${p.background}`).sort()

describe('contraste des palettes livrées', () => {
  it('déclare exactement les couples texte/fond attendus', () => {
    expect(nomme(TEXT_PAIRS)).toEqual([...COUPLES_TEXTE_ATTENDUS].sort())
  })

  it('déclare exactement les couples non textuels attendus', () => {
    expect(nomme(NON_TEXT_PAIRS)).toEqual([...COUPLES_NON_TEXTUELS_ATTENDUS].sort())
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
    // Le pire couple texte de la palette KreativPM est `dangerInk` sur
    // `dangerEdge` : le libellé du bouton de suppression, au survol.
    expect(pire).toBeCloseTo(4.6717, 3)
  })

  it('garde une marge réelle sur les couples non textuels', () => {
    const pire = Math.min(
      ...NON_TEXT_PAIRS.map((p) =>
        contrastRatio(THEME_KREATIVPM[p.text], THEME_KREATIVPM[p.background]),
      ),
    )
    // `focus` sur `offStrong` : l'anneau de sélection sur une cellule fériée.
    expect(pire).toBeCloseTo(3.1803, 3)
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

  // Le couple n'est pas listé parce qu'aucune classe ne le rend : le bouton
  // plein *inverse* au survol au lieu d'assombrir. C'est le balayage de
  // `src/components` et `src/app` qui garde cette porte fermée — l'exiger ici
  // obligerait à éclaircir `accentDark` jusqu'à lui faire perdre son 3:1 sur
  // le crème, pour protéger un usage que l'interface n'a pas.
  it('n’est pas exigé sous une encre, faute d’être rendu — et il échouerait', () => {
    expect(
      TEXT_PAIRS.some((p) => p.text === 'onAccent' && p.background === 'accentDark'),
    ).toBe(false)
    expect(
      contrastRatio(THEME_KREATIVPM.onAccent, THEME_KREATIVPM.accentDark),
    ).toBeLessThan(AA_TEXT_RATIO)
    // L'inversion que le bouton plein applique à la place, elle, tient.
    expect(
      contrastRatio(THEME_KREATIVPM.onDark, THEME_KREATIVPM.inkDeep),
    ).toBeGreaterThanOrEqual(AA_TEXT_RATIO)
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
    const issues = contrastes(findContrastIssues(fautive))

    const surPage = issues.find((i) => i.text === 'ink' && i.background === 'page')
    expect(surPage).toBeDefined()
    expect(surPage!.ratio).toBeCloseTo(2.3866, 4)
    expect(surPage!.required).toBe(AA_TEXT_RATIO)
  })

  it('remonte tous les couples fautifs, pas seulement le premier', () => {
    // L'or en encre casse ses quatre fonds : page, surface, off, offStrong.
    const fautive: ThemeTokens = { ...THEME_KREATIVPM, ink: '#d4943f' }
    expect(contrastes(findContrastIssues(fautive)).filter((i) => i.text === 'ink')).toHaveLength(4)
  })

  it('contrôle aussi les couples non textuels, à 3:1', () => {
    const fautive: ThemeTokens = { ...THEME_KREATIVPM, focus: '#faf5ed' }
    const issue = contrastes(findContrastIssues(fautive)).find((i) => i.text === 'focus')
    expect(issue).toBeDefined()
    expect(issue!.required).toBe(NON_TEXT_RATIO)
  })

  // Les deux défauts que la palette livrée présentait avant ce correctif. Ils
  // ne relevaient d'aucune erreur de calcul : les couples n'étaient pas listés.
  it('voit l’anneau de focus posé sur une cellule fériée', () => {
    const fautive: ThemeTokens = { ...THEME_KREATIVPM, focus: '#b57730' }
    const issue = contrastes(findContrastIssues(fautive)).find(
      (i) => i.text === 'focus' && i.background === 'offStrong',
    )
    expect(issue).toBeDefined()
    expect(issue!.ratio).toBeCloseTo(2.7289, 4)
  })

})

describe('describeContrastIssue', () => {
  it('écrit un message français qui nomme le couple et le rapport', () => {
    const message = describeContrastIssue({
      kind: 'contraste',
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

  it('écrit un message français pour un défaut de séparation', () => {
    const message = describeContrastIssue({
      kind: 'separation',
      lighter: 'off',
      darker: 'offStrong',
      gap: 1.2,
      required: MIN_LIGHTNESS_GAP,
    })
    expect(message).toContain('fond des jours non ouvrés')
    expect(message).toContain('fond des jours fériés')
    expect(message).toContain('1,2')
    expect(message).toContain('4,0')
  })
})

// Aucune information n'est portée par la seule couleur : les trois fonds de
// cellule de la grille doivent rester distincts en vision monochrome.
describe('lisibilité monochrome des fonds de grille', () => {
  for (const [nom, palette] of PALETTES) {
    it(`${nom} : surface, off et offStrong se séparent en luminance`, () => {
      const l = {
        surface: lightness(palette.surface),
        off: lightness(palette.off),
        offStrong: lightness(palette.offStrong),
      }
      expect(l.surface - l.off).toBeGreaterThanOrEqual(MIN_LIGHTNESS_GAP)
      expect(l.off - l.offStrong).toBeGreaterThanOrEqual(MIN_LIGHTNESS_GAP)
    })
  }

  // L'invariant ne vaut que s'il barre la route à une palette enregistrée.
  // Le vérifier seulement ici le laisserait exiger des préréglages livrés ce
  // qu'aucun contrôle n'exige des palettes soumises par un administrateur.
  it('refuse une palette où les trois fonds se confondent', () => {
    const plate: ThemeTokens = { ...THEME_KREATIVPM, off: '#ffffff', offStrong: '#ffffff' }
    const defauts = separations(findContrastIssues(plate))
    expect(defauts.map((d) => `${d.lighter}/${d.darker}`)).toEqual([
      'surface/off',
      'off/offStrong',
    ])
    expect(defauts[0]!.gap).toBeCloseTo(0, 10)
  })

  it('refuse une palette où l’ordre des fonds est inversé', () => {
    // Un férié plus clair qu'un week-end : l'écart devient négatif.
    const inversee: ThemeTokens = {
      ...THEME_KREATIVPM,
      off: THEME_KREATIVPM.offStrong,
      offStrong: THEME_KREATIVPM.off,
    }
    const defauts = separations(findContrastIssues(inversee))
    expect(defauts.map((d) => `${d.lighter}/${d.darker}`)).toContain('off/offStrong')
    expect(defauts.find((d) => d.lighter === 'off')!.gap).toBeLessThan(0)
  })

  it('n’en signale aucun sur les palettes livrées', () => {
    for (const [nom, palette] of PALETTES) {
      expect(separations(findContrastIssues(palette)), nom).toEqual([])
    }
  })
})

/**
 * Le point délicat de la palette catégorielle : chaque teinte tient son
 * 4,5:1 sur son *propre* fond (`TEXT_PAIRS` ci-dessus), mais rien dans ce
 * calcul ne dit que les six fonds se distinguent *entre eux*. Deux teintes
 * peuvent chacune passer le contraste sur le crème tout en étant quasiment
 * identiques l'une à l'autre — c'est exactement le défaut `info`/`off` que
 * cette palette remplace (voir le commentaire de `LINE_COLORS` dans
 * `src/core/saisie/colors.ts`). `colorDistance` mesure cet écart en CIE76
 * (ΔE*ab), indépendant du contraste WCAG ; `MIN_CATEGORY_DISTANCE` en fixe le
 * seuil — voir le commentaire de la constante pour sa justification.
 */
describe('distinction de la palette catégorielle', () => {
  it('déclare exactement les six fonds catégoriels, dans l’ordre', () => {
    expect(CATEGORY_BACKGROUNDS).toEqual(['catA', 'catB', 'catC', 'catD', 'catE', 'catF'])
  })

  for (const [nom, palette] of PALETTES) {
    it(`${nom} : les six fonds se distinguent deux à deux (ΔE*ab ≥ ${MIN_CATEGORY_DISTANCE})`, () => {
      for (let i = 0; i + 1 < CATEGORY_BACKGROUNDS.length; i++) {
        for (let j = i + 1; j < CATEGORY_BACKGROUNDS.length; j++) {
          const a = CATEGORY_BACKGROUNDS[i]!
          const b = CATEGORY_BACKGROUNDS[j]!
          const distance = colorDistance(palette[a], palette[b])
          expect(distance, `${a}/${b}`).toBeGreaterThanOrEqual(MIN_CATEGORY_DISTANCE)
        }
      }
    })
  }

  it('garde une marge réelle, pas un passage de justesse', () => {
    // Sur *toutes* les paires dérivées, teintes contre fonds comprises — le
    // pire couple de la palette de la marque était justement là.
    const pires = new Map<string, number>()
    for (const [nom, palette] of PALETTES) {
      let pire = Infinity
      for (const { a, b } of DISTINCTION_PAIRS) {
        pire = Math.min(pire, colorDistance(palette[a], palette[b]))
      }
      pires.set(nom, Math.round(pire * 100) / 100)
    }
    expect(Object.fromEntries(pires)).toEqual({
      Clair: 27.05,
      Sombre: 19.59,
      KreativPM: 24.61,
    })
  })

  // Le soupçon du porteur, mis en calcul : les six teintes ont été étalonnées
  // dans une fenêtre chaude, sur un fond crème. Leur écart *deux à deux* ne
  // dépend pas du fond — c'est une distance entre deux teintes — et tient donc
  // à l'identique sur un fond neutre. Ce qui dépend du fond, et que rien ne
  // vérifiait, c'est l'écart entre une teinte et **la surface sur laquelle
  // elle est posée** : une cellule remplie en rose pâle sur un week-end gris
  // ne se lit plus comme remplie.
  for (const [nom, palette] of PALETTES) {
    it(`${nom} : chaque teinte se distingue aussi des fonds qui la portent`, () => {
      for (const cat of CATEGORY_BACKGROUNDS) {
        for (const fond of FONDS_DE_TEXTE) {
          const distance = colorDistance(palette[cat], palette[fond])
          expect(distance, `${cat} sur ${fond}`).toBeGreaterThanOrEqual(MIN_CATEGORY_DISTANCE)
        }
      }
    })
  }

  it('refuse une palette où deux teintes catégorielles se confondent', () => {
    // `catB` recopié sur `catA` : même fond, même bordure, même encre. La
    // preuve la plus directe qu'une palette peut être un jeu de mots — les
    // deux jetons existent, les deux tiennent 4,5:1 sur eux-mêmes — sans que
    // les prestations qui les portent ne se distinguent plus à l'écran.
    const fautive: ThemeTokens = {
      ...THEME_KREATIVPM,
      catB: THEME_KREATIVPM.catA,
      catBInk: THEME_KREATIVPM.catAInk,
      catBEdge: THEME_KREATIVPM.catAEdge,
    }
    const defauts = distinctions(findContrastIssues(fautive))
    const trouve = defauts.find(
      (d) => (d.a === 'catA' && d.b === 'catB') || (d.a === 'catB' && d.b === 'catA'),
    )
    expect(trouve, 'un défaut catA/catB').toBeDefined()
    expect(trouve!.distance).toBeCloseTo(0, 6)
    expect(trouve!.required).toBe(MIN_CATEGORY_DISTANCE)
  })

  it('nomme le couple fautif dans le message français', () => {
    const message = describeContrastIssue({
      kind: 'distinction',
      a: 'catA',
      b: 'catB',
      distance: 3.2,
      required: MIN_CATEGORY_DISTANCE,
    })
    expect(message).toContain('catégorie 1')
    expect(message).toContain('catégorie 2')
    expect(message).toContain('3,2')
    expect(message).toContain('15,0')
  })

  it('n’en signale aucun sur les palettes livrées', () => {
    for (const [nom, palette] of PALETTES) {
      expect(distinctions(findContrastIssues(palette)), nom).toEqual([])
    }
  })
})

/**
 * La liste des paires de distinction est **dérivée**, pas écrite. C'est la
 * leçon de la revue du lot 1e : la table des couples de contraste avait été
 * énumérée à la main, deux couples y manquaient, et rien ne le signalait. Les
 * tests ci-dessous vérifient la dérivation elle-même — pas seulement son
 * résultat sur les palettes du jour.
 */
describe('les paires de distinction se dérivent des deux listes', () => {
  it('couvre les six teintes deux à deux et chacune contre les quatre fonds', () => {
    const attendu = new Set<string>()
    for (let i = 0; i < CATEGORY_BACKGROUNDS.length; i++) {
      for (let j = i + 1; j < CATEGORY_BACKGROUNDS.length; j++) {
        attendu.add(`${CATEGORY_BACKGROUNDS[i]}/${CATEGORY_BACKGROUNDS[j]}`)
      }
    }
    for (const c of CATEGORY_BACKGROUNDS) for (const f of FONDS_DE_TEXTE) attendu.add(`${c}/${f}`)

    expect(new Set(DISTINCTION_PAIRS.map((p) => `${p.a}/${p.b}`))).toEqual(attendu)
    // 15 paires entre teintes, 24 teinte-contre-fond. Le cardinal est ici une
    // *conséquence* vérifiée, pas la promesse : l'assertion qui compte est
    // celle du contenu au-dessus.
    expect(DISTINCTION_PAIRS).toHaveLength(39)
  })

  it('n’exige jamais deux fonds de texte l’un de l’autre', () => {
    // `page` et `surface` sont voisins par construction dans les trois thèmes.
    // Les exiger à 15 rendrait toute palette livrable impossible.
    const fonds = new Set<string>(FONDS_DE_TEXTE)
    expect(DISTINCTION_PAIRS.filter((p) => fonds.has(p.a) && fonds.has(p.b))).toEqual([])
  })

  it('la paire qui manquait au lot 1e y figure bien', () => {
    const cles = new Set(DISTINCTION_PAIRS.map((p) => `${p.a}/${p.b}`))
    expect(cles.has('catF/off')).toBe(true)
    expect(cles.has('catC/offStrong')).toBe(true)
  })

  // La preuve que le défaut existait, et la mesure exacte de ce qu'il valait.
  // La palette catégorielle chaude du lot 1e, posée sur les fonds de la marque
  // *et* sur ceux d'un thème neutre : elle échoue des deux côtés. Le soupçon
  // « c'est peut-être mon thème d'entreprise » était fondé pour moitié — le
  // thème neutre livré en souffrait autant.
  const CHAUDES_1E = {
    catA: '#f29892', catB: '#f2b892', catC: '#f7e5bf',
    catD: '#f2e892', catE: '#f292b8', catF: '#f9e1e5',
  } as const

  it('mesure le défaut que la fenêtre chaude produisait, fond par fond', () => {
    const mesure = (fond: string, cat: keyof typeof CHAUDES_1E): number =>
      Math.round(colorDistance(CHAUDES_1E[cat], fond) * 10) / 10

    // Fonds de la marque.
    expect(mesure(THEME_KREATIVPM.off, 'catF')).toBe(10)
    expect(mesure(THEME_KREATIVPM.offStrong, 'catC')).toBe(12.5)
    // Fonds neutres : le même défaut, en pire sur les fériés.
    expect(mesure(THEME_CLAIR.offStrong, 'catF')).toBe(10.5)
  })

  it('l’écart deux à deux, lui, ne dépendait pas du fond — et tenait', () => {
    // Ce que le lot 1e vérifiait tenait vraiment ; c'est la question qui était
    // incomplète, pas la réponse. Une distance entre deux teintes est la même
    // sur crème et sur gris : le contrôle ne pouvait rien voir.
    let pire = Infinity
    const cles = Object.keys(CHAUDES_1E) as (keyof typeof CHAUDES_1E)[]
    for (let i = 0; i < cles.length; i++) {
      for (let j = i + 1; j < cles.length; j++) {
        pire = Math.min(pire, colorDistance(CHAUDES_1E[cles[i]!], CHAUDES_1E[cles[j]!]))
      }
    }
    expect(pire).toBeCloseTo(20.97, 1)
    expect(pire).toBeGreaterThanOrEqual(MIN_CATEGORY_DISTANCE)
  })

  it('refuse une teinte qui se confond avec le fond des week-ends', () => {
    const fautive: ThemeTokens = { ...THEME_CLAIR, catF: THEME_CLAIR.off }
    const trouve = distinctions(findContrastIssues(fautive)).find(
      (d) => d.a === 'catF' && d.b === 'off',
    )
    expect(trouve, 'un défaut catF/off').toBeDefined()
    expect(trouve!.distance).toBeCloseTo(0, 6)
  })
})

/**
 * Le changement de grandeur de l'étagement de la grille — luminance relative
 * (Y) au lot 1e, clarté CIE (L*) au lot 1f — n'est pas un assouplissement.
 * Ce bloc le démontre au lieu de l'affirmer.
 */
describe('l’étagement de la grille se mesure en clarté, pas en luminance', () => {
  it('est plus exigeant que l’ancien seuil dans le régime clair', () => {
    // Près du blanc, ΔL* = 4 vaut nettement plus que l'ancien ΔY = 0,05.
    const clair = '#f2f2f2'
    const juste = (() => {
      // le gris exactement 4 unités de L* sous `clair`
      let lo = 0
      let hi = 255
      for (let i = 0; i < 24; i++) {
        const m = Math.round((lo + hi) / 2)
        const hex = `#${m.toString(16).padStart(2, '0').repeat(3)}`
        if (lightness(hex) > lightness(clair) - 4) hi = m
        else lo = m
      }
      return `#${hi.toString(16).padStart(2, '0').repeat(3)}`
    })()
    expect(lightness(clair) - lightness(juste)).toBeCloseTo(4, 0)
    expect(relativeLuminance(clair) - relativeLuminance(juste)).toBeGreaterThan(0.05)
  })

  it('est atteignable dans le régime sombre, là où l’ancien ne l’était pas', () => {
    const l = (k: 'surface' | 'off' | 'offStrong'): number => lightness(THEME_SOMBRE[k])
    expect(l('surface') - l('off')).toBeGreaterThanOrEqual(MIN_LIGHTNESS_GAP)
    expect(l('off') - l('offStrong')).toBeGreaterThanOrEqual(MIN_LIGHTNESS_GAP)
    // Et l'ancien seuil, lui, était hors d'atteinte : trois fonds sombres ne
    // peuvent pas s'écarter de 0,05 en luminance relative.
    const y = (k: 'surface' | 'off' | 'offStrong'): number => relativeLuminance(THEME_SOMBRE[k])
    expect(y('surface') - y('off')).toBeLessThan(0.05)
  })

  it('refuse toujours une grille plate et une grille inversée', () => {
    const plate: ThemeTokens = { ...THEME_SOMBRE, off: THEME_SOMBRE.surface, offStrong: THEME_SOMBRE.surface }
    expect(separations(findContrastIssues(plate)).map((d) => `${d.lighter}/${d.darker}`)).toEqual([
      'surface/off',
      'off/offStrong',
    ])

    const inversee: ThemeTokens = {
      ...THEME_SOMBRE,
      off: THEME_SOMBRE.offStrong,
      offStrong: THEME_SOMBRE.off,
    }
    const defaut = separations(findContrastIssues(inversee)).find((d) => d.lighter === 'off')
    expect(defaut).toBeDefined()
    expect(defaut!.gap).toBeLessThan(0)
  })
})

/**
 * « Le sombre est construit, pas dérivé » est une décision de la spec. Une
 * décision qu'aucun test ne mesure n'est qu'un commentaire.
 */
describe('le thème sombre n’est pas une inversion du clair', () => {
  it('n’inverse pas les clartés jeton par jeton', () => {
    const inverses = THEME_TOKEN_KEYS.filter(
      (k) => Math.abs(lightness(THEME_SOMBRE[k]) - (100 - lightness(THEME_CLAIR[k]))) < 2,
    )
    // Une inversion pure les mettrait tous à moins de 2 unités. Il en reste
    // au plus une poignée, par coïncidence et non par construction.
    expect(inverses.length).toBeLessThan(THEME_TOKEN_KEYS.length / 4)
  })

  it('baisse la saturation des aplats catégoriels, comme la spec l’exige', () => {
    const moyenne = (t: ThemeTokens): number =>
      CATEGORY_BACKGROUNDS.reduce((s, k) => s + chroma(t[k]), 0) / CATEGORY_BACKGROUNDS.length
    // Une inversion de luminance conserve le chroma ; une construction le baisse.
    expect(moyenne(THEME_SOMBRE)).toBeLessThan(moyenne(THEME_CLAIR) * 0.75)
  })

  it('garde une encre en deçà du blanc pur', () => {
    expect(THEME_SOMBRE.ink).not.toBe('#ffffff')
    expect(lightness(THEME_SOMBRE.ink)).toBeLessThan(95)
  })
})

/**
 * Le contrôle d'une configuration complète : deux palettes, deux versants.
 */
describe('findConfigIssues', () => {
  it('ne trouve rien sur la configuration livrée', () => {
    expect(findConfigIssues(DEFAULT_THEME_CONFIG)).toEqual([])
  })

  it('accepte la marque dans l’emplacement clair', () => {
    expect(
      findConfigIssues({ ...DEFAULT_THEME_CONFIG, clair: THEME_KREATIVPM }),
    ).toEqual([])
  })

  it('dit dans laquelle des deux palettes le couple fautif se trouve', () => {
    const trouves = findConfigIssues({
      ...DEFAULT_THEME_CONFIG,
      sombre: { ...THEME_SOMBRE, ink: THEME_SOMBRE.page },
    })
    expect(trouves.length).toBeGreaterThan(0)
    expect(trouves.every((t) => t.palette === 'sombre')).toBe(true)
    expect(contrastes(trouves.map((t) => t.issue)).some((i) => i.text === 'ink')).toBe(true)
  })

  it('refuse une palette claire rangée dans l’emplacement sombre', () => {
    // Chaque couple y tient son contraste : sans contrôle de polarité, rien
    // ne s'y opposerait, et un poste en mode sombre recevrait un aplat blanc.
    const echangee = { mode: 'systeme', clair: THEME_CLAIR, sombre: THEME_CLAIR } as const
    const trouves = findConfigIssues(echangee)
    const polarite = polarites(trouves.map((t) => t.issue))
    expect(polarite).toHaveLength(1)
    expect(polarite[0]!.attendu).toBe('sombre')
    expect(findContrastIssues(THEME_CLAIR)).toEqual([])
  })

  it('refuse aussi une palette sombre rangée dans l’emplacement clair', () => {
    const trouves = findConfigIssues({ ...DEFAULT_THEME_CONFIG, clair: THEME_SOMBRE })
    expect(polarites(trouves.map((t) => t.issue)).map((p) => p.attendu)).toEqual(['clair'])
  })

  it('écrit le refus de polarité en français, en nommant le versant', () => {
    const message = describeContrastIssue({
      kind: 'polarite',
      attendu: 'sombre',
      pageLightness: 96.9,
      inkLightness: 13.2,
    })
    expect(message).toContain('sombre')
    expect(message).toContain('96,9')
    expect(message).toContain('13,2')
  })
})

/**
 * Le filet qui relie la liste à l'interface. Sans lui, `TEXT_PAIRS` est une
 * énumération écrite à la main, et redevient incomplète au prochain écran :
 * c'est ainsi que l'anneau de focus sur les fériés, l'or assombri sous son
 * encre et deux fonds de survol sont sortis du garde-fou sans qu'un test tombe.
 *
 * Portée : le balayage rapproche les classes `text-*` et `bg-*` posées dans un
 * **même littéral de chaîne** — un variant de bouton, une tonalité de bandeau,
 * un `className` d'une seule pièce. Il ne remonte pas un fond hérité d'un
 * ancêtre ou tenu dans une variable (`FOND_JOUR` de la grille, par exemple) :
 * c'est un filet, pas une preuve. Le contrôle par jeton qui suit couvre en
 * partie cet angle mort, en exigeant que toute encre et tout fond de texte
 * employés quelque part figurent dans la liste.
 *
 * Angle mort refermé pour partie : une encre posée **seule** — sans `bg-*`
 * dans le même littéral — hérite du fond de son parent, et le balayage ci-
 * dessus ne formait alors aucun couple. C'est ainsi que `warningInk` sur
 * `off`/`offStrong` (`ChargeTable`, `EngagementBar`) est resté hors du filet.
 * Pour `ENCRES_ETAT` — les quatre encres pensées pour signaler un état
 * n'importe où dans l'interface, sans chrome dédié qui porterait toujours son
 * propre fond — une encre trouvée sans fond est confrontée aux quatre
 * `FONDS_DE_TEXTE` plutôt que de ne former aucun couple.
 *
 * Ce que ce filet-là ne couvre toujours pas :
 * - une encre d'état héritant d'un fond hors de `FONDS_DE_TEXTE` (un
 *   `warningInk` bare glissé dans un `bg-danger`, par exemple) : le fond de
 *   remplacement suppose l'un des quatre fonds de texte courants, pas un fond
 *   d'état voisin ;
 * - `ink`, `muted`, `link`, `onAccent`, `onDark` posés seuls : `ink`/`muted`
 *   sont déjà exigées sur les quatre `FONDS_DE_TEXTE` par construction, mais
 *   `link` en particulier reste hors filet — son unique fond manquant,
 *   `offStrong`, échoue à 4,28:1 sur KreativPM, et l'exiger malgré son
 *   invariant documenté (aucune classe ne le rend sur les fériés)
 *   assombrirait un jeton pour un usage que l'interface ne produit pas ;
 * - un composant futur qui poserait une nouvelle encre d'état seule sur un
 *   cinquième fond non listé ici (`accentDark`, par exemple) resterait
 *   silencieux tant que ce fond n'a pas d'usage en `text-*` ailleurs, faute
 *   d'appartenir à `FONDS_DE_TEXTE`.
 */
const RACINES_BALAYEES = ['src/components', 'src/app']

/**
 * Faux couples produits par le produit cartésien : le survol du bouton plein
 * remplace *à la fois* le fond et l'encre, si bien que les quatre classes
 * cohabitent dans la même chaîne sans jamais cohabiter à l'écran.
 */
const COUPLES_JAMAIS_SIMULTANES = ['onAccent/inkDeep', 'onDark/accent']

function fichiersRendus(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...fichiersRendus(p))
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p)
  }
  return out
}

interface UsageJetons {
  couples: Map<string, string>
  encres: Map<keyof ThemeTokens, string>
  fonds: Map<keyof ThemeTokens, string>
}

// `racines` accepte des chemins absolus (le test de mutation ci-dessous y
// pointe un dossier temporaire) aussi bien que les chemins relatifs au dépôt
// utilisés par défaut — `join(process.cwd(), racine)` laisserait passer un
// chemin déjà absolu tel quel, mais ne le résoudrait pas correctement.
function releverUsages(racines: readonly string[] = RACINES_BALAYEES): UsageJetons {
  const parClasse = new Map<string, keyof ThemeTokens>(
    THEME_TOKEN_KEYS.map((k) => [k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), k]),
  )
  // Alternance du plus long au plus court : `off-strong` avant `off`.
  const alternance = [...parClasse.keys()].sort((a, b) => b.length - a.length).join('|')
  // Le `/` exclu en fin de classe écarte les opacités (`bg-accent/45`), qui
  // ne sont pas des couleurs opaques et échappent par nature à ce contrôle.
  const motif = new RegExp(`(?:^|[\\s:])(text|bg)-(${alternance})(?![a-z0-9-/])`, 'g')
  const encresEtat = new Set<keyof ThemeTokens>(ENCRES_ETAT)

  const usages: UsageJetons = { couples: new Map(), encres: new Map(), fonds: new Map() }

  for (const racine of racines) {
    const dossier = isAbsolute(racine) ? racine : join(process.cwd(), racine)
    for (const fichier of fichiersRendus(dossier)) {
      const contenu = readFileSync(fichier, 'utf8')
      // Découpage aux frontières de littéraux et d'interpolations : ce qui
      // reste est une suite ininterrompue de classes.
      for (const morceau of contenu.split(/[`'"\n]|\$\{|\}/)) {
        const encres: (keyof ThemeTokens)[] = []
        const fonds: (keyof ThemeTokens)[] = []
        for (const m of morceau.matchAll(motif)) {
          const jeton = parClasse.get(m[2]!)!
          ;(m[1] === 'text' ? encres : fonds).push(jeton)
        }
        for (const e of encres) if (!usages.encres.has(e)) usages.encres.set(e, racine)
        for (const f of fonds) if (!usages.fonds.has(f)) usages.fonds.set(f, racine)

        if (fonds.length > 0) {
          for (const e of encres) {
            for (const f of fonds) {
              const cle = `${e}/${f}`
              if (!usages.couples.has(cle)) usages.couples.set(cle, fichier)
            }
          }
        } else {
          // Angle mort : une encre posée seule hérite du fond de son parent,
          // et ce littéral n'en dit rien. Pour les encres d'état, on la
          // confronte aux quatre fonds de texte possibles plutôt que de ne
          // former aucun couple — voir le commentaire au-dessus de cette
          // fonction pour ce que cela ne couvre toujours pas.
          for (const e of encres) {
            if (!encresEtat.has(e)) continue
            for (const f of FONDS_DE_TEXTE) {
              const cle = `${e}/${f}`
              if (!usages.couples.has(cle)) usages.couples.set(cle, fichier)
            }
          }
        }
      }
    }
  }

  return usages
}

describe('la liste des couples suit ce que l’interface rend', () => {
  const usages = releverUsages()

  it('balaie bien des composants — sinon le filet serait vide', () => {
    expect(usages.couples.size).toBeGreaterThan(8)
  })

  it('ne rend aucun couple texte/fond absent de TEXT_PAIRS', () => {
    const listes = new Set(nomme(TEXT_PAIRS))
    const orphelins = [...usages.couples]
      .filter(([cle]) => !listes.has(cle) && !COUPLES_JAMAIS_SIMULTANES.includes(cle))
      .map(([cle, fichier]) => `${cle} (${fichier})`)
    expect(orphelins).toEqual([])
  })

  it('ne pose aucune encre dont TEXT_PAIRS ne parle pas', () => {
    const encres = new Set(TEXT_PAIRS.map((p) => p.text))
    expect([...usages.encres.keys()].filter((k) => !encres.has(k))).toEqual([])
  })

  it('ne pose aucun fond de texte dont TEXT_PAIRS ne parle pas', () => {
    const fonds = new Set(TEXT_PAIRS.map((p) => p.background))
    expect([...usages.fonds.keys()].filter((k) => !fonds.has(k))).toEqual([])
  })
})

/**
 * Preuve de la brèche et de son correctif, isolée du dépôt réel : un dossier
 * temporaire porte un unique composant posant `text-info-ink` seul, sans
 * `bg-*` dans le même littéral — exactement la forme de `ChargeTable.tsx` et
 * `EngagementBar.tsx` avec `warningInk`. `infoInk` est choisi ici parce que
 * ses couples sur `off`/`offStrong` ne sont délibérément pas dans TEXT_PAIRS
 * (aucune classe réelle ne les rend) : le test peut donc affirmer, sans
 * ambiguïté, que l'ancien algorithme ne voyait rien là où le nouveau détecte
 * deux couples précis.
 */
describe('l’angle mort d’une encre posée sans fond', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tokens-scan-'))
    writeFileSync(
      join(dir, 'Fixture.tsx'),
      'export function Fixture() {\n  return <span className="text-info-ink">dépassement</span>\n}\n',
    )
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('l’ancien algorithme — encres et fonds du seul littéral — ne formait aucun couple', () => {
    const parClasse = new Map<string, keyof ThemeTokens>(
      THEME_TOKEN_KEYS.map((k) => [k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), k]),
    )
    const alternance = [...parClasse.keys()].sort((a, b) => b.length - a.length).join('|')
    const motif = new RegExp(`(?:^|[\\s:])(text|bg)-(${alternance})(?![a-z0-9-/])`, 'g')
    const couples = new Set<string>()
    for (const fichier of fichiersRendus(dir)) {
      const contenu = readFileSync(fichier, 'utf8')
      for (const morceau of contenu.split(/[`'"\n]|\$\{|\}/)) {
        const encres: (keyof ThemeTokens)[] = []
        const fonds: (keyof ThemeTokens)[] = []
        for (const m of morceau.matchAll(motif)) {
          const jeton = parClasse.get(m[2]!)!
          ;(m[1] === 'text' ? encres : fonds).push(jeton)
        }
        for (const e of encres) for (const f of fonds) couples.add(`${e}/${f}`)
      }
    }
    expect(couples.size).toBe(0)
  })

  it('le balayage actuel confronte l’encre isolée aux quatre fonds de texte', () => {
    const usages = releverUsages([dir])
    expect(usages.couples.has('infoInk/off')).toBe(true)
    expect(usages.couples.has('infoInk/offStrong')).toBe(true)
    expect(usages.couples.has('infoInk/page')).toBe(true)
    expect(usages.couples.has('infoInk/surface')).toBe(true)
  })

  it('ces deux couples seraient bien remontés comme orphelins par TEXT_PAIRS', () => {
    const listes = new Set(nomme(TEXT_PAIRS))
    expect(listes.has('infoInk/off')).toBe(false)
    expect(listes.has('infoInk/offStrong')).toBe(false)
  })
})
