'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { shiftMonth } from '@/core/month/build'

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7))
  return `${MOIS[m - 1]} ${month.slice(0, 4)}`
}

export function MonthNav({ month }: { month: string }) {
  const router = useRouter()
  const parametres = useSearchParams()
  const today = new Date().toISOString().slice(0, 7)

  /**
   * **Changer de mois ne doit rien effacer de ce qu'on regarde.**
   *
   * Chaque mois est une route à part : l'état des composants ne survit pas à
   * la navigation. Travailler en tableau multi-CRA et retomber en calendrier
   * au mois suivant, c'est ce qui arrivait. Ce qu'on regarde vit donc dans
   * l'adresse, et l'adresse se reporte ici — sur les flèches, sur le retour au
   * mois courant, et sur le choix direct.
   *
   * La chaîne vide plutôt qu'un `?` seul : un point d'interrogation orphelin
   * dans la barre d'adresse donne l'air d'un lien fabriqué à la main.
   */
  const suffixe = parametres.toString() === '' ? '' : `?${parametres.toString()}`

  function allerAuMois(value: string): void {
    if (value) router.push(`/saisie/${value}${suffixe}`)
  }

  return (
    <nav className="mb-4 flex items-center gap-2 text-sm">
      <Link
        href={`/saisie/${shiftMonth(month, -1)}${suffixe}`}
        aria-label="Mois précédent"
        className="rounded border px-2 py-1"
      >
        ←
      </Link>

      <span className="min-w-44 text-center font-medium">{monthLabel(month)}</span>

      <Link
        href={`/saisie/${shiftMonth(month, 1)}${suffixe}`}
        aria-label="Mois suivant"
        className="rounded border px-2 py-1"
      >
        →
      </Link>

      <input
        type="month"
        aria-label="Aller directement à un mois"
        value={month}
        onChange={(e) => allerAuMois(e.target.value)}
        className="ml-1 rounded border px-2 py-1"
      />

      {month !== today && (
        <Link href={`/saisie/${today}${suffixe}`} className="ml-2 rounded border px-2 py-1">
          Mois courant
        </Link>
      )}
    </nav>
  )
}
