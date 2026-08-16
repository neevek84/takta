# Lot 4 — Journal de preuve, API d'événements et ordonnanceur · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'application une trace probante, une intégration ouverte et une supervision — trois besoins servis par une seule chose : un journal en ajout seul, chaîné par empreinte, dont le catalogue d'actions est aussi le vocabulaire de l'API et des rappels sortants.

**Architecture:** Deux modules purs dans `core/` (catalogue, chaînage), quatre tables (`AuditEvent`, `Webhook`, `WebhookDelivery`, `ScheduledJob`), un service d'ajout sérialisé, deux routes protégées par jeton (`GET /api/events`, `POST /api/jobs/tick`), un ordonnanceur à registre en dur, et deux écrans d'administration.

**Tech Stack:** Next.js 15 · TypeScript · Prisma 6 · SQLite en développement, Postgres en cible · Vitest

**Spec :** `docs/superpowers/specs/2026-08-15-lot-4-journal-api-ordonnanceur-design.md`

## Global Constraints

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** `node:crypto` reste autorisé : c'est de la bibliothèque standard, pas une dépendance de plateforme.
- **Aucun enum Prisma, aucun décimal, aucun tableau, aucune requête fine sur du JSON.** Portabilité SQLite/Postgres. Le JSON se lit et s'écrit en bloc.
- **Aucune liste en tableau Prisma** : les événements souscrits par un abonnement sont une **chaîne séparée par des virgules**, comme `workingDays` et `allowedSlotIds`.
- **Entiers partout** : temps en minutes, jours en centièmes de jour, montants en centimes, durées d'ordonnancement en minutes.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus.** Deux exceptions explicitement justifiées dans ce lot : le contrôle du jeton d'API (il authentifie l'instance, pas un utilisateur) et la lecture de rattrapage `readAuditSince` (elle sert un jeton d'instance).
- **Aucune page ni action serveur n'interroge Prisma directement** en court-circuitant la couche service. Les route handlers non plus.
- **Le journal est en ajout seul et chaîné.** Aucune fonction publique ne modifie ni ne supprime une entrée.
- **Les consultations ne sont pas consignées.**
- **Aucun automatisme ne convertit du prévisionnel, ne valide un CRA, ni ne modifie une saisie** — à couvrir travail par travail.
- **Chaque appel sortant est signé** par HMAC-SHA256 du **corps brut**, avec le secret propre à l'abonnement.
- **La lecture par `since` est la garantie, la poussée n'est qu'un confort.**
- **Aucune information portée par la seule couleur** ; tout couple texte/fond atteint 4,5:1.
- Français pour les chaînes visibles, anglais pour le code et les messages de commit.
- `vitest.config.ts` est en `fileParallelism: false` — ne pas le modifier.
- Tests de composants : `// @vitest-environment happy-dom` en **première ligne**, `afterEach(cleanup)` explicite.
- **Ne jamais exécuter `npx next build`** : le serveur de développement du porteur du produit tourne sur cet arbre. Aucune tâche de ce plan ne l'appelle.
- **Ne jamais utiliser `git add -A`** pendant qu'un autre agent travaille — chemins explicites uniquement.
- **Toute évolution de `prisma/schema.prisma` s'accompagne d'une migration Postgres** sous `prisma/migrations/` : `src/db/schema-migration-sync.test.ts` échoue sinon.

---

## Interfaces existantes

```ts
// src/core/cra/state-machine.ts
type CraTransition = 'ENVOYER' | 'VALIDER' | 'REFUSER' | 'ROUVRIR'
applyTransition(from: CraStatus, t: CraTransition): CraStatus
isLocked(status: CraStatus): boolean

// src/core/types.ts
type TimeEntryKind = 'REALISE' | 'PREVISIONNEL'
type CraStatus = 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'
type CapacityMode = 'DESACTIVE' | 'AVERTISSEMENT' | 'BLOCAGE'

// src/core/engagement/compute.ts
interface EngagementSummary { venduCentiemes; realiseCentiemes; prevuCentiemes; resteCentiemes; depassementCentiemes }
computeEngagement(args: { venduCentiemes: number
                          entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number; minutesParJour: number }> }): EngagementSummary

// src/services/time-entries.ts
interface MonthEntry { id; lineId; date; minutes; kind; slotId; minutesParJour }
interface LineEngagementEntry { kind: TimeEntryKind; minutes: number; minutesParJour: number }
getMonthEntries(userId: string, month: string): Promise<MonthEntry[]>
getLineEngagementTotals(userId: string, lineIds: string[]): Promise<Record<string, LineEngagementEntry[]>>
saveEntry(args: { userId; lineId; date; minutes; kind; slotId? }): Promise<SaveResult>
convertPastForecast(userId, month, today): Promise<{ converted: number; skippedLocked: number }>

// src/services/cra.ts
interface CraView { id; missionId; missionLabel; clientName; month; status; invoiceNumber; invoicedAt; paidAt }
getOrCreateCra(userId: string, missionId: string, month: string): Promise<CraView>
transitionCra(userId: string, craId: string, t: CraTransition): Promise<CraView>
listCras(userId: string, month: string): Promise<CraView[]>

// src/services/settings.ts
interface AppSettings { minutesParJour; capacityMode; capacityCentiemes; workingDays: number[]
                        slots: Slot[]; holidays: string[]; defaultDisplayUnit; defaultEngagementSource
                        objectifCaExerciceCents; debutExerciceMois }
getSettings(): Promise<AppSettings>
updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
readSettingsRow(): Promise<Row>   // seul endroit qui porte les valeurs de création du singleton

// src/services/clients.ts / missions.ts
createClient(name: string, minutesParJour?: number | null): Promise<{ id; name }>
createMission(args: { clientId; label; minutesParJour? }): Promise<{ id }>
createLine(args: { missionId; userId; label; soldCentiemes; tjmCents; displayUnit?; minutesParJour?; allowedSlotIds? }): Promise<{ id }>

// src/services/rates.ts
recalibrateOpenMonths(userId: string): Promise<{ recalibrees: number; sauteesVerrouillees: number }>

// src/auth.ts
requireUser(): Promise<{ id: string; role: Role }>

// src/components/ui/
Badge({ tone, glyph, children, testId }) · Banner({ tone, title, glyph, children })
Button({ variant, loading, ... }) · Card({ title, children, className })
DataTable({ caption, children }) · Field({ label, error, hint, ... }) · Select({ label, error, children, ... })
PageShell({ title, actions, children })
```

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/core/audit/events.ts` | Catalogue des 25 événements, filtrage d'abonnement — pur |
| `src/core/audit/chain.ts` | Empreinte d'une entrée, vérification de la chaîne — pur |
| `src/core/webhooks/payload.ts` | Charge utile et corps brut — pur |
| `src/core/webhooks/signature.ts` | HMAC-SHA256 du corps brut — pur |
| `src/core/notify/templates.ts` | Gabarits de courriel, en français — pur |
| `prisma/schema.prisma` | *(modifié)* `AuditEvent`, `Webhook`, `WebhookDelivery`, `ScheduledJob`, colonnes `Settings` |
| `prisma/migrations/20260817000000_lot4_journal_api_ordonnanceur/migration.sql` | Migration Postgres |
| `src/services/audit.ts` | Ajout seul sérialisé, lecture, vérification |
| `src/services/api-token.ts` | Garde de jeton d'instance pour les routes d'API |
| `src/services/webhooks/subscriptions.ts` | Abonnements : CRUD, secret, suspension, reprise |
| `src/services/webhooks/delivery.ts` | Distribution, tentatives, recul, renvoi, essai |
| `src/services/jobs/registry.ts` | Les sept travaux, en dur, et leurs traitements |
| `src/services/jobs/scheduler.ts` | Réveil, échéances, verrou, isolation des échecs |
| `src/services/jobs/handlers.ts` | Les quatre travaux portés par ce lot |
| `src/services/notify.ts` | Envoi, ou consignation quand SMTP est absent |
| `src/integrations/smtp/mailer.ts` | Construction du transport depuis les réglages |
| `src/services/supervision.ts` | Agrégat « ce qui demande une action » |
| `src/app/api/events/route.ts` | `GET /api/events?since=&limit=&event=` |
| `src/app/api/jobs/tick/route.ts` | `POST /api/jobs/tick` |
| `src/middleware.ts` | *(modifié)* laisse passer `/api/`, protégé par jeton |
| `src/services/time-entries.ts` | *(modifié)* consignation des saisies |
| `src/services/cra.ts` | *(modifié)* consignation des transitions, CRA en souffrance |
| `src/services/clients.ts`, `missions.ts`, `settings.ts`, `rates.ts` | *(modifiés)* consignation |
| `src/app/(app)/admin/supervision/` | Écran de supervision |
| `src/app/(app)/admin/webhooks/` | Écran des abonnements |

**Dépendances :** **1, 2 et 7** sont indépendantes et parallélisables — c'est la première vague. Puis **3** ← 1, 2 ; **4** ← 3 ; **5** et **6** ← 4, et se parallélisent entre elles ; **8** ← 4, 7 ; **9** ← 4 ; **10** ← 9, 7 ; **11** ← 7 ; **13** ← 10, 11 ; **12** ← 13 (son registre importe les traitements) et 8 ; **14** ← 12 ; **15** ← tout.

**Vagues parallélisables :** (1, 2, 7) · (3) · (4) · (5, 6, 9, 11) · (8, 10) · (13) · (12) · (14) · (15).

**Compte des événements.** La spec liste **25** noms (§3), répartis en huit domaines. Le brief de rédaction en annonçait vingt-trois : c'est un décompte, pas une décision de conception, et la table de la spec fait foi. La tâche 1 fige la liste littéralement et son cardinal, pour que ce ne soit plus jamais une question d'appréciation.

---

## Task 1: Le catalogue d'événements

**Files:** Create `src/core/audit/events.ts`, `src/core/audit/events.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `const AUDIT_ACTIONS: readonly [...25 littéraux]`
  - `type AuditAction = (typeof AUDIT_ACTIONS)[number]`
  - `isAuditAction(valeur: string): valeur is AuditAction`
  - `parseSubscription(brut: string): AuditAction[]`
  - `serializeSubscription(actions: ReadonlyArray<AuditAction>): string`
  - `matchesSubscription(brut: string, action: AuditAction): boolean`

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/audit/events.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  AUDIT_ACTIONS,
  isAuditAction,
  matchesSubscription,
  parseSubscription,
  serializeSubscription,
} from './events'

describe('catalogue des événements', () => {
  it('est exactement la liste de la spec, dans son ordre', () => {
    // Contrat public : renommer, retirer ou réordonner une valeur casse les
    // flux qui s'y abonnent. Le test fige la liste littéralement — c'est le
    // seul endroit du dépôt où elle est écrite deux fois, volontairement.
    expect([...AUDIT_ACTIONS]).toEqual([
      'saisie.creee',
      'saisie.modifiee',
      'saisie.supprimee',
      'previsionnel.converti',
      'cra.ouvert',
      'cra.envoye',
      'cra.valide',
      'cra.refuse',
      'cra.rouvert',
      'client.cree',
      'mission.creee',
      'prestation.creee',
      'temps.pousses',
      'facture.demandee',
      'agenda.bloc.pousse',
      'agenda.conflit.detecte',
      'signature.envoyee',
      'signature.recue',
      'signature.refusee',
      'engagement.depasse',
      'capacite.depassee',
      'reglage.modifie',
      'reetalonnage.effectue',
      'synchro.echec',
      'travail.echoue',
    ])
  })

  it('en compte 25', () => {
    expect(AUDIT_ACTIONS).toHaveLength(25)
  })

  it('n en répète aucun', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
  })

  it('les nomme en minuscules pointées', () => {
    // Un humain qui configure un flux doit pouvoir les lire et les taper.
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z]+(\.[a-z]+)+$/)
    }
  })

  it('reconnaît un nom du catalogue et rejette le reste', () => {
    expect(isAuditAction('cra.valide')).toBe(true)
    expect(isAuditAction('cra.validee')).toBe(false)
    expect(isAuditAction('')).toBe(false)
    expect(isAuditAction('CRA.VALIDE')).toBe(false)
  })
})

describe('filtrage par abonnement', () => {
  it('une liste vide reçoit tout', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(matchesSubscription('', action)).toBe(true)
    }
    expect(matchesSubscription('   ', 'cra.valide')).toBe(true)
  })

  it('un abonnement ciblé ne reçoit que ce qu il a demandé', () => {
    expect(matchesSubscription('cra.valide', 'cra.valide')).toBe(true)
    expect(matchesSubscription('cra.valide', 'saisie.creee')).toBe(false)
  })

  it('accepte plusieurs noms et tolère les espaces', () => {
    const souscrits = ' cra.valide , saisie.creee '
    expect(matchesSubscription(souscrits, 'cra.valide')).toBe(true)
    expect(matchesSubscription(souscrits, 'saisie.creee')).toBe(true)
    expect(matchesSubscription(souscrits, 'cra.refuse')).toBe(false)
  })

  it('ignore un nom hors catalogue sans lever', () => {
    expect(parseSubscription('cra.valide,cra.inexistant')).toEqual(['cra.valide'])
    expect(matchesSubscription('cra.valide,cra.inexistant', 'cra.valide')).toBe(true)
  })

  it('un abonnement fait uniquement de noms inconnus ne reçoit rien', () => {
    // Le repli sûr est le silence : traiter « je n ai reconnu aucun nom »
    // comme « tous les événements » inonderait une URL qui n a rien demandé.
    expect(matchesSubscription('cra.inexistant', 'cra.valide')).toBe(false)
    expect(matchesSubscription('cra.inexistant', 'saisie.creee')).toBe(false)
  })

  it('fait l aller-retour avec la forme persistée', () => {
    const actions = ['cra.valide', 'saisie.creee'] as const
    expect(serializeSubscription(actions)).toBe('cra.valide,saisie.creee')
    expect(parseSubscription(serializeSubscription(actions))).toEqual([...actions])
    expect(serializeSubscription([])).toBe('')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/audit/events.test.ts`
Expected: FAIL — `Failed to resolve import "./events"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/audit/events.ts` :

```ts
/**
 * Le catalogue est **exactement** la liste des actes consignés au journal :
 * un seul vocabulaire pour la preuve, pour l'API et pour les rappels
 * sortants — trois usages, une nomenclature, aucune divergence possible.
 *
 * C'est un **contrat public**. Un consommateur (n8n, un script, ce qui
 * remplacera n8n) s'abonne par ces noms : les renommer casse silencieusement
 * des flux qu'on ne voit pas depuis ce dépôt. Ajouter une valeur est une
 * décision de conception, pas un effet de bord — un catalogue qui grossit
 * sans discipline devient inutilisable pour celui qui doit choisir à quoi
 * s'abonner.
 */
export const AUDIT_ACTIONS = [
  // Saisie
  'saisie.creee',
  'saisie.modifiee',
  'saisie.supprimee',
  'previsionnel.converti',
  // CRA
  'cra.ouvert',
  'cra.envoye',
  'cra.valide',
  'cra.refuse',
  'cra.rouvert',
  // Référentiel
  'client.cree',
  'mission.creee',
  'prestation.creee',
  // Dolibarr — émis par le lot 2
  'temps.pousses',
  'facture.demandee',
  // Agenda — émis par le lot 1b
  'agenda.bloc.pousse',
  'agenda.conflit.detecte',
  // Signature — émis par le lot 3
  'signature.envoyee',
  'signature.recue',
  'signature.refusee',
  // Alertes
  'engagement.depasse',
  'capacite.depassee',
  // Exploitation
  'reglage.modifie',
  'reetalonnage.effectue',
  'synchro.echec',
  'travail.echoue',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

const CATALOGUE: ReadonlySet<string> = new Set(AUDIT_ACTIONS)

export function isAuditAction(valeur: string): valeur is AuditAction {
  return CATALOGUE.has(valeur)
}

/**
 * Les événements souscrits sont persistés en **chaîne séparée par des
 * virgules**, jamais en tableau : la portabilité SQLite/Postgres l'impose,
 * comme `Settings.workingDays` et `MissionLine.allowedSlotIds`.
 *
 * Les noms hors catalogue sont écartés silencieusement plutôt que de lever :
 * un abonnement enregistré avant le retrait d'un événement doit continuer de
 * fonctionner pour les autres noms qu'il porte.
 */
export function parseSubscription(brut: string): AuditAction[] {
  return brut
    .split(',')
    .map((nom) => nom.trim())
    .filter(isAuditAction)
}

export function serializeSubscription(actions: ReadonlyArray<AuditAction>): string {
  return actions.join(',')
}

/**
 * Une valeur vide signifie « tous les événements ». Une valeur **non vide
 * dont aucun nom n'est reconnu** ne reçoit rien : le repli sûr est le
 * silence, pas l'inondation d'une URL qui n'a rien demandé.
 */
export function matchesSubscription(brut: string, action: AuditAction): boolean {
  if (brut.trim() === '') return true
  return parseSubscription(brut).includes(action)
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/audit/events.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/audit/events.ts src/core/audit/events.test.ts
git commit -m "feat(core): public event catalogue shared by journal, API and webhooks"
```

---

## Task 2: Le chaînage par empreinte

**Files:** Create `src/core/audit/chain.ts`, `src/core/audit/chain.test.ts`

**Interfaces:**
- Consumes: rien (`node:crypto` uniquement)
- Produces:
  - `const GENESIS_HASH = ''`
  - `interface AuditEntryContent { seq: number; occurredAtIso: string; actorId: string; actorLabel: string; action: string; entityType: string; entityId: string; payloadJson: string; prevHash: string }`
  - `hashAuditEntry(contenu: AuditEntryContent): string`
  - `type ChainVerdict = { ok: true; verifiees: number } | { ok: false; verifiees: number; seq: number; raison: 'EMPREINTE' | 'CHAINAGE' | 'ORDRE' }`
  - `verifyAuditChain(entries: ReadonlyArray<AuditEntryContent & { hash: string }>, ancrage?: string): ChainVerdict`

**Ce que ce module rend possible.** Sans la chaîne, une ligne réécrite ne laisse aucune trace, et un journal qu'on peut retoucher n'atteste de rien. Avec elle, modifier une entrée ancienne casse toutes les suivantes — et le premier point de rupture désigne l'entrée touchée.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/audit/chain.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  GENESIS_HASH,
  hashAuditEntry,
  verifyAuditChain,
  type AuditEntryContent,
} from './chain'

function contenu(patch: Partial<AuditEntryContent> = {}): AuditEntryContent {
  return {
    seq: 1,
    occurredAtIso: '2026-08-15T09:12:03.000Z',
    actorId: 'usr_1',
    actorLabel: 'Keveen',
    action: 'cra.valide',
    entityType: 'Cra',
    entityId: 'cra_1',
    payloadJson: '{"missionId":"m1","month":"2026-07"}',
    prevHash: GENESIS_HASH,
    ...patch,
  }
}

/** Construit une chaîne bien formée de n entrées. */
function chaine(n: number): Array<AuditEntryContent & { hash: string }> {
  const out: Array<AuditEntryContent & { hash: string }> = []
  let prevHash = GENESIS_HASH
  for (let seq = 1; seq <= n; seq++) {
    const c = contenu({ seq, prevHash, payloadJson: `{"n":${seq}}` })
    const hash = hashAuditEntry(c)
    out.push({ ...c, hash })
    prevHash = hash
  }
  return out
}

describe('empreinte d une entrée', () => {
  it('est reproductible', () => {
    expect(hashAuditEntry(contenu())).toBe(hashAuditEntry(contenu()))
  })

  it('est une empreinte SHA-256 en hexadécimal', () => {
    expect(hashAuditEntry(contenu())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('change dès qu un champ change, quel qu il soit', () => {
    const reference = hashAuditEntry(contenu())
    const variantes: Array<Partial<AuditEntryContent>> = [
      { seq: 2 },
      { occurredAtIso: '2026-08-15T09:12:04.000Z' },
      { actorId: 'usr_2' },
      { actorLabel: 'Autre' },
      { action: 'cra.refuse' },
      { entityType: 'TimeEntry' },
      { entityId: 'cra_2' },
      { payloadJson: '{"missionId":"m1","month":"2026-08"}' },
      { prevHash: 'a'.repeat(64) },
    ]
    for (const patch of variantes) {
      expect(hashAuditEntry(contenu(patch)), JSON.stringify(patch)).not.toBe(reference)
    }
  })

  it('ne confond pas deux découpages de champs', () => {
    // Sans séparateur non ambigu, ('ab','c') et ('a','bc') donneraient la
    // même empreinte : le journal cesserait d être une preuve.
    const a = hashAuditEntry(contenu({ entityType: 'ab', entityId: 'c' }))
    const b = hashAuditEntry(contenu({ entityType: 'a', entityId: 'bc' }))
    expect(a).not.toBe(b)
  })
})

describe('vérification de la chaîne', () => {
  it('accepte une chaîne vide', () => {
    expect(verifyAuditChain([])).toEqual({ ok: true, verifiees: 0 })
  })

  it('accepte une chaîne bien formée', () => {
    expect(verifyAuditChain(chaine(5))).toEqual({ ok: true, verifiees: 5 })
  })

  it('détecte une entrée réécrite À LA BONNE ENTRÉE', () => {
    // Le test qui fait du journal une preuve plutôt qu un historique.
    const entrees = chaine(5)
    entrees[2] = { ...entrees[2]!, payloadJson: '{"n":999}' }

    expect(verifyAuditChain(entrees)).toEqual({
      ok: false,
      verifiees: 2,
      seq: 3,
      raison: 'EMPREINTE',
    })
  })

  it('détecte la rupture même quand le faussaire recalcule l empreinte', () => {
    // Recalculer le hash de l entrée 3 la rend cohérente avec elle-même,
    // mais l entrée 4 porte encore le prevHash de l ancienne version.
    const entrees = chaine(5)
    const falsifiee = { ...entrees[2]!, payloadJson: '{"n":999}' }
    entrees[2] = { ...falsifiee, hash: hashAuditEntry(falsifiee) }

    expect(verifyAuditChain(entrees)).toEqual({
      ok: false,
      verifiees: 3,
      seq: 4,
      raison: 'CHAINAGE',
    })
  })

  it('détecte une entrée retirée du milieu', () => {
    const entrees = chaine(5)
    entrees.splice(2, 1)
    expect(verifyAuditChain(entrees)).toMatchObject({ ok: false, seq: 4, raison: 'CHAINAGE' })
  })

  it('détecte une numérotation qui ne progresse pas', () => {
    const entrees = chaine(3)
    entrees[1] = { ...entrees[1]!, seq: 1 }
    expect(verifyAuditChain(entrees)).toMatchObject({ ok: false, seq: 1, raison: 'ORDRE' })
  })

  it('refuse une chaîne qui ne part pas de la genèse', () => {
    const entrees = chaine(3).slice(1)
    expect(verifyAuditChain(entrees)).toMatchObject({ ok: false, raison: 'CHAINAGE' })
  })

  it('vérifie une fenêtre à partir d un ancrage connu', () => {
    // La vérification quotidienne n a pas à relire tout le journal : elle
    // repart de l empreinte de la dernière entrée déjà vérifiée.
    const entrees = chaine(5)
    const fenetre = entrees.slice(2)
    expect(verifyAuditChain(fenetre, entrees[1]!.hash)).toEqual({ ok: true, verifiees: 3 })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/audit/chain.test.ts`
Expected: FAIL — `Failed to resolve import "./chain"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/audit/chain.ts` :

```ts
import { createHash } from 'node:crypto'

/** L'ancrage de la toute première entrée. La chaîne part de nulle part. */
export const GENESIS_HASH = ''

/**
 * `\u001f` — « unit separator ». Il ne peut apparaître dans aucun champ :
 * `payloadJson` est produit par `JSON.stringify`, qui échappe tout caractère
 * de contrôle sous la forme `\u001f` (six caractères imprimables), et les
 * autres champs sont des identifiants, des libellés ou des dates ISO.
 */
const SEPARATEUR = '\u001f'

export interface AuditEntryContent {
  /** numéro d'ordre, strictement croissant */
  seq: number
  /** horodatage, sérialisé une seule fois pour que l'empreinte soit stable */
  occurredAtIso: string
  /** '' pour un traitement de fond */
  actorId: string
  actorLabel: string
  action: string
  entityType: string
  entityId: string
  payloadJson: string
  prevHash: string
}

/**
 * Encodage **positionnel**, et non `JSON.stringify` d'un objet : l'ordre des
 * clés d'un objet construit dynamiquement n'est pas un contrat de langage, et
 * une empreinte qui dépend de l'ordre des clés ne prouve rien le jour où le
 * mappage change.
 */
function canonicalise(c: AuditEntryContent): string {
  return [
    String(c.seq),
    c.occurredAtIso,
    c.actorId,
    c.actorLabel,
    c.action,
    c.entityType,
    c.entityId,
    c.payloadJson,
    c.prevHash,
  ].join(SEPARATEUR)
}

/** L'empreinte du contenu de l'entrée **et de `prevHash`** : c'est ce lien qui chaîne. */
export function hashAuditEntry(contenu: AuditEntryContent): string {
  return createHash('sha256').update(canonicalise(contenu), 'utf8').digest('hex')
}

export type ChainVerdict =
  | { ok: true; verifiees: number }
  | {
      ok: false
      /** nombre d'entrées vérifiées avant la rupture */
      verifiees: number
      /** numéro d'ordre de la première entrée en défaut */
      seq: number
      raison: 'EMPREINTE' | 'CHAINAGE' | 'ORDRE'
    }

/**
 * Recalcule la chaîne et signale **la première** rupture.
 *
 * Trois défauts distincts, parce qu'ils ne racontent pas la même histoire :
 * `ORDRE` = la numérotation ne progresse plus ; `CHAINAGE` = une entrée a été
 * insérée, retirée, ou une entrée antérieure a été réécrite puis rehachée ;
 * `EMPREINTE` = le contenu de cette entrée-ci ne correspond plus à son hash.
 *
 * `ancrage` permet de vérifier une fenêtre à partir de l'empreinte de la
 * dernière entrée déjà contrôlée, sans relire tout le journal.
 */
export function verifyAuditChain(
  entries: ReadonlyArray<AuditEntryContent & { hash: string }>,
  ancrage: string = GENESIS_HASH,
): ChainVerdict {
  let precedentHash = ancrage
  let precedentSeq = 0

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!

    if (e.seq <= precedentSeq) {
      return { ok: false, verifiees: i, seq: e.seq, raison: 'ORDRE' }
    }
    if (e.prevHash !== precedentHash) {
      return { ok: false, verifiees: i, seq: e.seq, raison: 'CHAINAGE' }
    }
    if (hashAuditEntry(e) !== e.hash) {
      return { ok: false, verifiees: i, seq: e.seq, raison: 'EMPREINTE' }
    }

    precedentHash = e.hash
    precedentSeq = e.seq
  }

  return { ok: true, verifiees: entries.length }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/audit/chain.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer `SEPARATEUR` par `''` et confirmer que « ne confond pas deux découpages de champs » échoue. Retirer `c.prevHash` de `canonicalise` et confirmer que « change dès qu un champ change » échoue sur la variante `prevHash`. Restaurer ensuite.

- [ ] **Step 6: Commit**

```bash
git add src/core/audit/chain.ts src/core/audit/chain.test.ts
git commit -m "feat(core): hash-chained audit entries with first-breach detection"
```

---

## Task 3: Schéma et migration Postgres

**Files:** Modify `prisma/schema.prisma`. Create `prisma/migrations/20260817000000_lot4_journal_api_ordonnanceur/migration.sql`, `src/db/audit-schema.test.ts`. Modify `.env.example`

**Interfaces:**
- Consumes: le catalogue (tâche 1) et `GENESIS_HASH` (tâche 2) pour les valeurs de test
- Produces: modèles `AuditEvent`, `Webhook`, `WebhookDelivery`, `ScheduledJob` ; colonnes `Settings.webhookMaxEchecs`, `notificationEmail`, `smtpHost`, `smtpPort`, `smtpUser`, `smtpFrom`, `smtpSecure`

**Trois décisions portées par ce schéma.**

1. **`AuditEvent` n'a aucune clé étrangère vers `User`.** Toutes les autres tables du produit cascadent à la suppression d'un utilisateur ; un journal de preuve qui cascade s'amputerait tout seul — supprimer un compte effacerait la preuve de ce qu'il a fait. `actorId` est donc une chaîne libre, `''` désignant `SYSTEME`.
2. **`seq` n'est pas un `autoincrement`.** Il est calculé par le service et entre dans l'empreinte. Un numéro d'ordre attribué par le moteur ne pourrait pas être haché à l'écriture, et un journal dont la numérotation n'est pas hachée peut être renuméroté sans trace.
3. **`prevHash` est unique.** Deux entrées ne peuvent pas se réclamer du même prédécesseur : la base elle-même interdit la fourche, y compris entre deux processus. C'est ce qui rend la sérialisation applicative de la tâche 4 vérifiable plutôt que seulement espérée.

- [ ] **Step 1: Étendre le schéma**

Dans `prisma/schema.prisma`, ajouter la relation à `User` :

```prisma
model User {
  // … champs existants
  webhooks Webhook[]
}
```

Ajouter les réglages à `Settings` :

```prisma
model Settings {
  // … champs existants

  /// échecs consécutifs au-delà desquels un abonnement est suspendu.
  /// Cinq tentatives = un événement abandonné ; suspendre pour un seul
  /// événement serait fragile, dix échecs de suite disent une URL morte.
  webhookMaxEchecs Int @default(10)

  /// destinataire des rappels internes. Vide = aucun envoi.
  notificationEmail String @default("")

  /// configuration SMTP minimale, pour l'autoportance. Le mot de passe ne
  /// vit PAS ici : il se saisit dans l'environnement (SMTP_PASSWORD), comme
  /// AUTH_SECRET — un secret en base ressort dans chaque sauvegarde.
  smtpHost   String  @default("")
  smtpPort   Int     @default(0)
  smtpUser   String  @default("")
  smtpFrom   String  @default("")
  smtpSecure Boolean @default(true)
}
```

Puis les quatre tables :

```prisma
/// Le journal de preuve : **jamais modifié, jamais supprimé**.
///
/// Aucune relation vers `User` : toutes les autres tables cascadent à la
/// suppression d'un compte, et un journal qui cascade s'ampute lui-même.
/// `actorId` vaut '' pour un traitement de fond.
model AuditEvent {
  /// numéro d'ordre, calculé par le service et haché avec le reste :
  /// un autoincrement ne pourrait pas entrer dans l'empreinte.
  seq         Int      @id
  occurredAt  DateTime @default(now())
  actorId     String   @default("")
  actorLabel  String   @default("SYSTEME")
  /// une valeur du catalogue, validée par le service
  action      String
  entityType  String
  entityId    String
  /// JSON lu et écrit en bloc uniquement — jamais interrogé finement
  payloadJson String   @default("{}")
  /// unique : la base interdit la fourche de chaîne, même entre processus
  prevHash    String   @unique
  hash        String   @unique

  @@index([action, seq])
  @@index([actorId, seq])
  @@index([occurredAt])
}

/// Une URL que l'utilisateur a lui-même enregistrée. L'application n'appelle
/// jamais rien d'autre.
model Webhook {
  id     String @id @default(cuid())
  userId String
  label  String
  url    String
  /// secret de signature HMAC, propre à l'abonnement
  secret String
  /// noms d'événements souscrits, séparés par des virgules. Vide = tous.
  /// Jamais un tableau : portabilité SQLite/Postgres.
  events String @default("")
  /// 'ACTIF' | 'SUSPENDU'
  state  String @default("ACTIF")
  /// dernier seq du journal déjà pris en compte pour cet abonnement
  lastSeq             Int       @default(0)
  consecutiveFailures Int       @default(0)
  lastError           String    @default("")
  suspendedAt         DateTime?
  createdAt           DateTime  @default(now())

  user       User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  deliveries WebhookDelivery[]

  @@index([userId, state])
}

/// Une tentative de poussée, tracée. Le corps n'est pas stocké : il se
/// reconstruit à l'identique depuis `AuditEvent.seq`, ce qui est précisément
/// ce qui rend un renvoi reproductible.
model WebhookDelivery {
  id        String @id @default(cuid())
  webhookId String
  seq       Int
  action    String
  /// 'PENDING' | 'SUCCES' | 'ECHEC' | 'ABANDONNE'
  state          String    @default("PENDING")
  attempts       Int       @default(0)
  nextAttemptAt  DateTime  @default(now())
  responseStatus Int       @default(0)
  durationMs     Int       @default(0)
  lastError      String    @default("")
  deliveredAt    DateTime?
  createdAt      DateTime  @default(now())

  webhook Webhook @relation(fields: [webhookId], references: [id], onDelete: Cascade)

  /// un événement n'est jamais mis en file deux fois pour le même abonnement
  @@unique([webhookId, seq])
  @@index([state, nextAttemptAt])
}

/// Les traitements récurrents. La liste est en dur dans `jobs/registry.ts` ;
/// cette table ne porte que leur état.
model ScheduledJob {
  id   String @id @default(cuid())
  name String @unique
  /// récurrence, en minutes
  intervalMinutes Int
  enabled         Boolean   @default(true)
  lastRunAt       DateTime?
  nextRunAt       DateTime  @default(now())
  /// '' | 'SUCCES' | 'ECHEC' | 'IGNORE' | 'INDISPONIBLE'
  lastState       String    @default("")
  lastError       String    @default("")
  attempts        Int       @default(0)
  /// verrou : non nul pendant l'exécution, pour qu'un second réveil
  /// n'exécute pas une seconde fois un travail encore en cours
  runningSince    DateTime?

  @@index([enabled, nextRunAt])
}
```

Puis appliquer :

```bash
npm run db:sqlite
```

- [ ] **Step 2: Écrire la migration Postgres**

`prisma/migrations/20260817000000_lot4_journal_api_ordonnanceur/migration.sql` :

```sql
-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "webhookMaxEchecs" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "notificationEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN "smtpHost" TEXT NOT NULL DEFAULT '',
ADD COLUMN "smtpPort" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "smtpUser" TEXT NOT NULL DEFAULT '',
ADD COLUMN "smtpFrom" TEXT NOT NULL DEFAULT '',
ADD COLUMN "smtpSecure" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AuditEvent" (
    "seq" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL DEFAULT '',
    "actorLabel" TEXT NOT NULL DEFAULT 'SYSTEME',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'ACTIF',
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastState" TEXT NOT NULL DEFAULT '',
    "lastError" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runningSince" TIMESTAMP(3),

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_prevHash_key" ON "AuditEvent"("prevHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_hash_key" ON "AuditEvent"("hash");

-- CreateIndex
CREATE INDEX "AuditEvent_action_seq_idx" ON "AuditEvent"("action", "seq");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_seq_idx" ON "AuditEvent"("actorId", "seq");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "Webhook_userId_state_idx" ON "Webhook"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_webhookId_seq_key" ON "WebhookDelivery"("webhookId", "seq");

-- CreateIndex
CREATE INDEX "WebhookDelivery_state_nextAttemptAt_idx" ON "WebhookDelivery"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_name_key" ON "ScheduledJob"("name");

-- CreateIndex
CREATE INDEX "ScheduledJob_enabled_nextRunAt_idx" ON "ScheduledJob"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Écrire le test qui échoue**

`src/db/audit-schema.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './client'
import { GENESIS_HASH } from '@/core/audit/chain'

let userId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'audit-schema@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({})
  await prisma.scheduledJob.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'audit-schema@test.local' } })
  await prisma.$disconnect()
})

describe('schéma du journal', () => {
  it('accepte une entrée ancrée à la genèse', async () => {
    const e = await prisma.auditEvent.create({
      data: {
        seq: 1,
        actorId: userId,
        actorLabel: 'T',
        action: 'cra.valide',
        entityType: 'Cra',
        entityId: 'cra_1',
        payloadJson: '{"month":"2026-07"}',
        prevHash: GENESIS_HASH,
        hash: 'h1',
      },
    })
    expect(e.seq).toBe(1)
    expect(e.prevHash).toBe('')
  })

  it('refuse deux entrées réclamant le même prédécesseur', async () => {
    // La fourche est interdite par la base elle-même, pas seulement par le
    // service : c'est ce qui protège entre deux processus.
    await expect(
      prisma.auditEvent.create({
        data: {
          seq: 2,
          action: 'cra.refuse',
          entityType: 'Cra',
          entityId: 'cra_2',
          prevHash: GENESIS_HASH,
          hash: 'h2',
        },
      }),
    ).rejects.toThrow()
  })

  it('refuse deux entrées de même numéro d ordre', async () => {
    await expect(
      prisma.auditEvent.create({
        data: {
          seq: 1,
          action: 'cra.refuse',
          entityType: 'Cra',
          entityId: 'cra_3',
          prevHash: 'h1',
          hash: 'h3',
        },
      }),
    ).rejects.toThrow()
  })

  it('survit à la suppression de son acteur', async () => {
    // Le journal ne cascade pas : supprimer un compte n'efface pas la preuve
    // de ce qu'il a fait.
    const ephemere = await prisma.user.create({
      data: { email: 'ephemere@test.local', name: 'E', passwordHash: 'x' },
    })
    await prisma.auditEvent.create({
      data: {
        seq: 2,
        actorId: ephemere.id,
        actorLabel: 'E',
        action: 'saisie.creee',
        entityType: 'TimeEntry',
        entityId: 't1',
        prevHash: 'h1',
        hash: 'h2',
      },
    })

    await prisma.user.delete({ where: { id: ephemere.id } })

    const relu = await prisma.auditEvent.findUniqueOrThrow({ where: { seq: 2 } })
    expect(relu.actorId).toBe(ephemere.id)
    expect(relu.actorLabel).toBe('E')
  })
})

describe('schéma des abonnements et de l ordonnanceur', () => {
  it('stocke les événements souscrits en chaîne, pas en tableau', async () => {
    const w = await prisma.webhook.create({
      data: {
        userId,
        label: 'n8n',
        url: 'https://exemple.test/hook',
        secret: 's',
        events: 'cra.valide,saisie.creee',
      },
    })
    expect(w.events).toBe('cra.valide,saisie.creee')
    expect(w.state).toBe('ACTIF')
    expect(w.lastSeq).toBe(0)
    await prisma.webhook.delete({ where: { id: w.id } })
  })

  it('ne met jamais deux fois le même événement en file pour un abonnement', async () => {
    const w = await prisma.webhook.create({
      data: { userId, label: 'l', url: 'https://exemple.test/h', secret: 's' },
    })
    await prisma.webhookDelivery.create({ data: { webhookId: w.id, seq: 1, action: 'cra.valide' } })
    await expect(
      prisma.webhookDelivery.create({ data: { webhookId: w.id, seq: 1, action: 'cra.valide' } }),
    ).rejects.toThrow()
    await prisma.webhook.delete({ where: { id: w.id } })
  })

  it('emporte ses livraisons quand l abonnement disparaît', async () => {
    const w = await prisma.webhook.create({
      data: { userId, label: 'l', url: 'https://exemple.test/h', secret: 's' },
    })
    await prisma.webhookDelivery.create({ data: { webhookId: w.id, seq: 9, action: 'cra.valide' } })
    await prisma.webhook.delete({ where: { id: w.id } })
    expect(await prisma.webhookDelivery.count({ where: { webhookId: w.id } })).toBe(0)
  })

  it('nomme les travaux de façon unique', async () => {
    await prisma.scheduledJob.create({ data: { name: 'test.travail', intervalMinutes: 5 } })
    await expect(
      prisma.scheduledJob.create({ data: { name: 'test.travail', intervalMinutes: 5 } }),
    ).rejects.toThrow()
  })

  it('porte les nouveaux réglages avec leurs défauts', async () => {
    const s = await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
    expect(s.webhookMaxEchecs).toBe(10)
    expect(s.notificationEmail).toBe('')
    expect(s.smtpPort).toBe(0)
    expect(s.smtpSecure).toBe(true)
  })
})
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run src/db/`
Expected: PASS — 10 tests neufs, **et** `schema-migration-sync.test.ts` toujours vert (c'est lui qui prouve que la migration Postgres suit le schéma).

- [ ] **Step 5: Documenter les variables d'environnement**

Ajouter à `.env.example` :

```
# Jeton d'instance pour /api/events et /api/jobs/tick.
# Distinct de la session utilisateur : il authentifie un intégrateur, pas une personne.
# Générer avec : openssl rand -hex 32
CRA_API_TOKEN="a-remplacer-par-une-valeur-aleatoire"

# Mot de passe SMTP. Le reste de la configuration SMTP se saisit dans l'écran
# de supervision ; seul le secret vit dans l'environnement, comme AUTH_SECRET.
SMTP_PASSWORD=""
```

Ajouter les deux mêmes clés au bloc `environment:` du service `app` de `docker-compose.yml` :

```yaml
      CRA_API_TOKEN: ${CRA_API_TOKEN:?definir CRA_API_TOKEN}
      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/db/audit-schema.test.ts .env.example docker-compose.yml
git commit -m "feat(db): append-only audit journal, webhook subscriptions and scheduled jobs"
```

---

## Task 4: Le service du journal — ajout seul, sérialisé, vérifiable

**Files:** Create `src/services/audit.ts`, `src/services/audit.test.ts`, `src/services/audit-append-only.test.ts`

**Interfaces:**
- Consumes: `AuditAction`, `isAuditAction` (tâche 1) ; `GENESIS_HASH`, `hashAuditEntry`, `verifyAuditChain`, `ChainVerdict` (tâche 2) ; `prisma.auditEvent` (tâche 3)
- Produces:
  - `interface Acteur { actorId: string; actorLabel: string }`
  - `const ACTEUR_SYSTEME: Acteur` — `{ actorId: '', actorLabel: 'SYSTEME' }`
  - `interface AuditAppend { action: AuditAction; entityType: string; entityId: string; actorId: string; actorLabel: string; payload: Record<string, unknown>; occurredAt?: Date }`
  - `interface AuditEntry { seq: number; occurredAt: Date; actorId: string; actorLabel: string; action: AuditAction; entityType: string; entityId: string; payload: Record<string, unknown>; prevHash: string; hash: string }`
  - `appendAudit(entree: AuditAppend): Promise<AuditEntry>`
  - `actorOf(userId: string): Promise<Acteur>`
  - `currentAuditSeq(): Promise<number>`
  - `readAuditSince(args: { since?: number; limit?: number; action?: AuditAction }): Promise<AuditEntry[]>`
  - `interface AuditFilter { action?: AuditAction; entityType?: string; du?: string; au?: string; limit?: number }`
  - `listAuditEvents(userId: string, filtre?: AuditFilter): Promise<AuditEntry[]>`
  - `verifyJournalChain(): Promise<ChainVerdict>`

**Les deux garanties de sérialisation.** Un verrou **de processus** (une file de promesses) rend la course impossible à l'intérieur d'une instance ; les contraintes d'unicité sur `seq` et `prevHash` la rendent impossible **entre** instances, et une reprise bornée l'absorbe. L'une sans l'autre laisserait un trou : le verrou seul ne protège pas de deux conteneurs, les contraintes seules feraient échouer une écriture légitime sous charge.

**Deux lectures, deux portées, volontairement.** `listAuditEvents(userId, …)` est scopée comme toute fonction de service : elle rend les entrées dont l'acteur est l'utilisateur, plus celles de `SYSTEME` — les masquer viderait l'écran de supervision du seul humain qui le consulte. `readAuditSince` n'est **pas** scopée : elle sert un jeton d'instance, pas une session, dans un produit explicitement mono-organisation. C'est une décision, pas un oubli, et son test l'affirme pour qu'on ne la « corrige » pas par mégarde.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/audit.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { GENESIS_HASH, hashAuditEntry } from '@/core/audit/chain'
import {
  ACTEUR_SYSTEME,
  actorOf,
  appendAudit,
  currentAuditSeq,
  listAuditEvents,
  readAuditSince,
  verifyJournalChain,
} from './audit'

let userId = ''
let autreId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'audit@test.local', name: 'Keveen', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'audit-autre@test.local', name: 'Autre', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: ['audit@test.local', 'audit-autre@test.local'] } } })
  await prisma.$disconnect()
})

