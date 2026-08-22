import { describe, it, expect } from 'vitest'
import { LICENCE, NOM, SOURCE_URL } from './identite'

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
