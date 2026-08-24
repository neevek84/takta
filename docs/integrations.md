<!-- ENGENDRÉ depuis les catalogues — ne pas modifier à la main. Voir npm run doc:integrations. -->

# Intégrations

## À quoi sert ce chapitre

Il dit **où sont les appels aux API externes, quels paramètres chacun porte, et
d'où vient la valeur de chacun** — pour suivre les évolutions des systèmes tiers
sans relire tout le code.

Il est **engendré** depuis `src/integrations/<système>/catalogue.ts`. Trois tests
l'empêchent de mentir : le double d'API refuse une route absente du catalogue, un
test de couverture refuse une entrée que rien n'exerce, et ce fichier est comparé
à ce que la génération produirait.

Ce qu'il n'est pas : une réécriture de la documentation de Dolibarr ou de Google.
Il décrit **les appels que cette application émet**, et rien de plus.

## Dolibarr

Base : `{URL de l'instance, saisie dans Administration · Dolibarr}/api/index.php`

### Retirer un temps qui n a plus lieu d être

`DELETE /tasks/{taskId}/timespent/{timespentId}` — émis par `src/services/dolibarr/http.ts · deleteTimeSpent`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `taskId` | identifiant externe | `ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts` | `17` |
| `timespentId` | identifiant externe | `ExternalLink (cellule de saisie → temps passé), src/services/dolibarr/push.ts` | `91` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Toléré — l'état visé est déjà atteint. Rien. Un temps déjà disparu est un objectif atteint.

> Le 404 est toléré par le client : lever bloquerait la file sur une cible conforme.

### Lister les commandes clients utilisables

`GET /orders` — émis par `src/services/dolibarr/http.ts · listOrders`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `limit` | constante | `src/services/dolibarr/http.ts · listOrders` | `1000` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran Administration · Dolibarr affiche l'erreur ; aucun projet n'est créé.

> Deux filtres, tous deux côté client. Le statut : seules 1 (validée) et 2 (en cours) sont retenues — un brouillon n’engage rien, une annulée n’engage plus, une livrée est close. Et `billed` : une commande entièrement facturée n’a plus rien à consommer, et le projet qu’on ouvrirait dessus ne serait jamais facturé. Une commande partiellement facturée reste proposée : c’est le cas courant d’une prestation en cours.

### Lire une commande client et ses lignes

`GET /orders/{orderId}` — émis par `src/services/dolibarr/http.ts · getOrder`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `orderId` | identifiant externe | `src/services/dolibarr/commande.ts · creerProjetDepuisCommande, attachOrderLine` | `42` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran affiche le refus ; rien n'est créé ni écrit.

> `ref_client` porte la référence du bon de commande du client — le champ que le lot 2b reporte sur le projet. Il est nul sur la plupart des commandes, et `ref_customer` en est l’alias sur certaines versions. La commande ne porte **pas** le nom du tiers, seulement `socid` : le titre du projet le résout par `GET /thirdparties`.

### Lister les projets facturables au temps consommé

`GET /projects` — émis par `src/services/dolibarr/http.ts · listProjects`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `limit` | constante | `src/services/dolibarr/http.ts · listProjects` | `1000` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran de reprise affiche l'erreur ; aucune correspondance n'est proposée.

Réglage tiers : `usage_bill_time du projet (« Facturer le temps consommé »)`.

> Dolibarr rend tous les projets ; le filtre sur `usage_bill_time` est appliqué localement par le client. Un projet non facturable au temps n’a aucune tâche où pousser.

### Relire le projet créé pour connaître la référence attribuée

`GET /projects/{projectId}` — émis par `src/services/dolibarr/http.ts · createProject`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `projectId` | identifiant externe | `identifiant rendu par POST /projects` | `12` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran affiche le refus, alors que le projet, lui, a bien été créé.

> La référence (`PJxxxx-nnnn`) est attribuée par Dolibarr : la relire évite qu’un refus ultérieur nomme un projet sous une référence inventée.

### Lire les contacts déjà posés sur le projet

