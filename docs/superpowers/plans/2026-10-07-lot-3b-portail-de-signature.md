# Lot 3b — Le client valide et signe dans l'outil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le client reçoit un courriel de l'outil, ouvre une page de l'outil protégée par un code à usage unique, voit son CRA figé sous forme visuelle et le signe ou le refuse dans un cadre Documenso embarqué ; l'outil passe à l'API v2 de Documenso et referme deux défauts du lot 3 (webhook toujours rejeté, mois `ENVOYE` modifiable).

**Architecture:** Le cœur pur (`src/core/signature/`) gagne le contenu figé, les règles du code client et la nouvelle interface du connecteur. Les services (`src/services/signature/`) gardent **une demande par CRA** (l'envoi en cours) et archivent les envois remplacés dans `SignatureEnvoiClos`. Une seule route publique, `/v/[jeton]`, lit uniquement le contenu figé. Toute transition passe encore par `transitionCra` via `applySignatureStatus` ; le webhook n'est plus qu'un signal qui déclenche une relecture chez le prestataire.

**Tech Stack:** Next.js 15 (App Router, server actions), React 19, Prisma 6 (SQLite + Postgres, deux jeux de migrations), Vitest 4 (`happy-dom`/`jsdom` par fichier), nodemailer, Documenso ≥ 2.0.0 auto-hébergé.

**Spec:** `docs/superpowers/specs/2026-10-07-lot-3b-portail-de-signature-design.md`

## Global Constraints

- `src/core/` n'importe jamais `@prisma/client`, `next`, ni React. `node:crypto` est permis (précédent : `core/auth/reinitialisation.ts`).
- Aucun enum Prisma, aucun décimal, aucun tableau, aucune requête fine sur du JSON. Le JSON (`contenuFige`) s'écrit et se lit en bloc.
- Toute évolution de `prisma/schema.prisma` demande **deux** migrations : `prisma/migrations/` (Postgres) et `prisma/migrations-sqlite/` (SQLite). Les garde-fous `src/db/schema-migration-sync.test.ts` et `src/distribution/migrations-sqlite.test.ts` doivent rester verts.
- Toute fonction de service prend un `userId` et scope ses requêtes, **sauf** celles appelées sans session : webhook, page `/v/`, balayages de l'ordonnanceur. Elles le disent dans leur commentaire.
- Aucune page ni action serveur n'interroge Prisma directement.
- Une transition de CRA passe **toujours** par `transitionCra` — jamais `cra.update({ status })`.
- Le journal (`appendAudit`) ne contient **ni nom, ni adresse du signataire, ni motif de refus, ni jeton, ni code**. Noms d'événements en minuscules pointées (`/^[a-z]+(\.[a-z]+)+$/`).
- Aucun montant sur ce que voit le client.
- Aucune information portée par la seule couleur ; tout couple texte/fond ≥ 4,5:1 (utiliser les classes Encre existantes : `text-muted`, `text-link`, `border-rule`, `bg-off`, composants `Badge`, `Banner`, `Button`, `Card`).
- Français pour les chaînes visibles, anglais pour les messages de commit (le dépôt écrit ses sujets en français sans accents : `feat(signature): ...` — suivre le dépôt).
- Code : commentaires en français, au ton et à la densité des fichiers voisins.
- Valeurs fixées par la spec : code **6 chiffres**, valable **10 minutes**, **5 essais**, **5 codes par heure et par lien**, session client **2 heures**, Documenso **≥ 2.0.0**.
- Les tests tournent en série sur une base SQLite (`fileParallelism: false`) : chaque fichier nettoie ce qu'il crée.
- Commande de test : `npx vitest run <chemin>` ; suite complète : `npx vitest run` ; types : `npx tsc --noEmit`.

## Review Focus

1. **Un lien client ouvert par deux onglets / deux codes demandés coup sur coup** — seul le dernier code est valable ; l'ancien échoue proprement avec « code incorrect ou expiré », sans consommer d'essai au-delà du compteur. → test dans la tâche 9 (`demander deux codes : seul le dernier vaut`).
2. **Le client signe, puis le webhook arrive avant que la page ait appelé `confirmerDepuisPage`** — les deux chemins convergent sur `applySignatureStatus`, qui est idempotent : un seul courriel « validé », une seule entrée `signature.recue`. → test dans la tâche 7 (`webhook puis confirmation de page : un seul effet`).
3. **Annuler l'envoi quand Documenso est injoignable** — le CRA reste `ENVOYE`, le lien reste valide, l'écran affiche l'erreur. → test dans la tâche 10.
4. **CRA validé puis rouvert (`ROUVRIR`) puis renvoyé** — l'ancien lien affiche « remplacé », pas le PDF signé de l'envoi précédent. → test dans la tâche 9 (`lien d'un envoi clos signé puis rouvert`).
5. **SMTP absent** — l'envoi réussit, le CRA passe `ENVOYE`, l'échec du courriel est visible et journalisé (`signature.courriel.echoue`), et le lien manuel est générable. → test dans la tâche 6.

---

## File Structure

**Cœur (pur)**
- Modify `src/core/cra/state-machine.ts` — `RENVOYER`, `ANNULER_ENVOI`, `isLocked` élargi, nouveau `isArrete`.
- Modify `src/core/signature/connector.ts` — nouvelle interface (`SignatureDepot`, `SignatureEtat`, `renouveler`, `annuler`, `urlEmbarquee`), corps multipart.
- Modify `src/core/signature/documenso-champs.ts` — format de champ v2.
- Modify `src/core/signature/webhook.ts` — vérification `X-Documenso-Secret`.
- Create `src/core/signature/contenu-fige.ts` — figer / relire un `CraDocument`, empreinte.
- Create `src/core/signature/code-client.ts` — code à 6 chiffres, session client signée, masquage d'adresse.
- Create `src/core/notify/signature.ts` — gabarits de courriel du circuit.
- Modify `src/core/audit/events.ts` — huit noms.

**Données**
- Modify `prisma/schema.prisma` — colonnes de `SignatureRequest`, tables `SignatureEnvoiClos` et `LienClient`.
- Create `prisma/migrations/20261007000000_portail_signature/migration.sql`
- Create `prisma/migrations-sqlite/20261007000000_portail_signature/migration.sql`

**Services**
- Modify `src/services/notify.ts`, `src/integrations/smtp/mailer.ts` — pièces jointes.
- Modify `src/services/signature/documenso.ts` — réécrit en v2 (+ héritage numérique).
- Modify `src/services/signature/fake-connector.ts` — nouvelle interface.
- Create `src/services/signature/envois.ts` — clôture d'un envoi, historique.
- Create `src/services/signature/courriels.ts` — envoi des courriels du circuit, jamais levant.
- Create `src/services/signature/lien-client.ts` — liens, codes, vue client.
- Create `src/services/signature/limiteur.ts` — limitation par IP, en mémoire.
- Create `src/services/signature/annuler.ts` — « Annuler l'envoi ».
- Modify `src/services/signature/send.ts`, `apply.ts`, `refresh.ts`, `webhook.ts`, `reminders.ts`.
- Modify `src/services/cra.ts`, `src/services/cra-pdf.ts` — vue de signature, transitions, lecture du PDF signé.
- Modify `src/services/dolibarr/push.ts`, `src/services/dolibarr/rattrapage.ts` — `isArrete`.

**Écrans**
- Modify `src/middleware.ts`, `src/auth.config.ts` — `/v/` ouvert, en-têtes de sécurité.
- Create `src/app/v/[jeton]/page.tsx`, `src/app/v/[jeton]/actions.ts`, `src/app/v/[jeton]/session.ts`
- Create `src/components/client/CraLecture.tsx`, `src/components/client/CadreSignature.tsx`, `src/components/client/FormulaireCode.tsx`
- Modify `src/app/(app)/cra/[craId]/page.tsx`, `src/app/(app)/cra/[craId]/actions.ts`
- Create `src/components/cra/HistoriqueEnvois.tsx`, `src/components/cra/LienManuel.tsx`
- Modify `src/app/api/webhooks/signature/route.ts`

**Documentation**
- Modify `docs/decisions.md`, `docs/superpowers/ETAT.md`, `docs/integrations.md`, `.env.example`, `.env.docker.example`, `README.md` (section signature si présente).

---

## Contrats partagés

Ces signatures sont **le** vocabulaire entre tâches. Un exécutant qui ne voit que sa tâche s'y réfère.

```ts
// src/core/cra/state-machine.ts
export type CraTransition = 'ENVOYER' | 'VALIDER' | 'REFUSER' | 'ROUVRIR' | 'RENVOYER' | 'ANNULER_ENVOI'
export function isLocked(status: CraStatus): boolean   // ENVOYE | VALIDE — la saisie est fermée
export function isArrete(status: CraStatus): boolean   // VALIDE — les temps peuvent partir

// src/core/signature/connector.ts
export type SignatureStatus = 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE'
export interface SignatureEtat { statut: SignatureStatus; motifRefus: string | null }
export interface SignatureDepot { externalId: string; jetonSignataire: string }
export interface SignatureEnvoi {
  titre: string; fileName: string; pdf: Uint8Array
  destinataire: SignatureContact; champs: ReadonlyArray<SignatureChamp>
  /** notre identifiant, rendu par le prestataire dans ses webhooks */
  reference: string
}
export interface SignatureConnector {
  readonly provider: string
  send(envoi: SignatureEnvoi): Promise<SignatureDepot>
  status(externalId: string): Promise<SignatureEtat>
  download(externalId: string): Promise<Uint8Array>
  /** renouvelle le lien du destinataire ; rend le jeton à jour, ou '' pour un envoi hérité que le prestataire relance lui-même */
  renouveler(externalId: string): Promise<string>
  annuler(externalId: string): Promise<void>
  urlEmbarquee(jetonSignataire: string, signataire: SignatureContact): string
}
export type SignatureFetchLike = (url: string, init: {
  method: string; headers: Record<string, string>; body?: string | Uint8Array | FormData
}) => Promise<Response>

// src/core/signature/contenu-fige.ts
export function figerContenu(document: CraDocument): { json: string; empreinte: string }
export function lireContenu(json: string): CraDocument

// src/core/signature/code-client.ts
export const CODE_DUREE_MINUTES = 10
export const CODE_ESSAIS_MAX = 5
export const CODES_PAR_HEURE_MAX = 5
export const SESSION_CLIENT_MINUTES = 120
export function fabriquerCode(): string
export function empreinteCode(lienId: string, code: string, secret: string): string
export function signerSessionClient(lienId: string, expireAt: Date, secret: string): string
export function lireSessionClient(valeur: string, secret: string, maintenant: Date): string | null
export function masquerEmail(email: string): string

// src/services/notify.ts
export interface PieceJointe { nom: string; type: string; octets: Uint8Array }
export type Mailer = (message: { to: string; sujet: string; corps: string; pieces?: PieceJointe[] }) => Promise<void>
export async function notify(gabarit: Gabarit, deps?: { mailer?: Mailer | null; destinataire?: string; pieces?: PieceJointe[] }): Promise<NotifyResult>

// src/services/signature/courriels.ts — ne lève jamais
export type CourrielRaison = 'ENVOI' | 'CODE' | 'VALIDE_CONSULTANT' | 'VALIDE_CLIENT' | 'REFUSE_CONSULTANT' | 'REFUSE_CLIENT' | 'ANNULATION' | 'RELANCE'
export async function envoyerCourriel(args: {
  craId: string; raison: CourrielRaison; to: string; gabarit: Gabarit
  pieces?: PieceJointe[]; mailer?: Mailer | null
}): Promise<{ envoye: boolean; motif: string }>

// src/services/signature/envois.ts
export async function cloreEnvoiCourant(tx: Prisma.TransactionClient, craId: string, maintenant: Date): Promise<void>
export interface EnvoiVue {
  numero: number; status: 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE' | 'ANNULE'
  sentAt: Date; completedAt: Date | null; motifRefus: string
  signataireNom: string; empreinte: string; enCours: boolean
}
export async function listerEnvois(userId: string, craId: string): Promise<EnvoiVue[]>

// src/services/signature/lien-client.ts
export async function creerLienClient(tx: Prisma.TransactionClient, args: { craId: string; numero: number; jetonSignataire: string }): Promise<string> // rend le jeton en clair
export async function revoquerLiensDuCra(tx: Prisma.TransactionClient, craId: string, maintenant: Date): Promise<void>
export type EtatLien = 'INCONNU' | 'ACTIF' | 'REMPLACE' | 'RETIRE'
export async function resoudreLien(jeton: string): Promise<{ etat: EtatLien; lienId: string | null }>
export async function demanderCode(jeton: string, deps?: { maintenant?: Date; mailer?: Mailer | null }): Promise<{ ok: true; adresseMasquee: string } | { ok: false; raison: 'LIEN' | 'TROP_DE_CODES' }>
export async function verifierCode(jeton: string, code: string, deps?: { maintenant?: Date }): Promise<{ ok: true; lienId: string } | { ok: false; raison: 'LIEN' | 'CODE' | 'EPUISE' }>
export interface VueClient {
  etat: EtatLien
  document: CraDocument | null
  statut: 'A_SIGNER' | 'SIGNE' | 'REFUSE' | 'EXPIRE'
  signeLe: Date | null; refuseLe: Date | null; motifRefus: string
  empreinte: string
  pdfSigneDisponible: boolean
  urlEmbarquee: string | null
}
export async function lireVueClient(lienId: string, deps?: { connector?: SignatureConnector | null; maintenant?: Date }): Promise<VueClient>
export async function confirmerDepuisPage(lienId: string, deps?: { connector?: SignatureConnector | null }): Promise<void>
export async function pdfSigneDuLien(lienId: string): Promise<{ fileName: string; bytes: Uint8Array } | null>
export async function nouveauLienManuel(userId: string, craId: string, origine: string): Promise<{ ok: true; url: string } | { ok: false }>

// src/services/signature/send.ts
export async function sendCraForSignature(userId: string, craId: string, options?: {
  connector?: SignatureConnector | null; origine?: string; mailer?: Mailer | null
}): Promise<SendCraResult>

// src/services/signature/annuler.ts
export async function annulerEnvoi(userId: string, craId: string, options?: {
  connector?: SignatureConnector | null; mailer?: Mailer | null
}): Promise<{ ok: true } | { ok: false; raison: 'TRANSITION_IMPOSSIBLE' | 'CONNECTEUR_EN_ECHEC'; message: string }>

// src/services/signature/apply.ts
export async function applySignatureStatus(args: {
  craId: string; externalId: string; statut: SignatureStatus; motifRefus?: string | null
  connector?: SignatureConnector | null; mailer?: Mailer | null
}): Promise<SignatureEffet>
```

---

### Task 1: Machine à états — verrou d'`ENVOYE`, arrêt séparé, deux transitions

**Files:**
- Modify: `src/core/cra/state-machine.ts`
- Modify: `src/core/cra/state-machine.test.ts`
- Modify: `src/services/cra.ts` (table `ACTION_PAR_TRANSITION`, ~ligne 30)
- Modify: `src/services/dolibarr/push.ts:171`, `src/services/dolibarr/rattrapage.ts:78`
- Modify: `src/app/(app)/cra/[craId]/page.tsx` (`LABELS`, `ALL`)
- Test: `src/services/dolibarr/push.test.ts`, `src/services/dolibarr/rattrapage.test.ts`, `src/services/time-entries.test.ts`, `src/services/cells.test.ts`, `src/services/rates.test.ts`, `src/services/missions.test.ts`, `src/services/sync/conflicts.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `CraTransition` à six valeurs, `isLocked`, `isArrete` (voir Contrats).

- [ ] **Step 1: Écrire les tests du noyau qui échouent**

Ajouter à `src/core/cra/state-machine.test.ts` :

```ts
import { applyTransition, canTransition, isArrete, isLocked } from './state-machine'

describe('lot 3b — verrou, arrêt et nouvelles transitions', () => {
  it('ENVOYE ferme la saisie, comme VALIDE', () => {
    expect(isLocked('ENVOYE')).toBe(true)
    expect(isLocked('VALIDE')).toBe(true)
    expect(isLocked('BROUILLON')).toBe(false)
    // Un refus rend le mois modifiable : c'est tout l'intérêt de refuser.
    expect(isLocked('REFUSE')).toBe(false)
  })

  it('seul VALIDE arrête le mois — ENVOYE ne doit rien pousser vers Dolibarr', () => {
    expect(isArrete('VALIDE')).toBe(true)
    expect(isArrete('ENVOYE')).toBe(false)
    expect(isArrete('BROUILLON')).toBe(false)
    expect(isArrete('REFUSE')).toBe(false)
  })

  it('RENVOYER part de REFUSE vers ENVOYE, et de nulle part ailleurs', () => {
    expect(applyTransition('REFUSE', 'RENVOYER')).toBe('ENVOYE')
    expect(canTransition('BROUILLON', 'RENVOYER')).toBe(false)
    expect(canTransition('ENVOYE', 'RENVOYER')).toBe(false)
    expect(canTransition('VALIDE', 'RENVOYER')).toBe(false)
  })

  it('ANNULER_ENVOI part de ENVOYE vers BROUILLON ; ROUVRIR reste refusé depuis ENVOYE', () => {
    expect(applyTransition('ENVOYE', 'ANNULER_ENVOI')).toBe('BROUILLON')
    expect(canTransition('ENVOYE', 'ROUVRIR')).toBe(false)
    expect(canTransition('REFUSE', 'ANNULER_ENVOI')).toBe(false)
    expect(canTransition('VALIDE', 'ANNULER_ENVOI')).toBe(false)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/cra/state-machine.test.ts`
Expected: FAIL — `isArrete` n'est pas exporté ; `isLocked('ENVOYE')` vaut `false`.

- [ ] **Step 3: Implémenter**

Remplacer le contenu de `src/core/cra/state-machine.ts` par :

```ts
import type { CraStatus } from '../types'

export type CraTransition =
  | 'ENVOYER'
  | 'VALIDER'
  | 'REFUSER'
  | 'ROUVRIR'
  /** corriger un refus et repartir en un geste, sans « Rouvrir » puis « Envoyer » */
  | 'RENVOYER'
  /**
   * Retirer un CRA envoyé avant la réponse du client. N'est franchie que par
   * `annulerEnvoi`, qui annule aussi l'enveloppe chez le prestataire : un CRA
   * rouvert chez nous mais encore signable ailleurs validerait un mois en cours
   * de modification.
   */
  | 'ANNULER_ENVOI'

export class InvalidTransitionError extends Error {
  constructor(from: CraStatus, transition: CraTransition) {
    super(`Transition ${transition} impossible depuis l'état ${from}`)
    this.name = 'InvalidTransitionError'
  }
}

const TRANSITIONS: Record<CraStatus, Partial<Record<CraTransition, CraStatus>>> = {
  BROUILLON: { ENVOYER: 'ENVOYE' },
  ENVOYE: { VALIDER: 'VALIDE', REFUSER: 'REFUSE', ANNULER_ENVOI: 'BROUILLON' },
  VALIDE: { ROUVRIR: 'BROUILLON' },
  REFUSE: { ROUVRIR: 'BROUILLON', RENVOYER: 'ENVOYE' },
}

export function canTransition(from: CraStatus, t: CraTransition): boolean {
  return TRANSITIONS[from][t] !== undefined
}

export function applyTransition(from: CraStatus, t: CraTransition): CraStatus {
  const next = TRANSITIONS[from][t]
  if (next === undefined) throw new InvalidTransitionError(from, t)
  return next
}

/**
 * **La saisie du mois est fermée.**
 *
 * `ENVOYE` en fait partie depuis le lot 3b : sans ce verrou, le consultant
 * modifiait ses jours pendant que le client relisait, et une signature
 * arrivée ensuite validait des chiffres que le client n'avait pas vus.
 *
 * À ne pas confondre avec `isArrete` : un mois fermé n'est pas forcément un
 * mois dont les temps peuvent partir.
 */
export function isLocked(status: CraStatus): boolean {
  return status === 'ENVOYE' || status === 'VALIDE'
}

/**
 * **Le mois est arrêté : ses temps peuvent partir chez Dolibarr.**
 *
 * Séparé de `isLocked` au lot 3b. Le push et son rattrapage lisaient
 * `isLocked` dans ce sens-là ; l'élargir à `ENVOYE` leur aurait fait pousser
 * des temps **avant** la signature du client.
 */
export function isArrete(status: CraStatus): boolean {
  return status === 'VALIDE'
}
```

Dans `src/services/cra.ts`, compléter la table des événements (chercher `const ACTION_PAR_TRANSITION`) :

```ts
const ACTION_PAR_TRANSITION: Record<CraTransition, AuditAction> = {
  ENVOYER: 'cra.envoye',
  VALIDER: 'cra.valide',
  REFUSER: 'cra.refuse',
  ROUVRIR: 'cra.rouvert',
  // Un renvoi est un envoi, une annulation est une réouverture : le catalogue
  // public n'a pas à apprendre deux noms pour deux gestes qu'il connaît déjà.
  RENVOYER: 'cra.envoye',
  ANNULER_ENVOI: 'cra.rouvert',
}
```

(Garder la forme exacte de la déclaration existante — si elle est typée autrement, ajouter seulement les deux clés.)

Dans `src/services/dolibarr/push.ts` : remplacer l'import `isLocked` par `isArrete` et la ligne 171 par `if (!isArrete(cra.status as CraStatus)) return resultat`. Mettre à jour le commentaire au-dessus : « Le mois doit être **arrêté** (`isArrete`), pas seulement fermé : un CRA `ENVOYE` attend encore la signature du client. »

Dans `src/services/dolibarr/rattrapage.ts` : même remplacement, ligne 78 : `const valides = cras.filter((c) => isArrete(c.status as CraStatus))`.

Dans `src/app/(app)/cra/[craId]/page.tsx` :

```ts
const LABELS: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
  RENVOYER: 'Marquer renvoyé',
  ANNULER_ENVOI: 'Annuler l’envoi',
}

// `ANNULER_ENVOI` n'est pas une transition manuelle : son bouton dédié
// (tâche 10) annule aussi l'enveloppe chez le prestataire.
const ALL: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR', 'RENVOYER']
```

- [ ] **Step 4: Vérifier que le noyau passe**

Run: `npx vitest run src/core/cra/state-machine.test.ts`
Expected: PASS.

- [ ] **Step 5: Prouver le verrou chez chaque appelant**

Pour chacun des fichiers de test ci-dessous, trouver le test existant qui prouve le refus d'écriture sur un mois `VALIDE` :

```bash
grep -n "VALIDE" src/services/time-entries.test.ts src/services/cells.test.ts src/services/rates.test.ts src/services/missions.test.ts src/services/sync/conflicts.test.ts | head -40
```

Dans chaque fichier, dupliquer **ce** test juste en dessous, en renommant son titre avec le suffixe ` — aussi sur un mois ENVOYE (lot 3b)` et en remplaçant `status: 'VALIDE'` par `status: 'ENVOYE'` dans la création du CRA. Ne rien changer d'autre : les fixtures et les assertions du test d'origine sont la preuve attendue. (Pour `time-entries.test.ts`, l'assertion attendue est `{ ok: false, reason: 'VERROUILLE' }` ; pour `cells.test.ts`, `isMonthLocked(...)` vaut `true`.)

Dans `src/services/dolibarr/push.test.ts` et `src/services/dolibarr/rattrapage.test.ts`, trouver le test qui prouve qu'un CRA `BROUILLON` n'est pas poussé / pas rattrapé :

```bash
grep -n "BROUILLON" src/services/dolibarr/push.test.ts src/services/dolibarr/rattrapage.test.ts | head
```

Le dupliquer avec `status: 'ENVOYE'` et le titre ` — ni un CRA ENVOYE, qui attend la signature (lot 3b)`.

- [ ] **Step 6: Lancer les suites touchées**

Run: `npx vitest run src/core/cra src/services/time-entries.test.ts src/services/cells.test.ts src/services/rates.test.ts src/services/missions.test.ts src/services/sync/conflicts.test.ts src/services/dolibarr "src/app/(app)/cra"`
Expected: PASS. Si un test **existant** échoue parce qu'il écrivait sur un mois `ENVOYE`, c'est le défaut que ce lot referme : modifier ce test pour qu'il crée son CRA en `BROUILLON`, et le signaler dans le message de commit.

- [ ] **Step 7: Types**

Run: `npx tsc --noEmit`
Expected: 0 erreur. (Toute table `Record<CraTransition, …>` du dépôt doit recevoir les deux clés ; `grep -rn "Record<CraTransition" src` les liste.)

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "feat(cra): un CRA envoye ferme la saisie, l'arret du mois devient isArrete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schéma et migrations

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261007000000_portail_signature/migration.sql`
- Create: `prisma/migrations-sqlite/20261007000000_portail_signature/migration.sql`

**Interfaces:**
- Produces: modèles `SignatureRequest` (colonnes ajoutées), `SignatureEnvoiClos`, `LienClient`, relations `Cra.envoisClos`, `Cra.liensClient`.

- [ ] **Step 1: Modifier le schéma**

Dans `model SignatureRequest`, remplacer le commentaire de tête et ajouter les colonnes **après** `signataireEmail` :

```prisma
/// L'état de l'envoi **en cours**. Une seule par CRA : renvoyer recopie
/// d'abord l'envoi précédent dans `SignatureEnvoiClos`, puis le remplace.
/// Empiler les demandes obligerait chaque lecture à décider laquelle fait
/// foi, et une seule divergence suffirait à verrouiller un mois sur un
/// document périmé.
model SignatureRequest {
  // … champs existants inchangés jusqu'à signataireEmail …

  /// 1, 2, 3… — incrémenté à chaque renvoi
  numero      Int    @default(1)
  /// l'enveloppe de **cet** envoi ; `ExternalLink` reste la correspondance du CRA
  externalId  String @default("")
  /// texte du client, tel quel ; ne sort jamais vers le journal
  motifRefus  String @default("")
  /// le `CraDocument` envoyé, en JSON, écrit et lu en bloc
  contenuFige String @default("")
  /// SHA-256 hexadécimal de `contenuFige`
  empreinte   String @default("")
  /// adresse publique de l'outil au moment de l'envoi : les relances n'ont pas
  /// de requête d'où la déduire. Vide = envoi antérieur au lot 3b.
  origine     String @default("")

  // … sentAt, relances, etc. inchangés …
}
```

et mettre à jour le commentaire de `status` : `/// 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE' | 'ANNULE'`.

Ajouter, après `model SignatureRequest` :

```prisma
/// Un envoi **remplacé** (renvoi après refus, ou annulation), recopié tel
/// quel au moment du remplacement. Une ligne close ne change plus jamais :
/// rien ne peut donc diverger de l'envoi en cours.
model SignatureEnvoiClos {
  id              String    @id @default(cuid())
  craId           String
  numero          Int
  /// 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE' | 'ANNULE'
  status          String
  motifRefus      String    @default("")
  signataireNom   String    @default("")
  signataireEmail String    @default("")
  sentAt          DateTime
  completedAt     DateTime?
  empreinte       String    @default("")
  closAt          DateTime  @default(now())

  cra Cra @relation(fields: [craId], references: [id], onDelete: Cascade)

  @@unique([craId, numero])
}

/// Le lien que reçoit le client. **Le jeton n'est jamais stocké** : seule son
/// empreinte SHA-256, comme pour la réinitialisation de mot de passe.
model LienClient {
  id                     String    @id @default(cuid())
  craId                  String
  /// l'envoi servi ; un lien dont le numéro est dépassé est « remplacé »
  numero                 Int
  jetonEmpreinte         String    @unique
  /// jeton Documenso du destinataire, pour le cadre embarqué
  jetonSignataire        String    @default("")
  revokedAt              DateTime?
  codeEmpreinte          String    @default("")
  codeExpireAt           DateTime?
  codeEssais             Int       @default(0)
  /// codes envoyés dans la fenêtre d'une heure qui commence à `codesFenetreAt`
  codesEnvoyes           Int       @default(0)
  codesFenetreAt         DateTime?
  derniereConsultationAt DateTime?
  createdAt              DateTime  @default(now())

  cra Cra @relation(fields: [craId], references: [id], onDelete: Cascade)

  @@index([craId, numero])
}
```

Dans `model Cra`, après `signatureRequest SignatureRequest?` :

```prisma
  envoisClos  SignatureEnvoiClos[]
  liensClient LienClient[]
```

- [ ] **Step 2: Générer les deux migrations**

```bash
mkdir -p prisma/migrations/20261007000000_portail_signature prisma/migrations-sqlite/20261007000000_portail_signature
node scripts/set-db-provider.mjs postgresql
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261007000000_portail_signature/migration.sql
node scripts/set-db-provider.mjs sqlite
npx prisma migrate diff --from-migrations prisma/migrations-sqlite --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations-sqlite/20261007000000_portail_signature/migration.sql
```

> Si `migrate diff --from-migrations` réclame une base fantôme (`--shadow-database-url`), suivre ce que le README propose ; à défaut, écrire les fichiers à la main sur le modèle de `20260914000000_pause_et_trajets` : une colonne par `ALTER TABLE` côté SQLite, `TIMESTAMP(3)` côté Postgres, `DATETIME` côté SQLite.

Ouvrir les deux fichiers et ajouter en tête un commentaire sur le modèle des migrations voisines :

```sql
-- Lot 3b — le client valide et signe dans l'outil.
--
-- L'envoi en cours garde sa ligne unique ; les envois remplacés sont recopiés
-- dans SignatureEnvoiClos. LienClient ne porte que l'empreinte du jeton.
```

Vérifier que le fichier SQLite ne contient **aucune** reconstruction de `SignatureRequest` (`CREATE TABLE "new_SignatureRequest"`) : seules des colonnes sont ajoutées, avec valeur par défaut, et une reconstruction serait un signe de diff erroné.

- [ ] **Step 3: Appliquer en local et régénérer le client**

```bash
npx prisma db push --skip-generate && npx prisma generate
```

- [ ] **Step 4: Lancer les garde-fous**

Run: `npx vitest run src/db/schema-migration-sync.test.ts src/distribution/migrations-sqlite.test.ts`
Expected: PASS.

- [ ] **Step 5: Types**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add prisma
git commit -m "feat(signature): schema de l'envoi en cours, des envois clos et du lien client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cœur pur — contenu figé, code client, gabarits, catalogue

**Files:**
- Create: `src/core/signature/contenu-fige.ts`, `src/core/signature/contenu-fige.test.ts`
- Create: `src/core/signature/code-client.ts`, `src/core/signature/code-client.test.ts`
- Create: `src/core/notify/signature.ts`, `src/core/notify/signature.test.ts`
- Modify: `src/core/audit/events.ts`, `src/core/audit/events.test.ts`

**Interfaces:**
- Consumes: `CraDocument`, `formatJours`, `libelleMois` (`src/core/cra/document.ts`), `Gabarit` (`src/core/notify/templates.ts`).
- Produces: `figerContenu`, `lireContenu`, constantes et fonctions de `code-client`, gabarits `gabaritEnvoiClient`, `gabaritCodeClient`, `gabaritValideConsultant`, `gabaritValideClient`, `gabaritRefusConsultant`, `gabaritRefusClient`, `gabaritAnnulationClient`, `gabaritRelanceClient`.

- [ ] **Step 1: Tests du contenu figé**

`src/core/signature/contenu-fige.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import type { CraDocument } from '@/core/cra/document'
import { figerContenu, lireContenu } from './contenu-fige'

const ENGAGEMENT_VIDE = {} as CraDocument['engagementMission']

function documentDeTest(): CraDocument {
  return {
    emetteur: { nom: 'Kreativ', adresse: '1 rue', siret: '123', email: 'k@exemple.fr' },
    clientNom: 'Client',
    missionLabel: 'ITSM',
    mois: '2026-09',
    moisLibelle: 'septembre 2026',
    signataireNom: 'Jeanne Martin',
    signataireEmail: 'jeanne@client.test',
    lignes: [
      {
        label: 'Consultant',
        jours: [{ date: '2026-09-01', centiemes: 100 }],
        totalCentiemes: 100,
        engagement: ENGAGEMENT_VIDE,
      },
    ],
    totalCentiemes: 100,
    joursDuMois: ['2026-09-01'],
    feries: [],
    engagementMission: ENGAGEMENT_VIDE,
  }
}

describe('contenu figé', () => {
  it('relit exactement ce qui a été figé', () => {
    const doc = documentDeTest()
    const { json } = figerContenu(doc)
    expect(lireContenu(json)).toEqual(doc)
  })

  it("l'empreinte est le SHA-256 hexadécimal du JSON stocké", () => {
    const { json, empreinte } = figerContenu(documentDeTest())
    expect(empreinte).toBe(createHash('sha256').update(json, 'utf8').digest('hex'))
    expect(empreinte).toMatch(/^[0-9a-f]{64}$/)
  })

  it('deux documents identiques donnent la même empreinte, un jour de plus la change', () => {
    const a = figerContenu(documentDeTest()).empreinte
    const b = figerContenu(documentDeTest()).empreinte
    const autre = documentDeTest()
    autre.lignes[0]!.jours[0]!.centiemes = 50
    expect(a).toBe(b)
    expect(figerContenu(autre).empreinte).not.toBe(a)
  })

  it("refuse un JSON qui n'est pas un document de CRA", () => {
    expect(() => lireContenu('')).toThrow()
    expect(() => lireContenu('{"mois":"2026-09"}')).toThrow()
  })

  it('ne porte aucun champ monétaire', () => {
    const { json } = figerContenu(documentDeTest())
    expect(json).not.toMatch(/tjm|cents|montant|prix/i)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/core/signature/contenu-fige.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

`src/core/signature/contenu-fige.ts` :

```ts
/**
 * Le contenu d'un CRA **tel qu'il est parti chez le client**.
 *
 * La page client ne lit que lui, jamais les saisies vivantes : ce que le
 * client voit et signe ne bouge donc pas, quoi que le consultant fasse
 * ensuite — y compris rouvrir le CRA ou changer un réglage de conversion.
 * C'est la règle « le gel se casse en lecture » appliquée au document entier :
 * un JSON figé ne se reconvertit plus.
 *
 * Pur : `node:crypto` seulement.
 */
import { createHash } from 'node:crypto'
import type { CraDocument } from '../cra/document'

export function figerContenu(document: CraDocument): { json: string; empreinte: string } {
  const json = JSON.stringify(document)
  return { json, empreinte: createHash('sha256').update(json, 'utf8').digest('hex') }
}

/**
 * Relit un contenu figé. **Lève** sur un contenu illisible : une page client
 * qui afficherait un document à moitié vide inviterait à signer autre chose
 * que ce qui a été envoyé.
 */
export function lireContenu(json: string): CraDocument {
  const valeur: unknown = JSON.parse(json)
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) {
    throw new Error('Contenu figé illisible.')
  }
  const doc = valeur as Partial<CraDocument>
  if (
    typeof doc.mois !== 'string' ||
    !Array.isArray(doc.lignes) ||
    !Array.isArray(doc.joursDuMois) ||
    typeof doc.totalCentiemes !== 'number'
  ) {
    throw new Error('Contenu figé incomplet.')
  }
  return doc as CraDocument
}
```

- [ ] **Step 4: Vérifier**

Run: `npx vitest run src/core/signature/contenu-fige.test.ts`
Expected: PASS.

- [ ] **Step 5: Tests du code client**

`src/core/signature/code-client.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  CODE_DUREE_MINUTES,
  CODE_ESSAIS_MAX,
  CODES_PAR_HEURE_MAX,
  SESSION_CLIENT_MINUTES,
  empreinteCode,
  fabriquerCode,
  lireSessionClient,
  masquerEmail,
  signerSessionClient,
} from './code-client'

const SECRET = 'secret-de-test'

describe('code client', () => {
  it('reprend les valeurs de la spec', () => {
    expect(CODE_DUREE_MINUTES).toBe(10)
    expect(CODE_ESSAIS_MAX).toBe(5)
    expect(CODES_PAR_HEURE_MAX).toBe(5)
    expect(SESSION_CLIENT_MINUTES).toBe(120)
  })

  it('fabrique six chiffres, zéros de tête compris', () => {
    for (let i = 0; i < 200; i += 1) expect(fabriquerCode()).toMatch(/^\d{6}$/)
  })

  it("l'empreinte dépend du lien, du code et du secret", () => {
    const base = empreinteCode('lien-a', '123456', SECRET)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(empreinteCode('lien-a', '123456', SECRET)).toBe(base)
    expect(empreinteCode('lien-b', '123456', SECRET)).not.toBe(base)
    expect(empreinteCode('lien-a', '123457', SECRET)).not.toBe(base)
    expect(empreinteCode('lien-a', '123456', 'autre')).not.toBe(base)
  })
})

describe('session client', () => {
  const maintenant = new Date('2026-10-07T10:00:00Z')
  const expire = new Date('2026-10-07T12:00:00Z')

  it('rend le lien signé tant que la session vit', () => {
    const v = signerSessionClient('lien-a', expire, SECRET)
    expect(lireSessionClient(v, SECRET, maintenant)).toBe('lien-a')
  })

  it("refuse une session expirée, à la seconde près", () => {
    const v = signerSessionClient('lien-a', expire, SECRET)
    expect(lireSessionClient(v, SECRET, expire)).toBeNull()
  })

  it('refuse une session falsifiée ou signée par un autre secret', () => {
    const v = signerSessionClient('lien-a', expire, SECRET)
    const [, exp, mac] = v.split('.')
    expect(lireSessionClient(`lien-b.${exp}.${mac}`, SECRET, maintenant)).toBeNull()
    expect(lireSessionClient(v, 'autre', maintenant)).toBeNull()
    expect(lireSessionClient('n.importe.quoi', SECRET, maintenant)).toBeNull()
    expect(lireSessionClient('', SECRET, maintenant)).toBeNull()
  })

  it('refuse tout sans secret', () => {
    const v = signerSessionClient('lien-a', expire, SECRET)
    expect(lireSessionClient(v, '', maintenant)).toBeNull()
  })
})

describe('masquerEmail', () => {
  it("ne laisse voir que l'initiale et le domaine", () => {
    expect(masquerEmail('jeanne.martin@client.fr')).toBe('j•••@client.fr')
    expect(masquerEmail('a@b.fr')).toBe('a•••@b.fr')
  })

  it('ne lève pas sur une adresse sans arobase', () => {
    expect(masquerEmail('invalide')).toBe('•••')
  })
})
```

- [ ] **Step 6: Vérifier l'échec**

Run: `npx vitest run src/core/signature/code-client.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 7: Implémenter**

`src/core/signature/code-client.ts` :

```ts
/**
 * Les règles du code à usage unique et de la session du client.
 *
 * Pur : `node:crypto` seulement, et l'heure toujours passée en argument.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export const CODE_DUREE_MINUTES = 10
export const CODE_ESSAIS_MAX = 5
export const CODES_PAR_HEURE_MAX = 5
export const SESSION_CLIENT_MINUTES = 120

/** Six chiffres, tirés uniformément — `randomInt` et non `Math.random`. */
export function fabriquerCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * L'empreinte stockée. **HMAC, et non SHA-256 nu** : un million de codes se
 * parcourent en un instant, et une copie de la base ne doit pas suffire à
 * retrouver un code en cours. Le lien entre dans le message, pour qu'un même
 * code sur deux liens n'ait pas la même empreinte.
 */
export function empreinteCode(lienId: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${lienId}:${code}`, 'utf8').digest('hex')
}

