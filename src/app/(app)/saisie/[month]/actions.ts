'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { saveEntry, convertPastForecast, type SaveResult } from '@/services/time-entries'
import { parseQuantity } from '@/core/time/units'
import { listActiveLines } from '@/services/missions'
import type { TimeEntryKind } from '@/core/types'

export async function saveCell(args: {
  lineId: string
  date: string
  raw: string
  kind: TimeEntryKind
  month: string
}): Promise<SaveResult | { ok: false; reason: 'SAISIE_INVALIDE' }> {
  const user = await requireUser()

  const line = (await listActiveLines(user.id)).find((l) => l.id === args.lineId)
  if (!line) return { ok: false, reason: 'SAISIE_INVALIDE' }

  const minutes = parseQuantity(args.raw, line.displayUnit, line.minutesParJour)
  if (minutes === null) return { ok: false, reason: 'SAISIE_INVALIDE' }

  const result = await saveEntry({
    userId: user.id,
    lineId: args.lineId,
    date: args.date,
    minutes,
    kind: args.kind,
  })

  if (result.ok) revalidatePath(`/saisie/${args.month}`)
  return result
}

/**
 * Convertit le prévisionnel échu en réalisé — jamais déclenché seul, toujours
 * à l'initiative de l'utilisateur via le bouton de `PastForecastNotice`.
 */
export async function validerJoursPasses(formData: FormData) {
  const user = await requireUser()
  const month = String(formData.get('month'))
  const today = new Date().toISOString().slice(0, 10)

  await convertPastForecast(user.id, month, today)
  revalidatePath(`/saisie/${month}`)
}