function ajout(patch: Partial<Parameters<typeof appendAudit>[0]> = {}) {
  return appendAudit({
    action: 'cra.valide',
    entityType: 'Cra',
    entityId: 'cra_1',
    actorId: userId,
    actorLabel: 'Keveen',
    payload: { month: '2026-07' },
    ...patch,
  })
}

describe('ajout au journal', () => {
  it('ancre la première entrée à la genèse', async () => {
    const e = await ajout()
    expect(e.seq).toBe(1)
    expect(e.prevHash).toBe(GENESIS_HASH)
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('chaîne chaque entrée à la précédente', async () => {
    const a = await ajout()
    const b = await ajout({ entityId: 'cra_2' })
    expect(b.seq).toBe(2)
    expect(b.prevHash).toBe(a.hash)
  })

  it('calcule une empreinte que le module pur retrouve', async () => {
    const e = await ajout()
    expect(
      hashAuditEntry({
        seq: e.seq,
        occurredAtIso: e.occurredAt.toISOString(),
        actorId: e.actorId,
        actorLabel: e.actorLabel,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        payloadJson: JSON.stringify(e.payload),
        prevHash: e.prevHash,
      }),
    ).toBe(e.hash)
  })

  it('restitue la charge utile telle qu elle a été confiée', async () => {
    const e = await ajout({ payload: { month: '2026-07', minutes: 480, verrouille: false } })
    expect(e.payload).toEqual({ month: '2026-07', minutes: 480, verrouille: false })
  })

  it('refuse une action hors catalogue', async () => {
    // @ts-expect-error le type interdit déjà la valeur ; la garde protège
    // les appelants non typés (script de reprise, futur endpoint).
    await expect(ajout({ action: 'cra.validee' })).rejects.toThrow(/catalogue/i)
  })

  it('accepte un acte du système', async () => {
    const e = await appendAudit({
      action: 'travail.echoue',
      entityType: 'ScheduledJob',
      entityId: 'journal.verification',
      ...ACTEUR_SYSTEME,
      payload: { erreur: 'rupture' },
    })
    expect(e.actorId).toBe('')
    expect(e.actorLabel).toBe('SYSTEME')
  })

  it('garde un seq strictement croissant sous écritures concurrentes', async () => {
    // Vingt ajouts lancés ensemble : ni doublon, ni trou, ni fourche.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => ajout({ entityId: `cra_${i}` })),
    )

    const seqs = (
      await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' }, select: { seq: true } })
    ).map((r) => r.seq)

    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(await verifyJournalChain()).toEqual({ ok: true, verifiees: 20 })
  })
})

describe('acteur', () => {
  it('nomme l utilisateur', async () => {
    expect(await actorOf(userId)).toEqual({ actorId: userId, actorLabel: 'Keveen' })
  })

  it('nomme le système pour une chaîne vide', async () => {
    expect(await actorOf('')).toEqual({ actorId: '', actorLabel: 'SYSTEME' })
  })

  it('retombe sur l identifiant quand le compte a disparu', async () => {
    // Le journal survit à la suppression d'un compte : son acteur doit
    // rester nommable, même approximativement.
    expect(await actorOf('usr_inconnu')).toEqual({
      actorId: 'usr_inconnu',
      actorLabel: 'usr_inconnu',
    })
  })
})

describe('rattrapage par since', () => {
  beforeEach(async () => {
    await ajout({ action: 'saisie.creee', entityType: 'TimeEntry', entityId: 't1' })
    await ajout({ action: 'cra.valide', entityId: 'cra_1' })
    await ajout({ action: 'saisie.creee', entityType: 'TimeEntry', entityId: 't2' })
  })

  it('rend tout depuis l origine', async () => {
    const tout = await readAuditSince({ since: 0 })
    expect(tout.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('reprend strictement après le seq fourni', async () => {
    expect((await readAuditSince({ since: 2 })).map((e) => e.seq)).toEqual([3])
    expect(await readAuditSince({ since: 3 })).toEqual([])
  })

  it('ne perd ni ne répète aucun événement quand un consommateur boucle', async () => {
    // La promesse centrale du modèle : un consommateur mémorise son dernier
    // seq et reprend où il s'était arrêté.
    const vus: number[] = []
    let curseur = 0
    for (;;) {
      const lot = await readAuditSince({ since: curseur, limit: 2 })
      if (lot.length === 0) break
      vus.push(...lot.map((e) => e.seq))
      curseur = lot[lot.length - 1]!.seq
    }
    expect(vus).toEqual([1, 2, 3])
    expect(new Set(vus).size).toBe(vus.length)
  })

  it('filtre par événement sans casser la reprise', async () => {
    const saisies = await readAuditSince({ since: 0, action: 'saisie.creee' })
    expect(saisies.map((e) => e.seq)).toEqual([1, 3])
    expect(await readAuditSince({ since: 1, action: 'saisie.creee' })).toHaveLength(1)
  })

  it('borne le lot rendu', async () => {
    expect(await readAuditSince({ since: 0, limit: 2 })).toHaveLength(2)
  })

  it('n est volontairement PAS scopée par utilisateur', async () => {
    // Elle sert un jeton d'instance, pas une session, dans un produit
    // mono-organisation. Ce test existe pour qu'on ne « corrige » pas cette
    // décision par mégarde.
    await ajout({ actorId: autreId, actorLabel: 'Autre', entityId: 'cra_autre' })
    expect((await readAuditSince({ since: 0 })).some((e) => e.actorId === autreId)).toBe(true)
  })
})

describe('lecture de supervision', () => {
  beforeEach(async () => {
    await ajout({ action: 'saisie.creee', entityType: 'TimeEntry', entityId: 't1' })
    await ajout({ actorId: autreId, actorLabel: 'Autre', entityId: 'cra_autre' })
    await appendAudit({
      action: 'travail.echoue',
      entityType: 'ScheduledJob',
      entityId: 'journal.verification',
      ...ACTEUR_SYSTEME,
      payload: {},
    })
  })

  it('isole par utilisateur, système inclus', async () => {
    const vues = await listAuditEvents(userId)
    const acteurs = new Set(vues.map((e) => e.actorId))
    expect(acteurs).toEqual(new Set([userId, '']))
  })

  it('rend les plus récentes d abord', async () => {
    const vues = await listAuditEvents(userId)
    expect(vues[0]!.seq).toBeGreaterThan(vues[vues.length - 1]!.seq)
  })

  it('filtre par action, par entité et par période', async () => {
    expect(await listAuditEvents(userId, { action: 'saisie.creee' })).toHaveLength(1)
    expect(await listAuditEvents(userId, { entityType: 'ScheduledJob' })).toHaveLength(1)
    expect(await listAuditEvents(userId, { du: '2099-01-01' })).toHaveLength(0)
  })
})

describe('vérification de la chaîne en base', () => {
  it('valide un journal intact', async () => {
    await ajout()
    await ajout({ entityId: 'cra_2' })
    expect(await verifyJournalChain()).toEqual({ ok: true, verifiees: 2 })
  })

  it('valide un journal vide', async () => {
    expect(await verifyJournalChain()).toEqual({ ok: true, verifiees: 0 })
  })

  it('DÉTECTE UNE MODIFICATION DIRECTE EN BASE, À LA BONNE ENTRÉE', async () => {
    // C'est le test qui fait de ce journal une preuve plutôt qu'un
    // historique. On contourne délibérément le service — c'est exactement ce
    // que ferait quelqu'un qui voudrait réécrire l'histoire.
    for (let i = 1; i <= 5; i++) await ajout({ entityId: `cra_${i}` })

    await prisma.auditEvent.update({
      where: { seq: 3 },
      data: { payloadJson: '{"month":"2026-01"}' },
    })

    expect(await verifyJournalChain()).toEqual({
      ok: false,
      verifiees: 2,
      seq: 3,
      raison: 'EMPREINTE',
    })
  })

  it('détecte une entrée supprimée en base', async () => {
    for (let i = 1; i <= 5; i++) await ajout({ entityId: `cra_${i}` })
    await prisma.auditEvent.delete({ where: { seq: 3 } })

    expect(await verifyJournalChain()).toMatchObject({ ok: false, seq: 4, raison: 'CHAINAGE' })
  })
})

describe('numéro d ordre courant', () => {
  it('vaut zéro sur un journal vide', async () => {
    expect(await currentAuditSeq()).toBe(0)
  })

  it('suit la dernière entrée', async () => {
    await ajout()
    await ajout({ entityId: 'cra_2' })
    expect(await currentAuditSeq()).toBe(2)
  })
})
```

`src/services/audit-append-only.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Le journal est en ajout seul : aucune fonction publique ne le modifie ni
// ne l'ampute. Ce test balaie TOUT le code applicatif, pas seulement
// `audit.ts` — la règle ne vaut que si personne d'autre ne peut la
// contourner depuis un autre service ou un server action.
//
// Les fichiers de test sont exclus : `audit.test.ts` doit précisément
// pouvoir falsifier une entrée en base pour prouver que la chaîne le voit.

const SRC = path.resolve(__dirname, '..')
const INTERDITS = [
  'auditEvent.update',
  'auditEvent.updateMany',
  'auditEvent.delete',
  'auditEvent.deleteMany',
  'auditEvent.upsert',
]

function fichiersApplicatifs(racine: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(racine, { withFileTypes: true })) {
    const complet = path.join(racine, entree.name)
    if (entree.isDirectory()) {
      out.push(...fichiersApplicatifs(complet))
      continue
    }
    if (!/\.tsx?$/.test(entree.name)) continue
    if (/\.test\.tsx?$/.test(entree.name)) continue
    out.push(complet)
  }
  return out
}

describe('le journal est inviolable en écriture', () => {
  it('aucun fichier applicatif ne modifie ni ne supprime une entrée', () => {
    const coupables: string[] = []
    for (const fichier of fichiersApplicatifs(SRC)) {
      const source = readFileSync(fichier, 'utf8')
      for (const interdit of INTERDITS) {
        if (source.includes(interdit)) {
          coupables.push(`${path.relative(SRC, fichier)} → ${interdit}`)
        }
      }
    }

    expect(
      coupables,
      [
        "Le journal de preuve est en ajout seul : ces appels le rendraient réécrivable.",
        coupables.join('\n'),
      ].join('\n'),
    ).toEqual([])
  })

  it('le service du journal n exporte aucune fonction de modification', async () => {
    const module = await import('./audit')
    for (const nom of Object.keys(module)) {
      expect(nom, `export « ${nom} »`).not.toMatch(/^(update|delete|remove|purge|edit)/i)
    }
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/audit.test.ts src/services/audit-append-only.test.ts`
Expected: FAIL — `Failed to resolve import "./audit"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/audit.ts` :

```ts
import { prisma } from '@/db/client'
import { isAuditAction, type AuditAction } from '@/core/audit/events'
import {
  GENESIS_HASH,
  hashAuditEntry,
  verifyAuditChain,
  type AuditEntryContent,
  type ChainVerdict,
} from '@/core/audit/chain'

export interface Acteur {
  /** '' désigne un traitement de fond */
  actorId: string
  actorLabel: string
}

export const ACTEUR_SYSTEME: Acteur = { actorId: '', actorLabel: 'SYSTEME' }

export interface AuditAppend extends Acteur {
  action: AuditAction
  entityType: string
  entityId: string
  /** résumé de ce qui a changé ; sérialisé en bloc, jamais interrogé finement */
  payload: Record<string, unknown>
  occurredAt?: Date
}

export interface AuditEntry extends Acteur {
  seq: number
  occurredAt: Date
  action: AuditAction
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  prevHash: string
  hash: string
}

type Row = Awaited<ReturnType<typeof prisma.auditEvent.findFirstOrThrow>>

function toEntry(row: Row): AuditEntry {
  return {
    seq: row.seq,
    occurredAt: row.occurredAt,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    action: row.action as AuditAction,
    entityType: row.entityType,
    entityId: row.entityId,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    prevHash: row.prevHash,
    hash: row.hash,
  }
}

/**
 * File d'attente **de processus**. Deux ajouts simultanés liraient la même
 * tête de chaîne et calculeraient le même `prevHash` : l'un des deux serait
 * rejeté par la contrainte d'unicité et devrait reprendre. La file évite ce
 * gâchis à l'intérieur d'une instance ; les contraintes d'unicité restent la
 * garantie entre instances, et `MAX_REPRISES` absorbe leur collision.
 */
let file: Promise<unknown> = Promise.resolve()

function enFile<T>(travail: () => Promise<T>): Promise<T> {
  const execution = file.then(travail, travail)
  file = execution.then(
    () => undefined,
    () => undefined,
  )
  return execution
}

const MAX_REPRISES = 5

function estConflitUnicite(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

/**
 * Ajoute une entrée au journal. **Aucune autre écriture n'existe** : le
 * module n'expose ni modification, ni suppression, et
 * `audit-append-only.test.ts` vérifie qu'aucun autre fichier n'en introduit.
 */
export async function appendAudit(entree: AuditAppend): Promise<AuditEntry> {
  if (!isAuditAction(entree.action)) {
    throw new Error(`L'événement « ${entree.action} » n'existe pas au catalogue.`)
  }

  const payloadJson = JSON.stringify(entree.payload)
  const occurredAt = entree.occurredAt ?? new Date()
  const occurredAtIso = occurredAt.toISOString()

  return enFile(async () => {
    for (let tentative = 1; tentative <= MAX_REPRISES; tentative++) {
      const tete = await prisma.auditEvent.findFirst({
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      })

      const contenu: AuditEntryContent = {
        seq: (tete?.seq ?? 0) + 1,
        occurredAtIso,
        actorId: entree.actorId,
        actorLabel: entree.actorLabel,
        action: entree.action,
        entityType: entree.entityType,
        entityId: entree.entityId,
        payloadJson,
        prevHash: tete?.hash ?? GENESIS_HASH,
      }

      try {
        const row = await prisma.auditEvent.create({
          data: {
            seq: contenu.seq,
            occurredAt,
            actorId: contenu.actorId,
            actorLabel: contenu.actorLabel,
            action: contenu.action,
            entityType: contenu.entityType,
            entityId: contenu.entityId,
            payloadJson: contenu.payloadJson,
            prevHash: contenu.prevHash,
            hash: hashAuditEntry(contenu),
          },
        })
        return toEntry(row)
      } catch (err) {
        // Une autre instance a écrit entre la lecture de la tête et
        // l'insertion : on relit la tête et on recommence.
        if (!estConflitUnicite(err) || tentative === MAX_REPRISES) throw err
      }
    }

    throw new Error(
      `Journal : impossible d'ajouter une entrée après ${MAX_REPRISES} reprises.`,
    )
  })
}

/**
 * Nomme un acteur pour le journal. Le libellé est figé à l'écriture : le
 * journal doit rester lisible même après la disparition du compte, et
 * l'identifiant sert alors de dernier recours.
 */
export async function actorOf(userId: string): Promise<Acteur> {
  if (userId === '') return { ...ACTEUR_SYSTEME }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  })
  return { actorId: userId, actorLabel: user?.name ?? userId }
}

export async function currentAuditSeq(): Promise<number> {
  const tete = await prisma.auditEvent.findFirst({
    orderBy: { seq: 'desc' },
    select: { seq: true },
  })
  return tete?.seq ?? 0
}

const LIMITE_DEFAUT = 100

/**
 * Le rattrapage : les entrées **strictement postérieures** à `since`, dans
 * l'ordre. Un consommateur mémorise le dernier `seq` traité et reprend là où
 * il s'était arrêté — aucun événement ne se perd, même après une panne de
 * plusieurs jours.
 *
 * **Volontairement non scopée par utilisateur** : elle sert un jeton
 * d'instance, pas une session, dans un produit mono-organisation.
 * `listAuditEvents` est la lecture scopée.
 */
export async function readAuditSince(args: {
  since?: number
  limit?: number
  action?: AuditAction
}): Promise<AuditEntry[]> {
  const rows = await prisma.auditEvent.findMany({
    where: {
      seq: { gt: args.since ?? 0 },
      ...(args.action !== undefined && { action: args.action }),
    },
    orderBy: { seq: 'asc' },
    take: args.limit ?? LIMITE_DEFAUT,
  })
  return rows.map(toEntry)
}

export interface AuditFilter {
  action?: AuditAction
  entityType?: string
  /** borne basse incluse, 'YYYY-MM-DD' */
  du?: string
  /** borne haute incluse, 'YYYY-MM-DD' */
  au?: string
  limit?: number
}

/**
 * L'historique de l'écran de supervision, scopé comme toute lecture de
 * service : les actes de l'utilisateur, plus ceux de `SYSTEME`. Masquer ces
 * derniers viderait l'écran de son contenu le plus utile — ce sont eux qui
 * disent ce que les traitements de fond ont fait.
 */
export async function listAuditEvents(
  userId: string,
  filtre: AuditFilter = {},
): Promise<AuditEntry[]> {
  const rows = await prisma.auditEvent.findMany({
    where: {
      actorId: { in: [userId, ''] },
      ...(filtre.action !== undefined && { action: filtre.action }),
      ...(filtre.entityType !== undefined && { entityType: filtre.entityType }),
      ...((filtre.du !== undefined || filtre.au !== undefined) && {
        occurredAt: {
          ...(filtre.du !== undefined && { gte: new Date(`${filtre.du}T00:00:00.000Z`) }),
          ...(filtre.au !== undefined && { lt: jourSuivant(filtre.au) }),
        },
      }),
    },
    orderBy: { seq: 'desc' },
    take: filtre.limit ?? LIMITE_DEFAUT,
  })
  return rows.map(toEntry)
}

/** Borne haute **incluse** : l'utilisateur qui filtre « au 31 » attend le 31. */
function jourSuivant(isoDate: string): Date {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

/**
 * Recalcule la chaîne complète et signale la première rupture.
 *
 * Relit tout le journal : à quelques milliers d'entrées par an, le coût est
 * négligeable devant ce qu'on prouve. Le jour où il cesserait de l'être,
 * `verifyAuditChain` accepte déjà un ancrage pour vérifier par fenêtres.
 */
export async function verifyJournalChain(): Promise<ChainVerdict> {
  const rows = await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } })

  return verifyAuditChain(
    rows.map((r) => ({
      seq: r.seq,
      occurredAtIso: r.occurredAt.toISOString(),
      actorId: r.actorId,
      actorLabel: r.actorLabel,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      payloadJson: r.payloadJson,
      prevHash: r.prevHash,
      hash: r.hash,
    })),
  )
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/audit.test.ts src/services/audit-append-only.test.ts`
Expected: PASS — 22 tests

- [ ] **Step 5: Vérifier par mutation**

Trois mutations, chacune doit faire échouer un test précis. Restaurer après chacune.

1. Dans `appendAudit`, remplacer `prevHash: tete?.hash ?? GENESIS_HASH` par `prevHash: GENESIS_HASH` → « chaîne chaque entrée à la précédente » **et** le test d'unicité en base doivent échouer.
2. Retirer l'appel à `enFile` (exécuter `travail()` directement) → « garde un seq strictement croissant sous écritures concurrentes » doit échouer, ou passer par la reprise ; s'il passe encore, augmenter à 50 ajouts concurrents et confirmer.
3. Dans `verifyJournalChain`, remplacer `r.payloadJson` par `'{}'` → « DÉTECTE UNE MODIFICATION DIRECTE EN BASE » doit échouer.

- [ ] **Step 6: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add src/services/audit.ts src/services/audit.test.ts src/services/audit-append-only.test.ts
git commit -m "feat(audit): serialized append-only journal with chain verification"
```

---

## Task 5: Consignation des saisies

**Files:** Modify `src/services/time-entries.ts`, `src/services/time-entries.test.ts`

**Interfaces:**
- Consumes: `appendAudit`, `actorOf` (tâche 4) ; `computeEngagement`, `getLineEngagementTotals` (existants)
- Produces: aucune signature publique ne change. `saveEntry` et `convertPastForecast` consignent désormais.

**Ce qui est consigné ici**, et rien d'autre : `saisie.creee`, `saisie.modifiee`, `saisie.supprimee`, `previsionnel.converti`, `capacite.depassee`, `engagement.depasse`. **Les lectures ne le sont pas** — `getMonthEntries`, `listPastForecast` et `getPastForecastWithLockStatus` restent muettes. Un journal qui enregistre les consultations se noie et cesse d'être lisible.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/services/time-entries.test.ts` :

```ts
import { listAuditEvents, readAuditSince } from './audit'
import { prisma } from '@/db/client'

describe('consignation des saisies', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne une création', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-09-01', minutes: 480, kind: 'REALISE' })

    const journal = await readAuditSince({ since: 0 })
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      action: 'saisie.creee',
      entityType: 'TimeEntry',
      actorId: userId,
    })
    expect(journal[0]!.payload).toMatchObject({
      lineId: lineA,
      date: '2026-09-01',
      minutes: 480,
      kind: 'REALISE',
      slotId: '',
    })
  })

  it('distingue une modification d une création', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-09-02', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-09-02', minutes: 240, kind: 'REALISE' })

    const journal = await readAuditSince({ since: 0 })
    expect(journal.map((e) => e.action)).toEqual(['saisie.creee', 'saisie.modifiee'])
    expect(journal[1]!.payload).toMatchObject({ minutes: 240, minutesAvant: 480 })
  })

  it('consigne une suppression avec ce qui disparaît', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-09-03', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-09-03', minutes: 0, kind: 'REALISE' })

    const journal = await readAuditSince({ since: 0 })
    expect(journal.map((e) => e.action)).toEqual(['saisie.creee', 'saisie.supprimee'])
    expect(journal[1]!.payload).toMatchObject({ minutes: 480, date: '2026-09-03' })
  })

  it('ne consigne rien quand on supprime ce qui n existe pas', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-09-04', minutes: 0, kind: 'REALISE' })
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('ne consigne rien quand la saisie est refusée faute d affectation', async () => {
    const r = await saveEntry({
      userId: autreUserId, lineId: lineA, date: '2026-09-05', minutes: 480, kind: 'REALISE',
    })
    expect(r).toEqual({ ok: false, reason: 'NON_AFFECTE' })
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('ne consigne rien quand le mois est verrouillé', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-09-01T00:00:00Z'), status: 'VALIDE' },
    })
    const r = await saveEntry({ userId, lineId: lineA, date: '2026-09-06', minutes: 480, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)

    await prisma.cra.deleteMany({ where: { userId } })
  })

  it('consigne un dépassement de capacité, blocage compris', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100, minutesParJour: 480 })
    const r = await saveEntry({ userId, lineId: lineA, date: '2026-09-07', minutes: 600, kind: 'REALISE' })
    expect(r).toMatchObject({ ok: false, reason: 'CAPACITE' })

    const journal = await readAuditSince({ since: 0 })
    expect(journal.map((e) => e.action)).toEqual(['capacite.depassee'])
    expect(journal[0]!.payload).toMatchObject({ date: '2026-09-07', bloque: true })

    await updateSettings({ capacityMode: 'DESACTIVE' })
  })

  it('consigne un dépassement d engagement une seule fois', async () => {
    // La ligne est vendue 100 centièmes ; la deuxième journée la dépasse.
    await updateSettings({ capacityMode: 'DESACTIVE', minutesParJour: 480 })
    await saveEntry({ userId, lineId: lineCourte, date: '2026-09-10', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineCourte, date: '2026-09-11', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineCourte, date: '2026-09-14', minutes: 480, kind: 'REALISE' })

    const depassements = (await readAuditSince({ since: 0 })).filter(
      (e) => e.action === 'engagement.depasse',
    )
    // Franchi une fois, il ne se re-signale pas à chaque journée suivante :
    // un rappel qu'on apprend à ignorer est pire qu'une absence de rappel.
    expect(depassements).toHaveLength(1)
    expect(depassements[0]!.payload).toMatchObject({ lineId: lineCourte })
  })

  it('consigne la conversion du prévisionnel échu', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-09-20', minutes: 480, kind: 'PREVISIONNEL' })
    await prisma.auditEvent.deleteMany({})

    const r = await convertPastForecast(userId, '2026-09', '2026-09-25')
    expect(r.converted).toBe(1)

    const journal = await readAuditSince({ since: 0 })
    expect(journal.map((e) => e.action)).toEqual(['previsionnel.converti'])
    expect(journal[0]).toMatchObject({ entityType: 'Mois', entityId: '2026-09' })
    expect(journal[0]!.payload).toMatchObject({ converted: 1, skippedLocked: 0 })
  })

  it('ne consigne rien quand la conversion ne convertit rien', async () => {
    expect(await convertPastForecast(userId, '2026-10', '2026-10-25')).toEqual({
      converted: 0, skippedLocked: 0,
    })
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('ne consigne AUCUNE lecture', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-09-28', minutes: 480, kind: 'PREVISIONNEL' })
    const avant = await readAuditSince({ since: 0 })

    await getMonthEntries(userId, '2026-09')
    await listPastForecast(userId, '2026-09', '2026-09-30')
    await getPastForecastWithLockStatus(userId, '2026-09', '2026-09-30')

    expect(await readAuditSince({ since: 0 })).toHaveLength(avant.length)
  })

  it('rend les entrées consignées visibles dans la lecture scopée', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-09-29', minutes: 480, kind: 'REALISE' })
    expect(await listAuditEvents(userId, { action: 'saisie.creee' })).toHaveLength(1)
    expect(await listAuditEvents(autreUserId, { action: 'saisie.creee' })).toHaveLength(0)
  })
})
```

**Prérequis du fichier de test.** Ce bloc suppose trois valeurs déjà présentes ou à ajouter au `beforeAll` existant : `autreUserId` (un second utilisateur, sans affectation sur `lineA`), `missionId` (la mission de `lineA`), et `lineCourte` — une prestation vendue **100 centièmes** créée par `createLine({ missionId, userId, label: 'Courte', soldCentiemes: 100, tjmCents: 0 })`. Les ajouter s'ils manquent, et les nettoyer dans le `afterAll`.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/time-entries.test.ts`
Expected: FAIL — le journal reste vide : `expected [] to have a length of 1`

