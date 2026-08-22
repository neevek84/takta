'use server'

import { headers } from 'next/headers'
import { demanderReinitialisation, definirMotDePasse } from '@/services/auth/mot-de-passe'
import { journalErreur } from '@/services/log'
import { originePublique } from '@/core/http/origine'

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
 * Repli sur la machine locale quand aucun hôte n'est lisible : ici on
 * **fabrique un lien**, et un lien sans hôte n'en est pas un.
 */
async function origineDeLaRequete(): Promise<string> {
  const entetes = await headers()
  const origine = originePublique(process.env.AUTH_URL, (nom) => entetes.get(nom))
  return origine !== '' ? origine : 'http://localhost:3000'
}

