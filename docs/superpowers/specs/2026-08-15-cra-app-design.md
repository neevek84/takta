# CRA — Application de compte-rendu d'activité

**Date :** 2026-08-15
**Statut :** design validé, en attente de plan d'implémentation

---

## 1. Intention

Construire une application de saisie et de production de CRA, aussi simple à l'usage que Timizer, qui gère en plus le **prévisionnel adossé à un engagement contractuel** — un besoin qu'aucun outil existant ne couvre correctement.

L'application est **autoportante** : elle fonctionne intégralement sans aucun système tiers. Dolibarr, Google Calendar et la signature électronique sont des **connecteurs optionnels et additifs**.

### Ce qui motive un nouvel outil

Le module Dolibarr `dolibarr_project_timesheet` (delcroip) couvre le besoin fonctionnel mais n'est plus maintenu. Le reconstruire en module Dolibarr reproduirait la cause de sa mort : du PHP couplé au cycle de release de Dolibarr, cassé à chaque montée de version, maintenu par une seule personne.

**L'inversion retenue : l'application est le produit, Dolibarr est le back-office.** Une SPA autonome qui écrit dans Dolibarr via son API REST. Dolibarr reste source de vérité pour les référentiels et les temps consommés ; l'UX n'est plus prisonnière de son front.

### Ce que l'application ne fait pas

**Elle ne facture pas.** Jamais. Son rôle s'arrête au CRA validé. La réglementation française sur la facturation électronique est un domaine complexe et mouvant ; l'intégrer transformerait un outil de CRA en produit de conformité.

L'application se contente d'exposer, sur chaque CRA, des champs de **suivi informatif** : numéro de facture associé, date de facturation, date de paiement. Ils permettent de savoir quels CRA sont facturés et lesquels sont payés, sans qu'aucun calcul ne soit produit.

La facture est établie dans Dolibarr, à partir des temps consommés que l'add-on y a poussés.

### Cadrage

| Décision | Valeur |
|---|---|
| Déploiement | Auto-hébergeable, **mono-organisation** — serveur ou poste local |
| Stack | Next.js (App Router) · TypeScript · Prisma · Postgres **ou** SQLite |
| Surfaces | Desktop (grille mensuelle) + mobile (saisie rapide), PWA |
| Utilisateurs v1 | Un consultant. Le modèle est provisionné pour N. |
| Facturation | **Hors produit**, définitivement |
| Multi-tenant | **Hors produit**, assumé |

---

## 2. Architecture

### Couches

```
core/          domaine pur — missions, lignes, engagements, CRA, calculs.
               Aucune dépendance externe. Testable sans Dolibarr ni réseau.
connectors/    dolibarr/ · google/ · (signature — lot ultérieur)
               Chacun implémente une interface déclarée par le core.
app/           Next.js — UI et routes.
db/            Prisma + Postgres.
```

**Règle structurante : le cœur ne sait pas que Dolibarr existe.** C'est ce qui rend l'add-on réellement optionnel et le métier testable sans dépendance.

### Interfaces de connecteur

```ts
interface ErpConnector {
  listClients(): Promise<ExternalClient[]>
  createClient(client: Client): Promise<string>
  listEngagements(clientRef: string): Promise<ExternalEngagement[]>
  pushTimeEntries(entries: TimeEntry[]): Promise<PushResult[]>
}

interface CalendarConnector {
  upsertBlock(entry: TimeEntry): Promise<string>
  removeBlock(externalId: string): Promise<void>
  findBusy(range: DateRange): Promise<BusySlot[]>
}
```

Un `SignatureConnector` est prévu comme point d'extension mais **n'est pas conçu dans cette spec** — il fait l'objet d'un lot dédié avec son propre brainstorming (voir §8).

Sans connecteur configuré, l'application tourne normalement. C'est le mode autoportant.

### Les connecteurs sont additifs, jamais exclusifs

Dolibarr configuré **n'impose rien**. Création manuelle d'un client, d'une mission, d'une ligne de prestation ou d'un CRA reste possible en permanence. Un objet créé localement peut être rattaché plus tard à son équivalent Dolibarr, ou y être poussé.

Toute référence externe est nullable, à tout moment, pour toute entité.

### Sens de la synchronisation

**Unidirectionnel. L'application est maître du CRA.**

| Connecteur | Lecture | Écriture |
|---|---|---|
| Dolibarr | tiers, projets, lignes de propale | temps **réalisé**, à la validation du CRA |
| Google Calendar | occupation (détection de conflit) | blocs **réalisé + prévisionnel** |

