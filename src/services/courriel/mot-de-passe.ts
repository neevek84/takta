import { readInstanceCredentialAndSecret } from '@/services/credentials'
import { confierSecret } from '@/services/log'

/**
 * Le mot de passe SMTP saisi dans Administration · Courriel : un identifiant
 * d'instance, scellé par `CREDENTIALS_KEY`, comme la clé Documenso.
 *
 * Module à part de `reglages.ts` parce que `services/notify.ts` le lit, et
 * que `reglages.ts` lit `notify.ts` : séparés, aucun des deux n'importe
 * l'autre en boucle.
 */
export const PROVIDER_SMTP = 'smtp'

/** D'où vient le mot de passe en vigueur. */
export type ProvenanceMotDePasse = 'ecran' | 'env' | 'aucune'

export interface MotDePasseSmtp {
  provenance: ProvenanceMotDePasse
  /** jamais rendu à une page : seuls le transport et le contrôle de complétude le lisent */
  motDePasse: string
  /** un mot de passe est enregistré mais ne se déchiffre plus (`CREDENTIALS_KEY` changée) */
  illisible: boolean
  /** date d'enregistrement de la ligne de l'écran, quand il y en a une */
  enregistreLe: Date | null
}

/**
 * Le mot de passe en vigueur : celui de l'écran, sinon `SMTP_PASSWORD` —
 * l'environnement reste un repli pour les instances réglées avant l'écran.
 *
 * Une ligne illisible ne vaut pas réglage : on retombe sur l'environnement,
 * `readInstanceSecret` a laissé sa ligne de journal, et `illisible` permet à
 * l'écran de dire pourquoi le mot de passe saisi n'est pas en vigueur.
 */
export async function lireMotDePasseSmtp(): Promise<MotDePasseSmtp> {
  // Une seule lecture de la ligne : un secret illisible ne laisse qu'un
  // avertissement par résolution.
  const { existe, secret: stocke, connectedAt } = await readInstanceCredentialAndSecret(PROVIDER_SMTP)
  if (stocke !== null && stocke !== '') {
    // Il ne vit plus dans l'environnement : la liste des variables secrètes du
    // journal ne le couvre plus. On le confie au moment où on le lit.
    confierSecret(stocke)
    return { provenance: 'ecran', motDePasse: stocke, illisible: false, enregistreLe: connectedAt }
  }

  const illisible = existe
  const env = process.env.SMTP_PASSWORD ?? ''
  if (env !== '') return { provenance: 'env', motDePasse: env, illisible, enregistreLe: null }
  return { provenance: 'aucune', motDePasse: '', illisible, enregistreLe: null }
}