- [ ] **Step 3: Écrire l'implémentation**

Dans `src/services/time-entries.ts`, ajouter les imports :

```ts
import { computeEngagement } from '@/core/engagement/compute'
import { appendAudit, actorOf } from './audit'
```

Ajouter, avant `saveEntry` :

```ts
/**
 * Dépassement d'engagement d'une ligne, en centièmes, **toutes périodes
 * confondues** — la mesure sur laquelle porte l'alerte.
 */
async function depassementDeLaLigne(
  userId: string,
  lineId: string,
  venduCentiemes: number,
): Promise<number> {
  const totaux = await getLineEngagementTotals(userId, [lineId])
  return computeEngagement({ venduCentiemes, entries: totaux[lineId] ?? [] })
    .depassementCentiemes
}
```

Dans `saveEntry`, étendre le `select` de l'affectation pour disposer du vendu :

```ts
  const assignment = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { soldCentiemes: true, line: { select: { missionId: true } } },
  })
```

Juste après le contrôle de verrou, lire l'état antérieur de la cellule — c'est lui qui distingue une création d'une modification, et qui dit ce qui disparaît :

```ts
  // Lu avant toute écriture : c'est le seul moment où l'on sait encore ce
  // que la saisie remplace.
  const existante = await prisma.timeEntry.findUnique({
    where: {
      lineId_userId_date_slotId: { lineId: args.lineId, userId: args.userId, date, slotId },
    },
    select: { minutes: true, kind: true },
  })

  const acteur = await actorOf(args.userId)
```

Dans la branche `args.minutes === 0` :

```ts
  if (args.minutes === 0) {
    if (existante === null) return { ok: true, minutes: 0 }

    await prisma.timeEntry.deleteMany({
      where: { userId: args.userId, lineId: args.lineId, date, slotId },
    })

    await appendAudit({
      ...acteur,
      action: 'saisie.supprimee',
      entityType: 'TimeEntry',
      entityId: `${args.lineId}:${args.date}:${slotId}`,
      payload: {
        lineId: args.lineId,
        date: args.date,
        slotId,
        minutes: existante.minutes,
        kind: existante.kind,
      },
    })

    return { ok: true, minutes: 0 }
  }
```

Après le calcul de `verdict`, et **avant** le retour en cas de blocage :

```ts
  if (!verdict.ok) {
    // Le dépassement est un fait du jour, qu'il ait bloqué ou seulement
    // averti : les deux méritent d'être consignés.
    await appendAudit({
      ...acteur,
      action: 'capacite.depassee',
      entityType: 'Jour',
      entityId: args.date,
      payload: {
        date: args.date,
        totalMinutes: verdict.totalMinutes,
        capacityMinutes: verdict.capacityMinutes,
        mode: settings.capacityMode,
        bloque: verdict.severity === 'block',
      },
    })
  }
```

Autour de l'`upsert`, mesurer le dépassement avant et après :

```ts
  const depassementAvant = await depassementDeLaLigne(
    args.userId, args.lineId, assignment.soldCentiemes,
  )

  await prisma.timeEntry.upsert({ /* … inchangé … */ })

  await appendAudit({
    ...acteur,
    action: existante === null ? 'saisie.creee' : 'saisie.modifiee',
    entityType: 'TimeEntry',
    entityId: `${args.lineId}:${args.date}:${slotId}`,
    payload: {
      lineId: args.lineId,
      date: args.date,
      slotId,
      minutes: args.minutes,
      kind: args.kind,
      minutesParJour,
      ...(existante !== null && { minutesAvant: existante.minutes, kindAvant: existante.kind }),
    },
  })

  const depassementApres = await depassementDeLaLigne(
    args.userId, args.lineId, assignment.soldCentiemes,
  )

  // Signalé au **franchissement** seulement. Le re-signaler à chaque journée
  // suivante apprendrait à l'ignorer, et un rappel qu'on ignore est pire
  // qu'une absence de rappel.
  if (depassementAvant === 0 && depassementApres > 0) {
    await appendAudit({
      ...acteur,
      action: 'engagement.depasse',
      entityType: 'MissionLine',
      entityId: args.lineId,
      payload: {
        lineId: args.lineId,
        venduCentiemes: assignment.soldCentiemes,
        depassementCentiemes: depassementApres,
      },
    })
  }
```

Dans `convertPastForecast`, après l'`updateMany` :

```ts
  if (convertibles.length > 0) {
    await prisma.timeEntry.updateMany({ /* … inchangé … */ })

    await appendAudit({
      ...(await actorOf(userId)),
      action: 'previsionnel.converti',
      entityType: 'Mois',
      entityId: month,
      payload: {
        month,
        converted: convertibles.length,
        skippedLocked: lockedCount,
        lineIds: [...new Set(convertibles.map((e) => e.lineId))],
      },
    })
  }
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/time-entries.test.ts`
Expected: PASS — les 12 tests nouveaux plus tous les existants

- [ ] **Step 5: Vérifier par mutation**

Remplacer `existante === null ? 'saisie.creee' : 'saisie.modifiee'` par `'saisie.creee'` → « distingue une modification d une création » doit échouer. Remplacer la garde `depassementAvant === 0 &&` par `true &&` → « consigne un dépassement d engagement une seule fois » doit échouer. Restaurer.

- [ ] **Step 6: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add src/services/time-entries.ts src/services/time-entries.test.ts
git commit -m "feat(audit): record time-entry writes, capacity and engagement breaches"
```

---

## Task 6: Consignation du CRA, du référentiel et de l'exploitation

**Files:** Modify `src/services/cra.ts`, `src/services/cra.test.ts`, `src/services/clients.ts`, `src/services/missions.ts`, `src/services/missions.test.ts`, `src/services/settings.ts`, `src/services/settings.test.ts`, `src/services/rates.ts`, `src/services/rates.test.ts`, `src/app/(app)/missions/actions.ts`, `src/app/(app)/admin/saisie/actions.ts`, `src/app/(app)/cra/actions.ts`

**Interfaces:**
- Consumes: `appendAudit`, `actorOf` (tâche 4)
- Produces (élargissements rétrocompatibles) :
  - `createClient(name: string, minutesParJour?: number | null, userId?: string): Promise<{ id; name }>`
  - `createMission(args: { clientId; label; minutesParJour?; userId? }): Promise<{ id }>`
  - `updateSettings(patch: Partial<AppSettings>, userId?: string): Promise<AppSettings>`
  - `getOrCreateCra` et `transitionCra` : signatures **inchangées**, consignation ajoutée

**Le `userId` optionnel, et pourquoi il l'est.** `createClient`, `createMission` et `updateSettings` ne portaient pas d'utilisateur : ce sont des écritures d'instance. Le journal, lui, a besoin d'un acteur. Plutôt que d'imposer un argument à des dizaines d'appels de test existants, on ajoute un paramètre optionnel en **dernière position** ; absent, l'acte est attribué à `SYSTEME`. Les server actions, elles, le passent toujours — c'est là que se trouve l'utilisateur réel, et un acte humain attribué au système serait une preuve fausse.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `src/services/cra.test.ts` :

```ts
import { readAuditSince } from './audit'
import { prisma } from '@/db/client'

describe('consignation du CRA', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne l ouverture, une seule fois', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-11')
    await getOrCreateCra(userId, missionId, '2026-11')

    const journal = await readAuditSince({ since: 0 })
    expect(journal.map((e) => e.action)).toEqual(['cra.ouvert'])
    expect(journal[0]).toMatchObject({ entityType: 'Cra', entityId: cra.id, actorId: userId })
    expect(journal[0]!.payload).toMatchObject({ missionId, month: '2026-11' })
  })

  it('consigne chaque transition sous son propre nom', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-12')
    await prisma.auditEvent.deleteMany({})

    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')
    await transitionCra(userId, cra.id, 'ROUVRIR')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'REFUSER')

    expect((await readAuditSince({ since: 0 })).map((e) => e.action)).toEqual([
      'cra.envoye', 'cra.valide', 'cra.rouvert', 'cra.envoye', 'cra.refuse',
    ])
  })

  it('consigne le statut d avant et d après', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2027-01')
    await prisma.auditEvent.deleteMany({})
    await transitionCra(userId, cra.id, 'ENVOYER')

    expect((await readAuditSince({ since: 0 }))[0]!.payload).toMatchObject({
      statutAvant: 'BROUILLON',
      statutApres: 'ENVOYE',
      month: '2027-01',
    })
  })

  it('ne consigne rien quand la transition est impossible', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2027-02')
    await prisma.auditEvent.deleteMany({})

    await expect(transitionCra(userId, cra.id, 'VALIDER')).rejects.toThrow()
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('ne consigne aucune consultation', async () => {
    await getOrCreateCra(userId, missionId, '2027-03')
    await prisma.auditEvent.deleteMany({})

    await listCras(userId, '2027-03')

    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })
})
```

Ajouter à `src/services/missions.test.ts` :

```ts
import { readAuditSince } from './audit'

describe('consignation du référentiel', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne la création d un client', async () => {
    const c = await createClient('JOURNAL client', null, userId)
    const journal = await readAuditSince({ since: 0 })
    expect(journal[0]).toMatchObject({
      action: 'client.cree', entityType: 'Client', entityId: c.id, actorId: userId,
    })
    expect(journal[0]!.payload).toMatchObject({ name: 'JOURNAL client' })
  })

  it('consigne la création d une mission et d une prestation', async () => {
    const c = await createClient('JOURNAL cascade', null, userId)
    const m = await createMission({ clientId: c.id, label: 'M', userId })
    const l = await createLine({
      missionId: m.id, userId, label: 'L', soldCentiemes: 3000, tjmCents: 80000,
    })

    expect((await readAuditSince({ since: 0 })).map((e) => e.action)).toEqual([
      'client.cree', 'mission.creee', 'prestation.creee',
    ])
    const journal = await readAuditSince({ since: 0 })
    expect(journal[2]).toMatchObject({ entityType: 'MissionLine', entityId: l.id })
    expect(journal[2]!.payload).toMatchObject({ missionId: m.id, soldCentiemes: 3000 })
  })

  it('attribue au système un acte sans utilisateur', async () => {
    await createClient('JOURNAL systeme')
    expect((await readAuditSince({ since: 0 }))[0]).toMatchObject({
      actorId: '', actorLabel: 'SYSTEME',
    })
  })

  it('ne consigne aucune consultation du référentiel', async () => {
    await listMissionsForUser(userId)
    await listActiveLines(userId)
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })
})
```

Ajouter à `src/services/settings.test.ts` :

```ts
import { readAuditSince } from './audit'
import { prisma } from '@/db/client'

describe('consignation des réglages', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne les clés modifiées et leurs valeurs', async () => {
    await updateSettings({ minutesParJour: 432, capacityMode: 'BLOCAGE' })

    const journal = await readAuditSince({ since: 0 })
    expect(journal[0]).toMatchObject({ action: 'reglage.modifie', entityType: 'Settings', entityId: 'singleton' })
    expect(journal[0]!.payload).toMatchObject({
      cles: ['minutesParJour', 'capacityMode'],
      minutesParJour: 432,
      capacityMode: 'BLOCAGE',
    })
  })

  it('résume les listes plutôt que de les recopier', async () => {
    // Recopier 60 jours fériés à chaque enregistrement noierait le journal.
    await updateSettings({ holidays: ['2026-01-01', '2026-05-01'], workingDays: [1, 2, 3, 4, 5] })

    expect((await readAuditSince({ since: 0 }))[0]!.payload).toMatchObject({
      holidays: '2 valeur(s)',
      workingDays: '5 valeur(s)',
    })
  })

  it('ne consigne rien quand la validation refuse le patch', async () => {
    await expect(updateSettings({ minutesParJour: 0 })).rejects.toThrow()
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('ne consigne aucune lecture de réglage', async () => {
    await getSettings()
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })
})
```

Ajouter à `src/services/rates.test.ts` :

```ts
import { readAuditSince } from './audit'

