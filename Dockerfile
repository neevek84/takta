FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Le schema.prisma committe declare provider = "sqlite" (etat de developpement,
# voir README). L'image cible Postgres (docker-compose.yml injecte une
# DATABASE_URL postgresql://) : `db:pg` bascule le provider PUIS genere le
# client, sinon le client genere ne correspond jamais au moteur cible.
RUN npm run db:pg && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Etiquettes OCI : `docker inspect` dit alors ce que l'image est. L'interface
# de Container Manager, elle, n'affiche que l'identifiant local — c'est
# pourquoi l'application affiche aussi sa version elle-meme.
ARG VERSION=dev
LABEL org.opencontainers.image.title="takta" \
      org.opencontainers.image.description="Compte-rendu d'activite pour consultants independants" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/neevek84/takta" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# `output: 'standalone'` ne trace que les modules importés par le code : les
# fichiers statiques de public/ n'y entrent jamais. Sans ce COPY, manifeste,
# service worker et icônes renvoient 404 dans l'image — le manifeste n'est pas
# analysé, le service worker n'est pas enregistré, et l'invite « Installer
# l'application » n'apparaît pas. Ce sont les quatre fichiers que
# src/middleware.ts laisse justement passer sans session.
COPY --from=builder /app/public ./public
# prisma/schema.prisma copie ici est celui MUTE par le RUN ci-dessus
# (provider = "postgresql"), coherent avec prisma/migrations/migration_lock.toml.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
# Les scripts de maintenance sous scripts/ (ex. backfill-invites-calendrier.ts)
# ne passent pas par le tracing de sortie standalone de Next puisqu'aucun code
# applicatif ne les importe : ils sont executes tels quels par
# `node --experimental-strip-types`, et importent directement ce module par
# chemin relatif plutot que par l'alias @/, que ce mode d'execution ne resout
# pas. Sans cette ligne, cet import echoue avec ERR_MODULE_NOT_FOUND une fois
# le conteneur en service, ce que le build n'exerce jamais.
COPY --from=builder /app/src/core/crypto ./src/core/crypto
# node_modules complet (pas seulement node_modules/.prisma) : le demarrage du
# conteneur a besoin du CLI `prisma` (paquet "prisma", devDependency) pour
# executer `prisma migrate deploy`, que le tracing de sortie standalone de
# Next n'inclut pas puisqu'aucun code applicatif ne l'importe. Ce COPY
# ecrase/complete le sous-ensemble deja pose par .next/standalone ci-dessus.
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
# Applique les migrations Postgres commitees (prisma/migrations/) puis
# demarre le serveur standalone. Echoue fort si `migrate deploy` echoue :
# pas de demarrage silencieux sur un schema non a jour.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