function mac(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

/** `lienId.expirationEnMs.hmac` — lisible, mais infalsifiable sans le secret. */
export function signerSessionClient(lienId: string, expireAt: Date, secret: string): string {
  const corps = `${lienId}.${expireAt.getTime()}`
  return `${corps}.${mac(corps, secret)}`
}

/**
 * Le lien que la session ouvre, ou `null`. Comparaison à temps constant ; sans
 * secret, aucune session n'est valide — jamais de repli permissif.
 */
export function lireSessionClient(valeur: string, secret: string, maintenant: Date): string | null {
  if (secret === '') return null
  const morceaux = valeur.split('.')
  if (morceaux.length !== 3) return null
  const [lienId, exp, fourni] = morceaux as [string, string, string]
  if (lienId === '' || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(fourni)) return null

  const attendu = mac(`${lienId}.${exp}`, secret)
  if (!timingSafeEqual(Buffer.from(attendu, 'hex'), Buffer.from(fourni, 'hex'))) return null
  if (maintenant.getTime() >= Number(exp)) return null
  return lienId
}

/** `jeanne.martin@client.fr` → `j•••@client.fr` : de quoi se reconnaître, pas de quoi être lu. */
export function masquerEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}
```

- [ ] **Step 8: Vérifier**

Run: `npx vitest run src/core/signature/code-client.test.ts`
Expected: PASS.

- [ ] **Step 9: Tests des gabarits**

`src/core/notify/signature.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  gabaritAnnulationClient,
  gabaritCodeClient,
  gabaritEnvoiClient,
  gabaritRefusClient,
  gabaritRefusConsultant,
  gabaritRelanceClient,
  gabaritValideClient,
  gabaritValideConsultant,
} from './signature'

const base = {
  clientNom: 'Client SA',
  missionLabel: 'ITSM',
  moisLibelle: 'septembre 2026',
  signataireNom: 'Jeanne Martin',
}

describe('gabarits du circuit de signature', () => {
  it("l'envoi porte le lien et le mois", () => {
    const g = gabaritEnvoiClient({ ...base, lien: 'https://cra.test/v/abc' })
    expect(g.sujet).toContain('septembre 2026')
    expect(g.corps).toContain('https://cra.test/v/abc')
  })

  it('le code porte le code et sa durée', () => {
    const g = gabaritCodeClient({ code: '042317', minutes: 10 })
    expect(g.corps).toContain('042317')
    expect(g.corps).toContain('10 minutes')
    expect(g.sujet).not.toContain('042317')
  })

  it('le refus porte le motif, chez le consultant comme chez le client', () => {
    const motif = 'Il manque la journée du 15.'
    expect(gabaritRefusConsultant({ ...base, motif, lienCra: 'https://cra.test/cra/1' }).corps).toContain(motif)
    expect(gabaritRefusClient({ ...base, motif }).corps).toContain(motif)
  })

  it('la validation dit si le PDF est joint ou non', () => {
    expect(gabaritValideConsultant({ ...base, pdfJoint: true }).corps).toContain('joint')
    expect(gabaritValideClient({ ...base, pdfJoint: false }).corps).toContain('pas encore disponible')
  })

  it("l'annulation et la relance se lisent sans contexte", () => {
    expect(gabaritAnnulationClient(base).corps).toContain('retiré')
    expect(gabaritRelanceClient({ ...base, lien: 'https://cra.test/v/abc' }).corps).toContain('https://cra.test/v/abc')
  })

  it("aucun gabarit n'évoque un montant", () => {
    const tous = [
      gabaritEnvoiClient({ ...base, lien: 'x' }),
      gabaritValideClient({ ...base, pdfJoint: true }),
      gabaritValideConsultant({ ...base, pdfJoint: true }),
      gabaritRefusClient({ ...base, motif: 'm' }),
      gabaritRefusConsultant({ ...base, motif: 'm', lienCra: 'x' }),
      gabaritAnnulationClient(base),
      gabaritRelanceClient({ ...base, lien: 'x' }),
    ]
    for (const g of tous) expect(`${g.sujet}\n${g.corps}`).not.toMatch(/€|montant|tarif|TJM/i)
  })
})
```

- [ ] **Step 10: Implémenter les gabarits**

`src/core/notify/signature.ts` :

```ts
/**
 * Les courriels du circuit de signature (lot 3b). Texte brut, en français,
 * comme les gabarits voisins. **Aucun montant** : le CRA atteste du temps.
 */
import type { Gabarit } from './templates'

interface Contexte {
  clientNom: string
  missionLabel: string
  moisLibelle: string
  signataireNom: string
}

function objet(c: Contexte): string {
  return `${c.clientNom} · ${c.missionLabel} — ${c.moisLibelle}`
}

export function gabaritEnvoiClient(c: Contexte & { lien: string }): Gabarit {
  return {
    sujet: `Votre CRA de ${c.moisLibelle} est prêt — ${c.missionLabel}`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Le compte-rendu d'activité ${objet(c)} est prêt pour votre validation.`,
      '',
      'Pour le consulter et le signer :',
      `  ${c.lien}`,
      '',
      'Un code de confirmation vous sera envoyé à cette adresse à l’ouverture du lien.',
    ].join('\n'),
  }
}

export function gabaritCodeClient(args: { code: string; minutes: number }): Gabarit {
  return {
    sujet: 'Votre code de confirmation',
    corps: [
      `Votre code : ${args.code}`,
      '',
      `Il est valable ${args.minutes} minutes.`,
      'Si vous n’avez rien demandé, ignorez ce message.',
    ].join('\n'),
  }
}

export function gabaritValideConsultant(c: Contexte & { pdfJoint: boolean }): Gabarit {
  return {
    sujet: `CRA validé — ${objet(c)}`,
    corps: [
      `${c.signataireNom} a validé et signé le CRA ${objet(c)}.`,
      '',
      c.pdfJoint
        ? 'Le document signé est joint à ce message.'
        : 'Le document signé n’est pas encore disponible ; il le sera dans l’outil dès son archivage.',
    ].join('\n'),
  }
}

export function gabaritValideClient(c: Contexte & { pdfJoint: boolean }): Gabarit {
  return {
    sujet: `Confirmation — CRA ${c.moisLibelle} signé`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Votre signature du CRA ${objet(c)} est bien enregistrée.`,
      '',
      c.pdfJoint
        ? 'Le document signé est joint à ce message.'
        : 'Le document signé n’est pas encore disponible ; il reste téléchargeable depuis le lien reçu.',
    ].join('\n'),
  }
}

export function gabaritRefusConsultant(c: Contexte & { motif: string; lienCra: string }): Gabarit {
  return {
    sujet: `CRA refusé — ${objet(c)}`,
    corps: [
      `${c.signataireNom} a refusé le CRA ${objet(c)}.`,
      '',
      'Motif :',
      `  « ${c.motif} »`,
      '',
      'La saisie du mois est rouverte. Corrigez puis renvoyez :',
      `  ${c.lienCra}`,
    ].join('\n'),
  }
}

export function gabaritRefusClient(c: Contexte & { motif: string }): Gabarit {
  return {
    sujet: `Refus transmis — CRA ${c.moisLibelle}`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Votre refus du CRA ${objet(c)} a bien été transmis, avec ce motif :`,
      `  « ${c.motif} »`,
      '',
      'Une version corrigée vous sera adressée.',
    ].join('\n'),
  }
}

