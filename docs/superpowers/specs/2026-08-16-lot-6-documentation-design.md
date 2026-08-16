# Lot 6 — Documentation

**Date :** 2026-08-16
**Statut :** design proposé, non relu par le porteur du produit
**Position :** **lot final.** Il documente le produit fini ; l'écrire plus tôt reviendrait à décrire ce qui va changer.

---

## 1. Intention

Rendre le produit **reprenable** — par le porteur dans six mois, par un tiers qui le déploie, par un développeur qui reprend le code.

Et, au cœur du lot, une exigence précise du porteur : **savoir où sont les appels aux API externes, quels paramètres chacun porte, et comment les mettre à jour**, pour suivre les évolutions de Dolibarr dans le temps.

---

## 2. Le problème que pose cette exigence

Un chapitre en prose qui liste les appels API **ment au bout de trois mois**. Quelqu'un ajoute une requête, oublie la doc, et le suivi des évolutions devient faux au moment exact où l'on s'y fie.

Ce projet a déjà tranché ce genre de question deux fois, dans le même sens :

- le contraste n'est pas *recommandé*, il est **refusé au calcul** à l'enregistrement d'un thème ;
- la dérive du schéma n'est pas *surveillée*, elle est **détectée par un test** qui compare types, nullabilité et contraintes.

La documentation des intégrations suit la même règle : **elle est engendrée depuis le code, et un test refuse qu'elle diverge.**

---

## 3. Le catalogue des appels externes

### Ce qu'il est

Un module par système, **à côté du connecteur qu'il décrit** — `src/integrations/dolibarr/catalogue.ts`, `src/integrations/google/catalogue.ts`, et ainsi de suite. Les fichiers qui changent ensemble vivent ensemble : ajouter un appel et oublier son entrée devient un geste visible en revue.

Chaque entrée déclare, pour un appel :

| Champ | Ce qu'il porte |
|---|---|
| **Opération** | ce que l'appel fait, en langage métier — « pousser un temps consommé sur une tâche », pas `POST /tasks/{id}/addtimespent` |
| **Méthode et chemin** | le gabarit réel, paramètres de chemin compris |
| **Paramètres envoyés** | chacun, avec **d'où vient sa valeur** : un réglage, une saisie, un calcul, une constante |
| **Version vérifiée** | contre quelle version du système tiers cet appel a été **prouvé**, et à quelle date |
| **Comportement en échec** | rejoué, abandonné, silencieux — et ce que l'utilisateur voit |
| **Réglage tiers dont il dépend** | par exemple `TIMESHEET_DAY_DURATION` côté Dolibarr, qui change le sens des données envoyées |

La colonne **« d'où vient la valeur »** est celle qui sert vraiment. Quand Dolibarr change le format d'un champ, la question n'est pas « où est l'appel » — elle est « qu'est-ce que je dois recalculer pour le remplir autrement ».

### Ce qu'il n'est pas

Ce n'est pas une réécriture de la documentation de Dolibarr, ni un client générique. Le catalogue décrit **les appels que cette application émet**, et rien d'autre.

---

## 4. Les trois tests qui empêchent le catalogue de mentir

**Aucun appel non catalogué.** Le double d'API de chaque système n'accepte que les routes déclarées au catalogue. Une requête vers une route absente est refusée — donc un appel ajouté sans son entrée fait échouer les tests du connecteur, tout de suite, sans arbitrage humain.

**Aucune entrée non prouvée.** Les doubles enregistrent déjà les appels reçus. Un test exerce les opérations du connecteur et compare l'ensemble des couples *(méthode, chemin)* réellement émis à celui du catalogue. Une entrée que rien n'exerce est une entrée inventée ; elle tombe.

**Le document publié est celui du catalogue.** Le chapitre `docs/integrations.md` est **engendré** depuis les catalogues. Un test échoue si le fichier committé diffère de ce que produirait la génération — le même geste que le garde-fou de dérive du schéma, pour la même raison.

Ces trois tests portent le lot. Sans eux, il ne reste qu'un document de plus.

---

## 5. Suivre les évolutions d'un système tiers

Le chapitre porte une **procédure**, pas seulement un état :

1. le catalogue dit contre quelle version chaque appel a été prouvé — l'environnement du porteur est aujourd'hui **Dolibarr 23.0.1** ;
2. le lot 2 livre un **test d'intégration sur instance jetable** : un vrai Dolibarr, lancé le temps du test ;
3. après une montée de version, on relance ce test contre la nouvelle instance ;
4. ce qui passe voit sa version mise à jour dans le catalogue ; ce qui casse est nommé, avec l'appel et le champ fautifs ;
5. la génération du document suit.

C'est ce qui transforme « je crois que ça marche encore » en « c'est prouvé contre telle version, à telle date ».

