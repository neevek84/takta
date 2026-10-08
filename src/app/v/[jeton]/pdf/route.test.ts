import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ lienDeLaSession: vi.fn(), pdfSigneDuLien: vi.fn() }))
vi.mock('../session', () => ({ lienDeLaSession: m.lienDeLaSession }))
vi.mock('@/services/signature/lien-client', () => ({ pdfSigneDuLien: m.pdfSigneDuLien }))

import { GET } from './route'

const J = 'a'.repeat(64)
const appel = () => GET(new Request(`https://cra.test/v/${J}/pdf`), { params: Promise.resolve({ jeton: J }) })

beforeEach(() => {
  m.lienDeLaSession.mockReset()
  m.pdfSigneDuLien.mockReset()
})

describe('GET /v/[jeton]/pdf', () => {
  it('sans session : 404, et le service n est pas interrogé', async () => {
    m.lienDeLaSession.mockResolvedValue(null)
    expect((await appel()).status).toBe(404)
    expect(m.pdfSigneDuLien).not.toHaveBeenCalled()
  })

  it('session mais pas de PDF signé : 404', async () => {
    m.lienDeLaSession.mockResolvedValue('l1')
    m.pdfSigneDuLien.mockResolvedValue(null)
    expect((await appel()).status).toBe(404)
    expect(m.pdfSigneDuLien).toHaveBeenCalledWith('l1')
  })

  it('succès : le PDF en pièce jointe, jamais mis en cache', async () => {
    m.lienDeLaSession.mockResolvedValue('l1')
    m.pdfSigneDuLien.mockResolvedValue({ fileName: 'CRA-0001.pdf', bytes: new Uint8Array([37, 80, 68, 70]) })
    const r = await appel()
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="CRA-0001.pdf"')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]))
  })
})
