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
ni comme perdus — ils disparaissent, parce qu'ils n'ont pas eu lieu.

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

Une seule base de code, quatre cibles d'installation :

| Cible                    | Moyen                          | Base            |
|---------------------------|--------------------------------|-----------------|
| VPS / serveur              | Docker Compose                 | Postgres        |
| Cloud managé                | template de déploiement (à venir) | Postgres        |
| Poste local                 | `npm run setup:local`          | SQLite (fichier) |
| Poste local, archive        | archive portable par plateforme (lot 5) | SQLite (fichier) |

## Le mécanisme de bascule SQLite / Postgres

`prisma/schema.prisma` ne déclare qu'un seul `provider` à la fois — Prisma
ne permet pas de le paramétrer dynamiquement. Le fichier committé dans ce
dépôt a **actuellement `provider = "sqlite"`** : c'est le chemin qui tourne
réellement en développement dans cet environnement.

Deux scripts basculent ce provider en réécrivant le fichier :

```bash
npm run db:pg      # bascule provider = "postgresql", puis prisma generate
npm run db:sqlite   # bascule provider = "sqlite", puis prisma db push + generate
```

`npm run setup:local` fait exactement la même chose que `db:sqlite`. Le
Dockerfile appelle explicitement `npm run db:pg` (bascule + `prisma
generate`) avant `npm run build`, dans l'étage `builder` — voir le
paragraphe Docker ci-dessous pour l'ordre exact des commandes.

**Règle à respecter absolument :** avant de committer, remettre le
provider sur `sqlite` (`npm run db:sqlite` ou
`node scripts/set-db-provider.mjs sqlite`) pour laisser le dépôt dans
l'état de développement attendu.

## Serveur (Docker Compose, Postgres)

