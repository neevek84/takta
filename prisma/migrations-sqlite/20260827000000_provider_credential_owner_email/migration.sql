-- L'adresse du compte Google connecté (son calendrier `primary`), invitée sur
-- chaque bloc pour que le libre/occupé du compte le porte.
-- AlterTable
ALTER TABLE "ProviderCredential" ADD COLUMN "ownerEmail" TEXT NOT NULL DEFAULT '';
