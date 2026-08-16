import { getInstanceCredential, readInstanceSecret } from '@/services/credentials'
import { DOLIBARR, type DolibarrApi } from './api'
import { createHttpDolibarrApi } from './http'

/**
 * Construit l'API depuis les identifiants stockés, ou `null` si Dolibarr n'est
 * pas connecté.
 *
 * `null` n'est pas une erreur : le connecteur est additif (spec §1). Toute
 * l'application doit fonctionner sans lui, et une instance éteinte ne doit
 * jamais empêcher une saisie.
 *
 * Pas de `userId`, comme les autres fonctions d'instance de `credentials.ts` :
 * une clé d'API Dolibarr appartient à l'instance, pas à une personne. Un
 * paramètre décoratif ressemblerait à un cloisonnement là où il n'y a rien à
 * cloisonner. C'est `ownerScope` qui empêche cette lecture de rendre — ou de
 * se faire prendre pour — un jeton personnel.
 */
export async function getDolibarrApi(): Promise<DolibarrApi | null> {
  const vue = await getInstanceCredential(DOLIBARR)
  // Une clé sans URL d'instance ne mène nulle part : `null` plutôt qu'un
  // client qui appellerait des chemins relatifs jusqu'à l'échec.
  if (vue === null || vue.baseUrl === '') return null

  // `null` couvre ici « clé de chiffrement perdue » autant que « jamais
  // configuré » ; le premier laisse une ligne de journal côté credentials,
  // sans quoi rien ne les séparerait.
  const secret = await readInstanceSecret(DOLIBARR)
  if (secret === null || secret === '') return null

  return createHttpDolibarrApi({ baseUrl: vue.baseUrl, apiKey: secret })
}