**Les réglages tiers qui changent le sens des données méritent leur propre encadré.** `TIMESHEET_DAY_DURATION` en est l'exemple vivant, et il est aussi l'exemple de ce que ce chapitre doit empêcher : **cette spec elle-même a d'abord affirmé qu'il rendait les temps « faux d'un septième ». C'était faux.** `task_duration` est en secondes — huit heures travaillées valent 28 800 secondes quel que soit ce réglage. Ce qu'il change est la **lecture** jour/heure dans Dolibarr, où huit heures s'affichent « 1,14 jour ». Cela **s'aligne**, cela ne se compense pas ; un implémenteur a refusé, à juste titre, une instruction qui lui demandait de compenser.

L'encadré doit donc distinguer **ce qui altère la donnée envoyée** de **ce qui n'altère que son affichage chez le tiers**. Confondre les deux est précisément l'erreur qui a circulé ici, et un catalogue engendré depuis le code l'aurait rendue impossible.

---

## 6. Le reste de la documentation

Trois publics, trois besoins. Rien de plus que ce qui sert.

**Pour qui déploie** — installation par archive portable, par Docker, ou sur un serveur ; les variables d'environnement et lesquelles sont obligatoires ; activer un connecteur optionnel ; sauvegarder, arrêter, relancer, mettre à jour sans perdre la base. Cette dernière partie est le vrai sujet d'exploitation, et le lot 5 en porte déjà la matière.

**Pour qui reprend le code** — l'architecture en trois couches et pourquoi le cœur n'importe jamais Prisma ; les règles métier qu'on n'enfreint pas ; les pièges d'environnement durement acquis ; la méthode de travail et ce qu'elle a coûté d'apprendre.

**Pour le porteur** — les décisions structurantes et **leur pourquoi**. C'est la partie qui a le plus de valeur dans six mois, parce que c'est celle qu'aucune lecture du code ne redonne.

### La règle qui borne tout le reste

**On ne documente que ce que le code ne peut pas dire.** Une documentation qui paraphrase des signatures est morte à la première refonte. Le *pourquoi*, les contraintes, les pièges et les contrats externes — le reste se lit dans le code, et doit s'y lire.

---

## 7. Ce qui existe déjà et qu'il faut sauver

`docs/superpowers/ETAT.md` porte de la matière chèrement acquise : les décisions qui ne se rouvrent pas, les règles métier, les pièges d'environnement, les dettes connues. Elle a été écrite pour des agents, pas pour des lecteurs.

Ce lot **la répartit** dans la documentation publiée plutôt que de la recopier. Ce qui n'a plus de destinataire disparaît ; ce qui reste utile est réécrit pour son public.

Les dix specs et leurs plans restent où ils sont : ce sont des documents de travail, pas de la documentation de produit. Le chapitre des décisions y renvoie plutôt que de les résumer.

---

## 8. Règles métier

- **Le chapitre des intégrations est engendré**, jamais écrit à la main.
- **Un appel non catalogué fait échouer les tests du connecteur.**
- **Une entrée du catalogue que rien n'exerce fait échouer un test.**
- **Chaque entrée porte la version contre laquelle elle a été prouvée**, et la date.
- **Aucun secret, aucun jeton, aucune clé** dans la documentation ni dans le catalogue — les valeurs d'exemple sont manifestement factices.
- **On ne documente que ce que le code ne peut pas dire.**
- Français pour la documentation, anglais pour le code.

---

## 9. Hors périmètre

- **Un site de documentation.** Du Markdown dans le dépôt, lisible tel quel.
- **Une documentation d'API générée depuis les types.** Le code se lit.
- **Un tutoriel pas à pas** de l'usage quotidien de l'application. Elle doit être évidente ; si elle ne l'est pas, c'est un défaut de conception, pas de documentation.
- **La traduction en anglais.**
- **Documenter les API tierces elles-mêmes.** Le catalogue décrit ce que cette application appelle, pas ce que Dolibarr sait faire.

---

## 10. Tests

- **Le fichier engendré est à jour** : le test échoue si le catalogue et le document committé divergent.
- **Un appel ajouté sans entrée au catalogue est refusé** par le double d'API.
- **Une entrée du catalogue que rien n'exerce** fait échouer le test de couverture.
- **Chaque entrée porte une version et une date**, vérifié par une lecture du catalogue.
- **Aucun secret dans la documentation** : une recherche des motifs de clés et de jetons ne remonte rien.
- **Les commandes du chapitre d'installation s'exécutent** dans l'ordre donné, sur une machine qui n'a jamais vu le projet — le seul test qui vaille pour une documentation d'installation.
- **Aucun lien mort** entre les documents.

---

## 11. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Le catalogue vit à côté de chaque connecteur**, pas dans un fichier central. Un fichier central serait plus facile à lire d'un bloc, et plus facile à oublier de mettre à jour.
- **Le chapitre est engendré, pas écrit.** Il perd en style ce qu'il gagne en vérité.
- **`ETAT.md` est répartie puis retirée**, plutôt que conservée en double.
- **Les specs et les plans restent des documents de travail**, non réécrits en documentation.
- **La documentation est en français uniquement.**
