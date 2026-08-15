-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionLine" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "soldCentiemes" INTEGER NOT NULL DEFAULT 0,
    "tjmCents" INTEGER NOT NULL DEFAULT 0,
    "displayUnit" TEXT NOT NULL DEFAULT 'JOUR',
    "minutesParJour" INTEGER,
    "engagementSource" TEXT NOT NULL DEFAULT 'MANUEL',
    "allowedSlotIds" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MissionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "soldCentiemes" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "slotId" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cra" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BROUILLON',
    "invoiceNumber" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalLink" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "syncState" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "ExternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "minutesParJour" INTEGER NOT NULL DEFAULT 480,
    "capacityMode" TEXT NOT NULL DEFAULT 'AVERTISSEMENT',
    "capacityCentiemes" INTEGER NOT NULL DEFAULT 100,
    "workingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "slotsJson" TEXT NOT NULL DEFAULT '[]',
    "holidaysJson" TEXT NOT NULL DEFAULT '[]',
    "defaultDisplayUnit" TEXT NOT NULL DEFAULT 'JOUR',
    "defaultEngagementSource" TEXT NOT NULL DEFAULT 'MANUEL',

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Mission_clientId_idx" ON "Mission"("clientId");

-- CreateIndex
CREATE INDEX "MissionLine_missionId_idx" ON "MissionLine"("missionId");

-- CreateIndex
CREATE INDEX "Assignment_userId_idx" ON "Assignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_lineId_userId_key" ON "Assignment"("lineId", "userId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_date_idx" ON "TimeEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_lineId_idx" ON "TimeEntry"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_lineId_userId_date_slotId_key" ON "TimeEntry"("lineId", "userId", "date", "slotId");

-- CreateIndex
CREATE INDEX "Cra_userId_idx" ON "Cra"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Cra_missionId_userId_month_key" ON "Cra"("missionId", "userId", "month");

-- CreateIndex
CREATE INDEX "ExternalLink_provider_externalId_idx" ON "ExternalLink"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalLink_entityType_entityId_provider_key" ON "ExternalLink"("entityType", "entityId", "provider");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionLine" ADD CONSTRAINT "MissionLine_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "MissionLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "MissionLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cra" ADD CONSTRAINT "Cra_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cra" ADD CONSTRAINT "Cra_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

