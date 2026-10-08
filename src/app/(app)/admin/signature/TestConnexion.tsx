'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { Verification } from '@/services/signature/verification'
import { testerSignature, type TestSignatureState } from './actions'

/**
 * Le verdict s'écrit, ligne par ligne : seul le bandeau porte une teinte, et
 * elle résume — elle ne dit jamais à elle seule laquelle des lignes a échoué.
 */
const VERDICT: Record<Verification['etat'], string> = {
  ok: 'Réussi',
  echec: 'Échec',
  'non-verifie': 'Non vérifié',
}

/**
 * Le bouton « Tester » : une lecture authentifiée de l'API v2 sur la
 * configuration en vigueur, et l'état de SMTP. Rien n'est créé chez Documenso.
 */
export function TestConnexion() {
  const [state, formAction, enCours] = useActionState<TestSignatureState, FormData>(
    testerSignature,
    null,
  )

  return (
    <Card title="Tester la configuration" className="mt-6">
      <p className="mb-3 text-sm text-muted">
        Vérifie que l’instance répond, que l’API v2 est disponible, que la clé est acceptée et que
        SMTP est configuré. Rien n’est créé chez Documenso.
      </p>
      <form action={formAction}>
        <Button type="submit" variant="primary" loading={enCours}>
          Tester
        </Button>
      </form>

      {state !== null && (
        <div className="mt-3">
          <Banner
            tone={state.ok ? 'success' : 'warning'}
            title={state.ok ? 'Tout est prêt pour la signature' : 'La signature n’est pas prête'}
          >
            <ul className="flex flex-col gap-1">
              {state.verifications.map((v) => (
                <li key={v.cle}>
                  <strong>{VERDICT[v.etat]}</strong> : {v.texte}
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      )}
    </Card>
  )
}