Pas de synchronisation bidirectionnelle : c'est là que ce type d'outil meurt, en conflits de données inarbitrables.

**Règle par connecteur, pas générale :**

- **Vers Dolibarr, jamais de prévisionnel.** Du temps prévu n'est pas du temps consommé.
- **Vers l'agenda, le prévisionnel est le cas d'usage principal** — c'est lui qui protège les journées à venir.

---

## 3. Modèle de domaine

### Entités

| Entité | Contenu |
|---|---|
| `User` | identité, `role` (ADMIN par défaut), auth |
| `Client` | nom |
| `Mission` | client, libellé, période. **Le cadre, pas l'engagement.** |
| `MissionLine` | **l'engagement** : libellé, `joursVendus`, `tjm`, unité de saisie, créneaux autorisés, `heuresParJour` (surcharge), `engagementSource` |
| `Assignment` | (ligne, user, jours alloués, période) |
| `TimeEntry` | **ligne**, user, date, `minutes`, `kind`, créneau, commentaire |
| `Cra` | user, mission, mois, statut, + suivi : `numeroFacture`, `dateFacturation`, `datePaiement` |
| `ExternalLink` | (entityType, entityId, provider, externalId, syncedAt, syncState) |
| `Settings` | jours ouvrés, fériés, créneaux, `heuresParJour`, mode de contrôle de capacité, capacité journalière, unité par défaut, source d'engagement par défaut |

### L'engagement est porté par la ligne, pas par la mission

Une propale se découpe en lignes facturables distinctes, chacune avec sa quantité et son tarif :

```
Mission « ITSM — client 38 »
  ├── Ligne « Consultant ITSM »       30 j · 800 €
  └── Ligne « Consultant ITSM Nuit »  10 j · 1 200 €
```

Conséquences :

- **Une ligne de grille = une ligne de prestation.** L'utilisateur saisit sur la bonne ligne.
- **Pas de majoration.** La différenciation tarifaire est déjà portée par le découpage en lignes ; un coefficient ferait double emploi avec la propale.
- L'unité de saisie descend au niveau de la ligne : une ligne au forfait jour et une ligne à l'heure peuvent coexister sous la même mission.
- Le `tjm` est **informatif** — l'application ne facturant pas, il sert uniquement à lire un reste à facturer en euros.

### Réalisé et prévisionnel dans la même table

`TimeEntry.kind ∈ { RÉALISÉ, PRÉVISIONNEL }`.

```
reste à planifier = joursVendus − Σ(RÉALISÉ) − Σ(PRÉVISIONNEL)
```

La bascule prévisionnel → réalisé est un changement de champ, pas une migration d'enregistrement. Et le plan de charge multi-consultants devient un simple pivot par personne de données déjà présentes — aucune donnée nouvelle requise.

### Portabilité SQLite / Postgres

Le schéma reste dans l'**intersection** des deux moteurs, afin que la même base de code tourne sur un serveur (Postgres) et sur un poste local (SQLite).

| Règle | Conséquence |
|---|---|
| Pas d'enum natif Postgres | Enums stockés en chaînes, union TypeScript + contrainte de vérification |
| Pas de décimal | Entiers partout : minutes, `joursVendus` en **centièmes de jour**, `tjm` en **centimes** |
| Pas de tableaux ni de `jsonb` interrogé finement | JSON en lecture/écriture globale uniquement (réglages) |

Bénéfice collatéral : plus aucune question d'arrondi sur les jours ni sur les montants.

Cette discipline coûte peu maintenant et ne se rattrape pas ensuite — une fois cinquante requêtes écrites contre des enums natifs, la portabilité est perdue.

### Stockage du temps

**Toujours en minutes.** Un stockage « en jours » explose dès qu'un client demande du 7 h 30.

La conversion minutes ↔ jours passe par `heuresParJour`, réglable en administration (7 h, 8 h, 7 h 12…) et **surchargeable par ligne de prestation** — un client peut contractuellement compter la journée autrement qu'un autre.

L'unité d'affichage (jour / demi-journée / heure) est un réglage de la ligne.

### Provisions pour le multi-consultants

Intégrées dès la v1, sans aucune UI supplémentaire.

| Provision | Justification |
|---|---|
| `User` + auth dès J1, requêtes scopées via couche service | Le retrofit du scoping est coûteux et diffus |
| Clé `(user, ligne, date)` partout dès le départ | C'est la dimension du modèle mental ; se rajoute très mal |
| `Assignment`, rattaché à la **ligne** | Sinon réécriture du moteur d'engagement + migration |
| `userId` sur `TimeEntry` et `Cra` | Quasi gratuit |
| Statut `Cra` en machine à états dans `core/`, jamais en booléens | L'étape « validation manager » s'insère alors sans douleur |
| `ExternalLink` plutôt que des colonnes `externalRef` | Une ligne de temps porte déjà 2 refs (Dolibarr + Google) |

