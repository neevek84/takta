import './globals.css'
import localFont from 'next/font/local'
import type { CSSProperties, ReactNode } from 'react'
// `getTheme` vit dans `@/services/settings` (tâche 5) et non dans
// `@/services/theme` : l'agent de la tâche 5 avait un périmètre restreint à
// `settings.ts` et a intégré le code du brief là plutôt que dans un nouveau
// fichier. Voir task-5-report.md.
import { getTheme } from '@/services/settings'
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
  const theme = await getTheme()

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