export function gabaritAnnulationClient(c: Contexte): Gabarit {
  return {
    sujet: `CRA retiré — ${c.moisLibelle}`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Le CRA ${objet(c)} qui vous avait été adressé a été retiré.`,
      'Une nouvelle version vous sera envoyée. Le lien précédent n’est plus valable.',
    ].join('\n'),
  }
}

export function gabaritRelanceClient(c: Contexte & { lien: string }): Gabarit {
  return {
    sujet: `Rappel — CRA ${c.moisLibelle} en attente de signature`,
    corps: [
      `Bonjour ${c.signataireNom},`,
      '',
      `Le CRA ${objet(c)} attend toujours votre validation.`,
      '',
      `  ${c.lien}`,
    ].join('\n'),
  }
}
```

- [ ] **Step 11: Catalogue d'événements**

Dans `src/core/audit/events.ts`, compléter le bloc signature :

```ts
  // Signature — émis par le lot 3
  'signature.envoyee',
  'signature.recue',
  'signature.refusee',
  // Signature — émis par le lot 3b. Le parcours du client dans l'outil, et
  // les courriels qui le portent. Aucun ne contient le nom, l'adresse ni le
  // motif du signataire : le journal est poussé vers des URL tierces.
  'signature.lien.ouvert',
  'signature.code.envoye',
  'signature.code.valide',
  'signature.code.echoue',
  'signature.annulee',
  'signature.renvoyee',
  'signature.courriel.envoye',
  'signature.courriel.echoue',
```

Dans `src/core/audit/events.test.ts`, ajouter ces huit noms à la liste exacte attendue (juste après `'signature.refusee'`) et passer `toHaveLength(30)` à `toHaveLength(38)`.

> `src/services/audit-emetteurs.test.ts` échouera tant que chaque nom n'a pas d'émetteur ; c'est voulu. Il redeviendra vert à la fin de la tâche 10. **Ne pas le désactiver.** Pour cette tâche, lancer seulement les fichiers listés au step 12.

- [ ] **Step 12: Vérifier**

Run: `npx vitest run src/core/signature src/core/notify src/core/audit/events.test.ts`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/core
git commit -m "feat(signature): contenu fige, code client, gabarits et evenements du lot 3b

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Connecteur — nouvelle interface, Documenso v2, double, secret du webhook

**Files:**
- Modify: `src/core/signature/connector.ts`, `src/core/signature/connector.test.ts`
- Modify: `src/core/signature/documenso-champs.ts`, `src/core/signature/documenso-champs.test.ts`
- Modify: `src/core/signature/webhook.ts`, `src/core/signature/webhook.test.ts`
- Rewrite: `src/services/signature/documenso.ts`, `src/services/signature/documenso.test.ts`
- Modify: `src/services/signature/fake-connector.ts`, `src/services/signature/fake-connector.test.ts`

**Interfaces:**
- Consumes: `SignatureChamp`, `SignatureContact` (existants).
- Produces: interface `SignatureConnector` des Contrats ; `verifierSecretDocumenso(header, secret): boolean` ; `parseDocumensoWebhook(raw): { candidats: string[]; eventId: string } | null` ; double `createFakeSignatureConnector()` avec `envois`, `annulations`, `renouvellements`, `regler(externalId, statut, motif?)`, `poserPdfSigne`, `faireEchouerEnvoi`, `faireEchouerTelechargement`, `faireEchouerAnnulation`, `faireEchouerStatut`.

> Cette tâche casse temporairement la compilation de `send.ts`, `refresh.ts`, `reminders.ts`, `apply.ts`, `webhook.ts` (services). Les tâches 6 à 8 les remettent d'aplomb. Ne lancer ici que les fichiers de test listés ; `npx tsc --noEmit` redevient propre à la fin de la tâche 8.

- [ ] **Step 1: Réécrire l'interface**

Dans `src/core/signature/connector.ts`, remplacer `SignatureEnvoi`, `SignatureConnector` et `SignatureFetchLike` par :

```ts
export interface SignatureEnvoi {
  titre: string
  fileName: string
  pdf: Uint8Array
  destinataire: SignatureContact
  champs: ReadonlyArray<SignatureChamp>
  /**
   * Notre identifiant — celui du CRA. Le prestataire le rend dans ses
   * webhooks : la correspondance ne repose plus seulement sur l'identifiant
   * qu'il a choisi.
   */
  reference: string
}

/** Ce que le prestataire rend à l'envoi. */
export interface SignatureDepot {
  externalId: string
  /**
   * Le jeton de signature du destinataire. C'est lui que le cadre embarqué
   * charge ; il ne voyage jamais dans un courriel.
   */
  jetonSignataire: string
}

/** L'état rapporté par le prestataire, motif de refus compris. */
export interface SignatureEtat {
  statut: SignatureStatus
  motifRefus: string | null
}

export interface SignatureConnector {
  /** identifiant du prestataire, tel qu'il sera écrit dans `ExternalLink.provider` */
  readonly provider: string
  /** confie le document **sans que le prestataire n'écrive à personne** */
  send(envoi: SignatureEnvoi): Promise<SignatureDepot>
  /** l'état courant — c'est aussi ce que relit un webhook, qui n'est qu'un signal */
  status(externalId: string): Promise<SignatureEtat>
  /** le document signé, avec sa piste d'audit, à archiver tel quel */
  download(externalId: string): Promise<Uint8Array>
  /**
   * Renouvelle le lien de signature et rend le jeton à jour. Pour un envoi
   * antérieur au lot 3b, distribué par courriel du prestataire, c'est aussi
   * ce qui le fait relancer : le prestataire réécrit lui-même au client.
   */
  renouveler(externalId: string): Promise<string>
  /** retire l'enveloppe : plus personne ne peut la signer */
  annuler(externalId: string): Promise<void>
  /** l'adresse que le cadre embarqué charge pour ce jeton, nom et adresse verrouillés */
  urlEmbarquee(jetonSignataire: string, signataire: SignatureContact): string
}

export type SignatureFetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string | Uint8Array | FormData
  },
) => Promise<Response>
```

Garder le commentaire existant au-dessus de `SignatureFetchLike` et ajouter : « Le corps peut être un `FormData` : la création d'une enveloppe v2 est multipart. »

Dans `src/core/signature/connector.test.ts`, supprimer tout test qui référence `remind` (`grep -n remind src/core/signature/connector.test.ts`).

- [ ] **Step 2: Champs au format v2**

Remplacer le contenu de `src/core/signature/documenso-champs.ts` à partir de `export interface DocumensoField` par :

```ts
/** Un champ tel que l'API v2 de Documenso l'attend à la création d'une enveloppe. */
export interface DocumensoField {
  type: 'SIGNATURE' | 'DATE'
  /** l'index du fichier téléversé qui porte le champ — il n'y en a qu'un */
  identifier: 0
  /** à partir de 1 */
  page: number
  /** pourcentages de la page, origine en **haut** à gauche */
  positionX: number
  positionY: number
  width: number
  height: number
}

/** Arrondi au centième de pourcent : au-delà, c'est du bruit. */
function pourcent(part: number, tout: number): number {
  if (tout <= 0) {
    throw new Error('Une page sans dimension ne peut pas porter de champ.')
  }
  return Math.round((part / tout) * 10_000) / 100
}

export function versDocumensoField(champ: SignatureChamp): DocumensoField {
  return {
    type: champ.nature,
    identifier: 0,
    page: champ.page,
    positionX: pourcent(champ.x, champ.pageLargeur),
    // `y` désigne le **bas** du champ ; Documenso attend son **haut**, compté
    // depuis le haut de la page. Les deux inversions se composent.
    positionY: pourcent(champ.pageHauteur - (champ.y + champ.hauteur), champ.pageHauteur),
    width: pourcent(champ.largeur, champ.pageLargeur),
    height: pourcent(champ.hauteur, champ.pageHauteur),
  }
}
```

Mettre à jour `src/core/signature/documenso-champs.test.ts` aux nouveaux noms :

```bash
sed -i '' -e 's/formType:/type:/g' -e 's/pageNumber:/page:/g' -e 's/pageX:/positionX:/g' -e 's/pageY:/positionY:/g' -e 's/pageWidth:/width:/g' -e 's/pageHeight:/height:/g' -e 's/\.formType/.type/g' -e 's/\.pageNumber/.page/g' -e 's/\.pageX/.positionX/g' -e 's/\.pageY/.positionY/g' -e 's/\.pageWidth/.width/g' -e 's/\.pageHeight/.height/g' src/core/signature/documenso-champs.test.ts
```

Puis, dans chaque `toEqual({ ... })` d'un champ complet, ajouter `identifier: 0,`. Ajouter ce test :

```ts
it('désigne le seul fichier téléversé, par son index', () => {
  const champ = versDocumensoField({
    nature: 'SIGNATURE', ancre: '[[cra:signature]]', page: 1,
    x: 0, y: 0, largeur: 10, hauteur: 10, pageLargeur: 842, pageHauteur: 595,
  })
  expect(champ.identifier).toBe(0)
})
```

Run: `npx vitest run src/core/signature/documenso-champs.test.ts` → PASS.

- [ ] **Step 3: Le secret de Documenso — tests**

Ajouter à `src/core/signature/webhook.test.ts` :

```ts
import { verifierSecretDocumenso } from './webhook'

describe('verifierSecretDocumenso — Documenso envoie son secret tel quel', () => {
  it('accepte le secret exact', () => {
    expect(verifierSecretDocumenso('s3cret', 's3cret')).toBe(true)
  })

  it('refuse un autre secret, un préfixe, un suffixe', () => {
    expect(verifierSecretDocumenso('s3cre', 's3cret')).toBe(false)
    expect(verifierSecretDocumenso('s3cret!', 's3cret')).toBe(false)
    expect(verifierSecretDocumenso('autre', 's3cret')).toBe(false)
  })

  it('refuse tout quand aucun secret n est configuré, même un en-tête vide', () => {
    expect(verifierSecretDocumenso('', '')).toBe(false)
    expect(verifierSecretDocumenso('x', '')).toBe(false)
  })

  it('refuse un en-tête absent sans lever', () => {
    expect(verifierSecretDocumenso('', 's3cret')).toBe(false)
  })
})
```

- [ ] **Step 4: Implémenter**

Ajouter à la fin de `src/core/signature/webhook.ts` :

```ts
import { createHash } from 'node:crypto'

/**
 * **Documenso ne signe pas ses webhooks** : il recopie le secret configuré
 * dans l'en-tête `X-Documenso-Secret` (`execute-webhook-call.ts`, et sa
 * documentation « Verification »). Le lot 3 attendait un HMAC ; chaque
 * webhook réel recevait donc 401.
 *
 * Un secret partagé prouve l'**origine**, pas l'**intégrité** : c'est pourquoi
 * le service ne croit plus la charge et relit l'état chez le prestataire
 * (`services/signature/webhook.ts`).
 *
 * Les deux valeurs sont hachées avant comparaison : `timingSafeEqual` exige
 * deux longueurs égales, et comparer les longueurs d'abord révélerait celle du
 * secret.
 */
export function verifierSecretDocumenso(header: string, secret: string): boolean {
  if (secret === '' || header === '') return false
  const a = createHash('sha256').update(header, 'utf8').digest()
  const b = createHash('sha256').update(secret, 'utf8').digest()
  return timingSafeEqual(a, b)
}
```

(`timingSafeEqual` est déjà importé en tête du fichier ; regrouper l'import de `createHash` avec lui.)

Run: `npx vitest run src/core/signature/webhook.test.ts` → PASS.

- [ ] **Step 5: Le connecteur v2 — tests**

Remplacer **entièrement** `src/services/signature/documenso.test.ts` par :

```ts
import { describe, it, expect } from 'vitest'
import { SignatureConnectorError, type SignatureFetchLike } from '@/core/signature/connector'
import { createDocumensoConnector, parseDocumensoWebhook } from './documenso'

const BASE = 'https://documenso.test'
const CLE = 'api_cle_de_test'

interface Appel {
  url: string
  method: string
  headers: Record<string, string>
  body?: string | Uint8Array | FormData
  statut: number
}

interface Enveloppe {
  id: string
  secondaryId: number
  status: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'REJECTED'
  distributionMethod: 'EMAIL' | 'NONE' | ''
  recipients: Array<{ id: number; token: string; signingStatus: string; rejectionReason: string | null }>
  itemId: string
  annulee: boolean
}

/**
 * Le double de l'API v2 de Documenso. **Il refuse ce que Documenso
 * refuserait** — un double complaisant valide un connecteur qui ne marcherait
 * pas :
 *   - la clé d'API sur toute route ;
 *   - création en `multipart/form-data` avec un champ `payload` JSON et un
 *     fichier PDF non vide — un corps JSON y est refusé ;
 *   - `type: DOCUMENT`, un titre, un destinataire `SIGNER` adressé ;
 *   - des champs en pourcentages, dans [0, 100] ;
 *   - distribution d'une enveloppe existante, `distributionMethod` explicite ;
 *   - 404 sur toute route ou enveloppe inconnue.
 */
function faussApi() {
  const appels: Appel[] = []
  const enveloppes = new Map<string, Enveloppe>()
  let compteur = 0

  const refus = (m: string, s: number) => new Response(m, { status: s })
  const json = (v: unknown) =>
    new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })

  const fetchFn: SignatureFetchLike = async (url, init) => {
    const r = await repondre(url, init)
    appels.push({ url, method: init.method, headers: init.headers, body: init.body, statut: r.status })
    return r
  }

  async function lireJson(init: Parameters<SignatureFetchLike>[1]) {
    if (init.headers['Content-Type'] !== 'application/json' || typeof init.body !== 'string') return null
    return JSON.parse(init.body) as Record<string, unknown>
  }

  async function repondre(url: string, init: Parameters<SignatureFetchLike>[1]): Promise<Response> {
    if (!url.startsWith(`${BASE}/api/v2/`)) return refus('Inconnu', 404)
    if (init.headers.Authorization !== CLE) return refus('Clé absente', 401)
    const chemin = url.slice(`${BASE}/api/v2`.length)

    if (chemin === '/envelope/create' && init.method === 'POST') {
      if (!(init.body instanceof FormData)) return refus('multipart attendu', 415)
      const brut = init.body.get('payload')
      const fichier = init.body.get('files')
      if (typeof brut !== 'string') return refus('payload manquant', 400)
      if (!(fichier instanceof Blob) || fichier.size === 0) return refus('fichier manquant', 400)
      const p = JSON.parse(brut) as {
        title?: string; type?: string; externalId?: string
        recipients?: Array<{ email?: string; name?: string; role?: string; fields?: Array<Record<string, number | string>> }>
      }
      if (p.type !== 'DOCUMENT' || !p.title) return refus('type ou titre', 400)
      const r0 = p.recipients?.[0]
      if (!r0?.email || !r0.name || r0.role !== 'SIGNER') return refus('destinataire', 400)
      for (const f of r0.fields ?? []) {
        for (const k of ['positionX', 'positionY', 'width', 'height'] as const) {
          const v = f[k]
          if (typeof v !== 'number' || v < 0 || v > 100) return refus(`champ ${k}`, 400)
        }
      }
      compteur += 1
      const id = `envelope_${compteur}`
      enveloppes.set(id, {
        id, secondaryId: 1000 + compteur, status: 'DRAFT', distributionMethod: '',
        recipients: [{ id: compteur, token: `jeton-${compteur}`, signingStatus: 'NOT_SIGNED', rejectionReason: null }],
        itemId: `item_${compteur}`, annulee: false,
      })
      return json({ id })
    }

    if (chemin === '/envelope/distribute' && init.method === 'POST') {
      const corps = await lireJson(init)
      const e = corps && enveloppes.get(String(corps.envelopeId))
      if (!e) return refus('enveloppe', 404)
      const meta = corps.meta as { distributionMethod?: string } | undefined
      if (meta?.distributionMethod !== 'NONE' && meta?.distributionMethod !== 'EMAIL') return refus('distributionMethod', 400)
      e.status = 'PENDING'
      e.distributionMethod = meta.distributionMethod
      return json({ success: true, id: e.id, recipients: e.recipients.map((r) => ({ ...r, signingUrl: `${BASE}/sign/${r.token}` })) })
    }

    if (chemin === '/envelope/redistribute' && init.method === 'POST') {
      const corps = await lireJson(init)
      const e = corps && enveloppes.get(String(corps.envelopeId))
      if (!e) return refus('enveloppe', 404)
      if (!Array.isArray(corps.recipients) || corps.recipients.length === 0) return refus('recipients', 400)
      e.recipients = e.recipients.map((r) => ({ ...r, token: `${r.token}-r` }))
      return json({ success: true, id: e.id, recipients: e.recipients })
    }

    if (chemin === '/envelope/cancel' && init.method === 'POST') {
      const corps = await lireJson(init)
      const e = corps && enveloppes.get(String(corps.envelopeId))
      if (!e) return refus('enveloppe', 404)
      e.annulee = true
      return json({ success: true })
    }

    const doc = /^\/document\/(\d+)$/.exec(chemin)
    if (doc && init.method === 'GET') {
      const e = [...enveloppes.values()].find((x) => x.secondaryId === Number(doc[1]))
      return e ? json({ id: e.secondaryId, envelopeId: e.id }) : refus('document', 404)
    }

    const tel = /^\/envelope\/item\/([^/]+)\/download\?version=signed$/.exec(chemin)
    if (tel && init.method === 'GET') {
      const e = [...enveloppes.values()].find((x) => x.itemId === tel[1])
      if (!e) return refus('item', 404)
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { 'Content-Type': 'application/pdf' } })
    }

    const get = /^\/envelope\/([^/?]+)$/.exec(chemin)
    if (get && init.method === 'GET') {
      const e = enveloppes.get(get[1]!)
      if (!e) return refus('enveloppe', 404)
      return json({ id: e.id, status: e.status, recipients: e.recipients, envelopeItems: [{ id: e.itemId }] })
    }

    return refus('Route inconnue', 404)
  }

  return { fetchFn, appels, enveloppes }
}

function connecteur(api = faussApi()) {
  return { api, c: createDocumensoConnector({ fetchFn: api.fetchFn, baseUrl: `${BASE}/`, apiKey: CLE }) }
}

const ENVOI = {
  titre: 'CRA Client — ITSM — septembre 2026',
  fileName: 'CRA.pdf',
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  destinataire: { nom: 'Jeanne Martin', email: 'jeanne@client.test' },
  champs: [{
    nature: 'SIGNATURE' as const, ancre: '[[cra:signature]]', page: 1,
    x: 600, y: 60, largeur: 148, hauteur: 34, pageLargeur: 842, pageHauteur: 595,
  }],
  reference: 'cra_123',
}

describe('send — une enveloppe v2, distribuée sans courriel', () => {
  it('crée en multipart, distribue en NONE, et rend le jeton du signataire', async () => {
    const { api, c } = connecteur()
    const depot = await c.send(ENVOI)

    expect(depot).toEqual({ externalId: 'envelope_1', jetonSignataire: 'jeton-1' })
    expect(api.appels.map((a) => `${a.method} ${a.url.replace(BASE, '')}`)).toEqual([
      'POST /api/v2/envelope/create',
      'POST /api/v2/envelope/distribute',
    ])
    expect(api.enveloppes.get('envelope_1')!.distributionMethod).toBe('NONE')
  })

  it('porte notre référence, le destinataire et les champs en pourcentages', async () => {
    const { api, c } = connecteur()
    await c.send(ENVOI)
    const corps = api.appels[0]!.body as FormData
    const payload = JSON.parse(String(corps.get('payload')))
    expect(payload.externalId).toBe('cra_123')
    expect(payload.recipients[0]).toMatchObject({ name: 'Jeanne Martin', email: 'jeanne@client.test', role: 'SIGNER' })
    expect(payload.recipients[0].fields[0]).toMatchObject({ type: 'SIGNATURE', page: 1, identifier: 0 })
  })

  it("ne pose pas de Content-Type sur le multipart — c'est fetch qui fixe la frontière", async () => {
    const { api, c } = connecteur()
    await c.send(ENVOI)
    expect(api.appels[0]!.headers['Content-Type']).toBeUndefined()
  })

  it('lève une erreur typée, sans rien du corps de la réponse', async () => {
    const { c } = connecteur()
    const err = await c.send({ ...ENVOI, destinataire: { nom: '', email: 'x' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SignatureConnectorError)
    expect((err as SignatureConnectorError).statusCode).toBe(400)
    expect((err as Error).message).not.toContain('destinataire')
  })
})

describe('status', () => {
  it('traduit PENDING, COMPLETED, REJECTED avec son motif', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    expect(await c.status(externalId)).toEqual({ statut: 'EN_ATTENTE', motifRefus: null })

    api.enveloppes.get(externalId)!.status = 'COMPLETED'
    expect(await c.status(externalId)).toEqual({ statut: 'SIGNE', motifRefus: null })

    const e = api.enveloppes.get(externalId)!
    e.status = 'REJECTED'
    e.recipients[0]!.signingStatus = 'REJECTED'
    e.recipients[0]!.rejectionReason = 'Il manque le 15.'
    expect(await c.status(externalId)).toEqual({ statut: 'REFUSE', motifRefus: 'Il manque le 15.' })
  })

  it('rend EN_ATTENTE sur un statut inconnu, plutôt que d inventer une issue', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    ;(api.enveloppes.get(externalId)! as { status: string }).status = 'QUELQUE_CHOSE'
    expect((await c.status(externalId)).statut).toBe('EN_ATTENTE')
  })

  it('résout un identifiant numérique hérité de la v1 vers son enveloppe', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    api.enveloppes.get(externalId)!.status = 'COMPLETED'
    const numerique = String(api.enveloppes.get(externalId)!.secondaryId)
    expect((await c.status(numerique)).statut).toBe('SIGNE')
  })
})

describe('download, renouveler, annuler', () => {
  it('télécharge la version signée du seul fichier de l enveloppe', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    const octets = await c.download(externalId)
    expect(Buffer.from(octets).toString('latin1')).toBe('%PDF')
    expect(api.appels.at(-1)!.url).toBe(`${BASE}/api/v2/envelope/item/item_1/download?version=signed`)
  })

  it('renouvelle et rend le jeton à jour', async () => {
    const { c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    expect(await c.renouveler(externalId)).toBe('jeton-1-r')
  })

  it('annule l enveloppe', async () => {
    const { api, c } = connecteur()
    const { externalId } = await c.send(ENVOI)
    await c.annuler(externalId)
    expect(api.enveloppes.get(externalId)!.annulee).toBe(true)
  })
})

describe('urlEmbarquee', () => {
  it('pointe /embed/sign/{jeton} sur l instance, avec nom et adresse verrouillés et refus permis', () => {
    const { c } = connecteur()
    const url = c.urlEmbarquee('jeton-1', { nom: 'Jeanne Martin', email: 'jeanne@client.test' })
    const [adresse, fragment] = url.split('#')
    expect(adresse).toBe(`${BASE}/embed/sign/jeton-1`)
    const options = JSON.parse(decodeURIComponent(Buffer.from(fragment!, 'base64').toString('utf8')))
    expect(options).toMatchObject({
      name: 'Jeanne Martin', lockName: true, email: 'jeanne@client.test', lockEmail: true,
      allowDocumentRejection: true,
    })
  })
})

describe('parseDocumensoWebhook', () => {
  const charge = (event: string, payload: Record<string, unknown>) => JSON.stringify({ event, payload })

  it('propose l enveloppe puis l identifiant numérique, pour les envois hérités', () => {
    expect(parseDocumensoWebhook(charge('DOCUMENT_COMPLETED', { id: 42, envelopeId: 'envelope_9' }))).toEqual({
      candidats: ['envelope_9', '42'],
      eventId: 'DOCUMENT_COMPLETED:envelope_9',
    })
  })

  it('reconnaît refus, annulation et expiration ; ignore le reste', () => {
    for (const ev of ['DOCUMENT_REJECTED', 'DOCUMENT_CANCELLED', 'DOCUMENT_EXPIRED', 'DOCUMENT_SIGNED']) {
      expect(parseDocumensoWebhook(charge(ev, { id: 1, envelopeId: 'e' }))).not.toBeNull()
    }
    expect(parseDocumensoWebhook(charge('DOCUMENT_OPENED', { id: 1, envelopeId: 'e' }))).toBeNull()
  })

  it('rend null sur une charge illisible', () => {
    expect(parseDocumensoWebhook('pas du json')).toBeNull()
    expect(parseDocumensoWebhook('[]')).toBeNull()
    expect(parseDocumensoWebhook(charge('DOCUMENT_COMPLETED', {}))).toBeNull()
  })
})
```

- [ ] **Step 6: Vérifier l'échec**

Run: `npx vitest run src/services/signature/documenso.test.ts`
Expected: FAIL (le connecteur parle encore v1).

- [ ] **Step 7: Réécrire le connecteur**

Remplacer **entièrement** `src/services/signature/documenso.ts` par :

```ts
import {
  SignatureConnectorError,
  type SignatureConnector,
  type SignatureContact,
  type SignatureEnvoi,
  type SignatureEtat,
  type SignatureFetchLike,
  type SignatureStatus,
} from '@/core/signature/connector'
import { versDocumensoField } from '@/core/signature/documenso-champs'
import { PROVIDER_DOCUMENSO } from './constants'

/**
 * Implémentation de `SignatureConnector` sur l'**API v2** de Documenso
 * (« enveloppes », Documenso ≥ 2.0.0).
 *
 * Tout ce qui est propre à Documenso — URLs, en-têtes, vocabulaire de statuts,
 * forme des webhooks — est enfermé dans ce fichier.
 *
 * **Le prestataire n'écrit plus au client** (`distributionMethod: NONE`) :
 * c'est l'outil qui envoie le lien, et le client signe dans un cadre embarqué.
 *
 * Les envois antérieurs portent un identifiant **numérique** (API v1). Ils
 * sont résolus vers leur enveloppe par la route `document/{id}` — dépréciée
 * mais présente — puis servis comme les autres.
 */
export function createDocumensoConnector(args: {
  fetchFn: SignatureFetchLike
  baseUrl: string
  apiKey: string
}): SignatureConnector {
  const racine = args.baseUrl.replace(/\/+$/, '')
  const api = `${racine}/api/v2`

  async function appeler(
    url: string,
    init: { method: string; body?: string | FormData },
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: args.apiKey }
    // Pas de `Content-Type` sur un multipart : `fetch` le pose lui-même, avec
    // la frontière. L'imposer ici produirait un corps illisible.
    if (typeof init.body === 'string') headers['Content-Type'] = 'application/json'

    const reponse = await args.fetchFn(url, { method: init.method, headers, body: init.body })
    if (!reponse.ok) {
      // Le message ne reprend **rien** du corps de la réponse : un prestataire
      // qui renvoie la requête refusée y ferait remonter la clé d'API, et ce
      // message finit dans un journal.
      throw new SignatureConnectorError(
        `Le prestataire de signature a refusé la requête (${reponse.status}).`,
        reponse.status,
      )
    }
    return reponse
  }

  const poster = (chemin: string, corps: unknown) =>
    appeler(`${api}${chemin}`, { method: 'POST', body: JSON.stringify(corps) })

  /** Un identifiant v1 (numérique) devient l'identifiant de son enveloppe. */
  async function enveloppe(externalId: string): Promise<string> {
    if (!/^\d+$/.test(externalId)) return externalId
    const r = await appeler(`${api}/document/${externalId}`, { method: 'GET' })
    const { envelopeId } = (await r.json()) as { envelopeId?: string }
    if (typeof envelopeId !== 'string' || envelopeId === '') {
      throw new SignatureConnectorError('Document hérité sans enveloppe.', 0)
    }
    return envelopeId
  }

  interface EnveloppeLue {
    status: string
    recipients: Array<{ id: number; token: string; signingStatus: string; rejectionReason: string | null }>
    envelopeItems: Array<{ id: string }>
  }

  async function lire(externalId: string): Promise<EnveloppeLue> {
    const id = await enveloppe(externalId)
    const r = await appeler(`${api}/envelope/${encodeURIComponent(id)}`, { method: 'GET' })
    const e = (await r.json()) as Partial<EnveloppeLue>
    return { status: e.status ?? '', recipients: e.recipients ?? [], envelopeItems: e.envelopeItems ?? [] }
  }

  return {
    provider: PROVIDER_DOCUMENSO,

    async send(envoi: SignatureEnvoi) {
      const formulaire = new FormData()
      formulaire.append(
        'payload',
        JSON.stringify({
          title: envoi.titre,
          type: 'DOCUMENT',
          externalId: envoi.reference,
          recipients: [
            {
              name: envoi.destinataire.nom,
              email: envoi.destinataire.email,
              role: 'SIGNER',
              signingOrder: 1,
              // Sans champs, Documenso reçoit un PDF muet. La conversion
              // points → pourcentages vit dans `core/signature`, où elle est prouvée.
              fields: envoi.champs.map(versDocumensoField),
            },
          ],
          meta: { language: 'fr' },
        }),
      )
      formulaire.append(
        'files',
        new Blob([envoi.pdf], { type: 'application/pdf' }),
        envoi.fileName,
      )

      const creation = await appeler(`${api}/envelope/create`, { method: 'POST', body: formulaire })
      const { id } = (await creation.json()) as { id: string }

      const distribution = await poster('/envelope/distribute', {
        envelopeId: id,
        meta: { distributionMethod: 'NONE' },
      })
      const { recipients } = (await distribution.json()) as { recipients?: Array<{ token: string }> }
      const jeton = recipients?.[0]?.token ?? ''
      if (jeton === '') throw new SignatureConnectorError('Aucun jeton de signature rendu.', 0)

      return { externalId: id, jetonSignataire: jeton }
    },

    async status(externalId: string): Promise<SignatureEtat> {
      const e = await lire(externalId)
      const refus = e.recipients.find((r) => r.signingStatus === 'REJECTED')
      return {
        statut: traduireStatut(e.status, e.recipients.map((r) => r.signingStatus)),
        motifRefus: refus?.rejectionReason ?? null,
      }
    },

    async download(externalId: string): Promise<Uint8Array> {
      const e = await lire(externalId)
      const item = e.envelopeItems[0]
      if (item === undefined) throw new SignatureConnectorError('Enveloppe sans document.', 0)
      const r = await appeler(
        `${api}/envelope/item/${encodeURIComponent(item.id)}/download?version=signed`,
        { method: 'GET' },
      )
      return new Uint8Array(await r.arrayBuffer())
    },

    async renouveler(externalId: string): Promise<string> {
      const id = await enveloppe(externalId)
      const e = await lire(id)
      const r = await poster('/envelope/redistribute', {
        envelopeId: id,
        recipients: e.recipients.map((x) => x.id),
      })
      const { recipients } = (await r.json()) as { recipients?: Array<{ token: string }> }
      return recipients?.[0]?.token ?? ''
    },

    async annuler(externalId: string): Promise<void> {
      await poster('/envelope/cancel', { envelopeId: await enveloppe(externalId) })
    },

    urlEmbarquee(jetonSignataire: string, signataire: SignatureContact): string {
      // Le format du composant officiel `@documenso/embed-react` : options en
      // JSON, encodées URI puis base64, dans le fragment — qui ne part jamais
      // au serveur.
      const options = Buffer.from(
        encodeURIComponent(
          JSON.stringify({
            name: signataire.nom,
            lockName: true,
            email: signataire.email,
            lockEmail: true,
            allowDocumentRejection: true,
            language: 'fr',
            darkModeDisabled: true,
          }),
        ),
        'utf8',
      ).toString('base64')
      return `${racine}/embed/sign/${encodeURIComponent(jetonSignataire)}#${options}`
    },
  }
}

/**
 * Un statut inconnu devient `EN_ATTENTE`, jamais une issue inventée : croire
 * qu'un document est signé sur la foi d'un mot qu'on ne comprend pas
 * verrouillerait un mois à tort.
 */
function traduireStatut(statutDocument: string, statutsSignataires: string[]): SignatureStatus {
  if (statutsSignataires.includes('REJECTED')) return 'REFUSE'
  if (statutDocument === 'REJECTED') return 'REFUSE'
  if (statutDocument === 'COMPLETED') return 'SIGNE'
  if (statutDocument === 'EXPIRED' || statutDocument === 'CANCELLED') return 'EXPIRE'
  return 'EN_ATTENTE'
}

const EVENEMENTS = new Set([
  'DOCUMENT_COMPLETED',
  'DOCUMENT_SIGNED',
  'DOCUMENT_REJECTED',
  'DOCUMENT_CANCELLED',
  'DOCUMENT_EXPIRED',
])

/**
 * Lecture d'une charge utile de webhook Documenso.
 *
 * **La charge n'est plus crue** : elle désigne une enveloppe, et le service
 * relit son état chez le prestataire. On n'en tire donc que l'identifiant —
 * l'enveloppe d'abord, l'identifiant numérique ensuite pour un envoi antérieur
 * au lot 3b — et une clé d'idempotence `{événement}:{enveloppe}`.
 */
export function parseDocumensoWebhook(
  rawBody: string,
): { candidats: string[]; eventId: string } | null {
  let charge: unknown
  try {
    charge = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (typeof charge !== 'object' || charge === null || Array.isArray(charge)) return null

  const { event, payload } = charge as {
    event?: unknown
    payload?: { id?: unknown; envelopeId?: unknown }
  }
  if (typeof event !== 'string' || !EVENEMENTS.has(event)) return null

  const candidats: string[] = []
  if (typeof payload?.envelopeId === 'string' && payload.envelopeId !== '') {
    candidats.push(payload.envelopeId)
  }
  if (typeof payload?.id === 'number' || typeof payload?.id === 'string') {
    candidats.push(String(payload.id))
  }
  if (candidats.length === 0) return null

  return { candidats, eventId: `${event}:${candidats[0]}` }
}
```

- [ ] **Step 8: Vérifier**

Run: `npx vitest run src/services/signature/documenso.test.ts`
Expected: PASS.

- [ ] **Step 9: Le double du connecteur**

Remplacer `src/services/signature/fake-connector.ts` par :

```ts
import type {
  SignatureConnector,
  SignatureEnvoi,
  SignatureStatus,
} from '@/core/signature/connector'
import { SignatureConnectorError } from '@/core/signature/connector'

export interface FakeSignatureConnector extends SignatureConnector {
  readonly envois: SignatureEnvoi[]
  readonly annulations: string[]
  readonly renouvellements: string[]
  readonly telechargements: string[]
  /** références dont l'état a été demandé, dans l'ordre */
  readonly interrogations: string[]
  /** force l'état que `status()` rendra pour cette référence */
  regler(externalId: string, statut: SignatureStatus, motifRefus?: string): void
  poserPdfSigne(externalId: string, pdf: Uint8Array): void
  faireEchouerEnvoi(message: string): void
  faireEchouerTelechargement(message: string): void
  faireEchouerAnnulation(message: string): void
  faireEchouerStatut(message: string): void
}

/**
 * Le double du connecteur, partagé par les suites de services.
 *
 * Il double le **connecteur**, pas l'API : la sévérité de la frontière
 * Documenso est exercée par le double d'API de `documenso.test.ts`. Ici, ce
 * qui compte c'est le contrat : un envoi refusé lève, un statut inconnu vaut
 * `EN_ATTENTE`, un téléchargement ou une annulation peuvent échouer.
 */
export function createFakeSignatureConnector(): FakeSignatureConnector {
  const envois: SignatureEnvoi[] = []
  const annulations: string[] = []
  const renouvellements: string[] = []
  const telechargements: string[] = []
  const interrogations: string[] = []
  const etats = new Map<string, { statut: SignatureStatus; motifRefus: string | null }>()
  const signes = new Map<string, Uint8Array>()
  let echecEnvoi: string | null = null
  let echecTelechargement: string | null = null
  let echecAnnulation: string | null = null
  let echecStatut: string | null = null
  let compteur = 0

  return {
    provider: 'double',
    envois,
    annulations,
    renouvellements,
    telechargements,
    interrogations,

    regler(externalId, statut, motifRefus) {
      etats.set(externalId, { statut, motifRefus: motifRefus ?? null })
    },
    poserPdfSigne(externalId, pdf) {
      signes.set(externalId, pdf)
    },
    faireEchouerEnvoi(message) {
      echecEnvoi = message
    },
    faireEchouerTelechargement(message) {
      echecTelechargement = message
    },
    faireEchouerAnnulation(message) {
      echecAnnulation = message
    },
    faireEchouerStatut(message) {
      echecStatut = message
    },

    async send(envoi) {
      if (echecEnvoi !== null) throw new SignatureConnectorError(echecEnvoi, 502)
      if (envoi.titre.trim() === '') throw new SignatureConnectorError('Titre du document manquant.', 400)
      if (!envoi.destinataire.email.includes('@') || envoi.destinataire.nom.trim() === '') {
        throw new SignatureConnectorError('Destinataire invalide.', 400)
      }
      if (envoi.pdf.byteLength === 0) throw new SignatureConnectorError('Document vide.', 400)
      if (envoi.reference === '') throw new SignatureConnectorError('Référence manquante.', 400)

      envois.push(envoi)
      compteur += 1
      const externalId = `ext-${compteur}`
      etats.set(externalId, { statut: 'EN_ATTENTE', motifRefus: null })
      return { externalId, jetonSignataire: `jeton-${compteur}` }
    },

    async status(externalId) {
      if (echecStatut !== null) throw new SignatureConnectorError(echecStatut, 503)
      interrogations.push(externalId)
      return etats.get(externalId) ?? { statut: 'EN_ATTENTE', motifRefus: null }
    },

    async download(externalId) {
      if (echecTelechargement !== null) throw new SignatureConnectorError(echecTelechargement, 503)
      telechargements.push(externalId)
      return signes.get(externalId) ?? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53])
    },

    async renouveler(externalId) {
      renouvellements.push(externalId)
      return `jeton-renouvele-${renouvellements.length}`
    },

    async annuler(externalId) {
      if (echecAnnulation !== null) throw new SignatureConnectorError(echecAnnulation, 503)
      annulations.push(externalId)
    },

    urlEmbarquee(jeton) {
      return `https://signature.double/embed/sign/${jeton}`
    },
  }
}
```

Mettre `src/services/signature/fake-connector.test.ts` en accord : remplacer les attentes `'ext-1'` rendues par `send` par `{ externalId: 'ext-1', jetonSignataire: 'jeton-1' }`, celles de `status` par `{ statut: …, motifRefus: null }`, ajouter `reference: 'cra-x'` aux envois de test, et supprimer les tests de `remind`. Ajouter :

```ts
it('annule, et peut échouer à annuler', async () => {
  const c = createFakeSignatureConnector()
  await c.annuler('ext-1')
  expect(c.annulations).toEqual(['ext-1'])
  c.faireEchouerAnnulation('panne')
  await expect(c.annuler('ext-2')).rejects.toThrow('panne')
})