`GET /projects/{projectId}/contacts` — émis par `src/services/dolibarr/http.ts · createProject, assignerAuProjet`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `projectId` | identifiant externe | `projet Dolibarr de la mission` | `179` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-19, sur l'instance du porteur.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran affiche le refus ; aucune affectation n'est tentée.

> **Lue avant d'écrire, parce que l'affectation n'est pas idempotente.** `CommonObject::add_contact()` rend `0` quand le contact est déjà posé, et `addToContact` traduit ce `0` en **500 sans message**. Constaté sur l'instance du porteur le 21 août 2026 : la seconde affectation du même utilisateur au projet 179 a échoué ainsi. On lit donc les contacts existants et on saute l'écriture si le rôle est déjà là.

### Lister les tâches d un projet, pour y retrouver une prestation

`GET /projects/{projectId}/tasks` — émis par `src/services/dolibarr/http.ts · listTasks`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `projectId` | identifiant externe | `ExternalLink (mission → projet), posé par src/services/dolibarr/import.ts` | `3` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Rejoué par la file de synchronisation. L'écran de synchronisation compte l'échec ; la file rejoue.

> La tâche est retrouvée par son libellé avant d’être créée : voir `POST /tasks`.

### Relire une propale pour en reprendre les lignes

`GET /proposals/{proposalId}` — émis par `src/services/dolibarr/http.ts · getProposal`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `proposalId` | saisie | `référence de propale saisie au rattachement d'un engagement` | `7` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran de rattachement affiche que la propale est introuvable.

> `subprice` est relu en euros et converti en centimes (× 100) par le client. Appelée par `src/services/dolibarr/propal.ts` pour reprendre les lignes d'un engagement, après contrôle que la propale appartient bien au tiers rattaché au client de la mission.

### Lire une constante de configuration de l instance

`GET /setup/conf/{constante}` — émis par `src/services/dolibarr/http.ts · getSetupValue`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `constante` | constante | `src/services/dolibarr/setup.ts — SOCIETE_FISCAL_MONTH_START, TIMESHEET_DAY_DURATION` | `TIMESHEET_DAY_DURATION` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Toléré — l'état visé est déjà atteint. L'écran de reprise ne propose simplement pas la valeur.

Réglage tiers : `SOCIETE_FISCAL_MONTH_START`, `TIMESHEET_DAY_DURATION`.

> La route n’existe pas sur toutes les versions : un 404 vaut « constante non lisible ici », jamais « instance en panne ». Le 403 est tolere de meme — `/setup` est reserve aux administrateurs, et une cle portee par un utilisateur ordinaire ne doit pas faire tomber l’ecran pour une valeur facultative. La valeur arrive nue ou enveloppée dans `value`.

### Relire une tâche par son identifiant

`GET /tasks/{taskId}` — émis par `src/services/dolibarr/http.ts · getTask`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `taskId` | identifiant externe | `ExternalLink (prestation → tâche), posé par src/services/dolibarr/taches.ts` | `34` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-19, sur l'instance du porteur.

En échec : Abandonné — le rejouer donnerait le même refus. La prestation est traitée comme si sa tâche n'existait plus, et une nouvelle est ouverte à la place.

> Une correspondance mémorisée ne se juge pas sur la liste du projet : celle-ci ne rend les tâches qu'aux utilisateurs qui ont un rôle sur le projet, et une tâche existante peut donc en disparaître. Un 404 est toléré et signifie « supprimée chez Dolibarr », auquel cas la correspondance est abandonnée. La charge prévue est relue au passage : c'est d'elle que la reprise tire les jours vendus.

### Lire les contacts déjà posés sur la tâche

`GET /tasks/{taskId}/contacts` — émis par `src/services/dolibarr/http.ts · createTask`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `taskId` | identifiant externe | `tâche Dolibarr de la prestation` | `317` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran affiche le refus ; aucune affectation n'est tentée.

> Même raison que côté projet : l'affectation n'est pas idempotente chez Dolibarr.

### Relire les temps consommés pour identifier la ligne créée

`GET /tasks/{taskId}/timespent` — émis par `src/services/dolibarr/http.ts · addTimeSpent, listTimeSpent`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `taskId` | identifiant externe | `ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts` | `17` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-19, sur l'instance du porteur.

