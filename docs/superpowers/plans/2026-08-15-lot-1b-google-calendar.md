# Lot 1b — Google Calendar · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de l'agenda la surface de disponibilité — pousser un bloc occupé par ligne de temps, lire l'occupation existante pour avertir avant de planifier, et arbitrer les divergences sans jamais écraser en silence, sans qu'une panne Google ne bloque jamais la saisie.

**Architecture:** Une file de sortie qui est un **ensemble** (unicité sur `(entityType, entityId, provider)`), mise à jour dans la transaction d'écriture ; un traitement de fond qui lit avant d'écrire et ouvre un conflit plutôt que d'écraser ; un connecteur Google testé **exclusivement contre un double de son API** ; des jetons chiffrés au repos par une clé d'environnement.

**Tech Stack:** Next.js 15 · TypeScript · Prisma 6 · SQLite en développement · Vitest 4 · Node 22

**Spec :** `docs/superpowers/specs/2026-08-15-lot-1b-google-calendar-design.md`

## Global Constraints

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** (`node:crypto` est autorisé : c'est un module de plateforme, pas une couche applicative.)
- **Aucun enum Prisma, aucun décimal, aucun tableau Prisma.** Une liste se stocke en chaîne séparée par des virgules. Portabilité SQLite/Postgres.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus.**
- **Un mois dont le CRA est validé refuse toute écriture** — y compris celles qui viendraient de l'arbitrage d'un conflit d'agenda.
- **Aucun test n'appelle Google.** Le connecteur se teste contre `createFakeGoogleApi()`, un double en mémoire de l'API REST. Un plan dont les tests dépendent du réseau est un plan invalide : aucun `fetch` global n'est jamais laissé branché dans un test.
- **La file de sortie est un ensemble, pas un journal.** Dix modifications d'une même cellule avant le prochain passage produisent **une** ligne.
- **La mise en file est transactionnelle avec l'écriture** de la saisie.
- **La détection de divergence par etag n'écrase jamais** : elle crée un conflit et s'arrête.
- **« Accepter la version agenda » passe par les règles de `saveEntry`** — capacité, affectation, verrouillage du mois. Jamais à côté.
- **Une panne Google ne bloque jamais la saisie**, ni en lecture ni en écriture.
- **Le calendrier dédié est exclu de la requête d'occupation.**
- **Les jetons sont chiffrés au repos**, la clé vient de l'environnement (`CREDENTIALS_KEY`).
- Français pour les chaînes visibles, anglais pour le code et les messages de commit.
- `vitest.config.ts` est en `fileParallelism: false` — ne pas le modifier.
- Tests de composants : `// @vitest-environment happy-dom` en première ligne, `afterEach(cleanup)` explicite.
- **Ne jamais exécuter `npx next build`** : le serveur de développement du porteur du produit tourne sur cet arbre.

---

## Interfaces existantes

```ts
// src/core/time/slots.ts
interface Slot { id: string; label: string; startMinute: number; endMinute: number; centiemes: number }
crossesMidnight(slot: Slot): boolean
slotDurationMinutes(slot: Slot): number

// src/core/cra/state-machine.ts
isLocked(status: CraStatus): boolean

// src/core/types.ts
type TimeEntryKind = 'REALISE' | 'PREVISIONNEL'
type CraStatus = 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'

// src/services/settings.ts
interface AppSettings { minutesParJour; capacityMode; capacityCentiemes; workingDays; slots: Slot[];
                        holidays: string[]; defaultDisplayUnit; defaultEngagementSource;
                        objectifCaExerciceCents; debutExerciceMois }
getSettings(): Promise<AppSettings>
updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
validateSettingsPatch(patch: Partial<AppSettings>): { ok: true } | { ok: false; errors: string[] }

// src/services/time-entries.ts
interface MonthEntry { id; lineId; date; minutes; kind; slotId; minutesParJour }
type SaveResult =
  | { ok: true; minutes: number; warning?: CapacityWarning }
  | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number }
  | { ok: false; reason: 'VERROUILLE' }
  | { ok: false; reason: 'NON_AFFECTE' }
saveEntry(args: { userId; lineId; date; minutes; kind; slotId? }): Promise<SaveResult>
getMonthEntries(userId: string, month: string): Promise<MonthEntry[]>
convertPastForecast(userId, month, today): Promise<{ converted: number; skippedLocked: number }>
toIsoDate(d: Date): string

// src/services/missions.ts
interface LineForGrid { id; label; missionLabel; clientName; displayUnit; minutesParJour; soldCentiemes; allowedSlotIds: string[] }
listActiveLines(userId: string): Promise<LineForGrid[]>

// src/auth.ts
requireUser(): Promise<{ id: string; role: Role }>

// prisma/schema.prisma — déjà présent
model ExternalLink { id, entityType, entityId, provider, externalId, syncedAt, syncState
                     @@unique([entityType, entityId, provider]) }
```

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `prisma/schema.prisma` | *(modifié)* `SyncOutbox`, `SyncConflict`, `ProviderCredential`, `ExternalLink.etag`, plage journée |
| `src/core/crypto/secret-box.ts` | AES-256-GCM, pur, sans accès à l'environnement |
| `src/core/calendar/event.ts` | Construction de l'événement, pure |
| `src/core/calendar/connector.ts` | Interface `CalendarConnector`, types distants, `CalendarApiError` |
| `src/core/sync/policy.ts` | Vocabulaire de la file, recul progressif |
| `src/integrations/google/calendar.ts` | Implémentation Google sur un `fetch` injecté |
| `src/integrations/google/oauth.ts` | Consentement, échange de code, rafraîchissement |
| `src/integrations/google/fake-google-api.ts` | **Le double de l'API** — jamais importé par le code applicatif |
| `src/services/credentials.ts` | Jetons chiffrés au repos, clé lue dans l'environnement |
| `src/services/sync/outbox.ts` | Mise en file, transactionnelle avec l'écriture |
| `src/services/sync/queue.ts` | Lecture et rejeu des échecs (en aval de `outbox.ts`) |
| `src/services/sync/connector.ts` | Résolution du connecteur, rafraîchissement du jeton |
| `src/services/sync/flush.ts` | Drainage, détection de divergence, recul progressif |
| `src/services/sync/conflicts.ts` | Arbitrage — « accepter » passe par `saveEntry` |
| `src/services/availability.ts` | Lecture d'occupation, silencieuse en cas de panne |
| `src/services/google/connect.ts` | Connexion du compte, calendrier dédié |
| `src/services/time-entries.ts` | *(modifié)* mise en file, signalement de créneau |
| `src/app/api/sync/flush/route.ts` | Déclenchement externe, protégé par jeton |
| `src/app/api/google/{connect,callback}/route.ts` | Parcours OAuth |
| `src/app/(app)/admin/sync/` | État de la connexion, conflits, échecs, bouton |

**Dépendances :** 1 et 4 sont indépendantes. 2 et 3 consomment 1. 5 consomme 3 et 4. 6 consomme 1 et 4. 7 consomme 2, 3, 5 et 6. 8 et 9 consomment 7. 10 consomme 2 et 5. 11 consomme 7, 8 et 10. 12 consomme 6.

---

## Task 1: Les tables de synchronisation, l'etag et la plage journée

**Files:** Modify `prisma/schema.prisma`, `src/services/settings.ts`, `src/app/(app)/admin/saisie/actions.ts`, `src/app/(app)/admin/saisie/SettingsForm.tsx`. Create `src/db/sync-schema.test.ts`. Modify `src/services/settings.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `SyncOutbox { id, userId, entityType, entityId, provider, operation, state, attempts, lastError, nextAttemptAt, updatedAt }` avec `@@unique([entityType, entityId, provider])`
  - `SyncConflict { id, userId, entityType, entityId, provider, kind, remoteSnapshotJson, detectedAt, resolvedAt, resolution }`
  - `ProviderCredential { id, userId, provider, accessTokenEnc, refreshTokenEnc, expiresAt, scope, calendarId, connectedAt }` avec `@@unique([userId, provider])`
  - `ExternalLink.etag String @default("")`
  - `AppSettings` gagne `journeeDebutMinute: number` et `journeeFinMinute: number`

- [ ] **Step 1: Écrire le test qui échoue**

`src/db/sync-schema.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from './client'

let userId = ''
let autreId = ''

const CIBLE = { entityType: 'TimeEntry', entityId: 'entry-1', provider: 'GOOGLE' }

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'sync-schema@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'sync-schema-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.externalLink.deleteMany({})
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['sync-schema@test.local', 'sync-schema-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

describe('SyncOutbox — un ensemble, pas un journal', () => {
  // Le test central du lot : c'est l'unicité du triplet qui rend la
  // synchronisation idempotente par construction, et le rejeu gratuit.
  it('dix mises en file de la même entité ne produisent qu une ligne', async () => {
    for (let i = 0; i < 10; i++) {
      await prisma.syncOutbox.upsert({
        where: { entityType_entityId_provider: CIBLE },
        create: { ...CIBLE, userId, operation: 'UPSERT' },
        update: { operation: 'UPSERT', state: 'PENDING', attempts: 0, lastError: '' },
      })
    }

    expect(await prisma.syncOutbox.count()).toBe(1)
  })

  it('refuse un doublon inséré sans passer par l upsert', async () => {
    await prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'UPSERT' } })
    await expect(
      prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'DELETE' } }),
    ).rejects.toThrow()
  })

  it('sépare deux entités distinctes', async () => {
    await prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'UPSERT' } })
    await prisma.syncOutbox.create({
      data: { ...CIBLE, entityId: 'entry-2', userId, operation: 'UPSERT' },
    })
    expect(await prisma.syncOutbox.count()).toBe(2)
  })

  it('sépare deux fournisseurs pour la même entité', async () => {
    await prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'UPSERT' } })
    await prisma.syncOutbox.create({
      data: { ...CIBLE, provider: 'DOLIBARR', userId, operation: 'UPSERT' },
    })
    expect(await prisma.syncOutbox.count()).toBe(2)
  })

  it('naît PENDING, sans tentative et sans erreur', async () => {
    const row = await prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'UPSERT' } })
    expect({ state: row.state, attempts: row.attempts, lastError: row.lastError }).toEqual({
      state: 'PENDING',
      attempts: 0,
      lastError: '',
    })
  })

  it('disparaît avec son utilisateur', async () => {
    await prisma.syncOutbox.create({ data: { ...CIBLE, userId: autreId, operation: 'UPSERT' } })
    await prisma.user.delete({ where: { id: autreId } })
    expect(await prisma.syncOutbox.count()).toBe(0)

    const a = await prisma.user.create({
      data: { email: 'sync-schema-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    autreId = a.id
  })
})

describe('SyncConflict', () => {
  it('naît non résolu, sans arbitrage', async () => {
    const c = await prisma.syncConflict.create({
      data: { ...CIBLE, userId, kind: 'REMOTE_MODIFIED', remoteSnapshotJson: '{"etag":"2"}' },
    })
    expect(c.resolvedAt).toBeNull()
    expect(c.resolution).toBe('')
  })

  it('accepte plusieurs divergences successives sur la même entité', async () => {
    await prisma.syncConflict.create({
      data: { ...CIBLE, userId, kind: 'REMOTE_MODIFIED', resolvedAt: new Date(), resolution: 'DETACHER' },
    })
    await prisma.syncConflict.create({ data: { ...CIBLE, userId, kind: 'REMOTE_DELETED' } })

    expect(await prisma.syncConflict.count({ where: { resolvedAt: null } })).toBe(1)
  })
})

describe('ProviderCredential', () => {
  it('est unique par utilisateur et fournisseur', async () => {
    const base = {
      provider: 'GOOGLE',
      accessTokenEnc: 'v1.a.b.c',
      refreshTokenEnc: 'v1.d.e.f',
      expiresAt: new Date('2026-08-15T12:00:00Z'),
    }
    await prisma.providerCredential.create({ data: { ...base, userId } })
    await expect(prisma.providerCredential.create({ data: { ...base, userId } })).rejects.toThrow()

    // Le même fournisseur chez un autre utilisateur reste possible.
    await prisma.providerCredential.create({ data: { ...base, userId: autreId } })
    expect(await prisma.providerCredential.count()).toBe(2)
  })

  it('naît sans calendrier dédié', async () => {
    const c = await prisma.providerCredential.create({
      data: {
        userId,
        provider: 'GOOGLE',
        accessTokenEnc: 'v1.a.b.c',
        refreshTokenEnc: 'v1.d.e.f',
        expiresAt: new Date('2026-08-15T12:00:00Z'),
      },
    })
    expect({ calendarId: c.calendarId, scope: c.scope }).toEqual({ calendarId: '', scope: '' })
  })
})

describe('ExternalLink', () => {
  it('porte un etag, vide tant que rien n a été poussé', async () => {
    const l = await prisma.externalLink.create({
      data: { ...CIBLE, externalId: 'evt-1' },
    })
    expect(l.etag).toBe('')

    const relu = await prisma.externalLink.update({ where: { id: l.id }, data: { etag: '"3"' } })
    expect(relu.etag).toBe('"3"')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/db/sync-schema.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'deleteMany')` : `prisma.syncOutbox` n'existe pas.

- [ ] **Step 3: Étendre le schéma**

Dans `prisma/schema.prisma`, ajouter aux relations de `User` :

```prisma
model User {
  // … champs existants
  outbox      SyncOutbox[]
  conflicts   SyncConflict[]
  credentials ProviderCredential[]
}
```

Ajouter `etag` à `ExternalLink` :

```prisma
model ExternalLink {
  // … champs existants
  /// empreinte de l'événement distant ; toute la détection de divergence repose dessus.
  /// Vide tant que rien n'a été poussé.
  etag       String    @default("")
}
```

Ajouter les deux réglages à `Settings` :

```prisma
model Settings {
  // … champs existants
  /// début de la plage journée, minutes depuis minuit (9 h -> 540)
  journeeDebutMinute Int @default(540)
  /// fin de la plage journée, minutes depuis minuit (18 h -> 1080)
  journeeFinMinute   Int @default(1080)
}
```

Puis les trois tables nouvelles :

```prisma
/// Un **ensemble** d'entités à synchroniser, jamais un journal : l'unicité du
/// triplet fait que dix modifications d'une même cellule avant le prochain
/// passage produisent une ligne, pas dix.
model SyncOutbox {
  id            String   @id @default(cuid())
  userId        String
  entityType    String
  entityId      String
  provider      String
  /// 'UPSERT' | 'DELETE'
  operation     String
  /// 'PENDING' | 'FAILED'
  state         String   @default("PENDING")
  attempts      Int      @default(0)
  lastError     String   @default("")
  nextAttemptAt DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([entityType, entityId, provider])
  @@index([state, nextAttemptAt])
  @@index([userId])
}

/// Les divergences à arbitrer. Aucune n'est jamais écrasée en silence.
model SyncConflict {
  id         String @id @default(cuid())
  userId     String
  entityType String
  entityId   String
  provider   String
  /// 'REMOTE_MODIFIED' | 'REMOTE_DELETED'
  kind       String
  /// instantané de l'événement distant au moment de la détection.
  /// JSON lu et écrit en bloc uniquement — jamais interrogé finement.
  remoteSnapshotJson String   @default("{}")
  detectedAt         DateTime @default(now())
  resolvedAt         DateTime?
  /// '' tant que non arbitré, puis 'RETABLIR' | 'ACCEPTER' | 'DETACHER'
  resolution         String   @default("")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, resolvedAt])
  @@index([entityType, entityId, provider])
}

/// Les jetons, chiffrés au repos (AES-256-GCM). La clé vient de
/// l'environnement : la perdre impose de reconnecter le compte.
model ProviderCredential {
  id              String   @id @default(cuid())
  userId          String
  provider        String
  accessTokenEnc  String
  refreshTokenEnc String
  expiresAt       DateTime
  scope           String   @default("")
  /// le calendrier dédié, exclu de toute lecture d'occupation
  calendarId      String   @default("")
  connectedAt     DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, provider])
  @@index([userId])
}
```

Puis appliquer :

```bash
npm run db:sqlite
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/db/sync-schema.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Exposer la plage journée dans les réglages**

Ajouter à `src/services/settings.test.ts` — en complétant son import de
`./settings` avec `getSettings`, `updateSettings` et `validateSettingsPatch`
s'ils n'y sont pas déjà :

```ts
describe('plage journée', () => {
  it('vaut 9 h – 18 h par défaut', async () => {
    await prisma.settings.deleteMany({})
    const s = await getSettings()
    expect({ debut: s.journeeDebutMinute, fin: s.journeeFinMinute }).toEqual({
      debut: 540,
      fin: 1080,
    })
  })

  it('enregistre une plage explicite', async () => {
    const s = await updateSettings({ journeeDebutMinute: 480, journeeFinMinute: 960 })
    expect({ debut: s.journeeDebutMinute, fin: s.journeeFinMinute }).toEqual({
      debut: 480,
      fin: 960,
    })
  })

  it('refuse une fin antérieure ou égale au début', () => {
    expect(
      validateSettingsPatch({ journeeDebutMinute: 600, journeeFinMinute: 600 }),
    ).toEqual({
      ok: false,
      errors: ['La fin de la plage journée doit être postérieure à son début.'],
    })
  })

  it('refuse une borne hors des 24 heures', () => {
    expect(validateSettingsPatch({ journeeDebutMinute: -1 }).ok).toBe(false)
    expect(validateSettingsPatch({ journeeFinMinute: 1441 }).ok).toBe(false)
  })
})
```

Dans `src/services/settings.ts`, ajouter au `settingsPatchSchema` (avant `.partial()`) :

```ts
    journeeDebutMinute: z
      .number({ message: 'Le début de la plage journée est requis.' })
      .int('Le début de la plage journée doit être un nombre entier de minutes.')
      .min(0, 'Le début de la plage journée est invalide.')
      .max(1439, 'Le début de la plage journée est invalide.'),
    journeeFinMinute: z
      .number({ message: 'La fin de la plage journée est requise.' })
      .int('La fin de la plage journée doit être un nombre entier de minutes.')
      .min(1, 'La fin de la plage journée est invalide.')
      .max(1440, 'La fin de la plage journée est invalide.'),
```

et, après `.partial()`, la vérification croisée — elle ne s'applique que si le
patch porte les deux bornes, un patch partiel n'ayant rien à comparer :

```ts
  .superRefine((patch, ctx) => {
    if (
      patch.journeeDebutMinute !== undefined &&
      patch.journeeFinMinute !== undefined &&
      patch.journeeFinMinute <= patch.journeeDebutMinute
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'La fin de la plage journée doit être postérieure à son début.',
      })
    }
  })
```

Ajouter à `AppSettings` :

```ts
  /** début de la plage journée, minutes depuis minuit */
  journeeDebutMinute: number
  /** fin de la plage journée, minutes depuis minuit */
  journeeFinMinute: number
```

à `toAppSettings` :

```ts
    journeeDebutMinute: row.journeeDebutMinute,
    journeeFinMinute: row.journeeFinMinute,
```

et au `data` de `updateSettings` :

```ts
      ...(patch.journeeDebutMinute !== undefined && {
        journeeDebutMinute: patch.journeeDebutMinute,
      }),
      ...(patch.journeeFinMinute !== undefined && { journeeFinMinute: patch.journeeFinMinute }),
```

- [ ] **Step 6: Exposer la plage dans le formulaire d'administration**

Dans `src/app/(app)/admin/saisie/actions.ts`, au sein de l'appel à `updateSettings` de `saveSettings` :

```ts
      journeeDebutMinute: timeInputToMinutes(String(formData.get('journeeDebut') ?? '')),
      journeeFinMinute: timeInputToMinutes(String(formData.get('journeeFin') ?? '')),
```

avec, en haut du fichier :

```ts
/** 'HH:MM' -> minutes depuis minuit. NaN si illisible : la validation du
 *  service refusera le patch avec un message en français. */
function timeInputToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return NaN
  return Number(match[1]) * 60 + Number(match[2])
}
```

Dans `src/app/(app)/admin/saisie/SettingsForm.tsx`, ajouter dans le formulaire —
`minutesToTimeInput` et `timeInputToMinutes` y existent déjà pour les créneaux :

```tsx
<fieldset className="flex flex-col gap-2 border-t pt-4">
  <legend className="font-medium">Plage journée</legend>
  <p className="text-sm text-slate-600">
    Un bloc d’agenda sans créneau démarre au début de cette plage et n’en déborde jamais.
  </p>
  <div className="flex gap-3">
    <label className="flex flex-col text-sm">
      Début
      <input
        name="journeeDebut"
        type="time"
        defaultValue={minutesToTimeInput(settings.journeeDebutMinute)}
        className="rounded border px-2 py-1"
      />
    </label>
    <label className="flex flex-col text-sm">
      Fin
      <input
        name="journeeFin"
        type="time"
        defaultValue={minutesToTimeInput(settings.journeeFinMinute)}
        className="rounded border px-2 py-1"
      />
    </label>
  </div>
</fieldset>
```

- [ ] **Step 7: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): sync outbox as a set, conflicts, encrypted credentials, event etag"
```

---

## Task 2: Le chiffrement des jetons au repos

**Files:** Create `src/core/crypto/secret-box.ts`, `src/core/crypto/secret-box.test.ts`, `src/services/credentials.ts`, `src/services/credentials.test.ts`

**Interfaces:**
- Consumes: `ProviderCredential` de la tâche 1
- Produces:
  - `encryptSecret(plaintext: string, key: Buffer): string` · `decryptSecret(payload: string, key: Buffer): string` · `parseKey(base64: string): Buffer` · `class SecretBoxError`
  - `interface ProviderTokens { accessToken: string; refreshToken: string; expiresAt: Date; scope: string; calendarId: string }`
  - `saveCredential(userId: string, provider: string, tokens: ProviderTokens): Promise<void>`
  - `getCredential(userId: string, provider: string): Promise<ProviderTokens | null>`
  - `updateAccessToken(userId: string, provider: string, accessToken: string, expiresAt: Date): Promise<void>`
  - `setCalendarId(userId: string, provider: string, calendarId: string): Promise<void>`
  - `revokeCredential(userId: string, provider: string): Promise<void>`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/core/crypto/secret-box.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret, parseKey, SecretBoxError } from './secret-box'

const KEY = randomBytes(32)

describe('secret-box', () => {
  it('rend le clair après un aller-retour', () => {
    const chiffre = encryptSecret('1//refresh-token-de-longue-duree', KEY)
    expect(decryptSecret(chiffre, KEY)).toBe('1//refresh-token-de-longue-duree')
  })

  it('ne laisse jamais le clair apparaître dans le chiffré', () => {
    const chiffre = encryptSecret('1//refresh-token-de-longue-duree', KEY)
    expect(chiffre).not.toContain('refresh-token')
  })

  it('produit deux chiffrés différents pour le même clair', () => {
    // Sans vecteur d'initialisation aléatoire, deux jetons identiques
    // seraient reconnaissables l'un de l'autre dans la base.
    expect(encryptSecret('meme-secret', KEY)).not.toBe(encryptSecret('meme-secret', KEY))
  })

  it('refuse de déchiffrer avec une autre clé', () => {
    const chiffre = encryptSecret('secret', KEY)
    expect(() => decryptSecret(chiffre, randomBytes(32))).toThrow(SecretBoxError)
  })

  it('détecte une altération du chiffré', () => {
    const chiffre = encryptSecret('secret', KEY)
    const parts = chiffre.split('.')
    const altere = [parts[0], parts[1], parts[2], Buffer.from('autre').toString('base64')].join('.')
    expect(() => decryptSecret(altere, KEY)).toThrow(SecretBoxError)
  })

  it('refuse un format inconnu', () => {
    expect(() => decryptSecret('pas-un-jeton', KEY)).toThrow(SecretBoxError)
    expect(() => decryptSecret('v9.a.b.c', KEY)).toThrow(SecretBoxError)
  })

  it('gère un clair vide et un clair accentué', () => {
    expect(decryptSecret(encryptSecret('', KEY), KEY)).toBe('')
    expect(decryptSecret(encryptSecret('clé été à', KEY), KEY)).toBe('clé été à')
  })

  it('refuse une clé qui ne fait pas 32 octets', () => {
    expect(() => parseKey(randomBytes(16).toString('base64'))).toThrow(SecretBoxError)
    expect(() => encryptSecret('secret', randomBytes(16))).toThrow(SecretBoxError)
  })

  it('accepte une clé de 32 octets encodée en base64', () => {
    const key = randomBytes(32)
    expect(parseKey(key.toString('base64')).equals(key)).toBe(true)
  })
})
```