it('rend le motif de refus réglé', async () => {
  const c = createFakeSignatureConnector()
  c.regler('ext-9', 'REFUSE', 'Il manque le 15.')
  expect(await c.status('ext-9')).toEqual({ statut: 'REFUSE', motifRefus: 'Il manque le 15.' })
})
```

- [ ] **Step 10: Vérifier**

Run: `npx vitest run src/core/signature src/services/signature/documenso.test.ts src/services/signature/fake-connector.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/core/signature src/services/signature/documenso.ts src/services/signature/documenso.test.ts src/services/signature/fake-connector.ts src/services/signature/fake-connector.test.ts
git commit -m "feat(signature): connecteur Documenso en API v2, signature embarquee et secret du webhook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Courriels avec pièces jointes, et l'émetteur des courriels du circuit

**Files:**
- Modify: `src/services/notify.ts`, `src/services/notify.test.ts`
- Modify: `src/integrations/smtp/mailer.ts`
- Create: `src/services/signature/courriels.ts`, `src/services/signature/courriels.test.ts`

**Interfaces:**
- Consumes: `Gabarit`, `appendAudit`, `ACTEUR_SYSTEME`.
- Produces: `PieceJointe`, `Mailer` étendu, `notify(..., { pieces })`, `envoyerCourriel` (voir Contrats).

- [ ] **Step 1: Test de `notify` avec pièce jointe**

Ajouter à `src/services/notify.test.ts` (dans le `describe` principal, en réutilisant ses fixtures de réglages) :

```ts
it('transmet les pièces jointes au transport, telles quelles', async () => {
  const recus: Array<Parameters<Mailer>[0]> = []
  const mailer: Mailer = async (m) => {
    recus.push(m)
  }
  const octets = new Uint8Array([0x25, 0x50, 0x44, 0x46])
  await notify(
    { sujet: 'S', corps: 'C' },
    { mailer, destinataire: 'a@b.test', pieces: [{ nom: 'cra.pdf', type: 'application/pdf', octets }] },
  )
  expect(recus[0]!.pieces).toEqual([{ nom: 'cra.pdf', type: 'application/pdf', octets }])
})
```

(Importer `type Mailer` depuis `./notify` si le fichier ne le fait pas.)

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/services/notify.test.ts`
Expected: FAIL — `pieces` absent.

- [ ] **Step 3: Implémenter**

Dans `src/services/notify.ts` :

```ts
/** Une pièce jointe, en octets — le transport ne relit jamais un fichier du disque. */
export interface PieceJointe {
  nom: string
  type: string
  octets: Uint8Array
}

export type Mailer = (message: {
  to: string
  sujet: string
  corps: string
  pieces?: PieceJointe[]
}) => Promise<void>
```

Signature de `notify` : `deps: { mailer?: Mailer | null; destinataire?: string; pieces?: PieceJointe[] } = {}` et dernière ligne :

```ts
  await mailer({
    to,
    sujet: gabarit.sujet,
    corps: gabarit.corps,
    ...(deps.pieces !== undefined && deps.pieces.length > 0 ? { pieces: deps.pieces } : {}),
  })
```

Dans `src/integrations/smtp/mailer.ts` :

```ts
  return async ({ to, sujet, corps, pieces }) => {
    await transport.sendMail({
      from: config.from,
      to,
      subject: sujet,
      text: corps,
      ...(pieces !== undefined && {
        attachments: pieces.map((p) => ({
          filename: p.nom,
          contentType: p.type,
          content: Buffer.from(p.octets),
        })),
      }),
    })
  }
```

Run: `npx vitest run src/services/notify.test.ts` → PASS.

- [ ] **Step 4: Tests de l'émetteur**

`src/services/signature/courriels.test.ts` :

```ts
import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import type { Mailer } from '@/services/notify'
import { envoyerCourriel } from './courriels'

const CRA = 'cra-courriels-test'

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: CRA } })
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: CRA } })
  await prisma.$disconnect()
})

async function journal() {
  return prisma.auditEvent.findMany({ where: { entityId: CRA }, orderBy: { seq: 'asc' } })
  // `payloadJson` : la charge utile est une chaîne JSON, lue en bloc.
}

describe('envoyerCourriel', () => {
  it('envoie et journalise sans adresse ni contenu', async () => {
    const recus: string[] = []
    const mailer: Mailer = async (m) => {
      recus.push(m.to)
    }
    const r = await envoyerCourriel({
      craId: CRA, raison: 'ENVOI', to: 'jeanne@client.test',
      gabarit: { sujet: 'S', corps: 'C secret' }, mailer,
    })

    expect(r).toEqual({ envoye: true, motif: '' })
    expect(recus).toEqual(['jeanne@client.test'])
    const [e] = await journal()
    expect(e!.action).toBe('signature.courriel.envoye')
    expect(e!.payloadJson).not.toContain('jeanne')
    expect(e!.payloadJson).not.toContain('secret')
    expect(e!.payloadJson).toContain('ENVOI')
  })

  it('ne lève JAMAIS : une panne SMTP devient un échec journalisé', async () => {
    const mailer: Mailer = async () => {
      throw new Error('connexion refusée par smtp.exemple')
    }
    const r = await envoyerCourriel({
      craId: CRA, raison: 'VALIDE_CLIENT', to: 'x@y.test', gabarit: { sujet: 'S', corps: 'C' }, mailer,
    })
    expect(r.envoye).toBe(false)
    expect(r.motif).not.toContain('smtp.exemple')
    expect((await journal())[0]!.action).toBe('signature.courriel.echoue')
  })

  it("sans SMTP configuré, rend l'échec et le journalise", async () => {
    await prisma.settings.deleteMany({})
    const r = await envoyerCourriel({
      craId: CRA, raison: 'CODE', to: 'x@y.test', gabarit: { sujet: 'S', corps: 'C' },
    })
    expect(r.envoye).toBe(false)
    expect((await journal())[0]!.action).toBe('signature.courriel.echoue')
  })

  it('refuse un destinataire vide sans rien tenter', async () => {
    let appels = 0
    const mailer: Mailer = async () => {
      appels += 1
    }
    const r = await envoyerCourriel({ craId: CRA, raison: 'ENVOI', to: '', gabarit: { sujet: 'S', corps: 'C' }, mailer })
    expect(r.envoye).toBe(false)
    expect(appels).toBe(0)
  })
})
```

- [ ] **Step 5: Implémenter**

`src/services/signature/courriels.ts` :

```ts
import type { Gabarit } from '@/core/notify/templates'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { notify, type Mailer, type PieceJointe } from '@/services/notify'

export type CourrielRaison =
  | 'ENVOI'
  | 'CODE'
  | 'VALIDE_CONSULTANT'
  | 'VALIDE_CLIENT'
  | 'REFUSE_CONSULTANT'
  | 'REFUSE_CLIENT'
  | 'ANNULATION'
  | 'RELANCE'

/**
 * Envoie un courriel du circuit de signature, et le dit au journal.
 *
 * **Ne lève jamais.** Le courriel ne commande rien : une transition a déjà eu
 * lieu, ou va avoir lieu, quoi qu'il arrive au SMTP. Laisser remonter une
 * panne d'envoi ferait échouer une validation que le client a pourtant
 * signée.
 *
 * Le journal ne reçoit **ni l'adresse, ni le sujet, ni le corps** — un code à
 * usage unique y passerait sinon en clair, et le journal est poussé vers des
 * URL tierces. Seule la raison est consignée.
 */
export async function envoyerCourriel(args: {
  craId: string
  raison: CourrielRaison
  to: string
  gabarit: Gabarit
  pieces?: PieceJointe[]
  mailer?: Mailer | null
}): Promise<{ envoye: boolean; motif: string }> {
  let resultat: { envoye: boolean; motif: string }

  if (args.to.trim() === '') {
    resultat = { envoye: false, motif: 'Aucune adresse de destination.' }
  } else {
    try {
      resultat = await notify(args.gabarit, {
        mailer: args.mailer ?? null,
        destinataire: args.to,
        pieces: args.pieces,
      })
    } catch {
      // Le message d'erreur du transport n'est pas repris : il nomme le
      // serveur, parfois l'utilisateur SMTP, et finit sous les yeux de
      // quelqu'un.
      resultat = { envoye: false, motif: 'Le serveur de courriel a refusé l’envoi.' }
    }
  }

  await appendAudit({
    ...ACTEUR_SYSTEME,
    action: resultat.envoye ? 'signature.courriel.envoye' : 'signature.courriel.echoue',
    entityType: 'Cra',
    entityId: args.craId,
    payload: { raison: args.raison },
  })

  return resultat
}
```

> `notify` lit `deps.mailer ?? null` puis la configuration SMTP : passer `null` explicitement conserve ce comportement.

- [ ] **Step 6: Vérifier**

Run: `npx vitest run src/services/notify.test.ts src/services/signature/courriels.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/notify.ts src/services/notify.test.ts src/integrations/smtp/mailer.ts src/services/signature/courriels.ts src/services/signature/courriels.test.ts
git commit -m "feat(signature): courriels avec pieces jointes, jamais bloquants, journalises sans contenu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: L'envoi — contenu figé, enveloppe, lien client, courriel ; renvoi après refus

**Files:**
- Create: `src/services/signature/envois.ts`, `src/services/signature/envois.test.ts`
- Create: `src/services/signature/lien-client.ts` (premières fonctions : `creerLienClient`, `revoquerLiensDuCra`, `secretClient`)
- Rewrite: `src/services/signature/send.ts`
- Modify: `src/services/signature/send.test.ts`
- Modify: `src/services/cra-pdf.ts` (rien à changer si `buildCraPdf` rend déjà `document` — le vérifier)

**Interfaces:**
- Consumes: `figerContenu` (tâche 3), `SignatureConnector.send` (tâche 4), `envoyerCourriel` (tâche 5), `gabaritEnvoiClient` (tâche 3), `fabriquerJeton`/`empreinteJeton` (`src/core/auth/reinitialisation.ts`), `transitionCra`, `buildCraPdf` (rend `{ fileName, bytes, document, champs }`).
- Produces: `cloreEnvoiCourant`, `listerEnvois`, `EnvoiVue` (Contrats) ; `creerLienClient`, `revoquerLiensDuCra`, `secretClient(): string` ; `sendCraForSignature(userId, craId, { connector?, origine?, mailer? })` rendant :

```ts
export type SendCraResult =
  | { ok: true; externalId: string; status: CraStatus; numero: number; courrielEnvoye: boolean }
  | { ok: false; raison: SendCraRaison; message: string }
// SendCraRaison gagne 'PAS_D_ORIGINE'
```

- [ ] **Step 1: Tests de l'historique**

`src/services/signature/envois.test.ts` :

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission } from '@/services/missions'
import { getOrCreateCra } from '@/services/cra'
import { cloreEnvoiCourant, listerEnvois } from './envois'

let userId = ''
let autreId = ''
let craId = ''

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: 'envois@test.local', name: 'T', passwordHash: 'x' } })).id
  autreId = (await prisma.user.create({ data: { email: 'envois-autre@test.local', name: 'A', passwordHash: 'x' } })).id
  const c = await createClient('ENVOIS client')
  const m = await createMission({ clientId: c.id, label: 'M', signataireNom: 'J', signataireEmail: 'j@c.test' })
  craId = (await getOrCreateCra(userId, m.id, '2026-09')).id
})

beforeEach(async () => {
  await prisma.signatureEnvoiClos.deleteMany({ where: { craId } })
  await prisma.signatureRequest.deleteMany({ where: { craId } })
})

afterAll(async () => {
  await prisma.signatureEnvoiClos.deleteMany({ where: { craId } })
  await prisma.signatureRequest.deleteMany({ where: { craId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: { in: ['envois@test.local', 'envois-autre@test.local'] } } })
  await prisma.client.deleteMany({ where: { name: 'ENVOIS client' } })
  await prisma.$disconnect()
})

async function demande(numero: number, status: string, motifRefus = '') {
  return prisma.signatureRequest.create({
    data: {
      craId, provider: 'double', status, numero, motifRefus,
      signataireNom: 'Jeanne', signataireEmail: 'j@c.test',
      sentAt: new Date(`2026-10-0${numero}T09:00:00Z`), empreinte: `e${numero}`,
    },
  })
}

describe('cloreEnvoiCourant', () => {
  it("recopie l'envoi en cours tel quel, motif compris", async () => {
    await demande(1, 'REFUSE', 'Il manque le 15.')
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date('2026-10-03T00:00:00Z')))
    const clos = await prisma.signatureEnvoiClos.findMany({ where: { craId } })
    expect(clos).toHaveLength(1)
    expect(clos[0]).toMatchObject({ numero: 1, status: 'REFUSE', motifRefus: 'Il manque le 15.', empreinte: 'e1' })
  })

  it('est idempotent : clore deux fois le même envoi ne le duplique pas', async () => {
    await demande(1, 'REFUSE')
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date()))
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date()))
    expect(await prisma.signatureEnvoiClos.count({ where: { craId } })).toBe(1)
  })

  it("ne fait rien quand aucun envoi n'existe", async () => {
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date()))
    expect(await prisma.signatureEnvoiClos.count({ where: { craId } })).toBe(0)
  })
})

describe('listerEnvois', () => {
  it("rend l'envoi en cours puis les envois clos, du plus récent au plus ancien", async () => {
    await demande(1, 'REFUSE', 'motif 1')
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date()))
    await prisma.signatureRequest.update({
      where: { craId }, data: { numero: 2, status: 'EN_ATTENTE', motifRefus: '', empreinte: 'e2' },
    })
    const envois = await listerEnvois(userId, craId)
    expect(envois.map((e) => [e.numero, e.status, e.enCours])).toEqual([
      [2, 'EN_ATTENTE', true],
      [1, 'REFUSE', false],
    ])
    expect(envois[1]!.motifRefus).toBe('motif 1')
  })

  it("ne rend rien du CRA d'un autre", async () => {
    await demande(1, 'EN_ATTENTE')
    expect(await listerEnvois(autreId, craId)).toEqual([])
  })
})
```

- [ ] **Step 2: Implémenter `envois.ts`**

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'

export type EnvoiStatut = 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE' | 'ANNULE'

export interface EnvoiVue {
  numero: number
  status: EnvoiStatut
  sentAt: Date
  completedAt: Date | null
  motifRefus: string
  signataireNom: string
  empreinte: string
  /** l'envoi en cours, celui que porte `SignatureRequest` */
  enCours: boolean
}

/**
 * Recopie l'envoi en cours dans `SignatureEnvoiClos`, **avant** qu'un renvoi
 * ou une annulation ne le remplace.
 *
 * Idempotent par l'unicité `(craId, numero)` : un double appel — une action
 * rejouée, une transaction reprise — n'empile pas deux fois le même envoi.
 * Une ligne close ne change plus jamais ensuite.
 */
export async function cloreEnvoiCourant(
  tx: Prisma.TransactionClient,
  craId: string,
  maintenant: Date,
): Promise<void> {
  const courant = await tx.signatureRequest.findUnique({ where: { craId } })
  if (courant === null) return

  await tx.signatureEnvoiClos.upsert({
    where: { craId_numero: { craId, numero: courant.numero } },
    create: {
      craId,
      numero: courant.numero,
      status: courant.status,
      motifRefus: courant.motifRefus,
      signataireNom: courant.signataireNom,
      signataireEmail: courant.signataireEmail,
      sentAt: courant.sentAt,
      completedAt: courant.completedAt,
      empreinte: courant.empreinte,
      closAt: maintenant,
    },
    update: {},
  })
}

/**
 * L'historique des envois d'un CRA : l'envoi en cours, puis les envois clos,
 * du plus récent au plus ancien. Scopé par `userId` — l'historique d'un autre
 * ne se lit pas en devinant un identifiant.
 */
export async function listerEnvois(userId: string, craId: string): Promise<EnvoiVue[]> {
  const cra = await prisma.cra.findFirst({ where: { id: craId, userId }, select: { id: true } })
  if (cra === null) return []

  const [courant, clos] = await Promise.all([
    prisma.signatureRequest.findUnique({ where: { craId } }),
    prisma.signatureEnvoiClos.findMany({ where: { craId }, orderBy: { numero: 'desc' } }),
  ])

  const vues: EnvoiVue[] = clos.map((c) => ({
    numero: c.numero,
    status: c.status as EnvoiStatut,
    sentAt: c.sentAt,
    completedAt: c.completedAt,
    motifRefus: c.motifRefus,
    signataireNom: c.signataireNom,
    empreinte: c.empreinte,
    enCours: false,
  }))

  if (courant !== null && !vues.some((v) => v.numero === courant.numero)) {
    vues.unshift({
      numero: courant.numero,
      status: courant.status as EnvoiStatut,
      sentAt: courant.sentAt,
      completedAt: courant.completedAt,
      motifRefus: courant.motifRefus,
      signataireNom: courant.signataireNom,
      empreinte: courant.empreinte,
      enCours: true,
    })
  }

  return vues
}
```

> Si l'envoi en cours a déjà été clos (annulation : la demande reste en place, marquée `ANNULE`, et sa copie existe), il n'est montré qu'une fois — par sa copie.

Run: `npx vitest run src/services/signature/envois.test.ts` → PASS.

- [ ] **Step 3: Création et révocation des liens**

Créer `src/services/signature/lien-client.ts` avec ces premières fonctions (la tâche 9 complète le fichier) :

```ts
import type { Prisma } from '@prisma/client'
import { empreinteJeton, fabriquerJeton } from '@/core/auth/reinitialisation'

/**
 * Le secret qui signe les sessions client et protège les empreintes de code.
 * `AUTH_SECRET` : celui qu'Auth.js exige déjà. Vide en dehors d'une
 * installation configurée — alors aucune session client n'est valide
 * (`lireSessionClient` refuse tout), jamais l'inverse.
 */
export function secretClient(): string {
  return process.env.AUTH_SECRET ?? ''
}

/**
 * Crée un lien pour l'envoi `numero` du CRA et rend **le jeton en clair**.
 *
 * C'est la seule fois qu'il existe en clair : il part dans un courriel, la base
 * n'en garde que l'empreinte — le procédé de la réinitialisation de mot de
 * passe, réutilisé tel quel. Plusieurs liens peuvent servir le même envoi
 * (courriel d'origine, relances, lien copié à la main) : aucun n'invalide les
 * autres ; seul un renvoi ou une annulation les révoque tous.
 */
export async function creerLienClient(
  tx: Prisma.TransactionClient,
  args: { craId: string; numero: number; jetonSignataire: string },
): Promise<string> {
  const jeton = fabriquerJeton()
  await tx.lienClient.create({
    data: {
      craId: args.craId,
      numero: args.numero,
      jetonEmpreinte: empreinteJeton(jeton),
      jetonSignataire: args.jetonSignataire,
    },
  })
  return jeton
}

/** Révoque tous les liens encore ouverts du CRA. */
export async function revoquerLiensDuCra(
  tx: Prisma.TransactionClient,
  craId: string,
  maintenant: Date,
): Promise<void> {
  await tx.lienClient.updateMany({ where: { craId, revokedAt: null }, data: { revokedAt: maintenant } })
}
```

- [ ] **Step 4: Tests de l'envoi**

Dans `src/services/signature/send.test.ts` :

1. Ajouter en tête : `import type { Mailer } from '@/services/notify'` et `import { empreinteJeton } from '@/core/auth/reinitialisation'`.
2. Ajouter au `beforeEach` et à l'`afterAll` le nettoyage : `await prisma.lienClient.deleteMany({}); await prisma.signatureEnvoiClos.deleteMany({})`.
3. Déclarer un facteur commun, et le passer à **tous** les appels existants de `sendCraForSignature(userId, craId, { connector })` → `{ connector, origine: ORIGINE, mailer }` :

```ts
const ORIGINE = 'https://cra.test'
let courriels: Array<{ to: string; sujet: string; corps: string }> = []
const mailer: Mailer = async (m) => {
  courriels.push({ to: m.to, sujet: m.sujet, corps: m.corps })
}
// dans beforeEach :
courriels = []
```

4. Mettre à jour les attentes existantes : `expect(r).toEqual({ ok: true, externalId: 'ext-1', status: 'ENVOYE' })` devient `expect(r).toEqual({ ok: true, externalId: 'ext-1', status: 'ENVOYE', numero: 1, courrielEnvoye: true })`.
5. Le test « remplace la demande précédente après un refus » passait par `ROUVRIR` puis `ENVOYER` : le réécrire pour renvoyer **directement** depuis `REFUSE` (voir ci-dessous) ; le test « efface le PDF archivé quand on renvoie » reste valable tel quel une fois l'appel mis à jour.
6. Ajouter :

```ts
describe('lot 3b — envoi par l outil', () => {
  it('fige le contenu, avec son empreinte, sur l envoi', async () => {
    await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    const d = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    const doc = JSON.parse(d.contenuFige)
    expect(doc.mois).toBe('2026-06')
    expect(doc.totalCentiemes).toBe(100)
    expect(d.empreinte).toMatch(/^[0-9a-f]{64}$/)
    expect(d.externalId).toBe('ext-1')
    expect(d.origine).toBe(ORIGINE)
  })

  it('confie notre référence au prestataire', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect(connector.envois[0]!.reference).toBe(craId)
  })

  it('écrit au signataire, avec un lien dont la base ne garde que l empreinte', async () => {
    await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    expect(courriels).toHaveLength(1)
    expect(courriels[0]!.to).toBe('claire@send.test')
    const lien = /https:\/\/cra\.test\/v\/([0-9a-f]{64})/.exec(courriels[0]!.corps)
    expect(lien).not.toBeNull()
    const enBase = await prisma.lienClient.findFirstOrThrow({ where: { craId } })
    expect(enBase.jetonEmpreinte).toBe(empreinteJeton(lien![1]!))
    expect(enBase.jetonSignataire).toBe('jeton-1')
    expect(JSON.stringify(enBase)).not.toContain(lien![1]!)
  })

  it('SANS SMTP, envoie quand même et le dit', async () => {
    await prisma.settings.deleteMany({})
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE })
    expect(r).toMatchObject({ ok: true, status: 'ENVOYE', courrielEnvoye: false })
    const journal = await prisma.auditEvent.findMany({ where: { entityId: craId }, orderBy: { seq: 'asc' } })
    expect(journal.map((e) => e.action)).toContain('signature.courriel.echoue')
  })

  it('refuse sans origine publique, sans rien toucher', async () => {
    const connector = createFakeSignatureConnector()
    const r = await sendCraForSignature(userId, craId, { connector, origine: '', mailer })
    expect(r).toMatchObject({ ok: false, raison: 'PAS_D_ORIGINE' })
    expect(connector.envois).toHaveLength(0)
  })

  it('RENVOIE DIRECTEMENT DEPUIS REFUSE : clôt le premier envoi, numérote le second, révoque l ancien lien', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    await prisma.signatureRequest.update({ where: { craId }, data: { status: 'REFUSE', motifRefus: 'Il manque le 15.' } })
    await transitionCra(userId, craId, 'REFUSER')

    const r = await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect(r).toMatchObject({ ok: true, status: 'ENVOYE', numero: 2, externalId: 'ext-2' })

    const clos = await prisma.signatureEnvoiClos.findMany({ where: { craId } })
    expect(clos).toMatchObject([{ numero: 1, status: 'REFUSE', motifRefus: 'Il manque le 15.' }])
    const d = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(d).toMatchObject({ numero: 2, status: 'EN_ATTENTE', motifRefus: '', relances: 0 })

    const liens = await prisma.lienClient.findMany({ where: { craId } })
    expect(liens.find((l) => l.numero === 1)!.revokedAt).not.toBeNull()
    expect(liens.find((l) => l.numero === 2)!.revokedAt).toBeNull()
  })

  it('consigne `signature.renvoyee` sur un renvoi, jamais sur un premier envoi', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    let actions = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => e.action)
    expect(actions).not.toContain('signature.renvoyee')

    await transitionCra(userId, craId, 'REFUSER')
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    actions = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => e.action)
    expect(actions).toContain('signature.renvoyee')
  })

  it("le journal ne contient ni le signataire, ni le jeton", async () => {
    await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    const tout = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => e.payloadJson).join('\n')
    expect(tout).not.toContain('claire')
    expect(tout).not.toContain('Claire')
    expect(tout).not.toContain('jeton-1')
  })
})
```

- [ ] **Step 5: Vérifier l'échec**

Run: `npx vitest run src/services/signature/send.test.ts`
Expected: FAIL.

- [ ] **Step 6: Réécrire `send.ts`**

Remplacer la partie du fichier qui suit les imports par ce qui suit (garder les commentaires du lot 3 là où le code est identique) :

