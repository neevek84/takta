import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'


// Reprise du thème au lot 1g — donner l'identité « Encre » aux installations
// existantes qui n'ont jamais choisi leur palette.
//
// Pourquoi ce script existe. Le thème est **persisté** depuis le lot 1e, et une
// palette enregistrée l'emporte sur le défaut livré : c'est ce qui permet à un
// exploitant de garder la sienne à travers les montées de version. Conséquence
// directe : changer `DEFAULT_THEME_CONFIG` ne change rien pour une base
// existante. Sans ce script, le lot 1g livre son identité aux seules bases
// vierges, et toutes les autres gardent le châssis gris d'avant sous les aplats
// teal et ambre du lot — un hybride qui n'est ni l'ancien thème ni le nouveau.
//
// Ce qu'il ne fait pas, et c'est le point : il n'écrase **jamais** une palette
// choisie. Le préréglage KreativPM, une teinte retouchée à la main, un seul
// jeton qui diffère — tout cela est une décision, et l'écraser au nom d'une
// identité produit serait pire que le défaut réparé. Il ne remplace que la
// palette neutre livrée par défaut jusqu'au lot 1f, restée telle quelle.
//
// La règle est celle de `verdictDeReprise` (src/core/theme/reprise.ts),
// recopiée ici parce qu'un script ESM ne peut pas importer du TypeScript sans
// outillage — même contrainte que `backfill-heures-saisies.mjs`. Les palettes
// historiques, elles, ne sont pas recopiées : elles sont lues dans le JSON que
// le module consomme aussi. Seules les deux palettes d'arrivée restent des
// copies, et `src/core/theme/reprise-script.test.ts` les confronte aux jetons
// vivants : elles ne peuvent pas dériver en silence.
//
// Idempotent : relancé, il ne fait rien. Il n'écrit qu'une fois.




/**
 * Les défauts historiques sont **lus**, jamais recopiés : le même fichier sert
 * au module `src/core/theme/reprise.ts`. C'est du JSON précisément pour qu'un
 * script ESM puisse le consommer sans outillage, là où il ne peut pas importer
 * du TypeScript — la recopie qu'imposait `backfill-heures-saisies.mjs` n'a donc
 * pas lieu d'être ici, et aucune dérive n'est possible sur ces trois palettes.
 */
const ICI = dirname(fileURLToPath(import.meta.url))
const historiques = JSON.parse(
  readFileSync(join(ICI, '..', 'src', 'core', 'theme', 'palettes-historiques.json'), 'utf8'),
)
const NEUTRE_LOT_1E = historiques.neutreLot1e
const NEUTRE_AVANT_1G_CLAIR = historiques.neutreAvant1gClair
const NEUTRE_AVANT_1G_SOMBRE = historiques.neutreAvant1gSombre

/** La palette d'arrivée : Encre, les deux versants. */
const ENCRE_CLAIR = {
  "page": "#eaf2ef",
  "surface": "#ffffff",
  "off": "#dbe8e3",
  "offStrong": "#c8dad4",
  "ink": "#12211d",
  "inkDeep": "#0a1512",
  "muted": "#485853",
  "onAccent": "#031c18",
  "onDark": "#eaf2ef",
  "accent": "#0e9480",
  "accentDark": "#0b7566",
  "link": "#0a6355",
  "rule": "#aec5bd",
  "focus": "#0b7566",
  "saisie": "#51c9b2",
  "success": "#dff0e2",
  "successInk": "#1e5232",
  "successEdge": "#98c9a8",
  "warning": "#fbecd0",
  "warningInk": "#6b4708",
  "warningEdge": "#e5bf72",
  "danger": "#fbe3dc",
  "dangerInk": "#7f2c17",
  "dangerEdge": "#e8a894",
  "info": "#dfebef",
  "infoInk": "#24454f",
  "infoEdge": "#aac6ce",
  "prevu": "#f2b544",
  "prevuInk": "#4a2f05",
  "prevuEdge": "#7c5500",
  "catA": "#fc9b9f",
  "catAInk": "#502d2f",
  "catAEdge": "#e98c90",
  "catB": "#d8b06f",
  "catBInk": "#43351d",
  "catBEdge": "#c6a062",
  "catC": "#8cc487",
  "catCInk": "#283c26",
  "catCEdge": "#7eb378",
  "catD": "#2cc9cd",
  "catDInk": "#033e3f",
  "catDEdge": "#12b8bc",
  "catE": "#6dbdfc",
  "catEInk": "#1c3950",
  "catEEdge": "#5eade9",
  "catF": "#d7a4e4",
  "catFInk": "#433048",
  "catFEdge": "#c695d2"
}

