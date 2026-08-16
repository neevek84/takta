import nodemailer from 'nodemailer'
import type { Mailer, SmtpConfig } from '@/services/notify'

/**
 * Transport SMTP minimal. Isolé dans `integrations/` parce que c'est le seul
 * endroit qui connaisse `nodemailer` : `services/notify.ts` ne manipule que
 * le type `Mailer`, ce qui rend chaque test capable d'injecter un double
 * sans que la moindre connexion ne soit ouverte.
 *
 * Le mot de passe vient de `SmtpConfig`, donc de l'environnement, et ne
 * ressort jamais d'ici : ni dans un journal, ni dans un message d'erreur.
 */
export function buildSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user !== '' && { auth: { user: config.user, pass: config.password } }),
  })

  return async ({ to, sujet, corps }) => {
    await transport.sendMail({ from: config.from, to, subject: sujet, text: corps })
  }
}