`src/services/credentials.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import {
  saveCredential,
  getCredential,
  updateAccessToken,
  setCalendarId,
  revokeCredential,
} from './credentials'

let userId = ''
let autreId = ''

const TOKENS = {
  accessToken: 'ya29.acces',
  refreshToken: '1//rafraichissement',
  expiresAt: new Date('2026-08-15T12:00:00.000Z'),
  scope: 'https://www.googleapis.com/auth/calendar',
  calendarId: 'cra@group.calendar.google.com',
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  const u = await prisma.user.create({
    data: { email: 'creds@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'creds-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  await prisma.providerCredential.deleteMany({})
})

afterAll(async () => {
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['creds@test.local', 'creds-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

describe('credentials', () => {
  it('rend les jetons après un aller-retour', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    expect(await getCredential(userId, 'GOOGLE')).toEqual(TOKENS)
  })

  it('ne stocke jamais un jeton en clair', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const row = await prisma.providerCredential.findFirstOrThrow({ where: { userId } })
    expect(row.accessTokenEnc).not.toContain('ya29')
    expect(row.refreshTokenEnc).not.toContain('rafraichissement')
  })

  it('remplace les jetons d une reconnexion sans créer de seconde ligne', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    await saveCredential(userId, 'GOOGLE', { ...TOKENS, accessToken: 'ya29.nouveau' })

    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(1)
    expect((await getCredential(userId, 'GOOGLE'))?.accessToken).toBe('ya29.nouveau')
  })

  it('renvoie null quand le compte n est pas connecté', async () => {
    expect(await getCredential(userId, 'GOOGLE')).toBeNull()
  })

  it('ne laisse pas voir les jetons d un autre utilisateur', async () => {
    await saveCredential(autreId, 'GOOGLE', TOKENS)
    expect(await getCredential(userId, 'GOOGLE')).toBeNull()
  })

  it('rafraîchit le seul jeton d accès', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const expire = new Date('2026-08-15T13:00:00.000Z')
    await updateAccessToken(userId, 'GOOGLE', 'ya29.rafraichi', expire)

    const relu = await getCredential(userId, 'GOOGLE')
    expect(relu?.accessToken).toBe('ya29.rafraichi')
    expect(relu?.expiresAt).toEqual(expire)
    // Le jeton de rafraîchissement, lui, ne bouge pas.
    expect(relu?.refreshToken).toBe(TOKENS.refreshToken)
  })

  it('enregistre le calendrier dédié', async () => {
    await saveCredential(userId, 'GOOGLE', { ...TOKENS, calendarId: '' })
    await setCalendarId(userId, 'GOOGLE', 'dedie@group.calendar.google.com')
    expect((await getCredential(userId, 'GOOGLE'))?.calendarId).toBe(
      'dedie@group.calendar.google.com',
    )
  })

  it('révoque la connexion', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    await revokeCredential(userId, 'GOOGLE')
    expect(await getCredential(userId, 'GOOGLE')).toBeNull()
  })

  // La spec le dit : perdre la clé impose de reconnecter le compte. Ce que ça
  // ne doit surtout pas faire, c'est casser l'application.
  it('se lit comme non connecté quand la clé a changé', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const ancienne = process.env.CREDENTIALS_KEY
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

    expect(await getCredential(userId, 'GOOGLE')).toBeNull()

    process.env.CREDENTIALS_KEY = ancienne
  })

  it('se lit comme non connecté quand la clé est absente', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const ancienne = process.env.CREDENTIALS_KEY
    delete process.env.CREDENTIALS_KEY

    expect(await getCredential(userId, 'GOOGLE')).toBeNull()

    process.env.CREDENTIALS_KEY = ancienne
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/core/crypto/ src/services/credentials.test.ts`
Expected: FAIL — `Failed to resolve import "./secret-box"` puis `"./credentials"`

- [ ] **Step 3: Écrire le coffre**

`src/core/crypto/secret-box.ts` :

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretBoxError'
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(
      `La clé de chiffrement doit faire ${KEY_BYTES} octets une fois décodée (${key.length} reçus).`,
    )
  }
}

/** Décode et valide la clé fournie par l'environnement. */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64')
  assertKey(key)
  return key
}

/**
 * AES-256-GCM. Le format porte sa version : le jour où l'algorithme change,
 * les jetons déjà stockés restent lisibles au lieu de devenir du bruit.
 * Le vecteur d'initialisation est tiré à chaque appel — sans lui, deux jetons
 * identiques produiraient le même chiffré et seraient reconnaissables en base.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const chiffre = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    chiffre.toString('base64'),
  ].join('.')
}

export function decryptSecret(payload: string, key: Buffer): string {
  assertKey(key)

  const parts = payload.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError('Le jeton chiffré est illisible : format inconnu.')
  }

  const iv = Buffer.from(parts[1] as string, 'base64')
  const tag = Buffer.from(parts[2] as string, 'base64')
  const chiffre = Buffer.from(parts[3] as string, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError('Le jeton chiffré est illisible : en-tête invalide.')
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([decipher.update(chiffre), decipher.final()]).toString('utf8')
  } catch {
    // GCM authentifie : une clé fausse et une donnée altérée échouent ici, et
    // c'est exactement ce qu'on veut — jamais un déchiffrement silencieux.
    throw new SecretBoxError(
      "Le jeton chiffré n'a pas pu être déchiffré : clé incorrecte ou donnée altérée.",
    )
  }
}
```

- [ ] **Step 4: Écrire le service**

`src/services/credentials.ts` :

```ts
import { prisma } from '@/db/client'
import { decryptSecret, encryptSecret, parseKey } from '@/core/crypto/secret-box'

export interface ProviderTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string
  calendarId: string
}

/**
 * La clé vient de l'environnement, jamais de la base : une base volée sans la
 * variable d'environnement ne donne accès à aucun agenda.
 */
function credentialsKey(): Buffer {
  const raw = process.env.CREDENTIALS_KEY ?? ''
  if (raw === '') {
    throw new Error(
      "CREDENTIALS_KEY est absente de l'environnement : les jetons ne peuvent être ni chiffrés ni relus.",
    )
  }
  return parseKey(raw)
}

export async function saveCredential(
  userId: string,
  provider: string,
  tokens: ProviderTokens,
): Promise<void> {
  const key = credentialsKey()
  const data = {
    accessTokenEnc: encryptSecret(tokens.accessToken, key),
    refreshTokenEnc: encryptSecret(tokens.refreshToken, key),
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    calendarId: tokens.calendarId,
  }

  await prisma.providerCredential.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ...data },
    update: data,
  })
}

/**
 * `null` couvre trois cas volontairement indistincts pour l'appelant : compte
 * jamais connecté, connexion révoquée, et clé perdue ou changée. Dans les
 * trois, la conduite à tenir est la même — reconnecter le compte — et surtout
 * l'application continue de fonctionner sans agenda.
 */
export async function getCredential(
  userId: string,
  provider: string,
): Promise<ProviderTokens | null> {
  const row = await prisma.providerCredential.findUnique({
    where: { userId_provider: { userId, provider } },
  })
  if (row === null) return null

  try {
    const key = credentialsKey()
    return {
      accessToken: decryptSecret(row.accessTokenEnc, key),
      refreshToken: decryptSecret(row.refreshTokenEnc, key),
      expiresAt: row.expiresAt,
      scope: row.scope,
      calendarId: row.calendarId,
    }
  } catch {
    return null
  }
}

export async function updateAccessToken(
  userId: string,
  provider: string,
  accessToken: string,
  expiresAt: Date,
): Promise<void> {
  await prisma.providerCredential.update({
    where: { userId_provider: { userId, provider } },
    data: { accessTokenEnc: encryptSecret(accessToken, credentialsKey()), expiresAt },
  })
}

export async function setCalendarId(
  userId: string,
  provider: string,
  calendarId: string,
): Promise<void> {
  await prisma.providerCredential.update({
    where: { userId_provider: { userId, provider } },
    data: { calendarId },
  })
}

export async function revokeCredential(userId: string, provider: string): Promise<void> {
  await prisma.providerCredential.deleteMany({ where: { userId, provider } })
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/core/crypto/ src/services/credentials.test.ts`
Expected: PASS — 9 + 10 = 19 tests

- [ ] **Step 6: Documenter la clé**

Ajouter à `.env.example` :

```
# Clé de chiffrement des jetons de connexion (32 octets en base64) :
#   openssl rand -base64 32
# La perdre impose de reconnecter Google Calendar — aucun jeton n'est récupérable sans elle.
CREDENTIALS_KEY="a-remplacer-par-32-octets-en-base64"
```

Ajouter au README, dans une section « Google Calendar » :

```md
## Google Calendar

Les jetons OAuth sont chiffrés au repos (AES-256-GCM) avec `CREDENTIALS_KEY`,
lue dans l'environnement et jamais stockée en base.

**Perdre `CREDENTIALS_KEY` impose de reconnecter le compte Google.** Aucun jeton
n'est récupérable sans elle : l'application se comportera comme un compte non
connecté — la saisie continue de fonctionner, la synchronisation reprend après
reconnexion depuis `/admin/sync`.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(security): encrypt provider tokens at rest with an env-provided key"
```

---

## Task 3: La construction de l'événement, pure et sans réseau

**Files:** Create `src/core/calendar/event.ts`, `src/core/calendar/event.test.ts`

**Interfaces:**
- Consumes: `Slot` et `slotDurationMinutes` de `src/core/time/slots.ts` ; la plage journée de la tâche 1
- Produces:
  - `interface CalendarEventDraft { summary; description; startLocal; endLocal; timeZone; transparency: 'opaque'; colorId; craEntryId }`
  - `buildCalendarEvent(args: BuildEventArgs): CalendarEventDraft`
  - `COULEUR_REALISE`, `COULEUR_PREVISIONNEL`

**La règle des heures.** Sans créneau, un bloc démarre à `journeeDebutMinute` et dure exactement le temps saisi — une règle unique qui couvre toutes les unités de saisie sans cas particulier. Il ne déborde jamais de `journeeFinMinute` : au-delà, il couvre la plage entière. C'est la lecture littérale de la spec (« une journée pleine couvre donc la plage entière ») et elle évite qu'une journée de dix heures pousse un bloc d'occupation jusqu'à 19 h dans l'agenda de quelqu'un. Avec un créneau, ce sont les bornes du créneau qui font foi, minuit franchi compris.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/calendar/event.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import type { Slot } from '../time/slots'
import { buildCalendarEvent, COULEUR_PREVISIONNEL, COULEUR_REALISE } from './event'

const MATIN: Slot = { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 }
const APRES_MIDI: Slot = {
  id: 'apres-midi',
  label: 'Après-midi',
  startMinute: 840,
  endMinute: 1080,
  centiemes: 50,
}
const NUIT: Slot = { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 }

function base() {
  return {
    entryId: 'entry-1',
    date: '2026-03-10',
    minutes: 480,
    kind: 'REALISE' as const,
    clientName: 'Acme',
    missionLabel: 'Refonte',
    lineLabel: 'Développement',
    slot: null as Slot | null,
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
    timeZone: 'Europe/Paris',
  }
}

describe('buildCalendarEvent — sans créneau', () => {
  it('démarre à la plage et dure exactement le temps saisi', () => {
    const e = buildCalendarEvent(base())
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T17:00:00'])
  })

  it('couvre la plage entière quand la journée vaut la plage', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 540 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T18:00:00'])
  })

  it('place une demi-journée sur la première moitié', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 240 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T13:00:00'])
  })

  it('place trois heures sur les trois premières heures', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 180 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T12:00:00'])
  })

  it('ne déborde jamais de la plage', () => {
    // Un bloc d'occupation qui filerait jusqu'à 20 h occuperait une soirée que
    // personne n'a vendue.
    const e = buildCalendarEvent({ ...base(), minutes: 660 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T18:00:00'])
  })

  it('suit une plage journée décalée', () => {
    const e = buildCalendarEvent({
      ...base(),
      minutes: 240,
      journeeDebutMinute: 480,
      journeeFinMinute: 960,
    })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T08:00:00', '2026-03-10T12:00:00'])
  })
})

describe('buildCalendarEvent — avec créneau', () => {
  it('prend les bornes du créneau, pas la plage par défaut', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 240, slot: APRES_MIDI })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T14:00:00', '2026-03-10T18:00:00'])
  })

  it('couvre le matin', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 240, slot: MATIN })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T13:00:00'])
  })

  it('franchit minuit sans se replier sur lui-même', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 480, slot: NUIT })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T22:00:00', '2026-03-11T06:00:00'])
  })

  it('ignore la durée saisie quand un créneau est choisi', () => {
    // Le créneau dit quand ; la durée saisie sert au CRA, pas à l'agenda.
    const court = buildCalendarEvent({ ...base(), minutes: 60, slot: APRES_MIDI })
    expect([court.startLocal, court.endLocal]).toEqual([
      '2026-03-10T14:00:00',
      '2026-03-10T18:00:00',
    ])
  })
})

describe('buildCalendarEvent — le reste de l événement', () => {
  it('titre le bloc client · mission · ligne', () => {
    expect(buildCalendarEvent(base()).summary).toBe('Acme · Refonte · Développement')
  })

  it('marque le bloc occupé', () => {
    expect(buildCalendarEvent(base()).transparency).toBe('opaque')
  })

  it('distingue le réalisé du prévisionnel par la couleur', () => {
    expect(buildCalendarEvent(base()).colorId).toBe(COULEUR_REALISE)
    expect(buildCalendarEvent({ ...base(), kind: 'PREVISIONNEL' }).colorId).toBe(
      COULEUR_PREVISIONNEL,
    )
    expect(COULEUR_REALISE).not.toBe(COULEUR_PREVISIONNEL)
  })

  it('porte l identifiant de la saisie, qui permet de retrouver les orphelins', () => {
    expect(buildCalendarEvent(base()).craEntryId).toBe('entry-1')
  })

  it('reporte le fuseau tel quel', () => {
    expect(buildCalendarEvent({ ...base(), timeZone: 'Indian/Reunion' }).timeZone).toBe(
      'Indian/Reunion',
    )
  })

  it('dit dans la description que la saisie fait foi', () => {
    expect(buildCalendarEvent(base()).description).toContain('la saisie fait foi')
    expect(buildCalendarEvent({ ...base(), kind: 'PREVISIONNEL' }).description).toContain(
      'prévisionnel',
    )
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/calendar/event.test.ts`
Expected: FAIL — `Failed to resolve import "./event"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/calendar/event.ts` :

```ts
import { slotDurationMinutes, type Slot } from '../time/slots'
import type { TimeEntryKind } from '../types'

/** Identifiants de couleur Google : Myrtille pour le réalisé, Banane pour le prévu. */
export const COULEUR_REALISE = '9'
export const COULEUR_PREVISIONNEL = '5'

export interface CalendarEventDraft {
  summary: string
  description: string
  /** heure locale naïve, 'YYYY-MM-DDTHH:MM:SS' — le fuseau est porté à part */
  startLocal: string
  endLocal: string
  /** fuseau IANA, ex. 'Europe/Paris' */
  timeZone: string
  /** le but même du bloc : occuper la plage */
  transparency: 'opaque'
  colorId: string
  /** retrouvé côté Google dans extendedProperties.private */
  craEntryId: string
}

export interface BuildEventArgs {
  entryId: string
  /** 'YYYY-MM-DD' */
  date: string
  minutes: number
  kind: TimeEntryKind
  clientName: string
  missionLabel: string
  lineLabel: string
  /** créneau porté par la saisie ; `null` pour une saisie à la journée */
  slot: Slot | null
  journeeDebutMinute: number
  journeeFinMinute: number
  timeZone: string
}

/**
 * Décale une date locale de N minutes et rend une heure locale naïve.
 *
 * L'arithmétique se fait en UTC sur une horloge murale traitée comme telle :
 * aucun décalage n'est appliqué, le fuseau reste porté par `timeZone`. C'est ce
 * qui rend la fonction pure et le franchissement de minuit trivial.
 */
function localAt(date: string, minutesFromMidnight: number): string {
  const minuit = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  )
  return new Date(minuit + minutesFromMidnight * 60_000).toISOString().slice(0, 19)
}

/**
 * Sans créneau : départ au début de la plage, durée exactement égale au temps
 * saisi, et jamais de débordement au-delà de la fin de plage. Une seule règle,
 * qui couvre journée, demi-journée et heures sans cas particulier.
 */
function journeeBounds(args: BuildEventArgs): [number, number] {
  const plage = Math.max(0, args.journeeFinMinute - args.journeeDebutMinute)
  return [args.journeeDebutMinute, args.journeeDebutMinute + Math.min(args.minutes, plage)]
}

export function buildCalendarEvent(args: BuildEventArgs): CalendarEventDraft {
  const [debut, fin] =
    args.slot === null
      ? journeeBounds(args)
      : [args.slot.startMinute, args.slot.startMinute + slotDurationMinutes(args.slot)]

  const nature = args.kind === 'REALISE' ? 'réalisé' : 'prévisionnel'

  return {
    summary: `${args.clientName} · ${args.missionLabel} · ${args.lineLabel}`,
    description: `Bloc ${nature} posé par le CRA. Ne pas modifier ici : la saisie fait foi.`,
    startLocal: localAt(args.date, debut),
    endLocal: localAt(args.date, fin),
    timeZone: args.timeZone,
    transparency: 'opaque',
    colorId: args.kind === 'REALISE' ? COULEUR_REALISE : COULEUR_PREVISIONNEL,
    craEntryId: args.entryId,
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/calendar/event.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer brièvement `Math.min(args.minutes, plage)` par `args.minutes`, et confirmer que « ne déborde jamais de la plage » échoue seul. Restaurer ensuite.

- [ ] **Step 6: Commit**

```bash
git add src/core/calendar/
git commit -m "feat(core): build a calendar block from a time entry, a slot and a day range"
```

---

## Task 4: La politique de la file — vocabulaire et recul progressif

**Files:** Create `src/core/sync/policy.ts`, `src/core/sync/policy.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `type SyncOperation = 'UPSERT' | 'DELETE'` · `type SyncState = 'PENDING' | 'FAILED'`
  - `type ConflictKind = 'REMOTE_MODIFIED' | 'REMOTE_DELETED'` · `type ConflictResolution = 'RETABLIR' | 'ACCEPTER' | 'DETACHER'`
  - `PROVIDER_GOOGLE = 'GOOGLE'` · `ENTITY_TIME_ENTRY = 'TimeEntry'`
  - `RETRY_DELAYS_MINUTES`, `MAX_ATTEMPTS`
  - `nextAttempt(attemptsSoFar: number, now: Date): { state: SyncState; attempts: number; nextAttemptAt: Date }`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/sync/policy.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { MAX_ATTEMPTS, RETRY_DELAYS_MINUTES, nextAttempt } from './policy'

const NOW = new Date('2026-03-10T10:00:00.000Z')

function apres(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000)
}

describe('nextAttempt', () => {
  it('respecte la séquence 1, 5, 15, 60, 360 minutes', () => {
    expect(nextAttempt(0, NOW).nextAttemptAt).toEqual(apres(1))
    expect(nextAttempt(1, NOW).nextAttemptAt).toEqual(apres(5))
    expect(nextAttempt(2, NOW).nextAttemptAt).toEqual(apres(15))
    expect(nextAttempt(3, NOW).nextAttemptAt).toEqual(apres(60))
    expect(nextAttempt(4, NOW).nextAttemptAt).toEqual(apres(360))
  })

  it('compte la tentative consommée', () => {
    expect(nextAttempt(0, NOW).attempts).toBe(1)
    expect(nextAttempt(3, NOW).attempts).toBe(4)
  })

  it('reste PENDING tant que le quota n est pas épuisé', () => {
    expect(nextAttempt(0, NOW).state).toBe('PENDING')
    expect(nextAttempt(3, NOW).state).toBe('PENDING')
  })

  it('passe à FAILED à la cinquième tentative', () => {
    // La ligne ne disparaît pas pour autant : elle remonte dans l'écran de
    // synchronisation, où elle se rejoue.
    expect(nextAttempt(4, NOW).state).toBe('FAILED')
    expect(nextAttempt(4, NOW).attempts).toBe(MAX_ATTEMPTS)
  })

  it('reste FAILED au-delà, sans plafonner le compteur au mauvais endroit', () => {
    const suite = nextAttempt(9, NOW)
    expect(suite.state).toBe('FAILED')
    expect(suite.attempts).toBe(10)
    expect(suite.nextAttemptAt).toEqual(apres(360))
  })

  it('ne planifie jamais une tentative dans le passé', () => {
    for (let i = 0; i < 8; i++) {
      expect(nextAttempt(i, NOW).nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime())
    }
  })

  it('expose une séquence de longueur cohérente avec le quota', () => {
    expect(RETRY_DELAYS_MINUTES).toEqual([1, 5, 15, 60, 360])
    expect(MAX_ATTEMPTS).toBe(5)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/sync/policy.test.ts`
Expected: FAIL — `Failed to resolve import "./policy"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/sync/policy.ts` :

```ts
export type SyncOperation = 'UPSERT' | 'DELETE'
export type SyncState = 'PENDING' | 'FAILED'
export type ConflictKind = 'REMOTE_MODIFIED' | 'REMOTE_DELETED'
export type ConflictResolution = 'RETABLIR' | 'ACCEPTER' | 'DETACHER'

export const SYNC_OPERATIONS: readonly SyncOperation[] = ['UPSERT', 'DELETE']
export const CONFLICT_RESOLUTIONS: readonly ConflictResolution[] = [
  'RETABLIR',
  'ACCEPTER',
  'DETACHER',
]

/** Le seul fournisseur du lot ; la colonne reste générique pour la suite. */
export const PROVIDER_GOOGLE = 'GOOGLE'
/** La seule entité synchronisée du lot : une ligne de temps, un événement. */
export const ENTITY_TIME_ENTRY = 'TimeEntry'

/** Recul progressif : 1 min, 5 min, 15 min, 1 h, 6 h. */
export const RETRY_DELAYS_MINUTES: readonly number[] = [1, 5, 15, 60, 360]
export const MAX_ATTEMPTS = 5

export interface NextAttempt {
  state: SyncState
  attempts: number
  nextAttemptAt: Date
}

/**
 * Décide de la suite après un échec.
 *
 * Au-delà du quota, l'état passe à `FAILED` — **et la ligne reste en base**.
 * Une file qui perdrait ses échecs produirait un agenda silencieusement faux,
 * exactement la dérive qu'on ne détecte que trois mois plus tard.
 */
export function nextAttempt(attemptsSoFar: number, now: Date): NextAttempt {
  const attempts = attemptsSoFar + 1
  const index = Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)
  const delai = RETRY_DELAYS_MINUTES[index] as number

  return {
    state: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
    attempts,
    nextAttemptAt: new Date(now.getTime() + delai * 60_000),
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/sync/policy.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/sync/
git commit -m "feat(core): sync queue vocabulary and progressive backoff"
```

---

## Task 5: Le connecteur Google et son double d'API

**Files:** Create `src/core/calendar/connector.ts`, `src/integrations/google/calendar.ts`, `src/integrations/google/fake-google-api.ts`, `src/integrations/google/calendar.test.ts`

**Interfaces:**
- Consumes: `CalendarEventDraft` (tâche 3)
- Produces:
  - `class CalendarApiError extends Error { readonly kind: 'NOT_FOUND' | 'UNAUTHORIZED' | 'UNAVAILABLE' }`
  - `interface RemoteEvent { externalId; etag; summary; startLocal; endLocal; timeZone; craEntryId }`
  - `interface BusyInterval { startIso: string; endIso: string }`
  - `interface CalendarConnector { readonly dedicatedCalendarId: string; createEvent; updateEvent; getEvent; deleteEvent; freeBusy }`
  - `type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>`
  - `createGoogleCalendarConnector(args: { fetchFn: FetchLike; accessToken: string; calendarId: string }): CalendarConnector`
  - `createFakeGoogleApi(): FakeGoogleApi`

**L'exigence absolue.** Le connecteur ne connaît qu'un `fetchFn` qu'on lui passe. Aucun test ne touche le réseau : ils lui passent tous `fake.fetchFn`. C'est le même connecteur — le vrai — qui est exercé, avec ses URLs, ses en-têtes et sa traduction des codes HTTP ; seul le transport est un double.

- [ ] **Step 1: Écrire le test qui échoue**

`src/integrations/google/calendar.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { CalendarApiError } from '@/core/calendar/connector'
import { buildCalendarEvent } from '@/core/calendar/event'
import { createGoogleCalendarConnector } from './calendar'
import { createFakeGoogleApi, type FakeGoogleApi } from './fake-google-api'

const DEDIE = 'cra-dedie@group.calendar.google.com'

let api: FakeGoogleApi

function connector(calendarId = DEDIE) {
  return createGoogleCalendarConnector({
    fetchFn: api.fetchFn,
    accessToken: 'ya29.acces',
    calendarId,
  })
}

function draft(entryId = 'entry-1') {
  return buildCalendarEvent({
    entryId,
    date: '2026-03-10',
    minutes: 480,
    kind: 'REALISE',
    clientName: 'Acme',
    missionLabel: 'Refonte',
    lineLabel: 'Développement',
    slot: null,
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
    timeZone: 'Europe/Paris',
  })
}

beforeEach(() => {
  api = createFakeGoogleApi()
})

describe('création et mise à jour', () => {
  it('crée un événement et rend son etag', async () => {
    const r = await connector().createEvent(draft())
    expect(r.externalId).not.toBe('')
    expect(r.etag).not.toBe('')
  })

  it('pousse le corps attendu', async () => {
    await connector().createEvent(draft())
    const corps = api.dernierAppel().body as Record<string, unknown>

    expect(corps.summary).toBe('Acme · Refonte · Développement')
    expect(corps.transparency).toBe('opaque')
    expect(corps.colorId).toBe('9')
    expect(corps.start).toEqual({ dateTime: '2026-03-10T09:00:00', timeZone: 'Europe/Paris' })
    expect(corps.end).toEqual({ dateTime: '2026-03-10T17:00:00', timeZone: 'Europe/Paris' })
    expect(corps.extendedProperties).toEqual({ private: { craEntryId: 'entry-1' } })
  })

  it('écrit dans le calendrier dédié, jamais dans l agenda principal', async () => {
    await connector().createEvent(draft())
    expect(api.dernierAppel().url).toContain(encodeURIComponent(DEDIE))
    expect(api.dernierAppel().url).not.toContain('/calendars/primary/')
  })

  it('porte le jeton d accès', async () => {
    await connector().createEvent(draft())
    expect(api.dernierAppel().headers.authorization).toBe('Bearer ya29.acces')
  })

  it('fait changer l etag à chaque mise à jour', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    const maj = await c.updateEvent(cree.externalId, draft())
    expect(maj.etag).not.toBe(cree.etag)
  })
})

describe('relecture', () => {
  it('rend l etag courant et l identifiant de saisie', async () => {
    const c = connector()
    const cree = await c.createEvent(draft('entry-42'))
    const lu = await c.getEvent(cree.externalId)

    expect(lu.etag).toBe(cree.etag)
    expect(lu.craEntryId).toBe('entry-42')
    expect(lu.startLocal).toBe('2026-03-10T09:00:00')
  })

  it('voit l etag bouger quand Google modifie l événement', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    api.toucherEvenement(cree.externalId, { summary: 'Déplacé à la main' })

    const lu = await c.getEvent(cree.externalId)
    expect(lu.etag).not.toBe(cree.etag)
    expect(lu.summary).toBe('Déplacé à la main')
  })

  it('traduit un 404 en NOT_FOUND', async () => {
    await expect(connector().getEvent('inconnu')).rejects.toMatchObject({
      name: 'CalendarApiError',
      kind: 'NOT_FOUND',
    })
  })

  it('traduit un 410 en NOT_FOUND', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    api.supprimerEvenement(cree.externalId, { gone: true })

    await expect(c.getEvent(cree.externalId)).rejects.toMatchObject({ kind: 'NOT_FOUND' })
  })

  it('traite un événement annulé comme disparu', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    api.annulerEvenement(cree.externalId)

    await expect(c.getEvent(cree.externalId)).rejects.toMatchObject({ kind: 'NOT_FOUND' })
  })
})

describe('suppression', () => {
  it('supprime l événement', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    await c.deleteEvent(cree.externalId)
    expect(api.events.has(cree.externalId)).toBe(false)
  })

  it('réussit sur un événement déjà absent', async () => {
    // Objectif atteint : l'événement n'est plus là. Échouer ici ferait tourner
    // la file en boucle sur une suppression déjà faite.
    await expect(connector().deleteEvent('inconnu')).resolves.toBeUndefined()
  })
})

