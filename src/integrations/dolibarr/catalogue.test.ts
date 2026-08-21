import { describe, it, expect } from 'vitest'
import { cleAppel, verifierCatalogue } from '@/core/integrations/catalogue'
import { CATALOGUE_DOLIBARR } from './catalogue'

const AUJOURDHUI = new Date().toISOString().slice(0, 10)

describe('catalogue Dolibarr', () => {
  it('est en règle', () => {
    expect(verifierCatalogue(CATALOGUE_DOLIBARR, AUJOURDHUI)).toEqual([])
  })

  it('déclare exactement les vingt appels du client HTTP', () => {
    expect(CATALOGUE_DOLIBARR.appels.map(cleAppel).sort()).toEqual([
      'DELETE /tasks/{taskId}/timespent/{timespentId}',
      'GET /orders',
      'GET /orders/{orderId}',
      'GET /projects',
      'GET /projects/{projectId}',
      'GET /projects/{projectId}/contacts',
      'GET /projects/{projectId}/tasks',
      'GET /proposals/{proposalId}',
      'GET /setup/conf/{constante}',
      'GET /tasks/{taskId}/contacts',
      'GET /tasks/{taskId}/timespent',
      'GET /thirdparties',
      'POST /projects',
      'POST /projects/{projectId}/contacts',
      'POST /tasks',
      'POST /tasks/{taskId}/addtimespent',
      'POST /tasks/{taskId}/contacts',
      'POST /thirdparties',
      'PUT /orders/{orderId}',
      'PUT /tasks/{taskId}/timespent/{timespentId}',
    ])
  })

  it('n écrit sur un document commercial que le rattachement au projet', () => {
    // La seule écriture de l'application sur une commande. Un second champ
    // modifierait un document signé — et c'est ici qu'on s'en apercevrait.
    const lien = CATALOGUE_DOLIBARR.appels.find((a) => cleAppel(a) === 'PUT /orders/{orderId}')
    expect(lien?.parametres.map((p) => p.nom).sort()).toEqual(['fk_project', 'orderId'])
    expect(lien?.echec.comportement).toBe('TOLERE')
  })

  it('impose au projet créé d être facturable au temps', () => {
    const creation = CATALOGUE_DOLIBARR.appels.find((a) => cleAppel(a) === 'POST /projects')
    const drapeaux = creation?.parametres.filter((p) =>
      ['usage_task', 'usage_bill_time'].includes(p.nom),
    )
    expect(drapeaux?.map((p) => p.source)).toEqual(['CONSTANTE', 'CONSTANTE'])
  })

  it('ne catalogue aucun appel de facturation, le produit n en émettant plus', () => {
    const facturation = CATALOGUE_DOLIBARR.appels.filter((a) => a.gabarit.includes('/invoices'))
    expect(facturation).toEqual([])
  })

  it('rattache le push des temps au réglage qui change le sens de ses données', () => {
    const push = CATALOGUE_DOLIBARR.appels.find(
      (a) => cleAppel(a) === 'POST /tasks/{taskId}/addtimespent',
    )
    expect(push?.reglagesTiers).toContain('TIMESHEET_DAY_DURATION')
    expect(push?.echec.comportement).toBe('REJOUE')
  })

  it('dit d où vient la durée poussée, pour savoir quoi recalculer', () => {
    const push = CATALOGUE_DOLIBARR.appels.find(
      (a) => cleAppel(a) === 'POST /tasks/{taskId}/addtimespent',
    )
    const duration = push?.parametres.find((p) => p.nom === 'duration')
    expect(duration?.source).toBe('CALCUL')
    expect(duration?.origine).toContain('src/core/dolibarr/timespent.ts')
  })

  it('tolère l absence d un temps déjà supprimé', () => {
    const suppression = CATALOGUE_DOLIBARR.appels.find(
      (a) => cleAppel(a) === 'DELETE /tasks/{taskId}/timespent/{timespentId}',
    )
    expect(suppression?.echec.comportement).toBe('TOLERE')
  })

  it('prouve chaque appel contre la version relevée chez le porteur', () => {
    for (const appel of CATALOGUE_DOLIBARR.appels) {
      expect(appel.preuve.version).toBe('23.0.1')
    }
  })
})
