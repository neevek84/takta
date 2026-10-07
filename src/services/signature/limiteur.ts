/**
 * Limitation des essais de code **par adresse IP**, en mémoire.
 *
 * En plus du compteur par lien (5 essais par code) : un attaquant qui
 * détiendrait plusieurs liens ne doit pas multiplier ses essais d'autant.
 *
 * En mémoire, et c'est assumé : l'application est mono-instance (Docker ou
 * archive portable). Un redémarrage remet les compteurs à zéro — le compteur
 * par lien, lui, est en base et survit.
 */
const FENETRE_MS = 15 * 60_000
const MAX = 20

/** Au-delà, chaque appel balaie les fenêtres échues : la table ne grossit pas sans fin. */
const SEUIL_BALAYAGE = 1000

const compteurs = new Map<string, { debut: number; n: number }>()

export function autoriser(cle: string, maintenant: number = Date.now()): boolean {
  if (compteurs.size > SEUIL_BALAYAGE) {
    for (const [k, v] of compteurs) if (maintenant - v.debut >= FENETRE_MS) compteurs.delete(k)
  }
  const c = compteurs.get(cle)
  if (c === undefined || maintenant - c.debut >= FENETRE_MS) {
    compteurs.set(cle, { debut: maintenant, n: 1 })
    return true
  }
  c.n += 1
  return c.n <= MAX
}

/** Pour les tests. */
export function reinitialiserLimiteur(): void {
  compteurs.clear()
}

/** Pour les tests. */
export function tailleLimiteur(): number {
  return compteurs.size
}
