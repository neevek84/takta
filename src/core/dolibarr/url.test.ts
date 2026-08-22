import { describe, expect, it } from 'vitest'
import { baseApiDepuisInstance, instanceDepuisBaseApi } from './url'

describe('baseApiDepuisInstance', () => {
  it('ajoute le chemin de l’API, qui est le même sur tous les Dolibarr', () => {
    expect(baseApiDepuisInstance('https://erp.exemple.test')).toBe(
      'https://erp.exemple.test/api/index.php',
    )
  })

  it('supporte une instance installée dans un sous-répertoire', () => {
    expect(baseApiDepuisInstance('https://exemple.test/dolibarr')).toBe(
      'https://exemple.test/dolibarr/api/index.php',
    )
  })

  it('ne redouble pas le chemin quand on lui donne déjà l’URL complète', () => {
    expect(baseApiDepuisInstance('https://erp.exemple.test/api/index.php')).toBe(
      'https://erp.exemple.test/api/index.php',
    )
  })

  it('complète une URL arrêtée à /api', () => {
    expect(baseApiDepuisInstance('https://erp.exemple.test/api')).toBe(
      'https://erp.exemple.test/api/index.php',
    )
  })

  it('absorbe les barres obliques en trop', () => {
    expect(baseApiDepuisInstance('  https://erp.exemple.test///  ')).toBe(
      'https://erp.exemple.test/api/index.php',
    )
    expect(baseApiDepuisInstance('https://erp.exemple.test/api/index.php/')).toBe(
      'https://erp.exemple.test/api/index.php',
    )
  })

  it('suppose https quand le protocole manque : personne ne tape le sien', () => {
    expect(baseApiDepuisInstance('erp.exemple.test')).toBe('https://erp.exemple.test/api/index.php')
  })

  it('garde le port, que les instances locales portent souvent', () => {
    expect(baseApiDepuisInstance('http://localhost:8080')).toBe(
      'http://localhost:8080/api/index.php',
    )
  })

  it('jette la requête et l’ancre : elles casseraient tous les chemins suivants', () => {
    expect(baseApiDepuisInstance('https://erp.exemple.test/?onglet=3#haut')).toBe(
      'https://erp.exemple.test/api/index.php',
    )
  })

  it('jette un identifiant glissé dans l’URL plutôt que de l’envoyer à chaque appel', () => {
    expect(baseApiDepuisInstance('https://kev:motdepasse@erp.exemple.test')).toBe(
      'https://erp.exemple.test/api/index.php',
    )
  })

  it('refuse ce qui n’est pas une adresse web', () => {
    expect(() => baseApiDepuisInstance('')).toThrow(/requise/i)
    expect(() => baseApiDepuisInstance('   ')).toThrow(/requise/i)
    expect(() => baseApiDepuisInstance('ftp://erp.exemple.test')).toThrow(/https/i)
    expect(() => baseApiDepuisInstance('n’importe quoi')).toThrow(/adresse/i)
  })
})

describe('instanceDepuisBaseApi', () => {
  it('rend l’URL que l’utilisateur a saisie, pour la lui réafficher', () => {
    expect(instanceDepuisBaseApi('https://erp.exemple.test/api/index.php')).toBe(
      'https://erp.exemple.test',
    )
    expect(instanceDepuisBaseApi('https://exemple.test/dolibarr/api/index.php')).toBe(
      'https://exemple.test/dolibarr',
    )
  })

  it('laisse passer ce qui ne porte pas le chemin de l’API', () => {
    expect(instanceDepuisBaseApi('https://erp.exemple.test')).toBe('https://erp.exemple.test')
    expect(instanceDepuisBaseApi('')).toBe('')
  })

  it('fait l’aller-retour sans rien perdre', () => {
    for (const saisie of [
      'https://erp.exemple.test',
      'https://exemple.test/dolibarr',
      'http://localhost:8080',
    ]) {
      expect(instanceDepuisBaseApi(baseApiDepuisInstance(saisie))).toBe(saisie)
    }
  })
})
