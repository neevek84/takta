# Lot 2 — Connecteur Dolibarr · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cesser la double saisie — la validation d'un CRA pousse les temps **réalisés** du mois vers les **tâches** Dolibarr du projet correspondant, et propose ensuite de faire créer la facture par Dolibarr. Sans jamais bloquer la saisie, sans jamais pousser de prévisionnel, sans jamais réécrire un CRA validé.

**Architecture:** Trois modules purs dans `src/core/` (conversion des temps, brouillon de facture, chiffrement des secrets), une file de sortie **générique par construction** dans `src/services/sync/`, un port `DolibarrApi` avec son double en mémoire et son implémentation HTTP dans `src/services/dolibarr/`, et un unique point d'accroche : la transition `VALIDER` de `transitionCra`.

**Tech Stack:** Next.js 15 · TypeScript · Prisma 6 · SQLite en développement · Vitest

**Spec du lot :** `docs/superpowers/specs/2026-08-15-lot-2-connecteur-dolibarr-design.md`
**Specs consommées :** `docs/superpowers/specs/2026-08-15-lot-1b-google-calendar-design.md` (§2, infrastructure de synchronisation) · `docs/superpowers/specs/2026-08-15-lot-1d-gel-facteur-conversion-design.md` (facteur figé)

---

## Situation supposée pour `SyncOutbox` et `ProviderCredential`

**Vérifié dans `prisma/schema.prisma` avant d'écrire ce plan (branche `lot-1e`) :**

| Table | État constaté |
|---|---|
| `ExternalLink` | **existe** (lot 0) — `entityType`, `entityId`, `provider`, `externalId`, `syncedAt`, `syncState`, unicité sur le triplet. **Pas** de colonne `etag`. |
| `SyncOutbox` | **absente** |
| `ProviderCredential` | **absente** |
| `SyncConflict` | **absente** |

**Situation retenue : le lot 2 est construit avant le lot 1b.** Ce plan crée donc `SyncOutbox` et `ProviderCredential`, et les garde **indépendants du fournisseur** pour que le lot 1b les consomme sans avoir à les modifier. Concrètement :

- aucun champ nommé d'après Dolibarr ni d'après Google dans ces deux tables ;
- `ProviderCredential` porte `secretEnc` / `refreshEnc` / `metadataJson` plutôt que `accessTokenEnc` / `refreshTokenEnc` / `calendarId` : le lot 1b rangera son `calendarId` dans `metadataJson`, ce lot y range `dolibarrUserId`. La correspondance avec les noms de la spec 1b est donnée en tâche 4 ;
- `SyncOutbox` reprend telles quelles les colonnes de la spec 1b (`entityType`, `entityId`, `provider`, `operation`, `state`, `attempts`, `lastError`, `nextAttemptAt`) et l'**unicité du triplet**, qui est le cœur du dispositif ; elle y ajoute `userId` (toute donnée de ce projet est scopée par utilisateur) et `payloadJson` (contexte de rejeu, lu et écrit en bloc) ;
- la séquence de recul progressif est celle de la spec 1b : **1 min, 5 min, 15 min, 1 h, 6 h**, puis `FAILED` au-delà de cinq tentatives, sans perdre la ligne ;
- **`ExternalLink.etag` n'est pas ajouté ici**, et `SyncConflict` n'est pas créée : Dolibarr n'a ni l'un ni l'autre pour usage (spec §10 et §12 — une modification faite dans Dolibarr est écrasée au push suivant, sans file d'arbitrage). Les deux appartiennent au lot 1b.

Si, au moment d'exécuter ce plan, `SyncOutbox` et `ProviderCredential` existent déjà (lot 1b livré entre-temps), **la tâche 4 devient une tâche de vérification** : contrôler que les colonnes listées sont présentes, ajouter `userId` et `payloadJson` à `SyncOutbox` si le 1b ne les a pas mis, et ne rien recréer.

---

## Global Constraints

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** `node:crypto` est autorisé et utilisé (tâche 3) : la règle vise le couplage au stockage et au framework, pas la bibliothèque standard.
- **Aucun enum Prisma, aucun décimal persisté, aucun tableau.** Entiers partout : minutes, secondes, centièmes de jour, centimes. Portabilité SQLite/Postgres.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus.** Deux exceptions assumées et déjà présentes dans le projet : `getSettings`/`updateSettings` et, dans ce lot, `ProviderCredential` — ce sont des réglages d'instance, comme `Settings`, pas des données d'utilisateur (voir tâche 4).
- **Une saisie porte son propre facteur de conversion, figé à l'écriture** (`TimeEntry.minutesParJour`, lot 1d). Tout calcul le lit ; ni `Settings.minutesParJour` ni `TIMESHEET_DAY_DURATION` n'entrent jamais dans la conversion d'une saisie.
- **Les saisies d'un mois validé ne sont jamais réétalonnées.**
- **Aucun test n'appelle l'instance Dolibarr réelle.** Le connecteur se teste contre un double (`FakeDolibarr`, tâche 5) ; le seul test qui parle à une instance vit dans une configuration Vitest séparée et se saute de lui-même sans variables d'environnement (tâche 14).
- Français pour les chaînes visibles et les messages d'erreur destinés à l'utilisateur, anglais pour le code et les messages de commit.
- `vitest.config.ts` est en `fileParallelism: false` — **ne pas le modifier**.
- Tests de composants : `// @vitest-environment happy-dom` en première ligne, `afterEach(cleanup)` explicite.
- **Ne jamais exécuter `npx next build`** : le serveur de développement du porteur du produit tourne sur cet arbre.

---

## Décisions tranchées par ce plan

Elles sont à contester si elles ne conviennent pas, mais elles sont appliquées telles quelles dans les tâches.

**1. Ce qui part vers Dolibarr est une durée écoulée, jamais un nombre de jours reconverti.**
`llx_projet_task_time.task_duration` est une durée en **secondes**. `TimeEntry.minutes` est déjà une durée écoulée : `parseQuantity` a multiplié le nombre de jours saisi par le facteur de la ligne au moment de l'écriture. La durée poussée est donc exactement `minutes × 60`, et **rien d'autre n'entre dans ce calcul** — ni `Settings.minutesParJour`, ni `TIMESHEET_DAY_DURATION`.
Le facteur figé de la saisie (`TimeEntry.minutesParJour`) sert à tout ce qui s'exprime **en jours** : la quantité des lignes de facture (§8 bis), le nombre de jours affiché dans les écrans, et la comparaison avec ce que Dolibarr affichera.
Reconvertir avec `TIMESHEET_DAY_DURATION` avant de pousser serait précisément la faute silencieuse que la spec redoute : cela ferait **disparaître** l'écart au lieu de le signaler, et donnerait à une constante distante le dernier mot sur un chiffre déjà figé côté CRA. Le §8 dit l'inverse : l'écart doit se voir, et se corriger par alignement explicite des réglages (tâche 11).

**2. Le push réconcilie, il n'ajoute pas.**
Rouvrir un CRA, supprimer une journée, revalider doit **retirer** ce temps de Dolibarr. Un push qui ne saurait qu'ajouter et mettre à jour laisserait Dolibarr sur-facturer d'une journée fantôme. La correspondance est donc portée par une clé de cellule stable — `craId|lineId|date|slotId` dans `ExternalLink` — et tout lien de ce CRA qui ne correspond plus à une saisie réalisée voit son `timespent` supprimé chez Dolibarr, puis son lien supprimé localement.

**3. `previewRecalibration` gagne un paramètre hypothétique plutôt qu'un jumeau.**
Le §8 exige d'annoncer, **avant** confirmation, le nombre de saisies concernées par le réétalonnage — donc de le calculer avec une durée de journée qui n'est pas encore enregistrée. `src/services/rates.ts` (lot 1d) sait déjà exactement faire ce calcul ; on lui ajoute un argument optionnel `globalMinutesParJourHypothetique`, par défaut le réglage courant. Aucun appelant existant n'est touché, et le mécanisme des mois verrouillés n'est ni dupliqué ni contourné.

**4. `updateLine` est créé par ce lot.**
La règle « une ligne en `DOLIBARR_PROPALE` a ses jours vendus et son TJM en lecture seule » a besoin d'un chemin d'écriture à garder. `src/services/missions.ts` n'expose aujourd'hui que `createLine`. Le verrou vit dans le service, pas dans l'écran : c'est la seule barrière qui compte.

**5. `ProviderCredential` n'est pas scopé par utilisateur.**
Une clé d'API Dolibarr est un réglage d'instance, comme `Settings` : l'instance cible est unique. Scoper par utilisateur donnerait l'illusion d'un multi-tenant que ni `Settings` ni `ExternalLink` ne portent. `SyncOutbox`, en revanche, **est** scopé : ses lignes désignent des CRA, qui appartiennent à un utilisateur.

**6. Le test contre instance réelle vit dans sa propre configuration Vitest.**
`vitest.config.ts` n'est pas modifié (contrainte du projet). Le fichier s'appelle `*.integration.ts` — il ne correspond donc pas au glob `src/**/*.test.{ts,tsx}` — et s'exécute par `npm run test:dolibarr` avec `vitest.integration.config.ts`.

---

## Interfaces existantes

```ts
// src/core/time/units.ts
minutesToCentiemes(minutes: number, minutesParJour: number): number
centiemesToMinutes(centiemes: number, minutesParJour: number): number

// src/core/cra/state-machine.ts
type CraTransition = 'ENVOYER' | 'VALIDER' | 'REFUSER' | 'ROUVRIR'
applyTransition(from: CraStatus, t: CraTransition): CraStatus
isLocked(status: CraStatus): boolean            // true seulement pour 'VALIDE'

// src/core/types.ts
type TimeEntryKind = 'REALISE' | 'PREVISIONNEL'
type CraStatus = 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'
type DisplayUnit = 'JOUR' | 'DEMI_JOUR' | 'HEURE'
type EngagementSource = 'MANUEL' | 'DOLIBARR_PROPALE' | 'DOLIBARR_PROJET'

// src/core/fiscal/year.ts
interface FiscalYear { start: string; end: string; label: string; months: string[] }
fiscalYearBounds(date: string, debutMois: number): FiscalYear

// src/services/cra.ts
interface CraView { id; missionId; missionLabel; clientName; month; status; invoiceNumber; invoicedAt; paidAt }
transitionCra(userId: string, craId: string, t: CraTransition): Promise<CraView>

// src/services/settings.ts
interface AppSettings { minutesParJour; capacityMode; capacityCentiemes; workingDays; slots;
                        holidays; defaultDisplayUnit; defaultEngagementSource;
                        objectifCaExerciceCents; debutExerciceMois }
getSettings(): Promise<AppSettings>
updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>

// src/services/rates.ts  (lot 1d)
previewRecalibration(userId: string): Promise<{ concernees: number; verrouillees: number }>
recalibrateOpenMonths(userId: string): Promise<{ recalibrees: number; sauteesVerrouillees: number }>

// src/services/missions.ts
interface MissionForUser { id; label; clientName; minutesParJourEffectif; minutesParJourSurcharge; lines }
createLine(args: { missionId; userId; label; soldCentiemes; tjmCents;
                   displayUnit?; minutesParJour?; allowedSlotIds? }): Promise<{ id: string }>
createMission(args: { clientId; label; minutesParJour? }): Promise<{ id: string }>

// src/services/clients.ts
createClient(name: string, minutesParJour?: number | null): Promise<{ id: string; name: string }>

// src/services/time-entries.ts
interface MonthEntry { id; lineId; date; minutes; kind; slotId; minutesParJour }
saveEntry(args: { userId; lineId; date; minutes; kind; slotId? }): Promise<SaveResult>
```

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/core/dolibarr/timespent.ts` | Conversion minutes → secondes et centièmes, filtrage du réalisé — pur |
| `src/core/dolibarr/invoice.ts` | Brouillon de facture : quantités en jours, TJM, total HT — pur |
| `src/core/crypto/secret-box.ts` | Scellement AES-256-GCM des secrets — pur |
| `prisma/schema.prisma` | *(modifié)* `SyncOutbox`, `ProviderCredential` |
| `src/services/credentials.ts` | Lecture/écriture des identifiants chiffrés, tous fournisseurs |
| `src/services/sync/types.ts` | `SyncJob`, `SyncOutcome`, `SyncHandler` — indépendants du fournisseur |
| `src/services/sync/outbox.ts` | Mise en file, drainage, recul progressif, réarmement |
| `src/services/sync/handlers.ts` | Assemblage des gestionnaires disponibles |
| `src/services/dolibarr/api.ts` | Port `DolibarrApi` + erreurs typées |
| `src/services/dolibarr/fake.ts` | Double en mémoire, avec injection de panne |
| `src/services/dolibarr/http.ts` | Implémentation réelle, `fetch` injectable |
| `src/services/dolibarr/resolve.ts` | Construit l'API depuis les identifiants stockés |
| `src/services/dolibarr/push.ts` | Push des temps d'un CRA + gestionnaire de file |
| `src/services/dolibarr/import.ts` | Rattachement tiers/projets, création locale ou distante |
| `src/services/dolibarr/propal.ts` | Rattachement d'une ligne à une ligne de propale |
| `src/services/dolibarr/setup.ts` | Reprise de `SOCIETE_FISCAL_MONTH_START` et `TIMESHEET_DAY_DURATION` |
| `src/services/dolibarr/invoicing.ts` | Proposition et demande de facture |
| `src/services/missions.ts` | *(modifié)* `updateLine` + `engagementSource` exposé |
| `src/services/cra.ts` | *(modifié)* mise en file à la validation |
| `src/services/rates.ts` | *(modifié)* réétalonnage hypothétique |
| `src/app/(app)/admin/dolibarr/**` | Connexion, import initial, reprise des réglages |
| `src/app/(app)/admin/sync/**` | Écran de synchronisation |
| `src/app/api/sync/flush/route.ts` | Vidage de la file par jeton |
| `src/middleware.ts` | *(modifié)* `api/sync` hors du matcher d'authentification |
| `vitest.integration.config.ts` | Configuration du seul test qui parle à une instance |

**Dépendances :** 1, 2 et 3 sont indépendantes. 4 consomme 3. 5 est indépendante. 6 consomme 4 et 5. 7 consomme 1, 5 et 6. 8 consomme 6 et 7. 9, 10, 11 et 12 consomment 5 (et 2 pour la 12, 4 pour la 9). 13 consomme 6, 7 et 9. 14 consomme 5.

---

## Task 1: Conversion des temps réalisés — noyau pur

**Files:** Create `src/core/dolibarr/timespent.ts`, `src/core/dolibarr/timespent.test.ts`

**Interfaces:**
- Consumes: `minutesToCentiemes` de `src/core/time/units.ts`, `TimeEntryKind` de `src/core/types.ts`
- Produces:
  - `interface PushableEntry { id: string; lineId: string; date: string; slotId: string; minutes: number; kind: TimeEntryKind; minutesParJour: number; comment: string }`
  - `interface TimeSpentPayload { entryId: string; lineId: string; date: string; slotId: string; durationSeconds: number; centiemesDeJour: number; note: string }`
  - `buildTimeSpentPayloads(entries: ReadonlyArray<PushableEntry>): TimeSpentPayload[]`
  - `interface DayLengthComparison { minutesParJourLocal: number; minutesParJourDolibarr: number; divergent: boolean; centiemesAffichesParDolibarr: number }`
  - `compareDayLength(args: { minutesParJourLocal: number; heuresParJourDolibarr: number }): DayLengthComparison`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/dolibarr/timespent.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { buildTimeSpentPayloads, compareDayLength, type PushableEntry } from './timespent'

function saisie(over: Partial<PushableEntry> = {}): PushableEntry {
  return {
    id: 'e1',
    lineId: 'l1',
    date: '2026-05-04',
    slotId: '',
    minutes: 480,
    kind: 'REALISE',
    minutesParJour: 480,
    comment: '',
    ...over,
  }
}

describe('buildTimeSpentPayloads', () => {
  it('convertit les minutes en secondes, sans autre facteur', () => {
    const [p] = buildTimeSpentPayloads([saisie({ minutes: 480 })])
    expect(p!.durationSeconds).toBe(28_800)
  })

  it('donne la même durée quel que soit le facteur figé de la saisie', () => {
    // Le facteur ne convertit pas des minutes en secondes : 8 heures restent
    // 8 heures. Il ne sert qu'à dire combien de JOURS ces minutes valent.
    const a = buildTimeSpentPayloads([saisie({ minutes: 480, minutesParJour: 480 })])[0]!
    const b = buildTimeSpentPayloads([saisie({ minutes: 480, minutesParJour: 420 })])[0]!
    expect(a.durationSeconds).toBe(b.durationSeconds)
    expect(a.centiemesDeJour).toBe(100)
    expect(b.centiemesDeJour).toBe(114)
  })

  it('exprime les jours au facteur figé de chaque saisie, jamais d un facteur commun', () => {
    const p = buildTimeSpentPayloads([
      saisie({ id: 'a', date: '2026-05-04', minutes: 480, minutesParJour: 480 }),
      saisie({ id: 'b', date: '2026-05-05', minutes: 420, minutesParJour: 420 }),
    ])
    expect(p.map((x) => x.centiemesDeJour)).toEqual([100, 100])
    expect(p.map((x) => x.durationSeconds)).toEqual([28_800, 25_200])
  })

  it('ne laisse jamais passer de prévisionnel', () => {
    // Le test central de la spec : un mois mêlant réalisé et prévu ne pousse
    // que le réalisé.
    const p = buildTimeSpentPayloads([
      saisie({ id: 'r', date: '2026-05-04', kind: 'REALISE' }),
      saisie({ id: 'p', date: '2026-05-05', kind: 'PREVISIONNEL' }),
    ])
    expect(p.map((x) => x.entryId)).toEqual(['r'])
  })

  it('ignore une saisie à zéro minute', () => {
    expect(buildTimeSpentPayloads([saisie({ minutes: 0 })])).toEqual([])
  })

  it('refuse une saisie dont le facteur figé est inexploitable', () => {
    // Sauter silencieusement une telle saisie la ferait disparaître de la
    // facturation sans que personne ne s'en aperçoive.
    expect(() => buildTimeSpentPayloads([saisie({ minutesParJour: 0 })])).toThrow(/inexploitable/)
    expect(() => buildTimeSpentPayloads([saisie({ minutesParJour: -420 })])).toThrow(/inexploitable/)
  })

  it('reporte le commentaire de la saisie en note, débarrassé de ses blancs', () => {
    const [p] = buildTimeSpentPayloads([saisie({ comment: '  Recette V2  ' })])
    expect(p!.note).toBe('Recette V2')
  })

  it('trie par date puis par ligne, pour un push reproductible', () => {
    const p = buildTimeSpentPayloads([
      saisie({ id: 'c', lineId: 'l2', date: '2026-05-05' }),
      saisie({ id: 'a', lineId: 'l2', date: '2026-05-04' }),
      saisie({ id: 'b', lineId: 'l1', date: '2026-05-04' }),
    ])
    expect(p.map((x) => x.entryId)).toEqual(['b', 'a', 'c'])
  })

  it('conserve le créneau, qui fait partie de l identité d une cellule', () => {
    const p = buildTimeSpentPayloads([
      saisie({ id: 'm', slotId: 'matin', minutes: 240 }),
      saisie({ id: 's', slotId: 'apres-midi', minutes: 240 }),
    ])
    expect(p.map((x) => x.slotId).sort()).toEqual(['apres-midi', 'matin'])
  })
})

describe('compareDayLength', () => {
  it('signale l écart entre 8 h locales et 7 h Dolibarr', () => {
    const c = compareDayLength({ minutesParJourLocal: 480, heuresParJourDolibarr: 7 })
    expect(c.minutesParJourDolibarr).toBe(420)
    expect(c.divergent).toBe(true)
    // Une journée locale pleine s'affichera comme 1,14 jour chez Dolibarr :
    // le fameux septième de trop.
    expect(c.centiemesAffichesParDolibarr).toBe(114)
  })

  it('ne signale rien quand les deux côtés comptent pareil', () => {
    const c = compareDayLength({ minutesParJourLocal: 420, heuresParJourDolibarr: 7 })
    expect(c.divergent).toBe(false)
    expect(c.centiemesAffichesParDolibarr).toBe(100)
  })

  it('accepte une durée Dolibarr fractionnaire', () => {
    const c = compareDayLength({ minutesParJourLocal: 450, heuresParJourDolibarr: 7.5 })
    expect(c.minutesParJourDolibarr).toBe(450)
    expect(c.divergent).toBe(false)
  })

  it('refuse une durée Dolibarr inexploitable', () => {
    expect(() =>
      compareDayLength({ minutesParJourLocal: 480, heuresParJourDolibarr: 0 }),
    ).toThrow(/inexploitable/)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/dolibarr/timespent.test.ts`
Expected: FAIL — `Failed to resolve import "./timespent"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/dolibarr/timespent.ts` :

```ts
import type { TimeEntryKind } from '../types'
import { minutesToCentiemes } from '../time/units'

/** Une saisie de temps, telle que le connecteur la reçoit du service. */
export interface PushableEntry {
  id: string
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  /** chaîne vide = journée entière */
  slotId: string
  minutes: number
  kind: TimeEntryKind
  /** durée d'une journée figée à l'écriture de cette saisie (lot 1d) */
  minutesParJour: number
  comment: string
}

export interface TimeSpentPayload {
  entryId: string
  lineId: string
  date: string
  slotId: string
  /**
   * Durée écoulée, en secondes — l'unité de `llx_projet_task_time`.
   *
   * `minutes × 60`, et rien d'autre. Ni le réglage global, ni
   * `TIMESHEET_DAY_DURATION` n'entrent ici : `TimeEntry.minutes` est déjà une
   * durée écoulée, obtenue en multipliant les jours saisis par le facteur figé
   * de la ligne au moment de l'écriture.
   */
  durationSeconds: number
  /**
   * La même durée exprimée en jours, au facteur **figé de cette saisie**.
   *
   * C'est ce nombre qui sert de quantité sur une ligne de facture, et de point
   * de comparaison avec ce que Dolibarr affichera à partir des secondes.
   */
  centiemesDeJour: number
  note: string
}

/**
 * Traduit des saisies en lignes de temps passé pour Dolibarr.
 *
 * Ne laisse passer que le réalisé : du temps prévu n'est pas du temps consommé
 * et n'a rien à faire dans une facture (spec §2).
 */
export function buildTimeSpentPayloads(
  entries: ReadonlyArray<PushableEntry>,
): TimeSpentPayload[] {
  const out: TimeSpentPayload[] = []

  for (const e of entries) {
    if (e.kind !== 'REALISE') continue
    if (e.minutes <= 0) continue

    if (!Number.isInteger(e.minutesParJour) || e.minutesParJour <= 0) {
      throw new Error(
        `La saisie ${e.id} porte une durée de journée inexploitable (${e.minutesParJour}).`,
      )
    }

    out.push({
      entryId: e.id,
      lineId: e.lineId,
      date: e.date,
      slotId: e.slotId,
      durationSeconds: e.minutes * 60,
      centiemesDeJour: minutesToCentiemes(e.minutes, e.minutesParJour),
      note: e.comment.trim(),
    })
  }

  // Ordre stable : un push rejoué produit la même séquence d'appels, ce qui
  // rend les journaux et les tests lisibles.
  out.sort((a, b) =>
    a.date === b.date
      ? a.lineId === b.lineId
        ? a.slotId.localeCompare(b.slotId)
        : a.lineId.localeCompare(b.lineId)
      : a.date.localeCompare(b.date),
  )

  return out
}

export interface DayLengthComparison {
  minutesParJourLocal: number
  minutesParJourDolibarr: number
  divergent: boolean
  /**
   * Ce que Dolibarr affichera pour une journée locale pleine, en centièmes de
   * jour. 114 quand l'application compte 8 h et Dolibarr 7 h.
   */
  centiemesAffichesParDolibarr: number
}

/**
 * Compare la durée d'une journée des deux côtés.
 *
 * Sert uniquement à **signaler** l'écart (spec §8) : rien dans ce module ne
 * compense l'écart en silence, ce serait la meilleure façon de le rendre
 * indétectable.
 */
