// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TotalsRow } from './TotalsRow'
import { buildMonthDays } from '@/core/month/build'
import { checkCapacity } from '@/core/capacity/check'
import type { CapacityMode } from '@/core/types'
import type { MonthEntry } from '@/services/time-entries'

/**
 * La ligne Total et le contrôle de capacité du service parlent de la même
 * journée : ils doivent en dire la même chose. Chaque test compare donc
 * l'affichage au verdict que `checkCapacity` rend sur les mêmes saisies —
 * jamais à un chiffre recalculé ici avec un facteur global, qui est exactement
 * l'erreur corrigée.
 */

const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])
const JOUR = '2026-03-12'
const CAP = 100 // une journée

let compteur = 0
function saisie(minutes: number, minutesParJour: number): MonthEntry {
  compteur += 1
  return {
    id: `e${compteur}`,
    lineId: 'l1',
    date: JOUR,
    minutes,
    kind: 'REALISE',
    // Bornes figées : la ligne de totaux ne les lit pas, le type les exige.
    startMinute: 540,
    endMinute: 1020,
    slotId: '',
    minutesParJour,
  }
}

function afficher(
  entries: MonthEntry[],
  capacityCentiemes = CAP,
  capacityMode: CapacityMode = 'BLOCAGE',
): HTMLElement {
  render(
    <table>
      <tbody>
        <TotalsRow
          days={days}
          entries={entries}
          capacityCentiemes={capacityCentiemes}
          capacityMode={capacityMode}
        />
      </tbody>
    </table>,
  )
  return screen.getByTestId(`total-${JOUR}`)
}

function verdict(
  entries: MonthEntry[],
  capacityCentiemes = CAP,
  mode: CapacityMode = 'BLOCAGE',
): boolean {
  const v = checkCapacity({
    existing: entries,
    added: [],
    capacityCentiemes,
    mode,
  })
  return v.ok
}

describe('TotalsRow', () => {
  afterEach(cleanup)

  it('convertit chaque saisie au facteur figé à son écriture', () => {
    // 590 minutes chez un client dont la journée fait 600 minutes : 0,98 j.
    // Converties au facteur global (480), elles afficheraient 1,23 j et
    // porteraient un « ! » que le service ne pose pas.
    const entries = [saisie(350, 600), saisie(240, 600)]
    const total = afficher(entries)

    expect(total.textContent).toBe('0,98')
    expect(total.getAttribute('data-depassement')).toBe('false')
    expect(verdict(entries)).toBe(true)
  })

  it('somme les conversions par facteur sur une journée qui en mêle deux', () => {
    // 330 min à 420 (79) + 150 min à 600 (25) = 104 centièmes. La somme brute
    // des minutes vaut 480 : convertie en une fois au facteur global, elle
    // afficherait 1 j tout rond et laisserait passer le dépassement.
    const entries = [saisie(200, 420), saisie(130, 420), saisie(150, 600)]
    const total = afficher(entries)

    expect(total.textContent).toContain('1,04')
    expect(total.getAttribute('data-depassement')).toBe('true')
    expect(verdict(entries)).toBe(false)
  })

  it('marque le dépassement à la minute près, comme le service', () => {
    // 481 minutes sur une journée de 480 : le dépassement ne pèse pas un
    // centième entier, mais il est réel. Comparer des centièmes arrondis
    // afficherait une journée dans les clous là où le service la refuse.
    const entries = [saisie(480, 480), saisie(1, 480)]
    const total = afficher(entries)

    expect(total.getAttribute('data-depassement')).toBe('true')
    expect(verdict(entries)).toBe(false)
  })

  it('garde le marqueur non chromatique et le mot qui l explique', () => {
    const total = afficher([saisie(200, 420), saisie(130, 420), saisie(150, 600)])

    expect(total.textContent).toContain('!')
    expect(total.getAttribute('title')).toBe('Capacité dépassée')
    expect(total.className).toContain('text-danger-ink')
  })

  it('laisse vide une journée sans saisie', () => {
    const total = afficher([saisie(480, 480)])
    expect(screen.getByTestId('total-2026-03-13').textContent).toBe('')
    expect(total.textContent).toBe('1')
  })

  it('ne marque rien quand aucune capacité n est réglée', () => {
    const total = afficher([saisie(480, 480), saisie(480, 480)], 0)
    expect(total.getAttribute('data-depassement')).toBe('false')
    expect(total.textContent).toBe('2')
  })

  /**
   * Le mode manquait à cette ligne : en `DESACTIVE`, elle marquait un
   * dépassement que `checkCapacity` ignore délibérément — l'écran contredisait
   * le service sur la même journée, dans le seul mode où le service ne dit
   * rien. Les trois modes sont vérifiés, et chacun contre le verdict rendu
   * sous ce même mode.
   */
  describe('mode de capacité', () => {
    // Deux journées pleines pour une capacité d'une : le dépassement est
    // franc, seul le mode décide s'il se dit.
    const deuxJournees = (): MonthEntry[] => [saisie(480, 480), saisie(480, 480)]

    it('ne marque rien en mode DESACTIVE', () => {
      const entries = deuxJournees()
      const total = afficher(entries, CAP, 'DESACTIVE')

      expect(total.getAttribute('data-depassement')).toBe('false')
      // Le glyphe précède le chiffre : `toBe` refuse le « ! » que `toContain`
      // laisserait passer.
      expect(total.textContent).toBe('2')
      expect(total.getAttribute('title')).toBeNull()
      expect(verdict(entries, CAP, 'DESACTIVE')).toBe(true)
    })

    it('marque en mode AVERTISSEMENT', () => {
      const entries = deuxJournees()
      const total = afficher(entries, CAP, 'AVERTISSEMENT')

      expect(total.getAttribute('data-depassement')).toBe('true')
      expect(total.textContent).toBe('! 2')
      expect(verdict(entries, CAP, 'AVERTISSEMENT')).toBe(false)
    })

    it('marque en mode BLOCAGE', () => {
      const entries = deuxJournees()
      const total = afficher(entries, CAP, 'BLOCAGE')

      expect(total.getAttribute('data-depassement')).toBe('true')
      expect(total.textContent).toBe('! 2')
      expect(verdict(entries, CAP, 'BLOCAGE')).toBe(false)
    })
  })
})
