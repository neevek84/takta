# Lot 3 — Validation du CRA par le client · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire sortir le CRA de l'application et revenir signé, sans ressaisie et sans portail client — en **automatisant le franchissement** des transitions que la machine à états porte depuis le lot 0, jamais en l'étendant.

**Architecture:** Un écrivain PDF minimal écrit à la main dans `core/` (aucune dépendance), un modèle de document pur qui ne connaît **aucun montant**, un connecteur de signature derrière une interface et testé exclusivement contre un double, un webhook authentifié par signature de charge utile et rendu idempotent par une table d'événements, et deux voies de rattrapage — rafraîchissement à la demande, transition manuelle — qui restent ouvertes en permanence.

**Tech Stack:** Next.js 15 · TypeScript · Prisma 6 · SQLite en développement · Vitest

**Spec :** `docs/superpowers/specs/2026-08-15-lot-3-validation-client-design.md`

## Global Constraints

Tirées de `docs/superpowers/ETAT.md`.

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** Domaine pur.
- **Aucun enum Prisma, aucun décimal, aucun tableau, aucune requête fine sur du JSON.** Portabilité SQLite/Postgres. Le JSON se lit et s'écrit en bloc.
- **Entiers partout** : temps en minutes, jours en centièmes de jour, montants en centimes, durée d'une journée en minutes.
- **Toute fonction de service prend un `userId` et scope ses requêtes dessus** — sauf les travaux de fond, qui portent sur l'instance et le disent (voir tâche 13).
- **Aucune page ni action serveur n'interroge Prisma directement** en court-circuitant la couche service.
- **Un mois dont le CRA est `VALIDE` refuse toute écriture**, quelle que soit la voie qui l'a fait passer à `VALIDE`.
- **Aucun montant sur le CRA.** Le document atteste du temps, pas d'une somme.
- **« Cumuler les minutes, convertir une fois »**, mais uniquement **à facteur constant** : grouper par `minutesParJour`, convertir chaque groupe, sommer les centièmes.
- **Aucune information portée par la seule couleur.**
- Français pour les chaînes visibles, anglais pour le code et les messages de commit.
- `vitest.config.ts` est en `fileParallelism: false` — ne pas le modifier.
- Tests de composants : `// @vitest-environment happy-dom` en **première ligne**, `afterEach(cleanup)` explicite. `jsdom` ne fonctionne pas ici.
- **Ne jamais lancer plusieurs agents exécutant `vitest` en même temps.**
- **Aucune tâche n'exécute `npx next build`** : le serveur de développement du porteur du produit tourne sur cet arbre.
- **Jamais `git add -A`** tant que des agents travaillent : chemins explicites uniquement.
- `toLocaleString('fr-FR')` sépare les milliers par U+202F — le document n'en dépend pas, tout son formatage est fait à la main.

---

## Interfaces existantes

```ts
// src/core/cra/state-machine.ts
type CraTransition = 'ENVOYER' | 'VALIDER' | 'REFUSER' | 'ROUVRIR'
canTransition(from: CraStatus, t: CraTransition): boolean
applyTransition(from: CraStatus, t: CraTransition): CraStatus   // lève InvalidTransitionError
isLocked(status: CraStatus): boolean                            // VALIDE

// src/core/types.ts
type CraStatus = 'BROUILLON' | 'ENVOYE' | 'VALIDE' | 'REFUSE'
type TimeEntryKind = 'REALISE' | 'PREVISIONNEL'

// src/core/time/units.ts
minutesToCentiemes(minutes: number, minutesParJour: number): number

// src/services/cra.ts
interface CraView { id; missionId; missionLabel; clientName; month; status; invoiceNumber; invoicedAt; paidAt }
getOrCreateCra(userId, missionId, month): Promise<CraView>
transitionCra(userId, craId, t: CraTransition): Promise<CraView>
listCras(userId, month): Promise<CraView[]>

// src/services/missions.ts
interface MissionForUser { id; label; clientName; minutesParJourEffectif; minutesParJourSurcharge; lines }
listMissionsForUser(userId): Promise<MissionForUser[]>
createMission(args: { clientId; label; minutesParJour? }): Promise<{ id }>

// src/services/settings.ts
interface AppSettings { minutesParJour; capacityMode; capacityCentiemes; workingDays; slots;
                        holidays; defaultDisplayUnit; defaultEngagementSource;
                        objectifCaExerciceCents; debutExerciceMois }
getSettings(): Promise<AppSettings>
updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
validateSettingsPatch(patch: Partial<AppSettings>): { ok: true } | { ok: false; errors: string[] }

// src/services/time-entries.ts
interface MonthEntry { id; lineId; date; minutes; kind; slotId; minutesParJour }
saveEntry(args): Promise<SaveResult>   // { ok:false, reason:'VERROUILLE' } sur un mois validé

// src/auth.ts
requireUser(): Promise<{ id: string; role: Role }>

// prisma/schema.prisma
model ExternalLink { id, entityType, entityId, provider, externalId, syncedAt, syncState }
  @@unique([entityType, entityId, provider])  @@index([provider, externalId])
```

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/core/pdf/writer.ts` | Écrivain PDF minimal, sans dépendance, et relecture des textes |
| `src/core/cra/document.ts` | Modèle du document — **aucun montant, par construction** |
| `src/core/cra/layout.ts` | Mise en page A4, pagination, pavé de signature |
| `src/core/signature/connector.ts` | `SignatureConnector`, statuts, erreurs — le vrai livrable du lot |
| `src/core/signature/webhook.ts` | Signature de charge utile HMAC-SHA256, comparaison à temps constant |
| `prisma/schema.prisma` | *(modifié)* émetteur, signataire de mission, `SignatureRequest`, `SignatureWebhookEvent` |
| `src/services/cra-pdf.ts` | Génération et téléchargement (archive prioritaire sur regénération) |
| `src/services/signature/documenso.ts` | Première implémentation, testée contre un double |
| `src/services/signature/fake-connector.ts` | Le double, partagé par les tests des tâches 10 à 13 |
| `src/services/signature/registry.ts` | Résolution du connecteur, ou `null` — l'autoportance |
| `src/services/signature/send.ts` | Envoi, `ExternalLink`, transition `ENVOYER` |
| `src/services/signature/apply.ts` | Application d'un statut : transition, verrou, archivage |
| `src/services/signature/webhook.ts` | Réception : vérification, idempotence, dispatch |
| `src/services/signature/refresh.ts` | Rafraîchissement à la demande — le rattrapage |
| `src/services/signature/reminders.ts` | Relances, abandon |
| `src/app/(app)/cra/[craId]/pdf/route.ts` | Téléchargement |
| `src/app/api/webhooks/signature/route.ts` | Endpoint public, protégé par signature |
| `src/app/api/jobs/tick/route.ts` | Endpoint de traitement de fond, protégé par jeton |
| `src/app/(app)/cra/page.tsx`, `actions.ts` | *(modifiés)* envoi, téléchargement, rafraîchissement, souffrance |
| `src/app/(app)/missions/page.tsx`, `actions.ts` | *(modifiés)* signataire de la mission |
| `src/middleware.ts` | *(modifié)* sortie des endpoints publics du matcher |

**Dépendances entre tâches :** 1, 2, 4, 8, 9 sont indépendantes. 3 consomme 1 et 2. 5 consomme 2, 3, 4. 6 consomme 5. 7 consomme 4. 10 consomme 5, 7, 8. 11 consomme 8, 9, 10. 12 et 13 consomment 11. 14 consomme 6, 10, 12, 13.

**Parallélisation :** {1, 2, 4, 8, 9} en première vague, {3, 7} en deuxième, {5} puis {6, 10}, {11}, {12, 13}, {14}. Un seul processus `vitest` à la fois.

---

## Décisions tranchées dans ce plan

Elles complètent le § 11 de la spec, et sont à contester si elles ne conviennent pas.

| Décision | Raison |
|---|---|
| **Aucune dépendance npm pour le PDF** — un écrivain de 150 lignes dans `core/` | Un flux de contenu non compressé rend le test « aucun montant » vérifiable **sur les octets réellement produits**, pas sur un modèle intermédiaire. C'est ce qui donne sa force au test qui protège la frontière du produit. |
| **Le CRA n'imprime que le `REALISE`** | Un document qui atteste du temps passé ne peut pas contenir du temps prévu. |
| **Le total imprimé est la somme des cellules imprimées** | Un document dont le total ne se retrouve pas en additionnant ses lignes se fait contester. La convention « cumuler puis convertir » s'applique **à l'intérieur d'une cellule** (jour × ligne), à facteur constant. |
| **`SignatureConnector.send` prend un objet d'arguments, pas une entité `Cra`** | `core/` ne connaît pas Prisma. La spec décrit l'intention, pas la signature exacte. |
| **La clé d'idempotence est `{événement}:{identifiant du document}`** | Plus grossière que l'identifiant de livraison du prestataire, donc strictement plus sûre : deux livraisons du même événement sont un rejeu, quoi qu'en dise le prestataire. Un renvoi après refus crée un nouveau document, donc une nouvelle clé. |
| **Un webhook sans secret configuré est rejeté** | Un endpoint public qui verrouille un mois ne s'ouvre pas « par défaut ». |
| **`EXPIRE` ne change pas l'état du CRA** | L'expiration est un fait du prestataire, pas une décision du client. Le CRA reste `ENVOYE` et remonte en souffrance. |
| **Le travail de fond est `POST /api/jobs/tick`** | C'est le nom que le lot 4 donnera à son ordonnanceur. Le lot 3 crée l'endpoint avec un seul travail ; le lot 4 l'étend au lieu d'en inventer un second. |
| **`SignatureRequest` est unique par CRA** | Renvoyer un CRA remplace la demande précédente. Empiler les demandes obligerait chaque lecture à décider laquelle fait foi. |

---

## Task 1: Écrivain PDF minimal

**Files:** Create `src/core/pdf/writer.ts`, `src/core/pdf/writer.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `interface PdfText { x: number; y: number; size: number; text: string; bold?: boolean }`
  - `interface PdfLine { x1: number; y1: number; x2: number; y2: number; thickness?: number }`
  - `interface PdfPage { texts: PdfText[]; lines: PdfLine[] }`
  - `const A4_WIDTH_PT = 595` · `const A4_HEIGHT_PT = 842`
  - `renderPdf(pages: ReadonlyArray<PdfPage>): Uint8Array`
  - `extraireTextes(pdf: Uint8Array): string[]`
  - `toWinAnsi(text: string): number[]`
  - `largeurApprox(text: string, size: number): number`

**Pourquoi écrire un PDF à la main.** Toute bibliothèque compresse ses flux de contenu par défaut. Le test central de la spec — « aucun montant » — deviendrait alors un test sur un modèle intermédiaire, pas sur le document livré au client. Ici, `extraireTextes` relit **les octets rendus** et rend chaque chaîne réellement dessinée. Une mutation qui ajouterait un total en euros à la mise en page ferait tomber le test, ce qui est exactement ce qu'on lui demande.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/pdf/writer.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  renderPdf,
  extraireTextes,
  toWinAnsi,
  largeurApprox,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  type PdfPage,
} from './writer'

function texte(text: string): PdfPage {
  return { texts: [{ x: 40, y: 700, size: 10, text }], lines: [] }
}

function enLatin1(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString('latin1')
}

describe('renderPdf', () => {
  it('produit un fichier PDF reconnaissable', () => {
    const brut = enLatin1(renderPdf([texte('Bonjour')]))
    expect(brut.startsWith('%PDF-1.4\n')).toBe(true)
    expect(brut.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('déclare autant de pages qu on lui en donne', () => {
    expect(enLatin1(renderPdf([texte('a')]))).toContain('/Count 1')
    expect(enLatin1(renderPdf([texte('a'), texte('b')]))).toContain('/Count 2')
  })

  it('produit toujours au moins une page', () => {
    expect(enLatin1(renderPdf([]))).toContain('/Count 1')
  })

  it('donne à chaque page le format A4', () => {
    expect(enLatin1(renderPdf([texte('a')]))).toContain(
      `/MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}]`,
    )
  })

  it('place la table de références croisées là où le pied du fichier l annonce', () => {
    const pdf = renderPdf([texte('a'), texte('b')])
    const brut = enLatin1(pdf)
    const depart = /startxref\n(\d+)\n%%EOF/.exec(brut)
    expect(depart).not.toBeNull()
    expect(brut.slice(Number(depart![1]), Number(depart![1]) + 4)).toBe('xref')
  })

  it('fait pointer chaque entrée de la table sur son objet', () => {
    // Une seule mauvaise longueur d'objet décale toutes les entrées suivantes
    // et produit un fichier qu aucun lecteur n ouvre.
    const brut = enLatin1(renderPdf([texte('a'), texte('b')]))
    const entrees = [...brut.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(entrees.length).toBeGreaterThanOrEqual(8)
    entrees.forEach((offset, index) => {
      expect(brut.slice(offset).startsWith(`${index + 1} 0 obj\n`)).toBe(true)
    })
  })

  it('annonce la longueur exacte de chaque flux de contenu', () => {
    const brut = enLatin1(renderPdf([texte('Bonjour le monde')]))
    const m = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(brut)
    expect(m).not.toBeNull()
    expect(Buffer.byteLength(m![2]!, 'latin1')).toBe(Number(m![1]))
  })

  it('échappe les parenthèses et la barre oblique inverse', () => {
    const brut = enLatin1(renderPdf([texte('A (B) \\ C')]))
    expect(brut).toContain('(A \\(B\\) \\\\ C) Tj')
  })

  it('utilise la fonte grasse quand on la demande, la normale sinon', () => {
    const brut = enLatin1(
      renderPdf([
        {
          texts: [
            { x: 40, y: 700, size: 10, text: 'normal' },
            { x: 40, y: 680, size: 10, text: 'gras', bold: true },
          ],
          lines: [],
        },
      ]),
    )
    expect(brut).toContain('/F1 10 Tf')
    expect(brut).toContain('/F2 10 Tf')
    expect(brut).toContain('/BaseFont /Helvetica-Bold')
  })

  it('dessine les traits demandés', () => {
    const brut = enLatin1(
      renderPdf([{ texts: [], lines: [{ x1: 40, y1: 700, x2: 555, y2: 700, thickness: 0.8 }] }]),
    )
    expect(brut).toContain('0.8 w')
    expect(brut).toContain('40 700 m 555 700 l S')
  })
})

describe('toWinAnsi', () => {
  it('laisse les lettres accentuées sur leur octet latin-1', () => {
    expect(toWinAnsi('é')).toEqual([0xe9])
    expect(toWinAnsi('à')).toEqual([0xe0])
    expect(toWinAnsi('ç')).toEqual([0xe7])
  })

  it('mappe l apostrophe typographique, omniprésente dans les libellés français', () => {
    expect(toWinAnsi('’')).toEqual([0x92])
    expect(toWinAnsi('…')).toEqual([0x85])
    expect(toWinAnsi('—')).toEqual([0x97])
  })

  it('remplace ce qui ne se code pas plutôt que de produire un octet faux', () => {
    expect(toWinAnsi('☃')).toEqual([0x3f])
  })

  it('neutralise les caractères de contrôle', () => {
    expect(toWinAnsi('a\nb')).toEqual([0x61, 0x20, 0x62])
  })
})

describe('extraireTextes', () => {
  it('rend exactement les chaînes dessinées, dans l ordre', () => {
    const pdf = renderPdf([
      { texts: [{ x: 40, y: 700, size: 10, text: 'un' }], lines: [] },
      { texts: [{ x: 40, y: 700, size: 10, text: 'deux' }], lines: [] },
    ])
    expect(extraireTextes(pdf)).toEqual(['un', 'deux'])
  })

  it('reconstitue les caractères échappés et les accents', () => {
    const pdf = renderPdf([texte('Coût d’un (test) \\ é')])
    expect(extraireTextes(pdf)).toEqual(['Coût d’un (test) \\ é'])
  })

  it('ne rend rien pour un document sans texte', () => {
    expect(extraireTextes(renderPdf([{ texts: [], lines: [] }]))).toEqual([])
  })
})

describe('largeurApprox', () => {
  it('croît avec la longueur et avec le corps', () => {
    expect(largeurApprox('12', 10)).toBeLessThan(largeurApprox('1234', 10))
    expect(largeurApprox('12', 10)).toBeLessThan(largeurApprox('12', 14))
  })

  it('rend zéro pour une chaîne vide', () => {
    expect(largeurApprox('', 10)).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/pdf/writer.test.ts`
Expected: FAIL — `Failed to resolve import "./writer"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/pdf/writer.ts` :

```ts
/**
 * Un écrivain PDF 1.4 minimal : texte Helvetica et traits, **flux de contenu
 * non compressé**.
 *
 * L'absence de compression n'est pas une paresse : c'est ce qui permet à
 * `extraireTextes` de relire les octets réellement produits, et donc au test
 * « aucun montant sur le CRA » de porter sur le document livré au client
 * plutôt que sur un modèle intermédiaire.
 *
 * Module pur : aucune dépendance, aucun accès au système de fichiers.
 */

export const A4_WIDTH_PT = 595
export const A4_HEIGHT_PT = 842

export interface PdfText {
  /** points depuis le bord gauche */
  x: number
  /** points depuis le bord **bas** — l'origine PDF est en bas à gauche */
  y: number
  size: number
  text: string
  bold?: boolean
}

export interface PdfLine {
  x1: number
  y1: number
  x2: number
  y2: number
  thickness?: number
}

export interface PdfPage {
  texts: PdfText[]
  lines: PdfLine[]
}

/** Les points de code Unicode que WinAnsiEncoding loge dans 0x80–0x9F. */
const WIN_ANSI_HAUT: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

const WIN_ANSI_INVERSE = new Map<number, string>(
  Object.entries(WIN_ANSI_HAUT).map(([caractere, octet]) => [octet, caractere]),
)

/**
 * Encode une chaîne en WinAnsiEncoding. Ce qui ne s'y code pas devient `?` :
 * mieux vaut un point d'interrogation visible qu'un octet faux qui produirait
 * un caractère arbitraire dans un document signé.
 */
export function toWinAnsi(text: string): number[] {
  const octets: number[] = []
  for (const caractere of text) {
    const haut = WIN_ANSI_HAUT[caractere]
    if (haut !== undefined) {
      octets.push(haut)
      continue
    }
    const code = caractere.codePointAt(0) ?? 0x3f
    if (code >= 0x20 && code <= 0xff) octets.push(code)
    else octets.push(0x20 <= code ? 0x3f : 0x20)
  }
  return octets
}

function encoderChaine(text: string): Buffer {
  const octets: number[] = [0x28]
  for (const octet of toWinAnsi(text)) {
    if (octet === 0x28 || octet === 0x29 || octet === 0x5c) octets.push(0x5c)
    octets.push(octet)
  }
  octets.push(0x29)
  return Buffer.from(octets)
}

function nombre(valeur: number): string {
  const arrondi = Math.round(valeur * 100) / 100
  return String(arrondi)
}

/**
 * Largeur approchée d'une chaîne en Helvetica, en points.
 *
 * Les chiffres d'Helvetica font exactement 556/1000 d'em ; les lettres
 * tournent autour. C'est une approximation assumée : elle ne sert qu'à
 * aligner des nombres à droite dans une colonne, pas à composer du texte.
 */
export function largeurApprox(text: string, size: number): number {
  return text.length * size * 0.556
}

function fluxDeContenu(page: PdfPage): Buffer {
  const morceaux: Buffer[] = []

  for (const trait of page.lines) {
    morceaux.push(
      Buffer.from(
        `${nombre(trait.thickness ?? 0.5)} w\n` +
          `${nombre(trait.x1)} ${nombre(trait.y1)} m ` +
          `${nombre(trait.x2)} ${nombre(trait.y2)} l S\n`,
        'latin1',
      ),
    )
  }

  for (const texte of page.texts) {
    morceaux.push(
      Buffer.from(
        `BT /${texte.bold === true ? 'F2' : 'F1'} ${nombre(texte.size)} Tf ` +
          `${nombre(texte.x)} ${nombre(texte.y)} Td `,
        'latin1',
      ),
      encoderChaine(texte.text),
      Buffer.from(' Tj ET\n', 'latin1'),
    )
  }

  return Buffer.concat(morceaux)
}

const ENTETE = Buffer.concat([
  Buffer.from('%PDF-1.4\n', 'latin1'),
  // Commentaire binaire conventionnel : signale aux outils que le fichier
  // n'est pas du texte et ne doit pas subir de conversion de fin de ligne.
  Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
])

export function renderPdf(pages: ReadonlyArray<PdfPage>): Uint8Array {
  const utiles: ReadonlyArray<PdfPage> =
    pages.length === 0 ? [{ texts: [], lines: [] }] : pages

  // 1 catalogue, 2 arbre de pages, 3 et 4 les fontes, puis deux objets par
  // page : la page elle-même et son flux de contenu.
  const idPage = (index: number): number => 5 + index * 2
  const idContenu = (index: number): number => 6 + index * 2

  const objets: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from(
      `<< /Type /Pages /Kids [${utiles.map((_, i) => `${idPage(i)} 0 R`).join(' ')}]` +
        ` /Count ${utiles.length} >>`,
      'latin1',
    ),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
  ]

  utiles.forEach((page, index) => {
    const contenu = fluxDeContenu(page)
    objets.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}]` +
          ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>` +
          ` /Contents ${idContenu(index)} 0 R >>`,
        'latin1',
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${contenu.length} >>\nstream\n`, 'latin1'),
        contenu,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    )
  })

  const morceaux: Buffer[] = [ENTETE]
  let position = ENTETE.length
  const positions: number[] = []

  objets.forEach((corps, index) => {
    const ouverture = Buffer.from(`${index + 1} 0 obj\n`, 'latin1')
    const fermeture = Buffer.from('\nendobj\n', 'latin1')
    positions.push(position)
    morceaux.push(ouverture, corps, fermeture)
    position += ouverture.length + corps.length + fermeture.length
  })

  const departXref = position
  // Chaque entrée fait exactement 20 octets, fin de ligne comprise : la
  // spécification l'impose, et un lecteur strict refuse le fichier sinon.
  const entrees = [
    'xref',
    `0 ${objets.length + 1}`,
    '0000000000 65535 f ',
    ...positions.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
  ]
  morceaux.push(Buffer.from(`${entrees.join('\n')}\n`, 'latin1'))
  morceaux.push(
    Buffer.from(
      `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\n` +
        `startxref\n${departXref}\n%%EOF\n`,
      'latin1',
    ),
  )

  return new Uint8Array(Buffer.concat(morceaux))
}

/**
 * Relit un document produit par `renderPdf` et rend, dans l'ordre, chaque
 * chaîne qui y est dessinée.
 *
 * C'est l'instrument du test qui protège la frontière du produit : il regarde
 * ce que le client verra, pas ce que le code croit avoir composé.
 */
export function extraireTextes(pdf: Uint8Array): string[] {
  const brut = Buffer.from(pdf).toString('latin1')
  const motif = /\(((?:\\.|[^\\()])*)\) Tj/g
  const textes: string[] = []

  let trouve: RegExpExecArray | null = motif.exec(brut)
  while (trouve !== null) {
    const echappe = trouve[1] ?? ''
    const brutDeChaine = echappe.replace(/\\([\\()])/g, '$1')
    let reconstitue = ''
    for (let i = 0; i < brutDeChaine.length; i++) {
      const code = brutDeChaine.charCodeAt(i)
      reconstitue += WIN_ANSI_INVERSE.get(code) ?? String.fromCharCode(code)
    }
    textes.push(reconstitue)
    trouve = motif.exec(brut)
  }

  return textes
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/pdf/writer.test.ts`
Expected: PASS — 20 tests

- [ ] **Step 5: Vérifier qu'un lecteur réel ouvre le fichier**

Un PDF syntaxiquement plausible n'est pas un PDF valide. Ajouter **temporairement** à la fin de `src/core/pdf/writer.test.ts`, avec `import { writeFileSync } from 'node:fs'` en tête de fichier :

```ts
it('écrit un fichier ouvrable à la main', () => {
  const pdf = renderPdf([
    {
      texts: [
        { x: 40, y: 780, size: 15, text: 'Compte rendu d’activité', bold: true },
        { x: 40, y: 750, size: 10, text: 'Vérification manuelle — accents : é à ç ù' },
      ],
      lines: [{ x1: 40, y1: 740, x2: 555, y2: 740 }],
    },
  ])
  writeFileSync('/tmp/cra-verification.pdf', pdf)
  expect(pdf.length).toBeGreaterThan(300)
})
```

Run: `npx vitest run src/core/pdf/writer.test.ts && open /tmp/cra-verification.pdf`
Expected: le lecteur PDF du système affiche une page A4 portant le titre en gras, la ligne accentuée correctement rendue (`é à ç ù`, sans caractère de remplacement) et le filet horizontal.

**Puis retirer ce test et son import** : il écrit hors du dépôt et n'a pas sa place dans la suite.

- [ ] **Step 6: Vérifier par mutation**

Remplacer, dans le calcul de la table de références croisées, `positions.push(position)` par `positions.push(position + 1)`, et confirmer que « fait pointer chaque entrée de la table sur son objet » échoue. Restaurer.

Remplacer `Buffer.from(\`<< /Length ${contenu.length} >>...\`)` par `contenu.length - 1`, et confirmer que « annonce la longueur exacte de chaque flux de contenu » échoue. Restaurer.

- [ ] **Step 7: Commit**

```bash
git add src/core/pdf/
git commit -m "feat(core): dependency-free PDF writer with readable content streams"
```

---

## Task 2: Modèle de document du CRA

**Files:** Create `src/core/cra/document.ts`, `src/core/cra/document.test.ts`

**Interfaces:**
- Consumes: `minutesToCentiemes` de `src/core/time/units.ts`
- Produces:
  ```ts
  interface CraEmetteur { nom: string; adresse: string; siret: string; email: string }
  interface CraJour { /** 'YYYY-MM-DD' */ date: string; centiemes: number }
  interface CraLigne { label: string; jours: CraJour[]; totalCentiemes: number }
  interface CraDocument {
    emetteur: CraEmetteur
    clientNom: string
    missionLabel: string
    /** 'YYYY-MM' */ mois: string
    /** 'juin 2026' */ moisLibelle: string
    signataireNom: string
    signataireEmail: string
    lignes: CraLigne[]
    totalCentiemes: number
    /** toutes les dates du mois, 'YYYY-MM-DD' */ joursDuMois: string[]
  }
  interface CraDocumentInput {
    emetteur: CraEmetteur
    clientNom: string
    missionLabel: string
    mois: string
    signataireNom: string
    signataireEmail: string
    lignes: ReadonlyArray<{ id: string; label: string }>
    entries: ReadonlyArray<{ lineId: string; date: string; minutes: number
                             minutesParJour: number; kind: TimeEntryKind }>
  }
  buildCraDocument(input: CraDocumentInput): CraDocument
  formatJours(centiemes: number): string     // 100 -> '1,00'
  libelleMois(mois: string): string          // '2026-06' -> 'juin 2026'
  joursDuMois(mois: string): string[]
  libelleJour(date: string): string          // '2026-06-01' -> 'lun. 01'
  ```

**La frontière du produit vit ici.** `CraDocument` ne porte **aucun champ monétaire** — ni TJM, ni centimes, ni total en euros. Ce n'est pas une omission d'affichage : l'information n'entre jamais dans le modèle, donc aucune mise en page ne peut l'imprimer par accident.

**La règle d'arrondi.** « Cumuler les minutes, convertir une fois » s'applique **à l'intérieur d'une cellule** (une ligne, un jour), en groupant par facteur figé. Le total d'une ligne est ensuite la **somme des cellules imprimées** — pas une reconversion du cumul de minutes. Un document dont le total ne se retrouve pas en additionnant ses cases se fait contester par le client, et c'est le client qui a raison.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/cra/document.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  buildCraDocument,
  formatJours,
  libelleMois,
  libelleJour,
  joursDuMois,
  type CraDocumentInput,
} from './document'

const EMETTEUR = {
  nom: 'KREATIV PROJECT MANAGEMENT',
  adresse: '1 rue des Tests, 75000 Paris',
  siret: '000 000 000 00000',
  email: 'contact@exemple.test',
}

function saisie(
  lineId: string,
  date: string,
  minutes: number,
  extra: { minutesParJour?: number; kind?: 'REALISE' | 'PREVISIONNEL' } = {},
) {
  return {
    lineId,
    date,
    minutes,
    minutesParJour: extra.minutesParJour ?? 480,
    kind: extra.kind ?? ('REALISE' as const),
  }
}

function entree(partiel: Partial<CraDocumentInput> = {}): CraDocumentInput {
  return {
    emetteur: EMETTEUR,
    clientNom: 'ACME',
    missionLabel: 'Consultant ITSM',
    mois: '2026-06',
    signataireNom: 'Claire Martin',
    signataireEmail: 'claire.martin@acme.test',
    lignes: [{ id: 'l1', label: 'Consultant ITSM 30j' }],
    entries: [saisie('l1', '2026-06-01', 480)],
    ...partiel,
  }
}

describe('buildCraDocument', () => {
  it('reprend l entête, le client, la mission et le mois', () => {
    const doc = buildCraDocument(entree())
    expect(doc.emetteur.nom).toBe('KREATIV PROJECT MANAGEMENT')
    expect(doc.clientNom).toBe('ACME')
    expect(doc.missionLabel).toBe('Consultant ITSM')
    expect(doc.mois).toBe('2026-06')
    expect(doc.moisLibelle).toBe('juin 2026')
    expect(doc.signataireNom).toBe('Claire Martin')
  })

  it('détaille chaque ligne de prestation jour par jour', () => {
    const doc = buildCraDocument(
      entree({
        lignes: [
          { id: 'l1', label: 'Jour' },
          { id: 'l2', label: 'Nuit' },
        ],
        entries: [
          saisie('l1', '2026-06-01', 480),
          saisie('l1', '2026-06-02', 240),
          saisie('l2', '2026-06-02', 480),
        ],
      }),
    )

    expect(doc.lignes.map((l) => l.label)).toEqual(['Jour', 'Nuit'])
    expect(doc.lignes[0]!.jours).toEqual([
      { date: '2026-06-01', centiemes: 100 },
      { date: '2026-06-02', centiemes: 50 },
    ])
    expect(doc.lignes[1]!.jours).toEqual([{ date: '2026-06-02', centiemes: 100 }])
  })

  it('n imprime que le réalisé — un document qui atteste ne contient pas du prévu', () => {
    const doc = buildCraDocument(
      entree({
        entries: [
          saisie('l1', '2026-06-01', 480),
          saisie('l1', '2026-06-02', 480, { kind: 'PREVISIONNEL' }),
        ],
      }),
    )
    expect(doc.lignes[0]!.jours).toEqual([{ date: '2026-06-01', centiemes: 100 }])
    expect(doc.totalCentiemes).toBe(100)
  })

  it('cumule les créneaux d un même jour avant de convertir', () => {
    // Deux demi-journées de 60 min à 480 : converties séparément, 13 + 13 = 26.
    // Cumulées puis converties, 120/480 = 25. C est 25 qui doit figurer.
    const doc = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 60), saisie('l1', '2026-06-01', 60)] }),
    )
    expect(doc.lignes[0]!.jours).toEqual([{ date: '2026-06-01', centiemes: 25 }])
  })

  it('ne cumule jamais des minutes de facteurs différents', () => {
    // 420 min à 420/jour et 480 min à 480/jour : deux journées pleines.
    // Un cumul aveugle donnerait 900/480 = 188 au lieu de 200.
    const doc = buildCraDocument(
      entree({
        entries: [
          saisie('l1', '2026-06-01', 420, { minutesParJour: 420 }),
          saisie('l1', '2026-06-01', 480, { minutesParJour: 480 }),
        ],
      }),
    )
    expect(doc.lignes[0]!.jours).toEqual([{ date: '2026-06-01', centiemes: 200 }])
  })

  it('fait du total d une ligne la somme exacte des cellules imprimées', () => {
    const doc = buildCraDocument(
      entree({
        entries: [
          saisie('l1', '2026-06-01', 60),
          saisie('l1', '2026-06-02', 60),
          saisie('l1', '2026-06-03', 60),
        ],
      }),
    )
    const cellules = doc.lignes[0]!.jours.map((j) => j.centiemes)
    expect(cellules).toEqual([13, 13, 13])
    expect(doc.lignes[0]!.totalCentiemes).toBe(39)
  })

  it('fait du total général la somme des totaux de ligne', () => {
    const doc = buildCraDocument(
      entree({
        lignes: [
          { id: 'l1', label: 'Jour' },
          { id: 'l2', label: 'Nuit' },
        ],
        entries: [saisie('l1', '2026-06-01', 480), saisie('l2', '2026-06-02', 240)],
      }),
    )
    expect(doc.totalCentiemes).toBe(150)
  })

  it('écarte les lignes sans aucune saisie sur le mois', () => {
    const doc = buildCraDocument(
      entree({
        lignes: [
          { id: 'l1', label: 'Jour' },
          { id: 'l2', label: 'Jamais servie' },
        ],
        entries: [saisie('l1', '2026-06-01', 480)],
      }),
    )
    expect(doc.lignes.map((l) => l.label)).toEqual(['Jour'])
  })

  it('ignore une saisie hors du mois du document', () => {
    const doc = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 480), saisie('l1', '2026-07-01', 480)] }),
    )
    expect(doc.totalCentiemes).toBe(100)
  })

  it('ignore une saisie dont la ligne n appartient pas à la mission', () => {
    const doc = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 480), saisie('inconnue', '2026-06-02', 480)] }),
    )
    expect(doc.totalCentiemes).toBe(100)
  })

  it('produit un document vide mais complet quand rien n a été saisi', () => {
    const doc = buildCraDocument(entree({ entries: [] }))
    expect(doc.lignes).toEqual([])
    expect(doc.totalCentiemes).toBe(0)
    expect(doc.joursDuMois).toHaveLength(30)
  })

  it('ne porte aucun montant, par construction', () => {
    // Le test qui protège la frontière du produit, au niveau du modèle.
    // Le même contrôle est refait sur les octets du PDF à la tâche 5.
    const doc = buildCraDocument(entree())
    const serialise = JSON.stringify(doc).toLowerCase()
    for (const interdit of ['€', 'eur', 'tjm', 'cent', 'montant', 'prix', 'facture', 'ht']) {
      expect(serialise).not.toContain(interdit)
    }
  })
})

