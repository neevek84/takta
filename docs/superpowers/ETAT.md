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
- **Le gel du facteur se casse en lecture, pas en écriture.** La colonne `minutesParJour` peut rester parfaitement intacte en base pendant qu'un lecteur convertit avec le réglage courant — et un CRA validé bouge alors sans qu'aucune écriture n'ait eu lieu. Rien de statique ne l'empêche : **seuls des tests de comportement le rattrapent, chemin par chemin.** Tout nouveau lecteur de temps doit donc porter son propre test « un CRA validé rend les mêmes chiffres après un changement de réglage ». Couverts à ce jour : `buildChargeMatrix`, `buildTimeSpentPayloads`, `MonthGrid`, `MonthCalendar`.
- **Aucune information portée par la seule couleur.**
- **Tout couple texte/fond atteint 4,5:1**, vérifié par calcul, refusé sinon.
- Français pour les chaînes visibles, anglais pour le code et les commits.

---

## 4. État du code

**Branche `main`** — 1 253 tests, `tsc` à 0, `next build` vert, 15 routes.

| Lot | Contenu | État |
|---|---|---|
| 0 | Socle : auth, missions, grille, capacité, CRA, déploiement | fusionné |
| 1a | Prévisionnel, exercice fiscal, plan de charge | fusionné |
| 1d | Gel du facteur de conversion, cascade client/mission/prestation | fusionné |
| 1e | Système de design, thème paramétrable | fusionné |
| 1c | Calendrier, saisie cyclique, PWA | fusionné |
| 1b | Connecteur Google Calendar, file de synchronisation | fusionné |

**Écrans** : `/login` `/saisie/[month]` `/missions` `/cra` `/charge` `/admin/saisie` `/admin/theme`

---

## 5. Ce qui reste

| Lot | Spec | Plan | Tâches |
|---|---|---|---|
| **2** — Connecteur Dolibarr | oui | oui | 14 |
| **3** — Validation client (PDF, signature) | oui | oui | 15 |
| **4** — Journal de preuve, API, ordonnanceur | oui | oui | 15 |
| **5** — Distribution portable | oui | **oui** | 10 |

**Les dix plans sont écrits.** Il ne reste que de l'implémentation.

**Dépendance croisée à ne pas oublier, lot 1b → lot 5** : `chargerOuCreerEnv` du lot 5 ne génère qu'`AUTH_SECRET` au premier démarrage. Il doit aussi générer **`CREDENTIALS_KEY`** dans le dossier de données — sans quoi l'archive portable diffuse la clé de développement, et le chiffrement des jetons Google ne protège plus rien. **Il n'existe aucune rotation de clé** : la changer déconnecte tout le monde en silence.

**Deux points du lot 1c à soumettre au porteur du produit :**

- **La palette catégorielle** — les six teintes qui distinguent les prestations sont plus saturées que les fonds d'état. C'était nécessaire pour tenir l'écart de distinguabilité dans une fenêtre chaude, mais cela se juge à l'œil.
- **Le glissement au doigt n'est pas prouvé.** `releasePointerCapture` n'est couvert par aucun test : `happy-dom` n'implémente pas la capture implicite, et la mutation survit. Sans cette ligne, le glissement tactile est inopérant sur un appareil réel. **À essayer sur un téléphone.**

**Ordre retenu** : 1c → 1b → 2 → 3 → 4 → 5.

**Contrainte d'exécution** : les implémentations de lots différents **ne peuvent pas tourner en parallèle** — elles touchent les mêmes fichiers. Seules les tâches *à l'intérieur* d'un lot se parallélisent, sur des périmètres disjoints. L'écriture des plans, elle, se parallélise sans risque.

**Arbitrage déjà tranché** : `SyncOutbox` et `ProviderCredential` sont portées par le **lot 1b**, et le lot 2 les consomme.

