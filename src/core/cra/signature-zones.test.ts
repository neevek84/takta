import { describe, expect, it } from 'vitest'
import { renderPdf, type PdfPage } from '../pdf/writer'
import { buildCraDocument } from './document'
import { layoutCraDocument } from './layout'
import {
  ANCRE_DATE,
  ANCRE_SIGNATURE,
  TAILLE_CHAMP_SIGNATURE,
  zonesSignature,
} from './signature-zones'

function document(nbLignes: number) {
  const lignes = Array.from({ length: nbLignes }, (_, i) => ({
    id: `l${i}`,
    label: `Prestation ${i}`,
    soldCentiemes: 1000,
  }))
  return buildCraDocument({
    emetteur: { nom: 'Émetteur', adresse: 'Adresse', siret: '000', email: 'e@exemple.test' },
    clientNom: 'Client',
    missionLabel: 'Mission',
    mois: '2026-08',
    signataireNom: 'Signataire',
    signataireEmail: 's@exemple.test',
    lignes,
    moisValides: [],
    entries: lignes.map((l) => ({
      lineId: l.id,
      date: '2026-08-03',
      minutes: 420,
      minutesParJour: 420,
      kind: 'REALISE' as const,
    })),
  })
}

describe('zonesSignature', () => {
  it('rend la position réellement occupée par l’ancre, pas une géométrie recalculée', () => {
    // Une seconde source de vérité finirait par diverger d'un demi-centimètre,
    // c'est-à-dire par faire signer à côté du cadre.
    const pages = layoutCraDocument(document(3))
    const zones = zonesSignature(pages)

    const pose = pages[zones.signature.page - 1]!.texts.find((t) => t.text === ANCRE_SIGNATURE)
    expect(pose).toBeDefined()
    expect(zones.signature.x).toBe(pose!.x)
    expect(zones.signature.y).toBe(pose!.y)
    expect(zones.signature.largeur).toBe(TAILLE_CHAMP_SIGNATURE.largeur)
  })

  it('pose le pavé sur la dernière page, et sur elle seule', () => {
    // Un document qu'on peut signer deux fois est un document qui sera signé
    // deux fois.
    const pages = layoutCraDocument(document(40))
    expect(pages.length).toBeGreaterThan(1)

    const zones = zonesSignature(pages)
    expect(zones.signature.page).toBe(pages.length)
    expect(zones.date.page).toBe(pages.length)

    const partout = pages.flatMap((p) => p.texts.filter((t) => t.text === ANCRE_SIGNATURE))
    expect(partout).toHaveLength(1)
  })

  it('tient les deux champs dans la page', () => {
    const pages = layoutCraDocument(document(3))
    const zones = zonesSignature(pages)
    const derniere = pages[zones.signature.page - 1]!

    for (const zone of [zones.signature, zones.date]) {
      expect(zone.x).toBeGreaterThanOrEqual(0)
      expect(zone.y).toBeGreaterThanOrEqual(0)
      expect(zone.x + zone.largeur).toBeLessThanOrEqual(derniere.width ?? 0)
      expect(zone.y + zone.hauteur).toBeLessThanOrEqual(derniere.height ?? 0)
    }
  })

  it('garde le champ sous son intitulé, dans le cadre et pas dessus', () => {
    // Une ancre posée au ras de l'intitulé fait remonter le champ par-dessus
    // lui : la signature couvre alors le mot « SIGNATURE », et le cadre
    // déborde vers le haut. Rien ne le dit à l'écran, tout se voit une fois
    // signé.
    const pages = layoutCraDocument(document(3))
    const zones = zonesSignature(pages)
    const derniere = pages[zones.signature.page - 1]!

    for (const [zone, intitule] of [
      [zones.signature, 'SIGNATURE'],
      [zones.date, 'DATE'],
    ] as const) {
      const legende = derniere.texts.find((t) => t.text === intitule)
      expect(legende, intitule).toBeDefined()
      // L'origine PDF est en bas : le haut du champ doit rester **sous** la
      // ligne de base de son intitulé.
      expect(zone.y + zone.hauteur, intitule).toBeLessThanOrEqual(legende!.y)
    }
  })

  it('ne peint pas les ancres : le client ne doit rien voir de plus', () => {
    const pages = layoutCraDocument(document(2))
    for (const t of pages.flatMap((p) => p.texts)) {
      if (t.text === ANCRE_SIGNATURE || t.text === ANCRE_DATE) {
        expect(t.invisible).toBe(true)
      }
    }
  })

  it('laisse les ancres dans la couche de texte du fichier livré', () => {
    // C'est tout l'intérêt : un outil à ancres les cherche là, et une simple
    // extraction doit les voir. Invisible ne veut pas dire absent.
    const octets = Buffer.from(renderPdf(layoutCraDocument(document(2)))).toString('latin1')
    expect(octets).toContain(ANCRE_SIGNATURE)
    expect(octets).toContain(ANCRE_DATE)
    // Et le mode de rendu qui les rend invisibles est bien émis.
    expect(octets).toContain('3 Tr')
  })

  it('refuse d’inventer une zone quand l’ancre manque', () => {
    const sansAncre: PdfPage[] = [{ texts: [], lines: [] }]
    expect(() => zonesSignature(sansAncre)).toThrow(/ancre/i)
  })
})
