# Revue finale — branche `lot-0` (ebc4f42..b9e36da)

Date : 2026-08-15 · Périmètre : 9 commits, 68 fichiers.

## Vérifications exécutées

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | 0 erreur |
| `npx vitest run` | 101 tests / 15 fichiers, verts |
| `npx next build` | aboutit |
| `src/core/` sans `@prisma/client` / `next` / `react` | **conforme** (vérifié par grep, y compris les imports de type) |
| Aucun enum Prisma | **conforme** — `String` + unions dans `src/core/types.ts` |
| Aucun `Decimal`, aucun flottant persisté | **conforme** — tous les champs numériques sont `Int` |
| Aucun tableau Prisma, JSON en bloc | **conforme** — `slotsJson` / `holidaysJson` lus et écrits entiers |
| `next.config.ts` → `output: 'standalone'` | **conforme** |
| L'application ne facture jamais | **conforme** — aucun calcul de montant ; `tjmCents` n'est jamais multiplié |
| Contrôle de capacité sur le total du jour, pas l'exclusivité | **conforme** (`saveEntry` somme toutes lignes) |
| Correction ne comptant pas double | **conforme** (`time-entries.ts:111-113`) |
| Week-ends / fériés grisés mais saisissables | **conforme** — aucun blocage, seulement des classes CSS |
| Conversion prévisionnel → réalisé jamais automatique | **conforme** — aucune bascule automatique n'existe |
| CRA `VALIDE` verrouille le mois | **conforme** (`time-entries.ts:94-96`, testé de bout en bout) |
| `slotId` non nullable, `""` = journée entière | **conforme** (`schema.prisma:100`) |
| `.env`, `*.db` non versionnés | **conforme** |

Le socle de contraintes tient. Les défauts ci-dessous sont ailleurs.

> Note : `.next/` a été supprimé au cours de la revue (build de vérification). Relancer `npm run build` avant tout usage. L'arbre git est propre, aucune modification laissée.

---

# À BLOQUER AVANT FUSION

## C1 — Aucune feuille de style n'est produite : l'application est livrée sans aucun style

**Fichier :** racine du projet — `postcss.config.mjs` **absent**
**Gravité : Critique**

`src/app/globals.css` contient `@import "tailwindcss"` et `@tailwindcss/postcss` est bien en `devDependencies` (package.json:32), mais **aucun fichier de configuration PostCSS n'existe**. Next n'active donc jamais le plugin Tailwind : il se contente d'inliner le CSS du paquet, directive `@tailwind utilities` comprise, sans jamais la traiter.

**Scénario de défaillance (reproduit, pas déduit) :**

```
npx next build          →  succès, 8 routes
.next/static/*.css      →  21 298 octets
  contenu : @layer utilities{@tailwind utilities}   ← directive brute, non compilée
  grep '\.text-red-600' →  0 occurrence
  grep '^\.'            →  0 règle de classe, sur tout le fichier
```

Résultat : les ~200 `className` de l'application (`rounded`, `bg-slate-900`, `text-red-600`, `overflow-x-auto`, `sticky left-0`…) ne correspondent à aucune règle. La grille mensuelle n'a ni colonnes fixes, ni défilement horizontal, ni signalement rouge du dépassement de capacité ; les boutons sont des boutons nus. **Toute l'UI du lot 0 est livrée en HTML brut.**

**Correctif vérifié :** créer `postcss.config.mjs` à la racine :

```js
const config = { plugins: { '@tailwindcss/postcss': {} } }
export default config
```

Après ajout et `rm -rf .next && npx next build` : CSS = 11 723 octets, `.text-red-600`, `.bg-slate-900`, `.overflow-x-auto` présents. Correctif confirmé empiriquement.

**Pourquoi personne ne l'a vu :** `next build` ne signale rien, et le seul test qui touche au visuel (`MonthGrid.test.tsx:82`) assère `total.className).toContain('text-red-600')` — c'est-à-dire la chaîne de l'attribut, jamais le style calculé. Le test est vert sur une application sans CSS. Voir M2.

---

## C2 — Le déploiement Docker/Postgres ne peut pas fonctionner : client Prisma SQLite contre URL Postgres

**Fichiers :** `Dockerfile:10`, `prisma/schema.prisma:6`, `docker-compose.yml:21`, `README.md:32-34`
**Gravité : Critique**

`prisma/schema.prisma` est committé avec `provider = "sqlite"` (décision assumée du journal). Le Dockerfile fait :

```dockerfile
RUN npx prisma generate && npm run build      # Dockerfile:10
```

sans jamais basculer le provider. Le client généré dans l'image cible donc SQLite. `docker-compose.yml:21` injecte pourtant `DATABASE_URL: postgresql://cra:cra@db:5432/cra`.

**Scénario de défaillance (reproduit) :** avec le client actuellement généré dans ce dépôt et une URL Postgres :

```
PrismaClientInitializationError: error: Error validating datasource `db`:
the URL must start with the protocol `file:`  -->  schema.prisma:7
```

