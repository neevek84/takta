import { pdfSigneDuLien } from '@/services/signature/lien-client'
import { lienDeLaSession } from '../session'

/** Le PDF signé, pour une session client ouverte sur **ce** lien ; sinon 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ jeton: string }> }): Promise<Response> {
  const { jeton } = await params
  const lienId = await lienDeLaSession(jeton)
  const pdf = lienId === null ? null : await pdfSigneDuLien(lienId)
  if (pdf === null) return new Response('Introuvable', { status: 404 })
  return new Response(pdf.bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.fileName}"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
