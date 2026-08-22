import { describe, it, expect } from 'vitest'
import { origineDepuisEntetes, originePublique } from './origine'

function entetes(paires: Record<string, string>): (nom: string) => string | null {
  return (nom) => paires[nom] ?? null
}

describe("l'origine publique d'une requête", () => {
  it('suit le proxy plutôt que l hôte interne', () => {
    // Le cas réel : le conteneur voit `localhost:3000`, le visiteur a tapé son
    // domaine. Bâtir la redirection sur l'hôte interne l'envoie nulle part.
    expect(
      origineDepuisEntetes(
        entetes({ host: 'localhost:3000', 'x-forwarded-host': 'takta.exemple.fr' }),
      ),
    ).toBe('https://takta.exemple.fr')
  })

  it('coupe la chaîne de proxys au premier maillon', () => {
    expect(
      origineDepuisEntetes(entetes({ 'x-forwarded-host': 'takta.exemple.fr, interne.local' })),
    ).toBe('https://takta.exemple.fr')
  })

  it('respecte le protocole déclaré', () => {
    expect(
      origineDepuisEntetes(
        entetes({ 'x-forwarded-host': 'takta.exemple.fr', 'x-forwarded-proto': 'http' }),
      ),
    ).toBe('http://takta.exemple.fr')
  })

  // Un proxy muet sur le protocole parle en clair à son amont ; il ne dit pas
  // que le site est en clair. Supposer `http` ferait voyager un jeton de
  // réinitialisation en clair dans un courriel.
  it('suppose https quand rien n est déclaré, hors machine locale', () => {
    expect(origineDepuisEntetes(entetes({ host: 'takta.exemple.fr' }))).toBe(
      'https://takta.exemple.fr',
    )
  })

  it('reste en clair sur la machine locale, où il n y a pas de certificat', () => {
    for (const hote of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
      expect(origineDepuisEntetes(entetes({ host: hote })), hote).toBe(`http://${hote}`)
    }
  })

  // À l'appelant de choisir son repli : afficher une suggestion vide n'est pas
  // fabriquer un lien mort.
  it('rend une chaîne vide quand aucun hôte n est lisible', () => {
    expect(origineDepuisEntetes(entetes({}))).toBe('')
  })
})

describe("l'origine déclarée par l'exploitant", () => {
  // Le cas qui a mordu : un proxy qui réécrit `Host` avec l'adresse interne
  // sans poser `x-forwarded-host`. Le conteneur n'a alors aucun moyen de
  // deviner son adresse publique — il faut la lui dire.
  it("l'emporte sur des en-têtes qui ne connaissent que l'intérieur", () => {
    expect(
      originePublique('https://takta.ckle-it.eu', entetes({ host: '203f0699dc63:3000' })),
    ).toBe('https://takta.ckle-it.eu')
  })

  // Elle l'emporte aussi sur un en-tête de proxy : un en-tête se forge, une
  // variable d'environnement non.
  it("l'emporte sur l'en-tête du proxy", () => {
    expect(
      originePublique('https://takta.ckle-it.eu', entetes({ 'x-forwarded-host': 'attaquant.test' })),
    ).toBe('https://takta.ckle-it.eu')
  })

  it('ne garde que l origine, chemin compris dans la déclaration', () => {
    expect(originePublique('https://takta.ckle-it.eu/saisie', entetes({}))).toBe(
      'https://takta.ckle-it.eu',
    )
  })

  // Une valeur illisible ne doit pas faire tomber une redirection : les
  // en-têtes valent mieux que rien.
  it('retombe sur les en-têtes quand la déclaration est illisible', () => {
    expect(originePublique('pas-une-url', entetes({ host: 'takta.exemple.fr' }))).toBe(
      'https://takta.exemple.fr',
    )
  })

  it('retombe sur les en-têtes quand rien n est déclaré', () => {
    for (const vide of [undefined, '', '   ']) {
      expect(originePublique(vide, entetes({ host: 'takta.exemple.fr' }))).toBe(
        'https://takta.exemple.fr',
      )
    }
  })
})
