# Lot 1g — Identité « Encre »

**Date :** 2026-08-16
**Statut :** design validé par le porteur, en attente d'implémentation
**Prédécesseurs :** lot 1e (système de design), lot 1f (lisibilité et thèmes)
**Document de référence visuel :** https://claude.ai/code/artifact/299838ac-740b-4d02-880a-02ae930aa35e

---

## 1. Intention

Donner à CRA une identité qui lui soit propre — distincte de la marque KreativPM comme du thème neutre — et retirer l'impression, constatée par le porteur à l'usage, que l'application « fait site des années 80 : plat, terne, austère ».

Ce lot ne remet en cause **ni le contrat d'accessibilité, ni l'architecture des jetons, ni aucune règle métier**. Il change des valeurs, des formes et une architecture de navigation.

### Ce qui a été diagnostiqué

Constaté à l'écran, sur `main`, aux thèmes livrés :

| Constat | Mesure |
|---|---|
| L'accent est sombre **et** désaturé | `#3f4744` — C\* 22, L\* 36 |
| La seule couleur à l'écran est catégorielle | En mode « Cette prestation », `colorForLine(line.id)` est appelé **sans condition** (`MonthCalendar.tsx:465`) : l'unique ligne affichée reçoit une teinte tirée au hachage, qui ne distingue rien |
| La palette catégorielle n'est pas une famille | Chroma mesuré teinte par teinte : **25 · 50 · 81 · 42 · 28 · 40** — un écart de 3,2× entre `catA` et `catC`. Le défaut n'est pas « trop saturé » mais « six teintes qui n'appartiennent pas au même jeu » : `catC` hurle à C\* 81 pendant que `catA` s'efface à 25 |
| Aucune élévation | `rule` à 1,58:1 sur blanc, `shadow-card` à `0 1px 2px` / 10 % — indétectable |
| Aucun mouvement | `transition`, `duration-`, `animate-` : **zéro occurrence** dans `src/` |
| Pas d'échelle typographique | `h1` à 18 px / 800, corps à 14 px — un rapport de ×1,29. `--text-2xl` est déclaré et jamais utilisé |
| Cases du calendrier écrasées | 171 × 46 px à 1280 px de large — un rapport de 3,7:1 |
| Navigation débordante | À 375 px, la barre s'arrête après « Admin » : **Thème, Dolibarr, Synchro et Se déconnecter sont inatteignables**, et la page défile latéralement |
| Aucun état actif | Ni `usePathname` ni `aria-current` nulle part dans `src/` |
| Trois gabarits de page | Barre en `max-w-4xl`, `PageShell` en `max-w-5xl`, `/saisie/[month]` sans `PageShell` du tout |
| Chiffres non tabulaires | `font-variant-numeric` : zéro occurrence, dans une application dont chaque écran est une colonne de nombres |

### Ce qui est acquis et ne bouge pas

Le contrat d'accessibilité du lot 1f est meilleur que la moyenne du marché et **reste intact** : contrastes calculés et non jugés à l'œil, focus déclaré une fois pour toutes, cibles 44 pt tenues par un test de budget, zoom non bridé, `role="alert"` distingué de `role="status"`, équivalents clavier du glissement et de l'appui long, information jamais portée par la seule teinte.

---

## 2. La loi du système

**Le passé est froid, le futur est chaud.**

| État | Traitement | Marqueur non chromatique |
|---|---|---|
| Vide | Fond de surface, filet discret | l'absence d'aplat |
| **Réalisé** | Aplat teal plein | l'aplat lui-même, et sa forme |
| **Prévisionnel** | Aplat ambre plein | contour tireté |
| **Hors engagement** | Contre-teinte rouille (`danger`) | glyphe du bandeau |

Cette loi n'est pas une charte : c'est une règle de lecture qui encode la seule chose que CRA fait et qu'aucun outil concurrent ne fait — tenir ensemble le réalisé et le prévisionnel contre un engagement vendu.

