import './globals.css'
import type { ReactNode } from 'react'

export const metadata = { title: 'CRA' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  )
}
