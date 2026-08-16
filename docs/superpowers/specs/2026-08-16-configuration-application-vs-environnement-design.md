# Configuration — ce qui vit dans l'application, ce qui vit dans l'environnement

**Date :** 2026-08-16
**Statut :** design proposé, non relu par le porteur du produit
**Nature :** amendement transversal. Il modifie le lot 1b (connecteur Google) et le lot 5 (distribution portable).

---

## 1. L'incohérence, relevée par le porteur

La question était : « si tu mets dans le `.env`, ça reste autoportable ? »

Elle met le doigt sur ceci — **la clé d'API Dolibarr se saisit dans l'application** et vit chiffrée en base, **les jetons Google aussi**, mais **les identifiants du client OAuth Google restent dans un fichier texte**. Sans aucune raison technique.

Résultat : qui dézippe l'archive branche Dolibarr en trois champs dans un écran, et doit ouvrir un éditeur de texte pour brancher Google. Cela contredit la promesse du lot 5 — « tu dézippes, tu exécutes deux lignes, ça ouvre la page web ».

---

## 2. La règle

Deux natures de valeurs, aujourd'hui mélangées dans le même fichier.

**Ce que la machine fabrique seule** reste dans l'environnement, et **le script de démarrage l'engendre au premier lancement**, dans le dossier `donnees/` : le secret d'authentification, la clé de chiffrement, le jeton de l'API de synchronisation, l'adresse de la base. L'utilisateur ne les voit jamais et n'a jamais à les saisir.

**Ce qui appartient à l'utilisateur se saisit dans l'application**, et vit chiffré en base : identifiants du client OAuth Google, URL et clé d'API Dolibarr, fuseau horaire.

La ligne de partage est simple : **si l'utilisateur doit taper la valeur, elle n'a rien à faire dans un fichier.**

---

## 3. Ce qui bouge

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `GOOGLE_REDIRECT_URI` quittent l'environnement pour l'écran d'administration, stockés en portée instance dans `ProviderCredential` — exactement comme la clé Dolibarr. Le mécanisme existe et n'est pas à réinventer : `saveInstanceCredential`, `readInstanceSecret`, et `ownerScope` dans la clé de lecture.

**C'est plus sûr, pas moins.** Un secret dans le fichier d'environnement se lit en clair par quiconque accède au fichier. En base, il est scellé par `CREDENTIALS_KEY`, qui vit ailleurs : il faut désormais les deux.

`CRA_TIMEZONE` rejoint les réglages, avec le fuseau du système pour défaut. Personne ne devrait avoir à déclarer qu'il vit à Paris.

L'environnement ne conserve alors que des valeurs fabriquées : `DATABASE_URL`, `AUTH_SECRET`, `CREDENTIALS_KEY`, `SYNC_FLUSH_TOKEN`.

---

## 4. Le problème de l'URL de retour, que ce déplacement révèle

Google exige que l'URL de retour du consentement soit **enregistrée à l'avance et corresponde exactement**. Or le lot 5 fait **choisir un port libre dynamiquement**, à partir de 3000, précisément pour qu'un port occupé n'empêche jamais le démarrage.

Les deux ne peuvent pas être vrais en même temps : un port qui change casse une URL de retour figée, et la connexion Google échoue avec un message de Google, pas de l'application.

Trois corrections, toutes nécessaires :

- **L'écran d'administration affiche l'URL de retour à enregistrer**, calculée depuis l'adresse réellement servie, prête à copier. On ne demande pas à quelqu'un de la deviner.
- **Le mode portable préfère un port stable** et ne bascule qu'en dernier recours ; s'il bascule, il le dit et rappelle que Google devra être mis à jour.
- **L'URL de retour n'est jamais lue depuis la requête** pour construire la redirection — c'est la faille classique de ce type de flux, déjà traitée dans le connecteur, et ce déplacement ne doit pas la rouvrir.

---

## 5. Ce que cela règle en passant

Next recopie le `.env` du dépôt dans sa sortie `standalone`. Une archive construite en l'état embarquerait donc le secret d'authentification de développement — et, depuis que la clé de chiffrement y figure aussi, **le moyen de déchiffrer tous les jetons stockés**.

Vider ce fichier de tout ce qui appartient à l'utilisateur réduit la surface. Elle ne disparaît pas : les valeurs fabriquées doivent être engendrées dans `donnees/` au premier lancement, **jamais livrées dans l'archive**. Le script du lot 5 n'engendre aujourd'hui que le secret d'authentification.

---

## 6. Ce qui reste irréductible

**Créer un client OAuth chez Google et y ajouter le périmètre calendrier.** Aucune application ne peut le faire à la place de son utilisateur. Le rôle de l'écran est de rendre l'étape suivante évidente : ce qu'il faut créer, où, et quelle URL de retour y coller.

---

## 7. Règles métier

- **Une valeur que l'utilisateur tape ne vit jamais dans un fichier d'environnement.**
- **Les secrets d'utilisateur sont chiffrés au repos**, par le même scellement que le reste.
- **Le script de démarrage engendre les valeurs fabriquées** au premier lancement, dans `donnees/`, et jamais dans l'archive.
- **L'application reste autoportante** : sans aucun connecteur configuré, elle fonctionne intégralement.
- **L'URL de retour est affichée, jamais devinée**, et jamais lue depuis la requête.
- **Aucun secret n'apparaît dans un journal**, même tronqué.

---

## 8. Hors périmètre

- **Un gestionnaire de secrets externe.** Le produit vise l'auto-hébergement simple.
- **La rotation de la clé de chiffrement.** Elle reste une dette connue : la changer déconnecte tout le monde en silence.
- **Plusieurs jeux d'identifiants Google.** Un client OAuth par instance.

---

## 9. Tests

- **Sans aucun connecteur configuré**, l'application démarre, se connecte et saisit un CRA.
- **Les identifiants saisis à l'écran sont illisibles en base** sans la clé de chiffrement.
- **L'écran affiche l'URL de retour** correspondant à l'adresse réellement servie.
- **Un port différent produit une URL différente**, et l'écran le dit.
- **La redirection n'est jamais construite depuis la requête** — la mutation qui l'y ferait lire fait tomber un test nommé.
- **Le premier lancement engendre les valeurs fabriquées** et les écrit dans `donnees/`, pas dans l'archive.
- **Un second lancement les réutilise** sans en engendrer de nouvelles — sans quoi chaque redémarrage déconnecterait toutes les sessions et rendrait les jetons illisibles.
- **Aucun secret dans les journaux**, vérifié par la rédaction déjà en place.

---

## 10. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Le fuseau horaire rejoint les réglages**, avec le système pour défaut.
- **Le mode portable préfère un port stable** au lieu d'en choisir un libre en priorité, pour ne pas casser l'URL de retour.
- **Un seul client OAuth par instance.**
- **Le jeton de l'API de synchronisation reste dans l'environnement** : il est fabriqué, et destiné à un outil, pas à une personne.
