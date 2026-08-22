import { describe, it, expect } from 'vitest'
import { buildCraDocument, formatJours, type CraDocument } from './document'
import { layoutCraDocument, LIGNES_PAR_PAGE, MARGE } from './layout'
import {
  A4_PAYSAGE_WIDTH_PT,
  A4_PAYSAGE_HEIGHT_PT,
  extraireTextes,
  largeurApprox,
  renderPdf,
} from '../pdf/writer'

function document(nbLignes: number, joursParLigne = 2): CraDocument {
  const lignes = Array.from({ length: nbLignes }, (_, i) => ({
    id: `l${i}`,
    label: `Prestation ${i + 1}`,
    soldCentiemes: 3000,
  }))
  const entries = lignes.flatMap((l) =>
    Array.from({ length: joursParLigne }, (_, j) => ({
      lineId: l.id,
      date: `2026-06-${String(j + 1).padStart(2, '0')}`,
      minutes: 480,
      minutesParJour: 480,
      kind: 'REALISE' as const,
    })),
  )

  return buildCraDocument({
    emetteur: {
      nom: 'KREATIV PROJECT MANAGEMENT',
      adresse: '1 rue des Tests, 75000 Paris',
      siret: '000 000 000 00000',
      email: 'contact@kreativpm.fr',
    },
    clientNom: 'ACME',
    missionLabel: 'Consultant ITSM',
    mois: '2026-06',
    signataireNom: 'Claire Martin',
    signataireEmail: 'claire.martin@acme.test',
    lignes,
    moisValides: [],
    entries,
  })
}

function textes(pages: ReturnType<typeof layoutCraDocument>): string[] {
  return pages.flatMap((p) => p.texts.map((t) => t.text))
}

/** Voir `document.test.ts` : on compare des mots, pas des sous-chaînes. */
const MOTS_INTERDITS = new Set([
  'eur', 'euro', 'euros', 'tjm', 'montant', 'montants', 'prix', 'facture',
  'facturation', 'tarif', 'tarifs', 'centime', 'centimes', 'ht', 'ttc',
  'honoraires',
])

function motsDe(chaines: ReadonlyArray<string>): string[] {
  return chaines.flatMap((chaine) =>
    chaine
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-zà-öø-ÿ]+/)
      .filter((mot) => mot !== ''),
  )
}

/**
 * Aucune des chaînes ne porte de montant.
 *
 * Le pied de page ne nomme plus ce qu'il exclut : « aucun montant n'y figure »
 * a été retiré du document. Le contrôle porte donc sur **toutes** les chaînes
 * sans exception — il n'y a plus de mention à laquelle accorder le droit
 * d'employer le vocabulaire proscrit.
 */
function verifierAucunMontant(chaines: ReadonlyArray<string>): void {
  for (const mot of motsDe(chaines)) expect(MOTS_INTERDITS.has(mot)).toBe(false)
  expect(chaines.join(' ')).not.toContain('€')
}

