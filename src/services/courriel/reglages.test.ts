import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { currentAuditSeq, readAuditSince } from '@/services/audit'
import { saveInstanceCredential } from '@/services/credentials'
import { readSmtpConfig, type Mailer, type SmtpConfig } from '@/services/notify'
import { PROVIDER_SMTP, lireMotDePasseSmtp } from './mot-de-passe'
import {
  enregistrerReglagesCourriel,
  envoyerCourrielTest,
  vueReglagesCourriel,
} from './reglages'

/** Aucun vrai secret : ces chaînes n'ouvrent rien. */
const MDP_ECRAN = 'mdp-application-ecran-0000'
const MDP_ENV = 'mdp-environnement-00000'

const ENV = ['SMTP_PASSWORD', 'CREDENTIALS_KEY'] as const
const initial = Object.fromEntries(ENV.map((n) => [n, process.env[n]]))
const EMAIL_ADMIN = 'admin-courriel@test.local'

let userId = ''

const SAISIE = {
  host: 'smtp.gmail.com',
  port: '465',
  chiffrement: 'tls',
  user: 'cra@exemple.test',
  from: 'Kreativ <cra@exemple.test>',
  motDePasse: MDP_ECRAN,
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: EMAIL_ADMIN, name: 'Admin Courriel', passwordHash: 'x' },
  })
  userId = u.id
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton' }, update: {} })
})

beforeEach(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  delete process.env.SMTP_PASSWORD
  await prisma.providerCredential.deleteMany({})
  await prisma.settings.update({
    where: { id: 'singleton' },
    data: { smtpHost: '', smtpPort: 0, smtpUser: '', smtpFrom: '', smtpSecure: true },
  })
})

afterAll(async () => {
  for (const n of ENV) {
    if (initial[n] === undefined) delete process.env[n]
    else process.env[n] = initial[n]
  }
  await prisma.providerCredential.deleteMany({})
  await prisma.settings.update({
    where: { id: 'singleton' },
    data: { smtpHost: '', smtpPort: 0, smtpUser: '', smtpFrom: '', smtpSecure: true },
  })
  await prisma.user.deleteMany({ where: { email: EMAIL_ADMIN } })
})

describe('le mot de passe en vigueur : écran > environnement', () => {
  it('rien de posé : aucun', async () => {
    expect(await lireMotDePasseSmtp()).toEqual({ provenance: 'aucune', motDePasse: '', illisible: false })
  })

  it('SMTP_PASSWORD reste un repli', async () => {
    process.env.SMTP_PASSWORD = MDP_ENV
    expect(await lireMotDePasseSmtp()).toMatchObject({ provenance: 'env', motDePasse: MDP_ENV })
  })

  it('le mot de passe enregistré l emporte', async () => {
    process.env.SMTP_PASSWORD = MDP_ENV
    await saveInstanceCredential({ provider: PROVIDER_SMTP, secret: MDP_ECRAN })
    expect(await lireMotDePasseSmtp()).toMatchObject({ provenance: 'ecran', motDePasse: MDP_ECRAN })
  })

  it('un mot de passe illisible (clé changée) retombe sur l environnement, et le dit', async () => {
    await saveInstanceCredential({ provider: PROVIDER_SMTP, secret: MDP_ECRAN })
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
    process.env.SMTP_PASSWORD = MDP_ENV
    expect(await lireMotDePasseSmtp()).toEqual({ provenance: 'env', motDePasse: MDP_ENV, illisible: true })
  })
})