describe('consignation du réétalonnage', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne un réétalonnage effectif', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-11', minutes: 480, kind: 'REALISE' })
    await prisma.auditEvent.deleteMany({})
    await updateSettings({ minutesParJour: 420 })
    await prisma.auditEvent.deleteMany({})

    await recalibrateOpenMonths(userId)

    const journal = await readAuditSince({ since: 0 })
    expect(journal[0]).toMatchObject({
      action: 'reetalonnage.effectue', entityType: 'Settings', entityId: 'singleton', actorId: userId,
    })
    expect(journal[0]!.payload).toMatchObject({ recalibrees: 1, sauteesVerrouillees: 0 })
  })

  it('ne consigne rien quand rien n a bougé', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-12', minutes: 480, kind: 'REALISE' })
    await prisma.auditEvent.deleteMany({})

    expect(await recalibrateOpenMonths(userId)).toEqual({ recalibrees: 0, sauteesVerrouillees: 0 })
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('ne consigne pas la prévisualisation', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-13', minutes: 480, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 420 })
    await prisma.auditEvent.deleteMany({})

    await previewRecalibration(userId)
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/cra.test.ts src/services/missions.test.ts src/services/settings.test.ts src/services/rates.test.ts`
Expected: FAIL — journal vide partout, et `createClient` n'accepte pas de troisième argument

- [ ] **Step 3: Consigner le CRA**

Dans `src/services/cra.ts`, remplacer l'`upsert` de `getOrCreateCra` par une lecture puis une création — un `upsert` ne dit pas s'il a créé, et consigner une ouverture à chaque affichage de la page noierait le journal :

```ts
import { appendAudit, actorOf } from './audit'
import type { AuditAction } from '@/core/audit/events'

const ACTION_PAR_TRANSITION: Record<CraTransition, AuditAction> = {
  ENVOYER: 'cra.envoye',
  VALIDER: 'cra.valide',
  REFUSER: 'cra.refuse',
  ROUVRIR: 'cra.rouvert',
}

export async function getOrCreateCra(
  userId: string,
  missionId: string,
  month: string,
): Promise<CraView> {
  const cle = { missionId_userId_month: { missionId, userId, month: monthStart(month) } }

  const existant = await prisma.cra.findUnique({ where: cle, include: WITH_MISSION })
  if (existant !== null) return toView(existant)

  try {
    const row = await prisma.cra.create({
      data: { missionId, userId, month: monthStart(month) },
      include: WITH_MISSION,
    })

    await appendAudit({
      ...(await actorOf(userId)),
      action: 'cra.ouvert',
      entityType: 'Cra',
      entityId: row.id,
      payload: { missionId, month, status: row.status },
    })

    return toView(row)
  } catch {
    // Course avec un autre rendu de la même page : le CRA existe désormais,
    // et il n'a été « ouvert » qu'une fois.
    const relu = await prisma.cra.findUniqueOrThrow({ where: cle, include: WITH_MISSION })
    return toView(relu)
  }
}
```

Dans `transitionCra`, consigner après l'écriture :

```ts
  const row = await prisma.cra.update({
    where: { id: craId },
    data: { status: next },
    include: WITH_MISSION,
  })

  await appendAudit({
    ...(await actorOf(userId)),
    action: ACTION_PAR_TRANSITION[t],
    entityType: 'Cra',
    entityId: craId,
    payload: {
      missionId: row.missionId,
      month: row.month.toISOString().slice(0, 7),
      statutAvant: current.status,
      statutApres: next,
    },
  })

  return toView(row)
```

`applyTransition` lève **avant** l'écriture : une transition impossible ne laisse donc rien au journal, sans qu'aucune garde supplémentaire soit nécessaire.

- [ ] **Step 4: Consigner le référentiel**

`src/services/clients.ts` :

```ts
import { appendAudit, actorOf } from './audit'

export async function createClient(
  name: string,
  minutesParJour?: number | null,
  userId?: string,
): Promise<{ id: string; name: string }> {
  const c = await prisma.client.create({ data: { name, minutesParJour: minutesParJour ?? null } })

  await appendAudit({
    ...(await actorOf(userId ?? '')),
    action: 'client.cree',
    entityType: 'Client',
    entityId: c.id,
    payload: { name, minutesParJour: minutesParJour ?? null },
  })

  return { id: c.id, name: c.name }
}
```

`src/services/missions.ts` — `createMission` gagne `userId?: string` dans son objet d'arguments et consigne `mission.creee` avec `{ clientId, label, minutesParJour }` ; `createLine` consigne `prestation.creee` **après** la transaction (le journal ne doit pas être écrit dans une transaction qui peut encore être annulée) avec `{ missionId, label, soldCentiemes, tjmCents, displayUnit, minutesParJour }` et l'acteur `args.userId`, déjà présent.

```ts
export async function createMission(args: {
  clientId: string
  label: string
  minutesParJour?: number | null
  userId?: string
}): Promise<{ id: string }> {
  const m = await prisma.mission.create({
    data: {
      clientId: args.clientId,
      label: args.label,
      minutesParJour: args.minutesParJour ?? null,
    },
  })

  await appendAudit({
    ...(await actorOf(args.userId ?? '')),
    action: 'mission.creee',
    entityType: 'Mission',
    entityId: m.id,
    payload: { clientId: args.clientId, label: args.label, minutesParJour: args.minutesParJour ?? null },
  })

  return { id: m.id }
}
```

Dans `createLine`, garder la transaction telle quelle et consigner ensuite :

```ts
  const cree = await prisma.$transaction(async (tx) => { /* … inchangé … */ })

  await appendAudit({
    ...(await actorOf(args.userId)),
    action: 'prestation.creee',
    entityType: 'MissionLine',
    entityId: cree.id,
    payload: {
      missionId: args.missionId,
      label: args.label,
      soldCentiemes: args.soldCentiemes,
      tjmCents: args.tjmCents,
      minutesParJour: args.minutesParJour ?? null,
    },
  })

  return cree
```

- [ ] **Step 5: Consigner les réglages et le réétalonnage**

Dans `src/services/settings.ts` :

```ts
import { appendAudit, actorOf } from './audit'

/**
 * Résumé du patch pour le journal : les scalaires tels quels, les listes
 * réduites à leur cardinal. Recopier soixante jours fériés à chaque
 * enregistrement noierait le journal sans rien apprendre à personne.
 */
function resumePatch(patch: Partial<AppSettings>): Record<string, unknown> {
  const resume: Record<string, unknown> = { cles: Object.keys(patch) }
  for (const [cle, valeur] of Object.entries(patch)) {
    resume[cle] = Array.isArray(valeur) ? `${valeur.length} valeur(s)` : valeur
  }
  return resume
}

export async function updateSettings(
  patch: Partial<AppSettings>,
  userId?: string,
): Promise<AppSettings> {
  const validation = validateSettingsPatch(patch)
  if (!validation.ok) {
    throw new SettingsValidationError(validation.errors)
  }

  // … lecture du singleton et update inchangés …

  await appendAudit({
    ...(await actorOf(userId ?? '')),
    action: 'reglage.modifie',
    entityType: 'Settings',
    entityId: 'singleton',
    payload: resumePatch(patch),
  })

  return toAppSettings(row)
}
```

Dans `src/services/rates.ts`, à la fin de `recalibrateOpenMonths` :

```ts
  if (aTraiter.length > 0) {
    await appendAudit({
      ...(await actorOf(userId)),
      action: 'reetalonnage.effectue',
      entityType: 'Settings',
      entityId: 'singleton',
      payload: {
        recalibrees: aTraiter.length,
        sauteesVerrouillees: liste.length - aTraiter.length,
        entryIds: aTraiter.map((c) => c.id),
      },
    })
  }
```

`previewRecalibration` reste muette : elle ne fait que lire.

- [ ] **Step 6: Transmettre l'utilisateur depuis les server actions**

Dans `src/app/(app)/missions/actions.ts`, passer `user.id` à `createClient` (troisième argument) et à `createMission` (champ `userId`). Dans `src/app/(app)/admin/saisie/actions.ts`, passer `user.id` en second argument de `updateSettings`. Dans `src/app/(app)/cra/actions.ts`, rien à changer : `transitionCra` reçoit déjà l'utilisateur.

Un acte humain attribué à `SYSTEME` serait une preuve fausse — c'est le seul motif de ces trois modifications.

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/`
Expected: PASS — les 16 tests nouveaux plus tous les existants

- [ ] **Step 8: Vérifier par mutation**

Remettre `prisma.cra.upsert` dans `getOrCreateCra` en consignant systématiquement → « consigne l ouverture, une seule fois » doit échouer. Dans `resumePatch`, recopier les tableaux tels quels → « résume les listes » doit échouer. Restaurer.

- [ ] **Step 9: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 10: Commit**

```bash
git add src/services/cra.ts src/services/cra.test.ts src/services/clients.ts src/services/missions.ts src/services/missions.test.ts src/services/settings.ts src/services/settings.test.ts src/services/rates.ts src/services/rates.test.ts "src/app/(app)/missions/actions.ts" "src/app/(app)/admin/saisie/actions.ts"
git commit -m "feat(audit): record CRA transitions, reference data and operational settings"
```

---

## Task 7: Charge utile, signature HMAC et gabarits

**Files:** Create `src/core/webhooks/payload.ts`, `src/core/webhooks/payload.test.ts`, `src/core/webhooks/signature.ts`, `src/core/webhooks/signature.test.ts`, `src/core/notify/templates.ts`, `src/core/notify/templates.test.ts`

**Interfaces:**
- Consumes: rien (`node:crypto` uniquement)
- Produces:
  - `interface EventPayload { event: string; seq: number; occurredAt: string; actor: { id: string; label: string }; entity: { type: string; id: string }; data: Record<string, unknown> }`
  - `buildEventPayload(entree: { seq: number; occurredAt: Date; action: string; actorId: string; actorLabel: string; entityType: string; entityId: string; payload: Record<string, unknown> }): EventPayload`
  - `serializeEventPayload(p: EventPayload): string`
  - `const EN_TETE_EVENEMENT = 'X-CRA-Event'`, `EN_TETE_SEQ = 'X-CRA-Seq'`, `EN_TETE_SIGNATURE = 'X-CRA-Signature'`
  - `const SEQ_ESSAI = 0`
  - `signPayload(secret: string, corpsBrut: string): string`
  - `verifySignature(secret: string, corpsBrut: string, entete: string): boolean`
  - `interface Gabarit { sujet: string; corps: string }`
  - `gabaritRappelSaisie(args: { mois: string; jours: string[] }): Gabarit`
  - `gabaritRappelCloture(args: { mois: string; missions: ReadonlyArray<{ label: string; etat: string }> }): Gabarit`
  - `gabaritRuptureJournal(args: { seq: number; raison: string }): Gabarit`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/core/webhooks/payload.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  buildEventPayload,
  serializeEventPayload,
  SEQ_ESSAI,
  EN_TETE_EVENEMENT,
  EN_TETE_SEQ,
  EN_TETE_SIGNATURE,
} from './payload'

const ENTREE = {
  seq: 1234,
  occurredAt: new Date('2026-08-15T09:12:03.000Z'),
  action: 'cra.valide',
  actorId: 'usr_1',
  actorLabel: 'Keveen',
  entityType: 'Cra',
  entityId: 'cra_1',
  payload: { missionId: 'm1', month: '2026-07' },
}

describe('charge utile', () => {
  it('a exactement la forme annoncée par la spec', () => {
    expect(buildEventPayload(ENTREE)).toEqual({
      event: 'cra.valide',
      seq: 1234,
      occurredAt: '2026-08-15T09:12:03.000Z',
      actor: { id: 'usr_1', label: 'Keveen' },
      entity: { type: 'Cra', id: 'cra_1' },
      data: { missionId: 'm1', month: '2026-07' },
    })
  })

  it('sérialise l horodatage en ISO 8601 UTC', () => {
    expect(buildEventPayload(ENTREE).occurredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    )
  })

  it('produit un corps brut stable', () => {
    const p = buildEventPayload(ENTREE)
    expect(serializeEventPayload(p)).toBe(serializeEventPayload(buildEventPayload(ENTREE)))
    expect(JSON.parse(serializeEventPayload(p))).toEqual(p)
  })

  it('place event et seq en tête du corps, pour la lisibilité humaine', () => {
    expect(serializeEventPayload(buildEventPayload(ENTREE))).toMatch(
      /^\{"event":"cra\.valide","seq":1234,/,
    )
  })

  it('réserve le numéro zéro à l essai', () => {
    // seq commence à 1 dans le journal : zéro ne peut désigner qu un essai,
    // sans qu il faille inventer un vocabulaire pour le dire.
    expect(SEQ_ESSAI).toBe(0)
  })

  it('nomme ses en-têtes une seule fois', () => {
    expect([EN_TETE_EVENEMENT, EN_TETE_SEQ, EN_TETE_SIGNATURE]).toEqual([
      'X-CRA-Event', 'X-CRA-Seq', 'X-CRA-Signature',
    ])
  })
})
```

`src/core/webhooks/signature.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { signPayload, verifySignature } from './signature'

const SECRET = 'un-secret-d-abonnement'
const CORPS = '{"event":"cra.valide","seq":1234}'

describe('signature du corps brut', () => {
  it('est reproductible', () => {
    expect(signPayload(SECRET, CORPS)).toBe(signPayload(SECRET, CORPS))
  })

  it('est un HMAC-SHA256 préfixé', () => {
    expect(signPayload(SECRET, CORPS)).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('un consommateur la recalcule et retrouve l en-tête', () => {
    const entete = signPayload(SECRET, CORPS)
    expect(verifySignature(SECRET, CORPS, entete)).toBe(true)
  })

  it('une charge utile altérée d un octet ne valide plus', () => {
    const entete = signPayload(SECRET, CORPS)
    expect(verifySignature(SECRET, `${CORPS} `, entete)).toBe(false)
    expect(verifySignature(SECRET, CORPS.replace('1234', '1235'), entete)).toBe(false)
  })

  it('un autre secret ne valide pas', () => {
    expect(verifySignature('autre-secret', CORPS, signPayload(SECRET, CORPS))).toBe(false)
  })

  it('ne lève pas sur un en-tête tronqué, vide ou absurde', () => {
    // Le comparateur à temps constant jette sur des longueurs différentes :
    // sans garde, un en-tête malformé ferait tomber le serveur.
    for (const entete of ['', 'sha256=', 'nawak', 'sha256=zz']) {
      expect(verifySignature(SECRET, CORPS, entete)).toBe(false)
    }
  })
})
```

`src/core/notify/templates.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { gabaritRappelSaisie, gabaritRappelCloture, gabaritRuptureJournal } from './templates'

describe('gabarits de notification', () => {
  it('rappelle les jours sans saisie, en français', () => {
    const g = gabaritRappelSaisie({ mois: '2026-08', jours: ['2026-08-03', '2026-08-04'] })
    expect(g.sujet).toBe('CRA — 2 jour(s) ouvré(s) sans saisie en 2026-08')
    expect(g.corps).toContain('2026-08-03')
    expect(g.corps).toContain('2026-08-04')
  })

  it('rappelle les CRA à clôturer avec leur état', () => {
    const g = gabaritRappelCloture({
      mois: '2026-07',
      missions: [{ label: 'ITSM', etat: 'BROUILLON' }, { label: 'Audit', etat: 'ABSENT' }],
    })
    expect(g.sujet).toBe('CRA — 2 CRA à clôturer pour 2026-07')
    expect(g.corps).toContain('ITSM')
    expect(g.corps).toContain('BROUILLON')
    expect(g.corps).toContain('Audit')
  })

  it('annonce une rupture de chaîne avec l entrée en cause', () => {
    const g = gabaritRuptureJournal({ seq: 412, raison: 'EMPREINTE' })
    expect(g.sujet).toBe('CRA — rupture de la chaîne du journal à l’entrée 412')
    expect(g.corps).toContain('412')
    expect(g.corps).toContain('EMPREINTE')
  })

  it('n annonce rien d actionnable sans contenu', () => {
    // « Pas de notification pour ce qui n appelle aucune action » : les
    // gabarits refusent une liste vide plutôt que d envoyer du bruit.
    expect(() => gabaritRappelSaisie({ mois: '2026-08', jours: [] })).toThrow()
    expect(() => gabaritRappelCloture({ mois: '2026-07', missions: [] })).toThrow()
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/core/webhooks/ src/core/notify/`
Expected: FAIL — trois imports non résolus

- [ ] **Step 3: Écrire `payload.ts`**

```ts
/** Les trois en-têtes qui accompagnent chaque appel sortant. */
export const EN_TETE_EVENEMENT = 'X-CRA-Event'
export const EN_TETE_SEQ = 'X-CRA-Seq'
export const EN_TETE_SIGNATURE = 'X-CRA-Signature'

/**
 * Numéro d'ordre d'un événement d'essai. Le journal numérote à partir de 1 :
 * zéro ne peut désigner qu'un essai, et le consommateur le distingue sans
 * qu'on ait eu à inventer un vocabulaire pour le dire.
 */
export const SEQ_ESSAI = 0

export interface EventPayload {
  event: string
  seq: number
  /** ISO 8601 UTC */
  occurredAt: string
  actor: { id: string; label: string }
  entity: { type: string; id: string }
  data: Record<string, unknown>
}

export function buildEventPayload(entree: {
  seq: number
  occurredAt: Date
  action: string
  actorId: string
  actorLabel: string
  entityType: string
  entityId: string
  payload: Record<string, unknown>
}): EventPayload {
  return {
    event: entree.action,
    seq: entree.seq,
    occurredAt: entree.occurredAt.toISOString(),
    actor: { id: entree.actorId, label: entree.actorLabel },
    entity: { type: entree.entityType, id: entree.entityId },
    data: entree.payload,
  }
}

/**
 * Le corps **brut** : c'est lui qui part sur le réseau et lui qui est signé.
 * Signer un objet resérialisé ailleurs produirait une signature que le
 * destinataire ne pourrait pas reproduire.
 */
export function serializeEventPayload(p: EventPayload): string {
  return JSON.stringify(p)
}
```

L'ordre des clés du littéral suffit à placer `event` et `seq` en tête : `JSON.stringify` respecte l'ordre d'insertion pour les clés non numériques, et ce littéral est écrit à la main, pas construit dynamiquement.

- [ ] **Step 4: Écrire `signature.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

const PREFIXE = 'sha256='

/**
 * HMAC-SHA256 du **corps brut**, avec le secret propre à l'abonnement.
 * Sans elle, quiconque connaît l'URL peut déclencher un flux en fabriquant
 * un faux événement.
 */
export function signPayload(secret: string, corpsBrut: string): string {
  return PREFIXE + createHmac('sha256', secret).update(corpsBrut, 'utf8').digest('hex')
}

/**
 * Comparaison à temps constant. `timingSafeEqual` **lève** sur deux tampons
 * de longueurs différentes : la garde de longueur n'est pas une optimisation,
 * c'est ce qui empêche un en-tête malformé de faire tomber le serveur.
 */
export function verifySignature(secret: string, corpsBrut: string, entete: string): boolean {
  const attendu = Buffer.from(signPayload(secret, corpsBrut), 'utf8')
  const fourni = Buffer.from(entete, 'utf8')
  if (attendu.length !== fourni.length) return false
  return timingSafeEqual(attendu, fourni)
}
```

- [ ] **Step 5: Écrire `templates.ts`**

```ts
export interface Gabarit {
  sujet: string
  corps: string
}

/**
 * Les gabarits **refusent le vide**. « Pas de notification pour ce qui
 * n'appelle aucune action » : un gabarit qui accepterait une liste vide
 * enverrait un courriel disant qu'il n'y a rien à faire, et on apprendrait
 * à l'ignorer. C'est l'appelant qui décide de ne pas notifier.
 */
export function gabaritRappelSaisie(args: { mois: string; jours: string[] }): Gabarit {
  if (args.jours.length === 0) {
    throw new Error('Rappel de saisie : aucun jour à signaler, il ne faut pas notifier.')
  }

  return {
    sujet: `CRA — ${args.jours.length} jour(s) ouvré(s) sans saisie en ${args.mois}`,
    corps: [
      `Les jours ouvrés suivants de ${args.mois} ne portent aucune saisie :`,
      '',
      ...args.jours.map((jour) => `  · ${jour}`),
      '',
      "Ce message ne modifie rien : la saisie reste entièrement à votre main.",
    ].join('\n'),
  }
}

export function gabaritRappelCloture(args: {
  mois: string
  missions: ReadonlyArray<{ label: string; etat: string }>
}): Gabarit {
  if (args.missions.length === 0) {
    throw new Error('Rappel de clôture : aucun CRA à signaler, il ne faut pas notifier.')
  }

  return {
    sujet: `CRA — ${args.missions.length} CRA à clôturer pour ${args.mois}`,
    corps: [
      `Ces CRA de ${args.mois} ne sont pas encore envoyés :`,
      '',
      ...args.missions.map((m) => `  · ${m.label} — ${m.etat}`),
      '',
      "Aucun automatisme ne les enverra : l'envoi reste un geste humain.",
    ].join('\n'),
  }
}

export function gabaritRuptureJournal(args: { seq: number; raison: string }): Gabarit {
  return {
    sujet: `CRA — rupture de la chaîne du journal à l’entrée ${args.seq}`,
    corps: [
      `La vérification quotidienne du journal de preuve a détecté une rupture.`,
      '',
      `  Entrée en cause : ${args.seq}`,
      `  Nature          : ${args.raison}`,
      '',
      "Une entrée a été modifiée, supprimée ou insérée en dehors de l'application.",
      "Les entrées antérieures à celle-ci restent vérifiables.",
    ].join('\n'),
  }
}
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/core/webhooks/ src/core/notify/`
Expected: PASS — 16 tests

- [ ] **Step 7: Vérifier par mutation**

Dans `verifySignature`, remplacer `timingSafeEqual(attendu, fourni)` par `attendu.equals(fourni)` : les tests restent verts (le comportement est identique), ce qui montre qu'aucun test ne prouve la propriété de temps constant — c'est assumé, elle n'est pas observable depuis un test. Retirer en revanche la garde de longueur → « ne lève pas sur un en-tête tronqué » doit échouer. Restaurer.

- [ ] **Step 8: Commit**

```bash
git add src/core/webhooks/ src/core/notify/
git commit -m "feat(core): event payload, HMAC signature and French notification templates"
```

---

## Task 8: Le jeton d'API et `GET /api/events`

**Files:** Create `src/services/api-token.ts`, `src/services/api-token.test.ts`, `src/app/api/events/route.ts`, `src/app/api/events/route.test.ts`. Modify `src/middleware.ts`, `README.md`

**Interfaces:**
- Consumes: `readAuditSince` (tâche 4), `buildEventPayload` (tâche 7), `isAuditAction` (tâche 1)
- Produces:
  - `requireApiToken(request: Request): { ok: true } | { ok: false; response: Response }`
  - `GET /api/events?since=<seq>&limit=<n>&event=<nom>` → `{ events: EventPayload[]; nombre: number; derniereSeq: number }`

**Le jeton vit dans l'environnement, pas en base.** Il est du même ordre qu'`AUTH_SECRET` : un secret d'instance. En base, il ressortirait dans chaque sauvegarde, dans chaque export, et sur l'écran qui le gère. Et il est **distinct de la session utilisateur** parce qu'il authentifie un intégrateur, pas une personne — une session porte des droits d'écran, ce jeton ne donne accès qu'au journal en lecture et au réveil de l'ordonnanceur.

**Le middleware doit laisser passer `/api/`.** Il ne consulte pas la base et redirige toute requête sans session vers `/login` : sans cette modification, un appel correctement porteur du jeton recevrait une redirection HTML. Les deux routes portent elles-mêmes leur garde — c'est déjà le régime de `/api/auth`, exclu depuis le lot 0.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/services/api-token.test.ts` :

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { requireApiToken } from './api-token'

const ORIGINAL = process.env.CRA_API_TOKEN

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRA_API_TOKEN
  else process.env.CRA_API_TOKEN = ORIGINAL
})

function requete(entete?: string): Request {
  return new Request('https://exemple.test/api/events', {
    headers: entete === undefined ? {} : { authorization: entete },
  })
}

describe('garde de jeton d API', () => {
  it('accepte le jeton attendu', () => {
    process.env.CRA_API_TOKEN = 'jeton-de-test'
    expect(requireApiToken(requete('Bearer jeton-de-test'))).toEqual({ ok: true })
  })

  it('refuse un jeton faux', async () => {
    process.env.CRA_API_TOKEN = 'jeton-de-test'
    const r = requireApiToken(requete('Bearer autre-jeton'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(401)
  })

  it('refuse l absence d en-tête', async () => {
    process.env.CRA_API_TOKEN = 'jeton-de-test'
    const r = requireApiToken(requete())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(401)
  })

  it('refuse un schéma d autorisation qui n est pas Bearer', () => {
    process.env.CRA_API_TOKEN = 'jeton-de-test'
    expect(requireApiToken(requete('Basic jeton-de-test')).ok).toBe(false)
  })

  it('refuse tout quand le jeton n est pas configuré, plutôt que d ouvrir', async () => {
    // Le défaut sûr est la fermeture : une instance mal configurée ne doit
    // pas exposer son journal, ni son ordonnanceur.
    delete process.env.CRA_API_TOKEN
    const r = requireApiToken(requete('Bearer n-importe-quoi'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(503)
    expect(await r.response.json()).toMatchObject({ erreur: expect.stringContaining('CRA_API_TOKEN') })
  })

  it('refuse un jeton vide même si la variable est vide', () => {
    process.env.CRA_API_TOKEN = ''
    expect(requireApiToken(requete('Bearer ')).ok).toBe(false)
  })
})
```

`src/app/api/events/route.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { appendAudit, ACTEUR_SYSTEME } from '@/services/audit'
import { GET } from './route'

const JETON = 'jeton-de-test-events'
const ORIGINAL = process.env.CRA_API_TOKEN

beforeAll(() => {
  process.env.CRA_API_TOKEN = JETON
})

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({})
  if (ORIGINAL === undefined) delete process.env.CRA_API_TOKEN
  else process.env.CRA_API_TOKEN = ORIGINAL
  await prisma.$disconnect()
})

function appel(query: string, jeton: string | null = JETON): Promise<Response> {
  return GET(
    new Request(`https://exemple.test/api/events${query}`, {
      headers: jeton === null ? {} : { authorization: `Bearer ${jeton}` },
    }),
  )
}

async function peupler(n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await appendAudit({
      ...ACTEUR_SYSTEME,
      action: i % 2 === 1 ? 'saisie.creee' : 'cra.valide',
      entityType: 'TimeEntry',
      entityId: `e${i}`,
      payload: { n: i },
    })
  }
}

describe('GET /api/events', () => {
  it('refuse sans jeton', async () => {
    expect((await appel('', null)).status).toBe(401)
  })

  it('rend les événements dans l ordre, avec le curseur de reprise', async () => {
    await peupler(3)
    const reponse = await appel('?since=0')
    expect(reponse.status).toBe(200)

    const corps = await reponse.json()
    expect(corps.nombre).toBe(3)
    expect(corps.derniereSeq).toBe(3)
    expect(corps.events.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3])
  })

  it('rend la charge utile exactement à la forme de la spec', async () => {
    await peupler(1)
    const corps = await (await appel('?since=0')).json()
    expect(Object.keys(corps.events[0])).toEqual([
      'event', 'seq', 'occurredAt', 'actor', 'entity', 'data',
    ])
    expect(corps.events[0]).toMatchObject({
      event: 'saisie.creee',
      seq: 1,
      actor: { id: '', label: 'SYSTEME' },
      entity: { type: 'TimeEntry', id: 'e1' },
      data: { n: 1 },
    })
  })

  it('NE PERD NI NE RÉPÈTE AUCUN ÉVÉNEMENT quand un consommateur boucle', async () => {
    // La garantie centrale du modèle. Un consommateur mémorise derniereSeq
    // et reprend là où il s'était arrêté, même après plusieurs jours d'arrêt.
    await peupler(7)

    const vus: number[] = []
    let curseur = 0
    for (let tour = 0; tour < 10; tour++) {
      const corps = await (await appel(`?since=${curseur}&limit=3`)).json()
      if (corps.nombre === 0) break
      vus.push(...corps.events.map((e: { seq: number }) => e.seq))
      curseur = corps.derniereSeq
    }

    expect(vus).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(new Set(vus).size).toBe(vus.length)
  })

  it('conserve le curseur du consommateur quand il n y a rien de neuf', async () => {
    await peupler(2)
    const corps = await (await appel('?since=2')).json()
    expect(corps).toMatchObject({ nombre: 0, derniereSeq: 2, events: [] })
  })

  it('filtre par événement', async () => {
    await peupler(4)
    const corps = await (await appel('?since=0&event=cra.valide')).json()
    expect(corps.events.map((e: { seq: number }) => e.seq)).toEqual([2, 4])
  })

  it('refuse un événement hors catalogue', async () => {
    const reponse = await appel('?event=cra.validee')
    expect(reponse.status).toBe(400)
    expect((await reponse.json()).erreur).toContain('catalogue')
  })

  it('refuse un since ou un limit absurde', async () => {
    expect((await appel('?since=-1')).status).toBe(400)
    expect((await appel('?since=abc')).status).toBe(400)
    expect((await appel('?limit=0')).status).toBe(400)
    expect((await appel('?limit=abc')).status).toBe(400)
  })

  it('accepte un limit supérieur au plafond sans échouer', async () => {
    // Le plafond lui-même (500) n'est pas observable ici sans peupler le
    // journal de plus de 500 entrées : ce que ce test protège, c'est qu'une
    // demande démesurée soit ramenée au plafond plutôt que refusée.
    await peupler(5)
    const reponse = await appel('?since=0&limit=99999')
    expect(reponse.status).toBe(200)
    expect((await reponse.json()).nombre).toBe(5)
  })

  it('borne réellement le lot rendu', async () => {
    await peupler(5)
    expect((await (await appel('?since=0&limit=2')).json()).nombre).toBe(2)
  })

  it('ne consigne rien : lire n est pas un acte', async () => {
    await peupler(2)
    await appel('?since=0')
    expect(await prisma.auditEvent.count()).toBe(2)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/api-token.test.ts src/app/api/events/route.test.ts`
Expected: FAIL — deux imports non résolus

- [ ] **Step 3: Écrire la garde de jeton**

`src/services/api-token.ts` :

```ts
import { timingSafeEqual } from 'node:crypto'

/**
 * Garde des routes d'intégration. **Ne prend pas de `userId`** — c'est
 * l'unique exception assumée à la règle du projet : ce jeton authentifie
 * l'instance auprès d'un intégrateur, pas une personne auprès de l'écran.
 *
 * Le secret vit dans l'environnement, comme `AUTH_SECRET` : en base, il
 * ressortirait dans chaque sauvegarde et sur l'écran qui le gérerait.
 */
export function requireApiToken(request: Request): { ok: true } | { ok: false; response: Response } {
  const attendu = process.env.CRA_API_TOKEN ?? ''

  if (attendu === '') {
    // Défaut sûr : une instance mal configurée se ferme, elle ne s'ouvre pas.
    return {
      ok: false,
      response: Response.json(
        { erreur: "Le jeton d'API n'est pas configuré (variable d'environnement CRA_API_TOKEN)." },
        { status: 503 },
      ),
    }
  }

  const brut = request.headers.get('authorization') ?? ''
  const fourni = brut.startsWith('Bearer ') ? brut.slice('Bearer '.length) : ''

  if (!egalATempsConstant(fourni, attendu)) {
    return { ok: false, response: Response.json({ erreur: 'Jeton invalide.' }, { status: 401 }) }
  }

  return { ok: true }
}

/**
 * La différence de longueur fuit, et c'est irréductible sans hacher les deux
 * côtés ; le contenu, lui, ne fuit pas. `timingSafeEqual` lève sur des
 * longueurs différentes : la garde n'est pas une optimisation.
 */
function egalATempsConstant(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
```

- [ ] **Step 4: Écrire la route**

`src/app/api/events/route.ts` :

```ts
import { requireApiToken } from '@/services/api-token'
import { readAuditSince } from '@/services/audit'
import { buildEventPayload } from '@/core/webhooks/payload'
import { isAuditAction } from '@/core/audit/events'

/** Le journal est lu à la demande : jamais de cache statique sur cette route. */
export const dynamic = 'force-dynamic'

const LIMITE_DEFAUT = 100
const LIMITE_MAX = 500

function entierPositif(brut: string | null, defaut: number, minimum: number): number | null {
  if (brut === null) return defaut
  const valeur = Number(brut)
  if (!Number.isInteger(valeur) || valeur < minimum) return null
  return valeur
}

export async function GET(request: Request): Promise<Response> {
  const garde = requireApiToken(request)
  if (!garde.ok) return garde.response

  const parametres = new URL(request.url).searchParams

  const since = entierPositif(parametres.get('since'), 0, 0)
  if (since === null) {
    return Response.json(
      { erreur: 'Le paramètre « since » doit être un entier positif ou nul.' },
      { status: 400 },
    )
  }

  const limit = entierPositif(parametres.get('limit'), LIMITE_DEFAUT, 1)
  if (limit === null) {
    return Response.json(
      { erreur: 'Le paramètre « limit » doit être un entier strictement positif.' },
      { status: 400 },
    )
  }

  const event = parametres.get('event')
  if (event !== null && !isAuditAction(event)) {
    return Response.json(
      { erreur: `L'événement « ${event} » n'existe pas au catalogue.` },
      { status: 400 },
    )
  }

  const entries = await readAuditSince({
    since,
    limit: Math.min(limit, LIMITE_MAX),
    ...(event !== null && { action: event }),
  })

  const events = entries.map(buildEventPayload)

  return Response.json({
    events,
    nombre: events.length,
    // Rien de neuf : on rend au consommateur son propre curseur, pour qu'il
    // ne recule pas à zéro au prochain tour.
    derniereSeq: events.length === 0 ? since : events[events.length - 1]!.seq,
  })
}
```

**Le curseur sous filtre.** Avec `event=`, `derniereSeq` est le dernier seq **correspondant au filtre**. Un consommateur qui garde un curseur par filtre est correct ; un consommateur qui partage un curseur entre deux filtres se trompe. C'est le comportement attendu d'un flux filtré, et il vaut mieux qu'un curseur global qui ferait sauter des événements du filtre.

- [ ] **Step 5: Laisser passer les routes d'API dans le middleware**

`src/middleware.ts` :

```ts
export const config = {
  // `/api/` est exclu en entier : ces routes portent leur propre garde
  // (jeton d'instance pour /api/events et /api/jobs/tick, Auth.js pour
  // /api/auth). Le middleware, lui, redirige toute requête sans session
  // vers /login — un intégrateur correctement authentifié recevrait alors
  // une page HTML de connexion à la place de ses événements.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 6: Documenter l'API dans le README**

Ajouter une section à `README.md`, après « Développement » :

```markdown
## API d'événements

L'application **expose**, elle n'appelle personne. Un intégrateur (n8n, un
script, autre chose demain) lit le journal et reprend où il s'était arrêté.

    curl -H "Authorization: Bearer $CRA_API_TOKEN" \
         "http://localhost:3000/api/events?since=0&limit=100"

Paramètres : `since` (dernier `seq` traité, exclu), `limit` (100 par défaut,
500 au maximum), `event` (un nom du catalogue).

La réponse porte `events`, `nombre` et `derniereSeq` — ce dernier est le
curseur à mémoriser pour l'appel suivant. **Aucun événement ne se perd**,
même après plusieurs jours d'arrêt du consommateur.

Le réveil de l'ordonnanceur utilise le même jeton :

    curl -X POST -H "Authorization: Bearer $CRA_API_TOKEN" \
         http://localhost:3000/api/jobs/tick
```

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/api-token.test.ts src/app/api/events/route.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 8: Vérifier par mutation**

Dans `requireApiToken`, remplacer le repli `attendu === ''` par un `return { ok: true }` → « refuse tout quand le jeton n est pas configuré » doit échouer. Dans la route, remplacer `derniereSeq: events.length === 0 ? since : …` par `derniereSeq: events.at(-1)?.seq ?? 0` → « conserve le curseur du consommateur » doit échouer, et « NE PERD NI NE RÉPÈTE » doit boucler puis échouer sur la répétition. Restaurer.

- [ ] **Step 9: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 10: Commit**

```bash
git add src/services/api-token.ts src/services/api-token.test.ts src/app/api/events src/middleware.ts README.md
git commit -m "feat(api): token-protected event feed with lossless since cursor"
```

---

## Task 9: Les abonnements

**Files:** Create `src/services/webhooks/subscriptions.ts`, `src/services/webhooks/subscriptions.test.ts`

**Interfaces:**
- Consumes: `AuditAction`, `parseSubscription`, `serializeSubscription` (tâche 1) ; `currentAuditSeq` (tâche 4) ; `Webhook` (tâche 3)
- Produces:
  - `interface WebhookView { id: string; label: string; url: string; events: AuditAction[]; state: WebhookState; lastSeq: number; consecutiveFailures: number; lastError: string; suspendedAt: Date | null }`
  - `type WebhookState = 'ACTIF' | 'SUSPENDU'`
  - `createWebhook(userId: string, args: { label: string; url: string; events: AuditAction[]; secret?: string }): Promise<WebhookView>`
  - `listWebhooks(userId: string): Promise<WebhookView[]>`
  - `getWebhook(userId: string, id: string): Promise<WebhookView>`
  - `updateWebhook(userId: string, id: string, patch: { label?: string; url?: string; events?: AuditAction[]; state?: WebhookState }): Promise<WebhookView>`
  - `deleteWebhook(userId: string, id: string): Promise<void>`
  - `class WebhookValidationError extends Error { errors: string[] }`

**Le secret ne ressort jamais de ce module.** `WebhookView` ne le porte pas : il sert à signer, pas à être affiché. L'écran montre qu'un secret existe, jamais sa valeur — un secret qu'on affiche est un secret qu'on recopie dans un ticket.

**La reprise après suspension repart de l'instant présent.** Réactiver un abonnement suspendu depuis six mois ne doit pas déverser six mois d'événements sur une URL qui vient de revenir. `lastSeq` est donc remis au sommet du journal, et **c'est précisément pour cela que la lecture par `since` est la garantie** : les événements de la période suspendue n'ont pas disparu, ils sont dans le journal et se rattrapent par l'API. L'écran affiche le `seq` de reprise pour que ce rattrapage soit faisable.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/webhooks/subscriptions.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import type { AuditAction } from '@/core/audit/events'
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  updateWebhook,
  WebhookValidationError,
} from './subscriptions'

let userId = ''
let autreId = ''

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'hook@test.local', name: 'K', passwordHash: 'x' } })
  ).id
  autreId = (
    await prisma.user.create({ data: { email: 'hook-autre@test.local', name: 'A', passwordHash: 'x' } })
  ).id
})

beforeEach(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: ['hook@test.local', 'hook-autre@test.local'] } } })
  await prisma.$disconnect()
})

const BASE = { label: 'n8n', url: 'https://exemple.test/hook', events: [] as AuditAction[] }

describe('création d un abonnement', () => {
  it('engendre un secret quand on n en fournit pas', async () => {
    const w = await createWebhook(userId, BASE)
    const brut = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(brut.secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ne rend jamais le secret', async () => {
    const w = await createWebhook(userId, { ...BASE, secret: 'mon-secret' })
    expect(JSON.stringify(w)).not.toContain('mon-secret')
    expect(Object.keys(w)).not.toContain('secret')
  })

  it('persiste les événements en chaîne, pas en tableau', async () => {
    const w = await createWebhook(userId, { ...BASE, events: ['cra.valide', 'saisie.creee'] })
    const brut = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(brut.events).toBe('cra.valide,saisie.creee')
    expect(w.events).toEqual(['cra.valide', 'saisie.creee'])
  })

  it('traite la liste vide comme « tous les événements »', async () => {
    const w = await createWebhook(userId, BASE)
    expect(w.events).toEqual([])
    const brut = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(brut.events).toBe('')
  })

  it('démarre actif et au sommet du journal', async () => {
    await appendAudit({
      ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: 'c1', payload: {},
    })
    const w = await createWebhook(userId, BASE)
    expect(w.state).toBe('ACTIF')
    // Un abonnement neuf ne rejoue pas l'histoire : il part de maintenant.
    expect(w.lastSeq).toBe(1)
  })

  it('refuse une URL qui n est pas http(s)', async () => {
    for (const url of ['', 'ftp://exemple.test', 'exemple.test/hook', 'javascript:alert(1)']) {
      await expect(createWebhook(userId, { ...BASE, url })).rejects.toBeInstanceOf(
        WebhookValidationError,
      )
    }
  })

  it('refuse un libellé vide', async () => {
    await expect(createWebhook(userId, { ...BASE, label: '  ' })).rejects.toBeInstanceOf(
      WebhookValidationError,
    )
  })

  it('donne un message d erreur en français', async () => {
    await expect(createWebhook(userId, { ...BASE, url: 'nawak' })).rejects.toThrow(/URL/i)
  })
})

describe('lecture et modification', () => {
  it('isole par utilisateur', async () => {
    await createWebhook(userId, BASE)
    await createWebhook(autreId, { ...BASE, label: 'autre' })

    expect(await listWebhooks(userId)).toHaveLength(1)
    expect((await listWebhooks(userId))[0]!.label).toBe('n8n')
  })

  it('refuse de lire l abonnement d un autre', async () => {
    const w = await createWebhook(autreId, BASE)
    await expect(getWebhook(userId, w.id)).rejects.toThrow()
  })

  it('refuse de modifier l abonnement d un autre', async () => {
    const w = await createWebhook(autreId, BASE)
    await expect(updateWebhook(userId, w.id, { label: 'volé' })).rejects.toThrow()
    expect((await getWebhook(autreId, w.id)).label).toBe('n8n')
  })

  it('refuse de supprimer l abonnement d un autre', async () => {
    const w = await createWebhook(autreId, BASE)
    await expect(deleteWebhook(userId, w.id)).rejects.toThrow()
    expect(await prisma.webhook.count({ where: { id: w.id } })).toBe(1)
  })

  it('remplace la liste d événements plutôt que de la compléter', async () => {
    const w = await createWebhook(userId, { ...BASE, events: ['cra.valide', 'saisie.creee'] })
    const maj = await updateWebhook(userId, w.id, { events: ['cra.refuse'] })
    expect(maj.events).toEqual(['cra.refuse'])
  })

  it('suspend à la main sans toucher au curseur', async () => {
    const w = await createWebhook(userId, BASE)
    const maj = await updateWebhook(userId, w.id, { state: 'SUSPENDU' })
    expect(maj.state).toBe('SUSPENDU')
    expect(maj.suspendedAt).not.toBeNull()
    expect(maj.lastSeq).toBe(w.lastSeq)
  })
})

describe('reprise après suspension', () => {
  it('repart de l instant présent et remet le compteur à zéro', async () => {
    const w = await createWebhook(userId, BASE)
    await prisma.webhook.update({
      where: { id: w.id },
      data: { state: 'SUSPENDU', consecutiveFailures: 12, lastError: 'ECONNREFUSED', suspendedAt: new Date() },
    })

    // Trois événements pendant la suspension.
    for (let i = 1; i <= 3; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: `c${i}`, payload: {},
      })
    }

    const repris = await updateWebhook(userId, w.id, { state: 'ACTIF' })

    // Pas de déversement : six mois d'arriéré sur une URL qui vient de
    // revenir serait une inondation, pas une résilience.
    expect(repris.lastSeq).toBe(3)
    expect(repris.consecutiveFailures).toBe(0)
    expect(repris.lastError).toBe('')
    expect(repris.suspendedAt).toBeNull()
  })

  it('LES ÉVÉNEMENTS DE LA PÉRIODE SUSPENDUE RESTENT TOUS LISIBLES', async () => {
    // La promesse centrale : un abonnement suspendu ne fait perdre aucun
    // événement — ils sont dans le journal, et se rattrapent par `since`.
    const { readAuditSince } = await import('@/services/audit')

    const w = await createWebhook(userId, BASE)
    await prisma.webhook.update({ where: { id: w.id }, data: { state: 'SUSPENDU' } })

    for (let i = 1; i <= 3; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: `c${i}`, payload: {},
      })
    }

    const repris = await updateWebhook(userId, w.id, { state: 'ACTIF' })

    const manques = await readAuditSince({ since: w.lastSeq, limit: 500 })
    expect(manques.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(repris.lastSeq).toBe(3)
  })
})

describe('journal', () => {
  it('ne consigne pas la gestion des abonnements', async () => {
    // Le catalogue ne porte aucun événement d'abonnement, et c'est voulu :
    // il décrit les actes du métier, pas la configuration de la plomberie.
    const w = await createWebhook(userId, BASE)
    await updateWebhook(userId, w.id, { label: 'renommé' })
    await deleteWebhook(userId, w.id)

    expect(await prisma.auditEvent.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/webhooks/subscriptions.test.ts`
Expected: FAIL — `Failed to resolve import "./subscriptions"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/webhooks/subscriptions.ts` :

```ts
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import {
  parseSubscription,
  serializeSubscription,
  type AuditAction,
} from '@/core/audit/events'
import { currentAuditSeq } from '@/services/audit'

export type WebhookState = 'ACTIF' | 'SUSPENDU'

export interface WebhookView {
  id: string
  label: string
  url: string
  /** vide = tous les événements */
  events: AuditAction[]
  state: WebhookState
  /** dernier seq du journal déjà pris en compte */
  lastSeq: number
  consecutiveFailures: number
  lastError: string
  suspendedAt: Date | null
}

export class WebhookValidationError extends Error {
  errors: string[]

  constructor(errors: string[]) {
    super(errors.join(' '))
    this.name = 'WebhookValidationError'
    this.errors = errors
  }
}

type Row = Awaited<ReturnType<typeof prisma.webhook.findFirstOrThrow>>

/** `secret` est absent de la vue : il sert à signer, pas à être affiché. */
function toView(row: Row): WebhookView {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    events: parseSubscription(row.events),
    state: row.state as WebhookState,
    lastSeq: row.lastSeq,
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
    suspendedAt: row.suspendedAt,
  }
}

function valider(champs: { label?: string; url?: string }): void {
  const errors: string[] = []

  if (champs.label !== undefined && champs.label.trim() === '') {
    errors.push("Le libellé de l'abonnement est requis.")
  }

  if (champs.url !== undefined) {
    let protocole = ''
    try {
      protocole = new URL(champs.url).protocol
    } catch {
      protocole = ''
    }
    if (protocole !== 'http:' && protocole !== 'https:') {
      errors.push("L'URL doit être une adresse http ou https absolue.")
    }
  }

  if (errors.length > 0) throw new WebhookValidationError(errors)
}

export async function createWebhook(
  userId: string,
  args: { label: string; url: string; events: AuditAction[]; secret?: string },
): Promise<WebhookView> {
  valider({ label: args.label, url: args.url })

  // Un abonnement neuf part de maintenant : il n'a pas à rejouer l'histoire
  // antérieure à son existence.
  const lastSeq = await currentAuditSeq()

  const row = await prisma.webhook.create({
    data: {
      userId,
      label: args.label.trim(),
      url: args.url,
      secret: args.secret ?? randomBytes(32).toString('hex'),
      events: serializeSubscription(args.events),
      lastSeq,
    },
  })
  return toView(row)
}

export async function listWebhooks(userId: string): Promise<WebhookView[]> {
  const rows = await prisma.webhook.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return rows.map(toView)
}

export async function getWebhook(userId: string, id: string): Promise<WebhookView> {
  // Le scope par userId dans le `where` est la garantie : jamais un
  // findUnique suivi d'une comparaison, qui laisserait fuiter l'existence.
  return toView(await prisma.webhook.findFirstOrThrow({ where: { id, userId } }))
}

export async function updateWebhook(
  userId: string,
  id: string,
  patch: { label?: string; url?: string; events?: AuditAction[]; state?: WebhookState },
): Promise<WebhookView> {
  valider(patch)

  const actuel = await prisma.webhook.findFirstOrThrow({ where: { id, userId } })

  /**
   * Réactiver ne déverse pas l'arriéré : `lastSeq` repart du sommet du
   * journal. Rien n'est perdu pour autant — les événements de la période
   * suspendue restent lisibles par `GET /api/events?since=<lastSeq>`, et
   * c'est exactement pour cela que le tirage est la garantie et la poussée
   * un simple confort.
   */
  const reprise = patch.state === 'ACTIF' && actuel.state === 'SUSPENDU'
  const suspension = patch.state === 'SUSPENDU' && actuel.state === 'ACTIF'

  const row = await prisma.webhook.update({
    where: { id },
    data: {
      ...(patch.label !== undefined && { label: patch.label.trim() }),
      ...(patch.url !== undefined && { url: patch.url }),
      ...(patch.events !== undefined && { events: serializeSubscription(patch.events) }),
      ...(patch.state !== undefined && { state: patch.state }),
      ...(reprise && {
        lastSeq: await currentAuditSeq(),
        consecutiveFailures: 0,
        lastError: '',
        suspendedAt: null,
      }),
      ...(suspension && { suspendedAt: new Date() }),
    },
  })
  return toView(row)
}

export async function deleteWebhook(userId: string, id: string): Promise<void> {
  const cible = await prisma.webhook.findFirstOrThrow({ where: { id, userId } })
  await prisma.webhook.delete({ where: { id: cible.id } })
}

/**
 * Le secret, pour le seul module qui en a besoin : la signature des appels
 * sortants. Volontairement séparé de `getWebhook`, pour qu'un secret ne
 * puisse pas se retrouver dans une vue par inadvertance.
 */
export async function getWebhookSecret(userId: string, id: string): Promise<string> {
  const row = await prisma.webhook.findFirstOrThrow({
    where: { id, userId },
    select: { secret: true },
  })
  return row.secret
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/webhooks/subscriptions.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 5: Vérifier par mutation**

Retirer `userId` du `where` de `getWebhook` → « refuse de lire l abonnement d un autre » doit échouer. Remplacer, à la reprise, `lastSeq: await currentAuditSeq()` par `lastSeq: actuel.lastSeq` → « repart de l instant présent » doit échouer, mais « LES ÉVÉNEMENTS DE LA PÉRIODE SUSPENDUE RESTENT TOUS LISIBLES » doit rester vert : la promesse tient par le journal, pas par la poussée. Restaurer.

- [ ] **Step 6: Commit**

```bash
git add src/services/webhooks/subscriptions.ts src/services/webhooks/subscriptions.test.ts
git commit -m "feat(webhooks): subscription CRUD with per-user scoping and safe resume"
```

---

## Task 10: La livraison — tentatives, recul, suspension, renvoi, essai

**Files:** Create `src/services/webhooks/delivery.ts`, `src/services/webhooks/delivery.test.ts`

**Interfaces:**
- Consumes: `readAuditSince` (tâche 4) ; `buildEventPayload`, `serializeEventPayload`, `signPayload`, les trois en-têtes, `SEQ_ESSAI` (tâche 7) ; `matchesSubscription` (tâche 1) ; `Webhook`, `WebhookDelivery`, `Settings.webhookMaxEchecs` (tâche 3)
- Produces:
  - `type FetchLike = (url: string, init: RequestInit) => Promise<Response>`
  - `interface DeliveryDeps { fetchFn?: FetchLike; now?: Date }`
  - `const MAX_TENTATIVES = 5`, `const RECULS_MINUTES: readonly number[] = [1, 5, 15, 60]`
  - `interface DistributionReport { abonnements: number; creees: number; tentees: number; reussies: number; echouees: number; abandonnees: number; suspendus: number }`
  - `distributeWebhooks(deps?: DeliveryDeps): Promise<DistributionReport>`
  - `interface DeliveryView { id: string; webhookId: string; webhookLabel: string; seq: number; action: string; state: DeliveryState; attempts: number; responseStatus: number; durationMs: number; lastError: string; createdAt: Date; deliveredAt: Date | null }`
  - `type DeliveryState = 'PENDING' | 'SUCCES' | 'ECHEC' | 'ABANDONNE'`
  - `listDeliveries(userId: string, limit?: number): Promise<DeliveryView[]>`
  - `resendDelivery(userId: string, deliveryId: string, deps?: DeliveryDeps): Promise<DeliveryView>`
  - `sendTestWebhook(userId: string, webhookId: string, deps?: DeliveryDeps): Promise<{ ok: boolean; status: number; durationMs: number; erreur: string }>`

**La distribution lit le journal comme le ferait un consommateur.** Elle ne « reçoit » pas les événements à l'écriture : elle relit `readAuditSince({ since: webhook.lastSeq })` pour chaque abonnement actif, et crée les livraisons manquantes. C'est ce qui rend l'unicité `(webhookId, seq)` suffisante pour l'idempotence, et c'est ce qui garantit qu'un même mécanisme sert la poussée et le tirage — *la poussée est un raccourci vers l'immédiateté, pas un second système*.

**Le corps n'est pas stocké.** Il se reconstruit depuis `AuditEvent.seq`, et le journal est immuable : un renvoi produit donc mécaniquement le même corps et la même signature. Stocker le corps aurait ouvert la possibilité qu'il diverge de la preuve.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/webhooks/delivery.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit, readAuditSince } from '@/services/audit'
import { verifySignature } from '@/core/webhooks/signature'
import {
  EN_TETE_EVENEMENT,
  EN_TETE_SEQ,
  EN_TETE_SIGNATURE,
  SEQ_ESSAI,
} from '@/core/webhooks/payload'
import type { AuditAction } from '@/core/audit/events'
import { createWebhook, updateWebhook } from './subscriptions'
import {
  distributeWebhooks,
  listDeliveries,
  resendDelivery,
  sendTestWebhook,
  MAX_TENTATIVES,
  RECULS_MINUTES,
  type FetchLike,
} from './delivery'

const SECRET = 'secret-de-test'
const NOW = new Date('2026-08-15T10:00:00.000Z')
let userId = ''

interface Appel {
  url: string
  corps: string
  entetes: Record<string, string>
}

/** Double d'appel sortant : enregistre tout, répond ce qu'on lui dit. */
function espion(reponses: Array<number | 'throw'>): { fetchFn: FetchLike; appels: Appel[] } {
  const appels: Appel[] = []
  let i = 0
  const fetchFn: FetchLike = async (url, init) => {
    const entetes: Record<string, string> = {}
    for (const [cle, valeur] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      entetes[cle] = valeur
    }
    appels.push({ url, corps: String(init.body ?? ''), entetes })

    const reponse = reponses[Math.min(i++, reponses.length - 1)]
    if (reponse === 'throw') throw new Error('ECONNREFUSED')
    return new Response('', { status: reponse })
  }
  return { fetchFn, appels }
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'deliv@test.local', name: 'K', passwordHash: 'x' } })
  ).id
})