### Pourquoi le prévisionnel prend sa propre teinte

Le codebase croyait déjà à moitié à cette loi : `SEGMENT_REALISE` vaut `bg-accent`, `SEGMENT_PREVU` vaut `bg-accent/45 pattern-hatch`. Mais la règle ne vivait que dans la barre d'engagement, et le prévisionnel n'y était qu'**un accent délavé** — c'est-à-dire terne par construction. Dessiner « moins fort » une chose qui n'est pas moindre, seulement pas encore acquise, est une erreur de sens autant que de matière.

Dans le calendrier, la règle n'existait pas du tout : le prévisionnel garde aujourd'hui le remplissage exact du réalisé et ne s'en distingue que par une horloge SVG.

**Conséquence structurelle : trois jetons de plus.** `ThemeTokens` passe de 44 à 47 avec `prevu`, `prevuInk`, `prevuEdge`.

### Contrainte attachée aux nouveaux jetons

`prevuEdge` **ne reçoit jamais de remplissage au survol**, contrairement à `dangerEdge` (`hover:bg-danger-edge` sur le bouton danger). La raison est mesurée : à `#c1860f`, la bordure tient 3,14:1 sur blanc — ce qu'exige un élément non textuel — mais `prevuInk` posée dessus ne tiendrait que 3,93:1. Les deux exigences sont incompatibles sur une teinte ambre ; le contrat retenu est celui de la bordure, et le couple encre-sur-bordure n'entre donc pas dans `TEXT_PAIRS`.

---

## 3. Les palettes

Les deux palettes passent `findContrastIssues` et `findPolarityIssues` à **0 anomalie**. Elles ont été construites puis mesurées, jamais choisies à l'œil — même méthode que les lots 1e et 1f.

### Encre clair

| Jeton | Valeur | | Jeton | Valeur |
|---|---|---|---|---|
| `page` | `#eaf2ef` | | `accent` | `#0e9480` |
| `surface` | `#ffffff` | | `accentDark` | `#0b7566` |
| `off` | `#dbe8e3` | | `link` | `#0a6355` |
| `offStrong` | `#c8dad4` | | `focus` | `#0b7566` |
| `ink` | `#12211d` | | `rule` | `#aec5bd` |
| `inkDeep` | `#0a1512` | | `prevu` | `#f2b544` |
| `muted` | `#485853` | | `prevuInk` | `#4a2f05` |
| `onAccent` | `#031c18` | | `prevuEdge` | `#c1860f` |
| `onDark` | `#eaf2ef` | | | |

États : `success #dff0e2` / `#1e5232` / `#98c9a8` · `warning #fbecd0` / `#6b4708` / `#e5bf72` · `danger #fbe3dc` / `#7f2c17` / `#e8a894` · `info #dfebef` / `#24454f` / `#aac6ce`.

### Encre sombre

| Jeton | Valeur | | Jeton | Valeur |
|---|---|---|---|---|
| `page` | `#121a18` | | `accent` | `#3fc9b0` |
| `surface` | `#1e2a27` | | `accentDark` | `#2ba792` |
| `off` | `#111917` | | `link` | `#5fd8c0` |
| `offStrong` | `#050807` | | `focus` | `#5fd8c0` |
| `ink` | `#e2ece9` | | `rule` | `#33443f` |
| `inkDeep` | `#060a09` | | `prevu` | `#e0a83a` |
| `muted` | `#9fb0ab` | | `prevuInk` | `#2a1c04` |
| `onAccent` | `#04211c` | | `prevuEdge` | `#966d16` |
| `onDark` | `#e2ece9` | | | |

États : `success #14291c` / `#86d09a` / `#294733` · `warning #2b2513` / `#e0bf6e` / `#4b3e1c` · `danger #2c1b16` / `#f0a189` / `#4e2f25` · `info #16242a` / `#a2c7d0` / `#2d454e`.

### `onAccent` cesse d'être blanc