En échec : Abandonné — le rejouer donnerait le même refus. La cellule reste en échec dans l'écran de synchronisation, en disant que le temps est bien parti mais qu'il ne pourra pas être modifié depuis l'application.

> Appelée juste après `addtimespent`, qui ne rend qu'un accusé `{success:{code,message}}` sans identifiant de ligne — vérifié dans le code de l'API Dolibarr, en 23.0.1 comme en 23.0.4. La ligne posée est retrouvée par sa signature (utilisateur, durée, note) et son `timespent_line_id` est mémorisé : sans lui, aucune modification ultérieure de la cellule ne serait possible.

### Lister les tiers connus de Dolibarr

`GET /thirdparties` — émis par `src/services/dolibarr/http.ts · listThirdparties`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `limit` | constante | `src/services/dolibarr/http.ts · listThirdparties` | `1000` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran Administration · Dolibarr affiche l'erreur ; rien n'est mis en file.

Réglage tiers : `drapeau « Client » du tiers`.

> Un 404 signifie « collection vide » et rend une liste vide, jamais une panne. Dolibarr rend tous les tiers ; le client ne garde que ceux dont le drapeau `client` vaut 1 ou 3. Un fournisseur, un prospect seul ou un tiers neutre n’a pas de mission et ne recevra jamais de temps.

### Lire un utilisateur Dolibarr pour lui attribuer les temps repris

`GET /users/{userId}` — émis par `src/services/dolibarr/http.ts · getUser`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `userId` | identifiant externe | `timespent_line_fk_user des temps lus sur la tâche` | `1` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-19, sur l'instance du porteur.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran de reprise indique que l'auteur du temps n'a pas pu être identifié, et le temps est écarté plutôt que attribué à quelqu un d autre.

> Appelée une fois par auteur rencontré, pas une fois par temps. L'utilisateur local créé à partir de cette lecture naît **sans mot de passe** : il ne peut pas se connecter — `verify('')` lève et le refus est le comportement par défaut — il n'existe que pour porter l'attribution jusqu'à ce que les rôles arrivent.

### Créer un projet facturable au temps depuis une commande

`POST /projects` — émis par `src/services/dolibarr/http.ts · createProject`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `ref` | calcul | `src/core/dolibarr/commande.ts · referenceProjetDepuisCommande` | `CO-EXEMPLE` |
| `title` | saisie | `src/core/dolibarr/commande.ts · titreProjetDepuisCommande` | `BDC-EXEMPLE — Libellé de la commande` |
| `socid` | identifiant externe | `socid de la commande, via src/services/dolibarr/commande.ts` | `7` |
| `ref_ext` | saisie | `src/core/dolibarr/commande.ts · referenceExterneCommande` | `BDC-EXEMPLE` |
| `description` | saisie | `src/services/dolibarr/commande.ts · creerProjetDepuisCommande` | `Ouvert depuis la commande CO-EXEMPLE.` |
| `usage_task` | constante | `src/services/dolibarr/http.ts · createProject` | `1` |
| `usage_bill_time` | constante | `src/services/dolibarr/http.ts · createProject` | `1` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-19, sur l'instance du porteur.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran affiche le refus ; aucune correspondance locale n'est posée.

> `ref` est **obligatoire** : l’interface de Dolibarr la fabrique par son module de numérotation, son API non — elle refuse par « Bad Request: ref field missing ». Jamais préfixée `PJ`, qui est celui de sa séquence automatique. `usage_task` et `usage_bill_time` sont imposés et non paramétrables : sans eux le projet n’accepte ni tâche ni temps facturable, et `listProjects` le filtrerait aussitôt. Dolibarr rend un entier nu.

### Affecter l'utilisateur de la clé au projet, comme chef de projet

`POST /projects/{projectId}/contacts` — émis par `src/services/dolibarr/http.ts · createProject, assignerAuProjet`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `fk_socpeople` | réglage | `ExternalLink de type LIEN_UTILISATEUR, renseigné dans Mon profil` | `7` |
| `type_contact` | constante | `PROJECTLEADER, code de llx_c_type_contact pour l'élément « project »` | `PROJECTLEADER` |
| `source` | constante | `internal : fk_socpeople désigne alors un utilisateur Dolibarr, pas un contact de tiers` | `internal` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran affiche le refus. Le projet existe, mais ses tâches resteront invisibles à la clé tant que l'affectation n'est pas posée.

