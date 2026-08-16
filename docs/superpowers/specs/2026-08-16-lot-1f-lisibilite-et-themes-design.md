# Lot 1f — Lisibilité de la saisie, thèmes clair et sombre

**Date :** 2026-08-16
**Statut :** design proposé, non relu par le porteur du produit
**Origine :** essai du produit par le porteur, captures à l'appui.

---

## 1. Intention

La saisie fonctionne. Elle ne se **lit** pas.

Le porteur l'a formulé sans détour après avoir ouvert son CRA : « je trouve que ce n'est pas lisible du tout ». Ce lot traite ce qu'il a nommé, plus deux choses qu'il a demandées en passant et qui portent plus loin qu'elles n'en ont l'air.

---

## 2. Le dessin d'une cellule

C'est le cœur du lot. Aujourd'hui une cellule remplie affiche un chiffre. C'est juste, et illisible d'un coup d'œil sur un mois entier.

**La quantité se lit à la forme, pas au chiffre.**

| Saisie | Dessin |
|---|---|
| Journée entière | aplat plein, toute la cellule |
| Demi-journée matin | aplat sur la moitié **haute-gauche**, séparée par une diagonale montant de bas-gauche vers haut-droite |
| Demi-journée après-midi | aplat sur la moitié **basse-droite**, même diagonale |
| Durée libre | aplat partiel, proportionnel, avec le chiffre |
| Vide | rien |

La diagonale de bas-gauche à haut-droite est la convention retenue par le porteur. Elle a l'avantage de rendre matin et après-midi **spatialement** distincts : le matin en haut, l'après-midi en bas, ce qu'on lit sans l'apprendre.

**Le chiffre reste**, en plus de la forme, jamais à sa place. Une durée libre de 3 heures ne se déduit d'aucun aplat.

### Le prévisionnel

Les hachures actuelles sont illisibles — constaté, pas supposé.

**Le prévisionnel garde exactement le même remplissage que le réalisé**, et porte une **icône d'horloge**. Le porteur a choisi cette option en connaissant son coût : une icône encombre une cellule déjà petite sur téléphone. Si elle ne tient pas, c'est un constat à rapporter, pas une raison de la remplacer en silence par autre chose.

C'est aussi ce qui satisfait la règle du projet — **aucune information portée par la seule couleur** — puisque l'icône se voit en monochrome.

### Le jour courant

**La cellule d'aujourd'hui se distingue de toutes les autres**, indépendamment de son contenu. Demandé par le porteur, et utile au-delà de l'esthétique : la frontière entre réalisé et prévisionnel passe exactement là, et rien ne la montre aujourd'hui.

---

## 3. Thèmes clair et sombre

Le lot 1e avait tranché « pas de thème sombre », au motif qu'une palette crème et brun s'y transpose mal. **Le porteur revient sur cette décision**, et il a raison : c'est un produit qu'il utilisera tous les jours, et l'argument d'usage prime sur l'argument de palette.

Trois thèmes, donc :

- **Clair** — le défaut. Neutre, dense, conçu pour de longues sessions de lecture de chiffres.
- **Sombre** — construit, pas dérivé. Inverser des luminances produit une interface grise et sale ; les fonds sombres demandent des saturations plus basses et des encres moins pures que leur symétrique clair.
- **KreativPM** — la palette de marque, conservée comme préréglage.

Le mécanisme existe déjà et ne change pas : les couleurs vivent dans les réglages, en JSON lu et écrit en bloc, injectées en variables CSS sur la racine. **Le garde-fou de contraste s'applique aux trois** — tout couple texte/fond à 4,5:1, vérifié par calcul et refusé sinon, et les six teintes catégorielles séparées d'un écart mesuré.

**Le thème suit la préférence du système** par défaut, avec un choix explicite qui la remplace. Un utilisateur qui a réglé son système en sombre n'a pas à le redire ici.

Le soupçon du porteur — « c'est peut-être mon thème d'entreprise qui fout le bazar » — se vérifie en même temps : les six teintes catégorielles ont été calibrées dans une fenêtre chaude, et rien ne prouve qu'elles tiennent sur un fond neutre.

---

## 4. Les mots de l'interface

**« ½ AM » et « ½ PM »**, et rien d'autre. Le porteur les veut pour lever l'ambiguïté, et parce que c'est universel. Partout : cinématique, formulaire, légende, infobulle.

**Le tableau doit dire qu'il est la vue multi-CRA.** C'est sa nature — plusieurs lignes de prestation à la fois — et son nom actuel ne le dit pas.

### La bascule qui ment, et qui ne sert que dans une vue

Sur la capture du porteur, le tableau affiche trois lignes alors que la portée sélectionnée est « Cette prestation ». Lecture du code : **la bascule n'est transmise qu'au calendrier.** En mode tableau, elle n'a aucun effet.

Et son libellé ne dit pas ce qu'elle fait. **« Tout le mois » annonce une portée de temps ; elle porte une portée de prestations** — afficher, ou non, les autres prestations en lecture seule à côté de celle qu'on saisit. C'est le basculement que le porteur avait demandé dès l'origine : « afficher le CRA avec toutes les prestations ou uniquement celle sélectionnée ».

