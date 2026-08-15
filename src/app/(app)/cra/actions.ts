'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { getOrCreateCra, transitionCra, updateInvoiceTracking } from '@/services/cra'
import type { CraTransition } from '@/core/cra/state-machine'

export async function openCra(formData: FormData) {
  const user = await requireUser()
  await getOrCreateCra(user.id, String(formData.get('missionId')), String(formData.get('month')))
  revalidatePath('/cra')
}

export async function moveCra(formData: FormData) {
  const user = await requireUser()
  await transitionCra(user.id, String(formData.get('craId')), String(formData.get('transition')) as CraTransition)
  revalidatePath('/cra')
  revalidatePath('/saisie')
}

export async function saveTracking(formData: FormData) {
  const user = await requireUser()
  const invoicedAt = String(formData.get('invoicedAt'))
  const paidAt = String(formData.get('paidAt'))

  await updateInvoiceTracking(user.id, String(formData.get('craId')), {
    invoiceNumber: String(formData.get('invoiceNumber')) || null,
    invoicedAt: invoicedAt ? new Date(invoicedAt) : null,
    paidAt: paidAt ? new Date(paidAt) : null,
  })
  revalidatePath('/cra')
}
