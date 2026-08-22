import { describe, it, expect } from 'vitest'
import { texteDepuisHtml } from './depuis-html'

describe('le texte lisible caché dans un fragment HTML', () => {
  // Le cas rapporté par le porteur, mot pour mot.
  it('rend lisible un libellé venu de l éditeur riche de Dolibarr', () => {
    expect(texteDepuisHtml('Déploiement FreshService.&nbsp;')).toBe('Déploiement FreshService.')
  })

  it('retire les balises sans coller les mots', () => {
    expect(texteDepuisHtml('<p>Audit</p><p>Reprise</p>')).toBe('Audit Reprise')
    expect(texteDepuisHtml('Audit<br>Reprise')).toBe('Audit Reprise')
    expect(texteDepuisHtml('<ul><li>Un</li><li>Deux</li></ul>')).toBe('Un Deux')
  })

  it('garde le texte porté par une balise, attributs compris', () => {
    expect(texteDepuisHtml('<span style="color:#fff">Audit</span> de sécurité')).toBe(
      'Audit de sécurité',
    )
  })

  it('décode les entités nommées et numériques', () => {
    expect(texteDepuisHtml('Ren&eacute; &amp; Cie')).toBe('René & Cie')
    expect(texteDepuisHtml('Ren&#233; &#x26; Cie')).toBe('René & Cie')
  })

  /**
   * **L'ordre n'est pas interchangeable.** Décoder avant de retirer ferait
   * renaître en balise ce qui était écrit `&lt;b&gt;` — et cette balise-là
   * survivrait, puisque plus rien ne passe derrière.
   */
  it('ne fait pas renaître une balise écrite en entités', () => {
    expect(texteDepuisHtml('&lt;b&gt;Audit&lt;/b&gt;')).toBe('<b>Audit</b>')
  })

  it('ramène les espaces à un seul et taille les bords', () => {
    expect(texteDepuisHtml('  Audit   \n\n de   sécurité  ')).toBe('Audit de sécurité')
  })

  // Un libellé mal formé ne doit pas faire tomber une reprise de commande.
  it('laisse tel quel ce qu il ne sait pas décoder', () => {
    expect(texteDepuisHtml('100&nbsp;% &inconnue; &#999999999;')).toBe('100 % &inconnue; &#999999999;')
  })

  it('rend une chaîne vide sans rien inventer', () => {
    expect(texteDepuisHtml('')).toBe('')
    expect(texteDepuisHtml('<p></p>')).toBe('')
  })

  // Le cas courant : la très grande majorité des libellés sont déjà du texte.
  it('ne touche pas à un libellé qui n a jamais vu de HTML', () => {
    expect(texteDepuisHtml('Prestation de conseil — juillet 2026')).toBe(
      'Prestation de conseil — juillet 2026',
    )
  })
})