Toute requête échoue au démarrage. Le chemin « VPS / serveur » du README — cible principale du lot — est inopérant tel que livré.

Trois défauts se cumulent sur la même chaîne :

1. **Le Dockerfile ne bascule pas le provider.** `README.md:32-34` affirme pourtant : « Le Dockerfile appelle `npx prisma generate` **après avoir basculé implicitement en Postgres via `db:pg`** ». C'est faux, la ligne n'existe pas. Documentation qui décrit un comportement absent.
2. **Aucune migration n'existe** (`prisma/migrations/` absent). Même provider corrigé, `prisma migrate deploy` échoue et le schéma n'est jamais créé. Le README le documente (l.49-60) mais renvoie la génération à l'exploitant, contre un Postgres qu'il faut avoir sous la main — ce n'est pas un déploiement, c'est un chantier.
3. **Aucune migration SQLite non plus.** Le mode local repose sur `prisma db push`, qui n'a pas de chemin d'évolution : au lot 1, toute modification de schéma sur une base existante se fera sans historique.

**Correctif :** dans le Dockerfile, `RUN node scripts/set-db-provider.mjs postgresql && npx prisma generate && npm run build` ; générer et committer `prisma/migrations/` (initiale) ; ajouter `npx prisma migrate deploy` au démarrage du conteneur ou le documenter comme étape obligatoire ; corriger `README.md:32-34`.

Le journal reporte « Docker jamais exécuté / Postgres jamais validé » comme un point mineur d'environnement. Ce n'est pas le cas : le défaut est lisible dans le code, sans Docker ni Postgres, et il rend la cible inutilisable. **Il doit bloquer.**

---

## C3 — Le bandeau d'engagement calcule sur un seul mois un engagement pluri-mensuel

**Fichiers :** `src/components/grid/EngagementBar.tsx:14-18`, `src/app/(app)/saisie/[month]/page.tsx:15,21-27`
**Gravité : Critique**

`EngagementBar` reçoit `entries` = `getMonthEntries(user.id, month)` — les saisies **du mois affiché uniquement** — et les compare à `line.soldCentiemes`, qui est le **total contractuel de la ligne, tous mois confondus**. Les deux termes ne sont pas dans le même référentiel.

**Scénario de défaillance :**

```
Ligne « Consultant ITSM » : 30 j vendus.
Mars 2026 : 18 j réalisés saisis.
Avril 2026 : aucune saisie pour l'instant.

Ouverture de /saisie/2026-04 :
  bandeau affiché → « 30 vendus · 0 réalisés · 0 prévus · 30 restants »
  attendu (spec §6) → « 30 vendus · 18 réalisés · 0 prévus · 12 restants »
```

Le consultant lit un reste à consommer de 30 jours là où il lui en reste 12. Le dépassement (`depassementCentiemes`) est symétriquement indétectable tant qu'il n'est pas atteint en un seul mois. C'est la fonctionnalité que la spec désigne comme différenciante (§6 : « La fonctionnalité différenciante doit être sous les yeux pendant la saisie ») ; elle donne un résultat faux dès le deuxième mois d'une mission.

`computeEngagement` (core) est correct — le défaut est dans le raccordement. Il vient du plan lui-même (`plan:2670` déclare `<EngagementBar line entries={MonthEntry[]} />`), donc aucun agent ne l'a introduit : personne ne l'a rattrapé.

**Correctif :** ajouter un service `getLineEngagement(userId, lineId)` qui agrège les `TimeEntry` de la ligne **sans borne de mois** (`groupBy` sur `kind`, `sum` sur `minutes`), et passer ce résumé au bandeau. Conserver `entries` du mois pour la grille et les totaux, qui eux sont bien mensuels.

---

## C4 — Le formulaire d'administration permet de fixer `minutesParJour = 0`, ce qui détruit silencieusement toute saisie

**Fichiers :** `src/app/(app)/admin/saisie/actions.ts:11-19`, `src/app/(app)/admin/saisie/page.tsx:27-43`
**Gravité : Critique**

`saveSettings` ne valide rien. `zod` est en dépendance directe et n'est utilisé nulle part dans les server actions.

```ts
const heures = Number(formData.get('heures'))        // '' → 0, absent → 0
const minutesSup = Number(formData.get('minutes'))
await updateSettings({ minutesParJour: heures * 60 + minutesSup, ... })
```

Le champ `heures` porte `min={1}` mais **pas `required`** : un champ vidé est valide côté navigateur et arrive en chaîne vide.

**Scénario de défaillance :**

```
1. Admin → Saisie, l'utilisateur efface le champ « heures » et enregistre.
2. Settings.minutesParJour = 0, persisté sans erreur.
3. Retour sur la grille, il tape « 1 » dans une cellule :
     parseQuantity('1', 'JOUR', 0)  →  Math.round(1 * 0)  =  0
     saveEntry(minutes: 0)          →  deleteMany         →  la saisie est SUPPRIMÉE
   L'action renvoie { ok: true, minutes: 0 } : aucun message d'erreur.
4. Toutes les cellules déjà remplies s'effacent au premier réenregistrement.
5. En mode BLOCAGE, capacityMinutes = centiemesToMinutes(100, 0) = 0 :
   toute saisie non nulle dépasse et est refusée.
```

