import { NextResponse } from 'next/server'
import { requireUser } from '@/auth'
import { buildPlanningPdf, PeriodeInvalide, type PerimetrePlanning } from '@/services/planning-pdf'

/**
 * Téléchargement d'un planning d'intervention, sur une période choisie.
 *
 *     /planning/pdf?ligne=<id>&du=2026-11-01&au=2027-06-30[&perimetre=MISSION]
 *
 * La route transporte : le service vérifie la période et le droit sur la
 * prestation, comme pour le CRA.
 */
export async function GET(request: Request): Promise<Response> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch {
    return NextResponse.json({ erreur: 'Non authentifié.' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const lineId = params.get('ligne') ?? ''
  const perimetre: PerimetrePlanning =
    params.get('perimetre') === 'MISSION' ? 'MISSION' : 'PRESTATION'
  const periode = { du: params.get('du') ?? '', au: params.get('au') ?? '' }

  try {
    const { fileName, bytes } = await buildPlanningPdf(userId, {
      lineId,
      perimetre,
      periode,
      aujourdhui: new Date().toISOString().slice(0, 10),
    })
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        // Réduit à [A-Za-z0-9-] par `nomFichierPlanning`.
        'content-disposition': `attachment; filename="${fileName}"`,
        'cache-control': 'no-store, must-revalidate',
      },
    })
  } catch (e) {
    if (e instanceof PeriodeInvalide) {
      return NextResponse.json({ erreur: e.message }, { status: 400 })
    }
    // Prestation inconnue ou affectée à un autre : indiscernables.
    return NextResponse.json({ erreur: 'Prestation introuvable.' }, { status: 404 })
  }
}
