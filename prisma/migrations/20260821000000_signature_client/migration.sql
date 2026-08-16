-- Le CRA sort de l'application, part chez le client et revient signé — sans
-- portail client, sans compte à créer pour lui. Trois choses nouvelles :
--
--   1. l'identité de l'émetteur, imprimée en tête du document, et le délai de
--      relance d'une signature en attente ;
--   2. le contact signataire, rattaché à la **mission** et non au client : un
--      même client porte plusieurs missions avec des interlocuteurs
--      différents, et le rattacher au client obligerait à ressaisir ou à se
--      tromper ;
--   3. la demande de signature et le journal des webhooks déjà traités.
--
-- Aucune colonne n'est nullable parmi celles qui entrent dans une contrainte
-- d'unicité (`SignatureRequest.craId`, `SignatureWebhookEvent(provider,
-- eventId)`) : un NULL n'étant jamais égal à un autre NULL, la contrainte
-- cesserait de contraindre en silence — la panne du lot 0 sur `slotId`.
--
-- Les colonnes ajoutées à une table peuplée portent toutes un DEFAULT NOT
-- NULL : un `ADD COLUMN ... NOT NULL` sans défaut échouerait sur une base de
-- production. La valeur vide est ici le bon défaut, et non un pis-aller :
-- l'entête émetteur muet et une mission sans signataire sont deux états
-- normaux, le document se génère dans les deux cas.

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "emetteurNom" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "emetteurAdresse" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "emetteurSiret" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "emetteurEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "relanceJours" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "signataireNom" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "signataireEmail" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL,
    "craId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EN_ATTENTE',
    "signataireNom" TEXT NOT NULL DEFAULT '',
    "signataireEmail" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relances" INTEGER NOT NULL DEFAULT 0,
    "lastRelanceAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "abandoned" BOOLEAN NOT NULL DEFAULT false,
    "signedPdf" BYTEA,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureRequest_craId_key" ON "SignatureRequest"("craId");

-- CreateIndex
CREATE INDEX "SignatureRequest_status_idx" ON "SignatureRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureWebhookEvent_provider_eventId_key" ON "SignatureWebhookEvent"("provider", "eventId");

-- AddForeignKey
-- La cascade est voulue : une demande de signature n'a aucun sens sans son
-- CRA, et le PDF signé qu'elle archive désigne un mois qui n'existe plus.
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_craId_fkey" FOREIGN KEY ("craId") REFERENCES "Cra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
