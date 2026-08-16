# CRA

Application de compte-rendu d'activité autoportante. Elle ne facture pas :
son rôle s'arrête au CRA validé. Les champs liés à la facturation
(`invoiceNumber`, `invoicedAt`, `paidAt`) sont un suivi informatif, pas un
module de facturation.

Une seule base de code, quatre cibles d'installation :

| Cible                    | Moyen                          | Base            |
|---------------------------|--------------------------------|-----------------|
| VPS / serveur              | Docker Compose                 | Postgres        |
| Cloud managé                | template de déploiement (à venir) | Postgres        |
| Poste local                 | `npm run setup:local`          | SQLite (fichier) |
| Poste local, double-clic    | Tauri — hors périmètre de ce lot | SQLite         |

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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | non | vides : connexion Google indisponible |
| `GOOGLE_REDIRECT_URI` | non | `http://localhost:3000/api/google/callback` |
| `CRA_TIMEZONE` | non | `Europe/Paris` |
| `SYNC_FLUSH_TOKEN` | non | vide : `POST /api/sync/flush` fermé |

`CREDENTIALS_KEY` est exigée au démarrage alors que le connecteur Google est,
lui, entièrement optionnel. C'est délibéré : absente, elle ne se manifesterait
qu'au retour du consentement Google, très loin du déploiement — et l'écran
d'alors ne peut proposer que de recommencer une opération qui ne peut jamais
aboutir. Une variable exigée au démarrage se corrige en une commande ; la même
variable oubliée se paye en dépannage.

Pour un déploiement derrière un nom de domaine, exporter aussi
`GOOGLE_REDIRECT_URI=https://votre-domaine/api/google/callback` — la même
valeur, au caractère près, que celle déclarée dans la console Google Cloud.

### Journaux

`docker compose logs app`. Les lignes du chemin Google et de la
synchronisation sont préfixées `[cra]` :

```
[cra] error google.callback userId=… erreur=SecretBoxError message="CREDENTIALS_KEY est absente…"
[cra] warn  google.connect raison=non-configure manquantes=GOOGLE_CLIENT_ID
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
