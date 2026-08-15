# Re-revue ciblée — correctifs `b9e36da..931dfd8` (branche `lot-0`)

Date : 2026-08-15 · Périmètre : vérification des 4 Critiques et 9 Importants de
`final-review.md`, plus recherche de régressions introduites par le seul commit
`931dfd8`. Ce n'est pas une nouvelle revue générale.

## Méthode

Quatre agents ont travaillé en parallèle **dans le même arbre**, chacun validant
sur un arbre que les trois autres modifiaient. Leurs rapports ont donc été
traités comme des affirmations à vérifier, pas comme des preuves. Chaque constat
vérifiable par exécution l'a été, et **avec mes propres tests**, écrits
indépendamment des leurs (fichier temporaire `src/zz-rereview.test.ts`, 16 tests,
supprimé après coup — arbre git laissé propre, base de développement laissée
vide).

### Vérifications exécutées sur l'arbre final

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | 0 erreur |
| `npx vitest run` | **152 tests / 17 fichiers, verts** |
| `rm -rf .next && npx next build` | aboutit, 9 routes |
| CSS produit | `13 290` octets, `0` occurrence de la directive brute `@tailwind utilities` |
| Règles Tailwind réelles | `.text-red-600{color:var(--color-red-600)}`, `.bg-slate-900{…}`, `.overflow-x-auto{overflow-x:auto}`, `.bg-amber-50{…}` — et les variables `--color-*` sont bien définies dans le même fichier |
| Migration Postgres vs schéma | `prisma migrate diff --from-empty --to-schema-datamodel` (provider basculé sur une **copie** hors dépôt) → **diff vide** avec `prisma/migrations/20260815000000_init/migration.sql`. La migration décrit exactement le schéma : 9 tables, index, clés étrangères. |
| Chaîne du Dockerfile (étage `builder`) rejouée hors Docker | `npm run db:pg` puis `env -u DATABASE_URL npx next build` → **aboutit**. `prisma generate` ne réclame pas `DATABASE_URL` (vérifié isolément dans un répertoire sans `.env`), donc l'étage builder ne dépend pas d'une base joignable. Schéma remis en `sqlite` et client régénéré ensuite (`git status` propre). |
| Mes 16 tests indépendants (C3, C4, I1, I5, I6 + garde-fous spec) | verts |
| `src/core/` sans Prisma / Next / React | conforme (grep) |
| Aucun accès Prisma direct sous `src/app/` | conforme (grep) |
| L'application ne facture jamais | conforme — `tjmCents` n'est jamais multiplié |
| Conversion prévisionnel → réalisé automatique | inexistante |
| Tests existants supprimés ou affaiblis | **aucun** — les seules lignes retirées des fichiers de test sont des imports et du `deleteMany` de nettoyage ; aucune assertion n'a été supprimée ni relâchée |

---

# Verdicts sur les 13 constats

## C1 — postcss absent → **CORRIGÉ**

`postcss.config.mjs` existe à la racine avec `{ plugins: { '@tailwindcss/postcss': {} } }`.

**Preuve par exécution, pas par lecture du diff :** après `rm -rf .next && npx next build`,
`.next/static/css/b7429dc04e760d3d.css` fait 13 290 octets ;
`grep -c '@tailwind utilities'` → **0** ; `grep -o '\.text-red-600{[^}]*}'` →
`.text-red-600{color:var(--color-red-600)}` ; idem `.bg-slate-900`,
`.overflow-x-auto`, `.bg-amber-50`. J'ai en plus vérifié que les variables
référencées sont définies dans le même fichier
(`--color-red-600:oklch(57.7% .245 27.325)`), ce que le rapport de l'agent A ne
vérifiait pas — sans quoi les règles auraient été présentes mais inertes.

## C2 — Docker/Prisma provider incohérent → **CORRIGÉ** (dans la limite explicite : Docker non exécuté)

Trois défauts cumulés, les trois traités :

1. **Bascule du provider.** `Dockerfile:14` fait `RUN npm run db:pg && npm run build`
   dans l'étage `builder`. `scripts/set-db-provider.mjs` ne remplace que
   `provider = "(sqlite|postgresql)"` — le bloc `generator` (`prisma-client-js`)
   n'est pas touché. Le `prisma/` copié dans l'étage `runner` provient du
   `builder`, donc porte le schéma déjà muté ; il est cohérent avec
   `migration_lock.toml` (`provider = "postgresql"`).
