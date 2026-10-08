import { prisma } from '@/db/client'
import { DELAIS_SMTP, estAdresse, messageErreurSmtp, validerReglagesSmtp } from '@/core/courriel/smtp'
import { gabaritCourrielTest } from '@/core/notify/templates'
import { actorOf, appendAudit } from '@/services/audit'
import {
  getInstanceCredential,
  revokeInstanceCredential,
  saveInstanceCredential,
} from '@/services/credentials'
import { readSmtpConfig, type Mailer, type SmtpConfig } from '@/services/notify'
import { PROVIDER_SMTP, lireMotDePasseSmtp, type ProvenanceMotDePasse } from './mot-de-passe'

/**
 * Les réglages d'envoi de courriel, saisis dans Administration · Courriel.
 *
 * Le serveur, le port, le chiffrement, l'utilisateur et l'adresse d'expédition
 * vivent dans les colonnes `smtp*` de `Settings` — celles que
 * `readSmtpConfig` lisait déjà sans qu'aucun écran ne les écrive. Le mot de
 * passe vit chiffré en identifiant d'instance (`mot-de-passe.ts`), et
 * `SMTP_PASSWORD` reste un repli.
 *
 * Les lectures ne prennent pas de `userId` pour cloisonner : le contrôle
 * d'accès est celui de la page et des actions. Les écritures en prennent un,
 * pour le journal.
 */

/** Ce qu'un écran a le droit de voir : tout sauf le mot de passe. */
export interface VueReglagesCourriel {
  host: string
  port: number
  secure: boolean
  user: string
  from: string
  motDePasse: { provenance: ProvenanceMotDePasse; illisible: boolean; enregistreLe: Date | null }
  /** `readSmtpConfig` rend une configuration : les envois partiront */
  complete: boolean
  /** l'adresse du compte qui regarde, destinataire par défaut du test */
  adresseAdministrateur: string
}

export async function vueReglagesCourriel(userId: string): Promise<VueReglagesCourriel> {
  const [row, mdp, config, user, ligne] = await Promise.all([
    prisma.settings.findUnique({
      where: { id: 'singleton' },
      select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpFrom: true, smtpSecure: true },
    }),
    lireMotDePasseSmtp(),
    readSmtpConfig(),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    getInstanceCredential(PROVIDER_SMTP),
  ])

  return {
    host: row?.smtpHost ?? '',
    port: row?.smtpPort ?? 0,
    secure: row?.smtpSecure ?? true,
    user: row?.smtpUser ?? '',
    from: row?.smtpFrom ?? '',
    motDePasse: {
      provenance: mdp.provenance,
      illisible: mdp.illisible,
      enregistreLe: mdp.provenance === 'ecran' ? (ligne?.connectedAt ?? null) : null,
    },
    complete: config !== null,
    adresseAdministrateur: user?.email ?? '',
  }
}

export type ResultatEnregistrement = { ok: true } | { ok: false; erreurs: string[] }

/**
 * Enregistre les réglages. **Un mot de passe laissé vide conserve celui qui
 * est en vigueur** : changer de port ne doit pas obliger à ressaisir un secret
 * que l'écran ne réaffiche jamais.
 *
 * Sans utilisateur (relais qui authentifie par l'adresse IP), aucun mot de
 * passe n'a de sens : celui qui était enregistré est retiré, plutôt que de
 * garder en base un secret qui ne sert plus.
 *
 * Rien n'est essayé ici : « Envoyer un courriel de test » est fait pour ça, et
 * un serveur momentanément injoignable ne doit pas empêcher d'enregistrer.
 */