Le lot 1f posait du blanc sur l'accent. L'accent d'Encre est **vif et clair** (L\* 55) : le blanc n'y tient pas 4,5:1. `onAccent` devient une encre teal très sombre — `#031c18` en clair, `#04211c` en sombre — ce qui autorise un accent bien plus lumineux qu'un teal sombre à texte blanc. C'est ce choix, et lui seul, qui retire la grisaille.

Deux ajustements ont été nécessaires en cours de mesure : `onAccent` à `#04211c` ne tenait que 4,49:1 sur l'accent clair, et les encres de `catD` et `catE` tombaient à 4,49 et 4,43 sur leurs bordures.

### Palette catégorielle : C\* 39

Reconstruite en LCh sur les mêmes principes que le lot 1f — clarté commune, six secteurs de teinte répartis aux angles 20°, 80°, 140°, 200°, 260°, 320°.

| Version | Chroma | Verdict |
|---|---|---|
| Lot 1f (`main`) | 25 à 81, moyenne 44 | **inégal** — le vrai défaut. `ETAT.md` listait déjà le point « à soumettre au porteur » |
| Première tentative de ce lot | C\* 24 uniforme | **terne** — refusé par le porteur |
| **Retenu** | **C\* 39 uniforme** | assez de couleur pour vivre, pas assez pour hurler — et surtout, **le même chroma pour les six**, ce qui est ce qui en fait une famille |

Clair : L\* 78 / C\* 40 pour le fond, L\* 22 / C\* 28 pour l'encre, L\* 68 / C\* 46 pour la bordure.
Sombre : L\* 38 / C\* 30 pour le fond, L\* 91 / C\* 8 pour l'encre, L\* 41 / C\* 34 pour la bordure.

Le chroma du sombre (29) reste inférieur à celui du clair (39) : la palette sombre est **construite, pas inversée** — la propriété que le lot 1f exigeait.

### La couleur catégorielle ne s'applique plus qu'en présence de catégories

Une teinte catégorielle ne distingue rien quand il n'y a qu'une catégorie affichée.

| Mode | Aplat des cases |
|---|---|
| **Cette prestation** (défaut) | `accent` — la teinte ne distingue rien, elle signale « saisi » |
| **Toutes les prestations** | `catA`…`catF` — la teinte porte enfin une information |

C'est la cause racine du « tout est saumon » constaté à l'écran.

---

## 4. La matière

L'impression de platitude ne vient pas d'un manque de couleur mais d'un manque d'épaisseur.

| Jeton | `main` | Encre |
|---|---|---|
| `--radius-sm` / `md` / `lg` | 3 / 5 / 8 px | **6 / 10 / 14 px** |
| `--shadow-card` | `0 1px 2px` à 10 % | **trois couches** : contact, diffusion, ambiante |
| `--shadow-lift` | n'existe pas | l'état survolé d'une carte ou d'un bouton |
| Aplat réalisé | aplat mort | **dégradé de 8 %** du haut vers le bas |
| Transitions | aucune | **150 ms** sur teinte et élévation |

Le dégradé est délibérément faible : assez pour donner une épaisseur à la case, pas assez pour évoquer un bouton de 2008.

`prefers-reduced-motion: reduce` neutralise toutes les transitions. Le lot 1f n'avait pas à s'en soucier — il n'y avait aucun mouvement.

---

## 5. La typographie

Les polices ne changent pas. Manrope en titrage, Inter en texte : le problème n'était pas Manrope mais Manrope à 18 px en graisse 800 — un titre qui compense sa petite taille en criant.

| Rôle | `main` | Encre |
|---|---|---|
| Titre de page | 18 px / 800 (×1,29 du corps) | **22 px / 700** (×1,57) |
| Titre de carte | 16 px / 800 | **18 px / 650** |
| Corps | 14 px / 400 | **inchangé** — une grille de saisie a besoin de sa densité |

`--text-2xl` (22 px), déclaré au lot 1e et jamais utilisé, devient le titre de page.

