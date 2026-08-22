# Mise à jour du produit par registre d'images

**Besoin du porteur, dans ses mots** : « le même système que ce que j'ai quand je
vais voir mes images dans Container Manager : ça me dit qu'il y a une mise à
jour, je clique sur mettre à jour, ça télécharge et redéploie ».

Cible : Synology, conteneur, Postgres.

---

## 1. Ce que Container Manager sait faire, et ce qu'il ne sait pas

C'est lui qui dicte la conception, et il est plus étroit qu'espéré. Ces deux
limites sont **rapportées par la communauté Synology**, pas par une
documentation officielle — à confirmer sur son modèle avant de s'y engager.

| | |
|---|---|
| Notifie une mise à jour | **seulement pour le tag `latest`** — ni `v1.2.3`, ni `nightly` |
| Registres surveillés | **Docker Hub seulement** — GHCR et les autres ne remontent aucune notification |
| Ce que « Mettre à jour » fait | télécharge l'image ; **le conteneur est recréé** depuis le projet |

**Conséquence directe** : l'image doit vivre sur **Docker Hub**, et le tag que
le Synology suit doit être **`latest`**. GitHub Container Registry, que
j'envisageais d'abord, ne produirait aucune notification — le porteur devrait
aller voir lui-même, ce qui est exactement ce qu'il ne veut pas.

GitHub reste la source : c'est GitHub Actions qui construit et pousse. Seul le
lieu de publication change.

---

## 2. Ce que le dépôt doit livrer

### 2.1 Un workflow de publication

`.github/workflows/image.yml`, déclenché sur `push` vers `main`.

Étapes : connexion à Docker Hub par un jeton d'accès (`secrets`), construction
**multi-architecture** `linux/amd64,linux/arm64`, publication de deux tags à
chaque fois :

- **`latest`** — celui que le Synology surveille ;
- **`v<version>`** tirée de `package.json` — sans notification, mais c'est le
  seul moyen de revenir en arrière.

Le multi-architecture n'est pas du zèle : les Synology x86 sont en `amd64`, les
modèles à processeur ARM en `arm64`. Publier les deux évite d'avoir à trancher,
et coûte quelques minutes de construction.

### 2.2 Un `docker-compose.yml` de production

L'actuel porte `build: .` — il construit sur place, donc il ne recevra jamais
de mise à jour. Il faut une seconde composition, ou une variante, portant
`image: <compte>/cra:latest`.

C'est **la** modification sans laquelle rien du reste ne sert.

### 2.3 Ce qui ne change pas

Le `Dockerfile` cible déjà Postgres et applique `prisma migrate deploy` au
démarrage. Une mise à jour qui embarque une migration l'applique donc seule.
C'est voulu — et c'est aussi le principal risque, voir §4.

---

## 3. Le cycle, vu du porteur

1. Un correctif est fusionné dans `main`.
2. GitHub Actions construit et pousse `latest` et `v<version>`.
3. Container Manager signale la mise à jour — sous un délai qui lui appartient.
4. Le porteur clique. L'image descend, le conteneur est recréé, les migrations
   s'appliquent au démarrage.
5. Les données survivent : elles sont dans le volume Postgres, pas dans le
   conteneur applicatif.

**Aucun code applicatif n'est concerné.** Ce lot ne touche pas au produit : il
ajoute un workflow, une composition, et de la documentation.

---

## 4. Les risques, nommés

**Une migration qui échoue laisse le conteneur mort.** Le démarrage exécute
`prisma migrate deploy` et échoue fort si elle rate — délibérément, car un
serveur qui démarre sur un schéma faux est pire. Mais après une mise à jour
automatique, cela veut dire un service arrêté sans que personne l'ait demandé.
**Il faut donc une sauvegarde Postgres avant chaque mise à jour**, et le
document doit le dire à cet endroit précis.

**Les secrets doivent survivre.** `AUTH_SECRET` et `CREDENTIALS_KEY` vivent dans
l'environnement de la composition. Les régénérer à une mise à jour
déconnecterait tout le monde et rendrait **illisibles les jetons Google et
Dolibarr** — il n'existe aucune rotation de clé.

**`latest` est une cible mouvante.** Toute fusion dans `main` devient
déployable. Ou bien on accepte que `main` soit toujours livrable — ce qui est
déjà la discipline du dépôt — ou bien on déclenche la publication sur une
**étiquette de version** plutôt que sur chaque `push`. Décision du porteur.

**Docker Hub limite les dépôts privés** sur son offre gratuite. Une seule image
est nécessaire ici, mais c'est à vérifier sur son compte avant de s'engager.

---

## 5. Ce qui reste à trancher

1. **Publier à chaque `main`, ou sur étiquette de version ?**
2. **Dépôt Docker Hub public ou privé ?** Privé impose d'enregistrer des
   identifiants dans Container Manager ; public expose le produit.
3. **La sauvegarde Postgres** : un conteneur voisin qui fait un `pg_dump`
   périodique vers un partage du NAS, ou la sauvegarde Hyper Backup du Synology
   sur le volume ?

---

## 6. Ce que ce lot ne fait pas

- **Aucune mise à jour sans clic.** Le porteur a décrit un geste manuel, et
  c'est plus sûr : une mise à jour automatique appliquerait des migrations sans
  personne devant l'écran. Watchtower ferait cela, et n'est pas retenu.
- **Aucun retour arrière automatique.** Revenir en arrière, c'est repointer la
  composition sur `v<version précédente>` — et si une migration a modifié le
  schéma, la restauration de la sauvegarde devient nécessaire.