> **Ce chemin n'a pas été vérifié empiriquement dans cet environnement**
> (Docker n'y est pas installé). Le Dockerfile et le `docker-compose.yml`
> ont été relus ligne à ligne contre l'arborescence réelle du projet
> (générée par `npx next build`), mais `docker compose up --build` n'a pas
> pu être exécuté ici. **À valider par un `docker compose up --build` réel
> avant toute mise en production.**

L'étage `builder` du Dockerfile bascule explicitement le provider Prisma en
Postgres (`npm run db:pg`) **avant** `npx prisma generate` et `npm run
build` : le client généré et embarqué dans l'image cible donc bien
Postgres, cohérent avec la `DATABASE_URL` postgresql:// injectée par
`docker-compose.yml`.

Une migration initiale Postgres est committée dans
`prisma/migrations/20260815000000_init/` (générée hors ligne, sans serveur
Postgres joignable, via
`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
— une pure dérivation du schéma, qui ne nécessite pas de connexion
base). Au démarrage, le conteneur `app` exécute automatiquement
`npx prisma migrate deploy` avant de lancer le serveur (voir la `CMD` du
Dockerfile) : le schéma est donc créé/mis à jour sans étape manuelle.

> **Historique du défaut corrigé :** entre le lot 0 et ce lot, ce fichier de
> migration n'avait pas suivi le schéma — chaque évolution passait par
> `npm run db:sqlite` (`prisma db push`), qui ne génère jamais de migration.
> Quatre changements de schéma (`objectifCaExerciceCents`,
> `debutExerciceMois`, `themeJson`, et la quasi-totalité des
> `minutesParJour`) étaient absents de la migration Postgres alors qu'ils
> existaient dans `schema.prisma` : le chemin `docker compose up` +
> `migrate deploy` créait donc un schéma incomplet, et l'application
> plantait (500) sur toute route touchant ces colonnes. La migration a été
> régénérée pour refléter le schéma actuel (un unique dossier de migration
> initiale, remplacé en place — Postgres n'a jamais été déployé avec ce
> dépôt, il n'y a donc aucun historique de migration réel à préserver).
> Un test (`src/db/schema-migration-sync.test.ts`, dans la suite
> `npx vitest run`) compare désormais statiquement, à chaque exécution, les
> champs scalaires de `schema.prisma` aux colonnes produites par
> `prisma/migrations/**/migration.sql` et échoue en nommant toute colonne
> manquante — pour empêcher que ce défaut ne se reproduise silencieusement.

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
export CREDENTIALS_KEY=$(openssl rand -base64 32)
docker compose up -d --build
docker compose exec app node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse
```

L'application écoute sur http://localhost:3000

### Variables d'environnement du service `app`

`.dockerignore` exclut `.env` : **rien n'entre dans le conteneur qui ne soit
listé dans le bloc `environment:` du `docker-compose.yml`.** Ce bloc reprend
donc toutes les variables de `.env.example`, et
`src/deploy/deployment-config.test.ts` échoue si l'une d'elles y manque.

| Variable | Obligatoire | Défaut |
| --- | --- | --- |
| `AUTH_SECRET` | oui — `docker compose up` refuse de démarrer sans elle | — |
| `CREDENTIALS_KEY` | oui, même sans Google | — |
| `SYNC_FLUSH_TOKEN` | non | vide : `POST /api/sync/flush` fermé |

**Le client OAuth Google n'est pas dans ce tableau, et c'est le point.**
Identifiant, secret et URL de retour se saisissent dans *Administration ·
Google* et vivent chiffrés en base, scellés par `CREDENTIALS_KEY` — comme la
clé d'API Dolibarr. La règle est simple : *si l'utilisateur doit taper la
valeur, elle n'a rien à faire dans un fichier*. C'est aussi plus sûr : un
secret dans un fichier se lit en clair, en base il faut la base **et** la clé.
Le fuseau horaire suit la même route, vers *Administration · Saisie*, avec
celui du système pour défaut.

`CREDENTIALS_KEY` est exigée au démarrage alors que le connecteur Google est,
lui, entièrement optionnel. C'est délibéré : absente, elle ne se manifesterait
qu'au retour du consentement Google, très loin du déploiement — et l'écran
d'alors ne peut proposer que de recommencer une opération qui ne peut jamais
aboutir. Une variable exigée au démarrage se corrige en une commande ; la même
variable oubliée se paye en dépannage.

Pour un déploiement derrière un nom de domaine, l'écran *Administration ·
Google* affiche l'URL de retour correspondant à l'adresse réellement servie
(`https://votre-domaine/api/google/callback`) : c'est elle qu'il faut déclarer
dans la console Google Cloud, au caractère près, puis enregistrer sur l'écran.

### Journaux

`docker compose logs app`. Les lignes du chemin Google et de la
synchronisation sont préfixées `[cra]` :

```
[cra] error google.callback userId=… erreur=SecretBoxError message="CREDENTIALS_KEY est absente…"
[cra] warn  google.connect raison=client-oauth-absent
[cra] warn  sync.connecteur userId=… raison=calendrier-absent
[cra] info  sync.flush.api nonConnecte=false traitees=12 reussies=12 echecs=0
```

Aucun jeton, secret, clé ni identifiant client n'y figure : les valeurs des
variables ci-dessus sont effacées avant écriture, ainsi que toute forme
reconnaissable de jeton (`src/core/log/redact.ts`). Un compte simplement pas
connecté n'écrit rien — c'est l'état par défaut d'une installation, pas une
panne. Ce journal est un minimum d'exploitation : il n'est ni daté par nos
soins, ni conservé, ni corrélé.

Si le démarrage échoue sur `migrate deploy`, consulter
`docker compose logs app` : la cause la plus probable est une base non
vide dont l'historique de migrations diverge (ex. modifiée à la main). En
usage normal — base Postgres vierge fournie par le service `db` du
`docker-compose.yml` — la migration initiale s'applique sans intervention.

**Migrations futures :** toute évolution de `prisma/schema.prisma` doit
être accompagnée d'un nouveau dossier sous `prisma/migrations/`, généré de
la même façon hors ligne (`prisma migrate diff --from-migrations
prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`,
provider basculé en Postgres au moment de la génération) si aucun Postgres
n'est joignable, ou via `prisma migrate dev` si un serveur de
développement Postgres est disponible. Pas de filet de sécurité manuel à
retenir : `npx vitest run` (donc la CI et tout `npm test`) fait déjà
échouer `src/db/schema-migration-sync.test.ts`, en nommant la colonne
manquante, si une évolution de schéma part sans sa migration.

> **Ce paragraphe ne parle que du jeu Postgres.** Depuis le lot 5, un second
> jeu existe sous `prisma/migrations-sqlite/`, pour le mode portable, et il
> doit suivre la même évolution. Voir « Deux jeux de migrations, pas un »,
> dans la section « Archive portable ».

**Reprise d'une base SQLite déjà peuplée.** `npm run db:sqlite` passe par
`prisma db push`, qui n'exécute aucune migration : une colonne ajoutée y
arrive avec sa seule valeur par défaut. Deux scripts rejouent, côté SQLite,
ce que les migrations Postgres font en SQL — `npm run backfill:rates` pour
le facteur de conversion des saisies (lot 1d) et `npm run backfill:heures`
pour leurs heures de début et de fin (lot 1f). Ce sont des scripts de
reprise, pas d'entretien : relancer `backfill:heures` après qu'un créneau a
été redéfini en administration déplacerait les saisies que le gel des
heures protège.

## Poste local (sans Docker, SQLite)

Prérequis : Node.js 20 ou plus.

```bash
npm install
echo 'DATABASE_URL="file:./cra.db"' > .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "CREDENTIALS_KEY=$(openssl rand -base64 32)" >> .env
npm run setup:local
npm run build
node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse
npm start
```

La base est le fichier `prisma/cra.db` — le sauvegarder, c'est sauvegarder
toutes les données. Une copie de ce fichier ne donne accès à aucun agenda :
les jetons Google y sont chiffrés, et la clé vit dans l'environnement, hors
de la base (voir ci-dessous).

## Archive portable (lot 5)

Pour distribuer l'application à quelqu'un qui ne veut ni dépôt, ni Docker,
ni `npm install`.

```bash
npm run empaqueter
```

Produit `distribution/cra-<version>-<plateforme>.zip`, **construit dans un
`distDir` séparé** (`CRA_DIST_DIR`, `.next-dist` par défaut) pour ne jamais
écraser le cache `.next` du serveur de développement. Le script **ne modifie
pas `prisma/schema.prisma`** : il en dérive une copie temporaire
`prisma/.schema-portable.prisma` sur le provider SQLite, le temps du
`prisma generate`. Il remet aussi `tsconfig.json` et `next-env.d.ts` dans leur
état d'origine, que `next build` réécrit pour y déclarer le `distDir` employé.

Ce que reçoit la personne, une fois l'archive dézippée :

```
cra/
  LISEZMOI.txt                      demarrer.sh   / demarrer.cmd
  app/                              arreter.sh    / arreter.cmd
  (donnees/ apparaît au 1er lancement)  sauvegarder.sh / sauvegarder.cmd
                                    creer-utilisateur.sh / .cmd
```

**Une archive par plateforme, jamais d'archive universelle.** Les moteurs
Prisma sont compilés par architecture ; `scripts/empaqueter.mjs` refuse de
produire une archive dont le moteur embarqué ne correspond pas à la machine
qui construit. Pour les quatre cibles (macOS Apple Silicon, macOS Intel,
Windows x64, Linux x64), lancer `npm run empaqueter` **sur** chacune.

Ce que le script garantit avant de rendre la main, en rouvrant l'archive
produite :

- aucune entrée `donnees/` — c'est ce qui rend l'écrasement accidentel
  impossible, même en dézippant par-dessus une installation existante ;
- aucun fichier `.env` — Next recopie le `.env` du dépôt dans la sortie
  standalone, secret de développement compris ;
- présence des scripts d'entrée, du client et du moteur Prisma, d'argon2,
  des fichiers statiques et du jeu de migrations SQLite.

`src/distribution/paquet.test.ts` ne se contente pas de vérifier le prédicat
d'exclusion : il **produit un vrai `.zip`**, le relit avec `unzip`, le dézippe
par-dessus une fausse installation et vérifie que la base n'a pas bougé.
Rendre la purge inerte laisse les tests de prédicat verts et fait tomber ceux-là
— c'est exactement la différence qui manquait au lot 0.

### Le port, et pourquoi il compte pour Google

Le démarrage **préfère 3000** et n'en change que s'il est occupé, en annonçant
alors, prête à copier, l'URL de retour exacte à réenregistrer dans la console
Google Cloud (`http://localhost:<port>/api/google/callback`) et à reporter dans
*Administration · Google*, qui l'affiche aussi. Google exige une correspondance au
caractère près : un port qui change en silence casserait la connexion, et
l'erreur viendrait de Google, pas de l'application.

`CRA_PORT` fait du port une **exigence** et non une préférence : s'il est
occupé, le démarrage échoue en nommant le port plutôt que de basculer.

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
sont statiques ; l'oubli reste facile, la panne ne l'est pas.

## Google Calendar

Les jetons OAuth sont chiffrés au repos (AES-256-GCM) avec `CREDENTIALS_KEY`,
lue dans l'environnement et jamais stockée en base. La même clé protège la clé
d'API Dolibarr : la perdre impose de reconnecter Google **et** de ressaisir la
clé d'API Dolibarr, sans aucune perte de données de CRA.

Les deux secrets partagent la table `ProviderCredential` mais pas la même
nature de propriétaire : un jeton Google appartient à une personne, une clé
d'API Dolibarr à l'instance. C'est la colonne `ownerScope` (`USER` /
`INSTANCE`) qui les sépare, et elle entre dans la contrainte d'unicité — une
ligne d'instance porte `userId = ''`, jamais `NULL`, faute de quoi deux clés
d'instance du même fournisseur auraient coexisté sans que rien ne le signale.

**Perdre `CREDENTIALS_KEY` impose de reconnecter le compte Google.** Aucun jeton
n'est récupérable sans elle : l'application se comportera comme un compte non
connecté — la saisie continue de fonctionner, la synchronisation reprend après
reconnexion depuis `/admin/sync`.

Deux conséquences pratiques, qui découlent de ce choix :

- **La lecture dégrade en silence, l'écriture non.** Clé absente, illisible ou
  changée : `getCredential` renvoie `null` (compte non connecté) et rien ne
  casse. Mais enregistrer des jetons sans clé valide **échoue franchement**,
  avec un message nommant `CREDENTIALS_KEY` — une reconnexion qui ne peut pas
  aboutir se constate au lieu de poser en base des jetons illisibles. Le retour
  de consentement le dit alors à l'écran, **sans conseiller de réessayer**, et
  laisse une ligne `[cra] error google.callback` côté serveur.
- **La clé ne voyage pas avec l'archive portable.** `next build` recopie le
  `.env` du dépôt dans `.next/standalone` : une archive construite en l'état
  embarquerait la clé de développement, donc la même clé chez tout le monde.
  L'empaquetage portable (lot 5) doit exclure ce `.env` et **générer
  `CREDENTIALS_KEY` dans le dossier de données**, à côté d'`AUTH_SECRET`, au
  premier lancement.

  **L'image Docker, elle, n'est pas concernée** : `.dockerignore` exclut `.env`
  *et* `.next`, l'étage `builder` reconstruit donc dans un arbre où aucun `.env`
  n'existe et `.next/standalone/.env` n'est jamais produit. Constaté en l'état
  du dépôt : `.next/standalone/.env` existe bien sur le poste (issu d'un
  `next build` local) et porte `AUTH_SECRET` ; il n'entre pas dans l'image.
  `src/deploy/deployment-config.test.ts` fige l'exclusion de `.env`.

## Développement

Le dépôt est laissé, par défaut, avec le provider `sqlite` et une base de
développement fonctionnelle (`prisma/dev.db`, `.env` pointant dessus). Pour
travailler contre Postgres en local :

```bash
npm run db:pg
npx prisma migrate dev
npm run dev
npm test
```

Pour revenir à SQLite ensuite :

```bash
npm run db:sqlite
```

## API d'événements

L'application **expose**, elle n'appelle personne. Un intégrateur (n8n, un
script, autre chose demain) lit le journal et reprend où il s'était arrêté.

    curl -H "Authorization: Bearer $CRA_API_TOKEN" \
         "http://localhost:3000/api/events?since=0&limit=100"

Paramètres : `since` (dernier `seq` traité, exclu), `limit` (100 par défaut,
500 au maximum), `event` (un nom du catalogue, voir `src/core/audit/events.ts`).

La réponse porte `events`, `nombre` et `derniereSeq` — ce dernier est le
curseur à mémoriser pour l'appel suivant. **Aucun événement ne se perd**,
même après plusieurs jours d'arrêt du consommateur.

Sans `CRA_API_TOKEN`, la route reste fermée (503) : une instance mal
configurée n'expose pas son journal.

Le réveil de l'ordonnanceur utilise le même jeton :

    curl -X POST -H "Authorization: Bearer $CRA_API_TOKEN" \
         http://localhost:3000/api/jobs/tick

## Portabilité SQLite / Postgres

Le schéma reste dans l'intersection des deux moteurs :

- pas d'enum Prisma — des `String` et des unions TypeScript dans
  `src/core/types.ts` ;
- pas de décimal — entiers partout (minutes, centièmes de jour, centimes) ;
- pas de tableau, pas de requête fine sur du JSON.

**La suite d'intégration ne tourne aujourd'hui que contre SQLite** —
`vitest.config.ts` ne déclare qu'une configuration, et les tests
d'intégration tapent la base SQLite de développement. Rien ne l'exécute
contre Postgres ; c'est un manque, pas un choix délibéré (voir « État
vérifié de ce lot » ci-dessous). Faire tourner la suite contre les deux
moteurs — en CI, par exemple avec une matrice `DATABASE_URL` — est le seul
moyen de garantir que la portabilité au sens large (types, contraintes,
comportement réel des requêtes) ne se dégrade pas silencieusement au fil
des migrations ; c'est à inscrire au backlog du prochain lot. Ce que couvre
déjà `src/db/schema-migration-sync.test.ts` est plus étroit mais tourne
sans aucun Postgres joignable : il garantit que chaque colonne déclarée
dans `schema.prisma` a bien sa contrepartie dans les fichiers de migration
committés — le défaut précis qui a rendu ce chemin cassé pendant plusieurs
lots. En attendant la matrice CI, ne pas contourner les règles ci-dessus :
elles conditionnent le mode local et l'empaquetage à venir.