describe('enregistrerReglagesCourriel', () => {
  it('écrit les colonnes Settings et chiffre le mot de passe', async () => {
    const r = await enregistrerReglagesCourriel({ userId, ...SAISIE })
    expect(r).toEqual({ ok: true })

    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(row).toMatchObject({
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpUser: 'cra@exemple.test',
      smtpFrom: 'Kreativ <cra@exemple.test>',
      smtpSecure: true,
    })

    // Chiffré au repos : la base ne contient pas le mot de passe en clair.
    const cred = await prisma.providerCredential.findFirstOrThrow({ where: { provider: PROVIDER_SMTP } })
    expect(JSON.stringify(cred)).not.toContain(MDP_ECRAN)
    expect((await lireMotDePasseSmtp()).motDePasse).toBe(MDP_ECRAN)
  })

  it('readSmtpConfig utilise le mot de passe enregistré', async () => {
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    expect(await readSmtpConfig()).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'cra@exemple.test',
      from: 'Kreativ <cra@exemple.test>',
      secure: true,
      password: MDP_ECRAN,
    })
  })

  it('un mot de passe laissé vide conserve celui qui est enregistré', async () => {
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    const r = await enregistrerReglagesCourriel({ userId, ...SAISIE, port: '587', chiffrement: 'starttls', motDePasse: '' })
    expect(r).toEqual({ ok: true })
    expect((await lireMotDePasseSmtp()).motDePasse).toBe(MDP_ECRAN)
    expect(await readSmtpConfig()).toMatchObject({ port: 587, secure: false })
  })

  it('exige un mot de passe quand il y a un utilisateur et rien d enregistré', async () => {
    const r = await enregistrerReglagesCourriel({ userId, ...SAISIE, motDePasse: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.join(' ')).toMatch(/mot de passe/i)
    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(row.smtpHost).toBe('')
  })

  it('SMTP_PASSWORD suffit à ne pas exiger de saisie', async () => {
    process.env.SMTP_PASSWORD = MDP_ENV
    const r = await enregistrerReglagesCourriel({ userId, ...SAISIE, motDePasse: '' })
    expect(r).toEqual({ ok: true })
    expect(await readSmtpConfig()).toMatchObject({ password: MDP_ENV })
  })

  it('un relais sans utilisateur : aucun mot de passe exigé, l ancien est retiré', async () => {
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    const r = await enregistrerReglagesCourriel({
      userId,
      host: 'smtp-relay.gmail.com',
      port: '587',
      chiffrement: 'starttls',
      user: '',
      from: 'cra@exemple.test',
      motDePasse: '',
    })
    expect(r).toEqual({ ok: true })
    expect(await prisma.providerCredential.count({ where: { provider: PROVIDER_SMTP } })).toBe(0)
    expect(await readSmtpConfig()).toMatchObject({ host: 'smtp-relay.gmail.com', user: '', password: '' })
  })

  it('refuse un mot de passe sans utilisateur', async () => {
    const r = await enregistrerReglagesCourriel({ userId, ...SAISIE, user: '' })
    expect(r.ok).toBe(false)
  })

  it('rend les erreurs de validation sans rien écrire', async () => {
    const r = await enregistrerReglagesCourriel({ userId, ...SAISIE, host: '', from: 'rien' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.length).toBeGreaterThanOrEqual(2)
    expect(await prisma.providerCredential.count()).toBe(0)
  })

  it('consigne reglage.modifie sans le mot de passe', async () => {
    const avant = await currentAuditSeq()
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    const entrees = (await readAuditSince({ since: avant })).filter((e) => e.action === 'reglage.modifie')
    expect(entrees).toHaveLength(1)
    expect(entrees[0]!.entityId).toBe('courriel')
    const texte = JSON.stringify(entrees[0])
    expect(texte).not.toContain(MDP_ECRAN)
    expect(texte).toContain('smtpMotDePasse')
  })
})

describe('vueReglagesCourriel', () => {
  it('ne rend jamais le mot de passe, mais dit d où il vient', async () => {
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    const vue = await vueReglagesCourriel(userId)
    expect(JSON.stringify(vue)).not.toContain(MDP_ECRAN)
    expect(vue).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'cra@exemple.test',
      from: 'Kreativ <cra@exemple.test>',
      motDePasse: { provenance: 'ecran', illisible: false },
      complete: true,
      adresseAdministrateur: EMAIL_ADMIN,
    })
  })

  it('une instance nue : incomplète, sans mot de passe', async () => {
    expect(await vueReglagesCourriel(userId)).toMatchObject({
      complete: false,
      motDePasse: { provenance: 'aucune' },
    })
  })
})

describe('envoyerCourrielTest', () => {
  function doubles(echec?: unknown) {
    const recus: Array<{ config: SmtpConfig; message: Parameters<Mailer>[0] }> = []
    const creerMailer = (config: SmtpConfig): Mailer => async (message) => {
      if (echec !== undefined) throw echec
      recus.push({ config, message })
    }
    return { recus, creerMailer }
  }

  it('sans configuration complète : le dit, sans rien tenter', async () => {
    const { recus, creerMailer } = doubles()
    const r = await envoyerCourrielTest({ destinataire: 'a@b.test' }, { creerMailer })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/incompl/)
    expect(recus).toHaveLength(0)
  })

  it('refuse un destinataire qui n est pas une adresse', async () => {
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    const { recus, creerMailer } = doubles()
    const r = await envoyerCourrielTest({ destinataire: 'pas une adresse' }, { creerMailer })
    expect(r.ok).toBe(false)
    expect(recus).toHaveLength(0)
  })

  it('envoie réellement par le transport configuré', async () => {
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    const { recus, creerMailer } = doubles()
    const r = await envoyerCourrielTest({ destinataire: ' a@b.test ' }, { creerMailer })
    expect(r).toMatchObject({ ok: true })
    expect(recus).toHaveLength(1)
    expect(recus[0]!.config).toMatchObject({ host: 'smtp.gmail.com', password: MDP_ECRAN })
    expect(recus[0]!.message.to).toBe('a@b.test')
    expect(recus[0]!.message.sujet).toMatch(/test/i)
  })

  it('traduit l erreur du transport sans recopier le message du serveur', async () => {
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    const echec = Object.assign(new Error(`535 auth failed for cra@exemple.test with ${MDP_ECRAN}`), {
      code: 'EAUTH',
    })
    const { creerMailer } = doubles(echec)
    const r = await envoyerCourrielTest({ destinataire: 'a@b.test' }, { creerMailer })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toMatch(/identifiants/)
      expect(r.message).not.toContain(MDP_ECRAN)
      expect(r.message).not.toContain('535')
    }
  })

  it('un transport qui ne répond jamais échoue au délai', async () => {
    await enregistrerReglagesCourriel({ userId, ...SAISIE })
    const creerMailer = (): Mailer => () => new Promise<void>(() => {})
    const r = await envoyerCourrielTest({ destinataire: 'a@b.test' }, { creerMailer, delaiMs: 20 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/injoignable/)
  })
})
