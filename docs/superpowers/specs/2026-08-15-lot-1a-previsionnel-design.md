# Lot 1a — Prévisionnel et plan de charge

**Date :** 2026-08-15
**Statut :** design validé, en attente de plan d'implémentation
**Prérequis :** lot 0 livré (commit `77b2f28`)

---

## 1. Intention

Rendre exploitables les **mois à venir**. Le lot 0 sait enregistrer et restituer le passé ; il ne sait pas répondre à « suis-je rempli, et jusqu'à quand ».

Le chiffre que cette fonctionnalité doit produire est le **reste à vendre** : ce qui manque, sur l'exercice, entre l'objectif de chiffre d'affaires et ce qui est déjà réalisé ou planifié. C'est lui qui déclenche une décision commerciale — pas un pourcentage d'occupation.

### Décomposition du lot 1

Le lot 1 de la spec initiale contenait trois sous-systèmes indépendants, aux risques très différents. Il est découpé :

| | Contenu | Dépendances externes |
|---|---|---|
| **1a** — cette spec | Prévisionnel, navigation entre mois, conversion des jours passés, plan de charge | aucune |
| **1b** | Google Calendar : OAuth, blocs, détection de conflit, file d'arbitrage | Google |
| **1c** | Surface mobile PWA | aucune, mais second modèle d'interaction |

L'ordre n'est pas arbitraire : **1b n'a aucun sens sans 1a** — bloquer un agenda suppose de savoir planifier — et 1c est une seconde surface au-dessus de 1a. Chacun aura son cycle spec → plan → implémentation.

### Le TJM redevient porteur

La spec du lot 0 a sorti la facturation du produit et déclaré le `tjm` « informatif ». Il redevient load-bearing ici, mais pour **projeter**, jamais pour facturer.

La distinction tient et doit être maintenue : l'application calcule un prévisionnel de chiffre d'affaires ; elle n'émet aucun document, ne produit aucune ligne de facture, ne calcule aucune TVA.

---

## 2. Ce que le lot 0 fournit déjà

Vérifié dans le code, à ne pas reconcevoir :

- `TimeEntry.kind ∈ { REALISE, PREVISIONNEL }` — toute cellule saisie sur une date future part déjà en `PREVISIONNEL` (`SaisieClient.tsx`).
- `getLineEngagementTotals(userId, lineIds)` cumule réalisé et prévu **sans borne de mois**.
- `MissionLine.tjmCents` et `soldCentiemes` sont peuplés.
- `Settings.minutesParJour`, surchargeable par ligne.

**Le trou principal :** il n'existe aucune navigation entre les mois. La route `/saisie/[month]` fonctionne, mais rien dans l'interface ne permet d'aller sur un autre mois. C'est le premier obstacle à lever.

---

## 3. Modèle de données

**Deux réglages nouveaux dans `Settings`, rien d'autre.**

| Champ | Type | Défaut | Sens |
|---|---|---|---|
| `objectifCaExerciceCents` | `Int` | `0` | Objectif de CA sur l'exercice, en **centimes** |
| `debutExerciceMois` | `Int` | `1` | Mois de début d'exercice, 1–12 |

`0` sur l'objectif signifie « non défini » : la barre d'exercice et le reste à vendre sont alors masqués plutôt qu'affichés à zéro.

Aucune nouvelle table, aucune nouvelle colonne ailleurs. Tout le reste est du calcul sur des données existantes.

---

## 4. Calculs — tous dans `core/`

Purs, sans base ni réseau, conformément à la contrainte du projet.

```ts
// core/fiscal/year.ts
interface FiscalYear { start: string; end: string; label: string; months: string[] }
fiscalYearBounds(date: string, debutMois: number): FiscalYear
```

`months` contient les 12 mois `'YYYY-MM'` dans l'ordre de l'exercice. Le libellé vaut `'Exercice 2026-2027'` quand l'exercice chevauche deux années civiles, et `'Exercice 2026'` quand `debutMois === 1`.

