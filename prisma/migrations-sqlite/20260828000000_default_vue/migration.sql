-- La vue ouverte par défaut sur /saisie (CALENDRIER, TROIS_MOIS ou TABLEAU),
-- réglée depuis « Mon profil » ; NULL tant que la personne n'a rien réglé.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "defaultVue" TEXT;
