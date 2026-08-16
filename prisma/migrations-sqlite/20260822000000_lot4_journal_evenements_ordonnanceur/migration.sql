-- CreateTable
CREATE TABLE "AuditEvent" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL DEFAULT '',
    "actorLabel" TEXT NOT NULL DEFAULT 'SYSTEME',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'ACTIF',
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "suspendedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webhook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "webhookId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastState" TEXT NOT NULL DEFAULT '',
    "lastError" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runningSince" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
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
    "relanceJours" INTEGER NOT NULL DEFAULT 7,
    "webhookMaxEchecs" INTEGER NOT NULL DEFAULT 10,
    "notificationEmail" TEXT NOT NULL DEFAULT '',
    "smtpHost" TEXT NOT NULL DEFAULT '',
    "smtpPort" INTEGER NOT NULL DEFAULT 0,
    "smtpUser" TEXT NOT NULL DEFAULT '',
    "smtpFrom" TEXT NOT NULL DEFAULT '',
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Settings" ("capacityCentiemes", "capacityMode", "debutExerciceMois", "defaultDisplayUnit", "defaultEngagementSource", "emetteurAdresse", "emetteurEmail", "emetteurNom", "emetteurSiret", "holidaysJson", "id", "journeeDebutMinute", "journeeFinMinute", "minutesParJour", "objectifCaExerciceCents", "relanceJours", "slotsJson", "themeJson", "workingDays") SELECT "capacityCentiemes", "capacityMode", "debutExerciceMois", "defaultDisplayUnit", "defaultEngagementSource", "emetteurAdresse", "emetteurEmail", "emetteurNom", "emetteurSiret", "holidaysJson", "id", "journeeDebutMinute", "journeeFinMinute", "minutesParJour", "objectifCaExerciceCents", "relanceJours", "slotsJson", "themeJson", "workingDays" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_prevHash_key" ON "AuditEvent"("prevHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_hash_key" ON "AuditEvent"("hash");

-- CreateIndex
CREATE INDEX "AuditEvent_action_seq_idx" ON "AuditEvent"("action", "seq");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_seq_idx" ON "AuditEvent"("actorId", "seq");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "Webhook_userId_state_idx" ON "Webhook"("userId", "state");

-- CreateIndex
CREATE INDEX "WebhookDelivery_state_nextAttemptAt_idx" ON "WebhookDelivery"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_webhookId_seq_key" ON "WebhookDelivery"("webhookId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_name_key" ON "ScheduledJob"("name");

-- CreateIndex
CREATE INDEX "ScheduledJob_enabled_nextRunAt_idx" ON "ScheduledJob"("enabled", "nextRunAt");

