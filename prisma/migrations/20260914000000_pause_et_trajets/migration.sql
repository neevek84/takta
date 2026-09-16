-- Pause déjeuner et trajets chez le client.
--
-- La pause est figée sur chaque saisie (deux colonnes égales = aucune pause) ;
-- le lieu vient de la mission. Les trajets vivent dans leur propre table, sans
-- clé étrangère vers la saisie : ils lui survivent, comme dans l'agenda.
-- AlterTable
ALTER TABLE "Mission" ADD COLUMN "lieuDefaut" TEXT NOT NULL DEFAULT 'DISTANCE';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "pauseDebutMinute" INTEGER NOT NULL DEFAULT 750;
ALTER TABLE "Settings" ADD COLUMN "pauseFinMinute" INTEGER NOT NULL DEFAULT 810;
ALTER TABLE "Settings" ADD COLUMN "dureeTrajetMinutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "pauseDebutMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TimeEntry" ADD COLUMN "pauseFinMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TimeEntry" ADD COLUMN "lieu" TEXT NOT NULL DEFAULT 'DISTANCE';
ALTER TABLE "TimeEntry" ADD COLUMN "trajetsCalcules" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Trajet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "entryId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "poseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trajet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trajet_userId_date_idx" ON "Trajet"("userId", "date");

-- AddForeignKey
ALTER TABLE "Trajet" ADD CONSTRAINT "Trajet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