describe('joursDuMois', () => {
  it('couvre le mois entier', () => {
    expect(joursDuMois('2026-06')).toHaveLength(30)
    expect(joursDuMois('2026-07')).toHaveLength(31)
    expect(joursDuMois('2026-02')).toHaveLength(28)
    expect(joursDuMois('2028-02')).toHaveLength(29)
  })

  it('rend des dates ISO ordonnées', () => {
    const jours = joursDuMois('2026-06')
    expect(jours[0]).toBe('2026-06-01')
    expect(jours[29]).toBe('2026-06-30')
  })
})

describe('formatJours', () => {
  it('rend des centièmes en jours, virgule française, deux décimales', () => {
    expect(formatJours(100)).toBe('1,00')
    expect(formatJours(50)).toBe('0,50')
    expect(formatJours(2000)).toBe('20,00')
    expect(formatJours(13)).toBe('0,13')
  })

  it('ne sépare pas les milliers — l espace fine insécable n a rien à faire dans un PDF', () => {
    expect(formatJours(123456)).toBe('1234,56')
  })
})

describe('libelleMois', () => {
  it('nomme le mois en français', () => {
    expect(libelleMois('2026-01')).toBe('janvier 2026')
    expect(libelleMois('2026-06')).toBe('juin 2026')
    expect(libelleMois('2026-12')).toBe('décembre 2026')
  })
})

describe('libelleJour', () => {
  it('donne le jour de la semaine et le quantième', () => {
    expect(libelleJour('2026-06-01')).toBe('lun. 01')
    expect(libelleJour('2026-06-06')).toBe('sam. 06')
    expect(libelleJour('2026-06-07')).toBe('dim. 07')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/cra/document.test.ts`
Expected: FAIL — `Failed to resolve import "./document"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/cra/document.ts` :

```ts
import type { TimeEntryKind } from '../types'
import { minutesToCentiemes } from '../time/units'

export interface CraEmetteur {
  nom: string
  adresse: string
  siret: string
  email: string
}

export interface CraJour {
  /** 'YYYY-MM-DD' */
  date: string
  centiemes: number
}

export interface CraLigne {
  label: string
  /** uniquement les jours servis, dans l'ordre chronologique */
  jours: CraJour[]
  /** somme exacte des cellules ci-dessus */
  totalCentiemes: number
}

/**
 * Le document tel qu'il sera imprimé.
 *
 * **Aucun champ monétaire, et ce n'est pas négociable.** Le CRA atteste du
 * temps passé, pas d'une somme due. Un total en euros en ferait une
 * pré-facture, et ferait rentrer par la fenêtre la facturation qu'on a sortie
 * par la porte. L'information n'entre pas dans ce type : aucune mise en page
 * ne peut donc l'imprimer par accident.
 */
export interface CraDocument {
  emetteur: CraEmetteur
  clientNom: string
  missionLabel: string
  /** 'YYYY-MM' */
  mois: string
  /** 'juin 2026' */
  moisLibelle: string
  signataireNom: string
  signataireEmail: string
  lignes: CraLigne[]
  totalCentiemes: number
  /** toutes les dates du mois, servies ou non — c'est l'axe du tableau */
  joursDuMois: string[]
}

export interface CraDocumentInput {
  emetteur: CraEmetteur
  clientNom: string
  missionLabel: string
  /** 'YYYY-MM' */
  mois: string
  signataireNom: string
  signataireEmail: string
  /** les prestations de la mission, dans l'ordre d'affichage voulu */
  lignes: ReadonlyArray<{ id: string; label: string }>
  entries: ReadonlyArray<{
    lineId: string
    /** 'YYYY-MM-DD' */
    date: string
    minutes: number
    /** facteur figé à l'écriture de la saisie */
    minutesParJour: number
    kind: TimeEntryKind
  }>
}

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

export function libelleMois(mois: string): string {
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  return `${MOIS[numero - 1]} ${annee}`
}

export function joursDuMois(mois: string): string[] {
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  // Le jour 0 du mois suivant est le dernier jour de celui-ci.
  const dernier = new Date(Date.UTC(annee, numero, 0)).getUTCDate()
  return Array.from(
    { length: dernier },
    (_, i) => `${mois}-${String(i + 1).padStart(2, '0')}`,
  )
}

/** Tout est calculé en UTC : le document ne doit pas changer selon le fuseau du serveur. */
export function libelleJour(date: string): string {
  const jour = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return `${JOURS[jour]} ${date.slice(8, 10)}`
}

/** Centièmes de jour vers une quantité française à deux décimales, sans séparateur de milliers. */
export function formatJours(centiemes: number): string {
  return (centiemes / 100).toFixed(2).replace('.', ',')
}

/**
 * Cumul des minutes d'une cellule, ventilé par facteur figé, puis converti
 * groupe par groupe : « cumuler les minutes, convertir une fois » ne vaut
 * qu'à facteur constant.
 */
function centiemesDeLaCellule(parFacteur: Map<number, number>): number {
  let centiemes = 0
  for (const [facteur, minutes] of parFacteur) {
    centiemes += minutesToCentiemes(minutes, facteur)
  }
  return centiemes
}

export function buildCraDocument(input: CraDocumentInput): CraDocument {
  const idsConnus = new Set(input.lignes.map((l) => l.id))

  // (ligne, jour) -> (facteur -> minutes)
  const cellules = new Map<string, Map<number, number>>()

  for (const saisie of input.entries) {
    if (saisie.kind !== 'REALISE') continue
    if (!idsConnus.has(saisie.lineId)) continue
    if (saisie.date.slice(0, 7) !== input.mois) continue

    const cle = `${saisie.lineId}|${saisie.date}`
    const parFacteur = cellules.get(cle) ?? new Map<number, number>()
    parFacteur.set(saisie.minutesParJour, (parFacteur.get(saisie.minutesParJour) ?? 0) + saisie.minutes)
    cellules.set(cle, parFacteur)
  }

  const dates = joursDuMois(input.mois)
  const lignes: CraLigne[] = []

  for (const ligne of input.lignes) {
    const jours: CraJour[] = []
    let total = 0

    for (const date of dates) {
      const parFacteur = cellules.get(`${ligne.id}|${date}`)
      if (parFacteur === undefined) continue
      const centiemes = centiemesDeLaCellule(parFacteur)
      if (centiemes === 0) continue
      jours.push({ date, centiemes })
      // Le total est la somme des cellules **imprimées**, jamais une
      // reconversion : sinon le client additionne les cases du tableau et
      // trouve autre chose que le total, ce qui suffit à faire contester le
      // document.
      total += centiemes
    }

    if (jours.length === 0) continue
    lignes.push({ label: ligne.label, jours, totalCentiemes: total })
  }

  return {
    emetteur: input.emetteur,
    clientNom: input.clientNom,
    missionLabel: input.missionLabel,
    mois: input.mois,
    moisLibelle: libelleMois(input.mois),
    signataireNom: input.signataireNom,
    signataireEmail: input.signataireEmail,
    lignes,
    totalCentiemes: lignes.reduce((somme, l) => somme + l.totalCentiemes, 0),
    joursDuMois: dates,
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/cra/document.test.ts`
Expected: PASS — 21 tests

- [ ] **Step 5: Vérifier par mutation**

Dans `centiemesDeLaCellule`, remplacer le regroupement par une conversion à facteur unique (`minutesToCentiemes(total, 480)`), et confirmer que « ne cumule jamais des minutes de facteurs différents » échoue. Restaurer.

Remplacer `total += centiemes` par une reconversion du cumul de minutes, et confirmer que « fait du total d une ligne la somme exacte des cellules imprimées » échoue (39 attendu, 38 obtenu). Restaurer.

- [ ] **Step 6: Commit**

```bash
git add src/core/cra/document.ts src/core/cra/document.test.ts
git commit -m "feat(core): CRA document model, amount-free by construction"
```

---

## Task 3: Mise en page du CRA

**Files:** Create `src/core/cra/layout.ts`, `src/core/cra/layout.test.ts`

**Interfaces:**
- Consumes: `PdfPage`, `PdfText`, `PdfLine`, `largeurApprox`, `A4_WIDTH_PT`, `A4_HEIGHT_PT` (tâche 1) ; `CraDocument`, `formatJours`, `libelleJour` (tâche 2)
- Produces:
  - `const LIGNES_PAR_PAGE = 5`
  - `const MARGE = 40`
  - `layoutCraDocument(doc: CraDocument): PdfPage[]`

**Pagination.** Les jours tiennent toujours sur une page — 31 lignes de 15,5 pt. Ce sont les **colonnes** qui débordent : au-delà de cinq prestations, une page supplémentaire reprend l'entête et la colonne des jours. Le pavé de signature ne figure que sur la dernière page : un document qu'on peut signer deux fois est un document qui sera signé deux fois.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/cra/layout.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { buildCraDocument, formatJours, type CraDocument } from './document'
import { layoutCraDocument, LIGNES_PAR_PAGE, MARGE } from './layout'
import { A4_WIDTH_PT, A4_HEIGHT_PT } from '../pdf/writer'

function document(nbLignes: number, joursParLigne = 2): CraDocument {
  const lignes = Array.from({ length: nbLignes }, (_, i) => ({
    id: `l${i}`,
    label: `Prestation ${i + 1}`,
  }))
  const entries = lignes.flatMap((l) =>
    Array.from({ length: joursParLigne }, (_, j) => ({
      lineId: l.id,
      date: `2026-06-${String(j + 1).padStart(2, '0')}`,
      minutes: 480,
      minutesParJour: 480,
      kind: 'REALISE' as const,
    })),
  )

  return buildCraDocument({
    emetteur: {
      nom: 'KREATIV PROJECT MANAGEMENT',
      adresse: '1 rue des Tests, 75000 Paris',
      siret: '000 000 000 00000',
      email: 'contact@exemple.test',
    },
    clientNom: 'ACME',
    missionLabel: 'Consultant ITSM',
    mois: '2026-06',
    signataireNom: 'Claire Martin',
    signataireEmail: 'claire.martin@acme.test',
    lignes,
    entries,
  })
}

function textes(pages: ReturnType<typeof layoutCraDocument>): string[] {
  return pages.flatMap((p) => p.texts.map((t) => t.text))
}

describe('layoutCraDocument', () => {
  it('tient sur une page tant que les prestations tiennent en colonnes', () => {
    expect(layoutCraDocument(document(1))).toHaveLength(1)
    expect(layoutCraDocument(document(LIGNES_PAR_PAGE))).toHaveLength(1)
  })

  it('ouvre une page par paquet de colonnes supplémentaire', () => {
    expect(layoutCraDocument(document(LIGNES_PAR_PAGE + 1))).toHaveLength(2)
    expect(layoutCraDocument(document(LIGNES_PAR_PAGE * 2 + 1))).toHaveLength(3)
  })

  it('produit une page même sans aucune prestation servie', () => {
    const pages = layoutCraDocument(document(0))
    expect(pages).toHaveLength(1)
    expect(textes(pages).join(' ')).toContain('Aucun temps réalisé')
  })

  it('reprend le client, la mission et le mois sur chaque page', () => {
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    for (const page of pages) {
      const contenu = page.texts.map((t) => t.text).join(' | ')
      expect(contenu).toContain('ACME')
      expect(contenu).toContain('Consultant ITSM')
      expect(contenu).toContain('juin 2026')
    }
  })

  it('reprend la colonne des jours sur chaque page', () => {
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    for (const page of pages) {
      const contenu = page.texts.map((t) => t.text)
      expect(contenu).toContain('lun. 01')
      expect(contenu).toContain('mar. 30')
    }
  })

  it('numérote les pages', () => {
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    expect(textes([pages[0]!])).toContain('Page 1 / 2')
    expect(textes([pages[1]!])).toContain('Page 2 / 2')
  })

  it('ne pose le pavé de signature que sur la dernière page', () => {
    const pages = layoutCraDocument(document(LIGNES_PAR_PAGE + 1))
    const mention = (page: (typeof pages)[number]): boolean =>
      page.texts.some((t) => t.text.includes('Bon pour accord'))
    expect(mention(pages[0]!)).toBe(false)
    expect(mention(pages[1]!)).toBe(true)
  })

  it('nomme le signataire dans le pavé de signature', () => {
    const contenu = textes(layoutCraDocument(document(1))).join(' | ')
    expect(contenu).toContain('Claire Martin')
    expect(contenu).toContain('claire.martin@acme.test')
  })

  it('imprime le détail par ligne et par jour', () => {
    const pages = layoutCraDocument(document(2, 3))
    const contenu = textes(pages)
    expect(contenu).toContain('Prestation 1')
    expect(contenu).toContain('Prestation 2')
    // Trois journées pleines par prestation.
    expect(contenu.filter((t) => t === formatJours(100))).toHaveLength(6)
  })

  it('imprime le total de chaque colonne et le total du mois', () => {
    const contenu = textes(layoutCraDocument(document(2, 3))).join(' | ')
    expect(contenu).toContain('Total du mois')
    // 3 jours par prestation, deux prestations.
    expect(contenu).toContain(formatJours(300))
    expect(contenu).toContain(formatJours(600))
  })

  it('rappelle sur chaque page que le document ne porte aucun montant', () => {
    for (const page of layoutCraDocument(document(LIGNES_PAR_PAGE + 1))) {
      expect(page.texts.map((t) => t.text).join(' ')).toContain('aucun montant')
    }
  })

  it('n imprime jamais de montant', () => {
    const contenu = textes(layoutCraDocument(document(3, 4))).join(' ').toLowerCase()
    for (const interdit of ['€', 'eur', 'tjm', 'total ht', 'montant dû']) {
      expect(contenu).not.toContain(interdit)
    }
  })

  it('tient dans les marges de la page', () => {
    for (const page of layoutCraDocument(document(LIGNES_PAR_PAGE * 2 + 1, 31))) {
      for (const t of page.texts) {
        expect(t.x).toBeGreaterThanOrEqual(MARGE - 1)
        expect(t.x).toBeLessThanOrEqual(A4_WIDTH_PT - MARGE)
        expect(t.y).toBeGreaterThanOrEqual(25)
        expect(t.y).toBeLessThanOrEqual(A4_HEIGHT_PT - MARGE)
      }
      for (const l of page.lines) {
        expect(Math.min(l.x1, l.x2)).toBeGreaterThanOrEqual(MARGE - 1)
        expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(A4_WIDTH_PT - MARGE)
      }
    }
  })

  it('aligne les quantités à droite de leur colonne', () => {
    const page = layoutCraDocument(document(1, 1))[0]!
    const cellule = page.texts.find((t) => t.text === formatJours(100))
    const enTete = page.texts.find((t) => t.text === 'Prestation 1')
    expect(cellule).toBeDefined()
    expect(enTete).toBeDefined()
    expect(cellule!.x).toBeGreaterThan(enTete!.x)
  })

  it('tronque un libellé de prestation trop long plutôt que de déborder', () => {
    const doc = document(1)
    doc.lignes[0]!.label = 'Consultant ITSM senior sur le périmètre production étendu'
    const contenu = textes(layoutCraDocument(doc))
    expect(contenu.some((t) => t.startsWith('Consultant ITSM') && t.endsWith('…'))).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/cra/layout.test.ts`
Expected: FAIL — `Failed to resolve import "./layout"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/cra/layout.ts` :

```ts
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  largeurApprox,
  type PdfLine,
  type PdfPage,
  type PdfText,
} from '../pdf/writer'
import { formatJours, libelleJour, type CraDocument } from './document'

export const MARGE = 40
/** Au-delà, les colonnes ne tiennent plus en largeur : on ouvre une page. */
export const LIGNES_PAR_PAGE = 5

const DROITE = A4_WIDTH_PT - MARGE // 555
const COLONNE_JOUR_X = MARGE
const COLONNE_JOUR_LARGEUR = 92
const COLONNE_X0 = MARGE + 100 // 140
const COLONNE_LARGEUR = 83

const Y_TITRE = A4_HEIGHT_PT - MARGE - 10 // 792
const Y_ENTETE = 770
const Y_FILET_ENTETE = 724
const Y_ENTETE_TABLE = 706
const Y_FILET_TABLE = 700
const Y_PREMIERE_LIGNE = 686
const PAS_LIGNE = 15.5
const Y_PIED = 32

function colonneX(index: number): number {
  return COLONNE_X0 + index * COLONNE_LARGEUR
}

/** Aligne une quantité sur le bord droit de sa colonne. */
function aDroite(texte: string, xColonne: number, size: number): number {
  return xColonne + COLONNE_LARGEUR - 6 - largeurApprox(texte, size)
}

function tronquer(texte: string, largeurMax: number, size: number): string {
  if (largeurApprox(texte, size) <= largeurMax) return texte
  let coupe = texte
  while (coupe.length > 1 && largeurApprox(`${coupe}…`, size) > largeurMax) {
    coupe = coupe.slice(0, -1)
  }
  return `${coupe.trimEnd()}…`
}

export function layoutCraDocument(doc: CraDocument): PdfPage[] {
  const paquets: CraDocument['lignes'][] = []
  for (let i = 0; i < doc.lignes.length; i += LIGNES_PAR_PAGE) {
    paquets.push(doc.lignes.slice(i, i + LIGNES_PAR_PAGE))
  }
  if (paquets.length === 0) paquets.push([])

  return paquets.map((paquet, index) =>
    composerPage(doc, paquet, index + 1, paquets.length, index === paquets.length - 1),
  )
}

function composerPage(
  doc: CraDocument,
  lignes: CraDocument['lignes'],
  numero: number,
  total: number,
  derniere: boolean,
): PdfPage {
  const texts: PdfText[] = []
  const lines: PdfLine[] = []

  // --- Entête -------------------------------------------------------------
  texts.push({ x: MARGE, y: Y_TITRE, size: 15, text: 'Compte rendu d’activité', bold: true })

  texts.push({ x: MARGE, y: Y_ENTETE, size: 10, text: doc.emetteur.nom, bold: true })
  ;[doc.emetteur.adresse, doc.emetteur.siret, doc.emetteur.email].forEach((valeur, i) => {
    if (valeur === '') return
    texts.push({ x: MARGE, y: Y_ENTETE - 12 - i * 11, size: 8.5, text: valeur })
  })

  const xDroite = 330
  texts.push({ x: xDroite, y: Y_ENTETE, size: 10, text: `Client : ${doc.clientNom}`, bold: true })
  texts.push({ x: xDroite, y: Y_ENTETE - 12, size: 8.5, text: `Mission : ${doc.missionLabel}` })
  texts.push({ x: xDroite, y: Y_ENTETE - 23, size: 8.5, text: `Période : ${doc.moisLibelle}` })

  lines.push({ x1: MARGE, y1: Y_FILET_ENTETE, x2: DROITE, y2: Y_FILET_ENTETE, thickness: 0.8 })

  // --- Entête du tableau ---------------------------------------------------
  texts.push({ x: COLONNE_JOUR_X, y: Y_ENTETE_TABLE, size: 8.5, text: 'Jour', bold: true })
  lignes.forEach((ligne, i) => {
    texts.push({
      x: colonneX(i) + 2,
      y: Y_ENTETE_TABLE,
      size: 8.5,
      text: tronquer(ligne.label, COLONNE_LARGEUR - 8, 8.5),
      bold: true,
    })
  })
  lines.push({ x1: MARGE, y1: Y_FILET_TABLE, x2: DROITE, y2: Y_FILET_TABLE, thickness: 0.5 })

  // --- Corps ---------------------------------------------------------------
  const parLigneEtJour = lignes.map(
    (ligne) => new Map(ligne.jours.map((j) => [j.date, j.centiemes])),
  )

  doc.joursDuMois.forEach((date, rang) => {
    const y = Y_PREMIERE_LIGNE - rang * PAS_LIGNE
    texts.push({ x: COLONNE_JOUR_X, y, size: 8, text: libelleJour(date) })

    parLigneEtJour.forEach((cellules, i) => {
      const centiemes = cellules.get(date)
      if (centiemes === undefined) return
      const valeur = formatJours(centiemes)
      texts.push({ x: aDroite(valeur, colonneX(i), 8), y, size: 8, text: valeur })
    })
  })

  const yFiletTotaux = Y_PREMIERE_LIGNE - doc.joursDuMois.length * PAS_LIGNE + 6
  lines.push({ x1: MARGE, y1: yFiletTotaux, x2: DROITE, y2: yFiletTotaux, thickness: 0.8 })

  const yTotaux = yFiletTotaux - 12
  texts.push({ x: COLONNE_JOUR_X, y: yTotaux, size: 8.5, text: 'Total', bold: true })
  lignes.forEach((ligne, i) => {
    const valeur = formatJours(ligne.totalCentiemes)
    texts.push({ x: aDroite(valeur, colonneX(i), 8.5), y: yTotaux, size: 8.5, text: valeur, bold: true })
  })

  if (lignes.length === 0) {
    texts.push({
      x: COLONNE_X0,
      y: Y_PREMIERE_LIGNE,
      size: 9,
      text: 'Aucun temps réalisé n’a été saisi sur ce mois.',
    })
  }

  // --- Pavé de signature, dernière page seulement ---------------------------
  if (derniere) {
    const yMention = yTotaux - 22
    texts.push({
      x: MARGE,
      y: yMention,
      size: 9,
      text: `Total du mois : ${formatJours(doc.totalCentiemes)} jour(s)`,
      bold: true,
    })
    texts.push({ x: MARGE, y: yMention - 26, size: 9, text: 'Bon pour accord — validation du client', bold: true })
    texts.push({
      x: MARGE,
      y: yMention - 39,
      size: 8.5,
      text: `Signataire : ${doc.signataireNom}${doc.signataireEmail === '' ? '' : ` (${doc.signataireEmail})`}`,
    })
    texts.push({ x: MARGE, y: yMention - 51, size: 8.5, text: 'Date et signature :' })

    const cadreHaut = yMention - 20
    const cadreBas = Math.max(Y_PIED + 18, cadreHaut - 72)
    const cadreGauche = 330
    lines.push(
      { x1: cadreGauche, y1: cadreHaut, x2: DROITE, y2: cadreHaut, thickness: 0.5 },
      { x1: cadreGauche, y1: cadreBas, x2: DROITE, y2: cadreBas, thickness: 0.5 },
      { x1: cadreGauche, y1: cadreBas, x2: cadreGauche, y2: cadreHaut, thickness: 0.5 },
      { x1: DROITE, y1: cadreBas, x2: DROITE, y2: cadreHaut, thickness: 0.5 },
    )
  }

  // --- Pied de page --------------------------------------------------------
  texts.push({
    x: MARGE,
    y: Y_PIED,
    size: 7.5,
    text: 'Document attestant du temps passé — aucun montant n’y figure.',
  })
  const pagination = `Page ${numero} / ${total}`
  texts.push({
    x: DROITE - largeurApprox(pagination, 7.5),
    y: Y_PIED,
    size: 7.5,
    text: pagination,
  })

  return { texts, lines }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/cra/layout.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer `index === paquets.length - 1` par `true` et confirmer que « ne pose le pavé de signature que sur la dernière page » échoue. Restaurer.

Remplacer `tronquer(ligne.label, …)` par `ligne.label` et confirmer que le test de troncature échoue. Restaurer.

- [ ] **Step 6: Vérifier la suite et le typage**

Run: `npx vitest run src/core && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add src/core/cra/layout.ts src/core/cra/layout.test.ts
git commit -m "feat(core): A4 layout for the CRA document, paginated by service line"
```

---

## Task 4: Schéma — émetteur, signataire, demande de signature, événements

**Files:** Modify `prisma/schema.prisma`. Create `src/db/signature-schema.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `Settings.emetteurNom/emetteurAdresse/emetteurSiret/emetteurEmail String @default("")`, `Settings.relanceJours Int @default(7)`
  - `Mission.signataireNom/signataireEmail String @default("")`
  - `model SignatureRequest { id, craId @unique, provider, status, signataireNom, signataireEmail, sentAt, relances, lastRelanceAt, completedAt, abandoned, signedPdf Bytes?, updatedAt }`
  - `model SignatureWebhookEvent { id, provider, eventId, receivedAt }` avec `@@unique([provider, eventId])`

**Portabilité.** `Bytes` se traduit en `BLOB` sur SQLite et `bytea` sur Postgres — aucun type propriétaire, aucun tableau, aucun décimal. Le PDF signé vit en base plutôt que sur le disque : c'est ce qui permet au lot 5 de transporter une instance complète en copiant un seul fichier.

- [ ] **Step 1: Écrire le test qui échoue**

`src/db/signature-schema.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './client'

let userId = ''
let missionId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'sig-schema@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await prisma.client.create({ data: { name: 'SIG SCHEMA client' } })
  const m = await prisma.mission.create({ data: { clientId: c.id, label: 'SIG SCHEMA mission' } })
  missionId = m.id
  const cra = await prisma.cra.create({
    data: { missionId, userId, month: new Date('2026-06-01T00:00:00.000Z') },
  })
  craId = cra.id
})

afterAll(async () => {
  await prisma.signatureWebhookEvent.deleteMany({ where: { provider: 'test' } })
  await prisma.user.deleteMany({ where: { email: 'sig-schema@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'SIG SCHEMA client' } })
  await prisma.$disconnect()
})

describe('signataire de la mission', () => {
  it('est vide par défaut — rien n est signable tant que rien n est saisi', async () => {
    const m = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })
    expect(m.signataireNom).toBe('')
    expect(m.signataireEmail).toBe('')
  })

  it('se renseigne au niveau de la mission, pas du client', async () => {
    const m = await prisma.mission.update({
      where: { id: missionId },
      data: { signataireNom: 'Claire Martin', signataireEmail: 'claire@acme.test' },
    })
    expect(m.signataireEmail).toBe('claire@acme.test')
  })
})

describe('identité de l émetteur et délai de relance', () => {
  it('sont vides et à sept jours par défaut', async () => {
    const s = await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
    expect(typeof s.emetteurNom).toBe('string')
    expect(typeof s.emetteurAdresse).toBe('string')
    expect(typeof s.emetteurSiret).toBe('string')
    expect(typeof s.emetteurEmail).toBe('string')
    expect(s.relanceJours).toBe(7)
  })
})

describe('SignatureRequest', () => {
  it('est unique par CRA — renvoyer remplace, jamais n empile', async () => {
    await prisma.signatureRequest.create({
      data: { craId, provider: 'test', signataireNom: 'C', signataireEmail: 'c@acme.test' },
    })
    await expect(
      prisma.signatureRequest.create({ data: { craId, provider: 'test' } }),
    ).rejects.toThrow()
  })

  it('démarre en attente, sans relance et sans PDF archivé', async () => {
    const r = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(r.status).toBe('EN_ATTENTE')
    expect(r.relances).toBe(0)
    expect(r.lastRelanceAt).toBeNull()
    expect(r.completedAt).toBeNull()
    expect(r.abandoned).toBe(false)
    expect(r.signedPdf).toBeNull()
  })

  it('archive des octets et les rend à l identique', async () => {
    const octets = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0xff])
    await prisma.signatureRequest.update({ where: { craId }, data: { signedPdf: octets } })
    const relu = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Buffer.from(relu.signedPdf!)).toEqual(octets)
  })

  it('disparaît avec son CRA', async () => {
    const autre = await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00.000Z') },
    })
    await prisma.signatureRequest.create({ data: { craId: autre.id, provider: 'test' } })
    await prisma.cra.delete({ where: { id: autre.id } })
    expect(await prisma.signatureRequest.findUnique({ where: { craId: autre.id } })).toBeNull()
  })
})

describe('SignatureWebhookEvent', () => {
  it('refuse deux fois le même événement du même prestataire', async () => {
    await prisma.signatureWebhookEvent.create({
      data: { provider: 'test', eventId: 'DOCUMENT_COMPLETED:42' },
    })
    await expect(
      prisma.signatureWebhookEvent.create({
        data: { provider: 'test', eventId: 'DOCUMENT_COMPLETED:42' },
      }),
    ).rejects.toThrow()
  })

  it('accepte le même identifiant chez deux prestataires différents', async () => {
    const autre = await prisma.signatureWebhookEvent.create({
      data: { provider: 'test', eventId: 'DOCUMENT_COMPLETED:43' },
    })
    expect(autre.id).not.toBe('')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/db/signature-schema.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'deleteMany')` : `prisma.signatureWebhookEvent` n'existe pas.

- [ ] **Step 3: Étendre le schéma**

Dans `prisma/schema.prisma`, ajouter à `Settings` :

```prisma
model Settings {
  // … champs existants

  /// identité imprimée en tête du CRA. Vide = l'entête émetteur reste muet,
  /// le document se génère quand même.
  emetteurNom     String @default("")
  emetteurAdresse String @default("")
  emetteurSiret   String @default("")
  emetteurEmail   String @default("")

  /// délai avant relance d'une signature en attente, en jours. 0 = relances désactivées.
  relanceJours    Int    @default(7)
}
```

Ajouter à `Mission` :

```prisma
model Mission {
  // … champs existants

  /// Contact signataire, rattaché à la **mission** et non au client : un même
  /// client peut porter plusieurs missions avec des interlocuteurs différents
  /// — un chef de projet pour l'une, un responsable de service pour l'autre.
  /// Le rattacher au client obligerait à ressaisir ou à se tromper.
  signataireNom   String @default("")
  signataireEmail String @default("")
}
```

Ajouter à `Cra` la relation inverse :

```prisma
model Cra {
  // … champs existants
  signatureRequest SignatureRequest?
}
```

Puis les deux tables nouvelles :

```prisma
/// L'état d'une demande de signature. **Une seule par CRA** : renvoyer un CRA
/// remplace la demande précédente. Empiler les demandes obligerait chaque
/// lecture à décider laquelle fait foi, et une seule divergence suffirait à
/// verrouiller un mois sur un document périmé.
model SignatureRequest {
  id       String @id @default(cuid())
  craId    String @unique
  /// identifiant du prestataire ; l'identifiant du document, lui, vit dans
  /// `ExternalLink` — un seul endroit porte la correspondance externe.
  provider String
  /// 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE'
  status   String @default("EN_ATTENTE")

  /// destinataire au moment de l'envoi, figé : changer le signataire de la
  /// mission ne réécrit pas à qui le document a réellement été adressé.
  signataireNom   String @default("")
  signataireEmail String @default("")

  sentAt        DateTime  @default(now())
  relances      Int       @default(0)
  lastRelanceAt DateTime?
  completedAt   DateTime?
  /// trois relances passées sans réponse : le CRA reste ENVOYE et remonte
  /// dans la liste des CRA en souffrance.
  abandoned     Boolean   @default(false)

  /// PDF signé, archivé tel que le prestataire l'a rendu. **Jamais
  /// regénéré** : un document signé se conserve, il ne se recalcule pas.
  signedPdf Bytes?

  updatedAt DateTime @updatedAt

  cra Cra @relation(fields: [craId], references: [id], onDelete: Cascade)

  @@index([status])
}

/// Les webhooks déjà traités. L'unicité du couple est le seul rempart contre
/// un rejeu : un même événement livré deux fois ne doit franchir la
/// transition qu'une fois.
model SignatureWebhookEvent {
  id         String   @id @default(cuid())
  provider   String
  eventId    String
  receivedAt DateTime @default(now())

  @@unique([provider, eventId])
}
```

Puis appliquer :

```bash
npm run db:sqlite
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/db/signature-schema.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Vérifier que la suite existante ne bouge pas**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/db/signature-schema.test.ts
git commit -m "feat(db): mission signer, signature requests and webhook event ledger"
```

---

## Task 5: Génération du PDF côté service

**Files:** Create `src/services/cra-pdf.ts`, `src/services/cra-pdf.test.ts`

**Interfaces:**
- Consumes: `buildCraDocument`, `libelleMois` (tâche 2) ; `layoutCraDocument` (tâche 3) ; `renderPdf`, `extraireTextes` (tâche 1) ; le schéma de la tâche 4 ; `getSettings`
- Produces:
  ```ts
  interface CraPdf { fileName: string; bytes: Uint8Array; document: CraDocument }
  buildCraPdf(userId: string, craId: string): Promise<CraPdf>
  interface CraPdfTelechargement { fileName: string; bytes: Uint8Array; archive: boolean }
  getCraPdfForDownload(userId: string, craId: string): Promise<CraPdfTelechargement>
  nomFichierCra(clientNom: string, missionLabel: string, mois: string): string
  ```

**Le PDF signé prime.** `getCraPdfForDownload` sert l'archive quand elle existe et ne regénère jamais : un document signé et un document recalculé sont deux objets différents, et c'est le premier qui a une valeur juridique.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/cra-pdf.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { extraireTextes } from '@/core/pdf/writer'
import { formatJours } from '@/core/cra/document'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry } from './time-entries'
import { getOrCreateCra } from './cra'
import { updateSettings } from './settings'
import { buildCraPdf, getCraPdfForDownload, nomFichierCra } from './cra-pdf'

let userId = ''
let autreUserId = ''
let missionId = ''
let ligneJour = ''
let ligneNuit = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'pdf@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const autre = await prisma.user.create({
    data: { email: 'pdf-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = autre.id

  const c = await createClient('PDF client')
  const m = await createMission({ clientId: c.id, label: 'Consultant ITSM' })
  missionId = m.id
  await prisma.mission.update({
    where: { id: missionId },
    data: { signataireNom: 'Claire Martin', signataireEmail: 'claire@pdf.test' },
  })

  ligneJour = (
    await createLine({ missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })
  ).id
  ligneNuit = (
    await createLine({ missionId, userId, label: 'Nuit', soldCentiemes: 1000, tjmCents: 120000 })
  ).id

  // Une mission concurrente, dont rien ne doit apparaître sur ce CRA.
  const autreMission = await createMission({ clientId: c.id, label: 'Hors périmètre' })
  await createLine({
    missionId: autreMission.id,
    userId,
    label: 'Ne doit pas figurer',
    soldCentiemes: 100,
    tjmCents: 0,
  })
})

beforeEach(async () => {
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  await prisma.settings.update({
    where: { id: 'singleton' },
    data: {
      emetteurNom: 'KREATIV PROJECT MANAGEMENT',
      emetteurAdresse: '1 rue des Tests, 75000 Paris',
      emetteurSiret: '000 000 000 00000',
      emetteurEmail: 'contact@exemple.test',
    },
  })
  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: { in: ['pdf@test.local', 'pdf-autre@test.local'] } } })
  await prisma.client.deleteMany({ where: { name: 'PDF client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function saisir(lineId: string, date: string, minutes: number): Promise<void> {
  const r = await saveEntry({ userId, lineId, date, minutes, kind: 'REALISE' })
  expect(r.ok).toBe(true)
}

describe('buildCraPdf', () => {
  it('produit un fichier PDF', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const { bytes } = await buildCraPdf(userId, craId)
    expect(Buffer.from(bytes).toString('latin1').startsWith('%PDF-')).toBe(true)
  })

  it('NE PORTE AUCUN MONTANT — le test qui protège la frontière du produit', async () => {
    // Les prestations portent un TJM de 800 € et 1 200 € : si un montant
    // devait fuiter, c est ici qu on le verrait. La vérification porte sur
    // les chaînes réellement dessinées dans le fichier, pas sur un modèle.
    await saisir(ligneJour, '2026-06-01', 480)
    await saisir(ligneNuit, '2026-06-02', 480)

    const { bytes } = await buildCraPdf(userId, craId)
    const imprime = extraireTextes(bytes).join(' | ')
    const minuscules = imprime.toLowerCase()

    for (const interdit of ['€', 'eur', 'tjm', 'montant', 'total ht', 'facture', 'prix']) {
      expect(minuscules).not.toContain(interdit)
    }
    expect(imprime).not.toContain('800')
    expect(imprime).not.toContain('1200')
    expect(imprime).not.toContain('80000')
  })

  it('porte l entête émetteur, le client, la mission et le mois', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const imprime = extraireTextes((await buildCraPdf(userId, craId)).bytes).join(' | ')
    expect(imprime).toContain('KREATIV PROJECT MANAGEMENT')
    expect(imprime).toContain('PDF client')
    expect(imprime).toContain('Consultant ITSM')
    expect(imprime).toContain('juin 2026')
  })

  it('détaille chaque prestation jour par jour', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    await saisir(ligneJour, '2026-06-02', 240)
    await saisir(ligneNuit, '2026-06-02', 480)

    const imprime = extraireTextes((await buildCraPdf(userId, craId)).bytes)
    expect(imprime).toContain('Jour')
    expect(imprime).toContain('Nuit')
    expect(imprime).toContain('lun. 01')
    expect(imprime).toContain(formatJours(50))
    expect(imprime.join(' | ')).toContain('Total du mois')
  })

  it('n emprunte rien à une autre mission', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const imprime = extraireTextes((await buildCraPdf(userId, craId)).bytes).join(' | ')
    expect(imprime).not.toContain('Ne doit pas figurer')
  })

  it('n emprunte rien aux saisies d un autre utilisateur', async () => {
    await prisma.timeEntry.create({
      data: {
        lineId: ligneJour,
        userId: autreUserId,
        date: new Date('2026-06-10T00:00:00.000Z'),
        minutes: 480,
        kind: 'REALISE',
        minutesParJour: 480,
      },
    })
    await saisir(ligneJour, '2026-06-01', 480)

    const { document } = await buildCraPdf(userId, craId)
    expect(document.totalCentiemes).toBe(100)
  })

  it('convertit chaque saisie avec le facteur qu elle porte', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    await updateSettings({ minutesParJour: 420 })
    await saisir(ligneJour, '2026-06-02', 420)

    const { document } = await buildCraPdf(userId, craId)
    expect(document.totalCentiemes).toBe(200)
  })

  it('se génère même sans identité émetteur configurée', async () => {
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { emetteurNom: '', emetteurAdresse: '', emetteurSiret: '', emetteurEmail: '' },
    })
    await saisir(ligneJour, '2026-06-01', 480)
    const { bytes } = await buildCraPdf(userId, craId)
    expect(bytes.length).toBeGreaterThan(300)
  })

  it('se génère sur un mois sans aucune saisie', async () => {
    const imprime = extraireTextes((await buildCraPdf(userId, craId)).bytes).join(' | ')
    expect(imprime).toContain('Aucun temps réalisé')
  })

  it('refuse le CRA d un autre utilisateur', async () => {
    await expect(buildCraPdf(autreUserId, craId)).rejects.toThrow()
  })
})

