import { describe, it, expect } from 'vitest'
import { comparerCouverture } from '@/core/integrations/catalogue'
import { createHttpDolibarrApi } from '@/services/dolibarr/http'
import { CATALOGUE_DOLIBARR } from './catalogue'
import { BASE_FACTICE, createFakeDolibarrHttp } from './fake-dolibarr-http'

/**
 * Exerce **toutes** les opérations du client. Ajouter une entrée au catalogue
 * sans l'exercer ici fait échouer le test ; c'est le seul moyen d'empêcher un
 * catalogue de décrire des appels que l'application n'émet pas.
 *
 * Aucune opération de facturation n'y figure : l'application n'en émet plus
 * (voir `DolibarrApi`, `src/services/dolibarr/api.ts`). C'est justement le
 * genre d'erreur qu'un catalogue engendré depuis le code ne peut pas porter —
 * si une entrée de facture réapparaissait au catalogue, `manquants` la
 * nommerait ici.
 */
async function exercerTout(): Promise<string[]> {
  const faux = createFakeDolibarrHttp()
  const api = createHttpDolibarrApi({
    baseUrl: BASE_FACTICE,
    apiKey: 'cle-factice',
    fetchImpl: faux.fetchImpl,
  })

  const tiers = faux.seedThirdparty('Client Exemple')
  const projet = faux.seedProject({ ref: 'PJ001', title: 'Exemple', socid: tiers.id })
  const propale = faux.seedProposal({
    ref: 'PR001',
    socid: tiers.id,
    lines: [{ label: 'Conseil', qty: 10, subpriceEuros: 800 }],
  })
  faux.seedSetup('TIMESHEET_DAY_DURATION', '7')
  const commande = faux.seedOrder({
    ref: 'CO-EXEMPLE',
    socid: tiers.id,
    refClient: 'BDC-EXEMPLE',
    label: 'Libellé de la commande',
    lines: [{ label: 'Conseil', qty: 10, subpriceEuros: 800 }],
  })

  await api.listThirdparties()
  await api.createThirdparty('Autre Client Exemple')
  await api.listProjects()
  await api.listTasks(projet.id)
  const tache = await api.createTask({ projectId: projet.id, label: 'Conseil' })
  await api.getProposal(propale.id)
  await api.listOrders()
  await api.getOrder(commande.id)
  const projetCree = await api.createProject({
    socid: tiers.id,
    ref: 'CO-EXEMPLE',
    title: 'BDC-EXEMPLE — Libellé de la commande',
    refExt: 'BDC-EXEMPLE',
    description: 'Projet ouvert depuis la commande CO-EXEMPLE.',
  })
  await api.linkOrderToProject({ orderId: commande.id, projectId: projetCree.id })
  const { timespentId } = await api.addTimeSpent({
    taskId: tache.id,
    dolibarrUserId: 42,
    date: '2026-04-13',
    durationSeconds: 28800,
    note: 'Atelier de cadrage',
  })
  await api.updateTimeSpent({
    taskId: tache.id,
    timespentId,
    date: '2026-04-13',
    durationSeconds: 25200,
    note: 'Atelier de cadrage',
  })
  await api.deleteTimeSpent({ taskId: tache.id, timespentId })
  await api.getSetupValue('TIMESHEET_DAY_DURATION')

  return faux.gabaritsObserves
}

describe('couverture du catalogue Dolibarr', () => {
  it('n a aucune entrée que rien n exerce', async () => {
    const { manquants, inconnus } = comparerCouverture({
      catalogue: CATALOGUE_DOLIBARR,
      observes: await exercerTout(),
    })
    expect(manquants).toEqual([])
    expect(inconnus).toEqual([])
  })
})