Perte de données silencieuse déclenchée par un geste banal d'administration, sans confirmation ni message.

Le même chemin plante sur `capaciteJours` : champ vidé → `Math.round(NaN * 100)` = `NaN` → Prisma rejette l'`Int` → server action en erreur non gérée.

**Correctif :** valider avec `zod` dans `saveSettings` (`minutesParJour` entier ≥ 60 et ≤ 1440, `capacityCentiemes` entier ≥ 1, `capacityMode` dans `CAPACITY_MODES`, `workingDays` ⊂ 1..7), retourner un message d'erreur exploitable, et poser une garde en profondeur dans `updateSettings`. Ajouter `required` aux deux champs numériques.

---

# IMPORTANT — à corriger, ne bloque pas nécessairement la fusion

## I1 — Le mode `AVERTISSEMENT` est strictement équivalent à `DESACTIVE` : aucun avertissement n'atteint jamais l'utilisateur

**Fichiers :** `src/services/time-entries.ts:115-129`, `src/core/capacity/check.ts:20`, `src/app/(app)/saisie/[month]/SaisieClient.tsx:25-37`
**Gravité : Important**

`checkCapacity` produit bien `severity: 'warn'`. `saveEntry` ne teste que `severity === 'block'` ; dans tous les autres cas il enregistre et renvoie `{ ok: true, minutes }`. Le type `SaveResult` n'a **aucune variante porteuse d'un avertissement**, et `SaisieClient` n'affiche un bandeau que sur `!r.ok`.

**Scénario de défaillance :**

```
Settings : capacityMode = AVERTISSEMENT, capacité = 1 j (480 min).
12/03 : ligne A = 1 j déjà saisie.
L'utilisateur saisit 0,5 j sur la ligne B, même jour.
  → saveEntry : verdict warn, total 720 > 480
  → retour { ok: true, minutes: 240 }, aucun message
  → comportement identique, octet pour octet, au mode DESACTIVE
```

La spec §4 exige : « En `AVERTISSEMENT`, il est signalé mais l'utilisateur passe outre. » Le signalement n'existe pas. Sur trois modes configurables en administration, deux produisent le même comportement — l'un des trois réglages est décoratif.

**Correctif :** étendre `SaveResult` en `{ ok: true; minutes: number; warning?: { totalMinutes: number; capacityMinutes: number } }`, remplir `warning` quand `verdict.severity === 'warn'`, et afficher le bandeau ambre existant dans `SaisieClient` sur cette variante.

**Le test ne protège rien** — voir M2.

---

## I2 — La ligne de totaux convertit les minutes en jours avec le `minutesParJour` de la première ligne

**Fichier :** `src/components/grid/MonthGrid.tsx:25`
**Gravité : Important**

```ts
const minutesParJour = lines[0]?.minutesParJour ?? 480
```

Ce diviseur est passé à `TotalsRow` pour formater un total **qui agrège toutes les lignes**. Il n'y a aucune raison que la première ligne de la grille porte le référentiel commun ; le référentiel commun est `Settings.minutesParJour`, celui-là même qui sert à calculer `capacityMinutes` (`page.tsx:26`). Les deux moitiés de la même ligne de totaux — la valeur affichée et le seuil de dépassement — utilisent donc deux diviseurs différents.

**Scénario de défaillance :**

```
Settings.minutesParJour = 480 (8 h) ; capacité = 1 j → capacityMinutes = 480.
Ligne A (position 0) : minutesParJour surchargé à 432 (7 h 12).
Ligne B : hérite, 480.

12/03 : 1 journée pleine saisie sur la ligne B → 480 minutes.
  Total affiché : formatQuantity(480, 'JOUR', 432) = « 1,11 »
  Attendu       : « 1 »
  Le seuil, lui, reste 480 : pas de rouge. L'utilisateur lit 1,11 j sans alerte.

Et si les lignes sont créées dans l'ordre inverse, la même donnée s'affiche « 1 ».
Le total dépend de l'ordre d'affichage des lignes.
```

Le repli `?? 480` masque en plus le cas « aucune ligne » avec une constante en dur qui duplique la valeur par défaut du schéma.

**Correctif :** passer `settings.minutesParJour` depuis `page.tsx` jusqu'à `MonthGrid`/`TotalsRow`, comme c'est déjà fait pour `capacityMinutes`. Supprimer la constante 480 en dur.

---

## I3 — Une saisie refusée reste affichée dans la cellule comme si elle était enregistrée

**Fichier :** `src/components/grid/MonthGrid.tsx:79-82`
**Gravité : Important**

Les cellules sont des inputs non contrôlés (`defaultValue={value}`). Une fois que l'utilisateur a tapé dedans, l'input est « dirty » : un nouveau rendu venant de `revalidatePath` ne remet plus la valeur serveur dans le DOM.

