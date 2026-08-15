import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(process.cwd(), 'src')
const DOSSIER = join(RACINE, 'app', 'fonts')

const ATTENDUS = ['inter-variable.woff2', 'inter-variable-italic.woff2', 'manrope-variable.woff2']

function fichiersSource(dossier: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) out.push(...fichiersSource(chemin))
    // Les fichiers de test sont exclus : celui-ci contient les chaînes
    // recherchées, et se trouverait lui-même.
    else if (/\.(ts|tsx|css)$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) {
      out.push(chemin)
    }
  }
  return out
}

describe('polices embarquées', () => {
  it('livre les trois fichiers dans le dépôt', () => {
    for (const nom of ATTENDUS) {
      const chemin = join(DOSSIER, nom)
      expect(statSync(chemin).size, nom).toBeGreaterThan(10_000)
    }
  })

  it('livre de vrais woff2, pas des marqueurs vides', () => {
    for (const nom of ATTENDUS) {
      // Signature du conteneur WOFF2 : les quatre premiers octets valent « wOF2 ».
      const entete = readFileSync(join(DOSSIER, nom)).subarray(0, 4).toString('latin1')
      expect(entete, nom).toBe('wOF2')
    }
  })

  it('ne charge aucune police depuis un service tiers', () => {
    const fautifs = fichiersSource(RACINE).filter((chemin) => {
      const contenu = readFileSync(chemin, 'utf8')
      return (
        contenu.includes('fonts.googleapis.com') ||
        contenu.includes('fonts.gstatic.com') ||
        contenu.includes('next/font/google')
      )
    })
    expect(fautifs).toEqual([])
  })
})
