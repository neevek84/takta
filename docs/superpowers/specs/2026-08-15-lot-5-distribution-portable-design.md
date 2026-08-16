# Lot 5 — Distribution portable

**Date :** 2026-08-15
**Statut :** design en cours d'arbitrage avec le porteur du produit
**Prérequis :** produit stabilisé.
**Remplace** une première version, écartée : elle proposait un empaquetage Tauri et un fonctionnement hors ligne. Les deux sont abandonnés — trop complexes pour le besoin réel.

---

## 1. Intention

Permettre à quelqu'un qui ne veut ni serveur ni Docker de faire tourner l'application **sur son ordinateur**.

On télécharge une archive, on la dézippe, on lance une commande, le navigateur s'ouvre. On lance une autre commande pour arrêter.

**Le vrai sujet n'est pas le démarrage, c'est l'exploitation.** Savoir arrêter proprement, relancer, mettre à jour, et surtout **ne jamais perdre sa base**. Une application qu'on n'ose plus éteindre de peur de perdre six mois de CRA est inutilisable, même si elle démarre bien.

### Ce qui est abandonné, et pourquoi

**Tauri.** Un vrai double-clic imposerait un build par plateforme, une signature de code payante sur macOS comme sur Windows, et un mécanisme de mise à jour automatique. Le coût est sans rapport avec le gain sur un produit qui vise quelques utilisateurs techniques.

**Le hors-ligne.** Il demandait une file de saisies locale, un arbitrage au retour du réseau et une identité déconnectée. L'application tourne ici sur la machine de l'utilisateur : le réseau n'est pas le sujet.

---

## 2. L'archive

Une archive **autosuffisante**, décompressée où l'on veut :

```
cra/
  demarrer.sh      demarrer.cmd
  arreter.sh       arreter.cmd
  creer-utilisateur.sh
  sauvegarder.sh
  LISEZMOI.txt
  app/             l'application construite en sortie standalone
  donnees/         créé au premier démarrage — JAMAIS dans l'archive
```

**Aucune installation de dépendances au dézippage.** Les modules nécessaires sont tracés par la sortie `standalone` de Next.js et embarqués. Pas de `npm install`, pas de réseau, pas de registre à joindre.

**Un seul prérequis, à dire clairement : Node.js 20 ou plus.** Le `LISEZMOI` commence par là, et `demarrer` vérifie la version avant toute chose — un message net vaut mieux qu'une pile d'erreurs incompréhensible.

**Une archive par plateforme** — macOS Apple Silicon, macOS Intel, Windows x64, Linux x64. Les moteurs Prisma sont compilés par architecture ; il n'y a pas d'archive universelle, et prétendre le contraire produirait un échec au premier lancement.

---

## 3. Démarrer

```bash
./demarrer.sh
```

Une commande, qui fait tout :

1. **vérifie Node** et s'arrête avec un message clair si la version ne convient ;
2. **crée `donnees/` et la base** au premier lancement, en appliquant le schéma ;
3. **applique les migrations** en attente aux lancements suivants — c'est ce qui rend une mise à jour indolore ;
4. **choisit un port libre** à partir de 3000, et n'échoue jamais parce qu'un autre programme occupe le port ;
5. **écrit `donnees/cra.pid`** avec le numéro du processus ;
6. **démarre, attend que l'application réponde, ouvre le navigateur**, et affiche l'adresse en clair.

Au tout premier lancement, s'il n'existe aucun utilisateur, la commande invite à en créer un — sinon on arrive sur une page de connexion sans identifiants, ce qui est une impasse.

---

## 4. Arrêter, et le faire sans crainte

```bash
./arreter.sh
```

Lit `donnees/cra.pid`, arrête le processus, retire le fichier. Si le processus n'existe plus, le dit sans faire d'histoire.

**Un point à écrire noir sur blanc dans le `LISEZMOI` :** SQLite écrit sur le disque à chaque transaction validée. **Fermer la fenêtre, arrêter le processus ou couper l'ordinateur ne perd aucune donnée déjà enregistrée.** C'est la phrase qui permet d'oser éteindre.

**Une correction apportée par le plan** : l'application n'est PAS en journalisation `WAL` aujourd'hui — son pragma vaut `delete`. La phrase ci-dessus n'est donc vraie qu'une fois le mode activé, ce que le lot fait explicitement et vérifie en relisant le pragma. Sans cela, le `LISEZMOI` mentirait sur la sécurité des données.

---