> **C'est l'appel qui rend le projet lisible à la clé qui vient de le créer.** Sur un projet non public, `Task::getTasksArray()` écarte toute tâche dont le projet ne rend aucun rôle à l'utilisateur (`getUserRolesForProjectsOrTasks`). Le filtre porte sur le **projet**, pas sur la tâche, et ne joue que si le projet est privé. Sans cette affectation, `GET /projects/{id}/tasks` revient vide, le connecteur croit la tâche absente, la recrée, et Dolibarr refuse par « Error creating task ». Omis quand aucun identifiant d'utilisateur n'est configuré.

### Créer la tâche qui portera les temps d une ligne de mission

`POST /tasks` — émis par `src/services/dolibarr/http.ts · createTask`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `fk_project` | identifiant externe | `ExternalLink (mission → projet), posé par src/services/dolibarr/import.ts` | `3` |
| `label` | calcul | `libellé de la ligne de mission, src/services/dolibarr/push.ts` | `Consultant ITSM` |
| `planned_workload` | calcul | `src/core/dolibarr/timespent.ts · chargePrevueEnSecondes — jours vendus de la prestation × durée de journée résolue` | `126000` |
| `ref` | calcul | `libellé de la ligne de mission, src/services/dolibarr/push.ts` | `Consultant ITSM` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Rejoué par la file de synchronisation. L'écran de synchronisation compte l'échec ; la file rejoue.

> `ref` reçoit le même libellé que `label`. Dolibarr rend un entier nu. `status: 1` est **obligatoire** : sans lui la tâche naît en brouillon (`Task::STATUS_DRAFT = 0`) et reste inexploitable dans le projet. `planned_workload` est envoyée en **secondes** — unité vérifiée dans `projet/tasks/task.php`, qui la compose en `heures × 3600 + minutes × 60` et la relit par `convertSecondToTime` ; elle est omise quand la prestation ne vend rien de chiffré, une charge inconnue ne valant pas une charge nulle.

### Pousser un temps consommé sur une tâche

`POST /tasks/{taskId}/addtimespent` — émis par `src/services/dolibarr/http.ts · addTimeSpent`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `taskId` | identifiant externe | `ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts` | `17` |
| `date` | calcul | `src/core/dolibarr/timespent.ts · buildTimeSpentPayloads` | `2026-04-13` |
| `duration` | calcul | `src/core/dolibarr/timespent.ts · buildTimeSpentPayloads — minutes × 60, en secondes` | `28800` |
| `user_id` | réglage | `ExternalLink de type LIEN_UTILISATEUR, renseigné dans Mon profil` | `42` |
| `note` | saisie | `commentaire de la saisie de temps` | `Atelier de cadrage` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Rejoué par la file de synchronisation. L'écran de synchronisation compte l'échec ; la file rejoue avec recul progressif.

Réglage tiers : `TIMESHEET_DAY_DURATION`.

> `duration` est un nombre de secondes. TIMESHEET_DAY_DURATION ne change que la lecture jour/heure dans Dolibarr, jamais la valeur envoyée.

### Affecter l'utilisateur de la clé à la tâche, comme responsable

`POST /tasks/{taskId}/contacts` — émis par `src/services/dolibarr/http.ts · createTask`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `fk_socpeople` | réglage | `ExternalLink de type LIEN_UTILISATEUR, renseigné dans Mon profil` | `7` |
| `type_contact` | constante | `TASKEXECUTIVE, code de llx_c_type_contact pour l'élément « project_task »` | `TASKEXECUTIVE` |
| `source` | constante | `internal : fk_socpeople désigne un utilisateur Dolibarr` | `internal` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran affiche le refus ; la tâche existe mais n'est affectée à personne.

> Miroir de PROJECTLEADER côté projet : la même personne pilote le projet et ses tâches. Omis quand aucun identifiant d'utilisateur n'est configuré.

### Créer le tiers qui correspond à un client local

