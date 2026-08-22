-- Un client peut être rangé, comme une mission l'était déjà.
-- Rangé, pas détruit : il disparaît des listes et ses missions avec lui, mais
-- son histoire — CRA signés, temps poussés chez Dolibarr — reste lisible. La
-- suppression, elle, existe aussi, et c'est un geste distinct : elle emporte
-- tout et ne se rattrape pas.
-- AlterTable
ALTER TABLE "Client" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