**Scénario de défaillance :**

```
Settings : capacityMode = BLOCAGE, capacité 1 j.
12/03 : ligne A = 1 j.
L'utilisateur tape « 0,5 » sur la ligne B au 12/03, puis quitte la cellule.
  → saveEntry refuse : { ok: false, reason: 'CAPACITE' }
  → un bandeau ambre s'affiche…
  → mais la cellule continue d'afficher « 0,5 », indéfiniment.
  La ligne de totaux affiche toujours « 1 » : grille et totaux se contredisent.
  Après navigation ailleurs et retour, le 0,5 a disparu — l'utilisateur croit
  avoir perdu une saisie qui n'a jamais existé.
```

Même symptôme sur `VERROUILLE` (CRA validé) et `SAISIE_INVALIDE`.

Corollaire du même défaut : après un remplissage par glissement (`applyToSelection`, l.84-88), seule la cellule où l'utilisateur a tapé affiche la valeur ; les autres cellules de la sélection ne se mettent à jour qu'au rechargement complet de la page. Le geste vendu comme « non négociable » par la spec §6 n'a pas de retour visuel.

**Correctif :** passer les cellules en inputs contrôlés avec un état local dérivé de `entries` (via `useOptimistic` ou un `useState` réinitialisé sur changement de `entries`), et restaurer la valeur serveur quand l'action renvoie `!ok`.

---

## I4 — La grille indexe les saisies sur `(ligne, date)` en ignorant `slotId`, alors que le schéma les distingue

**Fichier :** `src/components/grid/MonthGrid.tsx:24,67`
**Gravité : Important**

```ts
const byKey = new Map(entries.map((e) => [`${e.lineId}|${e.date}`, e]))
```

La clé d'unicité de `TimeEntry` est `(lineId, userId, date, slotId)` (`schema.prisma:107`) — le schéma, le service et le test `schema.test.ts:53` garantissent tous trois que deux créneaux peuvent coexister le même jour sur la même ligne. La grille, elle, suppose une saisie par jour et par ligne. `Map` conservant la dernière valeur, la première est purement perdue à l'affichage.

**Scénario de défaillance :**

```
2026-03-14, ligne A : matin 0,5 j (slotId 'matin') + après-midi 0,5 j (slotId 'apres-midi').
  Cellule affichée : « 0,5 » (seule la seconde), au lieu de « 1 ».
  Ligne de totaux  : « 1 » — dailyTotals somme bien les deux.
  Grille et totaux se contredisent sur la même colonne.

L'utilisateur corrige la cellule à « 1 » :
  saveCell → saveEntry sans slotId → slotId = ''
  → une TROISIÈME ligne est créée (clé unique différente)
  → le jour totalise 2 j au lieu de 1. Le contrôle de capacité se déclenche
    sur une journée que l'utilisateur croit avoir remise à 1.
```

Le lot 0 ne produit pas de saisie créneau par l'UI, ce qui rend le cas latent — mais `DEFAULT_SLOTS` est préchargé, `allowedSlotIds` est stocké, `MonthEntry.slotId` est exposé, et les données peuvent venir du script ou d'une reprise. Les deux moitiés du code (schéma/service *vs* grille) supposent des choses différentes sur la cardinalité : c'est exactement la classe de défaut que la production parallèle génère.

**Correctif :** agréger explicitement — `byKey` doit sommer les minutes de toutes les saisies d'un couple `(ligne, date)`, et le fait qu'une cellule agrège plusieurs créneaux doit soit être signalé, soit rendre la cellule non éditable directement. À défaut, documenter dans `MonthGrid` que le lot 0 impose `slotId === ''` et faire échouer explicitement les autres.

---

## I5 — Les écrans Missions et CRA interrogent Prisma directement, sans scope utilisateur, en contournant la couche service

**Fichiers :** `src/app/(app)/missions/page.tsx:9-13`, `src/app/(app)/cra/page.tsx:26-30`, `src/services/clients.ts:8-13`
**Gravité : Important**

La contrainte du projet est explicite : *« Toute fonction de service prend un `userId` et scope ses requêtes dessus — c'est la provision qui doit rendre le multi-consultants additif plus tard. »*

Trois écarts :

1. `missions/page.tsx:9` appelle `prisma.mission.findMany({ where: { archived: false } })` **depuis le composant de page**, sans passer par un service et sans aucun `userId`.
2. `cra/page.tsx:26` fait exactement la même requête, dupliquée à l'identique, avec le même défaut.
3. `listClients()` (`clients.ts:8`) ne prend **aucun** `userId` en paramètre, contrairement à toutes les autres fonctions de service.

**Scénario de défaillance (au lot où le multi-consultants arrive) :** deux consultants sur la même instance. Le consultant B ouvre `/missions` : il voit toutes les missions du consultant A, tous clients confondus, et peut créer une ligne de prestation sur n'importe laquelle. Il ouvre `/cra` : le sélecteur « Ouvrir un CRA » lui propose les missions de A, et `openCra` (`cra/actions.ts:8-12`) crée sans contrôle un CRA sur une mission où il n'a aucune affectation.

