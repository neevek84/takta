import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Un compte créé sans rôle explicite reçoit `ADMIN`, qui est le défaut de la
 * colonne. C'est arrivé : la reprise des temps Dolibarr fabriquait des
 * administrateurs à chaque auteur importé, sans que rien ne le signale.
 *
 * Corriger les appels connus laisserait le prochain répéter le défaut. Ce
 * contrôle refuse donc la **forme**, à la manière de `src/frontieres.test.ts`.
 */
const RACINE = join(process.cwd(), 'src')

function sources(dossier: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, e.name)
    if (e.isDirectory()) out.push(...sources(chemin))
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(chemin)
  }
  return out
}

describe('la création d un utilisateur nomme toujours son rôle', () => {
  it('n a aucun prisma.user.create muet', () => {
    const fautifs: string[] = []

    for (const fichier of sources(RACINE)) {
      const contenu = readFileSync(fichier, 'utf8')
      // On découpe sur l'appel, puis on lit les 400 caractères qui suivent :
      // assez pour couvrir un objet `data` sur plusieurs lignes, trop peu pour
      // attraper le `role` d'un appel voisin.
      const morceaux = contenu.split(/prisma\.user\.create\s*\(/).slice(1)
      for (const morceau of morceaux) {
        if (!/\brole\s*:/.test(morceau.slice(0, 400))) {
          fautifs.push(relative(process.cwd(), fichier))
        }
      }
    }

    expect(fautifs, `${fautifs.join(', ')} crée(nt) un utilisateur sans dire son rôle`).toEqual([])
  })
})