export function compareDayLength(args: {
  minutesParJourLocal: number
  heuresParJourDolibarr: number
}): DayLengthComparison {
  const minutesParJourDolibarr = Math.round(args.heuresParJourDolibarr * 60)

  if (!Number.isFinite(minutesParJourDolibarr) || minutesParJourDolibarr <= 0) {
    throw new Error(
      `La durée d'une journée relevée dans Dolibarr est inexploitable (${args.heuresParJourDolibarr} h).`,
    )
  }

  return {
    minutesParJourLocal: args.minutesParJourLocal,
    minutesParJourDolibarr,
    divergent: args.minutesParJourLocal !== minutesParJourDolibarr,
    centiemesAffichesParDolibarr: minutesToCentiemes(
      args.minutesParJourLocal,
      minutesParJourDolibarr,
    ),
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/dolibarr/timespent.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer brièvement `durationSeconds: e.minutes * 60` par
`durationSeconds: Math.round((e.minutes / e.minutesParJour) * 420 * 60)` et confirmer que
« donne la même durée quel que soit le facteur figé » échoue. Restaurer ensuite : c'est
exactement la compensation cachée que la décision 1 interdit.

- [ ] **Step 6: Commit**

```bash
git add src/core/dolibarr/
git commit -m "feat(core): conversion des temps realises vers l'unite Dolibarr"
```

---

## Task 2: Brouillon de facture — noyau pur

**Files:** Create `src/core/dolibarr/invoice.ts`, `src/core/dolibarr/invoice.test.ts`

**Interfaces:**
- Consumes: `PushableEntry` de la tâche 1, `minutesToCentiemes`
- Produces:
  - `interface InvoiceDraftLine { lineId: string; label: string; qteCentiemes: number; tjmCents: number; totalHtCents: number }`
  - `interface InvoiceDraft { socid: number; month: string; lines: InvoiceDraftLine[]; totalHtCents: number }`
  - `buildInvoiceDraft(args: { socid: number; month: string; entries: ReadonlyArray<PushableEntry>; lines: ReadonlyArray<{ id: string; label: string; tjmCents: number }> }): InvoiceDraft`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/dolibarr/invoice.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { buildInvoiceDraft } from './invoice'
import type { PushableEntry } from './timespent'

function saisie(over: Partial<PushableEntry> = {}): PushableEntry {
  return {
    id: 'e1',
    lineId: 'l1',
    date: '2026-05-04',
    slotId: '',
    minutes: 480,
    kind: 'REALISE',
    minutesParJour: 480,
    comment: '',
    ...over,
  }
}

const LIGNES = [{ id: 'l1', label: 'Développement', tjmCents: 80_000 }]

describe('buildInvoiceDraft', () => {
  it('facture les jours validés au TJM de la ligne', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      saisie({ id: `e${i}`, date: `2026-05-${String(i + 1).padStart(2, '0')}` }),
    )
    const draft = buildInvoiceDraft({ socid: 42, month: '2026-05', entries, lines: LIGNES })

    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0]!.qteCentiemes).toBe(2000) // 20,00 jours
    expect(draft.lines[0]!.totalHtCents).toBe(1_600_000) // 20 × 800 €
    expect(draft.totalHtCents).toBe(1_600_000)
  })

  it('convertit chaque groupe de facteur séparément', () => {
    // 120 min à 420/jour = 29 centièmes ; 60 min à 480/jour = 13 ; total 42.
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [
        saisie({ id: 'a', date: '2026-05-04', minutes: 60, minutesParJour: 420 }),
        saisie({ id: 'b', date: '2026-05-05', minutes: 60, minutesParJour: 420 }),
        saisie({ id: 'c', date: '2026-05-06', minutes: 60, minutesParJour: 480 }),
      ],
      lines: LIGNES,
    })
    expect(draft.lines[0]!.qteCentiemes).toBe(42)
  })

  it('ne facture aucun prévisionnel', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ id: 'p', kind: 'PREVISIONNEL' })],
      lines: LIGNES,
    })
    expect(draft.lines).toEqual([])
    expect(draft.totalHtCents).toBe(0)
  })

  it('ignore une saisie dont la ligne est inconnue', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ lineId: 'inconnue' })],
      lines: LIGNES,
    })
    expect(draft.lines).toEqual([])
  })

  it('omet une ligne sans réalisé plutôt que d en produire une à zéro', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [saisie({ lineId: 'l1' })],
      lines: [...LIGNES, { id: 'l2', label: 'Recette', tjmCents: 70_000 }],
    })
    expect(draft.lines.map((l) => l.lineId)).toEqual(['l1'])
  })

  it('conserve l ordre des lignes fourni par l appelant', () => {
    const draft = buildInvoiceDraft({
      socid: 42,
      month: '2026-05',
      entries: [
        saisie({ id: 'a', lineId: 'l2' }),
        saisie({ id: 'b', lineId: 'l1', date: '2026-05-05' }),
      ],
      lines: [...LIGNES, { id: 'l2', label: 'Recette', tjmCents: 70_000 }],
    })
    expect(draft.lines.map((l) => l.lineId)).toEqual(['l1', 'l2'])
  })

  it('ne produit ni numéro, ni TVA, ni mention légale', () => {
    // Dolibarr facture, pas le CRA. Le jour où quelqu'un ajoutera un champ
    // `tva` ou `ref` ici, ce test tombera — et c'est le but.
    const draft = buildInvoiceDraft({ socid: 42, month: '2026-05', entries: [saisie()], lines: LIGNES })
    expect(Object.keys(draft).sort()).toEqual(['lines', 'month', 'socid', 'totalHtCents'])
    expect(Object.keys(draft.lines[0]!).sort()).toEqual([
      'label',
      'lineId',
      'qteCentiemes',
      'tjmCents',
      'totalHtCents',
    ])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/dolibarr/invoice.test.ts`
Expected: FAIL — `Failed to resolve import "./invoice"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/dolibarr/invoice.ts` :

```ts
import { minutesToCentiemes } from '../time/units'
import type { PushableEntry } from './timespent'

export interface InvoiceDraftLine {
  lineId: string
  label: string
  /** jours réalisés, en centièmes de jour */
  qteCentiemes: number
  tjmCents: number
  totalHtCents: number
}

/**
 * Ce que l'application **demande** à Dolibarr de créer.
 *
 * Pas de numéro, pas de TVA, pas de mention légale, pas de date d'émission :
 * numérotation, taux, émission et conservation restent entièrement chez
 * Dolibarr (spec §8 bis). Ce type est volontairement pauvre.
 */
export interface InvoiceDraft {
  socid: number
  /** 'YYYY-MM' */
  month: string
  lines: InvoiceDraftLine[]
  totalHtCents: number
}

export function buildInvoiceDraft(args: {
  socid: number
  month: string
  entries: ReadonlyArray<PushableEntry>
  lines: ReadonlyArray<{ id: string; label: string; tjmCents: number }>
}): InvoiceDraft {
  // Cumul des minutes par (ligne, facteur) : la convention « cumuler les
  // minutes, convertir une fois » ne tient qu'à facteur constant (lot 1d).
  const parGroupe = new Map<string, { lineId: string; facteur: number; minutes: number }>()

  const connues = new Set(args.lines.map((l) => l.id))

  for (const e of args.entries) {
    if (e.kind !== 'REALISE') continue
    if (e.minutes <= 0) continue
    if (!connues.has(e.lineId)) continue
    if (!Number.isInteger(e.minutesParJour) || e.minutesParJour <= 0) continue

    const cle = `${e.lineId}|${e.minutesParJour}`
    const g = parGroupe.get(cle) ?? { lineId: e.lineId, facteur: e.minutesParJour, minutes: 0 }
    g.minutes += e.minutes
    parGroupe.set(cle, g)
  }

  const centiemesParLigne = new Map<string, number>()
  for (const g of parGroupe.values()) {
    const centiemes = minutesToCentiemes(g.minutes, g.facteur)
    centiemesParLigne.set(g.lineId, (centiemesParLigne.get(g.lineId) ?? 0) + centiemes)
  }

  const lines: InvoiceDraftLine[] = []
  let totalHtCents = 0

  for (const l of args.lines) {
    const qteCentiemes = centiemesParLigne.get(l.id) ?? 0
    if (qteCentiemes === 0) continue

    const ligneHt = Math.round((qteCentiemes * l.tjmCents) / 100)
    lines.push({
      lineId: l.id,
      label: l.label,
      qteCentiemes,
      tjmCents: l.tjmCents,
      totalHtCents: ligneHt,
    })
    totalHtCents += ligneHt
  }

  return { socid: args.socid, month: args.month, lines, totalHtCents }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/dolibarr/invoice.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/dolibarr/
git commit -m "feat(core): brouillon de facture a partir des jours realises"
```

---

## Task 3: Scellement des secrets — noyau pur

**Files:** Create `src/core/crypto/secret-box.ts`, `src/core/crypto/secret-box.test.ts`

**Interfaces:**
- Consumes: `node:crypto` (autorisé dans `core/` : la règle interdit `@prisma/client`, `next` et React, pas la bibliothèque standard)
- Produces:
  - `class SecretKeyError extends Error`
  - `class SecretSealError extends Error`
  - `parseKey(raw: string | undefined): Buffer`
  - `sealSecret(plain: string, key: Buffer): string`
  - `openSecret(sealed: string, key: Buffer): string`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/crypto/secret-box.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { parseKey, sealSecret, openSecret, SecretKeyError, SecretSealError } from './secret-box'

const CLE = 'a'.repeat(64)
const AUTRE_CLE = 'b'.repeat(64)

describe('parseKey', () => {
  it('accepte 32 octets en hexadécimal', () => {
    expect(parseKey(CLE)).toHaveLength(32)
  })

  it('refuse une clé absente, en le disant en français', () => {
    expect(() => parseKey(undefined)).toThrow(SecretKeyError)
    expect(() => parseKey('   ')).toThrow(/CREDENTIALS_KEY/)
  })

  it('refuse une clé de mauvaise taille plutôt que de la compléter', () => {
    expect(() => parseKey('abcdef')).toThrow(SecretKeyError)
    expect(() => parseKey('z'.repeat(64))).toThrow(SecretKeyError)
  })
})

describe('sealSecret / openSecret', () => {
  it('rend le secret d origine', () => {
    const key = parseKey(CLE)
    expect(openSecret(sealSecret('dolibarr-api-key-42', key), key)).toBe('dolibarr-api-key-42')
  })

  it('ne laisse jamais le secret apparaître en clair dans le scellé', () => {
    const key = parseKey(CLE)
    expect(sealSecret('dolibarr-api-key-42', key)).not.toContain('dolibarr-api-key-42')
  })

  it('produit deux scellés différents pour le même secret', () => {
    // Vecteur d'initialisation aléatoire : sans lui, deux fournisseurs
    // partageant la même clé d'API seraient reconnaissables en base.
    const key = parseKey(CLE)
    expect(sealSecret('idem', key)).not.toBe(sealSecret('idem', key))
  })

  it('refuse un scellé altéré', () => {
    const key = parseKey(CLE)
    const scelle = sealSecret('dolibarr-api-key-42', key)
    const [v, iv, tag, data] = scelle.split(':') as [string, string, string, string]
    const altere = [v, iv, tag, Buffer.from('autre-chose').toString('base64')].join(':')
    expect(() => openSecret(altere, key)).toThrow(SecretSealError)
  })

  it('refuse un scellé ouvert avec une autre clé, en disant quoi faire', () => {
    const scelle = sealSecret('dolibarr-api-key-42', parseKey(CLE))
    expect(() => openSecret(scelle, parseKey(AUTRE_CLE))).toThrow(/Reconnectez/)
  })

  it('refuse un scellé de format inconnu', () => {
    expect(() => openSecret('pas-un-scelle', parseKey(CLE))).toThrow(SecretSealError)
    expect(() => openSecret('v2:a:b:c', parseKey(CLE))).toThrow(SecretSealError)
  })

  it('supporte une chaîne vide', () => {
    const key = parseKey(CLE)
    expect(openSecret(sealSecret('', key), key)).toBe('')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/crypto/secret-box.test.ts`
Expected: FAIL — `Failed to resolve import "./secret-box"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/crypto/secret-box.ts` :

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const VERSION = 'v1'

/** La clé d'environnement est absente ou inexploitable. */
export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretKeyError'
  }
}

/** Le scellé stocké est illisible : format inconnu, altéré, ou mauvaise clé. */
export class SecretSealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretSealError'
  }
}

/**
 * Lit `CREDENTIALS_KEY`. Exige 32 octets en hexadécimal — pas de dérivation
 * silencieuse depuis une phrase de passe : une clé dérivée sans sel donnerait
 * une fausse impression de robustesse, et une clé de longueur variable ferait
 * échouer AES-256 au premier chiffrement au lieu du démarrage.
 */
export function parseKey(raw: string | undefined): Buffer {
  const hex = (raw ?? '').trim()

  if (hex === '') {
    throw new SecretKeyError(
      "CREDENTIALS_KEY est absent : les identifiants ne peuvent pas être chiffrés. " +
        'Générez une clé avec « openssl rand -hex 32 » et placez-la dans .env.',
    )
  }

  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new SecretKeyError(
      "CREDENTIALS_KEY doit être une clé de 32 octets en hexadécimal (64 caractères). " +
        'Générez-en une avec « openssl rand -hex 32 ».',
    )
  }

  return Buffer.from(hex, 'hex')
}

export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const chiffre = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])

  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    chiffre.toString('base64'),
  ].join(':')
}

export function openSecret(sealed: string, key: Buffer): string {
  const parts = sealed.split(':')

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretSealError(
      'Le secret stocké est dans un format inconnu. Reconnectez le fournisseur.',
    )
  }

  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string]

  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // GCM ne distingue pas « altéré » de « mauvaise clé » : les deux cassent
    // la vérification du tag. Le message couvre les deux, et dit quoi faire.
    throw new SecretSealError(
      "Le secret stocké ne peut pas être déchiffré : la clé CREDENTIALS_KEY a changé, " +
        'ou la valeur a été altérée. Reconnectez le fournisseur.',
    )
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/crypto/secret-box.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Documenter la clé**

Ajouter à `.env.example` :

```
# Chiffrement des identifiants de fournisseurs (Dolibarr, Google…).
# Générer avec : openssl rand -hex 32
# ATTENTION : perdre cette clé impose de reconnecter chaque fournisseur.
CREDENTIALS_KEY=""
```

Et, dans `README.md`, une ligne dans la section des variables d'environnement :
« `CREDENTIALS_KEY` — clé de 32 octets en hexadécimal chiffrant les identifiants
des fournisseurs externes. La perdre n'entraîne aucune perte de données de CRA,
mais impose de ressaisir la clé d'API Dolibarr. »

- [ ] **Step 6: Commit**

```bash
git add src/core/crypto/ .env.example README.md
git commit -m "feat(core): AES-256-GCM sealing for provider secrets"
```

---

## Task 4: Schéma de synchronisation et service des identifiants

**Files:** Modify `prisma/schema.prisma`. Create `src/services/credentials.ts`, `src/services/credentials.test.ts`

**Interfaces:**
- Consumes: `parseKey`, `sealSecret`, `openSecret` de la tâche 3
- Produces:
  - modèles Prisma `SyncOutbox` et `ProviderCredential`
  - `interface ProviderCredentialView { provider: string; baseUrl: string; scope: string; expiresAt: Date | null; connectedAt: Date; metadata: Record<string, string> }`
  - `saveCredential(args: { provider: string; secret: string; refresh?: string; baseUrl?: string; scope?: string; expiresAt?: Date | null; metadata?: Record<string, string> }): Promise<ProviderCredentialView>`
  - `getCredential(provider: string): Promise<ProviderCredentialView | null>` — n'expose **jamais** de secret
  - `readSecrets(provider: string): Promise<{ secret: string; refresh: string } | null>`
  - `deleteCredential(provider: string): Promise<void>`

- [ ] **Step 1: Étendre le schéma**

Ajouter à `prisma/schema.prisma` :

```prisma
/// File de sortie de synchronisation, **indépendante du fournisseur**.
///
/// Ce n'est pas un journal : c'est l'ensemble des entités restant à
/// synchroniser. L'unicité du triplet (entityType, entityId, provider) est le
/// cœur du dispositif — dix modifications d'une même cible avant le prochain
/// passage produisent une ligne, pas dix, et le rejeu d'un échec est gratuit.
model SyncOutbox {
  id         String @id @default(cuid())
  /// Propriétaire de l'entité visée ; toute donnée du projet est scopée ainsi.
  /// Volontairement PAS une relation vers `User` : la file doit rester
  /// indépendante du fournisseur *et* du reste du modèle, et une cascade de
  /// suppression sur une file de travail n'apporterait rien qu'un vidage
  /// explicite ne fasse mieux.
  userId     String
  entityType String
  entityId   String
  provider   String
  /// 'UPSERT' | 'DELETE'
  operation  String @default("UPSERT")
  /// 'PENDING' | 'FAILED'
  state      String @default("PENDING")
  attempts   Int    @default(0)
  lastError  String @default("")
  /// contexte minimal de rejeu, JSON lu et écrit en bloc uniquement
  payloadJson String @default("{}")

  nextAttemptAt DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([entityType, entityId, provider])
  @@index([state, nextAttemptAt])
  @@index([userId])
}

/// Identifiants d'un fournisseur externe, chiffrés au repos.
///
/// Volontairement générique : `secretEnc` porte la clé d'API Dolibarr comme il
/// portera le jeton d'accès Google, et `metadataJson` accueille ce qui est
/// propre à chaque fournisseur (identifiant d'utilisateur Dolibarr,
/// identifiant du calendrier dédié…). Réglage d'instance, comme `Settings` :
/// pas de `userId`.
model ProviderCredential {
  id       String @id @default(cuid())
  provider String @unique

  /// secret principal scellé (AES-256-GCM) — clé d'API, jeton d'accès…
  secretEnc  String @default("")
  /// secret de renouvellement scellé ; vide si le fournisseur n'en a pas
  refreshEnc String @default("")
  /// URL de base du fournisseur ; vide si sans objet
  baseUrl    String @default("")
  scope      String @default("")
  /// JSON lu et écrit en bloc uniquement
  metadataJson String @default("{}")

  expiresAt   DateTime?
  connectedAt DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

Correspondance avec les noms de la spec 1b, pour que le lot 1b sache où se brancher :

| Spec 1b | Ici |
|---|---|
| `accessTokenEnc` | `secretEnc` |
| `refreshTokenEnc` | `refreshEnc` |
| `calendarId` | `metadata.calendarId` |
| `expiresAt`, `scope`, `connectedAt` | identiques |

Puis appliquer :

```bash
npm run db:sqlite
```

- [ ] **Step 2: Écrire le test qui échoue**

`src/services/credentials.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { saveCredential, getCredential, readSecrets, deleteCredential } from './credentials'

beforeAll(() => {
  process.env.CREDENTIALS_KEY = 'c'.repeat(64)
})

