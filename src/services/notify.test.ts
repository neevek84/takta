import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { gabaritRuptureJournal } from '@/core/notify/templates'
import { randomBytes } from 'node:crypto'
import { saveInstanceCredential } from '@/services/credentials'
import { PROVIDER_SMTP } from '@/services/courriel/mot-de-passe'
import { notify, readSmtpConfig, type Mailer } from './notify'

const GABARIT = gabaritRuptureJournal({ seq: 412, raison: 'EMPREINTE' })
const MOT_DE_PASSE = process.env.SMTP_PASSWORD
const CLE_INITIALE = process.env.CREDENTIALS_KEY

beforeAll(async () => {
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  })
})

beforeEach(async () => {
  await prisma.settings.update({
    where: { id: 'singleton' },
    data: {
      notificationEmail: '',
      smtpHost: '',
      smtpPort: 0,
      smtpUser: '',
      smtpFrom: '',
      smtpSecure: true,
    },
  })
  delete process.env.SMTP_PASSWORD
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  await prisma.providerCredential.deleteMany({ where: { provider: PROVIDER_SMTP } })
})

afterAll(async () => {
  if (MOT_DE_PASSE === undefined) delete process.env.SMTP_PASSWORD
  else process.env.SMTP_PASSWORD = MOT_DE_PASSE
  if (CLE_INITIALE === undefined) delete process.env.CREDENTIALS_KEY
  else process.env.CREDENTIALS_KEY = CLE_INITIALE
  await prisma.providerCredential.deleteMany({ where: { provider: PROVIDER_SMTP } })
  await prisma.$disconnect()
})

function espion(): { mailer: Mailer; envois: Array<{ to: string; sujet: string; corps: string }> } {
  const envois: Array<{ to: string; sujet: string; corps: string }> = []
  return {
    envois,
    mailer: async (message) => {
      envois.push(message)
    },
  }
}

describe('lecture de la configuration SMTP', () => {
  it('rend null tant qu il manque quelque chose', async () => {
    expect(await readSmtpConfig()).toBeNull()

    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { smtpHost: 'smtp.exemple.test', smtpPort: 587, smtpFrom: 'cra@exemple.test' },
    })
    // Le port manque encore.
    await prisma.settings.update({ where: { id: 'singleton' }, data: { smtpPort: 0 } })
    expect(await readSmtpConfig()).toBeNull()

    // Un utilisateur est renseigné : le mot de passe devient obligatoire, et
    // il vit dans l'environnement, pas en base.
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { smtpPort: 587, smtpUser: 'cra' },
    })
    expect(await readSmtpConfig()).toBeNull()
  })

  it('rend la configuration quand tout est là', async () => {
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: {
        smtpHost: 'smtp.exemple.test',
        smtpPort: 587,
        smtpUser: 'cra',
        smtpFrom: 'cra@exemple.test',
        smtpSecure: false,
      },
    })
    process.env.SMTP_PASSWORD = 'motdepasse'

    expect(await readSmtpConfig()).toEqual({
      host: 'smtp.exemple.test',
      port: 587,
      user: 'cra',
      from: 'cra@exemple.test',
      secure: false,
      password: 'motdepasse',
    })
  })

  it('préfère le mot de passe enregistré à l écran à SMTP_PASSWORD', async () => {
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { smtpHost: 'smtp.exemple.test', smtpPort: 465, smtpUser: 'cra', smtpFrom: 'cra@exemple.test' },
    })
    process.env.SMTP_PASSWORD = 'repli-environnement'
    await saveInstanceCredential({ provider: PROVIDER_SMTP, secret: 'mot-de-passe-ecran' })

    expect(await readSmtpConfig()).toMatchObject({ password: 'mot-de-passe-ecran' })
  })

  it('accepte un relais qui n authentifie pas', async () => {
    // Un relais local sans compte est une configuration complète : exiger un
    // mot de passe là où le serveur n'en demande pas fermerait l'envoi sans
    // raison. C'est l'utilisateur renseigné sans secret qui est incomplet.
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: {
        smtpHost: 'localhost',
        smtpPort: 25,
        smtpUser: '',
        smtpFrom: 'cra@exemple.test',
        smtpSecure: false,
      },
    })

    expect(await readSmtpConfig()).toMatchObject({ host: 'localhost', user: '', password: '' })
  })
})

describe('notification', () => {
  it('envoie au destinataire configuré', async () => {
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { notificationEmail: 'keveen@exemple.test' },
    })
    const { mailer, envois } = espion()

    expect(await notify(GABARIT, { mailer })).toEqual({ envoye: true, motif: '' })
    expect(envois).toEqual([{ to: 'keveen@exemple.test', sujet: GABARIT.sujet, corps: GABARIT.corps }])
  })

  it('SANS CONFIGURATION SMTP, consigne au lieu d échouer', async () => {
    // C'est ce qui permet à l'ordonnanceur de tourner sur une instance nue.
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { notificationEmail: 'keveen@exemple.test' },
    })

    const r = await notify(GABARIT)
    expect(r.envoye).toBe(false)
    expect(r.motif).toContain('SMTP')
  })

  it('sans destinataire, ne tente rien et le dit', async () => {
    const { mailer, envois } = espion()
    const r = await notify(GABARIT, { mailer })

    expect(r).toMatchObject({ envoye: false })
    expect(r.motif).toContain('destinataire')
    expect(envois).toHaveLength(0)
  })

  it('LAISSE REMONTER une erreur d envoi', async () => {
    // L'absence de configuration est tolérée ; une panne d'envoi, non — elle
    // est actionnable, et doit apparaître dans la supervision.
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { notificationEmail: 'keveen@exemple.test' },
    })
    const mailer: Mailer = async () => {
      throw new Error('EAUTH')
    }

    await expect(notify(GABARIT, { mailer })).rejects.toThrow(/EAUTH/)
  })

  it('accepte un destinataire explicite', async () => {
    const { mailer, envois } = espion()
    await notify(GABARIT, { mailer, destinataire: 'autre@exemple.test' })
    expect(envois[0]!.to).toBe('autre@exemple.test')
  })

  it('transmet les pièces jointes au transport, telles quelles', async () => {
    const recus: Array<Parameters<Mailer>[0]> = []
    const mailer: Mailer = async (m) => {
      recus.push(m)
    }
    const octets = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    await notify(
      { sujet: 'S', corps: 'C' },
      { mailer, destinataire: 'a@b.test', pieces: [{ nom: 'cra.pdf', type: 'application/pdf', octets }] },
    )
    expect(recus[0]!.pieces).toEqual([{ nom: 'cra.pdf', type: 'application/pdf', octets }])
  })
})