`POST /thirdparties` — émis par `src/services/dolibarr/http.ts · createThirdparty`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `name` | saisie | `Client.name, via src/services/dolibarr/import.ts · pushClientToDolibarr` | `Client Exemple` |
| `client` | constante | `src/services/dolibarr/http.ts · createThirdparty` | `1` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran de reprise affiche le refus ; aucun lien de correspondance n'est posé.

> Dolibarr rend un entier nu, pas un objet : c'est l'identifiant du tiers créé.

### Rattacher la commande au projet créé

`PUT /orders/{orderId}` — émis par `src/services/dolibarr/http.ts · linkOrderToProject`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `orderId` | identifiant externe | `src/services/dolibarr/commande.ts · creerProjetDepuisCommande` | `42` |
| `fk_project` | identifiant externe | `identifiant du projet créé` | `12` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Toléré — l'état visé est déjà atteint. L'écran annonce que le projet existe mais que la commande n'a pas pu y être rattachée, et invite à faire le lien dans Dolibarr.

> Seul `fk_project` est envoyé. C’est la seule écriture de l’application sur un document commercial, et c’est elle qui fait remonter la référence du bon de commande jusqu’à la facture. Renvoyer la commande entière la ferait réenregistrer telle que l’API l’a rendue.

### Corriger un temps déjà poussé

`PUT /tasks/{taskId}/timespent/{timespentId}` — émis par `src/services/dolibarr/http.ts · updateTimeSpent`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `taskId` | identifiant externe | `ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts` | `17` |
| `timespentId` | identifiant externe | `ExternalLink (cellule de saisie → temps passé), src/services/dolibarr/push.ts` | `91` |
| `date` | calcul | `src/core/dolibarr/timespent.ts · buildTimeSpentPayloads` | `2026-04-13` |
| `duration` | calcul | `src/core/dolibarr/timespent.ts · buildTimeSpentPayloads — minutes × 60, en secondes` | `25200` |
| `note` | saisie | `commentaire de la saisie de temps` | `Atelier de cadrage` |

Prouvé contre Dolibarr 23.0.1 le 2026-08-16, contre le double d’API.

En échec : Rejoué par la file de synchronisation. L'écran de synchronisation compte l'échec ; la file rejoue.

Réglage tiers : `TIMESHEET_DAY_DURATION`.

> Mêmes paramètres que le push, moins `user_id` : Dolibarr ne réattribue pas la ligne.

## Google Calendar

Base : `https://www.googleapis.com/calendar/v3`

### Retirer un bloc qui n a plus lieu d être

`DELETE /calendars/{calendarId}/events/{eventId}` — émis par `src/integrations/google/calendar.ts · deleteEvent`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `calendarId` | identifiant externe | `ProviderCredential.calendarId` | `cal-exemple@group.calendar.google` |
| `eventId` | identifiant externe | `ExternalLink (saisie → événement), posé par src/services/sync/flush.ts` | `evt-exemple` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Toléré — l'état visé est déjà atteint. Rien. Un événement déjà disparu est un objectif atteint.

> Le connecteur avale NOT_FOUND — 404 comme 410. Toute autre erreur remonte.

### Relire le partage déjà posé sur le calendrier dédié

`GET /calendars/{calendarId}/acl` — émis par `src/integrations/google/calendar.ts · assurerLibreOccupePublic (appelée par ensureDedicatedCalendar)`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `calendarId` | identifiant externe | `calendrier dédié résolu par ensureDedicatedCalendar dans le même appel` | `cal-exemple@group.calendar.google.com` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. Le retour de consentement annule la connexion et invite à recommencer.

> Relue avant d’écrire : une portée `default` déjà présente ne doit pas être reposée à chaque connexion.

### Relire un bloc pour savoir s il a été touché à la main

`GET /calendars/{calendarId}/events/{eventId}` — émis par `src/integrations/google/calendar.ts · getEvent`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `calendarId` | identifiant externe | `ProviderCredential.calendarId` | `cal-exemple@group.calendar.google` |
| `eventId` | identifiant externe | `ExternalLink (saisie → événement), posé par src/services/sync/flush.ts` | `evt-exemple` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Rejoué par la file de synchronisation. L'écran de synchronisation compte l'échec ; la file rejoue.

