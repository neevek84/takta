import { describe, expect, it } from 'vitest'
import { ENGAGEMENT_SOURCES } from '@/core/types'
import { engagementVerrouille, libelleEngagement } from './engagement'

describe('libelleEngagement', () => {
  it('nomme chaque source, sans trou', () => {
    // Le défaut d'origine : un ternaire « propale ou saisi ici » affichait
    // « saisi ici » pour une commande — le contraire de la vérité, sur le
    // chiffre qui sera facturé. Ce test tombe le jour où une source s'ajoute
    // sans son libellé.
    for (const source of ENGAGEMENT_SOURCES) {
      expect(libelleEngagement(source), source).toBeTruthy()
    }
  })

  it('distingue la commande de la propale', () => {
    expect(libelleEngagement('DOLIBARR_COMMANDE')).toBe('commande Dolibarr')
    expect(libelleEngagement('DOLIBARR_PROPALE')).toBe('propale Dolibarr')
    expect(libelleEngagement('MANUEL')).toBe('saisi ici')
  })
})

describe('engagementVerrouille', () => {
  it('verrouille tout ce qui vient de Dolibarr, et rien d’autre', () => {
    // Le verrou était écrit « source === DOLIBARR_PROPALE » à deux endroits.
    // Une prestation reprise d'une commande redevenait donc modifiable ici, et
    // ses jours vendus pouvaient diverger de la commande — sur les chiffres
    // qui seront facturés.
    expect(engagementVerrouille('MANUEL')).toBe(false)
    for (const source of ENGAGEMENT_SOURCES.filter((s) => s !== 'MANUEL')) {
      expect(engagementVerrouille(source), source).toBe(true)
    }
  })
})
