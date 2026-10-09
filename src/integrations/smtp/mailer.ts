import nodemailer from 'nodemailer'
import { DELAIS_SMTP, nomAnnonce } from '@/core/courriel/smtp'
import type { Mailer, SmtpConfig } from '@/services/notify'

/**
 * Transport SMTP minimal. Isolé dans `integrations/` parce que c'est le seul
 * endroit qui connaisse `nodemailer` : `services/notify.ts` ne manipule que
 * le type `Mailer`, ce qui rend chaque test capable d'injecter un double
 * sans que la moindre connexion ne soit ouverte.
 *
 * Le mot de passe vient de `SmtpConfig` — l'écran Administration · Courriel,
 * sinon `SMTP_PASSWORD` — et ne ressort jamais d'ici : ni dans un journal, ni
 * dans un message d'erreur.
 *
 * Chaque envoi est borné (`DELAIS_SMTP`) : un serveur muet fait échouer
 * l'envoi en `ETIMEDOUT` au lieu de suspendre un travail ou une action.
 */
export function buildSmtpMailer(config: SmtpConfig): Mailer {
  // Le nom annoncé au serveur : sans lui, nodemailer dit `[127.0.0.1]` et le
  // relais Google Workspace refuse la connexion (`421 … (EHLO)`).
  const nom = nomAnnonce(process.env.AUTH_URL, config.from)
  const transport = nodemailer.createTransport({
    ...(nom !== undefined && { name: nom }),
    host: config.host,
    port: config.port,
    secure: config.secure,
    // STARTTLS exigé, pas opportuniste : sinon un intermédiaire qui retire
    // l'annonce STARTTLS du serveur ferait partir l'authentification en clair.
    ...(!config.secure && { requireTLS: true }),
    ...DELAIS_SMTP,
    ...(config.user !== '' && { auth: { user: config.user, pass: config.password } }),
  })

  return async ({ to, sujet, corps, pieces }) => {
    await transport.sendMail({
      from: config.from,
      to,
      subject: sujet,
      text: corps,
      ...(pieces !== undefined && {
        attachments: pieces.map((p) => ({
          filename: p.nom,
          contentType: p.type,
          content: Buffer.from(p.octets),
        })),
      }),
    })
  }
}