**Chiffres tabulaires.** `font-variant-numeric: tabular-nums` s'applique à `DataTable`, aux cases du calendrier et à la réglette. Correction typographique la moins chère et la plus visible du lot.

---

## 6. La forme du calendrier

### Cases carrées

`aspect-square` sur la case. À 1280 px, sept colonnes dans `max-w-5xl` produisent aujourd'hui des rectangles de 171 × 46. La contrainte de cible tactile (44 pt) reste tenue : une case carrée dans sept colonnes à 375 px fait 46 px de côté.

### La plage, pas la case

Des jours contigus au même état sont **un seul fait**. Un consultant ne pense pas « lundi, mardi, mercredi » mais « j'étais chez eux toute la semaine ».

Les cases d'une suite fusionnent : filets intérieurs supprimés, rayon porté par les seuls bouts, marges latérales portées par les seuls bouts. La fusion s'arrête à la fin de la ligne de la grille — une plage ne franchit pas le dimanche, parce que la grille ne le montre pas.

**Une demi-journée rompt toujours la plage** : elle garde ses quatre filets, son rayon et ses marges, parce que ce jour-là n'est pas le même fait que les autres.

Ce parti vient de Timizer, l'outil de référence du projet, et c'est le meilleur de son calendrier.

### Week-ends sans hachures

`pattern-stripes` disparaît des week-ends. Timizer démontre que l'absence suffit, et les hachures de dithering sont le signal d'ancienneté le plus fort du dessin actuel.

Le contrat non chromatique tient sans elles : l'écart de clarté entre `surface`, `off` et `offStrong` (100 / 91,2 / 85,4 en L\*) porte l'information, et il est déjà vérifié par `MIN_LIGHTNESS_GAP`.

`pattern-dots` **reste sur les fériés** : ils sont rares, l'information y est plus forte, et un marqueur qui ne sert que dix jours par an ne fatigue personne.

---

## 7. L'élément signature : la réglette du mois

Sous le calendrier, à sa largeur exacte, en permanence. Elle emploie le vocabulaire des cases au-dessus d'elle : plein pour le réalisé, ambre pour le prévisionnel, vide pour le reste, un trait vertical pour aujourd'hui.

Elle règle trois manques d'un coup :

1. **Le calendrier n'affiche aucun total.** On saisit douze jours sans jamais voir combien.
2. **Le vide gris** qui occupe les deux tiers inférieurs de l'écran se remplit.
3. **L'engagement** — la seule chose que CRA fait et que Timizer ne fait pas — remonte de la vue tableau vers l'écran où l'on travaille réellement.

Le composant existe : `EngagementBar`. Il change de place et de largeur, **pas de logique**. Le cumul reste sur toute la durée de la ligne, sous les facteurs figés à l'écriture — la règle du lot 1d n'est pas touchée.

---

## 8. L'architecture de navigation

### Le constat

Huit liens à plat, dont quatre sont des réglages, au même poids et à la même taille que le travail. Les libellés nomment la route et non ce que la personne contrôle : « Admin » pointe vers les règles de saisie, « Thème » vers l'apparence, « Synchro » vers un écran de supervision.

Et à 375 px, la barre déborde : **quatre écrans sont inatteignables au doigt, dont la déconnexion.** C'est un défaut fonctionnel, pas un défaut de goût.

### La forme retenue

Rail latéral à deux groupes nommés, sur le modèle de Timizer (`MENU` / `MON COMPTE`) :

| Groupe | Entrées |
|---|---|
| **Travail** | Saisie · Charge · Missions · CRA |
| **Réglages** | Règles de saisie · Apparence · Dolibarr · Synchronisation · Se déconnecter |

Les quatre entrées d'administration sont renommées pour ce qu'elles contrôlent. Le groupe « Réglages » se déplie et se replie ; son état est mémorisé.

**Sur mobile** : barre d'onglets basse à cinq entrées — les quatre du travail, plus « Réglages » qui ouvre la liste.

