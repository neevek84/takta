# Pause déjeuner et trajets — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une journée entière porte une pause déjeuner (7 h facturées, 8 h d'agenda, deux blocs), et une saisie chez le client pose une fois pour toutes un trajet avant et après dans l'agenda.

**Architecture :** tout ce qui est figé l'est à l'écriture de la saisie (`entryBounds`, `cellStateToWrite`, `applyCellState`, `saveEntry`). Le drainage de l'agenda (`services/sync/flush.ts`) découpe une saisie avec pause en deux événements suivis séparément, et pose les trajets — lignes de file `entityType = 'Trajet'` — sans jamais les relire. Le calcul des trajets est une fonction pure (`core/saisie/trajets.ts`).

**Tech Stack :** Next.js 15, React 19, Prisma 6 (SQLite en local et en archive portable, Postgres en production), Vitest 4 (happy-dom par fichier pour les composants), zod.

**Spec :** [`docs/superpowers/specs/2026-09-14-pause-dejeuner-et-trajets-design.md`](../specs/2026-09-14-pause-dejeuner-et-trajets-design.md)

## Global Constraints

- `TimeEntry.minutes` reste la durée **facturée**. Aucune tâche ne change ce que lisent le CRA, Dolibarr, la capacité ou l'engagement.
- Aucune saisie existante n'est réécrite : les défauts de colonnes (`pauseDebutMinute = 0`, `pauseFinMinute = 0`, `lieu = 'DISTANCE'`, `trajetsCalcules = false`) décrivent exactement leur réalité.
- Une pause se représente en mémoire par `Pause = { debutMinute, finMinute }`, **absente** quand il n'y en a pas ; en base par deux colonnes égales (0/0) quand il n'y en a pas. La conversion passe toujours par `pauseDepuisColonnes`.
- Lieu : `'SITE' | 'DISTANCE'`, chaîne libre en base (portabilité SQLite/Postgres), jamais un enum Prisma.
- Défauts de réglages : pause 750 → 810 (12 h 30 – 13 h 30), trajet 30 min.
- Trajets : jamais d'`ExternalLink`, jamais de conflit, jamais de mise à jour ni de suppression distante. Couleur Google `'8'` (Graphite).
- Toute évolution de `prisma/schema.prisma` s'accompagne d'une migration **Postgres** (`prisma/migrations/`) **et** **SQLite** (`prisma/migrations-sqlite/`), une colonne par `ALTER TABLE`.
- Textes à l'écran en français, apostrophe typographique `’` dans le JSX, comme le code existant.
- Commentaires : même densité et même ton que le code environnant — on dit *pourquoi*.
- Chaque commit se termine par `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Commandes de test : `npx vitest run <fichier>` ; vérification de types : `npx tsc --noEmit`.

### Correction de la spec, à connaître avant de commencer

La spec attribue le formulaire de case à `saveEntry`. C'est inexact : **le formulaire du calendrier passe par `appliquerCase` → `applyCellState`** avec un état `LIBRE`. `saveEntry` sert la **vue tableau** (`saveCell`). Le plan en tient compte : le formulaire transporte pause et lieu dans l'état `LIBRE` ; `saveEntry` applique la pause d'office à une journée entière saisie au tableau. `fillMonth` passe par `applyCellState` et hérite donc de la pause sans modification.

## Carte des fichiers

| Fichier | Rôle dans ce lot |
|---|---|
| `prisma/schema.prisma` + deux migrations | colonnes et table `Trajet` |
| `src/core/types.ts` | type `Lieu`, `LIEUX`, `LIBELLES_LIEU` |
| `src/core/time/slots.ts` | `Pause`, `pauseMinutes`, `pauseDepuisColonnes`, `entryBounds` avec pause |
| `src/services/settings.ts` + `admin/saisie/*` | réglages pause et durée de trajet |
| `src/services/missions.ts` + `missions/LieuMissionForm.tsx` | lieu par défaut de la mission |
| `src/core/saisie/cycle.ts`, `cell-state.ts` | pause et lieu dans l'état d'une case |
| `src/services/cells.ts`, `time-entries.ts` | écriture de la pause et du lieu |
| `src/components/calendar/CellForm.tsx`, `saisie/[month]/*` | case « Pause déjeuner », choix du lieu |
| `src/core/calendar/event.ts`, `integrations/google/calendar.ts` | segments, événement de trajet, propriétés privées |
| `src/core/sync/policy.ts`, `services/sync/flush.ts`, `conflicts.ts` | deux événements par saisie, drainage des trajets |
| `src/core/saisie/trajets.ts` | calcul pur des trajets |
| `src/services/trajets.ts` | pose des trajets dans la transaction d'écriture |

---

### Task 1 : schéma et migrations

**Files :**
- Modify : `prisma/schema.prisma`
- Create : `prisma/migrations/20260914000000_pause_et_trajets/migration.sql`
- Create : `prisma/migrations-sqlite/20260914000000_pause_et_trajets/migration.sql`
- Test : `src/db/schema-migration-sync.test.ts`, `src/distribution/migrations-sqlite.test.ts` (existants)

**Interfaces :**
- Produces : colonnes `Settings.pauseDebutMinute`, `Settings.pauseFinMinute`, `Settings.dureeTrajetMinutes`, `Mission.lieuDefaut`, `TimeEntry.pauseDebutMinute`, `TimeEntry.pauseFinMinute`, `TimeEntry.lieu`, `TimeEntry.trajetsCalcules` ; modèle `Trajet` ; relation `User.trajets`.

- [ ] **Step 1 : modifier le schéma**

Dans `model User`, après `passwordResets PasswordReset[]` :

```prisma
  trajets        Trajet[]
```

Dans `model Mission`, après `signataireEmail String @default("")` :

```prisma

  /// 'SITE' | 'DISTANCE'. Défaut DISTANCE : aucune mission existante ne se met
  /// à poser des trajets sans qu'on l'ait demandé. Une chaîne et non un enum,
  /// comme `kind` : le schéma reste dans l'intersection SQLite/Postgres.
  lieuDefaut String @default("DISTANCE")
```

Dans `model TimeEntry`, après la colonne `minutesParJour Int @default(480)` :

```prisma
  /// pause incluse dans le bloc, minutes depuis minuit. Égales = aucune pause.
  /// Figées à l'écriture comme les deux bornes : changer le réglage ne déplace
  /// aucune journée saisie. Les défauts à 0 disent « aucune pause », ce qui est
  /// exactement la réalité de toute saisie antérieure à ce lot.
  pauseDebutMinute Int @default(0)
  pauseFinMinute   Int @default(0)
  /// 'SITE' | 'DISTANCE', repris de la mission à l'écriture, modifiable.
  lieu String @default("DISTANCE")
  /// vrai dès que les trajets de cette saisie ont été calculés — une seule fois
  /// dans sa vie : les trajets sont posés, puis l'agenda en fait ce qu'il veut.
  trajetsCalcules Boolean @default(false)
```

Dans `model Settings`, après `journeeFinMinute Int @default(1080)` :

```prisma

  /// début de la pause déjeuner, minutes depuis minuit (12 h 30 -> 750)
  pauseDebutMinute Int @default(750)
  /// fin de la pause déjeuner (13 h 30 -> 810). Égale au début = aucune pause :
  /// pas de booléen à part, qui pourrait contredire les heures.
  pauseFinMinute   Int @default(810)
  /// durée d'un trajet posé dans l'agenda, en minutes. 0 = aucun trajet.
  dureeTrajetMinutes Int @default(30)
```

Après `model PasswordReset { … }` :

```prisma
/// Un trajet que l'application a posé, ou va poser, dans l'agenda. Il ne sert
/// qu'à ne pas en poser deux au même endroit : l'application ne relit jamais
/// l'événement distant, et le porteur le déplace ou le supprime à sa guise.
///
/// Aucune clé étrangère vers `TimeEntry` : le trajet survit à sa saisie, comme
/// il survit dans l'agenda.
model Trajet {
  id          String    @id @default(cuid())
  userId      String
  /// minuit UTC du jour concerné
  date        DateTime
  /// minutes depuis minuit ; un trajet ne franchit jamais minuit, la fin 0
  /// désigne minuit du soir
  startMinute Int
  endMinute   Int
  /// saisie d'origine, pour la trace uniquement
  entryId     String
  /// libellé figé à la pose : « Trajet · Client »
  summary     String
  /// null tant que Google n'a pas confirmé la création
  poseAt      DateTime?
  createdAt   DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, date])
}
```

- [ ] **Step 2 : lancer les gardes-fous de migration, qui doivent échouer**

Run : `npx vitest run src/db/schema-migration-sync.test.ts src/distribution/migrations-sqlite.test.ts`
Expected : FAIL — colonnes `Mission.lieuDefaut`, `TimeEntry.pauseDebutMinute`… et table `Trajet` absentes des migrations.

- [ ] **Step 3 : écrire la migration Postgres**

`prisma/migrations/20260914000000_pause_et_trajets/migration.sql` :

```sql
-- Pause déjeuner et trajets chez le client.
--
-- La pause est figée sur chaque saisie (deux colonnes égales = aucune pause) ;
-- le lieu vient de la mission. Les trajets vivent dans leur propre table, sans
-- clé étrangère vers la saisie : ils lui survivent, comme dans l'agenda.
-- AlterTable
ALTER TABLE "Mission" ADD COLUMN "lieuDefaut" TEXT NOT NULL DEFAULT 'DISTANCE';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "pauseDebutMinute" INTEGER NOT NULL DEFAULT 750;
ALTER TABLE "Settings" ADD COLUMN "pauseFinMinute" INTEGER NOT NULL DEFAULT 810;
ALTER TABLE "Settings" ADD COLUMN "dureeTrajetMinutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "pauseDebutMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TimeEntry" ADD COLUMN "pauseFinMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TimeEntry" ADD COLUMN "lieu" TEXT NOT NULL DEFAULT 'DISTANCE';
ALTER TABLE "TimeEntry" ADD COLUMN "trajetsCalcules" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Trajet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "entryId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "poseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trajet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trajet_userId_date_idx" ON "Trajet"("userId", "date");

-- AddForeignKey
ALTER TABLE "Trajet" ADD CONSTRAINT "Trajet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4 : écrire la migration SQLite**

`prisma/migrations-sqlite/20260914000000_pause_et_trajets/migration.sql` :

```sql
-- Pause déjeuner et trajets chez le client. Pendant SQLite de la migration
-- Postgres du même nom : une colonne par ALTER TABLE, SQLite n'en accepte pas
-- davantage.
-- AlterTable
ALTER TABLE "Mission" ADD COLUMN "lieuDefaut" TEXT NOT NULL DEFAULT 'DISTANCE';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "pauseDebutMinute" INTEGER NOT NULL DEFAULT 750;
ALTER TABLE "Settings" ADD COLUMN "pauseFinMinute" INTEGER NOT NULL DEFAULT 810;
ALTER TABLE "Settings" ADD COLUMN "dureeTrajetMinutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "pauseDebutMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TimeEntry" ADD COLUMN "pauseFinMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TimeEntry" ADD COLUMN "lieu" TEXT NOT NULL DEFAULT 'DISTANCE';
ALTER TABLE "TimeEntry" ADD COLUMN "trajetsCalcules" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Trajet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "entryId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "poseAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Trajet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Trajet_userId_date_idx" ON "Trajet"("userId", "date");
```

- [ ] **Step 5 : régénérer le client et relancer les gardes-fous**

Run : `npx prisma generate && npx vitest run src/db src/distribution/migrations-sqlite.test.ts src/distribution/migrations.test.ts`
Expected : PASS.

- [ ] **Step 6 : commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260914000000_pause_et_trajets prisma/migrations-sqlite/20260914000000_pause_et_trajets
git commit -m "feat(schema): pause figee sur la saisie, lieu de mission, table des trajets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2 : `entryBounds` connaît la pause

**Files :**
- Modify : `src/core/time/slots.ts`
- Test : `src/core/time/slots.test.ts`

**Interfaces :**
- Produces :
  - `export interface Pause { debutMinute: number; finMinute: number }`
  - `export function pauseMinutes(pause: Pause | undefined): number`
  - `export function pauseDepuisColonnes(debutMinute: number, finMinute: number): Pause | undefined`
  - `EntryBoundsArgs.pause?: Pause`
  - `entryBounds(args): { startMinute: number; endMinute: number; pause?: Pause }` — la clé `pause` n'est **présente** que si la pause s'applique.

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter `pauseDepuisColonnes` et `pauseMinutes` à l'import en tête de `slots.test.ts`, puis à la fin du fichier :

```ts
// La pause déjeuner : le temps facturé ne change pas, le bloc s'allonge de la
// pause et la laisse libre au milieu.
describe('entryBounds — pause déjeuner', () => {
  const journee = { journeeDebutMinute: 540, journeeFinMinute: 1080 }
  const DEJEUNER = { debutMinute: 750, finMinute: 810 }

  it('allonge une journée de 7 h de la pause, et la rend', () => {
    expect(entryBounds({ minutes: 420, slot: null, ...journee, pause: DEJEUNER })).toEqual({
      startMinute: 540,
      endMinute: 1020,
      pause: DEJEUNER,
    })
  })

  it('ignore une pause qui tombe hors du bloc', () => {
    // 9 h → 11 h : la pause de 12 h 30 n'a rien à couper.
    expect(entryBounds({ minutes: 120, slot: null, ...journee, pause: DEJEUNER })).toEqual({
      startMinute: 540,
      endMinute: 660,
    })
  })

  it('tronque à la fin de plage sans perdre la pause', () => {
    expect(
      entryBounds({
        minutes: 420,
        slot: null,
        journeeDebutMinute: 540,
        journeeFinMinute: 900,
        pause: DEJEUNER,
      }),
    ).toEqual({ startMinute: 540, endMinute: 900, pause: DEJEUNER })
  })

  it('ne pose jamais la pause sur un créneau nommé', () => {
    const matin: Slot = { id: 'm', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 }
    expect(entryBounds({ minutes: 240, slot: matin, ...journee, pause: DEJEUNER })).toEqual({
      startMinute: 540,
      endMinute: 780,
    })
  })

  it('traite une pause de durée nulle comme aucune pause', () => {
    expect(
      entryBounds({ minutes: 420, slot: null, ...journee, pause: { debutMinute: 750, finMinute: 750 } }),
    ).toEqual({ startMinute: 540, endMinute: 960 })
  })
})

describe('pauseDepuisColonnes', () => {
  it('lit deux colonnes égales comme aucune pause', () => {
    expect(pauseDepuisColonnes(0, 0)).toBeUndefined()
    expect(pauseDepuisColonnes(750, 750)).toBeUndefined()
  })

  it('rend la pause quand la fin suit le début', () => {
    expect(pauseDepuisColonnes(750, 810)).toEqual({ debutMinute: 750, finMinute: 810 })
  })
})

describe('pauseMinutes', () => {
  it('vaut 0 sans pause et la durée sinon', () => {
    expect(pauseMinutes(undefined)).toBe(0)
    expect(pauseMinutes({ debutMinute: 750, finMinute: 810 })).toBe(60)
  })
})
```

- [ ] **Step 2 : vérifier l'échec**

Run : `npx vitest run src/core/time/slots.test.ts`
Expected : FAIL — `pauseDepuisColonnes is not a function`, et `endMinute` 960 au lieu de 1020.

- [ ] **Step 3 : implémenter**

Dans `src/core/time/slots.ts`, après `slotDurationMinutes` :

```ts
/**
 * Une pause incluse dans un bloc, en minutes depuis minuit.
 *
 * Elle ne franchit jamais minuit, et un bloc de nuit n'en porte pas : la pause
 * déjeuner est la seule qu'on connaisse, et elle tombe en pleine journée.
 */
export interface Pause {
  debutMinute: number
  finMinute: number
}

/** Durée d'une pause, en minutes ; 0 quand il n'y en a pas. */
export function pauseMinutes(pause: Pause | undefined): number {
  return pause === undefined ? 0 : Math.max(0, pause.finMinute - pause.debutMinute)
}

/**
 * Relit la pause portée par deux colonnes — celles d'une saisie ou des
 * réglages. Deux bornes égales disent « aucune pause » : c'est ce que vaut
 * toute saisie antérieure à la pause, écrite à 0 et 0.
 */
export function pauseDepuisColonnes(debutMinute: number, finMinute: number): Pause | undefined {
  return finMinute > debutMinute ? { debutMinute, finMinute } : undefined
}
```

Ajouter à `EntryBoundsArgs`, après `journeeFinMinute` :

```ts
  /**
   * pause déjeuner à inclure dans une journée sans créneau. Absente, aucune.
   * C'est l'appelant qui décide qu'une saisie est une journée entière : ce
   * calcul ne fait que placer la pause quand on la lui donne.
   */
  pause?: Pause
