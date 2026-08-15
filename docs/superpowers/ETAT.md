# État du projet CRA

**Dernière mise à jour :** 2026-08-16
**À lire en premier** par quiconque reprend ce projet — humain ou agent.

---

## 1. Ce qu'est ce produit

Une application de **compte-rendu d'activité** pour consultant indépendant, aussi simple à l'usage que Timizer, qui gère en plus le **prévisionnel adossé à un engagement contractuel**.

**Autoportante** : elle fonctionne intégralement sans aucun système tiers. Dolibarr, Google Calendar et la signature électronique sont des connecteurs **optionnels et additifs**.

Porteur du produit : Keveen Plante, KREATIV PROJECT MANAGEMENT SASU.

---

## 2. Les décisions qui ne se rouvrent pas

Elles ont été prises explicitement et coûteraient cher à défaire.

| Décision | Pourquoi |
|---|---|
| **L'application est le produit, Dolibarr le back-office** | Un module Dolibarr reproduirait la cause de mort du module `dolibarr_project_timesheet` : du PHP couplé au cycle de release, maintenu par une seule personne |
| **L'application ne facture pas** | Elle peut demander à Dolibarr de créer une facture. Dolibarr facture, pas le CRA. Toute la charge réglementaire reste chez lui |
| **Mono-organisation, pas de multi-tenant** | Porter une clé de tenant inutilisée pollue chaque requête |
| **L'engagement est porté par la ligne de prestation, pas par la mission** | Une propale se découpe en lignes facturables distinctes (`Consultant ITSM 30j@800€`, `Consultant ITSM Nuit 10j@1200€`) |
| **Synchronisation unidirectionnelle** | L'application est maître du CRA. Pas de bidirectionnel, c'est là que ce type d'outil meurt |
| **La conversion prévisionnel → réalisé n'est jamais automatique** | Ce serait du temps engageant créé sans décision humaine |
| **Une saisie porte son facteur de conversion, figé à l'écriture** | Un CRA validé est un document signé ; son contenu ne peut pas changer après signature |
| **Pas de portail client** | Le client reçoit un document et le signe. Tout un sous-système disparaît |
| **Aucun montant sur le CRA** | Le document atteste du temps, pas d'une somme |

---

## 3. Les règles métier, à ne jamais enfreindre

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** Domaine pur.
- **Aucun enum Prisma, aucun décimal, aucun tableau, aucune requête fine sur du JSON.** Portabilité SQLite/Postgres. Le JSON se lit et s'écrit en bloc.
- **Entiers partout** : temps en **minutes**, jours en **centièmes de jour**, montants en **centimes**, durée d'une journée en **minutes**.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus** — provision multi-consultants.
- **Aucune page ni action serveur n'interroge Prisma directement** en court-circuitant la couche service.
- **Le contrôle de capacité porte sur le total de la journée**, toutes lignes confondues, pas sur l'exclusivité. Trois modes.
- **Week-ends et jours fériés sont saisissables**, jamais bloquants. Le grisé est un repère.
- **Un mois dont le CRA est `VALIDE` refuse toute écriture**, conversion et réétalonnage compris.
- **Le reste est plafonné à zéro, le dépassement exposé séparément.**
- **« Cumuler les minutes, convertir une fois »** — mais uniquement **à facteur constant**. Grouper par facteur, convertir chaque groupe, sommer les centièmes.
- **Aucune information portée par la seule couleur.**
- **Tout couple texte/fond atteint 4,5:1**, vérifié par calcul, refusé sinon.
- Français pour les chaînes visibles, anglais pour le code et les commits.

---

## 4. État du code

**Branche `main`** — 502 tests, `tsc` à 0, `next build` vert, 11 routes.

| Lot | Contenu | État |
|---|---|---|
| 0 | Socle : auth, missions, grille, capacité, CRA, déploiement | fusionné |
| 1a | Prévisionnel, exercice fiscal, plan de charge | fusionné |
| 1d | Gel du facteur de conversion, cascade client/mission/prestation | fusionné |
| 1e | Système de design, thème paramétrable | fusionné |

**Écrans** : `/login` `/saisie/[month]` `/missions` `/cra` `/charge` `/admin/saisie` `/admin/theme`

---

## 5. Ce qui reste

| Lot | Spec | Plan | Tâches |
|---|---|---|---|
| **1c** — Calendrier et saisie cyclique | oui | **oui** | 11 |
| **1b** — Google Calendar | oui | **oui** | 12 |
| **2** — Connecteur Dolibarr | oui | **oui** | 14 |
| **3** — Validation client (PDF, signature) | oui | non | — |
| **4** — Journal de preuve, API, ordonnanceur | oui | non | — |
| **5** — Distribution portable | oui | non | — |

**Ordre retenu** : 1c → 1b → 2 → 3 → 4 → 5.

**Contrainte d'exécution** : les implémentations de lots différents **ne peuvent pas tourner en parallèle** — elles touchent les mêmes fichiers. Seules les tâches *à l'intérieur* d'un lot se parallélisent, sur des périmètres disjoints. L'écriture des plans, elle, se parallélise sans risque.

**Arbitrage déjà tranché** : `SyncOutbox` et `ProviderCredential` sont portées par le **lot 1b**, et le lot 2 les consomme. `ProviderCredential.userId` est **nullable** — une clé Dolibarr appartient à l'instance, un jeton Google est personnel.

---