## État vérifié de ce lot

- `npx vitest run` : 152 tests verts sur 17 fichiers (dernière mesure
  stable avant commit — ce chiffre évolue avec le contenu du dépôt, ne pas
  le figer comme une garantie permanente).
- `npx tsc --noEmit` : 0 erreur.
- `npx next build` : aboutit (`output: 'standalone'` dans `next.config.ts`).
  Le CSS produit contient de vraies règles Tailwind compilées (ex.
  `.text-red-600{color:var(--color-red-600)}` dans
  `.next/static/css/*.css`) — vérifié par lecture du fichier généré après
  build, pas supposé. `postcss.config.mjs` (racine du dépôt) active
  `@tailwindcss/postcss` ; sans lui, `next build` réussit silencieusement
  mais ne produit aucune règle CSS.
- `Dockerfile` / `docker-compose.yml` : relus ligne à ligne contre
  l'arborescence réelle produite par `npx next build` (dossier
  `.next/standalone`), **non exécutés** (Docker indisponible dans cet
  environnement). Le Dockerfile bascule désormais explicitement le
  provider Prisma en Postgres (`npm run db:pg`) avant de générer le client,
  et applique les migrations (`prisma migrate deploy`) au démarrage du
  conteneur — mais cette chaîne n'a **pas** été exercée par un
  `docker compose up --build` réel. **À valider avant toute mise en
  production.**
