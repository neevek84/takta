import { describe, it, expect } from 'vitest'
import {
  PRESETS_SMTP,
  adresseExpediteur,
  messageErreurSmtp,
  presetPourServeur,
  validerReglagesSmtp,
} from './smtp'

const VALIDE = {
  host: 'smtp.gmail.com',
  port: '465',
  chiffrement: 'tls',
  user: 'cra@exemple.fr',
  from: 'cra@exemple.fr',
}

describe('les préréglages', () => {
  it('Google Workspace — mot de passe d application : smtp.gmail.com, 465, TLS direct', () => {
    expect(PRESETS_SMTP['google-app']).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      utilisateurEgalExpediteur: true,
      sansAuthentification: false,
    })
  })

  it('Google Workspace — relais : smtp-relay.gmail.com, 587, STARTTLS, sans compte', () => {
    expect(PRESETS_SMTP['google-relais']).toMatchObject({
      host: 'smtp-relay.gmail.com',
      port: 587,
      secure: false,
      sansAuthentification: true,
    })
  })

  it('Microsoft 365 : smtp.office365.com, 587, STARTTLS', () => {
    expect(PRESETS_SMTP.microsoft).toMatchObject({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
    })
  })

  it('reconnaît le préréglage d un serveur enregistré, sinon « autre »', () => {
    expect(presetPourServeur('smtp.gmail.com', 465)).toBe('google-app')
    expect(presetPourServeur('SMTP-RELAY.gmail.com', 587)).toBe('google-relais')
    expect(presetPourServeur('smtp.office365.com', 587)).toBe('microsoft')
    expect(presetPourServeur('mail.exemple.fr', 25)).toBe('autre')
    expect(presetPourServeur('', 0)).toBe('autre')
  })
})

describe('adresseExpediteur', () => {
  it('accepte une adresse nue ou avec un nom affiché', () => {
    expect(adresseExpediteur('cra@exemple.fr')).toBe('cra@exemple.fr')
    expect(adresseExpediteur('Kreativ <noreply@exemple.fr>')).toBe('noreply@exemple.fr')
    expect(adresseExpediteur('"Kreativ PM" <noreply@exemple.fr>')).toBe('noreply@exemple.fr')
  })

  it('refuse ce qui n est pas une adresse, et tout saut de ligne', () => {
    expect(adresseExpediteur('pas une adresse')).toBeNull()
    expect(adresseExpediteur('cra@exemple')).toBeNull()
    expect(adresseExpediteur('Kreativ <noreply@exemple.fr')).toBeNull()
    expect(adresseExpediteur('cra@exemple.fr\r\nBcc: x@y.fr')).toBeNull()
    expect(adresseExpediteur('A <b@c.fr>, D <e@f.fr>')).toBeNull()
  })
})

describe('validerReglagesSmtp', () => {
  it('rend des valeurs normalisées', () => {
    expect(validerReglagesSmtp({ ...VALIDE, host: ' smtp.gmail.com ' })).toEqual({
      ok: true,
      valeur: {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        user: 'cra@exemple.fr',
        from: 'cra@exemple.fr',
      },
    })
    expect(validerReglagesSmtp({ ...VALIDE, chiffrement: 'starttls', port: '587' })).toMatchObject({
      ok: true,
      valeur: { secure: false, port: 587 },
    })
  })

  it('accepte un utilisateur vide (relais sans authentification)', () => {
    expect(validerReglagesSmtp({ ...VALIDE, user: '' })).toMatchObject({
      ok: true,
      valeur: { user: '' },
    })
  })

  it('refuse un serveur vide, une URL, un port hors bornes, un chiffrement inconnu', () => {
    const r = validerReglagesSmtp({
      host: 'https://smtp.gmail.com',
      port: '70000',
      chiffrement: 'ssl3',
      user: 'a b',
      from: 'rien',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erreurs).toHaveLength(5)

    const vide = validerReglagesSmtp({ ...VALIDE, host: '', port: 'abc' })
    expect(vide.ok).toBe(false)
  })
})

/** Une erreur façon nodemailer : un `code`, et un message serveur à ne jamais recopier. */
function erreur(code: string | undefined, message = 'Invalid login: 535 user=cra pass=hunter2-secret'): Error {
  return Object.assign(new Error(message), code === undefined ? {} : { code })
}

describe('messageErreurSmtp', () => {
  it('EAUTH : identifiants refusés, avec le conseil Google', () => {
    const m = messageErreurSmtp(erreur('EAUTH'))
    expect(m).toContain('identifiants')
    expect(m).toContain("mot de passe d'application")
    expect(m).toContain('EAUTH')
  })

  it.each(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'])('%s : serveur injoignable', (code) => {
    const m = messageErreurSmtp(erreur(code, 'connect ECONNREFUSED 10.0.0.1:465'))
    expect(m).toMatch(/injoignable/)
    expect(m).toContain(code)
  })

  it('un défaut de certificat ou de TLS : chiffrement inadapté au port', () => {
    expect(messageErreurSmtp(erreur('ESOCKET', 'wrong version number'))).toMatch(/chiffrement/)
    expect(messageErreurSmtp(erreur('CERT_HAS_EXPIRED', 'certificate has expired'))).toMatch(
      /chiffrement/,
    )
    expect(messageErreurSmtp(erreur('ETLS', 'x'))).toMatch(/chiffrement/)
  })

  it('EENVELOPE : expéditeur ou destinataire refusé', () => {
    expect(messageErreurSmtp(erreur('EENVELOPE', '550 relay denied'))).toMatch(/refusé/)
  })

  it('ne recopie jamais le message du serveur', () => {
    for (const code of ['EAUTH', 'ECONNECTION', 'EENVELOPE', 'EINCONNU', undefined]) {
      const m = messageErreurSmtp(erreur(code))
      expect(m).not.toContain('hunter2')
      expect(m).not.toContain('535')
    }
    expect(messageErreurSmtp('chaîne brute hunter2')).not.toContain('hunter2')
  })

  it('un code inattendu se cite, un code forgé non', () => {
    expect(messageErreurSmtp(erreur('EMESSAGE'))).toContain('EMESSAGE')
    expect(messageErreurSmtp(erreur('pass=hunter2'))).not.toContain('hunter2')
  })
})
