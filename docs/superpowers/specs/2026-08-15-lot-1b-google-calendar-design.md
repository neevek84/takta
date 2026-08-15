# Lot 1b — Google Calendar

**Date :** 2026-08-15
**Statut :** design validé, en attente de plan d'implémentation
**Prérequis :** lot 0 livré (`77b2f28`), lot 1a livré

---

## 1. Intention

**L'agenda est la surface de disponibilité.** Si mars est planifié à quinze jours chez un client, ces jours doivent être occupés dans l'agenda — sinon ils sont revendus, ou un rendez-vous se pose dessus.

Ce lot pousse les blocs, lit l'occupation existante pour avertir avant de planifier, et arbitre les divergences sans jamais écraser en silence.

### Ce que le lot 0 a déjà tranché — ne pas rouvrir

- **Calendrier Google dédié**, jamais l'agenda principal : affichable ou masquable d'un clic, effaçable d'un geste.
- **Réalisé et prévisionnel partent tous les deux.** La règle « pas de prévisionnel » ne vaut que pour Dolibarr : du temps prévu n'est pas du temps consommé, mais c'est exactement lui qui protège les journées à venir.
- **Blocs marqués occupés**, couleur distincte entre réalisé et prévu.
- **Filtre des conflits** : seuls comptent les événements occupés, non annulés, non déclinés.
- **File d'arbitrage, jamais d'écrasement silencieux.**
- **Pas de synchronisation bidirectionnelle** : l'application reste maître du CRA.

### Décisions propres à ce lot

| Sujet | Décision |
|---|---|
| Moment de l'écriture | File d'attente drainée par un traitement de fond |
| Heures d'un bloc | Plage journée par défaut, créneau choisissable par cellule |
| Détection de conflit | Une lecture d'occupation à l'ouverture du mois |

---

## 2. Modèle de données

### Tables nouvelles

**`SyncOutbox` — un ensemble d'entités à synchroniser, pas un journal.**

| Champ | Type | Sens |
|---|---|---|
| `entityType`, `entityId`, `provider` | `String` | la cible ; **contrainte d'unicité sur le triplet** |
| `operation` | `String` | `UPSERT` · `DELETE` |
| `state` | `String` | `PENDING` · `FAILED` |
| `attempts` | `Int` | tentatives consommées |
| `lastError` | `String` | dernier message d'échec |
| `nextAttemptAt` | `DateTime` | date d'éligibilité |

L'unicité du triplet est le cœur du dispositif : **dix modifications d'une même cellule avant le prochain passage produisent une ligne, pas dix.** La synchronisation devient idempotente par construction, et le rejeu d'un échec est gratuit.

**`SyncConflict` — les divergences à arbitrer.**

| Champ | Type | Sens |
|---|---|---|
| `entityType`, `entityId`, `provider` | `String` | la cible |
| `kind` | `String` | `REMOTE_MODIFIED` · `REMOTE_DELETED` |
| `remoteSnapshotJson` | `String` | ce que Google porte au moment de la détection |
| `detectedAt` | `DateTime` | |
| `resolvedAt` | `DateTime?` | `null` tant que non arbitré |
| `resolution` | `String` | `RETABLIR` · `ACCEPTER` · `DETACHER` |

**`ProviderCredential` — les jetons, chiffrés au repos.**

| Champ | Type | Sens |
|---|---|---|
| `provider` | `String` | unique |
| `accessTokenEnc`, `refreshTokenEnc` | `String` | AES-256-GCM |
| `expiresAt` | `DateTime` | |
| `scope` | `String` | |
| `calendarId` | `String` | le calendrier dédié |
| `connectedAt` | `DateTime` | |

Le jeton de rafraîchissement est un secret de longue durée donnant accès à l'agenda : il ne peut pas rester en clair. La clé vient de l'environnement (`CREDENTIALS_KEY`). **La perdre impose de reconnecter le compte** — à documenter dans le README, c'est le genre d'oubli qui coûte une soirée.

### Tables étendues

