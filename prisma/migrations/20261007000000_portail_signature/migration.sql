-- Lot 3b — le client valide et signe dans l'outil.
--
-- L'envoi en cours garde sa ligne unique ; les envois remplacés sont recopiés
-- dans SignatureEnvoiClos. LienClient ne porte que l'empreinte du jeton.
-- AlterTable
ALTER TABLE "SignatureRequest" ADD COLUMN     "contenuFige" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "empreinte" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "externalId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "motifRefus" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "numero" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "origine" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SignatureEnvoiClos" (
    "id" TEXT NOT NULL,
    "craId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "motifRefus" TEXT NOT NULL DEFAULT '',
    "signataireNom" TEXT NOT NULL DEFAULT '',
    "signataireEmail" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "empreinte" TEXT NOT NULL DEFAULT '',
    "closAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureEnvoiClos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LienClient" (
    "id" TEXT NOT NULL,
    "craId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "jetonEmpreinte" TEXT NOT NULL,
    "jetonSignataire" TEXT NOT NULL DEFAULT '',
    "revokedAt" TIMESTAMP(3),
    "codeEmpreinte" TEXT NOT NULL DEFAULT '',
    "codeExpireAt" TIMESTAMP(3),
    "codeEssais" INTEGER NOT NULL DEFAULT 0,
    "codesEnvoyes" INTEGER NOT NULL DEFAULT 0,
    "codesFenetreAt" TIMESTAMP(3),
    "derniereConsultationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LienClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvoiClos_craId_numero_key" ON "SignatureEnvoiClos"("craId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "LienClient_jetonEmpreinte_key" ON "LienClient"("jetonEmpreinte");

-- CreateIndex
CREATE INDEX "LienClient_craId_numero_idx" ON "LienClient"("craId", "numero");

-- AddForeignKey
ALTER TABLE "SignatureEnvoiClos" ADD CONSTRAINT "SignatureEnvoiClos_craId_fkey" FOREIGN KEY ("craId") REFERENCES "Cra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienClient" ADD CONSTRAINT "LienClient_craId_fkey" FOREIGN KEY ("craId") REFERENCES "Cra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

