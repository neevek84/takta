# Décisions

Ce qui a le plus de valeur dans six mois n'est pas ce que le code fait — cela se
lit — mais **pourquoi il a été fait ainsi**. Une décision qu'on ne comprend plus
finit par être défaite par accident.

Pour installer et exploiter, voir [README.md](../README.md). Pour l'architecture
et les règles de codage, [reprise-du-code.md](reprise-du-code.md). Pour les
appels aux systèmes tiers, [integrations.md](integrations.md).

---

## 1. Ce qu'est ce produit

Une application de **compte-rendu d'activité** pour consultant indépendant,
aussi simple à l'usage que Timizer, qui gère en plus le **prévisionnel adossé à
un engagement contractuel**. Trois états jamais confondus — vendu, prévu,
réalisé — et un document mensuel qui fait foi.

**Autoportante.** Elle fonctionne intégralement sans aucun système tiers.
Dolibarr, Google Agenda et la signature électronique sont des connecteurs
**optionnels et additifs** : sans aucun d'eux, la saisie, le calcul, le PDF et la
validation marchent entièrement.

Porteur du produit : Keveen Plante, KREATIV PROJECT MANAGEMENT SASU.

---

## 2. Les décisions qui ne se rouvrent pas

Prises explicitement, elles coûteraient cher à défaire.

| Décision | Pourquoi |
|---|---|
| **L'application est le produit, Dolibarr le back-office** | Un module Dolibarr reproduirait la cause de mort du module `dolibarr_project_timesheet` : du PHP couplé au cycle de release, maintenu par une seule personne |
| **L'application ne facture pas** | Toute la charge réglementaire reste chez le logiciel de gestion. Elle lui pousse les temps consommés et s'arrête là |
| **Mono-organisation, pas de multi-tenant** | Porter une clé de tenant inutilisée pollue chaque requête, pour toujours |
| **L'engagement est porté par la ligne de prestation, pas par la mission** | Une propale se découpe en lignes facturables distinctes (`Consultant ITSM 30j@800€`, `Consultant ITSM Nuit 10j@1200€`) : c'est la ligne qui porte un prix et un volume |
| **Synchronisation unidirectionnelle** | L'application est maître du CRA. Le bidirectionnel est là où ce type d'outil meurt |
| **La conversion prévisionnel → réalisé n'est jamais automatique** | Ce serait du temps engageant créé sans décision humaine |
| **Une saisie porte son facteur de conversion, figé à l'écriture** | Un CRA validé est un document signé ; son contenu ne peut pas changer après signature |
| **Pas de portail client** | Le client reçoit un document et le signe. Tout un sous-système disparaît |
| **Aucun montant sur le CRA** | Le document atteste du temps, pas d'une somme |

### La facture, décision affinée en cours de route

« L'application ne facture pas » portait au départ une nuance : *elle peut
demander à Dolibarr de créer une facture*. Cette capacité a été **retirée**, et
la raison mérite d'être retenue.

Dolibarr porte déjà ce flux depuis ses propres écrans : on coche les temps
consommés d'un projet, on lance « Facturer », et chaque ligne passe de
« Facturée : Non » à la référence de la facture. La demande émise par
l'application créait une facture **parallèle**, que Dolibarr ne reliait à rien —
si bien que les temps poussés restaient refacturables. Vérifié : **l'API REST
n'expose pas l'action de facturation depuis les temps**, elle ne sait que créer
une facture nue.

Une intégration qui produit un objet correct mais non relié est pire qu'une
intégration absente : elle donne le sentiment que le travail est fait.

---

## 3. Arbitrages rendus en cours de route

**Déconnexion Google : honnête plutôt qu'à moitié.** On ne révoque pas le jeton
côté Google — on le **dit clairement à l'écran**. Une révocation qui échoue à
moitié laisse l'utilisateur croire qu'il a repris ses accès alors qu'il ne l'a
pas fait.

**L'écran de supervision attend son journal.** Il ne portera pas sa propre table
d'historique : deux sources de vérité sur le même sujet divergent toujours.

**Mise à jour d'événement, pas suppression puis recréation.** Garder
l'identifiant d'un événement d'agenda, c'est garder ce que l'utilisateur y a
attaché de son côté.

**Le bouton « sauvegarder » a été écarté**, et sa raison vaut d'être gardée. Il
s'agissait de sortir du temps réel : un bouton qui déclencherait Google et
Dolibarr d'un coup. Or **la synchronisation n'est déjà pas en temps réel** — la
file ne part qu'au drainage, et elle dédoublonne par cible. Le bouton n'aurait
donc rien gagné, tout en créant du travail perdable et en ramenant le
clic-qui-enregistre qu'on avait justement retiré. À rouvrir si l'usage le
demande.

