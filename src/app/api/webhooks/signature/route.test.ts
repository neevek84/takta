import { describe, it, expect, vi, beforeEach } from 'vitest'

const { etat } = vi.hoisted(() => ({
  etat: {
    resultat: { ok: true, effet: 'VALIDE', craId: 'cra-1' } as unknown,
    appels: [] as Array<{ rawBody: string; signatureHeader: string }>,
  },
}))

vi.mock('@/services/signature/webhook', () => ({
  handleSignatureWebhook: async (args: { rawBody: string; signatureHeader: string }) => {
    etat.appels.push({ rawBody: args.rawBody, signatureHeader: args.signatureHeader })
    return etat.resultat
  },
}))

// `vi.mock` est hissé au-dessus des imports : l'ordre lu ici n'est pas
// l'ordre exécuté, et la route reçoit bien le double.
import { POST } from './route'

function requete(corps: string, entetes: Record<string, string> = {}): Promise<Response> {
  return POST(new Request('http://local/api/webhooks/signature', { method: 'POST', body: corps, headers: entetes }))
}

describe('POST /api/webhooks/signature', () => {
  beforeEach(() => {
    etat.appels.length = 0
    etat.resultat = { ok: true, effet: 'VALIDE', craId: 'cra-1' }
  })

  it('transmet le corps BRUT et l en-tête de signature', async () => {
    const corps = '{"event":"DOCUMENT_COMPLETED","payload":{"id":42}}'
    await requete(corps, { 'x-documenso-signature': 'sha256=abc' })
    expect(etat.appels).toEqual([{ rawBody: corps, signatureHeader: 'sha256=abc' }])
  })

  it('ne réordonne jamais la charge : un HMAC porte sur les octets reçus', async () => {
    // Un aller-retour `await request.json()` puis `JSON.stringify` produirait
    // une chaîne différente — clés réordonnées, espaces perdus — et la
    // signature ne vaudrait plus rien.
    const corps = '{\n  "payload": {"id": 42},\n  "event": "DOCUMENT_COMPLETED"\n}'
    await requete(corps, { 'x-documenso-signature': 'sha256=abc' })
    expect(etat.appels[0]!.rawBody).toBe(corps)
  })

  it('accepte aussi l en-tête générique', async () => {
    await requete('{}', { 'x-cra-signature': 'sha256=def' })
    expect(etat.appels[0]!.signatureHeader).toBe('sha256=def')
  })

  it('passe une signature vide plutôt que de deviner, quand aucun en-tête n est fourni', async () => {
    await requete('{}')
    expect(etat.appels[0]!.signatureHeader).toBe('')
  })

  it('rend 200 et l effet obtenu', async () => {
    const r = await requete('{}')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ resultat: 'VALIDE' })
  })

  it('rend 401 sur une signature invalide', async () => {
    etat.resultat = { ok: false, raison: 'SIGNATURE_INVALIDE' }
    expect((await requete('{}')).status).toBe(401)
  })

  it('rend 400 sur une charge illisible', async () => {
    etat.resultat = { ok: false, raison: 'CHARGE_ILLISIBLE' }
    expect((await requete('{}')).status).toBe(400)
  })

  it('accuse réception d une référence inconnue sans rien révéler', async () => {
    etat.resultat = { ok: false, raison: 'LIEN_INCONNU' }
    const r = await requete('{}')
    expect(r.status).toBe(202)
    expect(JSON.stringify(await r.json())).not.toContain('cra')
  })

  it('ne renvoie jamais l identifiant interne du CRA au prestataire', async () => {
    // Le prestataire n'a pas à apprendre nos identifiants : il sait ce qu'il a
    // livré, le reste ne le regarde pas.
    etat.resultat = { ok: true, effet: 'VALIDE', craId: 'cra-secret-123' }
    const r = await requete('{}')
    expect(JSON.stringify(await r.json())).not.toContain('cra-secret-123')
  })
})