> Un événement `status: cancelled` revient en 200 ; le connecteur le traite en NOT_FOUND, sans quoi une suppression passerait pour une simple modification.

### Retrouver l adresse du compte connecté, pour l inviter à ses propres blocs

`GET /calendars/primary` — émis par `src/integrations/google/calendar.ts · getPrimaryCalendarEmail`

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. Le retour de consentement annule la connexion et invite à recommencer.

> L'identifiant du calendrier `primary` est littéralement l'adresse du compte — aucun scope supplémentaire à demander, `calendar` la couvre déjà. Sans cette adresse, les blocs partent sans invité et le libre/occupé du compte ne les porte jamais.

### Retrouver le calendrier dédié parmi ceux de l utilisateur

`GET /users/me/calendarList` — émis par `src/integrations/google/calendar.ts · ensureDedicatedCalendar`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `maxResults` | constante | `src/integrations/google/calendar.ts · ensureDedicatedCalendar` | `250` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. Le retour de consentement annule la connexion et invite à recommencer.

> Le calendrier dédié est retrouvé par son libellé (`CRA — disponibilités`), pas par un identifiant stocké : un identifiant perdu se retrouve, un libellé renommé se recrée.

### Envoyer l utilisateur donner son consentement

`GET https://accounts.google.com/o/oauth2/v2/auth` — émis par `src/integrations/google/oauth.ts · buildConsentUrl`

Redirection du navigateur — jamais émise par le serveur.

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `client_id` | réglage | `client OAuth d’instance, saisi dans Administration · Google` | `exemple.apps.googleusercontent.com` |
| `redirect_uri` | réglage | `client OAuth d’instance, saisi dans Administration · Google — recomparée par Google au caractère près` | `http://localhost:3000/api/…` |
| `response_type` | constante | `src/integrations/google/oauth.ts` | `code` |
| `scope` | constante | `src/integrations/google/oauth.ts · SCOPES` | `…/auth/calendar` |
| `access_type` | constante | `offline — pour obtenir un jeton de rafraîchissement` | `offline` |
| `prompt` | constante | `consent — sans quoi une reconnexion ne rend aucun jeton de rafraîchissement` | `consent` |
| `state` | calcul | `jeton anti-rejeu posé par la route de connexion` | `etat-factice` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. Le retour de consentement affiche l'échec sans conseiller de réessayer.

Réglage tiers : `URI de redirection autorisées dans la console Google Cloud`.

> Redirection du navigateur, jamais émise par le serveur : hors du test de route et du test de couverture (D3).

### Créer le calendrier dédié quand il n existe pas encore

`POST /calendars` — émis par `src/integrations/google/calendar.ts · ensureDedicatedCalendar`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `summary` | constante | `src/services/google/connect.ts · CALENDRIER_DEDIE` | `CRA — disponibilités` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. Le retour de consentement annule la connexion et invite à recommencer.

> Jamais l'agenda principal : le calendrier dédié est masquable d'un clic et effaçable d'un geste, ce qui est la condition pour que l'application ait le droit d'y écrire.

### Ouvrir la disponibilité du calendrier dédié à tout le monde, y compris hors du domaine

`POST /calendars/{calendarId}/acl` — émis par `src/integrations/google/calendar.ts · assurerLibreOccupePublic (appelée par ensureDedicatedCalendar)`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `calendarId` | identifiant externe | `calendrier dédié résolu par ensureDedicatedCalendar dans le même appel` | `cal-exemple@group.calendar.google.com` |
| `role` | constante | `src/integrations/google/calendar.ts — freeBusyReader, jamais davantage` | `freeBusyReader` |
| `scope.type` | constante | `src/integrations/google/calendar.ts — default, pour couvrir l’extérieur du domaine` | `default` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. Le retour de consentement annule la connexion et invite à recommencer.

> Sans cette règle, un calendrier secondaire fraîchement créé reste privé : les blocs qu’il porte, même marqués `opaque`, restent invisibles à quiconque d’autre que son propriétaire — vidant de son sens l’intention du lot 0.

### Poser un bloc de disponibilité dans le calendrier dédié

