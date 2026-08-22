# Reprendre ce code

Pour qui arrive sur le dépôt et doit y travailler. Ce document ne décrit ni les
fonctions ni les dossiers : ils se lisent. Il dit ce qu'aucune lecture ne rend —
pourquoi l'architecture est ainsi, quelles règles coûtent cher à enfreindre, et
quels pièges ont déjà été payés.

Pour installer et exploiter, voir [README.md](../README.md). Pour les décisions
produit, [decisions.md](decisions.md). Pour les appels aux systèmes tiers,
[integrations.md](integrations.md).

---

## 1. Les trois couches, et pourquoi

- **`src/core/`** — le domaine. Calcul des temps, conversion jours/minutes,
  règles de capacité, composition des charges utiles envoyées aux tiers.
- **`src/services/`** — la base. Toute requête Prisma passe par là, et prend un
  `userId` qu'elle applique à sa requête.
- **`src/app/` et `src/components/`** — Next : routes, actions serveur, écrans.

La règle qui tient l'ensemble : **`src/core/` n'importe jamais `@prisma/client`,
`next`, ni React.** Ce n'est pas de la propreté, c'est du temps de cycle. Le
domaine se teste sans base, sans serveur et sans navigateur ; la suite entière
tourne en quelques secondes, et c'est la seule raison pour laquelle on la lance
à chaque modification plutôt qu'avant de committer. Une seule dépendance vers
Prisma dans le cœur et cette propriété disparaît d'un coup, sans qu'aucun test
ne rougisse.

**La frontière client/serveur est tenue par un contrôle, pas par la vigilance**
— `src/frontieres.test.ts`. Il existe parce qu'un composant client importait une
*valeur* depuis un service : un `import type` disparaît à la compilation, un
import de valeur tire tout le module dans le paquet client. L'écran a cessé de
se construire le jour où ce service a gagné une dépendance vers `node:crypto`,
sans qu'une seule ligne de cet écran ait changé. Ni `tsc` ni aucun test unitaire
ne voyaient la faute : le type était parfaitement valide.

---

## 2. Les règles métier qu'on n'enfreint pas

Chacune a un coût de découverte. Aucune n'est là par goût.

**Portabilité du schéma.** Aucun enum Prisma, aucun décimal, aucun tableau,
aucune requête fine sur du JSON — le schéma reste dans l'intersection SQLite et
Postgres. Le JSON se lit et s'écrit en bloc.

**Entiers partout.** Temps en **minutes**, jours en **centièmes de jour**,
montants en **centimes**, durée d'une journée en **minutes**. Aucun flottant ne
traverse une frontière.

**Toute fonction de service prend un `userId` et scope ses requêtes dessus.**
Trois familles d'exceptions, et elles portent leur raison : `flushAllProviders`,
`distributeWebhooks` et `tick` sont réveillés par un **jeton d'instance**, pas
par une session — ils n'ont personne à scoper et doivent servir tous les
comptes ; `readAuditSince` et `verifyJournalChain` de même, pour le jeton d'API.
Toute autre fonction non scopée est un défaut.

*Corollaire, et il est rude :* `tick` exécute les travaux du **compte le plus
ancien**, si bien qu'un second consultant ne recevrait aucun rappel.
`/admin/supervision` le dit à l'écran — le dire n'est pas le corriger.

**Aucune page ni action serveur n'interroge Prisma directement** en
court-circuitant la couche service.

**Le contrôle de capacité porte sur le total de la journée**, toutes lignes
confondues, pas sur l'exclusivité. Trois modes.

**Week-ends et jours fériés sont saisissables**, jamais bloquants. Le grisé est
un repère, pas une barrière.

**Un mois dont le CRA est `VALIDE` refuse toute écriture**, conversion et
réétalonnage compris.

**Le reste est plafonné à zéro, le dépassement exposé séparément.**

**« Cumuler les minutes, convertir une fois »** — mais uniquement **à facteur
constant**. Grouper par facteur, convertir chaque groupe, sommer les centièmes.

### Le gel du facteur se casse en lecture, pas en écriture

C'est la règle la plus contre-intuitive du projet, et celle qu'il faut retenir
si on ne retient qu'une chose.

La colonne `minutesParJour` peut rester **parfaitement intacte en base** pendant
qu'un lecteur convertit avec le réglage courant — et un CRA validé bouge alors
sans qu'aucune écriture n'ait eu lieu. Rien de statique ne l'empêche : ni le
type, ni le schéma, ni `tsc`. **Seuls des tests de comportement le rattrapent,
chemin par chemin.**

Tout nouveau lecteur de temps doit donc porter son propre test « un CRA validé
rend les mêmes chiffres après un changement de réglage ». Couverts à ce jour :
`buildChargeMatrix`, `buildTimeSpentPayloads`, `MonthGrid`, `MonthCalendar`,
`CellForm`.

Le contexte de lecture d'une case (`CellReadContext`) ne porte **plus** de
facteur courant : chaque saisie porte le sien, et une lecture qui aurait de quoi
reconvertir finirait par le faire. C'est ainsi que le calendrier affichait « 1 »
là où le tableau affichait « 1,14 » — sur le même écran, sur un CRA validé.

### Accessibilité

**Aucune information portée par la seule couleur.** **Tout couple texte/fond
atteint 4,5:1**, vérifié par calcul et refusé sinon.

### Langue

Français pour les chaînes visibles, les commentaires et les messages de commit ;
anglais pour les identifiants de code. Exception assumée : les modules qui
nomment du domaine documentaire portent des identifiants français
(`AppelExterne`, `verifierCatalogue`), comme `src/core/dolibarr/` avant eux.

---

## 3. Les pièges d'environnement, durement acquis

