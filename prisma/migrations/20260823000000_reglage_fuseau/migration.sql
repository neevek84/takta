-- Le fuseau quitte l'environnement (CRA_TIMEZONE) pour les réglages.
-- '' = jamais choisi : le service applique alors celui du système. Une valeur
-- par défaut 'Europe/Paris' rendrait indiscernables « choisi Paris » et
-- « jamais choisi », et figerait le repli dans la base au lieu de le laisser
-- suivre la machine.
-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT '';
