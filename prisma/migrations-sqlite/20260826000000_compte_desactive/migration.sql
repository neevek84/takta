-- Couper un accès sans rien détruire.
-- Jusqu'ici, fermer une porte obligeait à supprimer le compte : ses saisies,
-- ses CRA et l'attribution de tout ce qui a été poussé chez Dolibarr partaient
-- avec. Le drapeau sépare les deux gestes.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
