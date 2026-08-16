import { describe, it, expect } from 'vitest'
import {
  SIGNATURE_STATUSES,
  SignatureConnectorError,
  estStatutDeSignature,
} from './connector'

describe('statuts de signature', () => {
  it('couvre exactement les quatre issues possibles', () => {
    expect([...SIGNATURE_STATUSES]).toEqual(['EN_ATTENTE', 'SIGNE', 'REFUSE', 'EXPIRE'])
  })

  it('reconnaît un statut connu et rejette le reste', () => {
    expect(estStatutDeSignature('SIGNE')).toBe(true)
    expect(estStatutDeSignature('COMPLETED')).toBe(false)
    expect(estStatutDeSignature('')).toBe(false)
  })
})

describe('SignatureConnectorError', () => {
  it('transporte le code HTTP pour que l appelant sache s il peut réessayer', () => {
    const e = new SignatureConnectorError('Refusé par le prestataire', 401)
    expect(e.statusCode).toBe(401)
    expect(e.name).toBe('SignatureConnectorError')
    expect(e).toBeInstanceOf(Error)
  })

  it('vaut zéro quand l échec n est pas un code HTTP', () => {
    expect(new SignatureConnectorError('transport injoignable').statusCode).toBe(0)
  })
})
