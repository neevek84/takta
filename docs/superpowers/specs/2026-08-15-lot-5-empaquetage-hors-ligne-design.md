# Lot 5 — Empaquetage et hors-ligne

**Date :** 2026-08-15
**Statut :** design proposé, non relu par le porteur du produit
**Prérequis :** produit stabilisé. Ce lot n'a de sens qu'une fois les lots précédents en service.

---

## 1. Intention

Deux besoins distincts, réunis parce qu'ils partagent la même condition : **le produit doit être stable avant d'y toucher.**

**L'empaquetage** répond à « comment quelqu'un sans serveur l'installe facilement » — un fichier à double-cliquer, sans Node, sans terminal, sans Docker.

**Le hors-ligne** répond à « je saisis chez un client sans réseau » — un besoin réel identifié dès le lot 1c, écarté à l'époque parce qu'il constitue un sujet en soi.

### Pourquoi en dernier

Empaqueter un produit encore instable revient à republier des installeurs toutes les semaines. Et une file de saisies hors ligne se conçoit une fois qu'on sait ce que les gens saisissent réellement, pas avant.

Le lot 0 a posé les trois contraintes qui rendent ce lot possible sans rien réécrire — schéma dans l'intersection SQLite/Postgres, sortie Next.js en `standalone`, aucune dépendance au serverless. **Il ne reste qu'à les exploiter.**

---

## 2. Empaquetage — Tauri

Une coquille Tauri embarquant le serveur Next.js en mode `standalone` et une base SQLite dans le répertoire de données de l'utilisateur.

Le résultat : un `.dmg` sur macOS, un `.exe` sur Windows, un `AppImage` sur Linux. On double-clique, l'application s'ouvre.

**Le coût est du côté du constructeur, pas de l'utilisateur** : build par plateforme, signature de code — payante sur macOS comme sur Windows — et mises à jour automatiques. C'est précisément ce coût qui justifie d'attendre la stabilité.

### Points à traiter

- **Le port** : le serveur embarqué écoute sur un port libre choisi au démarrage, jamais un port fixe qui entrerait en conflit.
- **La base** : dans le répertoire de données de la plateforme, avec un export et un import depuis l'application. **La sauvegarde doit être un geste**, pas une explication.
- **Le premier lancement** : création du schéma et du premier utilisateur, sans terminal.
- **Les secrets** : la clé de chiffrement des identifiants est générée au premier lancement et rangée dans le trousseau du système, pas dans un fichier à côté de la base.
- **Les mises à jour** : signées, vérifiées, avec migration de schéma au démarrage.

---

## 3. Hors-ligne

### Ce qui marche déjà

Le `service worker` du lot 1c met en cache la coquille : l'application **démarre** sans réseau. Ce lot ajoute la capacité à **écrire** sans réseau.

### Une file locale, et une seule

Les saisies faites hors ligne s'inscrivent dans une file locale — `IndexedDB` — et partent au retour du réseau. Le modèle est celui, déjà éprouvé, de la file de sortie du lot 1b : **un ensemble d'entités à pousser, dédupliqué par clé**, jamais un journal d'événements.

Cette symétrie n'est pas cosmétique : c'est ce qui permet de raisonner sur les deux mécanismes de la même façon.

### Les règles ne peuvent pas toutes s'appliquer hors ligne

Le point difficile, et il faut le regarder en face. Le contrôle de capacité, la vérification d'affectation et le verrouillage du CRA vivent dans les services, donc côté serveur. Hors ligne, ils sont hors d'atteinte.

**La saisie hors ligne est donc optimiste**, et le serveur arbitre au retour :

- une saisie refusée par le contrôle de capacité revient dans une **file de saisies rejetées**, avec son motif ;
- une saisie sur un mois verrouillé entre-temps est rejetée de la même manière ;
- rien n'est perdu en silence, rien n'est appliqué en silence.

C'est le même principe que la file d'arbitrage du lot 1b, appliqué à un autre type de divergence — et c'est la seule réponse honnête au problème.

**Le contrôle de capacité peut être approché localement**, à partir des données du mois déjà chargées, pour avertir au moment de la saisie. C'est un confort, pas une garantie : le verdict qui fait foi reste celui du serveur.

---

## 4. Règles métier

- **Rien n'est perdu en silence, rien n'est appliqué en silence.** Toute saisie hors ligne rejetée revient avec son motif.
- **Le serveur reste l'arbitre** de toutes les règles métier. Les contrôles locaux sont indicatifs.
- **La sauvegarde de la base est un geste** dans l'application empaquetée.
- **Les secrets vivent dans le trousseau du système**, jamais à côté de la base.
- **Les mises à jour sont signées et vérifiées.**

---

## 5. Hors périmètre

- **Synchronisation multi-appareils** hors ligne. Un appareil, une file. Deux téléphones saisissant hors ligne le même jour sont un problème de fusion qui dépasse largement ce lot.
- **Fonctionnement hors ligne du plan de charge et de l'administration.** La saisie et la consultation du mois courant suffisent.
- **Distribution par les magasins d'applications.**

---

## 6. Tests

- **L'application empaquetée démarre, crée son schéma et son premier utilisateur** sur une machine vierge, sans Node installé.
- **Le port est choisi dynamiquement** et un port déjà pris ne bloque pas le démarrage.
- **Export puis import de la base** restituent un état identique.
- **La file hors ligne déduplique** : dix corrections d'une même cellule produisent une entrée, pas dix.
- **Une saisie hors ligne rejetée par le serveur revient avec son motif** et n'est jamais perdue — c'est le test qui protège la promesse centrale du lot.
- **Une saisie hors ligne sur un mois verrouillé entre-temps est rejetée**, pas appliquée.
- **La migration de schéma au démarrage** fonctionne sur une base créée par une version antérieure.

---

## 7. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Tauri** plutôt qu'Electron : image plus légère, et le serveur Next.js est de toute façon embarqué en `standalone` dans les deux cas.
- **Saisie hors ligne optimiste**, avec arbitrage serveur au retour, plutôt qu'une réimplémentation des règles côté client — qui divergerait.
- **Un seul appareil hors ligne** à la fois, sans fusion multi-appareils.
- **Hors-ligne limité à la saisie et à la consultation du mois courant.**
