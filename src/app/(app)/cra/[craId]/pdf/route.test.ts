import { describe, it, expect, vi, beforeEach } from 'vitest'

const { etat } = vi.hoisted(() => ({
  etat: {
    userId: 'u1',
    resultat: {
      fileName: 'CRA-ACME-ITSM-2026-06.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      archive: false,
    } as { fileName: string; bytes: Uint8Array; archive: boolean },
    erreur: null as Error | null,
    appels: [] as Array<{ userId: string; craId: string }>,
  },
}))

vi.mock('@/auth', () => ({
  requireUser: vi.fn(async () => ({ id: etat.userId, role: 'ADMIN' as const })),
}))
vi.mock('@/services/cra-pdf', () => ({
  getCraPdfForDownload: async (userId: string, craId: string) => {
    etat.appels.push({ userId, craId })
    if (etat.erreur !== null) throw etat.erreur
    return etat.resultat
  },
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { GET } from './route'

function requete(craId: string): Promise<Response> {
  return GET(new Request(`http://local/cra/${craId}/pdf`), {
    params: Promise.resolve({ craId }),
  })
}

describe('GET /cra/{craId}/pdf', () => {
  beforeEach(() => {
    etat.erreur = null
    etat.appels.length = 0
    etat.resultat = {
      fileName: 'CRA-ACME-ITSM-2026-06.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      archive: false,
    }
  })

  it('sert le PDF avec le bon type de contenu', async () => {
    const r = await requete('cra-1')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
  })

  it('propose le fichier en pièce jointe, sous son nom', async () => {
    const r = await requete('cra-1')
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="CRA-ACME-ITSM-2026-06.pdf"',
    )
  })

  it('sert l archive signée sous son propre nom, sans rien changer au transport', async () => {
    etat.resultat = {
      fileName: 'CRA-ACME-ITSM-2026-06-signe.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      archive: true,
    }
    const r = await requete('cra-1')
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="CRA-ACME-ITSM-2026-06-signe.pdf"',
    )
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    )
  })

  it('scope la demande sur l utilisateur de la session, jamais sur un paramètre', async () => {
    await requete('cra-1')
    expect(etat.appels).toEqual([{ userId: 'u1', craId: 'cra-1' }])
  })

  it('interdit la mise en cache d un document nominatif', async () => {
    const r = await requete('cra-1')
    expect(r.headers.get('cache-control')).toContain('no-store')
  })

  it('rend 404 quand le CRA n existe pas ou n appartient pas à l utilisateur', async () => {
    etat.erreur = new Error('No Cra found')
    const r = await requete('inconnu')
    expect(r.status).toBe(404)
  })

  it('ne laisse jamais fuiter la cause de l échec dans le corps', async () => {
    // Un CRA inexistant et le CRA d un autre doivent rester indiscernables :
    // le message d origine (« No Cra found », un mois invalide, une panne de
    // base) dirait à l appelant ce qu il n a pas le droit de savoir.
    etat.erreur = new Error('No Cra found: cra-secret-de-quelqu-un-d-autre')
    const r = await requete('cra-1')
    expect(r.status).toBe(404)
    expect(await r.text()).not.toContain('cra-secret-de-quelqu-un-d-autre')
  })

  it('rend 401 quand la session manque', async () => {
    const { requireUser } = await import('@/auth')
    vi.mocked(requireUser).mockRejectedValueOnce(new Error('Non authentifié'))
    const r = await requete('cra-1')
    expect(r.status).toBe(401)
    expect(etat.appels).toEqual([])
  })
})
