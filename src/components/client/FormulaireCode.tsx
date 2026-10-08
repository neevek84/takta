import { Button } from '@/components/ui/Button'
import { demanderCodeAction, validerCodeAction } from '@/app/v/[jeton]/actions'

const ERREURS: Record<string, string> = {
  CODE: 'Code incorrect ou expiré.',
  EPUISE: 'Trop d’essais pour ce code. Demandez-en un nouveau.',
  TROP_DE_CODES: 'Trop de codes demandés. Réessayez dans une heure.',
  LIMITE: 'Trop d’essais depuis cette connexion. Réessayez dans un quart d’heure.',
  LIEN: 'Ce lien n’est plus valable.',
  COURRIEL: 'Le code n’a pas pu être envoyé. Réessayez dans un instant.',
}

/**
 * Deux étapes : recevoir un code, puis le saisir. **Rien ne part à
 * l'ouverture de la page** : les analyseurs de liens des messageries ouvrent
 * chaque lien reçu, et enverraient un code à chaque fois.
 */
export function FormulaireCode({ jeton, etape, erreur }: { jeton: string; etape: 'demande' | 'code'; erreur?: string }) {
  const message = erreur !== undefined ? ERREURS[erreur] : undefined
  return (
    <div className="flex max-w-sm flex-col gap-4">
      <p>Pour consulter ce compte-rendu d’activité, confirmez votre adresse : un code à six chiffres vous sera envoyé.</p>
      {message !== undefined && <p role="alert">{message}</p>}
      {etape === 'code' && (
        <form action={validerCodeAction} className="flex flex-col gap-2">
          <input type="hidden" name="jeton" value={jeton} />
          <label htmlFor="code">Code reçu par courriel</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            className="rounded-md border border-rule px-3 py-2 text-lg tracking-widest"
          />
          <Button variant="primary">Valider</Button>
        </form>
      )}
      <form action={demanderCodeAction}>
        <input type="hidden" name="jeton" value={jeton} />
        <Button variant={etape === 'code' ? undefined : 'primary'}>
          {etape === 'code' ? 'Recevoir un nouveau code' : 'Recevoir mon code'}
        </Button>
      </form>
    </div>
  )
}
