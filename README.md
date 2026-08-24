# takta

> *Le temps qui fait foi.*

Compte-rendu d'activité pour consultants indépendants. Auto-hébergé, sous
licence **GNU AGPL v3** — voir [LICENSE](LICENSE).

---

## Pourquoi

Un consultant en régie vend des jours. Pas des heures pointées, pas des tâches
cochées : **un nombre de jours, sur une période, contre un bon de commande.**

Tout l'enjeu du mois tient alors dans une soustraction — ce qui a été vendu,
moins ce qui a été servi, moins ce qui est déjà promis à un jour précis. Les
outils de suivi du temps savent faire la deuxième colonne. Aucun ne tient les
trois ensemble, et c'est pourtant la seule qui décide de la semaine à venir :
un jour prévu chez un client est un jour qu'on ne vendra pas ailleurs.

Alors on la refait à la main. Un tableur en parallèle du logiciel, un calcul le
vendredi soir, un chiffre annoncé au client dont on n'est jamais tout à fait
sûr. C'est ce tableur que **takta** remplace.

Trois états, jamais confondus : **vendu**, **prévu**, **réalisé**. Le prévu ne
devient jamais du réalisé tout seul — cette conversion est une décision, pas un
automatisme, parce qu'elle engage. Et à la fin du mois, ce qui sort n'est pas un
décompte : c'est un document que le client signe, qui verrouille le mois, et qui
fait foi.

## Prévoir, c'est déjà tenir la cadence

Un jour prévu qui n'est écrit nulle part n'existe pas. Il ne vous empêche pas
d'en promettre un autre au même moment, il ne se voit pas quand on vous demande
vos disponibilités, et il ne pèse rien face à une urgence. C'est ainsi qu'on se
retrouve à trois missions pour deux semaines.

takta pousse donc vos jours prévus **dans votre agenda**, sur un calendrier
dédié qui ne se mélange jamais au reste. Ce que vous avez engagé devient visible
là où vous regardez déjà, à côté de vos rendez-vous et de vos congés. Un jour
bloqué se voit, se défend, et se compte.

C'est le sens du mot *takt* pris au sérieux : une cadence ne se constate pas
après coup, elle se tient d'avance. Le mois qui se passe bien est celui qu'on
avait posé avant qu'il commence.

Et quand le mois se ferme, ce qui n'a pas eu lieu ne traîne pas : valider le CRA
annule les jours restés à l'état de prévision. Ils ne comptent ni comme servis,
ni comme perdus — ils disparaissent, parce qu'ils n'ont pas eu lieu. Ce sort
peut aussi se régler plus tôt : à la génération du CRA, vous choisissez de
faire passer ces jours en réalisé ou de les supprimer, mission par mission —
l'annulation à la validation reste le filet pour ce qui n'est pas passé par ce
choix, prévisionnel ressaisi après coup ou mois dont le CRA n'a jamais été
généré par cet écran.

**takta ne facture pas.** C'est délibéré, et c'est ce qui le garde léger : la
facture appartient à votre logiciel de gestion, avec toute sa charge
réglementaire. takta lui pousse les temps consommés et s'arrête là.

**takta fonctionne seul.** Dolibarr, Google Agenda et la signature électronique
sont des connecteurs *additifs* : sans aucun d'eux, la saisie, le calcul, le PDF
et la validation marchent intégralement. Vos données restent où vous les
installez — sur un poste, un NAS, un serveur.

---

## Le nom

En production, le *takt* est le rythme qu'il faut tenir : le temps dont on
dispose, divisé par ce qui a été promis. Ni plus vite, ni plus lentement — la
cadence juste, celle qui livre sans stock et sans retard.

C'est le calcul du consultant, exactement.

Le nom se dit en deux temps, comme un mécanisme qui avance. Au milieu, un **k**.

---

## Ce que takta fait, et ne fait pas

| Fait | Ne fait pas |
|---|---|
| Saisie au jour, au créneau ou à l'heure | Chronomètre, minuterie, pointage |
| Prévisionnel adossé à l'engagement vendu | Facturation, devis, comptabilité |
| CRA mensuel en PDF, signable | Portail client |
| Verrouillage du mois validé | Modification rétroactive d'un mois signé |
| Connecteurs Dolibarr, Google Agenda, signature | Rien d'obligatoire : tout est optionnel |

---

## Installer

Une seule base de code, quatre cibles :

| Cible | Moyen | Base |
|---|---|---|
| VPS / serveur | Docker Compose | Postgres |
| NAS | [`docker-compose.prod.yml`](docker-compose.prod.yml), image tirée de Docker Hub | Postgres |
| Poste local, depuis le dépôt | `npm run setup:local` | SQLite (fichier) |
| Poste local, sans dépôt | archive portable, une par plateforme | SQLite (fichier) |

### Serveur (Docker Compose, Postgres)

Ce chemin **a été déployé et exercé** — voir « Ce qui a été éprouvé ».