const ENCRE_SOMBRE = {
  "page": "#121a18",
  "surface": "#1e2a27",
  "off": "#111917",
  "offStrong": "#050807",
  "ink": "#e2ece9",
  "inkDeep": "#060a09",
  "muted": "#9fb0ab",
  "onAccent": "#04211c",
  "onDark": "#e2ece9",
  "accent": "#3fc9b0",
  "accentDark": "#2ba792",
  "link": "#5fd8c0",
  "rule": "#33443f",
  "focus": "#5fd8c0",
  "saisie": "#1f6458",
  "success": "#14291c",
  "successInk": "#86d09a",
  "successEdge": "#294733",
  "warning": "#2b2513",
  "warningInk": "#e0bf6e",
  "warningEdge": "#4b3e1c",
  "danger": "#2c1b16",
  "dangerInk": "#f0a189",
  "dangerEdge": "#4e2f25",
  "info": "#16242a",
  "infoInk": "#a2c7d0",
  "infoEdge": "#2d454e",
  "prevu": "#7c4f2c",
  "prevuInk": "#f3e3cf",
  "prevuEdge": "#dcaf64",
  "catA": "#804a4d",
  "catAInk": "#fedede",
  "catAEdge": "#905558",
  "catB": "#6c5632",
  "catBInk": "#f3e3cf",
  "catBEdge": "#7a623a",
  "catC": "#42613f",
  "catCInk": "#d9ead6",
  "catCEdge": "#4c6e49",
  "catD": "#046466",
  "catDInk": "#c9eced",
  "catDEdge": "#0a7174",
  "catE": "#305d80",
  "catEInk": "#d5e7fc",
  "catEEdge": "#386a90",
  "catF": "#6c5073",
  "catFInk": "#f1e0f4",
  "catFEdge": "#7a5b82"
}

const MODES = ['systeme', 'clair', 'sombre']

/**
 * La comparaison porte sur les clés de la **référence**, jamais sur celles du
 * stocké : une base d'avant le lot 1g ne porte ni `prevu` ni `saisie`.
 */
function estLaPalette(stocke, reference) {
  if (typeof stocke !== 'object' || stocke === null) return false
  for (const [cle, valeur] of Object.entries(reference)) {
    const trouve = stocke[cle]
    if (typeof trouve !== 'string' || trouve.toLowerCase() !== valeur) return false
  }
  return true
}

function verdictDeReprise(brut) {
  if (typeof brut !== 'object' || brut === null) {
    return { kind: 'DEJA_A_JOUR', raison: 'colonne vide ou illisible' }
  }
  if (Object.keys(brut).length === 0) {
    return { kind: 'DEJA_A_JOUR', raison: 'colonne vide' }
  }

  const aDeuxVersants =
    typeof brut.clair === 'object' && brut.clair !== null &&
    typeof brut.sombre === 'object' && brut.sombre !== null

  if (aDeuxVersants) {
    if (estLaPalette(brut.clair, ENCRE_CLAIR) && estLaPalette(brut.sombre, ENCRE_SOMBRE)) {
      return { kind: 'DEJA_A_JOUR', raison: 'la palette enregistrée est déjà Encre' }
    }
    if (
      (estLaPalette(brut.clair, NEUTRE_AVANT_1G_CLAIR) ||
        estLaPalette(brut.clair, NEUTRE_LOT_1E)) &&
      estLaPalette(brut.sombre, NEUTRE_AVANT_1G_SOMBRE)
    ) {
      return { kind: 'REPRISE', mode: MODES.includes(brut.mode) ? brut.mode : 'systeme' }
    }
    return { kind: 'PERSONNALISE', raison: 'au moins un jeton diffère du défaut neutre' }
  }

  if (estLaPalette(brut, ENCRE_CLAIR)) {
    return { kind: 'DEJA_A_JOUR', raison: 'la palette enregistrée est déjà Encre' }
  }
  if (estLaPalette(brut, NEUTRE_AVANT_1G_CLAIR) || estLaPalette(brut, NEUTRE_LOT_1E)) {
    return { kind: 'REPRISE', mode: 'systeme' }
  }
  return { kind: 'PERSONNALISE', raison: 'palette du lot 1e différente du défaut neutre' }
}

const prisma = new PrismaClient()
// `select` explicite, et non la ligne entière : ce script ne lit qu'une
// colonne, et une reprise de thème n'a aucune raison d'échouer parce qu'une
// migration sans rapport n'a pas encore été appliquée.
const settings = await prisma.settings.findUnique({
  where: { id: 'singleton' },
  select: { themeJson: true },
})

if (settings === null) {
  console.log('Aucun réglage enregistré : rien à reprendre, la base rendra Encre par défaut.')
} else {
  let brut
  try {
    brut = JSON.parse(settings.themeJson)
  } catch {
    brut = null
  }

  const verdict = verdictDeReprise(brut)

  if (verdict.kind === 'REPRISE') {
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: {
        themeJson: JSON.stringify({
          mode: verdict.mode,
          clair: ENCRE_CLAIR,
          sombre: ENCRE_SOMBRE,
        }),
      },
      // `select` ici aussi : sans lui, Prisma relit la ligne entière après
      // l'écriture et la reprise échoue sur une colonne sans aucun rapport.
      select: { themeJson: true },
    })
    console.log(`Thème repris : la palette neutre livrée jusqu'au lot 1f devient Encre.`)
    console.log(`Mode conservé : ${verdict.mode}.`)
  } else if (verdict.kind === 'PERSONNALISE') {
    console.log(`Palette laissée intacte — ${verdict.raison}.`)
    console.log(`Pour passer à Encre malgré tout : Réglages > Apparence > préréglage « Encre clair ».`)
  } else {
    console.log(`Rien à faire — ${verdict.raison}.`)
  }
}

await prisma.$disconnect()
