import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compose des classes et résout les conflits d'utilitaires.
 *
 * Le besoin est réel et non théorique : chaque primitive concaténait ses
 * propres classes avec celles de l'appelant en gabarit de chaîne. Un appelant
 * qui passe `px-2` à un `Button` portant déjà `px-4` produisait un résultat
 * dépendant de l'ordre d'insertion CSS — donc de l'ordre de compilation, que
 * personne ne contrôle depuis le site d'appel.
 *
 * `tailwind-merge` ne connaît que les utilitaires standard. Nos jetons —
 * `bg-accent`, `text-on-accent`, `bg-cat-a` — lui sont inconnus et traversent
 * inchangés : aucune configuration n'est nécessaire. **Ce n'est pas une
 * hypothèse** : `controls.test.tsx` le vérifie sur des jetons réellement
 * employés dans `src/`, y compris le cas où la confusion coûterait cher
 * (`text-ink` est une couleur, pas une taille — la ranger avec `text-sm`
 * ferait perdre sa densité à chaque tableau sans qu'aucune couleur ne change).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
