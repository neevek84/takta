# Lot 1c — Surface mobile

**Date :** 2026-08-15
**Statut :** design proposé, non relu par le porteur du produit
**Prérequis :** lot 1a livré

---

## 1. Intention

Permettre de noter sa journée **en sortant de chez le client**, au pouce, en deux tapes.

Le cas d'usage n'est pas « faire son CRA sur mobile » — c'est capter la saisie au moment où elle est fraîche, pour ne pas reconstituer trois semaines de mémoire un dimanche soir.

### La grille mensuelle ne passe pas sur un téléphone

Trente et une colonnes sur 375 pixels, et surtout la **sélection par glissement** — le geste qui fait toute la rapidité de la saisie — n'existe pas au doigt. Du responsive sur cette grille produirait quelque chose de techniquement mobile et concrètement inutilisable.

Le mobile reçoit donc un **modèle d'interaction distinct**, pas une mise en page adaptée. C'est le point structurant de ce lot.

---

## 2. Deux surfaces, un seul cœur

**Des routes distinctes, pas de détection de terminal.** Le mobile vit sous `/m`, le desktop conserve ses routes actuelles. Le manifeste de la PWA pointe son `start_url` sur `/m` : installée sur le téléphone, l'application ouvre directement la surface mobile ; ouverte au navigateur sur un poste, elle sert l'interface habituelle.

Ce choix évite le reniflage d'agent utilisateur, qui se trompe, et le rendu des deux interfaces avec masquage CSS, qui gaspille. Il a un coût assumé : un lien partagé depuis un poste vers un téléphone ouvre la mauvaise surface. Un bandeau discret propose de basculer.

**Aucune logique n'est dupliquée.** Les deux surfaces consomment les mêmes services et le même `core/` — elles ne sont que des composants de présentation.

---

## 3. Ce que le mobile fait

### Saisir — la vue du jour

Écran d'accueil : **aujourd'hui**. Les lignes de prestation actives, chacune avec trois boutons larges : **Matin · Après-midi · Journée**. Une tape sur la ligne, une tape sur la quantité, c'est enregistré.

Navigation d'un jour à l'autre par balayage horizontal, plus un retour à aujourd'hui.

Le contrôle de capacité s'applique à l'identique — c'est le même service. Un dépassement affiche l'avertissement sous la ligne, sans bloquer.

### Voir la semaine

Sept colonnes tiennent sur un téléphone. La vue semaine sert à vérifier et à corriger, pas à saisir en masse : une tape sur une cellule ouvre la même sélection de quantité que la vue du jour.

### Consulter

L'engagement par ligne — `vendu · réalisé · prévu · restant` — et la barre d'exercice avec le reste à vendre. En lecture seule : ce sont des chiffres qu'on consulte entre deux rendez-vous, pas qu'on modifie au pouce.

---

## 4. Ce qui reste sur le poste

L'administration, la création de clients, de missions et de lignes, la clôture de mois, la matrice de charge complète, et la file d'arbitrage du lot 1b.

Ce ne sont pas des écrans qu'on ouvre au téléphone. Les porter coûterait autant que tout le reste du lot pour un usage qui n'aura pas lieu.

---

## 5. La PWA

Un manifeste, une icône, un `service worker` minimal qui met en cache la coquille de l'application — de quoi obtenir l'installation sur l'écran d'accueil et un démarrage instantané.

**Le fonctionnement hors ligne n'est pas dans ce lot.** Il demande une file de saisies locales, une résolution de conflits au retour du réseau, et une gestion de l'identité déconnectée : c'est un sujet en soi, qui mérite sa propre spec une fois l'usage mobile éprouvé.

Bénéfice collatéral : une PWA s'installe aussi sur un poste depuis le navigateur. Pour qui héberge l'application quelque part, c'est déjà l'expérience « application installée » sans aucun empaquetage.

---

## 6. Règles métier

Aucune nouvelle. Le mobile est une seconde surface au-dessus de règles déjà écrites et déjà testées :

- contrôle de capacité identique, avec ses trois modes ;
- week-ends et jours fériés saisissables, jamais bloquants ;
- un mois dont le CRA est validé refuse l'écriture, y compris au pouce ;
- conversion du prévisionnel jamais automatique.

Si une règle devait diverger entre les deux surfaces, ce serait le signe qu'elle est implémentée au mauvais endroit.

---

## 7. Hors périmètre

- **Hors ligne** — sujet en soi, à traiter séparément.
- **Notifications poussées.**
- **Application native.** Une PWA suffit ici, et un build par plateforme coûterait sans rien apporter.
- **Saisie par créneau au pouce** au-delà de matin / après-midi / journée. La nuit et les créneaux personnalisés restent sur poste.

---

## 8. Tests

- **Composants de saisie mobile** contre des doubles de services : deux tapes produisent bien la ligne de temps attendue.
- **Le contrôle de capacité remonte à l'écran mobile** comme sur poste — même service, même verdict, même avertissement.
- **Un mois verrouillé refuse la saisie mobile.**
- **Le manifeste et le `service worker`** : l'application s'installe et démarre sans réseau sur sa coquille.
- **Aucune règle métier n'est réimplémentée** : une recherche dans `src/app/m/` ne doit trouver aucun calcul de capacité, d'engagement ou de conversion d'unité.

---

## 9. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Routes séparées sous `/m`** plutôt que détection de terminal ou responsive à masquage.
- **Trois quantités seulement** au pouce : matin, après-midi, journée. Les lignes facturées à l'heure saisissent une durée au clavier numérique.
- **Consultation en lecture seule** sur mobile, jamais de modification de mission ni de réglage.
- **Hors ligne exclu**, malgré son intérêt évident pour l'usage décrit.
