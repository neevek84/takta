'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { ResultatAgenda } from '@/services/availability'
import { verifierAgenda } from './actions'

/**
 * Ce que le dernier clic a produit, `INACTIF` avant tout clic.
 *
 * Trois issues distinctes après une vérification — des jours occupés (avec
 * leur compte), une absence honnête d'occupation, ou un échec de lecture —
 * jamais la même phrase déclinée par sa teinte.
 */
type Etat =
  | { kind: 'INACTIF' }
  | { kind: 'EN_COURS' }
  | { kind: 'OCCUPE'; jours: string[] }
  | { kind: 'VIDE' }
  | { kind: 'ECHEC' }

function messageDe(etat: Extract<Etat, { kind: 'OCCUPE' | 'VIDE' | 'ECHEC' }>): string {
  if (etat.kind === 'VIDE') return 'Aucune occupation sur la période vérifiée.'
  if (etat.kind === 'OCCUPE') {
    return etat.jours.length === 1
      ? '1 jour occupé sur la période vérifiée.'
      : `${etat.jours.length} jours occupés sur la période vérifiée.`
  }
  // L'utilisateur a demandé. Le silence serait un mensonge — la lecture n'a
  // pas abouti, mais la saisie, elle, n'en a jamais dépendu.
  return 'Google n’a pas répondu. La saisie continue normalement.'
}

const TONE: Record<'OCCUPE' | 'VIDE' | 'ECHEC', string> = {
  OCCUPE: 'border-info-edge bg-info text-info-ink',
  VIDE: 'border-success-edge bg-success text-success-ink',
  ECHEC: 'border-warning-edge bg-warning text-warning-ink',
}

/**
 * Le bouton qui déclenche, à la demande, la lecture de l'agenda externe sur la
 * plage affichée — jamais au chargement de la page (voir `page.tsx` et
 * `actions.ts`). `verifier` est injectable pour rester testable sans réseau ;
 * le point d'appel réel s'en remet à l'action serveur `verifierAgenda`.
 *
 * `role="status"` sur les trois issues, y compris l'échec : aucune ne bloque
 * la saisie, aucune n'a donc besoin d'interrompre au sens d'un `alert`.
 */
export function BoutonAgenda({
  du,
  au,
  verifier = verifierAgenda,
  onResultat,
}: {
  /** 'YYYY-MM-DD', bornes incluses — la plage actuellement affichée. */
  du: string
  au: string
  verifier?: (args: { du: string; au: string }) => Promise<ResultatAgenda>
  /** Reçoit les jours occupés à chaque lecture réussie, vide comprise. */
  onResultat: (jours: string[]) => void
}) {
  const [etat, setEtat] = useState<Etat>({ kind: 'INACTIF' })

  async function verifierMaintenant(): Promise<void> {
    setEtat({ kind: 'EN_COURS' })
    const r = await verifier({ du, au })

    if (!r.ok) {
      setEtat({ kind: 'ECHEC' })
      return
    }
    setEtat(r.jours.length === 0 ? { kind: 'VIDE' } : { kind: 'OCCUPE', jours: r.jours })
    onResultat(r.jours)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        loading={etat.kind === 'EN_COURS'}
        onClick={() => void verifierMaintenant()}
      >
        Vérifier l’agenda
      </Button>

      {(etat.kind === 'OCCUPE' || etat.kind === 'VIDE' || etat.kind === 'ECHEC') && (
        <p role="status" className={`rounded-md border px-2 py-1 text-xs ${TONE[etat.kind]}`}>
          {messageDe(etat)}
        </p>
      )}
    </div>
  )
}