```bash
# POSTGRES_PASSWORD en **hexadécimal**, jamais en base64 : il entre tel quel
# dans DATABASE_URL, et un `/` produit par base64 y couperait l'URL en deux.
export POSTGRES_PASSWORD=$(openssl rand -hex 24)
export AUTH_SECRET=$(openssl rand -base64 32)
export CREDENTIALS_KEY=$(openssl rand -base64 32)
docker compose up -d --build
```

L'application écoute sur http://localhost:3000

**Le premier compte se crée à l'écran.** Tant que la base ne porte aucun
utilisateur, `/login` devient « Premier démarrage » et crée un
**administrateur**. Aucune commande, aucun terminal.

> **Corollaire, et il n'est pas décoratif** : tant que l'installation est vide,
> **quiconque connaît son adresse peut prendre cette place**. Renseigne-la tout
> de suite après le premier démarrage. La condition ne se reproduit jamais
> ensuite — vraie une fois, fausse pour toujours.

### NAS Synology (image tirée de Docker Hub)

Éprouvé sur un **DS723+** (arm64), Container Manager, Postgres 16, derrière un
tunnel Cloudflare.

1. Créer un dossier partagé pour le projet, y déposer
   [`docker-compose.prod.yml`](docker-compose.prod.yml) et un `.env` copié de
   [`.env.docker.example`](.env.docker.example).
2. Remplir le `.env`. Les trois obligatoires — `POSTGRES_PASSWORD` (hexadécimal),
   `AUTH_SECRET`, `CREDENTIALS_KEY` — et, **derrière un proxy, `AUTH_URL`** :

   ```
   AUTH_URL="https://takta.mondomaine.fr"
   ```

   Sans elle, l'application déduit son adresse des en-têtes, et tous les proxys
   ne posent pas `x-forwarded-host` : certains réécrivent `Host` avec l'adresse
   interne. Les retours de connexion Google et les liens de mot de passe
   envoyés par courriel pointent alors vers `https://<identifiant du
   conteneur>:3000`, une adresse qui n'existe nulle part.

3. Container Manager → *Projet* → *Créer*, pointer sur le dossier, choisir
   `docker-compose.prod.yml`.
4. Ouvrir l'application, créer le premier administrateur à l'écran.

**Recevoir les versions suivantes.** La composition porte `pull_policy: always` :
il suffit d'**arrêter puis démarrer le projet**. N'attends pas la pastille
« mise à jour disponible » de Container Manager — elle ne concerne que l'onglet
*Image*, et un projet qui redémarre avec un `:latest` déjà présent en local ne
redemande rien au registre.

**Vérifier ce qui tourne** : le numéro de version s'affiche sous l'écran de
connexion. Container Manager, lui, n'affiche que l'identifiant *local* de
l'image, qui ne correspond à aucune empreinte du registre.

**Les données sont dans des dossiers visibles**, pas dans des volumes nommés :
`./donnees/postgres` et `./sauvegardes`, lisibles depuis File Station.

Le conteneur applique `npx prisma migrate deploy` **au démarrage**, avant de
lancer le serveur : le schéma est créé ou mis à jour sans étape manuelle. Si le
démarrage échoue là, `docker compose logs app` : la cause la plus probable est
une base non vide dont l'historique de migrations diverge — une base modifiée à
la main. Sur une base vierge fournie par le service `db`, la migration initiale
s'applique sans intervention.

### Poste local, depuis le dépôt (SQLite)

Prérequis : Node.js 20 ou plus.

```bash
npm install
echo 'DATABASE_URL="file:./cra.db"' > .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "CREDENTIALS_KEY=$(openssl rand -base64 32)" >> .env
npm run setup:local
npm run build
npm start
```

La base est le fichier `prisma/cra.db`. Le premier compte se crée **à l'écran**,
au premier chargement de `/login` : `scripts/create-user.mjs` existe encore pour
qui préfère le terminal, il n'est plus nécessaire.

### Archive portable

Pour distribuer l'application à quelqu'un qui ne veut ni dépôt, ni Docker, ni
`npm install`.

```bash
npm run empaqueter
```

Produit `distribution/cra-<version>-<plateforme>.zip`, **construit dans un
`distDir` séparé** (`CRA_DIST_DIR`, `.next-dist` par défaut) pour ne jamais
écraser le cache `.next` du serveur de développement. Le script **ne modifie pas
`prisma/schema.prisma`** : il en dérive une copie temporaire sur le provider
SQLite, le temps du `prisma generate`. Il remet aussi `tsconfig.json` et
`next-env.d.ts` dans leur état d'origine, que `next build` réécrit pour y
déclarer le `distDir` employé.

Ce que reçoit la personne, une fois l'archive dézippée :

```
cra/
  LISEZMOI.txt                          demarrer.sh   / demarrer.cmd
  app/                                  arreter.sh    / arreter.cmd
  (donnees/ apparaît au 1er lancement)  sauvegarder.sh / sauvegarder.cmd
                                        creer-utilisateur.sh / .cmd
```

**Une archive par plateforme, jamais d'archive universelle.** Les moteurs Prisma
sont compilés par architecture ; `scripts/empaqueter.mjs` refuse de produire une
archive dont le moteur embarqué ne correspond pas à la machine qui construit.
Pour les quatre cibles (macOS Apple Silicon, macOS Intel, Windows x64, Linux
x64), lancer `npm run empaqueter` **sur** chacune.