Deux corrections :

- **« Cette prestation » / « Toutes les prestations »** — le libellé dit la chose.
- **La bascule disparaît en mode tableau**, où elle ne fait rien. Un réglage sans effet visible apprend à l'utilisateur que l'interface ment.

**Le tableau, lui, ne change pas** : il montre toutes les missions et prestations auxquelles on est affecté, et le porteur l'a validé tel quel. C'est sa nature, et c'est ce qui justifie de le nommer comme la vue multi-CRA.

---

## 5. La saisie libre passe aux heures

Aujourd'hui, l'appui long ouvre un formulaire qui demande **une durée et un créneau**. Saisir « 1 heure » sur le créneau « Matin », qui va de 8 h à 12 h, laisse l'application décider seule que le bloc commence à 8 h. **Le choix est fait, et rien ne le dit.**

Le porteur l'a vu sous l'angle de l'agenda : « il faudrait mettre heure de début, heure de fin si tu veux pouvoir gérer avec Google ». C'est exact, et cela vaut au-delà de Google — le bloc a une place dans la journée, que la saisie doit dire.

**Le formulaire demande donc un début et une fin. La durée en découle.** Les créneaux nommés restent, en **pré-remplissage** : choisir « Matin » remplit 8 h – 12 h, ajustable ensuite. On garde le chemin rapide et on voit ce qui partira.

### Ce que cela change dans le modèle

`TimeEntry` porte désormais un **début** et une **fin**, en minutes depuis minuit — entiers, comme tout le reste.

Deux conséquences à traiter franchement :

**La clé d'unicité change.** Elle porte aujourd'hui `(ligne, utilisateur, date, créneau)`. Deux saisies du même jour sur la même ligne doivent désormais se distinguer par leur **heure de début**. Le `slotId` reste, comme trace du créneau nommé d'origine, mais il cesse d'être ce qui identifie la saisie. Rappel du lot 0 : la colonne qui entre dans une contrainte d'unicité n'est jamais nullable — `NULL` n'est jamais égal à `NULL`.

**Les heures sont figées à l'écriture, comme le facteur de conversion.** C'est la même règle, pour la même raison : redéfinir « Matin » en administration ne doit pas déplacer les journées déjà saisies. Un CRA validé ne change jamais, ni de calcul, ni d'horaires.

**Les saisies existantes se migrent** : celles portant un créneau nommé reçoivent ses bornes actuelles, celles marquées journée entière reçoivent les bornes de la journée de travail. La migration est écrite, jamais poussée par `db push`.

---

## 6. Règles métier

- **La quantité se lit à la forme** : aplat plein pour une journée, demi-aplat en diagonale pour une demi-journée, le chiffre en plus et jamais à la place.
- **Le prévisionnel a le même remplissage que le réalisé**, distingué par une icône.
- **Aucune information portée par la seule couleur**, dans les trois thèmes.
- **Tout couple texte/fond atteint 4,5:1**, vérifié par calcul et refusé sinon — clair, sombre et marque compris.
- **La cellule du jour se distingue** de toutes les autres.
- **« ½ AM » et « ½ PM »** partout.
- **Une saisie porte un début et une fin, figés à l'écriture.**
- **Cible tactile d'au moins 44 points**, focus visible, parcours clavier complet.

---

## 7. Hors périmètre

- **Refondre les parcours.** Ce lot habille et clarifie ce qui existe ; la cinématique au clic ne change pas.
- **Un thème par utilisateur.** L'application est mono-organisation ; le thème est un réglage, plus la préférence du système.
- **Des polices paramétrables.** Elles sont embarquées, et le mode portable l'impose.
- **Un éditeur de créneaux repensé.** Il existe et fonctionne.

---

## 8. Tests

- **Les trois thèmes passent le contrôle de contraste** par calcul, y compris les six teintes catégorielles sur fond neutre et sur fond sombre.
- **Les états d'une cellule se distinguent sans la couleur** — vérifié en simulant une vision monochrome, journée, demi-journées matin et après-midi, prévisionnel, jour courant.
- **L'icône du prévisionnel reste visible et la cible tactile tient 44 points** sur une largeur de 375 pixels. Si elle ne tient pas, le test échoue et le constat remonte.
- **Le thème suit la préférence du système**, et un choix explicite la remplace, et survit à un redémarrage.
- **Le formulaire calcule la durée depuis les heures**, et un créneau nommé pré-remplit ses bornes sans les verrouiller.
- **Les heures sont figées** : redéfinir un créneau en administration ne déplace aucune saisie existante.
- **La migration** part d'une base portant les trois formes — journée entière, créneau nommé, durée libre — et aboutit sans perte.
- **Aucun test existant n'est affaibli** : ce lot change des formes et des mots, et un modèle. Les règles de calcul ne bougent pas.

---

## 9. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Le clair est le thème par défaut**, la marque devient un préréglage.
- **Le sombre est construit, pas dérivé** du clair par inversion.
- **Le chiffre reste affiché** en plus de la forme.
- **Le `slotId` survit** comme trace du créneau d'origine, sans plus identifier la saisie.
- **Les heures se figent à l'écriture**, par symétrie avec le facteur de conversion.