- `src/deploy/deployment-config.test.ts` (dans `npx vitest run`) lit ces deux
  fichiers en pur texte et échoue si une variable de `.env.example` n'atteint
  pas le conteneur, si un secret y est écrit en dur, si `public/` n'est pas
  copié dans l'image, ou si `.dockerignore` cesse d'exclure `.env`. C'est un
  contrôle **statique** : il prouve la cohérence des fichiers entre eux, jamais
  qu'un conteneur démarre. Il existe parce que deux défauts de cette famille
  sont déjà passés — une interface entière livrée sans style au lot 0
  (`postcss.config.mjs` manquant, 152 tests verts) et `public/` absent de
  l'image ici même : une configuration de déploiement n'est couverte par aucun
  test unitaire par défaut.
- Postgres : **jamais validé empiriquement** ici, aucun serveur n'était
  joignable. Une migration initiale (`prisma/migrations/20260815000000_init/`)
  a été générée hors ligne par diff de schéma (`prisma migrate diff
  --from-empty ...`, sans connexion base) et committée, mais son
  application réelle contre un Postgres vivant n'a jamais été exercée ici.
  Cette migration avait cessé de suivre `schema.prisma` : elle a été
  régénérée hors ligne pour refléter le schéma actuel, et
  `src/db/schema-migration-sync.test.ts` (dans `npx vitest run`) empêche
  désormais qu'elle se dégrade à nouveau silencieusement — voir la note
  dans la section Docker Compose ci-dessus.