**`jsdom` ne fonctionne pas ici** — Node 22.11 est antérieur à 22.12, et les
jsdom publiés tirent une dépendance ESM que le pool `forks` de Vitest charge par
`require()`. Un projet Vitest qui déclare `environment: 'jsdom'` est initialisé
même quand zéro fichier lui correspond : le déclarer casse `npm test` en entier.
Le détail, mesuré et non supposé, est en tête de `vitest.config.ts`.

Donc, pour un test de composant : **`// @vitest-environment happy-dom` en
première ligne**, et **`afterEach(cleanup)` explicite**.

**`happy-dom` implémente la capture de pointeur** (`set`, `has`,
`releasePointerCapture`) avec son état réel. Ce qui lui manque est la capture
*implicite* posée par le navigateur au `pointerdown` : un test qui en a besoin
la pose lui-même, avec la vraie API et sans aucun double.

**`vitest.config.ts` est en `fileParallelism: false`.** Ne pas y toucher : les
fichiers de test partagent une base SQLite à l'intérieur d'un processus.

**Chaque exécution de vitest a sa propre base**, nommée d'après son PID
(`vitest.globalSetup.ts`), créée par `prisma db push` et détruite au démontage.
Deux conséquences : plusieurs exécutions cohabitent, et les tests n'écrivent
plus dans `prisma/dev.db` — ils y réécrivaient la ligne singleton `Settings`,
donc le thème et les réglages réels.

**Le thème est persisté.** Changer `DEFAULT_THEME_CONFIG` ne change **rien**
pour une installation existante : une palette enregistrée l'emporte toujours.
Tout changement de défaut doit livrer sa reprise — `npm run theme:reprise`.

**Ne jamais lancer `npx next build` pendant qu'un serveur de développement
tourne** : le cache `.next` est écrasé et cassé. Remède : arrêter, `rm -rf
.next`, relancer. L'empaquetage portable, lui, construit dans `CRA_DIST_DIR`
(`.next-dist`) précisément pour ne pas avoir ce problème.

**`next build` réécrit `tsconfig.json` et `next-env.d.ts`** pour y déclarer
`<distDir>/types`. `scripts/empaqueter.mjs` les remet dans leur état d'origine.

**Un port n'est pas libre parce qu'il l'est en IPv4.** `npm run dev` écoute sur
`*:3000` en IPv6 ; une sonde qui n'interroge que `127.0.0.1` le croit libre, et
deux serveurs cohabitent alors sur « le port 3000 ».

**Ne jamais utiliser `git add -A`** quand plusieurs travaux cohabitent —
chemins explicites uniquement. Cette erreur a balayé du code dans des commits de
documentation **deux fois**.

**TypeScript est épinglé en `^5.9`** : Next 15 rejette TypeScript 7.

**`@theme` classique, jamais `@theme inline`** : ce dernier substitue les
valeurs à la compilation et rend le thème paramétrable inopérant.

**Un fichier `page.tsx` ne peut exporter que `default`, `metadata` et les
exports que Next reconnaît.** Une action serveur va dans `actions.ts`.

**`signIn` d'Auth.js lève aussi en cas de succès** — la redirection passe par
une exception. Un `catch` naïf casse la connexion qui marche.

**`toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable**
(U+202F). Neutraliser les espaces avant toute comparaison de chaîne.

**`npm run db:sqlite` échoue en silence** quand le push détruirait des données :
il lui manque `--accept-data-loss`. `prisma generate` ne tourne alors pas, et le
client reste périmé sans que rien ne le dise.

---

## 4. La méthode de travail, et ce qu'elle a coûté d'apprendre

Chaque lot suit : **spec → plan → implémentation → revue adversariale →
correction**. Les consignes qui ne changent jamais : le brief est l'unique
source d'exigences, on écrit d'abord le test qui échoue, on ne commite pas, et
ce qui est hors périmètre se signale au lieu de se corriger.

**La revue finale est ce qui a le plus de valeur.** Elle a trouvé quatre défauts
critiques au lot 0, quatre au lot 1a, cinq au lot 1e — dans du code qui
compilait, passait tous ses tests et se construisait.

**La vérification par mutation est la seule preuve qu'un test sert à quelque
chose.** Écrire un test qui passe ne prouve rien : il faut casser volontairement
le code qu'il garde et le voir rougir. Un test qui survit à la mutation est un
test à corriger, pas une garantie. Trois exemples qui l'ont montré ici :

- deux tests d'isolation par utilisateur **sortaient par un retour anticipé**
  sans jamais atteindre la requête — retirer le `userId` du code laissait tout
  au vert ;
- six mutations au lot 1e laissaient **423 tests verts**, dont trois
  changements de comportement réels sur la page CRA ;
- un test de dérive d'arrondi employait des valeurs **qui tombaient juste**, et
  n'arrondissait donc jamais.

Le même principe vaut pour la documentation : c'est pourquoi les appels aux
systèmes tiers vivent dans un catalogue en code, comparé au double d'API et à ce
qu'exercent les tests, plutôt que dans un chapitre en prose qui aurait raison le
jour où il est écrit.

---

## 5. Où lire la suite

- [README.md](../README.md) — installer, exploiter, sauvegarder, mettre à jour.
- [integrations.md](integrations.md) — les appels aux API externes, engendré
  depuis les catalogues.
- [decisions.md](decisions.md) — les décisions produit et leur pourquoi.

Les **specs** (`docs/superpowers/specs/`) et les **plans**
(`docs/superpowers/plans/`) sont des documents de travail : datés, écrits avant
l'implémentation, **jamais tenus à jour ensuite**. Ils disent ce qu'on croyait
au moment de les écrire, ce qui a de la valeur pour comprendre un arbitrage —
et aucune pour savoir ce que le code fait aujourd'hui. En cas de contradiction,
le code a raison.
