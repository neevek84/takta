# Lot 1c — Vue calendrier et saisie cyclique

**Date :** 2026-08-15
**Statut :** design en cours d'arbitrage avec le porteur du produit
**Prérequis :** lot 1a livré
**Remplace** une première version, écartée : elle proposait une surface mobile séparée avec son propre modèle d'interaction. Le besoin réel est **une seule vue mensuelle qui fonctionne partout**.

---

## 1. Intention

Une vue mensuelle unique, **identique sur poste et sur téléphone**, où l'on saisit en cliquant sur des cases.

Pas de surface mobile à part, pas de modèle d'interaction dédié : une case qui change d'état au clic marche aussi bien à la souris qu'au pouce. C'est ce qui rend l'adaptation possible là où une grille de trente et une colonnes échouait.

---

## 2. Le parcours

Trois sélecteurs en tête : **Client → Mission → Prestation**.

On choisit ce qu'on saisit, puis on saisit. Une mission portant deux prestations — « Consultant ITSM » à 800 € et « Consultant ITSM Nuit » à 1 200 € — se traite en changeant de prestation dans le sélecteur, jamais en devinant à quelle ligne appartient une case.

La dernière sélection est mémorisée : on retombe dessus au retour.

---

## 3. La cinématique

**Un clic fait avancer la case d'un cran :**

```
vide  →  1 jour  →  ½ matin  →  ½ après-midi  →  vide
```

Quatre états, un geste, aucun formulaire. C'est la mécanique qui rend la saisie d'un mois rapide sans jamais quitter le pouce ni la souris.

**Une conséquence importante : toute demi-journée porte désormais un créneau.** Le lot 1b devait assumer qu'une demi-journée sans créneau se place sur la première moitié de la plage par défaut — donc au mauvais moment quand on travaille l'après-midi. La cinématique règle le problème à la source.

**Appui long — ou clic droit sur poste — ouvre un formulaire** pour saisir une durée libre en heures et choisir un créneau hors des trois prédéfinis, la nuit par exemple.

**Une case portant une valeur libre ne cycle plus au clic** : elle rouvre son formulaire. Sans cette exception, un clic distrait ramènerait une saisie de trois heures à zéro, et le clic suivant la remplacerait par une journée entière — une perte silencieuse déguisée en geste réversible.

**Sur une prestation facturée à l'heure**, le clic ouvre directement le formulaire : « 1 jour » n'y veut rien dire.

---

## 4. Remplir et vider

Deux boutons au-dessus du calendrier, sur la prestation sélectionnée et le mois affiché.

**Remplir le CRA** pose une journée sur chaque jour ouvré du mois. Il **saute** les jours qui feraient dépasser la capacité — parce qu'une autre prestation les occupe déjà — et rend un compte rendu : « 18 jours posés, 2 sautés faute de capacité ». Un remplissage qui écrase en silence le travail d'une autre prestation serait pire que pas de bouton du tout.

**Vider le CRA** retire les saisies du mois pour la prestation sélectionnée, après confirmation. C'est destructeur et ça doit se dire.

Les deux **refusent un mois verrouillé** par un CRA validé, comme toute autre écriture.

---

## 5. Cette prestation, ou tout le mois

Une bascule à deux états au-dessus du calendrier.

**« Cette prestation »** — seule la prestation sélectionnée s'affiche. C'est le mode de saisie.

**« Tout le mois »** — les autres prestations apparaissent aussi, chacune dans sa couleur, **en lecture seule**. Seule la prestation sélectionnée reste cliquable. On voit d'un coup d'œil si un jour est déjà pris ailleurs, sans quitter ce qu'on est en train de faire.

Les couleurs sont attribuées automatiquement et **restent stables** pour une prestation donnée : une couleur qui change entre deux visites ne sert à rien.

---

## 6. Deux vues, un même mois

Comme dans l'outil qui a inspiré ce parcours, une bascule en tête donne accès à deux représentations du même CRA :