Ce que le script garantit avant de rendre la main, en rouvrant l'archive
produite :

- aucune entrée `donnees/` — c'est ce qui rend l'écrasement accidentel
  impossible, même en dézippant par-dessus une installation existante ;
- aucun fichier `.env` — Next recopie le `.env` du dépôt dans la sortie
  standalone, secret de développement compris ;
- présence des scripts d'entrée, du client et du moteur Prisma, d'argon2, des
  fichiers statiques et du jeu de migrations SQLite.

`src/distribution/paquet.test.ts` ne se contente pas de vérifier le prédicat
d'exclusion : il **produit un vrai `.zip`**, le relit avec `unzip`, le dézippe
par-dessus une fausse installation et vérifie que la base n'a pas bougé. Rendre
la purge inerte laisse les tests de prédicat verts et fait tomber ceux-là.

**Le port compte, à cause de Google.** Le démarrage **préfère 3000** et n'en
change que s'il est occupé, en annonçant alors, prête à copier, l'URL de retour
exacte à réenregistrer dans la console Google Cloud
(`http://localhost:<port>/api/google/callback`). Google exige une correspondance
au caractère près : un port qui change en silence casserait la connexion, et
l'erreur viendrait de Google, pas de l'application. `CRA_PORT` fait du port une
**exigence** et non une préférence : occupé, le démarrage échoue en le nommant.

---

## Les variables d'environnement

**Deux sont obligatoires, et deux seulement** : `AUTH_SECRET` et
`CREDENTIALS_KEY`. Tout le reste est vide par défaut, et une valeur vide ferme
proprement la fonction correspondante au lieu d'empêcher le démarrage.

| Variable | Obligatoire | Défaut |
| --- | --- | --- |
| `AUTH_SECRET` | oui — `docker compose up` refuse de démarrer sans elle | — |
| `CREDENTIALS_KEY` | oui, **même sans Google** | — |
| `SYNC_FLUSH_TOKEN` | non | vide : `POST /api/sync/flush` fermé |
| `CRA_API_TOKEN` | non | vide : l'API d'événements et le réveil de l'ordonnanceur restent fermés |
| `SMTP_PASSWORD` | non | vide : pas d'envoi de courriel |
| `DOCUMENSO_URL`, `DOCUMENSO_API_KEY` | non | vides : pas de signature électronique |
| `SIGNATURE_WEBHOOK_SECRET` | non | vide : `POST /api/webhooks/signature` refuse tout |

`.dockerignore` exclut `.env` : **rien n'entre dans le conteneur qui ne soit
listé dans le bloc `environment:` du `docker-compose.yml`.** Ce bloc reprend donc
toutes les variables de `.env.example`, et `src/deploy/deployment-config.test.ts`
échoue si l'une d'elles y manque.

**Pourquoi `CREDENTIALS_KEY` est exigée au démarrage alors que Google est
optionnel.** Absente, elle ne se manifesterait qu'au retour du consentement
Google — très loin du déploiement, et sur un écran qui ne peut proposer que de
recommencer une opération qui ne peut jamais aboutir. Une variable exigée au
démarrage se corrige en une commande ; la même variable oubliée se paye en
dépannage.

**Le client OAuth Google n'est pas dans ce tableau, et c'est le point.**
Identifiant, secret et URL de retour se saisissent dans *Administration ·
Google* et vivent chiffrés en base, scellés par `CREDENTIALS_KEY` — comme la clé
d'API Dolibarr. La règle : *si l'utilisateur doit taper la valeur, elle n'a rien
à faire dans un fichier.* C'est aussi plus sûr : un secret dans un fichier se lit
en clair, en base il faut la base **et** la clé. Le fuseau horaire suit la même
route, vers *Administration · Saisie*, avec celui du système pour défaut.

---

## Activer un connecteur optionnel

Aucun n'est nécessaire : sans eux, la saisie, le calcul, le PDF et la validation
fonctionnent intégralement. Ce que chaque connecteur appelle exactement — route
par route, paramètre par paramètre — est dans
[docs/integrations.md](docs/integrations.md).

### Google Agenda

1. Dans la console Google Cloud, créer un client OAuth « application web » et
   activer l'API Google Calendar.
2. Déclarer l'URI de redirection **au caractère près** :
   `https://votre-domaine/api/google/callback` (ou
   `http://localhost:3000/api/google/callback` en local). L'écran
   *Administration · Google* affiche celle qui correspond à l'adresse réellement
   servie : c'est celle-là qu'il faut déclarer.
3. Reporter identifiant, secret et URI dans *Administration · Google*, puis
   lancer le consentement. Le scope demandé est celui du calendrier ; un
   calendrier dédié est créé au consentement et ne se mélange jamais au reste.

