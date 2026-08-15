'use client'

import { useActionState, useState } from 'react'
import { saveTheme, restoreDefaultTheme, type SaveThemeState } from './actions'
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  type ThemeTokens,
} from '@/core/theme/tokens'

export function ThemeForm({ theme }: { theme: ThemeTokens }) {
  const [state, formAction, pending] = useActionState<SaveThemeState, FormData>(saveTheme, null)
  const [values, setValues] = useState<ThemeTokens>(theme)

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-md border border-danger-edge bg-danger px-3 py-2 text-sm text-danger-ink"
        >
          <p className="font-medium">La palette n’a pas été enregistrée :</p>
          <ul className="mt-1 list-disc pl-5">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {state?.ok && (
        <p
          role="status"
          className="rounded-md border border-success-edge bg-success px-3 py-2 text-sm text-success-ink"
        >
          Palette enregistrée.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Préréglages :</span>
        {THEME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => setValues(preset.tokens)}
            className="touch-target rounded-md border border-rule px-3 text-sm text-link hover:bg-off"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {THEME_TOKEN_KEYS.map((key) => (
          // Volontairement un `div` et non un `label` : le nom accessible du
          // champ vient de son `aria-label` seul. Un `label` enveloppant y
          // ajouterait la valeur hexadécimale, et « fond de page » ne
          // désignerait plus rien.
          <div key={key} className="flex items-center gap-3 text-sm">
            <input
              type="color"
              name={key}
              aria-label={TOKEN_LABELS[key]}
              value={values[key]}
              onChange={(ev) => setValues((v) => ({ ...v, [key]: ev.target.value }))}
              className="h-9 w-12 rounded-sm border border-rule"
            />
            <span aria-hidden="true" className="flex flex-col">
              <span>{TOKEN_LABELS[key]}</span>
              <span className="font-mono text-xs text-muted">{values[key]}</span>
            </span>
          </div>
        ))}
      </div>

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
          onClick={() => {
            setValues(DEFAULT_THEME)
            void restoreDefaultTheme()
          }}
          className="touch-target rounded-md border border-rule px-4 text-link hover:bg-off"
        >
          Revenir au thème par défaut
        </button>
      </div>
    </form>
  )
}
