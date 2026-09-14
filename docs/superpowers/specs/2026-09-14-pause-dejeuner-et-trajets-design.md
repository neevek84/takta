# Pause déjeuner et trajets chez le client

**Date :** 2026-09-14
**Statut :** design validé, en attente de plan d'implémentation

---

## 1. Intention

Deux évolutions, demandées ensemble parce qu'elles règlent le même écart :
**ce qui se facture et ce qui occupe l'agenda ne sont pas la même durée.**

| # | Évolution |
|---|---|
| A | Une journée entière porte une **pause déjeuner** : 7 h facturées, 8 h d'agenda, la pause libre au milieu |
| B | Une saisie se fait **chez le client** ou **à distance** ; chez le client, l'agenda reçoit un **trajet** avant et après |

### Le constat

Le porteur facture 7 h par journée : c'est ce qui doit concorder entre takta et
Dolibarr, et c'est ce qu'il saisit. Aujourd'hui, une journée entière de 7 h
part dans l'agenda en **un seul bloc de 9 h à 16 h** (`entryBounds`, début de la
plage journée plus le temps saisi). La pause déjeuner n'existe nulle part, et le
bloc finit une heure trop tôt.

Deuxième écart : les rendez-vous chez un client se posent bout à bout dans
l'agenda, alors qu'il faut s'y rendre. Le trajet n'occupe rien, et quelqu'un
peut réserver la demi-heure où le porteur est sur la route.

### Ce que ces évolutions ne font pas

**Elles ne changent aucune quantité.** `TimeEntry.minutes` reste la durée
facturée. Le CRA, la poussée des temps vers Dolibarr, le contrôle de capacité et
les engagements lisent tous `minutes` et jamais les bornes — vérifié : seuls
`CellForm` et `buildCalendarEvent` dérivent une durée des deux heures. Aucun des
deux ne touche à la facturation.

**Elles ne réécrivent aucune saisie existante.** Même règle que les heures et le
facteur de conversion : ce qui est figé à l'écriture ne bouge qu'à la prochaine
écriture. Une journée saisie hier reste un bloc de 9 h à 16 h tant qu'on ne la
réenregistre pas.

**Les trajets ne sont pas du temps de travail.** Ils n'entrent ni dans le CRA,
ni dans Dolibarr, ni dans la capacité. Ils n'existent que dans l'agenda.

---

## 2. A — Pause déjeuner

### Réglage

Deux colonnes sur `Settings`, réglées dans **Administration · Saisie** à côté de
la plage journée :

```prisma
/// début de la pause déjeuner, minutes depuis minuit (12 h 30 -> 750).
pauseDebutMinute Int @default(750)
/// fin de la pause déjeuner (13 h 30 -> 810). Égale au début = aucune pause.
pauseFinMinute   Int @default(810)
```

Validation : la pause tient **strictement dans** la plage journée, et sa fin
suit son début. Début égal à fin désactive la pause — pas de booléen à part, qui
pourrait contredire les heures.

### Ce que la saisie porte

Deux colonnes sur `TimeEntry`, figées à l'écriture comme `startMinute` et
`endMinute` :

```prisma
/// pause incluse dans le bloc, minutes depuis minuit. Égales = aucune pause.
/// Figées à l'écriture : changer le réglage ne déplace aucune journée saisie.
pauseDebutMinute Int @default(0)
pauseFinMinute   Int @default(0)
```

Les défauts à 0 servent la migration d'une table peuplée : toutes les saisies
existantes lisent « aucune pause », ce qui est exactement leur réalité. Comme
pour `minutesParJour`, le chemin d'écriture renseigne **toujours** les deux
colonnes explicitement.