**Derrière un proxy, renseigne `AUTH_URL`** — l'adresse publique telle que les
gens la tapent, par exemple `https://takta.mondomaine.fr`, sans barre finale.
Sans elle, l'application déduit son adresse des en-têtes de la requête, et tous
les proxys ne posent pas `x-forwarded-host` : certains réécrivent `Host` avec
l'adresse interne de l'amont. Le retour d'un consentement Google **réussi**
renvoie alors vers `https://<identifiant du conteneur>:3000`, une adresse qui
n'existe nulle part — « site inaccessible », alors que la connexion a abouti.
La même variable sert le retour de la connexion Google et les liens de mot de
passe envoyés par courriel.

**Le même client sert aussi à se connecter**, et cela demande une **seconde**
URI de redirection. Déclare les deux, au caractère près — le **port en fait
partie** :

| URI | Ce qu'elle sert |
|---|---|
| `https://votre-domaine/api/google/callback` | brancher l'agenda, depuis *Mon profil* |
| `https://votre-domaine/api/auth/callback/google` | **se connecter** avec son compte Google |

Sans la seconde, le bouton « Se connecter avec Google » mène à un
`redirect_uri_mismatch`. Le bouton ne paraît que si un client est enregistré :
une porte qui ne mène nulle part ne s'affiche pas grisée, elle ne s'affiche pas.

**Ce que la connexion Google crée.** Une adresse **vérifiée** qui correspond à un
compte existant s'y rattache ; sinon un compte naît, au rôle `CONSULTANT`, sans
mot de passe — il s'en donnera un par « Définir ou réinitialiser mon mot de
passe ». Une adresse non vérifiée est refusée, et un compte désactivé n'entre pas
davantage par cette porte que par l'autre.

**Qui peut donc entrer ?** Tous ceux à qui Google délivre un jeton pour ce
client. Si l'écran de consentement est de type *Interne*, c'est le domaine
Workspace ou Cloud Identity de l'organisation — et rien d'autre. En *Externe*,
c'est le monde entier : n'active alors la connexion Google que derrière un
contrôle d'accès, ou pas du tout.

### Dolibarr

URL de l'instance, clé d'API et identifiant utilisateur Dolibarr se saisissent
dans *Administration · Dolibarr* — **jamais dans l'environnement**. La clé est
essayée avant d'être enregistrée : une clé fausse est refusée tout de suite, pas
au premier envoi.

L'ordre compte : **connecter → rattacher le tiers → rattacher le projet →
valider le CRA**. Un CRA validé avant que Dolibarr soit connecté et la mission
rattachée n'est pas mis en file ; le rattrapage existe et se déclenche au
rattachement du projet, mais mieux vaut ne pas en dépendre pour le premier
passage.

Deux réglages de l'instance Dolibarr changent la **lecture** des données sans
rien rendre faux — `TIMESHEET_DAY_DURATION` et `SOCIETE_FISCAL_MONTH_START`.
L'écran propose de s'aligner dessus, sans jamais l'imposer ni toucher un CRA
validé. Le détail est dans [docs/integrations.md](docs/integrations.md).

---

## Exploiter

C'est ici que se joue la différence entre une installation et un service.

### Sauvegarder

**Ce qu'est la base**, selon la cible :

| Cible | La base est… | Sauvegarder |
|---|---|---|
| Docker (`docker-compose.yml`) | le volume `db-data` (Postgres, base `cra`) | `docker compose exec -T db pg_dump -U cra -d cra \| gzip > sauvegarde.sql.gz` |
| NAS (`docker-compose.prod.yml`) | le dossier `./donnees/postgres` (Postgres, base `takta`) | automatique, service `sauvegarde` — voir ci-dessous |
| Poste local, dépôt | le fichier `prisma/cra.db` | copier le fichier, application arrêtée |
| Archive portable | `donnees/cra.db` | `./sauvegarder.sh`, **application allumée ou éteinte** |

`./sauvegarder.sh` passe par `VACUUM INTO` et non par un `cp` : en mode WAL, une
copie brute prise pendant une écriture peut être incohérente. La même raison vaut
côté Postgres, où `pg_dump` remplace la copie du volume.
[`docker-compose.prod.yml`](docker-compose.prod.yml) embarque un service qui fait
ce `pg_dump` **quotidiennement** vers `./sauvegardes`, avec 90 jours de
rétention — pointez ce dossier vers un partage du NAS, hors du conteneur : une
sauvegarde qui vit dans ce qu'elle protège ne protège rien.

### Où vivent les données, et comment les reprendre en main

La composition de production range la base dans **`./donnees/postgres`**, à côté
du fichier `docker-compose.prod.yml` — un dossier ordinaire, visible dans File
Station. Les sauvegardes vont dans `./sauvegardes` : les données et ce qui les
protège sont du même côté.

Ce n'est pas une question de persistance — un volume nommé Docker persiste tout
aussi bien. C'est une question de **reprise en main** : un dossier se voit, se
sauvegarde et se supprime depuis DSM ; un volume nommé demande un terminal, et
un NAS n'en offre pas toujours.

**`PGDATA` pointe volontairement sur un sous-dossier** du montage
(`/var/lib/postgresql/data/pgdata`). Postgres exige que son dossier de données
lui appartienne et soit en `0700` ; sur un dossier partagé Synology, avec ses
ACL, il ne peut pas toujours en changer le propriétaire, et l'initialisation
échoue par `initdb: could not change permissions`. Un sous-dossier, lui, est
créé par Postgres : il naît avec le bon propriétaire quoi que porte le parent.