## 6. Méthode de travail, et pourquoi elle a payé

Chaque lot suit : **spec → plan → implémentation par vagues d'agents parallèles → revue adversariale → vague de correction → fusion**.

**La revue finale est ce qui a le plus de valeur.** Elle a trouvé 4 défauts critiques au lot 0, 4 au lot 1a, 5 au lot 1e — dans du code qui compilait, passait tous ses tests et se construisait.

**La vérification par mutation est la seule preuve qu'un test sert à quelque chose.** Elle a démasqué, entre autres :

- deux tests d'isolation par utilisateur qui sortaient par un retour anticipé sans jamais atteindre la requête — retirer le `userId` du code laissait tout au vert ;
- six mutations sur le lot 1e laissant 423 tests verts, dont trois changements de comportement réels sur la page CRA ;
- un test de dérive d'arrondi utilisant des valeurs qui tombaient juste, donc n'arrondissant jamais.

**Consignes systématiques aux agents** : lire le brief comme unique source d'exigences, écrire d'abord le test qui échoue, ne jamais commiter, signaler sans corriger ce qui est hors périmètre.

---

## 7. Pièges d'environnement, durement acquis

- **`jsdom` ne fonctionne pas ici** (Node 22.11 < 22.12). Tests de composants : `// @vitest-environment happy-dom` en **première ligne**, et `afterEach(cleanup)` **explicite**.
- **`environmentMatchGlobs` n'existe plus en Vitest 4.**
- **`vitest.config.ts` est en `fileParallelism: false`** — base SQLite partagée. Ne pas modifier.
- **Ne jamais lancer plusieurs agents exécutant `vitest` en même temps** : ce réglage ne protège qu'à l'intérieur d'un processus. C'était la cause d'échecs intermittents `expected 420 to be 480`.
- **Ne jamais lancer `npx next build` pendant que le serveur de développement tourne** : cela écrase son cache et le casse. Remède : arrêter, `rm -rf .next`, relancer.
- **Ne jamais utiliser `git add -A` pendant que des agents travaillent** — chemins explicites uniquement. Cette erreur a balayé du code d'agent dans des commits de documentation **deux fois**.
- **TypeScript est épinglé en `^5.9`** : Next 15 rejette TypeScript 7.
- **`@theme` classique, jamais `@theme inline`** : ce dernier substitue les valeurs à la compilation et rend le thème paramétrable inopérant.
- **Un fichier `page.tsx` ne peut exporter que `default`, `metadata`, etc.** Une action serveur va dans `actions.ts`.
- **`signIn` d'Auth.js lève aussi en cas de succès** (redirection). Un `catch` naïf casse la connexion qui marche.
- **`toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable U+202F.** Neutraliser les espaces avant de comparer.

---

## 8. Dettes connues, non bloquantes

- **`today` est dérivé de l'heure UTC**, pas locale. Saisir à 00 h 30 fait croire à l'application qu'on est la veille. Demande un utilitaire de fuseau centralisé.
- **Le middleware edge laisse passer une session orpheline** : il ne consulte pas la base, seule la page le fait.
- **`month` n'est pas validé côté service** : `'2026-13'` est accepté et interprété comme janvier 2027.
- **Une ligne archivée portant du réalisé reste affichée** dans la matrice de charge — voulu, son CA est un fait comptable, mais à arbitrer côté affichage.
- **`theme.ts` importe `readSettingsRow` de `settings.ts`** : le layout racine tire donc toujours transitivement les fériés.
- **La grille fait 1364 px sur 31 jours** depuis la cible tactile de 44 pt — défilement horizontal systématique sur téléphone. Le lot 1c y répond par la vue calendrier.
- **Le balayage des couples de contraste ne couvre pas** : une encre d'état sur un fond hors des quatre fonds de texte, `link`/`onAccent`/`onDark` posés seuls, un fond porté par une variable.
- **Docker et Postgres n'ont jamais été exécutés** dans cet environnement. Un garde-fou statique détecte désormais la dérive du schéma, mais le chemin complet reste à éprouver.
- **Trois vulnérabilités npm** transitives via `next`, surfaces de construction.

---

## 9. Environnement du porteur

- **Dolibarr 23.0.1** joignable par API. Exercice fiscal : `SOCIETE_FISCAL_MONTH_START = 4` — **avril à mars**. `TIMESHEET_DAY_DURATION = 7` heures, quand le défaut local est de 480 minutes : **à aligner**, sinon les temps poussés seront faux d'un septième.
- **Client OAuth Google existant** (`OAUTH_GOOGLE-KreativWKS`) — réutilisable pour le calendrier en ajoutant le scope.
- **Documenso auto-hébergé**, pour le lot 3.
- **n8n** disponible — consommateur de l'API du lot 4, jamais une dépendance.
- **Identité de marque**, relevée sur `kreativpm.fr` : crème `#FAF5ED`, encre `#342820`, accent or `#D4943F`, **Manrope** 800 et **Inter**. Le bleu du thème Dolibarr n'est pas l'identité.

---

## 10. Ce que le porteur a demandé en dernier

- Affiner le design plus tard, vers quelque chose de plus proche de Timizer.
- **Enchaîner tous les lots**, revue le lendemain matin.

Toute décision prise sans arbitrage pendant cette période est consignée dans les journaux d'exécution sous `.superpowers/sdd/<plan>/progress.md`, et dans les sections « Décisions prises sans arbitrage du porteur » des specs.