### Lot 5 — ce qui a été exercé, et ce qui ne pouvait pas l'être

**Exercé réellement**, sur l'archive `cra-1.0.0-macos-apple-silicon.zip`
dézippée hors du dépôt, jamais depuis l'arbre de développement :

- `donnees/` **absent** du listing juste après dézippage ; créé au premier
  démarrage ;
- démarrage, migrations appliquées, `PRAGMA journal_mode` = `wal` relu sur une
  connexion neuve. **`PRAGMA synchronous` ne se relit pas de cette façon** : à la
  différence du mode de journalisation, c'est une propriété *de connexion*, pas
  du fichier. Le relire sur une connexion neuve ne mesurait que la valeur par
  défaut compilée de SQLite — la mesure restait à `2` avec la ligne qui la pose
  purement et simplement supprimée. Elle est désormais posée là où le serveur
  s'en sert (`src/instrumentation.ts` → `src/db/durabilite.ts`), sur une
  connexion **unique** (`connection_limit=1`, sans quoi le pool en laisse à leur
  valeur par défaut — mesuré), relue, et le démarrage échoue si elle ne vaut pas
  FULL ;
- `/login` en **200** — ce qui prouve du même coup `AUTH_TRUST_HOST` (sans
  lui Auth.js répond `UntrustedHost`) et le chargement du moteur Prisma
  natif ; `/saisie/2026-08` sans session en **307** ; la feuille de style
  servie contient de vraies règles Tailwind compilées, donc les fichiers
  statiques embarqués sont bien servis ;
