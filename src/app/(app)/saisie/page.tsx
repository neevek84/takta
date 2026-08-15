import { redirect } from 'next/navigation'

export default function SaisieIndex() {
  const now = new Date()
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  redirect(`/saisie/${month}`)
}
