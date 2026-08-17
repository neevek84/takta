# Lot 1g — recette avant fusion

**Branche :** `lot-1g-identite-encre` · **7 commits** · 2 763 tests verts, `tsc` à 0
**Spec :** `specs/2026-08-16-lot-1g-identite-encre-design.md`
**Document visuel :** https://claude.ai/code/artifact/299838ac-740b-4d02-880a-02ae930aa35e

---

## 0. Avant de commencer

```bash
npm run theme:reprise
```

**Sur la base de développement, c'est déjà fait** — elle est passée sur Encre, et une relance répond « rien à faire ». La commande est à passer **une fois par installation** au déploiement : sans elle, le thème enregistré l'emporte et le lot reste invisible.

Vérification en une ligne :

```bash
sqlite3 prisma/dev.db "select json_extract(themeJson,'\$.clair.accent') from Settings;"
```

Attendu : `#0e9480`. Si vous lisez `#3f4744`, la reprise n'a pas été passée.

---

## 1. Ce qu'il faut voir sur `/saisie`

| Point | Attendu |
|---|---|
| Fond de page | vert-teal très pâle, pas gris |
| Boutons actifs (« Calendrier », « Cette prestation ») | teal vif, **jamais charbon** |
| Cases du calendrier | **carrées**, pas des rectangles écrasés |
| Jours contigus au même état | **soudés en un bloc**, filets intérieurs invisibles |
| Fin de semaine | la plage s'arrête au dimanche, ne franchit pas la ligne |
| Demi-journée | **rompt la plage** : quatre filets, ses marges, sa diagonale |
| Prévisionnel | **ambre plein + contour tireté**, jamais un teal délavé |
| Week-ends | ton légèrement plus sombre, **aucune hachure** |
| Fériés | pointillés conservés |
| Aujourd'hui | trait épais d'encre, même sur une case prévisionnelle |
| Chiffres | alignés en colonne (chiffres tabulaires) |

**Le geste à refaire :** sélectionner lundi→vendredi par glissement, cliquer « ½ AM ». La semaine doit se remplir en une plage ambre continue, rompue au week-end.

---

## 2. La navigation

| Point | Attendu |
|---|---|
| Desktop | rail à gauche, deux groupes : les quatre écrans de travail, puis « Réglages » |
| Entrée courante | fond teinté + filet latéral + graisse — **jamais la teinte seule** |
| Libellés | « Règles de saisie » et « Apparence » ont remplacé « Admin » et « Thème » |
| Les sept écrans d'admin | tous atteignables : Règles de saisie, Apparence, Dolibarr, Google, Synchro, Abonnements, Supervision |
| **Mobile (375 px)** | barre d'onglets **basse** à cinq entrées, tiroir « Réglages » **replié à l'arrivée** |
| Mobile, débordement | **aucun défilement latéral** de la page |

C'est le point qui était cassé avant le lot : à 375 px, la barre s'arrêtait après « Admin » et quatre écrans — dont la déconnexion — étaient inatteignables au doigt.

---

## 3. Les deux marques du calendrier et du tableau

Elles disent **deux faits différents**, et c'est voulu :

| Vue | Marque | Condition | Sens |
|---|---|---|---|
| Calendrier | triangle plein, coin haut-gauche | journée saisie en **2 créneaux ou plus** | « ouvrir le formulaire les remplacera toutes par une » |
| Tableau | **deux barres empilées** | cellule qui totalise des créneaux, **dès le premier** | « se modifie créneau par créneau », d'où le champ verrouillé |

Un jour à **un seul** créneau porte la marque du tableau, pas celle du calendrier. C'est correct.

---

## 4. Le thème

Sur `/admin/theme` : les préréglages **Encre clair**, **Neutre clair** et **KreativPM** sont proposés. La palette affichée doit montrer `accent #0e9480` et le nouveau jeton `aplat de saisie #51c9b2`.

Bascule système clair / sombre : la page doit suivre sans rechargement ni scintillement.

---

## 5. Ce qui a été mesuré, pas jugé à l'œil

- **Les cinq préréglages passent `findContrastIssues` et `findPolarityIssues` à zéro anomalie**, sur 48 jetons.
- **Le budget des sept colonnes tient toujours** : 45,0 points à 375 px pour une cible de 44. La fusion des plages n'en consomme aucun — bordures transparentes et aplat en débord négatif, tous deux sans largeur.
- **Le marqueur d'éclatement tient le plancher de clarté** sur les onze fonds possibles, dans les cinq préréglages : il est peint à l'encre de la case, jamais avec une teinte propre.
- **Chroma catégoriel uniforme** : C\* 39 ± 0,1 en clair. Il valait 25 · 50 · 81 · 42 · 28 · 40 avant — l'inégalité était le vrai défaut, pas l'excès.

---

## 6. Un bug de `main` corrigé au passage

L'écran « Règles de saisie » ne se construisait plus :

```
Module build failed: UnhandledSchemeError:
Reading from "node:crypto" is not handled by plugins.
```

`SettingsForm` est un composant client et importait **une valeur** depuis `@/services/settings`, qui a reçu au lot 4 une dépendance vers l'audit, donc vers `node:crypto`. **Le défaut est antérieur au lot 1g** — il est sur `main`, et n'attendait que l'ouverture de la page.

`ENGAGEMENT_SOURCES` rejoint ses deux sœurs dans `core/types.ts`, et `src/frontieres.test.ts` refuse désormais tout import de valeur d'un `services/` ou `db/` depuis un composant client. `tsc` ne pouvait pas voir ce défaut : le type était parfaitement valide.

---

## 7. Ce qui reste ouvert, à décider après la recette

- **Un cas dégénéré sans couverture** : une saisie à 0 minute portant un créneau. Le verrouillage de cellule a été corrigé (`hasSlots` filtre `minutes > 0`), mais aucun test ne couvre la cascade complète.
- **Le glissement au doigt sur un appareil réel.** `releasePointerCapture` est désormais couvert par un test, mais aucun test ne prouvera que le geste marche sur un téléphone. C'est la seule vérification que la recette peut apporter et que le code ne peut pas.
- **Le garde-fou de frontière mériterait de vivre sur `main`** indépendamment de ce lot, puisque le bug qu'il attrape y est déjà.
- **Le plan de charge** garde ses 12 colonnes dont 9 vides, et le sélecteur de mois reste doublé (`← août 2026 →` puis un champ natif). Hors périmètre du lot — question d'information, pas d'identité.

---

## 8. Vérification machine

```bash
npx vitest run && npx tsc --noEmit
```

Attendu : **2 763 tests verts, 0 erreur**. Baseline avant le lot : 2 587.