beforeEach(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  // Écriture directe, et non `updateSettings` : celui-ci consigne
  // `reglage.modifie`, ce qui polluerait le journal que ces tests comptent.
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', webhookMaxEchecs: 10 },
    update: { webhookMaxEchecs: 10 },
  })
})

afterAll(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'deliv@test.local' } })
  await prisma.$disconnect()
})

function abonnement(events: AuditAction[] = []) {
  return createWebhook(userId, {
    label: 'n8n',
    url: 'https://exemple.test/hook',
    events,
    secret: SECRET,
  })
}

async function evenement(action: AuditAction = 'cra.valide', entityId = 'cra_1') {
  return appendAudit({
    ...ACTEUR_SYSTEME,
    action,
    entityType: 'Cra',
    entityId,
    payload: { month: '2026-07' },
  })
}

describe('constantes de reprise', () => {
  it('a un recul par reprise, pas un de plus', () => {
    // Cinq tentatives : la première est immédiate, les quatre suivantes
    // reculent. Un recul de trop laisserait une livraison en attente
    // éternelle après l'abandon.
    expect(RECULS_MINUTES).toHaveLength(MAX_TENTATIVES - 1)
    expect([...RECULS_MINUTES]).toEqual([1, 5, 15, 60])
  })
})

describe('distribution', () => {
  it('poste la charge utile signée, avec ses trois en-têtes', async () => {
    await abonnement()
    const entree = await evenement()
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(1)
    expect(appels[0]!.url).toBe('https://exemple.test/hook')
    expect(appels[0]!.entetes[EN_TETE_EVENEMENT]).toBe('cra.valide')
    expect(appels[0]!.entetes[EN_TETE_SEQ]).toBe(String(entree.seq))

    // Un consommateur recalcule le HMAC du corps brut et retrouve l'en-tête.
    expect(
      verifySignature(SECRET, appels[0]!.corps, appels[0]!.entetes[EN_TETE_SIGNATURE]!),
    ).toBe(true)
    // Un octet de plus, et ce n'est plus valide.
    expect(
      verifySignature(SECRET, `${appels[0]!.corps} `, appels[0]!.entetes[EN_TETE_SIGNATURE]!),
    ).toBe(false)
  })

  it('avance le curseur et ne renvoie jamais deux fois le même événement', async () => {
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })
    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(1)
  })

  it('FILTRE : un abonnement à cra.valide ne reçoit pas saisie.creee', async () => {
    await abonnement(['cra.valide'])
    await evenement('saisie.creee', 't1')
    await evenement('cra.valide', 'cra_1')
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(1)
    expect(appels[0]!.entetes[EN_TETE_EVENEMENT]).toBe('cra.valide')
  })

  it('FILTRE : un abonnement à liste vide reçoit tout', async () => {
    await abonnement([])
    await evenement('saisie.creee', 't1')
    await evenement('cra.valide', 'cra_1')
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels.map((a) => a.entetes[EN_TETE_EVENEMENT])).toEqual(['saisie.creee', 'cra.valide'])
  })

  it('n appelle pas un abonnement suspendu', async () => {
    const w = await abonnement()
    await updateWebhook(userId, w.id, { state: 'SUSPENDU' })
    await evenement()
    const { fetchFn, appels } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    expect(appels).toHaveLength(0)
  })

  it('rend un compte rendu chiffré', async () => {
    await abonnement()
    await evenement()
    const { fetchFn } = espion([200])

    expect(await distributeWebhooks({ fetchFn, now: NOW })).toMatchObject({
      abonnements: 1, creees: 1, tentees: 1, reussies: 1, echouees: 0, abandonnees: 0, suspendus: 0,
    })
  })
})

describe('échec, recul et abandon', () => {
  it('réessaie avec un recul progressif puis abandonne CET événement', async () => {
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([500])

    let instant = NOW
    for (let tour = 1; tour <= MAX_TENTATIVES + 2; tour++) {
      await distributeWebhooks({ fetchFn, now: instant })
      instant = new Date(instant.getTime() + 24 * 60 * 60 * 1000)
    }

    // Cinq tentatives, pas une de plus : après l'abandon, on ne rappelle plus.
    expect(appels).toHaveLength(MAX_TENTATIVES)

    const livraisons = await listDeliveries(userId)
    expect(livraisons[0]).toMatchObject({ state: 'ABANDONNE', attempts: MAX_TENTATIVES })
  })

  it('ne réessaie pas avant l échéance de recul', async () => {
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([500])

    await distributeWebhooks({ fetchFn, now: NOW })
    // 30 secondes plus tard : le premier recul est d'une minute.
    await distributeWebhooks({ fetchFn, now: new Date(NOW.getTime() + 30_000) })

    expect(appels).toHaveLength(1)
  })

  it('traite un appel qui jette comme un échec, sans faire tomber la distribution', async () => {
    await abonnement()
    await evenement()
    const { fetchFn } = espion(['throw'])

    const rapport = await distributeWebhooks({ fetchFn, now: NOW })
    expect(rapport).toMatchObject({ tentees: 1, reussies: 0, echouees: 1 })
    expect((await listDeliveries(userId))[0]!.lastError).toContain('ECONNREFUSED')
  })

  it('un abonnement en échec n empêche pas les autres', async () => {
    const sain = await createWebhook(userId, {
      label: 'sain', url: 'https://sain.test/hook', events: [], secret: SECRET,
    })
    await createWebhook(userId, {
      label: 'mort', url: 'https://mort.test/hook', events: [], secret: SECRET,
    })
    await evenement()

    const appels: string[] = []
    const fetchFn: FetchLike = async (url) => {
      appels.push(url)
      if (url.includes('mort')) throw new Error('ECONNREFUSED')
      return new Response('', { status: 200 })
    }

    const rapport = await distributeWebhooks({ fetchFn, now: NOW })
    expect(appels).toHaveLength(2)
    expect(rapport).toMatchObject({ reussies: 1, echouees: 1 })
    expect((await listDeliveries(userId)).find((d) => d.webhookId === sain.id)!.state).toBe('SUCCES')
  })
})

describe('suspension d un abonnement', () => {
  beforeEach(async () => {
    await prisma.settings.update({ where: { id: 'singleton' }, data: { webhookMaxEchecs: 3 } })
  })

  it('suspend après N échecs consécutifs et le signale', async () => {
    await abonnement()
    for (let i = 1; i <= 3; i++) await evenement('cra.valide', `cra_${i}`)
    const { fetchFn } = espion([500])

    const rapport = await distributeWebhooks({ fetchFn, now: NOW })

    expect(rapport.suspendus).toBe(1)
    const w = (await prisma.webhook.findFirstOrThrow({ where: { userId } }))
    expect(w.state).toBe('SUSPENDU')
    expect(w.consecutiveFailures).toBeGreaterThanOrEqual(3)
    expect(w.lastError).not.toBe('')
    expect(w.suspendedAt).not.toBeNull()
  })

  it('un envoi réussi remet le compteur à zéro', async () => {
    const w = await abonnement()
    await prisma.webhook.update({ where: { id: w.id }, data: { consecutiveFailures: 2 } })
    await evenement()
    const { fetchFn } = espion([200])

    await distributeWebhooks({ fetchFn, now: NOW })

    const relu = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(relu.consecutiveFailures).toBe(0)
    expect(relu.lastError).toBe('')
    expect(relu.state).toBe('ACTIF')
  })

  it('UN ABONNEMENT SUSPENDU NE FAIT PERDRE AUCUN ÉVÉNEMENT', async () => {
    // Le test qui protège la promesse centrale du modèle.
    await abonnement()
    for (let i = 1; i <= 3; i++) await evenement('cra.valide', `cra_${i}`)
    const { fetchFn } = espion([500])

    await distributeWebhooks({ fetchFn, now: NOW })
    expect((await prisma.webhook.findFirstOrThrow({ where: { userId } })).state).toBe('SUSPENDU')

    // Trois événements de plus pendant la suspension.
    for (let i = 4; i <= 6; i++) await evenement('cra.valide', `cra_${i}`)

    // Tout est là, du premier au dernier, lisible par tirage.
    const tout = await readAuditSince({ since: 0, limit: 500 })
    expect(tout.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('renvoi à la main', () => {
  it('produit le même corps et la même signature', async () => {
    await abonnement()
    await evenement()
    const { fetchFn, appels } = espion([500, 200])

    await distributeWebhooks({ fetchFn, now: NOW })
    const livraison = (await listDeliveries(userId))[0]!

    await resendDelivery(userId, livraison.id, { fetchFn, now: NOW })

    expect(appels).toHaveLength(2)
    expect(appels[1]!.corps).toBe(appels[0]!.corps)
    expect(appels[1]!.entetes[EN_TETE_SIGNATURE]).toBe(appels[0]!.entetes[EN_TETE_SIGNATURE])
  })

  it('rouvre une livraison abandonnée', async () => {
    await abonnement()
    await evenement()
    const { fetchFn } = espion([500, 500, 500, 500, 500, 200])

    let instant = NOW
    for (let tour = 1; tour <= MAX_TENTATIVES; tour++) {
      await distributeWebhooks({ fetchFn, now: instant })
      instant = new Date(instant.getTime() + 24 * 60 * 60 * 1000)
    }
    const abandonnee = (await listDeliveries(userId))[0]!
    expect(abandonnee.state).toBe('ABANDONNE')

    const renvoyee = await resendDelivery(userId, abandonnee.id, { fetchFn, now: instant })
    expect(renvoyee.state).toBe('SUCCES')
  })

  it('refuse de renvoyer la livraison d un autre', async () => {
    const autre = await prisma.user.create({
      data: { email: 'deliv-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await createWebhook(autre.id, {
      label: 'a', url: 'https://exemple.test/h', events: [], secret: SECRET,
    })
    await evenement()
    const { fetchFn } = espion([200])
    await distributeWebhooks({ fetchFn, now: NOW })

    const livraison = (await listDeliveries(autre.id))[0]!
    await expect(resendDelivery(userId, livraison.id, { fetchFn, now: NOW })).rejects.toThrow()

    await prisma.user.delete({ where: { id: autre.id } })
  })
})

describe('bouton d essai', () => {
  it('appelle l URL sans rien écrire au journal ni en file', async () => {
    const w = await abonnement()
    await evenement()
    const avantJournal = await prisma.auditEvent.count()
    const { fetchFn, appels } = espion([200])

    const r = await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })

    expect(r).toMatchObject({ ok: true, status: 200 })
    expect(appels).toHaveLength(1)
    expect(await prisma.auditEvent.count()).toBe(avantJournal)
    expect(await prisma.webhookDelivery.count()).toBe(0)
  })

  it('marque l essai par un numéro d ordre nul et une entité dédiée', async () => {
    const w = await abonnement()
    const { fetchFn, appels } = espion([200])

    await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })

    const corps = JSON.parse(appels[0]!.corps)
    expect(corps.seq).toBe(SEQ_ESSAI)
    expect(corps.entity).toEqual({ type: 'Essai', id: 'essai' })
    expect(corps.data).toMatchObject({ essai: true })
  })

  it('signe l essai comme un vrai événement', async () => {
    const w = await abonnement()
    const { fetchFn, appels } = espion([200])
    await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })

    expect(
      verifySignature(SECRET, appels[0]!.corps, appels[0]!.entetes[EN_TETE_SIGNATURE]!),
    ).toBe(true)
  })

  it('rapporte l échec sans suspendre ni compter', async () => {
    const w = await abonnement()
    const { fetchFn } = espion(['throw'])

    const r = await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })
    expect(r.ok).toBe(false)
    expect(r.erreur).toContain('ECONNREFUSED')

    const relu = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(relu.consecutiveFailures).toBe(0)
    expect(relu.state).toBe('ACTIF')
  })

  it('essaie même un abonnement suspendu — c est justement à ça qu il sert', async () => {
    const w = await abonnement()
    await updateWebhook(userId, w.id, { state: 'SUSPENDU' })
    const { fetchFn, appels } = espion([200])

    expect((await sendTestWebhook(userId, w.id, { fetchFn, now: NOW })).ok).toBe(true)
    expect(appels).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/webhooks/delivery.test.ts`
Expected: FAIL — `Failed to resolve import "./delivery"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/webhooks/delivery.ts` :

```ts
import { prisma } from '@/db/client'
import { matchesSubscription, type AuditAction } from '@/core/audit/events'
import {
  buildEventPayload,
  serializeEventPayload,
  EN_TETE_EVENEMENT,
  EN_TETE_SEQ,
  EN_TETE_SIGNATURE,
  SEQ_ESSAI,
  type EventPayload,
} from '@/core/webhooks/payload'
import { signPayload } from '@/core/webhooks/signature'
import { readAuditSince } from '@/services/audit'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface DeliveryDeps {
  /** injectable pour les tests : aucun test n'appelle le réseau */
  fetchFn?: FetchLike
  now?: Date
}

/** Cinq tentatives : la première immédiate, quatre reprises avec recul. */
export const MAX_TENTATIVES = 5
export const RECULS_MINUTES: readonly number[] = [1, 5, 15, 60]

/** Combien d'événements en retard on rattrape par abonnement et par passage. */
const LOT_MAX = 200

export type DeliveryState = 'PENDING' | 'SUCCES' | 'ECHEC' | 'ABANDONNE'

export interface DeliveryView {
  id: string
  webhookId: string
  webhookLabel: string
  seq: number
  action: string
  state: DeliveryState
  attempts: number
  responseStatus: number
  durationMs: number
  lastError: string
  createdAt: Date
  deliveredAt: Date | null
}

export interface DistributionReport {
  abonnements: number
  creees: number
  tentees: number
  reussies: number
  echouees: number
  abandonnees: number
  suspendus: number
}

/** Message d'échec borné : la colonne n'est pas un journal d'exécution. */
function messageDe(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  return brut.slice(0, 500)
}

async function corpsEtSignature(
  secret: string,
  seq: number,
): Promise<{ payload: EventPayload; corps: string; signature: string }> {
  const [entree] = await readAuditSince({ since: seq - 1, limit: 1 })
  if (entree === undefined || entree.seq !== seq) {
    throw new Error(`Journal : l'entrée ${seq} est introuvable.`)
  }

  // Le corps se reconstruit depuis le journal, immuable : c'est ce qui rend
  // un renvoi reproductible à l'octet près, signature comprise.
  const payload = buildEventPayload(entree)
  const corps = serializeEventPayload(payload)
  return { payload, corps, signature: signPayload(secret, corps) }
}

async function poster(
  fetchFn: FetchLike,
  url: string,
  corps: string,
  entetes: { event: string; seq: number; signature: string },
): Promise<{ ok: boolean; status: number; durationMs: number; erreur: string }> {
  const debut = Date.now()
  try {
    const reponse = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [EN_TETE_EVENEMENT]: entetes.event,
        [EN_TETE_SEQ]: String(entetes.seq),
        [EN_TETE_SIGNATURE]: entetes.signature,
      },
      body: corps,
    })
    return {
      ok: reponse.ok,
      status: reponse.status,
      durationMs: Date.now() - debut,
      erreur: reponse.ok ? '' : `Réponse ${reponse.status}`,
    }
  } catch (err) {
    return { ok: false, status: 0, durationMs: Date.now() - debut, erreur: messageDe(err) }
  }
}

type LigneLivraison = Awaited<ReturnType<typeof prisma.webhookDelivery.findFirstOrThrow>>
type LigneAbonnement = Awaited<ReturnType<typeof prisma.webhook.findFirstOrThrow>>

/**
 * Une tentative, et toutes ses conséquences : l'état de la livraison, le
 * compteur d'échecs consécutifs de l'abonnement, et sa suspension éventuelle.
 */
async function tenter(
  livraison: LigneLivraison,
  abonnement: LigneAbonnement,
  now: Date,
  fetchFn: FetchLike,
  maxEchecs: number,
): Promise<{ reussie: boolean; abandonnee: boolean; suspendu: boolean }> {
  const { corps, signature } = await corpsEtSignature(abonnement.secret, livraison.seq)
  const resultat = await poster(fetchFn, abonnement.url, corps, {
    event: livraison.action,
    seq: livraison.seq,
    signature,
  })

  const tentatives = livraison.attempts + 1

  if (resultat.ok) {
    await prisma.webhookDelivery.update({
      where: { id: livraison.id },
      data: {
        state: 'SUCCES',
        attempts: tentatives,
        responseStatus: resultat.status,
        durationMs: resultat.durationMs,
        lastError: '',
        deliveredAt: now,
      },
    })
    // Un envoi réussi remet le compteur à zéro : c'est la succession
    // d'échecs qui dit une URL morte, pas leur cumul historique.
    await prisma.webhook.update({
      where: { id: abonnement.id },
      data: { consecutiveFailures: 0, lastError: '' },
    })
    return { reussie: true, abandonnee: false, suspendu: false }
  }

  const abandonnee = tentatives >= MAX_TENTATIVES
  const reculMinutes = RECULS_MINUTES[tentatives - 1] ?? RECULS_MINUTES[RECULS_MINUTES.length - 1]!

  await prisma.webhookDelivery.update({
    where: { id: livraison.id },
    data: {
      state: abandonnee ? 'ABANDONNE' : 'ECHEC',
      attempts: tentatives,
      responseStatus: resultat.status,
      durationMs: resultat.durationMs,
      lastError: resultat.erreur,
      nextAttemptAt: new Date(now.getTime() + reculMinutes * 60_000),
    },
  })

  const echecs = abonnement.consecutiveFailures + 1
  // Une URL morte rappelée toutes les cinq minutes pendant six mois est un
  // défaut, pas une résilience.
  const suspendu = echecs >= maxEchecs && abonnement.state === 'ACTIF'

  await prisma.webhook.update({
    where: { id: abonnement.id },
    data: {
      consecutiveFailures: echecs,
      lastError: resultat.erreur,
      ...(suspendu && { state: 'SUSPENDU', suspendedAt: now }),
    },
  })

  return { reussie: false, abandonnee, suspendu }
}

/**
 * Un passage complet : mise en file de ce qui manque, puis tentative de tout
 * ce qui est échu.
 *
 * La mise en file **relit le journal comme le ferait un consommateur** —
 * `readAuditSince` depuis le curseur de l'abonnement. Il n'existe donc qu'un
 * seul mécanisme de lecture pour le tirage et pour la poussée, et l'unicité
 * `(webhookId, seq)` suffit à l'idempotence.
 */
export async function distributeWebhooks(deps: DeliveryDeps = {}): Promise<DistributionReport> {
  const now = deps.now ?? new Date()
  const fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init))
  const { webhookMaxEchecs } = await prisma.settings.findUniqueOrThrow({
    where: { id: 'singleton' },
    select: { webhookMaxEchecs: true },
  })

  const abonnements = await prisma.webhook.findMany({ where: { state: 'ACTIF' } })

  const rapport: DistributionReport = {
    abonnements: abonnements.length,
    creees: 0,
    tentees: 0,
    reussies: 0,
    echouees: 0,
    abandonnees: 0,
    suspendus: 0,
  }

  for (const abonnement of abonnements) {
    const entrees = await readAuditSince({ since: abonnement.lastSeq, limit: LOT_MAX })
    if (entrees.length === 0) continue

    for (const entree of entrees) {
      if (!matchesSubscription(abonnement.events, entree.action as AuditAction)) continue

      // `createMany` + `skipDuplicates` n'est pas portable sur SQLite :
      // une création unitaire tolérante au conflit l'est.
      try {
        await prisma.webhookDelivery.create({
          data: {
            webhookId: abonnement.id,
            seq: entree.seq,
            action: entree.action,
            nextAttemptAt: now,
          },
        })
        rapport.creees++
      } catch {
        // Déjà en file pour cet abonnement : c'est exactement ce que
        // l'unicité (webhookId, seq) doit produire.
      }
    }

    await prisma.webhook.update({
      where: { id: abonnement.id },
      data: { lastSeq: entrees[entrees.length - 1]!.seq },
    })
  }

  // Deuxième temps : on tente. Relire l'abonnement à chaque livraison est
  // délibéré — sans cela, une suspension décidée à la livraison n° 3 ne
  // serait pas vue par la livraison n° 4 du même passage.
  const echues = await prisma.webhookDelivery.findMany({
    where: { state: { in: ['PENDING', 'ECHEC'] }, nextAttemptAt: { lte: now } },
    orderBy: { seq: 'asc' },
  })

  for (const livraison of echues) {
    const abonnement = await prisma.webhook.findUnique({ where: { id: livraison.webhookId } })
    if (abonnement === null || abonnement.state !== 'ACTIF') continue

    rapport.tentees++
    // L'échec d'un abonnement ne doit jamais interrompre le passage.
    try {
      const issue = await tenter(livraison, abonnement, now, fetchFn, webhookMaxEchecs)
      if (issue.reussie) rapport.reussies++
      else rapport.echouees++
      if (issue.abandonnee) rapport.abandonnees++
      if (issue.suspendu) rapport.suspendus++
    } catch (err) {
      rapport.echouees++
      await prisma.webhookDelivery.update({
        where: { id: livraison.id },
        data: { state: 'ECHEC', lastError: messageDe(err) },
      })
    }
  }

  return rapport
}

type LigneAvecAbonnement = LigneLivraison & { webhook: { label: string } }

function toDeliveryView(row: LigneAvecAbonnement): DeliveryView {
  return {
    id: row.id,
    webhookId: row.webhookId,
    webhookLabel: row.webhook.label,
    seq: row.seq,
    action: row.action,
    state: row.state as DeliveryState,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    durationMs: row.durationMs,
    lastError: row.lastError,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
  }
}