- **`ExternalLink`** gagne `etag String @default("")` — l'empreinte de l'événement Google, sur laquelle repose toute la détection de divergence.
- **`Settings`** gagne `journeeDebutMinute Int @default(540)` et `journeeFinMinute Int @default(1080)` — la plage 9h–18h par défaut.

Toutes ces colonnes respectent la portabilité SQLite/Postgres du lot 0 : aucun enum natif, aucun tableau, aucun décimal.

---

## 3. Le chemin d'écriture

### Mise en file

`saveEntry`, `convertPastForecast` et la suppression d'une ligne de temps inscrivent l'entité dans `SyncOutbox` **dans la même transaction que l'écriture**. Une écriture qui réussirait sans être mise en file produirait un agenda silencieusement faux — c'est exactement le genre de dérive qu'on ne détecte que trois mois plus tard.

### Drainage

`flushSyncOutbox(limit)` lit les lignes éligibles et traite chacune :

- **`UPSERT`** — lit l'état courant de la ligne de temps, construit l'événement, pousse.
- **`DELETE`** — l'entité n'existe plus ; l'`externalId` est retrouvé dans `ExternalLink`, l'événement est supprimé, puis le lien.

Échec : `attempts` incrémenté, recul progressif (1 min, 5 min, 15 min, 1 h, 6 h). Au-delà de cinq tentatives, l'état passe à `FAILED` et la ligne **remonte dans l'écran de synchronisation** au lieu de disparaître.

### Déclenchement — autoportant par défaut

Un endpoint interne `POST /api/sync/flush`, protégé par un jeton d'environnement, **plus un bouton « synchroniser maintenant »**.

Un cron système ou n8n peuvent appeler l'endpoint, mais **rien ne les exige**. Faire dépendre la synchronisation d'un ordonnanceur externe retirerait à l'application son autoportance, qui est sa condition de départ.

### Correspondance

**Un événement Google par ligne de temps.** Jamais de fusion de journées consécutives : la correspondance 1:1 est ce qui rend l'arbitrage possible, et fusionner rendrait toute divergence inarbitrable.

L'événement porte :

- un titre `client · mission · ligne` ;
- des heures issues du créneau de la saisie, ou de la plage journée par défaut ;
- `transparency: opaque` — c'est le but ;
- une couleur distincte selon `kind` ;
- `extendedProperties.private.craEntryId`, qui permet de retrouver les orphelins.

**Sans créneau, un bloc démarre à `journeeDebutMinute` et dure exactement le temps saisi.** Une journée pleine couvre donc la plage entière, une demi-journée sa première moitié, et trois heures sur une ligne facturée à l'heure occupent les trois premières heures. Une seule règle, qui couvre toutes les unités de saisie sans cas particulier.

C'est faux quand tu travailles l'après-midi — et c'est précisément pourquoi le choix d'un créneau existe.

---

## 4. Le chemin de lecture

À l'ouverture d'un mois, un appel à `freeBusy` de Google sur l'agenda principal.

Ce point d'API applique déjà exactement le filtre spécifié au lot 0 : il ne renvoie que les plages réellement occupées et exclut les événements déclinés. **Rien à filtrer nous-mêmes.**

**Le calendrier CRA dédié est exclu de la requête.** Sans cette exclusion, les blocs poussés par l'application entreraient en conflit avec eux-mêmes.

La grille marque les jours porteurs d'une occupation externe, et planifier dessus affiche un avertissement — **non bloquant**, conformément à la famille A du lot 0.

**Une panne Google ne casse jamais la saisie.** Si le compte n'est pas connecté, si l'appel échoue ou expire, la grille s'affiche sans marques et la saisie fonctionne normalement. La détection de conflit est un confort, pas une dépendance.

Aucun cache en v1 : un appel `freeBusy` est bon marché et le cache introduirait une fraîcheur à arbitrer.

---

## 5. La file d'arbitrage

### Détection

Avant chaque `UPSERT`, le traitement lit l'événement et compare son `etag` à celui stocké :

- **etag différent** → `SyncConflict(REMOTE_MODIFIED)`, et **aucune écriture** ;
- **404 ou 410** → `SyncConflict(REMOTE_DELETED)`.

