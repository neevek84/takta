#!/bin/sh
# Demarre l'application CRA. Voir LISEZMOI.txt
set -e

RACINE="$(cd "$(dirname "$0")" && pwd)"
CRA_RACINE="$RACINE"
export CRA_RACINE

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js n'est pas installe sur cet ordinateur."
  echo "  Installe Node.js 20 ou plus depuis https://nodejs.org"
  echo "  puis relance ./demarrer.sh"
  echo ""
  exit 1
fi

VERSION="$(node -v)"
MAJEURE="$(echo "$VERSION" | sed 's/^v//' | cut -d. -f1)"
case "$MAJEURE" in
  ''|*[!0-9]*)
    echo ""
    echo "  Impossible de lire la version de Node.js (reponse : \"$VERSION\")."
    echo "  Reinstalle Node.js 20 ou plus depuis https://nodejs.org"
    echo ""
    exit 1
    ;;
esac

if [ "$MAJEURE" -lt 20 ]; then
  echo ""
  echo "  Node.js $VERSION est trop ancien : il faut la version 20 ou plus."
  echo "  Installe une version recente depuis https://nodejs.org"
  echo "  puis relance ./demarrer.sh"
  echo ""
  exit 1
fi

# macOS marque en quarantaine tout ce qui sort d'une archive telechargee ; le
# moteur natif de Prisma serait refuse au chargement. Sans effet ailleurs.
if [ "$(uname)" = "Darwin" ]; then
  xattr -dr com.apple.quarantine "$RACINE" 2>/dev/null || true
fi

exec node "$RACINE/app/outils/lancer.mjs" "$@"