export async function listDeliveries(userId: string, limit = 100): Promise<DeliveryView[]> {
  const rows = await prisma.webhookDelivery.findMany({
    where: { webhook: { userId } },
    include: { webhook: { select: { label: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.map(toDeliveryView)
}

/**
 * Renvoi à la main depuis la supervision. Le corps et la signature sont
 * **identiques** à ceux de la première tentative : ils se reconstruisent
 * depuis une entrée de journal qui n'a pas pu changer.
 */
export async function resendDelivery(
  userId: string,
  deliveryId: string,
  deps: DeliveryDeps = {},
): Promise<DeliveryView> {
  const now = deps.now ?? new Date()
  const fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init))
  const { webhookMaxEchecs } = await prisma.settings.findUniqueOrThrow({
    where: { id: 'singleton' },
    select: { webhookMaxEchecs: true },
  })

  const livraison = await prisma.webhookDelivery.findFirstOrThrow({
    where: { id: deliveryId, webhook: { userId } },
  })
  const abonnement = await prisma.webhook.findUniqueOrThrow({ where: { id: livraison.webhookId } })

  // Un renvoi rouvre le compteur de tentatives : c'est un geste humain,
  // délibéré, sur une livraison qu'on a décidé de ne pas laisser tomber.
  const rouverte = await prisma.webhookDelivery.update({
    where: { id: livraison.id },
    data: { state: 'PENDING', attempts: 0, nextAttemptAt: now },
  })

  await tenter(rouverte, abonnement, now, fetchFn, webhookMaxEchecs)

  const relu = await prisma.webhookDelivery.findFirstOrThrow({
    where: { id: livraison.id },
    include: { webhook: { select: { label: true } } },
  })
  return toDeliveryView(relu)
}

/**
 * Le bouton d'essai : vérifier qu'une URL répond **avant** d'en dépendre.
 *
 * Il n'écrit rien — ni au journal, ni en file — et ne touche ni au compteur
 * d'échecs ni à l'état de l'abonnement. Il fonctionne sur un abonnement
 * suspendu : c'est précisément le moment où l'on veut savoir si l'URL est
 * revenue.
 *
 * `seq: 0` marque l'essai : le journal numérote à partir de 1, un
 * consommateur distingue donc l'essai sans vocabulaire supplémentaire.
 */
export async function sendTestWebhook(
  userId: string,
  webhookId: string,
  deps: DeliveryDeps = {},
): Promise<{ ok: boolean; status: number; durationMs: number; erreur: string }> {
  const now = deps.now ?? new Date()
  const fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init))

  const abonnement = await prisma.webhook.findFirstOrThrow({ where: { id: webhookId, userId } })

  const payload = buildEventPayload({
    seq: SEQ_ESSAI,
    occurredAt: now,
    action: 'cra.valide',
    actorId: '',
    actorLabel: 'SYSTEME',
    entityType: 'Essai',
    entityId: 'essai',
    payload: { essai: true, abonnement: abonnement.label },
  })
  const corps = serializeEventPayload(payload)

  return poster(fetchFn, abonnement.url, corps, {
    event: payload.event,
    seq: SEQ_ESSAI,
    signature: signPayload(abonnement.secret, corps),
  })
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/webhooks/`
Expected: PASS — 22 tests dans `delivery.test.ts`, plus les 17 de `subscriptions.test.ts`

- [ ] **Step 5: Vérifier par mutation**

Quatre mutations, restaurer après chacune.

1. Retirer le filtre `matchesSubscription` → « un abonnement à cra.valide ne reçoit pas saisie.creee » doit échouer.
2. Remplacer `abandonnee = tentatives >= MAX_TENTATIVES` par `false` → « réessaie … puis abandonne CET événement » doit échouer.
3. Retirer la remise à zéro de `consecutiveFailures` au succès → « un envoi réussi remet le compteur à zéro » doit échouer.
4. Dans `sendTestWebhook`, créer une `WebhookDelivery` avant de poster → « appelle l URL sans rien écrire au journal ni en file » doit échouer.

- [ ] **Step 6: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add src/services/webhooks/delivery.ts src/services/webhooks/delivery.test.ts
git commit -m "feat(webhooks): signed delivery with backoff, abandon and subscription suspension"
```

---

## Task 11: Le courriel — envoi minimal, ou consignation

**Files:** Create `src/integrations/smtp/mailer.ts`, `src/services/notify.ts`, `src/services/notify.test.ts`. Modify `package.json`

**Interfaces:**
- Consumes: `Gabarit` (tâche 7), `getSettings` / `readSettingsRow` (existants)
- Produces:
  - `type Mailer = (message: { to: string; sujet: string; corps: string }) => Promise<void>`
  - `interface SmtpConfig { host: string; port: number; user: string; from: string; secure: boolean; password: string }`
  - `readSmtpConfig(): Promise<SmtpConfig | null>` — `null` tant que la configuration est incomplète
  - `buildSmtpMailer(config: SmtpConfig): Mailer`
  - `interface NotifyResult { envoye: boolean; motif: string }`
  - `notify(gabarit: Gabarit, deps?: { mailer?: Mailer | null; destinataire?: string }): Promise<NotifyResult>`

**Deux issues, et une seule est tolérée.** L'**absence** de configuration SMTP ne fait pas échouer un travail : elle rend `{ envoye: false, motif }`, et l'ordonnanceur consigne au lieu de tomber — c'est l'autoportance qui l'exige, l'envoi de courriel n'étant pas le métier de cette application. Une **erreur d'envoi**, elle, remonte : elle est actionnable, et un travail qui échoue apparaît dans la supervision. Confondre les deux ferait disparaître les vraies pannes.

**Pourquoi un envoi intégré malgré l'API.** Un consommateur de l'API s'en charge mieux — n8n dispose de gabarits, de relances et du compte Google déjà autorisé. Mais sans aucun outil externe, les rappels doivent partir : c'est le minimum d'autoportance.

- [ ] **Step 1: Ajouter la dépendance**

```bash
npm i nodemailer
npx tsc --noEmit
```

Si `tsc` signale l'absence de déclarations pour `nodemailer`, ajouter alors — et seulement alors — le paquet de types :

```bash
npm i -D @types/nodemailer
npx tsc --noEmit
```

Installer `@types/nodemailer` sans en avoir besoin peut au contraire masquer les types embarqués et faire diverger la signature : la vérification décide, pas l'habitude.

- [ ] **Step 2: Écrire le test qui échoue**

`src/services/notify.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { gabaritRuptureJournal } from '@/core/notify/templates'
import { notify, readSmtpConfig, type Mailer } from './notify'

const GABARIT = gabaritRuptureJournal({ seq: 412, raison: 'EMPREINTE' })
const MOT_DE_PASSE = process.env.SMTP_PASSWORD

beforeAll(async () => {
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton' }, update: {} })
})

beforeEach(async () => {
  await prisma.settings.update({
    where: { id: 'singleton' },
    data: {
      notificationEmail: '',
      smtpHost: '', smtpPort: 0, smtpUser: '', smtpFrom: '', smtpSecure: true,
    },
  })
  delete process.env.SMTP_PASSWORD
})

afterAll(async () => {
  if (MOT_DE_PASSE === undefined) delete process.env.SMTP_PASSWORD
  else process.env.SMTP_PASSWORD = MOT_DE_PASSE
  await prisma.$disconnect()
})

function espion(): { mailer: Mailer; envois: Array<{ to: string; sujet: string; corps: string }> } {
  const envois: Array<{ to: string; sujet: string; corps: string }> = []
  return {
    envois,
    mailer: async (message) => {
      envois.push(message)
    },
  }
}

describe('lecture de la configuration SMTP', () => {
  it('rend null tant qu il manque quelque chose', async () => {
    expect(await readSmtpConfig()).toBeNull()

    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { smtpHost: 'smtp.exemple.test', smtpPort: 587, smtpFrom: 'cra@exemple.test' },
    })
    // Le mot de passe manque encore : il vit dans l'environnement.
    expect(await readSmtpConfig()).toBeNull()
  })

  it('rend la configuration quand tout est là', async () => {
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: {
        smtpHost: 'smtp.exemple.test', smtpPort: 587, smtpUser: 'cra',
        smtpFrom: 'cra@exemple.test', smtpSecure: false,
      },
    })
    process.env.SMTP_PASSWORD = 'motdepasse'

    expect(await readSmtpConfig()).toEqual({
      host: 'smtp.exemple.test', port: 587, user: 'cra',
      from: 'cra@exemple.test', secure: false, password: 'motdepasse',
    })
  })
})

describe('notification', () => {
  it('envoie au destinataire configuré', async () => {
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { notificationEmail: 'keveen@exemple.test' },
    })
    const { mailer, envois } = espion()

    expect(await notify(GABARIT, { mailer })).toEqual({ envoye: true, motif: '' })
    expect(envois).toEqual([
      { to: 'keveen@exemple.test', sujet: GABARIT.sujet, corps: GABARIT.corps },
    ])
  })

  it('SANS CONFIGURATION SMTP, consigne au lieu d échouer', async () => {
    // C'est ce qui permet à l'ordonnanceur de tourner sur une instance nue.
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { notificationEmail: 'keveen@exemple.test' },
    })

    const r = await notify(GABARIT)
    expect(r.envoye).toBe(false)
    expect(r.motif).toContain('SMTP')
  })

  it('sans destinataire, ne tente rien et le dit', async () => {
    const { mailer, envois } = espion()
    const r = await notify(GABARIT, { mailer })

    expect(r).toMatchObject({ envoye: false })
    expect(r.motif).toContain('destinataire')
    expect(envois).toHaveLength(0)
  })

  it('LAISSE REMONTER une erreur d envoi', async () => {
    // L'absence de configuration est tolérée ; une panne d'envoi, non — elle
    // est actionnable, et doit apparaître dans la supervision.
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { notificationEmail: 'keveen@exemple.test' },
    })
    const mailer: Mailer = async () => {
      throw new Error('EAUTH')
    }

    await expect(notify(GABARIT, { mailer })).rejects.toThrow(/EAUTH/)
  })

  it('accepte un destinataire explicite', async () => {
    const { mailer, envois } = espion()
    await notify(GABARIT, { mailer, destinataire: 'autre@exemple.test' })
    expect(envois[0]!.to).toBe('autre@exemple.test')
  })
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/notify.test.ts`
Expected: FAIL — `Failed to resolve import "./notify"`

- [ ] **Step 4: Écrire le transport**

`src/integrations/smtp/mailer.ts` :

```ts
import nodemailer from 'nodemailer'
import type { Mailer, SmtpConfig } from '@/services/notify'

/**
 * Transport SMTP minimal. Isolé dans `integrations/` parce que c'est le seul
 * endroit qui connaisse `nodemailer` : `services/notify.ts` ne manipule que
 * le type `Mailer`, ce qui rend chaque test capable d'injecter un double
 * sans que la moindre connexion ne soit ouverte.
 */
export function buildSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user !== '' && { auth: { user: config.user, pass: config.password } }),
  })

  return async ({ to, sujet, corps }) => {
    await transport.sendMail({ from: config.from, to, subject: sujet, text: corps })
  }
}
```

- [ ] **Step 5: Écrire le service**

`src/services/notify.ts` :

```ts
import { prisma } from '@/db/client'
import type { Gabarit } from '@/core/notify/templates'

export type Mailer = (message: { to: string; sujet: string; corps: string }) => Promise<void>

export interface SmtpConfig {
  host: string
  port: number
  user: string
  from: string
  secure: boolean
  /** vient de l'environnement, jamais de la base */
  password: string
}

export interface NotifyResult {
  envoye: boolean
  /** vide quand l'envoi a eu lieu ; sinon, ce qui a manqué */
  motif: string
}

/**
 * La configuration SMTP, ou `null` s'il manque quoi que ce soit.
 *
 * Le serveur, le port et l'adresse d'expédition sont des réglages ; le
 * **secret d'authentification vit dans l'environnement**, comme
 * `AUTH_SECRET`. Il peut être vide sur un relais qui n'authentifie pas — mais
 * pas s'il y a un utilisateur, sinon la connexion échouerait à l'envoi plutôt
 * qu'ici, où le diagnostic est lisible.
 */
export async function readSmtpConfig(): Promise<SmtpConfig | null> {
  const row = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: {
      smtpHost: true, smtpPort: true, smtpUser: true, smtpFrom: true, smtpSecure: true,
    },
  })
  if (row === null) return null

  const password = process.env.SMTP_PASSWORD ?? ''
  const incomplet =
    row.smtpHost === '' ||
    row.smtpPort <= 0 ||
    row.smtpFrom === '' ||
    (row.smtpUser !== '' && password === '')

  if (incomplet) return null

  return {
    host: row.smtpHost,
    port: row.smtpPort,
    user: row.smtpUser,
    from: row.smtpFrom,
    secure: row.smtpSecure,
    password,
  }
}

/**
 * Envoie une notification, ou explique pourquoi elle n'est pas partie.
 *
 * **Ne lève pas** quand rien n'est configuré : sans configuration SMTP,
 * l'ordonnanceur doit tourner et consigner, pas échouer. **Laisse en
 * revanche remonter** une erreur d'envoi : celle-là est actionnable, et doit
 * apparaître comme un travail en échec dans la supervision.
 */
export async function notify(
  gabarit: Gabarit,
  deps: { mailer?: Mailer | null; destinataire?: string } = {},
): Promise<NotifyResult> {
  const reglages = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { notificationEmail: true },
  })
  const to = deps.destinataire ?? reglages?.notificationEmail ?? ''

  if (to === '') {
    return {
      envoye: false,
      motif: "Aucun destinataire de notification n'est configuré — rien n'a été envoyé.",
    }
  }

  let mailer = deps.mailer ?? null
  if (mailer === null) {
    const config = await readSmtpConfig()
    if (config === null) {
      return {
        envoye: false,
        motif: "SMTP n'est pas configuré — la notification a été consignée sans être envoyée.",
      }
    }
    // Import différé : `services/` ne doit pas tirer `nodemailer` dans tous
    // les rendus qui n'envoient jamais rien.
    const { buildSmtpMailer } = await import('@/integrations/smtp/mailer')
    mailer = buildSmtpMailer(config)
  }

  await mailer({ to, sujet: gabarit.sujet, corps: gabarit.corps })
  return { envoye: true, motif: '' }
}
```

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/notify.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 7: Vérifier par mutation**

Entourer l'appel `await mailer(...)` d'un `try/catch` renvoyant `{ envoye: false, motif }` → « LAISSE REMONTER une erreur d envoi » doit échouer. Restaurer.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/integrations/smtp/mailer.ts src/services/notify.ts src/services/notify.test.ts
git commit -m "feat(notify): minimal SMTP sending that degrades to logging when unconfigured"
```

---

## Task 12: L'ordonnanceur

**Files:** Create `src/services/jobs/registry.ts`, `src/services/jobs/scheduler.ts`, `src/services/jobs/scheduler.test.ts`, `src/app/api/jobs/tick/route.ts`, `src/app/api/jobs/tick/route.test.ts`

**Interfaces:**
- Consumes: `appendAudit`, `ACTEUR_SYSTEME` (tâche 4) ; `requireApiToken` (tâche 8) ; `FetchLike` (tâche 10)
- Produces:
  - `interface JobContext { now: Date; userId: string; fetchFn?: FetchLike }`
  - `interface JobResult { message: string }`
  - `type JobHandler = (ctx: JobContext) => Promise<JobResult>`
  - `interface JobDefinition { name: string; label: string; intervalMinutes: number; enabledByDefault: boolean }`
  - `const JOB_DEFINITIONS: readonly JobDefinition[]` — les **sept** travaux de la spec
  - `const TRAVAUX_DIFFERES: Readonly<Record<string, string>>` — nom → lot qui le portera
  - `const JOB_HANDLERS: Readonly<Record<string, JobHandler>>` — les quatre de ce lot
  - `type JobState = 'SUCCES' | 'ECHEC' | 'IGNORE' | 'INDISPONIBLE'`
  - `interface JobReport { name: string; state: JobState; message: string; durationMs: number }`
  - `interface TickReport { horodatage: string; dus: number; executes: JobReport[] }`
  - `interface JobView { name: string; label: string; intervalMinutes: number; enabled: boolean; disponible: boolean; lastRunAt: Date | null; nextRunAt: Date; lastState: string; lastError: string }`
  - `syncJobDefinitions(): Promise<void>`
  - `listJobs(): Promise<JobView[]>`
  - `setJobEnabled(userId: string, name: string, enabled: boolean): Promise<JobView>`
  - `tick(args?: { now?: Date; userId?: string; handlers?: Readonly<Record<string, JobHandler>>; fetchFn?: FetchLike }): Promise<TickReport>`
  - `runJobNow(userId: string, name: string, args?: { now?: Date; handlers?: Readonly<Record<string, JobHandler>>; fetchFn?: FetchLike }): Promise<JobReport>`
  - `POST /api/jobs/tick` → `TickReport`

**La liste est en dur, et les sept y figurent.** Un moteur de règles configurable serait un produit dans le produit — et l'API existe précisément pour ça. Mais trois des sept appartiennent à des lots que ce plan ne touche pas : `outbox.flush` (lots 1b/2) et les deux travaux de signature (lot 3). Ils sont **déclarés, désactivés par défaut, et rendus `INDISPONIBLE`** tant qu'aucun traitement n'est enregistré. C'est plus honnête que de les omettre — l'écran de supervision dit alors « livré par le lot 3 » au lieu de mentir par le silence — et plus honnête que de les faire échouer en boucle : un échec perpétuel noierait les vraies alertes, et « pas de notification pour ce qui n'appelle aucune action » vaut aussi pour l'écran.

**Raccordement des lots à venir.** Un lot qui livre son travail ajoute une entrée à `JOB_HANDLERS` et retire son nom de `TRAVAUX_DIFFERES` ; le test « chaque travail déclaré est traité ou explicitement différé » l'y oblige. Aucune signature inventée ici : la seule contrainte est de fournir un `JobHandler`.

**À exécuter après la tâche 13.** `registry.ts` importe les quatre traitements qu'elle écrit. Le graphe de dépendances le dit (12 ← 13) ; la numérotation suit l'ordre de lecture, pas l'ordre d'implémentation.

**Limite connue, assumée.** `tick` exécute les travaux pour le **propriétaire de l'instance** — le plus ancien utilisateur. C'est la conséquence directe de la décision « mono-organisation, pas de multi-tenant » : un réveil externe n'a pas de session. `runJobNow` utilise, lui, l'utilisateur qui clique.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/jobs/scheduler.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { readAuditSince } from '@/services/audit'
import {
  JOB_DEFINITIONS,
  JOB_HANDLERS,
  TRAVAUX_DIFFERES,
  type JobHandler,
} from './registry'
import { listJobs, runJobNow, setJobEnabled, syncJobDefinitions, tick } from './scheduler'

const NOW = new Date('2026-08-15T10:00:00.000Z')
let userId = ''

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'jobs@test.local', name: 'K', passwordHash: 'x' } })
  ).id
})

beforeEach(async () => {
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'jobs@test.local' } })
  await prisma.$disconnect()
})

/** Registre de test : déterministe, sans effet de bord. */
function registre(overrides: Record<string, JobHandler>): Record<string, JobHandler> {
  return { ...JOB_HANDLERS, ...overrides }
}

describe('le registre', () => {
  it('déclare les sept travaux de la spec', () => {
    expect(JOB_DEFINITIONS.map((d) => d.name)).toEqual([
      'outbox.flush',
      'webhooks.distribute',
      'rappel.saisie',
      'rappel.cloture',
      'signature.relance',
      'signature.rafraichissement',
      'journal.verification',
    ])
  })

  it('chaque travail déclaré est traité, ou explicitement différé', () => {
    // Le jour où un lot livre son travail, il retire son nom d'ici — et ce
    // test l'y oblige plutôt que de laisser pourrir un travail orphelin.
    for (const definition of JOB_DEFINITIONS) {
      const traite = definition.name in JOB_HANDLERS
      const differe = definition.name in TRAVAUX_DIFFERES
      expect(traite !== differe, `travail « ${definition.name} »`).toBe(true)
    }
  })

  it('les travaux différés sont désactivés par défaut', () => {
    for (const definition of JOB_DEFINITIONS) {
      if (definition.name in TRAVAUX_DIFFERES) {
        expect(definition.enabledByDefault, definition.name).toBe(false)
      }
    }
  })

  it('nomme le lot qui portera chaque travail différé', () => {
    expect(Object.keys(TRAVAUX_DIFFERES)).toEqual([
      'outbox.flush', 'signature.relance', 'signature.rafraichissement',
    ])
    for (const lot of Object.values(TRAVAUX_DIFFERES)) {
      expect(lot).toMatch(/lot/i)
    }
  })

  it('donne une récurrence exploitable à chacun', () => {
    for (const d of JOB_DEFINITIONS) {
      expect(Number.isInteger(d.intervalMinutes) && d.intervalMinutes > 0, d.name).toBe(true)
    }
  })
})

describe('synchronisation des déclarations', () => {
  it('crée une ligne par travail déclaré', async () => {
    await syncJobDefinitions()
    expect(await prisma.scheduledJob.count()).toBe(JOB_DEFINITIONS.length)
  })

  it('n écrase pas l état d un travail déjà connu', async () => {
    await syncJobDefinitions()
    await setJobEnabled(userId, 'rappel.saisie', false)
    await prisma.scheduledJob.update({
      where: { name: 'rappel.saisie' },
      data: { lastRunAt: NOW, lastState: 'SUCCES' },
    })

    await syncJobDefinitions()

    const relu = await prisma.scheduledJob.findUniqueOrThrow({ where: { name: 'rappel.saisie' } })
    expect(relu.enabled).toBe(false)
    expect(relu.lastState).toBe('SUCCES')
  })
})

describe('réveil', () => {
  it('exécute un travail échu', async () => {
    const vus: string[] = []
    const rapport = await tick({
      now: NOW,
      userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          vus.push('webhooks.distribute')
          return { message: 'ok' }
        },
      }),
    })

    expect(vus).toContain('webhooks.distribute')
    expect(rapport.executes.find((e) => e.name === 'webhooks.distribute')).toMatchObject({
      state: 'SUCCES', message: 'ok',
    })
  })

  it('n exécute pas un travail non échu', async () => {
    await syncJobDefinitions()
    await prisma.scheduledJob.update({
      where: { name: 'webhooks.distribute' },
      data: { nextRunAt: new Date(NOW.getTime() + 60 * 60 * 1000) },
    })

    const rapport = await tick({ now: NOW, userId })
    expect(rapport.executes.map((e) => e.name)).not.toContain('webhooks.distribute')
  })

  it('DEUX RÉVEILS RAPPROCHÉS N EXÉCUTENT PAS DEUX FOIS LE MÊME TRAVAIL', async () => {
    let appels = 0
    const handlers = registre({
      'webhooks.distribute': async () => {
        appels++
        return { message: 'ok' }
      },
    })

    await tick({ now: NOW, userId, handlers })
    await tick({ now: new Date(NOW.getTime() + 60_000), userId, handlers })

    // La récurrence est de cinq minutes : le second réveil est trop tôt.
    expect(appels).toBe(1)
  })

  it('n exécute pas un travail désactivé', async () => {
    await syncJobDefinitions()
    await setJobEnabled(userId, 'webhooks.distribute', false)

    let appels = 0
    await tick({
      now: NOW, userId,
      handlers: registre({ 'webhooks.distribute': async () => { appels++; return { message: '' } } }),
    })
    expect(appels).toBe(0)
  })

  it('UN TRAVAIL EN ÉCHEC N EMPÊCHE PAS LES SUIVANTS', async () => {
    // `rappel.saisie` est désactivé par défaut : sans cette activation, le
    // test ne prouverait rien — il n'y aurait qu'un seul travail à échouer.
    await syncJobDefinitions()
    await setJobEnabled(userId, 'rappel.saisie', true)

    const reussis: string[] = []
    const rapport = await tick({
      now: NOW, userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          throw new Error('URL injoignable')
        },
        'rappel.saisie': async () => {
          reussis.push('rappel.saisie')
          return { message: 'rien à signaler' }
        },
        'journal.verification': async () => {
          reussis.push('journal.verification')
          return { message: 'chaîne intacte' }
        },
      }),
    })

    expect(reussis).toEqual(['journal.verification', 'rappel.saisie'])
    expect(rapport.executes.find((e) => e.name === 'webhooks.distribute')).toMatchObject({
      state: 'ECHEC',
    })
    expect(
      rapport.executes.filter((e) => e.state === 'SUCCES').map((e) => e.name).sort(),
    ).toEqual(['journal.verification', 'rappel.saisie'])
  })

  it('consigne travail.echoue, une entrée par échec', async () => {
    await tick({
      now: NOW, userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          throw new Error('URL injoignable')
        },
      }),
    })

    const journal = (await readAuditSince({ since: 0 })).filter((e) => e.action === 'travail.echoue')
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      entityType: 'ScheduledJob', entityId: 'webhooks.distribute', actorId: '', actorLabel: 'SYSTEME',
    })
    expect(journal[0]!.payload).toMatchObject({ erreur: 'URL injoignable' })
  })

  it('retient la dernière erreur et repousse quand même l échéance', async () => {
    await tick({
      now: NOW, userId,
      handlers: registre({
        'webhooks.distribute': async () => {
          throw new Error('URL injoignable')
        },
      }),
    })

    const relu = await prisma.scheduledJob.findUniqueOrThrow({ where: { name: 'webhooks.distribute' } })
    expect(relu.lastState).toBe('ECHEC')
    expect(relu.lastError).toContain('URL injoignable')
    expect(relu.attempts).toBe(1)
    // Un travail périodique repassera : le marteler en boucle n'aide personne.
    expect(relu.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime())
    expect(relu.runningSince).toBeNull()
  })

  it('marque INDISPONIBLE un travail déclaré sans traitement, sans le compter en échec', async () => {
    await syncJobDefinitions()
    await setJobEnabled(userId, 'outbox.flush', true)

    const rapport = await tick({ now: NOW, userId })

    const ligne = rapport.executes.find((e) => e.name === 'outbox.flush')
    expect(ligne).toMatchObject({ state: 'INDISPONIBLE' })
    expect(ligne!.message).toMatch(/lot/i)
    expect(
      (await readAuditSince({ since: 0 })).filter((e) => e.action === 'travail.echoue'),
    ).toHaveLength(0)
  })

  it('saute un travail encore en cours', async () => {
    await syncJobDefinitions()
    await prisma.scheduledJob.update({
      where: { name: 'webhooks.distribute' },
      data: { runningSince: new Date(NOW.getTime() - 60_000) },
    })

    let appels = 0
    const rapport = await tick({
      now: NOW, userId,
      handlers: registre({ 'webhooks.distribute': async () => { appels++; return { message: '' } } }),
    })

    expect(appels).toBe(0)
    expect(rapport.executes.find((e) => e.name === 'webhooks.distribute')).toMatchObject({
      state: 'IGNORE',
    })
  })

  it('reprend un verrou périmé plutôt que de bloquer à jamais', async () => {
    await syncJobDefinitions()
    await prisma.scheduledJob.update({
      where: { name: 'webhooks.distribute' },
      data: { runningSince: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) },
    })

    let appels = 0
    await tick({
      now: NOW, userId,
      handlers: registre({ 'webhooks.distribute': async () => { appels++; return { message: '' } } }),
    })
    expect(appels).toBe(1)
  })
})

describe('exécution à la main', () => {
  it('exécute un travail même hors échéance', async () => {
    await syncJobDefinitions()
    await prisma.scheduledJob.update({
      where: { name: 'rappel.saisie' },
      data: { nextRunAt: new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000) },
    })

    let appels = 0
    const rapport = await runJobNow(userId, 'rappel.saisie', {
      now: NOW,
      handlers: registre({ 'rappel.saisie': async () => { appels++; return { message: 'fait' } } }),
    })

    expect(appels).toBe(1)
    expect(rapport).toMatchObject({ name: 'rappel.saisie', state: 'SUCCES', message: 'fait' })
  })

  it('exécute même un travail désactivé — un automatisme qu on ne peut pas déclencher soi-même ne se débogue pas', async () => {
    await syncJobDefinitions()
    await setJobEnabled(userId, 'rappel.cloture', false)

    let appels = 0
    await runJobNow(userId, 'rappel.cloture', {
      now: NOW,
      handlers: registre({ 'rappel.cloture': async () => { appels++; return { message: '' } } }),
    })
    expect(appels).toBe(1)
  })

  it('refuse un nom inconnu', async () => {
    await expect(runJobNow(userId, 'travail.inexistant', { now: NOW })).rejects.toThrow()
  })
})

describe('vue des travaux', () => {
  it('expose l état de chacun, disponibilité comprise', async () => {
    await syncJobDefinitions()
    const vues = await listJobs()

    expect(vues).toHaveLength(JOB_DEFINITIONS.length)
    expect(vues.find((v) => v.name === 'journal.verification')!.disponible).toBe(true)
    expect(vues.find((v) => v.name === 'outbox.flush')!.disponible).toBe(false)
    for (const v of vues) {
      expect(v.label.length).toBeGreaterThan(0)
    }
  })
})
```

`src/app/api/jobs/tick/route.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { POST } from './route'

const JETON = 'jeton-de-test-tick'
const ORIGINAL = process.env.CRA_API_TOKEN

beforeAll(async () => {
  process.env.CRA_API_TOKEN = JETON
  await prisma.user.create({ data: { email: 'tick@test.local', name: 'K', passwordHash: 'x' } })
})

beforeEach(async () => {
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'tick@test.local' } })
  if (ORIGINAL === undefined) delete process.env.CRA_API_TOKEN
  else process.env.CRA_API_TOKEN = ORIGINAL
  await prisma.$disconnect()
})

function appel(jeton: string | null = JETON): Promise<Response> {
  return POST(
    new Request('https://exemple.test/api/jobs/tick', {
      method: 'POST',
      headers: jeton === null ? {} : { authorization: `Bearer ${jeton}` },
    }),
  )
}

describe('POST /api/jobs/tick', () => {
  it('refuse sans jeton', async () => {
    expect((await appel(null)).status).toBe(401)
  })

  it('rend un compte rendu', async () => {
    const reponse = await appel()
    expect(reponse.status).toBe(200)

    const corps = await reponse.json()
    expect(corps).toMatchObject({ horodatage: expect.any(String) })
    expect(Array.isArray(corps.executes)).toBe(true)
  })

  it('déclare les travaux au premier réveil', async () => {
    await appel()
    expect(await prisma.scheduledJob.count()).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/jobs/ src/app/api/jobs/`
Expected: FAIL — imports non résolus

- [ ] **Step 3: Écrire le registre**

`src/services/jobs/registry.ts` :

```ts
import type { FetchLike } from '@/services/webhooks/delivery'
import {
  distributionRappels,
  rappelCloture,
  rappelSaisie,
  verificationJournal,
} from './handlers'

export interface JobContext {
  now: Date
  /** propriétaire de l'instance sous un réveil externe, appelant sous un clic */
  userId: string
  fetchFn?: FetchLike
}

export interface JobResult {
  /** ce que la supervision affichera : un travail muet n'apprend rien */
  message: string
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>

export interface JobDefinition {
  name: string
  label: string
  intervalMinutes: number
  enabledByDefault: boolean
}

const JOUR = 24 * 60

/**
 * **Liste en dur**, et volontairement : un moteur de règles configurable
 * serait un produit dans le produit, et l'API d'événements existe
 * précisément pour que les enchaînements vivent dehors.
 *
 * Les sept travaux de la spec y figurent, y compris ceux dont le traitement
 * appartient à un autre lot — les omettre ferait mentir l'écran de
 * supervision par le silence.
 */
export const JOB_DEFINITIONS: readonly JobDefinition[] = [
  { name: 'outbox.flush', label: 'Vidage de la file de sortie', intervalMinutes: 5, enabledByDefault: false },
  { name: 'webhooks.distribute', label: 'Distribution des rappels sortants', intervalMinutes: 5, enabledByDefault: true },
  { name: 'rappel.saisie', label: 'Rappel de saisie', intervalMinutes: JOUR, enabledByDefault: false },
  { name: 'rappel.cloture', label: 'Rappel de clôture', intervalMinutes: JOUR, enabledByDefault: false },
  { name: 'signature.relance', label: 'Relance de signature', intervalMinutes: JOUR, enabledByDefault: false },
  { name: 'signature.rafraichissement', label: 'Rafraîchissement des signatures', intervalMinutes: JOUR, enabledByDefault: false },
  { name: 'journal.verification', label: 'Vérification de la chaîne du journal', intervalMinutes: JOUR, enabledByDefault: true },
]

/**
 * Les travaux déclarés dont le traitement viendra d'un autre lot. Un lot qui
 * livre le sien ajoute son entrée à `JOB_HANDLERS` **et** retire son nom
 * d'ici — le test « chaque travail déclaré est traité, ou explicitement
 * différé » l'y oblige.
 */
export const TRAVAUX_DIFFERES: Readonly<Record<string, string>> = {
  'outbox.flush': 'lot 1b / lot 2',
  'signature.relance': 'lot 3',
  'signature.rafraichissement': 'lot 3',
}

/** Les quatre travaux que ce lot porte. */
export const JOB_HANDLERS: Readonly<Record<string, JobHandler>> = {
  'webhooks.distribute': distributionRappels,
  'rappel.saisie': rappelSaisie,
  'rappel.cloture': rappelCloture,
  'journal.verification': verificationJournal,
}
```

- [ ] **Step 4: Écrire l'ordonnanceur**

`src/services/jobs/scheduler.ts` :

```ts
import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import type { FetchLike } from '@/services/webhooks/delivery'
import {
  JOB_DEFINITIONS,
  JOB_HANDLERS,
  TRAVAUX_DIFFERES,
  type JobDefinition,
  type JobHandler,
} from './registry'

export type JobState = 'SUCCES' | 'ECHEC' | 'IGNORE' | 'INDISPONIBLE'

export interface JobReport {
  name: string
  state: JobState
  message: string
  durationMs: number
}

export interface TickReport {
  horodatage: string
  dus: number
  executes: JobReport[]
}

export interface JobView {
  name: string
  label: string
  intervalMinutes: number
  enabled: boolean
  /** faux tant qu'aucun traitement n'est enregistré pour ce nom */
  disponible: boolean
  lastRunAt: Date | null
  nextRunAt: Date
  lastState: string
  lastError: string
}

/**
 * Au-delà, un verrou est réputé abandonné : un processus tué en plein
 * travail ne doit pas bloquer l'ordonnanceur pour toujours.
 */
const VERROU_PERIME_MINUTES = 60

const DEFINITION_PAR_NOM = new Map(JOB_DEFINITIONS.map((d) => [d.name, d]))

function messageDe(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  return brut.slice(0, 500)
}

/**
 * Aligne la table sur les déclarations, **sans écraser l'état** : la
 * récurrence et le libellé viennent du code, `enabled`, `lastRunAt` et
 * `nextRunAt` restent à la base.
 */
export async function syncJobDefinitions(): Promise<void> {
  for (const definition of JOB_DEFINITIONS) {
    await prisma.scheduledJob.upsert({
      where: { name: definition.name },
      create: {
        name: definition.name,
        intervalMinutes: definition.intervalMinutes,
        enabled: definition.enabledByDefault,
      },
      update: { intervalMinutes: definition.intervalMinutes },
    })
  }
}

/**
 * Le propriétaire de l'instance : le plus ancien compte.
 *
 * Un réveil externe n'a pas de session, et le produit est explicitement
 * mono-organisation — porter une notion d'utilisateur courant ici
 * réintroduirait un multi-tenant qu'aucune autre table ne connaît.
 */
async function proprietaire(): Promise<string> {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  return user?.id ?? ''
}

type Ligne = Awaited<ReturnType<typeof prisma.scheduledJob.findFirstOrThrow>>

async function executer(
  ligne: Ligne,
  definition: JobDefinition,
  ctx: { now: Date; userId: string; fetchFn?: FetchLike },
  handlers: Readonly<Record<string, JobHandler>>,
): Promise<JobReport> {
  const debut = Date.now()
  const handler = handlers[definition.name]

  if (handler === undefined) {
    // Ni un succès, ni un échec : un travail dont le lot n'est pas livré.
    // Le faire échouer en boucle noierait les vraies alertes.
    const lot = TRAVAUX_DIFFERES[definition.name] ?? 'un lot ultérieur'
    const message = `Aucun traitement enregistré : ce travail est porté par le ${lot}.`
    await prisma.scheduledJob.update({
      where: { id: ligne.id },
      data: {
        lastState: 'INDISPONIBLE',
        lastError: '',
        nextRunAt: new Date(ctx.now.getTime() + definition.intervalMinutes * 60_000),
      },
    })
    return { name: definition.name, state: 'INDISPONIBLE', message, durationMs: 0 }
  }

  await prisma.scheduledJob.update({
    where: { id: ligne.id },
    data: { runningSince: ctx.now },
  })

  try {
    const resultat = await handler(ctx)

    await prisma.scheduledJob.update({
      where: { id: ligne.id },
      data: {
        lastState: 'SUCCES',
        lastError: '',
        lastRunAt: ctx.now,
        nextRunAt: new Date(ctx.now.getTime() + definition.intervalMinutes * 60_000),
        attempts: 0,
        runningSince: null,
      },
    })

    return {
      name: definition.name,
      state: 'SUCCES',
      message: resultat.message,
      durationMs: Date.now() - debut,
    }
  } catch (err) {
    const erreur = messageDe(err)

    await prisma.scheduledJob.update({
      where: { id: ligne.id },
      data: {
        lastState: 'ECHEC',
        lastError: erreur,
        lastRunAt: ctx.now,
        // Un travail périodique repassera de lui-même : le marteler
        // immédiatement n'apporterait rien qu'une charge inutile.
        nextRunAt: new Date(ctx.now.getTime() + definition.intervalMinutes * 60_000),
        attempts: { increment: 1 },
        runningSince: null,
      },
    })

    // Le journal doit garder la trace de l'échec — mais s'il est lui-même
    // en panne, cela ne doit pas transformer un travail raté en réveil raté.
    try {
      await appendAudit({
        ...ACTEUR_SYSTEME,
        action: 'travail.echoue',
        entityType: 'ScheduledJob',
        entityId: definition.name,
        payload: { travail: definition.name, erreur },
      })
    } catch {
      // consigné dans lastError, qui remonte dans la supervision
    }

    return {
      name: definition.name,
      state: 'ECHEC',
      message: erreur,
      durationMs: Date.now() - debut,
    }
  }
}

/**
 * Le réveil. Exécute les travaux échus, un par un, et rend un compte rendu.
 *
 * **L'échec de l'un n'interrompt jamais les autres** : chaque exécution est
 * enveloppée, et la boucle continue.
 */
export async function tick(
  args: {
    now?: Date
    userId?: string
    handlers?: Readonly<Record<string, JobHandler>>
    fetchFn?: FetchLike
  } = {},
): Promise<TickReport> {
  const now = args.now ?? new Date()
  const handlers = args.handlers ?? JOB_HANDLERS

  await syncJobDefinitions()
  const userId = args.userId ?? (await proprietaire())

  const dus = await prisma.scheduledJob.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { name: 'asc' },
  })

  const executes: JobReport[] = []
  const verrouPerime = new Date(now.getTime() - VERROU_PERIME_MINUTES * 60_000)

  for (const ligne of dus) {
    const definition = DEFINITION_PAR_NOM.get(ligne.name)
    if (definition === undefined) continue // ligne orpheline : la déclaration fait foi

    if (ligne.runningSince !== null && ligne.runningSince > verrouPerime) {
      executes.push({
        name: ligne.name,
        state: 'IGNORE',
        message: 'Déjà en cours depuis le réveil précédent.',
        durationMs: 0,
      })
      continue
    }

    executes.push(
      await executer(ligne, definition, { now, userId, fetchFn: args.fetchFn }, handlers),
    )
  }

  return { horodatage: now.toISOString(), dus: dus.length, executes }
}

/**
 * Exécution immédiate depuis la supervision. Ignore l'échéance **et**
 * l'activation : un automatisme qu'on ne peut pas déclencher soi-même est un
 * automatisme qu'on ne peut pas déboguer.
 */
export async function runJobNow(
  userId: string,
  name: string,
  args: {
    now?: Date
    handlers?: Readonly<Record<string, JobHandler>>
    fetchFn?: FetchLike
  } = {},
): Promise<JobReport> {
  const definition = DEFINITION_PAR_NOM.get(name)
  if (definition === undefined) {
    throw new Error(`Le travail « ${name} » n'existe pas.`)
  }

  await syncJobDefinitions()
  const ligne = await prisma.scheduledJob.findUniqueOrThrow({ where: { name } })

  return executer(
    ligne,
    definition,
    { now: args.now ?? new Date(), userId, fetchFn: args.fetchFn },
    args.handlers ?? JOB_HANDLERS,
  )
}

