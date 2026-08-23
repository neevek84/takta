import { describe, it, expect } from 'vitest'
import {
  AUDIT_ACTIONS,
  isAuditAction,
  matchesSubscription,
  parseSubscription,
  serializeSubscription,
} from './events'

describe('catalogue des événements', () => {
  it('est exactement la liste de la spec, dans son ordre', () => {
    // Contrat public : renommer, retirer ou réordonner une valeur casse les
    // flux qui s'y abonnent. Le test fige la liste littéralement — c'est le
    // seul endroit du dépôt où elle est écrite deux fois, volontairement.
    //
    // Une seule divergence avec la table de la spec, et elle est délibérée :
    // `facture.demandee` n'existe plus. La demande de facture a été retirée du
    // produit (commit c1aeb8c) — Dolibarr facture depuis ses propres écrans et
    // son API REST n'expose pas l'action. À sa place, `facturation.renseignee`
    // consigne le suivi manuel porté par le CRA (numéro de facture, date de
    // facturation, date de paiement), qui, lui, subsiste.
    expect([...AUDIT_ACTIONS]).toEqual([
      'saisie.creee',
      'saisie.modifiee',
      'saisie.supprimee',
      'previsionnel.converti',
      'cra.ouvert',
      'cra.envoye',
      'cra.valide',
      'cra.refuse',
      'cra.rouvert',
      'facturation.renseignee',
      'client.cree',
      'mission.creee',
      'prestation.creee',
      'client.supprime',
      'mission.renommee',
      'mission.supprimee',
      'prestation.supprimee',
      'temps.pousses',
      'agenda.bloc.pousse',
      'agenda.conflit.detecte',
      'signature.envoyee',
      'signature.recue',
      'signature.refusee',
      'engagement.depasse',
      'capacite.depassee',
      'reglage.modifie',
      'reetalonnage.effectue',
      'synchro.echec',
      'travail.echoue',
    ])
  })

  it('en compte 29', () => {
    expect(AUDIT_ACTIONS).toHaveLength(29)
  })

  it('ne porte plus la demande de facture, retirée du produit', () => {
    // Un événement pour un acte qui n'existe plus serait une promesse fausse :
    // un intégrateur pourrait s'y abonner et attendre indéfiniment.
    expect([...AUDIT_ACTIONS]).not.toContain('facture.demandee')
    expect(isAuditAction('facture.demandee')).toBe(false)
  })

  it('n en répète aucun', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
  })

  it('les nomme en minuscules pointées', () => {
    // Un humain qui configure un flux doit pouvoir les lire et les taper.
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z]+(\.[a-z]+)+$/)
    }
  })

  it('reconnaît un nom du catalogue et rejette le reste', () => {
    expect(isAuditAction('cra.valide')).toBe(true)
    expect(isAuditAction('cra.validee')).toBe(false)
    expect(isAuditAction('')).toBe(false)
    expect(isAuditAction('CRA.VALIDE')).toBe(false)
  })
})

describe('filtrage par abonnement', () => {
  it('une liste vide reçoit tout', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(matchesSubscription('', action)).toBe(true)
    }
    expect(matchesSubscription('   ', 'cra.valide')).toBe(true)
  })

  it('un abonnement ciblé ne reçoit que ce qu il a demandé', () => {
    expect(matchesSubscription('cra.valide', 'cra.valide')).toBe(true)
    expect(matchesSubscription('cra.valide', 'saisie.creee')).toBe(false)
  })

  it('accepte plusieurs noms et tolère les espaces', () => {
    const souscrits = ' cra.valide , saisie.creee '
    expect(matchesSubscription(souscrits, 'cra.valide')).toBe(true)
    expect(matchesSubscription(souscrits, 'saisie.creee')).toBe(true)
    expect(matchesSubscription(souscrits, 'cra.refuse')).toBe(false)
  })

  it('ignore un nom hors catalogue sans lever', () => {
    expect(parseSubscription('cra.valide,cra.inexistant')).toEqual(['cra.valide'])
    expect(matchesSubscription('cra.valide,cra.inexistant', 'cra.valide')).toBe(true)
  })

  it('un abonnement fait uniquement de noms inconnus ne reçoit rien', () => {
    // Le repli sûr est le silence : traiter « je n ai reconnu aucun nom »
    // comme « tous les événements » inonderait une URL qui n a rien demandé.
    expect(matchesSubscription('cra.inexistant', 'cra.valide')).toBe(false)
    expect(matchesSubscription('cra.inexistant', 'saisie.creee')).toBe(false)
  })

  it('fait l aller-retour avec la forme persistée', () => {
    const actions = ['cra.valide', 'saisie.creee'] as const
    expect(serializeSubscription(actions)).toBe('cra.valide,saisie.creee')
    expect(parseSubscription(serializeSubscription(actions))).toEqual([...actions])
    expect(serializeSubscription([])).toBe('')
  })
})

/**
 * **Ce qui disparaît doit laisser une trace.**
 *
 * Le référentiel ne consignait que les créations : un client, une mission, une
 * prestation naissaient au journal et pouvaient en sortir sans un mot. Une
 * prestation et ses saisies — jusqu'à des heures déjà poussées chez Dolibarr et
 * figurant dans un CRA validé — pouvaient disparaître sans qu'aucun événement
 * ne le dise. Le porteur a tranché le 23 août 2026 : ces gestes laissent une
 * trace.
 */
describe('les actes destructeurs du référentiel', () => {
  it('sont au catalogue, avec leur création en miroir', () => {
    for (const paire of [
      ['client.cree', 'client.supprime'],
      ['mission.creee', 'mission.supprimee'],
      ['prestation.creee', 'prestation.supprimee'],
    ]) {
      expect([...AUDIT_ACTIONS]).toContain(paire[0])
      expect([...AUDIT_ACTIONS], `${paire[0]} n'a pas son miroir`).toContain(paire[1])
    }
  })

  // Renommer n'est pas anodin : le libellé d'une mission part dans le PDF
  // envoyé au client et nomme le projet chez Dolibarr.
  it('comptent le renommage d une mission', () => {
    expect([...AUDIT_ACTIONS]).toContain('mission.renommee')
  })

  /**
   * **L'archivage n'y est pas, et c'est délibéré.** Il est réversible et ne
   * détruit rien : l'objet, ses saisies et ses CRA restent entiers, et l'écran
   * *Données* les montre. Un catalogue qui grossit sans discipline devient
   * inutilisable pour celui qui doit choisir à quoi s'abonner.
   */
  it("n'ajoute pas d'événement pour l'archivage, qui ne détruit rien", () => {
    for (const nom of ['client.archive', 'mission.archivee', 'prestation.archivee']) {
      expect([...AUDIT_ACTIONS]).not.toContain(nom)
    }
  })
})
