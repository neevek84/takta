import { describe, it, expect } from 'vitest'
import { gabaritRappelSaisie, gabaritRappelCloture, gabaritRuptureJournal } from './templates'

describe('gabarits de notification', () => {
  it('rappelle les jours sans saisie, en français', () => {
    const g = gabaritRappelSaisie({ mois: '2026-08', jours: ['2026-08-03', '2026-08-04'] })
    expect(g.sujet).toBe('CRA — 2 jour(s) ouvré(s) sans saisie en 2026-08')
    expect(g.corps).toContain('2026-08-03')
    expect(g.corps).toContain('2026-08-04')
  })

  it('rappelle les CRA à clôturer avec leur état', () => {
    const g = gabaritRappelCloture({
      mois: '2026-07',
      missions: [
        { label: 'ITSM', etat: 'BROUILLON' },
        { label: 'Audit', etat: 'ABSENT' },
      ],
    })
    expect(g.sujet).toBe('CRA — 2 CRA à clôturer pour 2026-07')
    expect(g.corps).toContain('ITSM')
    expect(g.corps).toContain('BROUILLON')
    expect(g.corps).toContain('Audit')
  })

  it('annonce une rupture de chaîne avec l entrée en cause', () => {
    const g = gabaritRuptureJournal({ seq: 412, raison: 'EMPREINTE' })
    expect(g.sujet).toBe('CRA — rupture de la chaîne du journal à l’entrée 412')
    expect(g.corps).toContain('412')
    expect(g.corps).toContain('EMPREINTE')
  })

  it('n annonce rien d actionnable sans contenu', () => {
    // « Pas de notification pour ce qui n appelle aucune action » : les
    // gabarits refusent une liste vide plutôt que d envoyer du bruit.
    expect(() => gabaritRappelSaisie({ mois: '2026-08', jours: [] })).toThrow()
    expect(() => gabaritRappelCloture({ mois: '2026-07', missions: [] })).toThrow()
  })
})
