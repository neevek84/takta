# Lot 2 — Connecteur Dolibarr

**Date :** 2026-08-15
**Statut :** design proposé, non relu par le porteur du produit
**Prérequis :** lot 1a livré. Réutilise l'infrastructure de synchronisation du lot 1b (voir §3).

---

## 1. Intention

Cesser la double saisie. Les tiers, les projets et les engagements vivent déjà dans Dolibarr ; les temps consommés doivent y retourner sans qu'on les retape.

**Le rôle de l'application s'arrête au CRA validé.** Ce lot pousse les temps réalisés dans Dolibarr et rien d'autre : c'est Dolibarr qui facture. La réglementation française sur la facturation électronique est un domaine mouvant, délibérément hors produit.

### Le connecteur est additif, jamais exclusif

Dolibarr configuré **n'impose rien**. Créer un client, une mission, une ligne ou un CRA à la main reste possible en permanence. Un objet créé localement peut être rattaché plus tard à son équivalent Dolibarr, ou y être poussé.

Toute référence externe est nullable, à tout moment, pour toute entité. C'est ce qui préserve l'autoportance, qui est la condition de départ du produit.

---

## 2. Sens de la synchronisation

**Unidirectionnel. L'application reste maître du CRA.**

| | Lecture | Écriture |
|---|---|---|
| Tiers | `GET /thirdparties` | `POST /thirdparties` |
| Projets | `GET /projects`, filtrés sur `usage_bill_time = 1` | — |
| Engagements | lignes de `GET /proposals/{id}` | — |
| Temps réalisé | — | `POST /tasks/{id}/addtimespent` |

**Jamais de prévisionnel vers Dolibarr.** Du temps prévu n'est pas du temps consommé et n'a rien à faire dans une facture. Cette règle ne vaut que pour Dolibarr : vers l'agenda, le prévisionnel est au contraire le cas d'usage principal.

**Aucun appel de facturation.** Le connecteur s'arrête au push des temps.

---

## 3. Réutilisation de l'infrastructure du lot 1b

Le lot 1b introduit deux mécanismes **génériques par construction**, et ce lot les réutilise au lieu d'en fabriquer une seconde version :

- **`SyncOutbox`** porte déjà un champ `provider`. Le push vers Dolibarr emprunte la même file, le même recul progressif, le même écran de synchronisation.
- **`ProviderCredential`** stocke la clé d'API Dolibarr chiffrée au repos, comme les jetons Google.
- **`ExternalLink`** porte déjà les correspondances par `(entityType, entityId, provider)`.

**Si le lot 2 est construit avant le lot 1b**, ces trois mécanismes migrent dans ce lot et le 1b les consomme. Ils sont conçus pour être indépendants du fournisseur — c'est délibéré, et c'est ce qui rend l'ordre des deux lots libre.

---

## 4. Correspondances

| Objet local | Objet Dolibarr | Remarque |
|---|---|---|
| `Client` | tiers (`socid`) | rattachable ou créable |
| `Mission` | projet | filtré sur `usage_bill_time = 1` |
| `MissionLine` | **tâche** du projet | créée automatiquement si absente |
| `User` | utilisateur Dolibarr | requis : `llx_projet_task_time` porte un `fk_user` |

**Le temps s'attache à une tâche, pas à un projet.** Une ligne de prestation ne se mappe donc pas sur un projet seul. Le connecteur pointe une tâche existante ou en crée une au premier push. Non traité, ce point se paie en bugs deux semaines après la mise en service.

---

## 5. Source de l'engagement

Réglée **par ligne de prestation** : `MANUEL` · `DOLIBARR_PROPALE` · `DOLIBARR_PROJET`.

L'administration ne fixe qu'un **défaut**. Un réglage global empêcherait d'avoir une mission issue d'une propale et une autre saisie à la main — ce qui doit rester possible.

Sur une ligne en `DOLIBARR_PROPALE`, les jours vendus et le TJM sont lus depuis la ligne de propale : quantité et prix unitaire. Ils deviennent alors **non modifiables dans l'application**, avec un lien vers la propale — deux sources de vérité pour le même chiffre finissent toujours par diverger.

---

## 6. Le push

**Déclencheur : le passage du CRA à `VALIDE`.** C'est la transition qui inscrit dans la file de sortie tous les temps réalisés du mois pour la mission concernée.

