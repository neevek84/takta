#!/bin/sh
# Vide la file de synchronisation en appelant l'application.
#
# Passe par l'endpoint plutot que par le service : celui-ci est en TypeScript
# et vit dans le serveur, qui tourne deja. Le jeton se lit dans `.env`, jamais
# en argument — une ligne de commande est visible de tout le systeme.
#
# Le serveur arrete n'est pas une erreur : il n'y a alors rien a drainer, et un
# agent qui hurle toutes les dix minutes finit par n'etre plus lu.
set -eu
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
JETON="$(sed -n 's/^SYNC_FLUSH_TOKEN="\(.*\)"$/\1/p' "$RACINE/.env" | head -1)"
URL="${CRA_URL:-http://localhost:3000}/api/sync/flush"
QUAND="$(date '+%Y-%m-%d %H:%M:%S')"

if [ -z "$JETON" ]; then
  echo "$QUAND · SYNC_FLUSH_TOKEN absent de .env : drainage ferme."
  exit 0
fi

REPONSE="$(curl -s -m 60 -o /tmp/cra-drain.out -w '%{http_code}' \
  -X POST "$URL" -H "Authorization: Bearer $JETON" 2>/dev/null || echo 000)"

case "$REPONSE" in
  200) echo "$QUAND · $(cat /tmp/cra-drain.out)" ;;
  000) echo "$QUAND · application arretee, rien a drainer" ;;
  401) echo "$QUAND · jeton refuse : SYNC_FLUSH_TOKEN differe de celui du serveur (redemarre-le)" ;;
  *)   echo "$QUAND · l'application a repondu $REPONSE : $(cat /tmp/cra-drain.out)" ;;
esac
