import { NextResponse } from 'next/server'
import { requireUser } from '@/auth'
import { getCraPdfForDownload } from '@/services/cra-pdf'

/**
 * Téléchargement du CRA.
 *
 * Disponible quel que soit l'état du CRA et **sans aucun connecteur de
 * signature configuré** : c'est ce qui rend le lot utile tout seul.
 *
 * Le service décide seul s'il sert l'archive signée ou une regénération ; la
 * route ne fait que transporter — aucun accès Prisma ici, aucune règle.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ craId: string }> },
): Promise<Response> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch {
    return NextResponse.json({ erreur: 'Non authentifié.' }, { status: 401 })
  }

  const { craId } = await params

  try {
    const { fileName, bytes } = await getCraPdfForDownload(userId, craId)

    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        // `fileName` est déjà réduit à [A-Za-z0-9-] par `nomFichierCra` : rien
        // de ce que l'utilisateur a saisi ne peut refermer les guillemets de
        // cet en-tête.
        'content-disposition': `attachment; filename="${fileName}"`,
        // Un CRA est nominatif et peut être remplacé par son archive signée
        // d'une minute à l'autre : rien à mettre en cache ici.
        'cache-control': 'no-store, must-revalidate',
      },
    })
  } catch {
    // Un CRA inexistant et un CRA appartenant à quelqu'un d'autre doivent
    // être indiscernables : `chargerContexte` les traite déjà de la même
    // façon, la route ne doit pas les redistinguer — ni par le statut, ni en
    // recopiant le message d'origine dans le corps.
    return NextResponse.json({ erreur: 'CRA introuvable.' }, { status: 404 })
  }
}
