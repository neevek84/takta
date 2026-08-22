/**
 * Un écrivain PDF 1.4 minimal : texte Helvetica et traits, **flux de contenu
 * non compressé**.
 *
 * L'absence de compression n'est pas une paresse : c'est ce qui permet à
 * `extraireTextes` de relire les octets réellement produits, et donc au test
 * « aucun montant sur le CRA » de porter sur le document livré au client
 * plutôt que sur un modèle intermédiaire.
 *
 * Module pur : aucune dépendance, aucun accès au système de fichiers.
 */

export const A4_WIDTH_PT = 595
export const A4_HEIGHT_PT = 842

/**
 * A4 couché. C'est le format du CRA : trente-et-une colonnes de jours ne
 * portent un nombre lisible qu'à cette largeur — à 595 points, une case fait
 * 13 points et n'en porte aucun.
 */
export const A4_PAYSAGE_WIDTH_PT = A4_HEIGHT_PT
export const A4_PAYSAGE_HEIGHT_PT = A4_WIDTH_PT

/**
 * Une couleur, en hexadécimal `#rrggbb`.
 *
 * Le type est une chaîne et non un triplet : les couleurs de ce document
 * viennent des jetons du thème (`core/theme/tokens.ts`), qui sont déjà écrits
 * sous cette forme. Les convertir à la main à chaque appel, c'est se donner
 * l'occasion de se tromper.
 */
export type PdfCouleur = string

/** Motif de tiret : longueur du trait, longueur du blanc, en points. */
export type PdfTiret = readonly [number, number]

export interface PdfText {
  /** points depuis le bord gauche */
  x: number
  /** points depuis le bord **bas** — l'origine PDF est en bas à gauche */
  y: number
  size: number
  text: string
  bold?: boolean
  /** encre du texte ; noir à défaut, la mise en page passant son jeton */
  color?: PdfCouleur
  /**
   * Texte posé mais **non peint** (mode de rendu 3).
   *
   * Il reste dans la couche de texte : une extraction le voit, un outil de
   * signature qui cherche une ancre le trouve. C'est ce qui permet de marquer
   * l'emplacement des champs sans rien ajouter à ce que le client lit.
   */
  invisible?: boolean
}

export interface PdfLine {
  x1: number
  y1: number
  x2: number
  y2: number
  thickness?: number
  color?: PdfCouleur
  dash?: PdfTiret
}

/**
 * Un rectangle, plein et/ou tracé.
 *
 * `y` est le bord **bas**, comme partout ailleurs dans ce module : l'origine
 * PDF est en bas à gauche, et une seule inversion suffit à décaler tout un
 * calendrier d'une case.
 */
export interface PdfRect {
  x: number
  y: number
  w: number
  h: number
  fill?: PdfCouleur
  stroke?: PdfCouleur
  thickness?: number
  /** rayon des coins, en points ; 0 par défaut */
  radius?: number
  dash?: PdfTiret
}

export interface PdfPage {
  texts: PdfText[]
  lines: PdfLine[]
  /**
   * Les aplats. Ils se dessinent **avant** les traits et les textes : ce sont
   * des fonds, et un fond posé après ce qu'il porte l'efface.
   */
  rects?: PdfRect[]
  /** largeur de la page, A4 portrait par défaut */
  width?: number
  /** hauteur de la page, A4 portrait par défaut */
  height?: number
}

/** Les points de code Unicode que WinAnsiEncoding loge dans 0x80–0x9F. */
const WIN_ANSI_HAUT: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

const WIN_ANSI_INVERSE = new Map<number, string>(
  Object.entries(WIN_ANSI_HAUT).map(([caractere, octet]) => [octet, caractere]),
)

const ESPACE = 0x20
const INTERROGATION = 0x3f

/**
 * Encode une chaîne en WinAnsiEncoding. Ce qui ne s'y code pas devient `?` :
 * mieux vaut un point d'interrogation visible qu'un octet faux qui produirait
 * un caractère arbitraire dans un document signé.
 */
