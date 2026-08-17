import { THEME_ENCRE_CLAIR, THEME_ENCRE_SOMBRE, THEME_MODES } from './tokens'
import type { ThemeConfig, ThemeMode, ThemeTokens } from './tokens'

/**
 * La reprise d'un thème enregistré avant le lot 1g.
 *
 * Le thème est **persisté** depuis le lot 1e, et une palette enregistrée
 * l'emporte sur le défaut livré — c'est ce qui permet à un exploitant de garder
 * la sienne à travers les montées de version. Conséquence : changer
 * `DEFAULT_THEME_CONFIG` ne change rien pour une installation existante. Le lot
 * 1g livrerait donc son identité aux seules bases vierges, et toutes les autres
 * garderaient le châssis gris d'avant sous les aplats teal et ambre du lot — un
 * hybride qui n'est ni l'ancien thème ni le nouveau.
 *
 * La reprise ne peut pas se contenter d'écraser : une palette **choisie** est
 * une décision, et l'écraser serait pire que le mal qu'on répare. Elle ne
 * remplace donc que ce que personne n'a choisi — la palette neutre livrée par
 * défaut jusqu'au lot 1f, restée telle quelle jeton pour jeton.
 *
 * Ce que la reprise laisse intact, délibérément :
 * - le préréglage KreativPM, qui est une décision de marque ;
 * - toute palette dont un seul jeton diffère du défaut historique ;
 * - le mode d'application (`systeme`, `clair`, `sombre`), qui est un réglage
 *   d'usage et non une identité.
 */







import historiques from './palettes-historiques.json'

/**
 * Les défauts livrés avant le lot 1g, figés en **données** et non en code.
 *
 * Trois générations : le neutre du lot 1e — dont la palette catégorielle vit
 * dans la fenêtre chaude que le lot 1f a quittée —, puis les deux versants du
 * neutre livré jusqu'au lot 1f inclus.
 *
 * Elles ne suivent jamais l'évolution de `tokens.ts` : ce sont les valeurs
 * qu'une base existante porte, et comparer au jeton courant ferait échouer la
 * reconnaissance dès la prochaine retouche d'un préréglage. Le JSON dit cette
 * nature : des données historiques, pas une palette vivante.
 */
export const NEUTRE_LOT_1E: Readonly<Record<string, string>> = historiques.neutreLot1e
export const NEUTRE_AVANT_1G_CLAIR: Readonly<Record<string, string>> =
  historiques.neutreAvant1gClair
export const NEUTRE_AVANT_1G_SOMBRE: Readonly<Record<string, string>> =
  historiques.neutreAvant1gSombre

export type Verdict =
  /** rien à faire : colonne vide, illisible, ou palette déjà reprise */
  | { kind: 'DEJA_A_JOUR'; raison: string }
  /** le défaut que personne n'a choisi : à remplacer par Encre */
  | { kind: 'REPRISE'; mode: ThemeMode }
  /** une décision de l'exploitant : à laisser intacte */
  | { kind: 'PERSONNALISE'; raison: string }

/**
 * Une palette stockée est-elle, jeton pour jeton, la palette de référence ?
 *
 * La comparaison porte sur les clés de la **référence**, jamais sur celles du
 * stocké : une base d'avant le lot 1g ne porte ni `prevu` ni `saisie`, et les
 * exiger ferait échouer toutes les reconnaissances. Une clé en trop côté
 * stocké ne disqualifie pas non plus — elle serait ignorée à la lecture.
 */
function estLaPalette(
  stocke: unknown,
  // `ThemeTokens` est une interface, donc sans signature d'index : elle n'est
  // pas assignable à un `Record<string, string>`. L'union laisse passer les
  // deux formes de référence — les palettes historiques figées ici, et les
  // palettes vivantes de `tokens.ts`.
  reference: Readonly<Record<string, string>> | ThemeTokens,
): boolean {
  if (typeof stocke !== 'object' || stocke === null) return false
  const palette = stocke as Record<string, unknown>
  for (const [cle, valeur] of Object.entries(reference as Record<string, string>)) {
    const trouve = palette[cle]
    if (typeof trouve !== 'string' || trouve.toLowerCase() !== valeur) return false
  }
  return true
}

/**
 * Ce qu'il faut faire du contenu de `Settings.themeJson`.
 *
 * Pure et sans base : c'est ce qui permet de la vérifier sur les cinq formes
 * que la colonne peut prendre sans monter une seule installation.
 */
export function verdictDeReprise(brut: unknown): Verdict {
  if (typeof brut !== 'object' || brut === null) {
    return { kind: 'DEJA_A_JOUR', raison: 'colonne vide ou illisible : la lecture rend déjà le défaut' }
  }
  const stocke = brut as Record<string, unknown>

  if (Object.keys(stocke).length === 0) {
    return { kind: 'DEJA_A_JOUR', raison: 'colonne vide : la lecture rend déjà le défaut' }
  }

  // Le format à deux versants, celui du lot 1f. `mode` est conservé : c'est un
  // réglage d'usage, pas une identité.
  const aDeuxVersants =
    typeof stocke.clair === 'object' && stocke.clair !== null &&
    typeof stocke.sombre === 'object' && stocke.sombre !== null

  if (aDeuxVersants) {
    if (
      estLaPalette(stocke.clair, THEME_ENCRE_CLAIR) &&
      estLaPalette(stocke.sombre, THEME_ENCRE_SOMBRE)
    ) {
      return { kind: 'DEJA_A_JOUR', raison: 'la palette enregistrée est déjà Encre' }
    }
    if (
      (estLaPalette(stocke.clair, NEUTRE_AVANT_1G_CLAIR) ||
        estLaPalette(stocke.clair, NEUTRE_LOT_1E)) &&
      estLaPalette(stocke.sombre, NEUTRE_AVANT_1G_SOMBRE)
    ) {
      const mode = THEME_MODES.find((m) => m === stocke.mode) ?? 'systeme'
      return { kind: 'REPRISE', mode }
    }
    return {
      kind: 'PERSONNALISE',
      raison: 'au moins un jeton diffère du défaut neutre livré jusqu’au lot 1f',
    }
  }

  // Le format à plat du lot 1e : une seule palette, relue comme le versant
  // clair. Un thème de marque enregistré à cette époque tombe ici, et c'est
  // très exactement ce qu'il ne faut pas écraser.
  if (estLaPalette(stocke, THEME_ENCRE_CLAIR)) {
    return { kind: 'DEJA_A_JOUR', raison: 'la palette enregistrée est déjà Encre' }
  }
  if (estLaPalette(stocke, NEUTRE_AVANT_1G_CLAIR) || estLaPalette(stocke, NEUTRE_LOT_1E)) {
    return { kind: 'REPRISE', mode: 'systeme' }
  }
  return {
    kind: 'PERSONNALISE',
    raison: 'palette à plat du lot 1e, différente du défaut neutre — une décision, pas un défaut',
  }
}

/** La configuration à écrire quand le verdict est `REPRISE`. */
export function configDeReprise(mode: ThemeMode): ThemeConfig {
  return { mode, clair: THEME_ENCRE_CLAIR, sombre: THEME_ENCRE_SOMBRE }
}
