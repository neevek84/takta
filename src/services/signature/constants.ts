/**
 * Type d'entité utilisé dans `ExternalLink` pour un CRA.
 *
 * **Réexporté, jamais redéfini.** Le plan du lot 3 posait ici une constante
 * neuve valant `'CRA'` ; le dépôt en portait déjà une valant `'Cra'`
 * (`src/core/sync/policy.ts`), utilisée par la file de synchronisation et le
 * push Dolibarr. Deux constantes homonymes de valeurs différentes sur la même
 * colonne d'une même table sont exactement le piège que la documentation de
 * `core/sync/policy` décrit : « un gestionnaire qui refuse "CRA" quand la file
 * dépose "Cra" ne lève rien, il abandonne la ligne ». Une seule valeur existe
 * donc, et ce fichier n'en est que la porte d'entrée locale.
 */
export { ENTITY_CRA } from '@/core/sync/policy'

/** Identifiant du premier prestataire implémenté. */
export const PROVIDER_DOCUMENSO = 'documenso'