```ts
import { prisma } from '@/db/client'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { libelleMois } from '@/core/cra/document'
import { figerContenu } from '@/core/signature/contenu-fige'
import { gabaritEnvoiClient } from '@/core/notify/signature'
import type { SignatureConnector, SignatureDepot } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import { actorOf, appendAudit } from '@/services/audit'
import { transitionCra } from '@/services/cra'
import { buildCraPdf } from '@/services/cra-pdf'
import type { Mailer } from '@/services/notify'
import { ENTITY_CRA } from './constants'
import { envoyerCourriel } from './courriels'
import { cloreEnvoiCourant } from './envois'
import { creerLienClient, revoquerLiensDuCra } from './lien-client'
import { getSignatureConnector } from './registry'

export type SendCraRaison =
  | 'PAS_DE_CONNECTEUR'
  | 'PAS_DE_SIGNATAIRE'
  | 'PAS_D_ORIGINE'
  | 'TRANSITION_IMPOSSIBLE'
  | 'CONNECTEUR_EN_ECHEC'

export type SendCraResult =
  | { ok: true; externalId: string; status: CraStatus; numero: number; courrielEnvoye: boolean }
  | { ok: false; raison: SendCraRaison; message: string }

const MESSAGES: Record<SendCraRaison, string> = {
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Le CRA reste téléchargeable et les transitions manuelles restent disponibles.',
  PAS_DE_SIGNATAIRE:
    'Renseignez le signataire de la mission (nom et adresse électronique) avant d’envoyer le CRA.',
  PAS_D_ORIGINE:
    'L’adresse publique de l’outil est inconnue : le lien envoyé au client serait inutilisable.',
  TRANSITION_IMPOSSIBLE: 'Ce CRA ne peut pas être envoyé dans son état actuel.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas accepté le document. Le CRA n’a pas changé d’état.',
}

function echec(raison: SendCraRaison): SendCraResult {
  return { ok: false, raison, message: MESSAGES[raison] }
}

/**
 * Envoie le CRA au signataire de sa mission — premier envoi depuis
 * `BROUILLON`, ou renvoi depuis `REFUSE`.
 *
 * **L'ordre des opérations est la garantie du circuit** : le document est
 * composé et figé, confié au connecteur, et seulement ensuite l'envoi
 * précédent est clos, le nouvel envoi écrit et le CRA transitionné. Un échec
 * du prestataire ne laisse donc rien derrière lui.
 *
 * Le courriel part **en dernier**, et son échec ne défait rien : le CRA est
 * chez le prestataire, le lien existe, et l'écran du CRA permet d'en copier
 * un à la main.
 */
export async function sendCraForSignature(
  userId: string,
  craId: string,
  options: { connector?: SignatureConnector | null; origine?: string; mailer?: Mailer | null } = {},
): Promise<SendCraResult> {
  const cra = await prisma.cra.findFirst({
    where: { id: craId, userId },
    include: { mission: { include: { client: true } } },
  })
  if (cra === null) return echec('TRANSITION_IMPOSSIBLE')

  const statut = cra.status as CraStatus
  const transition: CraTransition | null = canTransition(statut, 'ENVOYER')
    ? 'ENVOYER'
    : canTransition(statut, 'RENVOYER')
      ? 'RENVOYER'
      : null
  if (transition === null) return echec('TRANSITION_IMPOSSIBLE')

  const destinataire = { nom: cra.mission.signataireNom, email: cra.mission.signataireEmail }
  if (destinataire.email === '' || destinataire.nom === '') return echec('PAS_DE_SIGNATAIRE')

  const origine = (options.origine ?? '').replace(/\/+$/, '')
  if (origine === '') return echec('PAS_D_ORIGINE')

  const connector =
    options.connector !== undefined ? options.connector : await getSignatureConnector()
  if (connector === null) return echec('PAS_DE_CONNECTEUR')

  const { fileName, bytes, champs, document } = await buildCraPdf(userId, craId)
  const { json, empreinte } = figerContenu(document)
  const mois = cra.month.toISOString().slice(0, 7)
  const titre = `CRA ${cra.mission.client.name} — ${cra.mission.label} — ${libelleMois(mois)}`

  let depot: SignatureDepot
  try {
    depot = await connector.send({ titre, fileName, pdf: bytes, destinataire, champs, reference: craId })
  } catch {
    // Le message du prestataire n'est pas propagé : il finit sous les yeux de
    // l'utilisateur et peut porter ce que la requête contenait.
    return echec('CONNECTEUR_EN_ECHEC')
  }

  const maintenant = new Date()
  const precedent = await prisma.signatureRequest.findUnique({ where: { craId }, select: { numero: true } })
  const numero = (precedent?.numero ?? 0) + 1

  const jeton = await prisma.$transaction(async (tx) => {
    await cloreEnvoiCourant(tx, craId, maintenant)
    await revoquerLiensDuCra(tx, craId, maintenant)

    // Une seule demande par CRA : l'envoi précédent vient d'être recopié dans
    // `SignatureEnvoiClos`, on le remplace — relances, abandon, archive et
    // motif repartent de zéro.
    const champsEnvoi = {
      provider: connector.provider,
      status: 'EN_ATTENTE',
      numero,
      externalId: depot.externalId,
      motifRefus: '',
      contenuFige: json,
      empreinte,
      origine,
      signataireNom: destinataire.nom,
      signataireEmail: destinataire.email,
      sentAt: maintenant,
      relances: 0,
      lastRelanceAt: null,
      completedAt: null,
      abandoned: false,
      signedPdf: null,
    }
    await tx.signatureRequest.upsert({
      where: { craId },
      create: { craId, ...champsEnvoi },
      update: champsEnvoi,
    })

    await tx.externalLink.upsert({
      where: {
        entityType_entityId_provider: { entityType: ENTITY_CRA, entityId: craId, provider: connector.provider },
      },
      create: {
        userId,
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: connector.provider,
        externalId: depot.externalId,
        syncState: 'EN_ATTENTE',
        syncedAt: maintenant,
      },
      update: { externalId: depot.externalId, syncState: 'EN_ATTENTE', syncedAt: maintenant },
    })

    return creerLienClient(tx, { craId, numero, jetonSignataire: depot.jetonSignataire })
  })

  // `transitionCra`, jamais un `cra.update` direct : c'est lui qui consigne
  // `cra.envoye` au journal.
  const vue = await transitionCra(userId, craId, transition)

  const acteur = await actorOf(userId)
  const charge = { missionId: cra.missionId, month: mois, provider: connector.provider, externalId: depot.externalId, numero, empreinte }
  await appendAudit({ ...acteur, action: 'signature.envoyee', entityType: 'Cra', entityId: craId, payload: charge })
  if (transition === 'RENVOYER') {
    await appendAudit({ ...acteur, action: 'signature.renvoyee', entityType: 'Cra', entityId: craId, payload: charge })
  }

  const courriel = await envoyerCourriel({
    craId,
    raison: 'ENVOI',
    to: destinataire.email,
    gabarit: gabaritEnvoiClient({
      clientNom: cra.mission.client.name,
      missionLabel: cra.mission.label,
      moisLibelle: libelleMois(mois),
      signataireNom: destinataire.nom,
      lien: `${origine}/v/${jeton}`,
    }),
    mailer: options.mailer ?? null,
  })

  return { ok: true, externalId: depot.externalId, status: vue.status, numero, courrielEnvoye: courriel.envoye }
}
```

> Vérifier que `buildCraPdf` rend bien `document` (interface `CraPdf`, `src/services/cra-pdf.ts:10`) — c'est le cas au moment de l'écriture du plan.

- [ ] **Step 7: Brancher l'origine dans l'action**

Dans `src/app/(app)/cra/[craId]/actions.ts`, `envoyerPourSignature` :

```ts
import { headers } from 'next/headers'
import { originePublique } from '@/core/http/origine'

async function origineDeLaRequete(): Promise<string> {
  const entetes = await headers()
  return originePublique(process.env.AUTH_URL, (nom) => entetes.get(nom))
}

export async function envoyerPourSignature(formData: FormData): Promise<void> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const r = await sendCraForSignature(user.id, craId, { origine: await origineDeLaRequete() })

  revalidatePath('/cra')
  revalidatePath(`/cra/${craId}`)
  revalidatePath('/saisie')
  retour(craId, r.ok ? (r.courrielEnvoye ? undefined : 'COURRIEL_NON_PARTI') : r.raison)
}
```

Dans `src/app/(app)/cra/[craId]/page.tsx`, ajouter à `ERREURS` :

```ts
  PAS_D_ORIGINE:
    'L’adresse publique de l’outil est inconnue : renseignez AUTH_URL, sinon le lien envoyé au client serait inutilisable.',
  COURRIEL_NON_PARTI:
    'Le CRA est envoyé, mais le courriel au client n’est pas parti. Copiez le lien ci-dessous et transmettez-le vous-même.',
```

et afficher le bouton « Envoyer pour signature » aussi depuis `REFUSE`, libellé « Renvoyer pour signature » :

```tsx
{(canTransition(cra.status, 'ENVOYER') || canTransition(cra.status, 'RENVOYER')) && (
  <form action={envoyerPourSignature}>
    <input type="hidden" name="craId" value={cra.id} />
    <Button variant="primary" disabled={cra.signataireEmail === ''}>
      {cra.status === 'REFUSE' ? 'Renvoyer pour signature' : 'Envoyer pour signature'}
    </Button>
  </form>
)}
```

- [ ] **Step 8: Vérifier**

Run: `npx vitest run src/services/signature/send.test.ts src/services/signature/envois.test.ts "src/app/(app)/cra"`
Expected: PASS. (Les tests de page qui cherchaient le bouton d'envoi par son libellé restent valables : le libellé ne change que sur un CRA `REFUSE`.)

- [ ] **Step 9: Commit**

```bash
git add src/services/signature "src/app/(app)/cra"
git commit -m "feat(signature): envoi fige, enveloppe sans courriel du prestataire, lien client et renvoi apres refus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Le retour du client — application, courriels d'issue, rafraîchissement, webhook-signal

**Files:**
- Modify: `src/services/signature/apply.ts`, `src/services/signature/apply.test.ts`
- Modify: `src/services/signature/refresh.ts`, `src/services/signature/refresh.test.ts`
- Modify: `src/services/signature/webhook.ts`, `src/services/signature/webhook.test.ts`
- Modify: `src/app/api/webhooks/signature/route.ts`, `src/app/api/webhooks/signature/route.test.ts`

**Interfaces:**
- Consumes: `SignatureEtat`, `verifierSecretDocumenso`, `parseDocumensoWebhook` (tâche 4), `envoyerCourriel` (tâche 5), gabarits (tâche 3).
- Produces: `applySignatureStatus({ craId, externalId, statut, motifRefus?, connector?, mailer? })` ; `handleSignatureWebhook({ rawBody, secretHeader, signatureHeader, secret?, connector?, mailer? })`.

- [ ] **Step 1: Tests de l'application**

Dans `src/services/signature/apply.test.ts`, ajouter le nettoyage `lienClient`/`signatureEnvoiClos` comme à la tâche 6, puis :

```ts
import type { Mailer } from '@/services/notify'

describe('lot 3b — issue du circuit', () => {
  let courriels: Array<{ to: string; sujet: string; pieces: number }> = []
  const mailer: Mailer = async (m) => {
    courriels.push({ to: m.to, sujet: m.sujet, pieces: m.pieces?.length ?? 0 })
  }
  beforeEach(() => {
    courriels = []
  })

  it('un refus enregistre le motif et écrit au consultant ET au client, sans pièce jointe', async () => {
    // fixture : CRA ENVOYE, demande EN_ATTENTE externalId 'ext-1' — réutiliser l'aide du fichier
    const effet = await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'REFUSE', motifRefus: 'Il manque le 15.', mailer })
    expect(effet).toBe('REFUSE')
    const d = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(d.motifRefus).toBe('Il manque le 15.')
    expect(courriels.map((c) => c.to).sort()).toEqual([EMAIL_CONSULTANT, EMAIL_SIGNATAIRE].sort())
    expect(courriels.every((c) => c.pieces === 0)).toBe(true)
  })

  it('une signature écrit aux deux, PDF signé joint', async () => {
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector, mailer })
    expect(courriels).toHaveLength(2)
    expect(courriels.every((c) => c.pieces === 1)).toBe(true)
  })

  it("sans archive (téléchargement en échec), écrit quand même — sans pièce jointe", async () => {
    const connector = createFakeSignatureConnector()
    connector.faireEchouerTelechargement('panne')
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector, mailer })
    expect(courriels).toHaveLength(2)
    expect(courriels.every((c) => c.pieces === 0)).toBe(true)
  })

  it("UN REJEU N'ÉCRIT PAS DEUX FOIS", async () => {
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer })
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer })
    expect(courriels).toHaveLength(2)
  })

  it("ignore l'état d'une ancienne enveloppe : seul l'envoi en cours fait foi", async () => {
    const effet = await applySignatureStatus({ craId, externalId: 'ext-ancienne', statut: 'SIGNE', mailer })
    expect(effet).toBe('AUCUN')
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
  })

  it('une signature met les temps en file pour Dolibarr, comme une validation manuelle', async () => {
    // Reprendre ici la mise en place du test existant de `cra.test.ts` qui
    // arme le push Dolibarr (`grep -n "isDolibarrPushArmed\|enqueueSync" src/services/cra.test.ts`),
    // puis :
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer })
    expect(await prisma.syncOutbox.count({ where: { entityId: craId, provider: 'dolibarr' } })).toBe(1)
  })
})
```

> Fixtures : le fichier crée déjà un CRA, une mission avec signataire et une demande. Fixer `EMAIL_SIGNATAIRE` à l'adresse du signataire de sa mission, `EMAIL_CONSULTANT` à l'adresse de l'utilisateur créé, et poser `externalId: 'ext-1'` sur la demande créée dans son aide. Pour le dernier test, la valeur du `provider` de file est la constante `DOLIBARR` de `src/services/dolibarr/api.ts` — l'importer plutôt que l'écrire.

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/services/signature/apply.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `src/services/signature/apply.ts` :

1. Signature :

```ts
export async function applySignatureStatus(args: {
  craId: string
  externalId: string
  statut: SignatureStatus
  motifRefus?: string | null
  connector?: SignatureConnector | null
  mailer?: Mailer | null
}): Promise<SignatureEffet> {
```

2. Juste après la lecture du CRA, la garde de l'envoi en cours :

```ts
  // **Seul l'envoi en cours fait foi.** Un webhook tardif d'une enveloppe
  // remplacée — refusée puis renvoyée, ou annulée — ne doit ni valider ni
  // refuser le nouvel envoi. Un envoi antérieur au lot 3b n'a pas
  // d'`externalId` sur sa demande : `ExternalLink` a déjà fait la
  // correspondance en amont.
  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: args.craId },
    select: { externalId: true, status: true },
  })
  if (demande !== null && demande.externalId !== '' && demande.externalId !== args.externalId) {
    return 'AUCUN'
  }
  if (demande?.status === 'ANNULE') return 'AUCUN'
```

3. `marquerDemande` reçoit le motif :

```ts
  await marquerDemande(args.craId, {
    status: args.statut,
    completedAt: maintenant,
    ...(args.statut === 'REFUSE' ? { motifRefus: (args.motifRefus ?? '').trim() } : {}),
  })
```

(et le type de `data` de `marquerDemande` devient `{ status: string; completedAt?: Date; motifRefus?: string }`).

4. Après l'`appendAudit` final, avant le `return` :

```ts
  // Après tout le reste, et sous la garde d'idempotence : un rejeu rend
  // `AUCUN` bien avant d'arriver ici, donc pas de second courriel.
  await notifierIssue(args.craId, args.statut === 'SIGNE' ? 'VALIDE' : 'REFUSE', args.mailer ?? null)
```

5. Ajouter en bas du fichier :

```ts
/**
 * Écrit au consultant et au client que le CRA est validé ou refusé.
 *
 * Le PDF signé est joint s'il est archivé ; sinon le courriel le dit, et le
 * document reste disponible dans l'outil dès son archivage. Rien ici ne lève :
 * `envoyerCourriel` absorbe et journalise toute panne.
 */
async function notifierIssue(craId: string, issue: 'VALIDE' | 'REFUSE', mailer: Mailer | null): Promise<void> {
  const cra = await prisma.cra.findUnique({
    where: { id: craId },
    select: {
      id: true,
      month: true,
      user: { select: { email: true } },
      mission: { select: { label: true, client: { select: { name: true } } } },
      signatureRequest: {
        select: { signataireNom: true, signataireEmail: true, motifRefus: true, signedPdf: true, origine: true },
      },
    },
  })
  if (cra === null || cra.signatureRequest === null) return

  const d = cra.signatureRequest
  const mois = cra.month.toISOString().slice(0, 7)
  const contexte = {
    clientNom: cra.mission.client.name,
    missionLabel: cra.mission.label,
    moisLibelle: libelleMois(mois),
    signataireNom: d.signataireNom,
  }

  if (issue === 'VALIDE') {
    const pieces: PieceJointe[] =
      d.signedPdf == null
        ? []
        : [{
            nom: `${nomFichierCra(cra.mission.client.name, cra.mission.label, mois).replace(/\.pdf$/, '')}-signe.pdf`,
            type: 'application/pdf',
            octets: new Uint8Array(d.signedPdf),
          }]
    const pdfJoint = pieces.length > 0
    await envoyerCourriel({ craId, raison: 'VALIDE_CONSULTANT', to: cra.user.email, gabarit: gabaritValideConsultant({ ...contexte, pdfJoint }), pieces, mailer })
    await envoyerCourriel({ craId, raison: 'VALIDE_CLIENT', to: d.signataireEmail, gabarit: gabaritValideClient({ ...contexte, pdfJoint }), pieces, mailer })
    return
  }

  const motif = d.motifRefus !== '' ? d.motifRefus : '(aucun motif indiqué)'
  const lienCra = d.origine !== '' ? `${d.origine}/cra/${craId}` : `/cra/${craId}`
  await envoyerCourriel({ craId, raison: 'REFUSE_CONSULTANT', to: cra.user.email, gabarit: gabaritRefusConsultant({ ...contexte, motif, lienCra }), mailer })
  await envoyerCourriel({ craId, raison: 'REFUSE_CLIENT', to: d.signataireEmail, gabarit: gabaritRefusClient({ ...contexte, motif }), mailer })
}
```

Imports à ajouter : `libelleMois` (`@/core/cra/document`), les quatre gabarits (`@/core/notify/signature`), `type Mailer, type PieceJointe` (`@/services/notify`), `nomFichierCra` (`@/services/cra-pdf`), `envoyerCourriel` (`./courriels`).

> `nomFichierCra` vit dans `services/cra-pdf.ts`, qui n'importe pas `apply.ts` : pas de cycle. Le vérifier avec `grep -n "signature/apply" src/services/cra-pdf.ts` (aucun résultat attendu).

Run: `npx vitest run src/services/signature/apply.test.ts` → PASS.

- [ ] **Step 4: Rafraîchissement**

Dans `src/services/signature/refresh.ts`, remplacer :

```ts
  let statut: SignatureStatus
  try {
    statut = await connector.status(lien.externalId)
  } catch {
```

par :

```ts
  let etat: SignatureEtat
  try {
    etat = await connector.status(lien.externalId)
  } catch {
```

puis utiliser `etat.statut` partout où `statut` était lu, et passer `motifRefus: etat.motifRefus` et `mailer: options.mailer ?? null` à `applySignatureStatus`. Ajouter `mailer?: Mailer | null` aux options de `refreshSignatureStatus` et de `refreshPendingSignatures` (transmis à chaque appel). Le résultat `{ ok: true, statut, effet }` garde sa forme : `statut: etat.statut`. Importer `type SignatureEtat` et `type Mailer`.

Dans `src/services/signature/refresh.test.ts` : partout où le double est réglé par `connector.regler(id, 'REFUSE')`, rien ne change ; ajouter :

```ts
it('transmet le motif de refus rapporté par le prestataire', async () => {
  // fixture existante : CRA ENVOYE, demande 'ext-1'
  connector.regler('ext-1', 'REFUSE', 'Il manque le 15.')
  await refreshSignatureStatus(userId, craId, { connector, mailer: async () => {} })
  expect((await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })).motifRefus).toBe('Il manque le 15.')
})
```

- [ ] **Step 5: Le webhook devient un signal — tests**

Remplacer dans `src/services/signature/webhook.test.ts` la fabrication des appels : les tests qui signaient la charge par `signWebhookPayload(raw, SECRET)` passent désormais `secretHeader: SECRET` (en-tête `X-Documenso-Secret`) **ou** gardent `signatureHeader` (HMAC, toujours accepté). Les charges utiles passent au format v2 : `{ event: 'DOCUMENT_COMPLETED', payload: { id: 42, envelopeId: 'ext-1' } }`. Et, le webhook relisant l'état, chaque test qui attendait un effet règle d'abord le double : `connector.regler('ext-1', 'SIGNE')`.

Ajouter :

```ts
describe('lot 3b — le webhook est un signal, pas une source de vérité', () => {
  it('accepte X-Documenso-Secret, tel que Documenso l envoie', async () => {
    connector.regler('ext-1', 'SIGNE')
    const r = await handleSignatureWebhook({ rawBody: charge('DOCUMENT_COMPLETED', 'ext-1'), secretHeader: SECRET, signatureHeader: '', secret: SECRET, connector })
    expect(r).toMatchObject({ ok: true, effet: 'VALIDE' })
  })

  it('refuse un secret faux ou absent', async () => {
    for (const secretHeader of ['', 'faux']) {
      const r = await handleSignatureWebhook({ rawBody: charge('DOCUMENT_COMPLETED', 'ext-1'), secretHeader, signatureHeader: '', secret: SECRET, connector })
      expect(r).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })
    }
  })

  it('UNE CHARGE QUI DIT « SIGNÉ » NE VALIDE RIEN si le prestataire dit « en attente »', async () => {
    connector.regler('ext-1', 'EN_ATTENTE')
    const r = await handleSignatureWebhook({ rawBody: charge('DOCUMENT_COMPLETED', 'ext-1'), secretHeader: SECRET, signatureHeader: '', secret: SECRET, connector })
    expect(r).toMatchObject({ ok: true, effet: 'AUCUN' })
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
  })

  it("prestataire injoignable : rien n'est consommé, la relivraison pourra agir", async () => {
    connector.faireEchouerStatut('panne')
    const r1 = await handleSignatureWebhook({ rawBody: charge('DOCUMENT_COMPLETED', 'ext-1'), secretHeader: SECRET, signatureHeader: '', secret: SECRET, connector })
    expect(r1).toEqual({ ok: false, raison: 'PRESTATAIRE_INJOIGNABLE' })
    expect(await prisma.signatureWebhookEvent.count()).toBe(0)
  })

  it('reconnaît un envoi hérité par son identifiant numérique', async () => {
    // ExternalLink posé avec externalId '42' (envoi v1), demande sans externalId
    await prisma.externalLink.updateMany({ where: { entityId: craId }, data: { externalId: '42' } })
    await prisma.signatureRequest.update({ where: { craId }, data: { externalId: '' } })
    connector.regler('42', 'SIGNE')
    const r = await handleSignatureWebhook({
      rawBody: JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42, envelopeId: 'envelope_inconnue' } }),
      secretHeader: SECRET, signatureHeader: '', secret: SECRET, connector,
    })
    expect(r).toMatchObject({ ok: true, effet: 'VALIDE' })
  })

  it('webhook puis confirmation de page : un seul effet, un seul couple de courriels', async () => {
    connector.regler('ext-1', 'SIGNE')
    const envoyes: string[] = []
    const mailer: Mailer = async (m) => {
      envoyes.push(m.to)
    }
    await handleSignatureWebhook({ rawBody: charge('DOCUMENT_COMPLETED', 'ext-1'), secretHeader: SECRET, signatureHeader: '', secret: SECRET, connector, mailer })
    await refreshSignatureStatus(userId, craId, { connector, mailer })
    expect(envoyes).toHaveLength(2)
    const recues = await prisma.auditEvent.count({ where: { entityId: craId, action: 'signature.recue' } })
    expect(recues).toBe(1)
  })
})

function charge(event: string, envelopeId: string): string {
  return JSON.stringify({ event, payload: { id: 1, envelopeId } })
}
```

- [ ] **Step 6: Implémenter le webhook**

Remplacer le corps de `handleSignatureWebhook` dans `src/services/signature/webhook.ts` :

```ts
export type WebhookOutcome =
  | { ok: true; effet: SignatureEffet | 'REJOUE'; craId: string | null }
  | { ok: false; raison: 'SIGNATURE_INVALIDE' | 'CHARGE_ILLISIBLE' | 'LIEN_INCONNU' | 'PRESTATAIRE_INJOIGNABLE' }

/**
 * Réception d'un webhook de signature — **un signal, plus une source de
 * vérité**.
 *
 * 1. **L'origine** : `X-Documenso-Secret` (ce que Documenso envoie
 *    réellement), ou un HMAC `x-cra-signature` (intégrations maison, tests).
 * 2. **La lecture** : quelle enveloppe, quel événement.
 * 3. **La résolution** du lien externe, sans effet.
 * 4. **La relecture chez le prestataire.** Un secret prouve l'origine, pas
 *    l'intégrité : c'est l'état que rend `status()` qui s'applique, jamais
 *    celui que la charge raconte. Un prestataire injoignable ne consomme
 *    rien — la relivraison, ou le balayage, agiront.
 * 5. **L'unicité de l'événement**, consignée avant d'agir.
 */
export async function handleSignatureWebhook(args: {
  rawBody: string
  secretHeader: string
  signatureHeader: string
  secret?: string
  connector?: SignatureConnector | null
  mailer?: Mailer | null
}): Promise<WebhookOutcome> {
  const secret = args.secret ?? process.env.SIGNATURE_WEBHOOK_SECRET ?? ''

  const authentique =
    verifierSecretDocumenso(args.secretHeader, secret) ||
    verifyWebhookSignature(args.rawBody, args.signatureHeader, secret)
  if (!authentique) return { ok: false, raison: 'SIGNATURE_INVALIDE' }

  const lu = parseDocumensoWebhook(args.rawBody)
  if (lu === null) return { ok: false, raison: 'CHARGE_ILLISIBLE' }

  const lien = await prisma.externalLink.findFirst({
    where: { entityType: ENTITY_CRA, provider: PROVIDER_DOCUMENSO, externalId: { in: lu.candidats } },
    select: { entityId: true, externalId: true },
  })
  if (lien === null) return { ok: false, raison: 'LIEN_INCONNU' }

  const connector =
    args.connector !== undefined ? args.connector : await getSignatureConnector()
  if (connector === null) return { ok: false, raison: 'PRESTATAIRE_INJOIGNABLE' }

  let etat: SignatureEtat
  try {
    etat = await connector.status(lien.externalId)
  } catch {
    return { ok: false, raison: 'PRESTATAIRE_INJOIGNABLE' }
  }

  try {
    await prisma.signatureWebhookEvent.create({
      data: { provider: PROVIDER_DOCUMENSO, eventId: lu.eventId },
    })
  } catch {
    return { ok: true, effet: 'REJOUE', craId: null }
  }

  const effet = await applySignatureStatus({
    craId: lien.entityId,
    externalId: lien.externalId,
    statut: etat.statut,
    motifRefus: etat.motifRefus,
    connector,
    mailer: args.mailer ?? null,
  })

  await prisma.externalLink.updateMany({
    where: { entityType: ENTITY_CRA, entityId: lien.entityId, provider: PROVIDER_DOCUMENSO },
    data: { syncState: etat.statut, syncedAt: new Date() },
  })

  return { ok: true, effet, craId: lien.entityId }
}
```

Imports : `verifierSecretDocumenso` depuis `@/core/signature/webhook`, `type SignatureEtat`, `type Mailer`.

Dans la route `src/app/api/webhooks/signature/route.ts` :

```ts
const CODES: Record<string, number> = {
  SIGNATURE_INVALIDE: 401,
  CHARGE_ILLISIBLE: 400,
  LIEN_INCONNU: 202,
  // Le prestataire réessaiera : c'est exactement ce qu'on veut, l'état n'a
  // pas pu être relu.
  PRESTATAIRE_INJOIGNABLE: 503,
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()
  const resultat = await handleSignatureWebhook({
    rawBody,
    secretHeader: request.headers.get('x-documenso-secret') ?? '',
    signatureHeader: request.headers.get('x-cra-signature') ?? '',
  })
  // … suite inchangée
}
```

Mettre `src/app/api/webhooks/signature/route.test.ts` en accord : un test qui posait `x-documenso-signature` pose désormais `x-documenso-secret: <secret>` ; ajouter un test « `x-documenso-signature` seul (l'ancien en-tête) est refusé : 401 ».

- [ ] **Step 7: Vérifier**

Run: `npx vitest run src/services/signature src/app/api/webhooks`
Expected: PASS — sauf `reminders.test.ts`, qui attend la tâche 8.

- [ ] **Step 8: Commit**

```bash
git add src/services/signature src/app/api/webhooks
git commit -m "fix(signature): le webhook accepte X-Documenso-Secret et relit l'etat chez le prestataire

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Relances par l'outil, vue du CRA, types propres

**Files:**
- Modify: `src/services/signature/reminders.ts`, `src/services/signature/reminders.test.ts`
- Modify: `src/services/cra.ts` (`CraSignatureView`, `WITH_MISSION`, `Row`, `toView`)
- Modify: `src/components/cra/SignatureCard.tsx`, `src/components/cra/SignatureCard.test.tsx`

