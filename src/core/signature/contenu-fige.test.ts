import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import type { CraDocument } from '@/core/cra/document'
import { figerContenu, lireContenu } from './contenu-fige'

const ENGAGEMENT_VIDE = {} as CraDocument['engagementMission']

function documentDeTest(): CraDocument {
  return {
    emetteur: { nom: 'Kreativ', adresse: '1 rue', siret: '123', email: 'k@exemple.fr' },
    clientNom: 'Client',
    missionLabel: 'ITSM',
    mois: '2026-09',
    moisLibelle: 'septembre 2026',
    signataireNom: 'Jeanne Martin',
    signataireEmail: 'jeanne@client.test',
    lignes: [
      {
        label: 'Consultant',
        jours: [{ date: '2026-09-01', centiemes: 100 }],
        totalCentiemes: 100,
        engagement: ENGAGEMENT_VIDE,
      },
    ],
    totalCentiemes: 100,
    joursDuMois: ['2026-09-01'],
    feries: [],
    engagementMission: ENGAGEMENT_VIDE,
  }
}

describe('contenu figé', () => {
  it('relit exactement ce qui a été figé', () => {
    const doc = documentDeTest()
    const { json } = figerContenu(doc)
    expect(lireContenu(json)).toEqual(doc)
  })

  it("l'empreinte est le SHA-256 hexadécimal du JSON stocké", () => {
    const { json, empreinte } = figerContenu(documentDeTest())
    expect(empreinte).toBe(createHash('sha256').update(json, 'utf8').digest('hex'))
    expect(empreinte).toMatch(/^[0-9a-f]{64}$/)
  })

  it('deux documents identiques donnent la même empreinte, un jour de plus la change', () => {
    const a = figerContenu(documentDeTest()).empreinte
    const b = figerContenu(documentDeTest()).empreinte
    const autre = documentDeTest()
    autre.lignes[0]!.jours[0]!.centiemes = 50
    expect(a).toBe(b)
    expect(figerContenu(autre).empreinte).not.toBe(a)
  })

  it("refuse un JSON qui n'est pas un document de CRA", () => {
    expect(() => lireContenu('')).toThrow()
    expect(() => lireContenu('{"mois":"2026-09"}')).toThrow()
  })

  it('ne porte aucun champ monétaire', () => {
    const { json } = figerContenu(documentDeTest())
    expect(json).not.toMatch(/tjm|cents|montant|prix/i)
  })
})