En mono-consultant, l'`Assignment` est créée automatiquement et n'est jamais visible.

### Exclu définitivement / simplement différé

La distinction compte, et les deux ne se traitent pas pareil.

**Exclu définitivement — ne pas provisionner :**

- `organizationId` et le multi-tenant. Le déploiement est mono-organisation ; porter une clé de tenant jamais utilisée pollue chaque requête sans contrepartie.
- La facturation, sous toutes ses formes.

**Différé — provisionné, ajouté plus tard sans refonte :**

- Logique de permissions par rôle. La colonne `role` existe dès le départ, tout le monde en ADMIN ; la logique arrive avec le multi-consultants.
- Validation hiérarchique N+1. S'insère comme un état supplémentaire dans la machine à états du CRA.
- Flux d'invitation d'utilisateurs.

C'est précisément le rôle des provisions ci-dessus : rendre ces ajouts additifs.

---

## 4. Règles métier

### Contrôle de capacité — configurable

Le contrôle porte sur le **total** par personne et par date, toutes lignes confondues — pas sur l'exclusivité. Une demi-journée chez A et une demi-journée chez B est légitime.

Deux réglages en administration :

| Réglage | Valeurs |
|---|---|
| `capaciteJournaliere` | seuil en jours (défaut : 1) |
| `modeControle` | `DÉSACTIVÉ` · `AVERTISSEMENT` · `BLOCAGE` (défaut : `AVERTISSEMENT`) |

En mode `BLOCAGE`, le dépassement est refusé. En `AVERTISSEMENT`, il est signalé mais l'utilisateur passe outre. Dans tous les cas, la ligne de total de la grille signale visuellement le dépassement.

La règle s'applique un dimanche comme un mardi.

### Créneaux configurables

| Créneau | Plage | Valeur |
|---|---|---|
| Matin | 09:00 – 13:00 | 0,5 j |
| Après-midi | 14:00 – 18:00 | 0,5 j |
| Nuit | 22:00 – 06:00 | 0,5 j |

Ajout, renommage et suppression libres en admin. Cette table alimente les blocs Google Calendar : une intervention de nuit bloque réellement la nuit.

**Créneau franchissant minuit** : la `TimeEntry` reste datée du jour de **début** — sinon un CRA de fin de mois déborde sur le mois suivant — tandis que l'événement agenda s'étale sur deux jours. Traité une fois dans le connecteur.

**Créneaux autorisés par ligne** : une ligne peut restreindre les créneaux qu'elle accepte. La ligne « Nuit » n'accepte que le créneau Nuit ; saisir une nuit sur la ligne de jour déclenche un signalement.

### Week-ends et jours fériés

**Grisés mais parfaitement saisissables.** Le grisé est un repère visuel, jamais un refus — le travail de week-end, de jour férié et de nuit est un cas nominal. Seul le contrôle de capacité fait garde-fou.

### Conversion prévisionnel → réalisé

**Jamais automatique.** Un jour prévisionnel dont la date est passée ne se convertit pas de lui-même : il deviendrait du temps engageant sans décision humaine.

Deux moments de conversion, tous deux à l'initiative de l'utilisateur :

1. **Au fil du mois** — action « valider les jours passés », disponible à tout moment sur le mois en cours. Elle propose les jours prévisionnels déjà écoulés et les convertit en réalisé en un geste, unitairement ou en lot.
2. **À la clôture** — garde-fou : les jours prévisionnels restants sont listés, à convertir ou à abandonner (retrait des blocs agenda associés).

### Machine à états du CRA

`BROUILLON → ENVOYÉ → VALIDÉ` (et `REFUSÉ`, retour vers `BROUILLON`).

**Ces transitions sont manuelles dès le lot 0.** L'autoportance l'exige : sans outil de signature, l'utilisateur marque lui-même le CRA envoyé puis validé. Le lot signature (§8) ne fera qu'automatiser une transition qui existe déjà.

Le passage à `VALIDÉ` est le déclencheur du push des temps réalisés vers Dolibarr.

---

## 5. Politique de conflits

Principe directeur : **l'application ne perd jamais une donnée en silence et n'écrase jamais en silence.** Toute divergence part dans une file d'arbitrage visible.