**Arbitrage corrigé** : `ProviderCredential.userId` avait été noté **nullable**, au motif qu'une clé Dolibarr appartient à l'instance quand un jeton Google est personnel. **C'était faux, et pour la raison déjà apprise au lot 0** : la colonne entre dans `@@unique([userId, provider])`, or `NULL` n'est jamais égal à `NULL` — deux clés d'instance `(NULL, 'DOLIBARR')` passeraient la contrainte. Elle est donc `NOT NULL`.

**Tranché pour le lot 2** : la distinction instance / personne passe par un **`ownerScope` entrant dans la contrainte d'unicité**, et non par une ligne `User` conventionnelle. Un faux compte devrait être filtré par tous les écrans qui listent des utilisateurs, et se ferait oublier une fois sur deux.

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
- **`vitest.config.ts` est en `fileParallelism: false`** — base SQLite partagée à l'intérieur d'un processus. Ne pas modifier.
- **Chaque exécution de vitest a désormais sa propre base**, nommée d'après son PID (`vitest.globalSetup.ts`). Deux conséquences : les agents peuvent tourner en parallèle, et les tests n'écrivent plus dans `prisma/dev.db` — ils y réécrivaient la ligne singleton `Settings`, donc le thème et les réglages réels.
- **Ne jamais lancer `npx next build` pendant que le serveur de développement tourne** : cela écrase son cache et le casse. Remède : arrêter, `rm -rf .next`, relancer.
- **L'empaquetage portable construit dans `CRA_DIST_DIR` (`.next-dist`), jamais dans `.next`** — c'est ce qui permet de construire sans écraser le cache du serveur de développement. `next.config.ts` lit cette variable ; sans elle, rien ne change. Vérifié : `npm run empaqueter` a tourné pendant qu'un `next dev` était vivant, sans le perturber.
- **`next build` réécrit `tsconfig.json` et `next-env.d.ts`** pour y déclarer `<distDir>/types`. `scripts/empaqueter.mjs` les remet dans leur état d'origine ; le faire à la main autrement laisserait une entrée `.next-dist/types/**/*.ts` dans un fichier versionné.
- **Un port n'est pas libre parce qu'il l'est en IPv4.** `npm run dev` écoute sur `*:3000` en IPv6 ; une sonde qui n'écoute que sur `127.0.0.1` le croit libre, et deux serveurs cohabitent alors sur « le port 3000 ».
- **Ne jamais utiliser `git add -A` pendant que des agents travaillent** — chemins explicites uniquement. Cette erreur a balayé du code d'agent dans des commits de documentation **deux fois**.
- **TypeScript est épinglé en `^5.9`** : Next 15 rejette TypeScript 7.
- **`@theme` classique, jamais `@theme inline`** : ce dernier substitue les valeurs à la compilation et rend le thème paramétrable inopérant.
- **Un fichier `page.tsx` ne peut exporter que `default`, `metadata`, etc.** Une action serveur va dans `actions.ts`.
- **`signIn` d'Auth.js lève aussi en cas de succès** (redirection). Un `catch` naïf casse la connexion qui marche.
- **`toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable U+202F.** Neutraliser les espaces avant de comparer.
- **`npm run db:sqlite` échoue en silence** quand le push détruirait des données — il lui manque `--accept-data-loss`. `prisma generate` ne tourne alors pas, et le client reste périmé sans que rien ne le dise.

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
- **Chaque évolution de schéma demande désormais deux migrations** — une Postgres sous `prisma/migrations/`, une SQLite sous `prisma/migrations-sqlite/`. Les deux garde-fous statiques (`src/db/schema-migration-sync.test.ts`, `src/distribution/migrations-sqlite.test.ts`) échouent si l'une prend du retard, mais l'oubli reste facile. Documenté dans le README, section « Deux jeux de migrations, pas un ».
- **L'archive portable n'a été construite et éprouvée que pour macOS Apple Silicon.** Les trois autres plateformes demandent un passage sur la machine correspondante ; `scripts/empaqueter.mjs` refuse de produire une archive dont le moteur Prisma ne correspond pas.
- **`arreter.sh` juge la vivacité par le port, pas par le PID.** Si un autre programme écoute sur le même port (typiquement le `next dev` du dépôt, en IPv6), l'arrêt attend 10 secondes puis force — 11 s et un message alarmant, pour rien. Mesuré : 0 à 1 seconde et « Application arrêtée. » sur un port libre de tout autre occupant. Aucune donnée n'est perdue (WAL + `synchronous=FULL`, prouvé par `kill -9`). Correctif : sonder aussi `::1`, ou vérifier le PID.
- **Trois vulnérabilités npm** transitives via `next`, surfaces de construction.
- **`manifest.webmanifest` et `icon.svg` portent les couleurs KreativPM en dur.** Ce sont des fichiers statiques servis tels quels, hors de portée du système de jetons : quelqu'un qui change le thème garde l'icône d'origine sur son écran d'accueil. Le `themeColor` du document, lui, suit bien le thème enregistré.

---

## 9. Environnement du porteur

- **Dolibarr 23.0.1** joignable par API. Exercice fiscal : `SOCIETE_FISCAL_MONTH_START = 4` — **avril à mars**.
- **`TIMESHEET_DAY_DURATION = 7` heures, quand le défaut local est de 480 minutes.** *Correction d'une affirmation fausse qui figurait ici et qui a été propagée dans trois briefs :* les temps poussés **ne sont pas faux d'un septième**. `task_duration` est en **secondes** — huit heures travaillées valent 28 800 secondes quel que soit ce réglage. Compenser ferait passer huit heures pour sept, et un implémenteur a eu raison de refuser l'instruction. Ce que le réglage change est **l'affichage jour/heure dans Dolibarr** : huit heures s'y lisent « 1,14 jour ». Cela **s'aligne**, cela ne se compense pas.
- **Client OAuth Google existant** (`OAUTH_GOOGLE-KreativWKS`) — réutilisable pour le calendrier en ajoutant le scope.
- **Documenso auto-hébergé**, pour le lot 3.
- **n8n** disponible — consommateur de l'API du lot 4, jamais une dépendance.
- **Identité de marque**, relevée sur `kreativpm.fr` : crème `#FAF5ED`, encre `#342820`, accent or `#D4943F`, **Manrope** 800 et **Inter**. Le bleu du thème Dolibarr n'est pas l'identité.