**Repartir d'une base vierge**, sans terminal : arrêter le projet, supprimer
`donnees/postgres` dans File Station, relancer. C'est tout — et c'est ce qu'un
volume nommé ne permettait pas.

### Changer `POSTGRES_PASSWORD` après le premier démarrage

Ça ne suffit **jamais** à soi seul. Postgres ne fixe le mot de passe de son
utilisateur qu'à l'**initialisation du volume** : modifier la variable ensuite
laisse la base avec l'ancien, et l'application est rejetée par
`P1000: Authentication failed`. Relancer la pile n'y change rien.

Deux issues, selon qu'il y a des données ou non :

```bash
# Aucune donnée à garder — le -v détruit le volume, et c'est lui l'essentiel
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d

# Des données à garder — changer le mot de passe DANS la base
docker exec -it takta-db-1 psql -U takta -d takta \
  -c "ALTER USER takta WITH PASSWORD 'le-nouveau';"
```

Depuis l'intérieur du conteneur, Postgres fait confiance à la connexion locale :
cette commande ne demande aucun mot de passe.

**Les guillemets.** Dans un fichier `.env`, Docker les retire — c'est pourquoi
les fichiers d'exemple en portent. Dans un **champ de formulaire** — l'interface
de Container Manager, par exemple — ils feraient partie de la valeur.

**Une copie de la base ne donne accès à aucun agenda.** Les jetons Google et la
clé d'API Dolibarr y sont chiffrés (AES-256-GCM), et la clé vit dans
l'environnement, hors de la base.

### Ce qu'il faut sauvegarder en plus de la base

**`CREDENTIALS_KEY` et `AUTH_SECRET`.** Ce ne sont pas des données, et c'est
précisément pour cela qu'on les oublie.

- Perdre **`CREDENTIALS_KEY`** impose de reconnecter Google **et** de ressaisir
  la clé d'API Dolibarr. Aucune donnée de CRA n'est perdue : l'application se
  comporte comme un compte non connecté, la saisie continue, la synchronisation
  reprend après reconnexion depuis `/admin/sync`.
- Perdre **`AUTH_SECRET`** déconnecte tout le monde.

**Il n'existe aucune rotation de clé.** Changer `CREDENTIALS_KEY` rend les jetons
existants illisibles, définitivement, et le fait **en silence** : la lecture
dégrade sans bruit (`getCredential` renvoie « non connecté »), seule l'écriture
échoue franchement. Ce silence est délibéré — mais il veut dire qu'une clé
changée par erreur ne se signale pas d'elle-même.

Les deux secrets partagent la table `ProviderCredential` sans partager la nature
de leur propriétaire : un jeton Google appartient à une personne, une clé d'API
Dolibarr à l'instance. La colonne `ownerScope` (`USER` / `INSTANCE`) les sépare
et entre dans la contrainte d'unicité — une ligne d'instance porte `userId = ''`,
**jamais `NULL`**, faute de quoi deux clés d'instance du même fournisseur
auraient coexisté sans que rien ne le signale.

### Arrêter et relancer

| Cible | Arrêter | Relancer |
|---|---|---|
| Docker / NAS | `docker compose stop` | `docker compose up -d` |
| Poste local, dépôt | `Ctrl-C` sur `npm start` | `npm start` |
| Archive portable | `./arreter.sh` | `./demarrer.sh` |

`./arreter.sh` juge par le repère `donnees/cra.pid`, confronté à l'**instant de
démarrage** du processus — le seul signal qui résiste au fait que Next renomme
son propre processus. Un numéro recyclé par le système n'est jamais tué. Lancé
deux fois de suite, il dit calmement « L'application n'est pas démarrée. » et
sort en 0.

### Mettre à jour sans perdre la base

**Dans cet ordre, toujours :**

1. **Sauvegarder** (ci-dessus). C'est la seule étape qu'on ne peut pas rattraper.
2. Mettre à jour le code ou tirer la nouvelle image.
3. Appliquer les migrations :
   - **Docker** : rien à faire, le conteneur exécute `prisma migrate deploy` à
     son démarrage. Si une migration échoue, il **ne démarre pas** — c'est
     voulu, un schéma à moitié migré est pire qu'un service arrêté.
   - **Archive portable** : `./demarrer.sh` rejoue lui-même les migrations
     SQLite en attente et écrit d'abord une copie `avant-migration-*.db`.
   - **Poste local, dépôt** : `npx prisma migrate deploy`.

**`npm run db:sqlite` n'est pas une mise à jour.** Il passe par `prisma db push`,
qui n'exécute **aucune migration** : une colonne ajoutée y arrive avec sa seule
valeur par défaut. Deux scripts rejouent, côté SQLite, ce que les migrations
Postgres font en SQL — `npm run backfill:rates` pour le facteur de conversion des
saisies et `npm run backfill:heures` pour leurs heures de début et de fin. Ce
sont des scripts de **reprise**, pas d'entretien : relancer `backfill:heures`
après qu'un créneau a été redéfini en administration déplacerait les saisies que
le gel des heures protège.

