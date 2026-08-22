import type { Role } from '@/core/types'
import { MOTIF_REFUS_ADMIN } from '@/core/auth/roles'
import { Banner } from './Banner'
import { PageShell } from './PageShell'

/**
 * Le refus, à l'écran, à la place de ce qui est refusé.
 *
 * **Il ne redirige pas, et c'est tout son objet.** Une redirection vers
 * `/saisie` enseigne au consultant que l'écran n'existe pas : il le cherchera,
 * puis conclura que l'application ne sait pas faire. Un refus nommé lui apprend
 * que l'écran existe, qu'il ne lui est pas ouvert, et à qui le demander.
 *
 * Aucun lien de sortie : la navigation est déjà là, à gauche, et un bouton
 * « retour » ferait quitter l'écran avant d'avoir lu pourquoi.
 *
 * Composant **serveur** : il est rendu depuis les `page.tsx`, avant tout appel
 * de service. Rien de ce que la page allait lire n'a été lu.
 */
export function AccesRefuse({ role }: { role: Role }) {
  return (
    <PageShell title="Accès refusé">
      <Banner tone="danger" title="Cet écran ne vous est pas ouvert">
        <p>{MOTIF_REFUS_ADMIN}</p>
        <p>
          Votre rôle sur cette installation : <strong>{role}</strong>.
        </p>
      </Banner>
    </PageShell>
  )
}
