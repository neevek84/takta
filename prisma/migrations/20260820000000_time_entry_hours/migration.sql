-- La saisie libre passe aux heures : une saisie porte désormais un début et
-- une fin, en minutes depuis minuit, **figés à l'écriture**.
--
-- Même règle que le facteur de conversion (`minutesParJour`), et pour la même
-- raison : redéfinir « Matin » en administration ne doit déplacer aucune
-- journée déjà saisie, et un CRA validé ne change jamais, ni de calcul, ni
-- d'horaires.
--
-- Trois gestes, dans cet ordre, et l'ordre compte : les colonnes, la reprise
-- des saisies existantes, puis seulement la nouvelle clé d'unicité. Créer
-- l'index avant la reprise le ferait échouer sur toute base où deux créneaux
-- coexistent le même jour — ils porteraient tous le même début par défaut.

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "startMinute" INTEGER NOT NULL DEFAULT 540,
ADD COLUMN     "endMinute" INTEGER NOT NULL DEFAULT 1020;

-- Reprise des saisies existantes.
--
-- Une saisie portant un créneau nommé reçoit **ses bornes actuelles** ; une
-- saisie à la journée reçoit celles de la journée de travail, tronquées au
-- temps réellement saisi pour ne pas occuper une soirée que personne n'a
-- vendue — exactement ce que le constructeur du bloc d'agenda calculait
-- jusqu'ici à chaque lecture.
--
-- Les créneaux vivent dans `Settings.slotsJson`, lu et écrit en bloc par
-- l'application. Le lire finement ici est un geste unique de reprise, pas un
-- accès de service : aucune requête de l'application n'interroge ce JSON, et
-- la contrainte de portabilité SQLite/Postgres du projet reste entière — cette
-- migration ne s'applique qu'à Postgres.
UPDATE "TimeEntry" AS t
SET
  "startMinute" = COALESCE(
    (SELECT (creneau ->> 'startMinute')::int
       FROM "Settings" s, LATERAL jsonb_array_elements((s."slotsJson")::jsonb) AS creneau
      WHERE s."id" = 'singleton' AND (creneau ->> 'id') = t."slotId"
      LIMIT 1),
    (SELECT s."journeeDebutMinute" FROM "Settings" s WHERE s."id" = 'singleton'),
    540
  ),
  "endMinute" = COALESCE(
    (SELECT (creneau ->> 'endMinute')::int
       FROM "Settings" s, LATERAL jsonb_array_elements((s."slotsJson")::jsonb) AS creneau
      WHERE s."id" = 'singleton' AND (creneau ->> 'id') = t."slotId"
      LIMIT 1),
    (SELECT (s."journeeDebutMinute"
             + LEAST(t."minutes", GREATEST(s."journeeFinMinute" - s."journeeDebutMinute", 0)))
            % 1440
       FROM "Settings" s WHERE s."id" = 'singleton'),
    1020
  );

-- Dernier filet avant la clé : deux saisies du même jour sur la même
-- prestation peuvent, sur une base réglée à la main, retomber sur la même
-- minute de début (un créneau qui commence exactement au début de la plage
-- journée, deux créneaux se recouvrant). Elles sont décalées d'une minute
-- plutôt que perdues : `minutes` — donc tout le calcul du CRA — ne bouge pas,
-- seule la place du bloc dans l'agenda se déplace d'une minute. Une migration
-- qui échoue sur les données de production ne protège personne.
WITH doublons AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "lineId", "userId", "date", "startMinute"
           ORDER BY "slotId", "id"
         ) - 1 AS rang
    FROM "TimeEntry"
)
UPDATE "TimeEntry" AS t
   SET "startMinute" = (t."startMinute" + d.rang) % 1440
  FROM doublons d
 WHERE d."id" = t."id" AND d.rang > 0;

-- La clé d'unicité change de dernière colonne : le `slotId` reste comme trace
-- du créneau nommé d'origine, mais cesse d'identifier la saisie.
-- DropIndex
DROP INDEX "TimeEntry_lineId_userId_date_slotId_key";

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_lineId_userId_date_startMinute_key" ON "TimeEntry"("lineId", "userId", "date", "startMinute");
