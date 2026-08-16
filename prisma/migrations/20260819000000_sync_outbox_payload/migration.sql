-- Donne à la file de sortie un contexte de rejeu propre au fournisseur.
--
-- L'agenda n'en avait pas besoin : sa cible est une saisie, et le drainage la
-- relit en base au moment de pousser. Un fournisseur dont la cible a déjà
-- changé de forme quand le drainage tourne — ou dont la clé d'API appartient à
-- l'instance et non à la personne — n'a pas cette chance : ce qu'il faut
-- pousser doit voyager avec la ligne.
--
-- Colonne NOT NULL avec DEFAULT '{}' : les lignes déjà en file la reçoivent
-- sans réécriture, et « pas de contexte » se lit comme un objet vide plutôt
-- que comme un NULL à tester partout. JSON lu et écrit en bloc uniquement —
-- aucune requête ne l'interroge finement, contrainte de portabilité
-- SQLite/Postgres du projet.

-- AlterTable
ALTER TABLE "SyncOutbox" ADD COLUMN     "payloadJson" TEXT NOT NULL DEFAULT '{}';