**Ce qui ne doit jamais changer entre deux versions** : `AUTH_SECRET` et
`CREDENTIALS_KEY`.

### Publier une version, et la recevoir sur un NAS

**Publier.** Une version se pose par une étiquette git, jamais par une fusion :

```bash
npm version minor        # met à jour package.json et pose l'étiquette
git push --follow-tags
```

GitHub Actions construit alors l'image en `amd64` et `arm64`, et la publie sur
Docker Hub sous deux étiquettes : `latest`, et le numéro de version. Deux secrets
sont attendus dans le dépôt (`Settings → Secrets → Actions`) :
`DOCKERHUB_USERNAME` et `DOCKERHUB_TOKEN`.

**Le fichier d'environnement.** Ne copie pas `.env.example` — il liste **tout**,
y compris ce qui ne vaut que pour une autre cible. Copie celui de ta cible :

| Cible | Fichier à copier en `.env` |
|---|---|
| Conteneur, Postgres (NAS, VPS) | `.env.docker.example` |
| Poste local, SQLite | `.env.local.example` |

Chacun ne contient que ce qui a un sens pour lui : celui du conteneur ne propose
pas `DATABASE_URL`, que la composition fabrique ; celui du poste local ne
propose pas `POSTGRES_PASSWORD`, puisqu'il n'y a pas de serveur.

**Recevoir.** Sur le NAS, la composition à utiliser est
[`docker-compose.prod.yml`](docker-compose.prod.yml) — elle **tire** l'image
publiée au lieu de la construire, ce qui est la condition pour recevoir une mise
à jour.

**N'attends pas que Container Manager te la propose.** Sa pastille « mise à jour
disponible » vit sur l'onglet *Image*, ne concerne que les images qu'il a
lui-même téléchargées, et il ne réinterroge le registre que de loin en loin — on
a publié une version et attendu en vain. Pire : un projet qui redémarre avec un
`:latest` déjà présent en local **ne redemande rien**. L'étiquette pointe vers
une nouvelle empreinte, mais personne ne va la chercher.

C'est pourquoi la composition porte `pull_policy: always`. Pour recevoir une
version, il suffit alors de **redémarrer le projet** : Container Manager →
*Projet* → `takta` → *Action* → **Arrêter**, puis **Démarrer**. Le démarrage
retire l'image depuis Docker Hub.

**Vérifier ce qui tourne.** Le numéro de version s'affiche en bas de l'écran de
connexion — sans avoir à entrer — et en bas de la navigation une fois connecté.
C'est la seule réponse fiable : Container Manager n'affiche que l'identifiant
*local* de l'image, qui ne correspond à aucune empreinte du registre.

---

## Journaux

`docker compose logs app`. Les lignes du chemin Google et de la synchronisation
sont préfixées `[cra]` :

```
[cra] error google.callback userId=… erreur=SecretBoxError message="CREDENTIALS_KEY est absente…"
[cra] warn  google.connect raison=client-oauth-absent
[cra] warn  sync.connecteur userId=… raison=calendrier-absent
[cra] info  sync.flush.api nonConnecte=false traitees=12 reussies=12 echecs=0
```

Aucun jeton, secret, clé ni identifiant client n'y figure : les valeurs des
variables sensibles sont effacées avant écriture, ainsi que toute forme
reconnaissable de jeton (`src/core/log/redact.ts`). Un compte simplement pas
connecté n'écrit rien — c'est l'état par défaut d'une installation, pas une
panne.

Ce journal est un **minimum d'exploitation** : il n'est ni daté par nos soins, ni
conservé, ni corrélé. Le journal qui fait foi est celui de l'API d'événements.

---

## API d'événements

L'application **expose**, elle n'appelle personne. Un intégrateur (n8n, un
script, autre chose demain) lit le journal et reprend où il s'était arrêté.

    curl -H "Authorization: Bearer $CRA_API_TOKEN" \
         "http://localhost:3000/api/events?since=0&limit=100"

Paramètres : `since` (dernier `seq` traité, exclu), `limit` (100 par défaut, 500
au maximum), `event` (un nom du catalogue, voir `src/core/audit/events.ts`).

La réponse porte `events`, `nombre` et `derniereSeq` — ce dernier est le curseur
à mémoriser pour l'appel suivant. **Aucun événement ne se perd**, même après
plusieurs jours d'arrêt du consommateur.

Sans `CRA_API_TOKEN`, la route reste fermée (503) : une instance mal configurée
n'expose pas son journal. Le réveil de l'ordonnanceur utilise le même jeton :

    curl -X POST -H "Authorization: Bearer $CRA_API_TOKEN" \
         http://localhost:3000/api/jobs/tick

### L'ordonnanceur porte sa propre horloge

**Rien à configurer.** Au démarrage du serveur, l'application remonte une horloge
interne qui réveille l'ordonnanceur toutes les cinq minutes. Les rappels partent,
la file de sortie se vide, l'agenda et Dolibarr reçoivent ce qui les attend —
sans cron, sans tâche planifiée, sans jeton.