```ts
// core/fiscal/revenue.ts
caFromEntries(
  entries: ReadonlyArray<{ lineId: string; minutes: number }>,
  lines: ReadonlyArray<{ id: string; tjmCents: number; minutesParJour: number }>,
): number   // centimes
```

Calcul par entrée : `Math.round(minutes * tjmCents / minutesParJour)`. On reste en entiers de bout en bout, jamais de flottant persisté ni cumulé.

```ts
interface ExerciceProgress {
  objectifCents: number
  realiseCents: number
  prevuCents: number
  resteAVendreCents: number      // plafonné à 0
  depassementCents: number       // exposé séparément
  tauxCouverture: number         // 0 si objectif nul
}
exerciceProgress(objectifCents, realiseCents, prevuCents): ExerciceProgress
```

Le plafonnement à zéro avec dépassement exposé à part reprend exactement la convention de `computeEngagement` du lot 0 — deux calculs voisins ne doivent pas se comporter différemment.

```ts
tjmMoyenPondere(lines: ReadonlyArray<{ tjmCents: number; soldCentiemes: number }>): number | null
resteEnCentiemes(resteAVendreCents: number, tjmMoyenCents: number | null): number | null
```

La moyenne est pondérée par les **jours vendus** de chaque ligne, pas par un simple arithmétique : une ligne de 30 jours à 800 € pèse plus qu'une ligne de 10 jours à 1 200 €. Sans ligne active, la fonction renvoie `null` et l'interface masque la conversion en jours plutôt que d'afficher un chiffre faux.

---

## 5. Services

```ts
// services/time-entries.ts (extension)
listPastForecast(userId: string, month: string): Promise<MonthEntry[]>
convertPastForecast(userId: string, month: string): Promise<{ converted: number } | { ok: false; reason: 'VERROUILLE' }>

// services/charge.ts (nouveau)
interface ChargeCell { realiseCentiemes: number; prevuCentiemes: number }
interface ChargeRow {
  lineId: string
  label: string          // client · mission · ligne
  cells: ChargeCell[]    // un par mois de l'exercice, dans l'ordre
  engagement: EngagementSummary   // réutilisé du lot 0, non réimplémenté
  resteAVendreCents: number
}
interface ChargeMatrix {
  fiscalYear: FiscalYear
  rows: ChargeRow[]
  monthTotals: Array<{ centiemes: number; caCents: number }>
  progress: ExerciceProgress
}
buildChargeMatrix(userId: string, fiscalYear: FiscalYear): Promise<ChargeMatrix>
```

Le **reste à planifier** par ligne n'est pas recalculé : c'est `computeEngagement` du lot 0, déjà testé, appliqué aux entrées de la ligne. Deux implémentations du même calcul divergeraient tôt ou tard.

Toutes scopées par `userId`, comme l'impose la règle du projet.

`convertPastForecast` change `kind` de `PREVISIONNEL` à `REALISE` sur les entrées dont la date est strictement antérieure à aujourd'hui. Elle **ne touche jamais aux minutes**, donc le contrôle de capacité n'a pas à être rejoué. Elle refuse en revanche d'agir sur un mois dont le CRA est `VALIDE`, exactement comme `saveEntry`.

---

## 6. Les trois écrans

### Navigation entre mois

Sur `/saisie/[month]` : mois précédent, mois suivant, retour au mois courant, et un sélecteur direct. Sans elle, rien du reste n'est atteignable.

### Valider les jours passés

Sur le mois courant, un encart apparaît dès qu'il existe des jours prévisionnels déjà écoulés : « 3 jours prévus sont passés », la liste, et un bouton de conversion.

**La conversion n'est jamais automatique.** Un jour prévu qui deviendrait réalisé de lui-même, c'est du temps engageant créé sans décision humaine. L'encart est un rappel, pas un traitement.

Sur un mois verrouillé, l'encart affiche le motif au lieu du bouton.