**Interfaces:**
- Consumes: `creerLienClient` (tâche 6), `envoyerCourriel`, `gabaritRelanceClient`, `SignatureConnector.renouveler`.
- Produces: `runSignatureReminders({ userId?, now?, connector?, mailer? })` — `ReminderReport` inchangé ; `CraSignatureView` gagne `numero: number`, `motifRefus: string`, et `status: SignatureStatus | 'ANNULE'`.

- [ ] **Step 1: Tests des relances**

Dans `src/services/signature/reminders.test.ts` : remplacer les attentes sur `connector.relances` (supprimé) :
- pour une demande **avec** `origine` (lot 3b) : un courriel `RELANCE` part au signataire avec un **nouveau** lien `…/v/<64 hex>`, un `LienClient` de plus existe pour le même `numero`, et les liens précédents restent ouverts ;
- pour une demande **sans** `origine` (envoi hérité) : `connector.renouvellements` contient son `externalId`, aucun courriel ne part de l'outil.

Ajouter :

```ts
it('relance par l outil : nouveau lien, anciens liens intacts', async () => {
  // fixture : demande échue, origine 'https://cra.test', numero 1, un lien existant
  const envoyes: string[] = []
  const r = await runSignatureReminders({ now: APRES_ECHEANCE, connector, mailer: async (m) => { envoyes.push(m.corps) } })
  expect(r.relancees).toBe(1)
  expect(envoyes[0]).toMatch(/https:\/\/cra\.test\/v\/[0-9a-f]{64}/)
  const liens = await prisma.lienClient.findMany({ where: { craId } })
  expect(liens).toHaveLength(2)
  expect(liens.every((l) => l.revokedAt === null)).toBe(true)
})

it('relance un envoi hérité par le prestataire, qui réécrit lui-même', async () => {
  await prisma.signatureRequest.update({ where: { craId }, data: { origine: '' } })
  const r = await runSignatureReminders({ now: APRES_ECHEANCE, connector, mailer: async () => { throw new Error('ne doit pas écrire') } })
  expect(r.relancees).toBe(1)
  expect(connector.renouvellements).toEqual(['ext-1'])
})

it("un courriel de relance non parti ne consomme pas de relance", async () => {
  const r = await runSignatureReminders({ now: APRES_ECHEANCE, connector, mailer: async () => { throw new Error('smtp') } })
  expect(r.echecs).toBe(1)
  expect((await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })).relances).toBe(0)
})
```

(`APRES_ECHEANCE` : une date postérieure à `sentAt + relanceJours`, sur le modèle des dates déjà utilisées dans le fichier.)

- [ ] **Step 2: Implémenter**

Dans `src/services/signature/reminders.ts` : ajouter `mailer?: Mailer | null` aux arguments ; sélectionner aussi `numero`, `origine`, `externalId`, `signataireNom`, `signataireEmail`, et `cra: { select: { month: true, mission: { select: { label: true, client: { select: { name: true } } } } } }`. Remplacer le bloc « `if (connector === null)` … `connector.remind(...)` » par :

```ts
    let relancee: boolean
    if (demande.origine !== '') {
      // Lot 3b : c'est l'outil qui écrit. Un lien neuf part — le jeton n'est
      // jamais conservé en clair, on ne peut donc pas renvoyer l'ancien — et
      // les liens déjà reçus restent valables.
      const ligne = await prisma.lienClient.findFirst({
        where: { craId: demande.craId, numero: demande.numero, revokedAt: null },
        select: { jetonSignataire: true },
      })
      const jeton = await prisma.$transaction((tx) =>
        creerLienClient(tx, { craId: demande.craId, numero: demande.numero, jetonSignataire: ligne?.jetonSignataire ?? '' }),
      )
      const mois = demande.cra.month.toISOString().slice(0, 7)
      const r = await envoyerCourriel({
        craId: demande.craId,
        raison: 'RELANCE',
        to: demande.signataireEmail,
        gabarit: gabaritRelanceClient({
          clientNom: demande.cra.mission.client.name,
          missionLabel: demande.cra.mission.label,
          moisLibelle: libelleMois(mois),
          signataireNom: demande.signataireNom,
          lien: `${demande.origine}/v/${jeton}`,
        }),
        mailer: args.mailer ?? null,
      })
      relancee = r.envoye
    } else {
      // Envoi hérité : distribué par courriel du prestataire, c'est lui qui
      // relance quand on renouvelle son lien.
      if (connector === null) {
        rapport.sansConnecteur += 1
        continue
      }
      const externalId = demande.externalId !== '' ? demande.externalId : (await lienExterne(demande.craId, demande.provider))
      if (externalId === null) {
        rapport.echecs += 1
        continue
      }
      try {
        await connector.renouveler(externalId)
        relancee = true
      } catch {
        relancee = false
      }
    }

    if (!relancee) {
      // Un échec ne consomme pas de relance : trois pannes de suite
      // abandonneraient un CRA que personne n'a jamais relancé.
      rapport.echecs += 1
      continue
    }
```

suivi de la mise à jour `relances: { increment: 1 }` existante. Extraire l'ancienne lecture d'`ExternalLink` dans :

```ts
async function lienExterne(craId: string, provider: string): Promise<string | null> {
  const lien = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: { entityType: ENTITY_CRA, entityId: craId, provider } },
    select: { externalId: true },
  })
  return lien?.externalId ?? null
}
```

Le connecteur n'est plus résolu que pour les envois hérités : le résoudre paresseusement (une seule fois, au premier envoi hérité rencontré).

Mettre à jour le commentaire de tête : « Relancer n'est pas un acte humain : rien n'est consigné **au nom du consultant** ; le courriel, lui, est journalisé par `envoyerCourriel` (`signature.courriel.*`), sans contenu. »

- [ ] **Step 3: Vue du CRA**

Dans `src/services/cra.ts` :

```ts
export interface CraSignatureView {
  provider: string
  status: SignatureStatus | 'ANNULE'
  /** 1, 2, 3… — le rang de l'envoi en cours */
  numero: number
  /** le motif du dernier refus, tel que le client l'a écrit ; vide sinon */
  motifRefus: string
  sentAt: Date
  relances: number
  lastRelanceAt: Date | null
  abandoned: boolean
  archive: boolean
}
```

Ajouter `numero: true, motifRefus: true` à la sélection `signatureRequest` de `WITH_MISSION`, au type `Row`, et à `toView` (`numero: row.signatureRequest.numero, motifRefus: row.signatureRequest.motifRefus`, `status: row.signatureRequest.status as CraSignatureView['status']`). **Ne pas** sélectionner `contenuFige` : comme `signedPdf`, il traverserait chaque affichage de liste.

Dans `src/components/cra/SignatureCard.tsx`, ajouter l'état :

```ts
  ANNULE: { tone: 'neutral', icone: IconeAttente, label: 'Envoi annulé' },
```

(`neutral` est un ton de `Badge`), et afficher le numéro et le motif :

```tsx
      <span className="text-muted">Envoi n° {signature.numero} · le {jour(signature.sentAt)}</span>
      {signature.status === 'REFUSE' && signature.motifRefus !== '' && (
        <span className="w-full">Motif du client : « {signature.motifRefus} »</span>
      )}
```

Ajouter à `SignatureCard.test.tsx` un test qui rend `status: 'REFUSE', motifRefus: 'Il manque le 15.'` et vérifie que le texte `« Il manque le 15. »` est affiché, et un test `ANNULE` → « Envoi annulé ». Compléter les objets de test existants avec `numero: 1, motifRefus: ''`.

- [ ] **Step 4: Vérifier — la compilation redevient propre ici**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

Run: `npx vitest run src/services src/components/cra "src/app/(app)/cra" src/app/api`
Expected: PASS, sauf `src/services/audit-emetteurs.test.ts` (attend les tâches 9 et 10).

- [ ] **Step 5: Commit**

```bash
git add src/services src/components/cra
git commit -m "feat(signature): relances ecrites par l'outil, numero et motif sur la vue du CRA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Le lien client — résolution, code à usage unique, vue figée, confirmation

**Files:**
- Modify: `src/services/signature/lien-client.ts` (complète la tâche 6)
- Create: `src/services/signature/lien-client.test.ts`
- Create: `src/services/signature/limiteur.ts`, `src/services/signature/limiteur.test.ts`

**Interfaces:**
- Consumes: `code-client` et `contenu-fige` (tâche 3), `envoyerCourriel`, `gabaritCodeClient`, `applySignatureStatus` (tâche 7), `creerLienClient` (tâche 6), `empreinteJeton` (`core/auth/reinitialisation`).
- Produces: `resoudreLien`, `demanderCode`, `verifierCode`, `lireVueClient`, `confirmerDepuisPage`, `renouvelerDepuisPage(lienId, deps?)`, `pdfSigneDuLien`, `nouveauLienManuel` (Contrats) ; `autoriser(cle: string, maintenant?: number): boolean`, `reinitialiserLimiteur(): void`.

**Aucune de ces fonctions ne prend de `userId`, sauf `nouveauLienManuel`.** Elles servent une page sans session ; leur garde est le jeton, puis la session client. Le dire dans le commentaire de tête du fichier.

- [ ] **Step 1: Tests du limiteur**

`src/services/signature/limiteur.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { autoriser, reinitialiserLimiteur } from './limiteur'

beforeEach(() => reinitialiserLimiteur())

describe('limiteur par IP', () => {
  it('autorise vingt essais par quart d heure, puis refuse', () => {
    const t = 1_000_000
    for (let i = 0; i < 20; i += 1) expect(autoriser('1.2.3.4', t)).toBe(true)
    expect(autoriser('1.2.3.4', t)).toBe(false)
    expect(autoriser('5.6.7.8', t)).toBe(true)
  })

  it('rouvre après la fenêtre', () => {
    const t = 1_000_000
    for (let i = 0; i < 21; i += 1) autoriser('1.2.3.4', t)
    expect(autoriser('1.2.3.4', t + 15 * 60_000)).toBe(true)
  })
})
```

`src/services/signature/limiteur.ts` :

```ts
/**
 * Limitation des essais de code **par adresse IP**, en mémoire.
 *
 * En plus du compteur par lien (5 essais par code) : un attaquant qui
 * détiendrait plusieurs liens ne doit pas multiplier ses essais d'autant.
 *
 * En mémoire, et c'est assumé : l'application est mono-instance (Docker ou
 * archive portable). Un redémarrage remet les compteurs à zéro — le compteur
 * par lien, lui, est en base et survit.
 */
const FENETRE_MS = 15 * 60_000
const MAX = 20

const compteurs = new Map<string, { debut: number; n: number }>()

export function autoriser(cle: string, maintenant: number = Date.now()): boolean {
  const c = compteurs.get(cle)
  if (c === undefined || maintenant - c.debut >= FENETRE_MS) {
    compteurs.set(cle, { debut: maintenant, n: 1 })
    return true
  }
  c.n += 1
  return c.n <= MAX
}

/** Pour les tests. */
export function reinitialiserLimiteur(): void {
  compteurs.clear()
}
```

Run: `npx vitest run src/services/signature/limiteur.test.ts` → PASS.

- [ ] **Step 2: Tests du lien client**

`src/services/signature/lien-client.test.ts` :

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import type { Mailer } from '@/services/notify'
import { createFakeSignatureConnector, type FakeSignatureConnector } from './fake-connector'
import { sendCraForSignature } from './send'
import {
  confirmerDepuisPage,
  demanderCode,
  lireVueClient,
  nouveauLienManuel,
  pdfSigneDuLien,
  resoudreLien,
  verifierCode,
} from './lien-client'

process.env.AUTH_SECRET ??= 'secret-de-test-lien-client'

const ORIGINE = 'https://cra.test'
let userId = ''
let missionId = ''
let lineId = ''
let craId = ''
let connector: FakeSignatureConnector
let corps: string[] = []
const mailer: Mailer = async (m) => {
  corps.push(m.corps)
}

function jetonDuDernierCourriel(): string {
  const m = /\/v\/([0-9a-f]{64})/.exec(corps.filter((c) => c.includes('/v/')).at(-1) ?? '')
  return m![1]!
}
function codeDuDernierCourriel(): string {
  const m = /Votre code : (\d{6})/.exec(corps.filter((c) => c.includes('Votre code')).at(-1) ?? '')
  return m![1]!
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: 'lien@test.local', name: 'T', passwordHash: 'x' } })).id
  const c = await createClient('LIEN client')
  missionId = (await createMission({ clientId: c.id, label: 'ITSM', signataireNom: 'Jeanne Martin', signataireEmail: 'jeanne@client.test' })).id
  lineId = (await createLine({ missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })).id
})

beforeEach(async () => {
  await prisma.lienClient.deleteMany({})
  await prisma.signatureEnvoiClos.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { userId } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  corps = []
  connector = createFakeSignatureConnector()
  craId = (await getOrCreateCra(userId, missionId, '2026-09')).id
  await saveEntry({ userId, lineId, date: '2026-09-01', minutes: 480, kind: 'REALISE' })
  await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
})

afterAll(async () => {
  await prisma.lienClient.deleteMany({})
  await prisma.signatureEnvoiClos.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { userId } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'lien@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'LIEN client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

const T0 = new Date('2026-10-07T10:00:00Z')
const plus = (min: number) => new Date(T0.getTime() + min * 60_000)

async function ouvrir(): Promise<string> {
  const jeton = jetonDuDernierCourriel()
  await demanderCode(jeton, { maintenant: T0, mailer })
  const r = await verifierCode(jeton, codeDuDernierCourriel(), { maintenant: plus(1) })
  if (!r.ok) throw new Error('ouverture impossible')
  return r.lienId
}

describe('resoudreLien', () => {
  it('reconnaît le lien envoyé', async () => {
    expect((await resoudreLien(jetonDuDernierCourriel())).etat).toBe('ACTIF')
  })

  it('INCONNU pour un jeton mal formé ou absent — sans lever', async () => {
    for (const j of ['', 'abc', 'z'.repeat(64), '0'.repeat(64)]) {
      expect(await resoudreLien(j)).toEqual({ etat: 'INCONNU', lienId: null })
    }
  })

  it('REMPLACE après un renvoi', async () => {
    const ancien = jetonDuDernierCourriel()
    await transitionCra(userId, craId, 'REFUSER')
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect((await resoudreLien(ancien)).etat).toBe('REMPLACE')
    expect((await resoudreLien(jetonDuDernierCourriel())).etat).toBe('ACTIF')
  })

  it("lien d'un envoi clos signé puis rouvert et renvoyé : REMPLACE, jamais le PDF de l'ancien envoi", async () => {
    const ancien = jetonDuDernierCourriel()
    connector.regler('ext-1', 'SIGNE')
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    await transitionCra(userId, craId, 'ROUVRIR')
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect((await resoudreLien(ancien)).etat).toBe('REMPLACE')
    expect(await pdfSigneDuLien(lienId)).toBeNull()
  })
})

describe('demanderCode et verifierCode', () => {
  it('envoie un code à six chiffres au signataire figé, et rend son adresse masquée', async () => {
    const r = await demanderCode(jetonDuDernierCourriel(), { maintenant: T0, mailer })
    expect(r).toEqual({ ok: true, adresseMasquee: 'j•••@client.test' })
    expect(codeDuDernierCourriel()).toMatch(/^\d{6}$/)
  })

  it('le code juste ouvre, une seule fois', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    const code = codeDuDernierCourriel()
    expect((await verifierCode(jeton, code, { maintenant: plus(1) })).ok).toBe(true)
    expect(await verifierCode(jeton, code, { maintenant: plus(2) })).toEqual({ ok: false, raison: 'CODE' })
  })

  it('un code expiré à dix minutes', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    expect(await verifierCode(jeton, codeDuDernierCourriel(), { maintenant: plus(10) })).toEqual({ ok: false, raison: 'CODE' })
  })

  it('cinq essais faux épuisent le code — même le bon ne passe plus', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    const bon = codeDuDernierCourriel()
    const faux = bon === '000000' ? '111111' : '000000'
    const resultats = []
    for (let i = 0; i < 5; i += 1) resultats.push((await verifierCode(jeton, faux, { maintenant: plus(1) })) as { raison: string })
    expect(resultats.map((r) => r.raison)).toEqual(['CODE', 'CODE', 'CODE', 'CODE', 'EPUISE'])
    expect(await verifierCode(jeton, bon, { maintenant: plus(1) })).toEqual({ ok: false, raison: 'EPUISE' })
  })

  it('demander deux codes : seul le dernier vaut', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    const premier = codeDuDernierCourriel()
    await demanderCode(jeton, { maintenant: plus(1), mailer })
    const second = codeDuDernierCourriel()
    if (premier !== second) {
      expect(await verifierCode(jeton, premier, { maintenant: plus(2) })).toEqual({ ok: false, raison: 'CODE' })
    }
    expect((await verifierCode(jeton, second, { maintenant: plus(2) })).ok).toBe(true)
  })

  it('cinq codes par heure, pas un de plus ; la fenêtre se rouvre', async () => {
    const jeton = jetonDuDernierCourriel()
    for (let i = 0; i < 5; i += 1) expect((await demanderCode(jeton, { maintenant: plus(i), mailer })).ok).toBe(true)
    expect(await demanderCode(jeton, { maintenant: plus(6), mailer })).toEqual({ ok: false, raison: 'TROP_DE_CODES' })
    expect((await demanderCode(jeton, { maintenant: plus(61), mailer })).ok).toBe(true)
  })

  it('refuse un lien inconnu, révoqué ou remplacé, sans envoyer de courriel', async () => {
    const avant = corps.length
    expect(await demanderCode('0'.repeat(64), { maintenant: T0, mailer })).toEqual({ ok: false, raison: 'LIEN' })
    expect(corps.length).toBe(avant)
  })

  it('le journal ne contient ni le code, ni l adresse', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    const code = codeDuDernierCourriel()
    await verifierCode(jeton, '999999' === code ? '888888' : '999999', { maintenant: plus(1) })
    await verifierCode(jeton, code, { maintenant: plus(1) })
    const tout = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => `${e.action} ${e.payloadJson}`).join('\n')
    expect(tout).toContain('signature.code.envoye')
    expect(tout).toContain('signature.code.echoue')
    expect(tout).toContain('signature.code.valide')
    expect(tout).not.toContain(code)
    expect(tout).not.toContain('jeanne')
  })
})

describe('lireVueClient', () => {
  it('rend le contenu FIGÉ, même après réouverture et modification du CRA', async () => {
    const lienId = await ouvrir()
    // Un changement de réglage de conversion ne doit rien changer à ce que
    // voit le client : la vue ne lit que le contenu figé.
    const avant = await lireVueClient(lienId, { connector, maintenant: plus(2) })
    expect(avant.etat).toBe('ACTIF')
    expect(avant.document!.totalCentiemes).toBe(100)
    expect(avant.statut).toBe('A_SIGNER')
    expect(avant.urlEmbarquee).toBe('https://signature.double/embed/sign/jeton-1')

    await updateSettings({ minutesParJour: 420, capacityMode: 'DESACTIVE' })
    const apres = await lireVueClient(lienId, { connector, maintenant: plus(3) })
    expect(apres.document).toEqual(avant.document)
  })

  it("ne porte aucun montant", async () => {
    const lienId = await ouvrir()
    const vue = await lireVueClient(lienId, { connector, maintenant: plus(2) })
    expect(JSON.stringify(vue)).not.toMatch(/tjm|Cents|80000/i)
  })

  it('après signature : statut SIGNE, date, PDF signé disponible, plus de cadre', async () => {
    connector.regler('ext-1', 'SIGNE')
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    const vue = await lireVueClient(lienId, { connector, maintenant: plus(3) })
    expect(vue.statut).toBe('SIGNE')
    expect(vue.signeLe).not.toBeNull()
    expect(vue.pdfSigneDisponible).toBe(true)
    expect(vue.urlEmbarquee).toBeNull()
    expect((await pdfSigneDuLien(lienId))!.bytes.byteLength).toBeGreaterThan(0)
  })

  it('après refus : statut REFUSE et motif', async () => {
    connector.regler('ext-1', 'REFUSE', 'Il manque le 15.')
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    const vue = await lireVueClient(lienId, { connector, maintenant: plus(3) })
    expect(vue).toMatchObject({ statut: 'REFUSE', motifRefus: 'Il manque le 15.' })
  })

  it('journalise la consultation, au plus une fois par heure', async () => {
    const lienId = await ouvrir()
    await lireVueClient(lienId, { connector, maintenant: plus(2) })
    await lireVueClient(lienId, { connector, maintenant: plus(30) })
    await lireVueClient(lienId, { connector, maintenant: plus(90) })
    expect(await prisma.auditEvent.count({ where: { entityId: craId, action: 'signature.lien.ouvert' } })).toBe(2)
  })
})

describe('confirmerDepuisPage', () => {
  it("n'applique que ce que le prestataire confirme", async () => {
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
    connector.regler('ext-1', 'SIGNE')
    await confirmerDepuisPage(lienId, { connector })
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('VALIDE')
  })
})

describe('nouveauLienManuel', () => {
  it('rend une URL neuve pour l envoi en cours, sans révoquer les autres', async () => {
    const ancien = jetonDuDernierCourriel()
    const r = await nouveauLienManuel(userId, craId, ORIGINE)
    expect(r.ok).toBe(true)
    expect((r as { url: string }).url).toMatch(/^https:\/\/cra\.test\/v\/[0-9a-f]{64}$/)
    expect((await resoudreLien(ancien)).etat).toBe('ACTIF')
  })

  it("refuse le CRA d'un autre, et un CRA qui n'est pas en attente", async () => {
    expect(await nouveauLienManuel('autre', craId, ORIGINE)).toEqual({ ok: false })
    connector.regler('ext-1', 'SIGNE')
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    expect(await nouveauLienManuel(userId, craId, ORIGINE)).toEqual({ ok: false })
  })
})
```

- [ ] **Step 3: Vérifier l'échec**

Run: `npx vitest run src/services/signature/lien-client.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implémenter**

Compléter `src/services/signature/lien-client.ts` (en tête, le commentaire de fichier ; garder `secretClient`, `creerLienClient`, `revoquerLiensDuCra` de la tâche 6) :

```ts
/**
 * Le lien que reçoit le client, et ce qu'il ouvre.
 *
 * **Ces fonctions n'ont pas de `userId`** — sauf `nouveauLienManuel`. Elles
 * servent la seule page de l'outil sans session : leur garde est le jeton
 * (256 bits, empreinte seule en base), puis le code à usage unique, puis la
 * session client signée. Elles ne lisent jamais que le CRA du lien.
 */
import { timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { empreinteJeton, fabriquerJeton } from '@/core/auth/reinitialisation'
import type { CraDocument } from '@/core/cra/document'
import {
  CODE_DUREE_MINUTES,
  CODE_ESSAIS_MAX,
  CODES_PAR_HEURE_MAX,
  empreinteCode,
  fabriquerCode,
  masquerEmail,
} from '@/core/signature/code-client'
import { lireContenu } from '@/core/signature/contenu-fige'
import { gabaritCodeClient } from '@/core/notify/signature'
import type { SignatureConnector } from '@/core/signature/connector'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { nomFichierCra } from '@/services/cra-pdf'
import type { Mailer } from '@/services/notify'
import { applySignatureStatus } from './apply'
import { envoyerCourriel } from './courriels'
import { getSignatureConnector } from './registry'

const HEURE_MS = 60 * 60_000

export type EtatLien = 'INCONNU' | 'ACTIF' | 'REMPLACE' | 'RETIRE'

async function journal(craId: string, action: 'signature.lien.ouvert' | 'signature.code.envoye' | 'signature.code.valide' | 'signature.code.echoue', numero: number) {
  await appendAudit({ ...ACTEUR_SYSTEME, action, entityType: 'Cra', entityId: craId, payload: { numero } })
}

/**
 * L'état d'un lien. **Ne lève jamais** et ne dit rien de plus que nécessaire :
 * un jeton mal formé et un jeton inconnu rendent la même chose.
 */
export async function resoudreLien(jeton: string): Promise<{ etat: EtatLien; lienId: string | null }> {
  const inconnu = { etat: 'INCONNU' as const, lienId: null }
  if (!/^[0-9a-f]{64}$/.test(jeton)) return inconnu

  const lien = await prisma.lienClient.findUnique({
    where: { jetonEmpreinte: empreinteJeton(jeton) },
    select: { id: true, craId: true, numero: true, revokedAt: true },
  })
  if (lien === null) return inconnu

  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: lien.craId },
    select: { numero: true, status: true },
  })
  if (demande === null) return inconnu
  if (lien.numero < demande.numero) return { etat: 'REMPLACE', lienId: lien.id }
  if (lien.revokedAt !== null || demande.status === 'ANNULE') return { etat: 'RETIRE', lienId: lien.id }
  return { etat: 'ACTIF', lienId: lien.id }
}

export async function demanderCode(
  jeton: string,
  deps: { maintenant?: Date; mailer?: Mailer | null } = {},
): Promise<{ ok: true; adresseMasquee: string } | { ok: false; raison: 'LIEN' | 'TROP_DE_CODES' }> {
  const maintenant = deps.maintenant ?? new Date()
  const { etat, lienId } = await resoudreLien(jeton)
  if (etat !== 'ACTIF' || lienId === null) return { ok: false, raison: 'LIEN' }

  const lien = await prisma.lienClient.findUniqueOrThrow({ where: { id: lienId } })
  const demande = await prisma.signatureRequest.findUniqueOrThrow({
    where: { craId: lien.craId },
    select: { signataireEmail: true },
  })

  const fenetreNeuve =
    lien.codesFenetreAt === null || maintenant.getTime() - lien.codesFenetreAt.getTime() >= HEURE_MS
  const envoyes = fenetreNeuve ? 0 : lien.codesEnvoyes
  if (envoyes >= CODES_PAR_HEURE_MAX) return { ok: false, raison: 'TROP_DE_CODES' }

  const code = fabriquerCode()
  // Un nouveau code remplace le précédent et remet les essais à zéro : seul le
  // dernier code reçu vaut.
  await prisma.lienClient.update({
    where: { id: lien.id },
    data: {
      codeEmpreinte: empreinteCode(lien.id, code, secretClient()),
      codeExpireAt: new Date(maintenant.getTime() + CODE_DUREE_MINUTES * 60_000),
      codeEssais: 0,
      codesEnvoyes: envoyes + 1,
      codesFenetreAt: fenetreNeuve ? maintenant : lien.codesFenetreAt,
    },
  })

  // À l'adresse **figée à l'envoi**, jamais à celle de la mission aujourd'hui :
  // un lien transféré ne fait pas changer le destinataire du code.
  await envoyerCourriel({
    craId: lien.craId,
    raison: 'CODE',
    to: demande.signataireEmail,
    gabarit: gabaritCodeClient({ code, minutes: CODE_DUREE_MINUTES }),
    mailer: deps.mailer ?? null,
  })
  await journal(lien.craId, 'signature.code.envoye', lien.numero)

  return { ok: true, adresseMasquee: masquerEmail(demande.signataireEmail) }
}

export async function verifierCode(
  jeton: string,
  code: string,
  deps: { maintenant?: Date } = {},
): Promise<{ ok: true; lienId: string } | { ok: false; raison: 'LIEN' | 'CODE' | 'EPUISE' }> {
  const maintenant = deps.maintenant ?? new Date()
  const { etat, lienId } = await resoudreLien(jeton)
  if (etat !== 'ACTIF' || lienId === null) return { ok: false, raison: 'LIEN' }

  const lien = await prisma.lienClient.findUniqueOrThrow({ where: { id: lienId } })
  if (lien.codeEssais >= CODE_ESSAIS_MAX) return { ok: false, raison: 'EPUISE' }
  if (lien.codeEmpreinte === '' || lien.codeExpireAt === null || maintenant >= lien.codeExpireAt) {
    return { ok: false, raison: 'CODE' }
  }

  const attendu = Buffer.from(lien.codeEmpreinte, 'hex')
  const fourni = Buffer.from(empreinteCode(lien.id, code.trim(), secretClient()), 'hex')
  if (attendu.length !== fourni.length || !timingSafeEqual(attendu, fourni)) {
    const essais = lien.codeEssais + 1
    await prisma.lienClient.update({ where: { id: lien.id }, data: { codeEssais: essais } })
    await journal(lien.craId, 'signature.code.echoue', lien.numero)
    return { ok: false, raison: essais >= CODE_ESSAIS_MAX ? 'EPUISE' : 'CODE' }
  }

  // Usage unique : le code juste est effacé dès qu'il a servi.
  await prisma.lienClient.update({
    where: { id: lien.id },
    data: { codeEmpreinte: '', codeExpireAt: null, codeEssais: 0 },
  })
  await journal(lien.craId, 'signature.code.valide', lien.numero)
  return { ok: true, lienId: lien.id }
}

