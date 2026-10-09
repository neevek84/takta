'use server'

import { annoncer } from '@/services/annonce'
import { revalidatePath } from 'next/cache'
import { exigerAdministration } from '@/auth'
import {
  enregistrerConnexionDocumenso,
  genererSecretWebhook,
  retirerConnexionDocumenso,
  testerConfigurationSignature,
  vueReglagesSignature,
} from '@/services/signature/reglages'
import type { ResultatVerification } from '@/services/signature/verification'

const CHEMIN = '/admin/signature'

export type ConnexionSignatureState =
  | { ok: true; message: string }
  | { ok: false; erreurs: string[] }
  | null

export type SecretWebhookState = { ok: true; secret: string } | { ok: false; erreur: string } | null

export type TestSignatureState = ResultatVerification | null

/**
 * Le message d'une erreur, **expurgé de la clé qu'on vient de saisir** — même
 * précaution que pour Dolibarr : une bibliothèque recopie volontiers la valeur
 * fautive dans son message, et ce message part droit à l'écran.
 */
function messageSansSecret(err: unknown, secret: string): string {
  const brut = err instanceof Error ? err.message : String(err)
  return secret === '' ? brut : brut.split(secret).join('[clé masquée]')
}

/**
 * Enregistre l'instance Documenso et sa clé d'API. La clé vit chiffrée en
 * base, en portée instance, et ne se réaffiche jamais ; laissée vide, elle
 * conserve celle qui est enregistrée.
 */
export async function enregistrerSignature(
  _prev: ConnexionSignatureState,
  formData: FormData,
): Promise<ConnexionSignatureState> {
  // Avant toute lecture du formulaire : un refus détaillé rendu à un visiteur
  // non autorisé lui apprendrait déjà quelque chose.
  const user = await exigerAdministration()

  const baseUrl = String(formData.get('baseUrl') ?? '').trim()
  const apiKey = String(formData.get('apiKey') ?? '').trim()

  try {
    const r = await enregistrerConnexionDocumenso({ userId: user.id, baseUrl, apiKey })
    if (!r.ok) return r
  } catch (err) {
    // Typiquement `CREDENTIALS_KEY` absente : le nom de la variable est utile
    // et n'est pas un secret ; la clé saisie n'apparaît nulle part.
    return { ok: false, erreurs: [messageSansSecret(err, apiKey)] }
  }

  revalidatePath(CHEMIN)
  return {
    ok: true,
    message:
      "Réglage enregistré. La clé d'API est chiffrée au repos et ne sera jamais réaffichée. " +
      'Utilisez « Tester » pour vérifier l’instance.',
  }
}

/**
 * Retire l'instance réglée à l'écran. Si l'environnement en déclare une, elle
 * reprend la main — l'écran le dira au rendu suivant.
 */
export async function deconnecterSignature(): Promise<void> {
  const user = await exigerAdministration()
  await retirerConnexionDocumenso({ userId: user.id })
  await annoncer('L’outil de signature est déconnecté.')
  revalidatePath(CHEMIN)
}

/**
 * Génère le secret du webhook et le rend **une seule fois**.
 *
 * Un secret déjà en vigueur — à l'écran ou dans l'environnement — ne se
 * remplace que confirmé : l'ancien cesse aussitôt de fonctionner, et chaque
 * livraison de Documenso sera refusée tant que le nouveau n'y est pas collé.
 * La confirmation est vérifiée **ici**, pas seulement par la boîte de
 * dialogue : une action serveur s'appelle sans passer par l'écran.
 */
export async function genererSecret(
  _prev: SecretWebhookState,
  formData: FormData,
): Promise<SecretWebhookState> {
  const user = await exigerAdministration()

  const { webhook } = await vueReglagesSignature()
  if (webhook.provenance !== 'aucune' && formData.get('confirmer') !== 'oui') {
    return {
      ok: false,
      erreur: 'Un secret est déjà en vigueur : confirmez son remplacement pour en générer un autre.',
    }
  }

  let secret: string
  try {
    secret = await genererSecretWebhook({ userId: user.id })
  } catch (err) {
    return { ok: false, erreur: err instanceof Error ? err.message : String(err) }
  }
  revalidatePath(CHEMIN)
  return { ok: true, secret }
}

/** Le bouton « Tester » : ne crée rien chez Documenso. */
export async function testerSignature(_prev: TestSignatureState): Promise<TestSignatureState> {
  await exigerAdministration()
  return testerConfigurationSignature()
}
