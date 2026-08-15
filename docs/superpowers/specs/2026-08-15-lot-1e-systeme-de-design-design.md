# Lot 1e — Système de design

**Date :** 2026-08-15
**Statut :** design proposé, non relu par le porteur du produit
**Position :** **avant le lot 1c.** Ce dernier reconstruit entièrement la surface de saisie ; la bâtir contre un système existant coûte moins cher que la restyler après.

---

## 1. Intention

L'application est fonctionnelle et laide. Les agents ont produit du Tailwind par défaut — bordures grises, aucune hiérarchie, aucune identité — parce qu'on ne leur avait jamais donné autre chose.

Ce lot donne à l'outil **l'identité de KreativPM**, et surtout une grammaire visuelle que toute construction ultérieure peut suivre sans réfléchir.

---

## 2. L'identité, relevée à la source

Extraite des styles réellement appliqués sur `kreativpm.fr`, et non d'une intention supposée :

| Rôle | Valeur | Usage sur le site |
|---|---|---|
| Fond | `#FAF5ED` | fond de page, crème chaud |
| Encre | `#342820` | texte principal, brun profond |
| Encre profonde | `#2A211A` | surfaces sombres |
| Accent | `#D4943F` | or/ambre, couleur des titres |
| Accent foncé | `#B57730` | états survolés |
| Beige | `#D8CFBF` | séparateurs, surfaces secondaires |
| Gris neutre | `#5F5E5A` | texte secondaire |
| Titres | **Manrope**, graisse 800 | |
| Texte | **Inter** | |

**Le bleu du thème Dolibarr n'est pas ton identité.** C'est un thème d'ERP configuré une fois ; il n'apparaît nulle part sur le site. Il est écarté.

---

## 3. Le problème que pose cette palette, et sa résolution

**`#D4943F` sur `#FAF5ED` donne un contraste de 2,38:1.** Le minimum lisible pour du texte est 4,5:1.

Cet or fonctionne sur un site vitrine, en très gros titres. Il **ne peut pas servir de couleur de texte** dans une application où l'on lit des chiffres dans des cellules de trente pixels. Le reprendre tel quel produirait une interface jolie en capture d'écran et illisible à l'usage.

La résolution :

- **L'encre est le brun `#342820`** — **13,15:1** sur le crème, confortable sur de longues sessions.
- **L'or est réservé aux aplats** : boutons pleins, cellules remplies, barres de progression, où il porte du blanc ou du brun profond.
- **Le texte interactif est `#8C5A23`**, un or assombri à **5,37:1**. `#B57730`, la couleur de survol du site, ne donne que **3,42:1** : elle échouerait à la règle des 4,5:1 posée juste en dessous. Elle reste utilisable pour les bordures et l'anneau de focus, où le seuil est de 3:1.
- **Le survol d'un bouton plein inverse ses couleurs au lieu de les assombrir.** Un or assombri ne porte plus son encre qu'à 4,24:1 ; l'inversion tient à 14,53:1.
- **Tout jeton est vérifié par calcul de contraste**, pas à l'œil. Les valeurs ci-dessus sont calculées, non estimées.

---

## 4. Ce que la marque ne fournit pas

Une palette de site vitrine ne porte aucune couleur d'état. Or l'application en a besoin, et ce sont elles qui portent le sens :

| État | Où il sert |
|---|---|
| Succès | CRA validé, synchronisation réussie |
| Avertissement | capacité dépassée, dépassement d'engagement |
| Danger | mois verrouillé, échec, conflit à arbitrer |
| Information | prévisionnel, valeur héritée |

Elles doivent être **choisies dans la famille chaude** de la marque, désaturées vers l'ocre et le terracotta. Un rouge Tailwind par défaut sur un fond crème jure immédiatement et fait ressembler l'application à deux produits collés.

**Le prévisionnel se distingue du réalisé sans recourir à la couleur seule** — hachures ou opacité — parce que la distinction porte du sens et qu'un daltonien doit la percevoir.

---

## 5. Les jetons

Une seule source, exposée en **variables CSS** et consommée par Tailwind. Aucune couleur en dur dans un composant : une valeur écrite à la main est une valeur qu'on ne pourra ni changer ni thématiser.

Couleurs, échelle d'espacement, rayons, ombres, et une échelle typographique **plus resserrée que celle d'un site vitrine** : une grille de saisie a besoin de densité, pas de respiration.

Manrope et Inter sont **embarquées**, pas chargées depuis un service tiers — l'application doit fonctionner sans réseau sortant, et le mode portable du lot 5 l'impose.

---

## 6. Le thème est paramétrable

L'identité KreativPM est le **défaut**, pas une fatalité. Quelqu'un d'autre qui déploie cette application doit pouvoir mettre ses couleurs.

**Les couleurs vivent dans les réglages**, en JSON lu et écrit en bloc — comme les créneaux et les fériés, et pour la même raison de portabilité. À l'affichage, elles sont injectées en variables CSS sur la racine. C'est ce qui rend le changement immédiat, sans reconstruction.

