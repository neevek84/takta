import { centiemesParFacteur } from '../time/units'
import type { PushableEntry } from './timespent'

export interface InvoiceDraftLine {
  lineId: string
  label: string
  /** jours réalisés, en centièmes de jour */
  qteCentiemes: number
  tjmCents: number
  totalHtCents: number
}

/**
 * Ce que l'application **demande** à Dolibarr de créer.
 *
 * Pas de numéro, pas de TVA, pas de mention légale, pas de date d'émission :
 * numérotation, taux, émission et conservation restent entièrement chez
 * Dolibarr (spec §8 bis). Ce type est volontairement pauvre.
 */
export interface InvoiceDraft {
  socid: number
  /** 'YYYY-MM' */
  month: string
  lines: InvoiceDraftLine[]
  totalHtCents: number
}

/**
 * Construit un brouillon de facture à partir des jours réalisés.
 *
 * Ne fait jamais autorité sur la facturation elle-même : Dolibarr facture,
 * pas le CRA (arbitrage du porteur). Ce brouillon ne fait que rassembler,
 * ligne par ligne, ce que Dolibarr aura besoin de savoir pour créer la
 * facture — quantité et TJM, rien de plus.
 */
export function buildInvoiceDraft(args: {
  socid: number
  month: string
  entries: ReadonlyArray<PushableEntry>
  lines: ReadonlyArray<{ id: string; label: string; tjmCents: number }>
}): InvoiceDraft {
  // Regroupe les saisies retenues par ligne ; la conversion en jours, à
  // facteur constant, est déléguée à centiemesParFacteur (une seule fois par
  // ligne) plutôt que ré-implémentée ici. Une saisie dont la ligne n'est pas
  // dans `args.lines` finit ici aussi : elle ne sera simplement jamais lue
  // par la boucle ci-dessous, qui n'interroge que les lignes de l'appelant.
  const entriesParLigne = new Map<string, PushableEntry[]>()
  for (const e of args.entries) {
    if (e.kind !== 'REALISE') continue
    if (e.minutes <= 0) continue
    if (!Number.isInteger(e.minutesParJour) || e.minutesParJour <= 0) continue

    const groupe = entriesParLigne.get(e.lineId) ?? []
    groupe.push(e)
    entriesParLigne.set(e.lineId, groupe)
  }

  const lines: InvoiceDraftLine[] = []
  let totalHtCents = 0

  for (const l of args.lines) {
    const groupe = entriesParLigne.get(l.id)
    if (groupe === undefined) continue

    const qteCentiemes = centiemesParFacteur(groupe)
    if (qteCentiemes === 0) continue

    const ligneHt = Math.round((qteCentiemes * l.tjmCents) / 100)
    lines.push({
      lineId: l.id,
      label: l.label,
      qteCentiemes,
      tjmCents: l.tjmCents,
      totalHtCents: ligneHt,
    })
    totalHtCents += ligneHt
  }

  return { socid: args.socid, month: args.month, lines, totalHtCents }
}
