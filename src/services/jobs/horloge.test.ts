import { describe, it, expect, vi, beforeEach } from 'vitest'
import { INTERVALLE_MS, arreterHorloge, demarrerHorloge } from './horloge'

beforeEach(() => {
  arreterHorloge()
})

/**
 * **L'application porte sa propre horloge.**
 *
 * Elle ne l'a pas toujours fait : l'ordonnanceur attendait qu'un déclencheur
 * extérieur appelle `POST /api/jobs/tick`, et le porteur a tranché — l'API
 * existe pour que d'autres outils viennent parler à l'application, pas pour
 * que l'application se fasse marcher elle-même. Une synchronisation qui ne
 * part que si quelqu'un a pensé à poser un cron n'est pas une fonction du
 * produit, c'est une note de bas de page.
 */
describe("l'horloge interne", () => {
  it('bat toutes les cinq minutes', () => {
    expect(INTERVALLE_MS).toBe(5 * 60_000)
  })

  it('réveille une première fois sans attendre son premier intervalle', async () => {
    const tick = vi.fn().mockResolvedValue({ horodatage: '', dus: 0, executes: [] })

    demarrerHorloge({ tick, planifier: () => 0 })
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1))

    // Sinon un conteneur qui vient de redémarrer laisse dormir cinq minutes ce
    // qui attendait déjà en file — et c'est précisément après un redémarrage
    // qu'il y a le plus à rattraper.
  })

  it('ne démarre qu une fois, quoi qu il arrive', () => {
    const planifier = vi.fn(() => 0)
    const muet = () => Promise.resolve({ horodatage: '', dus: 0, executes: [] })

    expect(demarrerHorloge({ tick: muet, planifier })).toBe(true)
    // Un second appel — rechargement à chaud en développement, module évalué
    // deux fois — doublerait le rythme sans que rien ne le dise.
    expect(demarrerHorloge({ tick: muet, planifier })).toBe(false)
    expect(planifier).toHaveBeenCalledTimes(1)
  })

  it("survit à un réveil qui échoue", async () => {
    const tick = vi.fn().mockRejectedValue(new Error('base injoignable'))
    const journal = vi.fn()

    demarrerHorloge({ tick, planifier: () => 0, journal })
    await vi.waitFor(() => expect(journal).toHaveBeenCalled())

    // Une base injoignable au démarrage ne doit pas emporter le serveur : sans
    // ce filet, une erreur non capturée dans un `setInterval` tue le processus.
    const [portee] = journal.mock.calls[0] as [string, unknown]
    expect(portee).toBe('horloge')
  })
})
