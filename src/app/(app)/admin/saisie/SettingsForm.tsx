'use client'

import { useActionState, useState } from 'react'
import { saveSettings, lancerReetalonnage, type SaveSettingsState } from './actions'
import type { AppSettings } from '@/services/settings'
import { ENGAGEMENT_SOURCES } from '@/core/types'
import { crossesMidnight, slotDurationMinutes, type Slot } from '@/core/time/slots'
import { DISPLAY_UNITS } from '@/core/types'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Checkbox } from '@/components/ui/Checkbox'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/Banner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

const JOURS = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' },
]

const DISPLAY_UNIT_LABELS: Record<string, string> = {
  JOUR: 'Jour',
  DEMI_JOUR: 'Demi-journée',
  HEURE: 'Heure',
}

const ENGAGEMENT_SOURCE_LABELS: Record<string, string> = {
  MANUEL: 'Manuel',
  DOLIBARR_PROPALE: 'Propale Dolibarr',
  DOLIBARR_PROJET: 'Projet Dolibarr',
}

interface SlotRow {
  key: string
  id: string
  label: string
  /** HH:MM */
  start: string
  /** HH:MM */
  end: string
  /** valeur en jours, saisie décimale (ex. "0.5") */
  value: string
}

let rowSeq = 0
function nextRowKey(): string {
  rowSeq += 1
  return `row-${rowSeq}`
}

function minutesToTimeInput(minutes: number): string {
  const clamped = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function timeInputToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return NaN
  return Number(match[1]) * 60 + Number(match[2])
}

function slotsToRows(slots: Slot[]): SlotRow[] {
  return slots.map((s) => ({
    key: nextRowKey(),
    id: s.id,
    label: s.label,
    start: minutesToTimeInput(s.startMinute),
    end: minutesToTimeInput(s.endMinute),
    value: String(s.centiemes / 100),
  }))
}

interface RecalibrationPreview {
  concernees: number
  verrouillees: number
}

