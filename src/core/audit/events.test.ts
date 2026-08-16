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

  it('en compte 25', () => {
    expect(AUDIT_ACTIONS).toHaveLength(25)
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