**`ownerScope` dans la contrainte d'unicité de `ProviderCredential`, et pourquoi
`NULL` ne pouvait pas jouer ce rôle.** Une clé d'API Dolibarr appartient à
l'instance, un jeton Google à une personne. La tentation était de laisser
`userId` à `NULL` pour les lignes d'instance. **C'est faux, pour une raison déjà
apprise au lot 0** : `NULL` n'est jamais égal à `NULL`, et une contrainte
d'unicité ne mord donc pas sur lui. Deux clés d'instance `(NULL, 'DOLIBARR')`
auraient coexisté sans que rien ne le signale. La distinction passe par une
colonne `ownerScope` (`USER` / `INSTANCE`) qui **entre dans la contrainte**, et
une ligne d'instance porte `userId = ''`.

L'autre solution envisagée — un compte `User` conventionnel pour l'instance — a
été écartée : un faux compte devrait être filtré par tous les écrans qui listent
des utilisateurs, et se ferait oublier une fois sur deux.

---

## 4. L'environnement du porteur

- **Client OAuth Google existant**, réutilisable pour le calendrier en y ajoutant
  le scope. Pas de nouveau projet Google Cloud à créer.
- **Documenso auto-hébergé** pour la signature électronique.
- **n8n** disponible : **consommateur** de l'API d'événements, jamais une
  dépendance. Si n8n s'arrête, l'application ne s'en aperçoit pas.
- **Identité de marque**, relevée sur `kreativpm.fr` : crème `#FAF5ED`, encre
  `#342820`, accent or `#D4943F`, **Manrope** 800 et **Inter**. La remarque qui
  compte : *le bleu du thème Dolibarr n'est pas l'identité* — ce que le
  back-office affiche n'a rien à dire sur ce que le produit doit être.

**Les réglages de l'instance Dolibarr ne sont pas repris ici.** Ils vivent dans
[integrations.md](integrations.md), qui est **engendré depuis le code**. Les
dupliquer ici recréerait exactement le mensonge que ce document cherche à éviter :
deux versions du même fait, dont une seule est tenue à jour.

---

## 5. Dettes connues, non bloquantes

Aucune n'empêche l'usage. Toutes sont des choix de ne pas payer maintenant.

- **`today` est dérivé de l'heure UTC**, pas locale. Saisir à 00 h 30 fait croire
  à l'application qu'on est la veille. Demande un utilitaire de fuseau
  centralisé.
- **Le middleware edge laisse passer une session orpheline** : il ne consulte pas
  la base, seule la page le fait.
- **`month` n'est pas validé côté service** : `'2026-13'` est accepté et
  interprété comme janvier 2027.
- **Une ligne archivée portant du réalisé reste affichée** dans la matrice de
  charge. Voulu — son chiffre d'affaires est un fait comptable — mais à arbitrer
  côté affichage.
- **`theme.ts` importe `readSettingsRow`** : le layout racine tire donc toujours,
  transitivement, les jours fériés.
- **La grille fait 1364 px sur 31 jours**, conséquence de la cible tactile de
  44 pt : défilement horizontal systématique sur téléphone. La vue calendrier y
  répond.
- **Le balayage des couples de contraste ne couvre pas tout** : une encre d'état
  sur un fond hors des quatre fonds de texte, `link` / `onAccent` / `onDark`
  posés seuls, un fond porté par une variable.
- **Le glissement au doigt n'est prouvé par aucun test.** Sa moitié mécanisable
  l'est — `releasePointerCapture` est couvert et la mutation tombe — mais ce
  qu'aucun test ne peut prouver reste entier : **que le geste fonctionne sur un
  appareil**. À essayer sur un téléphone.
- **Docker et Postgres n'ont jamais été exécutés** dans cet environnement. Des
  garde-fous statiques détectent la dérive du schéma et de la configuration de
  déploiement ; le chemin complet reste à éprouver.
- **L'archive portable n'a été construite et éprouvée que pour macOS Apple
  Silicon.** Les trois autres plateformes demandent un passage sur la machine
  correspondante.
- **`arreter.sh` sonde encore le port en IPv4 seulement** pour juger de la
  disponibilité au démarrage : un programme tiers qui n'écoute qu'en IPv6 reste
  invisible. L'arrêt, lui, ne dépend plus du port.
- **Trois vulnérabilités npm transitives** via `next`, sur des surfaces de
  construction.
- **`manifest.webmanifest` et `icon.svg` portent les couleurs en dur.** Ce sont
  des fichiers statiques servis tels quels, hors de portée du système de jetons :
  qui change le thème garde l'icône d'origine sur son écran d'accueil. Le
  `themeColor` du document, lui, suit bien le thème enregistré.

---

## 6. Où lire le détail

Les **specs** (`docs/superpowers/specs/`) et les **plans**
(`docs/superpowers/plans/`) portent le raisonnement complet de chaque lot :
alternatives pesées, arbitrages, tests prévus. Ce sont des **documents de
travail** — datés, écrits avant l'implémentation, **jamais tenus à jour ensuite**.
Ils disent ce qu'on croyait au moment de les écrire.

Ils ne sont pas résumés ici, et c'est délibéré : un résumé de document de travail
est un troisième état de la vérité. En cas de contradiction avec le code, **le
code a raison**.
