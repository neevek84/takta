import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
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
  MIN_LUMINANCE_GAP,
  FONDS_DE_TEXTE,
  ENCRES_ETAT,
  CATEGORY_BACKGROUNDS,
  MIN_CATEGORY_DISTANCE,
  colorDistance,
  findContrastIssues,
  describeContrastIssue,
  type ThemeTokens,
  type ContrastIssue,
  type SeparationIssue,
  type DistinctionIssue,
  type ThemeIssue,
} from './tokens'

const contrastes = (issues: ThemeIssue[]): ContrastIssue[] =>
  issues.filter((i): i is ContrastIssue => i.kind === 'contraste')
const separations = (issues: ThemeIssue[]): SeparationIssue[] =>
  issues.filter((i): i is SeparationIssue => i.kind === 'separation')
const distinctions = (issues: ThemeIssue[]): DistinctionIssue[] =>
  issues.filter((i): i is DistinctionIssue => i.kind === 'distinction')

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
      gap: 0.012,
      required: MIN_LUMINANCE_GAP,
    })
    expect(message).toContain('fond des jours non ouvrés')
    expect(message).toContain('fond des jours fériés')
    expect(message).toContain('0,012')
    expect(message).toContain('0,050')
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
      expect(l.surface - l.off).toBeGreaterThanOrEqual(MIN_LUMINANCE_GAP)
      expect(l.off - l.offStrong).toBeGreaterThanOrEqual(MIN_LUMINANCE_GAP)
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
    let pire = Infinity
    for (let i = 0; i + 1 < CATEGORY_BACKGROUNDS.length; i++) {
      for (let j = i + 1; j < CATEGORY_BACKGROUNDS.length; j++) {
        const a = CATEGORY_BACKGROUNDS[i]!
        const b = CATEGORY_BACKGROUNDS[j]!
        pire = Math.min(pire, colorDistance(THEME_KREATIVPM[a], THEME_KREATIVPM[b]))
      }
    }
    // Le pire couple est `catA`/`catB` — corail contre abricot, les deux
    // teintes les plus proches en teinte de la famille chaude retenue.
    expect(pire).toBeCloseTo(20.97, 1)
  })

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