Cinq minutes : chaque travail porte **sa propre** récurrence — cinq minutes pour
la file de sortie, un jour pour les rappels — et l'horloge ne fait que demander
« y a-t-il quelque chose d'échu ».

**Il n'en a pas toujours été ainsi**, et le revirement mérite d'être dit :
l'ordonnanceur attendait un déclencheur extérieur. C'était une erreur de
conception. L'API existe pour que d'autres outils viennent parler à
l'application — pas pour que l'application se fasse marcher elle-même. Une
synchronisation qui ne part que si quelqu'un a pensé à poser un cron n'est pas
une fonction du produit, et son oubli ne se voit qu'à l'absence de ce qui aurait
dû arriver.

`POST /api/jobs/tick` reste, et garde tout son sens : elle permet à un
orchestrateur extérieur — n8n, un `crontab`, un timer `systemd` — de **provoquer**
un réveil quand il le veut. Elle n'est simplement plus nécessaire au
fonctionnement normal.

**Un travail resté désactivé ne tourne pas pour autant.** *Supervision · Travaux*
liste les sept et permet d'activer chacun. Les installations neuves ont la file
de sortie et la vérification du journal actives ; une installation existante
garde le choix qu'elle avait, et c'est voulu — réactiver en silence ce qu'un
exploitant a coupé serait pire que de le laisser coupé.

---

## Développement

Le dépôt est laissé, par défaut, avec le provider `sqlite` et une base de
développement fonctionnelle (`prisma/dev.db`, `.env` pointant dessus).

```bash
npm run dev        # serveur de développement
npm test           # la suite entière
```

**Avant de committer, remettre le provider sur `sqlite`** (`npm run db:sqlite`).
`prisma/schema.prisma` ne déclare qu'un seul `provider` à la fois — Prisma ne
permet pas de le paramétrer dynamiquement — et deux scripts le basculent en
réécrivant le fichier :

```bash
npm run db:pg      # provider = "postgresql", puis prisma generate
npm run db:sqlite  # provider = "sqlite", puis prisma db push + generate
```

Le `Dockerfile` appelle explicitement `npm run db:pg` dans l'étage `builder`,
avant `prisma generate` et `npm run build` : le client embarqué dans l'image
cible donc bien Postgres, cohérent avec la `DATABASE_URL` injectée par
`docker-compose.yml`.

**L'architecture, les règles métier et les pièges d'environnement sont dans
[docs/reprise-du-code.md](docs/reprise-du-code.md).** Les décisions produit et
leur pourquoi sont dans [docs/decisions.md](docs/decisions.md).

### Deux jeux de migrations, pas un

`prisma/migrations/` (PostgreSQL) et `prisma/migrations-sqlite/` (SQLite)
coexistent, chacun avec son `migration_lock.toml`. Ils ne sont pas
interchangeables : le SQL diffère, et Prisma refuse un jeu dont le
`migration_lock.toml` annonce un autre provider.

- **Postgres** (Docker) : `npx prisma migrate deploy`, dans l'entrée du
  conteneur.
- **SQLite** (archive portable) : l'archive ne contient pas le CLI Prisma.
  `outils/lib/migrations.mjs` rejoue lui-même les fichiers de
  `prisma/migrations-sqlite/` et tient son journal dans la table
  `_cra_migrations` — pas `_prisma_migrations`.

**Toute évolution de `prisma/schema.prisma` demande donc DEUX migrations**,
générées hors ligne :

```bash
# Postgres (provider basculé en postgresql le temps de la génération)
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/<AAAAMMJJHHMMSS>_<nom>/migration.sql

# SQLite (provider basculé en sqlite le temps de la génération)
npx prisma migrate diff --from-migrations prisma/migrations-sqlite \
  --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations-sqlite/<AAAAMMJJHHMMSS>_<nom>/migration.sql
```

`npx vitest run` échoue en nommant la colonne manquante si l'un des deux jeux
prend du retard : `src/db/schema-migration-sync.test.ts` pour Postgres,
`src/distribution/migrations-sqlite.test.ts` pour SQLite. Les deux garde-fous
sont **statiques** : ils prouvent la cohérence des fichiers entre eux, jamais
qu'une migration s'applique. L'oubli reste facile, la panne ne l'est pas.

### Portabilité SQLite / Postgres

Le schéma reste dans l'intersection des deux moteurs : pas d'enum Prisma, pas de
décimal, pas de tableau, pas de requête fine sur du JSON.

**La suite ne tourne aujourd'hui que contre SQLite.** Rien ne l'exécute contre
Postgres ; c'est un manque, pas un choix. Une matrice `DATABASE_URL` en CI est le
seul moyen de garantir que la portabilité au sens large — types, contraintes,
comportement réel des requêtes — ne se dégrade pas silencieusement. En
attendant, ne pas contourner les règles ci-dessus : elles conditionnent le mode
local et l'empaquetage.

---

## Ce qui a été éprouvé, et ce qui ne l'a pas été

Cette section dit ce qui a été **exécuté**, pas ce qui devrait marcher. Aucun
décompte de tests n'y figure : un chiffre ment dès le commit suivant.

### Jamais exécuté ici