```

Remplacer le corps et la signature de retour d'`entryBounds` par :

```ts
export function entryBounds(args: EntryBoundsArgs): {
  startMinute: number
  endMinute: number
  /** présente seulement si la pause tombe réellement dans le bloc */
  pause?: Pause
} {
  if (args.slot !== null) {
    return { startMinute: args.slot.startMinute, endMinute: args.slot.endMinute }
  }

  const debut = args.journeeDebutMinute
  const plage = Math.max(0, args.journeeFinMinute - debut)

  // La pause s'ajoute au temps saisi, elle ne le remplace pas : 7 h facturées
  // occupent 8 h d'agenda. Elle ne s'applique que si elle tombe strictement
  // dans le bloc ainsi allongé — une matinée de deux heures n'a rien à couper.
  const duree = pauseMinutes(args.pause)
  if (args.pause !== undefined && duree > 0) {
    const finAvecPause = debut + args.minutes + duree
    const fin = Math.min(finAvecPause, args.journeeFinMinute)
    if (args.pause.debutMinute > debut && args.pause.finMinute < fin) {
      return { startMinute: debut, endMinute: fin % MINUTES_PER_DAY, pause: { ...args.pause } }
    }
  }

  const fin = debut + Math.min(args.minutes, plage)
  // Minuit se note 0, jamais 1440 : les deux bornes vivent dans la même plage
  // 0-1439 que celles d'un créneau, et `minutesBetween` retrouve la durée.
  return { startMinute: debut, endMinute: fin % MINUTES_PER_DAY }
}
```

(Garder le commentaire de documentation existant au-dessus d'`entryBounds`, en ajoutant à sa fin : « Une pause donnée allonge le bloc d'autant, jamais au-delà de la plage. »)

- [ ] **Step 4 : vérifier**

Run : `npx vitest run src/core/time/slots.test.ts src/core/saisie/cell-state.test.ts src/core/calendar/event.test.ts`
Expected : PASS (les appelants existants ne passent pas de pause, leurs résultats sont inchangés).

- [ ] **Step 5 : commit**

```bash
git add src/core/time/slots.ts src/core/time/slots.test.ts
git commit -m "feat(temps): entryBounds allonge une journee de sa pause dejeuner

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3 : réglages — pause déjeuner et durée de trajet

**Files :**
- Modify : `src/services/settings.ts`
- Modify : `src/app/(app)/admin/saisie/actions.ts`
- Modify : `src/app/(app)/admin/saisie/SettingsForm.tsx`
- Test : `src/services/settings.test.ts`, `src/app/(app)/admin/saisie/actions.test.ts`, `src/app/(app)/admin/saisie/SettingsForm.test.tsx`

**Interfaces :**
- Produces : `AppSettings.pauseDebutMinute: number`, `AppSettings.pauseFinMinute: number`, `AppSettings.dureeTrajetMinutes: number`, acceptés par `updateSettings` et `validateSettingsPatch`. Champs de formulaire `pauseDebut`, `pauseFin` (heure, vides = aucune pause), `dureeTrajet` (minutes).

- [ ] **Step 1 : tests du service, qui échouent**

À la fin de `src/services/settings.test.ts` :

```ts
describe('pause déjeuner et trajets', () => {
  beforeEach(async () => {
    await prisma.settings.deleteMany({})
  })

  it('part de 12 h 30 – 13 h 30 et de trajets de 30 minutes', async () => {
    const s = await getSettings()
    expect([s.pauseDebutMinute, s.pauseFinMinute, s.dureeTrajetMinutes]).toEqual([750, 810, 30])
  })

  it('enregistre une autre pause et une autre durée de trajet', async () => {
    const s = await updateSettings({ pauseDebutMinute: 720, pauseFinMinute: 765, dureeTrajetMinutes: 45 })
    expect([s.pauseDebutMinute, s.pauseFinMinute, s.dureeTrajetMinutes]).toEqual([720, 765, 45])
  })

  it('accepte une pause désactivée, début égal à la fin', () => {
    expect(validateSettingsPatch({ pauseDebutMinute: 0, pauseFinMinute: 0 }).ok).toBe(true)
  })

  it('refuse une pause dont la fin précède le début', () => {
    expect(validateSettingsPatch({ pauseDebutMinute: 810, pauseFinMinute: 750 })).toEqual({
      ok: false,
      errors: ['La fin de la pause déjeuner doit suivre son début.'],
    })
  })

  it('refuse une pause qui sort de la plage journée', () => {
    expect(
      validateSettingsPatch({
        journeeDebutMinute: 540,
        journeeFinMinute: 1080,
        pauseDebutMinute: 480,
        pauseFinMinute: 600,
      }),
    ).toEqual({ ok: false, errors: ['La pause déjeuner doit tomber à l’intérieur de la plage journée.'] })
  })

  it('refuse une durée de trajet négative ou supérieure à 4 heures', () => {
    expect(validateSettingsPatch({ dureeTrajetMinutes: -5 }).ok).toBe(false)
    expect(validateSettingsPatch({ dureeTrajetMinutes: 241 }).ok).toBe(false)
  })
})
```

Si `beforeEach` n'est pas importé depuis `vitest` dans ce fichier, l'ajouter à l'import existant.

Run : `npx vitest run src/services/settings.test.ts`
Expected : FAIL — `pauseDebutMinute` indéfini.

- [ ] **Step 2 : implémenter dans le service**

Dans `settingsPatchSchema` (objet zod), après `journeeFinMinute` :

```ts
    pauseDebutMinute: z
      .number({ message: 'Le début de la pause déjeuner est requis.' })
      .int('Le début de la pause déjeuner doit être un nombre entier de minutes.')
      .min(0, 'Le début de la pause déjeuner est invalide.')
      .max(1439, 'Le début de la pause déjeuner est invalide.'),
    pauseFinMinute: z
      .number({ message: 'La fin de la pause déjeuner est requise.' })
      .int('La fin de la pause déjeuner doit être un nombre entier de minutes.')
      .min(0, 'La fin de la pause déjeuner est invalide.')
      .max(1439, 'La fin de la pause déjeuner est invalide.'),
    // Au-delà de quatre heures, ce n'est plus un trajet mais un déplacement,
    // qui se saisit comme tel. 0 désactive la pose des trajets.
    dureeTrajetMinutes: z
      .number({ message: 'La durée de trajet est requise.' })
      .int('La durée de trajet doit être un nombre entier de minutes.')
      .min(0, 'La durée de trajet ne peut pas être négative.')
      .max(240, 'La durée de trajet ne peut pas dépasser 4 heures.'),
```

Dans le `superRefine` final, après la vérification de la plage journée :

```ts
    // Deux bornes égales désactivent la pause : rien à vérifier alors. Sinon,
    // la pause suit son début et tombe dans la plage — sans quoi `entryBounds`
    // ne l'appliquerait jamais, et le réglage serait décoratif.
    const { pauseDebutMinute: pd, pauseFinMinute: pf } = patch
    if (pd !== undefined && pf !== undefined && pd !== pf) {
      if (pf < pd) {
        ctx.addIssue({ code: 'custom', message: 'La fin de la pause déjeuner doit suivre son début.' })
      } else if (
        patch.journeeDebutMinute !== undefined &&
        patch.journeeFinMinute !== undefined &&
        (pd <= patch.journeeDebutMinute || pf >= patch.journeeFinMinute)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'La pause déjeuner doit tomber à l’intérieur de la plage journée.',
        })
      }
    }
```

Dans `interface AppSettings`, après `journeeFinMinute` :

```ts
  /** début de la pause déjeuner, minutes depuis minuit */
  pauseDebutMinute: number
  /** fin de la pause déjeuner ; égale au début = aucune pause */
  pauseFinMinute: number
  /** durée d'un trajet posé dans l'agenda, en minutes. 0 = aucun trajet. */
  dureeTrajetMinutes: number
```

Dans `toAppSettings`, après `journeeFinMinute: row.journeeFinMinute,` :

```ts
    pauseDebutMinute: row.pauseDebutMinute,
    pauseFinMinute: row.pauseFinMinute,
    dureeTrajetMinutes: row.dureeTrajetMinutes,
```

Dans `updateSettings`, dans `data`, après la ligne `journeeFinMinute` :

```ts
      ...(patch.pauseDebutMinute !== undefined && { pauseDebutMinute: patch.pauseDebutMinute }),
      ...(patch.pauseFinMinute !== undefined && { pauseFinMinute: patch.pauseFinMinute }),
      ...(patch.dureeTrajetMinutes !== undefined && {
        dureeTrajetMinutes: patch.dureeTrajetMinutes,
      }),
```

Run : `npx vitest run src/services/settings.test.ts`
Expected : PASS.

- [ ] **Step 3 : tests de l'action, qui échouent**

Dans `src/app/(app)/admin/saisie/actions.test.ts`, ajouter aux champs par défaut du helper `formulaire` (après `journeeFin: '18:00',`) :

```ts
    pauseDebut: '12:30',
    pauseFin: '13:30',
    dureeTrajet: '30',
```

Puis à la fin du fichier :

```ts
describe('saveSettings — pause déjeuner et trajets', () => {
  it('transcrit la pause et la durée de trajet', async () => {
    await saveSettings(null, formulaire({ pauseDebut: '12:00', pauseFin: '12:45', dureeTrajet: '20' }))
    const patch = updateSettings.mock.calls[0]![0] as Record<string, unknown>
    expect([patch.pauseDebutMinute, patch.pauseFinMinute, patch.dureeTrajetMinutes]).toEqual([
      720, 765, 20,
    ])
  })

  it('lit deux heures de pause vides comme aucune pause', async () => {
    await saveSettings(null, formulaire({ pauseDebut: '', pauseFin: '' }))
    const patch = updateSettings.mock.calls[0]![0] as Record<string, unknown>
    expect([patch.pauseDebutMinute, patch.pauseFinMinute]).toEqual([0, 0])
  })
})
```

Run : `npx vitest run "src/app/(app)/admin/saisie/actions.test.ts"`
Expected : FAIL.

- [ ] **Step 4 : implémenter l'action**

Dans `actions.ts`, après la fonction locale `timeInputToMinutes` :

```ts
/**
 * Une heure de pause laissée vide vaut 0. Les deux vides donnent 0 et 0,
 * c'est-à-dire « aucune pause » ; une seule vide donne une pause que le
 * service refusera, en français — jamais un réglage à moitié écrit.
 */
function pauseChamp(value: FormDataEntryValue | null): number {
  const brut = String(value ?? '')
  return brut === '' ? 0 : timeInputToMinutes(brut)
}
```

Dans l'appel `updateSettings({ … })` de `saveSettings`, après `journeeFinMinute` :

```ts
      pauseDebutMinute: pauseChamp(formData.get('pauseDebut')),
      pauseFinMinute: pauseChamp(formData.get('pauseFin')),
      dureeTrajetMinutes: Number(formData.get('dureeTrajet')),
```

Run : `npx vitest run "src/app/(app)/admin/saisie/actions.test.ts"`
Expected : PASS.

- [ ] **Step 5 : test du formulaire, qui échoue**

Dans `SettingsForm.test.tsx`, ajouter à la constante `REGLAGES`, après `journeeFinMinute: 1080,` :

```ts
  pauseDebutMinute: 750,
  pauseFinMinute: 810,
  dureeTrajetMinutes: 30,
```

Puis à la fin du fichier :

```ts
describe('SettingsForm — pause déjeuner et trajets', () => {
  it('affiche la pause et la durée de trajet enregistrées', () => {
    rendre({ pauseDebutMinute: 720, pauseFinMinute: 780, dureeTrajetMinutes: 45 })
    expect(screen.getByLabelText('Début de la pause')).toHaveProperty('value', '12:00')
    expect(screen.getByLabelText('Fin de la pause')).toHaveProperty('value', '13:00')
    expect(screen.getByLabelText('Durée d’un trajet (min)')).toHaveProperty('value', '45')
  })

  it('laisse les heures vides quand aucune pause n’est réglée', () => {
    rendre({ pauseDebutMinute: 0, pauseFinMinute: 0 })
    expect(screen.getByLabelText('Début de la pause')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Fin de la pause')).toHaveProperty('value', '')
  })
})
```

Run : `npx vitest run "src/app/(app)/admin/saisie/SettingsForm.test.tsx"`
Expected : FAIL — libellé « Début de la pause » introuvable.

- [ ] **Step 6 : implémenter le formulaire**

Dans `SettingsForm.tsx`, juste après la `<Card>` « Plage journée » :

```tsx
      <Card>
        <fieldset>
          <legend className="mb-2 font-medium">Pause déjeuner et trajets</legend>
          <p className="mb-2 text-sm text-muted">
            Une journée entière reçoit la pause d’office : le temps facturé ne change pas, le bloc
            d’agenda s’allonge d’autant et laisse la pause libre. Laissez les deux heures vides
            pour ne poser aucune pause.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Début de la pause"
              name="pauseDebut"
              type="time"
              defaultValue={
                settings.pauseFinMinute > settings.pauseDebutMinute
                  ? minutesToTimeInput(settings.pauseDebutMinute)
                  : ''
              }
            />
            <Field
              label="Fin de la pause"
              name="pauseFin"
              type="time"
              defaultValue={
                settings.pauseFinMinute > settings.pauseDebutMinute
                  ? minutesToTimeInput(settings.pauseFinMinute)
                  : ''
              }
            />
            <Field
              label="Durée d’un trajet (min)"
              name="dureeTrajet"
              type="number"
              min="0"
              max="240"
              step="5"
              required
              defaultValue={settings.dureeTrajetMinutes}
              hint="Posé avant et après une saisie chez le client. 0 = aucun trajet."
            />
          </div>
        </fieldset>
      </Card>
```

Run : `npx vitest run "src/app/(app)/admin/saisie"`
Expected : PASS.

- [ ] **Step 7 : commit**

```bash
git add src/services/settings.ts src/services/settings.test.ts "src/app/(app)/admin/saisie"
git commit -m "feat(reglages): pause dejeuner et duree de trajet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4 : le lieu d'une mission

**Files :**
- Modify : `src/core/types.ts`
- Modify : `src/services/missions.ts`
- Modify : `src/app/(app)/missions/actions.ts`
- Create : `src/app/(app)/missions/LieuMissionForm.tsx`
- Modify : `src/app/(app)/missions/MissionsExplorer.tsx`
- Test : `src/services/missions.test.ts`, `src/app/(app)/missions/LieuMissionForm.test.tsx` (nouveau), et tout fichier de test qui construit un `LineForGrid` littéral

**Interfaces :**
- Produces :
  - `export type Lieu = 'SITE' | 'DISTANCE'`, `export const LIEUX: readonly Lieu[]`, `export const LIBELLES_LIEU: Record<Lieu, string>` dans `core/types.ts`
  - `LineForGrid.lieuDefaut: Lieu`, `MissionForUser.lieuDefaut: Lieu`
  - `createMission({ …, lieuDefaut?: Lieu })`
  - `export type LieuResult = { ok: true } | { ok: false; erreur: string }`
  - `export async function updateMissionLieu(userId: string, missionId: string, lieu: string): Promise<LieuResult>`
  - action `saveLieuMission(_prev: LieuMissionState, formData: FormData): Promise<LieuMissionState>` avec `export type LieuMissionState = LieuResult | null`

- [ ] **Step 1 : tests du service, qui échouent**

Ajouter `updateMissionLieu` et `listActiveLines` à l'import depuis `'./missions'` de `src/services/missions.test.ts` (s'ils n'y sont pas), puis à la fin du fichier :

```ts
describe('lieu par défaut d une mission', () => {
  let lieuUser = ''
  let intrus = ''
  let missionLieu = ''

  beforeAll(async () => {
    lieuUser = (
      await prisma.user.create({ data: { email: 'lieu@test.local', name: 'L', passwordHash: 'x' } })
    ).id
    intrus = (
      await prisma.user.create({ data: { email: 'lieu-intrus@test.local', name: 'I', passwordHash: 'x' } })
    ).id
    const c = await createClient('LIEU client')
    missionLieu = (await createMission({ clientId: c.id, label: 'Sur site' })).id
    await createLine({ missionId: missionLieu, userId: lieuUser, label: 'Conseil', soldCentiemes: 1000, tjmCents: 0 })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: ['lieu@test.local', 'lieu-intrus@test.local'] } } })
    await prisma.client.deleteMany({ where: { name: 'LIEU client' } })
  })

  it('crée une mission à distance par défaut', async () => {
    const lignes = await listActiveLines(lieuUser)
    expect(lignes.find((l) => l.missionLabel === 'Sur site')?.lieuDefaut).toBe('DISTANCE')
  })

  it('passe la mission chez le client, et la grille le voit', async () => {
    expect(await updateMissionLieu(lieuUser, missionLieu, 'SITE')).toEqual({ ok: true })
    const lignes = await listActiveLines(lieuUser)
    expect(lignes.find((l) => l.missionLabel === 'Sur site')?.lieuDefaut).toBe('SITE')
  })

  it('refuse un lieu inconnu', async () => {
    expect(await updateMissionLieu(lieuUser, missionLieu, 'LUNE')).toEqual({
      ok: false,
      erreur: 'Lieu inconnu.',
    })
  })

  it('refuse une mission qui n est pas affectée', async () => {
    expect(await updateMissionLieu(intrus, missionLieu, 'DISTANCE')).toEqual({
      ok: false,
      erreur: 'Cette mission ne vous est pas affectée.',
    })
  })
})
```

Run : `npx vitest run src/services/missions.test.ts`
Expected : FAIL — `updateMissionLieu is not a function`.

- [ ] **Step 2 : implémenter le type et le service**

À la fin de `src/core/types.ts` :

```ts
/**
 * Où la prestation se déroule. Chez le client, l'agenda reçoit un trajet avant
 * et après la saisie ; à distance, rien.
 */
