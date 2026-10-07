'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Le cadre Documenso, embarqué. Il **n'est cru sur rien** : ses messages ne
 * servent qu'à afficher « merci » et à demander au serveur de relire l'état
 * chez le prestataire (`confirmer`). La transition du CRA n'en dépend pas.
 *
 * Le lien « ouvrir dans un nouvel onglet » est toujours là : si l'instance
 * refuse d'être encadrée, le client signe quand même.
 */
export function CadreSignature({
  url,
  confirmer,
  renouveler,
}: {
  url: string
  confirmer: () => Promise<void>
  renouveler: () => Promise<void>
}) {
  const cadre = useRef<HTMLIFrameElement>(null)
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const origine = new URL(url).origin
    // Une action serveur qui échoue (réseau, 500) ne doit jamais devenir une
    // promesse rejetée sans gestionnaire : l'écouteur est appelé par le
    // navigateur, personne n'attend son résultat. Le client n'a rien à
    // refaire — le webhook ou le balayage appliqueront l'état — on le dit
    // sans alarmer, et la page se relit quand même.
    async function tenter(action: () => Promise<void>): Promise<void> {
      try {
        await action()
      } catch {
        setMessage('La confirmation prend plus de temps que prévu ; la page se mettra à jour.')
      }
    }
    async function ecouter(e: MessageEvent) {
      if (e.origin !== origine || e.source !== cadre.current?.contentWindow) return
      const action = (e.data as { action?: unknown } | null)?.action
      if (action === 'document-completed' || action === 'document-rejected') {
        setMessage(action === 'document-completed' ? 'Merci, votre signature est enregistrée.' : 'Votre refus est transmis.')
        await tenter(confirmer)
        router.refresh()
      } else if (action === 'document-error') {
        setMessage('Le document n’a pas pu s’afficher. Nous renouvelons le lien de signature…')
        await tenter(renouveler)
        router.refresh()
      }
    }
    window.addEventListener('message', ecouter)
    return () => window.removeEventListener('message', ecouter)
  }, [url, confirmer, renouveler, router])

  return (
    <section aria-label="Signature du document" className="flex flex-col gap-2">
      {message !== null && <p role="status">{message}</p>}
      <iframe
        ref={cadre}
        src={url}
        title="Document à signer"
        className="h-[80vh] w-full rounded-md border border-rule"
      />
      <p className="text-sm">
        Le document ne s’affiche pas ?{' '}
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-link underline">
          Ouvrir le document dans un nouvel onglet
        </a>
      </p>
    </section>
  )
}
