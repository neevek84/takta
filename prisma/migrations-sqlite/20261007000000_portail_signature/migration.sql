-- Lot 3b : le client valide et signe dans l outil.
--
-- L envoi en cours garde sa ligne unique, les envois remplaces sont recopies
-- dans SignatureEnvoiClos. LienClient ne porte que l empreinte du jeton.
-- Pendant SQLite de la migration Postgres du meme nom : une colonne par
-- ALTER TABLE, sans reconstruire SignatureRequest (toutes ont une valeur par
-- defaut).
-- AlterTable
ALTER TABLE "SignatureRequest" ADD COLUMN "numero" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SignatureRequest" ADD COLUMN "externalId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SignatureRequest" ADD COLUMN "motifRefus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SignatureRequest" ADD COLUMN "contenuFige" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SignatureRequest" ADD COLUMN "empreinte" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SignatureRequest" ADD COLUMN "origine" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SignatureEnvoiClos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "craId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "motifRefus" TEXT NOT NULL DEFAULT '',
    "signataireNom" TEXT NOT NULL DEFAULT '',
    "signataireEmail" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "empreinte" TEXT NOT NULL DEFAULT '',
    "closAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignatureEnvoiClos_craId_fkey" FOREIGN KEY ("craId") REFERENCES "Cra" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LienClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "craId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "jetonEmpreinte" TEXT NOT NULL,
    "jetonSignataire" TEXT NOT NULL DEFAULT '',
    "revokedAt" DATETIME,
    "codeEmpreinte" TEXT NOT NULL DEFAULT '',
    "codeExpireAt" DATETIME,
    "codeEssais" INTEGER NOT NULL DEFAULT 0,
    "codesEnvoyes" INTEGER NOT NULL DEFAULT 0,
    "codesFenetreAt" DATETIME,
    "derniereConsultationAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LienClient_craId_fkey" FOREIGN KEY ("craId") REFERENCES "Cra" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvoiClos_craId_numero_key" ON "SignatureEnvoiClos"("craId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "LienClient_jetonEmpreinte_key" ON "LienClient"("jetonEmpreinte");

-- CreateIndex
CREATE INDEX "LienClient_craId_numero_idx" ON "LienClient"("craId", "numero");

