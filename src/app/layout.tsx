import './globals.css'
import localFont from 'next/font/local'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { getThemeConfig } from '@/services/theme'
import { DEFAULT_THEME_CONFIG, type ThemeConfig } from '@/core/theme/tokens'
import { themeStylesheet } from '@/core/theme/css-vars'
import { RegisterServiceWorker } from '@/components/pwa/RegisterServiceWorker'

const inter = localFont({
  src: [
    { path: './fonts/inter-variable.woff2', style: 'normal' },
    { path: './fonts/inter-variable-italic.woff2', style: 'italic' },
  ],
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
})

const manrope = localFont({
  src: './fonts/manrope-variable.woff2',
  weight: '200 800',
  variable: '--font-manrope',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'CRA',
  manifest: '/manifest.webmanifest',
  // iOS ignore les icônes du manifeste : sans cette ligne, une application
  // ajoutée à l'écran d'accueil affiche une capture d'écran de la page.
  // Le PNG est produit à partir de `public/icon.svg` par
  // `scripts/generate-apple-touch-icon.mjs`.
  icons: { apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'CRA', statusBarStyle: 'default' },
}

/**
 * Le thème est un habillage : il ne fait jamais tomber la page. Le service est
 * tolérant au *contenu* de la colonne, mais l'appel lui-même peut jeter — base
 * injoignable, colonne ou table absente. Ce layout étant la racine, une telle
 * panne emporterait toutes les pages, `/login` compris, et l'exploitant
 * n'aurait plus d'écran pour diagnostiquer.
 */
async function lireConfig(): Promise<ThemeConfig> {
  try {
    return await getThemeConfig()
  } catch (err) {
    console.error('Thème illisible, repli sur la palette par défaut :', err)
    return DEFAULT_THEME_CONFIG
  }
}

/**
 * Lit le thème séparément de `RootLayout` : l'API Metadata de Next.js
 * appelle `generateViewport` et le composant de page indépendamment, sans
 * dédoublonnage entre eux. Même repli tolérant que `RootLayout` — un thème
 * illisible ne doit pas empêcher l'affichage de la coquille.
 */
export async function generateViewport(): Promise<Viewport> {
  const config = await lireConfig()

  // La couleur de la barre du navigateur ne peut pas recevoir de variable CSS
  // — c'est une valeur de méta-tag, pas une propriété stylée — d'où cette
  // lecture directe du jeton. En mode « système », elle se dédouble : le
  // méta-tag accepte une requête média, et c'est le seul moyen que la barre
  // suive le thème que la page vient d'appliquer. Un choix explicite n'en
  // produit qu'une : annoncer deux couleurs dont une ne s'appliquera jamais
  // ferait basculer la barre sans que la page bouge.
  const themeColor =
    config.mode === 'systeme'
      ? [
          { media: '(prefers-color-scheme: light)', color: config.clair.ink },
          { media: '(prefers-color-scheme: dark)', color: config.sombre.ink },
        ]
      : config[config.mode].ink

  return {
    themeColor,
    width: 'device-width',
    initialScale: 1,
    // Pas de `maximumScale` : brider le zoom rend l'application inutilisable
    // pour qui en a besoin.
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Le thème est lu à chaque rendu : l'enregistrer suffit à le voir appliqué,
  // sans reconstruction.
  const config = await lireConfig()

  return (
    <html lang="fr" className={`${inter.variable} ${manrope.variable}`}>
      <head>
        {/* Une feuille, et non plus un attribut `style` sur `<html>` : un
            attribut ne peut pas porter de requête média, et sans requête média
            « suivre la préférence du système » demanderait du JavaScript,
            donc un scintillement au chargement. Le texte injecté ne contient
            que des couleurs `#RRGGBB` — `themeStylesheet` omet tout le reste. */}
        <style dangerouslySetInnerHTML={{ __html: themeStylesheet(config) }} />
      </head>
      <body className="bg-page text-ink antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  )
}
