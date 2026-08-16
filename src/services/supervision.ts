import { prisma } from '@/db/client'
import { verifyJournalChain } from './audit'
import { instanceOwnerId, listJobs } from './jobs/scheduler'

/**
 * Les alertes que le lot 4 sait produire.
 *
 * La spec en énumère trois autres — file de sortie abandonnée, conflits
 * d'agenda non arbitrés, CRA en souffrance de signature — qui appartiennent
 * aux lots 1b, 2 et 3. Le lot qui les livre étend cette union ; le
 * compilateur lui désignera alors l'écran à compléter.
 */
export type CodeAlerte =
  | 'JOURNAL_ROMPU'
  | 'TRAVAIL_ECHEC'
  | 'ABONNEMENT_SUSPENDU'
  | 'LIVRAISON_ABANDONNEE'

export interface Alerte {
  code: CodeAlerte
  libelle: string
  detail: string
}

/**
 * Pour qui les traitements de fond travaillent.
 *
 * `tick` n'a pas de session : il exécute les travaux pour le compte le plus
 * ancien de l'instance. Le produit est mono-organisation, la décision se
 * défend — mais elle **échoue en silence** dès qu'un second compte existe :
 * ce consultant-là ne recevrait aucun rappel de saisie ni de clôture, et rien
 * ne l'en avertirait. L'écran le dit ; c'est tout ce qu'un écran peut faire.
 */
export interface Ordonnanceur {
  proprietaireId: string
  /** nom du compte, ou son identifiant à défaut ; '' si l'instance est vide */
  proprietaireLabel: string
  /** vrai quand l'utilisateur de la session n'est pas celui qui est servi */
  autreCompte: boolean
  comptes: number
}

export async function readOrdonnanceur(userId: string): Promise<Ordonnanceur> {
  // `instanceOwnerId` et non une seconde requête équivalente : c'est la
  // fonction que l'ordonnanceur appelle lui-même, et deux requêtes jumelles
  // finiraient par désigner deux comptes différents.
  const proprietaireId = await instanceOwnerId()
  const [proprietaire, comptes] = await Promise.all([
    proprietaireId === ''
      ? Promise.resolve(null)
      : prisma.user.findUnique({ where: { id: proprietaireId }, select: { name: true } }),
    prisma.user.count(),
  ])

  return {
    proprietaireId,
    proprietaireLabel: proprietaireId === '' ? '' : (proprietaire?.name ?? proprietaireId),
    autreCompte: proprietaireId !== '' && proprietaireId !== userId,
    comptes,
  }
}

/**
 * Tout ce qui demande une action, dans l'ordre de gravité.
 *
 * Rend un tableau **vide** quand rien ne cloche : c'est l'écran qui le dit,
 * explicitement. Un écran d'alertes qui n'annonce jamais « tout va bien »
 * laisse planer le doute d'un chargement raté.
 */
export async function listAlertes(userId: string): Promise<Alerte[]> {
  const alertes: Alerte[] = []

  // 1. La chaîne du journal : rien n'est plus grave qu'une preuve rompue.
  const chaine = await verifyJournalChain()
  if (!chaine.ok) {
    alertes.push({
      code: 'JOURNAL_ROMPU',
      libelle: 'Rupture de la chaîne du journal',
      detail:
        `Entrée ${chaine.seq} — ${chaine.raison}. ` +
        `${chaine.verifiees} entrée(s) vérifiée(s) avant elle.`,
    })
  }

  // 2. Les travaux en échec. `INDISPONIBLE` n'en est pas un : un lot non
  //    livré n'appelle aucune action de l'utilisateur.
  for (const travail of await listJobs()) {
    if (travail.lastState !== 'ECHEC') continue
    alertes.push({
      code: 'TRAVAIL_ECHEC',
      libelle: `Travail en échec : ${travail.label}`,
      detail: travail.lastError === '' ? 'Aucun message d’erreur enregistré.' : travail.lastError,
    })
  }

  // 3. Les abonnements suspendus.
  const suspendus = await prisma.webhook.findMany({
    where: { userId, state: 'SUSPENDU' },
    orderBy: { label: 'asc' },
  })
  for (const abonnement of suspendus) {
    alertes.push({
      code: 'ABONNEMENT_SUSPENDU',
      libelle: `Abonnement suspendu : ${abonnement.label}`,
      detail:
        `${abonnement.consecutiveFailures} échec(s) consécutif(s). ` +
        `${abonnement.lastError === '' ? '' : `Dernière erreur : ${abonnement.lastError}. `}` +
        // Le numéro **avant** de réactiver : la réactivation repart de
        // l'instant présent, et ce curseur-là ne se retrouve plus après.
        `Les événements de la période suspendue restent lisibles par ` +
        `GET /api/events?since=${abonnement.lastSeq}.`,
    })
  }

  // 4. Les livraisons abandonnées, groupées : une ligne par abonnement plutôt
  //    que cent lignes identiques.
  const abandons = await prisma.webhookDelivery.groupBy({
    by: ['webhookId'],
    where: { state: 'ABANDONNE', webhook: { userId } },
    _count: { _all: true },
  })
  if (abandons.length > 0) {
    const libelles = new Map(
      (await prisma.webhook.findMany({ where: { userId }, select: { id: true, label: true } })).map(
        (w) => [w.id, w.label],
      ),
    )
    for (const groupe of abandons) {
      alertes.push({
        code: 'LIVRAISON_ABANDONNEE',
        libelle: `Livraisons abandonnées : ${libelles.get(groupe.webhookId) ?? groupe.webhookId}`,
        detail:
          `${groupe._count._all} livraison(s) abandonnée(s) après cinq tentatives. ` +
          `Chacune peut être renvoyée à la main.`,
      })
    }
  }

  return alertes
}