Le lot 0 étant mono-consultant, il n'y a pas de fuite aujourd'hui. Mais la provision est précisément ce qui est censé rendre l'ajout additif — et elle est déjà percée en trois endroits, dont deux qui court-circuitent la couche service prévue pour la porter. Le retrofit sera à faire, ce que la spec §3 désigne comme « coûteux et diffus ».

**Correctif :** créer `listMissionsForUser(userId)` dans `src/services/missions.ts` (jointure via `Assignment` comme le fait déjà `listActiveLines`), l'utiliser dans les deux pages, supprimer les accès Prisma directs depuis `src/app/`, et ajouter `userId` à `listClients`. Envisager une règle de lint interdisant l'import de `@/db/client` sous `src/app/`.

---

## I6 — `saveEntry` n'exige aucune affectation de l'utilisateur sur la ligne

**Fichier :** `src/services/time-entries.ts:78-81`
**Gravité : Important**

Le service charge la ligne par `findUniqueOrThrow({ where: { id: args.lineId } })` — sans jointure sur `Assignment`, donc sans vérifier que `args.userId` a le droit d'y saisir. Le contrôle existe uniquement dans le server action (`saisie/[month]/actions.ts:19-20`, via `listActiveLines`), c'est-à-dire dans la couche qui est censée être remplaçable.

**Scénario de défaillance :** au lot 1, la surface mobile ou une route API appelle `saveEntry` sans reproduire ce filtre : un consultant peut alors imputer du temps sur la ligne d'engagement d'un autre. Les `TimeEntry` créées portent son `userId`, elles n'apparaîtront donc dans aucun `listActiveLines` mais compteront dans le calcul d'engagement de la ligne (C3, une fois corrigé) — le compteur de jours vendus d'une mission dérive sans qu'aucun écran ne montre d'où.

Même remarque, plus faible, sur `getOrCreateCra` (`cra.ts:49`) qui accepte n'importe quel `missionId`, et sur `createLine` (`missions.ts:26`) qui n'associe pas la mission à l'utilisateur.

**Correctif :** dans `saveEntry`, remplacer par une lecture via `Assignment` — `prisma.assignment.findUnique({ where: { lineId_userId: { lineId, userId } }, include: { line: { select: { missionId: true } } } })` — et renvoyer un `{ ok: false, reason: 'NON_AFFECTE' }` explicite. La contrainte du projet est que le scope vive dans le service, pas au-dessus.

---

## I7 — L'écran Admin → Saisie ne couvre que la moitié des réglages exigés par la spec

**Fichiers :** `src/app/(app)/admin/saisie/page.tsx`, `src/services/settings.ts:12-22`
**Gravité : Important**

La spec §6 « Écran Admin → Saisie » liste sept réglages. Le formulaire livré en expose trois et demi :

| Réglage (spec §6) | État |
|---|---|
| jours ouvrés | présent |
| `heuresParJour` | présent |
| mode de contrôle de capacité et seuil | présent |
| jours fériés (« préchargé, **activable** ») | rechargement en bloc uniquement, aucune activation/désactivation unitaire, aucun ajout manuel |
| **créneaux (libellé, plage, valeur)** | **absent** |
| **unité par défaut des nouvelles lignes** | **absent** |
| **source d'engagement par défaut** | **absent** |

`AppSettings` porte pourtant `slots`, `defaultDisplayUnit` et `defaultEngagementSource`, `updateSettings` sait les écrire, et `createLine` consomme les deux derniers (`missions.ts:44-46`). Trois réglages persistés, lus, utilisés par le métier — et non atteignables. `DEFAULT_SLOTS` ne peut jamais être modifié par l'utilisateur.

**Scénario de défaillance :** un client compte la journée en 7 h 12 et travaille de nuit. L'administrateur ne peut ni ajuster le créneau Nuit, ni définir `HEURE` comme unité par défaut : il doit éditer la base à la main ou recréer chaque ligne avec le paramètre explicite.

Effets de bord constatés dans le même périmètre :
- `reloadHolidays` (`admin/saisie/actions.ts:24-28`) **remplace** intégralement la liste — tout férié personnalisé serait détruit sans avertissement.
- `toAppSettings` (`settings.ts:40`) applique `slots.length > 0 ? slots : DEFAULT_SLOTS` : une liste de créneaux volontairement vide est **impossible à persister**, la lecture réintroduit toujours les défauts. État inatteignable.
- `allowedSlotIds` est stocké, relu et exposé dans `LineForGrid` (`missions.ts:76`) mais **n'est lu par aucun code** : la règle spec §4 « saisir une nuit sur la ligne de jour déclenche un signalement » n'existe pas. `slotInterval` et `crossesMidnight` ne sont appelés que par leurs propres tests.

**Correctif :** compléter le formulaire (éditeur de créneaux, deux sélecteurs de défauts) ou déclarer explicitement ces réglages hors lot 0 dans le README, en retirant du même coup les champs morts pour ne pas laisser croire qu'ils agissent.