Un écran d'administration expose la palette, avec deux préréglages : **KreativPM** et un **neutre** sobre pour qui ne veut pas de couleur de marque. Plus un retour au défaut, en un geste.

### L'éditeur refuse ce qui serait illisible

C'est le point qui compte, et il transforme une règle de conception en garde-fou vivant.

**À l'enregistrement, chaque couple texte/fond est vérifié par calcul.** Sous 4,5:1, la palette est refusée avec le couple fautif nommé et le rapport obtenu — pas un avertissement qu'on clique pour passer outre.

Sans cette barrière, offrir un thème revient à offrir le moyen de rendre l'application inutilisable, et l'or de la marque elle-même en est la démonstration : il donne 2,4:1 sur le crème, et c'est exactement le genre de choix qu'un utilisateur ferait de bonne foi.

**Les polices ne sont pas paramétrables.** Autoriser une police arbitraire imposerait de l'embarquer ou de la charger d'un service tiers, ce que le mode portable interdit. Manrope et Inter restent.

---

## 7. Les composants

Le strict nécessaire, tiré de ce que les écrans utilisent déjà : bouton avec ses variantes et son état de chargement, champ de saisie avec libellé et message d'erreur, liste déroulante, case à cocher, carte, tableau dense, badge d'état, bandeau d'alerte, boîte de dialogue de confirmation, et l'ossature de page avec sa navigation.

**Aucun composant qu'aucun écran n'utilise.** Une bibliothèque conçue pour l'avenir se remplit de choses mortes.

---

## 8. L'application aux écrans existants

Connexion, saisie, missions, CRA, plan de charge, administration. Tous reprennent les jetons et les composants.

**Trois endroits demandent plus qu'un remplacement de classes**, parce que la couleur y porte du sens :

**La grille de saisie** — jours ouvrés, week-ends, fériés, réalisé, prévisionnel, dépassement de capacité. Six états sur une même cellule.

**La matrice de charge** — densité, lisibilité des marges, et une barre d'exercice qui doit rester juste en cas de dépassement.

**Les badges de statut de CRA** — brouillon, envoyé, validé, refusé. Quatre états qui doivent se distinguer d'un coup d'œil, sans dépendre de la seule teinte.

---

## 9. Règles

- **Aucune couleur en dur** dans un composant ; tout passe par un jeton.
- **Les couleurs sont paramétrables**, les polices non.
- **Une palette dont un couple texte/fond descend sous 4,5:1 est refusée à l'enregistrement**, pas seulement signalée.
- **Tout couple texte/fond atteint 4,5:1**, vérifié par calcul.
- **L'or n'est jamais une couleur de texte** sur le crème.
- **Aucune information n'est portée par la seule couleur.**
- **Les polices sont embarquées**, jamais chargées d'un service tiers.
- **Cible tactile d'au moins 44 points** partout — le lot 1c en dépend.
- **Un état de focus visible** sur tout élément interactif. Le supprimer pour l'esthétique rend l'application inutilisable au clavier.

---

## 10. Hors périmètre

- **Thème sombre.** Une palette crème et brun s'y transpose mal, et ce n'est pas le besoin.
- **Animations et transitions élaborées.**
- **Refonte de l'architecture des écrans.** Ce lot habille ce qui existe ; il ne redessine pas les parcours. Le seul parcours qui change est celui du lot 1c, et il arrive après.

---

## 11. Tests

- **Le contraste est vérifié par calcul**, pas à l'œil : un test parcourt les couples de jetons texte/fond et échoue sous 4,5:1. C'est le seul moyen d'empêcher la dérive au fil des ajouts.
- **L'éditeur de thème refuse une palette illisible** : enregistrer l'or de la marque en couleur de texte sur le crème est rejeté, avec le couple et le rapport nommés.
- **Un thème enregistré s'applique sans reconstruction** et survit à un redémarrage.
- **Le retour au défaut** restaure exactement la palette KreativPM.
- **Aucune couleur en dur** dans les composants : une recherche de valeurs hexadécimales et de classes de couleur Tailwind brutes ne remonte rien hors de la définition des jetons.
- **Les états de la grille se distinguent sans la couleur** — vérifié en simulant une vision monochrome.
- **Les cibles tactiles atteignent 44 points** sur une largeur de 375 pixels.
- **Le focus est visible** sur chaque élément interactif, et un parcours complet au clavier reste possible sur la page de saisie.
- **Les polices se chargent sans réseau sortant.**
- **Les tests existants ne sont pas affaiblis** : ce lot change des classes, jamais un comportement.

---

## 12. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **L'identité du site prime sur le thème Dolibarr.**
- **L'or est cantonné aux aplats**, jamais au texte sur crème — imposé par le contraste, pas par le goût.
- **Les couleurs d'état sont inventées** dans la famille chaude de la marque, faute d'exister dans la charte.
- **Pas de thème sombre.**
- **Les polices ne sont pas paramétrables**, contrairement aux couleurs.
- **La bibliothèque se limite à ce que les écrans utilisent déjà.**
