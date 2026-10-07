import { describe, it, expect } from 'vitest'
import { SignatureConnectorError } from '@/core/signature/connector'
import { createFakeSignatureConnector } from './fake-connector'

/**
 * Le double du connecteur est un outil de test : il mérite donc lui-même
 * d'être tenu. Un double complaisant valide un service qui ne marcherait pas.
 */
describe('createFakeSignatureConnector — sévérité', () => {
  const envoiValide = {
    titre: 'CRA ACME — juin 2026',
    fileName: 'CRA-ACME-2026-06.pdf',
    pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    destinataire: { nom: 'Claire Martin', email: 'claire@acme.test' },
    champs: [
      {
        nature: 'SIGNATURE' as const,
        ancre: '[[cra:signature]]',
        page: 1,
        x: 600,
        y: 120,
        largeur: 148,
        hauteur: 34,
        pageLargeur: 842,
        pageHauteur: 595,
      },
    ],
    reference: 'cra-x',
  }

  it('GARDE-FOU INVERSE : un envoi complet passe et rend une référence', async () => {
    const c = createFakeSignatureConnector()
    expect(await c.send(envoiValide)).toEqual({ externalId: 'ext-1', jetonSignataire: 'jeton-1' })
    expect(await c.send(envoiValide)).toEqual({ externalId: 'ext-2', jetonSignataire: 'jeton-2' })
    expect(c.envois).toHaveLength(2)
  })

  it('refuse un envoi sans titre, sans destinataire joignable ou sans document', async () => {
    const c = createFakeSignatureConnector()
    await expect(c.send({ ...envoiValide, titre: '  ' })).rejects.toBeInstanceOf(
      SignatureConnectorError,
    )
    await expect(
      c.send({ ...envoiValide, destinataire: { nom: 'C', email: 'pas-une-adresse' } }),
    ).rejects.toBeInstanceOf(SignatureConnectorError)
    await expect(
      c.send({ ...envoiValide, destinataire: { nom: '', email: 'c@acme.test' } }),
    ).rejects.toBeInstanceOf(SignatureConnectorError)
    await expect(c.send({ ...envoiValide, pdf: new Uint8Array([]) })).rejects.toBeInstanceOf(
      SignatureConnectorError,
    )
    expect(c.envois).toHaveLength(0)
  })

  it('rend EN_ATTENTE pour une référence inconnue, jamais une issue inventée', async () => {
    const c = createFakeSignatureConnector()
    expect(await c.status('jamais-vu')).toEqual({ statut: 'EN_ATTENTE', motifRefus: null })
  })

  it('rejoue les pannes qui comptent — envoi refusé, téléchargement impossible', async () => {
    const c = createFakeSignatureConnector()
    c.faireEchouerEnvoi('injoignable')
    await expect(c.send(envoiValide)).rejects.toMatchObject({ statusCode: 502 })

    const d = createFakeSignatureConnector()
    d.faireEchouerTelechargement('injoignable')
    await expect(d.download('ext-1')).rejects.toMatchObject({ statusCode: 503 })
    expect(d.telechargements).toEqual([])
  })

  it('annule, et peut échouer à annuler', async () => {
    const c = createFakeSignatureConnector()
    await c.annuler('ext-1')
    expect(c.annulations).toEqual(['ext-1'])
    c.faireEchouerAnnulation('panne')
    await expect(c.annuler('ext-2')).rejects.toThrow('panne')
  })

  it('rend le motif de refus réglé', async () => {
    const c = createFakeSignatureConnector()
    c.regler('ext-9', 'REFUSE', 'Il manque le 15.')
    expect(await c.status('ext-9')).toEqual({ statut: 'REFUSE', motifRefus: 'Il manque le 15.' })
  })
})