2. **Migration initiale.** `prisma/migrations/20260815000000_init/migration.sql`
   existe. Je l'ai **régénérée indépendamment** depuis le schéma committé et le
   `diff` est vide : elle n'est ni tronquée ni désynchronisée.
3. **Application au démarrage.** `CMD ["sh","-c","npx prisma migrate deploy && node server.js"]`,
   avec le `node_modules` complet copié dans le runner pour que le CLI `prisma`
   soit présent. Échec fort si la migration échoue.

J'ai rejoué la partie rejouable de la chaîne hors Docker : `db:pg` puis
`next build` **sans `DATABASE_URL`** → succès. C'était le seul point où le
correctif pouvait échouer silencieusement au build ; il ne le fait pas.

**Limite assumée et conforme au périmètre reporté :** `docker compose up --build`
n'a pas été exécuté (Docker absent). Le README le dit maintenant à deux endroits
au lieu de prétendre le contraire.

## C3 — engagement calculé sur le mois → **CORRIGÉ**

`getLineEngagementTotals(userId, lineIds)` (`src/services/time-entries.ts:64-87`)
fait un `groupBy(['lineId','kind'])` **sans borne de date**, scopé par `userId`,
et initialise à zéro chaque `lineId` demandé. `page.tsx:17-20` l'appelle et le
transmet ; `EngagementBar` reçoit `totals` et non plus `entries`.

**Preuve par exécution (mon test, pas le leur) :** 2 j réalisés en mars 2026 +
0,5 j prévisionnel en avril 2026 sur la même ligne → `getMonthEntries(user,'2026-04')`
renvoie 1 saisie (le mois reste mensuel, la grille n'est pas cassée) tandis que
`getLineEngagementTotals` renvoie `{realiseMinutes: 960, prevuMinutes: 240}`.
Le cumul est bien inter-mois. Un second test confirme qu'il ne fuit pas d'un
utilisateur à l'autre.

## C4 — réglages non validés → **CORRIGÉ**

La validation `zod` vit dans `updateSettings` (couche service), pas dans le
formulaire — c'est le bon endroit : tout appelant futur (route API, script de
reprise) la traverse.

**Preuve par exécution :** `updateSettings({minutesParJour: 0})` **rejette** avec
`SettingsValidationError`, et une relecture montre la valeur précédente (432)
toujours en base — la valeur aberrante n'est jamais persistée. J'ai aussi
couvert le second chemin cité par la revue, celui qui plantait en erreur non
gérée : `capaciteJours` non numérique → `Math.round(NaN*100)` = `NaN` → refusé
avec un message, pas une exception Prisma. Idem `capacityCentiemes = 0`,
`minutesParJour` non entier, mode inconnu, `workingDays: [1,2,9]`. Les valeurs
légitimes passent toujours.

Le chemin UI est cohérent : `saveSettings` capture `SettingsValidationError` et
la renvoie via `useActionState` ; `SettingsForm` affiche un bandeau rouge
listant les messages. `required` a été ajouté aux champs numériques **en plus**
de la validation serveur, pas à sa place.

## I1 — mode AVERTISSEMENT inopérant → **CORRIGÉ**

