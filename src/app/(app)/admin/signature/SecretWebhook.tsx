'use client'

import { startTransition, useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { Provenance } from '@/services/signature/reglages'
import { genererSecret, type SecretWebhookState } from './actions'

const LIBELLE: Record<Provenance, string> = {
  ecran: 'généré sur cet écran',
  env: 'variable SIGNATURE_WEBHOOK_SECRET',
  aucune: 'aucun — le webhook refuse toute livraison',
}

/**
 * Le secret du webhook : généré par l'outil, scellé en base, et **affiché une
 * seule fois**, juste après sa génération — le temps de le coller dans
 * Documenso. Il ne revient jamais : le perdre, c'est le régénérer.
 *
 * Régénérer un secret en vigueur passe par une confirmation : l'ancien cesse
 * aussitôt de fonctionner, et Documenso est refusé tant que le nouveau n'y est
 * pas collé. L'action serveur exige la même confirmation de son côté.
 */
export function SecretWebhook({
  provenance,
  genereLe,
  illisible = false,
}: {
  provenance: Provenance
  genereLe: Date | null
  /** un secret est enregistré mais ne se déchiffre plus */
  illisible?: boolean
}) {
  const [state, formAction, enCours] = useActionState<SecretWebhookState, FormData>(
    genererSecret,
    null,
  )

  const confirmerEtGenerer = () => {
    const fd = new FormData()
    fd.set('confirmer', 'oui')
    startTransition(() => formAction(fd))
  }

  return (
    <div className="mt-4">
      <p className="mb-2 text-sm text-ink">
        Secret en vigueur : <strong>{LIBELLE[provenance]}</strong>
        {provenance === 'ecran' && genereLe !== null && (
          <>
            {' '}
            (le <time dateTime={genereLe.toISOString()}>{genereLe.toISOString().slice(0, 10)}</time>
            )
          </>
        )}
        .
      </p>

      {illisible && (
        <div className="mb-2">
          <Banner tone="warning" title="Secret enregistré illisible">
            Le secret enregistré ne peut plus être déchiffré (la clé de chiffrement a changé) : il
            n'est pas en vigueur. Générez-en un nouveau pour le remplacer.
          </Banner>
        </div>
      )}
      {provenance === 'aucune' ? (
        <form action={formAction}>
          <Button type="submit" variant="primary" loading={enCours}>
            Générer le secret
          </Button>
        </form>
      ) : (
        <ConfirmDialog
          trigger="Régénérer le secret"
          title="Régénérer le secret du webhook"
          message="L’ancien secret cessera aussitôt de fonctionner : Documenso sera refusé tant que le nouveau n’aura pas été collé dans son webhook."
          confirmLabel="Régénérer"
          action={confirmerEtGenerer}
        />
      )}

      {state !== null && state.ok && (
        <div className="mt-3">
          <Banner tone="success" title="Nouveau secret du webhook">
            <p>
              Collez-le maintenant dans le champ « Secret » du webhook Documenso. Il est affiché{' '}
              <strong>une seule fois</strong> : cet écran ne pourra plus le montrer.
            </p>
            {/* Sélectionnable d'un geste, sans bouton « copier » : le
                presse-papiers exige un contexte sécurisé, absent en http local. */}
            <code className="mt-2 block break-all rounded-md border border-rule bg-off px-3 py-2 text-sm text-ink">
              {state.secret}
            </code>
          </Banner>
        </div>
      )}
      {state !== null && !state.ok && (
        <div className="mt-3">
          <Banner tone="danger" title="Aucun secret n'a été généré">
            {state.erreur}
          </Banner>
        </div>
      )}
    </div>
  )
}
