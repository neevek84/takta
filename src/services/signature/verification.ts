import type { SignatureFetchLike } from '@/core/signature/connector'

/**
 * Une ligne du bouton « Tester », dite en toutes lettres.
 *
 * Trois états et non deux : une clé qu'on n'a pas pu soumettre — instance
 * muette, route absente — n'est ni bonne ni mauvaise. La peindre en rouge
 * enverrait changer une clé qui marche ; en vert, rassurer sur une clé que
 * personne n'a vue.
 */
export interface Verification {
  cle: 'configuration' | 'instance' | 'api-v2' | 'cle' | 'smtp'
  etat: 'ok' | 'echec' | 'non-verifie'
  texte: string
}

export interface ResultatVerification {
  /** vrai seulement si **toutes** les lignes sont vertes */
  ok: boolean
  verifications: Verification[]
}

/**
 * La route de lecture que la vérification interroge.
 *
 * **La recherche de documents, et non celle d'enveloppes.** `GET
 * /api/v2/envelope` n'existe pas dans Documenso 2.0.0 (elle est arrivée
 * après) : l'interroger ferait déclarer « Documenso 2.0 requis » à une
 * instance 2.0.0 parfaitement servie par le connecteur. `GET /api/v2/document`
 * existe depuis la 2.0.0 et demeure, dépréciée — le même statut que la route
 * `document/{id}` que le connecteur lit déjà pour les envois hérités. Elle est
 * en lecture seule, exige la clé, et `perPage=1` borne ce qu'elle rend.
 */
export const ROUTE_VERIFICATION = '/api/v2/document?page=1&perPage=1'

const NON_VERIFIEE_CLE: Verification = {
  cle: 'cle',
  etat: 'non-verifie',
  texte: "La clé d'API n'a pas pu être soumise : elle n'est ni acceptée ni refusée.",
}

/**
 * Vérifie une instance Documenso **sans rien y créer** : une seule lecture
 * authentifiée, plus l'état de SMTP, prérequis du circuit.
 *
 * **Aucun message ne reprend le corps de la réponse**, ni celui d'une
 * exception réseau : un proxy bavard y recopie volontiers l'en-tête
 * `Authorization`, et ces lignes partent droit à l'écran. Seul le code HTTP
 * est cité.
 */
export async function verifierDocumenso(args: {
  baseUrl: string
  apiKey: string
  fetchFn: SignatureFetchLike
  smtpConfigure: boolean
}): Promise<ResultatVerification> {
  const racine = args.baseUrl.replace(/\/+$/, '')
  const verifications = [
    ...(await verifierInstance(`${racine}${ROUTE_VERIFICATION}`, args.apiKey, args.fetchFn)),
    verifierSmtp(args.smtpConfigure),
  ]
  return { ok: verifications.every((v) => v.etat === 'ok'), verifications }
}

async function verifierInstance(
  url: string,
  apiKey: string,
  fetchFn: SignatureFetchLike,
): Promise<Verification[]> {
  let reponse: Response
  try {
    reponse = await fetchFn(url, { method: 'GET', headers: { Authorization: apiKey } })
  } catch {
    return [
      {
        cle: 'instance',
        etat: 'echec',
        texte: "L'instance ne répond pas : adresse injoignable, ou refusée par le réseau.",
      },
      {
        cle: 'api-v2',
        etat: 'non-verifie',
        texte: "La disponibilité de l'API v2 n'a pas pu être vérifiée.",
      },
      NON_VERIFIEE_CLE,
    ]
  }

  // Le corps n'est jamais lu au-delà de son type : il n'a rien à nous dire
  // qui vaille le risque d'en afficher un morceau.
  await reponse.body?.cancel().catch(() => {})

  const instanceRepond: Verification = { cle: 'instance', etat: 'ok', texte: "L'instance répond." }

  if (reponse.status === 404) {
    return [
      instanceRepond,
      {
        cle: 'api-v2',
        etat: 'echec',
        texte: "L'API v2 est introuvable sur cette instance : Documenso 2.0 ou plus est requis.",
      },
      NON_VERIFIEE_CLE,
    ]
  }

  if (reponse.status === 401 || reponse.status === 403) {
    return [
      instanceRepond,
      { cle: 'api-v2', etat: 'ok', texte: "L'API v2 est disponible." },
      {
        cle: 'cle',
        etat: 'echec',
        texte: `La clé d'API est refusée par Documenso (${reponse.status}).`,
      },
    ]
  }

  if (!reponse.ok) {
    return [
      {
        cle: 'instance',
        etat: 'echec',
        texte: `L'instance répond, mais en erreur (${reponse.status}) : réessayez plus tard.`,
      },
      {
        cle: 'api-v2',
        etat: 'non-verifie',
        texte: "La disponibilité de l'API v2 n'a pas pu être vérifiée.",
      },
      NON_VERIFIEE_CLE,
    ]
  }

  // Un 200 en HTML est une page d'accueil, de connexion ou de proxy : rien qui
  // ressemble à l'API de Documenso. Le prendre pour un succès validerait une
  // adresse fausse.
  const type = reponse.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) {
    return [
      instanceRepond,
      {
        cle: 'api-v2',
        etat: 'echec',
        texte: "L'adresse répond, mais pas comme l'API v2 de Documenso : vérifiez l'URL de l'instance.",
      },
      NON_VERIFIEE_CLE,
    ]
  }

  return [
    instanceRepond,
    { cle: 'api-v2', etat: 'ok', texte: "L'API v2 est disponible." },
    { cle: 'cle', etat: 'ok', texte: "La clé d'API est acceptée." },
  ]
}

function verifierSmtp(configure: boolean): Verification {
  return configure
    ? { cle: 'smtp', etat: 'ok', texte: 'SMTP est configuré : le code du client pourra partir.' }
    : {
        cle: 'smtp',
        etat: 'echec',
        texte:
          "SMTP n'est pas configuré : l'envoi pour signature sera refusé, le client ne recevrait pas son code.",
      }
}