- `./creer-utilisateur.sh` puis connexion possible ; `donnees/cra.env` en
  `-rw-------` ;
- `./sauvegarder.sh` **pendant que l'application tourne**, copie relue avec le
  client Prisma embarqué : même utilisateur présent ;
- port 3000 occupé → démarrage sur **3001**, avec l'URL de retour Google
  exacte affichée ;
- `./arreter.sh` deux fois de suite : la seconde dit calmement
  « L'application n'est pas démarrée. », code 0, aucun fichier PID résiduel ;
- **`kill -9` du serveur** après une écriture validée : la ligne est retrouvée
  intacte au redémarrage ;
- **dézippage par-dessus l'installation** : empreinte SHA-256 de
  `donnees/cra.db` inchangée, `donnees/cra.env` intact ;
- **mise à jour avec migration en attente** sur une base créée par la version
  précédente : copie `avant-migration-*.db` écrite d'abord (et vérifiée comme
  portant bien l'état *antérieur*), migration journalisée dans
  `_cra_migrations`, utilisateur et données conservés ;
- refus propre d'un Node 18 simulé, d'un `node -v` illisible et d'un Node
  absent du `PATH` — message et code 1, **aucune pile d'appels** ;
- attribut `com.apple.quarantine` posé à la main sur le moteur Prisma, puis
  levé par `./demarrer.sh`, le démarrage aboutissant.