- **Les archives macOS Intel, Windows x64 et Linux x64.** Ni ces machines ni ces
  moteurs Prisma ici. `scripts/empaqueter.mjs` refuse toute archive dont le
  moteur ne correspond pas à la machine qui construit.
- **Les scripts `.cmd` sous Windows.** Vérifié à la place : parité `.sh`/`.cmd`
  — même outil appelé, même seuil Node 20 avant l'appel, CRLF, `CRA_RACINE`.
- **Une machine vierge.** Vérifié à la place : archive dézippée hors du dépôt et
  exécutée depuis ce seul dossier, aucune résolution ne sortant de
  `cra/app/node_modules`.
- **La connexion Google de bout en bout.** Pas d'identifiants OAuth ici.
- **Une coupure de courant réelle.** Vérifié à la place : `kill -9` du serveur en
  pleine exploitation, en WAL et `synchronous=FULL` posé et relu **dans le
  processus du serveur**, sur une connexion unique.
- **Un volume de plusieurs années de CRA.** `VACUUM INTO` mesuré sur une base de
  recette de 308 Ko.

### Exercé réellement

- **Docker, Postgres et la publication d'image, en production.** Déployé le
  22 août 2026 sur un Synology DS723+ (arm64), Container Manager, Postgres 16,
  derrière un tunnel Cloudflare. Ce que le chemin réel a révélé, et qu'aucun
  contrôle statique n'aurait trouvé : un `POSTGRES_PASSWORD` en base64 coupant
  `DATABASE_URL` en deux ; l'initialisation de Postgres refusant un point de
  montage à cause des ACL Synology (d'où `PGDATA` dans un sous-dossier) ; un
  `:latest` déjà présent en local que le redémarrage ne réinterroge pas (d'où
  `pull_policy: always`) ; un proxy qui réécrit `Host` avec l'adresse interne du
  conteneur, envoyant les retours de connexion vers une adresse morte (d'où
  `AUTH_URL`) ; et le workflow de publication lui-même, cassé entre ses deux
  moitiés — un workflow ne se découvre cassé qu'une fois la version publiée.
  `src/deploy/deployment-config.test.ts` garde désormais chacun de ces points.


Sur l'archive `cra-1.0.0-macos-apple-silicon.zip`, dézippée hors du dépôt :
`donnees/` absent au dézippage et créé au premier démarrage ; migrations
appliquées ; `/login` en 200 (ce qui prouve du même coup `AUTH_TRUST_HOST` et le
chargement du moteur Prisma natif) ; création d'utilisateur puis connexion ;
`donnees/cra.env` en `-rw-------` ; sauvegarde **pendant que l'application
tourne**, copie relue avec le client Prisma embarqué ; port 3000 occupé →
démarrage sur 3001 avec l'URL de retour Google exacte ; `kill -9` sans perte ;
dézippage par-dessus l'installation sans toucher `donnees/cra.db` ; mise à jour
avec migration en attente sur une base de version antérieure ; refus propre d'un
Node 18, d'un `node -v` illisible et d'un Node absent du `PATH`, sans pile
d'appels ; attribut `com.apple.quarantine` posé à la main puis levé par
`./demarrer.sh`.

### Liste de vérification d'une installation neuve

Cochées sur un Synology DS723+ le **22 août 2026**, sauf mention contraire.

- [x] Le projet démarre, le service `app` reste vivant.
- [x] Les journaux montrent `prisma migrate deploy` appliqué sans erreur.
- [x] L'écran de premier démarrage crée l'administrateur, et ce compte se
      connecte.
- [x] Une montée de version applique ses migrations et conserve les données —
      quatre montées successives le même jour.
- [ ] Une saisie enregistrée survit à un redémarrage du conteneur.
- [ ] `pg_dump` produit une archive non vide, et sa restauration sur une base
      neuve redonne le compte et la saisie.
- [ ] Un arrêt-relance complet du projet ne perd rien.

Les trois dernières restent à faire : la sauvegarde n'a jamais été **restaurée**,
et une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde.

---

## Licence, et ce qu'elle impose

Ce logiciel est distribué sous **GNU Affero General Public License, version 3**.
Le texte intégral est dans [LICENSE](LICENSE).

En clair : vous pouvez l'utiliser, l'installer où vous voulez, le modifier et le
redistribuer — y compris commercialement. En échange, **toute version modifiée
que vous exposez à des utilisateurs via un réseau doit rendre son code source
disponible à ces utilisateurs** (article 13). C'est ce qui distingue l'AGPL de la
GPL, et c'est délibéré : le produit est fait pour être auto-hébergé, et cette
clause empêche qu'une version fermée en soit tirée comme service en ligne.

**Obligation à honorer dans le produit lui-même.** L'article 13 vise les
utilisateurs qui interagissent avec le logiciel *à distance*. Une installation
qui sert plusieurs consultants doit donc leur offrir un moyen d'obtenir la
source — en pratique, un lien vers le dépôt, visible depuis l'application. **Ce
lien n'existe pas encore** : il sera posé quand le dépôt aura une adresse
publique.

Aucune obligation, en revanche, pour un usage strictement personnel et non
modifié : installer et se servir du produit tel quel n'impose rien.