describe('lecture d occupation', () => {
  it('exclut le calendrier dédié de la requête', async () => {
    // Sans cette exclusion, les blocs poussés par l'application entreraient en
    // conflit avec eux-mêmes.
    await connector().freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary', DEDIE],
    })

    const corps = api.dernierAppel().body as { items: Array<{ id: string }> }
    expect(corps.items).toEqual([{ id: 'primary' }])
  })

  it('rend les plages occupées', async () => {
    api.busy.set('primary', [
      { start: '2026-03-12T08:00:00.000Z', end: '2026-03-12T10:00:00.000Z' },
    ])

    const plages = await connector().freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary', DEDIE],
    })

    expect(plages).toEqual([
      { startIso: '2026-03-12T08:00:00.000Z', endIso: '2026-03-12T10:00:00.000Z' },
    ])
  })

  it('ne rend rien quand rien n est occupé', async () => {
    const plages = await connector().freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary'],
    })
    expect(plages).toEqual([])
  })
})

describe('pannes', () => {
  it('traduit une coupure réseau en UNAVAILABLE', async () => {
    api.failNext('RESEAU')
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
  })

  it('traduit un délai dépassé en UNAVAILABLE', async () => {
    api.failNext('EXPIRE')
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
  })

  it('traduit un 503 en UNAVAILABLE', async () => {
    api.failNext('SERVEUR')
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
  })

  it('traduit un jeton expiré en UNAUTHORIZED', async () => {
    api.expirerJeton()
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'UNAUTHORIZED' })
  })

  it('n émet jamais autre chose qu une CalendarApiError', async () => {
    api.failNext('RESEAU')
    await expect(connector().createEvent(draft())).rejects.toBeInstanceOf(CalendarApiError)
  })

  it('ne rejoue pas la panne à l appel suivant', async () => {
    const c = connector()
    api.failNext('RESEAU')
    await expect(c.createEvent(draft())).rejects.toThrow()
    await expect(c.createEvent(draft())).resolves.toMatchObject({ etag: expect.any(String) })
  })
})

describe('aucun appel au réseau', () => {
  it('passe exclusivement par le transport injecté', async () => {
    const c = connector()
    await c.createEvent(draft())
    await c.freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary'],
    })
    // Chaque requête est passée par le double : aucune n'a pu partir ailleurs.
    expect(api.calls.length).toBe(2)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/integrations/google/calendar.test.ts`
Expected: FAIL — `Failed to resolve import "@/core/calendar/connector"`

- [ ] **Step 3: Écrire l'interface du connecteur**

`src/core/calendar/connector.ts` :

```ts
import type { CalendarEventDraft } from './event'

export type CalendarErrorKind = 'NOT_FOUND' | 'UNAUTHORIZED' | 'UNAVAILABLE'

/**
 * La seule erreur qu'un connecteur a le droit d'émettre.
 *
 * Trois cas suffisent à décider quoi faire : `NOT_FOUND` ouvre un conflit,
 * `UNAUTHORIZED` se lit comme « non connecté », `UNAVAILABLE` se rejoue. Toute
 * exception brute qui remonterait jusqu'à la saisie serait un défaut : une
 * panne Google ne bloque jamais la saisie.
 */
export class CalendarApiError extends Error {
  readonly kind: CalendarErrorKind

  constructor(kind: CalendarErrorKind, message: string) {
    super(message)
    this.name = 'CalendarApiError'
    this.kind = kind
  }
}

export interface RemoteEvent {
  externalId: string
  etag: string
  summary: string
  /** heure locale naïve, 'YYYY-MM-DDTHH:MM:SS' */
  startLocal: string
  endLocal: string
  timeZone: string
  /** vide quand l'événement ne vient pas du CRA */
  craEntryId: string
}

export interface BusyInterval {
  /** instant absolu ISO 8601 */
  startIso: string
  endIso: string
}

export interface CalendarConnector {
  /** le calendrier dédié — exclu de toute lecture d'occupation */
  readonly dedicatedCalendarId: string

  createEvent(draft: CalendarEventDraft): Promise<{ externalId: string; etag: string }>
  updateEvent(externalId: string, draft: CalendarEventDraft): Promise<{ etag: string }>
  /** lève `CalendarApiError('NOT_FOUND')` quand l'événement n'existe plus */
  getEvent(externalId: string): Promise<RemoteEvent>
  /** réussit quand l'événement est déjà absent : l'objectif est atteint */
  deleteEvent(externalId: string): Promise<void>
  freeBusy(args: {
    startIso: string
    endIso: string
    calendarIds: string[]
  }): Promise<BusyInterval[]>
}
```

- [ ] **Step 4: Écrire le double de l'API**

`src/integrations/google/fake-google-api.ts` :

```ts
/**
 * Double en mémoire de l'API Google Calendar.
 *
 * **Aucun test n'appelle Google.** Ce fichier est le seul « Google » que la
 * suite connaisse ; il n'est jamais importé par le code applicatif. Il rejoue
 * les codes de retour qui comptent — 200, 401, 404, 410, 503 — et les pannes de
 * transport, pour que le connecteur réel soit exercé tel quel.
 */
import type { FetchLike } from './calendar'

export interface FakeCall {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

interface FakeEvent {
  id: string
  etag: string
  status: string
  body: Record<string, unknown>
}

export interface FakeGoogleApi {
  fetchFn: FetchLike
  calls: FakeCall[]
  events: Map<string, FakeEvent>
  /** plages occupées rendues par freeBusy, par identifiant de calendrier */
  busy: Map<string, Array<{ start: string; end: string }>>
  /** calendriers créés, par identifiant */
  calendars: Map<string, { id: string; summary: string }>
  /** jetons acceptés par l'échange OAuth, pour les tâches 7 et 10 */
  oauth: { accessToken: string; refreshToken: string; expiresIn: number; refusRefresh: boolean }

  failNext(mode: 'RESEAU' | 'EXPIRE' | 'SERVEUR'): void
  expirerJeton(): void
  retablirJeton(): void
  toucherEvenement(
    id: string,
    patch?: { summary?: string; startLocal?: string; endLocal?: string },
  ): void
  supprimerEvenement(id: string, options?: { gone?: boolean }): void
  annulerEvenement(id: string): void
  dernierAppel(): FakeCall
  appelsVers(fragment: string): FakeCall[]
}

const BASE = 'https://www.googleapis.com/calendar/v3'

export function createFakeGoogleApi(): FakeGoogleApi {
  const calls: FakeCall[] = []
  const events = new Map<string, FakeEvent>()
  const busy = new Map<string, Array<{ start: string; end: string }>>()
  const calendars = new Map<string, { id: string; summary: string }>()
  const gone = new Set<string>()
  const oauth = {
    accessToken: 'ya29.nouveau',
    refreshToken: '1//rafraichissement',
    expiresIn: 3600,
    refusRefresh: false,
  }

  let prochainEchec: 'RESEAU' | 'EXPIRE' | 'SERVEUR' | null = null
  let jetonExpire = false
  let seq = 0

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  /** Le connecteur envoie du JSON, l'échange de jetons un formulaire. */
  function lireCorps(init: { headers: Record<string, string>; body?: string }): unknown {
    if (init.body === undefined) return null
    if ((init.headers['content-type'] ?? '').includes('x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(init.body))
    }
    return JSON.parse(init.body)
  }

  const fetchFn: FetchLike = async (url, init) => {
    const body: unknown = lireCorps(init)
    calls.push({ method: init.method, url, headers: init.headers, body })

    if (prochainEchec !== null) {
      const mode = prochainEchec
      prochainEchec = null
      if (mode === 'RESEAU') throw new Error('fetch failed')
      if (mode === 'EXPIRE') {
        const err = new Error("Le délai d'attente est dépassé")
        err.name = 'TimeoutError'
        throw err
      }
      return json({ error: { message: 'Backend error' } }, 503)
    }

    // L'échange de jeton n'est pas soumis à l'expiration du jeton d'accès.
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (oauth.refusRefresh) return json({ error: 'invalid_grant' }, 400)
      return json({
        access_token: oauth.accessToken,
        refresh_token: oauth.refreshToken,
        expires_in: oauth.expiresIn,
        scope: 'https://www.googleapis.com/auth/calendar',
        token_type: 'Bearer',
      })
    }

    if (jetonExpire) return json({ error: { message: 'Invalid Credentials' } }, 401)

    if (url === `${BASE}/freeBusy`) {
      const demande = body as { items: Array<{ id: string }> }
      const calendriers: Record<string, { busy: Array<{ start: string; end: string }> }> = {}
      for (const item of demande.items) calendriers[item.id] = { busy: busy.get(item.id) ?? [] }
      return json({ calendars: calendriers })
    }

    if (url === `${BASE}/calendars` && init.method === 'POST') {
      const demande = body as { summary: string }
      seq += 1
      const id = `cal-${seq}@group.calendar.google.com`
      calendars.set(id, { id, summary: demande.summary })
      return json({ id, summary: demande.summary })
    }

    if (url.startsWith(`${BASE}/users/me/calendarList`)) {
      return json({ items: [...calendars.values()] })
    }

    const evenements = /\/calendars\/[^/]+\/events(?:\/([^/?]+))?/.exec(url)
    if (evenements !== null) {
      const id = evenements[1] === undefined ? null : decodeURIComponent(evenements[1])

      if (id === null && init.method === 'POST') {
        seq += 1
        const nouveau: FakeEvent = {
          id: `evt-${seq}`,
          etag: '"1"',
          status: 'confirmed',
          body: body as Record<string, unknown>,
        }
        events.set(nouveau.id, nouveau)
        return json({ ...nouveau.body, id: nouveau.id, etag: nouveau.etag, status: 'confirmed' })
      }

      if (id !== null) {
        if (gone.has(id)) return json({ error: { message: 'Resource has been deleted' } }, 410)

        const existant = events.get(id)
        if (existant === undefined) return json({ error: { message: 'Not Found' } }, 404)

        if (init.method === 'GET') {
          return json({
            ...existant.body,
            id: existant.id,
            etag: existant.etag,
            status: existant.status,
          })
        }

        if (init.method === 'PUT' || init.method === 'PATCH') {
          existant.body = body as Record<string, unknown>
          existant.etag = `"${Number(existant.etag.replaceAll('"', '')) + 1}"`
          return json({ ...existant.body, id: existant.id, etag: existant.etag })
        }

        if (init.method === 'DELETE') {
          events.delete(id)
          return new Response(null, { status: 204 })
        }
      }
    }

    return json({ error: { message: `Route non simulée : ${init.method} ${url}` } }, 404)
  }

  return {
    fetchFn,
    calls,
    events,
    busy,
    calendars,
    oauth,

    failNext(mode) {
      prochainEchec = mode
    },
    expirerJeton() {
      jetonExpire = true
    },
    retablirJeton() {
      jetonExpire = false
    },
    toucherEvenement(id, patch) {
      const e = events.get(id)
      if (e === undefined) throw new Error(`Événement inconnu du double : ${id}`)

      const bornes = e.body as {
        start?: { dateTime?: string; timeZone?: string }
        end?: { dateTime?: string; timeZone?: string }
      }
      if (patch?.summary !== undefined) e.body = { ...e.body, summary: patch.summary }
      if (patch?.startLocal !== undefined) {
        e.body = { ...e.body, start: { ...bornes.start, dateTime: patch.startLocal } }
      }
      if (patch?.endLocal !== undefined) {
        e.body = { ...e.body, end: { ...bornes.end, dateTime: patch.endLocal } }
      }

      // Google fait bouger l'etag à chaque modification : c'est exactement
      // l'empreinte sur laquelle repose toute la détection de divergence.
      e.etag = `"${Number(e.etag.replaceAll('"', '')) + 1}"`
    },
    supprimerEvenement(id, options) {
      events.delete(id)
      if (options?.gone === true) gone.add(id)
    },
    annulerEvenement(id) {
      const e = events.get(id)
      if (e === undefined) throw new Error(`Événement inconnu du double : ${id}`)
      e.status = 'cancelled'
    },
    dernierAppel() {
      const dernier = calls[calls.length - 1]
      if (dernier === undefined) throw new Error('Aucun appel enregistré par le double.')
      return dernier
    },
    appelsVers(fragment) {
      return calls.filter((c) => c.url.includes(fragment))
    },
  }
}
```

- [ ] **Step 5: Écrire le connecteur**

`src/integrations/google/calendar.ts` :

```ts
import {
  CalendarApiError,
  type BusyInterval,
  type CalendarConnector,
  type RemoteEvent,
} from '@/core/calendar/connector'
import type { CalendarEventDraft } from '@/core/calendar/event'

const BASE = 'https://www.googleapis.com/calendar/v3'

/**
 * Le transport est toujours injecté — c'est ce qui rend le connecteur testable
 * sans réseau, et donc testable tout court.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>

interface GoogleEvent {
  id: string
  etag: string
  status?: string
  summary?: string
  start?: { dateTime?: string; timeZone?: string }
  end?: { dateTime?: string; timeZone?: string }
  extendedProperties?: { private?: Record<string, string> }
}

function toBody(draft: CalendarEventDraft): Record<string, unknown> {
  return {
    summary: draft.summary,
    description: draft.description,
    start: { dateTime: draft.startLocal, timeZone: draft.timeZone },
    end: { dateTime: draft.endLocal, timeZone: draft.timeZone },
    transparency: draft.transparency,
    colorId: draft.colorId,
    extendedProperties: { private: { craEntryId: draft.craEntryId } },
  }
}

async function request(
  fetchFn: FetchLike,
  accessToken: string,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetchFn(url, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (err) {
    // Coupure réseau, DNS, délai dépassé : traduits, jamais relayés bruts.
    const message = err instanceof Error ? err.message : String(err)
    throw new CalendarApiError('UNAVAILABLE', `Agenda injoignable : ${message}`)
  }

  if (res.status === 404 || res.status === 410) {
    throw new CalendarApiError('NOT_FOUND', "L'événement n'existe plus dans l'agenda.")
  }
  if (res.status === 401 || res.status === 403) {
    throw new CalendarApiError('UNAUTHORIZED', "L'autorisation Google est expirée ou révoquée.")
  }
  if (res.status >= 400) {
    throw new CalendarApiError('UNAVAILABLE', `Agenda en erreur (HTTP ${res.status}).`)
  }
  if (res.status === 204) return null

  return (await res.json()) as unknown
}

function toRemote(raw: GoogleEvent): RemoteEvent {
  return {
    externalId: raw.id,
    etag: raw.etag,
    summary: raw.summary ?? '',
    startLocal: raw.start?.dateTime ?? '',
    endLocal: raw.end?.dateTime ?? '',
    timeZone: raw.start?.timeZone ?? '',
    craEntryId: raw.extendedProperties?.private?.craEntryId ?? '',
  }
}

export function createGoogleCalendarConnector(args: {
  fetchFn: FetchLike
  accessToken: string
  calendarId: string
}): CalendarConnector {
  const { fetchFn, accessToken, calendarId } = args
  const events = `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`

  return {
    dedicatedCalendarId: calendarId,

    async createEvent(draft) {
      const raw = (await request(fetchFn, accessToken, 'POST', events, toBody(draft))) as GoogleEvent
      return { externalId: raw.id, etag: raw.etag }
    },

    async updateEvent(externalId, draft) {
      const raw = (await request(
        fetchFn,
        accessToken,
        'PUT',
        `${events}/${encodeURIComponent(externalId)}`,
        toBody(draft),
      )) as GoogleEvent
      return { etag: raw.etag }
    },

    async getEvent(externalId) {
      const raw = (await request(
        fetchFn,
        accessToken,
        'GET',
        `${events}/${encodeURIComponent(externalId)}`,
      )) as GoogleEvent

      // Google conserve les événements annulés avec un 200 : sans cette
      // lecture, une suppression passerait pour une simple modification.
      if (raw.status === 'cancelled') {
        throw new CalendarApiError('NOT_FOUND', "L'événement a été annulé dans l'agenda.")
      }
      return toRemote(raw)
    },

    async deleteEvent(externalId) {
      try {
        await request(
          fetchFn,
          accessToken,
          'DELETE',
          `${events}/${encodeURIComponent(externalId)}`,
        )
      } catch (err) {
        // Un événement déjà disparu est un objectif atteint, pas un échec.
        if (err instanceof CalendarApiError && err.kind === 'NOT_FOUND') return
        throw err
      }
    },

    async freeBusy({ startIso, endIso, calendarIds }) {
      // L'exclusion vit ici, pas seulement chez l'appelant : sans elle, les
      // blocs poussés par l'application entreraient en conflit avec eux-mêmes.
      const items = calendarIds.filter((id) => id !== calendarId).map((id) => ({ id }))

      const raw = (await request(fetchFn, accessToken, 'POST', `${BASE}/freeBusy`, {
        timeMin: startIso,
        timeMax: endIso,
        items,
      })) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }

      const plages: BusyInterval[] = []
      for (const calendrier of Object.values(raw.calendars ?? {})) {
        for (const plage of calendrier.busy ?? []) {
          plages.push({ startIso: plage.start, endIso: plage.end })
        }
      }
      return plages
    },
  }
}
```

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/integrations/google/calendar.test.ts`
Expected: PASS — 22 tests

- [ ] **Step 7: Vérifier qu'aucun test ne peut atteindre le réseau**

```bash
grep -rn "globalThis.fetch\|global.fetch\|https://www.googleapis.com\|https://oauth2" src --include="*.test.ts" --include="*.test.tsx"
```

Expected: aucune ligne. Les seules occurrences des URLs Google vivent dans
`src/integrations/google/calendar.ts`, `oauth.ts` et `fake-google-api.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/core/calendar/connector.ts src/integrations/
git commit -m "feat(google): calendar connector over an injected transport, with an in-memory API double"
```

---

## Task 6: La mise en file, transactionnelle avec l'écriture

**Files:** Create `src/services/sync/outbox.ts`, `src/services/sync/outbox.test.ts`. Modify `src/services/time-entries.ts`, `src/services/time-entries.test.ts`

**Interfaces:**
- Consumes: `SyncOutbox` (tâche 1), `PROVIDER_GOOGLE`, `ENTITY_TIME_ENTRY`, `SyncOperation` (tâche 4)
- Produces:
  - `enqueueSync(tx: Prisma.TransactionClient, args: { userId; entityType; entityId; provider; operation: SyncOperation; now?: Date }): Promise<void>`
  - `enqueueTimeEntry(tx: Prisma.TransactionClient, args: { userId: string; entryId: string; operation: SyncOperation; now?: Date }): Promise<void>`
  - `saveEntry` et `convertPastForecast` mettent en file **dans la transaction d'écriture**

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/sync/outbox.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry, convertPastForecast } from '@/services/time-entries'
import { enqueueTimeEntry } from './outbox'

let userId = ''
let autreId = ''
let missionId = ''
let lineA = ''
let lineB = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'outbox@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'outbox-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('OUTBOX client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineA = (await createLine({ missionId, userId, label: 'A', soldCentiemes: 3000, tjmCents: 0 })).id
  lineB = (await createLine({ missionId, userId, label: 'B', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await prisma.cra.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
})

afterAll(async () => {
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['outbox@test.local', 'outbox-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'OUTBOX client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('mise en file', () => {
  // Le test central : la file est un ensemble, pas un journal.
  it('dix écritures sur la même cellule produisent une ligne', async () => {
    for (let i = 1; i <= 10; i++) {
      await saveEntry({
        userId,
        lineId: lineA,
        date: '2026-03-12',
        minutes: i * 30,
        kind: 'REALISE',
      })
    }

    const file = await prisma.syncOutbox.findMany({ where: { userId } })
    expect(file.length).toBe(1)
    expect(file[0]?.operation).toBe('UPSERT')
  })

  it('sépare deux cellules distinctes', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(2)
  })

  it('cible la saisie écrite, avec le bon fournisseur', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: lineA } })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })

    expect({
      entityType: ligne.entityType,
      entityId: ligne.entityId,
      provider: ligne.provider,
      userId: ligne.userId,
    }).toEqual({
      entityType: 'TimeEntry',
      entityId: entry.id,
      provider: 'GOOGLE',
      userId,
    })
  })

  it('bascule en DELETE sans créer de seconde ligne', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })

    const file = await prisma.syncOutbox.findMany({ where: { userId } })
    expect(file.length).toBe(1)
    expect(file[0]?.operation).toBe('DELETE')
  })

  it('remet la ligne en attente après un échec quand la cellule est réécrite', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    await prisma.syncOutbox.updateMany({
      where: { userId },
      data: { state: 'FAILED', attempts: 5, lastError: 'Agenda injoignable' },
    })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ state: ligne.state, attempts: ligne.attempts, lastError: ligne.lastError }).toEqual({
      state: 'PENDING',
      attempts: 0,
      lastError: '',
    })
  })

  it('ne met rien en file quand une suppression ne trouve rien à supprimer', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('met en file chaque saisie convertie', async () => {
    await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-10',
      minutes: 240,
      kind: 'PREVISIONNEL',
    })
    await saveEntry({
      userId,
      lineId: lineB,
      date: '2026-03-11',
      minutes: 240,
      kind: 'PREVISIONNEL',
    })
    await prisma.syncOutbox.deleteMany({})

    const r = await convertPastForecast(userId, '2026-03', '2026-03-20')
    expect(r.converted).toBe(2)
    expect(await prisma.syncOutbox.count({ where: { userId, operation: 'UPSERT' } })).toBe(2)
  })
})

describe('une écriture refusée ne met rien en file', () => {
  it('mois verrouillé', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00Z'), status: 'VALIDE' },
    })

    const r = await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-12',
      minutes: 240,
      kind: 'REALISE',
    })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('capacité dépassée en mode BLOCAGE', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    await prisma.syncOutbox.deleteMany({})

    const r = await saveEntry({
      userId,
      lineId: lineB,
      date: '2026-03-12',
      minutes: 240,
      kind: 'REALISE',
    })
    expect(r.ok).toBe(false)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('ligne non affectée', async () => {
    const r = await saveEntry({
      userId: autreId,
      lineId: lineA,
      date: '2026-03-12',
      minutes: 240,
      kind: 'REALISE',
    })
    expect(r).toEqual({ ok: false, reason: 'NON_AFFECTE' })
    expect(await prisma.syncOutbox.count()).toBe(0)
  })
})

describe('la mise en file est transactionnelle avec l écriture', () => {
  // Une écriture qui réussirait sans être mise en file produirait un agenda
  // silencieusement faux ; l'inverse pousserait un bloc pour une saisie qui
  // n'existe pas. Les deux tiennent dans la même transaction, ou aucune.
  it('une transaction interrompue ne laisse ni saisie ni ligne en file', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.timeEntry.create({
          data: {
            lineId: lineA,
            userId,
            date: new Date('2026-03-13T00:00:00.000Z'),
            minutes: 240,
            kind: 'REALISE',
            minutesParJour: 480,
          },
        })
        await enqueueTimeEntry(tx, { userId, entryId: e.id, operation: 'UPSERT' })
        throw new Error('interruption')
      }),
    ).rejects.toThrow('interruption')

    expect(
      await prisma.timeEntry.count({
        where: { userId, date: new Date('2026-03-13T00:00:00.000Z') },
      }),
    ).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/sync/outbox.test.ts`
Expected: FAIL — `Failed to resolve import "./outbox"`

- [ ] **Step 3: Écrire la mise en file**

`src/services/sync/outbox.ts` :

```ts
import type { Prisma } from '@prisma/client'
import { ENTITY_TIME_ENTRY, PROVIDER_GOOGLE, type SyncOperation } from '@/core/sync/policy'

/**
 * Inscrit une entité dans la file — **toujours dans la transaction d'écriture**.
 *
 * L'upsert sur le triplet est ce qui fait de la file un ensemble : dix
 * modifications d'une même cellule avant le prochain passage produisent une
 * ligne, pas dix. Chaque réécriture repart d'un compteur neuf : une nouvelle
 * intention mérite un nouveau quota de tentatives, et une ligne tombée en
 * `FAILED` redevient éligible dès que l'utilisateur retouche la cellule.
 */
export async function enqueueSync(
  tx: Prisma.TransactionClient,
  args: {
    userId: string
    entityType: string
    entityId: string
    provider: string
    operation: SyncOperation
    now?: Date
  },
): Promise<void> {
  const now = args.now ?? new Date()
  const cible = {
    entityType: args.entityType,
    entityId: args.entityId,
    provider: args.provider,
  }

  await tx.syncOutbox.upsert({
    where: { entityType_entityId_provider: cible },
    create: {
      ...cible,
      userId: args.userId,
      operation: args.operation,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: now,
    },
    update: {
      operation: args.operation,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: now,
    },
  })
}

/** La cible unique du lot : une ligne de temps vers Google. */
export async function enqueueTimeEntry(
  tx: Prisma.TransactionClient,
  args: { userId: string; entryId: string; operation: SyncOperation; now?: Date },
): Promise<void> {
  await enqueueSync(tx, {
    userId: args.userId,
    entityType: ENTITY_TIME_ENTRY,
    entityId: args.entryId,
    provider: PROVIDER_GOOGLE,
    operation: args.operation,
    ...(args.now === undefined ? {} : { now: args.now }),
  })
}
```

- [ ] **Step 4: Coupler la mise en file à l'écriture**

Dans `src/services/time-entries.ts`, ajouter l'import :

```ts
import { enqueueTimeEntry } from './sync/outbox'
```

Remplacer la branche de suppression de `saveEntry` :

```ts
  if (args.minutes === 0) {
    // La suppression et sa mise en file tiennent dans la même transaction :
    // une suppression qui échapperait à la file laisserait un bloc fantôme
    // occuper une journée qu'on pourrait revendre.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.timeEntry.findUnique({
        where: {
          lineId_userId_date_slotId: { lineId: args.lineId, userId: args.userId, date, slotId },
        },
        select: { id: true },
      })
      if (existing === null) return

      await tx.timeEntry.delete({ where: { id: existing.id } })
      await enqueueTimeEntry(tx, {
        userId: args.userId,
        entryId: existing.id,
        operation: 'DELETE',
      })
    })

    return { ok: true, minutes: 0 }
  }
