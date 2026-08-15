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

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
docker compose up -d --build
docker compose exec app node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse
```

L'application écoute sur http://localhost:3000

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
développement Postgres est disponible.

## Poste local (sans Docker, SQLite)

Prérequis : Node.js 20 ou plus.

```bash
npm install
echo 'DATABASE_URL="file:./cra.db"' > .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
npm run setup:local
npm run build
node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse
npm start
```

La base est le fichier `prisma/cra.db` — le sauvegarder, c'est sauvegarder
toutes les données.

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
moyen de garantir que la portabilité ne se dégrade pas silencieusement au
fil des migrations ; c'est à inscrire au backlog du prochain lot. En
attendant, ne pas contourner les règles ci-dessus : elles conditionnent le
mode local et l'empaquetage à venir.

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
- Postgres : **jamais validé empiriquement** ici, aucun serveur n'était
  joignable. Une migration initiale (`prisma/migrations/20260815000000_init/`)
  a été générée hors ligne par diff de schéma (`prisma migrate diff
  --from-empty ...`, sans connexion base) et committée, mais son
  application réelle contre un Postgres vivant n'a jamais été exercée ici.
