# Reprise du lot 1g — ce qui a changé depuis l'écriture de la spec

**À lire avant de commencer.** La spec 1g a été écrite le 16 août à 19 h 14. Le dépôt a beaucoup bougé depuis. Ce document ne remplace pas la spec : il corrige ce qui y est devenu faux et nomme ce qui va lui résister.

---

## 1. Le lot 1f est fait

La spec le cite en prédécesseur, à juste titre — **il est implémenté et fusionné**. N'y touche pas, et surtout ne le réimplémente pas.

Ce qu'il a livré, et qui est acquis :

- **trois thèmes** — clair (le défaut), sombre, KreativPM en préréglage — suivant la préférence du système, avec un choix explicite qui la remplace ;
- **la quantité se lit à la forme** : aplat plein pour une journée, demi-aplat séparé par une diagonale montant de bas-gauche vers haut-droite pour une demi-journée, le chiffre en plus et jamais à la place ;
- **le prévisionnel** garde le même remplissage et porte une horloge — les hachures étaient illisibles ;
- **la cellule du jour** se distingue de toutes les autres ;
- **« ½ AM » et « ½ PM »** partout ;
- **une saisie porte une heure de début et de fin**, figées à l'écriture ; les créneaux nommés ne servent plus qu'au pré-remplissage ;
- la bascule de portée dit **« Cette prestation » / « Toutes les prestations »** et disparaît en vue tableau, où elle n'avait aucun effet ;
- le **tableau porte le code couleur** lui aussi.

---

## 2. L'état du dépôt

`main` — **2 587 tests, `tsc` à 0, construction verte**. Aucun test ne casse. Les deux échecs que la spec mentionne en section 11 n'existent plus.

**Tous les lots sont fusionnés** sauf la fin de la documentation : 0, 1a à 1f, 2 (13/14), 3, 4, 5 complets ; lot 6 à 7 tâches sur 14.

**Aucun agent ne tourne.** L'arbre est libre.

---

## 3. Ce qui est devenu faux dans le tableau de diagnostic

**`MonthCalendar.tsx:465`** — la ligne existe encore et `colorForLine` y est bien appelé sans condition, mais le fichier fait désormais **812 lignes** et a été réécrit trois fois depuis. Les autres numéros de ligne de la spec sont à revérifier avant usage.

**Deux extractions ont eu lieu**, et il faut les consommer plutôt que les contourner :
- `src/components/ui/Aplat.tsx` — l'aplat partagé entre le calendrier et le tableau ;
- `src/core/saisie/forme.ts` — la règle qui dit quelle forme une saisie prend.

**La palette catégorielle a été recalibrée.** Le diagnostic « criarde, C\* ≈ 62 » date d'avant. Surtout, le contrôle a changé de nature : il vérifiait l'écart **entre teintes**, qui ne dépend pas du fond et ne pouvait donc rien voir. Il vérifie désormais l'écart entre **une teinte et la surface qui la porte** — neuf couples fautifs mesurés, dont quatre sur la palette neutre. Les six teintes claires ont dû quitter la fenêtre chaude pour tenir le seuil.

---

## 4. Ce qui va résister, et qu'il faut savoir avant d'écrire

**`src/design-system.test.ts` refuse toute couleur Tailwind brute.** Pas d'avertissement : le test tombe. Tout passe par un jeton.

**Le contrôle de contraste est appliqué à l'enregistrement, pas recommandé.** Une palette dont un couple texte/fond descend sous 4,5:1 est **refusée**, avec le couple nommé. La liste des couples est **dérivée**, plus écrite à la main — une revue avait trouvé la liste manuelle incomplète, avec deux couples déjà fautifs sur la palette livrée. Toute nouvelle palette de 1g devra passer ce contrôle, dans les trois thèmes.

**Un contrôle de polarité existe aussi** : sans lui, une palette claire glissée dans l'emplacement sombre passait tout, les contrôles étant symétriques.