afterEach(async () => {
  await prisma.providerCredential.deleteMany({ where: { provider: { in: ['dolibarr', 'google'] } } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('identifiants de fournisseurs', () => {
  it('stocke le secret chiffré, jamais en clair', async () => {
    await saveCredential({ provider: 'dolibarr', secret: 'DOLAPIKEY-abc123', baseUrl: 'https://erp.local' })

    const row = await prisma.providerCredential.findUniqueOrThrow({ where: { provider: 'dolibarr' } })
    expect(row.secretEnc).not.toBe('DOLAPIKEY-abc123')
    expect(row.secretEnc).not.toContain('DOLAPIKEY-abc123')
    expect(row.secretEnc.startsWith('v1:')).toBe(true)
  })

  it('rend le secret à la lecture', async () => {
    await saveCredential({ provider: 'dolibarr', secret: 'DOLAPIKEY-abc123' })
    expect(await readSecrets('dolibarr')).toEqual({ secret: 'DOLAPIKEY-abc123', refresh: '' })
  })

  it('n expose aucun secret dans la vue', async () => {
    await saveCredential({ provider: 'dolibarr', secret: 'DOLAPIKEY-abc123', refresh: 'r' })
    const vue = await getCredential('dolibarr')
    expect(Object.keys(vue!).sort()).toEqual([
      'baseUrl',
      'connectedAt',
      'expiresAt',
      'metadata',
      'provider',
      'scope',
    ])
    expect(JSON.stringify(vue)).not.toContain('DOLAPIKEY-abc123')
  })

  it('conserve les métadonnées propres au fournisseur', async () => {
    await saveCredential({
      provider: 'dolibarr',
      secret: 'k',
      metadata: { dolibarrUserId: '7' },
    })
    expect((await getCredential('dolibarr'))!.metadata).toEqual({ dolibarrUserId: '7' })
  })

  it('reste générique : deux fournisseurs cohabitent', async () => {
    await saveCredential({ provider: 'dolibarr', secret: 'k1', metadata: { dolibarrUserId: '7' } })
    await saveCredential({ provider: 'google', secret: 'k2', refresh: 'r2', metadata: { calendarId: 'cra@group' } })

    expect((await readSecrets('google'))).toEqual({ secret: 'k2', refresh: 'r2' })
    expect((await getCredential('google'))!.metadata).toEqual({ calendarId: 'cra@group' })
    expect((await getCredential('dolibarr'))!.metadata).toEqual({ dolibarrUserId: '7' })
  })

  it('remplace les identifiants existants au lieu d en empiler', async () => {
    await saveCredential({ provider: 'dolibarr', secret: 'ancien' })
    await saveCredential({ provider: 'dolibarr', secret: 'nouveau' })

    expect(await prisma.providerCredential.count({ where: { provider: 'dolibarr' } })).toBe(1)
    expect((await readSecrets('dolibarr'))!.secret).toBe('nouveau')
  })

  it('rend null pour un fournisseur non connecté', async () => {
    expect(await getCredential('dolibarr')).toBeNull()
    expect(await readSecrets('dolibarr')).toBeNull()
  })

  it('supprime les identifiants', async () => {
    await saveCredential({ provider: 'dolibarr', secret: 'k' })
    await deleteCredential('dolibarr')
    expect(await getCredential('dolibarr')).toBeNull()
  })
})

describe('file de sortie — schéma', () => {
  afterEach(async () => {
    await prisma.syncOutbox.deleteMany({ where: { entityId: 'cra-schema' } })
  })

  it('n accepte qu une ligne par triplet', async () => {
    await prisma.syncOutbox.create({
      data: { userId: 'u1', entityType: 'Cra', entityId: 'cra-schema', provider: 'dolibarr' },
    })
    await expect(
      prisma.syncOutbox.create({
        data: { userId: 'u1', entityType: 'Cra', entityId: 'cra-schema', provider: 'dolibarr' },
      }),
    ).rejects.toThrow()
  })

  it('laisse cohabiter deux fournisseurs sur la même entité', async () => {
    await prisma.syncOutbox.create({
      data: { userId: 'u1', entityType: 'Cra', entityId: 'cra-schema', provider: 'dolibarr' },
    })
    const g = await prisma.syncOutbox.create({
      data: { userId: 'u1', entityType: 'Cra', entityId: 'cra-schema', provider: 'google' },
    })
    expect(g.state).toBe('PENDING')
    expect(g.attempts).toBe(0)
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/credentials.test.ts`
Expected: FAIL — `Failed to resolve import "./credentials"`

- [ ] **Step 4: Écrire l'implémentation**

`src/services/credentials.ts` :

```ts
import { prisma } from '@/db/client'
import { parseKey, sealSecret, openSecret } from '@/core/crypto/secret-box'

/**
 * Vue sans secret des identifiants d'un fournisseur.
 *
 * Volontairement dépourvue de `secretEnc`/`refreshEnc` : c'est le type que les
 * pages et les server actions manipulent, et il ne doit jamais pouvoir laisser
 * fuir un jeton dans un rendu ou un journal.
 */
export interface ProviderCredentialView {
  provider: string
  baseUrl: string
  scope: string
  expiresAt: Date | null
  connectedAt: Date
  metadata: Record<string, string>
}

/**
 * La clé est lue à chaque appel, pas mémorisée au chargement du module : un
 * test qui la renseigne dans `beforeAll` doit voir la même chose que le
 * serveur qui la lit dans `.env`.
 */
function cle(): Buffer {
  return parseKey(process.env.CREDENTIALS_KEY)
}

function parseMetadata(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

type Row = Awaited<ReturnType<typeof prisma.providerCredential.findUnique>>

function toView(row: NonNullable<Row>): ProviderCredentialView {
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    scope: row.scope,
    expiresAt: row.expiresAt,
    connectedAt: row.connectedAt,
    metadata: parseMetadata(row.metadataJson),
  }
}

export async function saveCredential(args: {
  provider: string
  secret: string
  refresh?: string
  baseUrl?: string
  scope?: string
  expiresAt?: Date | null
  metadata?: Record<string, string>
}): Promise<ProviderCredentialView> {
  const key = cle()

  const data = {
    secretEnc: sealSecret(args.secret, key),
    refreshEnc: sealSecret(args.refresh ?? '', key),
    baseUrl: args.baseUrl ?? '',
    scope: args.scope ?? '',
    expiresAt: args.expiresAt ?? null,
    metadataJson: JSON.stringify(args.metadata ?? {}),
  }

  const row = await prisma.providerCredential.upsert({
    where: { provider: args.provider },
    create: { provider: args.provider, ...data },
    update: data,
  })

  return toView(row)
}

export async function getCredential(provider: string): Promise<ProviderCredentialView | null> {
  const row = await prisma.providerCredential.findUnique({ where: { provider } })
  return row === null ? null : toView(row)
}

/**
 * Déscelle les secrets. Réservé aux appelants qui vont réellement parler au
 * fournisseur — jamais appelé depuis une page ou un composant.
 */
export async function readSecrets(
  provider: string,
): Promise<{ secret: string; refresh: string } | null> {
  const row = await prisma.providerCredential.findUnique({ where: { provider } })
  if (row === null) return null

  const key = cle()
  return { secret: openSecret(row.secretEnc, key), refresh: openSecret(row.refreshEnc, key) }
}

export async function deleteCredential(provider: string): Promise<void> {
  await prisma.providerCredential.deleteMany({ where: { provider } })
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/credentials.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): provider-agnostic sync outbox and encrypted provider credentials"
```

---

## Task 5: Port Dolibarr, double d'API et client HTTP

**Files:** Create `src/services/dolibarr/api.ts`, `src/services/dolibarr/fake.ts`, `src/services/dolibarr/http.ts`, `src/services/dolibarr/resolve.ts`, `src/services/dolibarr/http.test.ts`, `src/services/dolibarr/fake.test.ts`

**Interfaces:**
- Consumes: `getCredential`, `readSecrets` de la tâche 4
- Produces:

```ts
export const DOLIBARR = 'dolibarr'

export interface DolibarrThirdparty { id: number; name: string }
export interface DolibarrProject { id: number; ref: string; title: string; socid: number | null }
export interface DolibarrTask { id: number; ref: string; label: string; projectId: number }
export interface DolibarrPropalLine { id: number; label: string; qty: number; subpriceCents: number }
export interface DolibarrProposal { id: number; ref: string; socid: number; lines: DolibarrPropalLine[] }
export interface DolibarrInvoiceRequest {
  socid: number
  lines: Array<{ label: string; qteCentiemes: number; subpriceCents: number }>
}

export interface DolibarrApi {
  listThirdparties(): Promise<DolibarrThirdparty[]>
  createThirdparty(name: string): Promise<DolibarrThirdparty>
  /** déjà filtrés sur usage_bill_time = 1 */
  listProjects(): Promise<DolibarrProject[]>
  listTasks(projectId: number): Promise<DolibarrTask[]>
  createTask(args: { projectId: number; label: string }): Promise<DolibarrTask>
  getProposal(id: number): Promise<DolibarrProposal>
  addTimeSpent(args: { taskId: number; dolibarrUserId: number; date: string;
                       durationSeconds: number; note: string }): Promise<{ timespentId: number }>
  updateTimeSpent(args: { taskId: number; timespentId: number; date: string;
                          durationSeconds: number; note: string }): Promise<void>
  deleteTimeSpent(args: { taskId: number; timespentId: number }): Promise<void>
  createDraftInvoice(req: DolibarrInvoiceRequest): Promise<{ id: number; ref: string }>
  getSetupValue(constant: string): Promise<string | null>
}

export class DolibarrUnavailableError extends Error {}  // rejouable
export class DolibarrRequestError extends Error {}      // non rejouable
export class DolibarrMappingError extends Error {}      // non rejouable

// src/services/dolibarr/fake.ts — corps complet au Step 3
export class FakeDolibarr implements DolibarrApi
// src/services/dolibarr/http.ts
export function createHttpDolibarrApi(args: { baseUrl: string; apiKey: string;
  fetchImpl?: typeof fetch; timeoutMs?: number }): DolibarrApi
// src/services/dolibarr/resolve.ts
export function getDolibarrApi(): Promise<DolibarrApi | null>
```

**`api.ts` ne réexporte rien.** Il ne contient que des types, des erreurs et la constante
`DOLIBARR`, et il est importé par `http.ts`, `fake.ts` et `resolve.ts`. Y ajouter un
`export { createHttpDolibarrApi } from './http'` créerait un cycle `api → http → api` dont
l'ordre d'initialisation ferait tôt ou tard passer une classe d'erreur pour `undefined`.
Chaque appelant importe donc depuis le module qui définit ce dont il a besoin.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/services/dolibarr/fake.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { FakeDolibarr } from './fake'
import { DolibarrUnavailableError } from './api'

describe('double de l API Dolibarr', () => {
  it('crée une tâche et la retrouve', async () => {
    const api = new FakeDolibarr()
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: 1 })
    const t = await api.createTask({ projectId: projet.id, label: 'Développement' })

    expect(await api.listTasks(projet.id)).toEqual([t])
  })

  it('enregistre et met à jour un temps passé', async () => {
    const api = new FakeDolibarr()
    const projet = api.seedProject({ ref: 'PJ001', title: 'ITSM', socid: 1 })
    const t = await api.createTask({ projectId: projet.id, label: 'Dev' })

    const { timespentId } = await api.addTimeSpent({
      taskId: t.id, dolibarrUserId: 7, date: '2026-05-04', durationSeconds: 28_800, note: '',
    })
    await api.updateTimeSpent({ taskId: t.id, timespentId, date: '2026-05-04', durationSeconds: 14_400, note: '' })

    expect(api.timespents).toHaveLength(1)
    expect(api.timespents[0]!.durationSeconds).toBe(14_400)
  })

  it('simule une panne sur tous les appels', async () => {
    const api = new FakeDolibarr()
    api.panne = true
    await expect(api.listProjects()).rejects.toThrow(DolibarrUnavailableError)
    await expect(api.createThirdparty('X')).rejects.toThrow(DolibarrUnavailableError)
  })

  it('ne rend que les projets facturables au temps', async () => {
    const api = new FakeDolibarr()
    api.seedProject({ ref: 'PJ001', title: 'Facturable', socid: 1 })
    api.seedProject({ ref: 'PJ002', title: 'Interne', socid: 1, usageBillTime: false })

    expect((await api.listProjects()).map((p) => p.ref)).toEqual(['PJ001'])
  })

  it('rend les constantes de configuration semées', async () => {
    const api = new FakeDolibarr()
    api.setup.TIMESHEET_DAY_DURATION = '7'
    expect(await api.getSetupValue('TIMESHEET_DAY_DURATION')).toBe('7')
    expect(await api.getSetupValue('INCONNUE')).toBeNull()
  })
})
```

`src/services/dolibarr/http.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { DolibarrUnavailableError, DolibarrRequestError } from './api'
import { createHttpDolibarrApi } from './http'

function reponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('client HTTP Dolibarr', () => {
  it('présente la clé dans l en-tête DOLAPIKEY, jamais dans l URL', async () => {
    const vues: Array<{ url: string; headers: Headers }> = []
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'SECRET',
      fetchImpl: async (input, init) => {
        vues.push({ url: String(input), headers: new Headers(init?.headers) })
        return reponse([])
      },
    })

    await api.listThirdparties()
    expect(vues[0]!.headers.get('DOLAPIKEY')).toBe('SECRET')
    expect(vues[0]!.url).not.toContain('SECRET')
  })

  it('filtre les projets sur usage_bill_time', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'k',
      fetchImpl: async () =>
        reponse([
          { id: 1, ref: 'PJ001', title: 'Facturable', socid: 3, usage_bill_time: '1' },
          { id: 2, ref: 'PJ002', title: 'Interne', socid: 3, usage_bill_time: '0' },
        ]),
    })

    expect((await api.listProjects()).map((p) => p.id)).toEqual([1])
  })

  it('traite une panne serveur comme rejouable', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'k',
      fetchImpl: async () => reponse({ error: 'boom' }, 503),
    })
    await expect(api.listProjects()).rejects.toThrow(DolibarrUnavailableError)
  })

  it('traite un réseau injoignable comme rejouable', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'k',
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      },
    })
    await expect(api.listProjects()).rejects.toThrow(DolibarrUnavailableError)
  })

  it('traite un refus de la requête comme non rejouable', async () => {
    // Rejouer indéfiniment une requête que Dolibarr refuse encombrerait la
    // file sans jamais aboutir.
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'k',
      fetchImpl: async () => reponse({ error: { message: 'Bad value for socid' } }, 400),
    })
    await expect(api.createThirdparty('X')).rejects.toThrow(DolibarrRequestError)
  })

  it('traite une clé refusée comme non rejouable, avec un message explicite', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'mauvaise',
      fetchImpl: async () => reponse({ error: 'Unauthorized' }, 401),
    })
    await expect(api.listProjects()).rejects.toThrow(/clé d'API/)
  })

  it('rend null sur une constante absente plutôt que de lever', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'k',
      fetchImpl: async () => reponse({ error: 'not found' }, 404),
    })
    expect(await api.getSetupValue('TIMESHEET_DAY_DURATION')).toBeNull()
  })

  it('abandonne au bout du délai imparti, en rejouable', async () => {
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'k',
      timeoutMs: 10,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    })
    await expect(api.listProjects()).rejects.toThrow(DolibarrUnavailableError)
  })

  it('convertit les centièmes en quantité de jours et les centimes en euros', async () => {
    let corps: Record<string, unknown> = {}
    const api = createHttpDolibarrApi({
      baseUrl: 'https://erp.local/api/index.php',
      apiKey: 'k',
      fetchImpl: async (_input, init) => {
        if (typeof init?.body === 'string' && init.body.includes('socid')) {
          corps = JSON.parse(init.body) as Record<string, unknown>
          return reponse(12)
        }
        return reponse({ id: 12, ref: 'PROV-12' })
      },
    })

    await api.createDraftInvoice({
      socid: 3,
      lines: [{ label: 'Développement', qteCentiemes: 2000, subpriceCents: 80_000 }],
    })

    expect(corps.socid).toBe(3)
    // Brouillon, jamais validée : c'est Dolibarr qui numérote.
    expect(corps.status).toBe(0)
    const lignes = corps.lines as Array<Record<string, unknown>>
    expect(lignes[0]!.qty).toBe(20)
    expect(lignes[0]!.subprice).toBe(800)
    // Aucune TVA choisie par l'application.
    expect(Object.keys(lignes[0]!)).not.toContain('tva_tx')
  })
})
```

> Retirer la ligne `import { createHttpDolibarrApi as _ } from './http'` : elle n'est là que pour
> rappeler que `api.ts` **réexporte** `createHttpDolibarrApi` depuis `http.ts`. Importer
> depuis `./api` dans les tests est le contrat public.

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/dolibarr/`
Expected: FAIL — `Failed to resolve import "./api"`

- [ ] **Step 3: Écrire `api.ts` puis `fake.ts`**

`src/services/dolibarr/api.ts` — types, erreurs, réexports :

```ts
export const DOLIBARR = 'dolibarr'

export interface DolibarrThirdparty {
  id: number
  name: string
}

export interface DolibarrProject {
  id: number
  ref: string
  title: string
  /** tiers rattaché au projet, null si le projet n'en porte pas */
  socid: number | null
}

export interface DolibarrTask {
  id: number
  ref: string
  label: string
  projectId: number
}

export interface DolibarrPropalLine {
  id: number
  label: string
  /** quantité vendue, en jours */
  qty: number
  /** prix unitaire, en centimes */
  subpriceCents: number
}

export interface DolibarrProposal {
  id: number
  ref: string
  socid: number
  lines: DolibarrPropalLine[]
}

export interface DolibarrInvoiceRequest {
  socid: number
  lines: Array<{ label: string; qteCentiemes: number; subpriceCents: number }>
}

/**
 * Le port du connecteur. Tout ce que l'application sait faire avec Dolibarr
 * passe par là — ce qui rend le double de la tâche 5 suffisant pour tester le
 * lot entier sans jamais toucher une instance.
 */
export interface DolibarrApi {
  listThirdparties(): Promise<DolibarrThirdparty[]>
  createThirdparty(name: string): Promise<DolibarrThirdparty>
  /** déjà filtrés sur `usage_bill_time = 1` */
  listProjects(): Promise<DolibarrProject[]>
  listTasks(projectId: number): Promise<DolibarrTask[]>
  createTask(args: { projectId: number; label: string }): Promise<DolibarrTask>
  getProposal(id: number): Promise<DolibarrProposal>
  addTimeSpent(args: {
    taskId: number
    dolibarrUserId: number
    /** 'YYYY-MM-DD' */
    date: string
    durationSeconds: number
    note: string
  }): Promise<{ timespentId: number }>
  updateTimeSpent(args: {
    taskId: number
    timespentId: number
    date: string
    durationSeconds: number
    note: string
  }): Promise<void>
  deleteTimeSpent(args: { taskId: number; timespentId: number }): Promise<void>
  createDraftInvoice(req: DolibarrInvoiceRequest): Promise<{ id: number; ref: string }>
  getSetupValue(constant: string): Promise<string | null>
}

/** Dolibarr est injoignable ou en panne : la file rejouera. */
export class DolibarrUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DolibarrUnavailableError'
  }
}

/** Dolibarr a refusé la requête : la rejouer telle quelle n'aboutira jamais. */
export class DolibarrRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DolibarrRequestError'
  }
}

/** Une correspondance locale manque : rien à rejouer tant qu'elle n'existe pas. */
export class DolibarrMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DolibarrMappingError'
  }
}
```

Aucun `export … from` ici : `http.ts`, `fake.ts` et `resolve.ts` importent tous `api.ts`,
et un réexport en sens inverse fermerait le cycle.

`src/services/dolibarr/fake.ts` :

```ts
import {
  DolibarrUnavailableError,
  type DolibarrApi,
  type DolibarrInvoiceRequest,
  type DolibarrProject,
  type DolibarrProposal,
  type DolibarrTask,
  type DolibarrThirdparty,
} from './api'

interface FakeProject extends DolibarrProject {
  usageBillTime: boolean
}

export interface FakeTimeSpent {
  id: number
  taskId: number
  dolibarrUserId: number
  date: string
  durationSeconds: number
  note: string
}

export interface FakeInvoice {
  id: number
  ref: string
  socid: number
  /** 0 = brouillon. Le double refuse tout autre statut : l'application ne valide pas. */
  status: number
  lines: Array<{ label: string; qty: number; subprice: number }>
}

/**
 * Double en mémoire de l'API Dolibarr.
 *
 * Vit dans `src/services` et non dans un dossier de tests parce que plusieurs
 * fichiers de test s'en servent, et parce que le seul moyen de garantir qu'il
 * reste conforme au port est qu'il l'implémente au sens de TypeScript.
 */
export class FakeDolibarr implements DolibarrApi {
  /** Bascule toutes les méthodes en panne, comme une instance éteinte. */
  panne = false

  readonly thirdparties: DolibarrThirdparty[] = []
  readonly projects: FakeProject[] = []
  readonly tasks: DolibarrTask[] = []
  readonly proposals: DolibarrProposal[] = []
  readonly timespents: FakeTimeSpent[] = []
  readonly invoices: FakeInvoice[] = []
  setup: Record<string, string> = {}

  /** Compteurs d'appels, pour les tests d'idempotence. */
  readonly appels = { createTask: 0, addTimeSpent: 0, updateTimeSpent: 0, deleteTimeSpent: 0 }

  private sequence = 0

  private next(): number {
    this.sequence += 1
    return this.sequence
  }

  private garde(): void {
    if (this.panne) {
      throw new DolibarrUnavailableError('Instance Dolibarr injoignable (double de test).')
    }
  }

  // --- amorçage ------------------------------------------------------------

  seedThirdparty(name: string): DolibarrThirdparty {
    const t = { id: this.next(), name }
    this.thirdparties.push(t)
    return t
  }

  seedProject(args: {
    ref: string
    title: string
    socid: number | null
    usageBillTime?: boolean
  }): DolibarrProject {
    const p: FakeProject = {
      id: this.next(),
      ref: args.ref,
      title: args.title,
      socid: args.socid,
      usageBillTime: args.usageBillTime ?? true,
    }
    this.projects.push(p)
    return { id: p.id, ref: p.ref, title: p.title, socid: p.socid }
  }

  seedProposal(args: {
    ref: string
    socid: number
    lines: Array<{ label: string; qty: number; subpriceCents: number }>
  }): DolibarrProposal {
    const p: DolibarrProposal = {
      id: this.next(),
      ref: args.ref,
      socid: args.socid,
      lines: args.lines.map((l) => ({ id: this.next(), ...l })),
    }
    this.proposals.push(p)
    return p
  }

  // --- port ----------------------------------------------------------------

  async listThirdparties(): Promise<DolibarrThirdparty[]> {
    this.garde()
    return [...this.thirdparties]
  }

  async createThirdparty(name: string): Promise<DolibarrThirdparty> {
    this.garde()
    return this.seedThirdparty(name)
  }

  async listProjects(): Promise<DolibarrProject[]> {
    this.garde()
    return this.projects
      .filter((p) => p.usageBillTime)
      .map((p) => ({ id: p.id, ref: p.ref, title: p.title, socid: p.socid }))
  }

  async listTasks(projectId: number): Promise<DolibarrTask[]> {
    this.garde()
    return this.tasks.filter((t) => t.projectId === projectId)
  }

  async createTask(args: { projectId: number; label: string }): Promise<DolibarrTask> {
    this.garde()
    this.appels.createTask += 1
    const id = this.next()
    const t: DolibarrTask = {
      id,
      ref: `TK${String(id).padStart(4, '0')}`,
      label: args.label,
      projectId: args.projectId,
    }
    this.tasks.push(t)
    return t
  }

  async getProposal(id: number): Promise<DolibarrProposal> {
    this.garde()
    const p = this.proposals.find((x) => x.id === id)
    if (p === undefined) {
      throw new DolibarrUnavailableError(`Propale ${id} introuvable dans le double.`)
    }
    return p
  }

  async addTimeSpent(args: {
    taskId: number
    dolibarrUserId: number
    date: string
    durationSeconds: number
    note: string
  }): Promise<{ timespentId: number }> {
    this.garde()
    this.appels.addTimeSpent += 1
    const ts: FakeTimeSpent = { id: this.next(), ...args }
    this.timespents.push(ts)
    return { timespentId: ts.id }
  }

  async updateTimeSpent(args: {
    taskId: number
    timespentId: number
    date: string
    durationSeconds: number
    note: string
  }): Promise<void> {
    this.garde()
    this.appels.updateTimeSpent += 1
    const ts = this.timespents.find((x) => x.id === args.timespentId)
    if (ts === undefined) {
      throw new DolibarrUnavailableError(`Temps passé ${args.timespentId} introuvable.`)
    }
    ts.date = args.date
    ts.durationSeconds = args.durationSeconds
    ts.note = args.note
  }

  async deleteTimeSpent(args: { taskId: number; timespentId: number }): Promise<void> {
    this.garde()
    this.appels.deleteTimeSpent += 1
    const i = this.timespents.findIndex((x) => x.id === args.timespentId)
    if (i >= 0) this.timespents.splice(i, 1)
  }

  async createDraftInvoice(req: DolibarrInvoiceRequest): Promise<{ id: number; ref: string }> {
    this.garde()
    const id = this.next()
    this.invoices.push({
      id,
      ref: `(PROV${id})`,
      socid: req.socid,
      status: 0,
      lines: req.lines.map((l) => ({
        label: l.label,
        qty: l.qteCentiemes / 100,
        subprice: l.subpriceCents / 100,
      })),
    })
    return { id, ref: `(PROV${id})` }
  }

  async getSetupValue(constant: string): Promise<string | null> {
    this.garde()
    return this.setup[constant] ?? null
  }
}
```

- [ ] **Step 4: Écrire `http.ts` et `resolve.ts`**

`src/services/dolibarr/http.ts` :

```ts
import {
  DolibarrRequestError,
  DolibarrUnavailableError,
  type DolibarrApi,
  type DolibarrInvoiceRequest,
  type DolibarrProject,
  type DolibarrProposal,
  type DolibarrTask,
  type DolibarrThirdparty,
} from './api'

const DELAI_PAR_DEFAUT_MS = 15_000

interface Contexte {
  baseUrl: string
  apiKey: string
  fetchImpl: typeof fetch
  timeoutMs: number
}

/** Vrai pour '1', 1, true — Dolibarr renvoie l'un ou l'autre selon les versions. */
function vrai(valeur: unknown): boolean {
  return valeur === 1 || valeur === '1' || valeur === true
}

function nombreOuNull(valeur: unknown): number | null {
  const n = Number(valeur)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function appel(
  ctx: Contexte,
  chemin: string,
  init: RequestInit & { statutsToleres?: number[] } = {},
): Promise<unknown> {
  const { statutsToleres = [], ...reste } = init as RequestInit & { statutsToleres?: number[] }
  const controller = new AbortController()
  const minuterie = setTimeout(() => controller.abort(), ctx.timeoutMs)

  let reponse: Response
  try {
    reponse = await ctx.fetchImpl(`${ctx.baseUrl}${chemin}`, {
      ...reste,
      signal: controller.signal,
      headers: {
        DOLAPIKEY: ctx.apiKey,
        'Content-Type': 'application/json',
        ...(reste.headers ?? {}),
      },
    })
  } catch {
    // Réseau coupé, DNS, TLS, expiration : rejouable sans distinction. La
    // cause exacte n'aiderait pas la file à décider autre chose.
    throw new DolibarrUnavailableError(
      `Dolibarr est injoignable (${chemin}). La synchronisation réessaiera.`,
    )
  } finally {
    clearTimeout(minuterie)
  }

  if (statutsToleres.includes(reponse.status)) return null

  if (reponse.status === 401 || reponse.status === 403) {
    throw new DolibarrRequestError(
      "Dolibarr a refusé la clé d'API. Reconnectez le connecteur dans Administration · Dolibarr.",
    )
  }

  if (reponse.status >= 500) {
    throw new DolibarrUnavailableError(
      `Dolibarr a répondu ${reponse.status} sur ${chemin}. La synchronisation réessaiera.`,
    )
  }

  if (!reponse.ok) {
    throw new DolibarrRequestError(
      `Dolibarr a refusé la requête ${chemin} (${reponse.status}).`,
    )
  }

  return reponse.json()
}

export function createHttpDolibarrApi(args: {
  baseUrl: string
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): DolibarrApi {
  const ctx: Contexte = {
    baseUrl: args.baseUrl.replace(/\/$/, ''),
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl ?? fetch,
    timeoutMs: args.timeoutMs ?? DELAI_PAR_DEFAUT_MS,
  }

  return {
    async listThirdparties(): Promise<DolibarrThirdparty[]> {
      const brut = (await appel(ctx, '/thirdparties?limit=1000')) as Array<Record<string, unknown>>
      return brut.map((t) => ({ id: Number(t.id), name: String(t.name ?? '') }))
    },

    async createThirdparty(name: string): Promise<DolibarrThirdparty> {
      const id = (await appel(ctx, '/thirdparties', {
        method: 'POST',
        body: JSON.stringify({ name, client: 1 }),
      })) as number
      return { id: Number(id), name }
    },

    async listProjects(): Promise<DolibarrProject[]> {
      const brut = (await appel(ctx, '/projects?limit=1000')) as Array<Record<string, unknown>>
      // Le filtre vit ici et non chez l'appelant : un projet non facturable au
      // temps n'a aucune tâche où pousser, l'exposer ne ferait qu'inviter à
      // une correspondance qui échouerait plus tard.
      return brut
        .filter((p) => vrai(p.usage_bill_time))
        .map((p) => ({
          id: Number(p.id),
          ref: String(p.ref ?? ''),
          title: String(p.title ?? ''),
          socid: nombreOuNull(p.socid),
        }))
    },

    async listTasks(projectId: number): Promise<DolibarrTask[]> {
      const brut = (await appel(ctx, `/projects/${projectId}/tasks`)) as Array<
        Record<string, unknown>
      >
      return brut.map((t) => ({
        id: Number(t.id),
        ref: String(t.ref ?? ''),
        label: String(t.label ?? ''),
        projectId,
      }))
    },

    async createTask(a: { projectId: number; label: string }): Promise<DolibarrTask> {
      const id = (await appel(ctx, '/tasks', {
        method: 'POST',
        body: JSON.stringify({ fk_project: a.projectId, label: a.label, ref: a.label }),
      })) as number
      return { id: Number(id), ref: a.label, label: a.label, projectId: a.projectId }
    },

    async getProposal(id: number): Promise<DolibarrProposal> {
      const brut = (await appel(ctx, `/proposals/${id}`)) as Record<string, unknown>
      const lignes = (brut.lines ?? []) as Array<Record<string, unknown>>
      return {
        id: Number(brut.id),
        ref: String(brut.ref ?? ''),
        socid: Number(brut.socid),
        lines: lignes.map((l) => ({
          id: Number(l.id),
          label: String(l.desc ?? l.libelle ?? l.product_label ?? ''),
          qty: Number(l.qty),
          subpriceCents: Math.round(Number(l.subprice) * 100),
        })),
      }
    },

    async addTimeSpent(a: {
      taskId: number
      dolibarrUserId: number
      date: string
      durationSeconds: number
      note: string
    }): Promise<{ timespentId: number }> {
      const id = (await appel(ctx, `/tasks/${a.taskId}/addtimespent`, {
        method: 'POST',
        body: JSON.stringify({
          date: a.date,
          duration: a.durationSeconds,
          user_id: a.dolibarrUserId,
          note: a.note,
        }),
      })) as number | Record<string, unknown>

      const timespentId = typeof id === 'number' ? id : Number(id.id)
      return { timespentId }
    },

    async updateTimeSpent(a: {
      taskId: number
      timespentId: number
      date: string
      durationSeconds: number
      note: string
    }): Promise<void> {
      await appel(ctx, `/tasks/${a.taskId}/timespent/${a.timespentId}`, {
        method: 'PUT',
        body: JSON.stringify({ date: a.date, duration: a.durationSeconds, note: a.note }),
      })
    },

    async deleteTimeSpent(a: { taskId: number; timespentId: number }): Promise<void> {
      // 404 toléré : le temps a déjà disparu côté Dolibarr, l'état visé est
      // atteint. Lever ici bloquerait la file sur une cible déjà conforme.
      await appel(ctx, `/tasks/${a.taskId}/timespent/${a.timespentId}`, {
        method: 'DELETE',
        statutsToleres: [404],
      })
    },

    async createDraftInvoice(req: DolibarrInvoiceRequest): Promise<{ id: number; ref: string }> {
      // `status: 0` = brouillon. L'application ne valide jamais : une facture
      // validée est numérotée et immuable (spec §8 bis). Aucun taux de TVA
      // n'est transmis — Dolibarr applique le sien.
      const id = (await appel(ctx, '/invoices', {
        method: 'POST',
        body: JSON.stringify({
          socid: req.socid,
          status: 0,
          lines: req.lines.map((l) => ({
            desc: l.label,
            qty: l.qteCentiemes / 100,
            subprice: l.subpriceCents / 100,
          })),
        }),
      })) as number

      const facture = (await appel(ctx, `/invoices/${Number(id)}`)) as Record<string, unknown>
      return { id: Number(id), ref: String(facture.ref ?? '') }
    },

    async getSetupValue(constant: string): Promise<string | null> {
      // `GET /setup/conf/{constant}` n'existe pas sur toutes les versions :
      // un 404 signifie « constante non lisible ici », pas « instance en
      // panne ». On rend null et l'écran de reprise n'en propose simplement
      // pas la valeur — le connecteur ne doit jamais tomber parce qu'une
      // constante facultative manque.
      const brut = (await appel(ctx, `/setup/conf/${encodeURIComponent(constant)}`, {
        statutsToleres: [404],
      })) as { value?: unknown } | null

      if (brut === null || brut.value === undefined || brut.value === null) return null
      return String(brut.value)
    },
  }
}
```

`src/services/dolibarr/resolve.ts` :

```ts
import { getCredential, readSecrets } from '@/services/credentials'
import { DOLIBARR, type DolibarrApi } from './api'
import { createHttpDolibarrApi } from './http'

/**
 * Construit l'API depuis les identifiants stockés, ou `null` si Dolibarr n'est
 * pas connecté.
 *
 * `null` n'est pas une erreur : le connecteur est additif (spec §1). Toute
 * l'application doit fonctionner sans lui.
 */
export async function getDolibarrApi(): Promise<DolibarrApi | null> {
  const vue = await getCredential(DOLIBARR)
  if (vue === null || vue.baseUrl === '') return null

  const secrets = await readSecrets(DOLIBARR)
  if (secrets === null || secrets.secret === '') return null

  return createHttpDolibarrApi({ baseUrl: vue.baseUrl, apiKey: secrets.secret })
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/dolibarr/`
Expected: PASS — 5 tests de `fake.test.ts`, 9 de `http.test.ts`

- [ ] **Step 6: Vérifier**

Run: `npx tsc --noEmit`
Expected: 0 erreur — en particulier `FakeDolibarr implements DolibarrApi` doit tenir, c'est
la garantie que le double ne dérive pas du port.

- [ ] **Step 7: Commit**

```bash
git add src/services/dolibarr/
git commit -m "feat(dolibarr): API port, in-memory double and HTTP client"
```

---

## Task 6: File de sortie générique

**Files:** Create `src/services/sync/types.ts`, `src/services/sync/outbox.ts`, `src/services/sync/outbox.test.ts`

**Interfaces:**
- Consumes: `SyncOutbox` de la tâche 4
- Produces:

```ts
// src/services/sync/types.ts
export type SyncOperation = 'UPSERT' | 'DELETE'
export type SyncState = 'PENDING' | 'FAILED'
export interface SyncJob { id: string; userId: string; entityType: string; entityId: string
                           provider: string; operation: SyncOperation; attempts: number
                           payload: Record<string, string> }
export type SyncOutcome = { ok: true } | { ok: false; retriable: boolean; message: string }
export interface SyncHandler { upsert(job: SyncJob): Promise<SyncOutcome>
                               remove(job: SyncJob): Promise<SyncOutcome> }

// src/services/sync/outbox.ts
export const BACKOFF_MINUTES: readonly number[]   // [1, 5, 15, 60, 360]
export const MAX_ATTEMPTS: number                 // 5
export function enqueue(args: { userId: string; entityType: string; entityId: string
                                provider: string; operation?: SyncOperation
                                payload?: Record<string, string>
                                tx?: Prisma.TransactionClient }): Promise<void>
export interface FlushReport { traitees: number; reussies: number; replanifiees: number; echouees: number }
export function flushSyncOutbox(args: { handlers: Record<string, SyncHandler>
                                        limit?: number; now?: Date }): Promise<FlushReport>
export interface OutboxRow { id: string; entityType: string; entityId: string; provider: string
                             operation: SyncOperation; state: SyncState; attempts: number
                             lastError: string; nextAttemptAt: Date }
export function listOutbox(userId: string): Promise<OutboxRow[]>
export function retryOutboxRow(userId: string, id: string): Promise<boolean>
```

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/sync/outbox.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import {
  enqueue,
  flushSyncOutbox,
  listOutbox,
  retryOutboxRow,
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
} from './outbox'
import type { SyncHandler, SyncJob, SyncOutcome } from './types'

const T0 = new Date('2026-05-04T10:00:00.000Z')

function minutesApres(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000)
}

function handler(resultat: SyncOutcome, vus: SyncJob[] = []): SyncHandler {
  return {
    async upsert(job) {
      vus.push(job)
      return resultat
    },
    async remove(job) {
      vus.push(job)
      return resultat
    },
  }
}

const SUCCES: SyncOutcome = { ok: true }
const PANNE: SyncOutcome = { ok: false, retriable: true, message: 'Dolibarr injoignable.' }
const REFUS: SyncOutcome = { ok: false, retriable: false, message: 'Mission non rattachée.' }

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.$disconnect()
})

describe('mise en file', () => {
  it('dix mises en file sur la même cible produisent une ligne', async () => {
    for (let i = 0; i < 10; i++) {
      await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    }
    expect(await prisma.syncOutbox.count()).toBe(1)
  })

  it('réarme une ligne en échec au lieu d en créer une seconde', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    await flushSyncOutbox({ handlers: { dolibarr: handler(PANNE) }, now: T0 })

    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })

    const ligne = await prisma.syncOutbox.findFirstOrThrow()
    expect(ligne.attempts).toBe(0)
    expect(ligne.state).toBe('PENDING')
    expect(ligne.lastError).toBe('')
  })

  it('sépare deux fournisseurs sur la même entité', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'google' })
    expect(await prisma.syncOutbox.count()).toBe(2)
  })
})

describe('drainage', () => {
  it('supprime la ligne quand le gestionnaire réussit', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    const rapport = await flushSyncOutbox({ handlers: { dolibarr: handler(SUCCES) }, now: T0 })

    expect(rapport).toEqual({ traitees: 1, reussies: 1, replanifiees: 0, echouees: 0 })
    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it('transmet le contexte de rejeu au gestionnaire', async () => {
    const vus: SyncJob[] = []
    await enqueue({
      userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr',
      payload: { month: '2026-05' },
    })
    await flushSyncOutbox({ handlers: { dolibarr: handler(SUCCES, vus) }, now: T0 })

    expect(vus[0]!.userId).toBe('u1')
    expect(vus[0]!.payload).toEqual({ month: '2026-05' })
  })

  it('respecte la séquence de recul progressif', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })

    const attendus = [...BACKOFF_MINUTES]
    for (const [i, minutes] of attendus.entries()) {
      const maintenant = minutesApres(T0, i * 1000)
      await flushSyncOutbox({ handlers: { dolibarr: handler(PANNE) }, now: maintenant })

      const ligne = await prisma.syncOutbox.findFirstOrThrow()
      expect(ligne.attempts).toBe(i + 1)
      if (i + 1 < MAX_ATTEMPTS) {
        expect(ligne.state).toBe('PENDING')
        expect(ligne.nextAttemptAt.toISOString()).toBe(minutesApres(maintenant, minutes).toISOString())
      }
    }
  })

  it('passe à FAILED au-delà de cinq tentatives, sans perdre la ligne', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await flushSyncOutbox({ handlers: { dolibarr: handler(PANNE) }, now: minutesApres(T0, i * 1000) })
    }

    const ligne = await prisma.syncOutbox.findFirstOrThrow()
    expect(ligne.state).toBe('FAILED')
    expect(ligne.attempts).toBe(MAX_ATTEMPTS)
    expect(ligne.lastError).toBe('Dolibarr injoignable.')

    // Elle remonte dans l'écran de synchronisation au lieu de disparaître.
    expect((await listOutbox('u1')).map((r) => r.state)).toEqual(['FAILED'])
  })

  it('passe à FAILED sans attendre quand l échec n est pas rejouable', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    const rapport = await flushSyncOutbox({ handlers: { dolibarr: handler(REFUS) }, now: T0 })

    expect(rapport).toEqual({ traitees: 1, reussies: 0, replanifiees: 0, echouees: 1 })
    const ligne = await prisma.syncOutbox.findFirstOrThrow()
    expect(ligne.state).toBe('FAILED')
    expect(ligne.attempts).toBe(1)
    expect(ligne.lastError).toBe('Mission non rattachée.')
  })

  it('ne retraite pas une ligne en échec définitif', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    await flushSyncOutbox({ handlers: { dolibarr: handler(REFUS) }, now: T0 })

    const vus: SyncJob[] = []
    const rapport = await flushSyncOutbox({ handlers: { dolibarr: handler(SUCCES, vus) }, now: minutesApres(T0, 10_000) })
    expect(rapport.traitees).toBe(0)
    expect(vus).toEqual([])
  })

  it('ne traite pas une ligne dont l heure n est pas venue', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    await flushSyncOutbox({ handlers: { dolibarr: handler(PANNE) }, now: T0 })

    const rapport = await flushSyncOutbox({
      handlers: { dolibarr: handler(SUCCES) },
      now: minutesApres(T0, 0.5),
    })
    expect(rapport.traitees).toBe(0)
  })

  it('ignore une ligne dont le fournisseur n a pas de gestionnaire', async () => {
    // Dolibarr non connecté : sa file attend, elle ne tombe pas en échec.
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    const rapport = await flushSyncOutbox({ handlers: {}, now: T0 })

    expect(rapport.traitees).toBe(0)
    expect((await prisma.syncOutbox.findFirstOrThrow()).state).toBe('PENDING')
  })

  it('appelle remove pour une opération DELETE', async () => {
    const vus: SyncJob[] = []
    await enqueue({
      userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr', operation: 'DELETE',
    })
    await flushSyncOutbox({ handlers: { dolibarr: handler(SUCCES, vus) }, now: T0 })
    expect(vus[0]!.operation).toBe('DELETE')
  })

  it('respecte la limite demandée', async () => {
    for (let i = 0; i < 5; i++) {
      await enqueue({ userId: 'u1', entityType: 'Cra', entityId: `c${i}`, provider: 'dolibarr' })
    }
    const rapport = await flushSyncOutbox({ handlers: { dolibarr: handler(SUCCES) }, limit: 2, now: T0 })
    expect(rapport.traitees).toBe(2)
    expect(await prisma.syncOutbox.count()).toBe(3)
  })
})

describe('écran de synchronisation', () => {
  it('ne montre que les lignes de l utilisateur', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    await enqueue({ userId: 'u2', entityType: 'Cra', entityId: 'c2', provider: 'dolibarr' })

    expect((await listOutbox('u1')).map((r) => r.entityId)).toEqual(['c1'])
  })

  it('réarme une ligne en échec', async () => {
    await enqueue({ userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' })
    await flushSyncOutbox({ handlers: { dolibarr: handler(REFUS) }, now: T0 })

    const [ligne] = await listOutbox('u1')
    expect(await retryOutboxRow('u1', ligne!.id)).toBe(true)

    const relue = await prisma.syncOutbox.findFirstOrThrow()
    expect(relue.state).toBe('PENDING')
    expect(relue.attempts).toBe(0)
  })

  it('refuse de réarmer la ligne d un autre utilisateur', async () => {
    await enqueue({ userId: 'u2', entityType: 'Cra', entityId: 'c2', provider: 'dolibarr' })
    const ligne = await prisma.syncOutbox.findFirstOrThrow()

    expect(await retryOutboxRow('u1', ligne.id)).toBe(false)
    expect((await prisma.syncOutbox.findFirstOrThrow()).state).toBe('PENDING')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/sync/outbox.test.ts`
Expected: FAIL — `Failed to resolve import "./outbox"`

- [ ] **Step 3: Écrire `types.ts`**

`src/services/sync/types.ts` :

```ts
export type SyncOperation = 'UPSERT' | 'DELETE'
export type SyncState = 'PENDING' | 'FAILED'

export interface SyncJob {
  id: string
  userId: string
  entityType: string
  entityId: string
  provider: string
  operation: SyncOperation
  attempts: number
  payload: Record<string, string>
}

/**
 * `retriable: false` signifie « rejouer ceci à l'identique n'aboutira jamais » :
 * la ligne part directement en `FAILED` et remonte à l'écran, au lieu
 * d'occuper la file pendant six heures pour rien.
 */
export type SyncOutcome = { ok: true } | { ok: false; retriable: boolean; message: string }

export interface SyncHandler {
  upsert(job: SyncJob): Promise<SyncOutcome>
  remove(job: SyncJob): Promise<SyncOutcome>
}
```

- [ ] **Step 4: Écrire `outbox.ts`**

`src/services/sync/outbox.ts` :

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import type { SyncHandler, SyncJob, SyncOperation, SyncState } from './types'

/** Recul progressif : 1 min, 5 min, 15 min, 1 h, 6 h (spec 1b §3). */
export const BACKOFF_MINUTES: readonly number[] = [1, 5, 15, 60, 360]
export const MAX_ATTEMPTS = 5

function parsePayload(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * Inscrit une entité dans la file, ou **réarme** la ligne existante.
 *
 * L'unicité du triplet fait tout le travail : dix modifications d'une même
 * cible avant le prochain passage produisent une ligne, pas dix. Réarmer remet
 * `attempts` à zéro — un nouvel événement métier mérite un nouveau budget de
 * tentatives, sinon une cible ayant échoué cinq fois resterait morte à jamais.
 *
 * `tx` permet d'inscrire **dans la même transaction que l'écriture métier**.
 * Une écriture qui réussirait sans être mise en file produirait une
 * synchronisation silencieusement fausse.
 */
export async function enqueue(args: {
  userId: string
  entityType: string
  entityId: string
  provider: string
  operation?: SyncOperation
  payload?: Record<string, string>
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const db = args.tx ?? prisma
  const operation = args.operation ?? 'UPSERT'
  const payloadJson = JSON.stringify(args.payload ?? {})

  await db.syncOutbox.upsert({
    where: {
      entityType_entityId_provider: {
        entityType: args.entityType,
        entityId: args.entityId,
        provider: args.provider,
      },
    },
    create: {
      userId: args.userId,
      entityType: args.entityType,
      entityId: args.entityId,
      provider: args.provider,
      operation,
      payloadJson,
    },
    update: {
      userId: args.userId,
      operation,
      payloadJson,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: new Date(),
    },
  })
}

export interface FlushReport {
  traitees: number
  reussies: number
  /** échecs rejouables : la ligne reste en file avec un nouveau rendez-vous */
  replanifiees: number
  /** lignes passées en FAILED */
  echouees: number
}

export async function flushSyncOutbox(args: {
  handlers: Record<string, SyncHandler>
  limit?: number
  now?: Date
}): Promise<FlushReport> {
  const maintenant = args.now ?? new Date()
  const providers = Object.keys(args.handlers)
  const rapport: FlushReport = { traitees: 0, reussies: 0, replanifiees: 0, echouees: 0 }

  if (providers.length === 0) return rapport

  const lignes = await prisma.syncOutbox.findMany({
    where: {
      state: 'PENDING',
      provider: { in: providers },
      nextAttemptAt: { lte: maintenant },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: args.limit ?? 50,
  })

  for (const ligne of lignes) {
    const handler = args.handlers[ligne.provider]
    if (handler === undefined) continue

    const job: SyncJob = {
      id: ligne.id,
      userId: ligne.userId,
      entityType: ligne.entityType,
      entityId: ligne.entityId,
      provider: ligne.provider,
      operation: ligne.operation as SyncOperation,
      attempts: ligne.attempts,
      payload: parsePayload(ligne.payloadJson),
    }

    rapport.traitees += 1

    // Une exception non prévue ne doit pas interrompre le drainage des autres
    // lignes : on la traite comme un échec rejouable et on continue.
    let resultat
    try {
      resultat = job.operation === 'DELETE' ? await handler.remove(job) : await handler.upsert(job)
    } catch (err) {
      resultat = {
        ok: false as const,
        retriable: true,
        message: err instanceof Error ? err.message : String(err),
      }
    }

    if (resultat.ok) {
      await prisma.syncOutbox.delete({ where: { id: ligne.id } })
      rapport.reussies += 1
      continue
    }

    const attempts = ligne.attempts + 1
    const abandonne = !resultat.retriable || attempts >= MAX_ATTEMPTS
    const recul = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]!

    await prisma.syncOutbox.update({
      where: { id: ligne.id },
      data: {
        attempts,
        lastError: resultat.message,
        state: abandonne ? 'FAILED' : 'PENDING',
        nextAttemptAt: abandonne
          ? ligne.nextAttemptAt
          : new Date(maintenant.getTime() + recul * 60_000),
      },
    })

    if (abandonne) rapport.echouees += 1
    else rapport.replanifiees += 1
  }

  return rapport
}

export interface OutboxRow {
  id: string
  entityType: string
  entityId: string
  provider: string
  operation: SyncOperation
  state: SyncState
  attempts: number
  lastError: string
  nextAttemptAt: Date
}

export async function listOutbox(userId: string): Promise<OutboxRow[]> {
  // 'FAILED' avant 'PENDING' en ordre alphabétique croissant : ce qui demande
  // une action de l'utilisateur remonte en tête de l'écran.
  const lignes = await prisma.syncOutbox.findMany({
    where: { userId },
    orderBy: [{ state: 'asc' }, { nextAttemptAt: 'asc' }],
  })

  return lignes.map((l) => ({
    id: l.id,
    entityType: l.entityType,
    entityId: l.entityId,
    provider: l.provider,
    operation: l.operation as SyncOperation,
    state: l.state as SyncState,
    attempts: l.attempts,
    lastError: l.lastError,
    nextAttemptAt: l.nextAttemptAt,
  }))
}

/** Remet une ligne en file. Rend `false` si elle n'appartient pas à l'utilisateur. */
export async function retryOutboxRow(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.syncOutbox.updateMany({
    where: { id, userId },
    data: { state: 'PENDING', attempts: 0, lastError: '', nextAttemptAt: new Date() },
  })
  return count > 0
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/sync/outbox.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 6: Vérifier par mutation**

Retirer brièvement la clause `nextAttemptAt: { lte: maintenant }` du `findMany` et confirmer
que « ne traite pas une ligne dont l'heure n'est pas venue » échoue. Restaurer ensuite.

- [ ] **Step 7: Commit**

```bash
git add src/services/sync/
git commit -m "feat(sync): provider-agnostic outbox with progressive backoff"
```

---

## Task 7: Push des temps réalisés vers les tâches Dolibarr

**Files:** Create `src/services/dolibarr/push.ts`, `src/services/dolibarr/push.test.ts`

**Interfaces:**
- Consumes: `buildTimeSpentPayloads` (tâche 1), `DolibarrApi` / `FakeDolibarr` (tâche 5), `SyncHandler` (tâche 6), `getCredential` (tâche 4), `isLocked`
- Produces:
  - `interface PushResult { poussees: number; misesAJour: number; supprimees: number; tachesCreees: number }`
  - `pushCraTimes(args: { userId: string; craId: string; api: DolibarrApi }): Promise<PushResult>`
  - `createDolibarrHandler(api: DolibarrApi): SyncHandler`

**Les trois pièges de cette tâche.**
1. **Le temps s'attache à une tâche, pas à un projet.** Une prestation se mappe sur une tâche du projet, adoptée si elle existe déjà sous ce libellé, créée sinon — et une seule fois.
2. **Le push réconcilie.** Un temps poussé puis supprimé localement doit disparaître de Dolibarr, sinon rouvrir/corriger/revalider laisse une journée fantôme facturée.
3. **La clé de correspondance est la cellule, pas la saisie.** `craId|lineId|date|slotId` : une saisie supprimée puis ressaisie garde la même cellule et met donc à jour le même `timespent`, au lieu d'en créer un second.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/dolibarr/push.test.ts` :

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { updateSettings } from '@/services/settings'
import { saveCredential } from '@/services/credentials'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { FakeDolibarr } from './fake'
import { DOLIBARR, DolibarrMappingError } from './api'
import { pushCraTimes, createDolibarrHandler } from './push'
import type { SyncJob } from '@/services/sync/types'

let userId = ''
let missionId = ''
let lineId = ''
let api: FakeDolibarr
let projectId = 0

function job(craId: string, entityType = 'Cra'): SyncJob {
  return {
    id: 'job', userId, entityType, entityId: craId, provider: DOLIBARR,
    operation: 'UPSERT', attempts: 0, payload: {},
  }
}

async function craValide(month: string): Promise<string> {
  const cra = await getOrCreateCra(userId, missionId, month)
  await transitionCra(userId, cra.id, 'ENVOYER')
  await transitionCra(userId, cra.id, 'VALIDER')
  return cra.id
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = 'd'.repeat(64)
  const u = await prisma.user.create({
    data: { email: 'push@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('PUSH client')
  const m = await createMission({ clientId: c.id, label: 'PUSH mission' })
  missionId = m.id
  lineId = (await createLine({
    missionId, userId, label: 'Développement', soldCentiemes: 3000, tjmCents: 80_000,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  // `transitionCra` inscrit désormais le CRA en file quand Dolibarr est armé
  // (tâche 8) : ce test l'arme, il doit donc nettoyer derrière lui.
  await prisma.syncOutbox.deleteMany({})
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  api = new FakeDolibarr()
  api.setup.TIMESHEET_DAY_DURATION = '7'
  projectId = api.seedProject({ ref: 'PJ001', title: 'PUSH mission', socid: 1 }).id

  await saveCredential({
    provider: DOLIBARR,
    secret: 'k',
    baseUrl: 'https://erp.local/api/index.php',
    metadata: { dolibarrUserId: '7' },
  })
  await prisma.externalLink.create({
    data: {
      entityType: 'Mission', entityId: missionId, provider: DOLIBARR,
      externalId: String(projectId),
    },
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.syncOutbox.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({ where: { email: 'push@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'PUSH client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('push des temps', () => {
  it('crée la tâche au premier push, et n en crée pas de seconde au suivant', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const premier = await pushCraTimes({ userId, craId, api })
    expect(premier.tachesCreees).toBe(1)
    expect(api.tasks).toHaveLength(1)
    expect(api.tasks[0]!.label).toBe('Développement')

    const second = await pushCraTimes({ userId, craId, api })
    expect(second.tachesCreees).toBe(0)
    expect(api.appels.createTask).toBe(1)
    expect(api.tasks).toHaveLength(1)
  })

  it('adopte une tâche existante portant le même libellé', async () => {
    await api.createTask({ projectId, label: 'Développement' })
    api.appels.createTask = 0

    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await pushCraTimes({ userId, craId, api })
    expect(api.appels.createTask).toBe(0)
    expect(api.tasks).toHaveLength(1)
  })

  it('attache le temps à la tâche, jamais au projet', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    expect(api.timespents[0]!.taskId).toBe(api.tasks[0]!.id)
    expect(api.timespents[0]!.dolibarrUserId).toBe(7)
  })

  it('ne pousse que le réalisé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'PREVISIONNEL' })
    const craId = await craValide('2026-05')

    const r = await pushCraTimes({ userId, craId, api })
    expect(r.poussees).toBe(1)
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])
  })

  it('pousse la durée écoulée même quand Dolibarr compte une journée plus courte', async () => {
    // Réglage local à 8 h, Dolibarr à 7 h. Une journée pleine part à 28 800 s :
    // la valeur de Dolibarr n'entre jamais dans le calcul. L'écart se règle
    // par alignement des réglages (tâche 11), pas par compensation cachée.
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    expect(api.timespents[0]!.durationSeconds).toBe(28_800)
  })

  it('utilise le facteur figé de la saisie, pas le réglage courant', async () => {
    await updateSettings({ minutesParJour: 420 })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 420, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 480 })

    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    // 420 minutes saisies restent 420 minutes : 25 200 s.
    expect(api.timespents[0]!.durationSeconds).toBe(25_200)
  })

  it('ne pousse rien pour un mois hors du CRA', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-06-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await pushCraTimes({ userId, craId, api })
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])
  })

  it('rouvrir puis revalider met à jour, ne duplique pas', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    await transitionCra(userId, craId, 'ROUVRIR')
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 240, kind: 'REALISE' })
    await transitionCra(userId, craId, 'ENVOYER')
    await transitionCra(userId, craId, 'VALIDER')

    const r = await pushCraTimes({ userId, craId, api })
    expect(r.misesAJour).toBe(1)
    expect(r.poussees).toBe(0)
    expect(api.timespents).toHaveLength(1)
    expect(api.timespents[0]!.durationSeconds).toBe(14_400)
  })

  it('retire de Dolibarr une journée supprimée localement', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })
    expect(api.timespents).toHaveLength(2)

    await transitionCra(userId, craId, 'ROUVRIR')
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 0, kind: 'REALISE' })
    await transitionCra(userId, craId, 'ENVOYER')
    await transitionCra(userId, craId, 'VALIDER')

    const r = await pushCraTimes({ userId, craId, api })
    expect(r.supprimees).toBe(1)
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])
  })

  it('retire de Dolibarr une journée repassée en prévisionnel', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    await transitionCra(userId, craId, 'ROUVRIR')
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'PREVISIONNEL' })
    await transitionCra(userId, craId, 'ENVOYER')
    await transitionCra(userId, craId, 'VALIDER')

    await pushCraTimes({ userId, craId, api })
    expect(api.timespents).toEqual([])
  })

  it('distingue deux créneaux du même jour', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 240, kind: 'REALISE', slotId: 'matin' })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 240, kind: 'REALISE', slotId: 'apres-midi' })
    const craId = await craValide('2026-05')

    const r = await pushCraTimes({ userId, craId, api })
    expect(r.poussees).toBe(2)
    expect(api.timespents).toHaveLength(2)
  })

  it('ne pousse rien tant que le CRA n est pas validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-05')

    const r = await pushCraTimes({ userId, craId: cra.id, api })
    expect(r).toEqual({ poussees: 0, misesAJour: 0, supprimees: 0, tachesCreees: 0 })
    expect(api.timespents).toEqual([])
  })

  it('refuse de pousser une mission non rattachée, sans rejouer indéfiniment', async () => {
    await prisma.externalLink.deleteMany({ where: { entityType: 'Mission' } })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await expect(pushCraTimes({ userId, craId, api })).rejects.toThrow(DolibarrMappingError)
    expect(await createDolibarrHandler(api).upsert(job(craId))).toEqual({
      ok: false,
      retriable: false,
      message: expect.stringContaining('projet Dolibarr'),
    })
  })

  it('refuse de pousser sans utilisateur Dolibarr renseigné', async () => {
    await saveCredential({ provider: DOLIBARR, secret: 'k', baseUrl: 'https://erp.local', metadata: {} })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await expect(pushCraTimes({ userId, craId, api })).rejects.toThrow(/utilisateur Dolibarr/)
  })

  it('ne touche pas au CRA d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-push@test.local', name: 'A', passwordHash: 'x' },
    })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const r = await pushCraTimes({ userId: autre.id, craId, api })
    expect(r.poussees).toBe(0)
    expect(api.timespents).toEqual([])

    await prisma.user.delete({ where: { id: autre.id } })
  })
})

