import { readFileSync } from 'node:fs'
import type { NextConfig } from 'next'

/**
 * La version, lue dans `package.json` **au moment de la construction**.
 *
 * **Pourquoi elle est indispensable.** Une image déployée ne dit pas ce
 * qu'elle est : Container Manager affiche l'identifiant local de l'image, qui
 * n'est comparable à rien du registre. Le porteur ne pouvait donc pas savoir
 * quelle version tournait chez lui — ni pour vérifier une mise à jour, ni pour
 * décrire un défaut.
 *
 * Lue ici et non importée : `import pkg from '../package.json'` embarquerait le
 * fichier entier dans le paquet client, dépendances comprises.
 */
const version = JSON.parse(readFileSync('./package.json', 'utf8')).version as string

// `distDir` est paramétrable pour que l'empaquetage (scripts/empaqueter.mjs)
// construise dans un dossier à part et n'écrase jamais le cache `.next` du
// serveur de développement — piège documenté dans docs/superpowers/ETAT.md §7.
// Sans la variable, rien ne change : ni pour `npm run dev`, ni pour Docker.
const config: NextConfig = {
  output: 'standalone',
  distDir: process.env.CRA_DIST_DIR ?? '.next',
  // Figée à la construction : c'est la version de l'image, pas celle du dépôt
  // où elle tourne.
  env: { TAKTA_VERSION: version },
}

export default config