| # | Situation | Politique |
|---|---|---|
| **A** | Planification sur un créneau où l'agenda a un événement occupé | Avertissement non bloquant : l'événement est affiché, l'utilisateur confirme ou renonce |
| **B** | Bloc CRA déplacé ou supprimé directement dans Google | **File d'arbitrage.** Divergence détectée par etag, rien n'est écrasé. Trois choix par conflit : rétablir depuis l'app, accepter la version agenda (déplace la ligne de temps), détacher le lien |
| **C** | Clôture : 15 jours prévus, 12 réalisés | L'app liste les jours orphelins : convertir en réalisé, ou abandonner et retirer les blocs agenda |
| **D** | Planification au-delà des jours vendus | Avertissement seul, **jamais bloquant** — un avenant peut être en cours. Affiche « dépassement de X jours » |
| **E** | Modification d'un mois dont le CRA est validé | **Mois verrouillé.** Réouverture explicite → nouvelle version du CRA. Les temps déjà poussés dans Dolibarr sont mis à jour au prochain push |

**Filtre de la famille A** — ne comptent comme conflits que les événements marqués **occupés**, non annulés, et non déclinés. Un anniversaire, un rappel ou une invitation refusée ne doit jamais déclencher d'alerte, sous peine de désactivation de la fonction en une semaine.

---

## 6. Saisie

**Lignes = lignes de prestation actives. Colonnes = jours du mois.**

Une cellule porte une valeur dans l'unité de sa ligne — `0,5` sur une ligne au forfait et `3h` sur une ligne horaire, dans la même grille.

Trois éléments font la différence entre une grille agréable et une corvée :

**Sélection par glissement.** Sélectionner lundi à vendredi sur une ligne, taper `1`, la semaine est remplie. C'est le geste qui rend Timizer rapide — point non négociable. Navigation clavier complète en complément.

**Ligne de total en bas.** Total par jour, toutes lignes confondues, signalé au-delà de la capacité. Le contrôle devient visible en permanence au lieu d'être une erreur subie.

**Bandeau d'engagement par ligne de prestation.** `30 j vendus · 18 réalisés · 7 prévus · 5 restants`, en barre, au-dessus de la grille. La fonctionnalité différenciante doit être sous les yeux pendant la saisie, pas dans un écran de rapport.

Réalisé et prévisionnel se distinguent visuellement (plein / hachuré). Le futur est prévisionnel par défaut, le passé réalisé par défaut.

### Surface mobile

**La grille mensuelle ne passe pas sur un téléphone.** 31 colonnes sur 375 pixels, et surtout la sélection par glissement — le geste qui fait toute la rapidité de la saisie — n'existe pas au doigt. Du responsive sur cette grille produirait quelque chose de techniquement mobile et concrètement inutilisable.

Le mobile reçoit donc un **modèle d'interaction distinct**, pas une mise en page adaptée :

- vue centrée sur le **jour ou la semaine** ;
- saisie en deux tapes — jour → ligne de prestation → Matin / Après-midi / Journée ;
- consultation de l'engagement et du plan de charge.

Restent sur desktop : l'administration, la création de missions et de lignes, la clôture de mois, la file d'arbitrage.

**Une application, deux surfaces, un seul cœur.** La séparation `core/` garantit qu'aucune logique n'est dupliquée — les deux surfaces ne sont que des composants de présentation au-dessus du même domaine.

**Forme retenue : PWA**, pas de natif. Installable sur l'écran d'accueil, aucune plateforme à builder, une seule base de code. Bénéfice collatéral : la PWA s'installe aussi sur desktop depuis le navigateur, ce qui donne une expérience « application installée » sans aucun empaquetage.

Le fonctionnement **hors ligne** (saisir chez un client sans réseau, synchroniser au retour) est un vrai apport mobile mais n'est pas retenu en v1.

### Écran Admin → Saisie

- jours ouvrés (jours de semaine travaillés par défaut)
- jours fériés (calendrier français préchargé, activable, jamais bloquant)
- créneaux (libellé, plage, valeur)
- `heuresParJour` — valeur d'une journée (7 h, 8 h, 7 h 12…)
- mode de contrôle de capacité et seuil
- unité par défaut des nouvelles lignes
- source d'engagement par défaut

---

## 7. Cartographie Dolibarr

Instance cible vérifiée : **Dolibarr 23.0.1**, modules `projet`, `facture`, `societe`, `api`, `webhook`, `oauth` actifs.

| Opération | Endpoint |
|---|---|
| Tiers (lecture) | `GET /thirdparties` |
| Tiers (création) | `POST /thirdparties` |
| Projets | `GET /projects` (missions filtrées sur `usage_bill_time = 1`) |
| Lignes d'engagement | lignes de `GET /proposals/{id}` |
| Push du temps réalisé | `POST /tasks/{id}/addtimespent` |