describe('nomFichierCra', () => {
  it('compose un nom de fichier sans espace ni accent', () => {
    expect(nomFichierCra('ACME Systèmes', 'Consultant ITSM', '2026-06')).toBe(
      'CRA-ACME-Systemes-Consultant-ITSM-2026-06.pdf',
    )
  })

  it('ne laisse jamais de séparateur de chemin s échapper', () => {
    expect(nomFichierCra('a/b', 'c\\d', '2026-06')).toBe('CRA-a-b-c-d-2026-06.pdf')
  })
})

describe('getCraPdfForDownload', () => {
  it('regénère le document tant qu aucun PDF signé n est archivé', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const r = await getCraPdfForDownload(userId, craId)
    expect(r.archive).toBe(false)
    expect(r.fileName).toBe('CRA-PDF-client-Consultant-ITSM-2026-06.pdf')
  })

  it('sert le PDF signé archivé, et ne le regénère jamais', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const archive = Buffer.from('%PDF-1.4 signé par le client', 'latin1')
    await prisma.signatureRequest.create({
      data: { craId, provider: 'test', status: 'SIGNE', signedPdf: archive },
    })

    const r = await getCraPdfForDownload(userId, craId)
    expect(r.archive).toBe(true)
    expect(Buffer.from(r.bytes)).toEqual(archive)
    expect(r.fileName).toBe('CRA-PDF-client-Consultant-ITSM-2026-06-signe.pdf')
  })

  it('regénère quand la demande existe mais sans PDF archivé', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    await prisma.signatureRequest.create({ data: { craId, provider: 'test' } })
    expect((await getCraPdfForDownload(userId, craId)).archive).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/cra-pdf.test.ts`
Expected: FAIL — `Failed to resolve import "./cra-pdf"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/cra-pdf.ts` :

```ts
import { prisma } from '@/db/client'
import { renderPdf } from '@/core/pdf/writer'
import { buildCraDocument, type CraDocument } from '@/core/cra/document'
import { layoutCraDocument } from '@/core/cra/layout'
import type { TimeEntryKind } from '@/core/types'
import { readSettingsRow } from './settings'

export interface CraPdf {
  fileName: string
  bytes: Uint8Array
  /** le modèle qui a servi à composer le fichier, utile aux appelants et aux tests */
  document: CraDocument
}

export interface CraPdfTelechargement {
  fileName: string
  bytes: Uint8Array
  /** true = PDF signé servi tel quel, jamais recomposé */
  archive: boolean
}

/** Retire accents, espaces et séparateurs de chemin : ce nom part dans un en-tête HTTP. */
export function nomFichierCra(clientNom: string, missionLabel: string, mois: string): string {
  const morceau = (brut: string): string =>
    brut
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  return `CRA-${morceau(clientNom)}-${morceau(missionLabel)}-${mois}.pdf`
}

function bornesDuMois(mois: string): { start: Date; end: Date } {
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  return { start: new Date(Date.UTC(annee, numero - 1, 1)), end: new Date(Date.UTC(annee, numero, 1)) }
}

interface ContexteCra {
  craId: string
  missionId: string
  missionLabel: string
  clientNom: string
  /** 'YYYY-MM' */
  mois: string
  signataireNom: string
  signataireEmail: string
  fileName: string
}

/**
 * Charge le contexte d'un CRA en le scopant sur son propriétaire. Le
 * `findFirstOrThrow` sur `{ id, userId }` est la garantie qu'aucun appelant ne
 * peut télécharger le CRA d'un autre en devinant un identifiant.
 */
async function chargerContexte(userId: string, craId: string): Promise<ContexteCra> {
  const cra = await prisma.cra.findFirstOrThrow({
    where: { id: craId, userId },
    include: { mission: { include: { client: true } } },
  })

  const mois = cra.month.toISOString().slice(0, 7)
  return {
    craId: cra.id,
    missionId: cra.missionId,
    missionLabel: cra.mission.label,
    clientNom: cra.mission.client.name,
    mois,
    signataireNom: cra.mission.signataireNom,
    signataireEmail: cra.mission.signataireEmail,
    fileName: nomFichierCra(cra.mission.client.name, cra.mission.label, mois),
  }
}

export async function buildCraPdf(userId: string, craId: string): Promise<CraPdf> {
  const contexte = await chargerContexte(userId, craId)
  // `readSettingsRow` est le seul endroit du dépôt qui porte les valeurs de
  // création du singleton : y passer garantit la ligne avant de la lire.
  const settings = await readSettingsRow()

  // Seules les prestations réellement affectées à l'utilisateur : une mission
  // partagée ne fait pas fuiter les lignes des autres consultants.
  const lignes = await prisma.missionLine.findMany({
    where: { missionId: contexte.missionId, assignments: { some: { userId } } },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, label: true },
  })

  const { start, end } = bornesDuMois(contexte.mois)
  const saisies = await prisma.timeEntry.findMany({
    where: { userId, lineId: { in: lignes.map((l) => l.id) }, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
    select: { lineId: true, date: true, minutes: true, minutesParJour: true, kind: true },
  })

  const document = buildCraDocument({
    emetteur: {
      nom: settings.emetteurNom,
      adresse: settings.emetteurAdresse,
      siret: settings.emetteurSiret,
      email: settings.emetteurEmail,
    },
    clientNom: contexte.clientNom,
    missionLabel: contexte.missionLabel,
    mois: contexte.mois,
    signataireNom: contexte.signataireNom,
    signataireEmail: contexte.signataireEmail,
    lignes,
    entries: saisies.map((s) => ({
      lineId: s.lineId,
      date: s.date.toISOString().slice(0, 10),
      minutes: s.minutes,
      minutesParJour: s.minutesParJour,
      kind: s.kind as TimeEntryKind,
    })),
  })

  return {
    fileName: contexte.fileName,
    bytes: renderPdf(layoutCraDocument(document)),
    document,
  }
}

/**
 * Le document à servir : l'archive signée si elle existe, la regénération
 * sinon.
 *
 * **Un PDF signé ne se regénère jamais.** Le document que le client a signé
 * et le document que l'application recomposerait aujourd'hui sont deux objets
 * distincts ; seul le premier engage qui que ce soit.
 */
export async function getCraPdfForDownload(
  userId: string,
  craId: string,
): Promise<CraPdfTelechargement> {
  const contexte = await chargerContexte(userId, craId)

  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: contexte.craId },
    select: { signedPdf: true },
  })

  if (demande?.signedPdf != null) {
    return {
      fileName: contexte.fileName.replace(/\.pdf$/, '-signe.pdf'),
      bytes: new Uint8Array(demande.signedPdf),
      archive: true,
    }
  }

  const { fileName, bytes } = await buildCraPdf(userId, craId)
  return { fileName, bytes, archive: false }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/cra-pdf.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Vérifier par mutation**

Ajouter temporairement, dans `layoutCraDocument`, un texte `Total : 800 €` en pied de page, et confirmer que **« NE PORTE AUCUN MONTANT »** échoue. Restaurer. Un test qui ne tombe pas sur cette mutation ne protège rien.

Retirer `assignments: { some: { userId } }` de la requête des lignes et confirmer que « n emprunte rien à une autre mission » **ne** tombe pas — c'est le filtre `missionId` qui joue là — puis retirer `userId` de la requête des saisies et confirmer que « n emprunte rien aux saisies d un autre utilisateur » échoue. Restaurer.

- [ ] **Step 6: Commit**

```bash
git add src/services/cra-pdf.ts src/services/cra-pdf.test.ts
git commit -m "feat(cra): render the monthly CRA as a PDF, archived copy takes precedence"
```

---

## Task 6: Téléchargement du PDF

**Files:** Create `src/app/(app)/cra/[craId]/pdf/route.ts`, `src/app/(app)/cra/[craId]/pdf/route.test.ts`

**Interfaces:**
- Consumes: `getCraPdfForDownload` (tâche 5), `requireUser`
- Produces: `GET /cra/{craId}/pdf`

**C'est la moitié utile du lot sans aucun connecteur.** Le PDF se génère et se télécharge, les transitions restent manuelles : le lot 3 apporte déjà de la valeur avec `DOCUMENSO_URL` vide.

- [ ] **Step 1: Écrire le test qui échoue**

`src/app/(app)/cra/[craId]/pdf/route.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { etat } = vi.hoisted(() => ({
  etat: {
    userId: 'u1',
    resultat: {
      fileName: 'CRA-ACME-ITSM-2026-06.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      archive: false,
    } as { fileName: string; bytes: Uint8Array; archive: boolean },
    erreur: null as Error | null,
    appels: [] as Array<{ userId: string; craId: string }>,
  },
}))

vi.mock('@/auth', () => ({
  requireUser: vi.fn(async () => ({ id: etat.userId, role: 'ADMIN' as const })),
}))
vi.mock('@/services/cra-pdf', () => ({
  getCraPdfForDownload: async (userId: string, craId: string) => {
    etat.appels.push({ userId, craId })
    if (etat.erreur !== null) throw etat.erreur
    return etat.resultat
  },
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { GET } from './route'

function requete(craId: string): Promise<Response> {
  return GET(new Request(`http://local/cra/${craId}/pdf`), {
    params: Promise.resolve({ craId }),
  })
}