### Arbitrage

L'écran liste les divergences non résolues. Trois issues par conflit :

| Issue | `REMOTE_MODIFIED` | `REMOTE_DELETED` |
|---|---|---|
| **Rétablir** | l'application réécrit l'événement | l'événement est recréé |
| **Accepter** | la ligne de temps se déplace sur l'événement | la ligne de temps est supprimée |
| **Détacher** | le lien est rompu, les deux côtés restent | idem |

**« Accepter » passe par les règles de `saveEntry`**, jamais à côté : contrôle de capacité, affectation, et verrouillage du mois. Une divergence d'agenda ne doit pas devenir une porte dérobée vers l'intégrité que l'application protège partout ailleurs. Si la règle refuse, le conflit reste ouvert et le motif est affiché.

En particulier : **sur un mois dont le CRA est validé, « accepter » est refusé.** Supprimer par ce biais une ligne de temps déjà validée ouvrirait un trou dans la facturation.

---

## 6. Connexion Google

Le projet Google Cloud existant est réutilisé — l'instance Dolibarr cible porte déjà un client OAuth (`OAUTH_GOOGLE-KreativWKS`) — en lui ajoutant le scope calendrier.

Un écran d'administration porte un bouton « Connecter Google Calendar ». Au retour du consentement, le jeton de rafraîchissement est chiffré et stocké, et **le calendrier dédié est créé s'il n'existe pas**. L'écran affiche ensuite l'état de la connexion et permet de la révoquer.

---

## 7. Saisie par créneau

Une cellule de la grille peut désormais porter un créneau. Sans choix explicite, elle reste à la journée et utilise la plage par défaut — **la saisie rapide au glissement n'est pas modifiée**, elle reste le geste principal.

Ce lot débloque au passage `allowedSlotIds`, présent en base depuis le lot 0 et jusqu'ici inexploité : saisir un créneau qu'une ligne n'accepte pas déclenche un **signalement**, pas un refus, conformément au lot 0.

---

## 8. Règles métier

- **Aucun écrasement silencieux, aucune perte silencieuse.** Toute divergence part dans la file d'arbitrage.
- **Une panne Google ne bloque jamais la saisie**, ni en lecture ni en écriture.
- **« Accepter » respecte les règles de `saveEntry`**, verrouillage compris.
- **Le calendrier dédié est exclu de la lecture d'occupation.**
- **La mise en file est transactionnelle avec l'écriture.**
- **Les jetons sont chiffrés au repos.**
- **Un événement par ligne de temps**, jamais de fusion.

---

## 9. Hors périmètre

- **Relecture de l'agenda pour pré-remplir le réalisé.** C'est la synchronisation bidirectionnelle écartée au lot 0 : une suppression accidentelle dans Google ferait perdre du temps facturé.
- **Multi-agendas en lecture.** L'agenda principal suffit en v1.
- **Un second fournisseur.** L'interface `CalendarConnector` existe ; une implémentation Outlook viendra si le besoin apparaît.
- **Notifications.** Les conflits se consultent, ils ne se poussent pas.

---

## 10. Tests

- **`core/` sans réseau** : construction de l'événement depuis une ligne de temps, un créneau et une plage par défaut ; créneau franchissant minuit ; demi-journée sans créneau.
- **File de sortie** : dix écritures sur la même cellule produisent une ligne ; le recul progressif respecte sa séquence ; cinq échecs passent l'état à `FAILED` sans perdre la ligne.
- **Connecteur contre un double de l'API Google** — aucun test n'appelle Google.
- **Détection de divergence** : un etag différent crée un conflit **et n'écrit rien**.
- **Arbitrage** : « accepter » est refusé sur un mois verrouillé, et refusé quand la capacité serait dépassée.
- **Lecture d'occupation** : le calendrier dédié est bien exclu de la requête.
- **Résilience** : compte non connecté, appel en échec et appel expiré laissent la page de saisie fonctionnelle — c'est le test qui protège le cas d'usage quotidien.
- **Isolation par utilisateur** sur tous les services, comme partout ailleurs.