export type Lieu = 'SITE' | 'DISTANCE'
export const LIEUX: readonly Lieu[] = ['SITE', 'DISTANCE']
export const LIBELLES_LIEU: Record<Lieu, string> = {
  SITE: 'Chez le client',
  DISTANCE: 'À distance',
}
```

Dans `src/services/missions.ts` :

- remplacer `import type { DisplayUnit, EngagementSource } from '@/core/types'` par :

```ts
import { LIEUX } from '@/core/types'
import type { DisplayUnit, EngagementSource, Lieu } from '@/core/types'
```

- `interface LineForGrid` : ajouter après `allowedSlotIds: string[]` :

```ts
  /** lieu par défaut de la mission ; une saisie en hérite, et peut le changer */
  lieuDefaut: Lieu
```

- `createMission` : ajouter à ses arguments `lieuDefaut?: Lieu` (après `signataireEmail?: string`) et à `data` : `lieuDefaut: args.lieuDefaut ?? 'DISTANCE',`.
- `interface MissionForUser` : ajouter après `signataireEmail: string` :

```ts
  /** lieu par défaut des saisies de cette mission */
  lieuDefaut: Lieu
```

- `listMissionsForUser`, dans l'objet rendu, après `signataireEmail: m.signataireEmail,` : `lieuDefaut: m.lieuDefaut as Lieu,`
- `listActiveLines`, dans l'objet rendu, après `allowedSlotIds: …,` : `lieuDefaut: a.line.mission.lieuDefaut as Lieu,`
- après `updateMissionSignataire` :

```ts
export type LieuResult = { ok: true } | { ok: false; erreur: string }

/**
 * Change le lieu par défaut d'une mission. Les saisies déjà écrites gardent le
 * leur : le lieu se fige à l'écriture, comme les heures.
 *
 * Scopé par affectation, comme le signataire.
 */
export async function updateMissionLieu(
  userId: string,
  missionId: string,
  lieu: string,
): Promise<LieuResult> {
  if (!(LIEUX as readonly string[]).includes(lieu)) return { ok: false, erreur: 'Lieu inconnu.' }

  const mission = await prisma.mission.findFirst({
    where: { id: missionId, lines: { some: { assignments: { some: { userId } } } } },
    select: { id: true },
  })
  if (mission === null) {
    return { ok: false, erreur: 'Cette mission ne vous est pas affectée.' }
  }

  await prisma.mission.update({ where: { id: missionId }, data: { lieuDefaut: lieu } })
  return { ok: true }
}
```

Run : `npx vitest run src/services/missions.test.ts`
Expected : PASS.

- [ ] **Step 3 : compléter les `LineForGrid` littéraux des tests**

Run : `grep -rln "allowedSlotIds: \[" src --include="*.test.ts" --include="*.test.tsx"`

Dans chaque fichier listé, ajouter `lieuDefaut: 'DISTANCE',` à chaque objet littéral typé `LineForGrid` (repérable à `soldCentiemes` et `allowedSlotIds` côte à côte). Aucun comportement ne change : c'est le seul défaut qu'une ligne existante peut avoir.

- [ ] **Step 4 : test du formulaire de mission, qui échoue**

Créer `src/app/(app)/missions/LieuMissionForm.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { saveLieuMission } = vi.hoisted(() => ({ saveLieuMission: vi.fn() }))
vi.mock('./actions', () => ({ saveLieuMission }))

import { LieuMissionForm } from './LieuMissionForm'

beforeEach(() => {
  saveLieuMission.mockReset().mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('LieuMissionForm', () => {
  it('affiche le lieu enregistré', () => {
    render(<LieuMissionForm missionId="m1" lieuDefaut="SITE" />)
    expect(screen.getByLabelText('Lieu par défaut')).toHaveProperty('value', 'SITE')
  })

  it('transporte la mission et le lieu choisi', async () => {
    render(<LieuMissionForm missionId="m1" lieuDefaut="DISTANCE" />)
    fireEvent.change(screen.getByLabelText('Lieu par défaut'), { target: { value: 'SITE' } })
    fireEvent.submit(document.querySelector('form')!)

    await waitFor(() => expect(saveLieuMission).toHaveBeenCalledTimes(1))
    const formData = saveLieuMission.mock.calls[0]![1] as FormData
    expect([formData.get('missionId'), formData.get('lieuDefaut')]).toEqual(['m1', 'SITE'])
  })

  it('dit ce que le lieu change dans l agenda', () => {
    render(<LieuMissionForm missionId="m1" lieuDefaut="SITE" />)
    expect(screen.getByText(/trajet/)).toBeTruthy()
  })
})
```

Run : `npx vitest run "src/app/(app)/missions/LieuMissionForm.test.tsx"`
Expected : FAIL — module introuvable.

- [ ] **Step 5 : implémenter l'action, le composant et son emplacement**

Dans `src/app/(app)/missions/actions.ts`, ajouter `updateMissionLieu` et `type LieuResult` à l'import existant depuis `'@/services/missions'`, puis après `saveSignataire` :

```ts
/** `null` = rien n'a encore été soumis. */
export type LieuMissionState = LieuResult | null

/** Enregistre le lieu par défaut d'une mission, et rend son verdict. */
export async function saveLieuMission(
  _prevState: LieuMissionState,
  formData: FormData,
): Promise<LieuMissionState> {
  const user = await requireUser()

  const resultat = await updateMissionLieu(
    user.id,
    String(formData.get('missionId')),
    String(formData.get('lieuDefaut') ?? ''),
  )
  if (!resultat.ok) return resultat

  revalidatePath('/missions')
  // La grille de saisie lit le lieu par défaut pour pré-remplir le formulaire.
  revalidatePath('/saisie', 'layout')
  return resultat
}
```

Créer `src/app/(app)/missions/LieuMissionForm.tsx` :

```tsx
'use client'

import { useActionState } from 'react'
import { saveLieuMission, type LieuMissionState } from './actions'
import { LIBELLES_LIEU, LIEUX, type Lieu } from '@/core/types'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'

/**
 * Le lieu par défaut d'une **mission** : chez le client ou à distance.
 *
 * Il ne décide que du pré-remplissage : chaque saisie en hérite et peut le
 * changer. Ce qu'il déclenche se dit ici, pas seulement dans le formulaire de
 * saisie — sinon on découvrirait les trajets dans l'agenda.
 */
export function LieuMissionForm({ missionId, lieuDefaut }: { missionId: string; lieuDefaut: Lieu }) {
  const [state, formAction, pending] = useActionState<LieuMissionState, FormData>(
    saveLieuMission,
    null,
  )

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="missionId" value={missionId} />
      <p className="text-sm text-muted">
        Chez le client, chaque nouvelle saisie pose un trajet avant et après dans l’agenda, une
        seule fois. Vous pourrez ensuite le déplacer ou le supprimer là-bas.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Lieu par défaut" name="lieuDefaut" defaultValue={lieuDefaut} className="w-52">
          {LIEUX.map((l) => (
            <option key={l} value={l}>
              {LIBELLES_LIEU[l]}
            </option>
          ))}
        </Select>
        <Button type="submit" loading={pending}>
          Enregistrer le lieu
        </Button>
      </div>

      {state !== null && !state.ok && (
        <Banner tone="danger" title="Lieu non enregistré">
          {state.erreur}
        </Banner>
      )}
      {state?.ok === true && <Banner tone="success">Lieu enregistré.</Banner>}
    </form>
  )
}
```

Dans `MissionsExplorer.tsx`, ajouter `import { LieuMissionForm } from './LieuMissionForm'` après l'import de `SignataireForm`, puis juste après le bloc `<details>` « Signataire du CRA » :

```tsx
      <details className="group rounded-lg border border-rule bg-surface [&::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
          Lieu
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            ▸
          </span>
        </summary>
        <div className="px-4 pb-4 [&>form]:mt-0">
          <LieuMissionForm missionId={mission.id} lieuDefaut={mission.lieuDefaut} />
        </div>
      </details>
```

Si un test de `MissionsExplorer.test.tsx` construit un `MissionForUser` littéral, y ajouter `lieuDefaut: 'DISTANCE',`.

Run : `npx vitest run "src/app/(app)/missions" src/services/missions.test.ts`
Expected : PASS.

- [ ] **Step 6 : commit**

```bash
git add src/core/types.ts src/services/missions.ts src/services/missions.test.ts "src/app/(app)/missions" $(git diff --name-only -- '*.test.ts' '*.test.tsx')
git commit -m "feat(missions): lieu par defaut, chez le client ou a distance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5 : la pause et le lieu dans l'état d'une case

**Files :**
- Modify : `src/core/saisie/cycle.ts`
- Modify : `src/core/saisie/cell-state.ts`
- Modify : `src/services/time-entries.ts` (type `MonthEntry` et `versMonthEntry` seulement)
- Test : `src/core/saisie/cell-state.test.ts`

**Interfaces :**
- Consumes : `Pause`, `pauseDepuisColonnes` (Task 2) ; `Lieu` (Task 4).
- Produces :
  - `BornesFigees.pause?: Pause`
  - `CellState` : `JOURNEE` et `DEMI` gagnent `lieu?: Lieu` ; `LIBRE` gagne `pause?: Pause` et `lieu?: Lieu`
  - `CellEntry.pause?: Pause`, `CellEntry.lieu?: Lieu`
  - `CellContext.pause?: Pause` — la pause des réglages, appliquée d'office aux journées entières
  - `MonthEntry.pause?: Pause`, `MonthEntry.lieu: Lieu`
  - Convention : les clés `pause` et `lieu` sont **omises** quand elles n'ont rien à dire (conditional spread), pour que les objets sans pause restent identiques à ceux d'aujourd'hui.

- [ ] **Step 1 : tests qui échouent**

À la fin de `src/core/saisie/cell-state.test.ts` :

```ts
describe('pause déjeuner et lieu', () => {
  const DEJEUNER = { debutMinute: 750, finMinute: 810 }

  it('lit la pause et le lieu d une journée entière', () => {
    const journee: CellEntry = { ...saisie(480, '', 540, 1080), pause: DEJEUNER, lieu: 'SITE' }
    expect(readCellState([journee], CTX)).toEqual({
      kind: 'JOURNEE',
      bornes: { startMinute: 540, endMinute: 1080, pause: DEJEUNER },
      lieu: 'SITE',
    })
  })

  it('lit la pause et le lieu d une valeur libre', () => {
    const libre: CellEntry = { ...saisie(360, '', 480, 900), pause: DEJEUNER, lieu: 'SITE' }
    expect(readCellState([libre], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 360,
      slotId: '',
      startMinute: 480,
      endMinute: 900,
      eclatee: false,
      pause: DEJEUNER,
      lieu: 'SITE',
    })
  })

  it('pose la pause des réglages sur une journée entière', () => {
    expect(cellStateToWrite({ kind: 'JOURNEE' }, { ...CTX, pause: DEJEUNER })).toEqual([
      { ...saisie(480, '', 540, 1080), pause: DEJEUNER },
    ])
  })

  it('ne pose jamais la pause des réglages sur une demi-journée', () => {
    const [matin] = cellStateToWrite({ kind: 'DEMI', slotId: 'matin' }, { ...CTX, pause: DEJEUNER })
    expect(matin?.pause).toBeUndefined()
  })

  it('écrit la pause et le lieu qu une valeur libre porte', () => {
    const [libre] = cellStateToWrite(
      {
        kind: 'LIBRE',
        minutes: 360,
        slotId: '',
        startMinute: 480,
        endMinute: 900,
        eclatee: false,
        pause: DEJEUNER,
        lieu: 'SITE',
      },
      CTX,
    )
    expect(libre).toEqual({ ...saisie(360, '', 480, 900), pause: DEJEUNER, lieu: 'SITE' })
  })

  it('reporte la pause et le lieu jusqu à l état de la case', () => {
    const etats = buildCellStates(
      [{ ...saisie(480, '', 540, 1080), pause: DEJEUNER, lieu: 'SITE', date: '2026-03-10', lineId: 'l1' }],
      'l1',
      { slots: SLOTS },
    )
    expect(etats.get('2026-03-10')).toEqual({
      kind: 'JOURNEE',
      bornes: { startMinute: 540, endMinute: 1080, pause: DEJEUNER },
      lieu: 'SITE',
    })
  })
})
```

Run : `npx vitest run src/core/saisie/cell-state.test.ts`
Expected : FAIL — `pause` et `lieu` absents.

- [ ] **Step 2 : implémenter les types de l'état**

Dans `src/core/saisie/cycle.ts`, remplacer `import type { Slot } from '../time/slots'` par `import type { Pause, Slot } from '../time/slots'` et `import type { DisplayUnit } from '../types'` par `import type { DisplayUnit, Lieu } from '../types'`.

`interface BornesFigees`, après `endMinute` :

```ts
  /** pause incluse dans le bloc, figée elle aussi ; absente = aucune */
  pause?: Pause
```

Remplacer `type CellState` par :

```ts
export type CellState =
  | { kind: 'VIDE' }
  | { kind: 'JOURNEE'; bornes?: BornesFigees; lieu?: Lieu }
  | { kind: 'DEMI'; slotId: string; bornes?: BornesFigees; lieu?: Lieu }
  | {
      kind: 'LIBRE'
      minutes: number
      /** '' = journée entière. Trace du créneau nommé, jamais une identité. */
      slotId: string
      /**
       * début du bloc, minutes depuis minuit. Le formulaire demande un début
       * et une fin ; la durée en découle.
       */
      startMinute: number
      /**
       * fin du bloc, minutes depuis minuit. Une fin antérieure au début n'est
       * pas une erreur de saisie : le bloc franchit minuit.
       */
      endMinute: number
      /** vrai quand la case agrège plusieurs saisies */
      eclatee: boolean
      /** pause incluse dans le bloc ; absente = aucune */
      pause?: Pause
      /** lieu que la saisie porte ou que le formulaire choisit */
      lieu?: Lieu
    }
```

Ajouter au commentaire du type : « `lieu`, comme `bornes`, n'existe que sur ce que la lecture ou le formulaire produit : la cinématique ne le connaît pas, et l'écriture reprend alors celui de la saisie existante ou de la mission. »

- [ ] **Step 3 : implémenter la lecture et l'écriture**

Dans `src/core/saisie/cell-state.ts` :

- imports : `import type { Pause, Slot } from '../time/slots'` et `import type { Lieu } from '../types'`.
- `interface CellEntry`, après `minutesParJour` :

```ts
  /** pause incluse dans le bloc, figée à l'écriture ; absente = aucune */
  pause?: Pause
  /** lieu figé à l'écriture ; absent = celui que l'écrivain décidera */
  lieu?: Lieu
```

- `interface CellContext`, après `journeeFinMinute` :

```ts
  /**
   * pause déjeuner des réglages, posée d'office sur une **journée entière** —
   * jamais sur un créneau nommé. Absente, aucune pause.
   */
  pause?: Pause
```

- dans `readCellState`, branche `utiles.length === 1`, remplacer la construction de `bornes` et les trois `return` par :

```ts
    const bornes = {
      startMinute: seule.startMinute,
      endMinute: seule.endMinute,
      ...(seule.pause !== undefined && { pause: seule.pause }),
    }
    const lieu = seule.lieu !== undefined ? { lieu: seule.lieu } : {}
    if (seule.slotId === '' && seule.minutes === seule.minutesParJour) {
      return { kind: 'JOURNEE', bornes, ...lieu }
    }

    const slot = ctx.slots.find((s) => s.id === seule.slotId)
    if (
      slot !== undefined &&
      seule.minutes === centiemesToMinutes(slot.centiemes, seule.minutesParJour)
    ) {
      return { kind: 'DEMI', slotId: slot.id, bornes, ...lieu }
    }

    return {
      kind: 'LIBRE',
      minutes: seule.minutes,
      slotId: seule.slotId,
      startMinute: seule.startMinute,
      endMinute: seule.endMinute,
      eclatee: false,
      ...(seule.pause !== undefined && { pause: seule.pause }),
      ...lieu,
    }
```

(Garder les commentaires existants à leur place. La journée éclatée ne porte ni pause ni lieu : le formulaire la remplace par une seule saisie, que la personne décrit à nouveau.)

- dans `cellStateToWrite`, remplacer le helper `bornes` par :

```ts
  const bornes = (minutes: number, slot: Slot | null, pause?: Pause) =>
    entryBounds({
      minutes,
      slot,
      journeeDebutMinute: ctx.journeeDebutMinute,
      journeeFinMinute: ctx.journeeFinMinute,
      ...(pause !== undefined && { pause }),
    })
```

  - branche `JOURNEE` : `...bornes(ctx.minutesParJour, null, ctx.pause),` puis, après `minutesParJour,`, `...(state.lieu !== undefined && { lieu: state.lieu }),`
  - branche `DEMI` : ajouter `...(state.lieu !== undefined && { lieu: state.lieu })` à l'objet rendu.
  - branche `LIBRE` : ajouter après `minutesParJour,` :

```ts
          ...(state.pause !== undefined && { pause: state.pause }),
          ...(state.lieu !== undefined && { lieu: state.lieu }),
```

- dans `buildCellStates`, dans l'objet `entree`, après `minutesParJour: e.minutesParJour,` :

```ts
      ...(e.pause !== undefined && { pause: e.pause }),
      ...(e.lieu !== undefined && { lieu: e.lieu }),
```

- [ ] **Step 4 : `MonthEntry` transporte la pause et le lieu**

Dans `src/services/time-entries.ts` :

- imports : `import { entryBounds, pauseDepuisColonnes, type Pause } from '@/core/time/slots'` et `import type { CraStatus, Lieu, TimeEntryKind } from '@/core/types'`.
- `interface MonthEntry`, après `minutesParJour` :

```ts
  /** pause figée à l'écriture ; absente = aucune */
  pause?: Pause
  /** lieu figé à l'écriture */
  lieu: Lieu
```

- `versMonthEntry` : remplacer par

```ts
function versMonthEntry(r: TimeEntryRow): MonthEntry {
  const pause = pauseDepuisColonnes(r.pauseDebutMinute, r.pauseFinMinute)
  return {
    id: r.id,
    lineId: r.lineId,
    date: toIsoDate(r.date),
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
    slotId: r.slotId,
    // Relues telles qu'elles ont été écrites : aucun réglage courant ne
    // rejoue ici, sans quoi le gel des heures n'aurait tenu qu'en base.
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    minutesParJour: r.minutesParJour,
    ...(pause !== undefined && { pause }),
    lieu: r.lieu as Lieu,
  }
}
```

Si un test construit un `MonthEntry` littéral (`grep -rln "MonthEntry" src --include="*.test.tsx" --include="*.test.ts"`), y ajouter `lieu: 'DISTANCE',`.

- [ ] **Step 5 : vérifier**

Run : `npx vitest run src/core/saisie src/services/time-entries.test.ts src/components/calendar`
Expected : PASS.

- [ ] **Step 6 : commit**

```bash
git add src/core/saisie src/services/time-entries.ts $(git diff --name-only -- '*.test.ts' '*.test.tsx')
git commit -m "feat(saisie): la case porte la pause et le lieu de sa saisie

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6 : l'écriture fige la pause et le lieu

**Files :**
- Modify : `src/services/cells.ts`
- Modify : `src/services/time-entries.ts` (`saveEntry`)
- Test : `src/services/pause-et-lieu.test.ts` (nouveau)

**Interfaces :**
- Consumes : `pauseDepuisColonnes`, `Pause` (Task 2) ; `AppSettings.pauseDebutMinute/pauseFinMinute` (Task 3) ; `LIEUX`, `Lieu`, `createMission({ lieuDefaut })` (Task 4) ; `CellContext.pause`, `CellEntry.pause/lieu`, `CellState.LIBRE.pause/lieu` (Task 5).
- Produces : toute saisie écrite par `applyCellState` ou `saveEntry` porte `pauseDebutMinute`, `pauseFinMinute` et `lieu` explicitement. `applyCellState` refuse (`SAISIE_INVALIDE`) une pause hors du bloc ou un lieu inconnu.

- [ ] **Step 1 : tests qui échouent**

Créer `src/services/pause-et-lieu.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { applyCellState } from './cells'
import { saveEntry } from './time-entries'
import type { CellState } from '@/core/saisie/cycle'

let userId = ''
let ligneDistance = ''
let ligneSite = ''

const JOUR = '2026-03-10'

function lire(lineId: string, date = JOUR) {
  return prisma.timeEntry.findFirstOrThrow({
    where: { userId, lineId, date: new Date(`${date}T00:00:00.000Z`) },
  })
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'pause@test.local', name: 'P', passwordHash: 'x' } })
  ).id
  const c = await createClient('PAUSE client')
  const aDistance = await createMission({ clientId: c.id, label: 'À distance' })
  const surSite = await createMission({ clientId: c.id, label: 'Sur site', lieuDefaut: 'SITE' })
  ligneDistance = (
    await createLine({ missionId: aDistance.id, userId, label: 'Conseil', soldCentiemes: 5000, tjmCents: 0 })
  ).id
  ligneSite = (
    await createLine({ missionId: surSite.id, userId, label: 'Atelier', soldCentiemes: 5000, tjmCents: 0 })
  ).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.syncOutbox.deleteMany({ where: { userId } })
  await updateSettings({
    minutesParJour: 420,
    capacityMode: 'DESACTIVE',
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
    pauseDebutMinute: 750,
    pauseFinMinute: 810,
  })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'pause@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'PAUSE client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('applyCellState — pause déjeuner', () => {
  it('fige la pause des réglages sur une journée entière, sans toucher au temps facturé', async () => {
    const r = await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r.ok).toBe(true)

    const e = await lire(ligneDistance)
    expect([e.minutes, e.startMinute, e.endMinute, e.pauseDebutMinute, e.pauseFinMinute]).toEqual([
      420, 540, 1020, 750, 810,
    ])
  })

  it('n en pose aucune quand le réglage est désactivé', async () => {
    await updateSettings({ pauseDebutMinute: 0, pauseFinMinute: 0 })
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const e = await lire(ligneDistance)
    expect([e.endMinute, e.pauseDebutMinute, e.pauseFinMinute]).toEqual([960, 0, 0])
  })

  it('écrit la pause que le formulaire envoie', async () => {
    const state: CellState = {
      kind: 'LIBRE',
      minutes: 420,
      slotId: '',
      startMinute: 480,
      endMinute: 960,
      eclatee: false,
      pause: { debutMinute: 720, finMinute: 780 },
    }
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state })

    const e = await lire(ligneDistance)
    expect([e.startMinute, e.endMinute, e.pauseDebutMinute, e.pauseFinMinute]).toEqual([480, 960, 720, 780])
  })

  it('refuse une pause qui ne tombe pas dans le bloc', async () => {
    const state: CellState = {
      kind: 'LIBRE',
      minutes: 120,
      slotId: '',
      startMinute: 540,
      endMinute: 660,
      eclatee: false,
      pause: { debutMinute: 750, finMinute: 810 },
    }
    expect(
      await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state }),
    ).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
  })
})

