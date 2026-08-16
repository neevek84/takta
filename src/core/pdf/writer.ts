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

export interface PdfText {
  /** points depuis le bord gauche */
  x: number
  /** points depuis le bord **bas** — l'origine PDF est en bas à gauche */
  y: number
  size: number
  text: string
  bold?: boolean
}

export interface PdfLine {
  x1: number
  y1: number
  x2: number
  y2: number
  thickness?: number
}

export interface PdfPage {
  texts: PdfText[]
  lines: PdfLine[]
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
 * Largeur approchée d'une chaîne en Helvetica, en points.
 *
 * Les chiffres d'Helvetica font exactement 556/1000 d'em ; les lettres
 * tournent autour. C'est une approximation assumée : elle ne sert qu'à
 * aligner des nombres à droite dans une colonne, pas à composer du texte.
 */
export function largeurApprox(text: string, size: number): number {
  return text.length * size * 0.556
}

function fluxDeContenu(page: PdfPage): Buffer {
  const morceaux: Buffer[] = []

  for (const trait of page.lines) {
    morceaux.push(
      Buffer.from(
        `${nombre(trait.thickness ?? 0.5)} w\n` +
          `${nombre(trait.x1)} ${nombre(trait.y1)} m ` +
          `${nombre(trait.x2)} ${nombre(trait.y2)} l S\n`,
        'latin1',
      ),
    )
  }

  for (const texte of page.texts) {
    morceaux.push(
      Buffer.from(
        `BT /${texte.bold === true ? 'F2' : 'F1'} ${nombre(texte.size)} Tf ` +
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
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}]` +
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