---

## I8 — L'application n'est navigable qu'en tapant les URLs : aucun menu, aucune déconnexion, racine en 404

**Fichiers :** `src/app/layout.tsx`, absence de `src/app/(app)/layout.tsx` et de `src/app/page.tsx`
**Gravité : Important**

Il n'existe aucun `Link` ni aucun appel à `signOut` dans tout `src/` (vérifié par grep). Le groupe de routes `(app)` n'a pas de layout : les quatre écrans (`/saisie`, `/missions`, `/cra`, `/admin/saisie`) ne se référencent jamais l'un l'autre. Et aucun `src/app/page.tsx` n'existe.

**Scénario de défaillance :**

```
L'utilisateur se connecte → redirigé vers /saisie/2026-08 : la grille est vide,
aucune ligne de prestation n'existe encore.
Aucun lien vers /missions n'est affiché nulle part.
Il revient à la racine http://localhost:3000/ → 404 (route inexistante,
le middleware l'a laissée passer puisqu'il est authentifié).
Il ne peut pas se déconnecter : aucun bouton, aucune route exposée côté UI.
```

Un lot 0 qui « rend déjà autonome sur la production du CRA » (spec §9) n'est pas utilisable si le premier écran est une impasse.

**Correctif :** ajouter `src/app/(app)/layout.tsx` avec une barre de navigation (Saisie · Missions · CRA · Admin) et un bouton de déconnexion appelant `signOut`, plus un `src/app/page.tsx` qui redirige vers `/saisie`.

---

## I9 — Le README affirme deux choses fausses sur l'état vérifié du lot

**Fichier :** `README.md:32-34` et `README.md:124`
**Gravité : Important**

1. **l.32-34** — « Le Dockerfile appelle `npx prisma generate` après avoir basculé implicitement en Postgres via `db:pg` ». Faux, voir C2. C'est la phrase qui fait passer pour intentionnel le défaut le plus grave du déploiement.
2. **l.124** — « La suite d'intégration tourne contre les deux moteurs. » Faux : `vitest.config.ts` n'a qu'une configuration, les tests d'intégration tapent la base SQLite de développement, et rien n'exécute la suite contre Postgres. Le même fichier se contredit onze lignes plus bas (l.134 : « Postgres : **jamais validé empiriquement** »). La spec §10 en fait une exigence de non-régression de la portabilité : *« C'est le seul moyen de garantir que la portabilité ne se dégrade pas silencieusement au fil des migrations. »*

**Correctif :** corriger les deux phrases ; la seconde en indiquant explicitement que la double exécution SQLite/Postgres reste à mettre en place, avec sa place dans le backlog.

---

# MINEUR — peut attendre

## M1 — Tests qui passeraient sur une implémentation fausse