export async function listJobs(): Promise<JobView[]> {
  await syncJobDefinitions()
  const lignes = await prisma.scheduledJob.findMany({ orderBy: { name: 'asc' } })
  const parNom = new Map(lignes.map((l) => [l.name, l]))

  return JOB_DEFINITIONS.map((definition) => {
    const ligne = parNom.get(definition.name)
    return {
      name: definition.name,
      label: definition.label,
      intervalMinutes: definition.intervalMinutes,
      enabled: ligne?.enabled ?? definition.enabledByDefault,
      disponible: definition.name in JOB_HANDLERS,
      lastRunAt: ligne?.lastRunAt ?? null,
      nextRunAt: ligne?.nextRunAt ?? new Date(0),
      lastState: ligne?.lastState ?? '',
      lastError: ligne?.lastError ?? '',
    }
  })
}

export async function setJobEnabled(
  userId: string,
  name: string,
  enabled: boolean,
): Promise<JobView> {
  if (!DEFINITION_PAR_NOM.has(name)) {
    throw new Error(`Le travail « ${name} » n'existe pas.`)
  }

  await syncJobDefinitions()
  await prisma.scheduledJob.update({ where: { name }, data: { enabled } })

  const vues = await listJobs()
  return vues.find((v) => v.name === name)!
}
```

`setJobEnabled` prend un `userId` par cohérence avec la règle du projet, bien que `ScheduledJob` soit une table d'instance : la signature reste alignée sur celle qu'un futur multi-consultants exigerait, sans coût aujourd'hui.

- [ ] **Step 5: Écrire la route de réveil**

`src/app/api/jobs/tick/route.ts` :

```ts
import { requireApiToken } from '@/services/api-token'
import { tick } from '@/services/jobs/scheduler'

export const dynamic = 'force-dynamic'

/**
 * Réveille l'ordonnanceur. Appelé toutes les cinq minutes par n'importe quel
 * déclencheur — cron, n8n, un systemd timer — il suffit à tout.
 *
 * `POST` et non `GET` : le réveil a des effets, et un `GET` serait
 * déclenchable par un préchargement de navigateur.
 */
export async function POST(request: Request): Promise<Response> {
  const garde = requireApiToken(request)
  if (!garde.ok) return garde.response

  return Response.json(await tick())
}
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/jobs/ src/app/api/jobs/`
Expected: PASS — 21 tests.

**Ordre d'exécution.** `registry.ts` importe les quatre traitements : **la tâche 13 s'exécute avant celle-ci**, comme l'indique le graphe de dépendances (12 ← 13). Les deux tâches portent des numéros croissants parce qu'elles se lisent dans cet ordre — l'ordonnanceur explique ce que les traitements doivent respecter — mais elles ne s'implémentent pas dans cet ordre.

- [ ] **Step 7: Vérifier par mutation**

Sortir le `try/catch` de `executer` vers l'extérieur de la boucle de `tick` → « UN TRAVAIL EN ÉCHEC N EMPÊCHE PAS LES SUIVANTS » doit échouer. Ne pas repousser `nextRunAt` au succès → « DEUX RÉVEILS RAPPROCHÉS N EXÉCUTENT PAS DEUX FOIS » doit échouer. Faire lever la branche `handler === undefined` → « marque INDISPONIBLE … sans le compter en échec » doit échouer. Restaurer.

- [ ] **Step 8: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 9: Commit**

```bash
git add src/services/jobs/registry.ts src/services/jobs/scheduler.ts src/services/jobs/scheduler.test.ts src/app/api/jobs
git commit -m "feat(jobs): hard-coded job registry with isolated failures and manual runs"
```

---

## Task 13: Les quatre travaux portés par ce lot

**Files:** Create `src/services/jobs/handlers.ts`, `src/services/jobs/handlers.test.ts`. Modify `src/services/cra.ts`, `src/services/cra.test.ts`

**Interfaces:**
- Consumes: `distributeWebhooks` (tâche 10) ; `verifyJournalChain` (tâche 4) ; `notify` (tâche 11) ; les trois gabarits (tâche 7) ; `getSettings`, `getMonthEntries` (existants)
- Produces:
  - `rappelSaisie: JobHandler`
  - `rappelCloture: JobHandler`
  - `verificationJournal: JobHandler`
  - `distributionRappels: JobHandler`
  - dans `src/services/cra.ts` : `interface CraEnSouffrance { missionId: string; missionLabel: string; clientName: string; status: CraStatus | 'ABSENT' }` et `listCrasEnSouffrance(userId: string, month: string): Promise<CraEnSouffrance[]>`

**La règle centrale du produit, appliquée ici.** Aucun de ces quatre travaux ne convertit du prévisionnel en réalisé, ne valide un CRA, ni ne modifie une saisie. Ils signalent, ils poussent, ils consignent — **ils ne décident pas**. La règle du lot 0 n'admet pas d'exception, surtout pas depuis un traitement de fond, où personne ne voit passer la décision. Le test qui suit la couvre **travail par travail**, et un balayage de source interdit d'y réintroduire une écriture par accident.

**`listCrasEnSouffrance` ne crée rien.** `getOrCreateCra` créerait la ligne — et un rappel qui ouvre des CRA pour pouvoir dire qu'ils sont ouverts serait absurde. Un mois sans ligne de CRA est signalé comme `ABSENT`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/services/cra.test.ts` :

```ts
describe('CRA en souffrance', () => {
  it('signale une mission saisie dont le CRA n existe pas encore', async () => {
    await saveEntry({ userId, lineId, date: '2026-04-06', minutes: 480, kind: 'REALISE' })

    const souffrance = await listCrasEnSouffrance(userId, '2026-04')
    expect(souffrance).toHaveLength(1)
    expect(souffrance[0]).toMatchObject({ missionId, status: 'ABSENT' })
  })

  it('NE CRÉE PAS le CRA qu il signale', async () => {
    await saveEntry({ userId, lineId, date: '2026-04-07', minutes: 480, kind: 'REALISE' })
    const avant = await prisma.cra.count()

    await listCrasEnSouffrance(userId, '2026-04')

    expect(await prisma.cra.count()).toBe(avant)
  })

  it('signale un CRA resté en brouillon', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-06', minutes: 480, kind: 'REALISE' })
    await getOrCreateCra(userId, missionId, '2026-05')

    expect((await listCrasEnSouffrance(userId, '2026-05'))[0]).toMatchObject({
      status: 'BROUILLON',
    })
  })

  it('ne signale pas un CRA déjà envoyé', async () => {
    await saveEntry({ userId, lineId, date: '2026-06-08', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-06')
    await transitionCra(userId, cra.id, 'ENVOYER')

    expect(await listCrasEnSouffrance(userId, '2026-06')).toEqual([])
  })

  it('ne signale rien pour un mois sans aucune saisie', async () => {
    expect(await listCrasEnSouffrance(userId, '2026-03')).toEqual([])
  })

  it('isole par utilisateur', async () => {
    await saveEntry({ userId, lineId, date: '2026-04-08', minutes: 480, kind: 'REALISE' })
    expect(await listCrasEnSouffrance(autreUserId, '2026-04')).toEqual([])
  })
})
```

`src/services/jobs/handlers.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createLine, createMission } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra } from '@/services/cra'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { createWebhook } from '@/services/webhooks/subscriptions'
import type { Mailer } from '@/services/notify'
import { JOB_HANDLERS } from './registry'
import {
  distributionRappels,
  rappelCloture,
  rappelSaisie,
  verificationJournal,
} from './handlers'

let userId = ''
let missionId = ''
let lineId = ''

const envois: Array<{ to: string; sujet: string; corps: string }> = []
const mailer: Mailer = async (message) => {
  envois.push(message)
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'handlers@test.local', name: 'K', passwordHash: 'x' } })
  ).id
  const c = await createClient('HANDLERS client', null, userId)
  missionId = (await createMission({ clientId: c.id, label: 'M', userId })).id
  lineId = (
    await createLine({ missionId, userId, label: 'L', soldCentiemes: 10000, tjmCents: 80000 })
  ).id
})

beforeEach(async () => {
  envois.length = 0
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.auditEvent.deleteMany({})
  await prisma.webhook.deleteMany({})
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-08-05'],
  })
  await prisma.settings.update({
    where: { id: 'singleton' },
    data: { notificationEmail: 'keveen@exemple.test' },
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.auditEvent.deleteMany({})
  await prisma.webhook.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'handlers@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'HANDLERS client' } })
  await prisma.$disconnect()
})

/** Photographie exacte des deux tables que la règle centrale protège. */
async function photographie() {
  return {
    saisies: await prisma.timeEntry.findMany({ orderBy: { id: 'asc' } }),
    cras: await prisma.cra.findMany({ orderBy: { id: 'asc' } }),
  }
}

describe('rappel de saisie', () => {
  const NOW = new Date('2026-08-07T09:00:00.000Z') // un vendredi

  it('signale les jours ouvrés du mois sans aucune saisie', async () => {
    // 3, 4, 6 ouvrés sans saisie ; 5 férié ; 7 est aujourd hui, donc exclu.
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })

    const r = await rappelSaisie({ now: NOW, userId })

    expect(r.message).toContain('2')
    expect(envois).toHaveLength(1)
    expect(envois[0]!.corps).toContain('2026-08-04')
    expect(envois[0]!.corps).toContain('2026-08-06')
    expect(envois[0]!.corps).not.toContain('2026-08-05') // férié
    expect(envois[0]!.corps).not.toContain('2026-08-07') // aujourd hui
    expect(envois[0]!.corps).not.toContain('2026-08-01') // samedi
  })

  it('N ENVOIE RIEN quand tout est saisi', async () => {
    // Pas de notification pour ce qui n'appelle aucune action.
    for (const jour of ['2026-08-03', '2026-08-04', '2026-08-06']) {
      await saveEntry({ userId, lineId, date: jour, minutes: 480, kind: 'REALISE' })
    }

    const r = await rappelSaisie({ now: NOW, userId })

    expect(envois).toHaveLength(0)
    expect(r.message).toMatch(/aucun/i)
  })

  it('compte le prévisionnel comme une saisie', async () => {
    for (const jour of ['2026-08-03', '2026-08-04']) {
      await saveEntry({ userId, lineId, date: jour, minutes: 480, kind: 'PREVISIONNEL' })
    }
    await saveEntry({ userId, lineId, date: '2026-08-06', minutes: 480, kind: 'REALISE' })

    expect(envois).toHaveLength(0)
    await rappelSaisie({ now: NOW, userId })
    expect(envois).toHaveLength(0)
  })

  it('SANS SMTP, consigne au lieu d échouer', async () => {
    const r = await rappelSaisie({ now: NOW, userId })
    expect(r.message).toContain('SMTP')
  })

  it('NE MODIFIE NI SAISIE NI CRA', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'PREVISIONNEL' })
    await getOrCreateCra(userId, missionId, '2026-08')
    const avant = await photographie()

    await rappelSaisie({ now: NOW, userId })

    expect(await photographie()).toEqual(avant)
  })
})

describe('rappel de clôture', () => {
  const DEBUT_DE_MOIS = new Date('2026-09-03T09:00:00.000Z')
  const MILIEU_DE_MOIS = new Date('2026-09-18T09:00:00.000Z')

  it('signale les CRA en souffrance du mois écoulé', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-10', minutes: 480, kind: 'REALISE' })

    const r = await rappelCloture({ now: DEBUT_DE_MOIS, userId })

    expect(r.message).toContain('1')
    expect(envois).toHaveLength(1)
    expect(envois[0]!.sujet).toContain('2026-08')
    expect(envois[0]!.corps).toContain('ABSENT')
  })

  it('ne fait rien hors de la fenêtre de clôture', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-10', minutes: 480, kind: 'REALISE' })

    const r = await rappelCloture({ now: MILIEU_DE_MOIS, userId })

    expect(envois).toHaveLength(0)
    expect(r.message).toMatch(/fenêtre|hors/i)
  })

  it('N ENVOIE RIEN quand tous les CRA sont partis', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-10', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-08')
    await prisma.cra.update({ where: { id: cra.id }, data: { status: 'ENVOYE' } })

    await rappelCloture({ now: DEBUT_DE_MOIS, userId })
    expect(envois).toHaveLength(0)
  })

  it('NE VALIDE NI N ENVOIE AUCUN CRA', async () => {
    // Aucun automatisme ne franchit une transition de CRA, y compris la
    // clôture d'un mois entièrement saisi.
    await saveEntry({ userId, lineId, date: '2026-08-10', minutes: 480, kind: 'REALISE' })
    await getOrCreateCra(userId, missionId, '2026-08')
    const avant = await photographie()

    await rappelCloture({ now: DEBUT_DE_MOIS, userId })

    expect(await photographie()).toEqual(avant)
  })
})

describe('vérification de la chaîne du journal', () => {
  const NOW = new Date('2026-08-15T03:00:00.000Z')

  async function troisEntrees() {
    for (let i = 1; i <= 3; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: `c${i}`, payload: {},
      })
    }
  }

  it('rend compte d une chaîne intacte, sans notifier', async () => {
    await troisEntrees()
    const r = await verificationJournal({ now: NOW, userId })

    expect(r.message).toContain('3')
    expect(envois).toHaveLength(0)
  })

  it('ALERTE ET ÉCHOUE à la première rupture', async () => {
    await troisEntrees()
    await prisma.auditEvent.update({ where: { seq: 2 }, data: { payloadJson: '{"x":1}' } })

    // Le travail échoue : l'ordonnanceur le consigne et la supervision
    // l'affiche en tête. Une rupture silencieuse n'aurait aucune valeur.
    await expect(verificationJournal({ now: NOW, userId })).rejects.toThrow(/2/)
    expect(envois).toHaveLength(1)
    expect(envois[0]!.sujet).toContain('2')
    expect(envois[0]!.corps).toContain('EMPREINTE')
  })

  it('NE MODIFIE NI SAISIE NI CRA', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-12', minutes: 480, kind: 'PREVISIONNEL' })
    await getOrCreateCra(userId, missionId, '2026-08')
    const avant = await photographie()

    await verificationJournal({ now: NOW, userId })

    expect(await photographie()).toEqual(avant)
  })
})

describe('distribution des rappels sortants', () => {
  const NOW = new Date('2026-08-15T10:00:00.000Z')

  it('rend compte de ce qui est parti', async () => {
    await createWebhook(userId, {
      label: 'n8n', url: 'https://exemple.test/hook', events: [], secret: 's',
    })
    await appendAudit({
      ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: 'c1', payload: {},
    })

    const r = await distributionRappels({
      now: NOW,
      userId,
      fetchFn: async () => new Response('', { status: 200 }),
    })

    expect(r.message).toMatch(/1/)
  })

  it('NE MODIFIE NI SAISIE NI CRA', async () => {
    await createWebhook(userId, {
      label: 'n8n', url: 'https://exemple.test/hook', events: [], secret: 's',
    })
    await saveEntry({ userId, lineId, date: '2026-08-13', minutes: 480, kind: 'PREVISIONNEL' })
    await getOrCreateCra(userId, missionId, '2026-08')
    const avant = await photographie()

    await distributionRappels({
      now: NOW, userId, fetchFn: async () => new Response('', { status: 200 }),
    })

    expect(await photographie()).toEqual(avant)
  })
})

describe('la règle centrale, balayée à la source', () => {
  it('aucun traitement n écrit dans TimeEntry ni dans Cra', () => {
    // Le test comportemental couvre ce que les quatre travaux font
    // aujourd'hui ; celui-ci empêche d'y réintroduire une écriture demain.
    const source = readFileSync(path.join(__dirname, 'handlers.ts'), 'utf8')
    for (const interdit of [
      'timeEntry.create', 'timeEntry.update', 'timeEntry.updateMany',
      'timeEntry.delete', 'timeEntry.deleteMany', 'timeEntry.upsert',
      'cra.create', 'cra.update', 'cra.updateMany', 'cra.upsert',
      'saveEntry', 'convertPastForecast', 'transitionCra', 'getOrCreateCra',
    ]) {
      expect(source, `« ${interdit} » n'a rien à faire dans un traitement de fond`)
        .not.toContain(interdit)
    }
  })

  it('les quatre traitements du lot sont bien ceux qui viennent d être couverts', () => {
    expect(Object.keys(JOB_HANDLERS).sort()).toEqual([
      'journal.verification', 'rappel.cloture', 'rappel.saisie', 'webhooks.distribute',
    ])
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/services/jobs/handlers.test.ts src/services/cra.test.ts`
Expected: FAIL — `Failed to resolve import "./handlers"` et `listCrasEnSouffrance` inexistante

- [ ] **Step 3: Ajouter la lecture des CRA en souffrance**

Dans `src/services/cra.ts` :

```ts
export interface CraEnSouffrance {
  missionId: string
  missionLabel: string
  clientName: string
  /** 'ABSENT' quand aucune ligne de CRA n'existe encore pour ce mois */
  status: CraStatus | 'ABSENT'
}

/**
 * Les missions saisies sur un mois dont le CRA n'est pas parti.
 *
 * **Ne crée rien** : un rappel qui ouvrirait des CRA pour pouvoir annoncer
 * qu'ils sont ouverts serait absurde, et écrire depuis un traitement de fond
 * est précisément ce que ce lot s'interdit.
 */
export async function listCrasEnSouffrance(
  userId: string,
  month: string,
): Promise<CraEnSouffrance[]> {
  const debut = monthStart(month)
  const fin = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + 1, 1))

  const saisies = await prisma.timeEntry.findMany({
    where: { userId, date: { gte: debut, lt: fin } },
    select: {
      line: {
        select: {
          missionId: true,
          mission: { select: { label: true, client: { select: { name: true } } } },
        },
      },
    },
  })

  const missions = new Map<string, { missionLabel: string; clientName: string }>()
  for (const s of saisies) {
    missions.set(s.line.missionId, {
      missionLabel: s.line.mission.label,
      clientName: s.line.mission.client.name,
    })
  }
  if (missions.size === 0) return []

  const cras = await prisma.cra.findMany({
    where: { userId, month: debut, missionId: { in: [...missions.keys()] } },
    select: { missionId: true, status: true },
  })
  const statutParMission = new Map(cras.map((c) => [c.missionId, c.status as CraStatus]))

  const out: CraEnSouffrance[] = []
  for (const [missionId, info] of missions) {
    const status = statutParMission.get(missionId)
    // Envoyé, validé ou refusé : le CRA a quitté le brouillon, il n'est plus
    // « en souffrance de clôture ».
    if (status !== undefined && status !== 'BROUILLON') continue
    out.push({ missionId, ...info, status: status ?? 'ABSENT' })
  }
  return out.sort((a, b) => a.missionLabel.localeCompare(b.missionLabel, 'fr'))
}
```

- [ ] **Step 4: Écrire les quatre traitements**

`src/services/jobs/handlers.ts` :

```ts
import { getSettings } from '@/services/settings'
import { getMonthEntries } from '@/services/time-entries'
import { listCrasEnSouffrance } from '@/services/cra'
import { verifyJournalChain } from '@/services/audit'
import { notify } from '@/services/notify'
import {
  gabaritRappelCloture,
  gabaritRappelSaisie,
  gabaritRuptureJournal,
} from '@/core/notify/templates'
import { distributeWebhooks } from '@/services/webhooks/delivery'
import type { JobHandler } from './registry'

/**
 * Aucun de ces quatre traitements n'écrit dans `TimeEntry` ni dans `Cra`.
 * Ils signalent, ils poussent, ils consignent — **ils ne décident pas**.
 * `handlers.test.ts` le vérifie travail par travail, et balaie en plus cette
 * source pour qu'aucune écriture n'y soit réintroduite.
 */

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function moisDe(d: Date): string {
  return d.toISOString().slice(0, 7)
}

/** Jour de semaine 1 = lundi … 7 = dimanche, aligné sur `Settings.workingDays`. */
function jourDeSemaine(d: Date): number {
  const jour = d.getUTCDay()
  return jour === 0 ? 7 : jour
}

/**
 * Signale les jours ouvrés du mois en cours qui ne portent aucune saisie,
 * **strictement antérieurs à aujourd'hui** : rappeler à quelqu'un qu'il n'a
 * pas encore saisi sa journée en cours serait du bruit.
 */
export const rappelSaisie: JobHandler = async ({ now, userId }) => {
  const mois = moisDe(now)
  const [reglages, saisies] = await Promise.all([getSettings(), getMonthEntries(userId, mois)])

  const ouvres = new Set(reglages.workingDays)
  const feries = new Set(reglages.holidays)
  const saisis = new Set(saisies.map((e) => e.date))
  const aujourdhui = isoDate(now)

  const manquants: string[] = []
  for (let jour = 1; jour <= 31; jour++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), jour))
    if (moisDe(date) !== mois) break // débordement de mois

    const iso = isoDate(date)
    if (iso >= aujourdhui) break
    if (!ouvres.has(jourDeSemaine(date))) continue
    if (feries.has(iso)) continue
    if (saisis.has(iso)) continue

    manquants.push(iso)
  }

  if (manquants.length === 0) {
    return { message: `Aucun jour ouvré sans saisie en ${mois}.` }
  }

  const envoi = await notify(gabaritRappelSaisie({ mois, jours: manquants }))
  return {
    message: `${manquants.length} jour(s) ouvré(s) sans saisie en ${mois}.${
      envoi.envoye ? '' : ` ${envoi.motif}`
    }`,
  }
}

/** Fenêtre de clôture : les cinq premiers jours du mois, pour le mois écoulé. */
const DERNIER_JOUR_DE_CLOTURE = 5

/**
 * Signale les CRA encore en brouillon — ou pas même ouverts — sur le mois
 * écoulé. **N'en envoie, n'en valide et n'en ouvre aucun** : seuls un geste
 * humain ou un retour de signature franchissent une transition de CRA.
 */
export const rappelCloture: JobHandler = async ({ now, userId }) => {
  if (now.getUTCDate() > DERNIER_JOUR_DE_CLOTURE) {
    return {
      message: `Hors fenêtre de clôture (les ${DERNIER_JOUR_DE_CLOTURE} premiers jours du mois).`,
    }
  }

  const precedent = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const mois = moisDe(precedent)

  const souffrance = await listCrasEnSouffrance(userId, mois)
  if (souffrance.length === 0) {
    return { message: `Aucun CRA en souffrance pour ${mois}.` }
  }

  const envoi = await notify(
    gabaritRappelCloture({
      mois,
      missions: souffrance.map((c) => ({
        label: `${c.clientName} — ${c.missionLabel}`,
        etat: c.status,
      })),
    }),
  )

  return {
    message: `${souffrance.length} CRA à clôturer pour ${mois}.${
      envoi.envoye ? '' : ` ${envoi.motif}`
    }`,
  }
}

/**
 * Recalcule les empreintes et alerte à la première rupture.
 *
 * En cas de rupture, le travail **lève** après avoir notifié : l'ordonnanceur
 * le consigne alors en `travail.echoue` et la supervision l'affiche en tête.
 * Une rupture détectée mais rendue comme un succès n'aurait aucune valeur.
 */
export const verificationJournal: JobHandler = async () => {
  const verdict = await verifyJournalChain()

  if (verdict.ok) {
    return { message: `Chaîne intacte : ${verdict.verifiees} entrée(s) vérifiée(s).` }
  }

  await notify(gabaritRuptureJournal({ seq: verdict.seq, raison: verdict.raison }))

  throw new Error(
    `Rupture de la chaîne du journal à l'entrée ${verdict.seq} (${verdict.raison}). ` +
      `${verdict.verifiees} entrée(s) vérifiée(s) avant elle.`,
  )
}

