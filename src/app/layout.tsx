import './globals.css'
import localFont from 'next/font/local'
import type { Metadata, Viewport } from 'next'
import type { CSSProperties, ReactNode } from 'react'
import { getTheme } from '@/services/theme'
import { DEFAULT_THEME } from '@/core/theme/tokens'
import { themeToCssVars } from '@/core/theme/css-vars'
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
 * Lit le thème séparément de `RootLayout` : l'API Metadata de Next.js
 * appelle `generateViewport` et le composant de page indépendamment, sans
 * dédoublonnage entre eux. Même repli tolérant que `RootLayout` — un thème
 * illisible ne doit pas empêcher l'affichage de la coquille.
 */
export async function generateViewport(): Promise<Viewport> {
  let theme = DEFAULT_THEME
  try {
    theme = await getTheme()
  } catch (err) {
    console.error('Thème illisible, repli sur la palette par défaut :', err)
  }

  return {
    // La couleur de la barre d'état ne peut pas recevoir de variable CSS —
    // c'est une valeur de méta-tag, pas une propriété stylée — d'où cette
    // lecture directe du jeton plutôt qu'une couleur figée : elle continue de
    // suivre le thème enregistré, exactement comme les variables posées sur
    // `<html>` plus bas.
    themeColor: theme.ink,
    width: 'device-width',
    initialScale: 1,
    // Pas de `maximumScale` : brider le zoom rend l'application inutilisable
    // pour qui en a besoin.
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Le thème est lu à chaque rendu : l'enregistrer suffit à le voir appliqué,
  // sans reconstruction. Les variables posées ici l'emportent sur celles de
  // `@layer theme` produites par `@theme`.
  //
  // Le service est tolérant au *contenu* de la colonne, mais l'appel peut
  // jeter : base injoignable, colonne ou table absente. Ce layout étant la
  // racine, une telle panne emporterait toutes les pages, `/login` compris,
  // et l'exploitant n'aurait plus d'écran pour diagnostiquer. La règle « un
  // habillage ne fait jamais tomber la page » vaut donc aussi pour l'appel,
  // pas seulement pour ce qu'il lit.
  let theme = DEFAULT_THEME
  try {
    theme = await getTheme()
  } catch (err) {
    console.error('Thème illisible, repli sur la palette par défaut :', err)
  }

  return (
    <html
      lang="fr"
      className={`${inter.variable} ${manrope.variable}`}
      // React accepte les propriétés personnalisées ; le type CSSProperties
      // ne les décrit pas, d'où la conversion.
      style={themeToCssVars(theme) as CSSProperties}
    >
      <body className="bg-page text-ink antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  )
}
