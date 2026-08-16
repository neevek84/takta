import { describe, it, expect } from 'vitest'
import { kindDeLaJournee } from './kind'

describe('kindDeLaJournee', () => {
  it('lit une journée comme prévisionnelle dès qu une seule de ses saisies l est', () => {
    expect(kindDeLaJournee(['REALISE', 'PREVISIONNEL'])).toBe('PREVISIONNEL')
  })

  it('ne dépend pas de l ordre des saisies', () => {
    expect(kindDeLaJournee(['PREVISIONNEL', 'REALISE'])).toBe('PREVISIONNEL')
  })

  it('ne lit comme réalisée qu une journée dont toutes les saisies le sont', () => {
    expect(kindDeLaJournee(['REALISE', 'REALISE', 'REALISE'])).toBe('REALISE')
  })

  it('lit une journée entièrement prévisionnelle comme prévisionnelle', () => {
    expect(kindDeLaJournee(['PREVISIONNEL'])).toBe('PREVISIONNEL')
  })

  it('tient une journée sans saisie pour réalisée : elle n a rien à convertir', () => {
    expect(kindDeLaJournee([])).toBe('REALISE')
  })
})
