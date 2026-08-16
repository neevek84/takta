import { describe, it, expect } from 'vitest'
import { buildCraDocument, formatJours, type CraDocument } from './document'
import { layoutCraDocument, LIGNES_PAR_PAGE, MARGE } from './layout'
import {
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  extraireTextes,
  largeurApprox,
  renderPdf,
} from '../pdf/writer'

function document(nbLignes: number, joursParLigne = 2): CraDocument {
  const lignes = Array.from({ length: nbLignes }, (_, i) => ({
    id: `l${i}`,
    label: `Prestation ${i + 1}`,
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
 * La mention de garde du pied de page a le droit de nommer ce qu'elle exclut
 * — « aucun montant n'y figure » — mais à la condition de ne porter elle-même
 * aucun chiffre : sans quoi elle deviendrait la faille par laquelle un total
 * en euros passerait le contrôle.
 */
function verifierAucunMontant(chaines: ReadonlyArray<string>): void {
  const mentions = chaines.filter((c) => c.includes('aucun montant'))
  const reste = chaines.filter((c) => !c.includes('aucun montant'))
  for (const mention of mentions) expect(mention).not.toMatch(/\d/)
  for (const mot of motsDe(reste)) expect(MOTS_INTERDITS.has(mot)).toBe(false)
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

  it('reprend la colonne des jours sur chaque page', () => {
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    for (const page of pages) {
      const contenu = page.texts.map((t) => t.text)
      expect(contenu).toContain('lun. 01')
      expect(contenu).toContain('mar. 30')
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

  it('imprime le total de chaque colonne et le total du mois', () => {
    const contenu = textes(layoutCraDocument(document(2, 3))).join(' | ')
    expect(contenu).toContain('Total du mois')
    // 3 jours par prestation, deux prestations.
    expect(contenu).toContain(formatJours(300))
    expect(contenu).toContain(formatJours(600))
  })

  it('rappelle sur chaque page que le document ne porte aucun montant', () => {
    for (const page of layoutCraDocument(document(LIGNES_PAR_PAGE + 1))) {
      expect(page.texts.map((t) => t.text).join(' ')).toContain('aucun montant')
    }
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

    // Y compris glissé dans la mention de garde elle-même.
    const dansLaMention = layoutCraDocument(document(1))
    const pied = dansLaMention[0]!.texts.find((t) => t.text.includes('aucun montant'))!
    pied.text = `${pied.text} Total 12500.`
    expect(() => verifierAucunMontant(extraireTextes(renderPdf(dansLaMention)))).toThrow()
  })

  it('tient dans les marges de la page', () => {
    for (const page of layoutCraDocument(document(LIGNES_PAR_PAGE * 2 + 1, 31))) {
      for (const t of page.texts) {
        expect(t.x).toBeGreaterThanOrEqual(MARGE - 1)
        expect(t.x).toBeLessThanOrEqual(A4_WIDTH_PT - MARGE)
        expect(t.y).toBeGreaterThanOrEqual(25)
        expect(t.y).toBeLessThanOrEqual(A4_HEIGHT_PT - MARGE)
      }
      for (const l of page.lines) {
        expect(Math.min(l.x1, l.x2)).toBeGreaterThanOrEqual(MARGE - 1)
        expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(A4_WIDTH_PT - MARGE)
      }
    }
  })

  it('aligne les quantités à droite de leur colonne', () => {
    const page = layoutCraDocument(document(1, 1))[0]!
    const cellule = page.texts.find((t) => t.text === formatJours(100))
    const enTete = page.texts.find((t) => t.text === 'Prestation 1')
    expect(cellule).toBeDefined()
    expect(enTete).toBeDefined()
    expect(cellule!.x).toBeGreaterThan(enTete!.x)
  })

  it('tronque un libellé de prestation trop long plutôt que de déborder', () => {
    const doc = document(2)
    const long = 'Consultant ITSM senior sur le périmètre production étendu'
    doc.lignes[0]!.label = long
    const page = layoutCraDocument(doc)[0]!

    const enTete = page.texts.find((t) => t.text.startsWith('Consultant ITS'))
    expect(enTete).toBeDefined()
    expect(enTete!.text).not.toBe(long)
    expect(enTete!.text.endsWith('…')).toBe(true)
    // Ce qui reste est bien un début du libellé, pas un résumé inventé.
    expect(long.startsWith(enTete!.text.slice(0, -1))).toBe(true)
    // Et il s'arrête avant la colonne suivante — c'est tout l'objet de la
    // troncature.
    const suivante = page.texts.find((t) => t.text === 'Prestation 2')!
    expect(enTete!.x + largeurApprox(enTete!.text, enTete!.size)).toBeLessThanOrEqual(suivante.x)
  })
})
