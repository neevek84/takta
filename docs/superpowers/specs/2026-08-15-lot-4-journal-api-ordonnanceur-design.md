# Lot 4 — Journal de preuve, API d'événements et ordonnanceur

**Date :** 2026-08-15
**Statut :** design en cours d'arbitrage avec le porteur du produit
**Prérequis :** lot 1a livré. Les automatisations utiles supposent les lots 1b, 2 et 3.
**Remplace** une première version, écartée : elle faisait de l'application un client de n8n. L'inversion est meilleure — l'application **expose**, les outils consomment.

---

## 1. Intention

Trois besoins que l'on croyait distincts, et qui n'en font qu'un.

**Une trace probante** derrière chaque CRA validé : qui a saisi quoi, qui a validé, quand.
**Une intégration ouverte**, consommable par n8n aujourd'hui et par autre chose demain.
**Une supervision** : ce qui a tourné, ce qui a échoué, ce qui attend.

Ces trois besoins se servent de la même chose : **un journal en ajout seul**. C'est la décision structurante de ce lot.

**Ce lot n'ajoute aucune fonctionnalité métier.** Il consigne, il expose, et il déclenche au bon moment des traitements qui existent déjà — tous restant accessibles à la main.

---

## 2. Le journal de preuve

### En ajout seul, et chaîné

`AuditEvent` n'est **jamais modifié, jamais supprimé**. Chaque entrée porte :

| Champ | Sens |
|---|---|
| `seq` | numéro d'ordre, strictement croissant |
| `occurredAt` | horodatage |
| `actorId`, `actorLabel` | l'auteur ; `SYSTEME` pour un traitement de fond |
| `action` | `SAISIE_CREEE` · `CRA_VALIDE` · `CRA_ROUVERT` · `TEMPS_POUSSES` · `REGLAGE_MODIFIE` … |
| `entityType`, `entityId` | la cible |
| `payloadJson` | ce qui a changé, en résumé |
| `prevHash`, `hash` | le chaînage |

`hash` est l'empreinte du contenu de l'entrée **et de `prevHash`**. Modifier une ligne ancienne casse toutes les suivantes, et cela se voit.

**C'est ce qui distingue une preuve d'un historique.** Sans la chaîne, une ligne réécrite ne laisse aucune trace — et un journal qu'on peut retoucher n'atteste de rien. Le module de journalisation inaltérable de Dolibarr repose sur le même principe ; le coût est d'une fonction de hachage.

Une commande de vérification recalcule la chaîne et signale la première rupture.

### Ce qui est consigné

Tout ce qui engage : création, modification et suppression d'une saisie ; toute transition de CRA ; le push des temps ; la création d'une facture demandée à Dolibarr ; l'envoi en signature et le retour signé ; toute modification de réglage ; tout réétalonnage.

**Ce qui n'est pas consigné :** les consultations. Un journal qui enregistre les lectures se noie et cesse d'être lisible.

---

## 3. L'API d'événements

**L'application expose, elle n'appelle personne.** C'est l'inversion qui rend l'outil intégrable par n8n, par un script, ou par ce qui remplacera n8n.

### Lecture — le rattrapage

```
GET /api/events?since=<seq>&limit=<n>
```

Renvoie les entrées du journal postérieures à `seq`, dans l'ordre. Un consommateur mémorise le dernier `seq` traité et reprend où il s'était arrêté. **Aucun événement ne se perd**, même après une panne du consommateur de plusieurs jours — c'est l'avantage décisif du modèle par tirage sur une notification poussée.

Protégée par un jeton dédié, distinct de la session utilisateur.

### Poussée — l'immédiateté

Des URL de rappel configurables reçoivent chaque événement en `POST`, **signé** par empreinte de la charge utile. Filtrables par type d'action.

Un échec est réessayé avec recul progressif puis abandonné : **la poussée est un confort, la lecture est la garantie.** Un consommateur qui a raté une poussée la retrouve toujours par `since`.

### Ce que cela permet, sans que l'application ait à le savoir

Envoyer un courriel avec ton compte Google, publier dans un canal d'équipe, alimenter un tableau de bord, enchaîner vers un outil tiers. **Ces flux vivent chez le consommateur, pas dans l'application** — c'est la frontière qui l'empêche de devenir une plateforme d'intégration.

---

## 4. L'ordonnanceur

Une table `ScheduledJob` déclare les traitements récurrents : nom, récurrence, dernière exécution, prochaine échéance, état.

Un endpoint `POST /api/jobs/tick`, protégé par jeton, réveille l'ordonnanceur : il exécute les travaux échus et rend un compte rendu. Appelé toutes les cinq minutes par n'importe quel déclencheur, il suffit à tout.

**Un travail qui échoue ne bloque pas les autres.** Chacun porte son état, son compteur de tentatives et son dernier message d'erreur.

**Chaque travail est exécutable à la main.** Un automatisme qu'on ne peut pas déclencher soi-même est un automatisme qu'on ne peut pas déboguer.

### Les travaux

| Travail | Récurrence | Effet |
|---|---|---|
| **Vidage de la file de sortie** | 5 min | pousse vers Google et Dolibarr — travail du lot 1b, ici ordonnancé |
| **Distribution des rappels sortants** | 5 min | envoie les événements aux URL configurées |
| **Rappel de saisie** | configurable | signale les jours ouvrés du mois sans aucune saisie |
| **Rappel de clôture** | fin de mois | signale les CRA encore en brouillon sur le mois écoulé |
| **Relance de signature** | quotidien | relance les CRA envoyés au-delà du délai — lot 3 |
| **Rafraîchissement des signatures** | quotidien | rattrape les retours de signature perdus |
| **Vérification de la chaîne du journal** | quotidien | recalcule les empreintes et alerte à la première rupture |

