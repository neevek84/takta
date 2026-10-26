-- Un CRA par prestation, au choix de chaque mission.
--
-- Une mission peut porter plusieurs commandes d'un même client, rangées en
-- prestations et facturées chacune à part. Le CRA gagne la prestation qu'il
-- couvre seule (vide = toute la mission, le comportement historique), et la
-- mission le réglage qui choisit entre les deux.
-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "modeCra" TEXT NOT NULL DEFAULT 'MISSION';

-- AlterTable
ALTER TABLE "Cra" ADD COLUMN     "lineId" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "Cra_missionId_userId_month_key";

-- CreateIndex
CREATE UNIQUE INDEX "Cra_missionId_userId_month_lineId_key" ON "Cra"("missionId", "userId", "month", "lineId");
