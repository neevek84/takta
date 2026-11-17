'use client'

import { useState } from 'react'

import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import {
  erreurDePeriode,
  periodePredefinie,
  PERIODES_PREDEFINIES,
  type Periode,
  type PeriodePredefinie,
} from '@/core/planning/periode'
import type { LineForGrid } from '@/services/missions'

type Choix = PeriodePredefinie | 'PERSONNALISEE'

/** L'adresse du PDF : la route vérifie tout de nouveau, ceci n'est qu'un lien. */
export function urlPlanning(args: {
  lineId: string
  periode: Periode
  toutLaMission: boolean
}): string {
  const params = new URLSearchParams({ ligne: args.lineId, du: args.periode.du, au: args.periode.au })
  if (args.toutLaMission) params.set('perimetre', 'MISSION')
  return `/planning/pdf?${params.toString()}`
}

/**
 * Le panneau d'export du planning d'intervention : une période — prédéfinie
 * à partir du mois affiché, ou de date à date — puis un téléchargement.
 *
 * Le PDF part d'un simple lien : aucune écriture, rien à confirmer. La
 * validation ici ne sert qu'à dire tout de suite ce que la route refuserait.
 */
export function PanneauPlanning({
  month,
  ligne,
  lignesDeLaMission,
  onFermer,
}: {
  /** le mois affiché, 'YYYY-MM' : le point de départ des raccourcis */
  month: string
  ligne: LineForGrid
  /** combien de prestations la mission porte pour cet utilisateur */
  lignesDeLaMission: number
  onFermer: () => void
}) {
  const [choix, setChoix] = useState<Choix>('TROIS_MOIS')
  const [periode, setPeriode] = useState<Periode>(() => periodePredefinie('TROIS_MOIS', month))
  const [toutLaMission, setToutLaMission] = useState(false)

  const erreur = erreurDePeriode(periode)

  function choisir(valeur: Choix): void {
    setChoix(valeur)
    if (valeur !== 'PERSONNALISEE') setPeriode(periodePredefinie(valeur, month))
  }

  // Toucher une date, c'est quitter le raccourci : le sélecteur doit le dire,
  // sinon il afficherait « 3 mois » sur une période qui n'en fait plus trois.
  function changerDate(borne: keyof Periode, valeur: string): void {
    setChoix('PERSONNALISEE')
    setPeriode((p) => ({ ...p, [borne]: valeur }))
  }

  return (
    <div className="mb-3">
      <Banner tone="info" title="Exporter le planning en PDF">
        <p className="mb-3">
          Un agenda mois par mois des jours posés sur{' '}
          {toutLaMission ? 'la mission' : 'la prestation'} «{' '}
          {toutLaMission
            ? `${ligne.clientName} · ${ligne.missionLabel}`
            : `${ligne.clientName} · ${ligne.missionLabel} · ${ligne.label}`}{' '}
          », réalisés comme prévus. Ni jours vendus ni montants n’y figurent : il peut partir tel
          quel chez le client.
        </p>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Select
            label="Période"
            value={choix}
            onChange={(ev) => choisir(ev.target.value as Choix)}
          >
            {PERIODES_PREDEFINIES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.libelle}
              </option>
            ))}
            <option value="PERSONNALISEE">De date à date</option>
          </Select>
          <Field
            label="Du"
            type="date"
            value={periode.du}
            onChange={(ev) => changerDate('du', ev.target.value)}
          />
          <Field
            label="Au"
            type="date"
            value={periode.au}
            onChange={(ev) => changerDate('au', ev.target.value)}
            {...(erreur !== null ? { error: erreur } : {})}
          />
          {lignesDeLaMission > 1 && (
            <Checkbox
              label="Toutes les prestations de la mission"
              checked={toutLaMission}
              onChange={(ev) => setToutLaMission(ev.target.checked)}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {erreur === null ? (
            <a
              href={urlPlanning({ lineId: ligne.id, periode, toutLaMission })}
              download
              className="touch-target inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-on-accent transition-[background-color,color] duration-150 hover:bg-ink-deep hover:text-on-dark"
            >
              Télécharger le PDF
            </a>
          ) : (
            <Button type="button" variant="primary" disabled>
              Télécharger le PDF
            </Button>
          )}
          <Button type="button" variant="quiet" onClick={onFermer}>
            Fermer
          </Button>
        </div>
      </Banner>
    </div>
  )
}
