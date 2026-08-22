'use server'

import { headers } from 'next/headers'
import { demanderReinitialisation, definirMotDePasse } from '@/services/auth/mot-de-passe'
import { journalErreur } from '@/services/log'

export type MotDePasseState = { ok: boolean; message: string } | null

/** Douze caractères : la règle du produit, la même qu'au premier démarrage. */
const LONGUEUR_MINIMALE = 12

/**
 * La réponse est **la même** que l'adresse soit connue ou non. Le motif réel
 * d'un non-envoi — compte inconnu, SMTP absent — n'apparaît jamais ici.
 */
export async function demanderLien(
  _precedent: MotDePasseState,
  formData: FormData,
): Promise<MotDePasseState> {
  const email = String(formData.get('email') ?? '')

  try {
    await demanderReinitialisation({ email, origine: await origineDeLaRequete() })
  } catch (err) {
    // `notify` laisse remonter une panne d'envoi. Sans ce filet, l'adresse
    // connue rendrait une page d'erreur et l'inconnue un succès : le
    // formulaire deviendrait l'annuaire qu'il refuse d'être. Muet pour le
    // visiteur, pas pour l'exploitant — la trace part au journal.
    journalErreur('mot-de-passe.lien', err)
  }

  return {
    ok: true,
    message:
      'Si un compte porte cette adresse, un lien vient de partir. Il est valable dix minutes.',
  }
}

export async function poserMotDePasse(
  _precedent: MotDePasseState,
  formData: FormData,
): Promise<MotDePasseState> {
  const jeton = String(formData.get('jeton') ?? '')
  const motDePasse = String(formData.get('motDePasse') ?? '')

  if (motDePasse.length < LONGUEUR_MINIMALE) {
    return { ok: false, message: 'Choisissez un mot de passe d’au moins 12 caractères.' }
  }

  const r = await definirMotDePasse({ jeton, motDePasse })
  return r.ok
    ? { ok: true, message: 'Mot de passe enregistré. Vous pouvez vous connecter.' }
    : { ok: false, message: r.motif }
}

/**
 * L'origine vient de la requête : l'application ne connaît pas sa propre URL
 * publique, et la coder en dur produirait des liens morts derrière un proxy.
 *
 * Même lecture que `adresseDeLaRequete` de l'écran Google — un jeton voyage
 * dans cette URL, donc hors machine locale le protocole non déclaré est
 * supposé `https` : le supposer en clair enverrait la clé en clair.
 */
async function origineDeLaRequete(): Promise<string> {
  const entetes = await headers()
  const brut = entetes.get('x-forwarded-host') ?? entetes.get('host') ?? ''
  const hote = brut.split(',')[0]?.trim() ?? ''
  if (hote === '') return 'http://localhost:3000'

  const declare = (entetes.get('x-forwarded-proto') ?? '').split(',')[0]?.trim() ?? ''
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(hote)
  const schema = declare !== '' ? declare : local ? 'http' : 'https'
  return `${schema}://${hote}`
}
