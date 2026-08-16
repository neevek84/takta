import { describe, it, expect } from 'vitest'
import { cleAppel, verifierCatalogue } from '@/core/integrations/catalogue'
import { CATALOGUE_DOLIBARR } from './catalogue'

const AUJOURDHUI = new Date().toISOString().slice(0, 10)

describe('catalogue Dolibarr', () => {
  it('est en règle', () => {
    expect(verifierCatalogue(CATALOGUE_DOLIBARR, AUJOURDHUI)).toEqual([])
  })

  it('déclare exactement les dix appels du client HTTP', () => {
    expect(CATALOGUE_DOLIBARR.appels.map(cleAppel).sort()).toEqual([
      'DELETE /tasks/{taskId}/timespent/{timespentId}',
      'GET /projects',
      'GET /projects/{projectId}/tasks',
      'GET /proposals/{proposalId}',
      'GET /setup/conf/{constante}',
      'GET /thirdparties',
      'POST /tasks',
      'POST /tasks/{taskId}/addtimespent',
      'POST /thirdparties',
      'PUT /tasks/{taskId}/timespent/{timespentId}',
    ])
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
