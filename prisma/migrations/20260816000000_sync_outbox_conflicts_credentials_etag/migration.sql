-- AlterTable
ALTER TABLE "ExternalLink" ADD COLUMN     "etag" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "journeeDebutMinute" INTEGER NOT NULL DEFAULT 540,
ADD COLUMN     "journeeFinMinute" INTEGER NOT NULL DEFAULT 1080;

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "remoteSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "calendarId" TEXT NOT NULL DEFAULT '',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "ProviderCredential_userId_provider_key" ON "ProviderCredential"("userId", "provider");

-- AddForeignKey
ALTER TABLE "SyncOutbox" ADD CONSTRAINT "SyncOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