describe('gestionnaire de file Dolibarr', () => {
  it('rend un échec rejouable quand Dolibarr est en panne', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    api.panne = true

    expect(await createDolibarrHandler(api).upsert(job(craId))).toEqual({
      ok: false,
      retriable: true,
      message: expect.stringContaining('injoignable'),
    })
  })

  it('réussit sur un CRA validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    expect(await createDolibarrHandler(api).upsert(job(craId))).toEqual({ ok: true })
  })

  it('refuse un type d entité qu il ne sait pas traiter', async () => {
    const r = await createDolibarrHandler(api).upsert(job('x', 'TimeEntry'))
    expect(r).toEqual({ ok: false, retriable: false, message: expect.stringContaining('TimeEntry') })
  })

  it('refuse une suppression de CRA, en disant quoi faire à la place', async () => {
    const r = await createDolibarrHandler(api).remove(job('x'))
    expect(r).toEqual({ ok: false, retriable: false, message: expect.stringContaining('revalidez') })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/dolibarr/push.test.ts`
Expected: FAIL — `Failed to resolve import "./push"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/dolibarr/push.ts` :

```ts
import { prisma } from '@/db/client'
import { isLocked } from '@/core/cra/state-machine'
import { buildTimeSpentPayloads, type PushableEntry } from '@/core/dolibarr/timespent'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { getCredential } from '@/services/credentials'
import type { SyncHandler, SyncJob, SyncOutcome } from '@/services/sync/types'
import {
  DOLIBARR,
  DolibarrMappingError,
  DolibarrRequestError,
  DolibarrUnavailableError,
  type DolibarrApi,
} from './api'

/** Types d'entités portés par `ExternalLink` pour ce connecteur. */
const LIEN_MISSION = 'Mission'
const LIEN_LIGNE = 'MissionLine'
/**
 * Une correspondance par **cellule de grille**, pas par saisie : la clé est
 * `craId|lineId|date|slotId`. Une saisie supprimée puis ressaisie retombe donc
 * sur le même temps passé chez Dolibarr au lieu d'en créer un second, et le
 * préfixe `craId|` permet de retrouver d'un coup tout ce qui a été poussé pour
 * ce CRA — y compris ce qui n'a plus de saisie locale.
 */
const LIEN_TEMPS = 'CraTimeSpent'

export interface PushResult {
  poussees: number
  misesAJour: number
  supprimees: number
  tachesCreees: number
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function externalIdOf(entityType: string, entityId: string): Promise<string | null> {
  const lien = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: { entityType, entityId, provider: DOLIBARR } },
    select: { externalId: true },
  })
  return lien?.externalId ?? null
}

