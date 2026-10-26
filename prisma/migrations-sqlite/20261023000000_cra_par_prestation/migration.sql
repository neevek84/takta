-- Un CRA par prestation, au choix de chaque mission.
--
-- Pendant SQLite de la migration Postgres du meme nom. Les deux colonnes ont
-- une valeur par defaut : un ALTER TABLE chacune, sans reconstruire de table.
-- AlterTable
ALTER TABLE "Mission" ADD COLUMN "modeCra" TEXT NOT NULL DEFAULT 'MISSION';

-- AlterTable
ALTER TABLE "Cra" ADD COLUMN "lineId" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "Cra_missionId_userId_month_key";

-- CreateIndex
CREATE UNIQUE INDEX "Cra_missionId_userId_month_lineId_key" ON "Cra"("missionId", "userId", "month", "lineId");
