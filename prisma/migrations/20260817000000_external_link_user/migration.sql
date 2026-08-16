-- Rattache `ExternalLink` à son propriétaire.
--
-- La colonne est ajoutée nullable puis remplie, et seulement ensuite passée
-- en NOT NULL : un `ADD COLUMN ... NOT NULL` sans défaut échoue sur une table
-- déjà peuplée, et le défaut '' violerait la clé étrangère posée en fin de
-- fichier. `entityType` ne vaut que 'TimeEntry' à ce jour — le seul type
-- synchronisé du lot ; toute ligne qui ne se rattache à aucune saisie
-- existante est un orphelin produit par l'absence même de ce rattachement, et
-- n'a plus rien à désigner.

-- AlterTable
ALTER TABLE "ExternalLink" ADD COLUMN     "userId" TEXT;

UPDATE "ExternalLink" AS l
SET "userId" = t."userId"
FROM "TimeEntry" AS t
WHERE l."entityType" = 'TimeEntry' AND l."entityId" = t."id";

DELETE FROM "ExternalLink" WHERE "userId" IS NULL;

-- AlterTable
ALTER TABLE "ExternalLink" ALTER COLUMN "userId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ExternalLink_userId_idx" ON "ExternalLink"("userId");

-- AddForeignKey
ALTER TABLE "ExternalLink" ADD CONSTRAINT "ExternalLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