```

Remplacer l'`upsert` final :

```ts
  await prisma.$transaction(async (tx) => {
    const entry = await tx.timeEntry.upsert({
      where: {
        lineId_userId_date_slotId: { lineId: args.lineId, userId: args.userId, date, slotId },
      },
      create: {
        lineId: args.lineId,
        userId: args.userId,
        date,
        slotId,
        minutes: args.minutes,
        kind: args.kind,
        minutesParJour,
      },
      update: { minutes: args.minutes, kind: args.kind, minutesParJour },
    })

    await enqueueTimeEntry(tx, { userId: args.userId, entryId: entry.id, operation: 'UPSERT' })
  })
```

Et, dans `convertPastForecast`, remplacer le bloc `updateMany` :

```ts
  if (convertibles.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.updateMany({
        where: { id: { in: convertibles.map((e) => e.id) }, userId },
        data: { kind: 'REALISE' },
      })

      // Le prévisionnel converti change de couleur dans l'agenda : chaque
      // saisie repart donc dans la file, dans la transaction qui la convertit.
      for (const e of convertibles) {
        await enqueueTimeEntry(tx, { userId, entryId: e.id, operation: 'UPSERT' })
      }
    })
  }
```

- [ ] **Step 5: Nettoyer la file dans la suite existante**

Dans `src/services/time-entries.test.ts`, ajouter au `beforeEach`, **avant** la
suppression des saisies (la file survit à la saisie qu'elle vise) :

```ts
  await prisma.syncOutbox.deleteMany({})
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/sync/outbox.test.ts src/services/time-entries.test.ts`
Expected: PASS — 11 tests nouveaux plus tous les existants

- [ ] **Step 7: Vérifier par mutation**

Sortir brièvement l'appel à `enqueueTimeEntry` de la transaction de `saveEntry`
(le placer après le `$transaction`) et confirmer que « une transaction
interrompue ne laisse ni saisie ni ligne en file » reste vert mais que le
couplage a disparu ; puis retirer complètement l'appel et confirmer que « dix
écritures sur la même cellule produisent une ligne » échoue. Restaurer ensuite.

- [ ] **Step 8: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(sync): enqueue time entries in the same transaction as the write"
```

---

## Task 7: Le drainage — pousser, détecter la divergence, ne jamais bloquer la saisie

**Files:** Create `src/integrations/google/oauth.ts`, `src/services/sync/connector.ts`, `src/services/sync/flush.ts`, `src/services/sync/flush.test.ts`

**Interfaces:**
- Consumes: `enqueueTimeEntry` (6), `buildCalendarEvent` (3), `CalendarConnector` / `CalendarApiError` (5), `nextAttempt` (4), `getCredential` / `updateAccessToken` (2)
- Produces:
  - `refreshAccessToken(fetchFn: FetchLike, refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>`
  - `TIME_ZONE: string`
  - `resolveConnector(userId: string, deps?: { fetchFn?: FetchLike; now?: Date }): Promise<CalendarConnector | null>`
  - `interface FlushReport { nonConnecte: boolean; traitees: number; reussies: number; conflits: number; echecs: number }`
  - `flushSyncOutbox(args: { userId: string; limit?: number; now?: Date; connector?: CalendarConnector | null; fetchFn?: FetchLike }): Promise<FlushReport>`

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/sync/flush.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { saveCredential } from '@/services/credentials'
import { createGoogleCalendarConnector } from '@/integrations/google/calendar'
import { createFakeGoogleApi, type FakeGoogleApi } from '@/integrations/google/fake-google-api'
import { flushSyncOutbox } from './flush'

const DEDIE = 'cra-dedie@group.calendar.google.com'
const NOW = new Date('2026-03-20T10:00:00.000Z')

let userId = ''
let autreId = ''
let lineA = ''
let api: FakeGoogleApi

function connector() {
  return createGoogleCalendarConnector({
    fetchFn: api.fetchFn,
    accessToken: 'ya29.acces',
    calendarId: DEDIE,
  })
}

function lien(entityId: string) {
  return prisma.externalLink.findFirst({
    where: { entityType: 'TimeEntry', entityId, provider: 'GOOGLE' },
  })
}

async function saisir(date: string, minutes = 240): Promise<string> {
  const r = await saveEntry({ userId, lineId: lineA, date, minutes, kind: 'REALISE' })
  expect(r.ok).toBe(true)
  const entry = await prisma.timeEntry.findFirstOrThrow({
    where: { userId, lineId: lineA, date: new Date(`${date}T00:00:00.000Z`) },
  })
  return entry.id
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'flush@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'flush-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('FLUSH client')
  const m = await createMission({ clientId: c.id, label: 'Refonte' })
  lineA = (
    await createLine({ missionId: m.id, userId, label: 'Dév', soldCentiemes: 3000, tjmCents: 0 })
  ).id
})

beforeEach(async () => {
  api = createFakeGoogleApi()
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
  })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['flush@test.local', 'flush-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'FLUSH client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('poussée', () => {
  it('pousse la saisie, enregistre l etag et vide la file', async () => {
    const entryId = await saisir('2026-03-12')

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r).toEqual({ nonConnecte: false, traitees: 1, reussies: 1, conflits: 0, echecs: 0 })

    const link = await lien(entryId)
    expect(link?.externalId).not.toBe('')
    expect(link?.etag).not.toBe('')
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('pousse un événement porteur du titre et des heures attendus', async () => {
    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const corps = api.dernierAppel().body as Record<string, unknown>
    expect(corps.summary).toBe('FLUSH client · Refonte · Dév')
    expect(corps.start).toEqual({ dateTime: '2026-03-12T09:00:00', timeZone: expect.any(String) })
  })

  it('ne repousse rien au drainage suivant', async () => {
    await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const appels = api.calls.length

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.traitees).toBe(0)
    expect(api.calls.length).toBe(appels)
  })

  it('met à jour l événement existant au lieu d en créer un second', async () => {
    const entryId = await saisir('2026-03-12', 240)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(api.events.size).toBe(1)
    const link = await lien(entryId)
    expect(link?.etag).toBe('"2"')
  })

  it('consomme la ligne quand la saisie a disparu entre-temps', async () => {
    const entryId = await saisir('2026-03-12')
    await prisma.timeEntry.delete({ where: { id: entryId } })

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.reussies).toBe(1)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })
})

describe('détection de divergence', () => {
  // Le cœur du dispositif : on lit avant d'écrire, et on n'écrase jamais.
  it('un etag différent crée un conflit et n écrit rien', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const link = await lien(entryId)
    api.toucherEvenement(link?.externalId as string, { summary: 'Déplacé à la main' })
    await saisir('2026-03-12', 480)

    const avant = api.calls.length
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.conflits).toBe(1)
    const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId } })
    expect({ kind: conflit.kind, resolvedAt: conflit.resolvedAt }).toEqual({
      kind: 'REMOTE_MODIFIED',
      resolvedAt: null,
    })

    // Aucune écriture : seul le GET de détection est parti.
    const nouveaux = api.calls.slice(avant)
    expect(nouveaux.map((c) => c.method)).toEqual(['GET'])
    expect((api.events.get(link?.externalId as string)?.body as { summary: string }).summary).toBe(
      'Déplacé à la main',
    )
  })

  it('garde l instantané de ce que Google porte', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const link = await lien(entryId)
    api.toucherEvenement(link?.externalId as string, { summary: 'Déplacé à la main' })
    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId } })
    const snapshot = JSON.parse(conflit.remoteSnapshotJson) as Record<string, string>
    expect(snapshot.summary).toBe('Déplacé à la main')
    expect(snapshot.etag).toBe('"2"')
  })

  it('ne rouvre pas un second conflit sur la même divergence', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const link = await lien(entryId)
    api.toucherEvenement(link?.externalId as string)

    await saisir('2026-03-12', 480)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    await saisir('2026-03-12', 300)
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(await prisma.syncConflict.count({ where: { userId, resolvedAt: null } })).toBe(1)
  })

  it('un événement supprimé chez Google crée un conflit REMOTE_DELETED', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    const link = await lien(entryId)
    api.supprimerEvenement(link?.externalId as string, { gone: true })

    await saisir('2026-03-12', 480)
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.conflits).toBe(1)
    const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId } })
    expect(conflit.kind).toBe('REMOTE_DELETED')
    // Le lien survit : l'arbitrage en a besoin pour rétablir ou détacher.
    expect(await lien(entryId)).not.toBeNull()
  })
})

describe('suppression', () => {
  it('supprime l événement puis le lien', async () => {
    const entryId = await saisir('2026-03-12')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    expect(r.reussies).toBe(1)
    expect(api.events.size).toBe(0)
    expect(await lien(entryId)).toBeNull()
  })

  it('consomme la ligne quand la saisie n avait jamais été poussée', async () => {
    await saisir('2026-03-12')
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.reussies).toBe(1)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })
})

describe('échecs et recul progressif', () => {
  it('recule sans perdre la ligne', async () => {
    await saisir('2026-03-12')
    api.failNext('RESEAU')

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r).toEqual({ nonConnecte: false, traitees: 1, reussies: 0, conflits: 0, echecs: 0 })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect(ligne.attempts).toBe(1)
    expect(ligne.state).toBe('PENDING')
    expect(ligne.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000))
    expect(ligne.lastError).toContain('Agenda injoignable')
  })

  it('ne rejoue pas la ligne avant sa date d éligibilité', async () => {
    await saisir('2026-03-12')
    api.failNext('RESEAU')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.traitees).toBe(0)
  })

  // La ligne remonte dans l'écran de synchronisation au lieu de disparaître.
  it('cinq échecs passent l état à FAILED sans perdre la ligne', async () => {
    await saisir('2026-03-12')

    let instant = NOW
    for (let i = 0; i < 5; i++) {
      api.failNext('SERVEUR')
      await flushSyncOutbox({ userId, now: instant, connector: connector() })
      const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
      instant = new Date(ligne.nextAttemptAt.getTime())
    }

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ state: ligne.state, attempts: ligne.attempts }).toEqual({
      state: 'FAILED',
      attempts: 5,
    })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(1)
  })
})

describe('résilience — une panne Google ne bloque jamais la saisie', () => {
  it('compte non connecté : la file reste intacte et rien n est marqué en échec', async () => {
    await saisir('2026-03-12')

    const r = await flushSyncOutbox({ userId, now: NOW, fetchFn: api.fetchFn })
    expect(r).toEqual({ nonConnecte: true, traitees: 0, reussies: 0, conflits: 0, echecs: 0 })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ state: ligne.state, attempts: ligne.attempts }).toEqual({
      state: 'PENDING',
      attempts: 0,
    })
  })

  it('jeton expiré et non rafraîchissable : se lit comme non connecté', async () => {
    await saveCredential(userId, 'GOOGLE', {
      accessToken: 'ya29.perime',
      refreshToken: '1//perime',
      expiresAt: new Date(NOW.getTime() - 60_000),
      scope: 'calendar',
      calendarId: DEDIE,
    })
    api.oauth.refusRefresh = true
    await saisir('2026-03-12')

    const r = await flushSyncOutbox({ userId, now: NOW, fetchFn: api.fetchFn })
    expect(r.nonConnecte).toBe(true)
  })

  it('jeton expiré mais rafraîchissable : renouvelé, puis la poussée aboutit', async () => {
    await saveCredential(userId, 'GOOGLE', {
      accessToken: 'ya29.perime',
      refreshToken: '1//valide',
      expiresAt: new Date(NOW.getTime() - 60_000),
      scope: 'calendar',
      calendarId: DEDIE,
    })
    await saisir('2026-03-12')

    const r = await flushSyncOutbox({ userId, now: NOW, fetchFn: api.fetchFn })
    expect(r.reussies).toBe(1)
    expect(api.appelsVers('oauth2.googleapis.com/token').length).toBe(1)
    expect(api.dernierAppel().headers.authorization).toBe('Bearer ya29.nouveau')
  })

  // Le test qui protège le cas d'usage quotidien.
  it('la saisie reste possible pendant que Google est en panne', async () => {
    api.failNext('EXPIRE')
    await flushSyncOutbox({ userId, now: NOW, connector: connector() })

    const r = await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-13',
      minutes: 480,
      kind: 'REALISE',
    })
    expect(r).toEqual({ ok: true, minutes: 480 })
    expect(await prisma.timeEntry.count({ where: { userId } })).toBe(1)
  })
})

describe('isolation par utilisateur', () => {
  it('ne draine que la file de l utilisateur demandé', async () => {
    await saisir('2026-03-12')
    await prisma.syncOutbox.create({
      data: {
        userId: autreId,
        entityType: 'TimeEntry',
        entityId: 'entry-autre',
        provider: 'GOOGLE',
        operation: 'UPSERT',
      },
    })

    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.traitees).toBe(1)
    expect(await prisma.syncOutbox.count({ where: { userId: autreId } })).toBe(1)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/sync/flush.test.ts`
Expected: FAIL — `Failed to resolve import "./flush"`

- [ ] **Step 3: Écrire le rafraîchissement du jeton**

`src/integrations/google/oauth.ts` :

```ts
import type { FetchLike } from './calendar'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

async function postToken(fetchFn: FetchLike, params: Record<string, string>): Promise<TokenResponse> {
  let res: Response
  try {
    // Le point d'API des jetons de Google attend un formulaire, pas du JSON :
    // envoyer du JSON ici produit un `invalid_request` que rien dans les tests
    // ne rattraperait, puisque le double, lui, accepterait les deux.
    res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new GoogleOAuthError(`Google injoignable : ${message}`)
  }

  if (res.status >= 400) {
    throw new GoogleOAuthError(`Google a refusé la demande de jeton (HTTP ${res.status}).`)
  }
  return (await res.json()) as TokenResponse
}

/**
 * Renouvelle le seul jeton d'accès. Le jeton de rafraîchissement, lui, ne
 * bouge pas : c'est le secret de longue durée, et Google ne le renvoie qu'au
 * premier consentement.
 */
export async function refreshAccessToken(
  fetchFn: FetchLike,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const body = await postToken(fetchFn, {
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new GoogleOAuthError("Google n'a pas renvoyé de jeton d'accès.")
  }

  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
  }
}

export { postToken, type TokenResponse }
```

- [ ] **Step 4: Écrire la résolution du connecteur**

`src/services/sync/connector.ts` :

```ts
import type { CalendarConnector } from '@/core/calendar/connector'
import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { createGoogleCalendarConnector, type FetchLike } from '@/integrations/google/calendar'
import { refreshAccessToken } from '@/integrations/google/oauth'
import { getCredential, updateAccessToken } from '@/services/credentials'

/** Fuseau des blocs poussés. Un déploiement hors métropole le surcharge. */
export const TIME_ZONE = process.env.CRA_TIMEZONE ?? 'Europe/Paris'

/** Marge avant expiration : un jeton qui expire dans la minute est déjà mort. */
const MARGE_MS = 60_000

/**
 * Rend un connecteur prêt à l'emploi, ou `null`.
 *
 * `null` couvre tous les cas où l'agenda n'est pas joignable pour de bon :
 * compte non connecté, calendrier dédié absent, clé de chiffrement perdue,
 * rafraîchissement refusé. Un seul `null` à traiter chez l'appelant, et aucune
 * exception qui puisse remonter jusqu'à la page de saisie.
 */
export async function resolveConnector(
  userId: string,
  deps: { fetchFn?: FetchLike; now?: Date } = {},
): Promise<CalendarConnector | null> {
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as unknown as FetchLike)
  const now = deps.now ?? new Date()

  let creds: Awaited<ReturnType<typeof getCredential>>
  try {
    creds = await getCredential(userId, PROVIDER_GOOGLE)
  } catch {
    return null
  }
  if (creds === null || creds.calendarId === '') return null

  let accessToken = creds.accessToken
  if (creds.expiresAt.getTime() <= now.getTime() + MARGE_MS) {
    try {
      const renouvele = await refreshAccessToken(fetchFn, creds.refreshToken)
      accessToken = renouvele.accessToken
      await updateAccessToken(userId, PROVIDER_GOOGLE, renouvele.accessToken, renouvele.expiresAt)
    } catch {
      // Un rafraîchissement impossible se lit comme « non connecté » : la
      // saisie continue, la synchronisation reprendra à la reconnexion.
      return null
    }
  }

  return createGoogleCalendarConnector({ fetchFn, accessToken, calendarId: creds.calendarId })
}
```

- [ ] **Step 5: Écrire le drainage**

`src/services/sync/flush.ts` :

```ts
import { prisma } from '@/db/client'
import { CalendarApiError, type CalendarConnector } from '@/core/calendar/connector'
import { buildCalendarEvent } from '@/core/calendar/event'
import { nextAttempt, type ConflictKind } from '@/core/sync/policy'
import type { TimeEntryKind } from '@/core/types'
import type { FetchLike } from '@/integrations/google/calendar'
import { getSettings } from '@/services/settings'
import { toIsoDate } from '@/services/time-entries'
import { resolveConnector, TIME_ZONE } from './connector'

export interface FlushReport {
  /** aucun compte joignable : rien n'a été tenté, rien n'a été marqué en échec */
  nonConnecte: boolean
  traitees: number
  reussies: number
  conflits: number
  echecs: number
}

type Row = Awaited<ReturnType<typeof prisma.syncOutbox.findFirstOrThrow>>

function cibleDe(row: Row) {
  return { entityType: row.entityType, entityId: row.entityId, provider: row.provider }
}

/** Message d'échec borné : la colonne n'est pas un journal d'exécution. */
function messageDe(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  return brut.slice(0, 500)
}

/**
 * Ouvre — ou rafraîchit — la divergence à arbitrer.
 *
 * Idempotent par construction : tant qu'un conflit reste ouvert sur la même
 * cible, on le met à jour au lieu d'en empiler un second. Un écran d'arbitrage
 * qui listerait dix fois la même divergence ne serait pas arbitrable.
 */
async function ouvrirConflit(row: Row, kind: ConflictKind, snapshot: unknown): Promise<void> {
  const ouvert = await prisma.syncConflict.findFirst({
    where: { userId: row.userId, ...cibleDe(row), resolvedAt: null },
  })
  const data = { kind, remoteSnapshotJson: JSON.stringify(snapshot), detectedAt: new Date() }

  if (ouvert === null) {
    await prisma.syncConflict.create({ data: { userId: row.userId, ...cibleDe(row), ...data } })
  } else {
    await prisma.syncConflict.update({ where: { id: ouvert.id }, data })
  }
}

type Issue = 'OK' | 'CONFLIT'

async function traiterUpsert(
  connector: CalendarConnector,
  row: Row,
  now: Date,
): Promise<Issue> {
  const entry = await prisma.timeEntry.findFirst({
    where: { id: row.entityId, userId: row.userId },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  // La saisie a disparu entre la mise en file et le drainage : plus rien à
  // pousser. La ligne DELETE, elle, aura été mise en file par la suppression.
  if (entry === null) return 'OK'

  const settings = await getSettings()
  const draft = buildCalendarEvent({
    entryId: entry.id,
    date: toIsoDate(entry.date),
    minutes: entry.minutes,
    kind: entry.kind as TimeEntryKind,
    clientName: entry.line.mission.client.name,
    missionLabel: entry.line.mission.label,
    lineLabel: entry.line.label,
    slot: entry.slotId === '' ? null : (settings.slots.find((s) => s.id === entry.slotId) ?? null),
    journeeDebutMinute: settings.journeeDebutMinute,
    journeeFinMinute: settings.journeeFinMinute,
    timeZone: TIME_ZONE,
  })

  const link = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: cibleDe(row) },
  })

  if (link === null) {
    const cree = await connector.createEvent(draft)
    await prisma.externalLink.create({
      data: {
        ...cibleDe(row),
        externalId: cree.externalId,
        etag: cree.etag,
        syncState: 'SYNCED',
        syncedAt: now,
      },
    })
    return 'OK'
  }

  // On lit avant d'écrire. C'est le seul moment où une modification faite dans
  // Google peut être vue — et le seul endroit où on peut refuser de l'écraser.
  let remote
  try {
    remote = await connector.getEvent(link.externalId)
  } catch (err) {
    if (err instanceof CalendarApiError && err.kind === 'NOT_FOUND') {
      await ouvrirConflit(row, 'REMOTE_DELETED', { externalId: link.externalId })
      return 'CONFLIT'
    }
    throw err
  }

  if (link.etag !== '' && remote.etag !== link.etag) {
    await ouvrirConflit(row, 'REMOTE_MODIFIED', remote)
    // Et surtout : aucune écriture. La divergence part en arbitrage.
    return 'CONFLIT'
  }

  const maj = await connector.updateEvent(link.externalId, draft)
  await prisma.externalLink.update({
    where: { id: link.id },
    data: { etag: maj.etag, syncState: 'SYNCED', syncedAt: now },
  })
  return 'OK'
}

async function traiterSuppression(connector: CalendarConnector, row: Row): Promise<Issue> {
  const link = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: cibleDe(row) },
  })
  // Jamais poussée, donc rien à retirer de l'agenda.
  if (link === null) return 'OK'

  // Un événement déjà absent est absorbé par le connecteur : l'objectif est
  // atteint, la ligne peut être consommée.
  await connector.deleteEvent(link.externalId)
  await prisma.externalLink.delete({ where: { id: link.id } })
  return 'OK'
}

