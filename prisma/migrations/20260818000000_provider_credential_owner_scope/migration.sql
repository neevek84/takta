-- Ouvre `ProviderCredential` aux secrets d'instance (clé d'API Dolibarr) sans
-- désarmer la contrainte qui protège les jetons personnels (Google).
--
-- `ownerScope` entre dans la clé d'unicité. La tentation était de rendre
-- `userId` nullable — une clé Dolibarr n'a pas de propriétaire personnel — mais
-- un NULL n'est jamais égal à un autre NULL : deux clés d'instance du même
-- fournisseur seraient passées sans que rien ne les arrête, et la contrainte
-- aurait cessé de contraindre en silence. Une ligne d'instance porte donc
-- `userId = ''`, sentinelle non nulle (leçon de `TimeEntry.slotId`, lot 0).
--
-- Les identifiants déjà en base sont tous des jetons Google personnels : le
-- DEFAULT 'USER' de la colonne ajoutée leur donne la bonne portée sans qu'on
-- ait à les réécrire, et leur `userId` reste celui de leur propriétaire.

-- AlterTable
ALTER TABLE "ProviderCredential" ADD COLUMN     "ownerScope" TEXT NOT NULL DEFAULT 'USER',
ADD COLUMN     "baseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "metadataJson" TEXT NOT NULL DEFAULT '{}';

-- Une clé d'API Dolibarr n'expire pas. Les lignes Google existantes gardent
-- leur échéance : `DROP NOT NULL` n'efface aucune valeur.
-- AlterTable
ALTER TABLE "ProviderCredential" ALTER COLUMN "expiresAt" DROP NOT NULL;

-- La clé étrangère ne peut pas survivre à la sentinelle `userId = ''`, qui ne
-- désigne aucune ligne de `User`. Ce qui se perd, c'est la cascade de
-- suppression d'un compte ; ce qui se gagne, c'est une clé d'instance qui ne
-- meurt pas avec l'exploitant qui l'a saisie. L'alternative — un faux compte
-- conventionnel pour la porter — aurait dû être filtrée par tous les écrans
-- qui listent des utilisateurs.
-- DropForeignKey
ALTER TABLE "ProviderCredential" DROP CONSTRAINT "ProviderCredential_userId_fkey";

-- DropIndex
DROP INDEX "ProviderCredential_userId_provider_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_ownerScope_userId_provider_key" ON "ProviderCredential"("ownerScope", "userId", "provider");
