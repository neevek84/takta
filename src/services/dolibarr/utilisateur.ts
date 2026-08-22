/**
 * Où vit `dolibarrUserId` — et pourquoi il ne vivait pas au bon endroit.
 *
 * **Le cas réel du 19 août 2026.** La première connexion à Dolibarr a été faite
 * avec la clé de l'utilisateur technique `n8n.cds`, n° 4. Le réglage étant de
 * portée instance, *tous* les temps poussés auraient été enregistrés chez
 * Dolibarr au nom de `n8n.cds` — sur des CRA appartenant au porteur, et c'est
 * sur ces temps que la facturation se fait. Rien à l'écran ne l'aurait dit.
 *
 * Ce n'est pas une erreur de saisie : c'est un défaut de portée. La clé d'API,
 * elle, reste bien d'instance — une clé par consultant multiplierait les secrets
 * à faire tourner, et Dolibarr attribue déjà le temps par `fk_user`. C'est
 * **cet axe-là** qui est personnel, pas la clé.
 *
 * **Pourquoi un `ExternalLink` et pas une colonne de `User`.** Le type de
 * correspondance existe déjà : `LIEN_UTILISATEUR`, posé par la reprise des temps
 * pour attribuer un temps importé à son auteur. Une colonne en aurait fait un
 * second lieu de vérité, et la reprise aurait continué d'écrire dans le premier.
 */
import { prisma } from '@/db/client'
import { getInstanceCredential, OWNER_SCOPE_INSTANCE } from '@/services/credentials'
import { journalAvertissement } from '@/services/log'
import { DOLIBARR } from './api'
import { LIEN_UTILISATEUR } from './liens'

/** La clé, dans les métadonnées de l'ancienne portée d'instance. */
const CLE_METADONNEE = 'dolibarrUserId'

/** L'identifiant Dolibarr d'un compte local, `null` s'il n'en a pas. */
export async function identifiantDolibarrDe(userId: string): Promise<number | null> {
  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_UTILISATEUR,
        entityId: userId,
        provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  if (lien === null) return null

  const id = Number(lien.externalId)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Déclare l'identifiant Dolibarr d'un compte.
 *
 * **Un identifiant appartient à un seul compte local.** La contrainte d'unicité
 * de `ExternalLink` porte sur `(entityType, entityId, provider)` : elle empêche
 * qu'un compte en ait deux, pas que deux comptes aient le même. Or deux comptes
 * sous le même `fk_user`, c'est exactement le défaut du 19 août rejoué à deux —
 * et il ne se verrait pas davantage. Le refus est donc ici, et il nomme le
 * compte qui tient déjà l'identifiant.
 */
export async function definirIdentifiantDolibarr(
  userId: string,
  identifiant: number,
): Promise<{ ok: boolean; motif: string }> {
  if (!Number.isInteger(identifiant) || identifiant <= 0) {
    return {
      ok: false,
      motif:
        'L’identifiant de l’utilisateur Dolibarr est un nombre entier positif — celui de votre ' +
        'fiche utilisateur, pas votre identifiant de connexion.',
    }
  }

  const pris = await prisma.externalLink.findFirst({
    where: {
      entityType: LIEN_UTILISATEUR,
      provider: DOLIBARR,
      externalId: String(identifiant),
      entityId: { not: userId },
    },
    select: { entityId: true },
  })
  if (pris !== null) {
    const autre = await prisma.user.findUnique({
      where: { id: pris.entityId },
      select: { name: true, email: true },
    })
    const nom = autre === null ? 'un autre compte' : `${autre.name} (${autre.email})`
    return {
      ok: false,
      motif:
        `L’utilisateur Dolibarr n° ${identifiant} est déjà celui de ${nom}. ` +
        'Deux comptes sous le même utilisateur Dolibarr feraient facturer les temps de l’un au nom de l’autre.',
    }
  }

  await prisma.externalLink.upsert({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_UTILISATEUR,
        entityId: userId,
        provider: DOLIBARR,
      },
    },
    create: {
      // Posée par la personne elle-même : elle est à la fois l'auteur du lien et
      // son objet. La reprise des temps, elle, pose `userId = createur`.
      userId,
      entityType: LIEN_UTILISATEUR,
      entityId: userId,
      provider: DOLIBARR,
      externalId: String(identifiant),
      syncedAt: new Date(),
      syncState: 'SYNCED',
    },
    update: { externalId: String(identifiant), syncState: 'SYNCED' },
  })

  return { ok: true, motif: '' }
}