**L'invariant :** `minutes = minutesBetween(startMinute, endMinute) −
(pauseFinMinute − pauseDebutMinute)`, sauf quand la fin de plage a tronqué le
bloc — la règle existante, qui préfère un bloc trop court à une soirée occupée.
Une pause ne franchit pas minuit ; un bloc de nuit n'en porte pas.

### Le calcul des bornes — `entryBounds`

`EntryBoundsArgs` gagne `pause: { debutMinute, finMinute } | null`. Pour une
journée entière (`slot === null`) avec une pause active :

- le bloc part au début de la plage journée ;
- la pause s'applique si elle tombe **dans** `[début, début + minutes + durée de
  la pause]` ;
- la fin vaut `début + minutes + durée de la pause`, toujours bornée par la fin
  de plage — la règle actuelle (« ne jamais occuper une soirée que personne n'a
  vendue ») ne change pas ;
- le résultat rend aussi `pauseDebutMinute` et `pauseFinMinute`, égaux à 0 quand
  la pause ne s'applique pas.

Exemple, plage 9 h – 18 h, pause 12 h 30 – 13 h 30, 420 minutes : bloc 9 h →
17 h, pause 12 h 30 → 13 h 30.

Un créneau nommé (Matin, Après-midi) ne reçoit **jamais** la pause d'office : il
dit lui-même quand il commence et finit.

### Les deux chemins d'écriture

- **Clic dans la grille** — `applyCellState` (`src/services/cells.ts`) via
  `cellStateToWrite` : l'état `JOURNEE` reçoit la pause d'office, en passant le
  réglage courant à `entryBounds`.
- **Formulaire** — `saveEntry` (`src/services/time-entries.ts`) : reçoit la
  pause que le formulaire envoie, telle quelle. `null` = aucune pause.

`CellState.LIBRE` gagne les deux bornes de pause, pour que rouvrir le
formulaire montre ce qui est en base — la leçon de `bornesFigees`.

### Le formulaire — `CellForm`

Sous les heures de début et de fin :

```
[x] Pause déjeuner   12:30 → 13:30
Durée : 7 h
```

- La case est **cochée** à l'ouverture d'une case vide, ou quand on choisit
  « Journée entière ». Elle est décochée quand on choisit un créneau nommé.
  Rouverte sur une saisie existante, elle reflète la saisie.
- Cochée, deux champs horaires pré-remplis depuis le réglage, modifiables.
- La durée affichée devient `fin − début − pause`. C'est elle qui part en
  `minutes`.
- Erreur si la pause ne tombe pas strictement entre le début et la fin : « La
  pause doit tomber entre le début et la fin. »
- Réglage à « aucune pause » : la case n'est pas affichée.

### L'agenda : une saisie, deux événements

Un événement Google ne peut pas avoir de trou. Une saisie avec pause devient
donc **deux blocs** : `début → début de pause` et `fin de pause → fin`.

Écartées :

- **Deux saisies en base** — la case deviendrait « journée en plusieurs
  créneaux » et la journée cesserait d'être un seul fait (voir `plage.ts`).
- **Un bloc et la pause en description** — l'agenda ne montrerait pas la pause
  comme libre, ce qui est le but.

Mécanique, dans `src/services/sync/flush.ts` :

- La file garde **une ligne par saisie** (`entityType = 'TimeEntry'`) : rien ne
  change dans `enqueueTimeEntry`, ni pour `applyCellState` et `saveEntry`.
- `buildCalendarEvent` rend désormais une liste de **segments** — un seul sans
  pause, deux avec. Le second porte `craEntryId` et une propriété privée
  `craSegment = 'apres-pause'`.
- Chaque segment a son propre `ExternalLink` : le premier garde
  `entityType = 'TimeEntry'` (aucune reprise des liens existants), le second
  prend `entityType = 'TimeEntrySuite'`.
- Au drainage d'un `UPSERT`, chaque segment suit la règle actuelle — création,
  ou lecture puis comparaison d'etag puis mise à jour, ou conflit. Un segment
  qui n'existe plus (la pause a été retirée) voit son événement supprimé et son
  lien consommé.
- Un `DELETE` retire les deux liens.
- Les conflits restent par événement : `SyncConflict.entityType` peut valoir
  `TimeEntrySuite`. L'écran d'arbitrage et `src/services/sync/queue.ts` doivent
  reconnaître le nouveau type ; rétablir un segment repousse la saisie entière.

Aucun nouvel appel Google : `createEvent`, `getEvent`, `updateEvent`,
`deleteEvent` suffisent. Le catalogue (`src/integrations/google/catalogue.ts`)
ne gagne aucune route ; seule l'origine du `summary` et des heures y est
reformulée si le constructeur change de nom.

---

## 3. B — Lieu et trajets

### Le lieu

```prisma
// Mission
/// 'SITE' | 'DISTANCE'. Défaut DISTANCE : aucune mission existante ne se met
/// à poser des trajets sans qu'on l'ait demandé.
lieuDefaut String @default("DISTANCE")

