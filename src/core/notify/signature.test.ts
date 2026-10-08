import { describe, it, expect } from 'vitest'
import {
  gabaritAnnulationClient,
  gabaritCodeClient,
  gabaritEnvoiClient,
  gabaritRefusClient,
  gabaritRefusConsultant,
  gabaritRelanceClient,
  gabaritValideClient,
  gabaritValideConsultant,
} from './signature'

const base = {
  clientNom: 'Client SA',
  missionLabel: 'ITSM',
  moisLibelle: 'septembre 2026',
  signataireNom: 'Jeanne Martin',
}

describe('gabarits du circuit de signature', () => {
  it("l'envoi porte le lien et le mois", () => {
    const g = gabaritEnvoiClient({ ...base, lien: 'https://cra.test/v/abc' })
    expect(g.sujet).toContain('septembre 2026')
    expect(g.corps).toContain('https://cra.test/v/abc')
  })

  it('le code porte le code et sa durée', () => {
    const g = gabaritCodeClient({ code: '042317', minutes: 10 })
    expect(g.corps).toContain('042317')
    expect(g.corps).toContain('10 minutes')
    expect(g.sujet).not.toContain('042317')
  })

  it('le refus porte le motif, chez le consultant comme chez le client', () => {
    const motif = 'Il manque la journée du 15.'
    expect(gabaritRefusConsultant({ ...base, motif, lienCra: 'https://cra.test/cra/1' }).corps).toContain(motif)
    expect(gabaritRefusClient({ ...base, motif }).corps).toContain(motif)
  })

  it('la validation dit si le PDF est joint ou non', () => {
    expect(gabaritValideConsultant({ ...base, pdfJoint: true }).corps).toContain('joint')
    expect(gabaritValideClient({ ...base, pdfJoint: false }).corps).toContain('pas encore disponible')
  })

  it("l'annulation et la relance se lisent sans contexte", () => {
    expect(gabaritAnnulationClient(base).corps).toContain('retiré')
    expect(gabaritRelanceClient({ ...base, lien: 'https://cra.test/v/abc' }).corps).toContain('https://cra.test/v/abc')
  })

  it("aucun gabarit n'évoque un montant", () => {
    const tous = [
      gabaritEnvoiClient({ ...base, lien: 'x' }),
      gabaritValideClient({ ...base, pdfJoint: true }),
      gabaritValideConsultant({ ...base, pdfJoint: true }),
      gabaritRefusClient({ ...base, motif: 'm' }),
      gabaritRefusConsultant({ ...base, motif: 'm', lienCra: 'x' }),
      gabaritAnnulationClient(base),
      gabaritRelanceClient({ ...base, lien: 'x' }),
    ]
    for (const g of tous) expect(`${g.sujet}\n${g.corps}`).not.toMatch(/€|montant|tarif|TJM/i)
  })
})