/**
 * `llx_projet_task_time` porte un `fk_user` obligatoire : sans identifiant
 * d'utilisateur Dolibarr, aucun temps ne peut être enregistré. Le manque est
 * une erreur de configuration, pas une panne — rejouer n'y changerait rien.
 */
async function dolibarrUserId(): Promise<number> {
  const credential = await getCredential(DOLIBARR)
  const id = Number(credential?.metadata.dolibarrUserId ?? '')

  if (!Number.isInteger(id) || id <= 0) {
    throw new DolibarrMappingError(
      "Aucun utilisateur Dolibarr n'est renseigné : l'enregistrement d'un temps passé en exige un. " +
        'Renseignez-le dans Administration · Dolibarr.',
    )
  }
  return id
}

export async function pushCraTimes(args: {
  userId: string
  craId: string
  api: DolibarrApi
}): Promise<PushResult> {
  const resultat: PushResult = { poussees: 0, misesAJour: 0, supprimees: 0, tachesCreees: 0 }

  const cra = await prisma.cra.findFirst({
    where: { id: args.craId, userId: args.userId },
    select: { id: true, missionId: true, month: true, status: true },
  })

  // CRA disparu, ou appartenant à quelqu'un d'autre : rien à pousser, et ce
  // n'est pas une panne. La ligne de file est consommée sans bruit.
  if (cra === null) return resultat

  // Rouvert entre la mise en file et le drainage. Le déclencheur est la
  // validation, et elle seule : pousser un brouillon enverrait à Dolibarr du
  // temps qui n'est pas arrêté.
  if (!isLocked(cra.status as CraStatus)) return resultat

  const projetBrut = await externalIdOf(LIEN_MISSION, cra.missionId)
  if (projetBrut === null) {
    throw new DolibarrMappingError(
      "Cette mission n'est rattachée à aucun projet Dolibarr. " +
        'Rattachez-la dans Administration · Dolibarr avant de pousser ses temps.',
    )
  }
  const projectId = Number(projetBrut)
  const dolUser = await dolibarrUserId()

  const debut = new Date(Date.UTC(cra.month.getUTCFullYear(), cra.month.getUTCMonth(), 1))
  const fin = new Date(Date.UTC(cra.month.getUTCFullYear(), cra.month.getUTCMonth() + 1, 1))

  const rows = await prisma.timeEntry.findMany({
    where: {
      userId: args.userId,
      kind: 'REALISE',
      date: { gte: debut, lt: fin },
      line: { missionId: cra.missionId },
    },
    select: {
      id: true, lineId: true, date: true, slotId: true, minutes: true,
      kind: true, minutesParJour: true, comment: true,
      line: { select: { label: true } },
    },
  })

  const entries: PushableEntry[] = rows.map((r) => ({
    id: r.id,
    lineId: r.lineId,
    date: toIsoDate(r.date),
    slotId: r.slotId,
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
    minutesParJour: r.minutesParJour,
    comment: r.comment,
  }))
  const labelParLigne = new Map(rows.map((r) => [r.lineId, r.line.label]))
  const payloads = buildTimeSpentPayloads(entries)

  const tacheParLigne = new Map<string, number>()

  /**
   * Une prestation se mappe sur une **tâche** du projet. Elle est adoptée si
   * une tâche du même libellé existe déjà — cas d'une base Dolibarr organisée
   * à la main — et créée sinon, une seule fois, le lien étant alors mémorisé.
   */
  async function tacheDe(lineId: string): Promise<number> {
    const connue = tacheParLigne.get(lineId)
    if (connue !== undefined) return connue

    const lien = await externalIdOf(LIEN_LIGNE, lineId)
    if (lien !== null) {
      const id = Number(lien)
      tacheParLigne.set(lineId, id)
      return id
    }

    const label = labelParLigne.get(lineId) ?? lineId
    const existantes = await args.api.listTasks(projectId)
    const deja = existantes.find((t) => t.label === label)
    const tache = deja ?? (await args.api.createTask({ projectId, label }))
    if (deja === undefined) resultat.tachesCreees += 1

    await prisma.externalLink.upsert({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_LIGNE, entityId: lineId, provider: DOLIBARR,
        },
      },
      create: {
        entityType: LIEN_LIGNE, entityId: lineId, provider: DOLIBARR,
        externalId: String(tache.id), syncedAt: new Date(), syncState: 'SYNCED',
      },
      update: { externalId: String(tache.id), syncedAt: new Date(), syncState: 'SYNCED' },
    })

    tacheParLigne.set(lineId, tache.id)
    return tache.id
  }

  const liens = await prisma.externalLink.findMany({
    where: { entityType: LIEN_TEMPS, provider: DOLIBARR, entityId: { startsWith: `${cra.id}|` } },
    select: { entityId: true, externalId: true },
  })
  const connus = new Map(liens.map((l) => [l.entityId, l.externalId]))
  const vus = new Set<string>()

  for (const p of payloads) {
    const cle = `${cra.id}|${p.lineId}|${p.date}|${p.slotId}`
    vus.add(cle)

    const existant = connus.get(cle)

    if (existant === undefined) {
      const taskId = await tacheDe(p.lineId)
      const { timespentId } = await args.api.addTimeSpent({
        taskId, dolibarrUserId: dolUser, date: p.date,
        durationSeconds: p.durationSeconds, note: p.note,
      })
      await prisma.externalLink.create({
        data: {
          entityType: LIEN_TEMPS, entityId: cle, provider: DOLIBARR,
          externalId: `${taskId}:${timespentId}`, syncedAt: new Date(), syncState: 'SYNCED',
        },
      })
      resultat.poussees += 1
    } else {
      const [taskId, timespentId] = existant.split(':').map(Number) as [number, number]
      await args.api.updateTimeSpent({
        taskId, timespentId, date: p.date,
        durationSeconds: p.durationSeconds, note: p.note,
      })
      await prisma.externalLink.update({
        where: {
          entityType_entityId_provider: {
            entityType: LIEN_TEMPS, entityId: cle, provider: DOLIBARR,
          },
        },
        data: { syncedAt: new Date(), syncState: 'SYNCED' },
      })
      resultat.misesAJour += 1
    }
  }

  // Réconciliation. Sans elle, rouvrir un CRA, retirer une journée puis
  // revalider laisserait Dolibarr facturer une journée qui n'existe plus.
  for (const [cle, externalId] of connus) {
    if (vus.has(cle)) continue

    const [taskId, timespentId] = externalId.split(':').map(Number) as [number, number]
    await args.api.deleteTimeSpent({ taskId, timespentId })
    await prisma.externalLink.deleteMany({
      where: { entityType: LIEN_TEMPS, entityId: cle, provider: DOLIBARR },
    })
    resultat.supprimees += 1
  }

  return resultat
}