// TimeEntry
/// 'SITE' | 'DISTANCE', repris de la mission à l'écriture, modifiable.
lieu String @default("DISTANCE")
```

Une chaîne et non un enum Prisma, comme `kind` et `displayUnit` (portabilité
SQLite/Postgres).

- **Mission** : un choix « Lieu par défaut : chez le client / à distance » sur
  la page de la mission.
- **Clic dans la grille** : la saisie prend le lieu par défaut de la mission.
- **Formulaire** : un choix « Lieu », pré-rempli depuis la saisie existante ou,
  à défaut, la mission.
- **Reprise des temps Dolibarr** (`reprise-temps.ts`) : `DISTANCE`. Du réalisé
  passé ne pose aucun trajet.

### Le réglage

```prisma
// Settings
/// durée d'un trajet posé dans l'agenda, en minutes. 0 = aucun trajet.
dureeTrajetMinutes Int @default(30)
```

### La règle : posés, puis oubliés

Le porteur veut pouvoir retoucher ou supprimer un trajet dans son agenda sans
que l'application s'en mêle. D'où la règle, à écrire à l'écran telle quelle :

> **Les trajets sont posés une fois, puis l'agenda en fait ce qu'il veut.**
> Déplacer ou supprimer la saisie ne les déplace ni ne les retire.

Donc aucun `ExternalLink`, aucun etag, aucun conflit pour un trajet.

### Quand un trajet est posé

Une saisie gagne une colonne :

```prisma
/// vrai dès que les trajets de cette saisie ont été calculés — une seule fois
/// dans sa vie, quel que soit ce qui change ensuite.
trajetsCalcules Boolean @default(false)
```

Au moment d'écrire une saisie, dans la **même transaction** que son écriture et
sa mise en file, si `lieu = 'SITE'`, `trajetsCalcules = false` et la durée de
trajet est non nulle : les trajets sont calculés, enregistrés, mis en file, et
`trajetsCalcules` passe à vrai.

Conséquences assumées : repasser une saisie à distance puis sur site ne repose
rien, et changer ses heures non plus.

### Le calcul — une fonction pure

`src/core/saisie/trajets.ts` :

```ts
trajetsAPoser(args: {
  bloc: { startMinute: number; endMinute: number }
  dureeMinutes: number
  /** trajets déjà enregistrés ce jour-là pour cet utilisateur */
  dejaPoses: Intervalle[]
  /** autres saisies du jour, toutes prestations, sur site ou non */
  autresBlocs: Intervalle[]
}): Intervalle[]
```

- **Aller** : `[début − durée, début]`. **Retour** : `[fin, fin + durée]`. La
  pause n'en ajoute aucun.
- Chacun est **raccourci** pour ne recouvrir ni un trajet déjà posé, ni un autre
  bloc de travail. Un trajet réduit à rien n'est pas posé.
- Un trajet ne franchit pas minuit : il est tronqué à minuit, de part ou
  d'autre. Un bloc de nuit n'a pas de trajet au-delà.
- Prévisionnel comme réalisé : c'est le lieu qui décide, pas la nature. La
  conversion du prévisionnel passé en réalisé (`convertPastForecast`) ne pose
  rien — les trajets de ces saisies l'ont été à leur écriture.

C'est ce qui tient ensemble « posés puis oubliés » et « fusionnés quand ils se
touchent ». Journée chez A de 9 h à 17 h, rendez-vous chez B à 17 h 45 :

```
17:00 ─ 17:30  Trajet   (retour de A, déjà posé)
17:30 ─ 17:45  Trajet   (aller de B, raccourci)
17:45 ─ 18:45  B · Rendez-vous
18:45 ─ 19:15  Trajet   (retour de B)
```

Deux blocs contigus au lieu d'un seul trajet de 45 min : c'est le prix de ne
jamais retoucher ce qui est déjà posé. L'agenda montre le porteur occupé sur
toute la plage, ce qui est le but.

### Stockage et envoi

```prisma
/// Un trajet que l'application a posé ou va poser dans l'agenda. Sert
/// uniquement à ne pas en poser deux au même endroit : l'application ne relit
/// jamais l'événement distant.
///
/// Aucune clé étrangère vers `TimeEntry` : le trajet survit à sa saisie, comme
/// dans l'agenda.
model Trajet {
  id          String    @id @default(cuid())
  userId      String
  /// minuit UTC du jour concerné
  date        DateTime
  startMinute Int
  endMinute   Int
  /// saisie d'origine, pour la trace uniquement
  entryId     String
  /// libellé figé à la pose : « Trajet · Client »
  summary     String
  /// null tant que Google n'a pas confirmé la création
  poseAt      DateTime?
  createdAt   DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, date])
}
```

- Mis en file avec `entityType = 'Trajet'`, `operation = 'UPSERT'`.
- Au drainage : si `poseAt` est renseigné, rien. Sinon `connector.createEvent`,
  puis `poseAt = now`. Un échec transitoire se rejoue comme toute ligne de la
  file. Un trajet dont la création a réussi mais dont `poseAt` n'a pas pu être
  écrit serait reposé en double : risque accepté, l'utilisateur supprime le
  doublon dans l'agenda.
- Non connecté à Google : la ligne attend comme les autres.

### L'événement

`buildTrajetEvent` dans `src/core/calendar/event.ts` :

- `summary` : `Trajet · <client>`.
- `description` : « Trajet posé par takta. Vous pouvez le déplacer ou le
  supprimer : l'application ne le suivra plus. »
- `transparency: 'opaque'` — il occupe.
- `colorId` : Graphite (`'8'`), distinct du réalisé et du prévisionnel.
- Propriété privée `craTrajetId` à la place de `craEntryId`, pour que la lecture
  d'occupation et la détection de conflit ne le prennent jamais pour une saisie.

---

## 4. Tests

- `entryBounds` : journée avec pause, pause hors du bloc, plage trop courte,
  créneau nommé sans pause, réglage « aucune pause ».
- `cellStateToWrite` : `JOURNEE` porte la pause ; `DEMI` ne la porte pas.
- `trajetsAPoser` : aller et retour simples ; raccourci contre un trajet posé ;
  raccourci contre un bloc à distance ; réduit à rien ; tronqué à minuit.
- `buildCalendarEvent` : un segment sans pause, deux avec, heures exactes.
- `CellForm` : case cochée pour une journée entière, décochée pour un créneau,
  durée affichée à 7 h pour 9 h → 17 h, erreur de pause hors bloc.
- Drainage, avec le faux connecteur Google (`fake-google-api.ts`) : saisie avec
  pause → deux événements ; pause retirée → le second supprimé ; conflit sur le
  second segment ; trajet posé une fois et jamais relu ; saisie supprimée → ses
  trajets restent.
- Écriture : saisie sur site → trajets enregistrés et `trajetsCalcules` à vrai ;
  réécriture → aucun nouveau trajet ; mission `DISTANCE` → aucun trajet.
- Réglages : validation de la pause dans la plage.

---

## 5. Hors périmètre

- Déplacer ou supprimer les trajets quand la saisie change.
- Une durée de trajet par mission ou par client.
- Une pause posée d'office sur un bloc libre ou un créneau nommé.
- L'adresse du client dans le champ `location` de l'événement.
- Afficher le lieu dans la grille mensuelle ou le CRA.
