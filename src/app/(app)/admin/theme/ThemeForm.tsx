'use client'

import { useActionState, useState, useTransition } from 'react'
import { saveTheme, restoreDefaultTheme, type SaveThemeState } from './actions'
import {
  DEFAULT_THEME_CONFIG,
  THEME_MODES,
  THEME_MODE_LABELS,
  THEME_PRESETS,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  type ThemeConfig,
  type ThemeMode,
  type ThemeNature,
} from '@/core/theme/tokens'

const VERSANTS: readonly { nature: ThemeNature; titre: string; aide: string }[] = [
  {
    nature: 'clair',
    titre: 'Palette claire',
    aide: 'Appliquée quand le système est en clair, ou sur le choix « Toujours clair ».',
  },
  {
    nature: 'sombre',
    titre: 'Palette sombre',
    aide: 'Appliquée quand le système est en sombre, ou sur le choix « Toujours sombre ».',
  },
]

/**
 * Le nom accessible d'un champ doit rester unique dans la page : « fond de
 * page » désigne maintenant deux couleurs. Le versant s'y ajoute, et il sert
 * aussi de nom de champ — c'est le contrat avec `actions.ts`.
 */
function nomChamp(nature: ThemeNature, key: keyof typeof TOKEN_LABELS): string {
  return `${nature}.${key}`
}

function libelleChamp(nature: ThemeNature, key: keyof typeof TOKEN_LABELS): string {
  return `${TOKEN_LABELS[key]} (thème ${nature})`
}

export function ThemeForm({ config }: { config: ThemeConfig }) {
  const [state, formAction, pending] = useActionState<SaveThemeState, FormData>(saveTheme, null)
  const [values, setValues] = useState<ThemeConfig>(config)

  // Le retour au défaut est une écriture comme une autre : il passe par une
  // transition, se laisse attendre, et ne repeint les champs qu'une fois la
  // base d'accord. Repeindre d'abord ferait affirmer à l'écran un état que la
  // base n'a pas — l'utilisateur quitterait la page en croyant avoir
  // réinitialisé le thème.
  const [resetState, setResetState] = useState<SaveThemeState>(null)
  const [resetting, startReset] = useTransition()

  // Un seul bandeau : c'est le dernier geste qui s'exprime.
  const retour = resetState ?? state
  const succes = resetState?.ok ? 'Thème par défaut restauré.' : 'Palette enregistrée.'
  const echec = resetState
    ? 'Le thème par défaut n’a pas été restauré :'
    : 'La palette n’a pas été enregistrée :'

  return (
    <form action={formAction} onSubmit={() => setResetState(null)} className="flex flex-col gap-6">
      {retour && !retour.ok && (
        <div
          role="alert"
          className="rounded-md border border-danger-edge bg-danger px-3 py-2 text-sm text-danger-ink"
        >
          <p className="font-medium">{echec}</p>
          <ul className="mt-1 list-disc pl-5">
            {retour.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {retour?.ok && (
        <p
          role="status"
          className="rounded-md border border-success-edge bg-success px-3 py-2 text-sm text-success-ink"
        >
          {succes}
        </p>
      )}

      <fieldset className="rounded-md border border-rule px-3 py-2">
        <legend className="px-1 text-sm font-medium">Thème appliqué</legend>
        <p className="mb-2 text-sm text-muted">
          Par défaut, l’application suit la préférence d’affichage du système. Un choix explicite
          la remplace, pour tout le monde et jusqu’au prochain changement.
        </p>
        <div className="flex flex-col gap-1">
          {THEME_MODES.map((mode) => (
            <label key={mode} className="touch-target flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                value={mode}
                checked={values.mode === mode}
                onChange={() => setValues((v) => ({ ...v, mode: mode as ThemeMode }))}
              />
              {THEME_MODE_LABELS[mode]}
            </label>
          ))}
        </div>
      </fieldset>

      {VERSANTS.map(({ nature, titre, aide }) => (
        <fieldset key={nature} className="rounded-md border border-rule px-3 py-2">
          <legend className="px-1 text-sm font-medium">{titre}</legend>
          <p className="mb-2 text-sm text-muted">{aide}</p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Préréglages :</span>
            {THEME_PRESETS.filter((p) => p.nature === nature).map((preset) => (
              <button
                key={preset.id}
                type="button"
                // Un préréglage clair n'est proposé que du côté clair : le
                // service refuserait l'inverse, autant ne pas le laisser
                // tenter.
                onClick={() => setValues((v) => ({ ...v, [nature]: preset.tokens }))}
                className="touch-target rounded-md border border-rule px-3 text-sm text-link hover:bg-off"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {THEME_TOKEN_KEYS.map((key) => (
              // Volontairement un `div` et non un `label` : le nom accessible
              // du champ vient de son `aria-label` seul. Un `label`
              // enveloppant y ajouterait la valeur hexadécimale, et « fond de
              // page » ne désignerait plus rien.
              <div key={key} className="flex items-center gap-3 text-sm">
                <input
                  type="color"
                  name={nomChamp(nature, key)}
                  aria-label={libelleChamp(nature, key)}
                  value={values[nature][key]}
                  onChange={(ev) =>
                    setValues((v) => ({ ...v, [nature]: { ...v[nature], [key]: ev.target.value } }))
                  }
                  className="h-9 w-12 rounded-sm border border-rule"
                />
                <span aria-hidden="true" className="flex flex-col">
                  <span>{TOKEN_LABELS[key]}</span>
                  <span className="font-mono text-xs text-muted">{values[nature][key]}</span>
                </span>
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="touch-target rounded-md bg-accent px-4 font-medium text-on-accent hover:bg-ink-deep hover:text-on-dark"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer la palette'}
        </button>
        <button
          type="button"
          disabled={resetting}
          onClick={() => {
            startReset(async () => {
              const verdict = await restoreDefaultTheme()
              if (verdict.ok) setValues(DEFAULT_THEME_CONFIG)
              setResetState(verdict)
            })
          }}
          className="touch-target rounded-md border border-rule px-4 text-link hover:bg-off"
        >
          Revenir au thème par défaut
        </button>
      </div>
    </form>
  )
}
