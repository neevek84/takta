'use client'

import { useActionState, useState, useTransition } from 'react'
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
    <form
      action={formAction}
      onSubmit={() => setResetState(null)}
      className="flex flex-col gap-6"
    >
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
          disabled={resetting}
          onClick={() => {
            startReset(async () => {
              const verdict = await restoreDefaultTheme()
              if (verdict.ok) setValues(DEFAULT_THEME)
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