describe('applyCellState — lieu', () => {
  it('reprend le lieu de la mission à la création', async () => {
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect((await lire(ligneSite)).lieu).toBe('SITE')
    expect((await lire(ligneDistance)).lieu).toBe('DISTANCE')
  })

  it('écrit le lieu que le formulaire choisit', async () => {
    const state: CellState = {
      kind: 'LIBRE',
      minutes: 240,
      slotId: '',
      startMinute: 540,
      endMinute: 780,
      eclatee: false,
      lieu: 'SITE',
    }
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state })
    expect((await lire(ligneDistance)).lieu).toBe('SITE')
  })

  it('garde le lieu de la saisie quand un clic la retouche', async () => {
    const libre: CellState = {
      kind: 'LIBRE',
      minutes: 420,
      slotId: '',
      startMinute: 540,
      endMinute: 1020,
      eclatee: false,
      lieu: 'SITE',
    }
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: libre })
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect((await lire(ligneDistance)).lieu).toBe('SITE')
  })

  it('refuse un lieu inconnu', async () => {
    const state = {
      kind: 'LIBRE',
      minutes: 240,
      slotId: '',
      startMinute: 540,
      endMinute: 780,
      eclatee: false,
      lieu: 'LUNE',
    } as unknown as CellState
    expect(
      await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state }),
    ).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
  })
})

describe('saveEntry — la vue tableau', () => {
  it('pose la pause sur une journée entière', async () => {
    await saveEntry({ userId, lineId: ligneSite, date: JOUR, minutes: 420, kind: 'REALISE' })

    const e = await lire(ligneSite)
    expect([e.endMinute, e.pauseDebutMinute, e.pauseFinMinute, e.lieu]).toEqual([1020, 750, 810, 'SITE'])
  })

  it('n en pose pas sur une durée partielle', async () => {
    await saveEntry({ userId, lineId: ligneDistance, date: JOUR, minutes: 240, kind: 'REALISE' })

    const e = await lire(ligneDistance)
    expect([e.endMinute, e.pauseDebutMinute, e.pauseFinMinute]).toEqual([780, 0, 0])
  })
})
```

Run : `npx vitest run src/services/pause-et-lieu.test.ts`
Expected : FAIL — `pauseDebutMinute` à 0, `lieu` à `'DISTANCE'` pour la mission sur site.

- [ ] **Step 2 : implémenter `applyCellState`**

Dans `src/services/cells.ts` :

- imports : ajouter `import { pauseDepuisColonnes } from '@/core/time/slots'` et remplacer `import type { CraStatus, TimeEntryKind } from '@/core/types'` par :

```ts
import { LIEUX } from '@/core/types'
import type { CraStatus, TimeEntryKind } from '@/core/types'
```

- après `dureeExploitable` :

```ts
/**
 * Une pause venue du client n'est pas crue sur parole non plus : elle doit
 * tomber strictement dans le bloc qu'elle coupe. Un bloc de nuit n'en porte
 * pas — il franchit minuit, la pause jamais.
 */
function pauseExploitable(state: Extract<CellState, { kind: 'LIBRE' }>): boolean {
  const p = state.pause
  if (p === undefined) return true
  const minutesValides = [p.debutMinute, p.finMinute].every(
    (m) => Number.isInteger(m) && m >= 0 && m <= 1439,
  )
  if (!minutesValides || state.endMinute <= state.startMinute) return false
  return state.startMinute < p.debutMinute && p.debutMinute < p.finMinute && p.finMinute < state.endMinute
}
```

- dans `applyCellState`, le `select` de l'affectation devient :

```ts
    select: {
      line: { select: { allowedSlotIds: true, mission: { select: { lieuDefaut: true } } } },
    },
```

- après le contrôle `dureeExploitable` :

```ts
  if (args.state.kind === 'LIBRE' && !pauseExploitable(args.state)) {
    return { ok: false, reason: 'SAISIE_INVALIDE' }
  }

  const lieuDemande = args.state.kind === 'VIDE' ? undefined : args.state.lieu
  if (lieuDemande !== undefined && !(LIEUX as readonly string[]).includes(lieuDemande)) {
    return { ok: false, reason: 'SAISIE_INVALIDE' }
  }
```

- le contexte passé à `cellStateToWrite` gagne, après `journeeFinMinute` :

```ts
      // La pause des réglages, pour une journée entière seulement : c'est
      // `cellStateToWrite` qui décide à quel état elle s'applique.
      ...(pauseReglage !== undefined && { pause: pauseReglage }),
```

  avec, juste avant `let cibles` : `const pauseReglage = pauseDepuisColonnes(settings.pauseDebutMinute, settings.pauseFinMinute)`.

- le relevé `presentes` sélectionne aussi le lieu : `select: { id: true, slotId: true, lieu: true },`
- dans `tx.timeEntry.create({ data: { … } })`, après `endMinute: cible.endMinute,` :

```ts
                pauseDebutMinute: cible.pause?.debutMinute ?? 0,
                pauseFinMinute: cible.pause?.finMinute ?? 0,
                // Le lieu que le formulaire dit, sinon celui de la mission.
                lieu: cible.lieu ?? assignment.line.mission.lieuDefaut,
```

- dans `tx.timeEntry.update({ data: { … } })`, après `endMinute: cible.endMinute,` :

```ts
                pauseDebutMinute: cible.pause?.debutMinute ?? 0,
                pauseFinMinute: cible.pause?.finMinute ?? 0,
                // Un clic dans la grille ne connaît pas le lieu : il garde
                // celui de la saisie qu'il retouche.
                lieu: cible.lieu ?? existante.lieu,
```

- [ ] **Step 3 : implémenter `saveEntry`**

Dans `src/services/time-entries.ts`, `saveEntry` :

- le `select` de l'affectation devient :

```ts
    select: {
      soldCentiemes: true,
      line: { select: { missionId: true, allowedSlotIds: true, mission: { select: { lieuDefaut: true } } } },
    },
```

- remplacer le calcul `const bornes = entryBounds({ … })` par :

```ts
  // Une journée entière saisie au tableau reçoit la pause d'office, comme au
  // calendrier : c'est la même journée, et elle ne doit pas occuper l'agenda
  // autrement selon la vue qui l'a écrite.
  const pauseReglage = pauseDepuisColonnes(settings.pauseDebutMinute, settings.pauseFinMinute)
  const journeeEntiere = slotId === '' && args.minutes === minutesParJour
  const bornes = entryBounds({
    minutes: args.minutes,
    slot: slotId === '' ? null : (settings.slots.find((s) => s.id === slotId) ?? null),
    journeeDebutMinute: settings.journeeDebutMinute,
    journeeFinMinute: settings.journeeFinMinute,
    ...(journeeEntiere && pauseReglage !== undefined && { pause: pauseReglage }),
  })
  // Ce qui part en base : `bornes.pause` n'est pas une colonne, ses deux
  // bornes le sont.
  const colonnes = {
    startMinute: bornes.startMinute,
    endMinute: bornes.endMinute,
    pauseDebutMinute: bornes.pause?.debutMinute ?? 0,
    pauseFinMinute: bornes.pause?.finMinute ?? 0,
  }
```

- dans la transaction, `create` : remplacer `...bornes,` par `...colonnes,` et ajouter `lieu: assignment.line.mission.lieuDefaut,` ; `update` : remplacer `...bornes` par `...colonnes`.

- [ ] **Step 4 : vérifier**

Run : `npx vitest run src/services/pause-et-lieu.test.ts src/services/cells.test.ts src/services/time-entries.test.ts src/services/month-fill.test.ts`
Expected : PASS. Les suites existantes ne réglant pas la pause, elles lisent le défaut du singleton **recréé** (750/810) : si l'une d'elles attend une fin de journée à `startMinute + minutesParJour`, lui ajouter `pauseDebutMinute: 0, pauseFinMinute: 0` dans son `updateSettings` de `beforeEach` — c'est ce qu'elle testait avant ce lot.

- [ ] **Step 5 : commit**

```bash
git add src/services/cells.ts src/services/time-entries.ts src/services/pause-et-lieu.test.ts $(git diff --name-only -- '*.test.ts')
git commit -m "feat(saisie): l'ecriture fige la pause et le lieu de chaque saisie

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7 : le formulaire de case — pause déjeuner et lieu

**Files :**
- Modify : `src/components/calendar/CellForm.tsx`
- Modify : `src/app/(app)/saisie/[month]/SaisieClient.tsx`
- Modify : `src/app/(app)/saisie/[month]/page.tsx`
- Test : `src/components/calendar/CellForm.test.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.test.tsx`

**Interfaces :**
- Consumes : `Pause`, `pauseDepuisColonnes`, `entryBounds` (Task 2) ; `AppSettings.pauseDebutMinute/pauseFinMinute/dureeTrajetMinutes` (Task 3) ; `Lieu`, `LIEUX`, `LIBELLES_LIEU`, `LineForGrid.lieuDefaut` (Task 4) ; `CellState` avec `pause`/`lieu`, `CellContext.pause` (Task 5).
- Produces :
  - `export interface SaisieDuFormulaire { minutes: number; slotId: string; startMinute: number; endMinute: number; pause?: Pause; lieu: Lieu }`
  - `CellForm` props : `onSubmit: (saisie: SaisieDuFormulaire) => void` (remplace la signature positionnelle), `pauseReglage?: Pause`, `dureeTrajetMinutes?: number`
  - `SaisieClient` props : `pauseReglage?: Pause`, `dureeTrajetMinutes?: number`

Règles du formulaire :
- `pauseReglage` absent (réglage « aucune pause ») et saisie sans pause → aucune case « Pause déjeuner » : comportement strictement identique à aujourd'hui.
- Case vide ou journée que le clic vient de poser, avec `pauseReglage` → heures d'une journée entière **avec** pause (9 h → 17 h pour 7 h), case cochée.
- Saisie existante → la case reflète sa pause figée.
- Choisir un créneau nommé décoche ; revenir à « Journée entière » recoche si un réglage existe.
- Durée affichée et transmise = `fin − début − pause`.
- Lieu pré-rempli depuis la saisie, sinon la mission ; chez le client et trajet non nul → phrase qui annonce le trajet.

- [ ] **Step 1 : adapter les assertions existantes à la nouvelle signature**

Dans `CellForm.test.tsx`, remplacer chaque assertion positionnelle `expect(onSubmit).toHaveBeenCalledWith(m, s, d, f)` par sa forme objet, le lieu venant du défaut de la ligne de test :

```ts
expect(onSubmit).toHaveBeenCalledWith({ minutes: 210, slotId: '', startMinute: 540, endMinute: 750, lieu: 'DISTANCE' })
expect(onSubmit).toHaveBeenCalledWith({ minutes: 240, slotId: '', startMinute: 1320, endMinute: 120, lieu: 'DISTANCE' })
expect(onSubmit).toHaveBeenCalledWith({ minutes: 1440, slotId: '', startMinute: 540, endMinute: 540, lieu: 'DISTANCE' })
expect(onSubmit).toHaveBeenCalledWith({ minutes: 180, slotId: 'matin', startMinute: 540, endMinute: 720, lieu: 'DISTANCE' })
```

