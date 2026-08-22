import { describe, it, expect } from 'vitest'
import { LICENCE, NOM, SOURCE_URL, version } from './identite'

/**
 * Ces contrôles ne portent pas sur du goût : l'adresse de la source est ce qui
 * acquitte l'application de l'**article 13 de l'AGPL**. Une adresse vide, ou
 * relative, ou en clair, ne remplit pas l'obligation — et rien à l'écran ne le
 * dirait, puisqu'un lien mort ressemble à un lien.
 */
describe("l'identité du produit", () => {
  it('se nomme takta', () => {
    expect(NOM).toBe('takta')
  })

  it('annonce sa licence', () => {
    expect(LICENCE).toContain('AGPL')
  })

  it("offre une adresse de source absolue et chiffrée", () => {
    // Absolue : un chemin relatif désignerait l'installation elle-même, qui ne
    // sert pas son propre code.
    expect(SOURCE_URL.startsWith('https://')).toBe(true)
    // Non vide au-delà du schéma : `https://` seul passerait le test précédent.
    expect(new URL(SOURCE_URL).hostname).not.toBe('')
  })

  // Un fork qui oublierait de changer cette adresse ferait dire à son
  // installation une chose fausse — que son code est ailleurs. On ne peut pas
  // l'empêcher par un test ; on peut au moins refuser qu'elle disparaisse.
  it("ne peut pas être vidée sans que rien ne le dise", () => {
    expect(SOURCE_URL.trim()).not.toBe('')
  })
})

describe('la version qui tourne', () => {
  // Le porteur ne pouvait pas savoir quelle version tournait sur son NAS :
  // Container Manager n'affiche que l'identifiant local de l'image, qui ne
  // correspond à aucune empreinte du registre.
  it('rend ce que la construction a figé', () => {
    const avant = process.env.TAKTA_VERSION
    process.env.TAKTA_VERSION = '1.2.3'
    expect(version()).toBe('1.2.3')
    if (avant === undefined) delete process.env.TAKTA_VERSION
    else process.env.TAKTA_VERSION = avant
  })

  // Une version fausse est pire qu'une version absente : l'écran n'affiche
  // alors rien plutôt que « inconnue », qui ressemble à une réponse.
  it("rend une chaîne vide quand rien n'a été figé", () => {
    const avant = process.env.TAKTA_VERSION
    delete process.env.TAKTA_VERSION
    expect(version()).toBe('')
    if (avant !== undefined) process.env.TAKTA_VERSION = avant
  })
})