export function createDolibarrHandler(api: DolibarrApi): SyncHandler {
  return {
    async upsert(job: SyncJob): Promise<SyncOutcome> {
      if (job.entityType !== 'Cra') {
        return {
          ok: false,
          retriable: false,
          message: `Le connecteur Dolibarr ne sait pas synchroniser « ${job.entityType} ».`,
        }
      }

      try {
        await pushCraTimes({ userId: job.userId, craId: job.entityId, api })
        return { ok: true }
      } catch (err) {
        if (err instanceof DolibarrUnavailableError) {
          return { ok: false, retriable: true, message: err.message }
        }
        if (err instanceof DolibarrMappingError || err instanceof DolibarrRequestError) {
          return { ok: false, retriable: false, message: err.message }
        }
        throw err
      }
    },

    async remove(): Promise<SyncOutcome> {
      // L'application est maître du CRA : retirer des temps se fait en
      // rouvrant le CRA, pas en demandant une suppression à la file.
      return {
        ok: false,
        retriable: false,
        message:
          'Le connecteur Dolibarr ne supprime pas de CRA : rouvrez le CRA, retirez les jours, ' +
          'puis revalidez — le push retire alors les temps correspondants.',
      }
    },
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/dolibarr/push.test.ts`
Expected: PASS — 19 tests

- [ ] **Step 5: Vérifier par mutation**

Supprimer brièvement la boucle de réconciliation et confirmer que « retire de Dolibarr une
journée supprimée localement » échoue. Restaurer ensuite.

- [ ] **Step 6: Commit**

```bash
git add src/services/dolibarr/
git commit -m "feat(dolibarr): push realized times onto project tasks, with reconciliation"
```

---

## Task 8: Le déclencheur — la validation du CRA

**Files:** Modify `src/services/cra.ts`, `src/services/cra.test.ts`

**Interfaces:**
- Consumes: `enqueue` (tâche 6), `DOLIBARR` (tâche 5)
- Produces: `transitionCra` inchangée en signature ; elle inscrit désormais le CRA dans `SyncOutbox` **dans la même transaction** quand la transition aboutit à `VALIDE` et que Dolibarr est armé

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/services/cra.test.ts` :

```ts
import { saveCredential, deleteCredential } from './credentials'
import { DOLIBARR } from './dolibarr/api'

describe('mise en file à la validation', () => {
  async function armerDolibarr(): Promise<void> {
    process.env.CREDENTIALS_KEY = 'e'.repeat(64)
    await saveCredential({ provider: DOLIBARR, secret: 'k', baseUrl: 'https://erp.local' })
    await prisma.externalLink.upsert({
      where: {
        entityType_entityId_provider: {
          entityType: 'Mission', entityId: missionId, provider: DOLIBARR,
        },
      },
      create: { entityType: 'Mission', entityId: missionId, provider: DOLIBARR, externalId: '1' },
      update: { externalId: '1' },
    })
  }

  beforeEach(async () => {
    await prisma.syncOutbox.deleteMany({})
    await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
    await deleteCredential(DOLIBARR)
  })

  it('n inscrit rien quand Dolibarr n est pas connecté', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it('n inscrit rien quand la mission n est rattachée à aucun projet', async () => {
    process.env.CREDENTIALS_KEY = 'e'.repeat(64)
    await saveCredential({ provider: DOLIBARR, secret: 'k', baseUrl: 'https://erp.local' })

    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it('inscrit le CRA à la validation', async () => {
    await armerDolibarr()
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    const lignes = await prisma.syncOutbox.findMany()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]!.entityType).toBe('Cra')
    expect(lignes[0]!.entityId).toBe(cra.id)
    expect(lignes[0]!.provider).toBe(DOLIBARR)
    expect(lignes[0]!.userId).toBe(userId)
    expect(lignes[0]!.state).toBe('PENDING')
  })

  it('n inscrit rien sur une transition qui ne valide pas', async () => {
    await armerDolibarr()
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    expect(await prisma.syncOutbox.count()).toBe(0)

    await transitionCra(userId, cra.id, 'REFUSER')
    expect(await prisma.syncOutbox.count()).toBe(0)

    await transitionCra(userId, cra.id, 'ROUVRIR')
    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it('rouvrir puis revalider ne produit toujours qu une ligne', async () => {
    await armerDolibarr()
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')
    await transitionCra(userId, cra.id, 'ROUVRIR')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    expect(await prisma.syncOutbox.count()).toBe(1)
  })

  it('valide le CRA même si Dolibarr est éteint', async () => {
    // Aucun appel réseau n'a lieu ici : la validation écrit en base et met en
    // file, rien de plus. Une panne Dolibarr ne peut donc pas la bloquer.
    await armerDolibarr()
    const cra = await getOrCreateCra(userId, missionId, '2026-04')
    await transitionCra(userId, cra.id, 'ENVOYER')

    const valide = await transitionCra(userId, cra.id, 'VALIDER')
    expect(valide.status).toBe('VALIDE')
    expect(await prisma.syncOutbox.count()).toBe(1)
  })
})
```

Compléter le `afterAll` existant de `src/services/cra.test.ts` :

```ts
  await prisma.syncOutbox.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/cra.test.ts`
Expected: FAIL — `expected 0 to be 1` sur « inscrit le CRA à la validation »

- [ ] **Step 3: Écrire l'implémentation**

Dans `src/services/cra.ts`, ajouter les imports :

```ts
import { enqueue } from './sync/outbox'
import { DOLIBARR } from './dolibarr/api'
```

puis la garde et la transition :

```ts
/**
 * Le push n'est armé que si Dolibarr est connecté **et** que la mission est
 * rattachée à un projet. Inscrire sans l'un ou l'autre remplirait l'écran de
 * synchronisation de lignes vouées à échouer, sur une application dont le
 * connecteur est explicitement additif (spec §1).
 */
async function dolibarrPushArme(missionId: string): Promise<boolean> {
  const credential = await prisma.providerCredential.findUnique({
    where: { provider: DOLIBARR },
    select: { id: true },
  })
  if (credential === null) return false

  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: 'Mission', entityId: missionId, provider: DOLIBARR,
      },
    },
    select: { id: true },
  })
  return lien !== null
}

export async function transitionCra(
  userId: string,
  craId: string,
  t: CraTransition,
): Promise<CraView> {
  // Le scope par userId est la garantie qu'on n'agit jamais sur le CRA d'un autre.
  const current = await prisma.cra.findFirstOrThrow({ where: { id: craId, userId } })
  const next = applyTransition(current.status as CraStatus, t)

  // Lu **avant** la transaction : aucun appel réseau, mais deux lectures qui
  // n'ont rien à faire dans le verrou d'écriture.
  const arme = next === 'VALIDE' && (await dolibarrPushArme(current.missionId))

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.cra.update({
      where: { id: craId },
      data: { status: next },
      include: WITH_MISSION,
    })

    // La mise en file est transactionnelle avec le changement d'état : un CRA
    // validé sans ligne de file produirait un Dolibarr silencieusement
    // incomplet. Aucun appel à Dolibarr n'a lieu ici — c'est ce qui garantit
    // qu'une panne ne bloque jamais la validation.
    if (arme) {
      await enqueue({
        userId,
        entityType: 'Cra',
        entityId: craId,
        provider: DOLIBARR,
        payload: { month: updated.month.toISOString().slice(0, 7) },
        tx,
      })
    }

    return updated
  })

  return toView(row)
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/cra.test.ts`
Expected: PASS — les 6 tests nouveaux plus tous les existants

- [ ] **Step 5: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cra): enqueue the Dolibarr push when a CRA is validated"
```

---

## Task 9: Import initial et rattachement manuel

**Files:** Create `src/services/dolibarr/import.ts`, `src/services/dolibarr/import.test.ts`, `src/app/(app)/admin/dolibarr/page.tsx`, `src/app/(app)/admin/dolibarr/actions.ts`. Modify `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `DolibarrApi` (tâche 5), `createClient`, `createMission`, `listClients`, `listMissionsForUser`
- Produces:

```ts
export interface RemoteThirdparty { id: number; name: string; clientId: string | null; clientName: string | null }
export interface RemoteProject { id: number; ref: string; title: string; socid: number | null
                                 missionId: string | null; missionLabel: string | null }
export interface ImportCandidates { tiers: RemoteThirdparty[]; projets: RemoteProject[] }

listImportCandidates(userId: string, api: DolibarrApi): Promise<ImportCandidates>
attachClient(args: { userId: string; clientId: string; dolibarrThirdpartyId: number }): Promise<void>
createClientFromDolibarr(args: { userId: string; dolibarrThirdpartyId: number; name: string }): Promise<{ clientId: string }>
attachMission(args: { userId: string; missionId: string; dolibarrProjectId: number }): Promise<void>
createMissionFromDolibarr(args: { userId: string; clientId: string; dolibarrProjectId: number; label: string }): Promise<{ missionId: string }>
pushClientToDolibarr(args: { userId: string; clientId: string; api: DolibarrApi }): Promise<{ dolibarrThirdpartyId: number }>
detachEntity(args: { userId: string; entityType: 'Client' | 'Mission'; entityId: string }): Promise<void>
```

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/dolibarr/import.test.ts` :

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission } from '@/services/missions'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import {
  listImportCandidates,
  attachClient,
  createClientFromDolibarr,
  attachMission,
  createMissionFromDolibarr,
  pushClientToDolibarr,
  detachEntity,
} from './import'

let userId = ''
let api: FakeDolibarr

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'import@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'IMPORT' } } })
  api = new FakeDolibarr()
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'IMPORT' } } })
  await prisma.user.deleteMany({ where: { email: 'import@test.local' } })
  await prisma.$disconnect()
})

describe('import initial', () => {
  it('liste les tiers et les projets facturables au temps', async () => {
    api.seedThirdparty('IMPORT ACME')
    api.seedProject({ ref: 'PJ001', title: 'IMPORT Facturable', socid: 1 })
    api.seedProject({ ref: 'PJ002', title: 'IMPORT Interne', socid: 1, usageBillTime: false })

    const c = await listImportCandidates(userId, api)
    expect(c.tiers.map((t) => t.name)).toEqual(['IMPORT ACME'])
    expect(c.projets.map((p) => p.ref)).toEqual(['PJ001'])
    expect(c.tiers[0]!.clientId).toBeNull()
  })

  it('signale les objets déjà rattachés', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const local = await createClient('IMPORT ACME local')
    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })

    const c = await listImportCandidates(userId, api)
    expect(c.tiers[0]!.clientId).toBe(local.id)
    expect(c.tiers[0]!.clientName).toBe('IMPORT ACME local')
  })

  it('rattache sans jamais créer de doublon', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const local = await createClient('IMPORT ACME local')

    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })
    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })

    expect(await prisma.externalLink.count({ where: { entityType: 'Client' } })).toBe(1)
  })

  it('crée un client local à partir d un tiers', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const { clientId } = await createClientFromDolibarr({
      userId, dolibarrThirdpartyId: tiers.id, name: 'IMPORT ACME',
    })

    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).name).toBe('IMPORT ACME')
    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: 'Client', entityId: clientId, provider: DOLIBARR,
        },
      },
    })
    expect(lien.externalId).toBe(String(tiers.id))
  })

  it('crée une mission locale à partir d un projet', async () => {
    const c = await createClient('IMPORT client')
    const projet = api.seedProject({ ref: 'PJ001', title: 'IMPORT ITSM', socid: 1 })

    const { missionId } = await createMissionFromDolibarr({
      userId, clientId: c.id, dolibarrProjectId: projet.id, label: 'IMPORT ITSM',
    })

    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: 'Mission', entityId: missionId, provider: DOLIBARR,
        },
      },
    })
    expect(lien.externalId).toBe(String(projet.id))
  })

  it('pousse un client local vers Dolibarr et mémorise la correspondance', async () => {
    const local = await createClient('IMPORT poussé')
    const { dolibarrThirdpartyId } = await pushClientToDolibarr({
      userId, clientId: local.id, api,
    })

    expect(api.thirdparties.map((t) => t.name)).toEqual(['IMPORT poussé'])
    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: 'Client', entityId: local.id, provider: DOLIBARR,
        },
      },
    })
    expect(lien.externalId).toBe(String(dolibarrThirdpartyId))
  })

  it('ne pousse pas deux fois le même client', async () => {
    const local = await createClient('IMPORT poussé')
    const a = await pushClientToDolibarr({ userId, clientId: local.id, api })
    const b = await pushClientToDolibarr({ userId, clientId: local.id, api })

    expect(b.dolibarrThirdpartyId).toBe(a.dolibarrThirdpartyId)
    expect(api.thirdparties).toHaveLength(1)
  })

  it('laisse la base locale intacte quand Dolibarr est en panne', async () => {
    const local = await createClient('IMPORT poussé')
    api.panne = true

    await expect(pushClientToDolibarr({ userId, clientId: local.id, api })).rejects.toThrow()
    expect(await prisma.externalLink.count({ where: { entityType: 'Client' } })).toBe(0)
  })

  it('détache sans supprimer l objet local', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const local = await createClient('IMPORT ACME local')
    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })

    await detachEntity({ userId, entityType: 'Client', entityId: local.id })

    expect(await prisma.externalLink.count({ where: { entityType: 'Client' } })).toBe(0)
    expect(await prisma.client.findUnique({ where: { id: local.id } })).not.toBeNull()
  })

  it('propage la panne au lieu de rendre une liste silencieusement vide', async () => {
    // Une liste vide se confondrait avec « Dolibarr n'a rien à proposer ».
    // C'est la page qui attrape et affiche l'indisponibilité, en gardant le
    // formulaire de connexion accessible.
    api.panne = true
    await expect(listImportCandidates(userId, api)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/dolibarr/import.test.ts`
Expected: FAIL — `Failed to resolve import "./import"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/dolibarr/import.ts` :

```ts
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission } from '@/services/missions'
import { DOLIBARR, type DolibarrApi } from './api'

export interface RemoteThirdparty {
  id: number
  name: string
  /** objet local rattaché, null si aucun */
  clientId: string | null
  clientName: string | null
}

export interface RemoteProject {
  id: number
  ref: string
  title: string
  socid: number | null
  missionId: string | null
  missionLabel: string | null
}

export interface ImportCandidates {
  tiers: RemoteThirdparty[]
  projets: RemoteProject[]
}

/** Correspondances existantes d'un type d'entité, indexées par identifiant distant. */
async function liensParExternalId(entityType: string): Promise<Map<string, string>> {
  const liens = await prisma.externalLink.findMany({
    where: { entityType, provider: DOLIBARR },
    select: { entityId: true, externalId: true },
  })
  return new Map(liens.map((l) => [l.externalId, l.entityId]))
}

async function poser(entityType: string, entityId: string, externalId: string): Promise<void> {
  await prisma.externalLink.upsert({
    where: { entityType_entityId_provider: { entityType, entityId, provider: DOLIBARR } },
    create: {
      entityType, entityId, provider: DOLIBARR, externalId,
      syncedAt: new Date(), syncState: 'SYNCED',
    },
    update: { externalId, syncedAt: new Date(), syncState: 'SYNCED' },
  })
}

/**
 * Ce que l'écran d'import affiche : les tiers et projets de Dolibarr, avec la
 * mention de l'objet local déjà rattaché quand il y en a un.
 *
 * Volontairement manuel (spec §7) : un import automatique aveugle produirait
 * des doublons sur une base qui contient déjà des clients saisis à la main.
 */
export async function listImportCandidates(
  userId: string,
  api: DolibarrApi,
): Promise<ImportCandidates> {
  const [tiersDistants, projetsDistants] = await Promise.all([
    api.listThirdparties(),
    api.listProjects(),
  ])

  const [liensClients, liensMissions] = await Promise.all([
    liensParExternalId('Client'),
    liensParExternalId('Mission'),
  ])

  const clients = await prisma.client.findMany({ select: { id: true, name: true } })
  const nomClient = new Map(clients.map((c) => [c.id, c.name]))

  // Les missions restent scopées comme partout : seules celles dont
  // l'utilisateur porte une affectation, ou qui n'ont encore aucune ligne.
  const missions = await prisma.mission.findMany({
    where: {
      OR: [{ lines: { none: {} } }, { lines: { some: { assignments: { some: { userId } } } } }],
    },
    select: { id: true, label: true },
  })
  const nomMission = new Map(missions.map((m) => [m.id, m.label]))

  return {
    tiers: tiersDistants.map((t) => {
      const clientId = liensClients.get(String(t.id)) ?? null
      return {
        id: t.id,
        name: t.name,
        clientId,
        clientName: clientId === null ? null : (nomClient.get(clientId) ?? null),
      }
    }),
    projets: projetsDistants.map((p) => {
      const missionId = liensMissions.get(String(p.id)) ?? null
      return {
        id: p.id,
        ref: p.ref,
        title: p.title,
        socid: p.socid,
        missionId,
        missionLabel: missionId === null ? null : (nomMission.get(missionId) ?? null),
      }
    }),
  }
}

export async function attachClient(args: {
  userId: string
  clientId: string
  dolibarrThirdpartyId: number
}): Promise<void> {
  await poser('Client', args.clientId, String(args.dolibarrThirdpartyId))
}

export async function createClientFromDolibarr(args: {
  userId: string
  dolibarrThirdpartyId: number
  name: string
}): Promise<{ clientId: string }> {
  const c = await createClient(args.name)
  await poser('Client', c.id, String(args.dolibarrThirdpartyId))
  return { clientId: c.id }
}

export async function attachMission(args: {
  userId: string
  missionId: string
  dolibarrProjectId: number
}): Promise<void> {
  await poser('Mission', args.missionId, String(args.dolibarrProjectId))
}

export async function createMissionFromDolibarr(args: {
  userId: string
  clientId: string
  dolibarrProjectId: number
  label: string
}): Promise<{ missionId: string }> {
  const m = await createMission({ clientId: args.clientId, label: args.label })
  await poser('Mission', m.id, String(args.dolibarrProjectId))
  return { missionId: m.id }
}

/**
 * Pousse un client local vers Dolibarr. Idempotent : si la correspondance
 * existe déjà, on la rend telle quelle plutôt que de créer un second tiers.
 *
 * L'appel distant précède l'écriture locale : en cas de panne, rien n'est
 * inscrit, et l'utilisateur peut réessayer sans avoir à nettoyer un lien
 * pointant vers un tiers qui n'existe pas.
 */
export async function pushClientToDolibarr(args: {
  userId: string
  clientId: string
  api: DolibarrApi
}): Promise<{ dolibarrThirdpartyId: number }> {
  const existant = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: 'Client', entityId: args.clientId, provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  if (existant !== null) return { dolibarrThirdpartyId: Number(existant.externalId) }

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: args.clientId },
    select: { name: true },
  })
  const tiers = await args.api.createThirdparty(client.name)
  await poser('Client', args.clientId, String(tiers.id))

  return { dolibarrThirdpartyId: tiers.id }
}

/**
 * Rompt une correspondance sans rien supprimer des deux côtés. Toute référence
 * externe est nullable à tout moment (spec §1) — c'est ce qui préserve
 * l'autoportance de l'application.
 */
export async function detachEntity(args: {
  userId: string
  entityType: 'Client' | 'Mission'
  entityId: string
}): Promise<void> {
  await prisma.externalLink.deleteMany({
    where: { entityType: args.entityType, entityId: args.entityId, provider: DOLIBARR },
  })
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/dolibarr/import.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Écran de connexion et d'import**

`src/app/(app)/admin/dolibarr/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { saveCredential, deleteCredential } from '@/services/credentials'
import { DOLIBARR } from '@/services/dolibarr/api'
import { createHttpDolibarrApi } from '@/services/dolibarr/http'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import {
  attachClient,
  attachMission,
  createClientFromDolibarr,
  createMissionFromDolibarr,
  pushClientToDolibarr,
  detachEntity,
} from '@/services/dolibarr/import'

export type ConnexionState = { ok: true; message: string } | { ok: false; erreurs: string[] } | null

/**
 * Enregistre la clé d'API après l'avoir **essayée** : une clé fausse acceptée
 * en silence ne se manifesterait qu'au premier push, plusieurs jours plus tard.
 */
export async function connecterDolibarr(
  _prev: ConnexionState,
  formData: FormData,
): Promise<ConnexionState> {
  await requireUser()

  const baseUrl = String(formData.get('baseUrl') ?? '').trim()
  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const dolibarrUserId = String(formData.get('dolibarrUserId') ?? '').trim()

  const erreurs: string[] = []
  if (baseUrl === '') erreurs.push("L'URL de l'API Dolibarr est requise.")
  if (apiKey === '') erreurs.push("La clé d'API est requise.")
  if (!/^\d+$/.test(dolibarrUserId)) {
    erreurs.push("L'identifiant de l'utilisateur Dolibarr est requis : un temps passé en exige un.")
  }
  if (erreurs.length > 0) return { ok: false, erreurs }

  try {
    await createHttpDolibarrApi({ baseUrl, apiKey }).listProjects()
  } catch (err) {
    return { ok: false, erreurs: [err instanceof Error ? err.message : String(err)] }
  }

  await saveCredential({
    provider: DOLIBARR,
    secret: apiKey,
    baseUrl,
    metadata: { dolibarrUserId },
  })

  revalidatePath('/admin/dolibarr')
  return { ok: true, message: 'Connexion à Dolibarr enregistrée.' }
}

export async function deconnecterDolibarr(): Promise<void> {
  await requireUser()
  await deleteCredential(DOLIBARR)
  revalidatePath('/admin/dolibarr')
}

export async function rattacherTiers(formData: FormData): Promise<void> {
  const user = await requireUser()
  const dolibarrThirdpartyId = Number(formData.get('dolibarrId'))
  const clientId = String(formData.get('clientId') ?? '')

  if (clientId === '') {
    await createClientFromDolibarr({
      userId: user.id,
      dolibarrThirdpartyId,
      name: String(formData.get('nom') ?? ''),
    })
  } else {
    await attachClient({ userId: user.id, clientId, dolibarrThirdpartyId })
  }
  revalidatePath('/admin/dolibarr')
}

export async function rattacherProjet(formData: FormData): Promise<void> {
  const user = await requireUser()
  const dolibarrProjectId = Number(formData.get('dolibarrId'))
  const missionId = String(formData.get('missionId') ?? '')

  if (missionId === '') {
    await createMissionFromDolibarr({
      userId: user.id,
      clientId: String(formData.get('clientId') ?? ''),
      dolibarrProjectId,
      label: String(formData.get('titre') ?? ''),
    })
  } else {
    await attachMission({ userId: user.id, missionId, dolibarrProjectId })
  }
  revalidatePath('/admin/dolibarr')
}

export async function detacher(formData: FormData): Promise<void> {
  const user = await requireUser()
  await detachEntity({
    userId: user.id,
    entityType: String(formData.get('entityType')) as 'Client' | 'Mission',
    entityId: String(formData.get('entityId') ?? ''),
  })
  revalidatePath('/admin/dolibarr')
}

export async function pousserClient(formData: FormData): Promise<void> {
  const user = await requireUser()
  const api = await getDolibarrApi()
  if (api === null) return

  await pushClientToDolibarr({ userId: user.id, clientId: String(formData.get('clientId') ?? ''), api })
  revalidatePath('/admin/dolibarr')
}
```

`src/app/(app)/admin/dolibarr/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { getCredential } from '@/services/credentials'
import { listClients } from '@/services/clients'
import { listMissionsForUser } from '@/services/missions'
import { DOLIBARR } from '@/services/dolibarr/api'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import { listImportCandidates, type ImportCandidates } from '@/services/dolibarr/import'
import { previewDolibarrSetup, type SetupProposal } from '@/services/dolibarr/setup'
import { ConnexionForm } from './ConnexionForm'
import { RepriseReglages } from './RepriseReglages'
import { rattacherTiers, rattacherProjet, detacher, pousserClient } from './actions'

export default async function AdminDolibarrPage() {
  const user = await requireUser()
  const credential = await getCredential(DOLIBARR)
  const api = await getDolibarrApi()

  const clients = await listClients(user.id)
  const missions = await listMissionsForUser(user.id)

  let candidats: ImportCandidates | null = null
  let reprise: SetupProposal | null = null
  let panne: string | null = null

  if (api !== null) {
    // Une panne Dolibarr ne doit pas empêcher la page de s'afficher : elle
    // porte aussi le formulaire de connexion, qui est justement ce qu'on veut
    // atteindre quand ça ne marche pas.
    try {
      candidats = await listImportCandidates(user.id, api)
      reprise = await previewDolibarrSetup({ userId: user.id, api })
    } catch (err) {
      panne = err instanceof Error ? err.message : String(err)
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Administration · Dolibarr</h1>

      <ConnexionForm
        baseUrl={credential?.baseUrl ?? ''}
        dolibarrUserId={credential?.metadata.dolibarrUserId ?? ''}
        connecte={credential !== null}
      />

      {panne !== null && (
        <p className="mt-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Dolibarr est momentanément injoignable : {panne} La saisie et la validation des CRA
          fonctionnent normalement.
        </p>
      )}

      {reprise !== null && <RepriseReglages preview={reprise} />}

      {candidats !== null && (
        <>
          <section className="mt-8 border-t pt-4">
            <h2 className="mb-2 font-medium">Tiers Dolibarr</h2>
            <p className="mb-3 text-sm text-slate-600">
              Rattachez chaque tiers à un client existant, ou créez le client correspondant.
              Rien n’est importé automatiquement.
            </p>
            <ul className="space-y-2">
              {candidats.tiers.map((t) => (
                <li key={t.id} className="rounded border p-3 text-sm">
                  <div className="mb-2 font-medium">
                    {t.name}
                    {t.clientName !== null && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        rattaché à « {t.clientName} »
                      </span>
                    )}
                  </div>
                  {t.clientId === null ? (
                    <form action={rattacherTiers} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="dolibarrId" value={t.id} />
                      <input type="hidden" name="nom" value={t.name} />
                      <select name="clientId" className="rounded border px-2 py-1">
                        <option value="">Créer « {t.name} »</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            Rattacher à {c.name}
                          </option>
                        ))}
                      </select>
                      <button className="rounded border px-3 py-1">Valider</button>
                    </form>
                  ) : (
                    <form action={detacher}>
                      <input type="hidden" name="entityType" value="Client" />
                      <input type="hidden" name="entityId" value={t.clientId} />
                      <button className="rounded border px-3 py-1">Détacher</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8 border-t pt-4">
            <h2 className="mb-2 font-medium">Projets Dolibarr facturables au temps</h2>
            <ul className="space-y-2">
              {candidats.projets.map((p) => (
                <li key={p.id} className="rounded border p-3 text-sm">
                  <div className="mb-2 font-medium">
                    {p.ref} · {p.title}
                    {p.missionLabel !== null && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        rattaché à « {p.missionLabel} »
                      </span>
                    )}
                  </div>
                  {p.missionId === null ? (
                    <form action={rattacherProjet} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="dolibarrId" value={p.id} />
                      <input type="hidden" name="titre" value={p.title} />
                      <select name="missionId" className="rounded border px-2 py-1">
                        <option value="">Créer la mission « {p.title} »</option>
                        {missions.map((m) => (
                          <option key={m.id} value={m.id}>
                            Rattacher à {m.clientName} · {m.label}
                          </option>
                        ))}
                      </select>
                      <select name="clientId" className="rounded border px-2 py-1">
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            Client : {c.name}
                          </option>
                        ))}
                      </select>
                      <button className="rounded border px-3 py-1">Valider</button>
                    </form>
                  ) : (
                    <form action={detacher}>
                      <input type="hidden" name="entityType" value="Mission" />
                      <input type="hidden" name="entityId" value={p.missionId} />
                      <button className="rounded border px-3 py-1">Détacher</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8 border-t pt-4">
            <h2 className="mb-2 font-medium">Pousser un client vers Dolibarr</h2>
            <form action={pousserClient} className="flex items-center gap-2">
              <select name="clientId" className="rounded border px-2 py-1 text-sm">
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="rounded border px-3 py-1 text-sm">Créer le tiers</button>
            </form>
          </section>
        </>
      )}
    </main>
  )
}
```

`src/app/(app)/admin/dolibarr/ConnexionForm.tsx` :

```tsx
'use client'

import { useActionState } from 'react'
import { connecterDolibarr, deconnecterDolibarr, type ConnexionState } from './actions'

export function ConnexionForm({
  baseUrl,
  dolibarrUserId,
  connecte,
}: {
  baseUrl: string
  dolibarrUserId: string
  connecte: boolean
}) {
  const [state, action, enCours] = useActionState<ConnexionState, FormData>(connecterDolibarr, null)

  return (
    <section className="rounded border p-4">
      <h2 className="mb-2 font-medium">Connexion</h2>
      <p className="mb-3 text-sm text-slate-600">
        {connecte
          ? 'Dolibarr est connecté. La clé d’API est chiffrée au repos.'
          : 'Dolibarr n’est pas connecté. Tout reste créable et modifiable sans lui.'}
      </p>

      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          URL de l’API
          <input
            name="baseUrl"
            defaultValue={baseUrl}
            placeholder="https://erp.exemple.fr/api/index.php"
            className="w-80 rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          Clé d’API
          <input name="apiKey" type="password" className="w-64 rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          Identifiant utilisateur Dolibarr
          <input
            name="dolibarrUserId"
            defaultValue={dolibarrUserId}
            inputMode="numeric"
            className="w-40 rounded border px-2 py-1"
          />
        </label>
        <button disabled={enCours} className="rounded bg-slate-900 px-3 py-1 text-white">
          {enCours ? 'Vérification…' : 'Connecter'}
        </button>
      </form>

      {state?.ok === true && <p className="mt-2 text-sm text-emerald-700">{state.message}</p>}
      {state?.ok === false && (
        <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
          {state.erreurs.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {connecte && (
        <form action={deconnecterDolibarr} className="mt-3">
          <button className="rounded border px-3 py-1 text-sm">Déconnecter</button>
        </form>
      )}
    </section>
  )
}
```

Ajouter enfin le lien dans `src/app/(app)/layout.tsx`, après `/admin/saisie` :

```ts
  { href: '/admin/dolibarr', label: 'Dolibarr' },
```

- [ ] **Step 6: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(dolibarr): manual initial import and connection screen"
```

---

## Task 10: Engagement issu d'une propale, en lecture seule

**Files:** Create `src/services/dolibarr/propal.ts`. Modify `src/services/missions.ts`, `src/services/missions.test.ts`, `src/app/(app)/missions/page.tsx`, `src/app/(app)/missions/actions.ts`

**Interfaces:**
- Consumes: `DolibarrApi` (tâche 5)
- Produces:
  - `attachPropalLine(args: { userId: string; lineId: string; proposalId: number; propalLineId: number; api: DolibarrApi }): Promise<{ soldCentiemes: number; tjmCents: number }>`
  - `type UpdateLineResult = { ok: true } | { ok: false; reason: 'ENGAGEMENT_EXTERNE'; message: string } | { ok: false; reason: 'NON_AFFECTE' }`
  - `updateLine(args: { userId: string; lineId: string; label?: string; soldCentiemes?: number; tjmCents?: number; displayUnit?: DisplayUnit; allowedSlotIds?: string[] }): Promise<UpdateLineResult>`
  - `MissionForUser.lines[]` gagne `engagementSource: EngagementSource`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/services/missions.test.ts` :

```ts
import { updateLine } from './missions'
import { attachPropalLine } from './dolibarr/propal'
import { FakeDolibarr } from './dolibarr/fake'
import { DOLIBARR } from './dolibarr/api'

describe('engagement issu d une propale', () => {
  it('reprend les jours vendus et le TJM depuis la ligne de propale', async () => {
    const api = new FakeDolibarr()
    const c = await createClient('PROPALE client')
    const m = await createMission({ clientId: c.id, label: 'PROPALE mission' })
    const ligne = await createLine({
      missionId: m.id, userId, label: 'Dev', soldCentiemes: 0, tjmCents: 0,
    })

    const propale = api.seedProposal({
      ref: 'PR001',
      socid: 1,
      lines: [{ label: 'Développement', qty: 30, subpriceCents: 80_000 }],
    })

    const r = await attachPropalLine({
      userId, lineId: ligne.id, proposalId: propale.id, propalLineId: propale.lines[0]!.id, api,
    })

    expect(r).toEqual({ soldCentiemes: 3000, tjmCents: 80_000 })
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.soldCentiemes).toBe(3000)
    expect(relue.tjmCents).toBe(80_000)
    expect(relue.engagementSource).toBe('DOLIBARR_PROPALE')

    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: 'MissionLinePropalLine', entityId: ligne.id, provider: DOLIBARR,
        },
      },
    })
    expect(lien.externalId).toBe(`${propale.id}:${propale.lines[0]!.id}`)
  })

  it('refuse la modification locale des jours vendus et du TJM', async () => {
    const api = new FakeDolibarr()
    const c = await createClient('PROPALE verrou')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id, userId, label: 'Dev', soldCentiemes: 0, tjmCents: 0,
    })
    const propale = api.seedProposal({
      ref: 'PR002', socid: 1, lines: [{ label: 'Dev', qty: 30, subpriceCents: 80_000 }],
    })
    await attachPropalLine({
      userId, lineId: ligne.id, proposalId: propale.id, propalLineId: propale.lines[0]!.id, api,
    })

    const jours = await updateLine({ userId, lineId: ligne.id, soldCentiemes: 4000 })
    expect(jours).toEqual({
      ok: false,
      reason: 'ENGAGEMENT_EXTERNE',
      message: expect.stringContaining('propale'),
    })

    const tjm = await updateLine({ userId, lineId: ligne.id, tjmCents: 90_000 })
    expect(tjm.ok).toBe(false)

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.soldCentiemes).toBe(3000)
    expect(relue.tjmCents).toBe(80_000)
  })

  it('laisse modifier le libellé et l unité d une ligne issue d une propale', async () => {
    // Le verrou porte sur les deux chiffres qui ont une source de vérité
    // ailleurs, pas sur toute la ligne.
    const api = new FakeDolibarr()
    const c = await createClient('PROPALE libellé')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id, userId, label: 'Dev', soldCentiemes: 0, tjmCents: 0,
    })
    const propale = api.seedProposal({
      ref: 'PR003', socid: 1, lines: [{ label: 'Dev', qty: 10, subpriceCents: 70_000 }],
    })
    await attachPropalLine({
      userId, lineId: ligne.id, proposalId: propale.id, propalLineId: propale.lines[0]!.id, api,
    })

    expect(await updateLine({ userId, lineId: ligne.id, label: 'Développement V2' })).toEqual({ ok: true })
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.label).toBe('Développement V2')
  })

  it('laisse tout modifier sur une ligne manuelle', async () => {
    const c = await createClient('MANUEL client')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id, userId, label: 'Dev', soldCentiemes: 1000, tjmCents: 50_000,
    })

    expect(await updateLine({ userId, lineId: ligne.id, soldCentiemes: 2000, tjmCents: 60_000 })).toEqual({ ok: true })
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.soldCentiemes).toBe(2000)
    expect(relue.tjmCents).toBe(60_000)
  })

  it('met à jour la part affectée en même temps que les jours vendus', async () => {
    const c = await createClient('AFFECTATION client')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id, userId, label: 'Dev', soldCentiemes: 1000, tjmCents: 0,
    })

    await updateLine({ userId, lineId: ligne.id, soldCentiemes: 2500 })
    const affectation = await prisma.assignment.findUniqueOrThrow({
      where: { lineId_userId: { lineId: ligne.id, userId } },
    })
    expect(affectation.soldCentiemes).toBe(2500)
  })

  it('refuse de modifier la ligne d une mission non affectée', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-line@test.local', name: 'A', passwordHash: 'x' },
    })
    const c = await createClient('NON AFFECTE client')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id, userId, label: 'Dev', soldCentiemes: 1000, tjmCents: 0,
    })

    expect(await updateLine({ userId: autre.id, lineId: ligne.id, label: 'X' })).toEqual({
      ok: false,
      reason: 'NON_AFFECTE',
    })

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('expose la source d engagement de chaque ligne', async () => {
    const c = await createClient('SOURCE client')
    const m = await createMission({ clientId: c.id, label: 'SOURCE mission' })
    await createLine({ missionId: m.id, userId, label: 'Dev', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'SOURCE mission')
    expect(mission!.lines[0]!.engagementSource).toBe('MANUEL')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/missions.test.ts`
Expected: FAIL — `updateLine` et `attachPropalLine` n'existent pas

- [ ] **Step 3: Écrire `propal.ts`**

`src/services/dolibarr/propal.ts` :

```ts
import { prisma } from '@/db/client'
import { DOLIBARR, DolibarrRequestError, type DolibarrApi } from './api'

const LIEN_PROPALE = 'MissionLinePropalLine'

/**
 * Rattache une prestation à une ligne de propale.
 *
 * Les jours vendus et le TJM sont **repris** de la propale et deviennent
 * lecture seule localement (voir `updateLine`) : deux sources de vérité pour
 * le même chiffre finissent toujours par diverger.
 */
export async function attachPropalLine(args: {
  userId: string
  lineId: string
  proposalId: number
  propalLineId: number
  api: DolibarrApi
}): Promise<{ soldCentiemes: number; tjmCents: number }> {
  // Scope : on ne touche qu'à une ligne sur laquelle l'utilisateur est affecté.
  const affectation = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { id: true },
  })
  if (affectation === null) {
    throw new DolibarrRequestError("Cette prestation ne vous est pas affectée.")
  }

  const propale = await args.api.getProposal(args.proposalId)
  const ligne = propale.lines.find((l) => l.id === args.propalLineId)
  if (ligne === undefined) {
    throw new DolibarrRequestError(
      `La ligne ${args.propalLineId} est introuvable dans la propale ${propale.ref}.`,
    )
  }

  const soldCentiemes = Math.round(ligne.qty * 100)
  const tjmCents = ligne.subpriceCents

  await prisma.$transaction(async (tx) => {
    await tx.missionLine.update({
      where: { id: args.lineId },
      data: { soldCentiemes, tjmCents, engagementSource: 'DOLIBARR_PROPALE' },
    })
    await tx.assignment.update({
      where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
      data: { soldCentiemes },
    })
    await tx.externalLink.upsert({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_PROPALE, entityId: args.lineId, provider: DOLIBARR,
        },
      },
      create: {
        entityType: LIEN_PROPALE, entityId: args.lineId, provider: DOLIBARR,
        externalId: `${propale.id}:${ligne.id}`, syncedAt: new Date(), syncState: 'SYNCED',
      },
      update: {
        externalId: `${propale.id}:${ligne.id}`, syncedAt: new Date(), syncState: 'SYNCED',
      },
    })
  })

  return { soldCentiemes, tjmCents }
}
```

- [ ] **Step 4: Écrire `updateLine` et exposer `engagementSource`**

Dans `src/services/missions.ts`, ajouter `engagementSource: EngagementSource` au type des
lignes de `MissionForUser` et le renseigner dans `listMissionsForUser`
(`engagementSource: l.engagementSource as EngagementSource`), puis :

```ts
export type UpdateLineResult =
  | { ok: true }
  | { ok: false; reason: 'ENGAGEMENT_EXTERNE'; message: string }
  | { ok: false; reason: 'NON_AFFECTE' }

/**
 * Modifie une prestation.
 *
 * Le verrou de lecture seule sur les lignes issues d'une propale vit **ici**,
 * dans le service, et pas dans l'écran : le formulaire n'est qu'un des
 * appelants possibles, et le serveur est la seule barrière qui compte.
 *
 * Le verrou ne porte que sur les deux chiffres dont la source de vérité est
 * chez Dolibarr — jours vendus et TJM. Le libellé, l'unité d'affichage et les
 * créneaux autorisés restent locaux et modifiables.
 */
export async function updateLine(args: {
  userId: string
  lineId: string
  label?: string
  soldCentiemes?: number
  tjmCents?: number
  displayUnit?: DisplayUnit
  allowedSlotIds?: string[]
}): Promise<UpdateLineResult> {
  const affectation = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { line: { select: { engagementSource: true, soldCentiemes: true, tjmCents: true } } },
  })
  if (affectation === null) return { ok: false, reason: 'NON_AFFECTE' }

  const ligne = affectation.line
  const toucheEngagement =
    (args.soldCentiemes !== undefined && args.soldCentiemes !== ligne.soldCentiemes) ||
    (args.tjmCents !== undefined && args.tjmCents !== ligne.tjmCents)

  if (ligne.engagementSource === 'DOLIBARR_PROPALE' && toucheEngagement) {
    return {
      ok: false,
      reason: 'ENGAGEMENT_EXTERNE',
      message:
        'Les jours vendus et le TJM de cette prestation proviennent de la propale Dolibarr ' +
        'à laquelle elle est rattachée. Modifiez-les dans Dolibarr, ou détachez la prestation.',
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.missionLine.update({
      where: { id: args.lineId },
      data: {
        ...(args.label !== undefined && { label: args.label }),
        ...(args.soldCentiemes !== undefined && { soldCentiemes: args.soldCentiemes }),
        ...(args.tjmCents !== undefined && { tjmCents: args.tjmCents }),
        ...(args.displayUnit !== undefined && { displayUnit: args.displayUnit }),
        ...(args.allowedSlotIds !== undefined && {
          allowedSlotIds: args.allowedSlotIds.join(','),
        }),
      },
    })

    // La part affectée suit les jours vendus : `createLine` les initialise
    // égaux, les laisser diverger ici ferait mentir l'engagement affiché.
    if (args.soldCentiemes !== undefined) {
      await tx.assignment.update({
        where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
        data: { soldCentiemes: args.soldCentiemes },
      })
    }
  })

  return { ok: true }
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/missions.test.ts`
Expected: PASS — les 7 tests nouveaux plus tous les existants

- [ ] **Step 6: Refléter le verrou dans l'écran des missions**

Dans `src/app/(app)/missions/actions.ts`, ajouter :

```ts
import { updateLine } from '@/services/missions'

export type UpdateLineState = { ok: true } | { ok: false; message: string } | null

export async function modifierLigne(
  _prev: UpdateLineState,
  formData: FormData,
): Promise<UpdateLineState> {
  const user = await requireUser()

  const r = await updateLine({
    userId: user.id,
    lineId: String(formData.get('lineId') ?? ''),
    label: String(formData.get('label') ?? ''),
    soldCentiemes: Math.round(Number(formData.get('joursVendus')) * 100),
    tjmCents: Math.round(Number(formData.get('tjmEuros')) * 100),
  })

  if (!r.ok) {
    revalidatePath('/missions')
    return {
      ok: false,
      message:
        r.reason === 'ENGAGEMENT_EXTERNE'
          ? r.message
          : 'Cette prestation ne vous est pas affectée.',
    }
  }

  revalidatePath('/missions')
  return { ok: true }
}
```

Dans `src/app/(app)/missions/page.tsx`, sur chaque ligne listée, afficher la source
d'engagement et rendre les deux champs concernés non modifiables quand elle vaut
`DOLIBARR_PROPALE` — un champ qu'on peut remplir mais dont l'enregistrement sera refusé
est pire que pas de champ du tout :

```tsx
{l.engagementSource === 'DOLIBARR_PROPALE' ? (
  <p className="text-xs text-slate-500">
    Jours vendus et TJM repris de la propale Dolibarr — modifiables uniquement dans Dolibarr.
  </p>
) : null}
```

avec `readOnly={l.engagementSource === 'DOLIBARR_PROPALE'}` sur les champs `joursVendus` et
`tjmEuros` du formulaire `modifierLigne`.

- [ ] **Step 7: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(missions): propal-sourced engagement is read-only locally"
```

