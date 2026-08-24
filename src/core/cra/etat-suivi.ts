import type { CraStatus } from '../types'

/**
 * Ce que l'écran de suivi affiche, et ce sur quoi son filtre porte.
 *
 * **`FACTURE` n'est pas un statut** et ne le deviendra pas : la machine à
 * états décrit le cycle du *document* — écrit, envoyé, validé ou refusé — et
 * ce cycle s'arrête à la validation. La facturation est un fait qu'on note à
 * côté, saisi à la main, dont `services/cra.ts` rappelle qu'il n'est le
 * produit d'aucun calcul : l'application ne facture pas.
 *
 * En faire un état dérivé garde donc les deux notions à leur place, et évite
 * une migration, une transition, un événement de journal, et la question sans
 * intérêt de ce que « rouvrir un CRA facturé » voudrait dire.
 */
export type EtatSuivi = CraStatus | 'FACTURE'

/** Dans l'ordre du cycle : c'est celui dans lequel le filtre les propose. */
export const ETATS_SUIVI: readonly EtatSuivi[] = [
  'BROUILLON',
  'ENVOYE',
  'VALIDE',
  'REFUSE',
  'FACTURE',
]

/**
 * Ce que le suivi montre quand personne n'a rien demandé : tout **sauf** ce
 * qui est allé au bout du cycle. C'est ce qui allège la liste quand elle
 * comptera des centaines de lignes — le porteur ne veut y voir que ce qui
 * demande encore un geste.
 */
export const ETATS_PAR_DEFAUT: readonly EtatSuivi[] = ['BROUILLON', 'ENVOYE', 'REFUSE']

const LIBELLES: Record<EtatSuivi, string> = {
  BROUILLON: 'Brouillon',
  ENVOYE: 'Envoyé',
  VALIDE: 'Validé',
  REFUSE: 'Refusé',
  FACTURE: 'Facturé',
}

export function libelleEtat(etat: EtatSuivi): string {
  return LIBELLES[etat]
}

/**
 * La facture est-elle renseignée ?
 *
 * `paidAt` n'entre pas dans la règle : on peut facturer sans être payé, et un
 * CRA facturé impayé doit rester visible sous « Facturé » plutôt que de
 * disparaître dans une sixième catégorie que personne n'a demandée.
 *
 * La chaîne vide vaut une absence. `saveTracking` écrit déjà `null` plutôt
 * qu'une chaîne vide, mais une donnée reprise d'ailleurs n'a pas cette
 * garantie, et un numéro de facture vide ne facture rien.
 */
export function estFacture(cra: {
  invoiceNumber: string | null
  invoicedAt: Date | null
}): boolean {
  return (cra.invoiceNumber !== null && cra.invoiceNumber !== '') || cra.invoicedAt !== null
}

/**
 * L'état affiché d'un CRA.
 *
 * Seul un CRA **validé** peut être « facturé » : le suivi de facturation se
 * saisit sur n'importe quel CRA, et un brouillon portant un numéro reste un
 * brouillon — le masquer par défaut le ferait disparaître de l'écran alors
 * qu'il demande encore un geste.
 */
export function etatSuivi(cra: {
  status: CraStatus
  invoiceNumber: string | null
  invoicedAt: Date | null
}): EtatSuivi {
  return cra.status === 'VALIDE' && estFacture(cra) ? 'FACTURE' : cra.status
}

/**
 * Les états demandés par l'adresse.
 *
 * **L'absence et le vide ne disent pas la même chose.** Pas de paramètre du
 * tout : personne n'a choisi, on applique le défaut. Un paramètre vide :
 * l'utilisateur a tout décoché, et l'écran doit le lui dire au lieu de
 * ressusciter un filtre qu'il vient de retirer.
 */
export function parseEtats(brut: string | undefined): EtatSuivi[] {
  if (brut === undefined) return [...ETATS_PAR_DEFAUT]

  const connus = new Set<string>(ETATS_SUIVI)
  const vus = new Set<EtatSuivi>()
  for (const morceau of brut.split(',')) {
    const valeur = morceau.trim()
    if (connus.has(valeur)) vus.add(valeur as EtatSuivi)
  }
  return [...vus]
}