## 5. Sauvegarder

```bash
./sauvegarder.sh
```

Produit un fichier daté à côté de l'application, par la commande d'archivage propre de SQLite — la seule qui garantisse un fichier cohérent même si l'application tourne.

Et l'instruction qui compte, en une ligne dans le `LISEZMOI` : **toutes tes données sont dans le dossier `donnees/`. Le copier, c'est tout sauvegarder.**

---

## 6. Mettre à jour sans rien perdre

C'est le moment le plus dangereux du cycle de vie, donc le plus explicite :

1. `./arreter.sh`
2. dézipper la nouvelle version **dans un dossier neuf**
3. copier son propre dossier `donnees/` dans ce dossier neuf
4. `./demarrer.sh` — les migrations s'appliquent toutes seules

**L'archive ne contient jamais de dossier `donnees/`.** C'est la propriété qui rend l'écrasement accidentel impossible : même en dézippant par-dessus l'installation existante, rien ne peut remplacer la base.

Au démarrage, l'application **enregistre une copie de sauvegarde avant d'appliquer une migration**. Une migration ratée se rattrape ; une migration ratée sans sauvegarde, non.

---

## 7. Le LISEZMOI

Il tient sur un écran, dans cet ordre — parce que c'est l'ordre des questions que se pose quelqu'un qui vient de dézipper :

1. il faut Node.js 20 ou plus, et voici comment vérifier ;
2. pour démarrer : une commande ;
3. pour arrêter : une commande ;
4. tes données sont dans `donnees/`, le copier suffit à tout sauvegarder ;
5. arrêter ou couper le courant ne perd rien de ce qui est enregistré ;
6. pour mettre à jour : les quatre étapes ;
7. si le navigateur ne s'ouvre pas, voici l'adresse à saisir.

En français, sans jargon, et **testé sur une machine qui n'a jamais vu le projet**.

---

## 8. Règles métier

- **L'archive ne contient jamais le dossier `donnees/`.**
- **Aucune installation de dépendances n'est requise au dézippage.**
- **Le port est choisi dynamiquement** ; un port occupé n'empêche jamais le démarrage.
- **Les migrations s'appliquent au démarrage**, précédées d'une copie de sauvegarde.
- **L'arrêt ne perd aucune donnée enregistrée**, et le `LISEZMOI` le dit explicitement.
- **Une archive par plateforme**, jamais d'archive prétendument universelle.

---

## 9. Hors périmètre

- **Empaquetage en application native** (Tauri, Electron) et signature de code.
- **Fonctionnement hors ligne** avec file de saisies locale et arbitrage au retour.
- **Mise à jour automatique.** On télécharge la nouvelle archive et on suit quatre étapes.
- **Installateur graphique.**
- **Postgres dans l'archive.** Le mode portable, c'est SQLite ; qui veut Postgres déploie avec Docker.

---

## 10. Tests

- **Sur une machine vierge**, sans le dépôt ni aucune dépendance installée : dézipper, démarrer, se connecter — c'est le test qui vaut tous les autres.
- **`demarrer` sur une version de Node trop ancienne** produit un message compréhensible, pas une pile d'appels.
- **Le port est bien choisi dynamiquement** : démarrer avec le 3000 déjà occupé fonctionne et annonce le bon.
- **Arrêter puis redémarrer** retrouve exactement les mêmes données.
- **Tuer le processus brutalement** pendant une saisie ne perd aucune écriture validée.
- **Dézipper la nouvelle version par-dessus l'ancienne n'écrase aucune base** — l'archive ne contient pas `donnees/`.
- **Une mise à jour avec migration** part d'une base créée par la version précédente et aboutit, avec sa copie de sauvegarde écrite avant.
- **`sauvegarder` produit un fichier exploitable** pendant que l'application tourne, et le restaurer redonne le même état.
- **`arreter` sur une application déjà arrêtée** ne produit pas d'erreur.

---

## 11. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Les modules sont embarqués dans l'archive** plutôt qu'installés au dézippage. L'archive pèse plus lourd, mais ne dépend d'aucun réseau.
- **`donnees/` est à côté de l'application**, et non dans le dossier utilisateur du système. C'est visible, donc sauvegardable sans explication.
- **Une copie de sauvegarde est prise automatiquement avant chaque migration.**
- **Quatre scripts** : démarrer, arrêter, créer un utilisateur, sauvegarder. Pas de commande unique à sous-commandes, qui serait plus élégante et moins évidente.