export function SettingsForm({
  settings,
  preview,
}: {
  settings: AppSettings
  preview: RecalibrationPreview
}) {
  const [state, formAction, pending] = useActionState<SaveSettingsState, FormData>(
    saveSettings,
    null,
  )
  const [rows, setRows] = useState<SlotRow[]>(() => slotsToRows(settings.slots))

  function addRow() {
    setRows((r) => [...r, { key: nextRowKey(), id: '', label: '', start: '', end: '', value: '' }])
  }
  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key))
  }
  function updateRow(key: string, patch: Partial<SlotRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  // Sérialisé côté client puis revalidé côté serveur (zod, dans
  // `updateSettings`) : le client n'a pas besoin de dupliquer la logique de
  // validation, seulement de convertir les champs saisis en la forme
  // attendue par `Slot`. Une valeur non convertible (heure vide, texte non
  // numérique) devient `NaN`, sérialisée en `null` par `JSON.stringify` —
  // le serveur la rejette alors avec un message explicite.
  const slotsPayload = JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      label: r.label,
      startMinute: timeInputToMinutes(r.start),
      endMinute: timeInputToMinutes(r.end),
      centiemes: Math.round(Number(r.value) * 100),
    })),
  )

  return (
    <>
    <form action={formAction} className="flex flex-col gap-6">
      {state && !state.ok && (
        <Banner tone="danger">
          <p className="font-medium">Les réglages n’ont pas été enregistrés :</p>
          <ul className="mt-1 list-disc pl-5">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Banner>
      )}
      {state?.ok && <Banner tone="success">Réglages enregistrés.</Banner>}

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Durée d’une journée</legend>
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label="Heures"
              name="heures"
              type="number"
              min={1}
              max={24}
              required
              defaultValue={Math.floor(settings.minutesParJour / 60)}
              className="w-20"
            />
            <Field
              label="Minutes"
              name="minutes"
              type="number"
              min={0}
              max={59}
              required
              defaultValue={settings.minutesParJour % 60}
              className="w-20"
            />
          </div>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Contrôle de capacité</legend>
          <div className="flex flex-wrap items-end gap-4">
            <Select label="Mode" name="capacityMode" defaultValue={settings.capacityMode}>
              <option value="DESACTIVE">Désactivé</option>
              <option value="AVERTISSEMENT">Avertissement</option>
              <option value="BLOCAGE">Blocage</option>
            </Select>
            <Field
              label="Seuil (jour(s))"
              name="capaciteJours"
              type="number"
              step="0.5"
              min="0.5"
              required
              defaultValue={settings.capacityCentiemes / 100}
              className="w-24"
            />
          </div>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Jours ouvrés</legend>
          <div className="flex flex-wrap gap-3">
            {JOURS.map((j) => (
              <Checkbox
                key={j.value}
                name="workingDays"
                value={j.value}
                defaultChecked={settings.workingDays.includes(j.value)}
                label={j.label}
              />
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">
            Les autres jours restent saisissables ; ils sont seulement grisés.
          </p>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Créneaux</legend>
          <p className="mb-2 text-sm text-muted">
            Libellé, plage horaire et valeur (en jours) de chaque créneau. Un créneau peut
            franchir minuit : indiquez une heure de fin antérieure à l’heure de début (ex. Nuit
            22:00 → 06:00).
          </p>
          <div className="flex flex-col gap-2">
            {rows.map((row) => {
              const startMinute = timeInputToMinutes(row.start)
              const endMinute = timeInputToMinutes(row.end)
              const parsedSlot: Slot | null =
                Number.isFinite(startMinute) && Number.isFinite(endMinute)
                  ? { id: row.id, label: row.label, startMinute, endMinute, centiemes: 0 }
                  : null
              const crosses = parsedSlot ? crossesMidnight(parsedSlot) : false

              return (
                <div
                  key={row.key}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-rule p-2"
                >
                  <Field
                    label="Identifiant"
                    required
                    value={row.id}
                    onChange={(e) => updateRow(row.key, { id: e.target.value })}
                    className="w-28"
                  />
                  <Field
                    label="Libellé"
                    required
                    value={row.label}
                    onChange={(e) => updateRow(row.key, { label: e.target.value })}
                    className="w-32"
                  />
                  <Field
                    label="Début"
                    type="time"
                    required
                    value={row.start}
                    onChange={(e) => updateRow(row.key, { start: e.target.value })}
                  />
                  <span className="self-center text-sm text-muted">→</span>
                  <Field
                    label="Fin"
                    type="time"
                    required
                    value={row.end}
                    onChange={(e) => updateRow(row.key, { end: e.target.value })}
                  />
                  <Field
                    label="Valeur (j)"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={row.value}
                    onChange={(e) => updateRow(row.key, { value: e.target.value })}
                    className="w-24"
                  />
                  {crosses && parsedSlot && (
                    <span className="self-center rounded-md bg-off px-2 py-0.5 text-xs text-muted">
                      franchit minuit · {(slotDurationMinutes(parsedSlot) / 60).toFixed(1)} h
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => removeRow(row.key)}
                    className="ml-auto"
                  >
                    Retirer
                  </Button>
                </div>
              )
            })}
          </div>
          <Button type="button" variant="secondary" onClick={addRow} className="mt-2">
            Ajouter un créneau
          </Button>
          <input type="hidden" name="slotsJson" value={slotsPayload} readOnly />
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Plage journée</legend>
          <p className="mb-2 text-sm text-muted">
            Un bloc d’agenda sans créneau démarre au début de cette plage et n’en déborde jamais.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Début"
              name="journeeDebut"
              type="time"
              required
              defaultValue={minutesToTimeInput(settings.journeeDebutMinute)}
            />
            <Field
              label="Fin"
              name="journeeFin"
              type="time"
              required
              defaultValue={minutesToTimeInput(settings.journeeFinMinute)}
            />
          </div>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Unité d’affichage par défaut des nouvelles lignes</legend>
          <Select label="Unité" name="defaultDisplayUnit" defaultValue={settings.defaultDisplayUnit}>
            {DISPLAY_UNITS.map((u) => (
              <option key={u} value={u}>
                {DISPLAY_UNIT_LABELS[u]}
              </option>
            ))}
          </Select>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Source d’engagement par défaut</legend>
          <Select
            label="Source"
            name="defaultEngagementSource"
            defaultValue={settings.defaultEngagementSource}
          >
            {ENGAGEMENT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {ENGAGEMENT_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
          <p className="mt-2 text-sm text-muted">
            Ce réglage ne fixe qu’un défaut ; chaque ligne de prestation peut le surcharger.
          </p>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Fuseau horaire</legend>
          {/* Le fuseau situe les blocs poussés dans l'agenda : il ne décale
              aucune minute saisie, il dit dans quel fuseau les lire. Il se
              règle ici, plus dans un fichier — et son défaut est celui de la
              machine, personne n'ayant à déclarer qu'il vit à Paris. */}
          <Field
            label="Fuseau horaire (IANA)"
            name="timeZone"
            defaultValue={settings.timeZone}
            autoComplete="off"
            hint="Par défaut, celui de cette machine. Exemples : Europe/Paris, Indian/Reunion."
            className="w-64"
          />
          <p className="mt-2 text-sm text-muted">
            Il n’est utilisé que pour situer les blocs déposés dans l’agenda Google. Les heures
            saisies ne bougent pas.
          </p>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Exercice</legend>
          <div className="flex flex-wrap gap-4">
            <Select
              label="Mois de début d’exercice"
              name="debutExerciceMois"
              defaultValue={String(settings.debutExerciceMois)}
              className="w-48"
            >
              {['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
                .map((label, i) => (
                  <option key={label} value={i + 1}>{label}</option>
                ))}
            </Select>

            <Field
              label="Objectif de chiffre d’affaires sur l’exercice (€)"
              name="objectifCaEuros"
              type="number"
              min="0"
              step="100"
              defaultValue={settings.objectifCaExerciceCents / 100}
              hint="0 masque la barre d’exercice sur le plan de charge."
              className="w-48"
            />
          </div>
        </fieldset>
      </Card>

      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </Button>
    </form>

    <Card className="mt-8">
      <h2 className="mb-2 font-medium">Réétalonnage</h2>
      {preview.concernees === 0 && preview.verrouillees === 0 ? (
        <p className="text-sm text-muted">
          Toutes les saisies utilisent déjà la durée de journée en vigueur.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            {preview.concernees} saisie(s) d’un mois ouvert utilisent une durée de journée
            différente de celle en vigueur.
            {preview.verrouillees > 0 && (
              <> {preview.verrouillees} autre(s) appartiennent à un mois validé et ne seront
              jamais modifiées.</>
            )}
          </p>
          {preview.concernees > 0 && (
            <ConfirmDialog
              trigger={`Réétalonner les ${preview.concernees} saisie(s)`}
              title="Réétalonner les saisies des mois ouverts"
              message={`${preview.concernees} saisie(s) vont adopter la durée de journée en vigueur. Les saisies des mois validés ne sont jamais modifiées.`}
              confirmLabel="Réétalonner"
              action={async () => {
                await lancerReetalonnage()
              }}
            />
          )}
        </>
      )}
    </Card>
    </>
  )
}
