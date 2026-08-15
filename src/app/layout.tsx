import './globals.css'
import localFont from 'next/font/local'
import type { CSSProperties, ReactNode } from 'react'
import { getTheme } from '@/services/theme'
import { DEFAULT_THEME } from '@/core/theme/tokens'
import { themeToCssVars } from '@/core/theme/css-vars'

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

export const metadata = { title: 'CRA' }

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
      <body className="bg-page text-ink antialiased">{children}</body>
    </html>
  )
}