export interface VueClient {
  etat: EtatLien
  document: CraDocument | null
  statut: 'A_SIGNER' | 'SIGNE' | 'REFUSE' | 'EXPIRE'
  signeLe: Date | null
  refuseLe: Date | null
  motifRefus: string
  empreinte: string
  pdfSigneDisponible: boolean
  urlEmbarquee: string | null
}

const STATUTS: Record<string, VueClient['statut']> = {
  EN_ATTENTE: 'A_SIGNER',
  SIGNE: 'SIGNE',
  REFUSE: 'REFUSE',
  EXPIRE: 'EXPIRE',
}

async function lienEtDemande(lienId: string) {
  const lien = await prisma.lienClient.findUnique({ where: { id: lienId } })
  if (lien === null) return null
  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: lien.craId },
    select: {
      numero: true, status: true, externalId: true, contenuFige: true, empreinte: true,
      motifRefus: true, completedAt: true, signataireNom: true, signataireEmail: true,
    },
  })
  if (demande === null) return null
  return { lien, demande }
}

/**
 * Ce que la page client affiche. **Ne lit que le contenu figé** — jamais une
 * saisie, jamais un réglage.
 */
export async function lireVueClient(
  lienId: string,
  deps: { connector?: SignatureConnector | null; maintenant?: Date } = {},
): Promise<VueClient> {
  const maintenant = deps.maintenant ?? new Date()
  const vide: VueClient = {
    etat: 'INCONNU', document: null, statut: 'A_SIGNER', signeLe: null, refuseLe: null,
    motifRefus: '', empreinte: '', pdfSigneDisponible: false, urlEmbarquee: null,
  }

  const lu = await lienEtDemande(lienId)
  if (lu === null) return vide
  const { lien, demande } = lu
  if (lien.numero < demande.numero) return { ...vide, etat: 'REMPLACE' }
  if (lien.revokedAt !== null || demande.status === 'ANNULE') return { ...vide, etat: 'RETIRE' }

  // Une consultation par heure au journal : assez pour le suivi, pas assez
  // pour qu'un client qui recharge sa page noie l'historique.
  if (lien.derniereConsultationAt === null || maintenant.getTime() - lien.derniereConsultationAt.getTime() >= HEURE_MS) {
    await prisma.lienClient.update({ where: { id: lien.id }, data: { derniereConsultationAt: maintenant } })
    await journal(lien.craId, 'signature.lien.ouvert', lien.numero)
  }

  const statut = STATUTS[demande.status] ?? 'A_SIGNER'
  const archive = await prisma.signatureRequest.count({ where: { craId: lien.craId, NOT: { signedPdf: null } } })

  let urlEmbarquee: string | null = null
  if (statut === 'A_SIGNER' && lien.jetonSignataire !== '') {
    const connector = deps.connector !== undefined ? deps.connector : await getSignatureConnector()
    if (connector !== null) {
      urlEmbarquee = connector.urlEmbarquee(lien.jetonSignataire, {
        nom: demande.signataireNom,
        email: demande.signataireEmail,
      })
    }
  }

  return {
    etat: 'ACTIF',
    document: lireContenu(demande.contenuFige),
    statut,
    signeLe: statut === 'SIGNE' ? demande.completedAt : null,
    refuseLe: statut === 'REFUSE' ? demande.completedAt : null,
    motifRefus: statut === 'REFUSE' ? demande.motifRefus : '',
    empreinte: demande.empreinte,
    pdfSigneDisponible: statut === 'SIGNE' && archive > 0,
    urlEmbarquee,
  }
}

/**
 * Appelée par la page quand le cadre annonce « signé » ou « refusé ».
 *
 * **Le message du navigateur ne décide de rien** : on redemande l'état au
 * prestataire, et seul ce qu'il confirme s'applique, par l'applicateur
 * unique. Un message forgé dans la console ne valide aucun mois.
 */
export async function confirmerDepuisPage(
  lienId: string,
  deps: { connector?: SignatureConnector | null; mailer?: Mailer | null } = {},
): Promise<void> {
  const lu = await lienEtDemande(lienId)
  if (lu === null) return
  const { lien, demande } = lu
  if (lien.numero !== demande.numero || lien.revokedAt !== null) return
  if (demande.status !== 'EN_ATTENTE' || demande.externalId === '') return

  const connector = deps.connector !== undefined ? deps.connector : await getSignatureConnector()
  if (connector === null) return

  let etat
  try {
    etat = await connector.status(demande.externalId)
  } catch {
    return // le webhook ou le balayage prendront le relais
  }

  await applySignatureStatus({
    craId: lien.craId,
    externalId: demande.externalId,
    statut: etat.statut,
    motifRefus: etat.motifRefus,
    connector,
    mailer: deps.mailer ?? null,
  })
}

/**
 * Le jeton Documenso a expiré : on le renouvelle et on le pose sur tous les
 * liens ouverts de l'envoi.
 */
export async function renouvelerDepuisPage(
  lienId: string,
  deps: { connector?: SignatureConnector | null } = {},
): Promise<void> {
  const lu = await lienEtDemande(lienId)
  if (lu === null) return
  const { lien, demande } = lu
  if (lien.numero !== demande.numero || lien.revokedAt !== null) return
  if (demande.status !== 'EN_ATTENTE' || demande.externalId === '') return

  const connector = deps.connector !== undefined ? deps.connector : await getSignatureConnector()
  if (connector === null) return
  try {
    const jeton = await connector.renouveler(demande.externalId)
    if (jeton === '') return
    await prisma.lienClient.updateMany({
      where: { craId: lien.craId, numero: lien.numero, revokedAt: null },
      data: { jetonSignataire: jeton },
    })
  } catch {
    // la page proposera d'ouvrir le document dans un nouvel onglet
  }
}

/** Le PDF signé, pour un lien de l'envoi en cours **et signé** ; sinon `null`. */
export async function pdfSigneDuLien(lienId: string): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const lien = await prisma.lienClient.findUnique({ where: { id: lienId } })
  if (lien === null || lien.revokedAt !== null) return null
  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: lien.craId },
    select: { numero: true, status: true, signedPdf: true, cra: { select: { month: true, mission: { select: { label: true, client: { select: { name: true } } } } } } },
  })
  if (demande === null || demande.numero !== lien.numero || demande.status !== 'SIGNE' || demande.signedPdf == null) return null
  const mois = demande.cra.month.toISOString().slice(0, 7)
  return {
    fileName: nomFichierCra(demande.cra.mission.client.name, demande.cra.mission.label, mois).replace(/\.pdf$/, '-signe.pdf'),
    bytes: new Uint8Array(demande.signedPdf),
  }
}

/**
 * Un lien de plus pour l'envoi en cours, à transmettre à la main quand le
 * courriel n'est pas parti. Scopé : seul le propriétaire du CRA l'obtient.
 */
export async function nouveauLienManuel(
  userId: string,
  craId: string,
  origine: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const cra = await prisma.cra.findFirst({ where: { id: craId, userId }, select: { id: true } })
  if (cra === null) return { ok: false }
  const demande = await prisma.signatureRequest.findUnique({
    where: { craId },
    select: { numero: true, status: true, origine: true },
  })
  if (demande === null || demande.status !== 'EN_ATTENTE' || demande.origine === '') return { ok: false }

  const existant = await prisma.lienClient.findFirst({
    where: { craId, numero: demande.numero, revokedAt: null },
    select: { jetonSignataire: true },
  })
  const jeton = await prisma.$transaction((tx) =>
    creerLienClient(tx, { craId, numero: demande.numero, jetonSignataire: existant?.jetonSignataire ?? '' }),
  )
  const base = (origine !== '' ? origine : demande.origine).replace(/\/+$/, '')
  return { ok: true, url: `${base}/v/${jeton}` }
}
```

> `import type { Prisma }` et `fabriquerJeton` servent à `creerLienClient` (tâche 6) : un seul bloc d'imports pour tout le fichier.
>
> Cycle d'imports à vérifier : `lien-client.ts` → `apply.ts` → (`courriels.ts`, `cra-pdf.ts`). `apply.ts` ne doit **pas** importer `lien-client.ts`. `send.ts` importe `lien-client.ts` : pas de cycle.

- [ ] **Step 5: Vérifier**

Run: `npx vitest run src/services/signature`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/signature
git commit -m "feat(signature): lien client, code a usage unique et vue figee du CRA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: « Annuler l'envoi », historique et lien manuel sur l'écran du CRA

**Files:**
- Create: `src/services/signature/annuler.ts`, `src/services/signature/annuler.test.ts`
- Modify: `src/services/signature/envois.ts` (ajoute `compterCourrielsEchoues`)
- Create: `src/components/cra/HistoriqueEnvois.tsx`, `src/components/cra/HistoriqueEnvois.test.tsx`
- Create: `src/components/cra/LienManuel.tsx`
- Modify: `src/app/(app)/cra/[craId]/actions.ts`, `src/app/(app)/cra/[craId]/page.tsx`, `src/app/(app)/cra/[craId]/page.test.tsx`

**Interfaces:**
- Consumes: `cloreEnvoiCourant`, `listerEnvois`, `revoquerLiensDuCra`, `nouveauLienManuel`, `envoyerCourriel`, `gabaritAnnulationClient`, `transitionCra`.
- Produces: `annulerEnvoi` (Contrats) ; `compterCourrielsEchoues(userId, craId): Promise<number>` ; actions `annulerEnvoiAction(formData)`, `copierLienClient(prev, formData): Promise<{ url: string } | { erreur: string } | null>`.

- [ ] **Step 1: Tests de l'annulation**

`src/services/signature/annuler.test.ts` — même mise en place que `lien-client.test.ts` (copier son `beforeAll`/`beforeEach`/`afterAll`, avec des noms `ANNULER client` / `annuler@test.local`), puis :

```ts
describe('annulerEnvoi', () => {
  it('annule l enveloppe, révoque les liens, clôt l envoi et repasse en BROUILLON', async () => {
    const jeton = jetonDuDernierCourriel()
    const r = await annulerEnvoi(userId, craId, { connector, mailer })
    expect(r).toEqual({ ok: true })
    expect(connector.annulations).toEqual(['ext-1'])
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('BROUILLON')
    expect((await resoudreLien(jeton)).etat).toBe('RETIRE')
    expect(await prisma.signatureEnvoiClos.findMany({ where: { craId } })).toMatchObject([{ numero: 1, status: 'ANNULE' }])
    expect(corps.at(-1)).toContain('retiré')
  })

  it('PRESTATAIRE INJOIGNABLE : rien ne change, le lien reste valable', async () => {
    const jeton = jetonDuDernierCourriel()
    connector.faireEchouerAnnulation('panne')
    const r = await annulerEnvoi(userId, craId, { connector, mailer })
    expect(r).toMatchObject({ ok: false, raison: 'CONNECTEUR_EN_ECHEC' })
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
    expect((await resoudreLien(jeton)).etat).toBe('ACTIF')
  })

  it('refuse un CRA qui n est pas ENVOYE, et le CRA d un autre', async () => {
    await annulerEnvoi(userId, craId, { connector, mailer })
    expect(await annulerEnvoi(userId, craId, { connector, mailer })).toMatchObject({ ok: false, raison: 'TRANSITION_IMPOSSIBLE' })
    expect(await annulerEnvoi('autre', craId, { connector, mailer })).toMatchObject({ ok: false, raison: 'TRANSITION_IMPOSSIBLE' })
  })

  it('un renvoi après annulation numérote 2 et ne duplique pas l envoi clos', async () => {
    await annulerEnvoi(userId, craId, { connector, mailer })
    const r = await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect(r).toMatchObject({ ok: true, numero: 2 })
    expect(await prisma.signatureEnvoiClos.count({ where: { craId } })).toBe(1)
  })

  it('consigne signature.annulee et cra.rouvert', async () => {
    await annulerEnvoi(userId, craId, { connector, mailer })
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => e.action)
    expect(actions).toContain('signature.annulee')
    expect(actions).toContain('cra.rouvert')
  })
})
```

- [ ] **Step 2: Implémenter**

`src/services/signature/annuler.ts` :

```ts
import { prisma } from '@/db/client'
import { canTransition } from '@/core/cra/state-machine'
import { libelleMois } from '@/core/cra/document'
import { gabaritAnnulationClient } from '@/core/notify/signature'
import type { SignatureConnector } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import { actorOf, appendAudit } from '@/services/audit'
import { transitionCra } from '@/services/cra'
import type { Mailer } from '@/services/notify'
import { envoyerCourriel } from './courriels'
import { cloreEnvoiCourant } from './envois'
import { revoquerLiensDuCra } from './lien-client'
import { getSignatureConnector } from './registry'

const MESSAGES = {
  TRANSITION_IMPOSSIBLE: 'Seul un CRA envoyé peut être retiré.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas pu retirer le document. Le CRA reste envoyé : le client peut encore le signer.',
} as const

/**
 * Retire un CRA envoyé, avant la réponse du client.
 *
 * **L'enveloppe est annulée chez le prestataire d'abord**, et si ça échoue
 * rien ne bouge : un CRA rouvert chez nous mais encore signable chez le
 * prestataire validerait un mois en cours de modification.
 */
export async function annulerEnvoi(
  userId: string,
  craId: string,
  options: { connector?: SignatureConnector | null; mailer?: Mailer | null } = {},
): Promise<{ ok: true } | { ok: false; raison: keyof typeof MESSAGES; message: string }> {
  const echec = (raison: keyof typeof MESSAGES) => ({ ok: false as const, raison, message: MESSAGES[raison] })

  const cra = await prisma.cra.findFirst({
    where: { id: craId, userId },
    include: { mission: { include: { client: true } }, signatureRequest: true },
  })
  if (cra === null || !canTransition(cra.status as CraStatus, 'ANNULER_ENVOI')) return echec('TRANSITION_IMPOSSIBLE')

  const demande = cra.signatureRequest
  if (demande !== null && demande.externalId !== '') {
    const connector = options.connector !== undefined ? options.connector : await getSignatureConnector()
    if (connector === null) return echec('CONNECTEUR_EN_ECHEC')
    try {
      await connector.annuler(demande.externalId)
    } catch {
      return echec('CONNECTEUR_EN_ECHEC')
    }
  }

  const maintenant = new Date()
  if (demande !== null) {
    await prisma.$transaction(async (tx) => {
      await tx.signatureRequest.update({ where: { craId }, data: { status: 'ANNULE', completedAt: maintenant } })
      await cloreEnvoiCourant(tx, craId, maintenant)
      await revoquerLiensDuCra(tx, craId, maintenant)
    })
  }

  await transitionCra(userId, craId, 'ANNULER_ENVOI')
  await appendAudit({
    ...(await actorOf(userId)),
    action: 'signature.annulee',
    entityType: 'Cra',
    entityId: craId,
    payload: { numero: demande?.numero ?? 0 },
  })

  if (demande !== null) {
    await envoyerCourriel({
      craId,
      raison: 'ANNULATION',
      to: demande.signataireEmail,
      gabarit: gabaritAnnulationClient({
        clientNom: cra.mission.client.name,
        missionLabel: cra.mission.label,
        moisLibelle: libelleMois(cra.month.toISOString().slice(0, 7)),
        signataireNom: demande.signataireNom,
      }),
      mailer: options.mailer ?? null,
    })
  }

  return { ok: true }
}
```

Ajouter à `src/services/signature/envois.ts` :

```ts
/**
 * Les courriels **non partis** depuis l'envoi en cours — pour que l'écran du
 * CRA le dise. Lu dans le journal, en bloc : la raison est dans la charge
 * utile, jamais interrogée finement.
 */
export async function compterCourrielsEchoues(userId: string, craId: string): Promise<number> {
  const cra = await prisma.cra.findFirst({ where: { id: craId, userId }, select: { id: true } })
  if (cra === null) return 0
  const demande = await prisma.signatureRequest.findUnique({ where: { craId }, select: { sentAt: true } })
  if (demande === null) return 0
  return prisma.auditEvent.count({
    where: { entityType: 'Cra', entityId: craId, action: 'signature.courriel.echoue', occurredAt: { gte: demande.sentAt } },
  })
}
```

Run: `npx vitest run src/services/signature/annuler.test.ts src/services/audit-emetteurs.test.ts`
Expected: PASS — **les huit noms ont désormais un émetteur.**

- [ ] **Step 3: Historique — composant et test**

`src/components/cra/HistoriqueEnvois.tsx` :

```tsx
import type { EnvoiVue } from '@/services/signature/envois'

const LIBELLES: Record<EnvoiVue['status'], string> = {
  EN_ATTENTE: 'en attente de signature',
  SIGNE: 'signé',
  REFUSE: 'refusé',
  EXPIRE: 'expiré',
  ANNULE: 'retiré',
}

function jour(d: Date): string {
  return d.toISOString().slice(0, 10).split('-').reverse().join('/')
}

/**
 * Chaque envoi du CRA, du plus récent au plus ancien. L'état est écrit en
 * toutes lettres : aucune information n'est portée par la seule couleur.
 */