`POST /calendars/{calendarId}/events` — émis par `src/integrations/google/calendar.ts · createEvent`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `calendarId` | identifiant externe | `ProviderCredential.calendarId, posé au consentement par ensureDedicatedCalendar` | `cal-exemple@group.calendar.google` |
| `summary` | calcul | `src/core/calendar/event.ts · buildCalendarEvent` | `Client Exemple · Conseil` |
| `start.dateTime` | calcul | `src/core/calendar/event.ts — heure locale naïve, sans décalage` | `2026-04-13T09:00:00` |
| `start.timeZone` | réglage | `Settings.timeZone, lu par src/services/sync/flush.ts` | `Europe/Paris` |
| `transparency` | constante | `src/core/calendar/event.ts` | `opaque` |
| `colorId` | calcul | `src/core/calendar/event.ts — COULEUR_REALISE ou COULEUR_PREVISIONNEL` | `9` |
| `extendedProperties.private.craEntryId` | identifiant externe | `identifiant de la saisie locale — sert à retrouver le bloc` | `entry-exemple` |
| `attendees[].email` | identifiant externe | `ProviderCredential.ownerEmail, lu au consentement par getPrimaryCalendarEmail` | `compte-exemple@gmail.com` |
| `sendUpdates (paramètre de requête)` | constante | `src/integrations/google/calendar.ts — none, l’invité est le compte qui écrit` | `none` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Rejoué par la file de synchronisation. L'écran de synchronisation compte l'échec ; la file rejoue.

> Une heure locale naïve sans `timeZone` est refusée par Google : l'instant n'existe pas sans fuseau. L'invité n'est autre que le compte connecté : un calendrier secondaire ne fusionne jamais dans le libre/occupé interrogé sous `primary`, mais un événement où ce compte figure comme invité y compte, quel que soit le calendrier organisateur.

### Interroger les plages occupées des agendas de l utilisateur

`POST /freeBusy` — émis par `src/integrations/google/calendar.ts · freeBusy`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `timeMin` | calcul | `src/services/availability.ts — instant absolu RFC 3339` | `2026-04-13T00:00:00Z` |
| `timeMax` | calcul | `src/services/availability.ts — instant absolu RFC 3339` | `2026-04-14T00:00:00Z` |
| `items[].id` | identifiant externe | `calendriers de l'utilisateur, moins le calendrier dédié` | `principal@exemple.test` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran de disponibilités annonce que l'agenda n'a pas pu être interrogé.

> L'exclusion du calendrier dédié vit dans le connecteur, sans quoi les blocs posés entreraient en conflit avec eux-mêmes.

### Obtenir puis renouveler l autorisation d accès à l agenda

`POST https://oauth2.googleapis.com/token` — émis par `src/integrations/google/oauth.ts · exchangeCode, refreshAccessToken`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `client_id` | réglage | `client OAuth d’instance, saisi dans Administration · Google` | `exemple.apps.googleusercontent.com` |
| `client_secret` | réglage | `client OAuth d’instance, saisi dans Administration · Google — chiffré au repos, jamais journalisé` | `valeur-factice` |
| `redirect_uri` | réglage | `client OAuth d’instance, saisi dans Administration · Google — se termine par /api/google/callback` | `http://localhost:3000/api/…` |
| `grant_type` | constante | `authorization_code au consentement, refresh_token au renouvellement` | `refresh_token` |
| `code` | saisie | `code rendu par la redirection de consentement` | `code-factice` |
| `refresh_token` | identifiant externe | `ProviderCredential, chiffré au repos par CREDENTIALS_KEY` | `jeton-factice` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Abandonné — le rejouer donnerait le même refus. L'écran de synchronisation annonce une autorisation expirée et propose de reconnecter.

Réglage tiers : `Scopes accordés au client OAuth dans la console Google Cloud`.

> Corps de formulaire obligatoire : du JSON sur cette route reçoit un `invalid_request`. Une seule entrée pour les deux `grant_type` — l'identité d'une entrée est le couple méthode et chemin (D2).

### Corriger un bloc déjà posé, sans changer son identifiant

`PUT /calendars/{calendarId}/events/{eventId}` — émis par `src/integrations/google/calendar.ts · updateEvent`