/** Met en file et tente les appels sortants dus. */
export const distributionRappels: JobHandler = async ({ now, fetchFn }) => {
  const rapport = await distributeWebhooks({ now, ...(fetchFn !== undefined && { fetchFn }) })

  return {
    message:
      `${rapport.abonnements} abonnement(s) · ${rapport.creees} mise(s) en file · ` +
      `${rapport.reussies} réussie(s), ${rapport.echouees} en échec, ` +
      `${rapport.abandonnees} abandonnée(s), ${rapport.suspendus} suspendu(s).`,
  }
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/jobs/ src/services/cra.test.ts`
Expected: PASS — 14 tests dans `handlers.test.ts`, 6 nouveaux dans `cra.test.ts`, plus les 21 de `scheduler.test.ts`

- [ ] **Step 6: Vérifier par mutation**

Quatre mutations, restaurer après chacune.

1. Dans `rappelSaisie`, retirer la garde `if (manquants.length === 0)` et notifier toujours → « N ENVOIE RIEN quand tout est saisi » doit échouer (le gabarit lèvera sur une liste vide, ce qui est le comportement voulu).
2. Dans `rappelCloture`, retirer la garde de fenêtre → « ne fait rien hors de la fenêtre de clôture » doit échouer.
3. Dans `verificationJournal`, remplacer le `throw` par un `return` → « ALERTE ET ÉCHOUE à la première rupture » doit échouer.
4. Dans `rappelCloture`, appeler `getOrCreateCra` sur chaque mission signalée → « NE VALIDE NI N ENVOIE AUCUN CRA » **et** le balayage de source doivent tous deux échouer.

- [ ] **Step 7: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 8: Commit**

```bash
git add src/services/jobs/handlers.ts src/services/jobs/handlers.test.ts src/services/cra.ts src/services/cra.test.ts
git commit -m "feat(jobs): reminder, closing and chain-verification jobs that never write"
```

---

## Task 14: L'agrégat de supervision

**Files:** Create `src/services/supervision.ts`, `src/services/supervision.test.ts`

**Interfaces:**
- Consumes: `verifyJournalChain` (tâche 4) ; `listJobs` (tâche 12) ; `Webhook`, `WebhookDelivery` (tâche 3)
- Produces:
  - `type CodeAlerte = 'TRAVAIL_ECHEC' | 'ABONNEMENT_SUSPENDU' | 'LIVRAISON_ABANDONNEE' | 'JOURNAL_ROMPU'`
  - `interface Alerte { code: CodeAlerte; libelle: string; detail: string }`
  - `listAlertes(userId: string): Promise<Alerte[]>`

**Ce que porte cet agrégat, et ce qu'il ne porte pas.** La spec énumère cinq familles d'alertes ; **trois** relèvent de lots que ce plan ne touche pas — les éléments abandonnés de la file de sortie et les conflits d'agenda non arbitrés (lots 1b/2), les CRA en souffrance de signature (lot 3). Restent les travaux en échec et la rupture de chaîne, auxquels ce lot ajoute les deux siens : abonnement suspendu et livraison abandonnée, exigés par le §5 de la spec. D'où quatre codes, et pas cinq. `CodeAlerte` est une union de littéraux : le lot qui livre les siens l'étend, et le compilateur lui indique l'écran à compléter.

**Si rien ne cloche, l'agrégat rend un tableau vide** — et l'écran le dit explicitement. Un écran d'alertes qui n'annonce jamais « tout va bien » laisse toujours planer le doute d'un chargement raté.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/supervision.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { syncJobDefinitions } from './jobs/scheduler'
import { listAlertes } from './supervision'

let userId = ''

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'supervision@test.local', name: 'K', passwordHash: 'x' } })
  ).id
})

beforeEach(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await syncJobDefinitions()
})

afterAll(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'supervision@test.local' } })
  await prisma.$disconnect()
})

async function abonnement(patch: Record<string, unknown> = {}) {
  return prisma.webhook.create({
    data: {
      userId, label: 'n8n', url: 'https://exemple.test/hook', secret: 's', ...patch,
    },
  })
}

describe('alertes', () => {
  it('ne dit rien quand rien ne cloche', async () => {
    expect(await listAlertes(userId)).toEqual([])
  })

  it('signale un travail en échec, avec sa dernière erreur', async () => {
    await prisma.scheduledJob.update({
      where: { name: 'webhooks.distribute' },
      data: { lastState: 'ECHEC', lastError: 'URL injoignable' },
    })

    const alertes = await listAlertes(userId)
    expect(alertes).toHaveLength(1)
    expect(alertes[0]).toMatchObject({ code: 'TRAVAIL_ECHEC' })
    expect(alertes[0]!.detail).toContain('URL injoignable')
    expect(alertes[0]!.libelle).toContain('Distribution des rappels sortants')
  })

  it('ne signale pas un travail simplement indisponible', async () => {
    // « Pas de notification pour ce qui n appelle aucune action » : un lot
    // non encore livré n'est pas une panne.
    await prisma.scheduledJob.update({
      where: { name: 'outbox.flush' },
      data: { lastState: 'INDISPONIBLE' },
    })
    expect(await listAlertes(userId)).toEqual([])
  })

  it('signale un abonnement suspendu', async () => {
    await abonnement({ state: 'SUSPENDU', consecutiveFailures: 12, lastError: 'ECONNREFUSED' })

    const alertes = await listAlertes(userId)
    expect(alertes[0]).toMatchObject({ code: 'ABONNEMENT_SUSPENDU' })
    expect(alertes[0]!.libelle).toContain('n8n')
    expect(alertes[0]!.detail).toContain('ECONNREFUSED')
  })

  it('signale les livraisons abandonnées, groupées', async () => {
    const w = await abonnement()
    for (const seq of [1, 2, 3]) {
      await prisma.webhookDelivery.create({
        data: { webhookId: w.id, seq, action: 'cra.valide', state: 'ABANDONNE', attempts: 5 },
      })
    }

    const alertes = await listAlertes(userId)
    const abandon = alertes.find((a) => a.code === 'LIVRAISON_ABANDONNEE')
    expect(abandon).toBeDefined()
    expect(abandon!.detail).toContain('3')
  })

  it('SIGNALE UNE RUPTURE DE CHAÎNE, avec l entrée en cause', async () => {
    for (let i = 1; i <= 3; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: `c${i}`, payload: {},
      })
    }
    await prisma.auditEvent.update({ where: { seq: 2 }, data: { payloadJson: '{"x":1}' } })

    const alertes = await listAlertes(userId)
    const rupture = alertes.find((a) => a.code === 'JOURNAL_ROMPU')
    expect(rupture).toBeDefined()
    expect(rupture!.detail).toContain('2')
    expect(rupture!.detail).toContain('EMPREINTE')
  })

  it('place la rupture de chaîne en tête', async () => {
    await abonnement({ state: 'SUSPENDU', lastError: 'x' })
    for (let i = 1; i <= 2; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: `c${i}`, payload: {},
      })
    }
    await prisma.auditEvent.update({ where: { seq: 1 }, data: { payloadJson: '{"x":1}' } })

    expect((await listAlertes(userId))[0]!.code).toBe('JOURNAL_ROMPU')
  })

  it('isole par utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'supervision-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.webhook.create({
      data: { userId: autre.id, label: 'ailleurs', url: 'https://x.test/h', secret: 's', state: 'SUSPENDU' },
    })

    expect(await listAlertes(userId)).toEqual([])
    await prisma.user.delete({ where: { id: autre.id } })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/supervision.test.ts`
Expected: FAIL — `Failed to resolve import "./supervision"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/supervision.ts` :

```ts
import { prisma } from '@/db/client'
import { verifyJournalChain } from './audit'
import { listJobs } from './jobs/scheduler'

/**
 * Les alertes que le lot 4 sait produire.
 *
 * La spec en énumère trois autres — file de sortie abandonnée, conflits
 * d'agenda non arbitrés, CRA en souffrance de signature — qui appartiennent
 * aux lots 1b, 2 et 3. Le lot qui les livre étend cette union ; le
 * compilateur lui désignera alors l'écran à compléter.
 */
export type CodeAlerte =
  | 'JOURNAL_ROMPU'
  | 'TRAVAIL_ECHEC'
  | 'ABONNEMENT_SUSPENDU'
  | 'LIVRAISON_ABANDONNEE'

export interface Alerte {
  code: CodeAlerte
  libelle: string
  detail: string
}

/**
 * Tout ce qui demande une action, dans l'ordre de gravité.
 *
 * Rend un tableau **vide** quand rien ne cloche : c'est l'écran qui le dit,
 * explicitement. Un écran d'alertes qui n'annonce jamais « tout va bien »
 * laisse planer le doute d'un chargement raté.
 */
export async function listAlertes(userId: string): Promise<Alerte[]> {
  const alertes: Alerte[] = []

  // 1. La chaîne du journal : rien n'est plus grave qu'une preuve rompue.
  const chaine = await verifyJournalChain()
  if (!chaine.ok) {
    alertes.push({
      code: 'JOURNAL_ROMPU',
      libelle: 'Rupture de la chaîne du journal',
      detail:
        `Entrée ${chaine.seq} — ${chaine.raison}. ` +
        `${chaine.verifiees} entrée(s) vérifiée(s) avant elle.`,
    })
  }

  // 2. Les travaux en échec. `INDISPONIBLE` n'en est pas un : un lot non
  //    livré n'appelle aucune action de l'utilisateur.
  for (const travail of await listJobs()) {
    if (travail.lastState !== 'ECHEC') continue
    alertes.push({
      code: 'TRAVAIL_ECHEC',
      libelle: `Travail en échec : ${travail.label}`,
      detail: travail.lastError === '' ? 'Aucun message d’erreur enregistré.' : travail.lastError,
    })
  }

  // 3. Les abonnements suspendus.
  const suspendus = await prisma.webhook.findMany({
    where: { userId, state: 'SUSPENDU' },
    orderBy: { label: 'asc' },
  })
  for (const abonnement of suspendus) {
    alertes.push({
      code: 'ABONNEMENT_SUSPENDU',
      libelle: `Abonnement suspendu : ${abonnement.label}`,
      detail:
        `${abonnement.consecutiveFailures} échec(s) consécutif(s). ` +
        `${abonnement.lastError === '' ? '' : `Dernière erreur : ${abonnement.lastError}. `}` +
        `Les événements de la période suspendue restent lisibles par ` +
        `GET /api/events?since=${abonnement.lastSeq}.`,
    })
  }

  // 4. Les livraisons abandonnées, groupées : une ligne par abonnement plutôt
  //    que cent lignes identiques.
  const abandons = await prisma.webhookDelivery.groupBy({
    by: ['webhookId'],
    where: { state: 'ABANDONNE', webhook: { userId } },
    _count: { _all: true },
  })
  if (abandons.length > 0) {
    const libelles = new Map(
      (await prisma.webhook.findMany({ where: { userId }, select: { id: true, label: true } })).map(
        (w) => [w.id, w.label],
      ),
    )
    for (const groupe of abandons) {
      alertes.push({
        code: 'LIVRAISON_ABANDONNEE',
        libelle: `Livraisons abandonnées : ${libelles.get(groupe.webhookId) ?? groupe.webhookId}`,
        detail:
          `${groupe._count._all} livraison(s) abandonnée(s) après cinq tentatives. ` +
          `Chacune peut être renvoyée à la main.`,
      })
    }
  }

  return alertes
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/supervision.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Vérifier par mutation**

Ajouter `'INDISPONIBLE'` à la condition des travaux en échec → « ne signale pas un travail simplement indisponible » doit échouer. Retirer `userId` du `where` des abonnements suspendus → « isole par utilisateur » doit échouer. Restaurer.

- [ ] **Step 6: Commit**

```bash
git add src/services/supervision.ts src/services/supervision.test.ts
git commit -m "feat(supervision): actionable alert aggregate scoped per user"
```

---

## Task 15: Les deux écrans

**Files:** Create `src/app/(app)/admin/supervision/page.tsx`, `actions.ts`, `AlertesPanel.tsx`, `AlertesPanel.test.tsx`, `TravauxPanel.tsx`, `TravauxPanel.test.tsx`, `src/app/(app)/admin/webhooks/page.tsx`, `actions.ts`, `WebhookForm.tsx`, `WebhookForm.test.tsx`. Modify `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `listAlertes` (tâche 14) ; `listAuditEvents` (tâche 4) ; `listJobs`, `runJobNow`, `setJobEnabled` (tâche 12) ; `listWebhooks`, `createWebhook`, `updateWebhook`, `deleteWebhook` (tâche 9) ; `listDeliveries`, `resendDelivery`, `sendTestWebhook` (tâche 10) ; `requireUser` (existant)
- Produces: routes `/admin/supervision` et `/admin/webhooks`

**Un seul écran de supervision, dans cet ordre.** Ce qui demande une action, puis l'état des travaux, puis l'historique. L'inverse — l'historique d'abord — obligerait à faire défiler pour découvrir qu'un abonnement est mort depuis trois jours. **Les avertissements vivent dans l'outil**, pas seulement dans un courriel qu'on n'a pas lu.

**Aucune information portée par la seule couleur.** Chaque état porte un glyphe via `Badge`, comme partout ailleurs dans le système de design.

- [ ] **Step 1: Écrire les tests de composants qui échouent**

`src/app/(app)/admin/supervision/AlertesPanel.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AlertesPanel } from './AlertesPanel'
import type { Alerte } from '@/services/supervision'

afterEach(cleanup)

describe('panneau des alertes', () => {
  it('DIT EXPLICITEMENT que rien ne cloche', () => {
    // Sans cette phrase, un écran vide se confond avec un chargement raté.
    render(<AlertesPanel alertes={[]} />)
    expect(screen.getByText(/rien ne demande d’action/i)).toBeTruthy()
  })

  it('affiche chaque alerte avec son libellé et son détail', () => {
    const alertes: Alerte[] = [
      { code: 'JOURNAL_ROMPU', libelle: 'Rupture de la chaîne du journal', detail: 'Entrée 412 — EMPREINTE.' },
      { code: 'ABONNEMENT_SUSPENDU', libelle: 'Abonnement suspendu : n8n', detail: '12 échec(s).' },
    ]
    render(<AlertesPanel alertes={alertes} />)

    expect(screen.getByText('Rupture de la chaîne du journal')).toBeTruthy()
    expect(screen.getByText(/Entrée 412/)).toBeTruthy()
    expect(screen.getByText('Abonnement suspendu : n8n')).toBeTruthy()
  })

  it('ne porte jamais l information par la seule couleur', () => {
    render(
      <AlertesPanel
        alertes={[{ code: 'TRAVAIL_ECHEC', libelle: 'Travail en échec : X', detail: 'boum' }]}
      />,
    )
    // Le bandeau porte un glyphe, et un rôle d'alerte lu par les lecteurs d'écran.
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
```

`src/app/(app)/admin/supervision/TravauxPanel.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TravauxPanel } from './TravauxPanel'
import type { JobView } from '@/services/jobs/scheduler'

afterEach(cleanup)

function travail(patch: Partial<JobView> = {}): JobView {
  return {
    name: 'webhooks.distribute',
    label: 'Distribution des rappels sortants',
    intervalMinutes: 5,
    enabled: true,
    disponible: true,
    lastRunAt: new Date('2026-08-15T09:55:00.000Z'),
    nextRunAt: new Date('2026-08-15T10:00:00.000Z'),
    lastState: 'SUCCES',
    lastError: '',
    ...patch,
  }
}

describe('panneau des travaux', () => {
  it('affiche libellé, dernière exécution, prochaine échéance et état', () => {
    render(<TravauxPanel travaux={[travail()]} />)
    expect(screen.getByText('Distribution des rappels sortants')).toBeTruthy()
    expect(screen.getByText(/succès/i)).toBeTruthy()
  })

  it('donne un bouton d exécution immédiate à chaque travail disponible', () => {
    // Un automatisme qu'on ne peut pas déclencher soi-même ne se débogue pas.
    render(<TravauxPanel travaux={[travail(), travail({ name: 'rappel.saisie', label: 'Rappel de saisie' })]} />)
    expect(screen.getAllByRole('button', { name: /exécuter/i })).toHaveLength(2)
  })

  it('annonce un travail indisponible sans l afficher comme une panne', () => {
    render(
      <TravauxPanel
        travaux={[
          travail({
            name: 'outbox.flush',
            label: 'Vidage de la file de sortie',
            disponible: false,
            enabled: false,
            lastState: 'INDISPONIBLE',
          }),
        ]}
      />,
    )
    expect(screen.getByText(/indisponible/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /exécuter/i })).toBeNull()
  })

  it('affiche la dernière erreur d un travail en échec', () => {
    render(<TravauxPanel travaux={[travail({ lastState: 'ECHEC', lastError: 'URL injoignable' })]} />)
    expect(screen.getByText(/URL injoignable/)).toBeTruthy()
  })

  it('n a jamais jamais exécuté : le dit plutôt que d afficher un vide', () => {
    render(<TravauxPanel travaux={[travail({ lastRunAt: null, lastState: '' })]} />)
    expect(screen.getByText(/jamais/i)).toBeTruthy()
  })
})
```

`src/app/(app)/admin/webhooks/WebhookForm.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WebhookForm } from './WebhookForm'
import { AUDIT_ACTIONS } from '@/core/audit/events'

afterEach(cleanup)

describe('formulaire d abonnement', () => {
  it('propose tout le catalogue à la souscription', () => {
    render(<WebhookForm />)
    for (const action of AUDIT_ACTIONS) {
      expect(screen.getByLabelText(action), action).toBeTruthy()
    }
  })

  it('explique ce que veut dire ne rien cocher', () => {
    render(<WebhookForm />)
    expect(screen.getByText(/aucun coché.*tous les événements/i)).toBeTruthy()
  })

  it('demande un libellé et une URL', () => {
    render(<WebhookForm />)
    expect(screen.getByLabelText(/libellé/i)).toBeTruthy()
    expect(screen.getByLabelText(/URL/i)).toBeTruthy()
  })

  it('n affiche jamais de secret', () => {
    const { container } = render(<WebhookForm />)
    expect(container.textContent).not.toMatch(/secret/i)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run "src/app/(app)/admin/supervision" "src/app/(app)/admin/webhooks"`
Expected: FAIL — trois imports non résolus

- [ ] **Step 3: Écrire les composants de la supervision**

`src/app/(app)/admin/supervision/AlertesPanel.tsx` :

```tsx
import { Banner } from '@/components/ui/Banner'
import { Card } from '@/components/ui/Card'
import type { Alerte } from '@/services/supervision'

/** La rupture de chaîne est d'un autre ordre que le reste : elle met en cause la preuve. */
const TONALITES = {
  JOURNAL_ROMPU: 'danger',
  TRAVAIL_ECHEC: 'danger',
  ABONNEMENT_SUSPENDU: 'warning',
  LIVRAISON_ABANDONNEE: 'warning',
} as const

export function AlertesPanel({ alertes }: { alertes: Alerte[] }) {
  if (alertes.length === 0) {
    return (
      <Card title="À traiter">
        <p className="text-sm text-muted">
          Rien ne demande d’action : les travaux passent, les abonnements répondent, la
          chaîne du journal est intacte.
        </p>
      </Card>
    )
  }

  return (
    <Card title={`À traiter — ${alertes.length}`}>
      <ul className="flex flex-col gap-2">
        {alertes.map((alerte, index) => (
          <li key={`${alerte.code}-${index}`}>
            <Banner tone={TONALITES[alerte.code]} title={alerte.libelle}>
              <p className="text-sm">{alerte.detail}</p>
            </Banner>
          </li>
        ))}
      </ul>
    </Card>
  )
}
```

`src/app/(app)/admin/supervision/TravauxPanel.tsx` :

```tsx
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import type { JobView } from '@/services/jobs/scheduler'
import { executerTravail, basculerTravail } from './actions'

/** Chaque état porte un glyphe : la teinte seule ne se perçoit pas de tous. */
const ETATS: Record<string, { libelle: string; tone: Tone; glyph: string }> = {
  SUCCES: { libelle: 'Succès', tone: 'success', glyph: '✓' },
  ECHEC: { libelle: 'Échec', tone: 'danger', glyph: '✕' },
  IGNORE: { libelle: 'Ignoré', tone: 'neutral', glyph: '·' },
  INDISPONIBLE: { libelle: 'Indisponible', tone: 'info', glyph: 'ℹ' },
  '': { libelle: 'Jamais exécuté', tone: 'neutral', glyph: '–' },
}

function horodatage(date: Date | null): string {
  return date === null ? 'jamais' : date.toISOString().slice(0, 16).replace('T', ' ')
}

export function TravauxPanel({ travaux }: { travaux: JobView[] }) {
  return (
    <Card title="Travaux">
      <DataTable caption="État des traitements récurrents">
        <thead>
          <tr>
            <th scope="col" className="p-2 text-left">Travail</th>
            <th scope="col" className="p-2 text-left">Récurrence</th>
            <th scope="col" className="p-2 text-left">Dernière</th>
            <th scope="col" className="p-2 text-left">Prochaine</th>
            <th scope="col" className="p-2 text-left">État</th>
            <th scope="col" className="p-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {travaux.map((travail) => {
            const etat = ETATS[travail.lastState] ?? ETATS['']!
            return (
              <tr key={travail.name} className="border-t border-rule">
                <td className="p-2">
                  {travail.label}
                  {travail.lastError !== '' && (
                    <p className="text-xs text-danger-ink">{travail.lastError}</p>
                  )}
                </td>
                <td className="p-2">{travail.intervalMinutes} min</td>
                <td className="p-2">{horodatage(travail.lastRunAt)}</td>
                <td className="p-2">
                  {travail.disponible && travail.enabled ? horodatage(travail.nextRunAt) : '—'}
                </td>
                <td className="p-2">
                  <Badge tone={etat.tone} glyph={etat.glyph}>{etat.libelle}</Badge>
                </td>
                <td className="p-2">
                  {travail.disponible ? (
                    <div className="flex gap-2">
                      <form action={executerTravail}>
                        <input type="hidden" name="name" value={travail.name} />
                        <Button type="submit" variant="secondary">Exécuter</Button>
                      </form>
                      <form action={basculerTravail}>
                        <input type="hidden" name="name" value={travail.name} />
                        <input type="hidden" name="enabled" value={travail.enabled ? '0' : '1'} />
                        <Button type="submit" variant="quiet">
                          {travail.enabled ? 'Désactiver' : 'Activer'}
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Livré par un lot ultérieur</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
    </Card>
  )
}
```

**Note d'exécution.** `TravauxPanel` importe deux server actions ; son test de composant les tire donc transitivement, et avec elles `next/cache` et Prisma. Si l'import de `./actions` fait échouer le test en environnement `happy-dom`, extraire les deux `<form>` dans un composant enfant `TravauxActions.tsx` et n'en tester que le rendu — la responsabilité testée ici est l'affichage, pas le câblage.

- [ ] **Step 4: Écrire les actions et la page de supervision**

`src/app/(app)/admin/supervision/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { runJobNow, setJobEnabled } from '@/services/jobs/scheduler'
import { resendDelivery } from '@/services/webhooks/delivery'

export async function executerTravail(formData: FormData): Promise<void> {
  const user = await requireUser()
  await runJobNow(user.id, String(formData.get('name') ?? ''))
  revalidatePath('/admin/supervision')
}

export async function basculerTravail(formData: FormData): Promise<void> {
  const user = await requireUser()
  await setJobEnabled(user.id, String(formData.get('name') ?? ''), formData.get('enabled') === '1')
  revalidatePath('/admin/supervision')
}

/** Partagée par les deux écrans : un renvoi est un renvoi, deux copies divergeraient. */
export async function renvoyerLivraison(formData: FormData): Promise<void> {
  const user = await requireUser()
  await resendDelivery(user.id, String(formData.get('id') ?? ''))
  revalidatePath('/admin/supervision')
  revalidatePath('/admin/webhooks')
}
```

`src/app/(app)/admin/supervision/page.tsx` — un composant serveur qui lit les trois agrégats et les empile dans l'ordre voulu :

```tsx
import { requireUser } from '@/auth'
import { PageShell } from '@/components/ui/PageShell'
import { Card } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import { listAlertes } from '@/services/supervision'
import { listJobs } from '@/services/jobs/scheduler'
import { listAuditEvents } from '@/services/audit'
import { AUDIT_ACTIONS, isAuditAction } from '@/core/audit/events'
import { AlertesPanel } from './AlertesPanel'
import { TravauxPanel } from './TravauxPanel'

export const dynamic = 'force-dynamic'

export default async function SupervisionPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; du?: string; au?: string }>
}) {
  const user = await requireUser()
  const filtres = await searchParams

  const action = filtres.action !== undefined && isAuditAction(filtres.action)
    ? filtres.action
    : undefined

  const [alertes, travaux, journal] = await Promise.all([
    listAlertes(user.id),
    listJobs(),
    listAuditEvents(user.id, {
      ...(action !== undefined && { action }),
      ...(filtres.du !== undefined && { du: filtres.du }),
      ...(filtres.au !== undefined && { au: filtres.au }),
      limit: 100,
    }),
  ])

  return (
    <PageShell title="Supervision">
      <div className="flex flex-col gap-6">
        <AlertesPanel alertes={alertes} />
        <TravauxPanel travaux={travaux} />

        <Card title="Journal">
          {/* Filtre en GET : l'URL devient partageable, et le retour arrière
              du navigateur retrouve la vue précédente. */}
          <form method="get" className="mb-3 flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              Événement
              <select name="action" defaultValue={action ?? ''} className="touch-target rounded-md border border-rule bg-surface px-3">
                <option value="">Tous</option>
                {AUDIT_ACTIONS.map((nom) => (
                  <option key={nom} value={nom}>{nom}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Du
              <input type="date" name="du" defaultValue={filtres.du ?? ''} className="touch-target rounded-md border border-rule bg-surface px-3" />
            </label>
            <label className="flex flex-col gap-1">
              Au
              <input type="date" name="au" defaultValue={filtres.au ?? ''} className="touch-target rounded-md border border-rule bg-surface px-3" />
            </label>
            <button type="submit" className="touch-target rounded-md border border-rule px-4 text-sm">
              Filtrer
            </button>
          </form>

          {journal.length === 0 ? (
            <p className="text-sm text-muted">Aucune entrée pour ce filtre.</p>
          ) : (
            <DataTable caption="Entrées du journal de preuve">
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left">N°</th>
                  <th scope="col" className="p-2 text-left">Quand</th>
                  <th scope="col" className="p-2 text-left">Qui</th>
                  <th scope="col" className="p-2 text-left">Quoi</th>
                  <th scope="col" className="p-2 text-left">Cible</th>
                  <th scope="col" className="p-2 text-left">Détail</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((entree) => (
                  <tr key={entree.seq} className="border-t border-rule align-top">
                    <td className="p-2 tabular-nums">{entree.seq}</td>
                    <td className="p-2">{entree.occurredAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                    <td className="p-2">{entree.actorLabel}</td>
                    <td className="p-2 font-medium">{entree.action}</td>
                    <td className="p-2">{entree.entityType} {entree.entityId}</td>
                    <td className="p-2">
                      <code className="text-xs">{JSON.stringify(entree.payload)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </PageShell>
  )
}
```

- [ ] **Step 5: Écrire l'écran des abonnements**

`src/app/(app)/admin/webhooks/WebhookForm.tsx` :

```tsx
import { AUDIT_ACTIONS } from '@/core/audit/events'
import { Button } from '@/components/ui/Button'
import { creerAbonnement } from './actions'

/**
 * Le formulaire n'affiche aucun secret : il en existe un, il sert à signer,
 * il ne se relit pas. Un secret qu'on affiche est un secret qu'on recopie
 * dans un ticket.
 */
export function WebhookForm() {
  return (
    <form action={creerAbonnement} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Libellé
        <input name="label" required className="touch-target rounded-md border border-rule bg-surface px-3" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        URL à appeler
        <input
          name="url"
          type="url"
          required
          placeholder="https://n8n.exemple.fr/webhook/cra"
          className="touch-target rounded-md border border-rule bg-surface px-3"
        />
      </label>

      <fieldset className="rounded-md border border-rule p-3">
        <legend className="px-1 text-sm font-medium">Événements souscrits</legend>
        <p className="mb-2 text-xs text-muted">
          Aucun coché = tous les événements.
        </p>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {AUDIT_ACTIONS.map((action) => (
            <label key={action} className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="events" value={action} aria-label={action} />
              {action}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <Button type="submit" variant="primary">Créer l’abonnement</Button>
      </div>
    </form>
  )
}
```

`src/app/(app)/admin/webhooks/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { isAuditAction, type AuditAction } from '@/core/audit/events'
import {
  createWebhook,
  deleteWebhook,
  updateWebhook,
  type WebhookState,
} from '@/services/webhooks/subscriptions'
import { sendTestWebhook } from '@/services/webhooks/delivery'

function evenementsDe(formData: FormData): AuditAction[] {
  return formData.getAll('events').map(String).filter(isAuditAction)
}

export async function creerAbonnement(formData: FormData): Promise<void> {
  const user = await requireUser()
  await createWebhook(user.id, {
    label: String(formData.get('label') ?? ''),
    url: String(formData.get('url') ?? ''),
    events: evenementsDe(formData),
  })
  revalidatePath('/admin/webhooks')
}

export async function modifierAbonnement(formData: FormData): Promise<void> {
  const user = await requireUser()
  await updateWebhook(user.id, String(formData.get('id') ?? ''), {
    ...(formData.has('state') && { state: String(formData.get('state')) as WebhookState }),
    ...(formData.has('events') && { events: evenementsDe(formData) }),
  })
  revalidatePath('/admin/webhooks')
}

export async function supprimerAbonnement(formData: FormData): Promise<void> {
  const user = await requireUser()
  await deleteWebhook(user.id, String(formData.get('id') ?? ''))
  revalidatePath('/admin/webhooks')
}

export async function essayerAbonnement(formData: FormData): Promise<void> {
  const user = await requireUser()
  await sendTestWebhook(user.id, String(formData.get('id') ?? ''))
  revalidatePath('/admin/webhooks')
}
```

`src/app/(app)/admin/webhooks/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { PageShell } from '@/components/ui/PageShell'
import { Card } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { listWebhooks } from '@/services/webhooks/subscriptions'
import { listDeliveries } from '@/services/webhooks/delivery'
import { renvoyerLivraison } from '../supervision/actions'
import { WebhookForm } from './WebhookForm'
import { essayerAbonnement, modifierAbonnement, supprimerAbonnement } from './actions'

export const dynamic = 'force-dynamic'

const ETATS_LIVRAISON: Record<string, { libelle: string; tone: Tone; glyph: string }> = {
  PENDING: { libelle: 'En attente', tone: 'neutral', glyph: '·' },
  SUCCES: { libelle: 'Réussie', tone: 'success', glyph: '✓' },
  ECHEC: { libelle: 'Échec', tone: 'warning', glyph: '▲' },
  ABANDONNE: { libelle: 'Abandonnée', tone: 'danger', glyph: '✕' },
}

export default async function WebhooksPage() {
  const user = await requireUser()
  const [abonnements, livraisons] = await Promise.all([
    listWebhooks(user.id),
    listDeliveries(user.id, 50),
  ])

  return (
    <PageShell title="Abonnements sortants">
      <div className="flex flex-col gap-6">
        <Card title="Ce que fait cet écran">
          <p className="text-sm text-muted">
            L’application n’appelle que les URL enregistrées ici. Chaque appel est signé
            (HMAC-SHA256 du corps brut) avec le secret propre à l’abonnement, qui ne
            s’affiche jamais. La poussée n’est qu’un confort : tout reste lisible par
            <code> GET /api/events?since=…</code>.
          </p>
        </Card>

        <Card title="Abonnements">
          {abonnements.length === 0 ? (
            <p className="text-sm text-muted">Aucun abonnement enregistré.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {abonnements.map((abonnement) => {
                const suspendu = abonnement.state === 'SUSPENDU'
                return (
                  <li key={abonnement.id} className="border-t border-rule pt-3 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{abonnement.label}</span>
                      <Badge
                        tone={suspendu ? 'danger' : 'success'}
                        glyph={suspendu ? '✕' : '✓'}
                      >
                        {suspendu ? 'Suspendu' : 'Actif'}
                      </Badge>
                    </div>

                    <p className="text-sm text-muted">{abonnement.url}</p>
                    <p className="text-xs text-muted">
                      {abonnement.events.length === 0
                        ? 'Tous les événements'
                        : abonnement.events.join(' · ')}
                      {' — '}dernier événement pris en compte : {abonnement.lastSeq}
                    </p>

                    {suspendu && (
                      <p className="mt-1 text-xs text-muted">
                        {abonnement.consecutiveFailures} échec(s) consécutif(s).
                        {abonnement.lastError !== '' && ` Dernière erreur : ${abonnement.lastError}.`}
                        {' '}Les événements reçus pendant la suspension restent lisibles :
                        <code> GET /api/events?since={abonnement.lastSeq}</code>. La
                        réactivation reprend à l’instant présent, sans déverser l’arriéré.
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2">
                      <form action={essayerAbonnement}>
                        <input type="hidden" name="id" value={abonnement.id} />
                        <Button type="submit" variant="secondary">Essayer</Button>
                      </form>
                      <form action={modifierAbonnement}>
                        <input type="hidden" name="id" value={abonnement.id} />
                        <input type="hidden" name="state" value={suspendu ? 'ACTIF' : 'SUSPENDU'} />
                        <Button type="submit" variant="quiet">
                          {suspendu ? 'Réactiver' : 'Suspendre'}
                        </Button>
                      </form>
                      <form action={supprimerAbonnement}>
                        <input type="hidden" name="id" value={abonnement.id} />
                        <Button type="submit" variant="danger">Supprimer</Button>
                      </form>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="Nouvel abonnement">
          <WebhookForm />
        </Card>

        <Card title="Dernières livraisons">
          {livraisons.length === 0 ? (
            <p className="text-sm text-muted">Aucune livraison pour l’instant.</p>
          ) : (
            <DataTable caption="Tentatives d’appel sortant">
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left">Abonnement</th>
                  <th scope="col" className="p-2 text-left">N°</th>
                  <th scope="col" className="p-2 text-left">Événement</th>
                  <th scope="col" className="p-2 text-left">État</th>
                  <th scope="col" className="p-2 text-left">Tentatives</th>
                  <th scope="col" className="p-2 text-left">Réponse</th>
                  <th scope="col" className="p-2 text-left">Durée</th>
                  <th scope="col" className="p-2 text-left">Erreur</th>
                  <th scope="col" className="p-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {livraisons.map((livraison) => {
                  const etat = ETATS_LIVRAISON[livraison.state] ?? ETATS_LIVRAISON['PENDING']!
                  return (
                    <tr key={livraison.id} className="border-t border-rule">
                      <td className="p-2">{livraison.webhookLabel}</td>
                      <td className="p-2 tabular-nums">{livraison.seq}</td>
                      <td className="p-2">{livraison.action}</td>
                      <td className="p-2">
                        <Badge tone={etat.tone} glyph={etat.glyph}>{etat.libelle}</Badge>
                      </td>
                      <td className="p-2 tabular-nums">{livraison.attempts}</td>
                      <td className="p-2 tabular-nums">
                        {livraison.responseStatus === 0 ? '—' : livraison.responseStatus}
                      </td>
                      <td className="p-2 tabular-nums">{livraison.durationMs} ms</td>
                      <td className="p-2 text-xs text-danger-ink">{livraison.lastError}</td>
                      <td className="p-2">
                        <form action={renvoyerLivraison}>
                          <input type="hidden" name="id" value={livraison.id} />
                          <Button type="submit" variant="quiet">Renvoyer</Button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </PageShell>
  )
}
```

`renvoyerLivraison` est importée depuis les actions de la supervision plutôt que dupliquée : un renvoi est un renvoi, et deux copies divergeraient. Elle revalide `/admin/supervision` ; ajouter `revalidatePath('/admin/webhooks')` à sa suite pour que les deux écrans se rafraîchissent.

- [ ] **Step 6: Ajouter les deux entrées de navigation**

Dans `src/app/(app)/layout.tsx`, compléter `LIENS` :

```ts
const LIENS = [
  { href: '/saisie', label: 'Saisie' },
  { href: '/charge', label: 'Charge' },
  { href: '/missions', label: 'Missions' },
  { href: '/cra', label: 'CRA' },
  { href: '/admin/saisie', label: 'Admin' },
  { href: '/admin/theme', label: 'Thème' },
  { href: '/admin/webhooks', label: 'Abonnements' },
  { href: '/admin/supervision', label: 'Supervision' },
]
```

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run "src/app/(app)/admin"`
Expected: PASS — 12 tests de composants

- [ ] **Step 8: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

Ne **pas** lancer `npx next build` : le serveur de développement du porteur du produit tourne sur cet arbre.

- [ ] **Step 9: Vérifier à la main, sur le serveur de développement**

Le serveur tourne déjà. Ouvrir `/admin/webhooks`, créer un abonnement pointant sur un récepteur local, cliquer **Essayer**, vérifier que la requête arrive signée. Puis valider un CRA, appeler `POST /api/jobs/tick` avec le jeton, et vérifier que l'événement `cra.valide` est parvenu au récepteur **et** qu'il est lisible par `GET /api/events?since=0`.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/admin/supervision" "src/app/(app)/admin/webhooks" "src/app/(app)/layout.tsx"
git commit -m "feat(ui): supervision screen and webhook subscription management"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche |
|---|---|
| `AuditEvent` en ajout seul, jamais modifié ni supprimé | 3, 4 |
| Champs `seq`, `occurredAt`, `actorId`/`actorLabel`, `action`, `entityType`/`entityId`, `payloadJson`, `prevHash`/`hash` | 3, 4 |
| `hash` = empreinte du contenu **et** de `prevHash` | 2 |
| Commande de vérification signalant la première rupture | 2, 4, 13 |
| Consignation des saisies, conversions, transitions de CRA, réglages, réétalonnages | 5, 6 |
| Consignation du push des temps, des factures, de l'agenda et de la signature | catalogue en 1 ; émission par les lots 1b, 2 et 3 |
| **Les consultations ne sont pas consignées** | 5, 6 (tests dédiés dans chacune) |
| Catalogue unique, 25 noms en minuscules pointées | 1 |
| Le catalogue sert au journal, à l'API et aux rappels sortants | 1, 8, 10 |
| `GET /api/events?since=&limit=&event=` | 8 |
| Rattrapage sans perte ni doublon | 4, 8 |
| Jeton dédié, distinct de la session | 8 |
| `Webhook` : URL, libellé, secret, événements en chaîne, état | 3, 9 |
| Liste vide = tous les événements | 1, 9, 10 |
| Écran d'administration : création, modification, suspension | 15 |
| Bouton d'essai, sans écriture au journal | 10, 15 |
| Charge utile à la forme de la spec | 7, 8, 10 |
| Trois en-têtes, dont la signature HMAC du corps brut | 7, 10 |
| Cinq tentatives, recul progressif, puis abandon | 10 |
| Suspension après N échecs consécutifs, N configurable | 3, 10 |
| Renvoi à la main, corps et signature identiques | 10 |
| Un abonnement suspendu ne fait perdre aucun événement | 9, 10 |
| `ScheduledJob` : nom, récurrence, dernière exécution, échéance, état | 3, 12 |
| `POST /api/jobs/tick` protégé par jeton | 12 |
| Un travail en échec ne bloque pas les autres | 12 |
| Chaque travail exécutable à la main | 12, 15 |
| Les sept travaux déclarés | 12 |
| **Aucun travail ne convertit, ne valide, ni ne modifie** | 13 (travail par travail, plus balayage de source) |
| Écran de supervision : alertes, historique filtrable, état des travaux | 14, 15 |
| « Si rien ne cloche, l'écran le dit » | 14, 15 |
| Envoi SMTP minimal, un gabarit par type, en français | 7, 11 |
| Préférence par travail | 12 (`ScheduledJob.enabled`), 15 |
| Sans SMTP, l'ordonnanceur tourne et consigne | 11, 13 |
| Pas de notification sans action possible | 7 (gabarits refusant le vide), 13, 14 |
| Isolation par utilisateur sur la lecture du journal | 4 |

**Hors périmètre, conformément à la spec :** signature cryptographique du journal par clé asymétrique, purge ou archivage du journal, moteur de règles d'automatisation configurable, notifications poussées / SMS / messageries instantanées, ordonnancement à la seconde.

**Hors périmètre, propre à ce plan :** le raccordement des trois travaux portés par les lots 1b, 2 et 3 (`outbox.flush`, `signature.relance`, `signature.rafraichissement`), et l'émission des dix événements de catalogue qui leur appartiennent (`temps.pousses`, `facture.demandee`, `agenda.*`, `signature.*`, `synchro.echec`). Le catalogue et le registre les déclarent ; ce plan ne les implémente pas, et le dit dans son code plutôt que dans ses silences.

## Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas.

- **Le catalogue compte 25 événements**, conformément à la table de la spec ; le brief de rédaction en annonçait vingt-trois, ce qui est un décompte, pas une décision.
- **`seq` est calculé par le service** et non par un `autoincrement`, pour qu'il entre dans l'empreinte.
- **`prevHash` est unique en base** : la fourche de chaîne est interdite par le moteur, pas seulement par le code.
- **`AuditEvent` n'a aucune clé étrangère vers `User`** : supprimer un compte ne doit pas amputer la preuve.
- **Le jeton d'API vit dans l'environnement** (`CRA_API_TOKEN`), pas en base, et sert les deux routes.
- **Le middleware laisse passer tout `/api/`**, chaque route portant sa propre garde.
- **La distribution des rappels sortants relit le journal par `since`**, exactement comme un consommateur : un seul mécanisme pour le tirage et la poussée.
- **Réactiver un abonnement suspendu reprend à l'instant présent**, sans déverser l'arriéré ; le rattrapage passe par l'API, et l'écran affiche le `seq` nécessaire.
- **Le seuil de suspension vaut 10 échecs consécutifs** par défaut — cinq tentatives ne suspendent donc pas sur un seul événement malheureux.
- **L'essai porte `seq: 0`** et l'entité `Essai`, plutôt qu'un nouveau nom d'événement hors catalogue.
- **`engagement.depasse` n'est consigné qu'au franchissement**, pas à chaque saisie au-delà.
- **Les trois travaux des lots 1b, 2 et 3 sont déclarés `INDISPONIBLE`** plutôt qu'omis ou perpétuellement en échec.
- **`tick` exécute les travaux pour le compte le plus ancien**, conséquence directe du choix mono-organisation.
- **L'absence de configuration SMTP est tolérée, une erreur d'envoi ne l'est pas** : la première est un défaut de configuration, la seconde une panne actionnable.
- **La gestion des abonnements n'est pas consignée** : le catalogue décrit les actes du métier, pas la configuration de la plomberie.
