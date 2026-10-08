import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn()
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) }
})
vi.mock('nodemailer', () => ({ default: { createTransport } }))

import { buildSmtpMailer } from './mailer'

const CONFIG = {
  host: 'smtp.exemple.test',
  port: 465,
  user: 'cra@exemple.test',
  from: 'Kreativ <cra@exemple.test>',
  secure: true,
  password: 'mot-de-passe-fictif',
}

beforeEach(() => {
  createTransport.mockClear()
  sendMail.mockReset().mockResolvedValue({})
})

describe('buildSmtpMailer', () => {
  it('borne la connexion, l accueil et la socket : un envoi ne pend jamais', () => {
    buildSmtpMailer(CONFIG)
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.exemple.test',
        port: 465,
        secure: true,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
        auth: { user: 'cra@exemple.test', pass: 'mot-de-passe-fictif' },
      }),
    )
  })

  it('sans utilisateur, aucune authentification', () => {
    buildSmtpMailer({ ...CONFIG, user: '', password: '' })
    const options = (createTransport.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(options.auth).toBeUndefined()
  })

  it('envoie depuis l adresse configurée', async () => {
    await buildSmtpMailer(CONFIG)({ to: 'a@b.test', sujet: 'S', corps: 'C' })
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Kreativ <cra@exemple.test>', to: 'a@b.test', subject: 'S', text: 'C' }),
    )
  })
})