export function HistoriqueEnvois({ envois }: { envois: EnvoiVue[] }) {
  if (envois.length === 0) return null
  return (
    <section aria-labelledby="historique-envois" className="mb-4">
      <h3 id="historique-envois" className="mb-2 text-sm font-medium">Historique des envois</h3>
      <ol className="flex flex-col gap-2 text-sm">
        {envois.map((e) => (
          <li key={e.numero} className="rounded-md border border-rule p-2">
            <p>
              <span className="font-medium">Envoi n° {e.numero}</span>
              <span className="text-muted"> · le {jour(e.sentAt)} · {LIBELLES[e.status]}</span>
              {e.completedAt !== null && <span className="text-muted"> le {jour(e.completedAt)}</span>}
              {e.signataireNom !== '' && <span className="text-muted"> — {e.signataireNom}</span>}
            </p>
            {e.motifRefus !== '' && <p className="mt-1">« {e.motifRefus} »</p>}
            {e.empreinte !== '' && (
              <p className="mt-1 text-xs text-muted">
                Empreinte du document : {e.empreinte.slice(0, 4)}…{e.empreinte.slice(-4)}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
```

`src/components/cra/HistoriqueEnvois.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { HistoriqueEnvois } from './HistoriqueEnvois'

afterEach(cleanup)

describe('HistoriqueEnvois', () => {
  it('rend chaque envoi, son état en toutes lettres et le motif du refus', () => {
    render(
      <HistoriqueEnvois
        envois={[
          { numero: 2, status: 'SIGNE', sentAt: new Date('2026-10-06T09:00:00Z'), completedAt: new Date('2026-10-06T10:00:00Z'), motifRefus: '', signataireNom: 'Jeanne Martin', empreinte: '3f9a00000000c21e', enCours: true },
          { numero: 1, status: 'REFUSE', sentAt: new Date('2026-10-01T09:00:00Z'), completedAt: new Date('2026-10-03T09:00:00Z'), motifRefus: 'Il manque le 15.', signataireNom: 'Jeanne Martin', empreinte: '', enCours: false },
        ]}
      />,
    )
    expect(screen.getByText('Envoi n° 2')).toBeTruthy()
    expect(screen.getByText(/signé/)).toBeTruthy()
    expect(screen.getByText('« Il manque le 15. »')).toBeTruthy()
    expect(screen.getByText(/3f9a…c21e/)).toBeTruthy()
  })

  it('ne rend rien sans envoi', () => {
    const { container } = render(<HistoriqueEnvois envois={[]} />)
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 4: Lien manuel**

`src/components/cra/LienManuel.tsx` :

```tsx
'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'

type Etat = { url: string } | { erreur: string } | null

/**
 * Un lien neuf pour le client, à transmettre à la main — quand le courriel
 * n'est pas parti, ou que le client l'a égaré. Le jeton n'est montré qu'ici,
 * une fois : la base n'en garde que l'empreinte.
 */
export function LienManuel({
  craId,
  action,
}: {
  craId: string
  action: (prev: Etat, formData: FormData) => Promise<Etat>
}) {
  const [etat, soumettre, enCours] = useActionState(action, null)
  return (
    <form action={soumettre} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="craId" value={craId} />
      <Button disabled={enCours}>Obtenir un lien pour le client</Button>
      {etat !== null && 'url' in etat && (
        <input
          readOnly
          value={etat.url}
          aria-label="Lien à transmettre au client"
          className="w-full rounded-md border border-rule px-2 py-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {etat !== null && 'erreur' in etat && <p role="alert">{etat.erreur}</p>}
    </form>
  )
}
```

- [ ] **Step 5: Actions et page**

Dans `src/app/(app)/cra/[craId]/actions.ts`, ajouter :

```ts
import { annulerEnvoi } from '@/services/signature/annuler'
import { nouveauLienManuel } from '@/services/signature/lien-client'

export async function annulerEnvoiAction(formData: FormData): Promise<void> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const r = await annulerEnvoi(user.id, craId)
  revalidatePath('/cra')
  revalidatePath(`/cra/${craId}`)
  revalidatePath('/saisie')
  retour(craId, r.ok ? undefined : `ANNULATION_${r.raison}`)
}

export async function copierLienClient(
  _prev: { url: string } | { erreur: string } | null,
  formData: FormData,
): Promise<{ url: string } | { erreur: string }> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const r = await nouveauLienManuel(user.id, craId, await origineDeLaRequete())
  return r.ok ? { url: r.url } : { erreur: 'Aucun envoi en attente de signature sur ce CRA.' }
}
```

Dans `page.tsx` :
- charger en parallèle de `getCra` : `listerEnvois(user.id, craId)` et `compterCourrielsEchoues(user.id, craId)` ;
- ajouter à `ERREURS` : `ANNULATION_TRANSITION_IMPOSSIBLE: 'Seul un CRA envoyé peut être retiré.'` et `ANNULATION_CONNECTEUR_EN_ECHEC: 'L’outil de signature n’a pas pu retirer le document. Le CRA reste envoyé : le client peut encore le signer.'` ; le titre du bandeau devient « Action impossible » quand la clé commence par `ANNULATION_`, et « Courriel non parti » pour `COURRIEL_NON_PARTI` ;
- remplacer `{cra.signature !== null && <SignatureCard … />}` par :

```tsx
{cra.signature !== null && <SignatureCard signature={cra.signature} />}
{courrielsEchoues > 0 && (
  <div className="mb-4">
    <Banner tone="warning" title="Courriel non parti">
      {courrielsEchoues} courriel{courrielsEchoues > 1 ? 's' : ''} du circuit de signature n’{courrielsEchoues > 1 ? 'ont' : 'a'} pas pu partir. Vérifiez la configuration SMTP, ou transmettez le lien vous-même.
    </Banner>
  </div>
)}
<HistoriqueEnvois envois={envois} />
```

- dans la barre de boutons, après « Rafraîchir l'état » :

```tsx
{cra.status === 'ENVOYE' && cra.signature !== null && (
  <form action={annulerEnvoiAction}>
    <input type="hidden" name="craId" value={cra.id} />
    <Button>Annuler l’envoi</Button>
  </form>
)}
```

- sous la barre, si `cra.status === 'ENVOYE' && cra.signature?.status === 'EN_ATTENTE'` : `<LienManuel craId={cra.id} action={copierLienClient} />`.

Dans `page.test.tsx`, suivre le procédé du fichier (services simulés par `vi.mock`) : simuler `listerEnvois` (rend `[]` par défaut) et `compterCourrielsEchoues` (rend `0`), puis ajouter : « sur un CRA ENVOYE avec signature, le bouton “Annuler l’envoi” est présent », « sur un CRA REFUSE, le bouton s’intitule “Renvoyer pour signature” », « avec deux courriels échoués, le bandeau le dit ».

- [ ] **Step 6: Vérifier**

Run: `npx vitest run src/services/signature src/components/cra "src/app/(app)/cra" src/services/audit-emetteurs.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 7: Commit**

```bash
git add src/services/signature src/components/cra "src/app/(app)/cra"
git commit -m "feat(cra): annuler l'envoi, historique des envois et lien client manuel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: La page du client `/v/[jeton]`

**Files:**
- Modify: `src/middleware.ts`, `src/middleware.test.ts`
- Create: `src/app/v/[jeton]/session.ts`
- Create: `src/app/v/[jeton]/actions.ts`, `src/app/v/[jeton]/actions.test.ts`
- Create: `src/app/v/[jeton]/page.tsx`
- Create: `src/app/v/[jeton]/pdf/route.ts`
- Create: `src/components/client/CraLecture.tsx`, `src/components/client/CraLecture.test.tsx`
- Create: `src/components/client/CadreSignature.tsx`, `src/components/client/CadreSignature.test.tsx`
- Create: `src/components/client/FormulaireCode.tsx`

**Interfaces:**
- Consumes: tout `lien-client.ts` (tâche 9), `autoriser` (limiteur), `signerSessionClient`/`lireSessionClient`/`SESSION_CLIENT_MINUTES` (tâche 3), `formatJours`, `libelleJour` (`core/cra/document`).
- Produces: la route publique.

- [ ] **Step 1: Middleware — tests**

Ajouter à `src/middleware.test.ts` :

```ts
describe('middleware — la page client du lot 3b', () => {
  it('laisse passer /v/<jeton> sans session', async () => {
    const r = await sansSession(`/v/${'a'.repeat(64)}`)
    expect(redirige(r)).toBe(false)
  })

  it('pose les en-têtes de la page client', async () => {
    process.env.DOCUMENSO_URL = 'https://sign.exemple.fr/'
    const r = await sansSession(`/v/${'a'.repeat(64)}`)
    expect(r!.headers.get('referrer-policy')).toBe('no-referrer')
    expect(r!.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const csp = r!.headers.get('content-security-policy') ?? ''
    expect(csp).toContain('frame-src https://sign.exemple.fr')
    expect(csp).toContain("frame-ancestors 'none'")
    delete process.env.DOCUMENSO_URL
  })

  it('ne rouvre rien d autre : /cra reste fermé', async () => {
    expect(redirige(await sansSession('/cra'))).toBe(true)
    expect(redirige(await sansSession('/vue'))).toBe(true)
  })
})
```

- [ ] **Step 2: Middleware — implémentation**

Dans `src/middleware.ts`, avant `return protege(request, event)` :

```ts
  // **La seule page de l'outil sans session** (lot 3b) : le client n'a pas de
  // compte. Sa garde est le jeton du lien, puis un code à usage unique — voir
  // `src/services/signature/lien-client.ts`. `/v/` et pas `/v` : `/vue` ou
  // `/v` seuls restent derrière l'authentification.
  if (request.nextUrl.pathname.startsWith('/v/')) return reponseClient()
```

et en bas du fichier :

```ts
/**
 * Les en-têtes de la page client.
 *
 *   - `frame-src` limité à l'instance Documenso : le seul cadre que la page
 *     charge. Posé ici et non dans `next.config.ts`, dont les en-têtes sont
 *     figés à la construction — `DOCUMENSO_URL` est un réglage d'exécution.
 *   - `frame-ancestors 'none'` : personne n'encadre la page du client.
 *   - `no-referrer` : le jeton est dans l'URL, il ne doit fuir vers personne.
 *   - `noindex` : un lien privé n'a rien à faire dans un moteur.
 */
function reponseClient(): NextResponse {
  const reponse = NextResponse.next()
  let origineSignature = ''
  try {
    origineSignature = process.env.DOCUMENSO_URL ? new URL(process.env.DOCUMENSO_URL).origin : ''
  } catch {
    origineSignature = ''
  }
  reponse.headers.set(
    'Content-Security-Policy',
    `frame-src ${origineSignature !== '' ? origineSignature : "'none'"}; frame-ancestors 'none'`,
  )
  reponse.headers.set('Referrer-Policy', 'no-referrer')
  reponse.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return reponse
}
```

Run: `npx vitest run src/middleware.test.ts` → PASS.

- [ ] **Step 3: Session côté page**

`src/app/v/[jeton]/session.ts` :

```ts
import 'server-only'
import { cookies } from 'next/headers'
import { lireSessionClient, signerSessionClient, SESSION_CLIENT_MINUTES } from '@/core/signature/code-client'
import { resoudreLien, secretClient } from '@/services/signature/lien-client'

export const COOKIE_CLIENT = 'cra_client'

/** Le lien que la session ouvre **pour ce jeton**, ou `null`. */
export async function lienDeLaSession(jeton: string): Promise<string | null> {
  const { etat, lienId } = await resoudreLien(jeton)
  if (lienId === null || etat === 'INCONNU') return null
  const valeur = (await cookies()).get(COOKIE_CLIENT)?.value ?? ''
  const ouvert = lireSessionClient(valeur, secretClient(), new Date())
  return ouvert === lienId ? lienId : null
}

/**
 * Le cookie est **limité au chemin du lien** : une session ouverte sur un CRA
 * n'est même pas présentée aux autres.
 */
export async function ouvrirSession(jeton: string, lienId: string): Promise<void> {
  const expire = new Date(Date.now() + SESSION_CLIENT_MINUTES * 60_000)
  ;(await cookies()).set(COOKIE_CLIENT, signerSessionClient(lienId, expire, secretClient()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/v/${jeton}`,
    expires: expire,
  })
}
```

> Si `server-only` n'est pas une dépendance du dépôt (`grep -n '"server-only"' package.json`), retirer la première ligne : ne pas ajouter de dépendance pour elle.

- [ ] **Step 4: Actions — tests**

`src/app/v/[jeton]/actions.test.ts`, sur le modèle de `src/app/(auth)/mot-de-passe/actions.test.ts` (services simulés, `next/headers` et `next/navigation` simulés) :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  demanderCode: vi.fn(),
  verifierCode: vi.fn(),
  confirmerDepuisPage: vi.fn(),
  renouvelerDepuisPage: vi.fn(),
  ouvrirSession: vi.fn(),
  lienDeLaSession: vi.fn(),
  autoriser: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`)
  }),
}))
vi.mock('@/services/signature/lien-client', () => ({
  demanderCode: m.demanderCode, verifierCode: m.verifierCode,
  confirmerDepuisPage: m.confirmerDepuisPage, renouvelerDepuisPage: m.renouvelerDepuisPage,
}))
vi.mock('@/services/signature/limiteur', () => ({ autoriser: m.autoriser }))
vi.mock('./session', () => ({ ouvrirSession: m.ouvrirSession, lienDeLaSession: m.lienDeLaSession }))
vi.mock('next/headers', () => ({ headers: m.headers }))
vi.mock('next/navigation', () => ({ redirect: m.redirect }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { confirmerSignature, demanderCodeAction, validerCodeAction } from './actions'

const J = 'a'.repeat(64)
const fd = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset?.()
  m.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT ${url}`)
  })
  m.headers.mockResolvedValue({ get: (n: string) => (n === 'x-forwarded-for' ? '1.2.3.4, 10.0.0.1' : null) })
  m.autoriser.mockReturnValue(true)
})

describe('page client — actions', () => {
  it('demander un code renvoie vers la saisie', async () => {
    m.demanderCode.mockResolvedValue({ ok: true, adresseMasquee: 'j•••@c.fr' })
    await expect(demanderCodeAction(fd({ jeton: J }))).rejects.toThrow(`REDIRECT /v/${J}?etape=code`)
  })

  it('un code juste ouvre la session puis recharge la page', async () => {
    m.verifierCode.mockResolvedValue({ ok: true, lienId: 'l1' })
    await expect(validerCodeAction(fd({ jeton: J, code: '123456' }))).rejects.toThrow(`REDIRECT /v/${J}`)
    expect(m.ouvrirSession).toHaveBeenCalledWith(J, 'l1')
  })

  it('un code faux ne pose aucune session', async () => {
    m.verifierCode.mockResolvedValue({ ok: false, raison: 'CODE' })
    await expect(validerCodeAction(fd({ jeton: J, code: '000000' }))).rejects.toThrow(`erreur=CODE`)
    expect(m.ouvrirSession).not.toHaveBeenCalled()
  })

  it('la limite par IP s applique avant toute vérification, sur la première adresse de la chaîne', async () => {
    m.autoriser.mockReturnValue(false)
    await expect(validerCodeAction(fd({ jeton: J, code: '123456' }))).rejects.toThrow('erreur=LIMITE')
    expect(m.autoriser).toHaveBeenCalledWith('1.2.3.4')
    expect(m.verifierCode).not.toHaveBeenCalled()
  })

  it('confirmer sans session ne fait rien', async () => {
    m.lienDeLaSession.mockResolvedValue(null)
    await confirmerSignature(J)
    expect(m.confirmerDepuisPage).not.toHaveBeenCalled()
  })

  it('confirmer avec session relit chez le prestataire', async () => {
    m.lienDeLaSession.mockResolvedValue('l1')
    await confirmerSignature(J)
    expect(m.confirmerDepuisPage).toHaveBeenCalledWith('l1')
  })
})
```

- [ ] **Step 5: Actions — implémentation**

`src/app/v/[jeton]/actions.ts` :

```ts
'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  confirmerDepuisPage,
  demanderCode,
  renouvelerDepuisPage,
  verifierCode,
} from '@/services/signature/lien-client'
import { autoriser } from '@/services/signature/limiteur'
import { lienDeLaSession, ouvrirSession } from './session'

function jetonDe(formData: FormData): string {
  const j = String(formData.get('jeton') ?? '')
  return /^[0-9a-f]{64}$/.test(j) ? j : '0'.repeat(64)
}

async function ip(): Promise<string> {
  const h = await headers()
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'inconnue').split(',')[0]!.trim()
}

export async function demanderCodeAction(formData: FormData): Promise<void> {
  const jeton = jetonDe(formData)
  const r = await demanderCode(jeton)
  redirect(r.ok ? `/v/${jeton}?etape=code` : `/v/${jeton}?erreur=${r.raison}`)
}

export async function validerCodeAction(formData: FormData): Promise<void> {
  const jeton = jetonDe(formData)
  if (!autoriser(await ip())) redirect(`/v/${jeton}?etape=code&erreur=LIMITE`)

  const r = await verifierCode(jeton, String(formData.get('code') ?? ''))
  if (!r.ok) redirect(`/v/${jeton}?etape=code&erreur=${r.raison}`)

  await ouvrirSession(jeton, r.lienId)
  redirect(`/v/${jeton}`)
}

/**
 * Appelée par le cadre de signature quand il annonce « signé » ou « refusé ».
 * Ne transmet **rien** de ce que le navigateur raconte : le service relit
 * l'état chez le prestataire.
 */
export async function confirmerSignature(jeton: string): Promise<void> {
  const lienId = await lienDeLaSession(jeton)
  if (lienId === null) return
  await confirmerDepuisPage(lienId)
  revalidatePath(`/v/${jeton}`)
}

export async function renouvelerSignature(jeton: string): Promise<void> {
  const lienId = await lienDeLaSession(jeton)
  if (lienId === null) return
  await renouvelerDepuisPage(lienId)
  revalidatePath(`/v/${jeton}`)
}
```

> `redirect()` lève : le code qui le suit ne s'exécute pas en production. Dans `validerCodeAction`, TypeScript ne sait pas que `redirect` ne rend pas (`never`) si le type importé est correct — il l'est (`next/navigation` déclare `never`) ; `r.lienId` est donc bien typé après la garde.

Run: `npx vitest run "src/app/v"` → PASS.

- [ ] **Step 6: Lecture du CRA — composant et test**

`src/components/client/CraLecture.tsx` :

```tsx
import { formatJours, libelleJour, type CraDocument } from '@/core/cra/document'

function estWeekEnd(date: string): boolean {
  const j = new Date(`${date}T00:00:00Z`).getUTCDay()
  return j === 0 || j === 6
}

/**
 * Le CRA tel que le client l'a reçu — **en lecture seule, depuis le contenu
 * figé**. Aucun montant : le type `CraDocument` n'en porte pas.
 *
 * Week-ends et fériés sont **nommés** (« sam. », « férié »), pas seulement
 * grisés : aucune information par la seule couleur.
 */
export function CraLecture({ document }: { document: CraDocument }) {
  const feries = new Set(document.feries)
  const parJour = new Map<string, number>()
  for (const l of document.lignes) for (const j of l.jours) parJour.set(j.date, (parJour.get(j.date) ?? 0) + j.centiemes)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">{document.emetteur.nom}</p>
        <h1 className="text-xl">
          {document.clientNom} · {document.missionLabel}
        </h1>
        <p className="text-muted">Compte-rendu d’activité — {document.moisLibelle}</p>
      </header>

      <p>
        <span className="text-2xl font-medium">{formatJours(document.totalCentiemes)} j</span>{' '}
        <span className="text-muted">réalisés sur le mois</span>
      </p>

      <section aria-label="Calendrier du mois">
        <ol className="grid grid-cols-7 gap-1 text-center text-xs">
          {document.joursDuMois.map((date) => {
            const c = parJour.get(date) ?? 0
            const repere = feries.has(date) ? 'férié' : estWeekEnd(date) ? libelleJour(date).split(' ')[0] : ''
            return (
              <li key={date} className={`rounded-md border border-rule p-1 ${c > 0 ? 'bg-off' : ''}`}>
                <span className="block text-muted">{Number(date.slice(8))}</span>
                <span className="block font-medium">{c > 0 ? formatJours(c) : '–'}</span>
                {repere !== '' && <span className="block text-muted">{repere}</span>}
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-label="Détail par prestation">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-4">Prestation</th>
                <th className="py-1 pr-4">Jours</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {document.lignes.map((l) => (
                <tr key={l.label} className="border-b border-rule align-top">
                  <td className="py-1 pr-4">{l.label}</td>
                  <td className="py-1 pr-4">
                    {l.jours.map((j) => `${libelleJour(j.date)} : ${formatJours(j.centiemes)}`).join(' · ')}
                  </td>
                  <td className="py-1 text-right">{formatJours(l.totalCentiemes)} j</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
```

> Vérifier la sortie de `libelleJour` (`src/core/cra/document.ts:140`) : si elle ne commence pas par l'abréviation du jour, remplacer `libelleJour(date).split(' ')[0]` par une table locale `['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][jour]`.

`src/components/client/CraLecture.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { CraDocument } from '@/core/cra/document'
import { CraLecture } from './CraLecture'

afterEach(cleanup)

const doc = {
  emetteur: { nom: 'Kreativ', adresse: '', siret: '', email: '' },
  clientNom: 'Client SA', missionLabel: 'ITSM', mois: '2026-09', moisLibelle: 'septembre 2026',
  signataireNom: 'Jeanne', signataireEmail: 'j@c.fr',
  lignes: [{ label: 'Consultant', jours: [{ date: '2026-09-01', centiemes: 100 }], totalCentiemes: 100, engagement: {} }],
  totalCentiemes: 100, joursDuMois: ['2026-09-01', '2026-09-05'], feries: [], engagementMission: {},
} as unknown as CraDocument

describe('CraLecture', () => {
  it('affiche le client, le mois, le total et la ligne', () => {
    render(<CraLecture document={doc} />)
    expect(screen.getByText(/Client SA · ITSM/)).toBeTruthy()
    expect(screen.getByText(/septembre 2026/)).toBeTruthy()
    expect(screen.getByText('Consultant')).toBeTruthy()
  })

  it('nomme le week-end au lieu de seulement le griser', () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.textContent).toMatch(/sam/)
  })

  it("n'affiche aucun montant", () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.textContent).not.toMatch(/€|EUR|montant/i)
  })

  it("n'offre aucun champ de saisie", () => {
    const { container } = render(<CraLecture document={doc} />)
    expect(container.querySelectorAll('input, textarea, select, button')).toHaveLength(0)
  })
})
```

- [ ] **Step 7: Le cadre de signature — composant et test**

`src/components/client/CadreSignature.tsx` :

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Le cadre Documenso, embarqué. Il **n'est cru sur rien** : ses messages ne
 * servent qu'à afficher « merci » et à demander au serveur de relire l'état
 * chez le prestataire (`confirmer`). La transition du CRA n'en dépend pas.
 *
 * Le lien « ouvrir dans un nouvel onglet » est toujours là : si l'instance
 * refuse d'être encadrée, le client signe quand même.
 */
export function CadreSignature({
  url,
  confirmer,
  renouveler,
}: {
  url: string
  confirmer: () => Promise<void>
  renouveler: () => Promise<void>
}) {
  const cadre = useRef<HTMLIFrameElement>(null)
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const origine = new URL(url).origin
    async function ecouter(e: MessageEvent) {
      if (e.origin !== origine || e.source !== cadre.current?.contentWindow) return
      const action = (e.data as { action?: unknown } | null)?.action
      if (action === 'document-completed' || action === 'document-rejected') {
        setMessage(action === 'document-completed' ? 'Merci, votre signature est enregistrée.' : 'Votre refus est transmis.')
        await confirmer()
        router.refresh()
      } else if (action === 'document-error') {
        setMessage('Le document n’a pas pu s’afficher. Nous renouvelons le lien de signature…')
        await renouveler()
        router.refresh()
      }
    }
    window.addEventListener('message', ecouter)
    return () => window.removeEventListener('message', ecouter)
  }, [url, confirmer, renouveler, router])

  return (
    <section aria-label="Signature du document" className="flex flex-col gap-2">
      {message !== null && <p role="status">{message}</p>}
      <iframe
        ref={cadre}
        src={url}
        title="Document à signer"
        className="h-[80vh] w-full rounded-md border border-rule"
      />
      <p className="text-sm">
        Le document ne s’affiche pas ?{' '}
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-link underline">
          Ouvrir le document dans un nouvel onglet
        </a>
      </p>
    </section>
  )
}
```

`src/components/client/CadreSignature.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CadreSignature } from './CadreSignature'

afterEach(cleanup)

const URL_CADRE = 'https://sign.exemple.fr/embed/sign/jeton-1#abc'

function poster(source: MessageEventSource | null, origin: string, action: string) {
  window.dispatchEvent(new MessageEvent('message', { data: { action }, origin, source }))
}

describe('CadreSignature', () => {
  it('sur « signé » venu du cadre, demande au serveur de relire', async () => {
    const confirmer = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<CadreSignature url={URL_CADRE} confirmer={confirmer} renouveler={vi.fn()} />)
    const iframe = container.querySelector('iframe')!
    poster(iframe.contentWindow, 'https://sign.exemple.fr', 'document-completed')
    await waitFor(() => expect(confirmer).toHaveBeenCalledTimes(1))
  })

  it('IGNORE un message d une autre origine ou d une autre fenêtre', async () => {
    const confirmer = vi.fn()
    const { container } = render(<CadreSignature url={URL_CADRE} confirmer={confirmer} renouveler={vi.fn()} />)
    const iframe = container.querySelector('iframe')!
    poster(iframe.contentWindow, 'https://pirate.test', 'document-completed')
    poster(window, 'https://sign.exemple.fr', 'document-completed')
    await new Promise((r) => setTimeout(r, 10))
    expect(confirmer).not.toHaveBeenCalled()
  })

  it('propose toujours d ouvrir le document dans un nouvel onglet', () => {
    const { getByText } = render(<CadreSignature url={URL_CADRE} confirmer={vi.fn()} renouveler={vi.fn()} />)
    const lien = getByText(/nouvel onglet/) as HTMLAnchorElement
    expect(lien.getAttribute('href')).toBe(URL_CADRE)
    expect(lien.getAttribute('rel')).toContain('noopener')
  })
})
```

> Si `happy-dom` ne fournit pas de `contentWindow` à une iframe non chargée, basculer ce fichier en `// @vitest-environment jsdom` (voir le commentaire de `vitest.config.ts` sur la version de Node) ; à défaut, tester l'origine seule et le noter dans le commit.

- [ ] **Step 8: Formulaire du code**

`src/components/client/FormulaireCode.tsx` :

```tsx
import { Button } from '@/components/ui/Button'
import { demanderCodeAction, validerCodeAction } from '@/app/v/[jeton]/actions'

const ERREURS: Record<string, string> = {
  CODE: 'Code incorrect ou expiré.',
  EPUISE: 'Trop d’essais pour ce code. Demandez-en un nouveau.',
  TROP_DE_CODES: 'Trop de codes demandés. Réessayez dans une heure.',
  LIMITE: 'Trop d’essais depuis cette connexion. Réessayez dans un quart d’heure.',
  LIEN: 'Ce lien n’est plus valable.',
}

/**
 * Deux étapes : recevoir un code, puis le saisir. **Rien ne part à
 * l'ouverture de la page** : les analyseurs de liens des messageries ouvrent
 * chaque lien reçu, et enverraient un code à chaque fois.
 */
export function FormulaireCode({ jeton, etape, erreur }: { jeton: string; etape: 'demande' | 'code'; erreur?: string }) {
  const message = erreur !== undefined ? ERREURS[erreur] : undefined
  return (
    <div className="flex max-w-sm flex-col gap-4">
      <p>Pour consulter ce compte-rendu d’activité, confirmez votre adresse : un code à six chiffres vous sera envoyé.</p>
      {message !== undefined && <p role="alert">{message}</p>}
      {etape === 'code' && (
        <form action={validerCodeAction} className="flex flex-col gap-2">
          <input type="hidden" name="jeton" value={jeton} />
          <label htmlFor="code">Code reçu par courriel</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            className="rounded-md border border-rule px-3 py-2 text-lg tracking-widest"
          />
          <Button variant="primary">Valider</Button>
        </form>
      )}
      <form action={demanderCodeAction}>
        <input type="hidden" name="jeton" value={jeton} />
        <Button variant={etape === 'code' ? undefined : 'primary'}>
          {etape === 'code' ? 'Recevoir un nouveau code' : 'Recevoir mon code'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 9: La page et le téléchargement**

`src/app/v/[jeton]/page.tsx` :

```tsx
import type { Metadata } from 'next'
import { CraLecture } from '@/components/client/CraLecture'
import { CadreSignature } from '@/components/client/CadreSignature'
import { FormulaireCode } from '@/components/client/FormulaireCode'
import { Banner } from '@/components/ui/Banner'
import { lireVueClient, resoudreLien } from '@/services/signature/lien-client'
import { confirmerSignature, renouvelerSignature } from './actions'
import { lienDeLaSession } from './session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Compte-rendu d’activité',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

function Neutre({ titre, texte }: { titre: string; texte: string }) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-2 text-xl">{titre}</h1>
      <p className="text-muted">{texte}</p>
    </main>
  )
}

function jour(d: Date): string {
  return d.toISOString().slice(0, 10).split('-').reverse().join('/')
}

/**
 * La page du client — **la seule de l'outil sans session**. Elle ne montre que
 * le contenu figé de l'envoi, après un code à usage unique.
 */
export default async function PageClient({
  params,
  searchParams,
}: {
  params: Promise<{ jeton: string }>
  searchParams: Promise<{ etape?: string; erreur?: string }>
}) {
  const { jeton } = await params
  const { etape, erreur } = await searchParams
  const { etat } = await resoudreLien(jeton)

  if (etat === 'INCONNU') return <Neutre titre="Lien non valable" texte="Ce lien n’est pas ou plus valable. Utilisez le lien du dernier courriel reçu." />
  if (etat === 'REMPLACE') return <Neutre titre="Une version plus récente existe" texte="Une version plus récente de ce compte-rendu vous a été envoyée. Utilisez le lien du dernier courriel reçu." />
  if (etat === 'RETIRE') return <Neutre titre="Document retiré" texte="Ce compte-rendu a été retiré par son émetteur. Une nouvelle version vous sera envoyée." />

  const lienId = await lienDeLaSession(jeton)
  if (lienId === null) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-xl">Compte-rendu d’activité</h1>
        <FormulaireCode jeton={jeton} etape={etape === 'code' ? 'code' : 'demande'} erreur={erreur} />
      </main>
    )
  }

  const vue = await lireVueClient(lienId)
  if (vue.document === null) return <Neutre titre="Document indisponible" texte="Ce compte-rendu n’est plus disponible." />

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <CraLecture document={vue.document} />

      {vue.statut === 'SIGNE' && (
        <Banner tone="success" title={`Signé le ${vue.signeLe !== null ? jour(vue.signeLe) : ''}`}>
          {vue.pdfSigneDisponible ? (
            <a href={`/v/${jeton}/pdf`} className="text-link underline">Télécharger le document signé</a>
          ) : (
            'Le document signé sera disponible ici dans quelques instants.'
          )}
        </Banner>
      )}
      {vue.statut === 'REFUSE' && (
        <Banner tone="danger" title={`Refusé le ${vue.refuseLe !== null ? jour(vue.refuseLe) : ''}`}>
          Motif transmis : « {vue.motifRefus} ». Une version corrigée vous sera adressée.
        </Banner>
      )}
      {vue.statut === 'EXPIRE' && (
        <Banner tone="warning" title="Demande expirée">Contactez l’émetteur pour recevoir une nouvelle version.</Banner>
      )}

      {vue.statut === 'A_SIGNER' && vue.urlEmbarquee !== null && (
        <>
          <p>
            Vérifiez le détail ci-dessus, puis <strong>signez</strong> dans le cadre ci-dessous. Pour{' '}
            <strong>refuser</strong>, utilisez le bouton « Refuser » du cadre et indiquez votre motif.
          </p>
          <CadreSignature
            url={vue.urlEmbarquee}
            confirmer={confirmerSignature.bind(null, jeton)}
            renouveler={renouvelerSignature.bind(null, jeton)}
          />
        </>
      )}

      <p className="text-xs text-muted">
        Empreinte du document : {vue.empreinte.slice(0, 4)}…{vue.empreinte.slice(-4)}
      </p>
    </main>
  )
}
```

> Vérifier que `Banner` accepte `tone="success"` et `tone="danger"` (`grep -n "tone" src/components/ui/Banner.tsx`) ; à défaut, utiliser les tons qu'il propose.

`src/app/v/[jeton]/pdf/route.ts` :

```ts
import { pdfSigneDuLien } from '@/services/signature/lien-client'
import { lienDeLaSession } from '../session'

/** Le PDF signé, pour une session client ouverte sur **ce** lien ; sinon 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ jeton: string }> }): Promise<Response> {
  const { jeton } = await params
  const lienId = await lienDeLaSession(jeton)
  const pdf = lienId === null ? null : await pdfSigneDuLien(lienId)
  if (pdf === null) return new Response('Introuvable', { status: 404 })
  return new Response(pdf.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.fileName}"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
```

> `nomFichierCra` produit un nom sans guillemet ni séparateur : il peut entrer tel quel dans l'en-tête.

- [ ] **Step 10: Vérifier**

Run: `npx vitest run src/middleware.test.ts "src/app/v" src/components/client`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 11: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts src/app/v src/components/client
git commit -m "feat(signature): la page du client, son code a usage unique et le cadre de signature

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Documentation, décision affinée, vérification complète

**Files:**
- Modify: `docs/decisions.md`, `docs/superpowers/ETAT.md`, `docs/integrations.md`, `.env.example`, `.env.docker.example`
- Modify: `README.md` (section signature, si elle décrit le webhook ou l'API v1)

- [ ] **Step 1: La décision affinée**

Dans `docs/decisions.md` et `docs/superpowers/ETAT.md`, remplacer la ligne :

```
| **Pas de portail client** | Le client reçoit un document et le signe. Tout un sous-système disparaît |
```

par :

```
| **Pas de compte client** | Le client reçoit un lien par CRA, s'identifie par un code à usage unique, voit et signe ce document-là, rien d'autre. Ni inscription, ni mot de passe, ni espace client à maintenir (affiné au lot 3b, qui a remplacé « pas de portail client ») |
```

Ajouter sous le tableau de `docs/decisions.md` une section courte « Le lot 3b, et ce qu'il n'a pas rouvert » : le client signe dans l'outil (Documenso embarqué, API v2), la page lit un contenu figé, `ENVOYE` ferme la saisie, le webhook n'est qu'un signal. Trois à six lignes, au ton du fichier.

- [ ] **Step 2: Intégrations et environnement**

Dans `docs/integrations.md`, section Documenso (`grep -n -i documenso docs/integrations.md`) :
- version requise : **Documenso ≥ 2.0.0** ; API v2 (`/api/v2/envelope/*`) ;
- le webhook se configure dans Documenso avec l'URL `https://<outil>/api/webhooks/signature`, les événements `DOCUMENT_COMPLETED`, `DOCUMENT_REJECTED`, `DOCUMENT_CANCELLED`, et un **secret** égal à `SIGNATURE_WEBHOOK_SECRET` — Documenso le renvoie dans `X-Documenso-Secret` ;
- la signature embarquée n'exige aucune licence sur une instance sans facturation ; une instance avec Stripe doit porter le droit `embedSigning` ;
- `AUTH_URL` sert aussi à bâtir le lien envoyé au client.

Si `docs/integrations.md` est produit par `npm run doc:integrations` (le script existe), lancer la commande après modification des sources qu'il lit, et vérifier le diff.

Dans `.env.example` et `.env.docker.example`, au-dessus de `DOCUMENSO_URL` :

```bash
# Signature électronique — Documenso >= 2.0.0, auto-hébergé.
# Le client signe dans l'outil (cadre embarqué) ; Documenso n'écrit plus au client.
# Webhook à déclarer dans Documenso : <AUTH_URL>/api/webhooks/signature,
# avec un secret égal à SIGNATURE_WEBHOOK_SECRET (renvoyé dans X-Documenso-Secret).
```

- [ ] **Step 3: Vérification complète**

Run: `npx vitest run`
Expected: toute la suite verte.

Run: `npx tsc --noEmit`
Expected: 0 erreur.

Run: `npx next build`
Expected: succès. (Piège connu du dépôt : un fichier `'use server'` qui exporterait autre chose qu'une fonction asynchrone casse la construction sans que `tsc` ni les tests ne le voient — `src/app/v/[jeton]/actions.ts` et `src/app/(app)/cra/[craId]/actions.ts` n'exportent que des fonctions asynchrones.)

- [ ] **Step 4: Recette manuelle, à faire sur le serveur de production (le porteur l'a demandé)**

Consigner dans le message de PR, sans l'exécuter en local :
1. Documenso ≥ 2.0.0 ; webhook déclaré avec le secret ; `AUTH_URL` renseigné ; SMTP configuré.
2. Créer un client et une mission de test **hors Dolibarr**, signataire = une adresse du porteur, saisir deux jours, générer le CRA.
3. Envoyer → courriel reçu, lien `/v/…`, code reçu, CRA visible, aucun montant.
4. Refuser dans le cadre avec un motif → CRA `REFUSE`, saisie rouverte, deux courriels (consultant, client), historique « Envoi n° 1 · refusé ».
5. Corriger, « Renvoyer pour signature » → ancien lien « version plus récente », nouveau lien fonctionnel.
6. Signer → CRA `VALIDE`, deux courriels avec PDF signé joint, PDF téléchargeable depuis la page client et l'écran du CRA.
7. Sur une mission rattachée à Dolibarr : la signature met les temps en file comme une validation manuelle.

- [ ] **Step 5: Commit**

```bash
git add docs .env.example .env.docker.example README.md
git commit -m "docs(lot-3b): decision affinee, Documenso v2 et webhook, recette de production

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