**Aucun de ces travaux ne convertit du prévisionnel en réalisé, ne valide un CRA, ni ne modifie une saisie.** Ils signalent, ils poussent, ils consignent — ils ne décident pas. La règle du lot 0 n'admet pas d'exception, surtout pas depuis un traitement de fond.

---

## 5. L'écran de supervision

Un seul écran, qui répond à « qu'est-ce qui s'est passé, et qu'est-ce qui ne va pas ».

**En tête, ce qui demande une action** : travaux en échec, éléments abandonnés dans la file de sortie, conflits d'agenda non arbitrés, CRA en souffrance de signature, rupture de chaîne du journal. Si rien ne cloche, l'écran le dit.

**En dessous, l'historique** : le journal, filtrable par action, par entité et par période, avec le détail de chaque entrée.

**Et l'état des travaux** : dernière exécution, prochaine échéance, dernière erreur, et un bouton d'exécution immédiate pour chacun.

Les avertissements vivent **dans l'outil**, pas seulement dans un courriel qu'on n'a pas lu.

---

## 6. Le courriel

**L'envoi de courriel n'est pas le métier de cette application.** Avec l'API d'événements, un consommateur s'en charge bien mieux : n8n dispose de gabarits, de relances, et de ton compte Google déjà autorisé.

Un **envoi SMTP minimal reste intégré** pour l'autoportance : sans aucun outil externe, les rappels doivent partir. Un gabarit par type, en français, et une préférence par travail.

**Sa configuration peut être pré-remplie depuis Dolibarr** — serveur, port et adresse d'expédition sont lisibles par API. Le secret d'authentification, lui, se saisit une fois localement : il ne sort pas de Dolibarr, et c'est normal.

**Une limitation à connaître :** l'API REST de Dolibarr ne permet pas d'envoyer un courriel générique. Elle sait expédier une facture, et le module de mailing gère des campagnes — rien qui corresponde à « envoie ce message à cette adresse ». Déléguer l'envoi à Dolibarr n'est donc pas possible, seule la reprise de sa configuration l'est.

**Pas de notification pour ce qui n'appelle aucune action.** Un rappel qu'on apprend à ignorer est pire qu'une absence de rappel.

---

## 7. Règles métier

- **Le journal est en ajout seul et chaîné.** Aucune écriture ne le modifie, aucune suppression ne l'ampute.
- **Les consultations ne sont pas consignées.**
- **Aucun automatisme ne convertit du prévisionnel en réalisé.**
- **Aucun automatisme ne valide un CRA.** Seuls un geste humain ou un retour de signature le font.
- **Chaque travail est déclenchable à la main**, et un échec n'en bloque aucun autre.
- **La lecture des événements est la garantie ; la poussée est un confort.**
- **L'application n'appelle aucun outil externe pour s'intégrer** : elle expose.
- **Pas de notification sans action possible.**

---

## 8. Hors périmètre

- **Signature cryptographique du journal par clé asymétrique.** Le chaînage rend la modification détectable ; l'horodatage qualifié relève d'un autre métier.
- **Purge ou archivage du journal.** Il croît ; à quelques milliers d'entrées par an, ce n'est pas un problème avant longtemps.
- **Règles d'automatisation configurables** dans l'application. Une liste de travaux en dur, activables. Un moteur de règles serait un produit dans le produit — et l'API existe précisément pour ça.
- **Notifications poussées, SMS, messageries instantanées.** Elles passent par un consommateur de l'API.
- **Ordonnancement à la seconde.** La granularité est celle du réveil externe.

---

## 9. Tests

- **Le journal est inviolable en écriture** : aucune fonction publique ne permet de modifier ni de supprimer une entrée.
- **La chaîne se vérifie**, et une modification directe en base est **détectée à la bonne entrée** — c'est le test qui fait du journal une preuve plutôt qu'un historique.
- **`seq` est strictement croissant**, y compris sous écritures concurrentes.
- **`GET /api/events?since=` ne perd aucun événement** et n'en rend jamais deux fois le même.
- **Une charge utile de rappel mal signée est rejetée** par un consommateur de test.
- **Un rappel en échec est réessayé puis abandonné**, sans jamais bloquer l'ordonnanceur.
- **L'ordonnanceur** : un travail échu s'exécute, un travail non échu ne s'exécute pas, un travail en échec n'empêche pas les suivants, deux réveils rapprochés n'exécutent pas deux fois le même travail.
- **Aucun travail ne modifie une saisie ni un statut de CRA** — à couvrir travail par travail, c'est la règle centrale du produit.
- **Sans configuration SMTP**, l'ordonnanceur tourne et consigne au lieu d'échouer.
- **Isolation par utilisateur** sur la lecture du journal, comme partout ailleurs.

---

## 10. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Le journal est chaîné par empreinte**, pas seulement en ajout seul.
- **Les consultations ne sont pas consignées.**
- **La lecture des événements se fait par tirage** (`since`), la poussée n'étant qu'un confort.
- **Aucun automatisme ne franchit une transition de CRA**, y compris la clôture d'un mois entièrement saisi.
- **Un envoi SMTP minimal reste intégré** malgré l'API, pour préserver l'autoportance.
- **Liste de travaux en dur**, sans moteur de règles configurable.