**Preuve par exécution :** en `AVERTISSEMENT`, capacité 1 j, ligne A à 1 j puis
0,5 j sur la ligne B le même jour → `saveEntry` renvoie exactement
`{ok:true, minutes:240, warning:{totalMinutes:720, capacityMinutes:480}}`, et
les **deux** saisies sont bien en base (rien n'est bloqué). En `DESACTIVE`, la
même situation renvoie `{ok:true, minutes:960}` **sans clé `warning`** — le mode
reste strictement muet, la distinction entre les trois modes est réelle.
`SaisieClient` affiche le bandeau ambre avec « La saisie est conservée. », par
opposition à « La saisie est refusée. » du mode BLOCAGE.

## I2 — totaux au mauvais diviseur → **CORRIGÉ**

`settings.minutesParJour` descend de `page.tsx:33` jusqu'à `MonthGrid` puis
`TotalsRow`, comme `capacityMinutes`. La constante `480` en dur et le repli sur
`lines[0]` ont disparu. Le test qui l'accompagne n'est pas tautologique : il
place une ligne à 432 min en première position et vérifie que le total d'une
journée pleine saisie sur l'autre ligne affiche « 1 », puis que le même jeu de
données rendu dans les deux ordres donne le même total.

## I3 — cellules non contrôlées → **CORRIGÉ**

Les cellules sont contrôlées (`value=`, plus `defaultValue=`), avec un état local
dérivé de `entries` et réinitialisé sur changement d'identité de la table de
valeurs serveur. `onSave` renvoie `Promise<boolean>` et la cellule est restaurée
sur refus. Le corollaire signalé par la revue est traité : le remplissage par
glissement passe par le même `commit`, donc peint toute la sélection.

Une garde a été ajoutée (`editing.current`) pour que le rafraîchissement serveur
d'une cellule n'efface pas la frappe en cours dans une autre — c'est-à-dire que
l'agent a identifié et couvert la régression que son propre correctif
introduisait. Test présent et non trivial.

## I4 — grille ignorant `slotId` → **CORRIGÉ** (compromis discuté plus bas)

`buildCells` **agrège** au lieu d'écraser : somme des minutes, journée lue comme
réalisée dès qu'une des saisies l'est, marqueur `hasSlots`. La cellule et la
ligne de totaux disent enfin la même chose sur la même colonne, et la troisième
saisie fantôme à créneau vide ne peut plus être créée. Voir « Compromis » §R1.

## I5 — fuites de scope utilisateur → **CORRIGÉ** (compromis discuté plus bas)

Aucun `@/db/client` sous `src/app/` (grep). `listMissionsForUser(userId)` et
`listClients(userId)` existent et sont utilisés par les deux pages.

**Preuve par exécution :** une mission dont la seule ligne est affectée à A
apparaît dans `listMissionsForUser(A)` et **pas** dans `listMissionsForUser(B)` ;
`listActiveLines(B)` ne renvoie pas la ligne. Le filtrage des lignes à
l'intérieur d'une mission partagée est réel (`lines: { where: { assignments: { some: { userId } } } }`).
Voir « Compromis » §R2.

## I6 — `saveEntry` sans vérification d'affectation → **CORRIGÉ**

`saveEntry` lit désormais l'`Assignment` par sa clé unique `(lineId, userId)` et
en tire le `missionId` du verrouillage CRA, au lieu de charger la ligne par son
seul `id`.

**Preuve par exécution :** un utilisateur existant mais non affecté obtient
`{ok:false, reason:'NON_AFFECTE'}` et **aucune ligne n'est écrite** en base. J'ai
aussi vérifié le chemin de suppression, que la revue ne mentionnait pas
explicitement mais qui court-circuitait tout contrôle : `minutes: 0` par un
utilisateur non affecté est refusé, et la saisie de l'utilisateur légitime pour
ce jour est **toujours là** (comptage en base après coup). C'était le vrai
danger : effacer la saisie d'autrui.

**Résidus non traités**, conformes au texte de la revue qui les classait comme
« même remarque, plus faible » sans les inscrire au correctif : `getOrCreateCra`
accepte toujours n'importe quel `missionId`, et `createLine` n'associe pas la
mission à l'utilisateur.

## I7 — réglages inatteignables → **CORRIGÉ**, avec réserves nommées

Le correctif prescrit par la revue (« éditeur de créneaux, deux sélecteurs de
défauts ») est livré en entier : `SettingsForm.tsx` expose les créneaux
(identifiant, libellé, plages `<input type="time">`, valeur en jours,
ajout/suppression, badge « franchit minuit » réutilisant `crossesMidnight` /
`slotDurationMinutes` de `core` au lieu de les réimplémenter), l'unité
d'affichage par défaut et la source d'engagement par défaut. Le compte passe de
3,5 / 7 à 6,5 / 7.

**Ce qui reste ouvert, et que le rapport de l'agent C présente à tort comme
« sept réglages couverts » :**
- les **jours fériés** restent en rechargement en bloc — aucune activation ou
  désactivation unitaire, aucun ajout manuel : c'est le demi-point manquant ;
- `reloadHolidays` **remplace** toujours intégralement la liste : un férié
  personnalisé serait détruit sans avertissement ;
- `toAppSettings` applique toujours `slots.length > 0 ? slots : DEFAULT_SLOTS`
  (voir §R3) ;
- `allowedSlotIds` reste du code mort — assumé et justifié comme lot 1.

## I8 — navigation absente → **CORRIGÉ**

`src/app/(app)/layout.tsx` fournit la barre Saisie · Missions · CRA · Admin
(`next/link`) et un bouton « Se déconnecter » branché sur une server action
appelant `signOut({redirectTo:'/login'})` — `signOut` est bien exporté par
`src/auth.ts:14`. `src/app/page.tsx` redirige `/` vers `/saisie`. Le build
confirme la route `○ /`. `/login` est hors du groupe `(app)`, il n'hérite donc
pas du `requireUser()` du layout — vérifié, il reste statique et accessible.

## I9 — README faux → **CORRIGÉ**

Les deux phrases fausses sont corrigées, et remplacées par des affirmations que
j'ai pu vérifier :
- l.32-34 : « le Dockerfile appelle explicitement `npm run db:pg` … avant
  `npm run build` » — exact, `Dockerfile:14` ;
- l.124 : « La suite d'intégration **ne tourne aujourd'hui que contre SQLite** …
  c'est un manque, pas un choix délibéré » — exact, et cohérent avec la section
  « État vérifié » onze lignes plus bas, qui ne se contredit plus.
- Le chiffre « 152 tests verts sur 17 fichiers » est exact sur l'arbre final
  (mesuré). Le README l'assortit lui-même d'une réserve sur sa péremption.

---

# Régressions et compromis introduits par ce commit

Rien de bloquant. Aucune contradiction entre les quatre correctifs à leurs
jointures n'a été trouvée : `tsc` est à 0 erreur, la suite complète est verte, et
les surfaces partagées (`SaveResult` étendu par B et consommé par B seul,
`ENGAGEMENT_SOURCES` exporté par C et consommé par C seul, `LineForGrid`
inchangé, `settings.ts` touché par C seul) ne se recouvrent pas. Les points
ci-dessous sont des compromis, à inscrire au backlog.

## R1 — Mineur — Une cellule à créneau **unique** devient non modifiable, sans autre surface pour la corriger

`MonthGrid.tsx:49` pose `hasSlots` dès que `e.slotId !== ''`, **y compris pour une
seule saisie**. Le libellé affiché à l'utilisateur (« la cellule agrège plusieurs
créneaux ») et le commentaire du code décrivent donc une situation plus étroite
que la condition réellement appliquée.