**La vue calendrier** — semaines en lignes, jours en colonnes — devient la **vue par défaut**. Sept colonnes tiennent sur un téléphone.

**La vue tableau** — prestations en lignes, jours du mois en colonnes — reste disponible **sur poste**. Elle garde son intérêt propre : voir toutes les prestations éditables en même temps. C'est celle que le lot 1a a livrée, elle n'est pas jetée.

**La sélection par glissement fonctionne dans les deux**, sur poste : on glisse sur une plage de jours, on applique une valeur d'un coup.

---

## 7. Responsive

Sept colonnes en toutes circonstances. Sur téléphone, les cases se resserrent mais gardent une **cible tactile d'au moins 44 points** — en dessous, on rate une case sur trois.

Les en-têtes de jours s'abrègent, la sélection Client/Mission/Prestation s'empile, les deux boutons restent atteignables au pouce.

**La PWA reste dans ce lot** : manifeste, icône, et mise en cache de la coquille pour une installation sur l'écran d'accueil et un démarrage instantané. Le fonctionnement **hors ligne** n'y est pas — il demande une file locale et un arbitrage au retour du réseau, ce qui relève du lot 5.

---

## 8. Règles métier

Aucune nouvelle. Cette vue est une seconde présentation au-dessus de règles déjà écrites et déjà testées :

- contrôle de capacité identique, avec ses trois modes ;
- week-ends et jours fériés **saisissables**, jamais bloquants — le calendrier les grise, il ne les interdit pas ;
- un mois dont le CRA est validé refuse l'écriture, cinématique comprise ;
- la conversion du prévisionnel n'est jamais automatique.

Si une règle devait diverger entre les deux vues, ce serait le signe qu'elle est implémentée au mauvais endroit.

---

## 9. Ce que ce lot change ailleurs

- **Lot 1a** : la vue tableau reste, mais cesse d'être la vue par défaut.
- **Lot 1b** : les demi-journées portant systématiquement un créneau, le repli sur la plage par défaut ne concerne plus que les saisies libres en heures.
- **Lot 0** : `allowedSlotIds`, présent en base et inexploité depuis le début, devient enfin applicable — une prestation peut restreindre les créneaux que sa cinématique propose.

---

## 10. Hors périmètre

- **Hors ligne** — renvoyé au lot 5, avec l'empaquetage.
- **Notifications poussées.**
- **Application native.** Une PWA suffit ; un build par plateforme coûterait sans rien apporter.
- **Administration et gestion des missions sur téléphone.** Ce ne sont pas des écrans qu'on ouvre au pouce.

---

## 11. Tests

- **La cinématique** : quatre clics successifs ramènent une case à son état initial, et chaque état intermédiaire écrit bien ce qu'il annonce, créneau compris.
- **Une case à valeur libre ne cycle pas** : elle rouvre son formulaire. C'est le test qui protège contre la perte silencieuse.
- **Une prestation facturée à l'heure ouvre le formulaire au clic**, sans jamais passer par « 1 jour ».
- **Remplir le CRA saute les jours sans capacité** et le dit dans son compte rendu — jamais d'écrasement.
- **Remplir et vider refusent un mois verrouillé.**
- **Vider demande confirmation.**
- **En mode « Tout le mois », les autres prestations ne sont pas cliquables.**
- **Les couleurs sont stables** entre deux chargements pour une même prestation.
- **Aucune règle métier n'est réimplémentée dans la vue** : une recherche dans les composants du calendrier ne doit trouver aucun calcul de capacité, d'engagement ou de conversion d'unité.
- **Cible tactile d'au moins 44 points** vérifiée sur une largeur de 375 pixels.

---

## 12. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Une case à valeur libre rouvre son formulaire au lieu de cycler.**
- **« Remplir le CRA » saute les jours sans capacité** plutôt que d'écraser ou de refuser en bloc.
- **La vue tableau du lot 1a est conservée** sur poste, en seconde vue.
- **La bascule s'appelle « Cette prestation | Tout le mois ».**
- **Les couleurs sont attribuées automatiquement**, sans réglage.
