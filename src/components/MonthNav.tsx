'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  const today = new Date().toISOString().slice(0, 7)

  function allerAuMois(value: string): void {
    if (value) router.push(`/saisie/${value}`)
  }

  return (
    <nav className="mb-4 flex items-center gap-2 text-sm">
      <Link
        href={`/saisie/${shiftMonth(month, -1)}`}
        aria-label="Mois précédent"
        className="rounded border px-2 py-1"
      >
        ←
      </Link>

      <span className="min-w-44 text-center font-medium">{monthLabel(month)}</span>

      <Link
        href={`/saisie/${shiftMonth(month, 1)}`}
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
        <Link href={`/saisie/${today}`} className="ml-2 rounded border px-2 py-1">
          Mois courant
        </Link>
      )}
    </nav>
  )
}