(Run : `grep -n "toHaveBeenCalledWith(" src/components/calendar/CellForm.test.tsx` pour n'en oublier aucune.)

Dans `SaisieClient.test.tsx`, dans l'assertion `expect(appliquerCase).toHaveBeenCalledWith({ … state: { kind: 'LIBRE', minutes: 180, … eclatee: false } … })`, ajouter `lieu: 'DISTANCE'` à l'objet `state` attendu.

- [ ] **Step 2 : nouveaux tests du formulaire, qui échouent**

Ajouter aux helpers en tête de `CellForm.test.tsx` :

```ts
const DEJEUNER = { debutMinute: 750, finMinute: 810 }
const ligneSept: LineForGrid = { ...ligne, minutesParJour: 420 }

function casePause(): HTMLInputElement {
  return screen.getByLabelText('Pause déjeuner') as HTMLInputElement
}
```

Puis à la fin du fichier :

```ts
describe('CellForm — pause déjeuner', () => {
  afterEach(cleanup)

  it('n offre aucune pause quand aucune n est réglée', () => {
    renderForm()
    expect(screen.queryByLabelText('Pause déjeuner')).toBeNull()
  })

  it('ouvre une case vide sur une journée avec pause : 7 h facturées, 9 h → 17 h', () => {
    renderForm({ line: ligneSept, pauseReglage: DEJEUNER })
    expect([debut().value, fin().value]).toEqual(['09:00', '17:00'])
    expect(casePause().checked).toBe(true)
    expect(dureeCalculee()).toContain('7h')
  })

  it('transmet la pause et la durée facturée', () => {
    const { onSubmit } = renderForm({ line: ligneSept, pauseReglage: DEJEUNER })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith({
      minutes: 420,
      slotId: '',
      startMinute: 540,
      endMinute: 1020,
      pause: DEJEUNER,
      lieu: 'DISTANCE',
    })
  })

  it('compte la pause dans la durée dès qu on la décoche', () => {
    renderForm({ line: ligneSept, pauseReglage: DEJEUNER })
    fireEvent.click(casePause())
    expect(dureeCalculee()).toContain('8h')
  })

  it('décoche la pause quand on choisit un créneau nommé', () => {
    renderForm({ line: ligneSept, pauseReglage: DEJEUNER })
    fireEvent.change(creneau(), { target: { value: 'matin' } })
    expect(casePause().checked).toBe(false)
  })

  it('refuse une pause qui ne tombe pas entre le début et la fin', () => {
    const { onSubmit } = renderForm({ line: ligneSept, pauseReglage: DEJEUNER })
    fireEvent.change(fin(), { target: { value: '12:00' } })
    enregistrer()
    expect(screen.getByRole('alert').textContent).toBe('La pause doit tomber entre le début et la fin.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rouvre une saisie sur la pause qu elle porte, pas sur le réglage', () => {
    renderForm({
      pauseReglage: DEJEUNER,
      etat: {
        kind: 'JOURNEE',
        bornes: { startMinute: 480, endMinute: 960, pause: { debutMinute: 720, finMinute: 780 } },
      },
    })
    expect(casePause().checked).toBe(true)
    expect((screen.getByLabelText('Début de la pause') as HTMLInputElement).value).toBe('12:00')
  })
})

describe('CellForm — lieu', () => {
  afterEach(cleanup)

  function lieu(): HTMLSelectElement {
    return screen.getByLabelText('Lieu') as HTMLSelectElement
  }

  it('reprend le lieu de la mission sur une case vide', () => {
    renderForm({ line: { ...ligne, lieuDefaut: 'SITE' } })
    expect(lieu().value).toBe('SITE')
  })

  it('reprend le lieu de la saisie quand elle en porte un', () => {
    renderForm({
      line: { ...ligne, lieuDefaut: 'SITE' },
      etat: { kind: 'JOURNEE', bornes: { startMinute: 540, endMinute: 1020 }, lieu: 'DISTANCE' },
    })
    expect(lieu().value).toBe('DISTANCE')
  })

  it('annonce le trajet chez le client', () => {
    renderForm({ line: { ...ligne, lieuDefaut: 'SITE' }, dureeTrajetMinutes: 30 })
    expect(screen.getByTestId('annonce-trajet').textContent).toContain('30 min')
  })

  it('transmet le lieu choisi', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(lieu(), { target: { value: 'SITE' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ lieu: 'SITE' }))
  })
})
```

Run : `npx vitest run src/components/calendar/CellForm.test.tsx`
Expected : FAIL.

- [ ] **Step 3 : implémenter `CellForm`**

Imports : ajouter `import { LIBELLES_LIEU, LIEUX, type Lieu } from '@/core/types'`, `import { Checkbox } from '@/components/ui/Checkbox'`, et remplacer `import type { Slot } from '@/core/time/slots'` par `import type { Pause, Slot } from '@/core/time/slots'`.

Avant `bornesFigees`, ajouter :

```ts
/** Ce que le formulaire envoie : les heures, la pause qu'elles contiennent, le lieu. */
export interface SaisieDuFormulaire {
  minutes: number
  slotId: string
  startMinute: number
  endMinute: number
  /** absente = aucune pause */
  pause?: Pause
  lieu: Lieu
}
```

`bornesFigees` rend désormais la pause de la saisie :

```ts
function bornesFigees(etat: CellState): BornesFigeesLues | undefined {
  if (etat.kind === 'LIBRE') {
    return {
      startMinute: etat.startMinute,
      endMinute: etat.endMinute,
      ...(etat.pause !== undefined && { pause: etat.pause }),
    }
  }
  return etat.kind === 'VIDE' ? undefined : etat.bornes
}

type BornesFigeesLues = { startMinute: number; endMinute: number; pause?: Pause }
```

`bornesInitiales` gagne un dernier paramètre `pauseReglage: Pause | undefined` et devient :

```ts
function bornesInitiales(
  etat: CellState,
  line: LineForGrid,
  slots: Slot[],
  journeeDebutMinute: number,
  journeeFinMinute: number,
  pauseReglage: Pause | undefined,
): BornesFigeesLues {
  const figees = bornesFigees(etat)
  if (figees !== undefined) return figees

  // Une case vide s'ouvre comme la journée entière qu'un clic y poserait,
  // pause comprise, dès qu'une pause est réglée. Sans réglage, la plage
  // entière reste le pré-remplissage historique.
  const etatDeDepart: CellState =
    etat.kind === 'VIDE' ? (pauseReglage === undefined ? etat : { kind: 'JOURNEE' }) : etat
  if (etatDeDepart.kind === 'VIDE') {
    return { startMinute: journeeDebutMinute, endMinute: journeeFinMinute % 1440 }
  }

  const cible = cellStateToWrite(etatDeDepart, {
    minutesParJour: line.minutesParJour,
    slots,
    journeeDebutMinute,
    journeeFinMinute,
    ...(pauseReglage !== undefined && { pause: pauseReglage }),
  })[0]

  return cible === undefined
    ? { startMinute: journeeDebutMinute, endMinute: journeeFinMinute % 1440 }
    : {
        startMinute: cible.startMinute,
        endMinute: cible.endMinute,
        ...(cible.pause !== undefined && { pause: cible.pause }),
      }
}
```

Props de `CellForm` : ajouter à la déstructuration et au type, après `journeeFinMinute` :

```ts
  /** pause des réglages ; absente = aucune pause proposée d'office */
  pauseReglage?: Pause
  /** durée d'un trajet posé chez le client, pour l'annoncer ; 0 = aucun */
  dureeTrajetMinutes?: number
```

et remplacer le type de `onSubmit` par `onSubmit: (saisie: SaisieDuFormulaire) => void`.

État local, en remplacement des deux `useState` de `debut` et `fin` :

```ts
  // Calculées une seule fois : `useState` n'appelle l'initialiseur qu'au
  // premier rendu, mais trois appels referaient trois fois le même calcul.
  const [depart] = useState(() =>
    bornesInitiales(etat, line, slots, journeeDebutMinute, journeeFinMinute, pauseReglage),
  )
  const [debut, setDebut] = useState(() => minutesToTimeInput(depart.startMinute))
  const [fin, setFin] = useState(() => minutesToTimeInput(depart.endMinute))
  const [avecPause, setAvecPause] = useState(() => depart.pause !== undefined)
  const pauseProposee = depart.pause ?? pauseReglage
  const [pauseDebut, setPauseDebut] = useState(() =>
    pauseProposee === undefined ? '' : minutesToTimeInput(pauseProposee.debutMinute),
  )
  const [pauseFin, setPauseFin] = useState(() =>
    pauseProposee === undefined ? '' : minutesToTimeInput(pauseProposee.finMinute),
  )
  const [lieu, setLieu] = useState<Lieu>(() =>
    etat.kind !== 'VIDE' && etat.lieu !== undefined ? etat.lieu : line.lieuDefaut,
  )
  // La case n'apparaît que si elle a quelque chose à dire : un réglage, ou une
  // saisie qui porte déjà une pause.
  const pauseDisponible = pauseProposee !== undefined
```

(Supprimer la constante `initiales` devenue inutile.)

Remplacer le calcul de `minutes` par :

```ts
  const debutMinute = timeInputToMinutes(debut)
  const finMinute = timeInputToMinutes(fin)
  const pauseDebutMinute = timeInputToMinutes(pauseDebut)
  const pauseFinMinute = timeInputToMinutes(pauseFin)
  const dureePause =
    avecPause && pauseDebutMinute !== null && pauseFinMinute !== null
      ? Math.max(0, pauseFinMinute - pauseDebutMinute)
      : 0
  // La durée facturée : le bloc, moins la pause qu'il contient.
  const minutes =
    debutMinute === null || finMinute === null
      ? null
      : minutesBetween(debutMinute, finMinute) - dureePause
```

Dans `choisirCreneau`, remplacer le calcul des bornes par :

```ts
    setSlotId(id)
    const slot = id === '' ? null : (slots.find((s) => s.id === id) ?? null)
    // La journée entière retrouve sa pause d'office ; un créneau nommé dit
    // lui-même quand il commence et finit, et n'en porte jamais.
    const pause = slot === null ? pauseReglage : undefined
    setAvecPause(pause !== undefined)
    const bornes = entryBounds({
      // Sans créneau ni pause, la plage entière : c'est un pré-remplissage,
      // que la personne rectifie. Avec pause, la journée facturée.
      minutes:
        pause === undefined
          ? Math.max(0, journeeFinMinute - journeeDebutMinute)
          : line.minutesParJour,
      slot,
      journeeDebutMinute,
      journeeFinMinute,
      ...(pause !== undefined && { pause }),
    })
    setDebut(minutesToTimeInput(bornes.startMinute))
    setFin(minutesToTimeInput(bornes.endMinute))
```

Remplacer `valider` par :

```ts
  function valider(): void {
    if (debutMinute === null || finMinute === null || minutes === null) {
      setErreur('Indiquez une heure de début et une heure de fin.')
      return
    }

    let pause: Pause | undefined
    if (avecPause) {
      if (pauseDebutMinute === null || pauseFinMinute === null) {
        setErreur('Indiquez les deux heures de la pause.')
        return
      }
      // Même règle que le serveur : strictement dans le bloc, et jamais sur un
      // bloc de nuit.
      const dansLeBloc =
        finMinute > debutMinute &&
        debutMinute < pauseDebutMinute &&
        pauseDebutMinute < pauseFinMinute &&
        pauseFinMinute < finMinute
      if (!dansLeBloc) {
        setErreur('La pause doit tomber entre le début et la fin.')
        return
      }
      pause = { debutMinute: pauseDebutMinute, finMinute: pauseFinMinute }
    }

    setErreur(null)
    onSubmit({
      minutes,
      slotId,
      startMinute: debutMinute,
      endMinute: finMinute,
      ...(pause !== undefined && { pause }),
      lieu,
    })
  }
```

Dans le JSX, juste après la `<div className="flex flex-wrap gap-3">` des heures et du créneau :

```tsx
      {pauseDisponible && (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <Checkbox
            label="Pause déjeuner"
            checked={avecPause}
            onChange={(ev) => setAvecPause(ev.target.checked)}
          />
          {avecPause && (
            <>
              <Field
                label="Début de la pause"
                type="time"
                value={pauseDebut}
                onChange={(ev) => setPauseDebut(ev.target.value)}
                className="w-32"
              />
              <Field
                label="Fin de la pause"
                type="time"
                value={pauseFin}
                onChange={(ev) => setPauseFin(ev.target.value)}
                className="w-32"
              />
            </>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <Select
          label="Lieu"
          value={lieu}
          onChange={(ev) => setLieu(ev.target.value as Lieu)}
          className="w-52"
        >
          {LIEUX.map((l) => (
            <option key={l} value={l}>
              {LIBELLES_LIEU[l]}
            </option>
          ))}
        </Select>
      </div>

      {/* Le trajet se dit avant d'arriver dans l'agenda : il y sera posé une
          fois, puis l'application ne le suivra plus. */}
      {lieu === 'SITE' && (dureeTrajetMinutes ?? 0) > 0 && (
        <p data-testid="annonce-trajet" className="mt-2 text-xs text-muted">
          Chez le client : un trajet de {dureeTrajetMinutes} min est posé avant et après dans
          l’agenda, une seule fois. Vous pourrez ensuite le déplacer ou le supprimer là-bas.
        </p>
      )}
```

Run : `npx vitest run src/components/calendar/CellForm.test.tsx`
Expected : PASS.

- [ ] **Step 4 : brancher la page et `SaisieClient`**

Dans `SaisieClient.tsx` :

- import : `import type { Pause, Slot } from '@/core/time/slots'` (remplace l'import de type `Slot` s'il vient de ce module ; sinon ajouter `import type { Pause } from '@/core/time/slots'`).
- props, après `journeeFinMinute: number` :

```ts
  /** pause des réglages, proposée d'office au formulaire ; absente = aucune */
  pauseReglage?: Pause
  /** durée d'un trajet chez le client, annoncée par le formulaire */
  dureeTrajetMinutes?: number
```

- dans le rendu de `<CellForm>`, après `journeeFinMinute={props.journeeFinMinute}` :

```tsx
          pauseReglage={props.pauseReglage}
          dureeTrajetMinutes={props.dureeTrajetMinutes ?? 0}
```

- remplacer le `onSubmit` de `<CellForm>` par :

```tsx
          onSubmit={async (saisie) => {
            setFormulaire(null)
            await handleApply(formulaire.date, {
              kind: 'LIBRE',
              minutes: saisie.minutes,
              slotId: saisie.slotId,
              startMinute: saisie.startMinute,
              endMinute: saisie.endMinute,
              eclatee: false,
              ...(saisie.pause !== undefined && { pause: saisie.pause }),
              lieu: saisie.lieu,
            })
          }}
```

Dans `page.tsx`, ajouter `import { pauseDepuisColonnes } from '@/core/time/slots'` et, sur `<SaisieClient>` après `journeeFinMinute={settings.journeeFinMinute}` :

```tsx
        pauseReglage={pauseDepuisColonnes(settings.pauseDebutMinute, settings.pauseFinMinute)}
        dureeTrajetMinutes={settings.dureeTrajetMinutes}
```

- [ ] **Step 5 : vérifier**

Run : `npx vitest run src/components/calendar "src/app/(app)/saisie"`
Expected : PASS.

- [ ] **Step 6 : commit**

```bash
git add src/components/calendar "src/app/(app)/saisie"
git commit -m "feat(saisie): le formulaire propose la pause dejeuner et le lieu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8 : l'agenda reçoit deux blocs pour une journée coupée

**Files :**
- Modify : `src/core/sync/policy.ts`
- Modify : `src/core/calendar/event.ts`
- Modify : `src/integrations/google/calendar.ts` (`toBody`)
- Modify : `src/services/sync/flush.ts`
- Test : `src/core/calendar/event.test.ts`, `src/integrations/google/calendar.test.ts`, `src/services/sync/flush.test.ts`

**Interfaces :**
- Consumes : `Pause`, `pauseDepuisColonnes` (Task 2) ; colonnes `TimeEntry.pauseDebutMinute/pauseFinMinute` (Task 1) ; écriture de la pause (Task 6).
- Produces :
  - `export const ENTITY_TIME_ENTRY_SUITE = 'TimeEntrySuite'` (policy)
  - `CalendarEventDraft.craSegment?: string`, `CalendarEventDraft.craTrajetId?: string` ; `craEntryId` peut valoir `''` (trajet, Task 12)
  - `export const SEGMENT_APRES_PAUSE = 'apres-pause'`
  - `export type Segment = 'PRINCIPAL' | 'APRES_PAUSE'`
  - `export function buildCalendarEvents(args: BuildEventArgs & { pause?: Pause }): Array<{ segment: Segment; draft: CalendarEventDraft }>`
  - dans `flush.ts` : `pousserBloc(connector, row, cible, draft, now, entryId): Promise<Issue>` et `retirerBloc(connector, cible): Promise<void>` (privées) ; `ouvrirConflit(row, cible, kind, snapshot)` prend désormais la cible du bloc.

- [ ] **Step 1 : tests du constructeur, qui échouent**

Dans `event.test.ts`, ajouter `buildCalendarEvents, SEGMENT_APRES_PAUSE` à l'import depuis `'./event'`, puis à la fin :

```ts
describe('buildCalendarEvents — la pause coupe le bloc', () => {
  it('rend un seul bloc sans pause, identique à buildCalendarEvent', () => {
    expect(buildCalendarEvents(base())).toEqual([
      { segment: 'PRINCIPAL', draft: buildCalendarEvent(base()) },
    ])
  })

  it('rend deux blocs, la pause libre entre les deux', () => {
    const blocs = buildCalendarEvents({ ...base(), pause: { debutMinute: 750, finMinute: 810 } })
    expect(
      blocs.map((b) => [b.segment, b.draft.startLocal, b.draft.endLocal, b.draft.craSegment]),
    ).toEqual([
      ['PRINCIPAL', '2026-03-10T09:00:00', '2026-03-10T12:30:00', undefined],
      ['APRES_PAUSE', '2026-03-10T13:30:00', '2026-03-10T17:00:00', SEGMENT_APRES_PAUSE],
    ])
  })

  it('garde la même saisie derrière les deux blocs', () => {
    const blocs = buildCalendarEvents({ ...base(), pause: { debutMinute: 750, finMinute: 810 } })
    expect(blocs.map((b) => b.draft.craEntryId)).toEqual(['entry-1', 'entry-1'])
  })
})
```

Run : `npx vitest run src/core/calendar/event.test.ts`
Expected : FAIL — `buildCalendarEvents is not a function`.

- [ ] **Step 2 : implémenter le constructeur et la constante**

Dans `src/core/sync/policy.ts`, après `ENTITY_TIME_ENTRY` :

```ts
/**
 * Le second bloc d'une journée coupée par la pause déjeuner. Même saisie —
 * l'`entityId` est celui de la `TimeEntry` —, autre événement : l'unicité
 * (entityType, entityId, provider) d'`ExternalLink` en demande un par bloc.
 *
 * Ce type n'entre jamais en file : c'est la saisie entière qu'on repousse, et
 * le drainage retrouve ses deux blocs à partir d'elle.
 */
export const ENTITY_TIME_ENTRY_SUITE = 'TimeEntrySuite'
```

Dans `src/core/calendar/event.ts` :

- import : `import { minutesBetween, type Pause } from '../time/slots'`
- `interface CalendarEventDraft` : remplacer la ligne `craEntryId: string` et son commentaire par :

```ts
  /** retrouvé côté Google dans extendedProperties.private ; vide pour un trajet */
  craEntryId: string
  /** `'apres-pause'` sur le second bloc d'une journée coupée ; absent sinon */
  craSegment?: string
  /** identifiant du trajet ; absent pour un bloc de travail */
  craTrajetId?: string
```

- à la fin du fichier :

```ts
export const SEGMENT_APRES_PAUSE = 'apres-pause'

export type Segment = 'PRINCIPAL' | 'APRES_PAUSE'

/**
 * Les blocs d'agenda d'une saisie : un seul, ou deux quand une pause la coupe.
 *
 * Un événement Google n'a pas de trou. Poser un bloc de 9 h à 17 h et écrire
 * la pause en description laisserait l'agenda annoncer occupé à midi — le
 * contraire de ce que la pause veut dire. Le premier bloc garde exactement la
 * forme d'aujourd'hui, pour que les liens déjà posés continuent de le désigner.
 */
export function buildCalendarEvents(
  args: BuildEventArgs & { pause?: Pause },
): Array<{ segment: Segment; draft: CalendarEventDraft }> {
  if (args.pause === undefined) {
    return [{ segment: 'PRINCIPAL', draft: buildCalendarEvent(args) }]
  }

  return [
    { segment: 'PRINCIPAL', draft: buildCalendarEvent({ ...args, endMinute: args.pause.debutMinute }) },
    {
      segment: 'APRES_PAUSE',
      draft: {
        ...buildCalendarEvent({ ...args, startMinute: args.pause.finMinute }),
        craSegment: SEGMENT_APRES_PAUSE,
      },
    },
  ]
}
```

Run : `npx vitest run src/core/calendar/event.test.ts`
Expected : PASS.

- [ ] **Step 3 : le connecteur transporte les propriétés privées**

Test, à la fin de `src/integrations/google/calendar.test.ts` (ajouter les imports `createFakeGoogleApi` et `createGoogleCalendarConnector` s'ils manquent) :

```ts
describe('propriétés privées d un bloc', () => {
  const brouillon = {
    summary: 'Acme · Refonte · Dév',
    description: 'Bloc réalisé posé par le CRA.',
    startLocal: '2026-03-10T13:30:00',
    endLocal: '2026-03-10T17:00:00',
    timeZone: 'Europe/Paris',
    transparency: 'opaque' as const,
    colorId: '9',
    craEntryId: 'entry-1',
  }

  function connecteur() {
    const api = createFakeGoogleApi()
    const connector = createGoogleCalendarConnector({
      fetchFn: api.fetchFn,
      accessToken: 'ya29.acces',
      calendarId: 'cal-exemple@group.calendar.google.com',
    })
    return { api, connector }
  }

  it('porte le segment du second bloc d une journée coupée', async () => {
    const { api, connector } = connecteur()
    await connector.createEvent({ ...brouillon, craSegment: 'apres-pause' })
    expect((api.dernierAppel().body as Record<string, unknown>).extendedProperties).toEqual({
      private: { craEntryId: 'entry-1', craSegment: 'apres-pause' },
    })
  })

  it('ne porte que l identifiant du trajet sur un trajet', async () => {
    const { api, connector } = connecteur()
    await connector.createEvent({ ...brouillon, craEntryId: '', craTrajetId: 'trajet-1' })
    expect((api.dernierAppel().body as Record<string, unknown>).extendedProperties).toEqual({
      private: { craTrajetId: 'trajet-1' },
    })
  })
})
```

Run : `npx vitest run src/integrations/google/calendar.test.ts`
Expected : FAIL.

Dans `src/integrations/google/calendar.ts`, avant `toBody` :

```ts
/**
 * Ce que l'application reconnaît d'elle-même dans l'agenda. Un trajet n'a pas
 * de `craEntryId` : il n'est pas une saisie, et la lecture d'occupation comme
 * la détection de conflit ne doivent jamais le prendre pour l'une d'elles.
 */
function proprietesPrivees(draft: CalendarEventDraft): Record<string, string> {
  return {
    ...(draft.craEntryId !== '' && { craEntryId: draft.craEntryId }),
    ...(draft.craSegment !== undefined && { craSegment: draft.craSegment }),
    ...(draft.craTrajetId !== undefined && { craTrajetId: draft.craTrajetId }),
  }
}
```

et dans `toBody`, remplacer `extendedProperties: { private: { craEntryId: draft.craEntryId } },` par `extendedProperties: { private: proprietesPrivees(draft) },`.

Run : `npx vitest run src/integrations/google`
Expected : PASS.

- [ ] **Step 4 : tests du drainage, qui échouent**

Dans `src/services/sync/flush.test.ts`, ajouter `pauseDebutMinute: 0, pauseFinMinute: 0,` à l'`updateSettings` du `beforeEach` global : les tests existants décrivent le bloc unique, et le réglage par défaut (12 h 30 – 13 h 30) couperait leurs journées de 480 minutes. Puis à la fin du fichier :

```ts
describe('journée coupée par la pause', () => {
  beforeEach(async () => {
    await updateSettings({ pauseDebutMinute: 750, pauseFinMinute: 810 })
  })

  function lienSuite(entityId: string) {
    return prisma.externalLink.findFirst({
      where: { entityType: 'TimeEntrySuite', entityId, provider: 'GOOGLE' },
    })
  }

  function bornesPosees(): string[][] {
    return api
      .appelsVers('/events')
      .filter((a) => a.method === 'POST')
      .map((a) => {
        const b = a.body as { start: { dateTime: string }; end: { dateTime: string } }
        return [b.start.dateTime, b.end.dateTime]
      })
  }

  it('pose deux blocs, la pause libre entre les deux', async () => {
    const entryId = await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(bornesPosees()).toEqual([
      ['2026-03-12T09:00:00', '2026-03-12T12:30:00'],
      ['2026-03-12T13:30:00', '2026-03-12T18:00:00'],
    ])
    expect(await lien(entryId)).not.toBeNull()
    expect(await lienSuite(entryId)).not.toBeNull()
  })

  it('retire le second bloc quand la pause disparaît', async () => {
    const entryId = await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const suite = await lienSuite(entryId)

    // Une durée partielle n'est plus une journée entière : plus de pause.
    await saisir('2026-03-12', 240)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(await lienSuite(entryId)).toBeNull()
    expect(api.appelsVers(suite!.externalId).some((a) => a.method === 'DELETE')).toBe(true)
  })

  it('ouvre le conflit sur le seul bloc retouché dans Google', async () => {
    const entryId = await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const suite = await lienSuite(entryId)

    api.toucherEvenement(suite!.externalId, { summary: 'Déplacé à la main' })
    await saisir('2026-03-12', 480)
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.conflits).toBe(1)
    const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId, resolvedAt: null } })
    expect([conflit.entityType, conflit.entityId]).toEqual(['TimeEntrySuite', entryId])
  })

  it('retire les deux blocs quand la saisie est supprimée', async () => {
    const entryId = await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(await lien(entryId)).toBeNull()
    expect(await lienSuite(entryId)).toBeNull()
  })
})
```

Run : `npx vitest run src/services/sync/flush.test.ts`
Expected : les tests existants PASS, les quatre nouveaux FAIL (un seul POST).

- [ ] **Step 5 : implémenter le drainage par blocs**

Dans `src/services/sync/flush.ts` :

- imports : remplacer `import { buildCalendarEvent } from '@/core/calendar/event'` par `import { buildCalendarEvents, type CalendarEventDraft } from '@/core/calendar/event'` ; ajouter `ENTITY_TIME_ENTRY_SUITE` à l'import depuis `'@/core/sync/policy'` ; ajouter `import { pauseDepuisColonnes } from '@/core/time/slots'`.
- après `cibleDe` :

```ts
type Cible = ReturnType<typeof cibleDe>