**Non vérifiable dans cet environnement :**

| Point | Pourquoi | Vérification la plus proche, effectuée |
|---|---|---|
| Machine vierge, sans le dépôt ni aucune dépendance | Une seule machine ici, qui héberge le dépôt | Archive dézippée hors du dépôt et exécutée depuis ce dossier seul ; aucune résolution ne sort de `cra/app/node_modules` |
| Archives macOS Intel, Windows x64, Linux x64 | Ni ces machines ni ces moteurs Prisma ici | `scripts/empaqueter.mjs` refuse toute archive dont le moteur ne correspond pas à la machine qui construit, et nomme l'archive d'après elle |
| Exécution des scripts `.cmd` sous Windows | Pas de `cmd.exe` | Test de parité `.sh`/`.cmd` : même outil appelé, même seuil Node 20 **avant** l'appel, CRLF, `CRA_RACINE` |
| Gatekeeper sur une archive réellement téléchargée | Pas de passage par un navigateur | Attribut `com.apple.quarantine` posé à la main, puis levé par `demarrer.sh` |
| Docker et Postgres | Jamais exécutés ici, inchangés depuis le lot 0 | Le jeu Postgres et son garde-fou statique restent verts ; `.dockerignore` n'est pas jugé sur sa lecture mais sur sa sémantique réelle (`filepath.Match` de BuildKit rejouée dans `src/deploy/deployment-config.test.ts`), faute de `docker build` ici |
| Durabilité après coupure de courant réelle | Pas de coupure provocable | `kill -9` pendant l'exploitation, en WAL + `synchronous=FULL` **posé et relu dans le processus du serveur**, sur une connexion unique — la pose échoue bruyamment si SQLite ne la retient pas |
| Volume réel (des années de CRA) | Pas de base de cette taille | `VACUUM INTO` mesuré sur une base de recette (308 Ko) |
| Connexion Google de bout en bout | Pas d'identifiants OAuth ici | L'URL de retour exacte est affichée au démarrage et vérifiée par test |

**Corrigé depuis, et mesuré sur l'archive.** `demarrer.sh` et `arreter.sh` ne
jugeaient que par le port, et se trompaient dans les deux sens : un serveur
vivant qui n'écoutait pas (encore) passait pour mort — `arreter.sh` effaçait
alors le repère **sans rien tuer**, et le démarrage suivant lançait un second
serveur sur la même base — tandis qu'un programme tiers sur le port 3000 passait
pour CRA. Le repère `donnees/cra.pid` fait désormais foi : c'est le processus
qu'on interroge, reconnu par son **instant de démarrage** confronté à celui
inscrit au repère (le seul signal qui résiste au fait que Next renomme son
propre processus en `next-server (v15.5.23)`, mesuré), et un numéro recyclé par
le système n'est jamais tué.

