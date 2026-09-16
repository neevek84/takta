-- Pause déjeuner et trajets chez le client. Pendant SQLite de la migration
-- Postgres du même nom : une colonne par ALTER TABLE, SQLite accepte une seule
-- colonne à la fois.
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
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "entryId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "poseAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Trajet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Trajet_userId_date_idx" ON "Trajet"("userId", "date");