export function toWinAnsi(text: string): number[] {
  const octets: number[] = []
  for (const caractere of text) {
    const haut = WIN_ANSI_HAUT[caractere]
    if (haut !== undefined) {
      octets.push(haut)
      continue
    }
    const code = caractere.codePointAt(0) ?? INTERROGATION
    // Sous 0x20 : caractère de contrôle, neutralisé en espace — une fin de
    // ligne crue couperait la chaîne PDF en deux.
    if (code < 0x20) octets.push(ESPACE)
    // 0x7F–0x9F : cette plage n'a **pas** de glyphe en WinAnsiEncoding. Y
    // recopier le point de code (ce que ferait un simple filtre `<= 0xFF`)
    // laisserait chaque lecteur afficher ce qu'il veut.
    else if (code < 0x7f || (code >= 0xa0 && code <= 0xff)) octets.push(code)
    else octets.push(INTERROGATION)
  }
  return octets
}

function encoderChaine(text: string): Buffer {
  const octets: number[] = [0x28]
  for (const octet of toWinAnsi(text)) {
    if (octet === 0x28 || octet === 0x29 || octet === 0x5c) octets.push(0x5c)
    octets.push(octet)
  }
  octets.push(0x29)
  return Buffer.from(octets)
}

function nombre(valeur: number): string {
  const arrondi = Math.round(valeur * 100) / 100
  return String(arrondi)
}

/**
 * Les caractères d'Helvetica dont on connaît la largeur exacte, en millièmes
 * d'em — ceux qui composent une quantité.
 *
 * Les chiffres font 556, mais la virgule et l'espace n'en font que 278. Les
 * traiter comme un chiffre, c'est surestimer « 24,25 » de plus de huit points
 * à 31 points de corps : assez pour ouvrir un blanc visible entre le nombre et
 * son unité, et pour décaler une colonne de totaux alignés à droite.
 */
const LARGEURS_EXACTES: Record<string, number> = {
  '0': 0.556, '1': 0.556, '2': 0.556, '3': 0.556, '4': 0.556,
  '5': 0.556, '6': 0.556, '7': 0.556, '8': 0.556, '9': 0.556,
  ' ': 0.278, ',': 0.278, '.': 0.278, '·': 0.278, ':': 0.278, ';': 0.278,
}

/**
 * Largeur approchée d'une chaîne en Helvetica, en points.
 *
 * Exacte sur les quantités — chiffres, virgule, espace et séparateurs, voir
 * `LARGEURS_EXACTES` — et approchée à 556/1000 d'em sur le reste, où les
 * lettres tournent autour de cette valeur sans l'atteindre.
 *
 * L'approximation est assumée : cette fonction sert à aligner et à tronquer,
 * pas à composer du texte. Là où elle se trompe, elle se trompe **en trop** —
 * une troncature un caractère trop courte vaut mieux qu'un libellé qui déborde
 * sur son voisin.
 */
export function largeurApprox(text: string, size: number): number {
  let em = 0
  for (const caractere of text) em += LARGEURS_EXACTES[caractere] ?? 0.556
  return em * size
}

/**
 * `#rrggbb` vers les trois composantes que PDF attend, entre 0 et 1.
 *
 * Une couleur illisible — ou absente — rend du noir plutôt que de lever : ce
 * module compose un document destiné à être signé, et un fond manquant vaut
 * mieux qu'un export qui échoue. La forme est de toute façon vérifiée par le
 * type des jetons de thème, en amont.
 *
 * Aucune couleur n'est écrite en clair dans ce fichier, pas même le noir de
 * repli : le contrôle « aucune couleur en dur » du système de design ne connaît
 * qu'une source légitime, `core/theme/tokens.ts`, et un écrivain PDF n'en est
 * pas une.
 */
export function composantes(couleur: PdfCouleur | undefined): [number, number, number] {
  const hex = /^#([0-9a-fA-F]{6})$/.exec((couleur ?? '').trim())
  if (hex === null) return [0, 0, 0]
  const brut = hex[1] as string
  return [0, 2, 4].map((i) => {
    const octet = Number.parseInt(brut.slice(i, i + 2), 16)
    return Math.round((octet / 255) * 1000) / 1000
  }) as [number, number, number]
}

/**
 * Une composante de couleur s'écrit au millième, et non au centième comme les
 * coordonnées : `nombre` ramènerait 0,498 à 0,5, soit six niveaux de gris
 * d'écart sur 255. Sur un aplat qui porte du texte, c'est le genre d'écart qui
 * fait rater un rapport de contraste de peu.
 */
