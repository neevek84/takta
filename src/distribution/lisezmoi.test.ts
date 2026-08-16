import { describe, it, expect } from 'vitest'
import { texteLisezmoi } from '../../outils/lib/lisezmoi.mjs'

const texte = texteLisezmoi({ plateforme: 'macOS Apple Silicon', version: '1.0.0' })

// Le corps du LISEZMOI est volontairement sans accent : un .txt ouvert dans le
// Bloc-notes Windows en encodage local afficherait sinon des caracteres abimes.
// Les fragments cherches ici sont donc ceux du texte reel, sans accent.
describe('LISEZMOI', () => {
  it('dit noir sur blanc que l arrêt ne perd rien', () => {
    // C'est la phrase du lot. Sans elle, on n'ose pas éteindre, et une
    // application qu'on n'ose pas éteindre est inutilisable.
    expect(texte).toContain('ne perd aucune donnee')
    expect(texte).toContain('a chaque saisie validee')
  })

  it('commence par le prérequis Node, avec la commande pour le vérifier', () => {
    const avantDemarrer = texte.slice(0, texte.indexOf('./demarrer.sh'))
    expect(avantDemarrer).toContain('Node.js 20')
    expect(avantDemarrer).toContain('node -v')
  })

  it('suit l ordre des questions qu on se pose après avoir dézippé', () => {
    const positions = [
      texte.indexOf('node -v'),
      texte.indexOf('./demarrer.sh'),
      texte.indexOf('./arreter.sh'),
      texte.indexOf('dossier donnees/'),
      texte.indexOf('ne perd aucune donnee'),
      texte.indexOf('METTRE A JOUR'),
      texte.indexOf("SI LE NAVIGATEUR NE S'OUVRE PAS"),
    ]
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('dit que copier donnees/ suffit à tout sauvegarder', () => {
    expect(texte).toMatch(/copier[^.]*donnees[^.]*sauvegarder/i)
  })

  it('donne les quatre étapes de mise à jour, dans l ordre', () => {
    const maj = texte.slice(texte.indexOf('METTRE A JOUR'))
    const etapes = ['1. ./arreter.sh', '2. dezippe', '3. copie', '4. ./demarrer.sh']
    let curseur = -1
    for (const e of etapes) {
      const p = maj.indexOf(e)
      expect(p, `étape « ${e} » absente ou dans le désordre`).toBeGreaterThan(curseur)
      curseur = p
    }
    expect(maj).toContain('dossier neuf')
  })

  it('affirme que l archive ne contient pas donnees/', () => {
    expect(texte).toContain("L'archive ne contient jamais de dossier donnees/")
  })

  it('nomme la plateforme de cette archive-ci', () => {
    expect(texte).toContain('macOS Apple Silicon')
    expect(texteLisezmoi({ plateforme: 'Windows x64', version: '1.0.0' })).toContain('Windows x64')
  })

  it('donne les commandes Windows à côté des commandes POSIX', () => {
    expect(texte).toContain('demarrer.cmd')
    expect(texte).toContain('arreter.cmd')
  })

  it('explique le port, et ce qu un port différent casse chez Google', () => {
    // Un port qui change casse l'URL de retour enregistrée chez Google, et
    // l'erreur vient alors de Google, pas de l'application : le mode d'emploi
    // doit nommer la cause et dire où lire l'URL exacte à ré-enregistrer.
    const port = texte.slice(texte.indexOf('PORT'))
    expect(texte).toContain('3000')
    expect(port).toContain('Google')
    expect(port).toContain('/api/google/callback')
    expect(port).toContain('GOOGLE_REDIRECT_URI')
    expect(port).toContain('donnees/cra.env')
    // L'adresse exacte n'est jamais à deviner : elle est affichée au démarrage.
    expect(port).toMatch(/affich/i)
  })

  it('donne le moyen d imposer un port fixe', () => {
    // Sans cela, quelqu'un dont le 3000 est durablement pris n'a aucun moyen
    // de retrouver une URL de retour Google stable.
    expect(texte).toContain('CRA_PORT')
  })

  it('tient sur un écran', () => {
    // La spec le demande. Au-delà de 80 lignes, plus personne ne le lit.
    expect(texte.split('\n').length).toBeLessThanOrEqual(80)
  })
})
