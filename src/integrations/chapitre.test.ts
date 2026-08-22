import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CHEMIN_CHAPITRE, construireChapitre } from './chapitre'

const fichier = path.resolve(process.cwd(), CHEMIN_CHAPITRE)

describe('docs/integrations.md', () => {
  it('est exactement ce que la génération produit', () => {
    const attendu = construireChapitre()

    // Mode écriture : `npm run doc:integrations`. Le test devient alors la
    // génération elle-même — un seul chemin de code, donc aucun écart
    // possible entre ce qui écrit et ce qui vérifie.
    if (process.env.CRA_DOC_ECRIRE === '1') {
      writeFileSync(fichier, attendu, 'utf8')
      return
    }

    const publie = readFileSync(fichier, 'utf8')
    expect(publie).toBe(attendu)
  })

  it('ne porte aucun secret, même factice', () => {
    expect(readFileSync(fichier, 'utf8')).not.toMatch(/ya29\.|1\/\/[A-Za-z0-9_-]{15,}/)
  })

  it('couvre les deux systèmes', () => {
    const publie = readFileSync(fichier, 'utf8')
    expect(publie).toContain('## Dolibarr')
    expect(publie).toContain('## Google Calendar')
  })
})

describe('procédure de montée de version', () => {
  const publie = (): string => readFileSync(fichier, 'utf8')

  it('dit ce qui tient lieu de preuve contre une instance réelle', () => {
    const texte = publie()
    // Le lot 2 avait prévu une suite sur instance jetable ; elle n'a pas été
    // livrée. Le chapitre le dit et renvoie à ce qui existe vraiment.
    expect(texte).toContain('docs/superpowers/reviews/2026-08-18-recette-dolibarr.md')
    expect(texte).toContain('instance jetable')
  })

  it('n invente aucune commande de test d intégration', () => {
    // Le garde de la tâche 14 le vérifierait aussi ; ici on fige la raison.
    expect(publie()).not.toMatch(/npm run test:(integration:)?dolibarr/)
  })

  it('dit ce qu on fait de ce qui passe et de ce qui casse', () => {
    const texte = publie()
    expect(texte).toContain('met à jour sa version et sa date dans le catalogue')
    expect(texte).toContain("nommé avec l'appel et le champ fautifs")
  })

  it('dit que TIMESHEET_DAY_DURATION s aligne et ne se compense pas', () => {
    const texte = publie()
    expect(texte).toContain('Cela s’aligne ; cela ne se compense pas.')
    expect(texte).toContain('`duration` est un nombre de secondes')
  })

  it('ne répète pas l affirmation fausse du septième', () => {
    expect(publie()).not.toMatch(/septième|1\/7/)
  })
})