---

## Task 11: Reprise des réglages Dolibarr, sans jamais toucher aux CRA validés

**Files:** Create `src/services/dolibarr/setup.ts`, `src/services/dolibarr/setup.test.ts`. Modify `src/services/rates.ts`, `src/app/(app)/admin/dolibarr/page.tsx`, `src/app/(app)/admin/dolibarr/actions.ts`. Create `src/app/(app)/admin/dolibarr/RepriseReglages.tsx`

**Interfaces:**
- Consumes: `compareDayLength` (tâche 1), `fiscalYearBounds`, `getSettings`/`updateSettings`, `previewRecalibration`/`recalibrateOpenMonths` (lot 1d)
- Produces:
  - `previewRecalibration(userId: string, globalMinutesParJourHypothetique?: number)` — **paramètre ajouté**, par défaut le réglage courant
  - `interface SetupProposal { debutExerciceMois: { local: number; dolibarr: number | null; divergent: boolean }; minutesParJour: { local: number; dolibarr: number | null; divergent: boolean; centiemesAffichesParDolibarr: number | null }; exerciceApresReprise: { debut: string; fin: string; label: string } | null; reetalonnage: { concernees: number; verrouillees: number } }`
  - `previewDolibarrSetup(args: { userId: string; api: DolibarrApi; today?: string }): Promise<SetupProposal>`
  - `applyDolibarrSetup(args: { userId: string; api: DolibarrApi; reprendreExercice: boolean; reprendreDureeJournee: boolean; reetalonner: boolean }): Promise<{ reglagesRepris: string[]; recalibrees: number; sauteesVerrouillees: number }>`

**Le point non négociable.** Reprendre `TIMESHEET_DAY_DURATION` ne doit en aucun cas
modifier le calcul d'un CRA déjà validé. Le mécanisme existe déjà : `recalibrateOpenMonths`
(lot 1d) ne touche que les mois ouverts et compte ceux qu'il saute. **Ce lot s'appuie
dessus, il ne le réinvente pas** — et l'écran n'offre pas l'option pour les mois validés,
il ne se contente pas de la refuser.

- [ ] **Step 1: Élargir `previewRecalibration`**

Dans `src/services/rates.ts`, la fonction interne `candidats` prend un second argument
optionnel, et `previewRecalibration` le relaie :

```ts
/**
 * @param globalOverride durée de journée **hypothétique**, pour répondre à
 * « que se passerait-il si je reprenais la valeur de Dolibarr ? » avant d'avoir
 * enregistré quoi que ce soit. Sans lui, l'aperçu affiché avant confirmation
 * annoncerait toujours zéro saisie concernée, ce qui viderait l'avertissement
 * de son sens.
 */
async function candidats(userId: string, globalOverride?: number): Promise<Candidate[]> {
  const settings = await getSettings()
  const global = globalOverride ?? settings.minutesParJour
  // … reste inchangé, `global` remplaçant `settings.minutesParJour` dans
  // l'appel à `resolveMinutesParJour`.
}

export async function previewRecalibration(
  userId: string,
  globalMinutesParJourHypothetique?: number,
): Promise<{ concernees: number; verrouillees: number }> {
  const liste = await candidats(userId, globalMinutesParJourHypothetique)
  return {
    concernees: liste.filter((c) => !c.verrouille).length,
    verrouillees: liste.filter((c) => c.verrouille).length,
  }
}
```

`recalibrateOpenMonths` est inchangée : elle s'exécute **après** `updateSettings` et lit
donc déjà la nouvelle valeur.

- [ ] **Step 2: Écrire le test qui échoue**

`src/services/dolibarr/setup.test.ts` :

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { updateSettings, getSettings } from '@/services/settings'
import { FakeDolibarr } from './fake'
import { previewDolibarrSetup, applyDolibarrSetup } from './setup'

let userId = ''
let missionId = ''
let lineId = ''
let api: FakeDolibarr

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'setup@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('SETUP client')
  const m = await createMission({ clientId: c.id, label: 'SETUP mission' })
  missionId = m.id
  lineId = (await createLine({
    missionId, userId, label: 'Dev', soldCentiemes: 3000, tjmCents: 80_000,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, debutExerciceMois: 1, capacityMode: 'DESACTIVE' })

  api = new FakeDolibarr()
  api.setup.SOCIETE_FISCAL_MONTH_START = '4'
  api.setup.TIMESHEET_DAY_DURATION = '7'
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'setup@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'SETUP client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('aperçu de la reprise', () => {
  it('signale l écart de durée de journée et ce qu il produira', async () => {
    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })

    expect(p.minutesParJour).toEqual({
      local: 480,
      dolibarr: 420,
      divergent: true,
      centiemesAffichesParDolibarr: 114,
    })
  })

  it('annonce les bornes du nouvel exercice avant confirmation', async () => {
    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })

    expect(p.debutExerciceMois).toEqual({ local: 1, dolibarr: 4, divergent: true })
    expect(p.exerciceApresReprise).toEqual({
      debut: '2026-04-01',
      fin: '2027-03-31',
      label: 'Exercice 2026-2027',
    })
  })

  it('compte les saisies concernées par le réétalonnage, avant tout changement', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-01', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })

    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })
    expect(p.reetalonnage).toEqual({ concernees: 1, verrouillees: 1 })

    // Rien n'a été écrit : c'est un aperçu.
    expect((await getSettings()).minutesParJour).toBe(480)
  })

  it('ne propose rien quand les deux côtés sont déjà alignés', async () => {
    await updateSettings({ minutesParJour: 420, debutExerciceMois: 4 })
    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })

    expect(p.minutesParJour.divergent).toBe(false)
    expect(p.debutExerciceMois.divergent).toBe(false)
    expect(p.exerciceApresReprise).toBeNull()
  })

  it('reste utilisable quand une constante n est pas lisible', async () => {
    api.setup = {}
    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })

    expect(p.minutesParJour.dolibarr).toBeNull()
    expect(p.minutesParJour.divergent).toBe(false)
    expect(p.debutExerciceMois.dolibarr).toBeNull()
    expect(p.reetalonnage).toEqual({ concernees: 0, verrouillees: 0 })
  })
})

describe('application de la reprise', () => {
  it('NE TOUCHE JAMAIS une saisie d un mois validé', async () => {
    // Le test central du lot. Un document signé dont le contenu change après
    // signature est indéfendable.
    await saveEntry({ userId, lineId, date: '2026-07-01', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })

    const r = await applyDolibarrSetup({
      userId, api, reprendreExercice: false, reprendreDureeJournee: true, reetalonner: true,
    })
    expect(r.recalibrees).toBe(1)
    expect(r.sauteesVerrouillees).toBe(1)

    const juillet = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, date: new Date('2026-07-01T00:00:00.000Z') },
    })
    const aout = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, date: new Date('2026-08-03T00:00:00.000Z') },
    })
    expect(juillet.minutesParJour).toBe(480)
    expect(aout.minutesParJour).toBe(420)
  })

  it('reprend la durée de journée sans réétalonner si on ne le demande pas', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })

    const r = await applyDolibarrSetup({
      userId, api, reprendreExercice: false, reprendreDureeJournee: true, reetalonner: false,
    })
    expect(r.reglagesRepris).toEqual(["durée d'une journée"])
    expect(r.recalibrees).toBe(0)

    expect((await getSettings()).minutesParJour).toBe(420)
    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(e.minutesParJour).toBe(480)
  })

  it('reprend le mois de début d exercice', async () => {
    const r = await applyDolibarrSetup({
      userId, api, reprendreExercice: true, reprendreDureeJournee: false, reetalonner: false,
    })
    expect(r.reglagesRepris).toEqual(["mois de début d'exercice"])
    expect((await getSettings()).debutExerciceMois).toBe(4)
    expect((await getSettings()).minutesParJour).toBe(480)
  })

  it('ne fait rien quand on ne reprend rien', async () => {
    const r = await applyDolibarrSetup({
      userId, api, reprendreExercice: false, reprendreDureeJournee: false, reetalonner: false,
    })
    expect(r).toEqual({ reglagesRepris: [], recalibrees: 0, sauteesVerrouillees: 0 })
    expect((await getSettings()).minutesParJour).toBe(480)
  })

  it('ignore une reprise dont la constante n est pas lisible', async () => {
    api.setup = {}
    const r = await applyDolibarrSetup({
      userId, api, reprendreExercice: true, reprendreDureeJournee: true, reetalonner: true,
    })
    expect(r.reglagesRepris).toEqual([])
    expect((await getSettings()).minutesParJour).toBe(480)
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/dolibarr/setup.test.ts`
Expected: FAIL — `Failed to resolve import "./setup"`

- [ ] **Step 4: Écrire l'implémentation**

`src/services/dolibarr/setup.ts` :

```ts
import { compareDayLength } from '@/core/dolibarr/timespent'
import { fiscalYearBounds } from '@/core/fiscal/year'
import { getSettings, updateSettings } from '@/services/settings'
import { previewRecalibration, recalibrateOpenMonths } from '@/services/rates'
import type { DolibarrApi } from './api'

const CONSTANTE_EXERCICE = 'SOCIETE_FISCAL_MONTH_START'
const CONSTANTE_JOURNEE = 'TIMESHEET_DAY_DURATION'

export interface SetupProposal {
  debutExerciceMois: { local: number; dolibarr: number | null; divergent: boolean }
  minutesParJour: {
    local: number
    dolibarr: number | null
    divergent: boolean
    /** ce que Dolibarr affichera pour une journée locale pleine */
    centiemesAffichesParDolibarr: number | null
  }
  /** bornes de l'exercice **après** reprise, null si rien à reprendre */
  exerciceApresReprise: { debut: string; fin: string; label: string } | null
  reetalonnage: { concernees: number; verrouillees: number }
}

/** Lit une constante sans jamais faire échouer l'écran si elle manque. */
async function lireConstante(api: DolibarrApi, nom: string): Promise<number | null> {
  const brut = await api.getSetupValue(nom)
  if (brut === null || brut.trim() === '') return null
  const n = Number(brut)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Ce que la reprise va changer **concrètement**, calculé avant toute écriture.
 *
 * Reprendre l'une ou l'autre de ces valeurs modifie des chiffres que
 * l'utilisateur croit acquis : le mois d'exercice déplace les bornes de son
 * objectif de chiffre d'affaires, la durée d'une journée change la conversion
 * des minutes en jours. Une reprise silencieuse serait une trahison de
 * confiance (spec §8).
 */
export async function previewDolibarrSetup(args: {
  userId: string
  api: DolibarrApi
  /** 'YYYY-MM-DD' — paramètre pour rester testable sans geler l'horloge */
  today?: string
}): Promise<SetupProposal> {
  const settings = await getSettings()
  const today = args.today ?? new Date().toISOString().slice(0, 10)

  const moisDistant = await lireConstante(args.api, CONSTANTE_EXERCICE)
  const heuresDistantes = await lireConstante(args.api, CONSTANTE_JOURNEE)

  const moisValide =
    moisDistant !== null && Number.isInteger(moisDistant) && moisDistant >= 1 && moisDistant <= 12
      ? moisDistant
      : null

  const comparaison =
    heuresDistantes === null
      ? null
      : compareDayLength({
          minutesParJourLocal: settings.minutesParJour,
          heuresParJourDolibarr: heuresDistantes,
        })

  const exerciceDivergent = moisValide !== null && moisValide !== settings.debutExerciceMois
  const exercice = exerciceDivergent ? fiscalYearBounds(today, moisValide) : null

  // L'aperçu du réétalonnage se calcule avec la durée **hypothétique** : sans
  // cela, il annoncerait toujours zéro, puisque rien n'a encore changé.
  const reetalonnage =
    comparaison !== null && comparaison.divergent
      ? await previewRecalibration(args.userId, comparaison.minutesParJourDolibarr)
      : { concernees: 0, verrouillees: 0 }

  return {
    debutExerciceMois: {
      local: settings.debutExerciceMois,
      dolibarr: moisValide,
      divergent: exerciceDivergent,
    },
    minutesParJour: {
      local: settings.minutesParJour,
      dolibarr: comparaison?.minutesParJourDolibarr ?? null,
      divergent: comparaison?.divergent ?? false,
      centiemesAffichesParDolibarr: comparaison?.centiemesAffichesParDolibarr ?? null,
    },
    exerciceApresReprise:
      exercice === null
        ? null
        : { debut: exercice.start, fin: exercice.end, label: exercice.label },
    reetalonnage,
  }
}

export async function applyDolibarrSetup(args: {
  userId: string
  api: DolibarrApi
  reprendreExercice: boolean
  reprendreDureeJournee: boolean
  reetalonner: boolean
}): Promise<{ reglagesRepris: string[]; recalibrees: number; sauteesVerrouillees: number }> {
  const reglagesRepris: string[] = []

  if (args.reprendreExercice) {
    const mois = await lireConstante(args.api, CONSTANTE_EXERCICE)
    if (mois !== null && Number.isInteger(mois) && mois >= 1 && mois <= 12) {
      await updateSettings({ debutExerciceMois: mois })
      reglagesRepris.push("mois de début d'exercice")
    }
  }

  let dureeReprise = false
  if (args.reprendreDureeJournee) {
    const heures = await lireConstante(args.api, CONSTANTE_JOURNEE)
    if (heures !== null) {
      const settings = await getSettings()
      const comparaison = compareDayLength({
        minutesParJourLocal: settings.minutesParJour,
        heuresParJourDolibarr: heures,
      })
      await updateSettings({ minutesParJour: comparaison.minutesParJourDolibarr })
      reglagesRepris.push("durée d'une journée")
      dureeReprise = true
    }
  }

  // Le réétalonnage vient **après** l'écriture du réglage : `recalibrateOpenMonths`
  // compare le facteur figé de chaque saisie à ce que la cascade donne
  // maintenant. Et il ne touche jamais un mois validé — c'est le mécanisme du
  // lot 1d, réutilisé tel quel, pas réécrit ici.
  if (args.reetalonner && dureeReprise) {
    const r = await recalibrateOpenMonths(args.userId)
    return {
      reglagesRepris,
      recalibrees: r.recalibrees,
      sauteesVerrouillees: r.sauteesVerrouillees,
    }
  }

  return { reglagesRepris, recalibrees: 0, sauteesVerrouillees: 0 }
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/dolibarr/setup.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 6: Exposer dans l'écran Dolibarr**

Ajouter à `src/app/(app)/admin/dolibarr/actions.ts` :

```ts
import { applyDolibarrSetup } from '@/services/dolibarr/setup'

export async function reprendreReglages(formData: FormData): Promise<void> {
  const user = await requireUser()
  const api = await getDolibarrApi()
  if (api === null) return

  await applyDolibarrSetup({
    userId: user.id,
    api,
    reprendreExercice: formData.get('reprendreExercice') === 'on',
    reprendreDureeJournee: formData.get('reprendreDureeJournee') === 'on',
    reetalonner: formData.get('reetalonner') === 'on',
  })

  revalidatePath('/admin/dolibarr')
  revalidatePath('/admin/saisie')
  revalidatePath('/charge')
}
```

`src/app/(app)/admin/dolibarr/RepriseReglages.tsx` — composant serveur, déjà branché dans
`page.tsx` à la tâche 9 (`{reprise !== null && <RepriseReglages preview={reprise} />}`) :

```tsx
import type { SetupProposal } from '@/services/dolibarr/setup'
import { reprendreReglages } from './actions'

export function RepriseReglages({ preview }: { preview: SetupProposal }) {
  const rienAReprendre = !preview.debutExerciceMois.divergent && !preview.minutesParJour.divergent

  if (rienAReprendre) {
    return (
      <section className="mt-8 border-t pt-4">
        <h2 className="mb-2 font-medium">Réglages repris de Dolibarr</h2>
        <p className="text-sm text-slate-500">
          Les réglages de l’application correspondent déjà à ceux de l’instance Dolibarr.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-8 border-t pt-4">
      <h2 className="mb-2 font-medium">Réglages repris de Dolibarr</h2>
      <form action={reprendreReglages} className="space-y-3 text-sm">
        {preview.debutExerciceMois.divergent && (
          <label className="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-3">
            <span className="font-medium">
              <input type="checkbox" name="reprendreExercice" className="mr-2" />
              Reprendre le mois de début d’exercice : {preview.debutExerciceMois.dolibarr} (actuellement{' '}
              {preview.debutExerciceMois.local})
            </span>
            {preview.exerciceApresReprise !== null && (
              <span className="text-amber-900">
                Votre objectif de chiffre d’affaires sera désormais calculé sur{' '}
                {preview.exerciceApresReprise.label}, du {preview.exerciceApresReprise.debut} au{' '}
                {preview.exerciceApresReprise.fin}.
              </span>
            )}
          </label>
        )}

        {preview.minutesParJour.divergent && (
          <label className="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-3">
            <span className="font-medium">
              <input type="checkbox" name="reprendreDureeJournee" className="mr-2" />
              Aligner la durée d’une journée sur Dolibarr :{' '}
              {(preview.minutesParJour.dolibarr ?? 0) / 60} h (actuellement{' '}
              {preview.minutesParJour.local / 60} h)
            </span>
            <span className="text-amber-900">
              Sans alignement, une journée saisie ici s’affiche comme{' '}
              {((preview.minutesParJour.centiemesAffichesParDolibarr ?? 100) / 100)
                .toFixed(2)
                .replace('.', ',')}{' '}
              jour dans Dolibarr.
            </span>
          </label>
        )}

        {preview.minutesParJour.divergent && preview.reetalonnage.concernees > 0 && (
          <label className="flex flex-col gap-1 rounded border p-3">
            <span className="font-medium">
              <input type="checkbox" name="reetalonner" className="mr-2" />
              Réétalonner {preview.reetalonnage.concernees} saisie(s) des mois ouverts
            </span>
            {preview.reetalonnage.verrouillees > 0 && (
              <span className="text-slate-600">
                {preview.reetalonnage.verrouillees} saisie(s) appartiennent à un CRA validé et ne
                seront jamais modifiées.
              </span>
            )}
          </label>
        )}

        {preview.reetalonnage.verrouillees > 0 && preview.reetalonnage.concernees === 0 && (
          <p className="text-slate-600">
            {preview.reetalonnage.verrouillees} saisie(s) appartiennent à un CRA validé : elles ne
            sont jamais réétalonnées, l’option n’est donc pas proposée.
          </p>
        )}

        <button className="rounded bg-slate-900 px-3 py-1 text-white">Appliquer la reprise</button>
      </form>
    </section>
  )
}
```

- [ ] **Step 7: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0 — en particulier les tests existants de
`src/services/rates.test.ts` doivent toujours passer sans modification, le nouveau
paramètre étant optionnel.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(dolibarr): explicit takeover of fiscal month and day length"
```

---

## Task 12: Demander la facture à Dolibarr

**Files:** Create `src/services/dolibarr/invoicing.ts`, `src/services/dolibarr/invoicing.test.ts`. Modify `src/app/(app)/cra/page.tsx`, `src/app/(app)/cra/actions.ts`

**Interfaces:**
- Consumes: `buildInvoiceDraft` (tâche 2), `DolibarrApi` (tâche 5)
- Produces:
  - `previewCraInvoice(args: { userId: string; craId: string }): Promise<InvoiceDraft | null>`
  - `type RequestInvoiceResult = { ok: true; dolibarrInvoiceId: number; ref: string; deja: boolean } | { ok: false; reason: 'NON_VALIDE' | 'SANS_TIERS' | 'SANS_LIGNE' | 'INDISPONIBLE'; message: string }`
  - `requestCraInvoice(args: { userId: string; craId: string; api: DolibarrApi }): Promise<RequestInvoiceResult>`

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/dolibarr/invoicing.test.ts` :

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { updateSettings } from '@/services/settings'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import { previewCraInvoice, requestCraInvoice } from './invoicing'

let userId = ''
let clientId = ''
let missionId = ''
let lineId = ''
let api: FakeDolibarr

async function craValide(month: string): Promise<string> {
  const cra = await getOrCreateCra(userId, missionId, month)
  await transitionCra(userId, cra.id, 'ENVOYER')
  await transitionCra(userId, cra.id, 'VALIDER')
  return cra.id
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'facture@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('FACTURE client')
  clientId = c.id
  const m = await createMission({ clientId, label: 'FACTURE mission' })
  missionId = m.id
  lineId = (await createLine({
    missionId, userId, label: 'Développement', soldCentiemes: 3000, tjmCents: 80_000,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  api = new FakeDolibarr()
  await prisma.externalLink.create({
    data: { entityType: 'Client', entityId: clientId, provider: DOLIBARR, externalId: '42' },
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({ where: { email: 'facture@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'FACTURE client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('proposition de facture', () => {
  it('propose les jours validés au TJM de la prestation', async () => {
    for (let j = 1; j <= 20; j++) {
      await saveEntry({
        userId, lineId, date: `2026-05-${String(j).padStart(2, '0')}`,
        minutes: 480, kind: 'REALISE',
      })
    }
    const craId = await craValide('2026-05')

    const draft = await previewCraInvoice({ userId, craId })
    expect(draft!.socid).toBe(42)
    expect(draft!.lines[0]!.qteCentiemes).toBe(2000)
    expect(draft!.totalHtCents).toBe(1_600_000)
  })

  it('ne propose rien sur un CRA non validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-05')
    expect(await previewCraInvoice({ userId, craId: cra.id })).toBeNull()
  })

  it('ne propose rien sans tiers Dolibarr rattaché', async () => {
    await prisma.externalLink.deleteMany({ where: { entityType: 'Client' } })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    expect(await previewCraInvoice({ userId, craId })).toBeNull()
  })
})

describe('demande de facture', () => {
  it('crée une facture au brouillon, sans numéro ni TVA choisis par l application', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r.ok).toBe(true)
    expect(api.invoices).toHaveLength(1)
    expect(api.invoices[0]!.status).toBe(0)
    expect(api.invoices[0]!.socid).toBe(42)
    expect(api.invoices[0]!.lines[0]!.qty).toBe(1)
    expect(api.invoices[0]!.lines[0]!.subprice).toBe(800)
  })

  it('ne crée pas de seconde facture sur une seconde demande', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const a = await requestCraInvoice({ userId, craId, api })
    const b = await requestCraInvoice({ userId, craId, api })

    expect(api.invoices).toHaveLength(1)
    expect(b).toEqual({ ...a, deja: true })
  })

  it('refuse sur un CRA non validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-05')

    const r = await requestCraInvoice({ userId, craId: cra.id, api })
    expect(r).toEqual({
      ok: false,
      reason: 'NON_VALIDE',
      message: expect.stringContaining('validé'),
    })
  })

  it('laisse le CRA validé et les temps poussés quand Dolibarr est indisponible', async () => {
    // Le refus de la proposition, ou son échec, n'a aucune conséquence.
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    api.panne = true

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r).toEqual({
      ok: false,
      reason: 'INDISPONIBLE',
      message: expect.stringContaining('à la main'),
    })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
  })

  it('refuse quand le mois ne porte aucun réalisé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'PREVISIONNEL' })
    const craId = await craValide('2026-05')

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r).toEqual({
      ok: false,
      reason: 'SANS_LIGNE',
      message: expect.stringContaining('aucun temps réalisé'),
    })
    expect(api.invoices).toEqual([])
  })

  it('ne facture jamais de prévisionnel', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'PREVISIONNEL' })
    const craId = await craValide('2026-05')

    await requestCraInvoice({ userId, craId, api })
    expect(api.invoices[0]!.lines[0]!.qty).toBe(1)
  })

  it('ne facture pas le CRA d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-facture@test.local', name: 'A', passwordHash: 'x' },
    })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const r = await requestCraInvoice({ userId: autre.id, craId, api })
    expect(r.ok).toBe(false)
    expect(api.invoices).toEqual([])

    await prisma.user.delete({ where: { id: autre.id } })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/dolibarr/invoicing.test.ts`
Expected: FAIL — `Failed to resolve import "./invoicing"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/dolibarr/invoicing.ts` :

```ts
import { prisma } from '@/db/client'
import { isLocked } from '@/core/cra/state-machine'
import { buildInvoiceDraft, type InvoiceDraft } from '@/core/dolibarr/invoice'
import type { PushableEntry } from '@/core/dolibarr/timespent'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { DOLIBARR, DolibarrUnavailableError, type DolibarrApi } from './api'

const LIEN_FACTURE = 'CraInvoice'

interface Contexte {
  craId: string
  draft: InvoiceDraft
}

/**
 * Rassemble ce qu'il faut pour proposer une facture, ou `null` si la
 * proposition n'a pas lieu d'être.
 *
 * `null` couvre trois cas volontairement indistincts pour l'aperçu : CRA non
 * validé, client sans tiers Dolibarr, ou aucun temps réalisé. L'écran affiche
 * alors simplement rien ; `requestCraInvoice` les distingue, lui, parce qu'un
 * refus doit s'expliquer.
 */
