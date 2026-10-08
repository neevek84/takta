'use server'

import { revalidatePath } from 'next/cache'
import { exigerAdministration } from '@/auth'
import { messageErreurSmtp } from '@/core/courriel/smtp'
import { enregistrerReglagesCourriel, envoyerCourrielTest } from '@/services/courriel/reglages'

const CHEMIN = '/admin/courriel'

export type ReglagesCourrielState =
  | { ok: true; message: string }
  | { ok: false; erreurs: string[] }
  | null

export type TestCourrielState = { ok: boolean; message: string } | null

/**
 * Le message d'une erreur, **expurgé du mot de passe qu'on vient de saisir** :
 * une bibliothèque recopie volontiers la valeur fautive dans son message, et
 * ce message part droit à l'écran.
 */
function messageSansSecret(err: unknown, secret: string): string {
  const brut = err instanceof Error ? err.message : String(err)
  return secret === '' ? brut : brut.split(secret).join('[mot de passe masqué]')
}

/**
 * Enregistre le serveur d'envoi. Le mot de passe vit chiffré en base et ne se
 * réaffiche jamais ; laissé vide, il conserve celui qui est en vigueur.
 */
export async function enregistrerCourriel(
  _prev: ReglagesCourrielState,
  formData: FormData,
): Promise<ReglagesCourrielState> {
  // Avant toute lecture du formulaire : un refus détaillé rendu à un visiteur
  // non autorisé lui apprendrait déjà quelque chose.
  const user = await exigerAdministration()

  const champ = (nom: string) => String(formData.get(nom) ?? '')
  // Le mot de passe n'est pas « nettoyé » : un espace peut en faire partie.
  const motDePasse = champ('motDePasse')

  try {
    const r = await enregistrerReglagesCourriel({
      userId: user.id,
      host: champ('host'),
      port: champ('port'),
      chiffrement: champ('chiffrement'),
      user: champ('user'),
      from: champ('from'),
      motDePasse,
    })
    if (!r.ok) return r
  } catch (err) {
    // `CREDENTIALS_KEY` absente : le nom de la variable est utile et n'est pas
    // un secret. Tout le reste (base, bibliothèque) reste générique : un
    // message brut peut citer une adresse interne ou la valeur saisie.
    const brut = messageSansSecret(err, motDePasse)
    if (brut.includes('CREDENTIALS_KEY')) return { ok: false, erreurs: [brut] }
    return {
      ok: false,
      erreurs: ['Enregistrement impossible : une erreur inattendue est survenue. Réessayez, puis consultez le journal du serveur.'],
    }
  }

  revalidatePath(CHEMIN)
  return {
    ok: true,
    message:
      'Réglage enregistré. Le mot de passe est chiffré au repos et ne sera jamais réaffiché. ' +
      'Envoyez un courriel de test pour vérifier le serveur.',
  }
}

/** « Envoyer un courriel de test » : un vrai envoi, par le transport en vigueur. */
export async function testerCourriel(
  _prev: TestCourrielState,
  formData: FormData,
): Promise<TestCourrielState> {
  await exigerAdministration()
  const destinataire = String(formData.get('destinataire') ?? '')
  try {
    return await envoyerCourrielTest({ destinataire })
  } catch (err) {
    // Le service traduit déjà les erreurs d'envoi ; ce filet couvre le reste
    // (base, clé de chiffrement) sans jamais recopier un message brut.
    return { ok: false, message: messageErreurSmtp(err) }
  }
}
