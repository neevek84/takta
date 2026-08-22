'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, exigerAdministration } from '@/auth'
import { validerClientOAuth } from '@/core/google/oauth-client'
import { forgetGoogleOAuthClient, saveGoogleOAuthClient } from '@/services/google/oauth-client'

const CHEMIN = '/admin/google'

export type ClientGoogleState =
  | { ok: true; message: string }
  | { ok: false; erreurs: string[] }
  | null

/**
 * Le message d'une erreur, **expurgé du secret qu'on vient de saisir**.
 *
 * Même précaution que pour la clé d'API Dolibarr, et pour la même raison : une
 * bibliothèque tierce recopie volontiers la valeur fautive dans son message, et
 * ce message part droit à l'écran ou au journal. Un secret affiché une fois est
 * un secret à changer.
 */
function messageSansSecret(err: unknown, secret: string): string {
  const brut = err instanceof Error ? err.message : String(err)
  return secret === '' ? brut : brut.split(secret).join('[secret masqué]')
}

/**
 * Enregistre le client OAuth Google de l'instance.
 *
 * Les trois valeurs se saisissent ici, et vivent chiffrées en base en portée
 * instance — exactement comme la clé d'API Dolibarr. Aucune ne retourne jamais
 * dans un fichier d'environnement.
 *
 * L'URL de retour est **enregistrée**, jamais déduite de la requête au moment
 * de partir chez Google : c'est ce qui rend impossible qu'un lien forgé fasse
 * livrer un code de consentement ailleurs.
 */
export async function enregistrerClientGoogle(
  _prev: ClientGoogleState,
  formData: FormData,
): Promise<ClientGoogleState> {
  // Avant toute lecture du formulaire : un refus détaillé rendu à un visiteur
  // non authentifié lui apprendrait déjà quelque chose.
  await exigerAdministration()

  const validation = validerClientOAuth({
    clientId: String(formData.get('clientId') ?? ''),
    clientSecret: String(formData.get('clientSecret') ?? ''),
    redirectUri: String(formData.get('redirectUri') ?? ''),
  })
  if (!validation.ok) return { ok: false, erreurs: validation.erreurs }

  try {
    await saveGoogleOAuthClient(validation.client)
  } catch (err) {
    // Typiquement `CREDENTIALS_KEY` absente. Le nom de la variable est une
    // information utile et n'est pas un secret ; sa valeur n'apparaît nulle
    // part, et celle qu'on vient de saisir non plus.
    return { ok: false, erreurs: [messageSansSecret(err, validation.client.clientSecret)] }
  }

  revalidatePath(CHEMIN)
  return {
    ok: true,
    message:
      'Client OAuth Google enregistré. Le secret est chiffré au repos et ne sera jamais réaffiché.',
  }
}

/**
 * Efface le client OAuth de l'instance.
 *
 * Les comptes déjà connectés gardent leurs jetons : ils appartiennent à des
 * personnes, pas au client, et les effacer ici déconnecterait tout le monde
 * pour une correction de saisie. Ils cesseront simplement d'être renouvelables
 * tant qu'aucun client n'est enregistré — et l'écran de synchronisation le dira.
 */
export async function oublierClientGoogle(): Promise<void> {
  await exigerAdministration()
  await forgetGoogleOAuthClient()
  revalidatePath(CHEMIN)
}