function millieme(valeur: number): string {
  return String(Math.round(valeur * 1000) / 1000)
}

function encre(couleur: PdfCouleur | undefined, operateur: 'rg' | 'RG'): string {
  const [r, v, b] = composantes(couleur)
  return `${millieme(r)} ${millieme(v)} ${millieme(b)} ${operateur}\n`
}

/** Le motif de tiret, puis son annulation : l'état graphique est global. */
function tiret(motif: PdfTiret | undefined): { pose: string; retire: string } {
  if (motif === undefined) return { pose: '', retire: '' }
  return { pose: `[${nombre(motif[0])} ${nombre(motif[1])}] 0 d\n`, retire: '[] 0 d\n' }
}

/**
 * Le facteur de Bézier qui approche un quart de cercle — 4/3·(√2−1).
 *
 * PDF ne sait pas tracer d'arc : un coin arrondi est une courbe cubique, et
 * c'est la seule constante qui la fasse passer par le cercle.
 */
const KAPPA = 0.5523

/** Le contour d'un rectangle, à coins vifs ou arrondis. */
function contour(rect: PdfRect): string {
  const { x, y, w, h } = rect
  const r = Math.min(rect.radius ?? 0, w / 2, h / 2)
  if (r <= 0) return `${nombre(x)} ${nombre(y)} ${nombre(w)} ${nombre(h)} re\n`

  const k = r * KAPPA
  const [xg, xd, yb, yh] = [x, x + w, y, y + h]
  const courbe = (
    x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
  ): string =>
    `${nombre(x1)} ${nombre(y1)} ${nombre(x2)} ${nombre(y2)} ` +
    `${nombre(x3)} ${nombre(y3)} c\n`

  return (
    `${nombre(xg + r)} ${nombre(yb)} m\n` +
    `${nombre(xd - r)} ${nombre(yb)} l\n` +
    courbe(xd - r + k, yb, xd, yb + r - k, xd, yb + r) +
    `${nombre(xd)} ${nombre(yh - r)} l\n` +
    courbe(xd, yh - r + k, xd - r + k, yh, xd - r, yh) +
    `${nombre(xg + r)} ${nombre(yh)} l\n` +
    courbe(xg + r - k, yh, xg, yh - r + k, xg, yh - r) +
    `${nombre(xg)} ${nombre(yb + r)} l\n` +
    courbe(xg, yb + r - k, xg + r - k, yb, xg + r, yb) +
    'h\n'
  )
}

function fluxDeContenu(page: PdfPage): Buffer {
  const morceaux: Buffer[] = []

  // Les aplats d'abord : ce sont des fonds.
  for (const rect of page.rects ?? []) {
    const remplit = rect.fill !== undefined
    const trace = rect.stroke !== undefined
    if (!remplit && !trace) continue
    if (rect.w <= 0 || rect.h <= 0) continue

    const motif = tiret(rect.dash)
    morceaux.push(
      Buffer.from(
        (remplit ? encre(rect.fill, 'rg') : '') +
          (trace ? encre(rect.stroke, 'RG') + `${nombre(rect.thickness ?? 0.5)} w\n` : '') +
          motif.pose +
          contour(rect) +
          // `B` remplit **et** trace en une passe : deux passes poseraient le
          // trait à cheval sur un bord déjà peint, et l'épaissiraient d'un
          // demi-point sur les seuls rectangles qui font les deux.
          (remplit && trace ? 'B\n' : remplit ? 'f\n' : 'S\n') +
          motif.retire,
        'latin1',
      ),
    )
  }

  for (const trait of page.lines) {
    const motif = tiret(trait.dash)
    morceaux.push(
      Buffer.from(
        encre(trait.color, 'RG') +
          `${nombre(trait.thickness ?? 0.5)} w\n` +
          motif.pose +
          `${nombre(trait.x1)} ${nombre(trait.y1)} m ` +
          `${nombre(trait.x2)} ${nombre(trait.y2)} l S\n` +
          motif.retire,
        'latin1',
      ),
    )
  }

  for (const texte of page.texts) {
    morceaux.push(
      Buffer.from(
        encre(texte.color, 'rg') +
          `BT /${texte.bold === true ? 'F2' : 'F1'} ${nombre(texte.size)} Tf ` +
          // `3 Tr` : posé, jamais peint. L'opérateur vit dans le bloc BT/ET,
          // qui est propre à ce texte — rien à remettre à zéro derrière.
          (texte.invisible === true ? '3 Tr ' : '') +
          `${nombre(texte.x)} ${nombre(texte.y)} Td `,
        'latin1',
      ),
      encoderChaine(texte.text),
      Buffer.from(' Tj ET\n', 'latin1'),
    )
  }

  return Buffer.concat(morceaux)
}