**Ce que cela a fait apparaître.** Next installe son propre gestionnaire de
SIGTERM, qui attend `server.close()` — lequel ne rend la main qu'une fois toutes
les connexions fermées, et hors développement Next n'appelle jamais
`closeAllConnections()`. Mesuré sur l'archive réelle : le port se libère
aussitôt, **le processus était toujours vivant 25 secondes après SIGTERM**.
L'ancien `arreter.sh` annonçait donc l'arrêt en 0,3 seconde en laissant un
orphelin — à chaque arrêt, pas seulement dans les cas limites.
`outils/lancer.mjs` pose maintenant `NEXT_MANUAL_SIG_HANDLE=1` : SIGTERM
retrouve le comportement par défaut de Node. Mesuré ensuite, bout en bout sur
l'archive dézippée : arrêt en **0,43 seconde**, processus effectivement mort,
empreinte SHA-256 de `donnees/cra.db` inchangée, aucun serveur résiduel.

**Limite subsistante.** `outils/lib/port.mjs` sonde encore la disponibilité d'un
port en écoutant sur `127.0.0.1` (IPv4) : un programme tiers écoutant sur le
même port en **IPv6** seulement (`*:3000`) reste invisible, et CRA peut démarrer
sur un port déjà pris. L'arrêt, lui, ne dépend plus du port.

---

## Licence, et ce qu'elle impose

Ce logiciel est distribué sous **GNU Affero General Public License, version 3**.
Le texte intégral est dans [LICENSE](LICENSE).

En clair : vous pouvez l'utiliser, l'installer où vous voulez, le modifier et le
redistribuer — y compris commercialement. En échange, **toute version modifiée
que vous exposez à des utilisateurs via un réseau doit rendre son code source
disponible à ces utilisateurs** (article 13). C'est ce qui distingue l'AGPL de
la GPL, et c'est délibéré : le produit est fait pour être auto-hébergé, et cette
clause empêche qu'une version fermée en soit tirée comme service en ligne.

**Obligation à honorer dans le produit lui-même.** L'article 13 vise les
utilisateurs qui interagissent avec le logiciel *à distance*. Une installation
qui sert plusieurs consultants doit donc leur offrir un moyen d'obtenir la
source — en pratique, un lien vers le dépôt, visible depuis l'application. **Ce
lien n'existe pas encore** : il sera posé quand le dépôt aura une adresse
publique.

Aucune obligation, en revanche, pour un usage strictement personnel et non
modifié : installer et se servir du produit tel quel n'impose rien.

---

## Publier une version, et la recevoir sur un NAS

**Publier.** Une version se pose par une étiquette git, jamais par une fusion :

```bash
npm version minor        # met à jour package.json et pose l'étiquette
git push --follow-tags
```

GitHub Actions construit alors l'image en `amd64` et `arm64`, et la publie sur
Docker Hub sous deux étiquettes : `latest`, et le numéro de version.

Deux secrets sont attendus dans le dépôt (`Settings → Secrets → Actions`) :
`DOCKERHUB_USERNAME` et `DOCKERHUB_TOKEN`.

**Recevoir.** Sur le NAS, la composition à utiliser est
[`docker-compose.prod.yml`](docker-compose.prod.yml) — elle **tire** l'image
publiée au lieu de la construire, ce qui est la condition pour recevoir une
mise à jour. Container Manager signale alors les nouvelles versions de `latest`
et les applique d'un clic.

**Avant chaque mise à jour, une sauvegarde.** Le conteneur applique les
migrations de base au démarrage : si l'une échoue, il ne démarre pas. La
composition embarque un service qui fait un `pg_dump` quotidien vers
`./sauvegardes`, avec 90 jours de rétention — pointez ce dossier vers un partage
du NAS, hors du conteneur.

**Ce qui ne doit jamais changer entre deux versions** : `AUTH_SECRET` et
`CREDENTIALS_KEY`. Régénérer la première déconnecte tout le monde ; régénérer la
seconde rend **illisibles** les jetons Google et Dolibarr, définitivement — il
n'existe aucune rotation de clé.

