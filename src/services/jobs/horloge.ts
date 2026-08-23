import { journalErreur } from '@/services/log'
import { tick as tickReel, type TickReport } from './scheduler'

/**
 * Le battement de l'horloge interne.
 *
 * Cinq minutes : chaque travail porte **sa propre** récurrence — cinq minutes
 * pour la file de sortie, un jour pour les rappels — et l'horloge ne fait que
 * demander « y a-t-il quelque chose d'échu ». Battre plus vite ne ferait que
 * constater plus souvent qu'il n'y a rien à faire.
 */
export const INTERVALLE_MS = 5 * 60_000

/**
 * **L'application porte sa propre horloge.**
 *
 * Elle ne l'a pas toujours fait : l'ordonnanceur attendait qu'un déclencheur
 * extérieur appelle `POST /api/jobs/tick` — un cron, une tâche planifiée de
 * NAS. Le porteur a tranché, et il avait raison : **l'API existe pour que
 * d'autres outils viennent parler à l'application, pas pour que l'application
 * se fasse marcher elle-même.** Une synchronisation qui ne part que si
 * quelqu'un a pensé à poser un cron n'est pas une fonction du produit, c'est
 * une note de bas de page — et son oubli ne se voit qu'à l'absence de ce qui
 * aurait dû arriver.
 *
 * La route reste, et garde tout son sens : elle permet à un orchestrateur
 * extérieur de provoquer un réveil quand il le veut. Elle n'est simplement
 * plus **nécessaire**.
 *
 * Appelée depuis `src/instrumentation.ts`, que Next exécute une fois au
 * démarrage du serveur — jamais depuis un module de page, qui serait évalué à
 * la construction comme à l'exécution.
 */
let arret: (() => void) | null = null

export function demarrerHorloge(
  deps: {
    tick?: () => Promise<TickReport>
    /** injectée par les tests ; en production, `setInterval` */
    planifier?: (action: () => void, ms: number) => unknown
    journal?: (portee: string, err: unknown) => void
  } = {},
): boolean {
  // **Un seul démarrage.** Un rechargement à chaud en développement, ou un
  // module évalué deux fois, doublerait le rythme sans que rien ne le dise.
  if (arret !== null) return false

  const tick = deps.tick ?? tickReel
  const journal = deps.journal ?? journalErreur

  const battre = (): void => {
    // **Le filet est indispensable.** Une promesse rejetée dans un
    // `setInterval` n'est rattrapée par personne : elle emporte le processus,
    // et une base momentanément injoignable ferait tomber le serveur entier.
    void tick().catch((err: unknown) => journal('horloge', err))
  }

  // Un premier réveil tout de suite : un conteneur qui vient de redémarrer
  // laisserait sinon dormir cinq minutes ce qui attendait déjà en file — et
  // c'est justement après un redémarrage qu'il y a le plus à rattraper.
  battre()

  const planifier = deps.planifier ?? setInterval
  const handle = planifier(battre, INTERVALLE_MS)
  arret = () => {
    if (typeof handle === 'object' || typeof handle === 'number') clearInterval(handle as never)
  }
  return true
}

/** Rend l'horloge à son état d'origine. Pour les tests ; rien ne l'appelle en production. */
export function arreterHorloge(): void {
  arret?.()
  arret = null
}
