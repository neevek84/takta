-- L'adresse du compte Google connecté (son calendrier `primary`), retrouvée
-- une fois à la connexion et invitée sur chaque bloc pour que le libre/occupé
-- du compte le porte — un calendrier secondaire ne suffit pas à lui seul, un
-- tiers qui invite l'utilisateur ne le voit jamais occupé sans cela.
-- AlterTable
ALTER TABLE "ProviderCredential" ADD COLUMN     "ownerEmail" TEXT NOT NULL DEFAULT '';