describe('GET /cra/{craId}/pdf', () => {
  beforeEach(() => {
    etat.erreur = null
    etat.appels.length = 0
    etat.resultat = {
      fileName: 'CRA-ACME-ITSM-2026-06.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      archive: false,
    }
  })

  it('sert le PDF avec le bon type de contenu', async () => {
    const r = await requete('cra-1')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
  })

  it('propose le fichier en pièce jointe, sous son nom', async () => {
    const r = await requete('cra-1')
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="CRA-ACME-ITSM-2026-06.pdf"',
    )
  })

  it('scope la demande sur l utilisateur de la session, jamais sur un paramètre', async () => {
    await requete('cra-1')
    expect(etat.appels).toEqual([{ userId: 'u1', craId: 'cra-1' }])
  })

  it('interdit la mise en cache d un document nominatif', async () => {
    const r = await requete('cra-1')
    expect(r.headers.get('cache-control')).toContain('no-store')
  })

  it('rend 404 quand le CRA n existe pas ou n appartient pas à l utilisateur', async () => {
    etat.erreur = new Error('No Cra found')
    const r = await requete('inconnu')
    expect(r.status).toBe(404)
  })

  it('rend 401 quand la session manque', async () => {
    const { requireUser } = await import('@/auth')
    vi.mocked(requireUser).mockRejectedValueOnce(new Error('Non authentifié'))
    const r = await requete('cra-1')
    expect(r.status).toBe(401)
    expect(etat.appels).toEqual([])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run "src/app/(app)/cra/[craId]/pdf/route.test.ts"`
Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 3: Écrire l'implémentation**

`src/app/(app)/cra/[craId]/pdf/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { requireUser } from '@/auth'
import { getCraPdfForDownload } from '@/services/cra-pdf'

/**
 * Téléchargement du CRA.
 *
 * Disponible quel que soit l'état du CRA et **sans aucun connecteur de
 * signature configuré** : c'est ce qui rend le lot utile tout seul.
 *
 * Le service décide seul s'il sert l'archive signée ou une regénération ; la
 * route ne fait que transporter.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ craId: string }> },
): Promise<Response> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch {
    return NextResponse.json({ erreur: 'Non authentifié.' }, { status: 401 })
  }

  const { craId } = await params

  try {
    const { fileName, bytes } = await getCraPdfForDownload(userId, craId)

    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${fileName}"`,
        // Un CRA est nominatif et peut être remplacé par son archive signée
        // d'une minute à l'autre : rien à mettre en cache ici.
        'cache-control': 'no-store, must-revalidate',
      },
    })
  } catch {
    // Un CRA inexistant et un CRA appartenant à quelqu'un d'autre doivent
    // être indiscernables : `chargerContexte` les traite déjà de la même
    // façon, la route ne doit pas les redistinguer.
    return NextResponse.json({ erreur: 'CRA introuvable.' }, { status: 404 })
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run "src/app/(app)/cra/[craId]/pdf/route.test.ts"`
Expected: PASS — 6 tests

- [ ] **Step 5: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/cra/[craId]"
git commit -m "feat(cra): download the monthly CRA as a PDF, no connector required"
```

---

## Task 7: Signataire rattaché à la mission

**Files:** Modify `src/services/missions.ts`, `src/services/missions.test.ts`, `src/app/(app)/missions/page.tsx`, `src/app/(app)/missions/actions.ts`

**Interfaces:**
- Consumes: les colonnes de la tâche 4
- Produces:
  - `MissionForUser` gagne `signataireNom: string` et `signataireEmail: string`
  - `createMission(args: { clientId; label; minutesParJour?; signataireNom?; signataireEmail? })`
  - `type SignataireResult = { ok: true } | { ok: false; erreur: string }`
  - `updateMissionSignataire(userId: string, missionId: string, patch: { nom: string; email: string }): Promise<SignataireResult>`

**Pourquoi la mission et pas le client.** Un CRA est déjà produit par couple *(mission, mois)* ; aligner le destinataire sur le document supprime toute question. Un même client peut porter plusieurs missions avec des interlocuteurs différents — un chef de projet pour l'une, un responsable de service pour l'autre — et rattacher le signataire au client obligerait à ressaisir ou à se tromper.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/services/missions.test.ts`, en complétant son import de `./missions` avec `updateMissionSignataire` :

```ts
describe('signataire de la mission', () => {
  it('est vide à la création', async () => {
    const c = await createClient('SIGNATAIRE vide')
    const m = await createMission({ clientId: c.id, label: 'MV' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'MV')
    expect(mission!.signataireNom).toBe('')
    expect(mission!.signataireEmail).toBe('')
  })

  it('se renseigne à la création', async () => {
    const c = await createClient('SIGNATAIRE creation')
    const m = await createMission({
      clientId: c.id,
      label: 'MC',
      signataireNom: 'Claire Martin',
      signataireEmail: 'claire@acme.test',
    })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'MC')
    expect(mission!.signataireNom).toBe('Claire Martin')
    expect(mission!.signataireEmail).toBe('claire@acme.test')
  })

  it('se modifie après coup', async () => {
    const c = await createClient('SIGNATAIRE maj')
    const m = await createMission({ clientId: c.id, label: 'MM' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const r = await updateMissionSignataire(userId, m.id, {
      nom: 'Paul Durand',
      email: 'paul@acme.test',
    })
    expect(r).toEqual({ ok: true })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'MM')
    expect(mission!.signataireNom).toBe('Paul Durand')
    expect(mission!.signataireEmail).toBe('paul@acme.test')
  })

  it('deux missions du même client portent deux interlocuteurs différents', async () => {
    // La raison d être de la décision : le signataire n est pas une propriété
    // du client.
    const c = await createClient('SIGNATAIRE deux missions')
    const a = await createMission({
      clientId: c.id,
      label: 'MA',
      signataireNom: 'Chef de projet',
      signataireEmail: 'cp@acme.test',
    })
    const b = await createMission({
      clientId: c.id,
      label: 'MB',
      signataireNom: 'Responsable de service',
      signataireEmail: 'rs@acme.test',
    })
    await createLine({ missionId: a.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })
    await createLine({ missionId: b.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const missions = await listMissionsForUser(userId)
    expect(missions.find((x) => x.label === 'MA')!.signataireEmail).toBe('cp@acme.test')
    expect(missions.find((x) => x.label === 'MB')!.signataireEmail).toBe('rs@acme.test')
  })

  it('refuse une adresse électronique invalide', async () => {
    const c = await createClient('SIGNATAIRE email invalide')
    const m = await createMission({ clientId: c.id, label: 'MI' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const r = await updateMissionSignataire(userId, m.id, { nom: 'X', email: 'pas-une-adresse' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toContain('adresse')
  })

  it('accepte de tout effacer — le signataire n est pas obligatoire', async () => {
    const c = await createClient('SIGNATAIRE effacement')
    const m = await createMission({
      clientId: c.id,
      label: 'ME',
      signataireNom: 'X',
      signataireEmail: 'x@acme.test',
    })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    expect(await updateMissionSignataire(userId, m.id, { nom: '', email: '' })).toEqual({ ok: true })
  })

  it('refuse un nom sans adresse — un destinataire sans adresse n est pas joignable', async () => {
    const c = await createClient('SIGNATAIRE sans email')
    const m = await createMission({ clientId: c.id, label: 'MS' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const r = await updateMissionSignataire(userId, m.id, { nom: 'Sans adresse', email: '' })
    expect(r.ok).toBe(false)
  })

  it('ne touche pas la mission d un utilisateur non affecté', async () => {
    const autre = await prisma.user.create({
      data: { email: 'signataire-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    const c = await createClient('SIGNATAIRE isolation')
    const m = await createMission({ clientId: c.id, label: 'MZ' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const r = await updateMissionSignataire(autre.id, m.id, {
      nom: 'Intrus',
      email: 'intrus@acme.test',
    })
    expect(r.ok).toBe(false)

    const relu = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relu.signataireNom).toBe('')

    await prisma.user.delete({ where: { id: autre.id } })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/missions.test.ts`
Expected: FAIL — `updateMissionSignataire` n'est pas exporté, `signataireNom` est `undefined`

- [ ] **Step 3: Écrire l'implémentation**

Dans `src/services/missions.ts` :

```ts
import { z } from 'zod'
```

Élargir `createMission` :

```ts
export async function createMission(args: {
  clientId: string
  label: string
  minutesParJour?: number | null
  signataireNom?: string
  signataireEmail?: string
}): Promise<{ id: string }> {
  const m = await prisma.mission.create({
    data: {
      clientId: args.clientId,
      label: args.label,
      minutesParJour: args.minutesParJour ?? null,
      signataireNom: args.signataireNom ?? '',
      signataireEmail: args.signataireEmail ?? '',
    },
  })
  return { id: m.id }
}
```

Ajouter à `MissionForUser` :

```ts
  /** contact signataire du CRA, porté par la mission et non par le client */
  signataireNom: string
  signataireEmail: string
```

et les renseigner dans le `missions.map` de `listMissionsForUser` :

```ts
    signataireNom: m.signataireNom,
    signataireEmail: m.signataireEmail,
```

Puis la mise à jour :

```ts
export type SignataireResult = { ok: true } | { ok: false; erreur: string }

const signataireSchema = z
  .object({ nom: z.string().trim(), email: z.string().trim() })
  .refine((v) => v.email === '' || z.string().email().safeParse(v.email).success, {
    message: 'L’adresse électronique du signataire est invalide.',
  })
  // Un nom sans adresse produirait un destinataire qu'on ne peut pas joindre,
  // et donc un bouton « Envoyer pour signature » qui semble prêt sans l'être.
  .refine((v) => !(v.nom !== '' && v.email === ''), {
    message: 'Une adresse électronique est requise dès qu’un nom de signataire est renseigné.',
  })

/**
 * Renseigne le contact signataire d'une mission.
 *
 * Scopé par affectation : sans ligne affectée à l'utilisateur, la mission
 * n'est pas la sienne et il ne décide pas à qui son CRA est envoyé.
 */
export async function updateMissionSignataire(
  userId: string,
  missionId: string,
  patch: { nom: string; email: string },
): Promise<SignataireResult> {
  const valide = signataireSchema.safeParse(patch)
  if (!valide.success) {
    return { ok: false, erreur: valide.error.issues[0]?.message ?? 'Signataire invalide.' }
  }

  const mission = await prisma.mission.findFirst({
    where: { id: missionId, lines: { some: { assignments: { some: { userId } } } } },
    select: { id: true },
  })
  if (mission === null) {
    return { ok: false, erreur: 'Cette mission ne vous est pas affectée.' }
  }

  await prisma.mission.update({
    where: { id: missionId },
    data: { signataireNom: valide.data.nom, signataireEmail: valide.data.email },
  })
  return { ok: true }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/missions.test.ts`
Expected: PASS — les 8 tests nouveaux plus tous les existants

- [ ] **Step 5: Exposer dans l'écran des missions**

Dans `src/app/(app)/missions/actions.ts` :

```ts
import { updateMissionSignataire } from '@/services/missions'

export async function saveSignataire(formData: FormData): Promise<void> {
  const user = await requireUser()
  await updateMissionSignataire(user.id, String(formData.get('missionId')), {
    nom: String(formData.get('signataireNom') ?? ''),
    email: String(formData.get('signataireEmail') ?? ''),
  })
  revalidatePath('/missions')
  revalidatePath('/cra')
}
```

Dans `addMission`, transmettre les deux champs du formulaire de création :

```ts
    signataireNom: String(formData.get('signataireNom') ?? ''),
    signataireEmail: String(formData.get('signataireEmail') ?? ''),
```

Dans `src/app/(app)/missions/page.tsx`, ajouter au formulaire de création de mission deux champs, puis sur chaque mission listée un formulaire de mise à jour :

```tsx
<form action={saveSignataire} className="mt-3 flex flex-wrap items-end gap-2">
  <input type="hidden" name="missionId" value={m.id} />
  <Field
    label="Signataire du CRA"
    name="signataireNom"
    defaultValue={m.signataireNom}
    placeholder="Nom du contact"
  />
  <Field
    label="Adresse électronique"
    name="signataireEmail"
    type="email"
    defaultValue={m.signataireEmail}
    hint="Le destinataire du CRA à signer, propre à cette mission."
  />
  <Button>Enregistrer le signataire</Button>
</form>
```

- [ ] **Step 6: Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 7: Commit**

```bash
git add src/services/missions.ts src/services/missions.test.ts "src/app/(app)/missions"
git commit -m "feat(missions): per-mission signer contact, not per client"
```

---

## Task 8: Interface `SignatureConnector`, double, connecteur Documenso

**Files:** Create `src/core/signature/connector.ts`, `src/core/signature/connector.test.ts`, `src/services/signature/documenso.ts`, `src/services/signature/documenso.test.ts`, `src/services/signature/fake-connector.ts`, `src/services/signature/registry.ts`, `src/services/signature/registry.test.ts`, `src/services/signature/constants.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  ```ts
  // src/core/signature/connector.ts
  type SignatureStatus = 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE'
  const SIGNATURE_STATUSES: readonly SignatureStatus[]
  interface SignatureContact { nom: string; email: string }
  interface SignatureEnvoi { titre: string; fileName: string; pdf: Uint8Array; destinataire: SignatureContact }
  interface SignatureConnector {
    readonly provider: string
    send(envoi: SignatureEnvoi): Promise<string>
    status(externalId: string): Promise<SignatureStatus>
    download(externalId: string): Promise<Uint8Array>
    remind(externalId: string): Promise<void>
  }
  type SignatureFetchLike = (url: string, init: { method: string
                                                  headers: Record<string, string>
                                                  body?: string | Uint8Array }) => Promise<Response>
  class SignatureConnectorError extends Error { readonly statusCode: number }
  estStatutDeSignature(valeur: string): valeur is SignatureStatus

  // src/services/signature/constants.ts
  const ENTITY_CRA = 'CRA'
  const PROVIDER_DOCUMENSO = 'documenso'

  // src/services/signature/documenso.ts
  createDocumensoConnector(args: { fetchFn: SignatureFetchLike; baseUrl: string; apiKey: string }): SignatureConnector
  parseDocumensoWebhook(rawBody: string): { externalId: string; statut: SignatureStatus; eventId: string } | null

  // src/services/signature/fake-connector.ts
  createFakeSignatureConnector(): FakeSignatureConnector

  // src/services/signature/registry.ts
  getSignatureConnector(): Promise<SignatureConnector | null>
  ```

**L'exigence absolue.** Le connecteur ne connaît qu'un `fetchFn` qu'on lui passe. **Aucun test n'appelle Documenso.** C'est le vrai connecteur — avec ses URLs, ses en-têtes et sa traduction des statuts — qui est exercé ; seul le transport est un double. Un plan dont les tests dépendent du réseau est invalide.

**La signature diffère de celle de la spec.** Celle-ci écrit `send(cra: Cra, pdf: Buffer, destinataire: Contact)`. `core/` n'importe jamais `@prisma/client` : `Cra` ne peut donc pas entrer ici. L'intention est intacte — un document, un destinataire, une référence externe en retour.

- [ ] **Step 1: Écrire le test du contrat**

`src/core/signature/connector.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  SIGNATURE_STATUSES,
  SignatureConnectorError,
  estStatutDeSignature,
} from './connector'

describe('statuts de signature', () => {
  it('couvre exactement les quatre issues possibles', () => {
    expect([...SIGNATURE_STATUSES]).toEqual(['EN_ATTENTE', 'SIGNE', 'REFUSE', 'EXPIRE'])
  })

  it('reconnaît un statut connu et rejette le reste', () => {
    expect(estStatutDeSignature('SIGNE')).toBe(true)
    expect(estStatutDeSignature('COMPLETED')).toBe(false)
    expect(estStatutDeSignature('')).toBe(false)
  })
})

describe('SignatureConnectorError', () => {
  it('transporte le code HTTP pour que l appelant sache s il peut réessayer', () => {
    const e = new SignatureConnectorError('Refusé par le prestataire', 401)
    expect(e.statusCode).toBe(401)
    expect(e.name).toBe('SignatureConnectorError')
    expect(e).toBeInstanceOf(Error)
  })

  it('vaut zéro quand l échec n est pas un code HTTP', () => {
    expect(new SignatureConnectorError('transport injoignable').statusCode).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/signature/connector.test.ts`
Expected: FAIL — `Failed to resolve import "./connector"`

- [ ] **Step 3: Écrire le contrat**

`src/core/signature/connector.ts` :

```ts
/**
 * Le point d'extension déclaré dès le lot 0. **C'est lui le livrable du lot
 * 3**, pas Documenso : le cœur ne doit jamais savoir quel prestataire de
 * signature est branché, ni même s'il y en a un.
 *
 * Module pur : aucune dépendance à Prisma, à Next ni au réseau.
 */

export type SignatureStatus = 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE'

export const SIGNATURE_STATUSES: readonly SignatureStatus[] = [
  'EN_ATTENTE',
  'SIGNE',
  'REFUSE',
  'EXPIRE',
]

export function estStatutDeSignature(valeur: string): valeur is SignatureStatus {
  return (SIGNATURE_STATUSES as readonly string[]).includes(valeur)
}

export interface SignatureContact {
  nom: string
  email: string
}

export interface SignatureEnvoi {
  titre: string
  fileName: string
  pdf: Uint8Array
  destinataire: SignatureContact
}

export interface SignatureConnector {
  /** identifiant du prestataire, tel qu'il sera écrit dans `ExternalLink.provider` */
  readonly provider: string
  /** confie le document et rend la référence externe */
  send(envoi: SignatureEnvoi): Promise<string>
  /** l'état courant, interrogé à la demande — c'est le rattrapage d'un webhook perdu */
  status(externalId: string): Promise<SignatureStatus>
  /** le document signé, à archiver tel quel */
  download(externalId: string): Promise<Uint8Array>
  /** relance le destinataire */
  remind(externalId: string): Promise<void>
}

/**
 * Le transport, toujours injecté. C'est ce qui permet de tester le vrai
 * connecteur — ses URLs, ses en-têtes, sa traduction des statuts — sans
 * qu'aucun test ne touche le réseau.
 */
export type SignatureFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | Uint8Array },
) => Promise<Response>

export class SignatureConnectorError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 0) {
    super(message)
    this.name = 'SignatureConnectorError'
    this.statusCode = statusCode
  }
}
```

- [ ] **Step 4: Écrire le test du connecteur Documenso**

`src/services/signature/documenso.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  SignatureConnectorError,
  type SignatureFetchLike,
} from '@/core/signature/connector'
import { createDocumensoConnector, parseDocumensoWebhook } from './documenso'

const BASE = 'https://documenso.test'
const CLE = 'api_cle_de_test'

interface Appel {
  url: string
  method: string
  headers: Record<string, string>
  body?: string | Uint8Array
}

/**
 * Le double de l'API. Il implémente les mêmes routes que Documenso ; le vrai
 * connecteur est exercé tel quel au-dessus.
 */
function faussApi(options: { statutDocument?: string; signingStatus?: string } = {}) {
  const appels: Appel[] = []
  const documents = new Map<string, { status: string; signingStatus: string }>()

  const fetchFn: SignatureFetchLike = async (url, init) => {
    appels.push({ url, method: init.method, headers: init.headers, body: init.body })

    if (url === `${BASE}/api/v1/documents` && init.method === 'POST') {
      documents.set('42', {
        status: options.statutDocument ?? 'DRAFT',
        signingStatus: options.signingStatus ?? 'NOT_SIGNED',
      })
      return Response.json({ documentId: 42, uploadUrl: `${BASE}/upload/42` })
    }

    if (url === `${BASE}/upload/42` && init.method === 'PUT') {
      return new Response(null, { status: 200 })
    }

    if (url === `${BASE}/api/v1/documents/42/send` && init.method === 'POST') {
      return Response.json({ ok: true })
    }

    if (url === `${BASE}/api/v1/documents/42` && init.method === 'GET') {
      const doc = documents.get('42') ?? {
        status: options.statutDocument ?? 'DRAFT',
        signingStatus: options.signingStatus ?? 'NOT_SIGNED',
      }
      return Response.json({
        id: 42,
        status: doc.status,
        recipients: [{ id: 7, email: 'claire@acme.test', signingStatus: doc.signingStatus }],
      })
    }

    if (url === `${BASE}/api/v1/documents/42/download` && init.method === 'GET') {
      return Response.json({ downloadUrl: `${BASE}/fichiers/42.pdf` })
    }

    if (url === `${BASE}/fichiers/42.pdf` && init.method === 'GET') {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53]), { status: 200 })
    }

    if (url === `${BASE}/api/v1/documents/42/resend` && init.method === 'POST') {
      return Response.json({ ok: true })
    }

    return new Response('non trouvé', { status: 404 })
  }

  return { appels, fetchFn }
}

function connecteur(fetchFn: SignatureFetchLike) {
  return createDocumensoConnector({ fetchFn, baseUrl: BASE, apiKey: CLE })
}

describe('connecteur Documenso — aucun test ne touche le réseau', () => {
  it('ne fait aucun appel tant qu on ne lui demande rien', () => {
    const jamais: SignatureFetchLike = () => {
      throw new Error('Le réseau est interdit dans les tests.')
    }
    expect(() =>
      createDocumensoConnector({ fetchFn: jamais, baseUrl: BASE, apiKey: CLE }),
    ).not.toThrow()
  })

  it('s annonce sous le nom du prestataire', () => {
    expect(connecteur(faussApi().fetchFn).provider).toBe('documenso')
  })
})

describe('send', () => {
  it('crée le document, téléverse le PDF, puis l envoie — dans cet ordre', async () => {
    const api = faussApi()
    const externalId = await connecteur(api.fetchFn).send({
      titre: 'CRA ACME — juin 2026',
      fileName: 'CRA-ACME-2026-06.pdf',
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      destinataire: { nom: 'Claire Martin', email: 'claire@acme.test' },
    })

    expect(externalId).toBe('42')
    expect(api.appels.map((a) => `${a.method} ${a.url}`)).toEqual([
      `POST ${BASE}/api/v1/documents`,
      `PUT ${BASE}/upload/42`,
      `POST ${BASE}/api/v1/documents/42/send`,
    ])
  })

  it('porte la clé d API et le destinataire', async () => {
    const api = faussApi()
    await connecteur(api.fetchFn).send({
      titre: 'CRA ACME — juin 2026',
      fileName: 'CRA-ACME-2026-06.pdf',
      pdf: new Uint8Array([0x25]),
      destinataire: { nom: 'Claire Martin', email: 'claire@acme.test' },
    })

    expect(api.appels[0]!.headers['Authorization']).toBe(CLE)
    expect(String(api.appels[0]!.body)).toContain('claire@acme.test')
    expect(String(api.appels[0]!.body)).toContain('CRA ACME')
    expect(api.appels[1]!.headers['Content-Type']).toBe('application/pdf')
  })

  it('lève une erreur typée quand le prestataire refuse', async () => {
    const refus: SignatureFetchLike = async () => new Response('clé invalide', { status: 401 })
    await expect(
      connecteur(refus).send({
        titre: 't',
        fileName: 'f.pdf',
        pdf: new Uint8Array([1]),
        destinataire: { nom: 'C', email: 'c@acme.test' },
      }),
    ).rejects.toBeInstanceOf(SignatureConnectorError)
  })
})

describe('status', () => {
  it('traduit un document achevé en SIGNE', async () => {
    const api = faussApi({ statutDocument: 'COMPLETED', signingStatus: 'SIGNED' })
    expect(await connecteur(api.fetchFn).status('42')).toBe('SIGNE')
  })

  it('traduit un refus du destinataire en REFUSE', async () => {
    const api = faussApi({ statutDocument: 'PENDING', signingStatus: 'REJECTED' })
    expect(await connecteur(api.fetchFn).status('42')).toBe('REFUSE')
  })

  it('traduit une expiration en EXPIRE', async () => {
    const api = faussApi({ statutDocument: 'EXPIRED', signingStatus: 'NOT_SIGNED' })
    expect(await connecteur(api.fetchFn).status('42')).toBe('EXPIRE')
  })

  it('traduit tout le reste en EN_ATTENTE plutôt que d inventer une issue', async () => {
    const api = faussApi({ statutDocument: 'PENDING', signingStatus: 'NOT_SIGNED' })
    expect(await connecteur(api.fetchFn).status('42')).toBe('EN_ATTENTE')

    const inconnu = faussApi({ statutDocument: 'QUELQUE_CHOSE_DE_NOUVEAU' })
    expect(await connecteur(inconnu.fetchFn).status('42')).toBe('EN_ATTENTE')
  })
})

describe('download', () => {
  it('suit le lien de téléchargement et rend les octets', async () => {
    const api = faussApi({ statutDocument: 'COMPLETED', signingStatus: 'SIGNED' })
    const octets = await connecteur(api.fetchFn).download('42')
    expect(Array.from(octets)).toEqual([0x25, 0x50, 0x44, 0x46, 0x53])
  })
})

describe('remind', () => {
  it('relance les destinataires du document', async () => {
    const api = faussApi({ statutDocument: 'PENDING' })
    await connecteur(api.fetchFn).remind('42')
    const resend = api.appels.find((a) => a.url.endsWith('/resend'))
    expect(resend).toBeDefined()
    expect(String(resend!.body)).toContain('7')
  })
})

describe('parseDocumensoWebhook', () => {
  it('reconnaît une signature achevée', () => {
    const charge = JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42 } })
    expect(parseDocumensoWebhook(charge)).toEqual({
      externalId: '42',
      statut: 'SIGNE',
      eventId: 'DOCUMENT_COMPLETED:42',
    })
  })

  it('reconnaît un refus et une expiration', () => {
    expect(
      parseDocumensoWebhook(JSON.stringify({ event: 'DOCUMENT_REJECTED', payload: { id: 7 } }))!
        .statut,
    ).toBe('REFUSE')
    expect(
      parseDocumensoWebhook(JSON.stringify({ event: 'DOCUMENT_CANCELLED', payload: { id: 7 } }))!
        .statut,
    ).toBe('EXPIRE')
  })

  it('construit une clé d idempotence indépendante du prestataire', () => {
    // Deux livraisons du même événement pour le même document portent la même
    // clé, quoi qu en dise l identifiant de livraison de Documenso.
    const a = parseDocumensoWebhook(
      JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42 }, webhookEventId: 'x' }),
    )
    const b = parseDocumensoWebhook(
      JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42 }, webhookEventId: 'y' }),
    )
    expect(a!.eventId).toBe(b!.eventId)
  })

  it('rend null sur une charge illisible ou sans intérêt', () => {
    expect(parseDocumensoWebhook('pas du json')).toBeNull()
    expect(parseDocumensoWebhook('{}')).toBeNull()
    expect(parseDocumensoWebhook(JSON.stringify({ event: 'DOCUMENT_OPENED', payload: { id: 1 } }))).toBeNull()
    expect(parseDocumensoWebhook(JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: {} }))).toBeNull()
  })
})
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/signature/documenso.test.ts`
Expected: FAIL — `Failed to resolve import "./documenso"`

- [ ] **Step 6: Écrire le connecteur, le double, le registre**

`src/services/signature/constants.ts` :

```ts
/** Type d'entité utilisé dans `ExternalLink` pour un CRA. */
export const ENTITY_CRA = 'CRA'

/** Identifiant du premier prestataire implémenté. */
export const PROVIDER_DOCUMENSO = 'documenso'
```

`src/services/signature/documenso.ts` :

```ts
import {
  SignatureConnectorError,
  type SignatureConnector,
  type SignatureEnvoi,
  type SignatureFetchLike,
  type SignatureStatus,
} from '@/core/signature/connector'
import { PROVIDER_DOCUMENSO } from './constants'

/**
 * Première implémentation de `SignatureConnector`.
 *
 * Tout ce qui est propre à Documenso — URLs, en-têtes, vocabulaire de statuts,
 * forme des webhooks — est enfermé dans ce fichier. Changer de prestataire,
 * c'est écrire un fichier voisin, pas toucher au reste du lot.
 */
export function createDocumensoConnector(args: {
  fetchFn: SignatureFetchLike
  baseUrl: string
  apiKey: string
}): SignatureConnector {
  const racine = args.baseUrl.replace(/\/+$/, '')

  const enTetes = (): Record<string, string> => ({
    Authorization: args.apiKey,
    'Content-Type': 'application/json',
  })

  async function appeler(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string | Uint8Array },
  ): Promise<Response> {
    const reponse = await args.fetchFn(url, init)
    if (!reponse.ok) {
      throw new SignatureConnectorError(
        `Le prestataire de signature a refusé la requête (${reponse.status}).`,
        reponse.status,
      )
    }
    return reponse
  }

  async function lireDocument(externalId: string): Promise<{
    status: string
    recipients: Array<{ id: number; signingStatus: string }>
  }> {
    const reponse = await appeler(`${racine}/api/v1/documents/${externalId}`, {
      method: 'GET',
      headers: enTetes(),
    })
    return (await reponse.json()) as {
      status: string
      recipients: Array<{ id: number; signingStatus: string }>
    }
  }

  return {
    provider: PROVIDER_DOCUMENSO,

    async send(envoi: SignatureEnvoi): Promise<string> {
      const creation = await appeler(`${racine}/api/v1/documents`, {
        method: 'POST',
        headers: enTetes(),
        body: JSON.stringify({
          title: envoi.titre,
          fileName: envoi.fileName,
          recipients: [
            {
              name: envoi.destinataire.nom,
              email: envoi.destinataire.email,
              role: 'SIGNER',
              signingOrder: 1,
            },
          ],
        }),
      })

      const { documentId, uploadUrl } = (await creation.json()) as {
        documentId: number | string
        uploadUrl: string
      }

      await appeler(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: envoi.pdf,
      })

      await appeler(`${racine}/api/v1/documents/${documentId}/send`, {
        method: 'POST',
        headers: enTetes(),
        body: JSON.stringify({ sendEmail: true }),
      })

      return String(documentId)
    },

    async status(externalId: string): Promise<SignatureStatus> {
      const document = await lireDocument(externalId)
      return traduireStatut(
        document.status,
        (document.recipients ?? []).map((r) => r.signingStatus),
      )
    },

    async download(externalId: string): Promise<Uint8Array> {
      const lien = await appeler(`${racine}/api/v1/documents/${externalId}/download`, {
        method: 'GET',
        headers: enTetes(),
      })
      const { downloadUrl } = (await lien.json()) as { downloadUrl: string }

      const fichier = await appeler(downloadUrl, { method: 'GET', headers: {} })
      return new Uint8Array(await fichier.arrayBuffer())
    },

    async remind(externalId: string): Promise<void> {
      const document = await lireDocument(externalId)
      await appeler(`${racine}/api/v1/documents/${externalId}/resend`, {
        method: 'POST',
        headers: enTetes(),
        body: JSON.stringify({ recipients: (document.recipients ?? []).map((r) => r.id) }),
      })
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

const EVENEMENTS: Record<string, SignatureStatus> = {
  DOCUMENT_COMPLETED: 'SIGNE',
  DOCUMENT_SIGNED: 'SIGNE',
  DOCUMENT_REJECTED: 'REFUSE',
  DOCUMENT_CANCELLED: 'EXPIRE',
  DOCUMENT_EXPIRED: 'EXPIRE',
}

/**
 * Lecture d'une charge utile de webhook Documenso.
 *
 * La clé d'idempotence est délibérément **plus grossière** que l'identifiant
 * de livraison du prestataire : `{événement}:{document}`. Deux livraisons du
 * même événement pour le même document sont un rejeu, quel que soit ce que le
 * prestataire raconte de sa propre livraison. Un renvoi après refus crée un
 * nouveau document chez Documenso, donc une nouvelle clé.
 */
export function parseDocumensoWebhook(
  rawBody: string,
): { externalId: string; statut: SignatureStatus; eventId: string } | null {
  let charge: unknown
  try {
    charge = JSON.parse(rawBody)
  } catch {
    return null
  }

  if (typeof charge !== 'object' || charge === null) return null
  const { event, payload } = charge as { event?: unknown; payload?: { id?: unknown } }

  if (typeof event !== 'string') return null
  const statut = EVENEMENTS[event]
  if (statut === undefined) return null

  const id = payload?.id
  if (typeof id !== 'string' && typeof id !== 'number') return null

  const externalId = String(id)
  return { externalId, statut, eventId: `${event}:${externalId}` }
}
```

`src/services/signature/fake-connector.ts` :

```ts
import type {
  SignatureConnector,
  SignatureEnvoi,
  SignatureStatus,
} from '@/core/signature/connector'
import { SignatureConnectorError } from '@/core/signature/connector'

export interface FakeSignatureConnector extends SignatureConnector {
  readonly envois: SignatureEnvoi[]
  readonly relances: string[]
  readonly telechargements: string[]
  /** force l'état que `status()` rendra pour cette référence */
  regler(externalId: string, statut: SignatureStatus): void
  /** pose le document signé que `download()` rendra */
  poserPdfSigne(externalId: string, pdf: Uint8Array): void
  /** fait échouer le prochain `send()` */
  faireEchouerEnvoi(message: string): void
  /** fait échouer tout `download()` — un archivage impossible ne doit rien bloquer */
  faireEchouerTelechargement(message: string): void
}

/**
 * Le double du connecteur, partagé par les tests des tâches 10 à 13.
 *
 * Il vit dans un fichier ordinaire et non dans un `*.test.ts` parce que
 * plusieurs suites en ont besoin. Il n'est importé par aucun code applicatif.
 */
export function createFakeSignatureConnector(): FakeSignatureConnector {
  const envois: SignatureEnvoi[] = []
  const relances: string[] = []
  const telechargements: string[] = []
  const statuts = new Map<string, SignatureStatus>()
  const signes = new Map<string, Uint8Array>()
  let echecEnvoi: string | null = null
  let echecTelechargement: string | null = null
  let compteur = 0

  return {
    provider: 'double',
    envois,
    relances,
    telechargements,

    regler(externalId, statut) {
      statuts.set(externalId, statut)
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

    async send(envoi) {
      if (echecEnvoi !== null) throw new SignatureConnectorError(echecEnvoi, 502)
      envois.push(envoi)
      compteur += 1
      const externalId = `ext-${compteur}`
      statuts.set(externalId, 'EN_ATTENTE')
      return externalId
    },

    async status(externalId) {
      return statuts.get(externalId) ?? 'EN_ATTENTE'
    },

    async download(externalId) {
      if (echecTelechargement !== null) {
        throw new SignatureConnectorError(echecTelechargement, 503)
      }
      telechargements.push(externalId)
      return signes.get(externalId) ?? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53])
    },

    async remind(externalId) {
      relances.push(externalId)
    },
  }
}
```

`src/services/signature/registry.ts` :

```ts
import type { SignatureConnector } from '@/core/signature/connector'
import { createDocumensoConnector } from './documenso'

/**
 * Le connecteur configuré, ou `null`.
 *
 * `null` n'est pas une panne : c'est le mode nominal d'une instance sans outil
 * de signature. Le PDF se génère et se télécharge, les transitions du CRA
 * restent manuelles comme au lot 0. Tout appelant doit traiter ce cas.
 */
export async function getSignatureConnector(): Promise<SignatureConnector | null> {
  const baseUrl = process.env.DOCUMENSO_URL ?? ''
  const apiKey = process.env.DOCUMENSO_API_KEY ?? ''
  if (baseUrl === '' || apiKey === '') return null

  return createDocumensoConnector({
    fetchFn: (url, init) => fetch(url, init as RequestInit),
    baseUrl,
    apiKey,
  })
}
```

`src/services/signature/registry.test.ts` :

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { getSignatureConnector } from './registry'

const initial = { url: process.env.DOCUMENSO_URL, cle: process.env.DOCUMENSO_API_KEY }

afterEach(() => {
  if (initial.url === undefined) delete process.env.DOCUMENSO_URL
  else process.env.DOCUMENSO_URL = initial.url
  if (initial.cle === undefined) delete process.env.DOCUMENSO_API_KEY
  else process.env.DOCUMENSO_API_KEY = initial.cle
})

describe('getSignatureConnector', () => {
  it('rend null sans configuration — l instance reste utilisable', async () => {
    delete process.env.DOCUMENSO_URL
    delete process.env.DOCUMENSO_API_KEY
    expect(await getSignatureConnector()).toBeNull()
  })

  it('rend null quand une seule des deux valeurs est posée', async () => {
    process.env.DOCUMENSO_URL = 'https://documenso.test'
    delete process.env.DOCUMENSO_API_KEY
    expect(await getSignatureConnector()).toBeNull()
  })

  it('rend le connecteur Documenso quand tout est posé', async () => {
    process.env.DOCUMENSO_URL = 'https://documenso.test'
    process.env.DOCUMENSO_API_KEY = 'api_cle'
    const connecteur = await getSignatureConnector()
    expect(connecteur?.provider).toBe('documenso')
  })
})
```

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/core/signature/ src/services/signature/`
Expected: PASS — 4 + 15 + 3 = 22 tests

- [ ] **Step 8: Compléter `.env.example`**

```bash
cat >> .env.example <<'EOF'

# Signature électronique (lot 3) — optionnelle.
# Sans ces deux valeurs, le PDF se génère et se télécharge, et les transitions
# du CRA restent manuelles.
DOCUMENSO_URL=""
DOCUMENSO_API_KEY=""
EOF
```

- [ ] **Step 9: Vérifier par mutation**

Dans `traduireStatut`, remplacer le repli `return 'EN_ATTENTE'` par `return 'SIGNE'`, et confirmer que « traduit tout le reste en EN_ATTENTE » échoue. Restaurer.

Dans `parseDocumensoWebhook`, faire entrer `webhookEventId` dans la clé, et confirmer que « construit une clé d idempotence indépendante du prestataire » échoue. Restaurer.

- [ ] **Step 10: Commit**

```bash
git add src/core/signature/ src/services/signature/ .env.example
git commit -m "feat(signature): connector contract, Documenso implementation and test double"
```

---

## Task 9: Authentification du webhook par signature de charge utile

**Files:** Create `src/core/signature/webhook.ts`, `src/core/signature/webhook.test.ts`

**Interfaces:**
- Consumes: `node:crypto`
- Produces:
  - `signWebhookPayload(rawBody: string, secret: string): string` — rend `'sha256=<hex>'`
  - `verifyWebhookSignature(rawBody: string, header: string, secret: string): boolean`

**Pourquoi pas un jeton dans l'URL.** Ce webhook fait franchir une transition qui **verrouille un mois** et peut déclencher une facturation en aval. Un jeton d'URL fuit dans les journaux d'accès, les en-têtes `Referer` et l'historique des proxys ; il ne prouve rien sur le contenu reçu. Une signature HMAC de la charge utile prouve à la fois l'origine **et** l'intégrité du message.

- [ ] **Step 1: Écrire le test qui échoue**

`src/core/signature/webhook.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { signWebhookPayload, verifyWebhookSignature } from './webhook'

const SECRET = 'un-secret-de-webhook'
const CHARGE = JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42 } })

describe('signWebhookPayload', () => {
  it('produit une signature préfixée et hexadécimale', () => {
    const signature = signWebhookPayload(CHARGE, SECRET)
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('est déterministe', () => {
    expect(signWebhookPayload(CHARGE, SECRET)).toBe(signWebhookPayload(CHARGE, SECRET))
  })

  it('change dès que la charge ou le secret change', () => {
    expect(signWebhookPayload(CHARGE, SECRET)).not.toBe(signWebhookPayload(`${CHARGE} `, SECRET))
    expect(signWebhookPayload(CHARGE, SECRET)).not.toBe(signWebhookPayload(CHARGE, 'autre'))
  })
})

describe('verifyWebhookSignature', () => {
  it('accepte une charge correctement signée', () => {
    expect(verifyWebhookSignature(CHARGE, signWebhookPayload(CHARGE, SECRET), SECRET)).toBe(true)
  })

  it('REFUSE une charge modifiée après signature', () => {
    // Le cœur du sujet : on ne protège pas l origine, on protège le contenu.
    const signature = signWebhookPayload(CHARGE, SECRET)
    const falsifiee = JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 99 } })
    expect(verifyWebhookSignature(falsifiee, signature, SECRET)).toBe(false)
  })

  it('refuse une signature produite avec un autre secret', () => {
    expect(verifyWebhookSignature(CHARGE, signWebhookPayload(CHARGE, 'autre'), SECRET)).toBe(false)
  })

  it('refuse quand le secret n est pas configuré', () => {
    // Un endpoint public qui verrouille un mois ne s ouvre pas « par défaut ».
    expect(verifyWebhookSignature(CHARGE, signWebhookPayload(CHARGE, ''), '')).toBe(false)
  })

  it('refuse un en-tête absent, vide ou mal formé sans jamais lever', () => {
    for (const entete of ['', 'sha256=', 'sha256=zz', 'nimporte quoi', 'md5=abcd']) {
      expect(verifyWebhookSignature(CHARGE, entete, SECRET)).toBe(false)
    }
  })

  it('supporte une signature de longueur différente sans lever', () => {
    // `timingSafeEqual` lève sur des longueurs différentes : le garde-fou
    // doit être explicite, sinon l endpoint rend 500 au lieu de 401.
    expect(() => verifyWebhookSignature(CHARGE, 'sha256=abcdef', SECRET)).not.toThrow()
    expect(verifyWebhookSignature(CHARGE, 'sha256=abcdef', SECRET)).toBe(false)
  })

  it('accepte la signature quel que soit la casse de l hexadécimal', () => {
    const signature = signWebhookPayload(CHARGE, SECRET)
    expect(verifyWebhookSignature(CHARGE, signature.toUpperCase().replace('SHA256', 'sha256'), SECRET)).toBe(true)
  })

  it('tolère l absence de préfixe', () => {
    const hex = signWebhookPayload(CHARGE, SECRET).slice('sha256='.length)
    expect(verifyWebhookSignature(CHARGE, hex, SECRET)).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/core/signature/webhook.test.ts`
Expected: FAIL — `Failed to resolve import "./webhook"`

- [ ] **Step 3: Écrire l'implémentation**

`src/core/signature/webhook.ts` :

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Authentification d'un webhook de signature.
 *
 * **Par signature de charge utile, jamais par un jeton dans l'URL.** Ce
 * webhook fait franchir une transition qui verrouille un mois et peut
 * déclencher une facturation en aval : un jeton d'URL fuit dans les journaux
 * d'accès et ne prouve rien sur le contenu reçu, quand un HMAC prouve
 * l'origine **et** l'intégrité.
 *
 * Module pur : `node:crypto` uniquement, ni Prisma, ni Next, ni React.
 */

const PREFIXE = 'sha256='

export function signWebhookPayload(rawBody: string, secret: string): string {
  return PREFIXE + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/**
 * Comparaison à temps constant. Le secret étant vérifié à chaque appel, une
 * comparaison naïve laisserait fuiter le condensat attendu octet par octet.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string,
  secret: string,
): boolean {
  // Sans secret configuré, aucune charge n'est authentique. Ne jamais
  // « laisser passer » ici : ce serait ouvrir la transition VALIDE à
  // n'importe quel appelant du réseau.
  if (secret === '') return false

  const fourni = (header.startsWith(PREFIXE) ? header.slice(PREFIXE.length) : header)
    .trim()
    .toLowerCase()

  if (!/^[0-9a-f]{64}$/.test(fourni)) return false

  const attendu = signWebhookPayload(rawBody, secret).slice(PREFIXE.length)

  const a = Buffer.from(fourni, 'hex')
  const b = Buffer.from(attendu, 'hex')
  // `timingSafeEqual` lève si les longueurs diffèrent ; le format ci-dessus
  // les garantit égales, ce test reste une ceinture de sécurité.
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/core/signature/webhook.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Vérifier par mutation**

Remplacer `if (secret === '') return false` par `if (secret === '') return true`, et confirmer que « refuse quand le secret n est pas configuré » échoue. Restaurer.

Remplacer `timingSafeEqual(a, b)` par `fourni === attendu` et confirmer que **tous** les tests restent verts — c'est attendu, la comparaison naïve est fonctionnellement identique. Le laisser en `timingSafeEqual` reste la bonne décision : le test ne peut pas mesurer une fuite temporelle, la revue de code oui. **Consigner ce point** dans le journal d'exécution.

- [ ] **Step 6: Commit**

```bash
git add src/core/signature/webhook.ts src/core/signature/webhook.test.ts
git commit -m "feat(security): HMAC payload signature for the signature webhook"
```

---

## Task 10: Envoi du CRA pour signature

**Files:** Create `src/services/signature/send.ts`, `src/services/signature/send.test.ts`

**Interfaces:**
- Consumes: `buildCraPdf` (tâche 5), `updateMissionSignataire`/`Mission.signataire*` (tâches 4 et 7), `SignatureConnector` et `getSignatureConnector` (tâche 8), `canTransition`/`applyTransition`
- Produces:
  ```ts
  type SendCraRaison = 'PAS_DE_CONNECTEUR' | 'PAS_DE_SIGNATAIRE' | 'TRANSITION_IMPOSSIBLE' | 'CONNECTEUR_EN_ECHEC'
  type SendCraResult =
    | { ok: true; externalId: string; status: CraStatus }
    | { ok: false; raison: SendCraRaison; message: string }
  sendCraForSignature(userId: string, craId: string,
                      options?: { connector?: SignatureConnector | null }): Promise<SendCraResult>
  ```

**L'ordre est la garantie.** Le PDF est composé, confié au connecteur, **puis seulement** le CRA passe à `ENVOYE`. Transitionner d'abord laisserait, au moindre échec réseau, un CRA marqué envoyé que personne n'a reçu — et un mois qu'on ne peut plus rouvrir sans passer par `REFUSER`.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/signature/send.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { createFakeSignatureConnector } from './fake-connector'
import { ENTITY_CRA } from './constants'
import { sendCraForSignature } from './send'

let userId = ''
let autreUserId = ''
let missionId = ''
let lineId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'send@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'send-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = a.id

  const c = await createClient('SEND client')
  const m = await createMission({
    clientId: c.id,
    label: 'Consultant ITSM',
    signataireNom: 'Claire Martin',
    signataireEmail: 'claire@send.test',
  })
  missionId = m.id
  lineId = (await createLine({ missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })).id
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  await prisma.mission.update({
    where: { id: missionId },
    data: { signataireNom: 'Claire Martin', signataireEmail: 'claire@send.test' },
  })
  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await saveEntry({ userId, lineId, date: '2026-06-01', minutes: 480, kind: 'REALISE' })
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['send@test.local', 'send-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'SEND client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('sendCraForSignature', () => {
  it('confie le PDF au connecteur et fait passer le CRA à ENVOYE', async () => {
    const connector = createFakeSignatureConnector()
    const r = await sendCraForSignature(userId, craId, { connector })

    expect(r).toEqual({ ok: true, externalId: 'ext-1', status: 'ENVOYE' })
    expect(connector.envois).toHaveLength(1)
    expect(connector.envois[0]!.destinataire).toEqual({
      nom: 'Claire Martin',
      email: 'claire@send.test',
    })
    expect(Buffer.from(connector.envois[0]!.pdf).toString('latin1').startsWith('%PDF-')).toBe(true)
    expect(connector.envois[0]!.titre).toContain('juin 2026')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('enregistre la référence externe dans ExternalLink', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector })

    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: ENTITY_CRA,
          entityId: craId,
          provider: 'double',
        },
      },
    })
    expect(lien.externalId).toBe('ext-1')
    expect(lien.syncState).toBe('EN_ATTENTE')
  })

  it('ouvre une demande de signature en attente, sans relance', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.status).toBe('EN_ATTENTE')
    expect(demande.relances).toBe(0)
    expect(demande.abandoned).toBe(false)
    expect(demande.signedPdf).toBeNull()
    // Le destinataire est figé : changer le signataire de la mission ensuite
    // ne réécrit pas à qui le document a été adressé.
    expect(demande.signataireEmail).toBe('claire@send.test')
  })

  it('SANS CONNECTEUR, ne touche à rien et le dit', async () => {
    const r = await sendCraForSignature(userId, craId, { connector: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_CONNECTEUR')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
    expect(await prisma.signatureRequest.findUnique({ where: { craId } })).toBeNull()
  })

  it('la transition manuelle reste possible sans connecteur', async () => {
    await sendCraForSignature(userId, craId, { connector: null })
    const apres = await transitionCra(userId, craId, 'ENVOYER')
    expect(apres.status).toBe('ENVOYE')
  })

  it('refuse d envoyer sans signataire renseigné', async () => {
    await prisma.mission.update({
      where: { id: missionId },
      data: { signataireNom: '', signataireEmail: '' },
    })
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_SIGNATAIRE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
  })

  it('NE TRANSITIONNE PAS quand le connecteur échoue', async () => {
    // Un CRA marqué envoyé que personne n a reçu est pire que pas d envoi du tout.
    const connector = createFakeSignatureConnector()
    connector.faireEchouerEnvoi('Le prestataire est injoignable.')

    const r = await sendCraForSignature(userId, craId, { connector })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('CONNECTEUR_EN_ECHEC')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
    expect(await prisma.signatureRequest.findUnique({ where: { craId } })).toBeNull()
    expect(
      await prisma.externalLink.findFirst({ where: { entityType: ENTITY_CRA, entityId: craId } }),
    ).toBeNull()
  })

  it('refuse d envoyer un CRA déjà validé', async () => {
    await prisma.cra.update({ where: { id: craId }, data: { status: 'VALIDE' } })
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('TRANSITION_IMPOSSIBLE')
  })

  it('remplace la demande précédente après un refus, et remet les relances à zéro', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector })
    await prisma.signatureRequest.update({
      where: { craId },
      data: { status: 'REFUSE', relances: 3, abandoned: true, completedAt: new Date() },
    })
    await prisma.cra.update({ where: { id: craId }, data: { status: 'BROUILLON' } })

    const r = await sendCraForSignature(userId, craId, { connector })
    expect(r.ok).toBe(true)

    const demandes = await prisma.signatureRequest.findMany({ where: { craId } })
    expect(demandes).toHaveLength(1)
    expect(demandes[0]!.status).toBe('EN_ATTENTE')
    expect(demandes[0]!.relances).toBe(0)
    expect(demandes[0]!.abandoned).toBe(false)
    expect(demandes[0]!.completedAt).toBeNull()

    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: ENTITY_CRA, entityId: craId },
    })
    expect(lien.externalId).toBe('ext-2')
  })

  it('efface le PDF archivé quand on renvoie — l archive suit le document en cours', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector })
    await prisma.signatureRequest.update({
      where: { craId },
      data: { signedPdf: Buffer.from('ancien'), status: 'REFUSE' },
    })
    await prisma.cra.update({ where: { id: craId }, data: { status: 'BROUILLON' } })

    await sendCraForSignature(userId, craId, { connector })
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).toBeNull()
  })

  it('refuse le CRA d un autre utilisateur', async () => {
    const r = await sendCraForSignature(autreUserId, craId, {
      connector: createFakeSignatureConnector(),
    })
    expect(r.ok).toBe(false)

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/signature/send.test.ts`
Expected: FAIL — `Failed to resolve import "./send"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/signature/send.ts` :

```ts
import { prisma } from '@/db/client'
import { applyTransition, canTransition } from '@/core/cra/state-machine'
import { libelleMois } from '@/core/cra/document'
import type { SignatureConnector } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import { buildCraPdf } from '@/services/cra-pdf'
import { ENTITY_CRA } from './constants'
import { getSignatureConnector } from './registry'

export type SendCraRaison =
  | 'PAS_DE_CONNECTEUR'
  | 'PAS_DE_SIGNATAIRE'
  | 'TRANSITION_IMPOSSIBLE'
  | 'CONNECTEUR_EN_ECHEC'

export type SendCraResult =
  | { ok: true; externalId: string; status: CraStatus }
  | { ok: false; raison: SendCraRaison; message: string }

const MESSAGES: Record<SendCraRaison, string> = {
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Le CRA reste téléchargeable et les transitions manuelles restent disponibles.',
  PAS_DE_SIGNATAIRE:
    'Renseignez le signataire de la mission (nom et adresse électronique) avant d’envoyer le CRA.',
  TRANSITION_IMPOSSIBLE: 'Ce CRA ne peut pas être envoyé dans son état actuel.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas accepté le document. Le CRA n’a pas changé d’état.',
}

function echec(raison: SendCraRaison): SendCraResult {
  return { ok: false, raison, message: MESSAGES[raison] }
}

/**
 * Envoie le CRA au signataire de sa mission.
 *
 * **L'ordre des opérations est la garantie du circuit** : le document est
 * composé, confié au connecteur, et le CRA ne passe à `ENVOYE` qu'ensuite.
 * Transitionner d'abord laisserait, au moindre échec, un CRA marqué envoyé
 * que personne n'a reçu.
 *
 * `options.connector` sert aux tests et aux appelants qui ont déjà résolu le
 * connecteur ; sans lui, le registre décide — et peut rendre `null`, qui
 * n'est pas une panne mais le mode nominal d'une instance sans outil de
 * signature.
 */
export async function sendCraForSignature(
  userId: string,
  craId: string,
  options: { connector?: SignatureConnector | null } = {},
): Promise<SendCraResult> {
  const cra = await prisma.cra.findFirst({
    where: { id: craId, userId },
    include: { mission: { include: { client: true } } },
  })
  if (cra === null) return echec('TRANSITION_IMPOSSIBLE')

  const statut = cra.status as CraStatus
  if (!canTransition(statut, 'ENVOYER')) return echec('TRANSITION_IMPOSSIBLE')

  const destinataire = {
    nom: cra.mission.signataireNom,
    email: cra.mission.signataireEmail,
  }
  if (destinataire.email === '') return echec('PAS_DE_SIGNATAIRE')

  const connector =
    options.connector !== undefined ? options.connector : await getSignatureConnector()
  if (connector === null) return echec('PAS_DE_CONNECTEUR')

  const { fileName, bytes } = await buildCraPdf(userId, craId)
  const mois = cra.month.toISOString().slice(0, 7)
  const titre = `CRA ${cra.mission.client.name} — ${cra.mission.label} — ${libelleMois(mois)}`

  let externalId: string
  try {
    externalId = await connector.send({ titre, fileName, pdf: bytes, destinataire })
  } catch {
    return echec('CONNECTEUR_EN_ECHEC')
  }

  const maintenant = new Date()

  // Une seule demande par CRA : renvoyer remplace, et remet à zéro tout ce
  // qui appartenait à l'envoi précédent — relances, abandon, archive.
  await prisma.signatureRequest.upsert({
    where: { craId },
    create: {
      craId,
      provider: connector.provider,
      status: 'EN_ATTENTE',
      signataireNom: destinataire.nom,
      signataireEmail: destinataire.email,
      sentAt: maintenant,
    },
    update: {
      provider: connector.provider,
      status: 'EN_ATTENTE',
      signataireNom: destinataire.nom,
      signataireEmail: destinataire.email,
      sentAt: maintenant,
      relances: 0,
      lastRelanceAt: null,
      completedAt: null,
      abandoned: false,
      signedPdf: null,
    },
  })

  await prisma.externalLink.upsert({
    where: {
      entityType_entityId_provider: {
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: connector.provider,
      },
    },
    create: {
      entityType: ENTITY_CRA,
      entityId: craId,
      provider: connector.provider,
      externalId,
      syncState: 'EN_ATTENTE',
      syncedAt: maintenant,
    },
    update: { externalId, syncState: 'EN_ATTENTE', syncedAt: maintenant },
  })

  const suivant = applyTransition(statut, 'ENVOYER')
  await prisma.cra.update({ where: { id: craId }, data: { status: suivant } })

  return { ok: true, externalId, status: suivant }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/signature/send.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Vérifier par mutation**

Déplacer le `prisma.cra.update` **avant** l'appel au connecteur, et confirmer que « NE TRANSITIONNE PAS quand le connecteur échoue » échoue. Restaurer.

Retirer `userId` du `findFirst`, et confirmer que « refuse le CRA d un autre utilisateur » échoue. Restaurer.

- [ ] **Step 6: Commit**

```bash
git add src/services/signature/send.ts src/services/signature/send.test.ts
git commit -m "feat(signature): send a CRA for signature, transition only after success"
```

---

## Task 11: Réception du webhook — transition, verrou, idempotence, archivage

**Files:** Create `src/services/signature/apply.ts`, `src/services/signature/apply.test.ts`, `src/services/signature/webhook.ts`, `src/services/signature/webhook.test.ts`, `src/app/api/webhooks/signature/route.ts`, `src/app/api/webhooks/signature/route.test.ts`. Modify `src/middleware.ts`

**Interfaces:**
- Consumes: `verifyWebhookSignature` (tâche 9), `parseDocumensoWebhook`, `SignatureConnector` (tâche 8), `ENTITY_CRA`
- Produces:
  ```ts
  // apply.ts
  type SignatureEffet = 'VALIDE' | 'REFUSE' | 'EXPIRE' | 'AUCUN'
  applySignatureStatus(args: { craId: string; externalId: string; statut: SignatureStatus
                               connector?: SignatureConnector | null }): Promise<SignatureEffet>

  // webhook.ts
  type WebhookOutcome =
    | { ok: true; effet: SignatureEffet | 'REJOUE'; craId: string | null }
    | { ok: false; raison: 'SIGNATURE_INVALIDE' | 'CHARGE_ILLISIBLE' | 'LIEN_INCONNU' }
  handleSignatureWebhook(args: { rawBody: string; signatureHeader: string
                                 secret?: string
                                 connector?: SignatureConnector | null }): Promise<WebhookOutcome>
  ```

**Un seul applicateur.** `applySignatureStatus` est partagé par le webhook et par le rafraîchissement à la demande (tâche 12). Deux chemins qui appliquent le même statut différemment finiraient par diverger, et c'est un verrou de mois qui en dépend.

- [ ] **Step 1: Écrire le test de l'applicateur**

`src/services/signature/apply.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { createFakeSignatureConnector } from './fake-connector'
import { applySignatureStatus } from './apply'

let userId = ''
let missionId = ''
let lineId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'apply@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('APPLY client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineId = (await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
  await prisma.signatureRequest.create({
    data: { craId, provider: 'double', status: 'EN_ATTENTE' },
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'apply@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'APPLY client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('applySignatureStatus', () => {
  it('SIGNE fait passer le CRA à VALIDE et archive le document signé', async () => {
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53]))

    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'SIGNE',
      connector,
    })
    expect(effet).toBe('VALIDE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.status).toBe('SIGNE')
    expect(demande.completedAt).not.toBeNull()
    expect(Array.from(demande.signedPdf!)).toEqual([0x25, 0x50, 0x44, 0x46, 0x53])
  })

  it('VALIDE VERROUILLE LE MOIS, quelle que soit la voie empruntée', async () => {
    await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'SIGNE',
      connector: createFakeSignatureConnector(),
    })

    const r = await saveEntry({ userId, lineId, date: '2026-06-02', minutes: 480, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
  })

  it('n archive jamais deux fois — un document signé se conserve, il ne se recalcule pas', async () => {
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([1, 2, 3]))
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector })

    connector.poserPdfSigne('ext-1', new Uint8Array([9, 9, 9]))
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Array.from(demande.signedPdf!)).toEqual([1, 2, 3])
    expect(connector.telechargements).toEqual(['ext-1'])
  })

  it('valide quand même si l archivage échoue — un téléchargement raté ne bloque rien', async () => {
    const connector = createFakeSignatureConnector()
    connector.faireEchouerTelechargement('Le prestataire est injoignable.')

    const effet = await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector })
    expect(effet).toBe('VALIDE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).toBeNull()
  })

  it('valide sans connecteur, en se passant simplement d archive', async () => {
    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'SIGNE',
      connector: null,
    })
    expect(effet).toBe('VALIDE')
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).toBeNull()
  })

  it('UN REFUS ROUVRE LE CRA', async () => {
    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'REFUSE',
      connector: createFakeSignatureConnector(),
    })
    expect(effet).toBe('REFUSE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('REFUSE')

    // Rouvrable, donc modifiable à nouveau.
    const r = await saveEntry({ userId, lineId, date: '2026-06-03', minutes: 480, kind: 'REALISE' })
    expect(r.ok).toBe(true)
  })

  it('une expiration marque la demande sans toucher au CRA', async () => {
    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'EXPIRE',
      connector: createFakeSignatureConnector(),
    })
    expect(effet).toBe('EXPIRE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.status).toBe('EXPIRE')
  })

  it('EN_ATTENTE ne fait rien', async () => {
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'EN_ATTENTE', connector: null }),
    ).toBe('AUCUN')
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('est idempotent : appliquer SIGNE deux fois ne fait rien la seconde', async () => {
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null })
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null }),
    ).toBe('AUCUN')
  })

  it('ne rouvre jamais un CRA déjà validé sur un refus tardif', async () => {
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null })
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'REFUSE', connector: null }),
    ).toBe('AUCUN')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
  })

  it('ne fait rien sur un CRA inconnu', async () => {
    expect(
      await applySignatureStatus({ craId: 'inexistant', externalId: 'x', statut: 'SIGNE', connector: null }),
    ).toBe('AUCUN')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/signature/apply.test.ts`
Expected: FAIL — `Failed to resolve import "./apply"`

- [ ] **Step 3: Écrire l'applicateur**

`src/services/signature/apply.ts` :

```ts
import { prisma } from '@/db/client'
import { applyTransition, canTransition, type CraTransition } from '@/core/cra/state-machine'
import type { SignatureConnector, SignatureStatus } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'

export type SignatureEffet = 'VALIDE' | 'REFUSE' | 'EXPIRE' | 'AUCUN'

const TRANSITION_PAR_STATUT: Partial<Record<SignatureStatus, CraTransition>> = {
  SIGNE: 'VALIDER',
  REFUSE: 'REFUSER',
}

/**
 * Applique à un CRA l'état que le prestataire de signature rapporte.
 *
 * **Un seul applicateur pour deux chemins** : le webhook (tâche 11) et le
 * rafraîchissement à la demande (tâche 12) passent tous les deux par ici. Deux
 * implémentations finiraient par diverger, et c'est le verrou d'un mois qui en
 * dépend.
 *
 * L'identification passe par `craId`, résolu en amont depuis `ExternalLink` :
 * un webhook n'a pas de session, il est authentifié par la signature de sa
 * charge utile.
 *
 * Idempotent par construction : si la transition n'est pas franchissable
 * depuis l'état courant — parce qu'elle l'a déjà été — l'effet est `AUCUN`.
 */
export async function applySignatureStatus(args: {
  craId: string
  externalId: string
  statut: SignatureStatus
  connector?: SignatureConnector | null
}): Promise<SignatureEffet> {
  const cra = await prisma.cra.findUnique({
    where: { id: args.craId },
    select: { id: true, status: true },
  })
  if (cra === null) return 'AUCUN'

  const maintenant = new Date()

  if (args.statut === 'EXPIRE') {
    // L'expiration est un fait du prestataire, pas une décision du client :
    // le CRA reste ENVOYE et remonte dans la liste des CRA en souffrance.
    await marquerDemande(args.craId, { status: 'EXPIRE' })
    return 'EXPIRE'
  }

  const transition = TRANSITION_PAR_STATUT[args.statut]
  if (transition === undefined) return 'AUCUN'

  const statut = cra.status as CraStatus
  if (!canTransition(statut, transition)) return 'AUCUN'

  if (args.statut === 'SIGNE') {
    await archiverSiPossible(args.craId, args.externalId, args.connector ?? null)
  }

  await marquerDemande(args.craId, { status: args.statut, completedAt: maintenant })

  await prisma.cra.update({
    where: { id: args.craId },
    data: { status: applyTransition(statut, transition) },
  })

  return args.statut === 'SIGNE' ? 'VALIDE' : 'REFUSE'
}

async function marquerDemande(
  craId: string,
  data: { status: string; completedAt?: Date },
): Promise<void> {
  // `updateMany` plutôt que `update` : une transition manuelle a pu faire
  // arriver le CRA ici sans qu'aucune demande n'ait jamais été ouverte.
  await prisma.signatureRequest.updateMany({ where: { craId }, data })
}

/**
 * Archive le PDF signé — **une seule fois, et jamais en écrasant**.
 *
 * Un échec de téléchargement ne bloque rien : la signature a eu lieu, le CRA
 * doit être validé même si l'archive arrive plus tard (par un
 * rafraîchissement à la demande) ou jamais.
 */
async function archiverSiPossible(
  craId: string,
  externalId: string,
  connector: SignatureConnector | null,
): Promise<void> {
  if (connector === null) return

  const demande = await prisma.signatureRequest.findUnique({
    where: { craId },
    select: { signedPdf: true },
  })
  if (demande === null || demande.signedPdf != null) return

  try {
    const octets = await connector.download(externalId)
    await prisma.signatureRequest.update({
      where: { craId },
      data: { signedPdf: Buffer.from(octets) },
    })
  } catch {
    // Volontairement silencieux : l'archivage est un plus, la validation est
    // le fait. Le rafraîchissement à la demande retentera.
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/signature/apply.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Écrire le test du webhook**

`src/services/signature/webhook.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { signWebhookPayload } from '@/core/signature/webhook'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { createFakeSignatureConnector } from './fake-connector'
import { ENTITY_CRA, PROVIDER_DOCUMENSO } from './constants'
import { handleSignatureWebhook } from './webhook'

const SECRET = 'secret-de-webhook-de-test'

let userId = ''
let missionId = ''
let lineId = ''
let craId = ''

function charge(event: string, id: string): string {
  return JSON.stringify({ event, payload: { id } })
}

async function recevoir(
  rawBody: string,
  options: { secret?: string; signature?: string; connector?: ReturnType<typeof createFakeSignatureConnector> | null } = {},
) {
  return handleSignatureWebhook({
    rawBody,
    signatureHeader: options.signature ?? signWebhookPayload(rawBody, options.secret ?? SECRET),
    secret: SECRET,
    connector: options.connector ?? null,
  })
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'wh@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('WH client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineId = (await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.signatureWebhookEvent.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
  await prisma.signatureRequest.create({
    data: { craId, provider: PROVIDER_DOCUMENSO, status: 'EN_ATTENTE' },
  })
  await prisma.externalLink.create({
    data: {
      entityType: ENTITY_CRA,
      entityId: craId,
      provider: PROVIDER_DOCUMENSO,
      externalId: '42',
      syncState: 'EN_ATTENTE',
    },
  })
})

afterAll(async () => {
  await prisma.signatureWebhookEvent.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'wh@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'WH client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('authentification', () => {
  it('REJETTE une charge mal signée', async () => {
    const r = await recevoir(charge('DOCUMENT_COMPLETED', '42'), { signature: 'sha256=' + '0'.repeat(64) })
    expect(r).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('REJETTE une charge modifiée après signature', async () => {
    const authentique = charge('DOCUMENT_COMPLETED', '42')
    const signature = signWebhookPayload(authentique, SECRET)
    const falsifiee = charge('DOCUMENT_COMPLETED', '99')

    const r = await handleSignatureWebhook({
      rawBody: falsifiee,
      signatureHeader: signature,
      secret: SECRET,
      connector: null,
    })
    expect(r).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })
  })

  it('rejette quand aucun secret n est configuré', async () => {
    const corps = charge('DOCUMENT_COMPLETED', '42')
    const r = await handleSignatureWebhook({
      rawBody: corps,
      signatureHeader: signWebhookPayload(corps, ''),
      secret: '',
      connector: null,
    })
    expect(r).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })
  })

  it('rejette une charge illisible', async () => {
    expect(await recevoir('ceci n est pas du json')).toEqual({
      ok: false,
      raison: 'CHARGE_ILLISIBLE',
    })
  })

  it('rejette un événement sans correspondance connue', async () => {
    expect(await recevoir(charge('DOCUMENT_OPENED', '42'))).toEqual({
      ok: false,
      raison: 'CHARGE_ILLISIBLE',
    })
  })

  it('rend LIEN_INCONNU pour une référence externe qu on ne connaît pas', async () => {
    expect(await recevoir(charge('DOCUMENT_COMPLETED', '9999'))).toEqual({
      ok: false,
      raison: 'LIEN_INCONNU',
    })
  })
})

describe('effet', () => {
  it('UNE CHARGE VALIDE FAIT FRANCHIR LA TRANSITION ET VERROUILLE LE MOIS', async () => {
    const r = await recevoir(charge('DOCUMENT_COMPLETED', '42'), {
      connector: createFakeSignatureConnector(),
    })
    expect(r).toEqual({ ok: true, effet: 'VALIDE', craId })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')

    const ecriture = await saveEntry({
      userId,
      lineId,
      date: '2026-06-02',
      minutes: 480,
      kind: 'REALISE',
    })
    expect(ecriture).toEqual({ ok: false, reason: 'VERROUILLE' })
  })

  it('UN WEBHOOK REJOUÉ DEUX FOIS N A AUCUN EFFET LA SECONDE', async () => {
    const corps = charge('DOCUMENT_COMPLETED', '42')
    expect((await recevoir(corps)).ok).toBe(true)

    // Le CRA est rouvert entre-temps : si le rejeu agissait, il le
    // reverrouillerait à tort.
    await transitionCra(userId, craId, 'ROUVRIR')

    const rejeu = await recevoir(corps)
    expect(rejeu).toEqual({ ok: true, effet: 'REJOUE', craId: null })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
  })

  it('un refus fait passer à REFUSE et rouvre le CRA à l écriture', async () => {
    const r = await recevoir(charge('DOCUMENT_REJECTED', '42'))
    expect(r).toEqual({ ok: true, effet: 'REFUSE', craId })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('REFUSE')
    expect((await saveEntry({ userId, lineId, date: '2026-06-04', minutes: 480, kind: 'REALISE' })).ok).toBe(true)
  })

  it('archive le PDF signé', async () => {
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('42', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53]))
    await recevoir(charge('DOCUMENT_COMPLETED', '42'), { connector })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Array.from(demande.signedPdf!)).toEqual([0x25, 0x50, 0x44, 0x46, 0x53])
  })

  it('une annulation marque l expiration sans toucher au CRA', async () => {
    const r = await recevoir(charge('DOCUMENT_CANCELLED', '42'))
    expect(r).toEqual({ ok: true, effet: 'EXPIRE', craId })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('consigne l événement traité, une seule fois', async () => {
    await recevoir(charge('DOCUMENT_COMPLETED', '42'))
    await recevoir(charge('DOCUMENT_COMPLETED', '42'))

    const evenements = await prisma.signatureWebhookEvent.findMany({})
    expect(evenements).toHaveLength(1)
    expect(evenements[0]!.eventId).toBe('DOCUMENT_COMPLETED:42')
  })

  it('ne consigne rien quand la signature est mauvaise', async () => {
    await recevoir(charge('DOCUMENT_COMPLETED', '42'), { signature: 'sha256=' + '0'.repeat(64) })
    expect(await prisma.signatureWebhookEvent.count()).toBe(0)
  })
})
```

- [ ] **Step 6: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/signature/webhook.test.ts`
Expected: FAIL — `Failed to resolve import "./webhook"`

- [ ] **Step 7: Écrire le service de réception et la route**

`src/services/signature/webhook.ts` :

```ts
import { prisma } from '@/db/client'
import { verifyWebhookSignature } from '@/core/signature/webhook'
import type { SignatureConnector } from '@/core/signature/connector'
import { applySignatureStatus, type SignatureEffet } from './apply'
import { ENTITY_CRA, PROVIDER_DOCUMENSO } from './constants'
import { parseDocumensoWebhook } from './documenso'
import { getSignatureConnector } from './registry'

export type WebhookOutcome =
  | { ok: true; effet: SignatureEffet | 'REJOUE'; craId: string | null }
  | { ok: false; raison: 'SIGNATURE_INVALIDE' | 'CHARGE_ILLISIBLE' | 'LIEN_INCONNU' }

/**
 * Réception d'un webhook de signature.
 *
 * Trois barrières, dans cet ordre :
 *
 * 1. **La signature de la charge utile.** Sans secret configuré ou sans
 *    signature valide, rien ne se passe : ce webhook fait franchir une
 *    transition qui verrouille un mois et peut déclencher une facturation en
 *    aval.
 * 2. **La lecture de la charge**, propre au prestataire.
 * 3. **L'unicité de l'événement.** Consignée *avant* d'agir : c'est ce qui
 *    garantit qu'un rejeu n'a aucun effet, même si l'application redémarre
 *    entre deux livraisons. La contrepartie assumée est qu'un événement dont
 *    le traitement échoue ne sera pas rejoué automatiquement — le
 *    rafraîchissement à la demande est là pour ça.
 */
export async function handleSignatureWebhook(args: {
  rawBody: string
  signatureHeader: string
  secret?: string
  connector?: SignatureConnector | null
}): Promise<WebhookOutcome> {
  const secret = args.secret ?? process.env.SIGNATURE_WEBHOOK_SECRET ?? ''

  if (!verifyWebhookSignature(args.rawBody, args.signatureHeader, secret)) {
    return { ok: false, raison: 'SIGNATURE_INVALIDE' }
  }

  const lu = parseDocumensoWebhook(args.rawBody)
  if (lu === null) return { ok: false, raison: 'CHARGE_ILLISIBLE' }

  try {
    await prisma.signatureWebhookEvent.create({
      data: { provider: PROVIDER_DOCUMENSO, eventId: lu.eventId },
    })
  } catch {
    // L'unicité (provider, eventId) a parlé : cet événement a déjà été traité.
    return { ok: true, effet: 'REJOUE', craId: null }
  }

  const lien = await prisma.externalLink.findFirst({
    where: {
      entityType: ENTITY_CRA,
      provider: PROVIDER_DOCUMENSO,
      externalId: lu.externalId,
    },
    select: { entityId: true },
  })
  if (lien === null) return { ok: false, raison: 'LIEN_INCONNU' }

  const connector =
    args.connector !== undefined ? args.connector : await getSignatureConnector()

  const effet = await applySignatureStatus({
    craId: lien.entityId,
    externalId: lu.externalId,
    statut: lu.statut,
    connector,
  })

  await prisma.externalLink.updateMany({
    where: { entityType: ENTITY_CRA, entityId: lien.entityId, provider: PROVIDER_DOCUMENSO },
    data: { syncState: lu.statut, syncedAt: new Date() },
  })

  return { ok: true, effet, craId: lien.entityId }
}
```

`src/app/api/webhooks/signature/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { handleSignatureWebhook } from '@/services/signature/webhook'

const CODES: Record<string, number> = {
  SIGNATURE_INVALIDE: 401,
  CHARGE_ILLISIBLE: 400,
  // Une référence inconnue n'est pas une erreur du prestataire : on accuse
  // réception pour qu'il cesse de réessayer, sans rien révéler de ce qui
  // existe ou non de notre côté.
  LIEN_INCONNU: 202,
}

/**
 * Endpoint public, **authentifié par la signature de la charge utile** et non
 * par un jeton d'URL. Il n'a pas de session : il est sorti du matcher du
 * middleware.
 *
 * Le corps est lu en texte brut avant tout : un HMAC porte sur les octets
 * reçus, pas sur le résultat d'un aller-retour JSON qui réordonnerait les
 * clés.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()
  const signatureHeader =
    request.headers.get('x-documenso-signature') ?? request.headers.get('x-cra-signature') ?? ''

  const resultat = await handleSignatureWebhook({ rawBody, signatureHeader })

  if (!resultat.ok) {
    return NextResponse.json({ resultat: resultat.raison }, { status: CODES[resultat.raison] ?? 400 })
  }

  return NextResponse.json({ resultat: resultat.effet }, { status: 200 })
}
```

`src/app/api/webhooks/signature/route.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { etat } = vi.hoisted(() => ({
  etat: {
    resultat: { ok: true, effet: 'VALIDE', craId: 'cra-1' } as unknown,
    appels: [] as Array<{ rawBody: string; signatureHeader: string }>,
  },
}))

vi.mock('@/services/signature/webhook', () => ({
  handleSignatureWebhook: async (args: { rawBody: string; signatureHeader: string }) => {
    etat.appels.push({ rawBody: args.rawBody, signatureHeader: args.signatureHeader })
    return etat.resultat
  },
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { POST } from './route'

function requete(corps: string, entetes: Record<string, string> = {}): Promise<Response> {
  return POST(new Request('http://local/api/webhooks/signature', { method: 'POST', body: corps, headers: entetes }))
}

describe('POST /api/webhooks/signature', () => {
  beforeEach(() => {
    etat.appels.length = 0
    etat.resultat = { ok: true, effet: 'VALIDE', craId: 'cra-1' }
  })

  it('transmet le corps BRUT et l en-tête de signature', async () => {
    const corps = '{"event":"DOCUMENT_COMPLETED","payload":{"id":42}}'
    await requete(corps, { 'x-documenso-signature': 'sha256=abc' })
    expect(etat.appels).toEqual([{ rawBody: corps, signatureHeader: 'sha256=abc' }])
  })

  it('accepte aussi l en-tête générique', async () => {
    await requete('{}', { 'x-cra-signature': 'sha256=def' })
    expect(etat.appels[0]!.signatureHeader).toBe('sha256=def')
  })

  it('rend 200 et l effet obtenu', async () => {
    const r = await requete('{}')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ resultat: 'VALIDE' })
  })

  it('rend 401 sur une signature invalide', async () => {
    etat.resultat = { ok: false, raison: 'SIGNATURE_INVALIDE' }
    expect((await requete('{}')).status).toBe(401)
  })

  it('rend 400 sur une charge illisible', async () => {
    etat.resultat = { ok: false, raison: 'CHARGE_ILLISIBLE' }
    expect((await requete('{}')).status).toBe(400)
  })

  it('accuse réception d une référence inconnue sans rien révéler', async () => {
    etat.resultat = { ok: false, raison: 'LIEN_INCONNU' }
    const r = await requete('{}')
    expect(r.status).toBe(202)
    expect(JSON.stringify(await r.json())).not.toContain('cra')
  })
})
```

Enfin, dans `src/middleware.ts`, sortir les endpoints publics du matcher — ils portent leur propre protection et n'ont pas de session :

```ts
export const config = {
  matcher: [
    '/((?!api/auth|api/webhooks|api/jobs|_next/static|_next/image|favicon.ico).*)',
  ],
}
```

> Si le lot 2 a déjà ajouté `api/sync` à cette liste, le conserver : les trois exclusions coexistent.

- [ ] **Step 8: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/signature/ src/app/api/webhooks/`
Expected: PASS — 13 (webhook) + 6 (route) + les tests des tâches 8, 10, 11

- [ ] **Step 9: Compléter `.env.example`**

```bash
cat >> .env.example <<'EOF'

# Secret partagé avec le prestataire de signature. Sans lui, aucun webhook
# n'est accepté — l'endpoint ne s'ouvre jamais « par défaut ».
SIGNATURE_WEBHOOK_SECRET=""
EOF
```

- [ ] **Step 10: Vérifier par mutation**

Déplacer la consignation de l'événement **après** `applySignatureStatus`, et confirmer que « UN WEBHOOK REJOUÉ DEUX FOIS N A AUCUN EFFET LA SECONDE » échoue. Restaurer.

Remplacer `if (!verifyWebhookSignature(...))` par `if (false)`, et confirmer que « REJETTE une charge modifiée après signature » échoue. Restaurer.

- [ ] **Step 11: Vérifier et commiter**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

```bash
git add src/services/signature/apply.ts src/services/signature/apply.test.ts \
        src/services/signature/webhook.ts src/services/signature/webhook.test.ts \
        src/app/api/webhooks src/middleware.ts .env.example
git commit -m "feat(signature): signed webhook applies the transition, idempotent on replay"
```

---

## Task 12: Rafraîchissement à la demande

**Files:** Create `src/services/signature/refresh.ts`, `src/services/signature/refresh.test.ts`

**Interfaces:**
- Consumes: `applySignatureStatus` (tâche 11), `SignatureConnector`, `ENTITY_CRA`
- Produces:
  ```ts
  type RefreshResult =
    | { ok: true; statut: SignatureStatus; effet: SignatureEffet }
    | { ok: false; raison: 'PAS_DE_DEMANDE' | 'PAS_DE_CONNECTEUR' | 'CONNECTEUR_EN_ECHEC'; message: string }
  refreshSignatureStatus(userId: string, craId: string,
                         options?: { connector?: SignatureConnector | null }): Promise<RefreshResult>
  ```

**Un webhook perdu ne bloque jamais rien.** C'est la raison d'être de cette tâche : un circuit qui dépend d'un webhook qui n'arrive jamais est un circuit cassé. Le rafraîchissement interroge `status()` et passe par **le même applicateur** que le webhook ; et la transition manuelle reste de toute façon accessible.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/signature/refresh.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { createFakeSignatureConnector } from './fake-connector'
import { ENTITY_CRA } from './constants'
import { refreshSignatureStatus } from './refresh'

let userId = ''
let autreUserId = ''
let missionId = ''
let lineId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'refresh@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'refresh-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = a.id

  const c = await createClient('REFRESH client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineId = (await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['refresh@test.local', 'refresh-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'REFRESH client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function demandeEnCours(provider = 'double'): Promise<void> {
  await prisma.signatureRequest.create({ data: { craId, provider, status: 'EN_ATTENTE' } })
  await prisma.externalLink.create({
    data: {
      entityType: ENTITY_CRA,
      entityId: craId,
      provider,
      externalId: 'ext-1',
      syncState: 'EN_ATTENTE',
    },
  })
}

describe('refreshSignatureStatus', () => {
  it('UN WEBHOOK PERDU EST RATTRAPÉ PAR LE RAFRAÎCHISSEMENT', async () => {
    // Le client a signé, aucun webhook n est arrivé. Le bouton suffit.
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')
    connector.poserPdfSigne('ext-1', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53]))

    const r = await refreshSignatureStatus(userId, craId, { connector })
    expect(r).toEqual({ ok: true, statut: 'SIGNE', effet: 'VALIDE' })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')

    const ecriture = await saveEntry({ userId, lineId, date: '2026-06-02', minutes: 480, kind: 'REALISE' })
    expect(ecriture).toEqual({ ok: false, reason: 'VERROUILLE' })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).not.toBeNull()
  })

  it('ne change rien tant que le prestataire dit « en attente »', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'EN_ATTENTE')

    expect(await refreshSignatureStatus(userId, craId, { connector })).toEqual({
      ok: true,
      statut: 'EN_ATTENTE',
      effet: 'AUCUN',
    })
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('rattrape aussi un refus', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'REFUSE')

    expect((await refreshSignatureStatus(userId, craId, { connector })).ok).toBe(true)
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('REFUSE')
  })

  it('rattrape l archive quand la signature était déjà appliquée sans PDF', async () => {
    // Le webhook a validé le CRA, mais le téléchargement avait échoué.
    await demandeEnCours()
    await prisma.cra.update({ where: { id: craId }, data: { status: 'VALIDE' } })
    await prisma.signatureRequest.update({
      where: { craId },
      data: { status: 'SIGNE', completedAt: new Date() },
    })

    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')
    connector.poserPdfSigne('ext-1', new Uint8Array([1, 2, 3]))

    const r = await refreshSignatureStatus(userId, craId, { connector })
    expect(r.ok).toBe(true)

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Array.from(demande.signedPdf!)).toEqual([1, 2, 3])

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
  })

  it('le dit quand aucune demande n a été ouverte', async () => {
    const r = await refreshSignatureStatus(userId, craId, {
      connector: createFakeSignatureConnector(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_DEMANDE')
  })

  it('le dit quand aucun connecteur n est configuré', async () => {
    await demandeEnCours()
    const r = await refreshSignatureStatus(userId, craId, { connector: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_CONNECTEUR')
  })

  it('LA TRANSITION MANUELLE RESTE POSSIBLE quand le connecteur est muet', async () => {
    await demandeEnCours()
    await refreshSignatureStatus(userId, craId, { connector: null })

    const apres = await transitionCra(userId, craId, 'VALIDER')
    expect(apres.status).toBe('VALIDE')
    expect(
      await saveEntry({ userId, lineId, date: '2026-06-05', minutes: 480, kind: 'REALISE' }),
    ).toEqual({ ok: false, reason: 'VERROUILLE' })
  })

  it('ne casse rien quand le prestataire est injoignable', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')
    const enPanne = { ...connector, status: async () => { throw new Error('injoignable') } }

    const r = await refreshSignatureStatus(userId, craId, { connector: enPanne })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('CONNECTEUR_EN_ECHEC')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('refuse le CRA d un autre utilisateur', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')

    const r = await refreshSignatureStatus(autreUserId, craId, { connector })
    expect(r.ok).toBe(false)

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/signature/refresh.test.ts`
Expected: FAIL — `Failed to resolve import "./refresh"`

- [ ] **Step 3: Écrire l'implémentation**

`src/services/signature/refresh.ts` :

```ts
import { prisma } from '@/db/client'
import type { SignatureConnector, SignatureStatus } from '@/core/signature/connector'
import { applySignatureStatus, type SignatureEffet } from './apply'
import { ENTITY_CRA } from './constants'
import { getSignatureConnector } from './registry'

export type RefreshRaison = 'PAS_DE_DEMANDE' | 'PAS_DE_CONNECTEUR' | 'CONNECTEUR_EN_ECHEC'

export type RefreshResult =
  | { ok: true; statut: SignatureStatus; effet: SignatureEffet }
  | { ok: false; raison: RefreshRaison; message: string }

const MESSAGES: Record<RefreshRaison, string> = {
  PAS_DE_DEMANDE: 'Ce CRA n’a jamais été envoyé pour signature.',
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Utilisez les transitions manuelles.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas répondu. Réessayez, ou utilisez les transitions manuelles.',
}

/**
 * Interroge le prestataire et applique ce qu'il rapporte.
 *
 * **C'est le rattrapage d'un webhook perdu.** Un circuit qui dépend d'un
 * webhook qui n'arrive jamais est un circuit cassé : ce bouton, plus la
 * transition manuelle toujours disponible, garantissent qu'on avance quoi
 * qu'il arrive.
 *
 * Passe par `applySignatureStatus`, exactement comme le webhook : deux
 * chemins qui appliqueraient le même statut différemment finiraient par
 * diverger.
 */
export async function refreshSignatureStatus(
  userId: string,
  craId: string,
  options: { connector?: SignatureConnector | null } = {},
): Promise<RefreshResult> {
  const cra = await prisma.cra.findFirst({ where: { id: craId, userId }, select: { id: true } })
  if (cra === null) return { ok: false, raison: 'PAS_DE_DEMANDE', message: MESSAGES.PAS_DE_DEMANDE }

  const demande = await prisma.signatureRequest.findUnique({
    where: { craId },
    select: { provider: true },
  })
  if (demande === null) {
    return { ok: false, raison: 'PAS_DE_DEMANDE', message: MESSAGES.PAS_DE_DEMANDE }
  }

  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: demande.provider,
      },
    },
    select: { externalId: true },
  })
  if (lien === null) {
    return { ok: false, raison: 'PAS_DE_DEMANDE', message: MESSAGES.PAS_DE_DEMANDE }
  }

  const connector =
    options.connector !== undefined ? options.connector : await getSignatureConnector()
  if (connector === null) {
    return { ok: false, raison: 'PAS_DE_CONNECTEUR', message: MESSAGES.PAS_DE_CONNECTEUR }
  }

  let statut: SignatureStatus
  try {
    statut = await connector.status(lien.externalId)
  } catch {
    return { ok: false, raison: 'CONNECTEUR_EN_ECHEC', message: MESSAGES.CONNECTEUR_EN_ECHEC }
  }

  const effet = await applySignatureStatus({
    craId,
    externalId: lien.externalId,
    statut,
    connector,
  })

  // Rattrapage de l'archive : la signature a pu être appliquée par un webhook
  // au moment où le téléchargement du document échouait. `applySignatureStatus`
  // n'y touche plus une fois la transition franchie, on repasse donc ici.
  if (statut === 'SIGNE') {
    const demandeRelue = await prisma.signatureRequest.findUnique({
      where: { craId },
      select: { signedPdf: true },
    })
    if (demandeRelue !== null && demandeRelue.signedPdf == null) {
      try {
        const octets = await connector.download(lien.externalId)
        await prisma.signatureRequest.update({
          where: { craId },
          data: { signedPdf: Buffer.from(octets), status: 'SIGNE' },
        })
      } catch {
        // L'archive attendra le prochain rafraîchissement.
      }
    }
  }

  await prisma.externalLink.updateMany({
    where: { entityType: ENTITY_CRA, entityId: craId, provider: demande.provider },
    data: { syncState: statut, syncedAt: new Date() },
  })

  return { ok: true, statut, effet }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run src/services/signature/refresh.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Vérifier par mutation**

Retirer le bloc de rattrapage de l'archive, et confirmer que « rattrape l archive quand la signature était déjà appliquée sans PDF » échoue. Restaurer.

- [ ] **Step 6: Commit**

```bash
git add src/services/signature/refresh.ts src/services/signature/refresh.test.ts
git commit -m "feat(signature): on-demand status refresh recovers a lost webhook"
```

---

## Task 13: Relances, abandon, CRA en souffrance, endpoint de traitement de fond

**Files:** Create `src/services/signature/reminders.ts`, `src/services/signature/reminders.test.ts`, `src/app/api/jobs/tick/route.ts`, `src/app/api/jobs/tick/route.test.ts`. Modify `src/services/cra.ts`, `src/services/cra.test.ts`, `src/services/settings.ts`

**Interfaces:**
- Consumes: `SignatureConnector`, `getSignatureConnector`, `ENTITY_CRA`, `readSettingsRow`
- Produces:
  ```ts
  const RELANCES_MAX = 3
  interface ReminderReport { relancees: number; abandonnees: number; sansConnecteur: number; echecs: number }
  runSignatureReminders(args?: { userId?: string; now?: Date
                                 connector?: SignatureConnector | null }): Promise<ReminderReport>
  // src/services/cra.ts
  interface CraSignatureView { provider: string; status: SignatureStatus; sentAt: Date
                               relances: number; lastRelanceAt: Date | null
                               abandoned: boolean; archive: boolean }
  // CraView gagne : signataireNom, signataireEmail, signature: CraSignatureView | null
  listCrasEnSouffrance(userId: string): Promise<CraView[]>
  // AppSettings gagne : relanceJours: number
  ```

**Trois relances puis abandon.** Au-delà, le CRA reste `ENVOYE` — jamais annulé de force — et remonte dans une liste des CRA en souffrance : c'est un problème humain, pas un problème d'état.

**Un travail de fond porte sur l'instance.** `runSignatureReminders` sans `userId` traverse toutes les demandes : c'est ce que fait un ordonnanceur. Avec `userId`, il se scope — c'est ce dont l'écran a besoin. Les deux formes sont testées.

- [ ] **Step 1: Écrire le test qui échoue**

`src/services/signature/reminders.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { getOrCreateCra, listCrasEnSouffrance } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { createFakeSignatureConnector } from './fake-connector'
import { ENTITY_CRA } from './constants'
import { runSignatureReminders, RELANCES_MAX } from './reminders'

const MAINTENANT = new Date('2026-07-20T09:00:00.000Z')
const IL_Y_A_DIX_JOURS = new Date('2026-07-10T09:00:00.000Z')
const HIER = new Date('2026-07-19T09:00:00.000Z')

let userId = ''
let autreUserId = ''
let missionId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'relance@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'relance-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = a.id

  const c = await createClient('RELANCE client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  await createLine({ missionId, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await updateSettings({ relanceJours: 7 })

  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.cra.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await prisma.user.deleteMany({
    where: { email: { in: ['relance@test.local', 'relance-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'RELANCE client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function demande(patch: Record<string, unknown> = {}): Promise<void> {
  await prisma.signatureRequest.create({
    data: { craId, provider: 'double', status: 'EN_ATTENTE', sentAt: IL_Y_A_DIX_JOURS, ...patch },
  })
  await prisma.externalLink.create({
    data: {
      entityType: ENTITY_CRA,
      entityId: craId,
      provider: 'double',
      externalId: 'ext-1',
      syncState: 'EN_ATTENTE',
    },
  })
}

describe('runSignatureReminders', () => {
  it('relance une demande dont le délai est écoulé', async () => {
    await demande()
    const connector = createFakeSignatureConnector()

    const rapport = await runSignatureReminders({ now: MAINTENANT, connector })
    expect(rapport.relancees).toBe(1)
    expect(connector.relances).toEqual(['ext-1'])

    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.relances).toBe(1)
    expect(relue.lastRelanceAt).not.toBeNull()
  })

  it('ne relance pas avant l échéance', async () => {
    await demande({ sentAt: HIER })
    const connector = createFakeSignatureConnector()
    expect((await runSignatureReminders({ now: MAINTENANT, connector })).relancees).toBe(0)
    expect(connector.relances).toEqual([])
  })

  it('compte le délai depuis la dernière relance, pas depuis l envoi', async () => {
    await demande({ relances: 1, lastRelanceAt: HIER })
    const connector = createFakeSignatureConnector()
    expect((await runSignatureReminders({ now: MAINTENANT, connector })).relancees).toBe(0)
  })

  it('ABANDONNE APRÈS TROIS RELANCES, sans toucher à l état du CRA', async () => {
    await demande({ relances: RELANCES_MAX, lastRelanceAt: IL_Y_A_DIX_JOURS })
    const connector = createFakeSignatureConnector()

    const rapport = await runSignatureReminders({ now: MAINTENANT, connector })
    expect(rapport).toMatchObject({ relancees: 0, abandonnees: 1 })
    expect(connector.relances).toEqual([])

    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.abandoned).toBe(true)
    expect(relue.status).toBe('EN_ATTENTE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('ne relance plus une demande abandonnée', async () => {
    await demande({ relances: RELANCES_MAX, abandoned: true, lastRelanceAt: IL_Y_A_DIX_JOURS })
    const rapport = await runSignatureReminders({
      now: MAINTENANT,
      connector: createFakeSignatureConnector(),
    })
    expect(rapport).toMatchObject({ relancees: 0, abandonnees: 0 })
  })

  it('ne relance jamais une demande achevée', async () => {
    await demande({ status: 'SIGNE', completedAt: IL_Y_A_DIX_JOURS })
    expect(
      (await runSignatureReminders({ now: MAINTENANT, connector: createFakeSignatureConnector() }))
        .relancees,
    ).toBe(0)
  })

  it('ne fait rien quand les relances sont désactivées', async () => {
    await updateSettings({ relanceJours: 0 })
    await demande()
    const connector = createFakeSignatureConnector()
    expect(await runSignatureReminders({ now: MAINTENANT, connector })).toEqual({
      relancees: 0,
      abandonnees: 0,
      sansConnecteur: 0,
      echecs: 0,
    })
    expect(connector.relances).toEqual([])
  })

  it('SANS CONNECTEUR, compte les demandes échues sans jamais échouer', async () => {
    await demande()
    const rapport = await runSignatureReminders({ now: MAINTENANT, connector: null })
    expect(rapport).toMatchObject({ relancees: 0, sansConnecteur: 1 })

    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.relances).toBe(0)
  })

  it('un échec de relance n incrémente pas le compteur et n arrête pas le travail', async () => {
    await demande()
    const connector = createFakeSignatureConnector()
    const enPanne = { ...connector, remind: async () => { throw new Error('injoignable') } }

    const rapport = await runSignatureReminders({ now: MAINTENANT, connector: enPanne })
    expect(rapport).toMatchObject({ relancees: 0, echecs: 1 })

    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.relances).toBe(0)
  })

  it('se scope sur un utilisateur quand on le lui demande', async () => {
    await demande()
    const connector = createFakeSignatureConnector()

    expect((await runSignatureReminders({ userId: autreUserId, now: MAINTENANT, connector })).relancees).toBe(0)
    expect((await runSignatureReminders({ userId, now: MAINTENANT, connector })).relancees).toBe(1)
  })
})

describe('listCrasEnSouffrance', () => {
  it('remonte les CRA abandonnés, et eux seuls', async () => {
    await demande({ relances: RELANCES_MAX, abandoned: true })
    const souffrance = await listCrasEnSouffrance(userId)
    expect(souffrance.map((c) => c.id)).toEqual([craId])
    expect(souffrance[0]!.signature?.abandoned).toBe(true)
  })

  it('ne remonte rien tant que la demande suit son cours', async () => {
    await demande()
    expect(await listCrasEnSouffrance(userId)).toEqual([])
  })

  it('ne remonte pas les CRA d un autre utilisateur', async () => {
    await demande({ relances: RELANCES_MAX, abandoned: true })
    expect(await listCrasEnSouffrance(autreUserId)).toEqual([])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run src/services/signature/reminders.test.ts`
Expected: FAIL — `Failed to resolve import "./reminders"`

- [ ] **Step 3: Ajouter `relanceJours` aux réglages**

Dans `src/services/settings.ts`, ajouter au `settingsPatchSchema` :

```ts
    // 0 = relances désactivées. Un délai d'un jour est déjà agressif, au-delà
    // d'un trimestre le CRA relève de la relance humaine.
    relanceJours: z
      .number({ message: 'Le délai de relance est requis.' })
      .int('Le délai de relance doit être un nombre entier de jours.')
      .min(0, 'Le délai de relance ne peut pas être négatif.')
      .max(90, 'Le délai de relance ne peut pas dépasser 90 jours.'),
```

à `AppSettings` :

```ts
  /** délai avant relance d'une signature en attente, en jours. 0 = désactivé. */
  relanceJours: number
```

à `toAppSettings` : `relanceJours: row.relanceJours,`

et à `updateSettings` : `...(patch.relanceJours !== undefined && { relanceJours: patch.relanceJours }),`

- [ ] **Step 4: Écrire les relances**

`src/services/signature/reminders.ts` :

```ts
import { prisma } from '@/db/client'
import type { SignatureConnector } from '@/core/signature/connector'
import { getSettings } from '@/services/settings'
import { ENTITY_CRA } from './constants'
import { getSignatureConnector } from './registry'

/** Au-delà, on cesse de relancer et le CRA remonte en souffrance. */
export const RELANCES_MAX = 3

export interface ReminderReport {
  relancees: number
  abandonnees: number
  /** demandes échues qu'aucun connecteur ne pouvait relancer */
  sansConnecteur: number
  /** relances tentées et refusées par le prestataire */
  echecs: number
}

const JOUR_EN_MS = 24 * 60 * 60 * 1000

/**
 * Relance les signatures en attente dont le délai est écoulé, puis abandonne
 * au-delà de `RELANCES_MAX`.
 *
 * **Un travail de fond porte sur l'instance** : sans `userId`, il traverse
 * toutes les demandes — c'est ce que fait un ordonnanceur, qui n'a pas de
 * session. Avec `userId`, il se scope, pour le bouton de l'écran CRA.
 *
 * `now` est un paramètre et jamais l'horloge : un travail de fond qui lit
 * l'heure lui-même ne se teste pas.
 *
 * Sans connecteur, la fonction **compte et rend la main**. Elle n'échoue
 * jamais : une instance sans outil de signature doit pouvoir appeler
 * l'ordonnanceur sans que rien ne casse.
 */
export async function runSignatureReminders(
  args: { userId?: string; now?: Date; connector?: SignatureConnector | null } = {},
): Promise<ReminderReport> {
  const rapport: ReminderReport = { relancees: 0, abandonnees: 0, sansConnecteur: 0, echecs: 0 }

  const settings = await getSettings()
  if (settings.relanceJours <= 0) return rapport

  const now = args.now ?? new Date()
  const echeance = new Date(now.getTime() - settings.relanceJours * JOUR_EN_MS)

  const demandes = await prisma.signatureRequest.findMany({
    where: {
      status: 'EN_ATTENTE',
      abandoned: false,
      completedAt: null,
      ...(args.userId === undefined ? {} : { cra: { userId: args.userId } }),
    },
    select: {
      craId: true,
      provider: true,
      relances: true,
      sentAt: true,
      lastRelanceAt: true,
    },
  })

  const echues = demandes.filter((d) => (d.lastRelanceAt ?? d.sentAt) <= echeance)
  if (echues.length === 0) return rapport

  const connector =
    args.connector !== undefined ? args.connector : await getSignatureConnector()

  for (const demande of echues) {
    if (demande.relances >= RELANCES_MAX) {
      // Le CRA reste ENVOYE : trois relances sans réponse est un problème
      // humain, pas un problème d'état. On le rend visible, on ne l'annule pas.
      await prisma.signatureRequest.update({
        where: { craId: demande.craId },
        data: { abandoned: true },
      })
      rapport.abandonnees += 1
      continue
    }

    if (connector === null) {
      rapport.sansConnecteur += 1
      continue
    }

    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: ENTITY_CRA,
          entityId: demande.craId,
          provider: demande.provider,
        },
      },
      select: { externalId: true },
    })
    if (lien === null) {
      rapport.echecs += 1
      continue
    }

    try {
      await connector.remind(lien.externalId)
    } catch {
      // Un échec ne consomme pas de relance et n'arrête pas le travail : le
      // prochain passage retentera, et les demandes suivantes sont traitées.
      rapport.echecs += 1
      continue
    }

    await prisma.signatureRequest.update({
      where: { craId: demande.craId },
      data: { relances: { increment: 1 }, lastRelanceAt: now },
    })
    rapport.relancees += 1
  }

  return rapport
}
```

- [ ] **Step 5: Exposer la signature et la souffrance dans `src/services/cra.ts`**

Ajouter à `src/services/cra.ts` :

```ts
import type { SignatureStatus } from '@/core/signature/connector'

export interface CraSignatureView {
  provider: string
  status: SignatureStatus
  sentAt: Date
  relances: number
  lastRelanceAt: Date | null
  /** trois relances sans réponse : visible dans la liste des CRA en souffrance */
  abandoned: boolean
  /** un PDF signé est archivé, et sera servi tel quel au téléchargement */
  archive: boolean
}
```

Ajouter à `CraView` :

```ts
  /** signataire porté par la mission, vide tant qu'il n'est pas renseigné */
  signataireNom: string
  signataireEmail: string
  /** null tant qu'aucune demande de signature n'a été ouverte */
  signature: CraSignatureView | null
```

Étendre l'inclusion et la projection :

```ts
const WITH_MISSION = {
  mission: { include: { client: true } },
  signatureRequest: {
    select: {
      provider: true,
      status: true,
      sentAt: true,
      relances: true,
      lastRelanceAt: true,
      abandoned: true,
      // `signedPdf` n'est JAMAIS sélectionné ici : un blob de plusieurs
      // centaines de kilo-octets par ligne traverserait chaque affichage de
      // la page CRA pour un booléen. Sa présence se lit par un compte.
    },
  },
} as const
```

Le booléen `archive` demande un test d'existence sans charger les octets :

```ts
/** Identifiants des CRA dont le PDF signé est archivé, sans charger les octets. */
async function craAvecArchive(craIds: string[]): Promise<Set<string>> {
  if (craIds.length === 0) return new Set()
  const lignes = await prisma.signatureRequest.findMany({
    where: { craId: { in: craIds }, NOT: { signedPdf: null } },
    select: { craId: true },
  })
  return new Set(lignes.map((l) => l.craId))
}
```

`toView` prend un second argument `archives: Set<string>` et projette :

```ts
    signataireNom: row.mission.signataireNom,
    signataireEmail: row.mission.signataireEmail,
    signature:
      row.signatureRequest === null
        ? null
        : {
            provider: row.signatureRequest.provider,
            status: row.signatureRequest.status as SignatureStatus,
            sentAt: row.signatureRequest.sentAt,
            relances: row.signatureRequest.relances,
            lastRelanceAt: row.signatureRequest.lastRelanceAt,
            abandoned: row.signatureRequest.abandoned,
            archive: archives.has(row.id),
          },
```

Adapter `getOrCreateCra`, `transitionCra`, `updateInvoiceTracking` et `listCras` pour passer `await craAvecArchive([...])`, puis ajouter :

```ts
/**
 * Les CRA envoyés que trois relances n'ont pas fait revenir.
 *
 * Ils restent `ENVOYE` — on ne les annule pas de force : c'est un problème
 * humain, et le rendre visible est tout ce que le logiciel peut faire.
 */
export async function listCrasEnSouffrance(userId: string): Promise<CraView[]> {
  const rows = await prisma.cra.findMany({
    where: { userId, signatureRequest: { abandoned: true, status: 'EN_ATTENTE' } },
    include: WITH_MISSION,
    orderBy: { month: 'asc' },
  })
  const archives = await craAvecArchive(rows.map((r) => r.id))
  return rows.map((row) => toView(row, archives))
}
```

Ajouter à `src/services/cra.test.ts` :

```ts
describe('CraView et signature', () => {
  it('rend une signature nulle tant qu aucune demande n existe', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-09')
    expect(cra.signature).toBeNull()
  })

  it('expose le signataire porté par la mission', async () => {
    await prisma.mission.update({
      where: { id: missionId },
      data: { signataireNom: 'Claire Martin', signataireEmail: 'claire@cra.test' },
    })
    const cra = await getOrCreateCra(userId, missionId, '2026-09')
    expect(cra.signataireEmail).toBe('claire@cra.test')
  })

  it('ne transporte jamais les octets du PDF archivé, seulement le fait qu il existe', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-10')
    await prisma.signatureRequest.create({
      data: { craId: cra.id, provider: 'double', signedPdf: Buffer.from('%PDF') },
    })

    const relu = (await listCras(userId, '2026-10')).find((c) => c.id === cra.id)!
    expect(relu.signature?.archive).toBe(true)
    expect(JSON.stringify(relu)).not.toContain('signedPdf')
  })
})
```

- [ ] **Step 6: Écrire l'endpoint de traitement de fond**

`src/app/api/jobs/tick/route.ts` :

```ts
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runSignatureReminders } from '@/services/signature/reminders'

function jetonsEgaux(fourni: string, attendu: string): boolean {
  const a = Buffer.from(fourni)
  const b = Buffer.from(attendu)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * L'endpoint de traitement de fond.
 *
 * Un cron système ou n8n peuvent l'appeler, mais **rien ne les exige** : la
 * page CRA porte un bouton qui déclenche le même travail, et les transitions
 * manuelles n'en dépendent pas du tout. Faire dépendre le circuit d'un
 * ordonnanceur externe retirerait à l'application son autoportance.
 *
 * Le lot 4 étendra cet endpoint à l'ensemble de ses travaux plutôt que d'en
 * ouvrir un second.
 */
export async function POST(request: Request): Promise<Response> {
  const attendu = process.env.JOBS_TOKEN ?? ''

  if (attendu === '') {
    return NextResponse.json(
      { erreur: "Le traitement de fond par endpoint est désactivé : JOBS_TOKEN n'est pas défini." },
      { status: 503 },
    )
  }

  const fourni = request.headers.get('x-jobs-token') ?? ''
  if (!jetonsEgaux(fourni, attendu)) {
    return NextResponse.json({ erreur: 'Jeton de traitement de fond invalide.' }, { status: 401 })
  }

  return NextResponse.json({ relances: await runSignatureReminders() })
}
```

`src/app/api/jobs/tick/route.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const { etat } = vi.hoisted(() => ({
  etat: {
    appels: 0,
    rapport: { relancees: 2, abandonnees: 1, sansConnecteur: 0, echecs: 0 },
  },
}))

vi.mock('@/services/signature/reminders', () => ({
  runSignatureReminders: async () => {
    etat.appels += 1
    return etat.rapport
  },
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { POST } from './route'

const initial = process.env.JOBS_TOKEN

function requete(entetes: Record<string, string> = {}): Promise<Response> {
  return POST(new Request('http://local/api/jobs/tick', { method: 'POST', headers: entetes }))
}

beforeEach(() => {
  etat.appels = 0
  process.env.JOBS_TOKEN = 'jeton-de-test'
})

afterAll(() => {
  if (initial === undefined) delete process.env.JOBS_TOKEN
  else process.env.JOBS_TOKEN = initial
})

describe('POST /api/jobs/tick', () => {
  it('exécute les relances et rend le compte rendu', async () => {
    const r = await requete({ 'x-jobs-token': 'jeton-de-test' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      relances: { relancees: 2, abandonnees: 1, sansConnecteur: 0, echecs: 0 },
    })
    expect(etat.appels).toBe(1)
  })

  it('refuse un jeton faux sans rien exécuter', async () => {
    const r = await requete({ 'x-jobs-token': 'mauvais' })
    expect(r.status).toBe(401)
    expect(etat.appels).toBe(0)
  })

  it('refuse un jeton absent', async () => {
    expect((await requete()).status).toBe(401)
    expect(etat.appels).toBe(0)
  })

  it('refuse un jeton de longueur différente sans lever', async () => {
    const r = await requete({ 'x-jobs-token': 'court' })
    expect(r.status).toBe(401)
  })

  it('se déclare désactivé quand aucun jeton n est configuré', async () => {
    delete process.env.JOBS_TOKEN
    const r = await requete({ 'x-jobs-token': 'peu importe' })
    expect(r.status).toBe(503)
    expect(etat.appels).toBe(0)
  })
})
```

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run src/services/signature/reminders.test.ts src/services/cra.test.ts src/app/api/jobs/`
Expected: PASS — 13 (relances et souffrance) + 3 (CraView) + 5 (endpoint) plus les tests existants de `cra.test.ts`

- [ ] **Step 8: Compléter `.env.example`**

```bash
cat >> .env.example <<'EOF'

# Traitement de fond (relances de signature). Sans jeton, l'endpoint répond
# 503 et l'application reste pleinement utilisable à la main.
JOBS_TOKEN=""
EOF
```

- [ ] **Step 9: Vérifier par mutation**

Remplacer `if (demande.relances >= RELANCES_MAX)` par `> RELANCES_MAX`, et confirmer que « ABANDONNE APRÈS TROIS RELANCES » échoue. Restaurer.

Déplacer l'incrément de `relances` **avant** le `try`, et confirmer que « un échec de relance n incrémente pas le compteur » échoue. Restaurer.

Sélectionner `signedPdf: true` dans `WITH_MISSION`, et confirmer que « ne transporte jamais les octets du PDF archivé » échoue. Restaurer.

- [ ] **Step 10: Vérifier et commiter**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

```bash
git add src/services/signature/reminders.ts src/services/signature/reminders.test.ts \
        src/services/cra.ts src/services/cra.test.ts src/services/settings.ts \
        src/app/api/jobs .env.example
git commit -m "feat(signature): reminders with abandonment, stalled CRA list and job endpoint"
```

---

## Task 14: L'écran CRA

**Files:** Modify `src/app/(app)/cra/page.tsx`, `src/app/(app)/cra/actions.ts`, `src/app/(app)/cra/page.test.tsx`. Create `src/components/cra/SignatureCard.tsx`

**Interfaces:**
- Consumes: `listCras`, `listCrasEnSouffrance`, `CraSignatureView` (tâche 13) ; `sendCraForSignature` (tâche 10) ; `refreshSignatureStatus` (tâche 12) ; `runSignatureReminders` (tâche 13)
- Produces:
  - `envoyerPourSignature(formData: FormData): Promise<void>`
  - `rafraichirSignature(formData: FormData): Promise<void>`
  - `lancerRelances(formData: FormData): Promise<void>`
  - `SignatureCard({ signature }: { signature: CraSignatureView })`

**La règle qui gouverne cet écran : les transitions manuelles restent affichées en permanence.** Connecteur ou pas, signature en cours ou pas. C'est ce qui garantit qu'aucun blocage extérieur ne rend l'application inutilisable.

- [ ] **Step 1: Écrire le test qui échoue**

Compléter `src/app/(app)/cra/page.test.tsx`. Étendre d'abord le jeu de doubles :

```ts
const { cras, missions, souffrance } = vi.hoisted(() => ({
  cras: [] as unknown[],
  missions: [] as unknown[],
  souffrance: [] as unknown[],
}))

vi.mock('@/services/cra', () => ({
  listCras: async () => cras,
  listCrasEnSouffrance: async () => souffrance,
}))
vi.mock('./actions', () => ({
  openCra: vi.fn(),
  moveCra: vi.fn(),
  saveTracking: vi.fn(),
  envoyerPourSignature: vi.fn(),
  rafraichirSignature: vi.fn(),
  lancerRelances: vi.fn(),
}))
```

Compléter `unCra` avec les champs nouveaux, et étendre `rendre` :

```ts
function unCra(
  status: CraStatus,
  id = 'cra-1',
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    missionId: 'm1',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    month: '2026-03',
    status,
    invoiceNumber: null,
    invoicedAt: null,
    paidAt: null,
    signataireNom: 'Claire Martin',
    signataireEmail: 'claire@acme.test',
    signature: null,
    ...extra,
  }
}

function uneSignature(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'documenso',
    status: 'EN_ATTENTE',
    sentAt: new Date('2026-03-05T09:00:00.000Z'),
    relances: 0,
    lastRelanceAt: null,
    abandoned: false,
    archive: false,
    ...extra,
  }
}

async function rendre(
  jeu: { cras?: unknown[]; missions?: unknown[]; souffrance?: unknown[]; erreur?: string } = {},
): Promise<ReturnType<typeof render>> {
  cras.length = 0
  cras.push(...(jeu.cras ?? []))
  missions.length = 0
  missions.push(...(jeu.missions ?? [{ id: 'm1', clientName: 'ACME', label: 'ITSM' }]))
  souffrance.length = 0
  souffrance.push(...(jeu.souffrance ?? []))
  return render(
    await CraPage({
      searchParams: Promise.resolve({ month: '2026-03', erreur: jeu.erreur }),
    }),
  )
}
```

Puis ajouter :

```ts
describe('signature du CRA', () => {
  afterEach(cleanup)

  it('propose le téléchargement du PDF quel que soit l état', async () => {
    for (const statut of STATUTS) {
      await rendre({ cras: [unCra(statut)] })
      const lien = screen.getByRole('link', { name: /télécharger le pdf/i })
      expect(lien.getAttribute('href')).toBe('/cra/cra-1/pdf')
      cleanup()
    }
  })

  it('LAISSE LES TRANSITIONS MANUELLES DISPONIBLES en permanence', async () => {
    // La garantie que rien d extérieur ne peut rendre l application inutilisable.
    for (const statut of STATUTS) {
      await rendre({ cras: [unCra(statut, 'cra-1', { signature: uneSignature() })] })
      for (const t of TOUTES.filter((t) => canTransition(statut, t))) {
        expect(screen.getByRole('button', { name: LIBELLES[t] })).toBeTruthy()
      }
      cleanup()
    }
  })

  it('propose l envoi pour signature sur un brouillon', async () => {
    await rendre({ cras: [unCra('BROUILLON')] })
    const bouton = screen.getByRole('button', { name: /envoyer pour signature/i })
    expect(bouton.hasAttribute('disabled')).toBe(false)
  })

  it('désactive l envoi et l explique quand la mission n a pas de signataire', async () => {
    await rendre({ cras: [unCra('BROUILLON', 'cra-1', { signataireNom: '', signataireEmail: '' })] })
    const bouton = screen.getByRole('button', { name: /envoyer pour signature/i })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(document.body.textContent).toContain('signataire')
  })

  it('ne propose pas l envoi quand la transition est impossible', async () => {
    await rendre({ cras: [unCra('VALIDE')] })
    expect(screen.queryByRole('button', { name: /envoyer pour signature/i })).toBeNull()
  })

  it('affiche l état de la signature en cours, sans dépendre de la seule couleur', async () => {
    await rendre({
      cras: [unCra('ENVOYE', 'cra-1', { signature: uneSignature({ relances: 2 }) })],
    })
    const texte = document.body.textContent ?? ''
    expect(texte).toContain('En attente de signature')
    expect(texte).toContain('2 relance')
  })

  it('propose le rafraîchissement dès qu une demande existe', async () => {
    await rendre({ cras: [unCra('ENVOYE', 'cra-1', { signature: uneSignature() })] })
    expect(screen.getByRole('button', { name: /rafraîchir l’état/i })).toBeTruthy()
  })

  it('ne propose pas le rafraîchissement sans demande', async () => {
    await rendre({ cras: [unCra('ENVOYE')] })
    expect(screen.queryByRole('button', { name: /rafraîchir l’état/i })).toBeNull()
  })

  it('signale un document signé archivé', async () => {
    await rendre({
      cras: [unCra('VALIDE', 'cra-1', { signature: uneSignature({ status: 'SIGNE', archive: true }) })],
    })
    expect(document.body.textContent).toContain('signé archivé')
  })

  it('remonte les CRA en souffrance, et rien quand il n y en a pas', async () => {
    await rendre({ cras: [unCra('ENVOYE')] })
    expect(screen.queryByRole('heading', { name: /en souffrance/i })).toBeNull()
    cleanup()

    await rendre({
      cras: [unCra('ENVOYE')],
      souffrance: [
        unCra('ENVOYE', 'cra-1', { signature: uneSignature({ relances: 3, abandoned: true }) }),
      ],
    })
    expect(screen.getByRole('heading', { name: /en souffrance/i })).toBeTruthy()
  })

  it('affiche le motif d échec remonté par l action', async () => {
    await rendre({ cras: [unCra('BROUILLON')], erreur: 'PAS_DE_CONNECTEUR' })
    expect(document.body.textContent).toContain('Aucun outil de signature')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run "src/app/(app)/cra/page.test.tsx"`
Expected: FAIL — `listCrasEnSouffrance` n'est pas exporté du double, aucun lien de téléchargement, aucun bouton d'envoi

- [ ] **Step 3: Écrire les actions**

Dans `src/app/(app)/cra/actions.ts` :

```ts
import { redirect } from 'next/navigation'
import { sendCraForSignature } from '@/services/signature/send'
import { refreshSignatureStatus } from '@/services/signature/refresh'
import { runSignatureReminders } from '@/services/signature/reminders'

function retour(month: string, raison?: string): never {
  // Les server actions de cette page ne rendent rien : le motif d'échec
  // repasse par l'URL, et la page le traduit en bandeau. Lever une exception
  // afficherait une page d'erreur là où l'utilisateur a juste besoin d'une
  // phrase.
  redirect(`/cra?month=${month}${raison === undefined ? '' : `&erreur=${raison}`}`)
}

export async function envoyerPourSignature(formData: FormData): Promise<void> {
  const user = await requireUser()
  const month = String(formData.get('month'))
  const r = await sendCraForSignature(user.id, String(formData.get('craId')))

  revalidatePath('/cra')
  revalidatePath('/saisie')
  retour(month, r.ok ? undefined : r.raison)
}

export async function rafraichirSignature(formData: FormData): Promise<void> {
  const user = await requireUser()
  const month = String(formData.get('month'))
  const r = await refreshSignatureStatus(user.id, String(formData.get('craId')))

  revalidatePath('/cra')
  revalidatePath('/saisie')
  retour(month, r.ok ? undefined : r.raison)
}

export async function lancerRelances(formData: FormData): Promise<void> {
  const user = await requireUser()
  // Scopé sur l'utilisateur : ce bouton n'est pas l'ordonnanceur, c'est le
  // moyen de s'en passer.
  await runSignatureReminders({ userId: user.id })
  revalidatePath('/cra')
  redirect(`/cra?month=${String(formData.get('month'))}`)
}
```

- [ ] **Step 4: Écrire le composant d'état**

`src/components/cra/SignatureCard.tsx` :

```ts
import type { CraSignatureView } from '@/services/cra'
import { Badge, type Tone } from '@/components/ui/Badge'

const ETATS: Record<CraSignatureView['status'], { tone: Tone; glyph: string; label: string }> = {
  EN_ATTENTE: { tone: 'info', glyph: '⏳', label: 'En attente de signature' },
  SIGNE: { tone: 'success', glyph: '✓', label: 'Signé par le client' },
  REFUSE: { tone: 'danger', glyph: '✕', label: 'Refusé par le client' },
  EXPIRE: { tone: 'warning', glyph: '▲', label: 'Demande expirée' },
}

function jour(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * L'état de la demande de signature, en toutes lettres.
 *
 * Le glyphe et le libellé portent l'information ; la teinte ne fait que la
 * renforcer. Aucune information n'est portée par la seule couleur.
 */
export function SignatureCard({ signature }: { signature: CraSignatureView }) {
  const etat = ETATS[signature.status]

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <Badge tone={etat.tone} glyph={etat.glyph}>
        {etat.label}
      </Badge>
      <span className="text-muted">Envoyé le {jour(signature.sentAt)}</span>
      <span className="text-muted">
        {signature.relances} relance{signature.relances > 1 ? 's' : ''}
        {signature.lastRelanceAt === null ? '' : ` · dernière le ${jour(signature.lastRelanceAt)}`}
      </span>
      {signature.abandoned && (
        <span className="text-warning-ink">Relances abandonnées — CRA en souffrance</span>
      )}
      {signature.archive && <span className="text-muted">Document signé archivé</span>}
    </div>
  )
}
```

- [ ] **Step 5: Étendre la page**

Dans `src/app/(app)/cra/page.tsx` :

```tsx
import { listCras, listCrasEnSouffrance, type CraView } from '@/services/cra'
import { Banner } from '@/components/ui/Banner'
import { SignatureCard } from '@/components/cra/SignatureCard'
import { envoyerPourSignature, rafraichirSignature, lancerRelances, openCra, moveCra, saveTracking } from './actions'

const ERREURS: Record<string, string> = {
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Le CRA reste téléchargeable et les transitions manuelles restent disponibles.',
  PAS_DE_SIGNATAIRE:
    'Renseignez le signataire de la mission (nom et adresse électronique) avant d’envoyer le CRA.',
  TRANSITION_IMPOSSIBLE: 'Ce CRA ne peut pas être envoyé dans son état actuel.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas accepté le document. Le CRA n’a pas changé d’état.',
  PAS_DE_DEMANDE: 'Ce CRA n’a jamais été envoyé pour signature.',
}
```

La signature de la page devient :

```tsx
export default async function CraPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; erreur?: string }>
}) {
  const user = await requireUser()
  const { month: raw, erreur } = await searchParams
  const month = raw ?? new Date().toISOString().slice(0, 7)

  const cras = await listCras(user.id, month)
  const missions = await listMissionsForUser(user.id)
  const souffrance = await listCrasEnSouffrance(user.id)
  const messageErreur = erreur === undefined ? undefined : ERREURS[erreur]
```

Sous le titre, le bandeau d'erreur :

```tsx
{messageErreur !== undefined && (
  <Banner tone="warning" title="Envoi impossible">
    {messageErreur}
  </Banner>
)}
```

Dans la `Card` de chaque CRA, **avant** le bloc des transitions manuelles — qui reste inchangé :

```tsx
{cra.signature !== null && <SignatureCard signature={cra.signature} />}

<div className="mb-4 flex flex-wrap items-center gap-2">
  <a
    href={`/cra/${cra.id}/pdf`}
    className="touch-target inline-flex items-center rounded-md border border-rule px-3 text-sm text-link hover:bg-off"
  >
    Télécharger le PDF
  </a>

  {canTransition(cra.status, 'ENVOYER') && (
    <form action={envoyerPourSignature}>
      <input type="hidden" name="craId" value={cra.id} />
      <input type="hidden" name="month" value={month} />
      <Button variant="primary" disabled={cra.signataireEmail === ''}>
        Envoyer pour signature
      </Button>
    </form>
  )}

  {cra.signature !== null && (
    <form action={rafraichirSignature}>
      <input type="hidden" name="craId" value={cra.id} />
      <input type="hidden" name="month" value={month} />
      <Button>Rafraîchir l’état</Button>
    </form>
  )}
</div>

{cra.signataireEmail === '' && (
  <p className="mb-4 text-xs text-muted">
    Aucun signataire n’est renseigné sur cette mission : renseignez-le depuis l’écran Missions
    pour pouvoir envoyer le CRA. Le téléchargement et les transitions manuelles restent
    disponibles.
  </p>
)}
```

Et, en fin de page, la section des CRA en souffrance :

```tsx
{souffrance.length > 0 && (
  <section className="mt-10">
    <h2 className="mb-3 text-lg">CRA en souffrance</h2>
    <p className="mb-3 text-sm text-muted">
      Trois relances sans réponse. Ces CRA restent envoyés : à reprendre à la main avec le
      client, ou à renvoyer après réouverture.
    </p>
    {souffrance.map((cra: CraView) => (
      <p key={cra.id} className="text-sm">
        {cra.clientName} · {cra.missionLabel} · {cra.month} — envoyé le{' '}
        {cra.signature?.sentAt.toISOString().slice(0, 10)}
      </p>
    ))}
    <form action={lancerRelances} className="mt-3">
      <input type="hidden" name="month" value={month} />
      <Button>Lancer les relances échues</Button>
    </form>
  </section>
)}
```

> Le bouton « Lancer les relances échues » est ce qui rend l'ordonnanceur facultatif : sans cron ni n8n, le porteur du produit relance depuis l'écran.

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run "src/app/(app)/cra/page.test.tsx"`
Expected: PASS — les 11 tests nouveaux plus tous les existants

- [ ] **Step 7: Vérifier par mutation**

Retirer le bloc des transitions manuelles quand `cra.signature !== null`, et confirmer que « LAISSE LES TRANSITIONS MANUELLES DISPONIBLES en permanence » échoue. Restaurer.

Remplacer `disabled={cra.signataireEmail === ''}` par `disabled={false}`, et confirmer que « désactive l envoi et l explique » échoue. Restaurer.

- [ ] **Step 8: Vérifier l'ensemble**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 9: Vérifier à la main, sans connecteur configuré**

Avec `DOCUMENSO_URL` et `DOCUMENSO_API_KEY` vides dans `.env` :

```bash
npm run dev
```

Sur `/missions`, renseigner un signataire ; sur `/cra?month=<un mois saisi>` :

1. « Télécharger le PDF » ouvre un document lisible, au bon détail, **sans aucun montant** ;
2. « Envoyer pour signature » affiche le bandeau « Aucun outil de signature n'est configuré » et **ne change pas l'état** ;
3. « Marquer envoyé », « Marquer validé », « Rouvrir » fonctionnent comme au lot 0 ;
4. après « Marquer validé », la page de saisie du mois refuse toute écriture.

**Ne pas lancer `npx next build`.** Si le serveur de développement était déjà lancé par le porteur du produit, ne pas en démarrer un second.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/cra" src/components/cra/SignatureCard.tsx
git commit -m "feat(cra): signature status, send, refresh and stalled list on the CRA screen"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche |
|---|---|
| § 3 — PDF par couple *(mission, mois)*, entête émetteur et client | 2, 5 |
| § 3 — détail par ligne de prestation **et par jour** | 2, 3, 5 |
| § 3 — totaux par ligne, en jours | 2, 3 |
| § 3 — emplacement de signature | 3 |
| § 3, § 8, § 10 — **aucun montant** | 2 (modèle), 3 (mise en page), 5 (**octets du PDF**) |
| § 3, § 8 — le PDF signé est archivé, jamais regénéré | 4, 5, 11 |
| § 4 — `SignatureConnector` : `send`, `status`, `download` | 8 |
| § 4 — Documenso en première implémentation | 8 |
| § 4, § 10 — connecteur testé contre un double, **aucun appel réseau** | 8, 10, 11, 12, 13 |
| § 4, § 10 — sans connecteur, PDF et transitions manuelles fonctionnent | 6, 10, 12, 14 |
| § 5 — envoi : PDF confié au connecteur, CRA à `ENVOYE` | 10 |
| § 5 — référence externe dans `ExternalLink` | 10 |
| § 5 — webhook : `VALIDE`, verrouillage du mois | 11 |
| § 5, § 8 — webhook authentifié **par signature de charge utile** | 9, 11 |
| § 5, § 8, § 10 — webhook perdu : rafraîchissement à la demande | 12 |
| § 5, § 10 — un refus rouvre le CRA | 11 |
| § 6 — un contact signataire **par mission** | 4, 7 |
| § 7 — relance après un délai configurable, puis abandon | 13 |
| § 7 — trois relances maximum, liste des CRA en souffrance | 13, 14 |
| § 7 — déclenchement par l'endpoint de traitement de fond | 13 |
| § 8 — les transitions manuelles restent disponibles en permanence | 10, 12, 14 |
| § 8 — `VALIDE` verrouille le mois, quelle que soit la voie | 11, 12 |
| § 8 — le client n'a pas de compte | tout le lot : aucune table, aucun écran, aucune session client |
| § 10 — un webhook rejoué deux fois n'a aucun effet la seconde | 4, 11 |

**Hors périmètre, conformément au § 9 :** portail client, signature multi-parties, circuit d'approbation interne, modèles de PDF personnalisables, facturation.

**Non traité volontairement :** la reprise des contacts du tiers Dolibarr (§ 6, « le lot 2, s'il est présent, **peut** proposer… — sans l'imposer »). Le champ reste une saisie ; brancher une proposition de complétion relève du lot 2 et n'a aucune conséquence sur le modèle.

---

## Auto-revue appliquée à ce plan

Les points suivants ont été relevés en relisant le plan, et **corrigés dans le plan lui-même**.

| Défaut relevé | Correction |
|---|---|
| La tâche 5 lisait `Settings` deux fois — par `getSettings()` puis par un `findUniqueOrThrow` direct — avec un `void settings` pour taire le compilateur | Une seule lecture, par `readSettingsRow()`, qui est le seul endroit du dépôt portant les valeurs de création du singleton |
| Dans la mise en page, une cellule était poussée sans son champ `text`, puis corrigée par mutation de l'objet | Un seul `texts.push` complet |
| Le double de l'API Documenso portait un type de `fetchFn` acrobatique (`as never`, `Appel extends never ?`) | `SignatureFetchLike` est utilisé directement, sans aucune assertion de type |
| Le test « rend 401 quand la session manque » appelait `vi.mocked(requireUser).mockRejectedValueOnce` sur une fonction qui n'était pas un espion | `requireUser` est un `vi.fn()` dans la fabrique du double, et l'assertion est exactement `401` |
| Un test de la tâche 11 s'appelait « archive même sans connecteur » alors qu'il vérifiait l'**absence** d'archive | Renommé « valide sans connecteur, en se passant simplement d'archive » |
| L'étape de vérification manuelle du PDF (tâche 1) mélangeait trois commandes inabouties | Une seule marche à suivre : un test temporaire écrivant le fichier, `open`, puis retrait du test |
| `FetchLike` du lot 1b et celui de ce lot risquaient de se marcher dessus | Le type de ce lot s'appelle `SignatureFetchLike` et vit dans `core/signature/connector.ts` |
| Le nom de fichier utilisait une classe de diacritiques littérale, fragile selon l'encodage du fichier source | `\u0300-\u036f`, explicite |
| `relanceJours` était ajouté au schéma Prisma sans validation côté service ni test | La tâche 13 étend `settingsPatchSchema`, `AppSettings`, `toAppSettings` et `updateSettings`, et la tâche 13 bis ci-dessous ajoute le test |

**Cohérence des types et des noms entre tâches, vérifiée nom par nom :**

- `SignatureStatus` est produit en tâche 8 et consommé tel quel en 11, 12, 13, 14 — jamais redéclaré.
- `SignatureEffet` est produit en 11 et consommé en 12 (`RefreshResult.effet`) et par les tests de 11.
- `ENTITY_CRA` / `PROVIDER_DOCUMENSO` sont produits en 8 et consommés en 10, 11, 12, 13 — jamais réécrits en littéral, sauf dans les tests où le littéral est l'assertion.
- `CraDocument` est produit en 2, consommé en 3 (`layoutCraDocument`) et en 5 (`CraPdf.document`).
- `PdfPage` est produit en 1, consommé en 3 ; `extraireTextes` est produit en 1 et consommé par les tests de 5.
- `CraSignatureView` est produit en 13 (`services/cra.ts`) et consommé en 14 (`SignatureCard`).
- Les raisons d'échec de 10 (`SendCraRaison`) et de 12 (`RefreshRaison`) alimentent le dictionnaire `ERREURS` de 14 : les cinq clés y figurent.
- `runSignatureReminders` est produit en 13 et consommé par la route `/api/jobs/tick` (13) et l'action `lancerRelances` (14), avec la même signature.

**Chasse aux marqueurs :** aucune occurrence de `TODO`, `FIXME`, `…à compléter`, `<placeholder>`, `...` en position de code manquant, ni de test annoncé sans son corps. Chaque `Run:` porte une commande exécutable telle quelle et un `Expected:` chiffré.

---

## Task 13 bis: Test du réglage de délai de relance

À exécuter avec la tâche 13, dans le même commit.

**Files:** Modify `src/services/settings.test.ts`

- [ ] **Step 1: Ajouter le test**

```ts
describe('délai de relance', () => {
  it('vaut sept jours par défaut', async () => {
    await prisma.settings.deleteMany({})
    expect((await getSettings()).relanceJours).toBe(7)
  })

  it('se met à jour', async () => {
    expect((await updateSettings({ relanceJours: 14 })).relanceJours).toBe(14)
  })

  it('accepte zéro, qui désactive les relances', async () => {
    expect((await updateSettings({ relanceJours: 0 })).relanceJours).toBe(0)
  })

  it('refuse un délai négatif, non entier ou déraisonnable', async () => {
    expect(validateSettingsPatch({ relanceJours: -1 }).ok).toBe(false)
    expect(validateSettingsPatch({ relanceJours: 1.5 }).ok).toBe(false)
    expect(validateSettingsPatch({ relanceJours: 365 }).ok).toBe(false)
  })

  it('remonte un message en français', () => {
    const r = validateSettingsPatch({ relanceJours: -1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('délai de relance')
  })
})
```

- [ ] **Step 2: Vérifier**

Run: `npx vitest run src/services/settings.test.ts`
Expected: PASS — 5 tests nouveaux plus tous les existants

---

## Vérification finale du lot

- [ ] **Step 1: Suite complète et typage**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0

- [ ] **Step 2: Le test qui protège la frontière du produit, isolé**

Run: `npx vitest run -t "NE PORTE AUCUN MONTANT"`
Expected: PASS — 1 test

- [ ] **Step 3: Vérifier qu'aucun test ne touche le réseau**

```bash
grep -rn "https\?://" src --include=*.test.ts --include=*.test.tsx | grep -v "documenso.test\|http://local"
```

Expected: aucune ligne. Les seules URL présentes dans les tests sont celles du double de l'API Documenso et les URL fictives `http://local` des routes.

- [ ] **Step 4: Vérifier qu'aucun montant n'a pu entrer dans le document**

```bash
grep -rn "tjmCents\|Cents\|€" src/core/cra/ src/core/pdf/ src/services/cra-pdf.ts
```

Expected: aucune ligne hors commentaires. Le modèle du document n'a aucun champ monétaire, et rien dans la chaîne de rendu n'en manipule.

- [ ] **Step 5: Mettre `docs/superpowers/ETAT.md` à jour**

Passer le lot 3 à « plan : oui, 15 tâches » dans le tableau du § 5, et ajouter aux pièges d'environnement du § 7 :

> - **Le PDF est écrit à la main, sans bibliothèque** : ses flux de contenu ne sont **jamais** compressés. C'est ce qui rend `extraireTextes` capable de relire le document livré, et le test « aucun montant » réellement protecteur. Compresser un jour, c'est aveugler ce test.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/ETAT.md
git commit -m "docs: record lot 3 plan and the uncompressed-PDF constraint"
```

