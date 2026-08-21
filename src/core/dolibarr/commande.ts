/**
 * Ce qu'une commande client devient quand elle donne naissance à un projet
 * Dolibarr — **la nomenclature, et rien d'autre**.
 *
 * Pur : aucune base, aucun réseau. C'est ici que se décide ce que le porteur,
 * son client et sa facture liront.
 *
 * **Le problème que ce module ferme.** Le projet Dolibarr n'a pas de champ
 * « référence client » : il porte `ref` (auto, `PJ…`), `title`, `ref_ext` et
 * une description. La commande, elle, porte `ref_client` — la référence du bon
 * de commande du client, celle qu'il exige de retrouver sur sa facture. Si
 * personne ne la recopie explicitement, elle s'arrête à la commande.
 *
 * Deux endroits, complémentaires et pas redondants : `ref_ext` la porte pour
 * les machines et survit à un renommage du projet ; le titre la porte pour les
 * humains, en tête, là où une liste de projets la laisse voir sans l'ouvrir.
 */

/** Ce que la colonne `title` d'un projet Dolibarr accepte. */
export const LONGUEUR_MAX_TITRE = 255

/** Sépare la référence du libellé. Le tiret cadratin, comme partout ailleurs. */
const SEPARATEUR = ' — '

/**
 * Replie tout blanc — espaces, tabulations, sauts de ligne — en un espace
 * simple. Dolibarr laisse passer des libellés multilignes, et un titre qui
 * saute une ligne casse toutes les listes qui l'affichent.
 */
function replier(valeur: string): string {
  return valeur.replace(/\s+/g, ' ').trim()
}

/**
 * Le titre du projet créé depuis une commande.
 *
 * Ordre imposé : la référence client d'abord, parce que c'est elle qu'on
 * cherche. À défaut, la référence de la commande — jamais un titre vide, et
 * jamais un titre qui commencerait par un libellé quelconque sans rien pour
 * l'identifier.
 */
export function titreProjetDepuisCommande(commande: {
  /** `ref_client` de la commande : la référence du BDC du client, souvent vide */
  refClient: string
  /** `ref` de la commande, du genre `CO2608-0042` */
  ref: string
  /** libellé ou objet de la commande — vide sur l'immense majorité d'entre elles */
  label: string
  /** nom du tiers Dolibarr ; la commande ne le porte pas, il est résolu par le service */
  thirdpartyName?: string
}): string {
  const ref = replier(commande.ref)
  if (ref === '') {
    throw new Error('Une commande sans référence ne peut pas nommer un projet.')
  }

  const refClient = replier(commande.refClient)
  const label = replier(commande.label)
  const tiers = replier(commande.thirdpartyName ?? '')

  // La référence client tient la tête, parce que c'est elle qu'on cherche. À
  // défaut, la référence de la commande — jamais un titre qui n'identifierait
  // rien.
  const tete = refClient === '' ? ref : refClient

  const parts = [tete]
  if (tiers !== '') parts.push(tiers)
  if (label !== '') parts.push(label)
  // La référence de la commande ferme le titre : sans elle, rien ne dit de
  // quel document le projet est né. Sauf quand elle tient déjà la tête — la
  // répéter n'ajouterait rien et mangerait la place des autres.
  if (ref !== tete) parts.push(ref)

  const titre = parts.join(SEPARATEUR)
  if (titre.length <= LONGUEUR_MAX_TITRE) return titre

  // Tronqué par la queue : c'est la tête qui identifie. `trimEnd` évite de
  // laisser un titre finir sur un espace ou sur un séparateur pendant.
  return titre.slice(0, LONGUEUR_MAX_TITRE).trimEnd()
}

/**
 * La référence externe posée sur le projet — la référence client, nue.
 *
 * Vide quand la commande n'en porte aucune : inventer une valeur ferait passer
 * pour un report ce qui n'en est pas un, et un rapprochement automatique s'y
 * appuierait plus tard.
 */
export function referenceExterneCommande(commande: { refClient: string }): string {
  return replier(commande.refClient)
}

/** Ce que la colonne `ref` d'un projet Dolibarr accepte. */
export const LONGUEUR_MAX_REF = 30

/**
 * La référence du projet créé.
 *
 * **Dolibarr l'exige.** Son interface la fabrique elle-même par le module de
 * numérotation ; son API, non — elle refuse la création par
 * « Bad Request: ref field missing », mesuré sur l'instance du porteur le
 * 20 août 2026.
 *
 * **Jamais préfixée `PJ`.** C'est le préfixe de la numérotation automatique de
 * Dolibarr : y poser nos propres références reviendrait à marcher sur sa
 * séquence, et à provoquer un jour un conflit sur un numéro qu'il croyait
 * libre.
 *
 * Depuis une commande, c'est **la référence de la commande** : unique par
 * construction, et elle dit d'où le projet vient. Elle rend aussi la création
 * idempotente côté Dolibarr — une seconde tentative se heurte à la référence
 * déjà prise plutôt que d'ouvrir un doublon.
 */
export function referenceProjetDepuisCommande(commande: { ref: string }): string {
  const ref = replier(commande.ref)
  if (ref === '') {
    throw new Error('Une commande sans référence ne peut pas nommer un projet.')
  }
  return ref.slice(0, LONGUEUR_MAX_REF)
}

/**
 * La référence d'un projet ouvert pour une mission, faute de document.
 *
 * Dérivée du libellé pour rester lisible dans Dolibarr. Deux missions de même
 * libellé produiraient la même référence : Dolibarr refusera la seconde en le
 * disant, ce qui vaut mieux qu'une référence illisible imposée à toutes.
 */
export function referenceProjetDepuisMission(mission: { label: string }): string {
  const slug = replier(mission.label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (slug === '') {
    throw new Error('Une mission sans libellé exploitable ne peut pas nommer un projet.')
  }
  return `MIS-${slug}`.slice(0, LONGUEUR_MAX_REF).replace(/-+$/, '')
}

/**
 * La date de démarrage que porte une commande, ou `null` si elle n'en porte
 * aucune.
 *
 * **Où Dolibarr la range.** Pas sur l'en-tête de la commande — `date_commande`
 * est la date du document, `date_livraison` celle de la livraison prévue — mais
 * sur chaque **ligne de service**, dans `date_start` de `llx_commandedet`
 * (« date debut si service »). Une ligne de produit n'en porte pas : elle vend
 * des objets, pas une période.
 *
 * La plus petite l'emporte : c'est le moment où le chantier commence
 * réellement, même si les prestations qui le composent démarrent en ordre
 * dispersé.
 *
 * `null` est le cas **courant**, pas l'exception : sur l'instance du porteur,
 * 9 lignes de commande sur 75 portent une date. La date est alors demandée à la
 * création de la mission.
 */
export function dateDeDemarrageDeLaCommande(
  lignes: ReadonlyArray<{ service: boolean; dateStart: string | null }>,
): string | null {
  const dates = lignes
    .filter((l) => l.service && l.dateStart !== null)
    .map((l) => l.dateStart as string)
    .sort()
  return dates[0] ?? null
}
