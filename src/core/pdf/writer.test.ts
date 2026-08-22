import { describe, it, expect } from 'vitest'
import {
  renderPdf,
  extraireTextes,
  toWinAnsi,
  largeurApprox,
  composantes,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  A4_PAYSAGE_WIDTH_PT,
  A4_PAYSAGE_HEIGHT_PT,
  type PdfPage,
  type PdfRect,
} from './writer'

function texte(text: string): PdfPage {
  return { texts: [{ x: 40, y: 700, size: 10, text }], lines: [] }
}

function enLatin1(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString('latin1')
}

describe('renderPdf', () => {
  it('produit un fichier PDF reconnaissable', () => {
    const brut = enLatin1(renderPdf([texte('Bonjour')]))
    expect(brut.startsWith('%PDF-1.4\n')).toBe(true)
    expect(brut.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('déclare autant de pages qu on lui en donne', () => {
    expect(enLatin1(renderPdf([texte('a')]))).toContain('/Count 1')
    expect(enLatin1(renderPdf([texte('a'), texte('b')]))).toContain('/Count 2')
  })

  it('produit toujours au moins une page', () => {
    expect(enLatin1(renderPdf([]))).toContain('/Count 1')
  })

  it('donne à chaque page le format A4', () => {
    expect(enLatin1(renderPdf([texte('a')]))).toContain(
      `/MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}]`,
    )
  })

  it('place la table de références croisées là où le pied du fichier l annonce', () => {
    const pdf = renderPdf([texte('a'), texte('b')])
    const brut = enLatin1(pdf)
    const depart = /startxref\n(\d+)\n%%EOF/.exec(brut)
    expect(depart).not.toBeNull()
    expect(brut.slice(Number(depart![1]), Number(depart![1]) + 4)).toBe('xref')
  })

  it('fait pointer chaque entrée de la table sur son objet', () => {
    // Une seule mauvaise longueur d'objet décale toutes les entrées suivantes
    // et produit un fichier qu aucun lecteur n ouvre.
    const brut = enLatin1(renderPdf([texte('a'), texte('b')]))
    const entrees = [...brut.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(entrees.length).toBeGreaterThanOrEqual(8)
    entrees.forEach((offset, index) => {
      expect(brut.slice(offset).startsWith(`${index + 1} 0 obj\n`)).toBe(true)
    })
  })

  it('annonce la longueur exacte de chaque flux de contenu', () => {
    const brut = enLatin1(renderPdf([texte('Bonjour le monde')]))
    const m = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(brut)
    expect(m).not.toBeNull()
    expect(Buffer.byteLength(m![2]!, 'latin1')).toBe(Number(m![1]))
  })

  it('échappe les parenthèses et la barre oblique inverse', () => {
    const brut = enLatin1(renderPdf([texte('A (B) \\ C')]))
    expect(brut).toContain('(A \\(B\\) \\\\ C) Tj')
  })

  it('utilise la fonte grasse quand on la demande, la normale sinon', () => {
    const brut = enLatin1(
      renderPdf([
        {
          texts: [
            { x: 40, y: 700, size: 10, text: 'normal' },
            { x: 40, y: 680, size: 10, text: 'gras', bold: true },
          ],
          lines: [],
        },
      ]),
    )
    expect(brut).toContain('/F1 10 Tf')
    expect(brut).toContain('/F2 10 Tf')
    expect(brut).toContain('/BaseFont /Helvetica-Bold')
  })

  it('dessine les traits demandés', () => {
    const brut = enLatin1(
      renderPdf([{ texts: [], lines: [{ x1: 40, y1: 700, x2: 555, y2: 700, thickness: 0.8 }] }]),
    )
    expect(brut).toContain('0.8 w')
    expect(brut).toContain('40 700 m 555 700 l S')
  })
})

describe('toWinAnsi', () => {
  it('laisse les lettres accentuées sur leur octet latin-1', () => {
    expect(toWinAnsi('é')).toEqual([0xe9])
    expect(toWinAnsi('à')).toEqual([0xe0])
    expect(toWinAnsi('ç')).toEqual([0xe7])
  })

  it('mappe l apostrophe typographique, omniprésente dans les libellés français', () => {
    expect(toWinAnsi('’')).toEqual([0x92])
    expect(toWinAnsi('…')).toEqual([0x85])
    expect(toWinAnsi('—')).toEqual([0x97])
  })

  it('remplace ce qui ne se code pas plutôt que de produire un octet faux', () => {
    expect(toWinAnsi('☃')).toEqual([0x3f])
  })

  it('neutralise les caractères de contrôle', () => {
    expect(toWinAnsi('a\nb')).toEqual([0x61, 0x20, 0x62])
  })

  it('refuse les octets que WinAnsi ne définit pas', () => {
    // 0x7F–0x9F n'a pas de glyphe en WinAnsiEncoding : y laisser passer le
    // point de code brut ferait afficher un caractère arbitraire, différent
    // d'un lecteur à l'autre, dans un document signé.
    expect(toWinAnsi('\u007f')).toEqual([0x3f])
    expect(toWinAnsi('\u0081')).toEqual([0x3f])
    expect(toWinAnsi('\u009f')).toEqual([0x3f])
  })
})

describe('extraireTextes', () => {
  it('rend exactement les chaînes dessinées, dans l ordre', () => {
    const pdf = renderPdf([
      { texts: [{ x: 40, y: 700, size: 10, text: 'un' }], lines: [] },
      { texts: [{ x: 40, y: 700, size: 10, text: 'deux' }], lines: [] },
    ])
    expect(extraireTextes(pdf)).toEqual(['un', 'deux'])
  })

  it('reconstitue les caractères échappés et les accents', () => {
    const pdf = renderPdf([texte('Coût d’un (test) \\ é')])
    expect(extraireTextes(pdf)).toEqual(['Coût d’un (test) \\ é'])
  })

  it('relit le signe euro tel qu il serait imprimé', () => {
    // WinAnsi loge « € » sur l'octet 0x80 : chercher le caractère dans les
    // octets bruts ne le trouverait pas. C'est `extraireTextes` — et lui seul —
    // qui rend le test « aucun montant » capable de le voir.
    const pdf = renderPdf([texte('1 234,00 €')])
    expect(enLatin1(pdf)).not.toContain('€')
    expect(extraireTextes(pdf)).toEqual(['1 234,00 €'])
  })

  it('ne rend rien pour un document sans texte', () => {
    expect(extraireTextes(renderPdf([{ texts: [], lines: [] }]))).toEqual([])
  })
})

describe('largeurApprox', () => {
  it('croît avec la longueur et avec le corps', () => {
    expect(largeurApprox('12', 10)).toBeLessThan(largeurApprox('1234', 10))
    expect(largeurApprox('12', 10)).toBeLessThan(largeurApprox('12', 14))
  })

  it('rend zéro pour une chaîne vide', () => {
    expect(largeurApprox('', 10)).toBe(0)
  })
})

describe('les aplats', () => {
  function avecRects(rects: PdfRect[]): string {
    return enLatin1(renderPdf([{ texts: [], lines: [], rects }]))
  }

  it('remplit un rectangle à coins vifs en une seule opération', () => {
    const brut = avecRects([{ x: 10, y: 20, w: 30, h: 40, fill: '#0e9480' }])
    expect(brut).toContain('10 20 30 40 re')
    expect(brut).toContain('re\nf\n')
  })

  it('convertit la couleur hexadécimale en composantes PDF', () => {
    expect(composantes('#000000')).toEqual([0, 0, 0])
    expect(composantes('#ffffff')).toEqual([1, 1, 1])
    // 0x0e = 14 ; 14/255 = 0,0549… arrondi au millième.
    expect(composantes('#0e9480')).toEqual([0.055, 0.58, 0.502])
  })

  it('rend du noir plutôt que d échouer sur une couleur illisible', () => {
    expect(composantes('turquoise')).toEqual([0, 0, 0])
    expect(composantes('#abc')).toEqual([0, 0, 0])
  })

  it('remplit et trace en une passe quand le rectangle fait les deux', () => {
    const brut = avecRects([{ x: 0, y: 0, w: 10, h: 10, fill: '#ffffff', stroke: '#aec5bd' }])
    expect(brut).toContain('re\nB\n')
    expect(brut).not.toContain('re\nf\n')
    expect(brut).not.toContain('re\nS\n')
  })

  it('ignore un rectangle sans couleur, ou sans surface', () => {
    expect(avecRects([{ x: 0, y: 0, w: 10, h: 10 }])).not.toContain(' re')
    expect(avecRects([{ x: 0, y: 0, w: 0, h: 10, fill: '#000000' }])).not.toContain(' re')
    expect(avecRects([{ x: 0, y: 0, w: 10, h: -1, fill: '#000000' }])).not.toContain(' re')
  })

  it('trace un coin arrondi en courbes plutôt qu en rectangle', () => {
    const brut = avecRects([{ x: 0, y: 0, w: 20, h: 20, fill: '#000000', radius: 3 }])
    expect(brut).not.toContain(' re')
    expect([...brut.matchAll(/ c\n/g)]).toHaveLength(4)
    expect(brut).toContain('h\n')
  })

  it('borne le rayon à la moitié du plus petit côté', () => {
    // Un rayon plus grand replierait le contour sur lui-même.
    const brut = avecRects([{ x: 0, y: 0, w: 10, h: 4, fill: '#000000', radius: 50 }])
    expect(brut).toContain('2 0 m')
  })

  it('pose le motif de tiret puis le retire', () => {
    const brut = avecRects([{ x: 0, y: 0, w: 10, h: 10, stroke: '#7c5500', dash: [2.4, 1.8] }])
    expect(brut.indexOf('[2.4 1.8] 0 d')).toBeGreaterThan(-1)
    expect(brut.indexOf('[] 0 d')).toBeGreaterThan(brut.indexOf('[2.4 1.8] 0 d'))
  })

  it('dessine les aplats avant les traits et les textes', () => {
    // Un fond posé après ce qu'il porte l'efface.
    const brut = enLatin1(
      renderPdf([
        {
          rects: [{ x: 0, y: 0, w: 10, h: 10, fill: '#51c9b2' }],
          lines: [{ x1: 0, y1: 0, x2: 10, y2: 0 }],
          texts: [{ x: 0, y: 0, size: 8, text: 'dessus' }],
        },
      ]),
    )
    expect(brut.indexOf('0.318 0.788 0.698 rg')).toBeLessThan(brut.indexOf(' l S'))
    expect(brut.indexOf(' l S')).toBeLessThan(brut.indexOf('(dessus)'))
  })
})

describe('la couleur du texte et des traits', () => {
  it('encre le texte de la couleur demandée, en noir par défaut', () => {
    const brut = enLatin1(
      renderPdf([
        {
          texts: [
            { x: 0, y: 0, size: 8, text: 'rouille', color: '#7f2c17' },
            { x: 0, y: 20, size: 8, text: 'defaut' },
          ],
          lines: [],
        },
      ]),
    )
    expect(brut).toContain('0.498 0.173 0.09 rg')
    expect(brut).toContain('0 0 0 rg\nBT /F1 8 Tf 0 20 Td (defaut)')
  })

  it('accepte un trait tireté et coloré', () => {
    const brut = enLatin1(
      renderPdf([
        { texts: [], lines: [{ x1: 0, y1: 0, x2: 10, y2: 0, color: '#aec5bd', dash: [2, 2] }] },
      ]),
    )
    expect(brut).toContain('0.682 0.773 0.741 RG')
    expect(brut).toContain('[2 2] 0 d')
  })
})

describe('le format de page', () => {
  it('reste en A4 portrait quand la page ne dit rien', () => {
    expect(enLatin1(renderPdf([texte('a')]))).toContain(
      `/MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}]`,
    )
  })

  it('couche la page quand elle le demande', () => {
    const paysage: PdfPage = {
      texts: [],
      lines: [],
      width: A4_PAYSAGE_WIDTH_PT,
      height: A4_PAYSAGE_HEIGHT_PT,
    }
    expect(enLatin1(renderPdf([paysage]))).toContain('/MediaBox [0 0 842 595]')
  })

  it('donne à chaque page son propre format', () => {
    const brut = enLatin1(
      renderPdf([
        texte('portrait'),
        { texts: [], lines: [], width: A4_PAYSAGE_WIDTH_PT, height: A4_PAYSAGE_HEIGHT_PT },
      ]),
    )
    expect(brut).toContain('/MediaBox [0 0 595 842]')
    expect(brut).toContain('/MediaBox [0 0 842 595]')
  })
})