**Scénario :** une reprise de données ou le script d'initialisation crée une
unique saisie de 0,5 j avec `slotId = 'matin'` le 16/03. La cellule s'affiche
« 0,5 » en ambre, en lecture seule, avec un message parlant d'agrégation de
plusieurs créneaux alors qu'il n'y en a qu'un. Le consultant ne peut la corriger
**nulle part** dans le lot 0 : ni la grille, ni un écran créneaux (inexistant).
Le CRA part avec la valeur erronée jusqu'à une édition en base.

**Jugement : compromis acceptable.** L'alternative — laisser la cellule éditable —
créait une saisie fantôme à créneau vide et doublait le total du jour, c'est-à-dire
exactement le défaut I4. La lecture seule est le comportement sûr, et l'UI du lot 0
ne produit jamais de `slotId` non vide (`saveCell` n'en passe aucun,
`saveEntry` retombe sur `''`) : le cas est latent. À corriger au lot 1 avec la
vue créneaux. À faire tout de suite, en revanche : reformuler le message pour
qu'il dise « saisie par créneau », pas « agrège plusieurs créneaux ».

## R2 — Mineur — Un client ou une mission sans ligne reste visible à tous les utilisateurs

Vérifié par exécution : `listClients(B)` contient un client fraîchement créé par
A tant qu'aucune ligne n'existe. Et — point que le rapport de l'agent D ne
mentionne pas — **créer une mission sans ligne sur un client déjà revendiqué
rend ce client de nouveau visible à tout le monde** (clause 2 de `listClients`) :
un client masqué peut donc être ré-exposé.

