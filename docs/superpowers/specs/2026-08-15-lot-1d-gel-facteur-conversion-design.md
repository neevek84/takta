# Lot 1d — Gel du facteur de conversion et cascade d'heures par jour

**Date :** 2026-08-15
**Statut :** design proposé, non relu par le porteur du produit
**Priorité :** à traiter **avant** les lots 1b et 1c — c'est un défaut d'intégrité de données déjà observé en usage.

---

## 1. Le défaut

`minutesParJour` est aujourd'hui un **réglage lu au moment du calcul**, jamais stocké sur la donnée. Le temps est bien enregistré en minutes — c'était le bon choix — mais le facteur qui les convertit en jours est relu à chaque affichage.

Conséquence, constatée en test par le porteur du produit : **passer le réglage de 8 h à 7 h réinterprète tout l'historique.** Un CRA validé à 20 jours en affiche 22,86. Aucune donnée n'a bougé, et pourtant le document a changé.

C'est inacceptable pour trois raisons :

- **Un CRA validé est un document signé.** Son contenu ne peut pas évoluer après signature.
- **Le lot 2 poussera ces temps dans Dolibarr**, où ils deviendront la base d'une facture.
- **Le lot 1a projette un chiffre d'affaires** à partir de ces jours : un réglage modifié déplacerait rétroactivement le CA d'exercices clos.

Le lot 0 avait raison de stocker les minutes plutôt que les jours. Il lui manquait de figer le taux.

---

## 2. Le correctif — figer sur la saisie

`TimeEntry` gagne une colonne `minutesParJour Int` : **la valeur effective au moment de l'écriture**.

C'est le patron comptable habituel — on ne stocke pas un montant en devise sans le taux du jour. Une saisie devient auto-suffisante : ses minutes et son facteur voyagent ensemble, et aucun réglage ultérieur ne peut la réinterpréter.

Tous les calculs — engagement, cellules de la matrice, chiffre d'affaires, totaux — lisent désormais le facteur **porté par la saisie**, jamais le réglage courant.

### Reprise de l'existant

Les saisies déjà en base reçoivent la valeur effective actuelle de leur prestation, calculée par la cascade décrite ci-dessous. C'est la seule interprétation possible, et elle est exacte tant que le réglage n'a pas changé depuis.

### Changer le réglage plus tard

Un changement de réglage ne touche **jamais** les saisies existantes. L'écran propose de **réétalonner les saisies des mois non validés** — un geste explicite, avec un compte rendu du nombre de saisies concernées.

**Les saisies d'un mois validé ne sont jamais réétalonnées.** L'option n'est pas seulement refusée : elle n'est pas offerte.

---

## 3. La cascade

Le facteur effectif d'une saisie se résout du plus spécifique au plus général :

```
MissionLine.minutesParJour        (existe déjà)
  └─ Mission.minutesParJour       (nouveau)
      └─ Client.minutesParJour    (nouveau)
          └─ Settings.minutesParJour   (défaut global)
```

Le premier niveau renseigné gagne. Deux colonnes nullables suffisent — `Client.minutesParJour` et `Mission.minutesParJour`.

Le besoin est réel et manquait à la conception initiale : **un client facturé sur une base de 7 h et un autre sur 8 h** est un cas courant, et le porter uniquement au niveau de la prestation obligeait à le ressaisir sur chaque ligne.

Les écrans de création de client et de mission exposent le champ, vide par défaut, avec la valeur héritée affichée à côté — « hérité : 8 h ». Un champ de surcharge qui ne montre pas ce qu'il surcharge invite à l'erreur.

---

## 4. Règles métier

- **Une saisie porte son propre facteur de conversion**, figé à l'écriture.
- **Aucun changement de réglage ne réécrit une saisie existante.**
- **Les saisies d'un mois validé ne sont jamais réétalonnées**, ni automatiquement ni manuellement.
- **Le réétalonnage des mois ouverts est explicite** et rend un compte rendu.
- **La cascade va du plus spécifique au plus général**, premier niveau renseigné gagnant.
- **Tout calcul lit le facteur de la saisie**, jamais le réglage courant.

---

## 5. Hors périmètre

- **Historisation du réglage global.** La valeur figée sur la saisie suffit ; conserver en plus un journal des réglages n'apporterait rien.
- **Surcharge au niveau du CRA** ou du mois. La cascade couvre les cas réels.
- **Réétalonnage automatique**, sous quelque condition que ce soit.

---

## 6. Tests

- **Le test central** : un CRA validé à 20 jours affiche toujours 20 jours après passage du réglage global de 480 à 420 minutes. C'est le défaut observé, il doit être verrouillé par un test avant toute correction.
- **La cascade** est vérifiée à ses quatre niveaux, y compris une prestation qui surcharge une mission qui surcharge un client.
- **Une saisie créée après un changement de réglage porte la nouvelle valeur**, sa voisine créée avant garde l'ancienne, et les deux coexistent dans le même mois sans que les totaux ne se contredisent.
- **Le réétalonnage ne touche que les mois non validés**, et son compte rendu correspond au nombre réel de saisies modifiées.
- **La reprise des données existantes** attribue à chaque saisie la valeur effective de sa prestation.
- **Aucun calcul ne lit plus `Settings.minutesParJour`** pour convertir une saisie : une recherche dans les services et les composants ne doit trouver ce réglage que dans la résolution de la cascade à l'écriture.

---

## 7. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Le gel se fait sur la saisie**, pas sur le CRA. Un mois peut ainsi mêler des prestations à 7 h et à 8 h sans ambiguïté.
- **Le réétalonnage des mois ouverts est proposé, pas imposé.**
- **La cascade comporte quatre niveaux.** Le niveau mission est peut-être superflu si la surcharge par client suffit en pratique.
