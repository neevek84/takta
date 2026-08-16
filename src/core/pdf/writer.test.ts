import { describe, it, expect } from 'vitest'
import {
  renderPdf,
  extraireTextes,
  toWinAnsi,
  largeurApprox,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  type PdfPage,
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
