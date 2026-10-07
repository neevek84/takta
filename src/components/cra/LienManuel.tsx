'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'

type Etat = { url: string } | { erreur: string } | null

/**
 * Un lien neuf pour le client, à transmettre à la main — quand le courriel
 * n'est pas parti, ou que le client l'a égaré. Le jeton n'est montré qu'ici,
 * une fois : la base n'en garde que l'empreinte.
 */
export function LienManuel({
  craId,
  action,
}: {
  craId: string
  action: (prev: Etat, formData: FormData) => Promise<Etat>
}) {
  const [etat, soumettre, enCours] = useActionState(action, null)
  return (
    <form action={soumettre} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="craId" value={craId} />
      <Button disabled={enCours}>Obtenir un lien pour le client</Button>
      {etat !== null && 'url' in etat && (
        <input
          readOnly
          value={etat.url}
          aria-label="Lien à transmettre au client"
          className="w-full rounded-md border border-rule px-2 py-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {etat !== null && 'erreur' in etat && <p role="alert">{etat.erreur}</p>}
    </form>
  )
}
