# Lot 4 — Automatisations

**Date :** 2026-08-15
**Statut :** design proposé, non relu par le porteur du produit
**Prérequis :** lot 1a livré. Les automatisations utiles supposent les lots 1b, 2 et 3.

---

## 1. Intention

Supprimer les gestes qui reviennent tous les mois : penser à saisir, penser à clôturer, penser à relancer, penser à pousser.

**Ce lot n'ajoute aucune fonctionnalité métier.** Il déclenche au bon moment des transitions et des traitements qui existent déjà, et qui restent tous accessibles à la main. C'est sa limite et sa garantie.

---

## 2. Le partage avec n8n

Décision posée dès le lot 0 et non rouverte : **API directe pour l'interactif, n8n pour l'asynchrone.**

Pour un enregistrement de CRA synchrone, passer par n8n ajouterait une latence, un point de panne et dégraderait la gestion d'erreur. En revanche, un rappel de fin de mois ou un enchaînement validation → push sont exactement ce à quoi il sert.

**Mais n8n n'est jamais exigé.** L'application expose des endpoints de déclenchement et un ordonnanceur interne minimal ; n8n, un cron système ou un bouton peuvent les appeler. Rendre l'automatisation dépendante d'un ordonnanceur externe retirerait au produit son autoportance, qui est sa condition de départ.

---

## 3. Un ordonnanceur, pas une collection de scripts

Une table `ScheduledJob` déclare les traitements récurrents : nom, expression de récurrence, dernière exécution, prochaine échéance, état.

Un endpoint unique `POST /api/jobs/tick`, protégé par jeton, réveille l'ordonnanceur : il exécute les travaux échus et rend un compte-rendu. Appelé toutes les cinq minutes par n'importe quel déclencheur externe, il suffit à tout.

**Un travail qui échoue ne bloque pas les autres.** Chacun a son état, son compteur de tentatives et son dernier message d'erreur, consultables dans un écran d'exploitation.

**Chaque travail est exécutable à la main** depuis cet écran. Un automatisme qu'on ne peut pas déclencher soi-même est un automatisme qu'on ne peut pas déboguer.

---

## 4. Les travaux

| Travail | Déclenchement | Effet |
|---|---|---|
| **Vidage de la file de sortie** | toutes les 5 min | pousse vers Google et Dolibarr — c'est le travail introduit par le lot 1b, ici seulement ordonnancé |
| **Rappel de saisie** | jour configurable | signale les jours ouvrés du mois en cours sans aucune saisie |
| **Rappel de clôture** | fin de mois | signale les CRA encore en `BROUILLON` sur le mois écoulé |
| **Relance de signature** | quotidien | relance les CRA `ENVOYÉ` au-delà du délai — lot 3 |
| **Rafraîchissement des signatures** | quotidien | interroge le statut des CRA `ENVOYÉ`, rattrape les webhooks perdus |
| **Purge des conflits résolus** | hebdomadaire | nettoie la file d'arbitrage du lot 1b |

**Aucun de ces travaux ne convertit du prévisionnel en réalisé, ne valide un CRA, ni ne modifie une saisie.** Ils signalent et ils poussent ; ils ne décident pas. La règle du lot 0 — la conversion n'est jamais automatique — n'admet pas d'exception, surtout pas depuis un traitement de fond.

---

## 5. Les notifications

Un canal en v1 : **le courriel**, par la configuration SMTP existante.

Un modèle par type de rappel, en français, et une préférence par travail : activé ou non, et à quelle adresse.

**Pas de notification pour ce qui n'appelle aucune action.** Un rappel qu'on apprend à ignorer est pire qu'une absence de rappel.

---

## 6. Ce que n8n apporte en plus

Rien n'est requis, mais l'endpoint et les webhooks ouvrent la porte à ce que l'application n'a pas vocation à faire :

- publier un message dans un canal d'équipe à la validation d'un CRA ;
- alimenter un tableau de bord externe ;
- enchaîner vers un outil de facturation tiers.

**Ces flux vivent dans n8n, pas dans l'application.** C'est précisément la frontière qui empêche le produit de devenir une plateforme d'intégration.

---

## 7. Règles métier

- **Aucun automatisme ne convertit du prévisionnel en réalisé.**
- **Aucun automatisme ne valide un CRA.** Seuls un geste humain ou un retour de signature le font.
- **Chaque travail est déclenchable à la main.**
- **Un travail en échec n'en bloque aucun autre.**
- **n8n n'est jamais exigé** ; l'application fonctionne sans lui.
- **Pas de notification sans action possible.**

---

## 8. Hors périmètre

- **Notifications poussées, SMS, messageries instantanées.** Le courriel d'abord ; le reste passe par n8n si le besoin apparaît.
- **Règles d'automatisation configurables par l'utilisateur.** Une liste de travaux en dur, activables. Un moteur de règles serait un produit dans le produit.
- **Ordonnancement à la seconde.** La granularité est celle du réveil externe.

---

## 9. Tests

- **L'ordonnanceur** : un travail échu s'exécute, un travail non échu ne s'exécute pas, un travail en échec n'empêche pas les suivants.
- **Idempotence** : deux réveils rapprochés n'exécutent pas deux fois le même travail.
- **Aucun travail ne modifie une saisie ni un statut de CRA** — c'est le test qui protège la règle centrale du produit, et il doit couvrir chaque travail.
- **Les rappels ne partent que lorsqu'il y a quelque chose à signaler.**
- **Chaque travail est déclenchable manuellement** et rend le même résultat qu'en ordonnancé.
- **Sans configuration SMTP**, l'ordonnanceur tourne et consigne au lieu d'échouer.

---

## 10. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Un ordonnanceur interne réveillé par un endpoint**, plutôt que des flux n8n autonomes.
- **Courriel seul en v1.**
- **Liste de travaux en dur**, sans moteur de règles.
- **Aucun automatisme ne franchit une transition de CRA**, y compris la clôture d'un mois entièrement saisi.