Aucun appel de facturation. L'add-on s'arrête au push des temps.

**Le temps s'attache à une tâche, pas à un projet.** Une ligne de prestation se mappe donc explicitement sur une tâche Dolibarr, avec création automatique de la tâche si elle est absente au premier push. Non traité, ce point se paie en bugs deux semaines après la mise en service.

Le mapping utilisateur (`User` → user Dolibarr, via `ExternalLink`) est requis car `llx_projet_task_time` porte un `fk_user`.

### Source de l'engagement

Réglée **par ligne de prestation** : `MANUEL` · `DOLIBARR_PROPALE` · `DOLIBARR_PROJET`.

L'administration ne fixe qu'un **défaut**. Un réglage global empêcherait d'avoir une mission issue d'une propale et une autre saisie à la main — ce qui doit rester possible.

---

## 8. Déploiement et distribution

| Cible | Moyen | Base | Public |
|---|---|---|---|
| VPS / serveur | Docker Compose | Postgres | auto-hébergement |
| Cloud managé | template « Deploy » (Railway, Vercel + base managée) | Postgres | qui n'a pas de serveur |
| Poste local | `npx cra` | SQLite (fichier) | utilisateur un peu technique |
| Poste local, double-clic | **Tauri** — lot ultérieur | SQLite | utilisateur non technique |

**Trois contraintes à respecter dès le lot 0** pour que ces quatre chemins partagent une seule base de code :

1. Schéma dans l'intersection SQLite/Postgres (voir §3).
2. Next.js en sortie **`standalone`** — requis à la fois par Docker et par l'empaquetage Tauri.
3. Aucune dépendance à des fonctions propres au serverless.

Elles coûtent peu maintenant et ne se rattrapent pas ensuite.

**Tauri n'est pas décidé, il est seulement gardé possible.** Empaqueter un produit encore instable revient à republier des installeurs chaque semaine ; l'empaquetage devient pertinent une fois le produit stabilisé, et s'ajoute alors sans rien réécrire.

---

## 9. Lots

| Lot | Contenu |
|---|---|
| **0** | Auth · clients, missions et lignes · grille de saisie desktop · contrôle de capacité configurable · admin saisie · machine à états du CRA en transitions manuelles · déploiement Docker et `npx`/SQLite |
| **1** | Prévisionnel · engagement vs jours vendus · validation des jours passés · Google Calendar et file d'arbitrage · plan de charge · **PWA et surface mobile de saisie rapide** |
| **2** | Connecteur Dolibarr : lecture des référentiels, création de tiers, push des temps réalisés à la validation, champs de suivi de facturation |
| **3** | **Validation du CRA par le client** — lot à brainstormer séparément : PDF, signature électronique pluggable, circuit d'envoi et de retour |
| **4** | Automatisations n8n : rappels de fin de mois, relances, enchaînement validation → push |
| **5** | Empaquetage Tauri (double-clic, sans installation préalable) · fonctionnement hors ligne |

Le lot 0 rend déjà autonome sur la production du CRA. Le lot 1 porte le différenciateur.

**Le lot 3 n'est pas conçu dans cette spec.** Il fera l'objet d'une session de brainstorming propre : le choix de l'outil de signature, la pluggabilité entre plusieurs prestataires et le circuit de validation méritent d'être traités pour eux-mêmes. Seul le point d'extension est réservé.

**n8n est hors du chemin critique.** Pour un enregistrement de CRA synchrone, un passage par n8n ajoute une latence, un point de panne et dégrade la gestion d'erreur. Le partage retenu : **API directe pour l'interactif, n8n pour l'asynchrone**.

---

## 10. Tests

- **`core/` sans réseau ni base** : contrôle de capacité dans ses trois modes, calcul d'engagement, machine à états du CRA, conversion minutes ↔ jours avec `heuresParJour` surchargé, créneaux franchissant minuit. C'est là que porte l'essentiel de l'effort.
- **Connecteurs contre des doubles** : chaque interface a une implémentation de test. Le métier se teste sans Dolibarr.
- **La suite d'intégration base tourne contre SQLite *et* Postgres.** C'est le seul moyen de garantir que la portabilité ne se dégrade pas silencieusement au fil des migrations.
- **Un test d'intégration Dolibarr** sur instance jetable, exécuté à part.
- **La politique de conflits est testée cas par cas** — les cinq familles, chacune avec son scénario.
