import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
const cible = join(racine, 'src', 'app', 'fonts')

// Sous-ensemble « latin » uniquement : il couvre le français, œ et ligatures
// comprises (U+0152-0153). Les sous-ensembles cyrillique, grec et vietnamien
// pèseraient sans rien servir.
const FICHIERS = [
  ['@fontsource-variable/inter', 'inter-latin-wght-normal.woff2', 'inter-variable.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-wght-italic.woff2', 'inter-variable-italic.woff2'],
  ['@fontsource-variable/manrope', 'manrope-latin-wght-normal.woff2', 'manrope-variable.woff2'],
]

mkdirSync(cible, { recursive: true })

for (const [paquet, source, destination] of FICHIERS) {
  const chemin = join(racine, 'node_modules', paquet, 'files', source)
  if (!existsSync(chemin)) {
    // Échouer bruyamment : une police manquante qui passerait inaperçue
    // ferait retomber l'application sur une police système, exactement ce
    // que ce lot cherche à éviter.
    throw new Error(`Police introuvable : ${chemin}. Lancez d'abord « npm install ».`)
  }
  copyFileSync(chemin, join(cible, destination))
  console.log(`${destination} ← ${paquet}/files/${source}`)
}