### Plan de charge

Route `/charge`.

**En haut, la barre d'exercice** : `réalisé · prévu · reste à vendre`, en euros, avec le taux de couverture. Sous la barre, le reste à vendre traduit en jours au TJM moyen pondéré — « il manque 42 000 €, soit environ 53 jours ». C'est la ligne qui déclenche une action.

**Au centre, la matrice** : lignes de prestation en lignes, les 12 mois de l'exercice en colonnes. Chaque cellule porte les jours du mois pour cette ligne, réalisé et prévu distingués visuellement comme dans la grille de saisie.

**En marge droite**, par ligne : `vendu · réalisé · prévu · reste à planifier`, en jours et en euros.

**En marge basse**, par mois : total de jours et CA du mois.

Un sélecteur d'exercice permet de reculer et d'avancer d'une année.

---

## 7. Règles métier

- **La conversion prévisionnel → réalisé n'est jamais automatique.**
- **Un mois dont le CRA est `VALIDE` refuse la conversion**, comme il refuse toute écriture de temps.
- **Le TJM sert à projeter, jamais à facturer.** Aucun document, aucune ligne de facture, aucune TVA.
- **Le reste à vendre est plafonné à zéro**, le dépassement est exposé séparément — même convention que `computeEngagement`.
- **Entiers partout** : minutes, centièmes de jour, centimes. Aucun flottant persisté ni cumulé.
- **Un objectif à zéro masque la barre d'exercice** plutôt que d'afficher des pourcentages vides de sens.

---

## 8. Hors périmètre

Explicitement exclus de ce lot, et pourquoi :

- **Moteur de répartition automatique** des jours prévisionnels. La saisie reste cellule par cellule dans la grille : le glissement livré au lot 0 remplit déjà une semaine en un geste, un moteur de répartition ajouterait un concept pour un gain marginal.
- **Objectif mensuel.** L'objectif porte sur l'exercice, pas sur le mois.
- **Facturation**, sous toutes ses formes. Définitivement hors produit.
- **Google Calendar** (lot 1b) et **surface mobile** (lot 1c).

---

## 9. Notes d'exploitation

Relevées sur l'instance Dolibarr cible, utiles à la mise en service et au lot 2 :

- `SOCIETE_FISCAL_MONTH_START = 4` — l'exercice court d'**avril à mars**. C'est la valeur à saisir dans `debutExerciceMois`.
- `TIMESHEET_DAY_DURATION = 7` — Dolibarr compte la journée à **7 heures**, quand le lot 0 est par défaut à 480 minutes. À aligner en administration, faute de quoi un jour ne vaudra pas la même chose des deux côtés lorsque le connecteur arrivera.

Ces deux constantes sont lisibles par l'API Dolibarr. **Le lot 2 pourra proposer de les reprendre** au lieu de les faire ressaisir — à traiter dans sa propre spec, pas ici.

---

## 10. Tests

- **`core/` sans base ni réseau**, où porte l'essentiel de l'effort :
  - `fiscalYearBounds` sur les cas limites — `debutMois = 1` (exercice civil), date avant et après le pivot, exercice à cheval sur deux années, année bissextile ;
  - `caFromEntries` avec des TJM différents par ligne et des `minutesParJour` surchargés, en vérifiant l'absence de dérive d'arrondi sur un cumul de plusieurs centaines d'entrées ;
  - `exerciceProgress` sur objectif nul, dépassement, et égalité stricte ;
  - `tjmMoyenPondere` sans ligne active, avec une seule ligne, et avec la pondération réellement vérifiée — un test qui passerait aussi sur une moyenne arithmétique ne prouve rien.
- **Services contre la base de test** : `convertPastForecast` ne convertit que le passé strict, refuse un mois verrouillé, et ne modifie aucune minute.
- **Isolation par utilisateur** vérifiée sur `buildChargeMatrix`, comme sur tous les services.
