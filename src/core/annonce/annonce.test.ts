import { describe, it, expect } from 'vitest'
import { lireAnnonce } from './annonce'

describe('lireAnnonce', () => {
  it('relit une annonce bien formée', () => {
    expect(lireAnnonce(JSON.stringify({ id: 'a', message: 'Créé.', ton: 'danger' }))).toEqual({
      id: 'a',
      message: 'Créé.',
      ton: 'danger',
    })
  })

  it('retombe sur l’avertissement, jamais sur le succès, quand la tonalité est forgée', () => {
    expect(lireAnnonce(JSON.stringify({ id: 'a', message: 'Créé.', ton: 'rouge' }))?.ton).toBe(
      'warning',
    )
  })

  it('ignore un cookie absent, vide ou illisible', () => {
    expect(lireAnnonce(undefined)).toBeNull()
    expect(lireAnnonce('')).toBeNull()
    expect(lireAnnonce('{pas du json')).toBeNull()
    expect(lireAnnonce(JSON.stringify({ id: 'a', message: '' }))).toBeNull()
  })
})