**La cible tactile de 44 points tient à 1 point près.** À 375 px, sept colonnes valaient 43,29 — sous le seuil, et aucun test ne le voyait. La gouttière resserrée donne **45,0**. Toute largeur ajoutée dans une cellule doit tenir dans ce budget, et le test qui le mesure doit rester vert. La refonte des cases proposée par 1g touche directement ce point.

**`@theme` classique, jamais `@theme inline`** — ce dernier substitue les valeurs à la compilation et rend le thème paramétrable inopérant.

**Un test lit les dossiers de `src/app/(app)/admin/` et exige un lien de navigation par écran.** Il y en a désormais six : saisie, thème, dolibarr, google, sync, supervision, webhooks. La refonte de navigation de 1g — rail, tiroir « Réglages » — doit tous les garder atteignables, et le test le vérifie.

**`MonthCalendar` porte une mécanique de pointeur construite par cinq mains** : appui long armé sur `pointerdown`, clic consommé une fois derrière, clic droit, **Maj+Entrée** et touche **Menu** ouvrant le formulaire, glissement au doigt et au clavier, formulaire qui prend le focus, le retient et le rend. Tester chaque geste isolément ne suffit pas — ce sont leurs interactions qui cassent.

---

## 5. Sur les trois dépendances proposées

L'analyse de la spec est juste, et l'écartement de `shadcn/ui` pour cause de collision de jetons est exactement le bon raisonnement.

Deux précisions :

- **`tailwind-merge` ne connaît pas les jetons du projet** et les laissera donc intacts — c'est ce que dit la spec, et c'est vérifié : il n'y a pas de configuration à faire. Mais il faut un test qui le prouve sur un jeton réel, sinon c'est une hypothèse.
- **`lucide-react` entre dans l'archive portable.** Le lot 5 produit un zip autosuffisant de 26 Mo ; `nodemailer` y est déjà du poids mort. Ce n'est pas rédhibitoire, c'est à savoir.

---

## 6. La méthode qui a payé, et pourquoi elle n'est pas négociable

**Vingt jeux de tests de ce projet décrivaient correctement une promesse sans jamais la vérifier.** Ils étaient verts, lisibles, bien nommés — et ne protégeaient rien. Quelques-uns, pour donner la mesure :

- un test de résistance à une panne **armé sur une file vide** : la panne n'était jamais rencontrée ;
- une transactionnalité vérifiée sur la fonction appelée, **jamais sur l'appelant** ;
- un test « n'emprunte rien à une autre mission » **qui ne posait aucune donnée hors périmètre** — il vérifiait une absence garantie par la vacuité ;
- un test d'arrondi dont les valeurs **tombaient juste**, donc n'arrondissaient jamais ;
- un contrôle « aucun montant » qui interdisait les suites de lettres `eur` et `cent`, **contenues dans `emetteur` et `totalCentiemes`** : il échouait sur un document sain.

**D'où la règle : chaque test se vérifie par mutation.** On casse délibérément la ligne qu'il prétend protéger, on montre quel test tombe, on restaure. Un test qui survit à la mutation ne prouve rien — et inspire pourtant la même confiance qu'un vrai.

Deux pièges d'exécution, payés cher :

- **restaurer chaque mutation immédiatement**, avant la suivante. Un agent interrompu en pleine vérification a laissé un `break` planté au milieu d'une boucle, avec le code d'origine dupliqué en dessous ;
- **quoter les chemins contenant des crochets** — `src/app/(app)/saisie/[month]/…` — qu'un shell avale silencieusement. Un agent a cru deux mutations muettes pour cette raison.

---

## 7. Le reste

`docs/superpowers/ETAT.md` porte les décisions qui ne se rouvrent pas, les règles métier, les pièges d'environnement et les dettes connues. **C'est le document à lire en premier**, avant même la spec.

Chaque exécution de vitest a **sa propre base de données** : plusieurs agents peuvent tourner en parallèle sans collision.