/** Le second bloc d'une saisie : même saisie, autre événement, autre lien. */
function cibleSuiteDe(row: Row): Cible {
  return { ...cibleDe(row), entityType: ENTITY_TIME_ENTRY_SUITE }
}
```

- `ouvrirConflit` prend la cible explicitement — un conflit vise un **bloc**, plus forcément la ligne de file :

```ts
async function ouvrirConflit(
  row: Row,
  cible: Cible,
  kind: ConflictKind,
  snapshot: unknown,
): Promise<void> {
  const ouvert = await prisma.syncConflict.findFirst({
    where: { userId: row.userId, ...cible, resolvedAt: null },
  })
  const data = { kind, remoteSnapshotJson: JSON.stringify(snapshot), detectedAt: new Date() }

  if (ouvert === null) {
    await prisma.syncConflict.create({ data: { userId: row.userId, ...cible, ...data } })
  } else {
    await prisma.syncConflict.update({ where: { id: ouvert.id }, data })
  }
}
```

(garder son commentaire de documentation.)

- remplacer `traiterUpsert` par les trois fonctions suivantes :

```ts
/**
 * Pousse **un** bloc : création, ou lecture puis comparaison d'etag puis mise
 * à jour. C'est la règle d'avant la pause, inchangée — elle s'applique
 * désormais bloc par bloc, chacun sous son propre lien.
 */
async function pousserBloc(
  connector: CalendarConnector,
  row: Row,
  cible: Cible,
  draft: CalendarEventDraft,
  now: Date,
  entryId: string,
): Promise<Issue> {
  const link = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: cible },
  })

  if (link === null) {
    const cree = await connector.createEvent(draft)
    await prisma.externalLink.create({
      data: {
        ...cible,
        userId: row.userId,
        externalId: cree.externalId,
        etag: cree.etag,
        syncState: 'SYNCED',
        syncedAt: now,
      },
    })
    return { etat: 'POUSSE', entryId, externalId: cree.externalId }
  }

  // On lit avant d'écrire. C'est le seul moment où une modification faite dans
  // Google peut être vue — et le seul endroit où on peut refuser de l'écraser.
  let remote
  try {
    remote = await connector.getEvent(link.externalId)
  } catch (err) {
    if (err instanceof CalendarApiError && err.kind === 'NOT_FOUND') {
      await ouvrirConflit(row, cible, 'REMOTE_DELETED', { externalId: link.externalId })
      return { etat: 'CONFLIT', kind: 'REMOTE_DELETED' }
    }
    throw err
  }

  if (link.etag !== '' && remote.etag !== link.etag) {
    await ouvrirConflit(row, cible, 'REMOTE_MODIFIED', remote)
    // Et surtout : aucune écriture. La divergence part en arbitrage.
    return { etat: 'CONFLIT', kind: 'REMOTE_MODIFIED' }
  }

  const maj = await connector.updateEvent(link.externalId, draft)
  await prisma.externalLink.update({
    where: { id: link.id },
    data: { etag: maj.etag, syncState: 'SYNCED', syncedAt: now },
  })
  return { etat: 'POUSSE', entryId, externalId: link.externalId }
}

/** Retire un bloc de l'agenda, s'il y a jamais été posé. */
async function retirerBloc(connector: CalendarConnector, cible: Cible): Promise<void> {
  const link = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: cible },
  })
  // Jamais poussé, donc rien à retirer de l'agenda.
  if (link === null) return

  // Un événement déjà absent est absorbé par le connecteur : l'objectif est
  // atteint, le lien peut être consommé.
  await connector.deleteEvent(link.externalId)
  await prisma.externalLink.delete({ where: { id: link.id } })
}