Rouvrir un CRA puis le revalider réinscrit les temps ; la correspondance `ExternalLink` garantit une mise à jour et non un doublon.

**Ce qui part** : les lignes `REALISE` du couple *(mission, mois)*, converties en secondes — l'unité de `llx_projet_task_time` — depuis les minutes stockées. La conversion utilise le `minutesParJour` de la ligne, et **la valeur configurée dans Dolibarr peut différer** (voir §8).

---

## 7. Import initial

Un écran d'administration qui liste les tiers et les projets de Dolibarr, et permet de les rattacher à des objets locaux existants ou d'en créer.

Volontairement manuel : un import automatique aveugle produirait des doublons sur une base qui contient déjà des clients saisis à la main.

---

## 8. Reprise des réglages Dolibarr

Deux constantes relevées sur l'instance cible sont lisibles par API et méritent d'être proposées à la reprise plutôt que ressaisies :

| Constante | Valeur observée | Réglage local correspondant |
|---|---|---|
| `SOCIETE_FISCAL_MONTH_START` | `4` — exercice avril → mars | `debutExerciceMois` |
| `TIMESHEET_DAY_DURATION` | `7` heures | `minutesParJour` (420) |

**Le second est un piège actif.** Le lot 0 est parti sur 480 minutes par défaut quand Dolibarr compte 420 : sans alignement, un jour ne vaut pas la même chose des deux côtés, et les temps poussés seront faux d'un septième. L'écran de connexion doit signaler l'écart et proposer l'alignement, pas se contenter de l'afficher.

---

## 9. Règles métier

- **Aucune facturation, jamais.** Le connecteur s'arrête au push des temps.
- **Jamais de prévisionnel vers Dolibarr.**
- **Le connecteur est additif** : tout reste créable et modifiable localement sans lui.
- **Une ligne en `DOLIBARR_PROPALE` a ses jours vendus et son TJM en lecture seule** localement.
- **Le push est déclenché par la validation du CRA**, jamais par une saisie individuelle.
- **Une panne Dolibarr ne bloque jamais la saisie** ni la validation d'un CRA : la file de sortie absorbe l'indisponibilité.
- **Les identifiants sont chiffrés au repos.**

---

## 10. Hors périmètre

- **Facturation**, sous toutes ses formes. Définitivement.
- **Relecture des temps depuis Dolibarr.** L'application est maître ; une modification faite dans Dolibarr est écrasée au prochain push.
- **Synchronisation des congés, des notes de frais, des contrats.**
- **Passage par n8n pour le chemin interactif.** n8n peut appeler l'endpoint de vidage de la file, comme un cron, mais n'est jamais exigé.

---

## 11. Tests

- **Connecteur contre un double de l'API Dolibarr** — aucun test n'appelle l'instance réelle.
- **Conversion minutes → secondes** avec un `minutesParJour` local différent de celui de Dolibarr : c'est le calcul le plus susceptible d'être faux en silence.
- **Création automatique de la tâche** au premier push, et absence de doublon au second.
- **Rouvrir puis revalider un CRA met à jour**, ne duplique pas.
- **Aucun prévisionnel ne part** : un mois mêlant réalisé et prévu ne pousse que le réalisé.
- **Une ligne en `DOLIBARR_PROPALE` refuse la modification locale** de ses jours vendus et de son TJM.
- **Une panne Dolibarr laisse la saisie et la validation fonctionnelles**, et la file rejoue au rétablissement.
- **Un test d'intégration sur instance jetable**, exécuté à part du reste de la suite.

---

## 12. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Le push se déclenche à la validation du CRA**, et non en continu à chaque saisie. Dolibarr ne reçoit donc que du temps arrêté.
- **Les jours vendus et le TJM d'une ligne issue d'une propale sont en lecture seule** dans l'application.
- **L'import initial est manuel**, écran de rattachement plutôt qu'aspiration automatique.
- **Une modification faite directement dans Dolibarr est écrasée** au push suivant, sans file d'arbitrage — contrairement à Google Calendar. Dolibarr n'est pas un outil qu'on manipule au quotidien comme un agenda, et une file d'arbitrage de plus coûterait davantage qu'elle ne rapporterait.