describe('layoutCraDocument', () => {
  it('tient sur une page tant que les prestations tiennent en colonnes', () => {
    expect(layoutCraDocument(document(1))).toHaveLength(1)
    expect(layoutCraDocument(document(LIGNES_PAR_PAGE))).toHaveLength(1)
  })

  it('ouvre une page par paquet de colonnes supplémentaire', () => {
    expect(layoutCraDocument(document(LIGNES_PAR_PAGE + 1))).toHaveLength(2)
    expect(layoutCraDocument(document(LIGNES_PAR_PAGE * 2 + 1))).toHaveLength(3)
  })

  it('produit une page même sans aucune prestation servie', () => {
    const pages = layoutCraDocument(document(0))
    expect(pages).toHaveLength(1)
    expect(textes(pages).join(' ')).toContain('Aucun temps réalisé')
  })

  it('reprend le client, la mission et le mois sur chaque page', () => {
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    for (const page of pages) {
      const contenu = page.texts.map((t) => t.text).join(' | ')
      expect(contenu).toContain('ACME')
      expect(contenu).toContain('Consultant ITSM')
      expect(contenu).toContain('juin 2026')
    }
  })

  it('reprend la bande des trente jours sur chaque page', () => {
    // Le paysage écrit le quantième seul, surmonté de l'initiale du jour : à
    // 20 points de large, « lun. 01 » ne tient pas dans une case.
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    for (const page of pages) {
      const contenu = page.texts.map((t) => t.text)
      for (const quantieme of ['1', '15', '30']) expect(contenu).toContain(quantieme)
      // Juin 2026 commence un lundi et finit un mardi.
      expect(contenu.filter((t) => t === 'L')).toHaveLength(5)
      expect(contenu.filter((t) => t === 'D')).toHaveLength(4)
    }
  })

  it('numérote les pages', () => {
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    expect(textes([pages[0]!])).toContain('Page 1 / 2')
    expect(textes([pages[1]!])).toContain('Page 2 / 2')
  })

  it('ne pose le pavé de signature que sur la dernière page', () => {
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    const mention = (page: (typeof pages)[number]): boolean =>
      page.texts.some((t) => t.text.includes('Bon pour accord'))
    expect(mention(pages[0]!)).toBe(false)
    expect(mention(pages[1]!)).toBe(true)
  })

  it('nomme le signataire dans le pavé de signature', () => {
    const contenu = textes(layoutCraDocument(document(1))).join(' | ')
    expect(contenu).toContain('Claire Martin')
    expect(contenu).toContain('claire.martin@acme.test')
  })

  it('imprime le détail par ligne et par jour', () => {
    const pages = layoutCraDocument(document(2, 3))
    const contenu = textes(pages)
    expect(contenu).toContain('Prestation 1')
    expect(contenu).toContain('Prestation 2')
    // Trois journées pleines par prestation.
    expect(contenu.filter((t) => t === formatJours(100))).toHaveLength(6)
  })

  it('imprime le total de chaque prestation et le total du mois', () => {
    const contenu = textes(layoutCraDocument(document(2, 3))).join(' | ')
    expect(contenu).toContain('TOTAL DU MOIS')
    // 3 jours par prestation, deux prestations.
    expect(contenu).toContain(formatJours(300))
    expect(contenu).toContain(formatJours(600))
  })

  it('porte sur chaque page ce que le document atteste', () => {
    for (const page of layoutCraDocument(document(LIGNES_PAR_PAGE + 1))) {
      expect(page.texts.map((t) => t.text).join(' ')).toContain(
        'Document attestant du temps passé',
      )
    }
  })

  it('n écrit nulle part « temps de travail »', () => {
    // Le mot appartient au droit du travail : sur un document que le client
    // signe, il prête le flanc à une requalification.
    const contenu = textes(layoutCraDocument(document(3, 4))).join(' | ').toLowerCase()
    expect(contenu).not.toContain('temps de travail')
  })

  it('n imprime jamais de montant', () => {
    verifierAucunMontant(textes(layoutCraDocument(document(3, 4))))
  })

  it('ne laisse apparaître aucun montant dans les octets du PDF livré', () => {
    // Le contrôle qui compte : il porte sur le document que le client
    // recevra, relu depuis les octets rendus, et non sur le modèle qui a
    // servi à le composer. `renderPdf` ne compresse rien, précisément pour
    // que cette relecture soit possible.
    const dessine = extraireTextes(renderPdf(layoutCraDocument(document(3, 4))))
    expect(dessine.length).toBeGreaterThan(30)
    // « € » vaut l'octet 0x80 en WinAnsi : seul `extraireTextes` le retrouve.
    verifierAucunMontant(dessine)
  })

  it('le contrôle sur les octets voit un montant qu on y glisserait', () => {
    // Un test de garde qu'on ne sait pas faire échouer ne garde rien.
    const avecEuros = layoutCraDocument(document(1))
    avecEuros[0]!.texts.push({ x: MARGE, y: 100, size: 9, text: 'Total : 12 500,00 € HT' })
    expect(() => verifierAucunMontant(extraireTextes(renderPdf(avecEuros)))).toThrow()

    // Et sans le symbole : c'est le vocabulaire qui est proscrit, pas le seul
    // caractère.
    const sansSymbole = layoutCraDocument(document(1))
    sansSymbole[0]!.texts.push({ x: MARGE, y: 100, size: 9, text: 'Tarif journalier' })
    expect(() => verifierAucunMontant(extraireTextes(renderPdf(sansSymbole)))).toThrow()
  })

  it('couche la page, et lui donne le format qu elle dessine', () => {
    // `width` et `height` sont facultatifs au type `PdfPage` — sans valeur,
    // l'écrivain retombe sur le portrait. Les deux égalités ci-dessous sont
    // donc la vraie garde : elles échouent aussi bien sur une page sans
    // dimensions que sur une page dressée.
    for (const page of layoutCraDocument(document(2))) {
      expect(page.width).toBe(A4_PAYSAGE_WIDTH_PT)
      expect(page.height).toBe(A4_PAYSAGE_HEIGHT_PT)
    }
    // Et ce que ces valeurs signifient : la page est couchée.
    expect(A4_PAYSAGE_WIDTH_PT).toBeGreaterThan(A4_PAYSAGE_HEIGHT_PT)
  })

  it('tient dans les marges de la page', () => {
    // Le bandeau de tête est à fond perdu : c'est un aplat, et son texte est
    // posé dedans, au-dessus de la marge haute. Tout le reste s'y tient.
    const HAUT_BANDEAU = A4_PAYSAGE_HEIGHT_PT - 28

    for (const page of layoutCraDocument(document(LIGNES_PAR_PAGE * 2 + 1, 30))) {
      for (const t of page.texts) {
        expect(t.x).toBeGreaterThanOrEqual(MARGE - 1)
        expect(t.x + largeurApprox(t.text, t.size)).toBeLessThanOrEqual(
          A4_PAYSAGE_WIDTH_PT - MARGE + 1,
        )
        expect(t.y).toBeGreaterThanOrEqual(25)
        expect(t.y).toBeLessThanOrEqual(A4_PAYSAGE_HEIGHT_PT - 12)
        if (t.y > A4_PAYSAGE_HEIGHT_PT - MARGE) {
          expect(t.y).toBeGreaterThanOrEqual(HAUT_BANDEAU)
        }
      }
      for (const l of page.lines) {
        expect(Math.min(l.x1, l.x2)).toBeGreaterThanOrEqual(MARGE - 1)
        expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(A4_PAYSAGE_WIDTH_PT - MARGE + 1)
      }
      for (const r of page.rects ?? []) {
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.y + r.h).toBeLessThanOrEqual(A4_PAYSAGE_HEIGHT_PT)
      }
    }
  })

  it('centre la quantité dans sa case, et cale le total du mois à droite', () => {
    const page = layoutCraDocument(document(1, 1))[0]!
    const libelle = page.texts.find((t) => t.text === 'Prestation 1')!
    // Quatre « 1,00 » sur cette page, de gauche à droite : le total de tête,
    // le total de la ligne, l'unique case servie, et le consommé de la
    // mission dans la colonne de droite.
    const quantites = page.texts
      .filter((t) => t.text === formatJours(100))
      .sort((a, b) => a.x - b.x)
    expect(quantites).toHaveLength(4)

    const [total, totalLigne, cellule, cumul] = quantites as [
      (typeof quantites)[number],
      (typeof quantites)[number],
      (typeof quantites)[number],
      (typeof quantites)[number],
    ]
    expect(cumul.x).toBe(600)
    expect(total.x).toBe(MARGE)
    // Le total de la ligne s'arrête sur le bord droit de sa colonne.
    expect(totalLigne.x + largeurApprox(totalLigne.text, totalLigne.size)).toBeCloseTo(165, 1)
    expect(totalLigne.x).toBeGreaterThan(libelle.x)
    // La case, elle, est plus à droite encore : la bande commence après.
    expect(cellule.x).toBeGreaterThan(172)
  })

  it('tronque un libellé de prestation trop long plutôt que de déborder', () => {
    const doc = document(2)
    const long = 'Consultant ITSM senior sur le périmètre production étendu'
    doc.lignes[0]!.label = long
    const page = layoutCraDocument(doc)[0]!

    const tronques = page.texts.filter((t) => t.text.startsWith('Consultant ITS'))
    // Le libellé paraît deux fois : dans la bande, et dans le bloc
    // d'engagement. Les deux sont tronqués, chacun à sa colonne.
    expect(tronques).toHaveLength(2)

    for (const enTete of tronques) {
      expect(enTete.text).not.toBe(long)
      expect(enTete.text.endsWith('…')).toBe(true)
      // Ce qui reste est bien un début du libellé, pas un résumé inventé.
      expect(long.startsWith(enTete.text.slice(0, -1))).toBe(true)
      // Et il s'arrête avant ce qui suit sur sa ligne — c'est tout l'objet de
      // la troncature.
      expect(enTete.x + largeurApprox(enTete.text, enTete.size)).toBeLessThanOrEqual(172)
    }
  })
})