async function traiterUpsert(
  connector: CalendarConnector,
  row: Row,
  now: Date,
  timeZone: string,
): Promise<Issue> {
  const entry = await prisma.timeEntry.findFirst({
    where: { id: row.entityId, userId: row.userId },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  // La saisie a disparu entre la mise en file et le drainage : plus rien à
  // pousser. La ligne DELETE, elle, aura été mise en file par la suppression.
  if (entry === null) return { etat: 'RIEN' }

  // Aucun réglage n'est relu ici, et c'est tout l'enjeu : les heures d'une
  // saisie — pause comprise — sont figées à son écriture. Un réglage modifié
  // en administration ne déplace aucun bloc d'une journée que personne n'a
  // retouchée, CRA validé compris.
  const pause = pauseDepuisColonnes(entry.pauseDebutMinute, entry.pauseFinMinute)
  const blocs = buildCalendarEvents({
    entryId: entry.id,
    date: toIsoDate(entry.date),
    kind: entry.kind as TimeEntryKind,
    clientName: entry.line.mission.client.name,
    missionLabel: entry.line.mission.label,
    lineLabel: entry.line.label,
    startMinute: entry.startMinute,
    endMinute: entry.endMinute,
    // Le fuseau, lui, est bien un réglage courant, et c'est voulu : il situe
    // des heures locales naïves, il ne les change pas.
    timeZone,
    ...(pause !== undefined && { pause }),
  })

  // Chaque bloc part, même si l'autre est en conflit : une retouche faite dans
  // Google sur l'après-midi ne doit pas empêcher la matinée de suivre la saisie.
  const issues: Issue[] = []
  for (const { segment, draft } of blocs) {
    const cible = segment === 'PRINCIPAL' ? cibleDe(row) : cibleSuiteDe(row)
    issues.push(await pousserBloc(connector, row, cible, draft, now, entry.id))
  }

  // La pause a été retirée : le second bloc n'a plus rien à occuper.
  if (!blocs.some((b) => b.segment === 'APRES_PAUSE')) {
    await retirerBloc(connector, cibleSuiteDe(row))
  }

  return issues.find((i) => i.etat === 'CONFLIT') ?? issues[0]!
}
```

- remplacer `traiterSuppression` par :

```ts
async function traiterSuppression(connector: CalendarConnector, row: Row): Promise<Issue> {
  await retirerBloc(connector, cibleDe(row))
  await retirerBloc(connector, cibleSuiteDe(row))
  // `RIEN` et non `POUSSE` : `agenda.bloc.pousse` atteste qu'un bloc a été
  // écrit dans l'agenda, et un retrait n'en écrit aucun.
  return { etat: 'RIEN' }
}
```

Run : `npx vitest run src/services/sync src/integrations/google src/core/calendar`
Expected : PASS. Si `conflicts.test.ts` ou `drain.test.ts` saisissent des journées de 480 minutes et comptent des appels, ajouter `pauseDebutMinute: 0, pauseFinMinute: 0` à leur `updateSettings` de mise en place, pour la même raison qu'au Step 4.

- [ ] **Step 6 : commit**

```bash
git add src/core/sync/policy.ts src/core/calendar src/integrations/google src/services/sync
git commit -m "feat(agenda): une journee coupee par la pause devient deux blocs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9 : arbitrer le second bloc

**Files :**
- Modify : `src/services/sync/conflicts.ts`
- Test : `src/services/sync/conflicts.test.ts`

**Interfaces :**
- Consumes : `ENTITY_TIME_ENTRY_SUITE` (Task 8).
- Produces : `ResolveResult` gagne le motif `'SEGMENT'`. Un conflit `TimeEntrySuite` se liste avec « · après la pause », se **rétablit** en remettant en file la saisie entière (`entityType = 'TimeEntry'`), se **détache** comme un autre, et refuse d'être **accepté** seul.

- [ ] **Step 1 : tests qui échouent**

Dans `conflicts.test.ts`, remplacer l'import de `'@/core/sync/policy'` par `import { ENTITY_TIME_ENTRY, ENTITY_TIME_ENTRY_SUITE, PROVIDER_GOOGLE } from '@/core/sync/policy'`, puis à la fin du fichier :

```ts
describe('le second bloc d une journée coupée', () => {
  async function divergenceSuite(): Promise<{ conflictId: string; entryId: string }> {
    const entryId = await saisirLeDouze()
    const cible = { entityType: ENTITY_TIME_ENTRY_SUITE, entityId: entryId, provider: PROVIDER_GOOGLE }
    await prisma.externalLink.create({
      data: { userId, ...cible, externalId: 'evt-suite', etag: '"1"', syncState: 'SYNCED' },
    })
    const conflit = await prisma.syncConflict.create({
      data: {
        userId,
        ...cible,
        kind: 'REMOTE_MODIFIED',
        remoteSnapshotJson: JSON.stringify(
          instantane({ startLocal: '2026-03-12T13:30:00', endLocal: '2026-03-12T15:00:00' }),
        ),
      },
    })
    // L'état que le drainage laisse derrière lui : la file vidée.
    await prisma.syncOutbox.deleteMany({ where: { userId } })
    return { conflictId: conflit.id, entryId }
  }

  it('se liste comme le bloc d après la pause', async () => {
    await divergenceSuite()
    const [conflit] = await listOpenConflicts(userId)
    expect(conflit?.libelle).toContain('après la pause')
  })

  it('se rétablit en repoussant la saisie entière', async () => {
    const { conflictId, entryId } = await divergenceSuite()

    expect(await resolveConflict({ userId, conflictId, resolution: 'RETABLIR' })).toEqual({
      ok: true,
      resolution: 'RETABLIR',
    })
    expect(await prisma.syncOutbox.findFirst({ where: cibleDe(entryId) })).not.toBeNull()
    const lienSuite = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: ENTITY_TIME_ENTRY_SUITE, entityId: entryId },
    })
    expect(lienSuite.etag).toBe('')
  })

  it('refuse d être accepté seul', async () => {
    const { conflictId } = await divergenceSuite()
    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('SEGMENT')
  })
})
```

Run : `npx vitest run src/services/sync/conflicts.test.ts`
Expected : FAIL — le libellé ne dit rien de la pause, la file reste vide après rétablissement.

- [ ] **Step 2 : implémenter**

Dans `src/services/sync/conflicts.ts` :

- import : `import { ENTITY_TIME_ENTRY, ENTITY_TIME_ENTRY_SUITE } from '@/core/sync/policy'` (à côté de l'import de types existant).
- `ResolveResult` : ajouter `| 'SEGMENT'` à l'union des motifs.
- dans `listOpenConflicts`, remplacer le calcul de `libelle` par :

```ts
      libelle:
        entry === undefined
          ? 'Saisie supprimée'
          : `${toIsoDate(entry.date)} · ${entry.line.mission.client.name} · ${entry.line.mission.label} · ${entry.line.label}` +
            // Deux blocs pour une même saisie : l'écran doit dire lequel a bougé.
            (c.entityType === ENTITY_TIME_ENTRY_SUITE ? ' · après la pause' : ''),
```

- dans `resolveConflict`, branche `RETABLIR`, remplacer l'appel `enqueueSync(tx, { userId: args.userId, ...cible, operation: 'UPSERT' })` par :

```ts
      // Le second bloc d'une journée coupée n'entre jamais en file : c'est la
      // saisie entière qu'on repousse, et le drainage retrouve ses deux blocs.
      const aRepousser =
        cible.entityType === ENTITY_TIME_ENTRY_SUITE
          ? { ...cible, entityType: ENTITY_TIME_ENTRY }
          : cible
      await enqueueSync(tx, { userId: args.userId, ...aRepousser, operation: 'UPSERT' })
```

- juste avant le commentaire `// --- ACCEPTER ---` :

```ts
  // Accepter réécrit la saisie d'après l'événement. Le second bloc n'en porte
  // qu'une moitié : il ne dit ni le début de la journée, ni sa pause, et en
  // tirer une durée transformerait un après-midi retouché en journée facturée.
  if (conflit.entityType === ENTITY_TIME_ENTRY_SUITE) {
    return {
      ok: false,
      reason: 'SEGMENT',
      message:
        "Ce bloc est la seconde moitié d'une journée coupée par la pause : il ne dit pas à lui seul ce que vaut la journée. Rétablissez-le ou détachez-le.",
    }
  }
```

Run : `npx vitest run src/services/sync/conflicts.test.ts && npx tsc --noEmit`
Expected : PASS, et aucune erreur de type. Si `tsc` signale un `switch` exhaustif sur `ResolveResult['reason']` dans un écran, y ajouter le cas `'SEGMENT'` en affichant `message`.

- [ ] **Step 3 : commit**

```bash
git add src/services/sync/conflicts.ts src/services/sync/conflicts.test.ts
git commit -m "feat(agenda): le second bloc d'une journee coupee s'arbitre sans fausser la saisie

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 10 : le calcul des trajets

**Files :**
- Create : `src/core/saisie/trajets.ts`
- Test : `src/core/saisie/trajets.test.ts`

**Interfaces :**
- Consumes : `minutesBetween` (`core/time/slots.ts`, existant).
- Produces :
  - `export interface Intervalle { startMinute: number; endMinute: number }` — minutes depuis minuit ; une fin inférieure ou égale au début franchit minuit, comme partout ailleurs.
  - `export function trajetsAPoser(args: { bloc: Intervalle; dureeMinutes: number; dejaPoses: readonly Intervalle[]; autresBlocs: readonly Intervalle[] }): Intervalle[]` — aller puis retour, chacun absent s'il est réduit à rien. Un trajet rendu ne franchit jamais minuit ; un retour qui finit à minuit porte `endMinute = 0`.

- [ ] **Step 1 : tests qui échouent**

Créer `src/core/saisie/trajets.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { trajetsAPoser } from './trajets'

const aucun = { dejaPoses: [], autresBlocs: [] }

describe('trajetsAPoser', () => {
  it('pose un aller juste avant et un retour juste après', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 540, endMinute: 1020 }, dureeMinutes: 30, ...aucun })).toEqual([
      { startMinute: 510, endMinute: 540 },
      { startMinute: 1020, endMinute: 1050 },
    ])
  })

  it('ne pose rien quand la durée de trajet est nulle', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 540, endMinute: 1020 }, dureeMinutes: 0, ...aucun })).toEqual([])
  })

  // Journée chez A jusqu'à 17 h, rendez-vous chez B à 17 h 45 : le retour de A
  // est déjà posé, l'aller de B se contente de ce qui reste.
  it('raccourcit l aller contre un trajet déjà posé', () => {
    expect(
      trajetsAPoser({
        bloc: { startMinute: 1065, endMinute: 1125 },
        dureeMinutes: 30,
        dejaPoses: [{ startMinute: 1020, endMinute: 1050 }],
        autresBlocs: [],
      }),
    ).toEqual([
      { startMinute: 1050, endMinute: 1065 },
      { startMinute: 1125, endMinute: 1155 },
    ])
  })

  it('raccourcit le retour contre un autre bloc de travail', () => {
    expect(
      trajetsAPoser({
        bloc: { startMinute: 540, endMinute: 720 },
        dureeMinutes: 30,
        dejaPoses: [],
        autresBlocs: [{ startMinute: 735, endMinute: 900 }],
      }),
    ).toEqual([
      { startMinute: 510, endMinute: 540 },
      { startMinute: 720, endMinute: 735 },
    ])
  })

  it('ne pose pas un trajet réduit à rien', () => {
    expect(
      trajetsAPoser({
        bloc: { startMinute: 540, endMinute: 600 },
        dureeMinutes: 30,
        dejaPoses: [],
        autresBlocs: [{ startMinute: 420, endMinute: 540 }],
      }),
    ).toEqual([{ startMinute: 600, endMinute: 630 }])
  })

  it('ne pose pas d aller quand un autre bloc chevauche le début', () => {
    expect(
      trajetsAPoser({
        bloc: { startMinute: 540, endMinute: 600 },
        dureeMinutes: 30,
        dejaPoses: [],
        autresBlocs: [{ startMinute: 500, endMinute: 560 }],
      }),
    ).toEqual([{ startMinute: 600, endMinute: 630 }])
  })

  it('tronque l aller à minuit', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 10, endMinute: 60 }, dureeMinutes: 30, ...aucun })[0]).toEqual({
      startMinute: 0,
      endMinute: 10,
    })
  })

  it('tronque le retour à minuit, noté 0', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 1380, endMinute: 1430 }, dureeMinutes: 30, ...aucun })[1]).toEqual({
      startMinute: 1430,
      endMinute: 0,
    })
  })

  it('ne pose pas de retour après un bloc qui finit à minuit ou le franchit', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 1320, endMinute: 0 }, dureeMinutes: 30, ...aucun })).toEqual([
      { startMinute: 1290, endMinute: 1320 },
    ])
    expect(trajetsAPoser({ bloc: { startMinute: 1320, endMinute: 120 }, dureeMinutes: 30, ...aucun })).toEqual([
      { startMinute: 1290, endMinute: 1320 },
    ])
  })
})
```

Run : `npx vitest run src/core/saisie/trajets.test.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 2 : implémenter**

Créer `src/core/saisie/trajets.ts` :

```ts
import { minutesBetween } from '../time/slots'

const MINUIT = 1440

/** Un intervalle de la journée, en minutes depuis minuit. */
export interface Intervalle {
  startMinute: number
  /** une fin inférieure ou égale au début franchit minuit */
  endMinute: number
}

/** Les bornes en minutes absolues du jour : la fin peut dépasser minuit. */
function deplier(i: Intervalle): { debut: number; fin: number } {
  return { debut: i.startMinute, fin: i.startMinute + minutesBetween(i.startMinute, i.endMinute) }
}

/**
 * Les trajets à poser autour d'une saisie chez le client : un aller collé à son
 * début, un retour collé à sa fin.
 *
 * Chacun est **raccourci** pour ne recouvrir ni un trajet déjà posé, ni un
 * autre bloc de travail, et n'est pas posé du tout s'il ne reste rien. C'est ce
 * qui tient ensemble deux choix du porteur : les trajets sont posés puis
 * oubliés — un trajet posé ne se modifie jamais —, et deux trajets qui se
 * touchent ne se superposent pas. Le prix : deux blocs contigus là où un seul
 * aurait suffi, l'agenda restant occupé sur toute la plage, ce qui est le but.
 *
 * Un trajet ne franchit jamais minuit : il est tronqué, et un bloc qui finit à
 * minuit ou au-delà n'a pas de retour — il appartiendrait au lendemain.
 */
export function trajetsAPoser(args: {
  bloc: Intervalle
  dureeMinutes: number
  dejaPoses: readonly Intervalle[]
  autresBlocs: readonly Intervalle[]
}): Intervalle[] {
  if (args.dureeMinutes <= 0) return []

  const bloc = deplier(args.bloc)
  const obstacles = [...args.dejaPoses, ...args.autresBlocs].map(deplier)
  const trajets: Intervalle[] = []

  // L'aller se raccourcit par la gauche : il reste collé au début du bloc.
  let debutAller = Math.max(0, bloc.debut - args.dureeMinutes)
  for (const o of obstacles) {
    if (o.debut < bloc.debut && o.fin > debutAller) debutAller = Math.max(debutAller, o.fin)
  }
  if (debutAller < bloc.debut) trajets.push({ startMinute: debutAller, endMinute: bloc.debut })

  // Le retour se raccourcit par la droite : il reste collé à la fin du bloc.
  if (bloc.fin < MINUIT) {
    let finRetour = Math.min(MINUIT, bloc.fin + args.dureeMinutes)
    for (const o of obstacles) {
      if (o.fin > bloc.fin && o.debut < finRetour) finRetour = Math.min(finRetour, o.debut)
    }
    // Minuit se note 0, comme la fin de toute saisie.
    if (finRetour > bloc.fin) trajets.push({ startMinute: bloc.fin, endMinute: finRetour % MINUIT })
  }

  return trajets
}
```

Run : `npx vitest run src/core/saisie/trajets.test.ts`
Expected : PASS.

- [ ] **Step 3 : commit**

```bash
git add src/core/saisie/trajets.ts src/core/saisie/trajets.test.ts
git commit -m "feat(trajets): calcul pur de l'aller et du retour, raccourcis contre l'existant

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11 : poser les trajets à l'écriture

**Files :**
- Modify : `src/core/sync/policy.ts`
- Create : `src/services/trajets.ts`
- Modify : `src/services/cells.ts`, `src/services/time-entries.ts`
- Test : `src/services/trajets.test.ts` (nouveau)

**Interfaces :**
- Consumes : `trajetsAPoser`, `Intervalle` (Task 10) ; `enqueueSync` (`services/sync/outbox.ts`, existant) ; `TimeEntry.lieu`, `TimeEntry.trajetsCalcules`, modèle `Trajet` (Task 1) ; `AppSettings.dureeTrajetMinutes` (Task 3) ; lieu écrit par `applyCellState`/`saveEntry` (Task 6).
- Produces :
  - `export const ENTITY_TRAJET = 'Trajet'` (policy)
  - `export async function planifierTrajets(tx: Prisma.TransactionClient, args: { userId: string; entryId: string; dureeMinutes: number }): Promise<void>` — appelée dans la transaction d'écriture, **après** l'écriture et la mise en file de la saisie.

- [ ] **Step 1 : tests qui échouent**

Créer `src/services/trajets.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { applyCellState } from './cells'
import { saveEntry } from './time-entries'

let userId = ''
let ligneSite = ''
let ligneSiteRdv = ''
let ligneDistance = ''

const JOUR = '2026-03-10'
const MINUIT_DU_JOUR = new Date(`${JOUR}T00:00:00.000Z`)

function trajetsDuJour() {
  return prisma.trajet.findMany({
    where: { userId, date: MINUIT_DU_JOUR },
    orderBy: { startMinute: 'asc' },
    select: { startMinute: true, endMinute: true, summary: true },
  })
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'trajets@test.local', name: 'T', passwordHash: 'x' } })
  ).id
  const c = await createClient('TRAJETS client')
  const surSite = await createMission({ clientId: c.id, label: 'Chez eux', lieuDefaut: 'SITE' })
  const aDistance = await createMission({ clientId: c.id, label: 'De chez moi' })
  ligneSite = (await createLine({ missionId: surSite.id, userId, label: 'Atelier', soldCentiemes: 5000, tjmCents: 0 })).id
  ligneSiteRdv = (await createLine({ missionId: surSite.id, userId, label: 'Rendez-vous', soldCentiemes: 5000, tjmCents: 0 })).id
  ligneDistance = (await createLine({ missionId: aDistance.id, userId, label: 'Conseil', soldCentiemes: 5000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.trajet.deleteMany({ where: { userId } })
  await prisma.syncOutbox.deleteMany({ where: { userId } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
    // Sans pause : ce fichier décrit les trajets, la pause a les siens.
    pauseDebutMinute: 0,
    pauseFinMinute: 0,
    dureeTrajetMinutes: 30,
  })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'trajets@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'TRAJETS client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('pose des trajets', () => {
  it('pose un aller et un retour autour d une journée chez le client, et les met en file', async () => {
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await trajetsDuJour()).toEqual([
      { startMinute: 510, endMinute: 540, summary: 'Trajet · TRAJETS client' },
      { startMinute: 1020, endMinute: 1050, summary: 'Trajet · TRAJETS client' },
    ])
    expect(await prisma.syncOutbox.count({ where: { userId, entityType: 'Trajet' } })).toBe(2)
    const saisie = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: ligneSite } })
    expect(saisie.trajetsCalcules).toBe(true)
  })

  it('ne repose rien quand la saisie est retouchée', async () => {
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await trajetsDuJour()).toHaveLength(2)
  })

  it('ne pose rien à distance', async () => {
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(await trajetsDuJour()).toEqual([])
  })

  it('ne pose rien quand la durée de trajet est nulle, et pourra le faire plus tard', async () => {
    await updateSettings({ dureeTrajetMinutes: 0 })
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await trajetsDuJour()).toEqual([])
    const saisie = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: ligneSite } })
    expect(saisie.trajetsCalcules).toBe(false)
  })

  it('raccourcit l aller d un rendez-vous qui suit une journée', async () => {
    await applyCellState({
      userId,
      lineId: ligneSite,
      date: JOUR,
      kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 480, slotId: '', startMinute: 540, endMinute: 1020, eclatee: false },
    })
    await applyCellState({
      userId,
      lineId: ligneSiteRdv,
      date: JOUR,
      kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 60, slotId: '', startMinute: 1065, endMinute: 1125, eclatee: false },
    })

    expect((await trajetsDuJour()).map((t) => [t.startMinute, t.endMinute])).toEqual([
      [510, 540],
      [1020, 1050],
      [1050, 1065],
      [1125, 1155],
    ])
  })

  it('laisse les trajets en place quand la saisie est supprimée', async () => {
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'VIDE' } })

    expect(await trajetsDuJour()).toHaveLength(2)
  })

  it('pose aussi depuis la vue tableau', async () => {
    await saveEntry({ userId, lineId: ligneSite, date: JOUR, minutes: 240, kind: 'REALISE' })
    expect((await trajetsDuJour()).map((t) => [t.startMinute, t.endMinute])).toEqual([
      [510, 540],
      [780, 810],
    ])
  })
})
```

Run : `npx vitest run src/services/trajets.test.ts`
Expected : FAIL — aucun trajet.

- [ ] **Step 2 : implémenter**

Dans `src/core/sync/policy.ts`, après `ENTITY_TIME_ENTRY_SUITE` :

```ts
/**
 * Un trajet posé autour d'une saisie chez le client. Il entre en file pour
 * profiter des reprises après panne, mais n'a ni lien externe ni conflit : il
 * est posé une fois, puis l'agenda en fait ce qu'il veut.
 */
