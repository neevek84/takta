/**
 * Le chapitre des intégrations : catalogues + la prose que les catalogues ne
 * portent pas.
 *
 * La prose vit ici et non dans le fichier Markdown parce que le fichier est
 * **engendré**. Écrire dans `docs/integrations.md` à la main fait échouer
 * `chapitre.test.ts` — c'est voulu.
 */
import { engendrerChapitre } from '@/core/integrations/document'
import { CATALOGUE_DOLIBARR } from './dolibarr/catalogue'
import { CATALOGUE_GOOGLE } from './google/catalogue'

export const CHEMIN_CHAPITRE = 'docs/integrations.md'

export function construireChapitre(): string {
  return engendrerChapitre({
    titre: 'Intégrations',
    preambule: [
      {
        titre: 'À quoi sert ce chapitre',
        corps: [
          "Il dit **où sont les appels aux API externes, quels paramètres chacun porte, et",
          "d'où vient la valeur de chacun** — pour suivre les évolutions des systèmes tiers",
          'sans relire tout le code.',
          '',
          'Il est **engendré** depuis `src/integrations/<système>/catalogue.ts`. Trois tests',
          "l'empêchent de mentir : le double d'API refuse une route absente du catalogue, un",
          "test de couverture refuse une entrée que rien n'exerce, et ce fichier est comparé",
          'à ce que la génération produirait.',
          '',
          "Ce qu'il n'est pas : une réécriture de la documentation de Dolibarr ou de Google.",
          'Il décrit **les appels que cette application émet**, et rien de plus.',
        ].join('\n'),
      },
    ],
    catalogues: [CATALOGUE_DOLIBARR, CATALOGUE_GOOGLE],
    final: [
      {
        titre: "Suivre les évolutions d'un système tiers",
        corps: [
          '1. Le catalogue dit contre quelle version chaque appel a été prouvé, et à quelle date.',
          "   L'environnement du porteur est aujourd'hui **Dolibarr 23.0.1**.",
          "2. Le lot 2 avait prévu un test d'intégration automatique sur **instance jetable**. Il",
          "   **n'a pas été livré** : le dépôt ne porte ni configuration vitest séparée, ni suite",
          '   `*.integration.ts`, ni script npm pour la lancer. Ne pas citer une commande qui',
          "   n'existe pas.",
          "3. Ce qui tient lieu de preuve contre une instance réelle est une **recette manuelle**,",
          "   conduite le 18 août 2026 contre l'instance du porteur et consignée dans",
          '   `docs/superpowers/reviews/2026-08-18-recette-dolibarr.md`. Les entrées qui en',
          "   viennent portent `moyen: 'INSTANCE_PORTEUR'` ; les autres sont prouvées contre le",
          "   double d'API, qui prouve la forme de l'appel et non le comportement du serveur.",
          '4. Après une montée de version, rejouer cette recette contre la nouvelle instance.',
          '5. Ce qui passe **met à jour sa version et sa date dans le catalogue**',
          "   (`src/integrations/dolibarr/catalogue.ts`, champ `preuve`). Ce qui casse est",
          "   **nommé avec l'appel et le champ fautifs**, jamais résumé en « la synchronisation ne",
          '   marche plus ».',
          '6. Régénérer le chapitre : `npm run doc:integrations`.',
          '',
          "C'est ce qui transforme « je crois que ça marche encore » en « c'est prouvé contre telle",
          'version, à telle date ».',
        ].join('\n'),
      },
      {
        titre: 'Les réglages tiers qui changent le sens des données',
        corps: [
          '### `TIMESHEET_DAY_DURATION`',
          '',
          'Réglé à **7 heures** chez le porteur, quand le réglage local par défaut est de 480',
          'minutes.',
          '',
          '**Ce réglage ne rend aucun temps faux.** `duration` est un nombre de secondes : huit',
          'heures travaillées valent 28 800 secondes quelle que soit sa valeur. Compenser ferait',
          'passer huit heures pour sept.',
          '',
          "Ce qu'il change est **la lecture jour/heure dans Dolibarr** : huit heures s'y lisent",
          '« 1,14 jour ». Cela s’aligne ; cela ne se compense pas. L’écran Administration ·',
          "Dolibarr propose la reprise (`previewDolibarrSetup`), qui n'écrit rien sans décision, et",
          'ne touche jamais un CRA validé.',
          '',
          '### `SOCIETE_FISCAL_MONTH_START`',
          '',
          "Réglé à **4** chez le porteur — exercice d'avril à mars. Il déplace les bornes de",
          "l'objectif de chiffre d'affaires. Même écran, même règle : proposé, jamais imposé.",
        ].join('\n'),
      },
    ],
  })
}