export async function flushSyncOutbox(args: {
  userId: string
  limit?: number
  now?: Date
  /** injecté par les tests ; `null` force le cas « non connecté » */
  connector?: CalendarConnector | null
  fetchFn?: FetchLike
}): Promise<FlushReport> {
  const now = args.now ?? new Date()
  const vide: FlushReport = {
    nonConnecte: true,
    traitees: 0,
    reussies: 0,
    conflits: 0,
    echecs: 0,
  }

  const connector =
    args.connector !== undefined
      ? args.connector
      : await resolveConnector(args.userId, {
          ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
          now,
        })

  // Rien n'est marqué en échec : un compte non connecté n'est pas une panne de
  // synchronisation, et consommer des tentatives ici viderait le quota avant
  // même que l'utilisateur ait connecté son agenda.
  if (connector === null) return vide

  const rows = await prisma.syncOutbox.findMany({
    where: { userId: args.userId, state: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: args.limit ?? 50,
  })

  const report: FlushReport = {
    nonConnecte: false,
    traitees: 0,
    reussies: 0,
    conflits: 0,
    echecs: 0,
  }

  for (const row of rows) {
    report.traitees += 1
    try {
      const issue =
        row.operation === 'DELETE'
          ? await traiterSuppression(connector, row)
          : await traiterUpsert(connector, row, now)

      if (issue === 'CONFLIT') report.conflits += 1
      else report.reussies += 1

      // Conflit compris : la ligne quitte la file, le conflit porte désormais
      // l'état. Sans cela, chaque passage rouvrirait la même divergence.
      await prisma.syncOutbox.delete({ where: { id: row.id } })
    } catch (err) {
      const suite = nextAttempt(row.attempts, now)
      await prisma.syncOutbox.update({
        where: { id: row.id },
        data: {
          attempts: suite.attempts,
          state: suite.state,
          nextAttemptAt: suite.nextAttemptAt,
          lastError: messageDe(err),
        },
      })
      if (suite.state === 'FAILED') report.echecs += 1
    }
  }

  return report
}
```

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/sync/flush.test.ts`
Expected: PASS — 19 tests

- [ ] **Step 7: Vérifier par mutation**

Retirer brièvement la comparaison `remote.etag !== link.etag` (pousser
inconditionnellement) et confirmer que « un etag différent crée un conflit et
n'écrit rien » échoue seul. Restaurer ensuite.

- [ ] **Step 8: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(sync): drain the outbox, detect divergence by etag, never overwrite"
```

---

## Task 8: L'arbitrage — « accepter » passe par les règles de `saveEntry`

**Files:** Create `src/services/sync/conflicts.ts`, `src/services/sync/conflicts.test.ts`

**Interfaces:**
- Consumes: `SyncConflict` (1), `saveEntry` / `toIsoDate` (6), `enqueueSync` (6), `ConflictResolution` (4)
- Produces:
  - `interface OpenConflict { id; entityId; kind: ConflictKind; detectedAt: Date; libelle: string; remote: { summary: string; startLocal: string; endLocal: string } | null }`
  - `listOpenConflicts(userId: string): Promise<OpenConflict[]>`
  - `type ResolveResult = { ok: true; resolution: ConflictResolution } | { ok: false; reason: 'INTROUVABLE' | 'VERROUILLE' | 'CAPACITE' | 'NON_AFFECTE' | 'SAISIE_ABSENTE' | 'INSTANTANE_ILLISIBLE'; message: string }`
  - `resolveConflict(args: { userId: string; conflictId: string; resolution: ConflictResolution }): Promise<ResolveResult>`

**Le garde-fou.** « Accepter la version agenda » ne touche jamais `prisma.timeEntry` directement : elle passe par `saveEntry`, donc par le contrôle d'affectation, le contrôle de capacité et le verrouillage du mois. Une divergence d'agenda ne peut pas devenir une porte dérobée vers l'intégrité que l'application protège partout ailleurs — en particulier, **sur un mois validé, « accepter » est refusé**, sans quoi supprimer par ce biais une ligne de temps déjà validée ouvrirait un trou dans la facturation.

**L'ordre des écritures.** On écrit la nouvelle position **avant** d'effacer l'ancienne. L'ordre inverse détruirait la saisie quand la seconde écriture est refusée. Le cas résiduel — ancien mois verrouillé, nouveau mois ouvert — est compensé en défaisant la nouvelle écriture : le pire scénario laisse une donnée en trop, jamais une donnée en moins.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/sync/conflicts.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { createGoogleCalendarConnector } from '@/integrations/google/calendar'
import { createFakeGoogleApi, type FakeGoogleApi } from '@/integrations/google/fake-google-api'
import { flushSyncOutbox } from './flush'
import { listOpenConflicts, resolveConflict } from './conflicts'

const DEDIE = 'cra-dedie@group.calendar.google.com'
const NOW = new Date('2026-03-20T10:00:00.000Z')

let userId = ''
let autreId = ''
let missionId = ''
let lineA = ''
/** Sert à remplir une journée sans toucher la ligne en conflit. */
let lineB = ''
let api: FakeGoogleApi

function connector() {
  return createGoogleCalendarConnector({
    fetchFn: api.fetchFn,
    accessToken: 'ya29.acces',
    calendarId: DEDIE,
  })
}

/** Pousse une saisie, la fait diverger chez Google, et rend le conflit ouvert. */
async function divergence(patch: {
  summary?: string
  startLocal?: string
  endLocal?: string
}): Promise<{ conflictId: string; entryId: string; externalId: string }> {
  await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
  await flushSyncOutbox({ userId, now: NOW, connector: connector() })

  const entry = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
  const link = await prisma.externalLink.findFirstOrThrow({ where: { entityId: entry.id } })
  api.toucherEvenement(link.externalId, patch)

  await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
  await flushSyncOutbox({ userId, now: NOW, connector: connector() })

  const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId, resolvedAt: null } })
  return { conflictId: conflit.id, entryId: entry.id, externalId: link.externalId }
}

/** Idem, mais l'événement a disparu de Google. */
async function disparition(): Promise<{ conflictId: string; entryId: string }> {
  await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
  await flushSyncOutbox({ userId, now: NOW, connector: connector() })

  const entry = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
  const link = await prisma.externalLink.findFirstOrThrow({ where: { entityId: entry.id } })
  api.supprimerEvenement(link.externalId, { gone: true })

  await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
  await flushSyncOutbox({ userId, now: NOW, connector: connector() })

  const conflit = await prisma.syncConflict.findFirstOrThrow({ where: { userId, resolvedAt: null } })
  return { conflictId: conflit.id, entryId: entry.id }
}

function verrouillerMars(): Promise<unknown> {
  return prisma.cra.create({
    data: { missionId, userId, month: new Date('2026-03-01T00:00:00Z'), status: 'VALIDE' },
  })
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'conflits@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'conflits-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('CONFLITS client')
  const m = await createMission({ clientId: c.id, label: 'Refonte' })
  missionId = m.id
  lineA = (
    await createLine({ missionId, userId, label: 'Dév', soldCentiemes: 3000, tjmCents: 0 })
  ).id
  lineB = (
    await createLine({ missionId, userId, label: 'Recette', soldCentiemes: 3000, tjmCents: 0 })
  ).id
})

beforeEach(async () => {
  api = createFakeGoogleApi()
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    capacityCentiemes: 100,
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
  })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['conflits@test.local', 'conflits-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'CONFLITS client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('listOpenConflicts', () => {
  it('liste la divergence ouverte avec ce que Google porte', async () => {
    await divergence({ summary: 'Déplacé à la main' })

    const liste = await listOpenConflicts(userId)
    expect(liste.length).toBe(1)
    expect(liste[0]?.kind).toBe('REMOTE_MODIFIED')
    expect(liste[0]?.remote?.summary).toBe('Déplacé à la main')
    expect(liste[0]?.libelle).toContain('Dév')
  })

  it('ne liste pas une divergence déjà arbitrée', async () => {
    const { conflictId } = await divergence({ summary: 'Déplacé' })
    await resolveConflict({ userId, conflictId, resolution: 'DETACHER' })
    expect(await listOpenConflicts(userId)).toEqual([])
  })

  it('ne laisse pas voir la divergence d un autre utilisateur', async () => {
    await divergence({ summary: 'Déplacé' })
    expect(await listOpenConflicts(autreId)).toEqual([])
  })
})

describe('accepter — le garde-fou', () => {
  // Supprimer par ce biais une ligne de temps déjà validée ouvrirait un trou
  // dans la facturation.
  it('est refusé sur un mois dont le CRA est validé', async () => {
    const { conflictId, entryId } = await divergence({
      startLocal: '2026-03-18T14:00:00',
      endLocal: '2026-03-18T18:00:00',
    })
    await verrouillerMars()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ reason: 'VERROUILLE' })

    // Le conflit reste ouvert, la saisie n'a pas bougé.
    expect((await listOpenConflicts(userId)).length).toBe(1)
    const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(entry.date).toEqual(new Date('2026-03-12T00:00:00.000Z'))
  })

  it('est refusé quand la capacité serait dépassée', async () => {
    const { conflictId, entryId } = await divergence({
      startLocal: '2026-03-19T09:00:00',
      endLocal: '2026-03-19T17:00:00',
    })

    // Le 19 est déjà plein — sur une AUTRE ligne, sans quoi l'écriture viserait
    // la même clé et se substituerait à elle au lieu de s'y ajouter.
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await saveEntry({ userId, lineId: lineB, date: '2026-03-19', minutes: 480, kind: 'REALISE' })

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'CAPACITE' })
    expect((await listOpenConflicts(userId)).length).toBe(1)
    const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(entry.date).toEqual(new Date('2026-03-12T00:00:00.000Z'))
  })

  it('donne un motif en français', async () => {
    const { conflictId } = await divergence({
      startLocal: '2026-03-18T14:00:00',
      endLocal: '2026-03-18T18:00:00',
    })
    await verrouillerMars()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('validé')
  })
})

describe('accepter — quand la règle passe', () => {
  it('déplace la saisie sur l événement et repointe le lien', async () => {
    const { conflictId, entryId, externalId } = await divergence({
      startLocal: '2026-03-18T14:00:00',
      endLocal: '2026-03-18T18:00:00',
    })

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toEqual({ ok: true, resolution: 'ACCEPTER' })

    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).toBeNull()
    const deplacee = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(deplacee.date).toEqual(new Date('2026-03-18T00:00:00.000Z'))
    expect(deplacee.minutes).toBe(240)

    const link = await prisma.externalLink.findFirstOrThrow({ where: { externalId } })
    expect(link.entityId).toBe(deplacee.id)
    // L'etag distant est adopté : sans lui, le prochain drainage rouvrirait
    // exactement le même conflit.
    expect(link.etag).toBe('"2"')
  })

  it('ne repousse rien vers Google', async () => {
    const { conflictId } = await divergence({
      startLocal: '2026-03-18T14:00:00',
      endLocal: '2026-03-18T18:00:00',
    })
    await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })

    // Accepter la version agenda, c'est renoncer à pousser la sienne.
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
    const r = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(r.traitees).toBe(0)
  })

  it('supprime la saisie quand l événement a disparu', async () => {
    const { conflictId, entryId } = await disparition()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toEqual({ ok: true, resolution: 'ACCEPTER' })

    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).toBeNull()
    expect(await prisma.externalLink.count()).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('refuse de supprimer la saisie d un mois validé', async () => {
    const { conflictId, entryId } = await disparition()
    await verrouillerMars()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'VERROUILLE' })
    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).not.toBeNull()
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })
})

describe('rétablir', () => {
  it('remet en file et remet l etag à zéro', async () => {
    const { conflictId, entryId } = await divergence({ summary: 'Déplacé à la main' })

    const r = await resolveConflict({ userId, conflictId, resolution: 'RETABLIR' })
    expect(r).toEqual({ ok: true, resolution: 'RETABLIR' })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ entityId: ligne.entityId, operation: ligne.operation }).toEqual({
      entityId: entryId,
      operation: 'UPSERT',
    })
    // Sans cette remise à zéro, le drainage redétecterait la divergence qu'on
    // vient d'arbitrer.
    const link = await prisma.externalLink.findFirstOrThrow({ where: { entityId: entryId } })
    expect(link.etag).toBe('')

    const flush = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(flush.reussies).toBe(1)
    expect((await listOpenConflicts(userId)).length).toBe(0)
  })

  it('recrée l événement quand il a disparu', async () => {
    const { conflictId, entryId } = await disparition()

    await resolveConflict({ userId, conflictId, resolution: 'RETABLIR' })
    expect(await prisma.externalLink.count()).toBe(0)

    const flush = await flushSyncOutbox({ userId, now: NOW, connector: connector() })
    expect(flush.reussies).toBe(1)
    expect(await prisma.externalLink.count({ where: { entityId: entryId } })).toBe(1)
    expect(api.events.size).toBe(1)
  })
})

describe('détacher', () => {
  it('rompt le lien et laisse les deux côtés en place', async () => {
    const { conflictId, entryId, externalId } = await divergence({ summary: 'Déplacé' })

    const r = await resolveConflict({ userId, conflictId, resolution: 'DETACHER' })
    expect(r).toEqual({ ok: true, resolution: 'DETACHER' })

    expect(await prisma.externalLink.count()).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).not.toBeNull()
    expect(api.events.has(externalId)).toBe(true)
  })
})

describe('refus élémentaires', () => {
  it('refuse un conflit inconnu', async () => {
    const r = await resolveConflict({
      userId,
      conflictId: 'conflit-inexistant',
      resolution: 'DETACHER',
    })
    expect(r).toMatchObject({ ok: false, reason: 'INTROUVABLE' })
  })

  it('refuse d arbitrer le conflit d un autre utilisateur', async () => {
    const { conflictId } = await divergence({ summary: 'Déplacé' })
    const r = await resolveConflict({ userId: autreId, conflictId, resolution: 'DETACHER' })
    expect(r).toMatchObject({ ok: false, reason: 'INTROUVABLE' })
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })

  it('refuse d accepter un instantané illisible', async () => {
    const { conflictId } = await divergence({ summary: 'Déplacé' })
    await prisma.syncConflict.update({
      where: { id: conflictId },
      data: { remoteSnapshotJson: 'pas du json' },
    })

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'INSTANTANE_ILLISIBLE' })
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/sync/conflicts.test.ts`
Expected: FAIL — `Failed to resolve import "./conflicts"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/sync/conflicts.ts` :

```ts
import { prisma } from '@/db/client'
import type { ConflictKind, ConflictResolution } from '@/core/sync/policy'
import type { TimeEntryKind } from '@/core/types'
import { saveEntry, toIsoDate } from '@/services/time-entries'
import { enqueueSync } from './outbox'

export interface OpenConflict {
  id: string
  entityId: string
  kind: ConflictKind
  detectedAt: Date
  /** ce que la saisie dit, pour que l'écran soit lisible sans requête de plus */
  libelle: string
  /** ce que Google porte ; `null` quand l'instantané est illisible */
  remote: { summary: string; startLocal: string; endLocal: string } | null
}

export type ResolveResult =
  | { ok: true; resolution: ConflictResolution }
  | {
      ok: false
      reason:
        | 'INTROUVABLE'
        | 'VERROUILLE'
        | 'CAPACITE'
        | 'NON_AFFECTE'
        | 'SAISIE_ABSENTE'
        | 'INSTANTANE_ILLISIBLE'
      message: string
    }

interface Snapshot {
  etag?: string
  summary?: string
  startLocal?: string
  endLocal?: string
  externalId?: string
}

function lireSnapshot(json: string): Snapshot | null {
  try {
    const brut: unknown = JSON.parse(json)
    return brut !== null && typeof brut === 'object' ? (brut as Snapshot) : null
  } catch {
    return null
  }
}

/** Un refus de `saveEntry` traduit en motif affichable, tel quel. */
function refus(reason: 'CAPACITE' | 'VERROUILLE' | 'NON_AFFECTE'): ResolveResult {
  const messages: Record<typeof reason, string> = {
    VERROUILLE:
      "Le CRA de ce mois est validé : la version de l'agenda ne peut pas être acceptée. Rouvrez le CRA, ou rétablissez l'événement.",
    CAPACITE:
      'Accepter cette version dépasserait la capacité de la journée. Le conflit reste ouvert.',
    NON_AFFECTE: "Vous n'êtes plus affecté à cette ligne de prestation.",
  }
  return { ok: false, reason, message: messages[reason] }
}

export async function listOpenConflicts(userId: string): Promise<OpenConflict[]> {
  const conflits = await prisma.syncConflict.findMany({
    where: { userId, resolvedAt: null },
    orderBy: { detectedAt: 'desc' },
  })
  if (conflits.length === 0) return []

  const entries = await prisma.timeEntry.findMany({
    where: { userId, id: { in: conflits.map((c) => c.entityId) } },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  const parId = new Map(entries.map((e) => [e.id, e]))

  return conflits.map((c) => {
    const entry = parId.get(c.entityId)
    const snapshot = lireSnapshot(c.remoteSnapshotJson)

    return {
      id: c.id,
      entityId: c.entityId,
      kind: c.kind as ConflictKind,
      detectedAt: c.detectedAt,
      libelle:
        entry === undefined
          ? 'Saisie supprimée'
          : `${toIsoDate(entry.date)} · ${entry.line.mission.client.name} · ${entry.line.mission.label} · ${entry.line.label}`,
      remote:
        snapshot === null
          ? null
          : {
              summary: snapshot.summary ?? '',
              startLocal: snapshot.startLocal ?? '',
              endLocal: snapshot.endLocal ?? '',
            },
    }
  })
}

/** Durée en minutes entre deux heures locales naïves. */
function minutesEntre(startLocal: string, endLocal: string): number {
  const debut = Date.parse(`${startLocal}Z`)
  const fin = Date.parse(`${endLocal}Z`)
  if (Number.isNaN(debut) || Number.isNaN(fin)) return NaN
  return Math.round((fin - debut) / 60_000)
}

export async function resolveConflict(args: {
  userId: string
  conflictId: string
  resolution: ConflictResolution
}): Promise<ResolveResult> {
  const conflit = await prisma.syncConflict.findFirst({
    where: { id: args.conflictId, userId: args.userId, resolvedAt: null },
  })
  if (conflit === null) {
    return {
      ok: false,
      reason: 'INTROUVABLE',
      message: "Cette divergence n'existe plus ou a déjà été arbitrée.",
    }
  }

  const cible = {
    entityType: conflit.entityType,
    entityId: conflit.entityId,
    provider: conflit.provider,
  }
  const kind = conflit.kind as ConflictKind

  if (args.resolution === 'DETACHER') {
    await prisma.$transaction(async (tx) => {
      // Le lien est rompu ; les deux côtés restent, chacun chez soi.
      await tx.externalLink.deleteMany({ where: cible })
      await tx.syncOutbox.deleteMany({ where: cible })
      await tx.syncConflict.update({
        where: { id: conflit.id },
        data: { resolvedAt: new Date(), resolution: 'DETACHER' },
      })
    })
    return { ok: true, resolution: 'DETACHER' }
  }

  if (args.resolution === 'RETABLIR') {
    await prisma.$transaction(async (tx) => {
      if (kind === 'REMOTE_DELETED') {
        // Plus d'événement en face : sans supprimer le lien, le drainage
        // essaierait de mettre à jour un identifiant mort.
        await tx.externalLink.deleteMany({ where: cible })
      } else {
        // On réécrit par-dessus la version distante : l'etag stocké est remis
        // à zéro, sans quoi le drainage redétecterait la même divergence.
        await tx.externalLink.updateMany({ where: cible, data: { etag: '' } })
      }

      await enqueueSync(tx, { userId: args.userId, ...cible, operation: 'UPSERT' })
      await tx.syncConflict.update({
        where: { id: conflit.id },
        data: { resolvedAt: new Date(), resolution: 'RETABLIR' },
      })
    })
    return { ok: true, resolution: 'RETABLIR' }
  }

  // --- ACCEPTER -----------------------------------------------------------
  const entry = await prisma.timeEntry.findFirst({
    where: { id: conflit.entityId, userId: args.userId },
  })
  if (entry === null) {
    return {
      ok: false,
      reason: 'SAISIE_ABSENTE',
      message: "La saisie concernée n'existe plus. Détachez la divergence.",
    }
  }

  const ancienneDate = toIsoDate(entry.date)
  const kindSaisie = entry.kind as TimeEntryKind

  if (kind === 'REMOTE_DELETED') {
    // La suppression passe par saveEntry : sur un mois validé, elle est refusée.
    const suppression = await saveEntry({
      userId: args.userId,
      lineId: entry.lineId,
      date: ancienneDate,
      minutes: 0,
      kind: kindSaisie,
      slotId: entry.slotId,
    })
    if (!suppression.ok) return refus(suppression.reason)

    await prisma.$transaction(async (tx) => {
      await tx.externalLink.deleteMany({ where: cible })
      // La suppression a mis un DELETE en file : il est sans objet, l'événement
      // n'existe déjà plus chez Google.
      await tx.syncOutbox.deleteMany({ where: cible })
      await tx.syncConflict.update({
        where: { id: conflit.id },
        data: { resolvedAt: new Date(), resolution: 'ACCEPTER' },
      })
    })
    return { ok: true, resolution: 'ACCEPTER' }
  }

  const snapshot = lireSnapshot(conflit.remoteSnapshotJson)
  const minutes =
    snapshot === null || snapshot.startLocal === undefined || snapshot.endLocal === undefined
      ? NaN
      : minutesEntre(snapshot.startLocal, snapshot.endLocal)

  if (snapshot === null || Number.isNaN(minutes) || minutes <= 0) {
    return {
      ok: false,
      reason: 'INSTANTANE_ILLISIBLE',
      message:
        "L'événement distant n'est pas exploitable (heures manquantes). Rétablissez ou détachez.",
    }
  }

  const nouvelleDate = (snapshot.startLocal as string).slice(0, 10)

  // On écrit la nouvelle position AVANT d'effacer l'ancienne : l'ordre inverse
  // détruirait la saisie si la seconde écriture était refusée.
  const ecriture = await saveEntry({
    userId: args.userId,
    lineId: entry.lineId,
    date: nouvelleDate,
    minutes,
    kind: kindSaisie,
    slotId: '',
  })
  if (!ecriture.ok) return refus(ecriture.reason)

  if (nouvelleDate !== ancienneDate || entry.slotId !== '') {
    const suppression = await saveEntry({
      userId: args.userId,
      lineId: entry.lineId,
      date: ancienneDate,
      minutes: 0,
      kind: kindSaisie,
      slotId: entry.slotId,
    })
    if (!suppression.ok) {
      // Cas résiduel : ancien mois verrouillé, nouveau mois ouvert. On défait
      // la nouvelle écriture plutôt que de laisser la journée comptée deux fois.
      await saveEntry({
        userId: args.userId,
        lineId: entry.lineId,
        date: nouvelleDate,
        minutes: 0,
        kind: kindSaisie,
        slotId: '',
      })
      return refus(suppression.reason)
    }
  }

  const deplacee = await prisma.timeEntry.findFirstOrThrow({
    where: {
      userId: args.userId,
      lineId: entry.lineId,
      date: new Date(`${nouvelleDate}T00:00:00.000Z`),
      slotId: '',
    },
  })

  await prisma.$transaction(async (tx) => {
    // La saisie a suivi l'événement : le lien le suit aussi, avec l'etag
    // distant. Sans lui, le prochain drainage rouvrirait le même conflit.
    await tx.externalLink.updateMany({
      where: cible,
      data: {
        entityId: deplacee.id,
        etag: snapshot.etag ?? '',
        syncState: 'SYNCED',
        syncedAt: new Date(),
      },
    })
    // Les deux `saveEntry` ci-dessus ont mis les saisies en file : accepter la
    // version agenda, c'est justement renoncer à repousser la sienne.
    await tx.syncOutbox.deleteMany({
      where: {
        entityType: conflit.entityType,
        provider: conflit.provider,
        entityId: { in: [conflit.entityId, deplacee.id] },
      },
    })
    await tx.syncConflict.update({
      where: { id: conflit.id },
      data: { resolvedAt: new Date(), resolution: 'ACCEPTER' },
    })
  })

  return { ok: true, resolution: 'ACCEPTER' }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/sync/conflicts.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer brièvement l'appel à `saveEntry` du chemin `ACCEPTER` /
`REMOTE_DELETED` par un `prisma.timeEntry.delete` direct, et confirmer que
« refuse de supprimer la saisie d'un mois validé » échoue seul — c'est
exactement la porte dérobée que la spec interdit. Restaurer ensuite.

- [ ] **Step 6: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add src/services/sync/conflicts.ts src/services/sync/conflicts.test.ts
git commit -m "feat(sync): arbitrate divergences, accepting the remote version through saveEntry rules"
```

---

## Task 9: La lecture d'occupation et le marquage de la grille

**Files:** Create `src/services/availability.ts`, `src/services/availability.test.ts`. Modify `src/app/(app)/saisie/[month]/page.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.test.tsx`, `src/components/grid/MonthGrid.tsx`, `src/components/grid/MonthGrid.test.tsx`

**Interfaces:**
- Consumes: `resolveConnector` (7), `CalendarConnector.freeBusy` (5)
- Produces:
  - `getBusyDays(userId: string, month: string, deps?: { connector?: CalendarConnector | null; fetchFn?: FetchLike }): Promise<string[]>` — dates `'YYYY-MM-DD'` triées, **ne lève jamais**
  - `MonthGrid` et `SaisieClient` gagnent `busyDates?: string[]`

**La règle.** `getBusyDays` ne lève jamais et ne renvoie jamais autre chose qu'une liste de dates. Compte non connecté, appel en échec, appel expiré : la grille s'affiche sans marques et la saisie fonctionne normalement. La détection de conflit est un confort, pas une dépendance. L'avertissement affiché est **non bloquant**, conformément à la famille A du lot 0.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/availability.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry, getMonthEntries } from '@/services/time-entries'
import { saveCredential } from '@/services/credentials'
import { createGoogleCalendarConnector } from '@/integrations/google/calendar'
import { createFakeGoogleApi, type FakeGoogleApi } from '@/integrations/google/fake-google-api'
import { getBusyDays } from './availability'

const DEDIE = 'cra-dedie@group.calendar.google.com'

let userId = ''
let autreId = ''
let lineA = ''
let api: FakeGoogleApi

function connector() {
  return createGoogleCalendarConnector({
    fetchFn: api.fetchFn,
    accessToken: 'ya29.acces',
    calendarId: DEDIE,
  })
}

async function connecter(expiresAt = new Date('2026-12-31T00:00:00.000Z')): Promise<void> {
  await saveCredential(userId, 'GOOGLE', {
    accessToken: 'ya29.acces',
    refreshToken: '1//valide',
    expiresAt,
    scope: 'calendar',
    calendarId: DEDIE,
  })
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'occupation@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'occupation-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('OCCUPATION client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  lineA = (
    await createLine({ missionId: m.id, userId, label: 'A', soldCentiemes: 3000, tjmCents: 0 })
  ).id
})