**Jugement : compromis acceptable, et strictement moins permissif qu'avant.**
Avant ce commit, `listClients()` n'avait **aucun** scope et les deux pages
interrogeaient Prisma sans `userId` : tout était visible par construction. La
justification donnée (amorçage sur base vierge : sans les clauses 1 et 2, créer
le premier client puis la première mission devient impossible) est réelle — le
schéma ne porte aucun `userId` sur `Client` ni `Mission`, `Assignment` est le
seul lien. Seuls des **noms** fuient dans cette fenêtre : `listMissionsForUser`
ne renvoie que les lignes affectées à l'appelant, donc ni jours vendus ni TJM.
Et la ré-exposition décrite exige de connaître un `clientId` déjà visible, elle
ne permet pas de découvrir un client masqué. Aucune fuite au lot 0
(mono-consultant). **Dette à lever au premier lot multi-consultants** par un
`createdByUserId` sur `Client`/`Mission`, comme l'agent D le recommande.

## R3 — Mineur — Nouveau chemin utilisateur vers un état non persistable : supprimer tous les créneaux

`toAppSettings` (`settings.ts:160`) applique toujours
`slots.length > 0 ? slots : DEFAULT_SLOTS`. Ce défaut préexistait, mais il était
jusqu'ici inatteignable faute d'éditeur. Le nouvel éditeur le rend atteignable
en trois clics.

**Scénario :** l'administrateur retire les trois créneaux, enregistre, lit
« Réglages enregistrés. » (message de succès, la validation passe : `[]` est un
tableau valide), recharge la page — et les trois créneaux par défaut sont
revenus. Aucun message n'explique pourquoi. Le retrait **partiel** fonctionne,
lui, correctement : seul le cas « liste vide » régresse.

## R4 — Mineur — La fonctionnalité « multi-consultants additif » se referme sur les missions déjà revendiquées

`listMissionsForUser` alimente aussi le sélecteur « Nouvelle ligne » de l'écran
Missions. Une mission dont toutes les lignes appartiennent à un autre consultant
étant désormais invisible, un second consultant ne pourra jamais s'ajouter une
ligne sur une mission existante depuis l'UI. Sans effet au lot 0, mais c'est
précisément la manœuvre que le lot multi-consultants devra permettre. À traiter
avec R2.

## R5 — Mineur — `step="0.5"` sur le seuil de capacité

`SettingsForm.tsx:167` pose `step="0.5"` sur `capaciteJours`. Un
`capacityCentiemes` qui ne serait pas un multiple de 50 (posé par script ou
reprise, la validation serveur l'autorise) rend le formulaire **entier**
non soumettable tant que l'administrateur n'a pas modifié ce champ, sans que le
lien de cause à effet soit visible.

---

# Points sciemment reportés — non recomptés

Conformes à la consigne, non traités et non comptés comme régressions :
3 vulnérabilités npm transitives, warning `jose`/Edge Runtime, `?callbackUrl`,
absence de test sur `middleware.ts`, Docker et Postgres jamais exécutés.

Restent par ailleurs ouverts les Mineurs M1 à M12 de la revue initiale, non
inclus dans ce périmètre de correction. À noter que **M1 n'a pas été traité** :
les tests tautologiques de `src/core/capacity/check.test.ts` (l.17-20 et l.37-41)
sont inchangés. Ils ne nuisent pas, mais la revue les désignait comme la cause
racine de C1 et I1 non détectés — l'ajout des 31 tests réels de ce commit couvre
le fond du problème, pas le décor qui subsiste.

---

# Verdict

**La branche est fusionnable.**

Les 4 Critiques et les 9 Importants sont corrigés. Les cinq points vérifiables
par exécution — C1, C3, C4, I5, I6 — l'ont été avec des tests écrits
indépendamment de ceux des agents correcteurs, et se comportent comme annoncé.
Aucun test existant n'a été supprimé ni affaibli ; les 31 tests ajoutés ne sont
pas tautologiques (ils fixent des valeurs attendues précises et le comportement
opposé, notamment l'absence de `warning` en `DESACTIVE`). Les garde-fous produit
de la spec tiennent après correctifs : deux demi-journées chez deux lignes le
même jour restent acceptées en BLOCAGE, samedis et jours fériés restent
saisissables, aucune conversion prévisionnel → réalisé automatique, aucun calcul
de montant, `src/core/` pur, entiers partout.

Les cinq compromis relevés sont mineurs, tous sans effet au lot 0
mono-consultant, et tous strictement meilleurs que l'état d'avant le commit. Les
seules actions recommandées avant mise en service — et non avant fusion — sont
un `docker compose up --build` réel, et la reformulation du message de la cellule
à créneau (R1).