export const ENTITY_TRAJET = 'Trajet'
```

Créer `src/services/trajets.ts` :

```ts
import type { Prisma } from '@prisma/client'
import { trajetsAPoser } from '@/core/saisie/trajets'
import { ENTITY_TRAJET, PROVIDER_GOOGLE } from '@/core/sync/policy'
import { enqueueSync } from './sync/outbox'

/**
 * Calcule, enregistre et met en file les trajets d'une saisie chez le client —
 * **une seule fois dans sa vie**.
 *
 * Appelée dans la transaction d'écriture, après la saisie et sa mise en file :
 * un trajet enregistré sans sa ligne en file ne partirait jamais, et personne
 * ne le saurait. La lecture des autres blocs du jour voit donc aussi ce que la
 * même transaction vient d'écrire.
 *
 * Rien n'est reposé ensuite, même si la saisie change d'heures ou repasse à
 * distance puis sur site : le porteur a pu déplacer ou supprimer le trajet dans
 * son agenda, et le reposer effacerait ce geste. `trajetsCalcules` ne passe à
 * vrai que si un calcul a réellement eu lieu — une durée de trajet nulle laisse
 * la porte ouverte au jour où elle sera réglée.
 */
export async function planifierTrajets(
  tx: Prisma.TransactionClient,
  args: { userId: string; entryId: string; dureeMinutes: number },
): Promise<void> {
  if (args.dureeMinutes <= 0) return

  const saisie = await tx.timeEntry.findFirst({
    where: { id: args.entryId, userId: args.userId },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  if (saisie === null || saisie.lieu !== 'SITE' || saisie.trajetsCalcules) return

  const dejaPoses = await tx.trajet.findMany({
    where: { userId: args.userId, date: saisie.date },
    select: { startMinute: true, endMinute: true },
  })
  // Toutes prestations, sur site ou non : un trajet ne mord sur aucun travail.
  const autresBlocs = await tx.timeEntry.findMany({
    where: { userId: args.userId, date: saisie.date, id: { not: saisie.id } },
    select: { startMinute: true, endMinute: true },
  })

  const trajets = trajetsAPoser({
    bloc: { startMinute: saisie.startMinute, endMinute: saisie.endMinute },
    dureeMinutes: args.dureeMinutes,
    dejaPoses,
    autresBlocs,
  })

  for (const t of trajets) {
    const trajet = await tx.trajet.create({
      data: {
        userId: args.userId,
        date: saisie.date,
        startMinute: t.startMinute,
        endMinute: t.endMinute,
        entryId: saisie.id,
        summary: `Trajet · ${saisie.line.mission.client.name}`,
      },
    })
    await enqueueSync(tx, {
      userId: args.userId,
      entityType: ENTITY_TRAJET,
      entityId: trajet.id,
      provider: PROVIDER_GOOGLE,
    })
  }

  await tx.timeEntry.update({ where: { id: saisie.id }, data: { trajetsCalcules: true } })
}
```

Dans `src/services/cells.ts`, importer `import { planifierTrajets } from './trajets'` et, dans la boucle `for (const cible of cibles)`, juste après `await enqueueTimeEntry(tx, { … operation: 'UPSERT' })` :

```ts
      // Chez le client, les trajets de cette saisie — une fois pour toutes.
      await planifierTrajets(tx, {
        userId: args.userId,
        entryId: entry.id,
        dureeMinutes: settings.dureeTrajetMinutes,
      })
```

Dans `src/services/time-entries.ts`, importer `import { planifierTrajets } from './trajets'` et, dans la transaction d'écriture de `saveEntry`, juste après `await enqueueTimeEntry(tx, { userId: args.userId, entryId: entry.id, operation: 'UPSERT' })` :

```ts
    await planifierTrajets(tx, {
      userId: args.userId,
      entryId: entry.id,
      dureeMinutes: settings.dureeTrajetMinutes,
    })
```

- [ ] **Step 3 : vérifier**

Run : `npx vitest run src/services/trajets.test.ts src/services/cells.test.ts src/services/time-entries.test.ts src/services/month-fill.test.ts src/services/pause-et-lieu.test.ts`
Expected : PASS.

- [ ] **Step 4 : commit**

```bash
git add src/core/sync/policy.ts src/services/trajets.ts src/services/trajets.test.ts src/services/cells.ts src/services/time-entries.ts
git commit -m "feat(trajets): une saisie chez le client pose ses trajets, une fois pour toutes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12 : envoyer les trajets dans l'agenda

**Files :**
- Modify : `src/core/calendar/event.ts`
- Modify : `src/services/sync/flush.ts`
- Test : `src/core/calendar/event.test.ts`, `src/services/sync/flush.test.ts`

**Interfaces :**
- Consumes : `CalendarEventDraft.craTrajetId`, `proprietesPrivees` (Task 8) ; `ENTITY_TRAJET`, lignes de file et modèle `Trajet` (Tasks 1, 11) ; `createMission({ lieuDefaut })` (Task 4).
- Produces :
  - `export const COULEUR_TRAJET = '8'`
  - `export function buildTrajetEvent(args: { trajetId: string; date: string; startMinute: number; endMinute: number; summary: string; timeZone: string }): CalendarEventDraft`
  - dans `flush.ts` : `traiterTrajet(connector, row, now, timeZone): Promise<Issue>` (privée)

- [ ] **Step 1 : test du constructeur, qui échoue**

Dans `event.test.ts`, ajouter `buildTrajetEvent, COULEUR_TRAJET` à l'import, puis :

```ts
describe('buildTrajetEvent', () => {
  const trajet = {
    trajetId: 'trajet-1',
    date: '2026-03-10',
    startMinute: 1020,
    endMinute: 1050,
    summary: 'Trajet · Acme',
    timeZone: 'Europe/Paris',
  }

  it('pose un bloc occupé, de la couleur des trajets', () => {
    const draft = buildTrajetEvent(trajet)
    expect([draft.summary, draft.startLocal, draft.endLocal, draft.transparency, draft.colorId]).toEqual([
      'Trajet · Acme',
      '2026-03-10T17:00:00',
      '2026-03-10T17:30:00',
      'opaque',
      COULEUR_TRAJET,
    ])
  })

  it('se désigne comme un trajet, jamais comme une saisie', () => {
    const draft = buildTrajetEvent(trajet)
    expect([draft.craEntryId, draft.craTrajetId]).toEqual(['', 'trajet-1'])
  })

  it('dit qu on peut le retoucher sans que l application s en mêle', () => {
    expect(buildTrajetEvent(trajet).description).toContain('ne le suivra plus')
  })

  it('finit à minuit le soir même quand sa fin est notée 0', () => {
    expect(buildTrajetEvent({ ...trajet, startMinute: 1430, endMinute: 0 }).endLocal).toBe('2026-03-11T00:00:00')
  })
})
```

Run : `npx vitest run src/core/calendar/event.test.ts`
Expected : FAIL.

- [ ] **Step 2 : implémenter le constructeur**

Dans `src/core/calendar/event.ts`, après `COULEUR_PREVISIONNEL` :

```ts
/** Graphite : un trajet occupe, mais ne se confond ni avec le réalisé ni avec le prévu. */
export const COULEUR_TRAJET = '8'
```

et à la fin du fichier :

```ts
/**
 * Le bloc d'un trajet. Il occupe l'agenda comme un bloc de travail, mais ne
 * porte aucun `craEntryId` : l'application ne le relira jamais, et rien ne
 * doit pouvoir le prendre pour une saisie.
 */
export function buildTrajetEvent(args: {
  trajetId: string
  /** 'YYYY-MM-DD' */
  date: string
  startMinute: number
  endMinute: number
  summary: string
  timeZone: string
}): CalendarEventDraft {
  return {
    summary: args.summary,
    description:
      'Trajet posé par takta. Vous pouvez le déplacer ou le supprimer : l’application ne le suivra plus.',
    startLocal: localAt(args.date, args.startMinute),
    endLocal: localAt(args.date, args.startMinute + minutesBetween(args.startMinute, args.endMinute)),
    timeZone: args.timeZone,
    transparency: 'opaque',
    colorId: COULEUR_TRAJET,
    craEntryId: '',
    craTrajetId: args.trajetId,
  }
}
```

Run : `npx vitest run src/core/calendar/event.test.ts`
Expected : PASS.

- [ ] **Step 3 : tests du drainage, qui échouent**

Dans `flush.test.ts`, à la fin :

```ts
describe('trajets', () => {
  let ligneSite = ''

  beforeAll(async () => {
    const c = await createClient('FLUSH trajets')
    const m = await createMission({ clientId: c.id, label: 'Chez eux', lieuDefaut: 'SITE' })
    ligneSite = (
      await createLine({ missionId: m.id, userId, label: 'Atelier', soldCentiemes: 3000, tjmCents: 0 })
    ).id
  })

  beforeEach(async () => {
    await prisma.trajet.deleteMany({ where: { userId } })
    await updateSettings({ dureeTrajetMinutes: 30 })
  })

  afterAll(async () => {
    await prisma.trajet.deleteMany({ where: { userId } })
    await prisma.client.deleteMany({ where: { name: 'FLUSH trajets' } })
  })

  /** Les événements de trajet présents chez Google, par identifiant. */
  function trajetsChezGoogle(): string[] {
    return [...api.events.values()]
      .filter((e) => e.body.colorId === '8')
      .map((e) => e.id)
  }

  async function saisirSurSite(minutes = 240): Promise<void> {
    const r = await saveEntry({ userId, lineId: ligneSite, date: '2026-03-12', minutes, kind: 'REALISE' })
    expect(r.ok).toBe(true)
  }

  it('pose l aller et le retour, et note qu ils sont posés', async () => {
    await saisirSurSite()
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.echecs).toBe(0)
    const bornes = api
      .appelsVers('/events')
      .filter((a) => a.method === 'POST' && (a.body as { colorId: string }).colorId === '8')
      .map((a) => (a.body as { start: { dateTime: string } }).start.dateTime)
      .sort()
    expect(bornes).toEqual(['2026-03-12T08:30:00', '2026-03-12T13:00:00'])
    expect(await prisma.trajet.count({ where: { userId, poseAt: null } })).toBe(0)
  })

  it('ne relit ni ne réécrit un trajet posé', async () => {
    await saisirSurSite()
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const ids = trajetsChezGoogle()

    for (const id of ids) api.toucherEvenement(id, { summary: 'Retouché à la main' })
    await saisirSurSite(300)
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.conflits).toBe(0)
    for (const id of ids) {
      expect(api.appelsVers(id).filter((a) => a.method !== 'POST')).toEqual([])
    }
    expect(trajetsChezGoogle()).toHaveLength(2)
  })

  it('laisse les trajets dans l agenda quand la saisie est supprimée', async () => {
    await saisirSurSite()
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const ids = trajetsChezGoogle()

    await saveEntry({ userId, lineId: ligneSite, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(trajetsChezGoogle()).toEqual(ids)
  })
})
```

(Le `beforeEach` global supprime déjà les saisies de `userId` ; il ne touche pas aux trajets, d'où celui de ce `describe`. Ajouter `beforeAll` à l'import depuis `vitest` s'il manque.)

Run : `npx vitest run src/services/sync/flush.test.ts`
Expected : FAIL — la ligne `Trajet` passe par `traiterUpsert`, qui n'y trouve aucune saisie et la consomme sans rien poser.

- [ ] **Step 4 : implémenter le drainage des trajets**

Dans `src/services/sync/flush.ts` :

- imports : ajouter `buildTrajetEvent` à l'import depuis `'@/core/calendar/event'` et `ENTITY_TRAJET` à l'import depuis `'@/core/sync/policy'`.
- après `traiterSuppression` :

```ts
/**
 * Pose un trajet, **une fois**. Aucun lien, aucun etag, aucune relecture : le
 * trajet appartient à l'agenda dès qu'il y est, et le porteur le déplace ou le
 * supprime sans que l'application s'en mêle.
 *
 * Un trajet dont la création a réussi mais dont `poseAt` n'a pas pu être écrit
 * serait reposé au passage suivant : un doublon, que le porteur retire à la
 * main. Le risque est accepté plutôt que de tenir un lien pour un seul cas.
 */
async function traiterTrajet(
  connector: CalendarConnector,
  row: Row,
  now: Date,
  timeZone: string,
): Promise<Issue> {
  const trajet = await prisma.trajet.findFirst({ where: { id: row.entityId, userId: row.userId } })
  // Disparu avec son compte, ou déjà posé : plus rien à faire.
  if (trajet === null || trajet.poseAt !== null) return { etat: 'RIEN' }

  const cree = await connector.createEvent(
    buildTrajetEvent({
      trajetId: trajet.id,
      date: toIsoDate(trajet.date),
      startMinute: trajet.startMinute,
      endMinute: trajet.endMinute,
      summary: trajet.summary,
      timeZone,
    }),
  )
  await prisma.trajet.update({ where: { id: trajet.id }, data: { poseAt: now } })
  return { etat: 'POUSSE', entryId: trajet.entryId, externalId: cree.externalId }
}
```

- dans `flushSyncOutbox`, remplacer le calcul de `issue` par :

```ts
      // Un trajet ne se met jamais à jour ni ne se retire : il a son propre
      // traitement, qui ne lit aucune saisie.
      const issue =
        row.entityType === ENTITY_TRAJET
          ? await traiterTrajet(connector, row, now, timeZone)
          : row.operation === 'DELETE'
            ? await traiterSuppression(connector, row)
            : await traiterUpsert(connector, row, now, timeZone)
```

Run : `npx vitest run src/services/sync src/core/calendar`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git add src/core/calendar src/services/sync
git commit -m "feat(agenda): les trajets partent dans l'agenda, et n'y sont plus suivis

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13 : vérification d'ensemble

**Files :**
- Aucun nouveau fichier ; corrections éventuelles là où la suite échoue.

- [ ] **Step 1 : types**

Run : `npx tsc --noEmit`
Expected : aucune erreur. Les causes probables d'erreur, et leur correction :
- un `LineForGrid`, `MissionForUser`, `MonthEntry` ou `AppSettings` littéral dans un test ou un écran → ajouter `lieuDefaut: 'DISTANCE'`, `lieu: 'DISTANCE'` ou les trois réglages (`pauseDebutMinute: 750, pauseFinMinute: 810, dureeTrajetMinutes: 30`) ;
- un appelant de `CellForm` resté sur l'ancienne signature positionnelle de `onSubmit` → passer à `(saisie: SaisieDuFormulaire) => …`.

- [ ] **Step 2 : suite complète**

Run : `npx vitest run`
Expected : PASS. Une suite qui écrit des journées de `minutesParJour` minutes et vérifie leur fin, un nombre d'appels Google ou un nombre de lignes de file lit désormais la pause par défaut du singleton : lui régler `pauseDebutMinute: 0, pauseFinMinute: 0` dans sa mise en place — c'est la situation qu'elle décrivait. Ne jamais corriger en changeant le défaut du schéma.

- [ ] **Step 3 : construction**

Run : `npm run build`
Expected : construction réussie (elle refuse, entre autres, un export non asynchrone dans un fichier `'use server'` — `LieuMissionState` est un **type**, donc admis).

- [ ] **Step 4 : essai dans l'application**

Lancer l'application (`npm run dev`) et vérifier à la main :
1. Administration · Saisie : la carte « Pause déjeuner et trajets » affiche 12:30, 13:30 et 30.
2. Missions : une mission passée « Chez le client ».
3. Saisie : un clic sur un jour de cette mission, puis le formulaire rouvert — 09:00 → 17:00 pour une journée de 7 h, « Pause déjeuner » cochée, durée « 7h », lieu « Chez le client », phrase de trajet visible.
4. Si un agenda Google est connecté : « Synchroniser maintenant » pose 08:30–09:00, 09:00–12:30, 13:30–17:00 et 17:00–17:30.

- [ ] **Step 5 : commit des corrections éventuelles**

```bash
git add -A
git commit -m "test: les suites existantes decrivent le bloc sans pause

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Seulement si les Steps 1 à 3 ont demandé des corrections.)