**État actif** : `aria-current="page"` plus un marqueur visuel qui ne repose pas sur la seule teinte (filet latéral et graisse).

Un groupe de navigation qui se déplie n'a besoin d'aucun popover : un `<button aria-expanded>` et une liste suffisent, et c'est plus accessible qu'un menu flottant.

### Gabarit unique

`PageShell` s'applique à `/saisie/[month]`, qui utilise aujourd'hui `<main className="p-6">` sans gabarit, et à `/admin/theme`, qui est en `max-w-3xl`. Le rail rend la question de la largeur de la barre sans objet.

---

## 9. Dépendances ajoutées

Trois, et la justification de chacune. La maigreur du front (`next`, `react`, `zod`, `next-auth`, `@prisma/client`, `@node-rs/argon2`) est un atout du projet ; elle n'est entamée que là où le gain est net.

| Paquet | Rôle | Pourquoi |
|---|---|---|
| `lucide-react` | ~15 icônes | Les glyphes actuels sont du **texte** — `◆ ✓ ▲ ✕ ℹ` — rendus dans la police système, chacun avec sa métrique et son alignement propres. Tree-shakeable : ~5 Ko pour quinze icônes. En dessous de huit icônes, les dessiner à la main aurait été préférable ; le rail en ajoute neuf |
| `clsx` | composition de classes | Les `className` sont aujourd'hui concaténés en gabarits de chaîne |
| `tailwind-merge` | résolution des conflits | Un appelant qui passe `px-2` à un `Button` portant `px-4` produit un résultat dépendant de l'ordre d'insertion CSS. Résout les utilitaires standard et **laisse intacts les jetons personnalisés**, qu'il ne connaît pas — aucune configuration requise |

### Écartés, et pourquoi

- **`shadcn/ui`** — embarque son propre système de jetons (`--background`, `--foreground`, échelles neutres) qui entrerait en collision frontale avec les 47 jetons et ferait tomber `design-system.test.ts`. L'adopter reviendrait à abandonner le garde-fou ou à tout réécrire.
- **Radix / Base UI** — le seul besoin serait le tiroir « Réglages », et un groupe qui se déplie n'a pas besoin d'un popover. `ConfirmDialog` porte déjà un piège à focus testé.
- **Motion / Framer Motion** — `transition-colors` et `transform` couvrent tout le système. Motion se justifie pour des animations de layout ; les plages fusionnées sont statiques à chaque rendu.

---

## 10. Ce que ce lot ne fait pas

- **Il ne change aucune règle métier.** Ni cycle de saisie, ni conversion d'unité, ni facteur figé, ni capacité, ni engagement.
- **Il ne touche pas au modèle de données.** Aucune migration Prisma. Les palettes vivent dans le JSON de `Settings`, lu et écrit en bloc.
- **Il ne supprime aucun garde-fou.** `design-system.test.ts`, `tokens.test.ts`, le test de budget des cibles tactiles et le contrôle de focus restent en place et doivent rester verts.
- **Il ne retire pas le préréglage KreativPM.** Il cesse d'être proposé par défaut, rien de plus.
- **Il ne traite pas le dépassement de barre horizontale du plan de charge** (12 colonnes dont 9 vides) : c'est une question d'information, pas d'identité. À ouvrir séparément.

---

## 11. Risque de recouvrement

**Cette section est caduque depuis le 16 août 22 h.** Elle décrivait deux échecs
attribués au lot 3, alors en vol. Les lots 3 et 4 sont fusionnés, `main` porte
**2 587 tests tous verts**, `tsc` est à 0, et aucun agent ne tourne : l'arbre est
libre. La porte de sortie du lot est donc zéro échec, sans exception tolérée.

Reste vrai : la navigation compte désormais **sept écrans d'administration** —
`dolibarr`, `google`, `saisie`, `supervision`, `sync`, `theme`, `webhooks` — et
`layout.test.tsx` lit ce dossier pour exiger un lien par écran. Le regroupement
proposé en §8 **étend** cette liste, il ne la remplace pas.