beforeEach(async () => {
  api = createFakeGoogleApi()
  await prisma.syncOutbox.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['occupation@test.local', 'occupation-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'OCCUPATION client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('getBusyDays', () => {
  it('rend les jours occupés, dédoublonnés et triés', async () => {
    api.busy.set('primary', [
      { start: '2026-03-17T14:00:00.000Z', end: '2026-03-17T15:00:00.000Z' },
      { start: '2026-03-12T08:00:00.000Z', end: '2026-03-12T10:00:00.000Z' },
      { start: '2026-03-12T13:00:00.000Z', end: '2026-03-12T14:00:00.000Z' },
    ])

    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([
      '2026-03-12',
      '2026-03-17',
    ])
  })

  // Sans cette exclusion, les blocs poussés par l'application entreraient en
  // conflit avec eux-mêmes et chaque jour saisi paraîtrait occupé.
  it('exclut le calendrier dédié de la requête', async () => {
    await getBusyDays(userId, '2026-03', { connector: connector() })

    const corps = api.dernierAppel().body as { items: Array<{ id: string }> }
    expect(corps.items).toEqual([{ id: 'primary' }])
    expect(JSON.stringify(corps)).not.toContain(DEDIE)
  })

  it('interroge exactement le mois demandé', async () => {
    await getBusyDays(userId, '2026-03', { connector: connector() })

    const corps = api.dernierAppel().body as { timeMin: string; timeMax: string }
    expect(corps.timeMin).toBe('2026-03-01T00:00:00.000Z')
    expect(corps.timeMax).toBe('2026-04-01T00:00:00.000Z')
  })

  it('marque les deux jours d une plage qui franchit minuit', async () => {
    api.busy.set('primary', [
      { start: '2026-03-12T22:00:00.000Z', end: '2026-03-13T06:00:00.000Z' },
    ])
    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([
      '2026-03-12',
      '2026-03-13',
    ])
  })

  it('ne rend aucun jour hors du mois affiché', async () => {
    api.busy.set('primary', [
      { start: '2026-02-27T09:00:00.000Z', end: '2026-02-27T10:00:00.000Z' },
      { start: '2026-03-31T22:00:00.000Z', end: '2026-04-01T06:00:00.000Z' },
    ])
    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual(['2026-03-31'])
  })

  it('ne rend rien quand rien n est occupé', async () => {
    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([])
  })
})

describe('résilience — la panne ne casse jamais la saisie', () => {
  it('compte non connecté : aucune marque, aucune exception', async () => {
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('appel en échec : aucune marque', async () => {
    await connecter()
    api.failNext('SERVEUR')
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('appel expiré : aucune marque', async () => {
    await connecter()
    api.failNext('EXPIRE')
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('autorisation révoquée : aucune marque', async () => {
    await connecter()
    api.expirerJeton()
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('jeton expiré et non rafraîchissable : aucune marque', async () => {
    await connecter(new Date('2020-01-01T00:00:00.000Z'))
    api.oauth.refusRefresh = true
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  // Le test qui protège le cas d'usage quotidien : la page de saisie reste
  // entièrement fonctionnelle pendant que Google est indisponible.
  it('la page de saisie reste fonctionnelle dans tous ces cas', async () => {
    await connecter()
    api.failNext('EXPIRE')

    const jours = await getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })
    const r = await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-12',
      minutes: 480,
      kind: 'REALISE',
    })
    const entries = await getMonthEntries(userId, '2026-03')

    expect(jours).toEqual([])
    expect(r).toEqual({ ok: true, minutes: 480 })
    expect(entries.length).toBe(1)
  })
})

describe('isolation par utilisateur', () => {
  it('ne lit pas l agenda d un autre utilisateur', async () => {
    await connecter()
    // L'autre utilisateur n'a aucun compte connecté : aucune requête ne part.
    expect(await getBusyDays(autreId, '2026-03', { fetchFn: api.fetchFn })).toEqual([])
    expect(api.calls.length).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/availability.test.ts`
Expected: FAIL — `Failed to resolve import "./availability"`

- [ ] **Step 3: Écrire le service**

`src/services/availability.ts` :

```ts
import type { BusyInterval, CalendarConnector } from '@/core/calendar/connector'
import type { FetchLike } from '@/integrations/google/calendar'
import { resolveConnector } from './sync/connector'

/** L'agenda principal suffit en v1 ; le multi-agendas est hors périmètre. */
const AGENDA_PRINCIPAL = 'primary'

const JOUR_MS = 86_400_000

function monthBoundsIso(month: string): { startIso: string; endIso: string } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return {
    startIso: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    endIso: new Date(Date.UTC(y, m, 1)).toISOString(),
  }
}

/** Tous les jours qu'une plage touche, bornes ouvertes à droite. */
function joursCouverts(interval: BusyInterval): string[] {
  const debut = new Date(interval.startIso).getTime()
  const fin = new Date(interval.endIso).getTime()
  if (Number.isNaN(debut) || Number.isNaN(fin) || fin <= debut) return []

  const jours: string[] = []
  let curseur = Math.floor(debut / JOUR_MS) * JOUR_MS
  // Une réunion de 22 h à 6 h occupe deux journées, pas une.
  while (curseur < fin) {
    jours.push(new Date(curseur).toISOString().slice(0, 10))
    curseur += JOUR_MS
  }
  return jours
}

/**
 * Les jours du mois porteurs d'une occupation dans l'agenda principal.
 *
 * **Ne lève jamais.** Compte non connecté, appel en échec, appel expiré,
 * autorisation révoquée : la liste est vide et la grille s'affiche sans
 * marques. La détection de conflit est un confort, pas une dépendance — la
 * saisie doit continuer de fonctionner un jour où Google est en panne.
 *
 * Aucun cache en v1 : un appel `freeBusy` est bon marché, et un cache
 * introduirait une fraîcheur à arbitrer.
 */
export async function getBusyDays(
  userId: string,
  month: string,
  deps: { connector?: CalendarConnector | null; fetchFn?: FetchLike } = {},
): Promise<string[]> {
  try {
    const connector =
      deps.connector !== undefined
        ? deps.connector
        : await resolveConnector(userId, {
            ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
          })
    if (connector === null) return []

    const { startIso, endIso } = monthBoundsIso(month)
    const plages = await connector.freeBusy({
      startIso,
      endIso,
      // Le calendrier dédié est passé explicitement pour que le connecteur
      // l'écarte : l'exclusion est une propriété vérifiable, pas un oubli.
      calendarIds: [AGENDA_PRINCIPAL, connector.dedicatedCalendarId],
    })

    const jours = new Set<string>()
    for (const plage of plages) {
      for (const jour of joursCouverts(plage)) {
        if (jour.startsWith(month)) jours.add(jour)
      }
    }
    return [...jours].sort()
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/availability.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Écrire les tests de composants qui échouent**

Ajouter à `src/components/grid/MonthGrid.test.tsx` :

```ts
describe('occupation de l agenda', () => {
  it('marque l en-tête d un jour occupé', () => {
    renderGrid({ busyDates: ['2026-03-12'] })

    const occupe = screen.getByTestId('day-header-2026-03-12')
    expect(occupe.getAttribute('data-busy')).toBe('true')
    expect(occupe.getAttribute('title')).toBe('Occupation dans votre agenda')
  })

  it('ne marque pas les autres jours', () => {
    renderGrid({ busyDates: ['2026-03-12'] })
    expect(screen.getByTestId('day-header-2026-03-13').getAttribute('data-busy')).toBeNull()
  })

  it('ne marque rien quand l agenda est injoignable', () => {
    // Liste vide : c'est exactement ce que `getBusyDays` rend en cas de panne.
    renderGrid({ busyDates: [] })
    expect(screen.getByTestId('day-header-2026-03-12').getAttribute('data-busy')).toBeNull()
  })

  it('laisse la cellule d un jour occupé pleinement saisissable', () => {
    renderGrid({ busyDates: ['2026-03-12'] })
    const input = screen.getByLabelText('Consultant ITSM 2026-03-12') as HTMLInputElement
    expect(input.readOnly).toBe(false)
  })
})
```

Ajouter à `src/app/(app)/saisie/[month]/SaisieClient.test.tsx` — en élargissant
`renderClient` pour accepter des `busyDates` :

```tsx
function renderClient(busyDates: string[] = []): void {
  render(
    <SaisieClient
      month="2026-03"
      days={buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])}
      lines={lines}
      entries={[]}
      engagementTotals={{ l1: [] }}
      capacityMinutes={480}
      minutesParJour={480}
      busyDates={busyDates}
    />,
  )
}
```

```tsx
describe('avertissement d occupation', () => {
  it('avertit sans bloquer quand on planifie sur un jour occupé', async () => {
    saveCell.mockResolvedValue({ ok: true, minutes: 480 })
    renderClient(['2026-03-12'])

    const input = saisir('1')

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Votre agenda est déjà occupé le 2026-03-12. La saisie est conservée.',
      )
    })
    // Non bloquant : la valeur reste à l'écran, l'action a bien été appelée.
    expect(input.value).toBe('1')
    expect(saveCell).toHaveBeenCalledTimes(1)
  })

  it('n avertit pas sur un jour libre', async () => {
    saveCell.mockResolvedValue({ ok: true, minutes: 480 })
    renderClient(['2026-03-13'])

    saisir('1')

    await waitFor(() => expect(saveCell).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('laisse le message de capacité l emporter', async () => {
    // Un dépassement de capacité est plus important qu'une simple occupation.
    saveCell.mockResolvedValue({
      ok: true,
      minutes: 480,
      warning: { totalMinutes: 720, capacityMinutes: 480 },
    })
    renderClient(['2026-03-12'])

    saisir('1')

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Capacité dépassée')
    })
  })
})
```

- [ ] **Step 6: Lancer les tests de composants pour vérifier qu'ils échouent**

Run: `npx vitest run src/components/grid/MonthGrid.test.tsx "src/app/(app)/saisie/[month]/SaisieClient.test.tsx"`
Expected: FAIL — `busyDates` n'existe pas sur les props, aucun `data-busy`, aucun `role="status"`

- [ ] **Step 7: Marquer la grille**

Dans `src/components/grid/MonthGrid.tsx`, ajouter la prop — **optionnelle**, pour
que tous les rendus existants restent valides et que l'absence de donnée
(agenda injoignable) soit le cas nominal. La valeur par défaut est une constante
de module, comme `AUCUN_TOTAL` : un littéral `[]` dans la déstructuration créerait
un tableau neuf à chaque rendu et invaliderait le `useMemo` ci-dessous.

```tsx
const AUCUNE_OCCUPATION: string[] = []
```

```tsx
  /** jours porteurs d'une occupation externe ; vide quand l'agenda est injoignable */
  busyDates = AUCUNE_OCCUPATION,
```

dans la déstructuration, et dans la signature :

```tsx
  busyDates?: string[]
```

Puis, avant le rendu :

```tsx
  const occupes = useMemo(() => new Set(busyDates), [busyDates])
```

et dans l'en-tête de colonne :

```tsx
              <th
                key={d.date}
                scope="col"
                data-testid={`day-header-${d.date}`}
                {...(occupes.has(d.date)
                  ? { 'data-busy': 'true', title: 'Occupation dans votre agenda' }
                  : {})}
                className={`w-9 px-1 py-1 text-center text-xs font-normal ${
                  d.isWorking && !d.isHoliday ? '' : 'bg-slate-100'
                } ${occupes.has(d.date) ? 'border-b-2 border-b-violet-400' : ''}`}
              >
                {Number(d.date.slice(8))}
              </th>
```

- [ ] **Step 8: Avertir sans bloquer**

Dans `src/app/(app)/saisie/[month]/SaisieClient.tsx`, ajouter `busyDates?: string[]`
aux props (défaut `[]`), le transmettre à `MonthGrid`, et composer le message
dans `handleSave` :

```tsx
    if (r.ok) {
      // Le dépassement de capacité prime : c'est une règle du produit, quand
      // l'occupation n'est qu'un signalement. Aucun des deux ne bloque.
      if (r.warning) {
        setMessage(
          `Capacité dépassée le ${date} : ${heures(r.warning.totalMinutes)} h saisies pour ${heures(r.warning.capacityMinutes)} h disponibles. La saisie est conservée.`,
        )
      } else if ((props.busyDates ?? []).includes(date)) {
        setMessage(`Votre agenda est déjà occupé le ${date}. La saisie est conservée.`)
      } else {
        setMessage(null)
      }
      return true
    }
```

et donner au bandeau son rôle, pour qu'il soit annoncé sans voler le focus :

```tsx
      {message && (
        <p
          role="status"
          className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {message}
        </p>
      )}
```

- [ ] **Step 9: Brancher la page**

Dans `src/app/(app)/saisie/[month]/page.tsx`, ajouter l'import et la lecture :

```ts
import { getBusyDays } from '@/services/availability'
```

```ts
  // Une lecture d'occupation à l'ouverture du mois. Elle ne lève jamais : un
  // agenda injoignable rend une liste vide et la page s'affiche normalement.
  const busyDates = await getBusyDays(user.id, month)
```

et passer `busyDates={busyDates}` à `<SaisieClient />`.

- [ ] **Step 10: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/components/grid/MonthGrid.test.tsx "src/app/(app)/saisie/[month]/SaisieClient.test.tsx"`
Expected: PASS — 7 tests nouveaux plus tous les existants

- [ ] **Step 11: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(saisie): read agenda busy days and warn without blocking"
```

---

## Task 10: La connexion Google — consentement, jetons, calendrier dédié

**Files:** Modify `src/integrations/google/oauth.ts`, `src/integrations/google/calendar.ts`. Create `src/services/google/connect.ts`, `src/services/google/connect.test.ts`, `src/app/api/google/connect/route.ts`, `src/app/api/google/callback/route.ts`

**Interfaces:**
- Consumes: `saveCredential` / `getCredential` / `revokeCredential` / `setCalendarId` (2), `postToken` (7)
- Produces:
  - `buildConsentUrl(args: { state: string }): string`
  - `exchangeCode(fetchFn: FetchLike, code: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; scope: string }>`
  - `ensureDedicatedCalendar(fetchFn: FetchLike, accessToken: string, summary: string): Promise<string>`
  - `CALENDRIER_DEDIE = 'CRA — disponibilités'`
  - `connectGoogle(args: { userId: string; code: string; fetchFn?: FetchLike }): Promise<{ calendarId: string }>`
  - `disconnectGoogle(userId: string): Promise<void>`
  - `getConnectionState(userId: string): Promise<{ connected: boolean; calendarId: string; scope: string; connectedAt: Date | null }>`

**Le projet Google Cloud existant est réutilisé** — l'instance Dolibarr cible porte déjà un client OAuth (`OAUTH_GOOGLE-KreativWKS`) — en lui ajoutant le scope calendrier. Le consentement demande `access_type=offline` **et** `prompt=consent` : sans le second, Google ne renvoie le jeton de rafraîchissement qu'au tout premier consentement, et une reconnexion après perte de la clé repartirait sans secret de longue durée.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/google/connect.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { getCredential } from '@/services/credentials'
import { buildConsentUrl } from '@/integrations/google/oauth'
import { createFakeGoogleApi, type FakeGoogleApi } from '@/integrations/google/fake-google-api'
import { CALENDRIER_DEDIE, connectGoogle, disconnectGoogle, getConnectionState } from './connect'

let userId = ''
let autreId = ''
let api: FakeGoogleApi

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  process.env.GOOGLE_CLIENT_ID = 'client-id-de-test'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret-de-test'
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/google/callback'

  const u = await prisma.user.create({
    data: { email: 'connect@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'connect-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  api = createFakeGoogleApi()
  await prisma.providerCredential.deleteMany({})
})

afterAll(async () => {
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['connect@test.local', 'connect-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

describe('URL de consentement', () => {
  it('demande le scope calendrier et un accès hors ligne', () => {
    const url = new URL(buildConsentUrl({ state: 'etat-aleatoire' }))

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar')
    expect(url.searchParams.get('access_type')).toBe('offline')
    // Sans `prompt=consent`, une reconnexion repartirait sans jeton de
    // rafraîchissement — donc sans possibilité de synchroniser en fond.
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('porte l état anti-rejeu et l URI de retour', () => {
    const url = new URL(buildConsentUrl({ state: 'etat-aleatoire' }))
    expect(url.searchParams.get('state')).toBe('etat-aleatoire')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/google/callback',
    )
    expect(url.searchParams.get('client_id')).toBe('client-id-de-test')
  })
})

describe('connexion', () => {
  it('stocke les jetons chiffrés et crée le calendrier dédié', async () => {
    const r = await connectGoogle({ userId, code: 'code-de-consentement', fetchFn: api.fetchFn })

    expect(r.calendarId).not.toBe('')
    expect(api.calendars.get(r.calendarId)?.summary).toBe(CALENDRIER_DEDIE)

    const creds = await getCredential(userId, 'GOOGLE')
    expect(creds?.accessToken).toBe('ya29.nouveau')
    expect(creds?.refreshToken).toBe('1//rafraichissement')
    expect(creds?.calendarId).toBe(r.calendarId)

    const row = await prisma.providerCredential.findFirstOrThrow({ where: { userId } })
    expect(row.refreshTokenEnc).not.toContain('rafraichissement')
  })

  it('réutilise le calendrier dédié à la reconnexion', async () => {
    const premier = await connectGoogle({ userId, code: 'code-1', fetchFn: api.fetchFn })
    const second = await connectGoogle({ userId, code: 'code-2', fetchFn: api.fetchFn })

    expect(second.calendarId).toBe(premier.calendarId)
    expect(api.calendars.size).toBe(1)
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(1)
  })

  it('ne stocke rien quand Google refuse le code', async () => {
    api.oauth.refusRefresh = true

    await expect(
      connectGoogle({ userId, code: 'code-invalide', fetchFn: api.fetchFn }),
    ).rejects.toThrow()
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(0)
  })

  it('ne laisse pas une connexion à moitié faite quand le calendrier échoue', async () => {
    // Le jeton est obtenu, la création du calendrier échoue : sans annulation,
    // l'écran afficherait « connecté » pour un compte inutilisable.
    let appels = 0
    const fetchFn: typeof api.fetchFn = async (url, init) => {
      appels += 1
      if (appels > 1) api.failNext('SERVEUR')
      return api.fetchFn(url, init)
    }

    await expect(connectGoogle({ userId, code: 'code', fetchFn })).rejects.toThrow()
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(0)
  })
})

describe('état et révocation', () => {
  it('rend l état non connecté par défaut', async () => {
    expect(await getConnectionState(userId)).toEqual({
      connected: false,
      calendarId: '',
      scope: '',
      connectedAt: null,
    })
  })

  it('rend l état connecté après consentement', async () => {
    const r = await connectGoogle({ userId, code: 'code', fetchFn: api.fetchFn })
    const etat = await getConnectionState(userId)

    expect(etat.connected).toBe(true)
    expect(etat.calendarId).toBe(r.calendarId)
    expect(etat.scope).toContain('calendar')
    expect(etat.connectedAt).toBeInstanceOf(Date)
  })

  it('révoque la connexion', async () => {
    await connectGoogle({ userId, code: 'code', fetchFn: api.fetchFn })
    await disconnectGoogle(userId)

    expect((await getConnectionState(userId)).connected).toBe(false)
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(0)
  })

  it('ne mélange pas les connexions de deux utilisateurs', async () => {
    await connectGoogle({ userId, code: 'code', fetchFn: api.fetchFn })
    expect((await getConnectionState(autreId)).connected).toBe(false)

    await disconnectGoogle(autreId)
    expect((await getConnectionState(userId)).connected).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/google/connect.test.ts`
Expected: FAIL — `Failed to resolve import "./connect"`

- [ ] **Step 3: Compléter le parcours OAuth**

Ajouter à `src/integrations/google/oauth.ts` :

```ts
const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPES = ['https://www.googleapis.com/auth/calendar'].join(' ')

export function buildConsentUrl(args: { state: string }): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: SCOPES,
    // Le jeton de rafraîchissement est ce qui permet de synchroniser en fond
    // sans que l'utilisateur soit devant l'écran.
    access_type: 'offline',
    // Google ne renvoie ce jeton qu'au premier consentement, sauf si on le
    // redemande explicitement : sans cela, une reconnexion serait inutilisable.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: args.state,
  })
  return `${CONSENT_URL}?${params.toString()}`
}

export async function exchangeCode(
  fetchFn: FetchLike,
  code: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; scope: string }> {
  const body = await postToken(fetchFn, {
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
    grant_type: 'authorization_code',
    code,
  })

  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new GoogleOAuthError(
      "Google n'a pas renvoyé de jeton de rafraîchissement. Révoquez l'accès dans votre compte Google, puis reconnectez-vous.",
    )
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    scope: body.scope ?? SCOPES,
  }
}
```

- [ ] **Step 4: Créer ou retrouver le calendrier dédié**

Ajouter à `src/integrations/google/calendar.ts` :

```ts
/**
 * Retrouve le calendrier dédié par son libellé, ou le crée.
 *
 * Jamais l'agenda principal : le calendrier dédié est affichable ou masquable
 * d'un clic et effaçable d'un geste, ce qui est la condition pour que
 * l'application ait le droit d'y écrire.
 */
export async function ensureDedicatedCalendar(
  fetchFn: FetchLike,
  accessToken: string,
  summary: string,
): Promise<string> {
  const liste = (await request(
    fetchFn,
    accessToken,
    'GET',
    `${BASE}/users/me/calendarList?maxResults=250`,
  )) as { items?: Array<{ id: string; summary?: string }> }

  const existant = (liste.items ?? []).find((c) => c.summary === summary)
  if (existant !== undefined) return existant.id

  const cree = (await request(fetchFn, accessToken, 'POST', `${BASE}/calendars`, {
    summary,
  })) as { id: string }
  return cree.id
}
```

- [ ] **Step 5: Écrire le service de connexion**

`src/services/google/connect.ts` :

```ts
import { prisma } from '@/db/client'
import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { ensureDedicatedCalendar, type FetchLike } from '@/integrations/google/calendar'
import { exchangeCode } from '@/integrations/google/oauth'
import { revokeCredential, saveCredential, setCalendarId } from '@/services/credentials'

/** Libellé du calendrier dédié — jamais l'agenda principal. */
export const CALENDRIER_DEDIE = 'CRA — disponibilités'

/**
 * Au retour du consentement : le jeton de rafraîchissement est chiffré et
 * stocké, puis le calendrier dédié est créé s'il n'existe pas.
 *
 * Si la seconde étape échoue, la première est annulée : un compte enregistré
 * sans calendrier afficherait « connecté » tout en étant inutilisable, et
 * l'utilisateur n'aurait aucune raison de recommencer.
 */
export async function connectGoogle(args: {
  userId: string
  code: string
  fetchFn?: FetchLike
}): Promise<{ calendarId: string }> {
  const fetchFn = args.fetchFn ?? (globalThis.fetch as unknown as FetchLike)

  const jetons = await exchangeCode(fetchFn, args.code)
  await saveCredential(args.userId, PROVIDER_GOOGLE, { ...jetons, calendarId: '' })

  try {
    const calendarId = await ensureDedicatedCalendar(
      fetchFn,
      jetons.accessToken,
      CALENDRIER_DEDIE,
    )
    await setCalendarId(args.userId, PROVIDER_GOOGLE, calendarId)
    return { calendarId }
  } catch (err) {
    await revokeCredential(args.userId, PROVIDER_GOOGLE)
    throw err
  }
}

export async function disconnectGoogle(userId: string): Promise<void> {
  // Les blocs déjà posés restent dans l'agenda : ils sont dans un calendrier
  // dédié, que l'utilisateur efface d'un geste s'il le souhaite.
  await revokeCredential(userId, PROVIDER_GOOGLE)
}

export async function getConnectionState(userId: string): Promise<{
  connected: boolean
  calendarId: string
  scope: string
  connectedAt: Date | null
}> {
  const row = await prisma.providerCredential.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER_GOOGLE } },
    select: { calendarId: true, scope: true, connectedAt: true },
  })

  if (row === null) return { connected: false, calendarId: '', scope: '', connectedAt: null }
  return {
    connected: row.calendarId !== '',
    calendarId: row.calendarId,
    scope: row.scope,
    connectedAt: row.connectedAt,
  }
}
```

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/google/connect.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 7: Écrire les routes du parcours**

`src/app/api/google/connect/route.ts` :

```ts
import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { requireUser } from '@/auth'
import { buildConsentUrl } from '@/integrations/google/oauth'

export async function GET(): Promise<Response> {
  await requireUser()

  // État anti-rejeu : il repart avec la redirection et doit revenir identique.
  const state = randomBytes(16).toString('hex')
  const jar = await cookies()
  jar.set('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  })

  return Response.redirect(buildConsentUrl({ state }), 302)
}
```

`src/app/api/google/callback/route.ts` :

```ts
import { cookies } from 'next/headers'
import { requireUser } from '@/auth'
import { connectGoogle } from '@/services/google/connect'

function retour(request: Request, message: string): Response {
  const url = new URL('/admin/sync', request.url)
  url.searchParams.set('message', message)
  return Response.redirect(url.toString(), 302)
}

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser()
  const params = new URL(request.url).searchParams

  const jar = await cookies()
  const attendu = jar.get('google_oauth_state')?.value ?? ''
  jar.delete('google_oauth_state')

  if (params.get('error') !== null) {
    return retour(request, 'Connexion Google annulée.')
  }
  if (attendu === '' || params.get('state') !== attendu) {
    return retour(request, 'Connexion Google refusée : la demande ne vient pas de cet écran.')
  }

  const code = params.get('code') ?? ''
  if (code === '') return retour(request, 'Connexion Google incomplète : aucun code reçu.')

  try {
    await connectGoogle({ userId: user.id, code })
  } catch {
    return retour(request, 'La connexion Google a échoué. Réessayez.')
  }

  return retour(request, 'Google Calendar est connecté.')
}
```

- [ ] **Step 8: Documenter les variables**

Ajouter à `.env.example` :

```
# OAuth Google — réutilise le client existant du projet Google Cloud, en lui
# ajoutant le scope https://www.googleapis.com/auth/calendar
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_REDIRECT_URI="http://localhost:3000/api/google/callback"

# Fuseau des blocs poussés dans l'agenda
CRA_TIMEZONE="Europe/Paris"
```

- [ ] **Step 9: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(google): OAuth consent flow, encrypted tokens and dedicated calendar"
```

---

## Task 11: Le déclenchement — endpoint, bouton, écran de synchronisation

**Files:** Modify `src/services/sync/outbox.test.ts`, `src/services/sync/flush.ts`, `src/services/sync/flush.test.ts`, `src/middleware.ts`. Create `src/services/sync/queue.ts`, `src/app/api/sync/flush/route.ts`, `src/app/api/sync/flush/route.test.ts`, `src/app/(app)/admin/sync/page.tsx`, `src/app/(app)/admin/sync/actions.ts`, `src/app/(app)/admin/sync/SyncClient.tsx`, `src/app/(app)/admin/sync/SyncClient.test.tsx`

**Interfaces:**
- Consumes: `flushSyncOutbox` (7), `listOpenConflicts` / `resolveConflict` (8), `getConnectionState` / `disconnectGoogle` (10)
- Produces, dans `src/services/sync/queue.ts` :
  - `interface FailedSyncRow { id: string; entityId: string; operation: SyncOperation; attempts: number; lastError: string; libelle: string }`
  - `listFailedSyncRows(userId: string): Promise<FailedSyncRow[]>`
  - `retrySyncRow(userId: string, rowId: string): Promise<boolean>`
- Produces, dans `src/services/sync/flush.ts` :
  - `flushAllSyncOutboxes(limit?: number): Promise<{ comptes: number; traitees: number }>`

**Pourquoi un fichier de plus.** La lecture des échecs a besoin de `toIsoDate`
pour son libellé, donc de `@/services/time-entries` — qui importe déjà
`enqueueTimeEntry` depuis `outbox.ts`. Les mettre dans `outbox.ts` fermerait un
cycle d'imports. `queue.ts` est en aval des deux et n'est importé par aucun.

**Autoportant par défaut.** Un cron système ou n8n peuvent appeler `POST /api/sync/flush`, mais **rien ne les exige** : le bouton « Synchroniser maintenant » suffit. Faire dépendre la synchronisation d'un ordonnanceur externe retirerait à l'application son autoportance, qui est sa condition de départ.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `src/services/sync/outbox.test.ts` :

```ts
import { listFailedSyncRows, retrySyncRow } from './queue'

describe('les échecs remontent au lieu de disparaître', () => {
  async function echouer(): Promise<string> {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    await prisma.syncOutbox.update({
      where: { id: ligne.id },
      data: { state: 'FAILED', attempts: 5, lastError: 'Agenda injoignable : fetch failed' },
    })
    return ligne.id
  }

  it('liste les lignes en échec avec leur motif et un libellé lisible', async () => {
    await echouer()

    const echecs = await listFailedSyncRows(userId)
    expect(echecs.length).toBe(1)
    expect(echecs[0]?.attempts).toBe(5)
    expect(echecs[0]?.lastError).toContain('Agenda injoignable')
    expect(echecs[0]?.libelle).toContain('2026-03-12')
  })

  it('ne liste pas les lignes encore en attente', async () => {
    await saveEntry({ userId, lineId: lineB, date: '2026-03-13', minutes: 240, kind: 'REALISE' })
    expect(await listFailedSyncRows(userId)).toEqual([])
  })

  it('ne laisse pas voir les échecs d un autre utilisateur', async () => {
    await echouer()
    expect(await listFailedSyncRows(autreId)).toEqual([])
  })

  it('rejoue une ligne en la remettant immédiatement en attente', async () => {
    const id = await echouer()

    expect(await retrySyncRow(userId, id)).toBe(true)

    const ligne = await prisma.syncOutbox.findUniqueOrThrow({ where: { id } })
    expect({ state: ligne.state, attempts: ligne.attempts, lastError: ligne.lastError }).toEqual({
      state: 'PENDING',
      attempts: 0,
      lastError: '',
    })
    expect(ligne.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('refuse de rejouer la ligne d un autre utilisateur', async () => {
    const id = await echouer()
    expect(await retrySyncRow(autreId, id)).toBe(false)
    expect((await prisma.syncOutbox.findUniqueOrThrow({ where: { id } })).state).toBe('FAILED')
  })
})
```

Ajouter à `src/services/sync/flush.test.ts` :

```ts
import { flushAllSyncOutboxes } from './flush'

describe('drainage de tous les comptes', () => {
  it('ne draine que les comptes connectés', async () => {
    await saisir('2026-03-12')

    // Personne n'est connecté : rien n'est tenté, rien n'est marqué en échec.
    expect(await flushAllSyncOutboxes()).toEqual({ comptes: 0, traitees: 0 })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect(ligne.state).toBe('PENDING')
  })
})
```

`src/app/api/sync/flush/route.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

const { flushAllSyncOutboxes } = vi.hoisted(() => ({ flushAllSyncOutboxes: vi.fn() }))
vi.mock('@/services/sync/flush', () => ({ flushAllSyncOutboxes }))

import { POST } from './route'

function requete(authorization?: string): Request {
  return new Request('http://localhost:3000/api/sync/flush', {
    method: 'POST',
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  })
}

beforeEach(() => {
  flushAllSyncOutboxes.mockReset()
  flushAllSyncOutboxes.mockResolvedValue({ comptes: 1, traitees: 3 })
  process.env.SYNC_FLUSH_TOKEN = 'jeton-de-test'
})

afterAll(() => {
  delete process.env.SYNC_FLUSH_TOKEN
})

describe('POST /api/sync/flush', () => {
  it('refuse une requête sans jeton', async () => {
    const res = await POST(requete())
    expect(res.status).toBe(401)
    expect(flushAllSyncOutboxes).not.toHaveBeenCalled()
  })

  it('refuse un jeton faux', async () => {
    const res = await POST(requete('Bearer mauvais-jeton'))
    expect(res.status).toBe(401)
    expect(flushAllSyncOutboxes).not.toHaveBeenCalled()
  })

  it('refuse tout quand aucun jeton n est configuré', async () => {
    // Sans cette garde, un déploiement sans variable ouvrirait l'endpoint.
    delete process.env.SYNC_FLUSH_TOKEN
    const res = await POST(requete('Bearer '))
    expect(res.status).toBe(401)
    expect(flushAllSyncOutboxes).not.toHaveBeenCalled()
  })

  it('draine et rend le compte rendu avec le bon jeton', async () => {
    const res = await POST(requete('Bearer jeton-de-test'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ comptes: 1, traitees: 3 })
    expect(flushAllSyncOutboxes).toHaveBeenCalledTimes(1)
  })
})
```

`src/app/(app)/admin/sync/SyncClient.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { OpenConflict } from '@/services/sync/conflicts'
import type { FailedSyncRow } from '@/services/sync/queue'

const { arbitrer, synchroniserMaintenant, rejouer, revoquerGoogle } = vi.hoisted(() => ({
  arbitrer: vi.fn(),
  synchroniserMaintenant: vi.fn(),
  rejouer: vi.fn(),
  revoquerGoogle: vi.fn(),
}))
vi.mock('./actions', () => ({ arbitrer, synchroniserMaintenant, rejouer, revoquerGoogle }))

import { SyncClient } from './SyncClient'

const conflit: OpenConflict = {
  id: 'c1',
  entityId: 'e1',
  kind: 'REMOTE_MODIFIED',
  detectedAt: new Date('2026-03-20T10:00:00.000Z'),
  libelle: '2026-03-12 · ACME · ITSM · Consultant',
  remote: {
    summary: 'Déplacé à la main',
    startLocal: '2026-03-18T14:00:00',
    endLocal: '2026-03-18T18:00:00',
  },
}

const echec: FailedSyncRow = {
  id: 'r1',
  entityId: 'e2',
  operation: 'UPSERT',
  attempts: 5,
  lastError: 'Agenda injoignable : fetch failed',
  libelle: '2026-03-13 · ACME · ITSM · Consultant',
}

const CONNECTE = {
  connected: true,
  calendarId: 'cra@group.calendar.google.com',
  scope: 'calendar',
  connectedAt: new Date('2026-03-01T09:00:00.000Z'),
}

function renderSync(
  overrides: Partial<React.ComponentProps<typeof SyncClient>> = {},
): ReturnType<typeof render> {
  return render(
    <SyncClient
      connection={CONNECTE}
      conflicts={[]}
      failures={[]}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  arbitrer.mockReset()
  synchroniserMaintenant.mockReset()
  rejouer.mockReset()
  revoquerGoogle.mockReset()
})
afterEach(cleanup)

describe('état de la connexion', () => {
  it('propose de connecter quand aucun compte ne l est', () => {
    renderSync({
      connection: { connected: false, calendarId: '', scope: '', connectedAt: null },
    })
    const lien = screen.getByRole('link', { name: 'Connecter Google Calendar' })
    expect(lien.getAttribute('href')).toBe('/api/google/connect')
    expect(screen.queryByRole('button', { name: 'Révoquer la connexion' })).toBeNull()
  })

  it('affiche le calendrier dédié et propose de révoquer', () => {
    renderSync()
    expect(screen.getByText(/cra@group\.calendar\.google\.com/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Révoquer la connexion' })).toBeTruthy()
  })
})

describe('divergences', () => {
  it('offre les trois issues', () => {
    renderSync({ conflicts: [conflit] })
    expect(screen.getByText(/Déplacé à la main/)).toBeTruthy()
    for (const nom of ['Rétablir', 'Accepter', 'Détacher']) {
      expect(screen.getByRole('button', { name: nom })).toBeTruthy()
    }
  })

  it('affiche le motif quand l arbitrage est refusé', async () => {
    // Si la règle refuse, le conflit reste ouvert et le motif est affiché.
    arbitrer.mockResolvedValue({
      ok: false,
      reason: 'VERROUILLE',
      message: "Le CRA de ce mois est validé : la version de l'agenda ne peut pas être acceptée.",
    })
    renderSync({ conflicts: [conflit] })

    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('validé')
    })
    expect(arbitrer).toHaveBeenCalledWith('c1', 'ACCEPTER')
  })

  it('annonce quand il n y a rien à arbitrer', () => {
    renderSync()
    expect(screen.getByText('Aucune divergence à arbitrer.')).toBeTruthy()
  })
})

describe('échecs', () => {
  it('liste la ligne en échec avec son motif et propose de la rejouer', () => {
    renderSync({ failures: [echec] })
    expect(screen.getByText(/Agenda injoignable/)).toBeTruthy()
    expect(screen.getByText(/5 tentative/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rejouer' })).toBeTruthy()
  })
})

describe('synchroniser maintenant', () => {
  it('rend compte de ce qui a été fait', async () => {
    synchroniserMaintenant.mockResolvedValue({
      nonConnecte: false,
      traitees: 3,
      reussies: 2,
      conflits: 1,
      echecs: 0,
    })
    renderSync()

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        '3 élément(s) traité(s) : 2 synchronisé(s), 1 divergence(s), 0 échec(s).',
      )
    })
  })

  it('le dit quand aucun compte n est connecté', async () => {
    synchroniserMaintenant.mockResolvedValue({
      nonConnecte: true,
      traitees: 0,
      reussies: 0,
      conflits: 0,
      echecs: 0,
    })
    renderSync()

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Aucun agenda joignable. La saisie continue de fonctionner normalement.',
      )
    })
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/sync/ src/app/api/sync "src/app/(app)/admin/sync"`
Expected: FAIL — `listFailedSyncRows` et `flushAllSyncOutboxes` n'existent pas, `./route` et `./SyncClient` sont introuvables

- [ ] **Step 3: Compléter la file**

`src/services/sync/queue.ts` :

```ts
import { prisma } from '@/db/client'
import type { SyncOperation } from '@/core/sync/policy'
import { toIsoDate } from '@/services/time-entries'

export interface FailedSyncRow {
  id: string
  entityId: string
  operation: SyncOperation
  attempts: number
  lastError: string
  /** ce que la ligne visait, pour que l'écran soit lisible */
  libelle: string
}

/**
 * Les lignes tombées en échec, qui **remontent** dans l'écran de
 * synchronisation au lieu de disparaître.
 */
export async function listFailedSyncRows(userId: string): Promise<FailedSyncRow[]> {
  const rows = await prisma.syncOutbox.findMany({
    where: { userId, state: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
  })
  if (rows.length === 0) return []

  const entries = await prisma.timeEntry.findMany({
    where: { userId, id: { in: rows.map((r) => r.entityId) } },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  const parId = new Map(entries.map((e) => [e.id, e]))

  return rows.map((r) => {
    const entry = parId.get(r.entityId)
    return {
      id: r.id,
      entityId: r.entityId,
      operation: r.operation as SyncOperation,
      attempts: r.attempts,
      lastError: r.lastError,
      libelle:
        entry === undefined
          ? 'Saisie supprimée'
          : `${toIsoDate(entry.date)} · ${entry.line.mission.client.name} · ${entry.line.mission.label} · ${entry.line.label}`,
    }
  })
}

/** Remet une ligne en attente immédiate. Rend `false` si elle n'est pas à cet utilisateur. */
export async function retrySyncRow(userId: string, rowId: string): Promise<boolean> {
  const r = await prisma.syncOutbox.updateMany({
    where: { id: rowId, userId },
    data: { state: 'PENDING', attempts: 0, lastError: '', nextAttemptAt: new Date() },
  })
  return r.count > 0
}
```

Ajouter à `src/services/sync/flush.ts` — en complétant l'import existant de
`@/core/sync/policy` avec `PROVIDER_GOOGLE` :

```ts
/**
 * Draine la file de chaque compte connecté. C'est ce que l'endpoint interne
 * appelle : il n'a pas de session, donc pas d'utilisateur courant.
 */
export async function flushAllSyncOutboxes(
  limit = 50,
): Promise<{ comptes: number; traitees: number }> {
  const comptes = await prisma.providerCredential.findMany({
    where: { provider: PROVIDER_GOOGLE, calendarId: { not: '' } },
    select: { userId: true },
  })

  let traitees = 0
  for (const compte of comptes) {
    const r = await flushSyncOutbox({ userId: compte.userId, limit })
    traitees += r.traitees
  }
  return { comptes: comptes.length, traitees }
}
```

- [ ] **Step 4: Écrire l'endpoint**

`src/app/api/sync/flush/route.ts` :

```ts
import { timingSafeEqual } from 'node:crypto'
import { flushAllSyncOutboxes } from '@/services/sync/flush'

/** Comparaison à durée constante : un jeton ne se devine pas octet par octet. */
function jetonValide(header: string): boolean {
  const attendu = process.env.SYNC_FLUSH_TOKEN ?? ''
  // Aucun jeton configuré = endpoint fermé. Un déploiement qui oublie la
  // variable ne doit pas ouvrir la synchronisation à tout le monde.
  if (attendu === '') return false

  const fourni = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(fourni)
  const b = Buffer.from(attendu)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request): Promise<Response> {
  if (!jetonValide(request.headers.get('authorization') ?? '')) {
    return Response.json({ error: 'Jeton de synchronisation invalide.' }, { status: 401 })
  }

  const r = await flushAllSyncOutboxes()
  return Response.json(r, { status: 200 })
}
```

Dans `src/middleware.ts`, laisser passer l'endpoint — il porte son propre jeton
et n'a pas de session :

```ts
export const config = {
  matcher: ['/((?!api/auth|api/sync|_next/static|_next/image|favicon.ico).*)'],
}
```

Ajouter à `.env.example` :

```
# Jeton du déclenchement externe (cron, n8n) de POST /api/sync/flush.
# Vide = endpoint fermé. Le bouton « Synchroniser maintenant » suffit sans lui.
SYNC_FLUSH_TOKEN=""
```

- [ ] **Step 5: Écrire l'écran**

`src/app/(app)/admin/sync/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import type { ConflictResolution } from '@/core/sync/policy'
import { resolveConflict, type ResolveResult } from '@/services/sync/conflicts'
import { flushSyncOutbox, type FlushReport } from '@/services/sync/flush'
import { retrySyncRow } from '@/services/sync/queue'
import { disconnectGoogle } from '@/services/google/connect'

export async function synchroniserMaintenant(): Promise<FlushReport> {
  const user = await requireUser()
  const r = await flushSyncOutbox({ userId: user.id })
  revalidatePath('/admin/sync')
  return r
}

export async function arbitrer(
  conflictId: string,
  resolution: ConflictResolution,
): Promise<ResolveResult> {
  const user = await requireUser()
  const r = await resolveConflict({ userId: user.id, conflictId, resolution })
  revalidatePath('/admin/sync')
  return r
}

export async function rejouer(rowId: string): Promise<boolean> {
  const user = await requireUser()
  const r = await retrySyncRow(user.id, rowId)
  revalidatePath('/admin/sync')
  return r
}

export async function revoquerGoogle(): Promise<void> {
  const user = await requireUser()
  await disconnectGoogle(user.id)
  revalidatePath('/admin/sync')
}
```

`src/app/(app)/admin/sync/SyncClient.tsx` :

```tsx
'use client'

import { useState } from 'react'
import type { ConflictResolution } from '@/core/sync/policy'
import type { OpenConflict } from '@/services/sync/conflicts'
import type { FailedSyncRow } from '@/services/sync/queue'
import type { FlushReport } from '@/services/sync/flush'
import { arbitrer, rejouer, revoquerGoogle, synchroniserMaintenant } from './actions'

const ISSUES: Array<{ resolution: ConflictResolution; label: string }> = [
  { resolution: 'RETABLIR', label: 'Rétablir' },
  { resolution: 'ACCEPTER', label: 'Accepter' },
  { resolution: 'DETACHER', label: 'Détacher' },
]

const KIND_LABELS: Record<string, string> = {
  REMOTE_MODIFIED: "L'événement a été modifié dans l'agenda",
  REMOTE_DELETED: "L'événement a été supprimé de l'agenda",
}

function compteRendu(r: FlushReport): string {
  return r.nonConnecte
    ? 'Aucun agenda joignable. La saisie continue de fonctionner normalement.'
    : `${r.traitees} élément(s) traité(s) : ${r.reussies} synchronisé(s), ${r.conflits} divergence(s), ${r.echecs} échec(s).`
}

export function SyncClient(props: {
  connection: { connected: boolean; calendarId: string; scope: string; connectedAt: Date | null }
  conflicts: OpenConflict[]
  failures: FailedSyncRow[]
}) {
  const [info, setInfo] = useState<string | null>(null)
  const [refus, setRefus] = useState<string | null>(null)

  async function onArbitrer(id: string, resolution: ConflictResolution): Promise<void> {
    const r = await arbitrer(id, resolution)
    // Si la règle refuse, le conflit reste ouvert et le motif est affiché :
    // un arbitrage silencieusement sans effet serait pire que pas d'arbitrage.
    setRefus(r.ok ? null : r.message)
    setInfo(r.ok ? 'Divergence arbitrée.' : null)
  }

  return (
    <div className="flex flex-col gap-8">
      {info && (
        <p role="status" className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          {info}
        </p>
      )}
      {refus && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {refus}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-medium">Connexion</h2>
        {props.connection.connected ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Connecté. Calendrier dédié : <code>{props.connection.calendarId}</code>
            </p>
            <form action={revoquerGoogle}>
              <button className="rounded border px-3 py-1 text-sm">Révoquer la connexion</button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-slate-600">
              Aucun agenda connecté. La saisie fonctionne normalement ; rien n’est poussé.
            </p>
            <a href="/api/google/connect" className="w-fit rounded border px-3 py-1">
              Connecter Google Calendar
            </a>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Synchronisation</h2>
        <button
          className="rounded border px-3 py-1 text-sm"
          onClick={async () => {
            setRefus(null)
            setInfo(compteRendu(await synchroniserMaintenant()))
          }}
        >
          Synchroniser maintenant
        </button>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Divergences</h2>
        {props.conflicts.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune divergence à arbitrer.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {props.conflicts.map((c) => (
              <li key={c.id} className="rounded border p-3 text-sm">
                <p className="font-medium">{c.libelle}</p>
                <p className="text-slate-600">{KIND_LABELS[c.kind] ?? c.kind}</p>
                {c.remote && (
                  <p className="text-slate-600">
                    Agenda : « {c.remote.summary} » {c.remote.startLocal} → {c.remote.endLocal}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  {ISSUES.map((i) => (
                    <button
                      key={i.resolution}
                      className="rounded border px-2 py-1"
                      onClick={() => void onArbitrer(c.id, i.resolution)}
                    >
                      {i.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Échecs</h2>
        {props.failures.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun échec en attente.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {props.failures.map((f) => (
              <li key={f.id} className="rounded border p-3 text-sm">
                <p className="font-medium">{f.libelle}</p>
                <p className="text-slate-600">
                  {f.operation} · {f.attempts} tentative(s) · {f.lastError}
                </p>
                <button
                  className="mt-2 rounded border px-2 py-1"
                  onClick={async () => {
                    await rejouer(f.id)
                    setInfo('Ligne remise en file.')
                  }}
                >
                  Rejouer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

`src/app/(app)/admin/sync/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { getConnectionState } from '@/services/google/connect'
import { listOpenConflicts } from '@/services/sync/conflicts'
import { listFailedSyncRows } from '@/services/sync/queue'
import { SyncClient } from './SyncClient'

export default async function AdminSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const user = await requireUser()
  const { message } = await searchParams

  const [connection, conflicts, failures] = await Promise.all([
    getConnectionState(user.id),
    listOpenConflicts(user.id),
    listFailedSyncRows(user.id),
  ])

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Administration · Synchronisation</h1>
      {message && (
        <p className="mb-4 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <SyncClient connection={connection} conflicts={conflicts} failures={failures} />
    </main>
  )
}
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/sync/ src/app/api/sync "src/app/(app)/admin/sync"`
Expected: PASS — 5 + 1 + 4 + 8 = 18 tests nouveaux plus tous les existants

- [ ] **Step 7: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sync): internal flush endpoint, manual trigger and synchronisation screen"
```

---

## Task 12: La saisie par créneau et le signalement des créneaux non prévus

**Files:** Modify `src/services/time-entries.ts`, `src/services/time-entries.test.ts`, `src/app/(app)/saisie/[month]/actions.ts`, `src/app/(app)/saisie/[month]/page.tsx`, `src/app/(app)/saisie/[month]/SaisieClient.tsx`, `src/components/grid/MonthGrid.tsx`, `src/components/grid/MonthGrid.test.tsx`

**Interfaces:**
- Consumes: `Slot` (`src/core/time/slots.ts`), `AppSettings.slots`, `enqueueTimeEntry` (6)
- Produces:
  - `interface SlotWarning { slotId: string; allowedSlotIds: string[] }`
  - `SaveResult` branche `ok: true` gagne `slotWarning?: SlotWarning`
  - `saveCell(args: { …; slotId?: string })`
  - `MonthGrid` et `SaisieClient` gagnent `slots?: Slot[]` ; `onSave(lineId, date, raw, slotId)`

**Le geste principal ne change pas.** Sans choix explicite, la cellule reste à la journée et la saisie rapide au glissement fonctionne exactement comme avant. Ce lot débloque au passage `allowedSlotIds`, présent en base depuis le lot 0 : saisir un créneau qu'une ligne n'accepte pas déclenche un **signalement**, pas un refus.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `src/services/time-entries.test.ts` :

```ts
describe('saisie par créneau', () => {
  it('enregistre une saisie sur un créneau', async () => {
    const r = await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-12',
      minutes: 240,
      kind: 'REALISE',
      slotId: 'matin',
    })
    expect(r).toEqual({ ok: true, minutes: 240 })

    const entries = await getMonthEntries(userId, '2026-03')
    expect(entries.map((e) => e.slotId)).toEqual(['matin'])
  })

  it('laisse deux créneaux coexister le même jour sur la même ligne', async () => {
    await updateSettings({ capacityMode: 'DESACTIVE' })
    await saveEntry({
      userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'matin',
    })
    await saveEntry({
      userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'apres-midi',
    })

    const entries = await getMonthEntries(userId, '2026-03')
    expect(entries.map((e) => e.slotId).sort()).toEqual(['apres-midi', 'matin'])
  })

  it('signale un créneau non prévu sans refuser la saisie', async () => {
    // Conformément au lot 0 : signalement, jamais refus.
    const ligne = await createLine({
      missionId: missionA, userId, label: 'Nuit only', soldCentiemes: 3000, tjmCents: 0,
      allowedSlotIds: ['nuit'],
    })

    const r = await saveEntry({
      userId, lineId: ligne.id, date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'matin',
    })

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.slotWarning).toEqual({ slotId: 'matin', allowedSlotIds: ['nuit'] })
    expect(await prisma.timeEntry.count({ where: { userId, lineId: ligne.id } })).toBe(1)
  })

  it('ne signale rien quand le créneau est autorisé', async () => {
    const ligne = await createLine({
      missionId: missionA, userId, label: 'Nuit ok', soldCentiemes: 3000, tjmCents: 0,
      allowedSlotIds: ['nuit'],
    })

    const r = await saveEntry({
      userId, lineId: ligne.id, date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'nuit',
    })
    expect(r).toEqual({ ok: true, minutes: 240 })
  })

  it('ne signale rien quand la ligne n impose aucun créneau', async () => {
    const r = await saveEntry({
      userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'nuit',
    })
    expect(r).toEqual({ ok: true, minutes: 240 })
  })

  it('ne signale rien pour une saisie à la journée', async () => {
    const ligne = await createLine({
      missionId: missionA, userId, label: 'Nuit journée', soldCentiemes: 3000, tjmCents: 0,
      allowedSlotIds: ['nuit'],
    })

    const r = await saveEntry({
      userId, lineId: ligne.id, date: '2026-03-12', minutes: 240, kind: 'REALISE',
    })
    expect(r).toEqual({ ok: true, minutes: 240 })
  })

  it('met en file une ligne par créneau', async () => {
    await updateSettings({ capacityMode: 'DESACTIVE' })
    await saveEntry({
      userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'matin',
    })
    await saveEntry({
      userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'apres-midi',
    })

    // Un événement Google par ligne de temps, jamais de fusion.
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(2)
  })
})
```

`missionA` n'existe pas encore dans ce fichier : ajouter `let missionA = ''` avec
les autres identifiants, et `missionA = m.id` dans le `beforeAll`, juste après la
création de la mission `M`.

Ajouter à `src/components/grid/MonthGrid.test.tsx` :

```tsx
import { DEFAULT_SLOTS } from '@/services/settings'

describe('saisie par créneau', () => {
  it('ne montre aucun sélecteur quand aucun créneau n est configuré', () => {
    renderGrid()
    expect(screen.queryByLabelText('Créneau — Consultant ITSM')).toBeNull()
  })

  it('propose la journée par défaut, puis les créneaux', () => {
    renderGrid({ slots: DEFAULT_SLOTS })
    const select = screen.getByLabelText('Créneau — Consultant ITSM') as HTMLSelectElement

    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Journée',
      'Matin',
      'Après-midi',
      'Nuit',
    ])
  })

  it('enregistre sur le créneau choisi', async () => {
    const onSave = vi.fn(async () => true)
    renderGrid({ slots: DEFAULT_SLOTS, onSave })

    fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM'), {
      target: { value: 'matin' },
    })
    const input = cell('Consultant ITSM', '2026-03-13')
    fireEvent.change(input, { target: { value: '0,5' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('l1', '2026-03-13', '0,5', 'matin'),
    )
  })

  it('rend éditable une cellule agrégée dès qu un créneau est choisi', () => {
    // Ligne l2 : sa cellule du 12 agrège un créneau, donc verrouillée en vue
    // journée — mais éditable dès qu'on se place sur le créneau lui-même.
    renderGrid({ slots: DEFAULT_SLOTS })
    expect(cell('Consultant ITSM Nuit', '2026-03-12').readOnly).toBe(true)

    fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM Nuit'), {
      target: { value: 'nuit' },
    })
    expect(cell('Consultant ITSM Nuit', '2026-03-12').readOnly).toBe(false)
  })

  it('laisse la saisie rapide au glissement inchangée', async () => {
    const onSave = vi.fn(async () => true)
    renderGrid({ slots: DEFAULT_SLOTS, onSave })

    const debut = cell('Consultant ITSM', '2026-03-16')
    fireEvent.mouseDown(debut.parentElement as HTMLElement)
    fireEvent.mouseEnter(cell('Consultant ITSM', '2026-03-17').parentElement as HTMLElement)
    fireEvent.mouseUp(debut.parentElement as HTMLElement)
    fireEvent.change(debut, { target: { value: '1' } })
    fireEvent.keyDown(debut, { key: 'Enter' })

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    // Journée par défaut : le geste principal n'est pas modifié.
    expect(onSave).toHaveBeenCalledWith('l1', '2026-03-16', '1', '')
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/time-entries.test.ts src/components/grid/MonthGrid.test.tsx`
Expected: FAIL — `slotWarning` est `undefined`, `slots` n'existe pas sur les props

- [ ] **Step 3: Signaler côté service**

Dans `src/services/time-entries.ts`, ajouter le type et l'élargir dans `SaveResult` :

```ts
/** Créneau saisi que la ligne ne prévoit pas — signalement, jamais refus. */
export interface SlotWarning {
  slotId: string
  allowedSlotIds: string[]
}

export type SaveResult =
  | { ok: true; minutes: number; warning?: CapacityWarning; slotWarning?: SlotWarning }
  | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number }
  | { ok: false; reason: 'VERROUILLE' }
  | { ok: false; reason: 'NON_AFFECTE' }
```

Élargir la lecture de l'affectation — la liste des créneaux autorisés est
stockée en chaîne séparée par des virgules, jamais en tableau :

```ts
  const assignment = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { line: { select: { missionId: true, allowedSlotIds: true } } },
  })
```

Puis, juste avant le `return` final :

```ts
  // Une ligne qui n'énumère aucun créneau les accepte tous ; une saisie à la
  // journée n'est jamais concernée.
  const allowedSlotIds =
    assignment.line.allowedSlotIds === '' ? [] : assignment.line.allowedSlotIds.split(',')
  const slotWarning: SlotWarning | null =
    slotId !== '' && allowedSlotIds.length > 0 && !allowedSlotIds.includes(slotId)
      ? { slotId, allowedSlotIds }
      : null

  return {
    ok: true,
    minutes: args.minutes,
    ...(warning === null ? {} : { warning }),
    ...(slotWarning === null ? {} : { slotWarning }),
  }
```

en remplaçant l'ancien `return warning === null ? … : …`.

- [ ] **Step 4: Transmettre le créneau depuis l'écran**

Dans `src/app/(app)/saisie/[month]/actions.ts`, élargir `saveCell` :

```ts
export async function saveCell(args: {
  lineId: string
  date: string
  raw: string
  kind: TimeEntryKind
  month: string
  slotId?: string
}): Promise<SaveResult | { ok: false; reason: 'SAISIE_INVALIDE' }> {
```

et transmettre au service :

```ts
  const result = await saveEntry({
    userId: user.id,
    lineId: args.lineId,
    date: args.date,
    minutes,
    kind: args.kind,
    slotId: args.slotId ?? '',
  })
```

Dans `src/app/(app)/saisie/[month]/page.tsx`, passer les créneaux :

```tsx
        slots={settings.slots}
```

Dans `src/app/(app)/saisie/[month]/SaisieClient.tsx` : ajouter `slots?: Slot[]`
aux props (`import type { Slot } from '@/core/time/slots'`), le transmettre à
`MonthGrid`, élargir `handleSave` d'un quatrième paramètre `slotId = ''` transmis
à `saveCell`, et signaler le créneau non prévu — après le message de capacité,
avant celui d'occupation :

```tsx
      } else if (r.slotWarning) {
        setMessage(
          `Ce créneau n’est pas prévu pour cette ligne (créneaux prévus : ${r.slotWarning.allowedSlotIds.join(', ')}). La saisie est conservée.`,
        )
      } else if ((props.busyDates ?? []).includes(date)) {
```

- [ ] **Step 5: Choisir un créneau dans la grille**

Dans `src/components/grid/MonthGrid.tsx` :

```tsx
import type { Slot } from '@/core/time/slots'
```

Ajouter aux props `slots = []` / `slots?: Slot[]`, et élargir `onSave` :

```tsx
  /** créneaux configurés ; vide = saisie à la journée uniquement */
  slots?: Slot[]
  /** renvoie `true` quand la valeur a bien été enregistrée */
  onSave: (lineId: string, date: string, raw: string, slotId: string) => Promise<boolean>
```

Ajouter l'index par créneau, à côté de l'agrégation existante :

```tsx
function slotKey(lineId: string, date: string, slotId: string): string {
  return `${lineId}|${date}|${slotId}`
}

/** Saisies indexées sur leur clé réelle : (ligne, jour, créneau). */
function buildSlotCells(entries: MonthEntry[]): Map<string, Cell> {
  const cells = new Map<string, Cell>()
  for (const e of entries) {
    cells.set(slotKey(e.lineId, e.date, e.slotId), {
      lineId: e.lineId,
      minutes: e.minutes,
      kind: e.kind,
      hasSlots: e.slotId !== '',
    })
  }
  return cells
}
```

Dans le composant :

```tsx
  const slotCells = useMemo(() => buildSlotCells(entries), [entries])
  // Créneau courant par ligne. Vide = journée, et c'est le défaut : le geste
  // principal n'est pas modifié par ce lot.
  const [slotByLine, setSlotByLine] = useState<ReadonlyMap<string, string>>(new Map())

  const slotDe = useCallback(
    (lineId: string) => slotByLine.get(lineId) ?? '',
    [slotByLine],
  )
```

`serverValues` lit désormais la cellule correspondant au créneau courant :

```tsx
  const serverValues = useMemo(() => {
    const values = new Map<string, string>()
    for (const line of lines) {
      const slot = slotByLine.get(line.id) ?? ''
      for (const d of days) {
        const key = cellKey(line.id, d.date)
        const cell = slot === '' ? cells.get(key) : slotCells.get(slotKey(line.id, d.date, slot))
        if (cell === undefined) continue
        values.set(key, formatQuantity(cell.minutes, line.displayUnit, line.minutesParJour))
      }
    }
    return values
  }, [cells, slotCells, lines, days, slotByLine])
```

`commit` ne verrouille plus la cellule que dans la vue journée, et transmet le
créneau :

```tsx
  const commit = useCallback(
    async (lineId: string, date: string, raw: string) => {
      const key = cellKey(lineId, date)
      const slot = slotByLine.get(lineId) ?? ''

      // En vue journée, réécrire une cellule qui agrège des créneaux créerait
      // une saisie supplémentaire à créneau vide, qui doublerait le total du
      // jour. Sur un créneau choisi, la cellule vise cette saisie précise.
      if (slot === '' && cells.get(key)?.hasSlots === true) {
        setCell(key, serverValues.get(key) ?? '')
        return
      }

      setCell(key, raw)
      const saved = await onSave(lineId, date, raw, slot)
      if (!saved) setCell(key, serverValues.get(key) ?? '')
    },
    [cells, onSave, serverValues, setCell, slotByLine],
  )
```

et le calcul de `parCreneaux` dans le rendu :

```tsx
                const parCreneaux = slotDe(l.id) === '' && cell?.hasSlots === true
```

Enfin, le sélecteur dans l'en-tête de ligne :

```tsx
              <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left font-normal">
                <span className="mr-2">{l.label}</span>
                {slots.length > 0 && (
                  <select
                    aria-label={`Créneau — ${l.label}`}
                    value={slotDe(l.id)}
                    onChange={(ev) =>
                      setSlotByLine((prev) => new Map(prev).set(l.id, ev.target.value))
                    }
                    className="rounded border px-1 py-0.5 text-xs"
                  >
                    <option value="">Journée</option>
                    {slots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
              </th>
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/time-entries.test.ts src/components/grid/MonthGrid.test.tsx`
Expected: PASS — 12 tests nouveaux plus tous les existants

- [ ] **Step 7: Vérifier que les blocs suivent le créneau**

Run: `npx vitest run src/services/sync/flush.test.ts`
Expected: PASS — `traiterUpsert` lit déjà `settings.slots` et passe le créneau à
`buildCalendarEvent`, ajouté à la tâche 7.

- [ ] **Step 8: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(saisie): per-cell slot entry and non-blocking warning on unexpected slots"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche |
|---|---|
| `SyncOutbox`, unicité sur `(entityType, entityId, provider)` | 1, 6 |
| `SyncConflict`, `resolution` `RETABLIR`/`ACCEPTER`/`DETACHER` | 1, 8 |
| `ProviderCredential`, jetons chiffrés AES-256-GCM, clé d'environnement | 1, 2 |
| `ExternalLink.etag` | 1, 7 |
| `Settings.journeeDebutMinute` / `journeeFinMinute` (9 h – 18 h) | 1 |
| Portabilité SQLite/Postgres : aucun enum, aucun décimal, aucun tableau | 1 |
| Mise en file dans la transaction de `saveEntry`, `convertPastForecast`, suppression | 6 |
| Drainage `UPSERT` / `DELETE` | 7 |
| Recul progressif 1 min / 5 min / 15 min / 1 h / 6 h, `FAILED` au-delà de 5 | 4, 7 |
| Les échecs remontent dans l'écran de synchronisation | 11 |
| `POST /api/sync/flush` protégé par jeton, plus bouton « Synchroniser maintenant » | 11 |
| Un événement par ligne de temps, jamais de fusion | 3, 7, 12 |
| Titre `client · mission · ligne`, `transparency: opaque`, couleur par `kind`, `craEntryId` | 3 |
| Heures : créneau, sinon départ à `journeeDebutMinute` pour la durée saisie | 3 |
| Lecture `freeBusy` à l'ouverture du mois, sans cache | 9 |
| **Calendrier dédié exclu de la requête d'occupation** | 5, 9 |
| Avertissement non bloquant sur un jour occupé | 9 |
| Détection par etag : conflit et **aucune écriture** | 7 |
| 404 / 410 → `REMOTE_DELETED` | 5, 7 |
| **« Accepter » passe par les règles de `saveEntry`**, verrouillage compris | 8 |
| « Rétablir » réécrit ou recrée ; « Détacher » rompt le lien | 8 |
| Connexion Google, calendrier dédié créé s'il n'existe pas, révocation | 10 |
| Saisie par créneau ; `allowedSlotIds` en signalement, jamais en refus | 12 |
| **Aucun test n'appelle Google** — double d'API | 5, et toutes les tâches consommatrices |
| Résilience : compte non connecté, appel en échec, appel expiré | 7, 9 |
| Isolation par utilisateur sur tous les services | 2, 7, 8, 9, 10, 11 |

**Hors périmètre, conformément à la spec :** relecture de l'agenda pour
pré-remplir le réalisé (synchronisation bidirectionnelle), multi-agendas en
lecture, second fournisseur, notifications.

## Vérification finale

- [ ] `npx vitest run` — toute la suite verte
- [ ] `npx tsc --noEmit` — 0 erreur
- [ ] `grep -rn "globalThis.fetch\|https://www.googleapis.com\|https://oauth2\|https://accounts.google.com" src --include="*.test.ts" --include="*.test.tsx"` — aucune ligne
- [ ] `node scripts/set-db-provider.mjs sqlite` — le dépôt reste dans son état de développement
- [ ] Une migration Postgres accompagne les cinq changements de schéma, sous `prisma/migrations/`

---

## Arbitrage — propriété des tables de synchronisation

Les plans des lots **1b** et **2** décrivent tous deux la création de `SyncOutbox` et `ProviderCredential`. C'est voulu : les deux specs disent « celui qui arrive le premier les pose ». Elles doivent n'être créées **qu'une fois**.

**Décision : le lot 1b les porte**, conformément à l'ordre de construction retenu (1e → 1c → 1b → 2). Quand le lot 2 sera implémenté, ses tâches de création de schéma deviennent des tâches de consommation. Si l'ordre change, les rôles s'échangent — les tables sont conçues indépendantes du fournisseur exactement pour cela.

**Contradiction résolue sur le scope de `ProviderCredential`.** Le plan 1b y ajoutait un `userId` au nom de la règle de scoping du projet ; le plan 2 le refusait, y voyant un réglage d'instance. Les deux ont raison pour leur fournisseur :

- une **clé d'API Dolibarr** appartient à l'instance — il y en a une pour l'organisation ;
- un **jeton Google Calendar est personnel** — le jour où plusieurs consultants travaillent, chacun connecte son propre agenda, sinon on bloque les journées d'un autre.

`ProviderCredential.userId` est donc **nullable**, avec unicité sur `(provider, userId)`. Nul signifie identifiant d'instance, renseigné signifie identifiant personnel.

`SyncOutbox` reste scopée par utilisateur : ses lignes désignent des saisies et des CRA, qui le sont.
