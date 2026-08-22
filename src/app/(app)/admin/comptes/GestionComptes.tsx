'use client'

import { useState, useTransition } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { changerActivation, changerRole, type ComptesState } from './actions'
import { ROLES } from '@/core/auth/roles'
import type { Role } from '@/core/types'
import type { CompteVue } from '@/services/auth/comptes'

/**
 * Qui entre, et ce qu'il peut.
 *
 * L'état de chaque compte est dit **en toutes lettres** — « actif », « accès
 * coupé », le rôle dans un menu déroulant — et jamais par la seule teinte d'une
 * ligne : un fond grisé ne se lit pas en niveaux de gris, et ne s'annonce à
 * aucun lecteur d'écran.
 */
export function GestionComptes({ comptes }: { comptes: CompteVue[] }) {
  const [etat, setEtat] = useState<ComptesState>(null)
  const [enCours, demarrer] = useTransition()

  function agir(action: () => Promise<ComptesState>) {
    demarrer(async () => setEtat(await action()))
  }

  return (
    <>
      {etat !== null && (
        <div className="mb-4">
          <Banner tone={etat.ok ? 'success' : 'danger'}>{etat.message}</Banner>
        </div>
      )}

      <Card title="Comptes">
        <p className="mb-3 text-sm text-muted">
          Un compte créé sans qu’un humain décide de son rôle est <strong>consultant</strong> :
          c’est le cas de ceux que la connexion Google ouvre, et de ceux que la reprise des temps
          Dolibarr crée pour porter l’attribution. C’est ici qu’on l’élève.
        </p>
        <ul className="text-sm">
          {comptes.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-end gap-3 border-b border-rule py-2 last:border-0"
            >
              <span className="flex-1">
                {c.name} <span className="text-muted">· {c.email}</span>
              </span>
              <span className="text-muted">{c.disabled ? 'Accès coupé' : 'Actif'}</span>
              <span className="text-muted">
                {c.identifiantDolibarr === null
                  ? 'Dolibarr : aucun'
                  : `Dolibarr n° ${c.identifiantDolibarr}`}
              </span>
              <Select
                label={`Rôle de ${c.name}`}
                name={`role-${c.id}`}
                defaultValue={c.role}
                disabled={enCours}
                onChange={(e) => agir(() => changerRole(c.id, e.target.value as Role))}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant={c.disabled ? 'secondary' : 'danger'}
                disabled={enCours}
                onClick={() => agir(() => changerActivation(c.id, c.disabled))}
              >
                {c.disabled ? 'Rouvrir l’accès' : 'Couper l’accès'}
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          Couper un accès ne détruit rien : les saisies, les CRA et l’attribution de tout ce qui a
          été poussé chez Dolibarr restent. C’est la raison d’être de ce geste — supprimer un compte
          les emporterait.
        </p>
      </Card>
    </>
  )
}
