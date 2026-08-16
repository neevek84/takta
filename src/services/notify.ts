import { prisma } from '@/db/client'
import type { Gabarit } from '@/core/notify/templates'

export type Mailer = (message: { to: string; sujet: string; corps: string }) => Promise<void>

export interface SmtpConfig {
  host: string
  port: number
  user: string
  from: string
  secure: boolean
  /** vient de l'environnement, jamais de la base */
  password: string
}

export interface NotifyResult {
  envoye: boolean
  /** vide quand l'envoi a eu lieu ; sinon, ce qui a manqué */
  motif: string
}

/**
 * La configuration SMTP, ou `null` s'il manque quoi que ce soit.
 *
 * Le serveur, le port et l'adresse d'expédition sont des réglages ; le
 * **secret d'authentification vit dans l'environnement**, comme
 * `AUTH_SECRET`. Il peut être vide sur un relais qui n'authentifie pas — mais
 * pas s'il y a un utilisateur, sinon la connexion échouerait à l'envoi plutôt
 * qu'ici, où le diagnostic est lisible.
 *
 * **Pourquoi pas Dolibarr.** Le porteur demandait de proposer l'envoi via
 * Dolibarr « si l'API le permet ». Elle ne le permet pas : le port du
 * connecteur (`src/services/dolibarr/api.ts`) n'expose aucune méthode
 * d'envoi, et l'API REST de Dolibarr n'offre pas de point d'entrée d'envoi
 * de courriel arbitraire — seuls des envois attachés à un document existant
 * le sont, ce qui ne couvre ni un rappel de saisie ni une alerte de journal.
 * Router nos rappels par Dolibarr supposerait donc de fabriquer un document
 * pour avoir le droit d'écrire un courriel : exactement le contournement que
 * le retrait de la demande de facture a écarté.
 */
export async function readSmtpConfig(): Promise<SmtpConfig | null> {
  const row = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: {
      smtpHost: true,
      smtpPort: true,
      smtpUser: true,
      smtpFrom: true,
      smtpSecure: true,
    },
  })
  if (row === null) return null

  const password = process.env.SMTP_PASSWORD ?? ''
  const incomplet =
    row.smtpHost === '' ||
    row.smtpPort <= 0 ||
    row.smtpFrom === '' ||
    (row.smtpUser !== '' && password === '')

  if (incomplet) return null

  return {
    host: row.smtpHost,
    port: row.smtpPort,
    user: row.smtpUser,
    from: row.smtpFrom,
    secure: row.smtpSecure,
    password,
  }
}

/**
 * Envoie une notification, ou explique pourquoi elle n'est pas partie.
 *
 * **Ne lève pas** quand rien n'est configuré : sans configuration SMTP,
 * l'ordonnanceur doit tourner et consigner, pas échouer. **Laisse en
 * revanche remonter** une erreur d'envoi : celle-là est actionnable, et doit
 * apparaître comme un travail en échec dans la supervision. Confondre les
 * deux ferait disparaître les vraies pannes.
 */
export async function notify(
  gabarit: Gabarit,
  deps: { mailer?: Mailer | null; destinataire?: string } = {},
): Promise<NotifyResult> {
  const reglages = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { notificationEmail: true },
  })
  const to = deps.destinataire ?? reglages?.notificationEmail ?? ''

  if (to === '') {
    return {
      envoye: false,
      motif: "Aucun destinataire de notification n'est configuré — rien n'a été envoyé.",
    }
  }

  let mailer = deps.mailer ?? null
  if (mailer === null) {
    const config = await readSmtpConfig()
    if (config === null) {
      return {
        envoye: false,
        motif: "SMTP n'est pas configuré — la notification a été consignée sans être envoyée.",
      }
    }
    // Import différé : `services/` ne doit pas tirer `nodemailer` dans tous
    // les rendus qui n'envoient jamais rien.
    const { buildSmtpMailer } = await import('@/integrations/smtp/mailer')
    mailer = buildSmtpMailer(config)
  }

  await mailer({ to, sujet: gabarit.sujet, corps: gabarit.corps })
  return { envoye: true, motif: '' }
}