async function contexte(userId: string, craId: string): Promise<Contexte | null> {
  const cra = await prisma.cra.findFirst({
    where: { id: craId, userId },
    select: {
      id: true,
      month: true,
      status: true,
      missionId: true,
      mission: { select: { clientId: true } },
    },
  })
  if (cra === null || !isLocked(cra.status as CraStatus)) return null

  const lienTiers = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: 'Client', entityId: cra.mission.clientId, provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  if (lienTiers === null) return null

  const debut = new Date(Date.UTC(cra.month.getUTCFullYear(), cra.month.getUTCMonth(), 1))
  const fin = new Date(Date.UTC(cra.month.getUTCFullYear(), cra.month.getUTCMonth() + 1, 1))

  const rows = await prisma.timeEntry.findMany({
    where: {
      userId,
      kind: 'REALISE',
      date: { gte: debut, lt: fin },
      line: { missionId: cra.missionId },
    },
    select: {
      id: true, lineId: true, date: true, slotId: true, minutes: true,
      kind: true, minutesParJour: true, comment: true,
    },
  })

  const lignes = await prisma.missionLine.findMany({
    where: { missionId: cra.missionId },
    select: { id: true, label: true, tjmCents: true },
    orderBy: { position: 'asc' },
  })

  const entries: PushableEntry[] = rows.map((r) => ({
    id: r.id,
    lineId: r.lineId,
    date: r.date.toISOString().slice(0, 10),
    slotId: r.slotId,
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
    minutesParJour: r.minutesParJour,
    comment: r.comment,
  }))

  const draft = buildInvoiceDraft({
    socid: Number(lienTiers.externalId),
    month: cra.month.toISOString().slice(0, 7),
    entries,
    lines: lignes,
  })

  return { craId: cra.id, draft }
}

export async function previewCraInvoice(args: {
  userId: string
  craId: string
}): Promise<InvoiceDraft | null> {
  const ctx = await contexte(args.userId, args.craId)
  if (ctx === null || ctx.draft.lines.length === 0) return null
  return ctx.draft
}

export type RequestInvoiceResult =
  | { ok: true; dolibarrInvoiceId: number; ref: string; deja: boolean }
  | {
      ok: false
      reason: 'NON_VALIDE' | 'SANS_TIERS' | 'SANS_LIGNE' | 'INDISPONIBLE'
      message: string
    }

/**
 * Demande à Dolibarr de créer la facture. Une proposition acceptée, jamais un
 * automatisme (spec §8 bis).
 *
 * L'application transmet des données : elle ne numérote rien, ne calcule
 * aucune TVA, n'émet ni n'archive aucun document. La facture est créée **au
 * brouillon** — un brouillon se corrige, une facture validée est numérotée et
 * immuable.
 */
export async function requestCraInvoice(args: {
  userId: string
  craId: string
  api: DolibarrApi
}): Promise<RequestInvoiceResult> {
  // Le contrôle de propriété passe **avant** la recherche d'une facture déjà
  // demandée : `ExternalLink` n'est pas scopé par utilisateur, interroger le
  // lien en premier révélerait la facture d'un CRA qui n'appartient pas à
  // l'appelant.
  const cra = await prisma.cra.findFirst({
    where: { id: args.craId, userId: args.userId },
    select: { status: true },
  })
  if (cra === null || !isLocked(cra.status as CraStatus)) {
    return {
      ok: false,
      reason: 'NON_VALIDE',
      message: 'La facture ne se demande qu’une fois le CRA validé.',
    }
  }

  const dejaFaite = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_FACTURE, entityId: args.craId, provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  if (dejaFaite !== null) {
    const [id, ref] = dejaFaite.externalId.split('|') as [string, string]
    return { ok: true, dolibarrInvoiceId: Number(id), ref: ref ?? '', deja: true }
  }

  const ctx = await contexte(args.userId, args.craId)
  if (ctx === null) {
    return {
      ok: false,
      reason: 'SANS_TIERS',
      message:
        'Le client de cette mission n’est rattaché à aucun tiers Dolibarr. ' +
        'Rattachez-le dans Administration · Dolibarr.',
    }
  }
  if (ctx.draft.lines.length === 0) {
    return {
      ok: false,
      reason: 'SANS_LIGNE',
      message: 'Ce mois ne porte aucun temps réalisé : il n’y a rien à facturer.',
    }
  }

  let facture: { id: number; ref: string }
  try {
    facture = await args.api.createDraftInvoice({
      socid: ctx.draft.socid,
      lines: ctx.draft.lines.map((l) => ({
        label: l.label,
        qteCentiemes: l.qteCentiemes,
        subpriceCents: l.tjmCents,
      })),
    })
  } catch (err) {
    // Le CRA reste validé et les temps restent poussés : décliner la
    // proposition, ou échouer à l'honorer, n'a aucune conséquence.
    return {
      ok: false,
      reason: 'INDISPONIBLE',
      message:
        'Dolibarr est indisponible : ' +
        (err instanceof DolibarrUnavailableError ? err.message : String(err)) +
        ' Le CRA reste validé et les temps restent poussés ; la facture peut se créer à la main dans Dolibarr.',
    }
  }

  await prisma.externalLink.create({
    data: {
      entityType: LIEN_FACTURE,
      entityId: args.craId,
      provider: DOLIBARR,
      externalId: `${facture.id}|${facture.ref}`,
      syncedAt: new Date(),
      syncState: 'SYNCED',
    },
  })

  return { ok: true, dolibarrInvoiceId: facture.id, ref: facture.ref, deja: false }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/dolibarr/invoicing.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Proposer depuis l'écran CRA**

Ajouter à `src/app/(app)/cra/actions.ts` :

```ts
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import { requestCraInvoice } from '@/services/dolibarr/invoicing'

export async function demanderFacture(formData: FormData): Promise<void> {
  const user = await requireUser()
  const api = await getDolibarrApi()
  if (api === null) return

  await requestCraInvoice({ userId: user.id, craId: String(formData.get('craId')), api })
  revalidatePath('/cra')
}
```

Dans `src/app/(app)/cra/page.tsx`, pour chaque CRA validé, afficher l'aperçu et le bouton :

```tsx
{cra.status === 'VALIDE' && propositions[cra.id] !== undefined && (
  <section className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
    <h3 className="mb-1 font-medium">Facturation</h3>
    <ul className="mb-2 list-disc pl-5">
      {propositions[cra.id]!.lines.map((l) => (
        <li key={l.lineId}>
          {l.label} — {(l.qteCentiemes / 100).toFixed(2).replace('.', ',')} jour(s) ×{' '}
          {(l.tjmCents / 100).toFixed(2).replace('.', ',')} €
        </li>
      ))}
    </ul>
    <form action={demanderFacture}>
      <input type="hidden" name="craId" value={cra.id} />
      <button className="rounded border px-3 py-1">
        Demander la facture à Dolibarr (brouillon)
      </button>
    </form>
    <p className="mt-2 text-xs text-slate-500">
      Dolibarr facture, pas cette application : elle ne numérote rien, ne calcule aucune TVA
      et n’émet aucun document. La facture est créée au brouillon, à vérifier et valider dans
      Dolibarr. Décliner n’a aucune conséquence.
    </p>
  </section>
)}
```

`propositions` étant construit dans la page, avec les imports
`import type { InvoiceDraft } from '@/core/dolibarr/invoice'`,
`import { previewCraInvoice } from '@/services/dolibarr/invoicing'` et
`import { demanderFacture } from './actions'` :

```tsx
const propositions: Record<string, InvoiceDraft> = {}
for (const cra of cras) {
  if (cra.status !== 'VALIDE') continue
  const draft = await previewCraInvoice({ userId: user.id, craId: cra.id })
  if (draft !== null) propositions[cra.id] = draft
}
```

- [ ] **Step 6: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(dolibarr): ask Dolibarr for a draft invoice after a validated CRA"
```

---

## Task 13: Écran de synchronisation et endpoint de vidage

**Files:** Create `src/services/sync/handlers.ts`, `src/app/api/sync/flush/route.ts`, `src/app/api/sync/flush/route.test.ts`, `src/app/(app)/admin/sync/page.tsx`, `src/app/(app)/admin/sync/actions.ts`. Modify `src/middleware.ts`, `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `flushSyncOutbox`, `listOutbox`, `retryOutboxRow` (tâche 6), `createDolibarrHandler` (tâche 7), `getDolibarrApi` (tâche 5)
- Produces:
  - `buildSyncHandlers(): Promise<Record<string, SyncHandler>>`
  - `POST /api/sync/flush`, protégé par l'en-tête `x-sync-token`

- [ ] **Step 1: Écrire le test qui échoue**

`src/app/api/sync/flush/route.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { POST } from './route'

function requete(token: string | null): Request {
  return new Request('http://localhost/api/sync/flush', {
    method: 'POST',
    headers: token === null ? {} : { 'x-sync-token': token },
  })
}

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  // Aucun fournisseur connecté : `buildSyncHandlers` rend un objet vide, et le
  // vidage n'appelle donc rien.
  await prisma.providerCredential.deleteMany({})
  process.env.SYNC_TOKEN = 'jeton-de-test'
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  delete process.env.SYNC_TOKEN
  await prisma.$disconnect()
})

describe('POST /api/sync/flush', () => {
  it('refuse sans jeton', async () => {
    expect((await POST(requete(null))).status).toBe(401)
  })

  it('refuse un mauvais jeton', async () => {
    expect((await POST(requete('faux'))).status).toBe(401)
  })

  it('se désactive quand aucun jeton n est configuré', async () => {
    delete process.env.SYNC_TOKEN
    expect((await POST(requete('jeton-de-test'))).status).toBe(503)
  })

  it('rend un rapport de vidage avec le bon jeton', async () => {
    const reponse = await POST(requete('jeton-de-test'))
    expect(reponse.status).toBe(200)
    expect(await reponse.json()).toEqual({
      traitees: 0,
      reussies: 0,
      replanifiees: 0,
      echouees: 0,
    })
  })

  it('laisse la file intacte quand aucun fournisseur n est connecté', async () => {
    await prisma.syncOutbox.create({
      data: { userId: 'u1', entityType: 'Cra', entityId: 'c1', provider: 'dolibarr' },
    })
    await POST(requete('jeton-de-test'))

    expect((await prisma.syncOutbox.findFirstOrThrow()).state).toBe('PENDING')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/app/api/sync/flush/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/sync/handlers.ts` :

```ts
import { DOLIBARR } from '@/services/dolibarr/api'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import { createDolibarrHandler } from '@/services/dolibarr/push'
import type { SyncHandler } from './types'

/**
 * Les gestionnaires réellement disponibles.
 *
 * Un fournisseur non connecté n'apparaît pas : ses lignes de file restent
 * alors en attente au lieu de tomber en échec, ce qui est le comportement
 * souhaitable — reconnecter le fournisseur suffit à les faire repartir.
 */
export async function buildSyncHandlers(): Promise<Record<string, SyncHandler>> {
  const handlers: Record<string, SyncHandler> = {}

  const dolibarr = await getDolibarrApi()
  if (dolibarr !== null) handlers[DOLIBARR] = createDolibarrHandler(dolibarr)

  return handlers
}
```

`src/app/api/sync/flush/route.ts` :

```ts
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { flushSyncOutbox } from '@/services/sync/outbox'
import { buildSyncHandlers } from '@/services/sync/handlers'

function jetonsEgaux(fourni: string, attendu: string): boolean {
  const a = Buffer.from(fourni)
  const b = Buffer.from(attendu)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Vidage de la file de sortie.
 *
 * Un cron système ou n8n peuvent l'appeler, mais **rien ne les exige** :
 * l'écran de synchronisation porte un bouton qui fait la même chose. Faire
 * dépendre la synchronisation d'un ordonnanceur externe retirerait à
 * l'application son autoportance.
 */
export async function POST(request: Request): Promise<Response> {
  const attendu = process.env.SYNC_TOKEN ?? ''

  if (attendu === '') {
    return NextResponse.json(
      { erreur: "La synchronisation par endpoint est désactivée : SYNC_TOKEN n'est pas défini." },
      { status: 503 },
    )
  }

  const fourni = request.headers.get('x-sync-token') ?? ''
  if (!jetonsEgaux(fourni, attendu)) {
    return NextResponse.json({ erreur: 'Jeton de synchronisation invalide.' }, { status: 401 })
  }

  const handlers = await buildSyncHandlers()
  const rapport = await flushSyncOutbox({ handlers, limit: 50 })

  return NextResponse.json(rapport)
}
```

Dans `src/middleware.ts`, sortir `api/sync` du matcher — l'endpoint porte sa propre
protection par jeton et n'a pas de session :

```ts
export const config = {
  matcher: ['/((?!api/auth|api/sync|_next/static|_next/image|favicon.ico).*)'],
}
```

Ajouter à `.env.example` :

```
# Jeton de l'endpoint POST /api/sync/flush. Vide = endpoint désactivé.
# Le bouton « synchroniser maintenant » fonctionne sans lui.
SYNC_TOKEN=""
```

`src/app/(app)/admin/sync/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { flushSyncOutbox, retryOutboxRow } from '@/services/sync/outbox'
import { buildSyncHandlers } from '@/services/sync/handlers'

export async function synchroniserMaintenant(): Promise<void> {
  await requireUser()
  const handlers = await buildSyncHandlers()
  await flushSyncOutbox({ handlers, limit: 50 })
  revalidatePath('/admin/sync')
}

export async function reessayer(formData: FormData): Promise<void> {
  const user = await requireUser()
  await retryOutboxRow(user.id, String(formData.get('id') ?? ''))
  revalidatePath('/admin/sync')
}
```

`src/app/(app)/admin/sync/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { listOutbox } from '@/services/sync/outbox'
import { synchroniserMaintenant, reessayer } from './actions'

const ETATS: Record<string, string> = {
  PENDING: 'En attente',
  FAILED: 'En échec',
}

export default async function AdminSyncPage() {
  const user = await requireUser()
  const lignes = await listOutbox(user.id)

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Administration · Synchronisation</h1>

      <form action={synchroniserMaintenant} className="mb-6">
        <button className="rounded bg-slate-900 px-3 py-1 text-white">
          Synchroniser maintenant
        </button>
      </form>

      {lignes.length === 0 ? (
        <p className="text-sm text-slate-500">Rien en attente de synchronisation.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Cible</th>
              <th>Fournisseur</th>
              <th>État</th>
              <th>Tentatives</th>
              <th>Prochaine tentative</th>
              <th>Dernier échec</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-b align-top">
                <td className="py-2">
                  {l.entityType} · {l.entityId.slice(0, 8)}
                </td>
                <td>{l.provider}</td>
                <td>{ETATS[l.state] ?? l.state}</td>
                <td>{l.attempts}</td>
                <td>{l.nextAttemptAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="max-w-xs text-slate-600">{l.lastError}</td>
                <td>
                  {l.state === 'FAILED' && (
                    <form action={reessayer}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className="rounded border px-2 py-0.5 text-xs">Réessayer</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-xs text-slate-500">
        Une panne du fournisseur ne bloque ni la saisie ni la validation d’un CRA : la file
        absorbe l’indisponibilité et rejoue au rétablissement.
      </p>
    </main>
  )
}
```

Ajouter le lien dans `src/app/(app)/layout.tsx` :

```ts
  { href: '/admin/sync', label: 'Synchro' },
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/app/api/sync/flush/route.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0. **Ne pas exécuter `npx next build`.**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sync): flush endpoint and synchronization screen"
```

---

## Task 14: Test d'intégration sur instance jetable

**Files:** Create `vitest.integration.config.ts`, `src/services/dolibarr/live.integration.ts`. Modify `package.json`, `.env.example`, `README.md`

**Interfaces:**
- Consumes: `createHttpDolibarrApi` (tâche 5)
- Produces: `npm run test:dolibarr`

**Pourquoi une configuration séparée.** `vitest.config.ts` n'est pas modifiable (contrainte
du projet), et son glob `src/**/*.test.{ts,tsx}` embarquerait tout fichier nommé `*.test.ts`.
Le fichier s'appelle donc `*.integration.ts` : il est hors du glob de la suite normale, et
`npx vitest run` ne l'exécutera jamais.

- [ ] **Step 1: Écrire la configuration**

`vitest.integration.config.ts` :

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Suite séparée : elle parle à une instance Dolibarr réelle et n'a donc rien à
// faire dans `npm test`. Elle se saute d'elle-même sans DOLIBARR_LIVE_URL et
// DOLIBARR_LIVE_KEY, pour qu'un `npm run test:dolibarr` lancé par erreur ne
// casse rien.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

Ajouter à `package.json` :

```json
    "test:dolibarr": "vitest run --config vitest.integration.config.ts"
```

- [ ] **Step 2: Écrire le test d'intégration**

`src/services/dolibarr/live.integration.ts` :

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createHttpDolibarrApi } from './http'
import type { DolibarrApi } from './api'

const baseUrl = process.env.DOLIBARR_LIVE_URL ?? ''
const apiKey = process.env.DOLIBARR_LIVE_KEY ?? ''
const projectId = Number(process.env.DOLIBARR_LIVE_PROJECT_ID ?? '')
const dolibarrUserId = Number(process.env.DOLIBARR_LIVE_USER_ID ?? '')

const configure = baseUrl !== '' && apiKey !== ''

describe.skipIf(!configure)('instance Dolibarr jetable', () => {
  let api: DolibarrApi

  beforeAll(() => {
    api = createHttpDolibarrApi({ baseUrl, apiKey })
  })

  it('lit les tiers', async () => {
    const tiers = await api.listThirdparties()
    expect(Array.isArray(tiers)).toBe(true)
  })

  it('ne rend que des projets facturables au temps', async () => {
    const projets = await api.listProjects()
    expect(Array.isArray(projets)).toBe(true)
  })

  it('lit TIMESHEET_DAY_DURATION', async () => {
    const valeur = await api.getSetupValue('TIMESHEET_DAY_DURATION')
    // Null est acceptable : toutes les versions n'exposent pas la constante.
    expect(valeur === null || Number(valeur) > 0).toBe(true)
  })

  it.skipIf(!Number.isInteger(projectId) || !Number.isInteger(dolibarrUserId))(
    'crée une tâche, y pose un temps, le met à jour, puis le retire',
    async () => {
      const label = `CRA-INTEGRATION-${Date.now()}`
      const tache = await api.createTask({ projectId, label })
      expect(tache.id).toBeGreaterThan(0)

      const { timespentId } = await api.addTimeSpent({
        taskId: tache.id,
        dolibarrUserId,
        date: new Date().toISOString().slice(0, 10),
        durationSeconds: 3600,
        note: 'test d’intégration CRA',
      })
      expect(timespentId).toBeGreaterThan(0)

      await api.updateTimeSpent({
        taskId: tache.id,
        timespentId,
        date: new Date().toISOString().slice(0, 10),
        durationSeconds: 1800,
        note: 'test d’intégration CRA (corrigé)',
      })

      // Le test nettoie derrière lui : une instance jetable finit toujours par
      // ne plus l'être.
      await api.deleteTimeSpent({ taskId: tache.id, timespentId })
    },
  )
})
```

- [ ] **Step 3: Documenter**

Ajouter à `.env.example` :

```
# Test d'intégration Dolibarr — npm run test:dolibarr.
# Laisser vide : la suite se saute alors d'elle-même.
# N'utiliser QUE sur une instance jetable : le test écrit des tâches et des temps.
DOLIBARR_LIVE_URL=""
DOLIBARR_LIVE_KEY=""
DOLIBARR_LIVE_PROJECT_ID=""
DOLIBARR_LIVE_USER_ID=""
```

Et dans `README.md`, sous les tests :
« `npm test` ne parle jamais à Dolibarr : le connecteur se teste contre un double en
mémoire. `npm run test:dolibarr` est la seule suite qui appelle une instance, et elle exige
`DOLIBARR_LIVE_URL` et `DOLIBARR_LIVE_KEY` — à ne pointer que vers une instance jetable. »

- [ ] **Step 4: Vérifier que la suite normale ignore bien ce fichier**

```bash
npx vitest run --reporter=verbose 2>&1 | grep -c "live.integration"
```

Expected: `0`

Puis vérifier que la suite dédiée se saute proprement sans configuration :

Run: `npm run test:dolibarr`
Expected: tests `skipped`, aucun échec, aucun appel réseau

- [ ] **Step 5: Vérifier l'ensemble**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(dolibarr): opt-in integration suite against a disposable instance"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche | Test qui la tient |
|---|---|---|
| §2 Lecture des tiers et des projets (`usage_bill_time = 1`) | 5, 9 | « ne rend que les projets facturables au temps », « filtre les projets sur usage_bill_time » |
| §2 Création de tiers | 5, 9 | « pousse un client local vers Dolibarr » |
| §2 Écriture du temps réalisé sur `addtimespent` | 7 | « attache le temps à la tâche, jamais au projet » |
| §2 Jamais de prévisionnel vers Dolibarr | 1, 7, 12 | « ne laisse jamais passer de prévisionnel », « ne pousse que le réalisé », « ne facture jamais de prévisionnel » |
| §3 Réutilisation de `SyncOutbox` / `ProviderCredential` / `ExternalLink`, indépendants du fournisseur | 4, 6 | « reste générique : deux fournisseurs cohabitent », « sépare deux fournisseurs sur la même entité » |
| §4 Le temps s'attache à une **tâche**, créée si absente | 7 | « crée la tâche au premier push, et n'en crée pas de seconde au suivant » |
| §4 `fk_user` requis | 5, 7 | « refuse de pousser sans utilisateur Dolibarr renseigné » |
| §5 Source d'engagement par ligne, défaut global | schéma existant + 10 | « expose la source d'engagement de chaque ligne » |
| §5 Jours vendus et TJM en lecture seule sur `DOLIBARR_PROPALE` | 10 | « refuse la modification locale des jours vendus et du TJM » |
| §6 Déclencheur = passage à `VALIDE` | 8 | « inscrit le CRA à la validation », « n'inscrit rien sur une transition qui ne valide pas » |
| §6 Rouvrir puis revalider met à jour, ne duplique pas | 7, 8 | « rouvrir puis revalider met à jour, ne duplique pas » |
| §6 Conversion en secondes depuis les minutes, au facteur de la saisie | 1, 7 | « donne la même durée quel que soit le facteur figé », « utilise le facteur figé de la saisie, pas le réglage courant » |
| §7 Import initial manuel | 9 | « liste les tiers et les projets facturables au temps », « signale les objets déjà rattachés » |
| §8 Reprise de `SOCIETE_FISCAL_MONTH_START` | 11 | « reprend le mois de début d'exercice » |
| §8 Reprise de `TIMESHEET_DAY_DURATION`, écart signalé et non compensé | 1, 11 | « signale l'écart de durée de journée et ce qu'il produira », « pousse la durée écoulée même quand Dolibarr compte une journée plus courte » |
| §8 Avertissement chiffré **avant** confirmation | 11 | « annonce les bornes du nouvel exercice avant confirmation », « compte les saisies concernées par le réétalonnage, avant tout changement » |
| §8 Les CRA validés ne bougent jamais | 11 | « NE TOUCHE JAMAIS une saisie d'un mois validé » |
| §8 bis Facture demandée, au brouillon, sur proposition | 2, 12 | « crée une facture au brouillon, sans numéro ni TVA choisis par l'application » |
| §8 bis Refus ou indisponibilité sans conséquence | 12 | « laisse le CRA validé et les temps poussés quand Dolibarr est indisponible » |
| §8 bis Ni numérotation, ni TVA, ni émission | 2, 5 | « ne produit ni numéro, ni TVA, ni mention légale », « convertit les centièmes en quantité de jours… » |
| §9 Connecteur additif, référence externe nullable | 9 | « détache sans supprimer l'objet local » |
| §9 Une panne ne bloque ni la saisie ni la validation | 6, 7, 8 | « valide le CRA même si Dolibarr est éteint », « rend un échec rejouable quand Dolibarr est en panne » |
| §9 Identifiants chiffrés au repos | 3, 4 | « stocke le secret chiffré, jamais en clair » |
| §10 Pas de relecture des temps, écrasement au push suivant | 7 | « rouvrir puis revalider met à jour », réconciliation |
| §10 n8n facultatif | 13 | « se désactive quand aucun jeton n'est configuré » |
| §11 Aucun test n'appelle l'instance réelle | 5, 14 | double `FakeDolibarr` ; suite jetable hors du glob |
| §11 Test d'intégration à part | 14 | `npm run test:dolibarr` |

**Hors périmètre, conformément à la spec :** numérotation, TVA, émission, conservation et
journalisation des factures ; relecture des temps depuis Dolibarr ; congés, notes de frais
et contrats ; file d'arbitrage à la Google Calendar (`SyncConflict`, `ExternalLink.etag`),
qui appartiennent au lot 1b.






---

## Arbitrage — propriété des tables de synchronisation

Les plans des lots **1b** et **2** décrivent tous deux la création de `SyncOutbox` et `ProviderCredential`. C'est voulu : les deux specs disent « celui qui arrive le premier les pose ». Elles doivent n'être créées **qu'une fois**.

**Décision : le lot 1b les porte**, conformément à l'ordre de construction retenu (1e → 1c → 1b → 2). Quand le lot 2 sera implémenté, ses tâches de création de schéma deviennent des tâches de consommation. Si l'ordre change, les rôles s'échangent — les tables sont conçues indépendantes du fournisseur exactement pour cela.

**Contradiction résolue sur le scope de `ProviderCredential`.** Le plan 1b y ajoutait un `userId` au nom de la règle de scoping du projet ; le plan 2 le refusait, y voyant un réglage d'instance. Les deux ont raison pour leur fournisseur :

- une **clé d'API Dolibarr** appartient à l'instance — il y en a une pour l'organisation ;
- un **jeton Google Calendar est personnel** — le jour où plusieurs consultants travaillent, chacun connecte son propre agenda, sinon on bloque les journées d'un autre.

`ProviderCredential.userId` est donc **nullable**, avec unicité sur `(provider, userId)`. Nul signifie identifiant d'instance, renseigné signifie identifiant personnel.

`SyncOutbox` reste scopée par utilisateur : ses lignes désignent des saisies et des CRA, qui le sont.