export async function enregistrerReglagesCourriel(args: {
  userId: string
  host: string
  port: string
  chiffrement: string
  user: string
  from: string
  motDePasse: string
}): Promise<ResultatEnregistrement> {
  const validation = validerReglagesSmtp(args)
  const erreurs = validation.ok ? [] : [...validation.erreurs]
  const user = args.user.trim()
  const motDePasse = args.motDePasse
  const remplace = motDePasse !== ''

  if (user === '' && remplace) {
    erreurs.push(
      "Un mot de passe sans utilisateur ne servirait pas : renseignez l'utilisateur, ou laissez le mot de passe vide pour un relais.",
    )
  }
  if (user !== '' && !remplace) {
    // L'environnement compte : une instance réglée par SMTP_PASSWORD reste
    // complète sans qu'on ressaisisse ce qu'elle a déjà.
    const enVigueur = await lireMotDePasseSmtp()
    if (enVigueur.provenance === 'aucune') {
      erreurs.push('Le mot de passe est requis quand un utilisateur est renseigné.')
    }
  }
  if (!validation.ok || erreurs.length > 0) return { ok: false, erreurs }

  const v = validation.valeur
  // Le secret d'abord : sans `CREDENTIALS_KEY`, l'enregistrement échoue avant
  // d'avoir écrit la moitié des réglages.
  if (remplace) await saveInstanceCredential({ provider: PROVIDER_SMTP, secret: motDePasse })
  else if (user === '') await revokeInstanceCredential(PROVIDER_SMTP)

  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      smtpHost: v.host,
      smtpPort: v.port,
      smtpUser: v.user,
      smtpFrom: v.from,
      smtpSecure: v.secure,
    },
    update: {
      smtpHost: v.host,
      smtpPort: v.port,
      smtpUser: v.user,
      smtpFrom: v.from,
      smtpSecure: v.secure,
    },
  })

  // Ni le mot de passe ni son empreinte : le journal est poussé vers des URL
  // tierces. Le fait qu'il ait changé, lui, est une information.
  const cles = ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpFrom']
  if (remplace || user === '') cles.push('smtpMotDePasse')
  await appendAudit({
    ...(await actorOf(args.userId)),
    action: 'reglage.modifie',
    entityType: 'Settings',
    entityId: 'courriel',
    payload: {
      cles,
      smtpHost: v.host,
      smtpPort: v.port,
      smtpSecure: v.secure,
      smtpUser: v.user,
      smtpFrom: v.from,
    },
  })
  return { ok: true }
}

export type ResultatTestCourriel = { ok: true; message: string } | { ok: false; message: string }

/**
 * Délai total du test : la somme des délais du transport, plus une marge. Le
 * transport coupe normalement avant ; ce plafond garantit que l'action rend
 * toujours la main, même si un délai interne était contourné.
 */
const DELAI_TEST_MS =
  DELAIS_SMTP.connectionTimeout + DELAIS_SMTP.greetingTimeout + DELAIS_SMTP.socketTimeout + 5_000

/**
 * Envoie réellement un courriel de test par le transport configuré — le même
 * que celui des rappels et des codes de signature. L'erreur du serveur n'est
 * jamais rendue telle quelle : elle peut recopier l'identifiant ou le secret.
 */
export async function envoyerCourrielTest(
  args: { destinataire: string },
  deps: { creerMailer?: (config: SmtpConfig) => Mailer | Promise<Mailer>; delaiMs?: number } = {},
): Promise<ResultatTestCourriel> {
  const destinataire = args.destinataire.trim()
  if (!estAdresse(destinataire)) {
    return { ok: false, message: 'Le destinataire du test doit être une adresse valide.' }
  }

  const config = await readSmtpConfig()
  if (config === null) {
    return {
      ok: false,
      message:
        'La configuration est incomplète : serveur, port, adresse d’expédition, et mot de passe si un utilisateur est renseigné.',
    }
  }

  const creerMailer =
    deps.creerMailer ??
    (async (c: SmtpConfig): Promise<Mailer> => {
      // Import différé, comme dans `notify` : nodemailer n'entre que là où
      // l'on envoie vraiment.
      const { buildSmtpMailer } = await import('@/integrations/smtp/mailer')
      return buildSmtpMailer(c)
    })

  const gabarit = gabaritCourrielTest({ expediteur: config.from, serveur: config.host })
  let minuterie: ReturnType<typeof setTimeout> | undefined
  try {
    const mailer = await creerMailer(config)
    const delai = new Promise<never>((_, rejeter) => {
      minuterie = setTimeout(
        () => rejeter(Object.assign(new Error('délai dépassé'), { code: 'ETIMEDOUT' })),
        deps.delaiMs ?? DELAI_TEST_MS,
      )
    })
    await Promise.race([mailer({ to: destinataire, sujet: gabarit.sujet, corps: gabarit.corps }), delai])
  } catch (err) {
    return { ok: false, message: messageErreurSmtp(err) }
  } finally {
    if (minuterie !== undefined) clearTimeout(minuterie)
  }

  return {
    ok: true,
    message: `Courriel de test envoyé à ${destinataire}. Vérifiez sa réception, y compris dans les indésirables.`,
  }
}
