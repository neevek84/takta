-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minutesParJour" INTEGER
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minutesParJour" INTEGER,
    "signataireNom" TEXT NOT NULL DEFAULT '',
    "signataireEmail" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Mission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MissionLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "MissionLine_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "soldCentiemes" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATETIME,
    "endDate" DATETIME,
    CONSTRAINT "Assignment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "MissionLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "slotId" TEXT NOT NULL DEFAULT '',
    "startMinute" INTEGER NOT NULL DEFAULT 540,
    "endMinute" INTEGER NOT NULL DEFAULT 1020,
    "comment" TEXT NOT NULL DEFAULT '',
    "minutesParJour" INTEGER NOT NULL DEFAULT 480,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimeEntry_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "MissionLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cra" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BROUILLON',
    "invoiceNumber" TEXT,
    "invoicedAt" DATETIME,
    "paidAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Cra_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Cra_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "craId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EN_ATTENTE',
    "signataireNom" TEXT NOT NULL DEFAULT '',
    "signataireEmail" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relances" INTEGER NOT NULL DEFAULT 0,
    "lastRelanceAt" DATETIME,
    "completedAt" DATETIME,
    "abandoned" BOOLEAN NOT NULL DEFAULT false,
    "signedPdf" BLOB,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SignatureRequest_craId_fkey" FOREIGN KEY ("craId") REFERENCES "Cra" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignatureWebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExternalLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "syncedAt" DATETIME,
    "syncState" TEXT NOT NULL DEFAULT 'PENDING',
    "etag" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ExternalLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "minutesParJour" INTEGER NOT NULL DEFAULT 480,
    "capacityMode" TEXT NOT NULL DEFAULT 'AVERTISSEMENT',
    "capacityCentiemes" INTEGER NOT NULL DEFAULT 100,
    "workingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "slotsJson" TEXT NOT NULL DEFAULT '[]',
    "holidaysJson" TEXT NOT NULL DEFAULT '[]',
    "defaultDisplayUnit" TEXT NOT NULL DEFAULT 'JOUR',
    "defaultEngagementSource" TEXT NOT NULL DEFAULT 'MANUEL',
    "objectifCaExerciceCents" INTEGER NOT NULL DEFAULT 0,
    "debutExerciceMois" INTEGER NOT NULL DEFAULT 1,
    "themeJson" TEXT NOT NULL DEFAULT '{}',
    "journeeDebutMinute" INTEGER NOT NULL DEFAULT 540,
    "journeeFinMinute" INTEGER NOT NULL DEFAULT 1080,
    "emetteurNom" TEXT NOT NULL DEFAULT '',
    "emetteurAdresse" TEXT NOT NULL DEFAULT '',
    "emetteurSiret" TEXT NOT NULL DEFAULT '',
    "emetteurEmail" TEXT NOT NULL DEFAULT '',
    "relanceJours" INTEGER NOT NULL DEFAULT 7
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "remoteSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolution" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "SyncConflict_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerScope" TEXT NOT NULL DEFAULT 'USER',
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "scope" TEXT NOT NULL DEFAULT '',
    "calendarId" TEXT NOT NULL DEFAULT '',
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
CREATE UNIQUE INDEX "TimeEntry_lineId_userId_date_startMinute_key" ON "TimeEntry"("lineId", "userId", "date", "startMinute");

-- CreateIndex
CREATE INDEX "Cra_userId_idx" ON "Cra"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Cra_missionId_userId_month_key" ON "Cra"("missionId", "userId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureRequest_craId_key" ON "SignatureRequest"("craId");

-- CreateIndex
CREATE INDEX "SignatureRequest_status_idx" ON "SignatureRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureWebhookEvent_provider_eventId_key" ON "SignatureWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "ExternalLink_provider_externalId_idx" ON "ExternalLink"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ExternalLink_userId_idx" ON "ExternalLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalLink_entityType_entityId_provider_key" ON "ExternalLink"("entityType", "entityId", "provider");

-- CreateIndex
CREATE INDEX "SyncOutbox_state_nextAttemptAt_idx" ON "SyncOutbox"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SyncOutbox_userId_idx" ON "SyncOutbox"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncOutbox_entityType_entityId_provider_key" ON "SyncOutbox"("entityType", "entityId", "provider");

-- CreateIndex
CREATE INDEX "SyncConflict_userId_resolvedAt_idx" ON "SyncConflict"("userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "SyncConflict_entityType_entityId_provider_idx" ON "SyncConflict"("entityType", "entityId", "provider");

-- CreateIndex
CREATE INDEX "ProviderCredential_userId_idx" ON "ProviderCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_ownerScope_userId_provider_key" ON "ProviderCredential"("ownerScope", "userId", "provider");

