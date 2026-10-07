import type { Gabarit } from '@/core/notify/templates'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { journalErreur } from '@/services/log'
import { notify, type Mailer, type PieceJointe } from '@/services/notify'

export type CourrielRaison =
  | 'ENVOI'
  | 'CODE'
  | 'VALIDE_CONSULTANT'
  | 'VALIDE_CLIENT'
  | 'REFUSE_CONSULTANT'
  | 'REFUSE_CLIENT'
  | 'ANNULATION'
  | 'RELANCE'

/**
 * Envoie un courriel du circuit de signature, et le dit au journal.
 *
 * **Ne lève jamais** (ni l'envoi, ni l'écriture au journal). Le courriel ne commande rien : une transition a déjà eu
 * lieu, ou va avoir lieu, quoi qu'il arrive au SMTP. Laisser remonter une
 * panne d'envoi ferait échouer une validation que le client a pourtant
 * signée.
 *
 * Le journal ne reçoit **ni l'adresse, ni le sujet, ni le corps** — un code à
 * usage unique y passerait sinon en clair, et le journal est poussé vers des
 * URL tierces. Seule la raison est consignée.
 */
export async function envoyerCourriel(args: {
  craId: string
  raison: CourrielRaison
  to: string
  gabarit: Gabarit
  pieces?: PieceJointe[]
  mailer?: Mailer | null
}): Promise<{ envoye: boolean; motif: string }> {
  let resultat: { envoye: boolean; motif: string }

  if (args.to.trim() === '') {
    resultat = { envoye: false, motif: 'Aucune adresse de destination.' }
  } else {
    try {
      resultat = await notify(args.gabarit, {
        mailer: args.mailer ?? null,
        destinataire: args.to,
        ...(args.pieces !== undefined && { pieces: args.pieces }),
      })
    } catch {
      // Le message d'erreur du transport n'est pas repris : il nomme le
      // serveur, parfois l'utilisateur SMTP, et finit sous les yeux de
      // quelqu'un.
      resultat = { envoye: false, motif: 'Le serveur de courriel a refusé l’envoi.' }
    }
  }

  // L'écriture au journal ne doit pas non plus faire échouer l'appelant : la
  // transition est déjà validée. Texte fixe, sans le message de l'erreur.
  try {
    await appendAudit({
      ...ACTEUR_SYSTEME,
      action: resultat.envoye ? 'signature.courriel.envoye' : 'signature.courriel.echoue',
      entityType: 'Cra',
      entityId: args.craId,
      payload: { raison: args.raison },
    })
  } catch {
    journalErreur('signature.courriel.journal', new Error('écriture au journal impossible'), {
      raison: args.raison,
    })
  }

  return resultat
}