const ENTETE = Buffer.concat([
  Buffer.from('%PDF-1.4\n', 'latin1'),
  // Commentaire binaire conventionnel : signale aux outils que le fichier
  // n'est pas du texte et ne doit pas subir de conversion de fin de ligne.
  Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
])

export function renderPdf(pages: ReadonlyArray<PdfPage>): Uint8Array {
  const utiles: ReadonlyArray<PdfPage> =
    pages.length === 0 ? [{ texts: [], lines: [] }] : pages

  // 1 catalogue, 2 arbre de pages, 3 et 4 les fontes, puis deux objets par
  // page : la page elle-même et son flux de contenu.
  const idPage = (index: number): number => 5 + index * 2
  const idContenu = (index: number): number => 6 + index * 2

  const objets: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from(
      `<< /Type /Pages /Kids [${utiles.map((_, i) => `${idPage(i)} 0 R`).join(' ')}]` +
        ` /Count ${utiles.length} >>`,
      'latin1',
    ),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
  ]

  utiles.forEach((page, index) => {
    const contenu = fluxDeContenu(page)
    objets.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R` +
          ` /MediaBox [0 0 ${nombre(page.width ?? A4_WIDTH_PT)}` +
          ` ${nombre(page.height ?? A4_HEIGHT_PT)}]` +
          ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>` +
          ` /Contents ${idContenu(index)} 0 R >>`,
        'latin1',
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${contenu.length} >>\nstream\n`, 'latin1'),
        contenu,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    )
  })

  const morceaux: Buffer[] = [ENTETE]
  let position = ENTETE.length
  const positions: number[] = []

  objets.forEach((corps, index) => {
    const ouverture = Buffer.from(`${index + 1} 0 obj\n`, 'latin1')
    const fermeture = Buffer.from('\nendobj\n', 'latin1')
    positions.push(position)
    morceaux.push(ouverture, corps, fermeture)
    position += ouverture.length + corps.length + fermeture.length
  })

  const departXref = position
  // Chaque entrée fait exactement 20 octets, fin de ligne comprise : la
  // spécification l'impose, et un lecteur strict refuse le fichier sinon.
  const entrees = [
    'xref',
    `0 ${objets.length + 1}`,
    '0000000000 65535 f ',
    ...positions.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
  ]
  morceaux.push(Buffer.from(`${entrees.join('\n')}\n`, 'latin1'))
  morceaux.push(
    Buffer.from(
      `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\n` +
        `startxref\n${departXref}\n%%EOF\n`,
      'latin1',
    ),
  )

  return new Uint8Array(Buffer.concat(morceaux))
}

/**
 * Relit un document produit par `renderPdf` et rend, dans l'ordre, chaque
 * chaîne qui y est dessinée.
 *
 * C'est l'instrument du test qui protège la frontière du produit : il regarde
 * ce que le client verra, pas ce que le code croit avoir composé.
 */
export function extraireTextes(pdf: Uint8Array): string[] {
  const brut = Buffer.from(pdf).toString('latin1')
  const motif = /\(((?:\\.|[^\\()])*)\) Tj/g
  const textes: string[] = []

  let trouve: RegExpExecArray | null = motif.exec(brut)
  while (trouve !== null) {
    const echappe = trouve[1] ?? ''
    const brutDeChaine = echappe.replace(/\\([\\()])/g, '$1')
    let reconstitue = ''
    for (let i = 0; i < brutDeChaine.length; i++) {
      const code = brutDeChaine.charCodeAt(i)
      reconstitue += WIN_ANSI_INVERSE.get(code) ?? String.fromCharCode(code)
    }
    textes.push(reconstitue)
    trouve = motif.exec(brut)
  }

  return textes
}
