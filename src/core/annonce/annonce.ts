/**
 * L'annonce : la phrase qui dit à l'utilisateur ce que son clic a fait.
 *
 * Le défaut qu'elle ferme : une server action qui écrivait sans rien rendre
 * laissait l'écran tel quel — même formulaire, mêmes valeurs —, et l'on
 * recliquait jusqu'à voir un effet. Quatre clics, quatre missions.
 *
 * Elle voyage dans un cookie et non dans l'adresse : une action qui ne
 * redirige pas ne peut rien y écrire, et le cookie, lui, survit aussi bien à
 * la redirection qu'au simple rafraîchissement de la page.
 */
export const COOKIE_ANNONCE = 'takta-annonce'

export type TonAnnonce = 'success' | 'warning' | 'danger' | 'info'

export interface Annonce {
  /** distingue deux annonces au texte identique : la seconde doit s'afficher aussi */
  id: string
  message: string
  ton: TonAnnonce
}

const TONS: readonly TonAnnonce[] = ['success', 'warning', 'danger', 'info']

/** Le cookie relu ; tout ce qui n'a pas la forme attendue vaut « rien à dire ». */
export function lireAnnonce(brut: string | undefined): Annonce | null {
  if (brut === undefined || brut === '') return null
  try {
    const v: unknown = JSON.parse(brut)
    if (typeof v !== 'object' || v === null) return null
    const { id, message, ton } = v as Record<string, unknown>
    if (typeof id !== 'string' || typeof message !== 'string' || message === '') return null
    // Une tonalité forgée ou absente retombe sur l'avertissement, jamais sur
    // le succès : un refus ne doit pas pouvoir se peindre en réussite.
    return { id, message, ton: TONS.includes(ton as TonAnnonce) ? (ton as TonAnnonce) : 'warning' }
  } catch {
    return null
  }
}
