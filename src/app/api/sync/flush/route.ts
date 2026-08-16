import { timingSafeEqual } from 'node:crypto'
import { flushAllProviders } from '@/services/sync/drain'
import { journalAvertissement, journalErreur, journalInfo, type Contexte } from '@/services/log'

/**
 * Les seuls champs du compte rendu qu'on journalise : des nombres. Rien de ce
 * que le drainage a rencontré (identifiants d'événement, messages d'erreur
 * distants) ne passe par ici, et la forme exacte du rapport peut évoluer sans
 * que ce fichier bouge.
 */
function chiffres(rapport: unknown): Contexte {
  if (typeof rapport !== 'object' || rapport === null) return {}
  const out: Contexte = {}
  for (const [cle, valeur] of Object.entries(rapport)) {
    if (typeof valeur === 'number' || typeof valeur === 'boolean') out[cle] = valeur
  }
  return out
}

/** Comparaison à durée constante : un jeton ne se devine pas octet par octet. */
function jetonValide(header: string): boolean {
  const attendu = process.env.SYNC_FLUSH_TOKEN ?? ''
  // Aucun jeton configuré = endpoint fermé. Un déploiement qui oublie la
  // variable ne doit pas ouvrir la synchronisation à tout le monde.
  if (attendu === '') return false

  const fourni = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(fourni)
  const b = Buffer.from(attendu)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Le déclenchement appelable de l'extérieur : un cron système, n8n, ou un
 * `curl`. Il porte son propre jeton parce qu'il n'a pas de session — et il
 * reste fermé par défaut, puisqu'il écrit dans l'agenda et le Dolibarr
 * d'autrui.
 *
 * `flushAllProviders`, et non le seul drainage de l'agenda : un point d'entrée
 * qui rend 200 en laissant les CRA validés dans la file est pire que pas de
 * point d'entrée du tout — le cron a l'air de tourner.
 *
 * Rien ne l'exige : le bouton « Synchroniser maintenant » suffit à
 * l'autoportance de l'application.
 */
export async function POST(request: Request): Promise<Response> {
  if (!jetonValide(request.headers.get('authorization') ?? '')) {
    // Un cron mal configuré qui reçoit 401 en boucle est aujourd'hui
    // indiscernable d'un cron qui ne tourne pas du tout. Le jeton fourni n'est
    // pas journalisé : c'est le secret, et le comparer se fait ailleurs.
    journalAvertissement('sync.flush.api', {
      raison: 'jeton-refuse',
      configure: (process.env.SYNC_FLUSH_TOKEN ?? '') !== '',
    })
    return Response.json({ error: 'Jeton de synchronisation invalide.' }, { status: 401 })
  }

  let r: Awaited<ReturnType<typeof flushAllProviders>>
  try {
    r = await flushAllProviders()
  } catch (err) {
    // La levée continue son chemin (500) : c'est le contrat de l'appelant.
    // Mais elle ne doit pas partir sans avoir dit ce qui a cassé.
    journalErreur('sync.flush.api', err)
    throw err
  }

  journalInfo('sync.flush.api', chiffres(r))
  return Response.json(r, { status: 200 })
}