| Paramètre | Source | D'où vient la valeur | Exemple |
|---|---|---|---|
| `calendarId` | identifiant externe | `ProviderCredential.calendarId` | `cal-exemple@group.calendar.google` |
| `eventId` | identifiant externe | `ExternalLink (saisie → événement), posé par src/services/sync/flush.ts` | `evt-exemple` |
| `summary` | calcul | `src/core/calendar/event.ts · buildCalendarEvent` | `Client Exemple · Conseil` |
| `start.dateTime` | calcul | `src/core/calendar/event.ts — heure locale naïve, sans décalage` | `2026-04-13T09:00:00` |
| `start.timeZone` | réglage | `Settings.timeZone, lu par src/services/sync/flush.ts` | `Europe/Paris` |
| `attendees[].email` | identifiant externe | `ProviderCredential.ownerEmail, lu au consentement par getPrimaryCalendarEmail` | `compte-exemple@gmail.com` |
| `sendUpdates (paramètre de requête)` | constante | `src/integrations/google/calendar.ts — none, l’invité est le compte qui écrit` | `none` |

Prouvé contre Google Calendar API v3 le 2026-08-16, contre le double d’API.

En échec : Rejoué par la file de synchronisation. L'écran de synchronisation compte l'échec ; la file rejoue.

> Mise à jour plutôt que suppression puis recréation, pour garder l’identifiant (arbitrage du porteur du 16 août). L’etag rendu sert à détecter une divergence. Porte les mêmes invités que la création : sans quoi une mise à jour retirerait silencieusement le compte connecté de ses propres blocs.

## Suivre les évolutions d'un système tiers

1. Le catalogue dit contre quelle version chaque appel a été prouvé, et à quelle date.
   L'environnement du porteur est aujourd'hui **Dolibarr 23.0.1**.
2. Le lot 2 avait prévu un test d'intégration automatique sur **instance jetable**. Il
   **n'a pas été livré** : le dépôt ne porte ni configuration vitest séparée, ni suite
   `*.integration.ts`, ni script npm pour la lancer. Ne pas citer une commande qui
   n'existe pas.
3. Ce qui tient lieu de preuve contre une instance réelle est une **recette manuelle**,
   conduite le 18 août 2026 contre l'instance du porteur et consignée dans
   `docs/superpowers/reviews/2026-08-18-recette-dolibarr.md`. Les entrées qui en
   viennent portent `moyen: 'INSTANCE_PORTEUR'` ; les autres sont prouvées contre le
   double d'API, qui prouve la forme de l'appel et non le comportement du serveur.
4. Après une montée de version, rejouer cette recette contre la nouvelle instance.
5. Ce qui passe **met à jour sa version et sa date dans le catalogue**
   (`src/integrations/dolibarr/catalogue.ts`, champ `preuve`). Ce qui casse est
   **nommé avec l'appel et le champ fautifs**, jamais résumé en « la synchronisation ne
   marche plus ».
6. Régénérer le chapitre : `npm run doc:integrations`.

C'est ce qui transforme « je crois que ça marche encore » en « c'est prouvé contre telle
version, à telle date ».

## Les réglages tiers qui changent le sens des données

### `TIMESHEET_DAY_DURATION`

Réglé à **7 heures** chez le porteur, quand le réglage local par défaut est de 480
minutes.

**Ce réglage ne rend aucun temps faux.** `duration` est un nombre de secondes : huit
heures travaillées valent 28 800 secondes quelle que soit sa valeur. Compenser ferait
passer huit heures pour sept.

Ce qu'il change est **la lecture jour/heure dans Dolibarr** : huit heures s'y lisent
« 1,14 jour ». Cela s’aligne ; cela ne se compense pas. L’écran Administration ·
Dolibarr propose la reprise (`previewDolibarrSetup`), qui n'écrit rien sans décision, et
ne touche jamais un CRA validé.

### `SOCIETE_FISCAL_MONTH_START`

Réglé à **4** chez le porteur — exercice d'avril à mars. Il déplace les bornes de
l'objectif de chiffre d'affaires. Même écran, même règle : proposé, jamais imposé.
