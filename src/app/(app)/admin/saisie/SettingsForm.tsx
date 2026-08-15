'use client'

import { useActionState, useState } from 'react'
import { saveSettings, lancerReetalonnage, type SaveSettingsState } from './actions'
import type { AppSettings } from '@/services/settings'
import { ENGAGEMENT_SOURCES } from '@/services/settings'
import { crossesMidnight, slotDurationMinutes, type Slot } from '@/core/time/slots'
import { DISPLAY_UNITS } from '@/core/types'

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
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-medium">Les réglages n’ont pas été enregistrés :</p>
          <ul className="mt-1 list-disc pl-5">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {state?.ok && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          Réglages enregistrés.
        </p>
      )}

      <fieldset>
        <legend className="mb-2 font-medium">Durée d’une journée</legend>
        <div className="flex items-center gap-2">
          <input
            name="heures"
            type="number"
            min={1}
            max={24}
            required
            defaultValue={Math.floor(settings.minutesParJour / 60)}
            className="w-20 rounded border px-2 py-1"
          />
          <span>h</span>
          <input
            name="minutes"
            type="number"
            min={0}
            max={59}
            required
            defaultValue={settings.minutesParJour % 60}
            className="w-20 rounded border px-2 py-1"
          />
          <span className="text-sm text-slate-500">min</span>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-medium">Contrôle de capacité</legend>
        <select
          name="capacityMode"
          defaultValue={settings.capacityMode}
          className="rounded border px-2 py-1"
        >
          <option value="DESACTIVE">Désactivé</option>
          <option value="AVERTISSEMENT">Avertissement</option>
          <option value="BLOCAGE">Blocage</option>
        </select>
        <label className="ml-4 inline-flex items-center gap-2">
          <span className="text-sm">Seuil</span>
          <input
            name="capaciteJours"
            type="number"
            step="0.5"
            min="0.5"
            required
            defaultValue={settings.capacityCentiemes / 100}
            className="w-20 rounded border px-2 py-1"
          />
          <span className="text-sm text-slate-500">jour(s)</span>
        </label>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-medium">Jours ouvrés</legend>
        <div className="flex flex-wrap gap-3">
          {JOURS.map((j) => (
            <label key={j.value} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                name="workingDays"
                value={j.value}
                defaultChecked={settings.workingDays.includes(j.value)}
              />
              <span className="text-sm">{j.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Les autres jours restent saisissables ; ils sont seulement grisés.
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-medium">Créneaux</legend>
        <p className="mb-2 text-sm text-slate-500">
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
              <div key={row.key} className="flex flex-wrap items-center gap-2 rounded border p-2">
                <input
                  type="text"
                  placeholder="identifiant"
                  required
                  value={row.id}
                  onChange={(e) => updateRow(row.key, { id: e.target.value })}
                  className="w-28 rounded border px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  placeholder="libellé"
                  required
                  value={row.label}
                  onChange={(e) => updateRow(row.key, { label: e.target.value })}
                  className="w-32 rounded border px-2 py-1 text-sm"
                />
                <input
                  type="time"
                  required
                  value={row.start}
                  onChange={(e) => updateRow(row.key, { start: e.target.value })}
                  className="rounded border px-2 py-1 text-sm"
                />
                <span className="text-sm text-slate-500">→</span>
                <input
                  type="time"
                  required
                  value={row.end}
                  onChange={(e) => updateRow(row.key, { end: e.target.value })}
                  className="rounded border px-2 py-1 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="valeur"
                  value={row.value}
                  onChange={(e) => updateRow(row.key, { value: e.target.value })}
                  className="w-24 rounded border px-2 py-1 text-sm"
                />
                <span className="text-sm text-slate-500">j</span>
                {crosses && parsedSlot && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    franchit minuit · {(slotDurationMinutes(parsedSlot) / 60).toFixed(1)} h
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="ml-auto rounded border px-2 py-1 text-xs text-red-700"
                >
                  Retirer
                </button>
              </div>
            )
          })}
        </div>
        <button type="button" onClick={addRow} className="mt-2 rounded border px-3 py-1 text-sm">
          Ajouter un créneau
        </button>
        <input type="hidden" name="slotsJson" value={slotsPayload} readOnly />
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-medium">Unité d’affichage par défaut des nouvelles lignes</legend>
        <select
          name="defaultDisplayUnit"
          defaultValue={settings.defaultDisplayUnit}
          className="rounded border px-2 py-1"
        >
          {DISPLAY_UNITS.map((u) => (
            <option key={u} value={u}>
              {DISPLAY_UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-medium">Source d’engagement par défaut</legend>
        <select
          name="defaultEngagementSource"
          defaultValue={settings.defaultEngagementSource}
          className="rounded border px-2 py-1"
        >
          {ENGAGEMENT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {ENGAGEMENT_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <p className="mt-2 text-sm text-slate-500">
          Ce réglage ne fixe qu’un défaut ; chaque ligne de prestation peut le surcharger.
        </p>
      </fieldset>

      <fieldset className="border-t pt-4">
        <legend className="mb-2 font-medium">Exercice</legend>

        <label className="mb-3 flex flex-col text-sm">
          Mois de début d’exercice
          <select
            name="debutExerciceMois"
            defaultValue={String(settings.debutExerciceMois)}
            className="w-48 rounded border px-2 py-1"
          >
            {['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
              .map((label, i) => (
                <option key={label} value={i + 1}>{label}</option>
              ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          Objectif de chiffre d’affaires sur l’exercice (€)
          <input
            name="objectifCaEuros"
            type="number"
            min="0"
            step="100"
            defaultValue={settings.objectifCaExerciceCents / 100}
            className="w-48 rounded border px-2 py-1"
          />
          <span className="mt-1 text-xs text-slate-500">
            0 masque la barre d’exercice sur le plan de charge.
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>

    <section className="border-t pt-4">
      <h2 className="mb-2 font-medium">Réétalonnage</h2>
      {preview.concernees === 0 && preview.verrouillees === 0 ? (
        <p className="text-sm text-slate-500">
          Toutes les saisies utilisent déjà la durée de journée en vigueur.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {preview.concernees} saisie(s) d’un mois ouvert utilisent une durée de journée
            différente de celle en vigueur.
            {preview.verrouillees > 0 && (
              <> {preview.verrouillees} autre(s) appartiennent à un mois validé et ne seront
              jamais modifiées.</>
            )}
          </p>
          {preview.concernees > 0 && (
            <form
              action={async () => {
                await lancerReetalonnage()
              }}
            >
              <button className="rounded border px-3 py-1 text-sm">
                Réétalonner les {preview.concernees} saisie(s)
              </button>
            </form>
          )}
        </>
      )}
    </section>
    </>
  )
}
