import type { NextConfig } from 'next'

// `distDir` est paramétrable pour que l'empaquetage (scripts/empaqueter.mjs)
// construise dans un dossier à part et n'écrase jamais le cache `.next` du
// serveur de développement — piège documenté dans docs/superpowers/ETAT.md §7.
// Sans la variable, rien ne change : ni pour `npm run dev`, ni pour Docker.
const config: NextConfig = {
  output: 'standalone',
  distDir: process.env.CRA_DIST_DIR ?? '.next',
}

export default config