---

## 9 bis. Arbitrages rendus par le porteur le 16 août

- **Déconnexion Google** : on ne révoque pas côté Google, **on le dit clairement à l'écran**. Une révocation qui échoue à moitié est pire qu'une déconnexion honnête.
- **Écran de supervision** : il **attend le lot 4** et son journal de preuve. Il ne portera pas sa propre table d'historique.
- **Identifiants d'événement** : mise à jour plutôt que suppression puis recréation, pour garder l'identifiant. Le porteur envisageait aussi de sortir du temps réel avec un bouton « sauvegarder » qui déclencherait Google et Dolibarr — écarté pour l'instant : **la synchronisation n'est déjà pas en temps réel** (la file ne part qu'au drainage), la file dédoublonne par cible, et un bouton coûterait le clic-qui-enregistre de Timizer tout en créant du travail perdable. À rouvrir s'il en juge autrement à l'usage.
- **`ProviderCredential`** : `ownerScope` dans l'unicité, voir ci-dessus.

---

## 10. Ce que le porteur a demandé en dernier

- Affiner le design plus tard, vers quelque chose de plus proche de Timizer.
- **Enchaîner tous les lots**, revue le lendemain matin.

Toute décision prise sans arbitrage pendant cette période est consignée dans les journaux d'exécution sous `.superpowers/sdd/<plan>/progress.md`, et dans les sections « Décisions prises sans arbitrage du porteur » des specs.
