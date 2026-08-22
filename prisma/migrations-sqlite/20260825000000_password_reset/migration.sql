-- Les liens de réinitialisation de mot de passe.
--
-- La table porte l'EMPREINTE du jeton, jamais le jeton : une base qui fuite ne
-- doit pas livrer des liens utilisables. `usedAt` distingue un lien consommé
-- d'un lien expiré — les deux sont refusés, mais l'écran ne dit pas la même
-- chose, et la trace sert à comprendre après coup.
-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");
