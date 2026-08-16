import { timingSafeEqual } from 'node:crypto'

/**
 * Garde des routes d'intégration. **Ne prend pas de `userId`** — c'est
 * l'unique exception assumée à la règle du projet : ce jeton authentifie
 * l'instance auprès d'un intégrateur, pas une personne auprès de l'écran.
 *
 * Le secret vit dans l'environnement, comme `AUTH_SECRET` : en base, il
 * ressortirait dans chaque sauvegarde et sur l'écran qui le gérerait.
 */
export function requireApiToken(
  request: Request,
): { ok: true } | { ok: false; response: Response } {
  const attendu = process.env.CRA_API_TOKEN ?? ''

  if (attendu === '') {
    // Défaut sûr : une instance mal configurée se ferme, elle ne s'ouvre pas.
    return {
      ok: false,
      response: Response.json(
        {
          erreur:
            "Le jeton d'API n'est pas configuré (variable d'environnement CRA_API_TOKEN).",
        },
        { status: 503 },
      ),
    }
  }

  const brut = request.headers.get('authorization') ?? ''
  const fourni = brut.startsWith('Bearer ') ? brut.slice('Bearer '.length) : ''

  if (!egalATempsConstant(fourni, attendu)) {
    // Ni le jeton attendu ni le jeton fourni ne figurent dans la réponse :
    // un message d'erreur bavard publie le secret dans deux journaux d'accès.
    return { ok: false, response: Response.json({ erreur: 'Jeton invalide.' }, { status: 401 }) }
  }

  return { ok: true }
}

/**
 * La différence de longueur fuit, et c'est irréductible sans hacher les deux
 * côtés ; le contenu, lui, ne fuit pas. `timingSafeEqual` lève sur des
 * longueurs différentes : la garde n'est pas une optimisation.
 */
function egalATempsConstant(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
