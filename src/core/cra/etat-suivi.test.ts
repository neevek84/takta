import { describe, it, expect } from 'vitest'
import {
  ETATS_PAR_DEFAUT,
  ETATS_SUIVI,
  estFacture,
  etatSuivi,
  libelleEtat,
  parseEtats,
} from './etat-suivi'

const BASE = { status: 'VALIDE' as const, invoiceNumber: null, invoicedAt: null }

describe('etatSuivi', () => {
  it('rend le statut tel quel tant que rien n est facture', () => {
    expect(etatSuivi({ ...BASE, status: 'BROUILLON' })).toBe('BROUILLON')
    expect(etatSuivi({ ...BASE, status: 'ENVOYE' })).toBe('ENVOYE')
    expect(etatSuivi(BASE)).toBe('VALIDE')
    expect(etatSuivi({ ...BASE, status: 'REFUSE' })).toBe('REFUSE')
  })

  it('rend FACTURE des qu un numero ou une date de facturation est pose', () => {
    expect(etatSuivi({ ...BASE, invoiceNumber: 'F-2026-014' })).toBe('FACTURE')
    expect(etatSuivi({ ...BASE, invoicedAt: new Date('2026-04-02') })).toBe('FACTURE')
  })

  // Le suivi de facturation est saisi a la main, sur n'importe quel CRA. Un
  // brouillon portant un numero reste un brouillon : le cycle du document
  // n'est pas alle au bout, et le masquer par defaut le ferait disparaitre.
  it('ne facture que ce qui est valide', () => {
    expect(etatSuivi({ ...BASE, status: 'BROUILLON', invoiceNumber: 'F-1' })).toBe('BROUILLON')
  })

  // Facturer n'est pas encaisser. Un CRA facture impaye doit rester sous
  // « Facture » plutot que de creer une sixieme categorie que personne n'a
  // demandee.
  it('ignore la date de paiement', () => {
    expect(estFacture({ invoiceNumber: null, invoicedAt: null })).toBe(false)
  })

  it('traite la chaine vide comme une absence de numero', () => {
    expect(estFacture({ invoiceNumber: '', invoicedAt: null })).toBe(false)
  })
})

describe('parseEtats', () => {
  // L'absence de parametre vaut le defaut : un parametre qui ne dit rien de
  // plus que son absence encombrerait toutes les adresses.
  it('rend le defaut quand le parametre est absent', () => {
    expect(parseEtats(undefined)).toEqual([...ETATS_PAR_DEFAUT])
  })

  // Et la chaine vide vaut « rien de coche », qui est un choix de
  // l'utilisateur — pas la meme chose qu'une absence.
  it('rend une liste vide quand le parametre est vide', () => {
    expect(parseEtats('')).toEqual([])
  })

  it('lit les etats separes par des virgules', () => {
    expect(parseEtats('ENVOYE,FACTURE')).toEqual(['ENVOYE', 'FACTURE'])
  })

  it('ecarte ce qui n est pas un etat connu', () => {
    expect(parseEtats('ENVOYE,PIRATE')).toEqual(['ENVOYE'])
  })

  it('n a pas de doublon', () => {
    expect(parseEtats('ENVOYE,ENVOYE')).toEqual(['ENVOYE'])
  })
})

describe('le catalogue', () => {
  it('porte les cinq etats, dans l ordre du cycle', () => {
    expect([...ETATS_SUIVI]).toEqual(['BROUILLON', 'ENVOYE', 'VALIDE', 'REFUSE', 'FACTURE'])
  })

  // Ce que le porteur a demande : la liste s'allege de ce qui est alle au bout.
  it('masque par defaut ce qui est valide ou facture', () => {
    expect([...ETATS_PAR_DEFAUT]).toEqual(['BROUILLON', 'ENVOYE', 'REFUSE'])
  })

  it('nomme chaque etat en francais', () => {
    expect(ETATS_SUIVI.map(libelleEtat)).toEqual([
      'Brouillon',
      'Envoyé',
      'Validé',
      'Refusé',
      'Facturé',
    ])
  })
})
