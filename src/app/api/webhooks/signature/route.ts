import { handleSignatureWebhook } from '@/services/signature/webhook'

const CODES: Record<string, number> = {
  SIGNATURE_INVALIDE: 401,
  CHARGE_ILLISIBLE: 400,
  // Une référence inconnue n'est pas une erreur du prestataire : on accuse
  // réception pour qu'il cesse de réessayer, sans rien révéler de ce qui
  // existe ou non de notre côté.
  LIEN_INCONNU: 202,
}

/**
 * Endpoint public, **authentifié par la signature de la charge utile** et non
 * par un jeton d'URL. Il n'a pas de session : il est sorti du matcher du
 * middleware.
 *
 * Le corps est lu en texte brut avant tout : un HMAC porte sur les octets
 * reçus, pas sur le résultat d'un aller-retour JSON qui réordonnerait les
 * clés.
 *
 * Ce fichier est un gestionnaire, rien de plus : il ne connaît ni Prisma, ni
 * la machine à états, ni Documenso. Toute la décision vit dans le service.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()
  const signatureHeader =
    request.headers.get('x-documenso-signature') ?? request.headers.get('x-cra-signature') ?? ''

  const resultat = await handleSignatureWebhook({ rawBody, signatureHeader })

  if (!resultat.ok) {
    return Response.json({ resultat: resultat.raison }, { status: CODES[resultat.raison] ?? 400 })
  }

  // Seul l'effet est rendu. L'identifiant interne du CRA reste chez nous : le
  // prestataire sait ce qu'il a livré, il n'a pas à apprendre nos clés.
  return Response.json({ resultat: resultat.effet }, { status: 200 })
}