/**
 * Rompt la correspondance d'un compte. Rien n'est supprimé chez Dolibarr : les
 * temps déjà poussés y restent, c'est l'historique du client — même promesse que
 * `detachEntity`.
 */
export async function oublierIdentifiantDolibarr(userId: string): Promise<void> {
  await prisma.externalLink.deleteMany({
    where: { entityType: LIEN_UTILISATEUR, entityId: userId, provider: DOLIBARR },
  })
}

/**
 * L'ancien réglage d'instance, s'il traîne encore dans les métadonnées de la
 * clé. Il ne sert plus à pousser quoi que ce soit : il ne sert qu'à **proposer**
 * une valeur à l'écran « Mon profil », que la personne confirme ou corrige.
 */
export async function suggestionDInstance(): Promise<number | null> {
  const credential = await getInstanceCredential(DOLIBARR)
  const id = Number(credential?.metadata[CLE_METADONNEE] ?? '')
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * La reprise : convertit l'ancien réglage d'instance en correspondance
 * personnelle, **une seule fois**, et rend l'identifiant du compte servi.
 *
 * « La migration doit le convertir en correspondance pour le compte qui l'a
 * saisi, et non l'effacer. » Personne n'a enregistré *qui* l'a saisi — les
 * métadonnées ne portent que la valeur. La règle la plus proche du vrai est
 * donc : **le plus ancien compte existant avant l'enregistrement de la clé**.
 * Seul un administrateur atteint l'écran qui la saisit, et un compte né après
 * — par la porte Google, par la reprise des temps — n'a pas pu le faire.
 *
 * Elle n'écrase jamais une correspondance déjà posée à la main, et elle efface
 * la métadonnée en réussissant : la source de la confusion disparaît avec elle.
 *
 * **Où elle est appelée** : au moment exact où l'absence allait faire refuser un
 * push (`src/services/dolibarr/push.ts`). Pas au démarrage — l'application n'en
 * a pas —, pas au rendu d'une page — un rendu n'écrit pas. Elle est idempotente
 * et ne peut servir qu'un seul compte, celui que la règle désigne : appelée par
 * n'importe qui, elle ne donne rien à n'importe qui.
 */
export async function reprendreIdentifiantDolibarrDInstance(): Promise<string | null> {
  const credential = await getInstanceCredential(DOLIBARR)
  if (credential === null) return null

  const brut = Number(credential.metadata[CLE_METADONNEE] ?? '')
  if (!Number.isInteger(brut) || brut <= 0) return null

  const candidat = await prisma.user.findFirst({
    where: { createdAt: { lte: credential.connectedAt } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  if (candidat === null) {
    journalAvertissement('dolibarr.reprise-utilisateur', {
      raison: 'aucun-compte-anterieur-a-la-cle',
      identifiant: String(brut),
    })
    return null
  }

  if ((await identifiantDolibarrDe(candidat.id)) !== null) return null

  const pose = await definirIdentifiantDolibarr(candidat.id, brut)
  if (!pose.ok) {
    journalAvertissement('dolibarr.reprise-utilisateur', {
      raison: 'identifiant-deja-pris',
      identifiant: String(brut),
    })
    return null
  }

  // La métadonnée part : la laisser laisserait deux vérités en base, et la
  // suggestion de l'écran continuerait de proposer une valeur déjà attribuée.
  //
  // Seule la colonne des métadonnées est touchée, et **jamais le scellé**.
  // Passer par `saveInstanceCredential` obligerait à relire la clé d'API pour la
  // resceller à l'identique : une clé de chiffrement perdue ferait alors
  // renoncer à l'effacement — la confusion survivrait précisément le jour où
  // personne ne peut plus la corriger — et un rescellé inutile est une occasion
  // de couper Dolibarr pour rien.
  const restantes = { ...credential.metadata }
  delete restantes[CLE_METADONNEE]
  await prisma.providerCredential.updateMany({
    where: { ownerScope: OWNER_SCOPE_INSTANCE, provider: DOLIBARR },
    data: { metadataJson: JSON.stringify(restantes) },
  })

  return candidat.id
}