**Gravité : Mineur** (mais c'est la cause de C1 et I1 non détectés)

- `src/core/capacity/check.test.ts:17-20` — « autorise deux demi-journées sur deux lignes différentes » : `checkCapacity` n'a aucune notion de ligne, ses arguments sont `existingMinutes`/`addedMinutes`. Le test est un doublon exact du précédent (l.12-15, mêmes valeurs, mode différent) et n'exerce pas la règle qu'il prétend garantir. La règle réelle — le total agrège toutes les lignes — n'est testée qu'au niveau service (`time-entries.test.ts:45`), ce qui est correct ; le test core est du décor.
- `src/core/capacity/check.test.ts:37-41` — « applique la même règle un dimanche qu'un mardi » : le commentaire admet que la fonction ne connaît pas la date. Le test asserte `ok === false` sur `480 + 1 > 480`. Il ne peut pas échouer si la règle du dimanche est cassée, puisqu'aucune date n'y entre.
- `src/services/time-entries.test.ts:57-63` — « laisse passer le dépassement en mode AVERTISSEMENT » n'assère que `r.ok === true` et le nombre de lignes. Il est **vert sur une implémentation qui ignore complètement le mode `AVERTISSEMENT`** — ce qui est précisément l'état du code (I1). C'est le test qui aurait dû attraper l'absence d'avertissement ; il valide l'absence.
- `src/components/grid/MonthGrid.test.tsx:78-83` — assère `className.toContain('text-red-600')`. Il vérifie une chaîne d'attribut, jamais un style. Vert sur une application totalement dépourvue de CSS (C1).
- `src/components/grid/MonthGrid.test.tsx:85-89` — assère `textContent` contient `'30'` et `'29'`. `'30'` apparaît dans « 30 vendus » quel que soit le calcul ; l'assertion ne distingue pas un bandeau juste d'un bandeau faux (C3 en est la démonstration : le test reste vert).
- `src/auth.test.ts` porte le nom du module d'authentification mais ne teste que `auth-password.ts`. Le callback `authorize`, les callbacks `jwt`/`session` et `middleware.ts` ne sont couverts par aucun test — le journal le note déjà pour le middleware.

Non couverts et faciles : `parseQuantity('7h70')` (rejet des minutes > 59), `parseQuantity('1e3')`, `saveEntry` avec un `slotId` non vide, la capacité au franchissement exact du seuil côté service, `buildMonthDays` sur un mois de décembre (bascule d'année).

## M2 — `DEMI_JOUR` n'a aucun comportement propre
`src/core/time/units.ts:29` — `formatQuantity` traite `DEMI_JOUR` exactement comme `JOUR`, et `parseQuantity` idem. Le test `units.test.ts:47-49` fige cette équivalence (« formate en demi-journées comme en jours »). Sur trois unités d'affichage offertes à l'utilisateur dans `missions/page.tsx:78`, deux sont indiscernables. Soit implémenter un rendu propre (0,5 / 1), soit retirer la variante.

## M3 — Logique dupliquée entre modules écrits séparément
- `monthStartOf` (`time-entries.ts:54-56`) et `monthStart` (`cra.ts:45-47`) : deux fonctions identiques, deux noms, deux fichiers. Elles doivent rester d'accord — c'est ce qui fait tenir le verrouillage du CRA.
- `centiemesToMinutes(settings.capacityCentiemes, settings.minutesParJour)` est écrit deux fois (`saisie/[month]/page.tsx:26`, `time-entries.ts:118`). Une divergence future désaccorde silencieusement le seuil affiché et le seuil appliqué.
- Le mois courant est calculé de deux façons : `getUTCFullYear()/getUTCMonth()` (`saisie/page.tsx:5`) et `toISOString().slice(0,7)` (`cra/page.tsx:23`).
- La requête « missions non archivées avec client » est dupliquée mot pour mot dans `missions/page.tsx:9` et `cra/page.tsx:26`.

À regrouper dans `src/core/month/build.ts` (helpers de mois) et `src/services/` (requêtes).

## M4 — `soldCentiemes` existe en deux exemplaires sans synchronisation
`MissionLine.soldCentiemes` et `Assignment.soldCentiemes` sont initialisés à la même valeur par `createLine` (`missions.ts:41,53`). `listActiveLines` renvoie celui de l'**affectation** (l.75) tandis que `missions/page.tsx:54` affiche celui de la **ligne**. Aucun chemin ne les resynchronise. Dès qu'une édition de ligne sera ajoutée, l'écran Missions et le bandeau d'engagement afficheront deux jours vendus différents pour la même ligne.

## M5 — `getSettings()` écrit à chaque lecture
`settings.ts:48-52` utilise `upsert` pour lire. Chaque rendu de page déclenche une écriture (jusqu'à trois par requête sur `/saisie/[month]` : page, `listActiveLines`, `saveEntry`). Deux requêtes concurrentes sur une base vierge peuvent se percuter sur la clé primaire. Préférer `findUnique` puis `create` uniquement si absent, ou semer le singleton à l'initialisation.

## M6 — `kind` déterminé côté client, en UTC, avec « aujourd'hui » classé prévisionnel
`SaisieClient.tsx:21` : `date >= new Date().toISOString().slice(0,10) ? 'PREVISIONNEL' : 'REALISE'`.
Deux effets : (a) la journée en cours est classée **prévisionnelle** alors que la spec §6 oppose « le futur » au « passé » ; (b) le repère est l'UTC — à Paris, entre 00 h 00 et 02 h 00 en été, `toISOString()` renvoie encore la veille, et une saisie sur la veille est classée prévisionnelle. Le champ est modifiable ensuite, donc l'impact est faible, mais la décision devrait être prise côté serveur dans un fuseau explicite.

## M7 — Sauvegarde déclenchée à chaque perte de focus, même sans modification
`MonthGrid.tsx:82` — `onBlur` appelle `onSave` inconditionnellement. Parcourir une ligne au clavier déclenche 31 server actions, dont 31 `getSettings()` (donc 31 écritures, cf. M5) et 31 `deleteMany` sur les cellules vides. Sur un mois verrouillé, chaque tabulation affiche le bandeau « CRA validé ». Comparer à la valeur initiale avant d'appeler.

## M8 — Formats français incohérents entre composants
`EngagementBar.tsx:31-35` affiche `e.venduCentiemes / 100` via la conversion JS par défaut : « 29.5 » avec un point. `formatQuantity` produit « 29,5 » avec une virgule. Les deux nombres se côtoient dans la même vue. Réutiliser `formatQuantity` ou un formateur commun.

## M9 — Commentaire de configuration périmé et dépendance morte
`vitest.config.ts:17-21` conseille d'ajouter `// @vitest-environment jsdom` en tête des tests de composants, alors que les 15 premières lignes du même commentaire expliquent que jsdom est inutilisable ici et que les deux fichiers concernés utilisent `happy-dom`. Un contributeur qui suit le conseil casse la suite. `jsdom` reste par ailleurs en `devDependencies` (package.json:39) sans usage.

## M10 — Sélection par glissement : relâchement hors grille
`useDragSelect.ts:45-47` — `onMouseUp` n'est câblé que sur les cellules (`MonthGrid.tsx:74`). Relâcher le bouton hors du tableau laisse `dragging: true` : le survol ultérieur d'une cellule de la même ligne continue d'étendre la sélection sans bouton enfoncé. Écouter `mouseup` sur `window` pendant le glissement.

## M11 — Pas de versionnement du CRA à la réouverture
Spec §5-E : « Réouverture explicite → **nouvelle version du CRA** ». `ROUVRIR` remet simplement le statut à `BROUILLON` (`state-machine.ts:15`), sans trace ni numéro de version. Acceptable au lot 0 (le push Dolibarr, qui donne son sens à la version, arrive au lot 2), mais à noter comme dette explicite.

## M12 — Bornes absentes sur les quantités saisies
`parseQuantity` accepte `'1e3'` (→ 480 000 min) ou `'99'` (→ 99 jours sur une cellule). Seul le mode `BLOCAGE` s'y oppose ; en `DESACTIVE` ou `AVERTISSEMENT` la valeur est persistée telle quelle. Poser un plafond raisonnable (ex. 24 h) dans `parseQuantity`.

---

# Verdict sur les points déjà reportés dans `progress.md`

| Point reporté | Verdict |
|---|---|
| **Postgres jamais validé, aucune migration générée** | **Doit bloquer.** Requalifié en C2 : ce n'est pas seulement « non vérifié », le chemin est démontrablement cassé (client SQLite + URL Postgres), et sans `prisma/migrations/` aucune installation n'est possible. |
| **Build Docker jamais exécuté** | **Doit bloquer**, même raison (C2). Le défaut se lit dans le Dockerfile, il ne demandait pas Docker pour être trouvé. Une fois le provider et les migrations corrigés, un `docker compose up --build` réel reste indispensable avant mise en service. |
| **3 vulnérabilités npm « high »** | **Peut attendre.** Vérifié : `postcss <=8.5.22` et `sharp <0.35` atteints **uniquement** à travers `next` (`node_modules/next/node_modules/postcss`). Toutes deux sont des surfaces de build ou d'optimisation d'images ; l'application ne sert aucune image et ne traite aucun CSS d'origine externe. Le correctif impose `next@16` (rupture). À reprogrammer à la prochaine montée de Next. Note : le `postcss` de premier niveau installé (8.5.26) n'est pas concerné, le correctif C1 ne l'aggrave donc pas. |
| **Warning `jose` / Edge Runtime (CompressionStream)** | **Peut attendre.** Provient de `next-auth`, sans effet fonctionnel constaté. |
| **`authorized` laisse NextAuth gérer la redirection (`?callbackUrl=`) ; aucun test n'exerce `middleware.ts`** | **Peut attendre** pour la redirection. En revanche l'absence totale de test sur le middleware mérite d'être comblée au lot 1 : c'est le seul garde-fou global d'authentification, et son isolement du runtime edge (correctif de la vague 7) n'est protégé par aucune régression. |
| **`fileParallelism: false`, base SQLite partagée** | **Peut attendre**, mais fragile : les fichiers de test partagent le singleton `Settings` et se nettoient mutuellement par `deleteMany` en `afterAll` (`time-entries.test.ts:35`, `settings.test.ts:6`). La suite est verte et stable, au prix d'un couplage implicite entre fichiers. Une base par fichier de test lèverait la dette. |

---

# Synthèse

**4 Critiques · 9 Importants · 12 Mineurs.**

**Bloquent la fusion :** C1 (aucun CSS produit — l'application est livrée sans style), C2 (déploiement Docker/Postgres inopérant + aucune migration), C3 (bandeau d'engagement faux dès le 2ᵉ mois), C4 (`minutesParJour = 0` atteignable → suppression silencieuse des saisies).

Les trois premiers partagent la même signature : chacun se situe **à la jointure entre deux tâches**, jamais à l'intérieur d'une. Personne n'a câblé PostCSS parce que la tâche 1 installait les dépendances et la tâche 12 écrivait des `className`. Le Dockerfile (tâche 15) et le provider Prisma (tâche 6) n'ont jamais été confrontés. Le bandeau (tâche 12) consomme un service mensuel (tâche 10) pour un calcul pluri-mensuel (tâche 4) — les trois pièces sont correctes isolément. C'est ce que la production parallèle produit de pire, et c'est ce que les tests par tâche ne peuvent structurellement pas attraper.

**Le socle de contraintes, lui, tient :** pureté de `src/core/`, absence d'enums et de décimaux, JSON en bloc, `output: 'standalone'`, non-facturation, `slotId` non nullable, contrôle de capacité sur le total sans double comptage, verrouillage du CRA validé, week-ends et fériés jamais bloquants. Ces points ont été vérifiés, pas supposés.

**Recommandation :** corriger C1 à C4 (aucun n'excède quelques dizaines de lignes), traiter I1 à I3 dans la foulée (défauts visibles à l'usage dès la première session de saisie), puis fusionner. I5 à I9 peuvent partir en lot 0.1 s'ils sont inscrits au backlog ; I5 ne doit pas glisser au-delà du premier lot multi-consultants.
