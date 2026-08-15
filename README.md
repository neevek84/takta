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
Dockerfile appelle `npx prisma generate` après avoir basculé implicitement
en Postgres via `db:pg` : voir le paragraphe Docker ci-dessous pour l'ordre
exact des commandes.

**Règle à respecter absolument :** avant de committer, remettre le
provider sur `sqlite` (`npm run db:sqlite` ou
`node scripts/set-db-provider.mjs sqlite`) pour laisser le dépôt dans
l'état de développement attendu.

## Serveur (Docker Compose, Postgres)

> **Ce chemin n'a pas été vérifié empiriquement dans cet environnement**
> (Docker n'y est pas installé). Le Dockerfile et le `docker-compose.yml`
> ont été relus ligne à ligne contre l'arborescence réelle du projet, mais
> `docker compose up --build` n'a pas pu être exécuté ici. À valider avant
> une mise en production.

Aucune migration Postgres n'a encore été générée : le dossier
`prisma/migrations/` n'existe pas dans ce dépôt. **Avant la toute première
mise en service**, il faut donc créer la migration initiale en local,
contre un Postgres joignable, puis la committer :

```bash
npm run db:pg
npx prisma migrate dev --name init
git add prisma/schema.prisma prisma/migrations
git commit -m "chore(db): migration Postgres initiale"
node scripts/set-db-provider.mjs sqlite   # remettre le dépôt en état sqlite
```

Une fois `prisma/migrations/` présent et committé, le déploiement se fait
ainsi :

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app node scripts/create-user.mjs moi@exemple.fr "Mon Nom" motdepasse
```

L'application écoute sur http://localhost:3000

`docker compose exec app npx prisma migrate deploy` échouera tant qu'aucune
migration n'existe dans `prisma/migrations/` — voir le paragraphe
ci-dessus. C'est la bonne commande, mais elle suppose que la migration
initiale a déjà été générée et committée.

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

La suite d'intégration tourne contre les deux moteurs. Ne pas contourner
ces règles : elles conditionnent le mode local et l'empaquetage à venir.

## État vérifié de ce lot

- `npx vitest run` : 101 tests verts sur 15 fichiers.
- `npx tsc --noEmit` : 0 erreur.
- `npx next build` : aboutit (`output: 'standalone'` dans `next.config.ts`).
- `Dockerfile` / `docker-compose.yml` : relus contre l'arborescence réelle,
  **non exécutés** (Docker indisponible dans cet environnement).
- Postgres : **jamais validé empiriquement** ici, aucun serveur n'était
  joignable. Aucune migration Postgres n'existe encore dans le dépôt.
