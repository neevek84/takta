# Suivi CRA, génération depuis la saisie, vue 3 mois — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Déplacer la génération du CRA vers l'écran de saisie, transformer l'écran CRA en tableau de suivi filtrable, rendre le sort du prévisionnel à la décision humaine, ajouter une vue 3 mois, et cesser d'appeler Google à chaque ouverture de page.

**Architecture:** Sept chantiers indépendants (A à G) sur une application Next.js App Router existante. Aucune migration de base : la seule notion nouvelle, « facturé », est dérivée de champs qui existent. Les règles neuves vivent dans `src/core/` (pur, testable sans base), les lectures dans `src/services/`, les écrans dans `src/app/(app)/`. L'ordre de construction est F → B → A → D → C → G → E : chaque étape laisse le produit utilisable.

**Tech Stack:** Next.js 15 (App Router, server components + server actions) · TypeScript · Prisma (Postgres ou SQLite) · Tailwind v4 · Vitest + @testing-library/react + happy-dom

**Spec:** [`docs/superpowers/specs/2026-08-23-suivi-cra-et-vue-3-mois-design.md`](../specs/2026-08-23-suivi-cra-et-vue-3-mois-design.md)

## Contraintes globales

Elles s'appliquent à **toutes** les tâches. Aucune n'est négociable en cours de route.

- **Langue.** Code, commentaires, tests, messages d'interface et messages de commit : en français. Les messages de commit sont **sans accents** (convention du dépôt, voir `git log`).
- **Tests d'abord.** Chaque tâche écrit le test, le voit échouer, implémente, le voit passer, commite. Lancer un test : `npx vitest run <chemin>`. Toute la suite : `npm test`.
- **Aucune migration Prisma.** Si une tâche semble en exiger une, c'est qu'elle a dévié de la spec — s'arrêter et le signaler.
- **Les services sont scopés sur `userId`.** Toute lecture ou écriture qui touche un `Cra`, une `TimeEntry` ou une `Line` filtre sur l'utilisateur. C'est la garantie qu'on n'agit jamais sur les données d'un autre.
- **Aucune couleur inventée.** Les teintes viennent des jetons déclarés ; `src/components/ui/surfaces.test.tsx` et le contrôle de contraste refusent les couples non déclarés.
- **`window.confirm` est interdit.** Il bloque le fil et n'existe pas sous happy-dom. Toute confirmation est un panneau rendu dans le document.
- **Le `kind` d'une saisie n'est jamais fourni par le client.** L'horloge du serveur départage `REALISE` et `PREVISIONNEL`. Aucune tâche n'ajoute de paramètre `kind` à une server action.
- **Statuts CRA inchangés :** `BROUILLON | ENVOYE | VALIDE | REFUSE`. La machine à états de `src/core/cra/state-machine.ts` n'est pas touchée.
- **Un commit par tâche**, avec le préfixe conventionnel (`feat:`, `fix:`, `refactor:`, `docs:`).

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `src/core/cra/etat-suivi.ts` | L'état affiché par le suivi, dérivé du statut et de la facturation. Pur. |
| `src/core/cra/etat-suivi.test.ts` | — |
| `src/app/(app)/cra/[craId]/page.tsx` | La page de détail d'un CRA : tout ce que la carte portait. |
| `src/app/(app)/cra/[craId]/page.test.tsx` | — |
| `src/app/(app)/cra/[craId]/actions.ts` | Les server actions du détail (transitions, signature, suivi). |
| `src/components/cra/SuiviTable.tsx` | Le tableau du suivi. Composant serveur, sans état. |
| `src/components/cra/SuiviTable.test.tsx` | — |
| `src/components/cra/FiltreEtats.tsx` | Les cases à cocher du filtre. Client, écrit dans l'URL. |
| `src/components/cra/FiltreEtats.test.tsx` | — |
| `src/app/(app)/saisie/[month]/PanneauGeneration.tsx` | Le panneau qui pose la question du prévisionnel. |
| `src/app/(app)/saisie/[month]/PanneauGeneration.test.tsx` | — |
| `src/app/(app)/saisie/[month]/BoutonAgenda.tsx` | Le bouton « Vérifier l'agenda » et son compte rendu. |
| `src/app/(app)/saisie/[month]/BoutonAgenda.test.tsx` | — |
| `src/services/cra-generation.ts` | `genererCra` : la transaction prévisionnel + ouverture du CRA. |
| `src/services/cra-generation.test.ts` | — |

**Modifiés**

| Fichier | Ce qui change |
|---|---|
| `src/components/ui/PageShell.tsx` | Gabarit élargi, marges resserrées. |
| `src/components/cra/StatusBadge.tsx` | Gagne le cas `FACTURE`. |
| `src/services/cra.ts` | `listCras` → `listCrasSuivi` ; nouveau `getCra`. |
| `src/services/cra-previsionnel.ts` | Nouveau `validerPrevisionnelDuMois`. |
| `src/services/availability.ts` | `getBusyDays` → `getBusyRange`, qui distingue l'échec du vide. |
| `src/services/time-entries.ts` | Nouveau `getEntriesRange` ; `getMonthEntries` s'y appuie. |
| `src/core/audit/events.ts` | Nouvel événement `previsionnel.supprime`. |
| `src/core/audit/events.test.ts` | Le catalogue figé suit — ordre **et** longueur. |
| `src/app/(app)/cra/page.tsx` | Devient le tableau de suivi. Perd les cartes et le formulaire d'ouverture. |
| `src/app/(app)/cra/actions.ts` | Perd `openCra` ; les retours pointent vers le détail. |
| `src/components/nav/NavRail.tsx` | « CRA » → « Suivi CRA ». |
| `src/components/calendar/MonthCalendar.tsx` | Prop `densite`. |
| `src/app/(app)/saisie/[month]/page.tsx` | Trois mois, plus aucune lecture d'agenda. |
| `src/app/(app)/saisie/[month]/SaisieClient.tsx` | Vue `TROIS_MOIS`, bouton de génération, bouton d'agenda. |
| `src/app/(app)/saisie/[month]/actions.ts` | Actions `genererCraAction` et `verifierAgenda`. |

---

## Tâche 1 — F : le gabarit s'élargit

**Fichiers :**
- Modifier : `src/components/ui/PageShell.tsx:15`
- Modifier : `src/app/(app)/admin/theme/page.test.tsx:110`
- Modifier : `src/app/(app)/saisie/[month]/page.test.tsx:141`

**Interfaces :**
- Consomme : rien.
- Produit : le gabarit `mx-auto w-full max-w-[100rem] p-4 md:px-8 md:py-6`, sur lequel toutes les pages s'appuient. Les tâches suivantes ne le redéclarent jamais.

**Pourquoi d'abord :** isolé, sans dépendance, et il libère la largeur dont la vue 3 mois (tâche 14) a besoin.

- [ ] **Étape 1 : lire le test qui dérive le budget des cases**

Ouvrir `src/components/calendar/MonthCalendar.test.tsx` autour de la ligne 1449. Il extrait la marge de `PageShell.tsx` par `/<main className="[^"]*\bp-(\d+)\b/` et calcule `(375 - 2*MARGE - 6*gouttière) / 7 ≥ 44`.

**Ne pas le modifier.** Le nouveau gabarit déclare `p-4`, que ce motif capture toujours (`md:px-8` et `md:py-6` ne contiennent pas `p-` suivi d'un chiffre). Le budget passe de 45,0 à 47,3 points : le test doit continuer de passer **sans être touché**. S'il faut le modifier, c'est que le gabarit est faux.

- [ ] **Étape 2 : mettre à jour les deux tests qui assertent la largeur**

Dans `src/app/(app)/admin/theme/page.test.tsx` ligne 110 et `src/app/(app)/saisie/[month]/page.test.tsx` ligne 141, remplacer :

```ts
expect(principal.className).toContain('max-w-5xl')
```

par :

```ts
expect(principal.className).toContain('max-w-[100rem]')
```

- [ ] **Étape 3 : lancer les deux tests pour les voir échouer**

```bash
npx vitest run "src/app/(app)/admin/theme/page.test.tsx" "src/app/(app)/saisie/[month]/page.test.tsx"
```

Attendu : ÉCHEC — la classe attendue n'est pas dans le rendu.

- [ ] **Étape 4 : élargir le gabarit**

Dans `src/components/ui/PageShell.tsx`, remplacer la ligne du `<main>` par :

```tsx
    // 1600 points de contenu au lieu de 1024 : à côté d'un rail de 224, un
    // écran de 1920 laissait plus d'un tiers de sa largeur inutilisée, et la
    // vue 3 mois y serait à l'étroit sans raison.
    //
    // La marge tombe à 16 points sous `md`, et c'est un gain là où la place
    // manque le plus : la colonne du calendrier sur un écran de 375 passe de
    // 45,0 à 47,3 points, pour une cible tactile de 44. `MonthCalendar.test.tsx`
    // lit cette marge ici même et refuse qu'elle repasse sous le budget.
    <main className="mx-auto w-full max-w-[100rem] p-4 md:px-8 md:py-6">
```

- [ ] **Étape 5 : lancer les tests pour les voir passer**

```bash
npx vitest run "src/app/(app)/admin/theme/page.test.tsx" "src/app/(app)/saisie/[month]/page.test.tsx" src/components/calendar/MonthCalendar.test.tsx
```

Attendu : SUCCÈS pour les trois, `MonthCalendar.test.tsx` inclus et non modifié.

- [ ] **Étape 6 : commit**

```bash
git add src/components/ui/PageShell.tsx "src/app/(app)/admin/theme/page.test.tsx" "src/app/(app)/saisie/[month]/page.test.tsx"
git commit -m "feat(gabarit): les ecrans occupent enfin la largeur disponible"
```

---

## Tâche 2 — B : le service `getCra`

**Fichiers :**
- Modifier : `src/services/cra.ts`
- Test : `src/services/cra.test.ts`

**Interfaces :**
- Consomme : `CraView`, `WITH_MISSION`, `toView`, `craAvecArchive`, `syntheseParMission`, `compterPrevisionnelParMission`, `missionsArmeesPourDolibarr` — tous déjà présents dans `src/services/cra.ts`.
- Produit : `getCra(userId: string, craId: string): Promise<CraView>` — lève quand rien ne correspond.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter dans `src/services/cra.test.ts`, en suivant le style de montage des doubles déjà utilisé dans ce fichier :

```ts
describe('getCra', () => {
  it('rend un CRA complet — synthese, previsionnel et armement Dolibarr', async () => {
    const cra = await getCra('u1', 'cra-1')

    expect(cra.id).toBe('cra-1')
    expect(cra.synthese.totalCentiemes).toBeGreaterThan(0)
  })

  // Le scope par utilisateur est la garantie qu'on n'affiche jamais le CRA
  // d'un autre. Il se teste, il ne se suppose pas.
  it('leve quand le CRA appartient a quelqu un d autre', async () => {
    await expect(getCra('u2', 'cra-1')).rejects.toThrow()
  })

  // Un CRA valide n'a plus de previsionnel a annoncer : il a ete emporte au
  // moment ou il l'a ete. La liste applique deja cette regle ; le detail ne
  // peut pas en appliquer une autre.
  it('n annonce aucun previsionnel sur un CRA valide', async () => {
    const cra = await getCra('u1', 'cra-valide')

    expect(cra.previsionnelAAnnuler).toBe(0)
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run src/services/cra.test.ts -t "getCra"
```

Attendu : ÉCHEC — `getCra` n'est pas exporté.

- [ ] **Étape 3 : implémenter**

Ajouter dans `src/services/cra.ts` :

```ts
/**
 * Un CRA, complet, pour sa page de détail.
 *
 * Les fonctions de lot sont appelées avec un seul identifiant plutôt que
 * réécrites pour l'unité : un second chemin de calcul finirait par diverger du
 * premier, et la liste et le détail afficheraient alors deux chiffres pour le
 * même CRA.
 *
 * `findFirstOrThrow` et non `findUnique` : le scope par `userId` fait partie
 * de la requête, il n'est pas vérifié après coup. C'est ce qui garantit qu'on
 * ne sert jamais le CRA d'un autre, même en connaissant son identifiant.
 */
export async function getCra(userId: string, craId: string): Promise<CraView> {
  const row = await prisma.cra.findFirstOrThrow({
    where: { id: craId, userId },
    include: WITH_MISSION,
  })

  const month = row.month.toISOString().slice(0, 7)
  const archives = await craAvecArchive([row.id])
  const previsionnel = await compterPrevisionnelParMission({
    userId,
    missionIds: [row.missionId],
    month,
  })
  const armees = await missionsArmeesPourDolibarr([row.missionId])
  const syntheses = await syntheseParMission({ userId, missionIds: [row.missionId], month })

  return toView(
    row,
    archives,
    row.status === 'VALIDE' ? 0 : (previsionnel.get(row.missionId) ?? 0),
    armees.has(row.missionId),
    syntheses.get(row.missionId) ?? SYNTHESE_VIDE,
  )
}
```

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
npx vitest run src/services/cra.test.ts
```

Attendu : SUCCÈS, y compris les tests existants du fichier.

- [ ] **Étape 5 : commit**

```bash
git add src/services/cra.ts src/services/cra.test.ts
git commit -m "feat(cra): un CRA se lit seul, pour sa page de detail"
```

---

## Tâche 3 — B : la page de détail `/cra/[craId]`

**Fichiers :**
- Créer : `src/app/(app)/cra/[craId]/page.tsx`
- Créer : `src/app/(app)/cra/[craId]/page.test.tsx`
- Créer : `src/app/(app)/cra/[craId]/actions.ts`
- Modifier : `src/app/(app)/cra/actions.ts`

**Interfaces :**
- Consomme : `getCra` (tâche 2).
- Produit : la route `/cra/<id>`, et les actions `moveCra`, `saveTracking`, `envoyerPourSignature`, `rafraichirSignature` déplacées dans `[craId]/actions.ts`, retournant vers `/cra/<id>`.

**Note :** `lancerRelances` **reste** dans `src/app/(app)/cra/actions.ts` — c'est une action de la liste, pas du détail. `openCra` y reste aussi pour l'instant ; la tâche 9 le retirera.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `src/app/(app)/cra/[craId]/page.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { cra, introuvable } = vi.hoisted(() => ({
  cra: { valeur: null as unknown },
  introuvable: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser: async () => ({ id: 'u1', role: 'ADMIN' as const }) }))
vi.mock('@/services/cra', () => ({
  getCra: async () => {
    if (cra.valeur === null) throw new Error('introuvable')
    return cra.valeur
  },
}))
vi.mock('next/navigation', () => ({ notFound: introuvable }))
vi.mock('./actions', () => ({
  moveCra: vi.fn(),
  saveTracking: vi.fn(),
  envoyerPourSignature: vi.fn(),
  rafraichirSignature: vi.fn(),
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import CraDetailPage from './page'

function unCra(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cra-1',
    missionId: 'm1',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    month: '2026-03',
    status: 'ENVOYE',
    invoiceNumber: null,
    invoicedAt: null,
    paidAt: null,
    signataireNom: 'Claire Martin',
    signataireEmail: 'claire@acme.test',
    signature: null,
    previsionnelAAnnuler: 0,
    iraDansDolibarr: true,
    synthese: { totalCentiemes: 1200, joursServis: 12, lignes: [{ label: 'Run', centiemes: 1200 }] },
    ...extra,
  }
}

async function rendre(valeur: unknown, searchParams: Record<string, string> = {}) {
  cra.valeur = valeur
  return render(
    await CraDetailPage({
      params: Promise.resolve({ craId: 'cra-1' }),
      searchParams: Promise.resolve(searchParams),
    }),
  )
}

describe('page de detail du CRA', () => {
  afterEach(() => {
    cleanup()
    introuvable.mockClear()
  })

  it('montre la synthese, le telechargement et les transitions', async () => {
    await rendre(unCra())

    expect(screen.getByText('ACME · ITSM')).toBeTruthy()
    expect(screen.getByText('12,00 j')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Télécharger le PDF/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Marquer validé' })).toBeTruthy()
  })

  // Le lien porte l'identifiant de CE CRA. Servir le document nominatif d'un
  // autre serait une fuite, pas un defaut d'affichage.
  it('telecharge le PDF de ce CRA, pas d un autre', async () => {
    await rendre(unCra({ id: 'cra-42' }))

    const lien = screen.getByRole('link', { name: /Télécharger le PDF/ })
    expect(lien.getAttribute('href')).toBe('/cra/cra-42/pdf')
  })

  // Les deux garde-fous doivent etre LUS avant d'agir : c'est toute la raison
  // pour laquelle la liste n'offre aucune transition.
  it('place les avertissements avant les boutons de transition', async () => {
    const { container } = await rendre(
      unCra({ iraDansDolibarr: false, previsionnelAAnnuler: 3 }),
    )

    const texte = container.textContent ?? ''
    expect(texte.indexOf('n’ira pas dans Dolibarr')).toBeGreaterThan(-1)
    expect(texte.indexOf('3 jour')).toBeGreaterThan(-1)
    expect(texte.indexOf('n’ira pas dans Dolibarr')).toBeLessThan(
      texte.indexOf('Marquer validé'),
    )
  })

  it('rend notFound quand le CRA n appartient pas a l utilisateur', async () => {
    await rendre(null)

    expect(introuvable).toHaveBeenCalled()
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run "src/app/(app)/cra/[craId]/page.test.tsx"
```

Attendu : ÉCHEC — le module `./page` n'existe pas.

- [ ] **Étape 3 : déplacer les actions du détail**

Créer `src/app/(app)/cra/[craId]/actions.ts` en **déplaçant** depuis `src/app/(app)/cra/actions.ts` : `moveCra`, `saveTracking`, `envoyerPourSignature`, `rafraichirSignature`, la fonction `retour` et le dictionnaire `ERREURS` (qui vit aujourd'hui dans `page.tsx` de la liste).

La fonction `retour` change de cible :

```ts
/**
 * Les server actions de signature ne rendent rien : le motif d'échec repasse
 * par l'URL, et la page le traduit en bandeau. Elle pointe désormais vers le
 * détail — c'est là que l'action a été déclenchée, et c'est là que l'utilisateur
 * doit retrouver son CRA, pas au sommet d'une liste de trente lignes.
 */
function retour(craId: string, raison?: string): never {
  redirect(
    `/cra/${encodeURIComponent(craId)}` +
      (raison === undefined ? '' : `?erreur=${encodeURIComponent(raison)}`),
  )
}
```

Chaque action revalide les deux écrans — la liste montre l'état et le numéro de facture, elle doit suivre :

```ts
revalidatePath('/cra')
revalidatePath(`/cra/${craId}`)
revalidatePath('/saisie')
```

Retirer de `src/app/(app)/cra/actions.ts` les quatre actions déplacées. `openCra` et `lancerRelances` y restent.

- [ ] **Étape 4 : écrire la page**

Créer `src/app/(app)/cra/[craId]/page.tsx`. Elle reprend **telles quelles** les sections que `src/app/(app)/cra/page.tsx` rendait dans sa carte, dans cet ordre : bandeau d'erreur, en-tête (client · mission, `libelleMois`, `StatusBadge`, `Origine`), bandeau Dolibarr, synthèse, `SignatureCard`, bandeau prévisionnel, lien PDF + envoi + rafraîchissement, transitions, formulaire de suivi.

Squelette, avec les points qui ne se devinent pas :

```tsx
import { notFound } from 'next/navigation'
import { requireUser } from '@/auth'
import { getCra } from '@/services/cra'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { formatJours, libelleMois } from '@/core/cra/document'
import { PageShell } from '@/components/ui/PageShell'
// … Banner, Button, Card, Field, Origine, SignatureCard, StatusBadge
import { envoyerPourSignature, moveCra, rafraichirSignature, saveTracking } from './actions'

const LABELS: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
}

const ALL: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR']

const ERREURS: Record<string, string> = {
  /* déplacé depuis la page de liste, à l'identique */
}

export default async function CraDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ craId: string }>
  searchParams: Promise<{ erreur?: string }>
}) {
  await requireUser()
  const { craId } = await params
  const { erreur } = await searchParams

  // `getCra` lève quand le CRA n'existe pas OU qu'il appartient à quelqu'un
  // d'autre — et les deux cas rendent la même chose. Distinguer « absent » de
  // « pas à vous » apprendrait à un tiers quels identifiants existent.
  let cra
  try {
    cra = await getCra((await requireUser()).id, craId)
  } catch {
    notFound()
  }

  // … le rendu, repris de la carte
}
```

**Le bandeau Dolibarr et le bandeau prévisionnel sont rendus AVANT le bloc des transitions.** C'est ce que le test vérifie, et c'est la contrepartie du fait que la liste n'offre aucun bouton d'état.

Le lien PDF porte l'identifiant du CRA affiché : `` href={`/cra/${cra.id}/pdf`} ``.

- [ ] **Étape 5 : lancer les tests pour les voir passer**

```bash
npx vitest run "src/app/(app)/cra/[craId]/page.test.tsx" "src/app/(app)/cra/page.test.tsx"
```

Attendu : SUCCÈS pour la nouvelle page. `cra/page.test.tsx` peut échouer sur les actions déplacées : corriger ses `vi.mock` pour qu'ils ne réclament plus que `openCra` et `lancerRelances`. Ce fichier sera réécrit en tâche 6.

- [ ] **Étape 6 : commit**

```bash
git add "src/app/(app)/cra/[craId]" "src/app/(app)/cra/actions.ts" "src/app/(app)/cra/page.test.tsx"
git commit -m "feat(cra): chaque CRA a sa page, ou tout ce qui engage se lit avant d agir"
```

---

## Tâche 4 — A : l'état de suivi, et le badge qui le dit

**Fichiers :**
- Créer : `src/core/cra/etat-suivi.ts`
- Créer : `src/core/cra/etat-suivi.test.ts`
- Modifier : `src/components/cra/StatusBadge.tsx`

**Interfaces :**
- Consomme : `CraStatus` de `src/core/types.ts`.
- Produit :
  - `type EtatSuivi = CraStatus | 'FACTURE'`
  - `const ETATS_SUIVI: readonly EtatSuivi[]`
  - `const ETATS_PAR_DEFAUT: readonly EtatSuivi[]`
  - `function estFacture(cra: { invoiceNumber: string | null; invoicedAt: Date | null }): boolean`
  - `function etatSuivi(cra: { status: CraStatus; invoiceNumber: string | null; invoicedAt: Date | null }): EtatSuivi`
  - `function parseEtats(brut: string | undefined): EtatSuivi[]`
  - `function libelleEtat(etat: EtatSuivi): string`
  - `StatusBadge` accepte désormais un `EtatSuivi`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `src/core/cra/etat-suivi.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  ETATS_PAR_DEFAUT,
  ETATS_SUIVI,
  estFacture,
  etatSuivi,
  libelleEtat,
  parseEtats,
} from './etat-suivi'

const BASE = { status: 'VALIDE' as const, invoiceNumber: null, invoicedAt: null }

describe('etatSuivi', () => {
  it('rend le statut tel quel tant que rien n est facture', () => {
    expect(etatSuivi({ ...BASE, status: 'BROUILLON' })).toBe('BROUILLON')
    expect(etatSuivi({ ...BASE, status: 'ENVOYE' })).toBe('ENVOYE')
    expect(etatSuivi(BASE)).toBe('VALIDE')
    expect(etatSuivi({ ...BASE, status: 'REFUSE' })).toBe('REFUSE')
  })

  it('rend FACTURE des qu un numero ou une date de facturation est pose', () => {
    expect(etatSuivi({ ...BASE, invoiceNumber: 'F-2026-014' })).toBe('FACTURE')
    expect(etatSuivi({ ...BASE, invoicedAt: new Date('2026-04-02') })).toBe('FACTURE')
  })

  // Le suivi de facturation est saisi a la main, sur n'importe quel CRA. Un
  // brouillon portant un numero reste un brouillon : le cycle du document
  // n'est pas alle au bout, et le masquer par defaut le ferait disparaitre.
  it('ne facture que ce qui est valide', () => {
    expect(etatSuivi({ ...BASE, status: 'BROUILLON', invoiceNumber: 'F-1' })).toBe('BROUILLON')
  })

  // Facturer n'est pas encaisser. Un CRA facture impaye doit rester sous
  // « Facture » plutot que de creer une sixieme categorie que personne n'a
  // demandee.
  it('ignore la date de paiement', () => {
    expect(estFacture({ invoiceNumber: null, invoicedAt: null })).toBe(false)
  })

  it('traite la chaine vide comme une absence de numero', () => {
    expect(estFacture({ invoiceNumber: '', invoicedAt: null })).toBe(false)
  })
})

describe('parseEtats', () => {
  // L'absence de parametre vaut le defaut : un parametre qui ne dit rien de
  // plus que son absence encombrerait toutes les adresses.
  it('rend le defaut quand le parametre est absent', () => {
    expect(parseEtats(undefined)).toEqual([...ETATS_PAR_DEFAUT])
  })

  // Et la chaine vide vaut « rien de coche », qui est un choix de
  // l'utilisateur — pas la meme chose qu'une absence.
  it('rend une liste vide quand le parametre est vide', () => {
    expect(parseEtats('')).toEqual([])
  })

  it('lit les etats separes par des virgules', () => {
    expect(parseEtats('ENVOYE,FACTURE')).toEqual(['ENVOYE', 'FACTURE'])
  })

  it('ecarte ce qui n est pas un etat connu', () => {
    expect(parseEtats('ENVOYE,PIRATE')).toEqual(['ENVOYE'])
  })

  it('n a pas de doublon', () => {
    expect(parseEtats('ENVOYE,ENVOYE')).toEqual(['ENVOYE'])
  })
})

describe('le catalogue', () => {
  it('porte les cinq etats, dans l ordre du cycle', () => {
    expect([...ETATS_SUIVI]).toEqual(['BROUILLON', 'ENVOYE', 'VALIDE', 'REFUSE', 'FACTURE'])
  })

  // Ce que le porteur a demande : la liste s'allege de ce qui est alle au bout.
  it('masque par defaut ce qui est valide ou facture', () => {
    expect([...ETATS_PAR_DEFAUT]).toEqual(['BROUILLON', 'ENVOYE', 'REFUSE'])
  })

  it('nomme chaque etat en francais', () => {
    expect(ETATS_SUIVI.map(libelleEtat)).toEqual([
      'Brouillon',
      'Envoyé',
      'Validé',
      'Refusé',
      'Facturé',
    ])
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run src/core/cra/etat-suivi.test.ts
```

Attendu : ÉCHEC — le module n'existe pas.

- [ ] **Étape 3 : implémenter le module pur**

Créer `src/core/cra/etat-suivi.ts` :

```ts
import type { CraStatus } from '../types'

/**
 * Ce que l'écran de suivi affiche, et ce sur quoi son filtre porte.
 *
 * **`FACTURE` n'est pas un statut** et ne le deviendra pas : la machine à
 * états décrit le cycle du *document* — écrit, envoyé, validé ou refusé — et
 * ce cycle s'arrête à la validation. La facturation est un fait qu'on note à
 * côté, saisi à la main, dont `services/cra.ts` rappelle qu'il n'est le
 * produit d'aucun calcul : l'application ne facture pas.
 *
 * En faire un état dérivé garde donc les deux notions à leur place, et évite
 * une migration, une transition, un événement de journal, et la question sans
 * intérêt de ce que « rouvrir un CRA facturé » voudrait dire.
 */
export type EtatSuivi = CraStatus | 'FACTURE'

/** Dans l'ordre du cycle : c'est celui dans lequel le filtre les propose. */
export const ETATS_SUIVI: readonly EtatSuivi[] = [
  'BROUILLON',
  'ENVOYE',
  'VALIDE',
  'REFUSE',
  'FACTURE',
]

/**
 * Ce que le suivi montre quand personne n'a rien demandé : tout **sauf** ce
 * qui est allé au bout du cycle. C'est ce qui allège la liste quand elle
 * comptera des centaines de lignes — le porteur ne veut y voir que ce qui
 * demande encore un geste.
 */
export const ETATS_PAR_DEFAUT: readonly EtatSuivi[] = ['BROUILLON', 'ENVOYE', 'REFUSE']

const LIBELLES: Record<EtatSuivi, string> = {
  BROUILLON: 'Brouillon',
  ENVOYE: 'Envoyé',
  VALIDE: 'Validé',
  REFUSE: 'Refusé',
  FACTURE: 'Facturé',
}

export function libelleEtat(etat: EtatSuivi): string {
  return LIBELLES[etat]
}

/**
 * La facture est-elle renseignée ?
 *
 * `paidAt` n'entre pas dans la règle : on peut facturer sans être payé, et un
 * CRA facturé impayé doit rester visible sous « Facturé » plutôt que de
 * disparaître dans une sixième catégorie que personne n'a demandée.
 *
 * La chaîne vide vaut une absence. `saveTracking` écrit déjà `null` plutôt
 * qu'une chaîne vide, mais une donnée reprise d'ailleurs n'a pas cette
 * garantie, et un numéro de facture vide ne facture rien.
 */
export function estFacture(cra: {
  invoiceNumber: string | null
  invoicedAt: Date | null
}): boolean {
  return (cra.invoiceNumber !== null && cra.invoiceNumber !== '') || cra.invoicedAt !== null
}

/**
 * L'état affiché d'un CRA.
 *
 * Seul un CRA **validé** peut être « facturé » : le suivi de facturation se
 * saisit sur n'importe quel CRA, et un brouillon portant un numéro reste un
 * brouillon — le masquer par défaut le ferait disparaître de l'écran alors
 * qu'il demande encore un geste.
 */
export function etatSuivi(cra: {
  status: CraStatus
  invoiceNumber: string | null
  invoicedAt: Date | null
}): EtatSuivi {
  return cra.status === 'VALIDE' && estFacture(cra) ? 'FACTURE' : cra.status
}

/**
 * Les états demandés par l'adresse.
 *
 * **L'absence et le vide ne disent pas la même chose.** Pas de paramètre du
 * tout : personne n'a choisi, on applique le défaut. Un paramètre vide :
 * l'utilisateur a tout décoché, et l'écran doit le lui dire au lieu de
 * ressusciter un filtre qu'il vient de retirer.
 */
export function parseEtats(brut: string | undefined): EtatSuivi[] {
  if (brut === undefined) return [...ETATS_PAR_DEFAUT]

  const connus = new Set<string>(ETATS_SUIVI)
  const vus = new Set<EtatSuivi>()
  for (const morceau of brut.split(',')) {
    const valeur = morceau.trim()
    if (connus.has(valeur)) vus.add(valeur as EtatSuivi)
  }
  return [...vus]
}
```

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
npx vitest run src/core/cra/etat-suivi.test.ts
```

Attendu : SUCCÈS.

- [ ] **Étape 5 : étendre le badge**

Dans `src/components/cra/StatusBadge.tsx`, élargir la table et les signatures à `EtatSuivi`. `IconeFacture` n'existe pas : réutiliser `IconeSucces` serait indistinguable de `VALIDE`, ce que le commentaire du composant interdit explicitement (« chacun porte une icône qui lui est propre »). Ajouter dans `src/components/ui/icons.tsx`, à côté des autres :

```ts
export const IconeFacture = fabrique(Receipt, 'facture')
```

en important `Receipt` depuis `lucide-react`. Puis :

```tsx
const BADGES: Record<EtatSuivi, { tone: Tone; icone: Icone; label: string }> = {
  BROUILLON: { tone: 'neutral', icone: IconeBrouillon, label: 'Brouillon' },
  ENVOYE: { tone: 'info', icone: IconeEnvoye, label: 'Envoyé' },
  VALIDE: { tone: 'success', icone: IconeSucces, label: 'Validé' },
  REFUSE: { tone: 'danger', icone: IconeDanger, label: 'Refusé' },
  // Le cycle est allé jusqu'au bout : ni une alerte, ni une réussite de plus à
  // fêter. `neutral` est la teinte de ce qui est classé.
  FACTURE: { tone: 'neutral', icone: IconeFacture, label: 'Facturé' },
}

export function StatusBadge({ status }: { status: EtatSuivi }) { /* inchangé */ }
```

Remplacer les deux occurrences de `CraStatus` par `EtatSuivi` dans ce fichier, `craStatusBadge` incluse.

- [ ] **Étape 6 : lancer les tests du badge et du système de design**

```bash
npx vitest run src/components/cra/StatusBadge.test.tsx src/components/ui/surfaces.test.tsx src/design-system.test.ts
```

Attendu : SUCCÈS. Si le contrôle de contraste refuse le couple choisi, prendre une paire déclarée — ne pas assouplir le contrôle.

- [ ] **Étape 7 : commit**

```bash
git add src/core/cra/etat-suivi.ts src/core/cra/etat-suivi.test.ts src/components/cra/StatusBadge.tsx src/components/ui/icons.tsx
git commit -m "feat(cra): un CRA facture se distingue d un CRA valide"
```

---

## Tâche 5 — A : `listCrasSuivi`, le filtre appliqué en base

**Fichiers :**
- Modifier : `src/services/cra.ts`
- Test : `src/services/cra.test.ts`

**Interfaces :**
- Consomme : `EtatSuivi`, `estFacture` (tâche 4).
- Produit : `listCrasSuivi(userId: string, args: { etats: EtatSuivi[]; month?: string }): Promise<CraView[]>`. `listCras` disparaît — son seul appelant est la page réécrite en tâche 6.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter dans `src/services/cra.test.ts` :

```ts
describe('listCrasSuivi', () => {
  // LE piege de cet ecran. Sans exclusion explicite, decocher « Facture »
  // ne masquerait rien tant que « Valide » reste coche : les factures sont
  // des CRA valides.
  it('cocher VALIDE sans FACTURE ne ramene pas les factures', async () => {
    const where = await capturerWhere(() => listCrasSuivi('u1', { etats: ['VALIDE'] }))

    expect(where.OR).toContainEqual({ status: 'VALIDE', invoiceNumber: null, invoicedAt: null })
  })

  it('cocher FACTURE ne ramene que des valides factures', async () => {
    const where = await capturerWhere(() => listCrasSuivi('u1', { etats: ['FACTURE'] }))

    expect(where.OR).toContainEqual({
      status: 'VALIDE',
      OR: [{ NOT: { invoiceNumber: null } }, { NOT: { invoicedAt: null } }],
    })
  })

  it('groupe les statuts simples en une seule clause', async () => {
    const where = await capturerWhere(() =>
      listCrasSuivi('u1', { etats: ['BROUILLON', 'ENVOYE', 'REFUSE'] }),
    )

    expect(where.OR).toContainEqual({ status: { in: ['BROUILLON', 'ENVOYE', 'REFUSE'] } })
  })

  // Aucun etat coche : la reponse est « rien », et elle ne coute aucune
  // requete. Une clause `OR: []` en Prisma ne rend rien non plus, mais elle
  // fait payer le trajet.
  it('ne lit pas la base quand aucun etat n est demande', async () => {
    const cras = await listCrasSuivi('u1', { etats: [] })

    expect(cras).toEqual([])
    expect(prismaEspion.cra.findMany).not.toHaveBeenCalled()
  })

  // Sans mois, toutes periodes : c'est ce qui donne son sens au filtre.
  it('ne borne pas le mois quand aucun n est demande', async () => {
    const where = await capturerWhere(() => listCrasSuivi('u1', { etats: ['ENVOYE'] }))

    expect(where.month).toBeUndefined()
  })

  it('borne le mois quand il est demande', async () => {
    const where = await capturerWhere(() =>
      listCrasSuivi('u1', { etats: ['ENVOYE'], month: '2026-03' }),
    )

    expect(where.month).toEqual(new Date('2026-03-01T00:00:00.000Z'))
  })

  // Le mois le plus recent en tete : c'est celui sur lequel on agit.
  it('trie du mois le plus recent au plus ancien, puis par mission', async () => {
    const orderBy = await capturerOrderBy(() => listCrasSuivi('u1', { etats: ['ENVOYE'] }))

    expect(orderBy).toEqual([{ month: 'desc' }, { mission: { label: 'asc' } }])
  })

  it('est toujours scope sur l utilisateur', async () => {
    const where = await capturerWhere(() => listCrasSuivi('u1', { etats: ['ENVOYE'] }))

    expect(where.userId).toBe('u1')
  })
})
```

Les aides `capturerWhere` / `capturerOrderBy` / `prismaEspion` lisent les arguments passés au double de `prisma.cra.findMany` déjà monté dans ce fichier. Si le fichier n'expose pas encore d'espion, l'ajouter en suivant le montage `vi.mock('@/db/client', …)` existant :

```ts
async function capturerWhere(action: () => Promise<unknown>): Promise<Record<string, any>> {
  prismaEspion.cra.findMany.mockClear()
  await action()
  return prismaEspion.cra.findMany.mock.calls[0]![0]!.where
}
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run src/services/cra.test.ts -t "listCrasSuivi"
```

Attendu : ÉCHEC — `listCrasSuivi` n'est pas exporté.

- [ ] **Étape 3 : implémenter**

Dans `src/services/cra.ts`, **remplacer** `listCras` par :

```ts
/**
 * Les clauses Prisma d'un jeu d'états de suivi.
 *
 * `VALIDE` et `FACTURE` désignent tous deux des CRA au statut `VALIDE` : ils
 * ne peuvent donc pas entrer dans le même `status: { in: … }`, sans quoi
 * cocher « Validé » ramènerait exactement ce que « Facturé » décoché venait de
 * masquer. C'est le piège de cet écran, et c'est pour cela que les deux
 * portent une clause à eux.
 */
function clausesDesEtats(etats: EtatSuivi[]): Prisma.CraWhereInput[] {
  const clauses: Prisma.CraWhereInput[] = []

  const simples = etats.filter((e) => e !== 'VALIDE' && e !== 'FACTURE')
  if (simples.length > 0) clauses.push({ status: { in: simples } })

  // Validé **et pas encore facturé** : l'absence des deux champs de suivi.
  if (etats.includes('VALIDE')) {
    clauses.push({ status: 'VALIDE', invoiceNumber: null, invoicedAt: null })
  }

  // Facturé : validé, plus au moins un des deux champs. Le miroir exact
  // d'`estFacture`, écrit en SQL — les deux règles doivent bouger ensemble.
  if (etats.includes('FACTURE')) {
    clauses.push({
      status: 'VALIDE',
      OR: [{ NOT: { invoiceNumber: null } }, { NOT: { invoicedAt: null } }],
    })
  }

  return clauses
}

/**
 * Les CRA du suivi : toutes périodes par défaut, filtrés par état.
 *
 * Le filtre est appliqué **en base** et non après lecture : cet écran est fait
 * pour le jour où il y aura des centaines de lignes, et tout charger pour en
 * jeter les neuf dixièmes ferait payer l'écran au nombre de mois travaillés.
 *
 * Le tri met le mois le plus récent en tête : c'est celui sur lequel on agit.
 */
export async function listCrasSuivi(
  userId: string,
  args: { etats: EtatSuivi[]; month?: string },
): Promise<CraView[]> {
  const clauses = clausesDesEtats(args.etats)
  // Aucun état coché : la réponse est « rien », et elle ne coûte pas un
  // aller-retour à la base pour l'apprendre.
  if (clauses.length === 0) return []

  const rows = await prisma.cra.findMany({
    where: {
      userId,
      ...(args.month === undefined ? {} : { month: monthStart(args.month) }),
      OR: clauses,
    },
    include: WITH_MISSION,
    orderBy: [{ month: 'desc' }, { mission: { label: 'asc' } }],
  })

  const archives = await craAvecArchive(rows.map((r) => r.id))

  // Les trois lectures de lot sont désormais faites **par mois** : leurs
  // signatures prennent un mois unique, et la liste en couvre plusieurs. Une
  // passe par mois distinct, et non une par CRA — l'écran ne doit pas payer au
  // nombre de lignes.
  const parMois = new Map<string, Row[]>()
  for (const row of rows) {
    const mois = row.month.toISOString().slice(0, 7)
    const seau = parMois.get(mois)
    if (seau === undefined) parMois.set(mois, [row])
    else seau.push(row)
  }

  const vues: CraView[] = []
  for (const [mois, lignes] of parMois) {
    const missionIds = lignes.map((l) => l.missionId)
    const previsionnel = await compterPrevisionnelParMission({ userId, missionIds, month: mois })
    const armees = await missionsArmeesPourDolibarr(missionIds)
    const syntheses = await syntheseParMission({ userId, missionIds, month: mois })

    for (const row of lignes) {
      vues.push(
        toView(
          row,
          archives,
          row.status === 'VALIDE' ? 0 : (previsionnel.get(row.missionId) ?? 0),
          armees.has(row.missionId),
          syntheses.get(row.missionId) ?? SYNTHESE_VIDE,
        ),
      )
    }
  }

  // Le regroupement par mois a défait l'ordre de la requête : on le rétablit.
  return vues.sort(
    (a, b) =>
      b.month.localeCompare(a.month) || a.missionLabel.localeCompare(b.missionLabel, 'fr'),
  )
}
```

Importer `EtatSuivi` depuis `@/core/cra/etat-suivi` et `Prisma` depuis `@prisma/client`.

- [ ] **Étape 4 : lancer les tests pour les voir passer**

```bash
npx vitest run src/services/cra.test.ts
```

Attendu : SUCCÈS. Les tests existants qui appelaient `listCras` sont adaptés à la nouvelle signature.

- [ ] **Étape 5 : commit**

```bash
git add src/services/cra.ts src/services/cra.test.ts
git commit -m "feat(cra): le suivi lit tous les mois, et filtre en base"
```

---

## Tâche 6 — A : l'écran Suivi CRA

**Fichiers :**
- Créer : `src/components/cra/FiltreEtats.tsx`
- Créer : `src/components/cra/FiltreEtats.test.tsx`
- Créer : `src/components/cra/SuiviTable.tsx`
- Créer : `src/components/cra/SuiviTable.test.tsx`
- Modifier : `src/app/(app)/cra/page.tsx` (réécriture)
- Modifier : `src/app/(app)/cra/page.test.tsx` (réécriture)
- Modifier : `src/components/nav/NavRail.tsx:32`
- Modifier : `src/components/nav/NavRail.test.tsx`

**Interfaces :**
- Consomme : `listCrasSuivi` (tâche 5), `etatSuivi`, `parseEtats`, `ETATS_SUIVI`, `libelleEtat` (tâche 4), `StatusBadge` étendu (tâche 4).
- Produit : la route `/cra` en tableau, et l'entrée de navigation « Suivi CRA ».

- [ ] **Étape 1 : écrire les tests du tableau et du filtre**

Créer `src/components/cra/SuiviTable.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SuiviTable } from './SuiviTable'

function unCra(extra: Record<string, unknown> = {}) {
  return {
    id: 'cra-1',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    month: '2026-03',
    status: 'ENVOYE',
    invoiceNumber: null,
    invoicedAt: null,
    synthese: { totalCentiemes: 1250, joursServis: 13, lignes: [] },
    ...extra,
  }
}

describe('SuiviTable', () => {
  afterEach(cleanup)

  it('montre une ligne par CRA, avec son mois et ses jours', () => {
    render(<SuiviTable cras={[unCra()] as never} />)

    expect(screen.getByText('mars 2026')).toBeTruthy()
    expect(screen.getByText('ACME')).toBeTruthy()
    expect(screen.getByText('12,50')).toBeTruthy()
  })

  it('ouvre le detail du bon CRA', () => {
    render(<SuiviTable cras={[unCra({ id: 'cra-42' })] as never} />)

    expect(screen.getByRole('link', { name: /Ouvrir/ }).getAttribute('href')).toBe('/cra/cra-42')
  })

  it('affiche FACTURE pour un CRA valide portant un numero', () => {
    render(<SuiviTable cras={[unCra({ status: 'VALIDE', invoiceNumber: 'F-14' })] as never} />)

    expect(screen.getByTestId('cra-statut').textContent).toContain('Facturé')
  })

  // La liste montre et filtre ; le detail agit. Un bouton de transition ici
  // permettrait de valider sans avoir lu les deux avertissements qui vivent
  // sur la page de detail.
  it('n offre aucun bouton de transition', () => {
    render(<SuiviTable cras={[unCra()] as never} />)

    expect(screen.queryByRole('button', { name: 'Marquer validé' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('dit qu il n y a rien plutot que de rendre un tableau vide', () => {
    render(<SuiviTable cras={[]} />)

    expect(screen.getByText(/Aucun CRA/)).toBeTruthy()
  })
})
```

Créer `src/components/cra/FiltreEtats.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { FiltreEtats } from './FiltreEtats'

describe('FiltreEtats', () => {
  afterEach(() => {
    cleanup()
    push.mockClear()
  })

  it('propose les cinq etats', () => {
    render(<FiltreEtats etats={['BROUILLON', 'ENVOYE', 'REFUSE']} month={undefined} />)

    for (const nom of ['Brouillon', 'Envoyé', 'Validé', 'Refusé', 'Facturé']) {
      expect(screen.getByRole('checkbox', { name: nom })).toBeTruthy()
    }
  })

  it('coche ce qui est actif, decoche le reste', () => {
    render(<FiltreEtats etats={['BROUILLON', 'ENVOYE', 'REFUSE']} month={undefined} />)

    expect((screen.getByRole('checkbox', { name: 'Envoyé' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Validé' }) as HTMLInputElement).checked).toBe(false)
  })

  // Ce qu'on regarde vit dans l'adresse : c'est ce qui rend le filtrage
  // partageable, rejouable, et resistant au rechargement.
  it('ecrit le choix dans l adresse', async () => {
    render(<FiltreEtats etats={['ENVOYE']} month={undefined} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Facturé' }))

    expect(push).toHaveBeenCalledWith('/cra?etats=ENVOYE%2CFACTURE')
  })

  // Tout decocher n'est pas « revenir au defaut » : c'est un choix, et
  // l'adresse doit pouvoir le dire.
  it('ecrit un parametre vide quand tout est decoche', async () => {
    render(<FiltreEtats etats={['ENVOYE']} month={undefined} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Envoyé' }))

    expect(push).toHaveBeenCalledWith('/cra?etats=')
  })
})
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

```bash
npx vitest run src/components/cra/SuiviTable.test.tsx src/components/cra/FiltreEtats.test.tsx
```

Attendu : ÉCHEC — les deux modules n'existent pas.

- [ ] **Étape 3 : écrire le tableau**

Créer `src/components/cra/SuiviTable.tsx` (composant serveur, aucun `'use client'`) :

```tsx
import Link from 'next/link'
import { DataTable } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/cra/StatusBadge'
import { etatSuivi } from '@/core/cra/etat-suivi'
import { formatJours, libelleMois } from '@/core/cra/document'
import type { CraView } from '@/services/cra'

/**
 * Le suivi, en lignes.
 *
 * **Aucune transition ici, et c'est un point de sûreté.** Les deux garde-fous
 * qui précèdent une validation — « ce CRA n'ira pas dans Dolibarr » et « du
 * prévisionnel sera annulé » — vivent sur la page de détail. Un bouton
 * « Valider » dans une ligne permettrait de valider sans les avoir lus.
 * La liste montre et filtre ; le détail agit.
 */
export function SuiviTable({ cras }: { cras: CraView[] }) {
  if (cras.length === 0) {
    return <p className="text-muted">Aucun CRA ne correspond à ce filtre.</p>
  }

  return (
    <DataTable caption="Suivi des CRA">
      <thead>
        <tr className="border-b border-rule text-left text-muted">
          <th className="px-2 py-1 font-medium">Mois</th>
          <th className="px-2 py-1 font-medium">Client</th>
          <th className="px-2 py-1 font-medium">Mission</th>
          <th className="px-2 py-1 text-right font-medium">Jours</th>
          <th className="px-2 py-1 font-medium">État</th>
          <th className="px-2 py-1 font-medium">N° facture</th>
          <th className="px-2 py-1 font-medium">Facturé le</th>
          <th className="px-2 py-1">
            <span className="sr-only">Détail</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {cras.map((cra) => (
          <tr key={cra.id} className="border-b border-rule">
            <td className="px-2 py-1">{libelleMois(cra.month)}</td>
            <td className="px-2 py-1">{cra.clientName}</td>
            <td className="px-2 py-1">{cra.missionLabel}</td>
            <td className="px-2 py-1 text-right">{formatJours(cra.synthese.totalCentiemes)}</td>
            <td className="px-2 py-1">
              <StatusBadge status={etatSuivi(cra)} />
            </td>
            <td className="px-2 py-1">{cra.invoiceNumber ?? '—'}</td>
            <td className="px-2 py-1">{cra.invoicedAt?.toISOString().slice(0, 10) ?? '—'}</td>
            <td className="px-2 py-1">
              <Link href={`/cra/${cra.id}`} className="text-link underline">
                Ouvrir
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  )
}
```

- [ ] **Étape 4 : écrire le filtre**

Créer `src/components/cra/FiltreEtats.tsx` :

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { Checkbox } from '@/components/ui/Checkbox'
import { ETATS_SUIVI, libelleEtat, type EtatSuivi } from '@/core/cra/etat-suivi'

/**
 * Le filtre du suivi, écrit dans l'adresse.
 *
 * **`router.push` et non un état local.** Le filtre est appliqué en base : le
 * changer doit refaire le rendu serveur, sinon il ne filtrerait rien. C'est
 * l'inverse exact du choix de vue de la Saisie, qui est entièrement local et
 * passe donc par `history.replaceState`.
 *
 * Le paramètre est toujours écrit, **même vide** : l'absence signifie « le
 * défaut », le vide signifie « l'utilisateur a tout décoché ». Confondre les
 * deux ressusciterait un filtre qu'il vient de retirer.
 */
export function FiltreEtats({
  etats,
  month,
}: {
  etats: EtatSuivi[]
  month: string | undefined
}) {
  const router = useRouter()
  const actifs = new Set(etats)

  function basculer(etat: EtatSuivi): void {
    const prochains = new Set(actifs)
    if (prochains.has(etat)) prochains.delete(etat)
    else prochains.add(etat)

    // L'ordre du catalogue, pas celui des clics : deux adresses identiques
    // pour un même filtre.
    const retenus = ETATS_SUIVI.filter((e) => prochains.has(e))
    const parametres = new URLSearchParams()
    parametres.set('etats', retenus.join(','))
    if (month !== undefined) parametres.set('month', month)

    router.push(`/cra?${parametres.toString()}`)
  }

  return (
    <fieldset className="mb-4 flex flex-wrap items-center gap-3">
      <legend className="sr-only">Filtrer par état</legend>
      {ETATS_SUIVI.map((etat) => (
        <Checkbox
          key={etat}
          label={libelleEtat(etat)}
          checked={actifs.has(etat)}
          onChange={() => basculer(etat)}
        />
      ))}
    </fieldset>
  )
}
```

- [ ] **Étape 5 : lancer les tests des deux composants**

```bash
npx vitest run src/components/cra/SuiviTable.test.tsx src/components/cra/FiltreEtats.test.tsx
```

Attendu : SUCCÈS.

- [ ] **Étape 6 : réécrire la page**

Remplacer `src/app/(app)/cra/page.tsx` par :

```tsx
import { requireUser } from '@/auth'
import { listCrasSuivi, listCrasEnSouffrance, type CraView } from '@/services/cra'
import { parseEtats } from '@/core/cra/etat-suivi'
import { FiltreEtats } from '@/components/cra/FiltreEtats'
import { SuiviTable } from '@/components/cra/SuiviTable'
import { PageShell } from '@/components/ui/PageShell'
import { Button } from '@/components/ui/Button'
import { lancerRelances } from './actions'

export default async function SuiviCraPage({
  searchParams,
}: {
  searchParams: Promise<{ etats?: string; month?: string }>
}) {
  const user = await requireUser()
  const { etats: brut, month } = await searchParams
  const etats = parseEtats(brut)

  const cras = await listCrasSuivi(user.id, { etats, ...(month === undefined ? {} : { month }) })
  const souffrance = await listCrasEnSouffrance(user.id)

  return (
    <PageShell title="Suivi CRA">
      <FiltreEtats etats={etats} month={month} />

      {/* Zéro état coché n'est pas « aucun CRA » : c'est un filtre qui exclut
          tout, et le dire évite de croire que la base est vide. */}
      {etats.length === 0 ? (
        <p className="text-muted">
          Aucun état sélectionné : cochez au moins un état pour voir des CRA.
        </p>
      ) : (
        <SuiviTable cras={cras} />
      )}

      {/* La souffrance et les relances restent en bas, et hors du filtre : un
          CRA en souffrance l'est quel que soit l'état coché. */}
      {/* … reprendre à l'identique les deux sections de l'ancienne page … */}
    </PageShell>
  )
}
```

Le bouton « Lancer les relances échues » perd son `<input type="hidden" name="month">` : `lancerRelances` n'en a plus besoin puisqu'il ne redirige plus vers un mois. Adapter l'action pour rediriger vers `/cra` nu.

**Le formulaire « Ouvrir un CRA » n'est PAS retiré à cette tâche** — il le sera en tâche 9, quand son remplacement existera dans la Saisie. Le garder ici jusque-là évite un état du dépôt où aucun CRA ne peut être créé.

- [ ] **Étape 7 : renommer l'entrée de navigation**

Dans `src/components/nav/NavRail.tsx`, ligne 32 :

```ts
  { href: '/cra', label: 'Suivi CRA', icone: IconeCra },
```

Le commentaire au-dessus de `TRAVAIL` parle des « quatre écrans du travail quotidien » : il reste juste. Mettre à jour `src/components/nav/NavRail.test.tsx` partout où « CRA » est cherché par nom accessible. **Attention :** le test de largeur des onglets sur téléphone mesure la somme des libellés — « Suivi CRA » est plus long que « CRA », et ce test peut légitimement échouer. S'il échoue, ne pas l'assouplir : réduire le libellé de l'onglet mobile via la même mécanique que les autres, ou signaler le conflit.

- [ ] **Étape 8 : réécrire le test de la page**

Réécrire `src/app/(app)/cra/page.test.tsx` en gardant son montage de doubles (`vi.hoisted` + `vi.mock`), et en remplaçant les assertions sur les cartes par :

```tsx
it('rend un tableau et non des cartes', async () => {
  cras.push(unCra('ENVOYE'))
  render(await SuiviCraPage({ searchParams: Promise.resolve({}) }))

  expect(screen.getByRole('table')).toBeTruthy()
})

it('applique le defaut quand l adresse ne dit rien', async () => {
  render(await SuiviCraPage({ searchParams: Promise.resolve({}) }))

  expect(etatsRecus).toEqual(['BROUILLON', 'ENVOYE', 'REFUSE'])
})

it('dit qu aucun etat n est selectionne plutot que de paraitre vide', async () => {
  render(await SuiviCraPage({ searchParams: Promise.resolve({ etats: '' }) }))

  expect(screen.getByText(/Aucun état sélectionné/)).toBeTruthy()
})
```

où `etatsRecus` est capturé par le double de `listCrasSuivi`.

- [ ] **Étape 9 : lancer toute la suite**

```bash
npm test
```

Attendu : SUCCÈS. Les écrans qui liaient vers `/cra?month=…` (le plan de charge, les rappels) doivent continuer de fonctionner : `month` reste un paramètre lu.

- [ ] **Étape 10 : commit**

```bash
git add src/components/cra "src/app/(app)/cra/page.tsx" "src/app/(app)/cra/page.test.tsx" src/components/nav
git commit -m "feat(cra): l ecran CRA devient un suivi qui tient dans un tableau"
```

---

## Tâche 7 — D : valider ou supprimer le prévisionnel d'un mois

**Fichiers :**
- Modifier : `src/services/cra-previsionnel.ts`
- Test : `src/services/cra-previsionnel.test.ts`
- Modifier : `src/core/audit/events.ts:29`
- Modifier : `src/core/audit/events.test.ts:22,56`

**Interfaces :**
- Consomme : `enqueueTimeEntry` de `@/services/sync/outbox`.
- Produit : `validerPrevisionnelDuMois(tx: Prisma.TransactionClient, args: { userId: string; missionId: string; month: string }): Promise<number>` et l'événement d'audit `previsionnel.supprime`.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter dans `src/services/cra-previsionnel.test.ts` :

```ts
describe('validerPrevisionnelDuMois', () => {
  // Tout le mois, passe ET a venir : c'est ce qui permet d'envoyer un CRA le
  // 20 avec les jours du 21 au 31 deja comptes — la projection que le client
  // demande.
  it('convertit le previsionnel echu comme celui a venir', async () => {
    const compte = await validerPrevisionnelDuMois(tx, {
      userId: 'u1',
      missionId: 'm1',
      month: '2026-03',
    })

    expect(compte).toBe(2)
    expect(tx.timeEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { kind: 'REALISE' } }),
    )
  })

  // La question a ete posee sur UNE mission. Convertir le previsionnel des
  // autres clients serait une ecriture que personne n'a demandee.
  it('ne sort jamais de la mission visee', async () => {
    await validerPrevisionnelDuMois(tx, { userId: 'u1', missionId: 'm1', month: '2026-03' })

    const where = tx.timeEntry.findMany.mock.calls[0]![0]!.where
    expect(where.line).toEqual({ missionId: 'm1' })
    expect(where.userId).toBe('u1')
    expect(where.kind).toBe('PREVISIONNEL')
  })

  // Le previsionnel converti change de couleur dans l'agenda : chaque saisie
  // repart donc en file, dans la transaction qui la convertit.
  it('remet chaque saisie en file UPSERT', async () => {
    await validerPrevisionnelDuMois(tx, { userId: 'u1', missionId: 'm1', month: '2026-03' })

    expect(enqueueEspion).toHaveBeenCalledTimes(2)
    expect(enqueueEspion).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ operation: 'UPSERT' }),
    )
  })

  it('ne touche a rien quand le mois ne porte aucun previsionnel', async () => {
    videLesSaisies()

    expect(
      await validerPrevisionnelDuMois(tx, { userId: 'u1', missionId: 'm1', month: '2026-03' }),
    ).toBe(0)
    expect(tx.timeEntry.updateMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run src/services/cra-previsionnel.test.ts
```

Attendu : ÉCHEC — la fonction n'existe pas.

- [ ] **Étape 3 : implémenter**

Ajouter dans `src/services/cra-previsionnel.ts`, **immédiatement à côté** de `annulerPrevisionnelDuMois` :

```ts
/**
 * Passe en réalisé le prévisionnel du mois d'une mission, et rend le nombre de
 * saisies converties.
 *
 * **Le miroir exact d'`annulerPrevisionnelDuMois`**, et volontairement son
 * voisin de fichier : ce sont les deux issues d'une même question posée à
 * l'utilisateur au moment où il génère un CRA. Les séparer les ferait diverger.
 *
 * **Ce n'est pas `convertPastForecast`.** Celle-ci ne prend que le
 * prévisionnel *échu* et n'est pas scopée sur une mission : s'en servir ici
 * convertirait le prévisionnel des autres clients et laisserait de côté
 * précisément les jours à venir qu'on veut projeter.
 *
 * Elle ne consulte pas le verrou de CRA validé : le cas est refusé en amont,
 * par `genererCra`, avant qu'aucune saisie ne soit touchée.
 *
 * Chaque saisie repart en file `UPSERT` : le prévisionnel converti change de
 * couleur dans l'agenda.
 */
export async function validerPrevisionnelDuMois(
  tx: Prisma.TransactionClient,
  args: { userId: string; missionId: string; month: string },
): Promise<number> {
  const { debut, fin } = bornes(args.month)

  const converties = await tx.timeEntry.findMany({
    where: {
      userId: args.userId,
      kind: 'PREVISIONNEL',
      date: { gte: debut, lt: fin },
      line: { missionId: args.missionId },
    },
    select: { id: true },
  })
  if (converties.length === 0) return 0

  await tx.timeEntry.updateMany({
    where: { userId: args.userId, id: { in: converties.map((e) => e.id) } },
    data: { kind: 'REALISE' },
  })
  for (const convertie of converties) {
    await enqueueTimeEntry(tx, { userId: args.userId, entryId: convertie.id, operation: 'UPSERT' })
  }

  return converties.length
}
```

- [ ] **Étape 4 : ajouter l'événement d'audit**

Dans `src/core/audit/events.ts`, sous `'previsionnel.converti'` :

```ts
  'previsionnel.converti',
  // La suppression du prévisionnel n'était jusqu'ici tracée que dans la charge
  // utile de `cra.valide` (`previsionnelAnnule`). Depuis que le sort du
  // prévisionnel se décide **à la génération** et non plus à la validation,
  // elle a lieu hors de toute transition : sans nom à elle, une suppression
  // décidée par un humain ne laisserait plus aucune trace consultable.
  'previsionnel.supprime',
```

`src/core/audit/events.test.ts` fige le catalogue **dans l'ordre et en nombre**. C'est le garde-fou qui fait d'un ajout une décision de conception. Mettre à jour les deux endroits :

- ligne ~22 : insérer `'previsionnel.supprime'` juste après `'previsionnel.converti'` dans la liste attendue ;
- ligne ~56 : `expect(AUDIT_ACTIONS).toHaveLength(30)`.

Vérifier aussi le test des « miroirs » (ligne ~142) : si `previsionnel.converti` y figure sans miroir attendu, `previsionnel.supprime` n'a pas à y entrer non plus — ce ne sont pas deux faces d'un même acte mais deux issues d'un choix.

- [ ] **Étape 5 : lancer les tests pour les voir passer**

```bash
npx vitest run src/services/cra-previsionnel.test.ts src/core/audit/events.test.ts
```

Attendu : SUCCÈS.

- [ ] **Étape 6 : commit**

```bash
git add src/services/cra-previsionnel.ts src/services/cra-previsionnel.test.ts src/core/audit
git commit -m "feat(previsionnel): valider un mois, ou le supprimer, sont deux actes nommes"
```

---

## Tâche 8 — D : le service `genererCra`

**Fichiers :**
- Créer : `src/services/cra-generation.ts`
- Créer : `src/services/cra-generation.test.ts`

**Interfaces :**
- Consomme : `validerPrevisionnelDuMois`, `annulerPrevisionnelDuMois` (tâche 7), `getOrCreateCra` de `@/services/cra`, `appendAudit`/`actorOf` de `@/services/audit`.
- Produit :

```ts
export type ChoixPrevisionnel = 'VALIDER' | 'SUPPRIMER'

export type ResultatGeneration =
  | { ok: true; craId: string; previsionnelTraite: number }
  | { ok: false; raison: 'MOIS_VALIDE'; craId: string }
  | { ok: false; raison: 'NON_AFFECTE' }

export async function genererCra(
  userId: string,
  args: { lineId: string; month: string; previsionnel: ChoixPrevisionnel },
): Promise<ResultatGeneration>
```

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `src/services/cra-generation.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
// … montage des doubles Prisma comme dans src/services/cra.test.ts
import { genererCra } from './cra-generation'

describe('genererCra', () => {
  beforeEach(reinitialiser)

  it('ouvre le CRA et rend son identifiant', async () => {
    const r = await genererCra('u1', {
      lineId: 'l1',
      month: '2026-03',
      previsionnel: 'SUPPRIMER',
    })

    expect(r).toEqual({ ok: true, craId: 'cra-1', previsionnelTraite: 2 })
  })

  it('convertit le previsionnel quand on repond VALIDER', async () => {
    await genererCra('u1', { lineId: 'l1', month: '2026-03', previsionnel: 'VALIDER' })

    expect(validerEspion).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 'u1', missionId: 'm1', month: '2026-03' },
    )
    expect(annulerEspion).not.toHaveBeenCalled()
  })

  it('supprime le previsionnel quand on repond SUPPRIMER', async () => {
    await genererCra('u1', { lineId: 'l1', month: '2026-03', previsionnel: 'SUPPRIMER' })

    expect(annulerEspion).toHaveBeenCalled()
    expect(validerEspion).not.toHaveBeenCalled()
  })

  // Un mois clos ne se regenere pas, et y toucher le previsionnel
  // contournerait le verrou que toute la saisie respecte.
  it('refuse quand le CRA du mois est deja valide, sans toucher aux saisies', async () => {
    craExistant({ id: 'cra-9', status: 'VALIDE' })

    const r = await genererCra('u1', {
      lineId: 'l1',
      month: '2026-03',
      previsionnel: 'VALIDER',
    })

    expect(r).toEqual({ ok: false, raison: 'MOIS_VALIDE', craId: 'cra-9' })
    expect(validerEspion).not.toHaveBeenCalled()
    expect(annulerEspion).not.toHaveBeenCalled()
  })

  // Le client ne decide pas seul sur quelle mission on ecrit.
  it('refuse une prestation a laquelle l utilisateur n est pas affecte', async () => {
    aucuneAffectation()

    const r = await genererCra('u2', {
      lineId: 'l1',
      month: '2026-03',
      previsionnel: 'VALIDER',
    })

    expect(r).toEqual({ ok: false, raison: 'NON_AFFECTE' })
  })

  // Un previsionnel supprime sans CRA cree est une perte que rien ne
  // rattrape ; un CRA cree sur un previsionnel non traite ment sur ce qu'il
  // porte. Les deux tombent ensemble, ou pas du tout.
  it('n a rien laisse derriere lui quand la creation echoue', async () => {
    laCreationEchoue()

    await expect(
      genererCra('u1', { lineId: 'l1', month: '2026-03', previsionnel: 'SUPPRIMER' }),
    ).rejects.toThrow()
    expect(transactionAnnulee()).toBe(true)
  })

  it('consigne la suppression sous previsionnel.supprime', async () => {
    await genererCra('u1', { lineId: 'l1', month: '2026-03', previsionnel: 'SUPPRIMER' })

    expect(auditEspion).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'previsionnel.supprime' }),
    )
  })

  it('consigne la conversion sous previsionnel.converti', async () => {
    await genererCra('u1', { lineId: 'l1', month: '2026-03', previsionnel: 'VALIDER' })

    expect(auditEspion).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'previsionnel.converti' }),
    )
  })

  it('ne consigne rien quand le mois ne portait aucun previsionnel', async () => {
    aucunPrevisionnel()

    await genererCra('u1', { lineId: 'l1', month: '2026-03', previsionnel: 'VALIDER' })

    expect(auditEspion).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'previsionnel.converti' }),
    )
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run src/services/cra-generation.test.ts
```

Attendu : ÉCHEC — le module n'existe pas.

- [ ] **Étape 3 : implémenter**

Créer `src/services/cra-generation.ts` :

```ts
import { prisma } from '@/db/client'
import { getOrCreateCra } from './cra'
import { annulerPrevisionnelDuMois, validerPrevisionnelDuMois } from './cra-previsionnel'
import { appendAudit, actorOf } from './audit'
import type { CraStatus } from '@/core/types'

export type ChoixPrevisionnel = 'VALIDER' | 'SUPPRIMER'

export type ResultatGeneration =
  | { ok: true; craId: string; previsionnelTraite: number }
  | { ok: false; raison: 'MOIS_VALIDE'; craId: string }
  | { ok: false; raison: 'NON_AFFECTE' }

/**
 * Ouvre le CRA d'un mois, après avoir réglé le sort de son prévisionnel.
 *
 * **Les deux tombent ensemble, dans une seule transaction.** Un prévisionnel
 * supprimé sans CRA créé est une perte de données que rien ne rattrape ; un
 * CRA créé sur un prévisionnel non traité ment sur ce qu'il porte.
 *
 * `lineId` et non `missionId` : c'est ce que l'écran de saisie connaît. La
 * mission est résolue ici, **et l'affectation vérifiée au passage** — le
 * client ne décide pas seul sur quelle mission on écrit.
 */
export async function genererCra(
  userId: string,
  args: { lineId: string; month: string; previsionnel: ChoixPrevisionnel },
): Promise<ResultatGeneration> {
  // La ligne, la mission, et l'affectation — en une lecture scopée.
  const line = await prisma.line.findFirst({
    where: { id: args.lineId, assignments: { some: { userId } } },
    select: { missionId: true },
  })
  if (line === null) return { ok: false, raison: 'NON_AFFECTE' }

  const debut = new Date(`${args.month}-01T00:00:00.000Z`)
  const existant = await prisma.cra.findUnique({
    where: { missionId_userId_month: { missionId: line.missionId, userId, month: debut } },
    select: { id: true, status: true },
  })

  // Un mois clos ne se regénère pas : y toucher le prévisionnel contournerait
  // le verrou que toute la saisie respecte. Refusé **avant** toute écriture.
  if (existant !== null && (existant.status as CraStatus) === 'VALIDE') {
    return { ok: false, raison: 'MOIS_VALIDE', craId: existant.id }
  }

  const previsionnelTraite = await prisma.$transaction(async (tx) =>
    args.previsionnel === 'VALIDER'
      ? await validerPrevisionnelDuMois(tx, { userId, missionId: line.missionId, month: args.month })
      : await annulerPrevisionnelDuMois(tx, { userId, missionId: line.missionId, month: args.month }),
  )

  // Hors transaction : le journal atteste de ce qui a eu lieu, et une
  // transaction annulée n'a rien fait avoir lieu. Zéro jour traité ne se
  // consigne pas — il n'y a pas eu d'acte.
  if (previsionnelTraite > 0) {
    await appendAudit({
      ...(await actorOf(userId)),
      action: args.previsionnel === 'VALIDER' ? 'previsionnel.converti' : 'previsionnel.supprime',
      entityType: 'Mois',
      entityId: args.month,
      payload: {
        month: args.month,
        missionId: line.missionId,
        // D'où vient le geste : ce n'est pas l'encart de prévisionnel échu de
        // la saisie, c'est la question posée à la génération du CRA.
        origine: 'generation-cra',
        ...(args.previsionnel === 'VALIDER'
          ? { converted: previsionnelTraite }
          : { supprimes: previsionnelTraite }),
      },
    })
  }

  // `getOrCreateCra` sait déjà ne consigner l'ouverture qu'une fois et
  // encaisser la course entre deux rendus. Un CRA brouillon, envoyé ou refusé
  // est rendu tel quel : c'est ce qui permet de projeter une seconde fois un
  // mois dont le CRA est parti sans être validé.
  const cra = await getOrCreateCra(userId, line.missionId, args.month)

  return { ok: true, craId: cra.id, previsionnelTraite }
}
```

**Note sur la transaction :** `getOrCreateCra` ouvre sa propre écriture et n'accepte pas de `tx`. Si le test « rien laissé derrière » ne peut pas passer avec cette forme, faire entrer la création dans la transaction en appelant `tx.cra.create` directement et en consignant `cra.ouvert` après — mais alors **reproduire la capture de course** (`try/catch` + relecture) de `getOrCreateCra`, sans quoi deux clics simultanés lèveraient.

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
npx vitest run src/services/cra-generation.test.ts
```

Attendu : SUCCÈS.

- [ ] **Étape 5 : commit**

```bash
git add src/services/cra-generation.ts src/services/cra-generation.test.ts
git commit -m "feat(cra): generer un CRA regle d abord le sort du previsionnel"
```

---

## Tâche 9 — C : le bouton et le panneau dans la Saisie

**Fichiers :**
- Créer : `src/app/(app)/saisie/[month]/PanneauGeneration.tsx`
- Créer : `src/app/(app)/saisie/[month]/PanneauGeneration.test.tsx`
- Modifier : `src/app/(app)/saisie/[month]/actions.ts`
- Modifier : `src/app/(app)/saisie/[month]/SaisieClient.tsx`
- Modifier : `src/app/(app)/saisie/[month]/SaisieClient.test.tsx`
- Modifier : `src/app/(app)/saisie/[month]/page.tsx`
- Modifier : `src/app/(app)/cra/page.tsx` (retrait du formulaire)
- Modifier : `src/app/(app)/cra/actions.ts` (retrait d'`openCra`)

**Interfaces :**
- Consomme : `genererCra` (tâche 8).
- Produit :
  - action `genererCraAction(args: { lineId: string; month: string; previsionnel: ChoixPrevisionnel }): Promise<ResultatGeneration>`
  - action `compterPrevisionnelDeLaLigne(args: { lineId: string; month: string }): Promise<number>`
  - `<PanneauGeneration>` : le panneau de question.

- [ ] **Étape 1 : écrire le test du panneau**

Créer `src/app/(app)/saisie/[month]/PanneauGeneration.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PanneauGeneration } from './PanneauGeneration'

const props = {
  month: '2026-03',
  missionLabel: 'ACME · ITSM',
  onAnnuler: vi.fn(),
  onChoix: vi.fn(),
}

describe('PanneauGeneration', () => {
  afterEach(() => {
    cleanup()
    props.onChoix.mockClear()
    props.onAnnuler.mockClear()
  })

  it('nomme la mission, le mois et le nombre de jours', () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    expect(screen.getByText(/7 jours en prévisionnel/)).toBeTruthy()
    expect(screen.getByText(/ACME · ITSM/)).toBeTruthy()
  })

  it('accorde le singulier', () => {
    render(<PanneauGeneration {...props} previsionnel={1} />)

    expect(screen.getByText(/1 jour en prévisionnel/)).toBeTruthy()
  })

  // Deux chemins explicites, aucun par defaut : c'est toute la demande.
  it('offre les deux issues, et aucune n est prechoisie', () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    expect(screen.getByRole('button', { name: /Valider ces jours/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Les supprimer/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Annuler/ })).toBeTruthy()
    expect(props.onChoix).not.toHaveBeenCalled()
  })

  it('remonte le choix de validation', async () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    await userEvent.click(screen.getByRole('button', { name: /Valider ces jours/ }))

    expect(props.onChoix).toHaveBeenCalledWith('VALIDER')
  })

  it('remonte le choix de suppression', async () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    await userEvent.click(screen.getByRole('button', { name: /Les supprimer/ }))

    expect(props.onChoix).toHaveBeenCalledWith('SUPPRIMER')
  })

  // Une boite de dialogue qui demande quoi faire de zero jour apprend a
  // l'utilisateur a cliquer sans lire.
  it('ne pose aucune question quand il n y a rien a trancher', () => {
    const { container } = render(<PanneauGeneration {...props} previsionnel={0} />)

    expect(container.textContent).not.toContain('prévisionnel')
  })

  it('dit que la suppression est irreversible', () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    expect(screen.getByText(/irréversible|ne pourront pas être retrouvés/)).toBeTruthy()
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run "src/app/(app)/saisie/[month]/PanneauGeneration.test.tsx"
```

Attendu : ÉCHEC — le module n'existe pas.

- [ ] **Étape 3 : écrire le panneau**

Créer `src/app/(app)/saisie/[month]/PanneauGeneration.tsx` :

```tsx
'use client'

import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { libelleMois } from '@/core/cra/document'
import type { ChoixPrevisionnel } from '@/services/cra-generation'

/**
 * La question posée avant de générer un CRA : que devient le prévisionnel du
 * mois ?
 *
 * **Aucun choix par défaut, et c'est le cœur de la demande.** Un client
 * demande son CRA le 20 : les jours du 21 au 31 sont saisis, connus, engagés.
 * Ils doivent figurer sur le document — ou disparaître —, mais c'est une
 * décision, pas un effet de bord de la validation.
 *
 * Un panneau rendu dans le document, jamais `window.confirm` : celui-ci bloque
 * le fil et n'existe pas au test.
 */
export function PanneauGeneration({
  month,
  missionLabel,
  previsionnel,
  onChoix,
  onAnnuler,
}: {
  month: string
  missionLabel: string
  previsionnel: number
  onChoix: (choix: ChoixPrevisionnel) => void
  onAnnuler: () => void
}) {
  // Rien à trancher : le CRA s'ouvre sans question. L'appelant l'a déjà fait,
  // ce panneau ne doit alors rien peindre.
  if (previsionnel === 0) return null

  const jours = previsionnel === 1 ? '1 jour en prévisionnel' : `${previsionnel} jours en prévisionnel`

  return (
    <div className="mb-3">
      <Banner tone="warning" title={`Générer le CRA de ${libelleMois(month)} ?`}>
        <p className="mb-2">
          Ce mois porte encore {jours} sur la mission « {missionLabel} ».
        </p>
        <p className="mb-2">
          <strong>Valider</strong> les passe en réalisé : ils compteront dans le CRA, y compris les
          jours à venir de ce mois. <strong>Les supprimer</strong> les retire définitivement, avec
          leurs blocs d’agenda — c’est irréversible.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={() => onChoix('VALIDER')}>
            Valider ces jours et générer
          </Button>
          <Button type="button" variant="danger" onClick={() => onChoix('SUPPRIMER')}>
            Les supprimer et générer
          </Button>
          <Button type="button" variant="quiet" onClick={onAnnuler}>
            Annuler
          </Button>
        </div>
      </Banner>
    </div>
  )
}
```

- [ ] **Étape 4 : écrire les deux server actions**

Ajouter dans `src/app/(app)/saisie/[month]/actions.ts` :

```ts
/**
 * Combien de jours en prévisionnel la mission de cette prestation porte-t-elle
 * sur ce mois ?
 *
 * Lu **au clic** et non au rendu : c'est un chiffre qui bouge à chaque saisie,
 * et l'afficher figé depuis le rendu de la page ferait poser la question sur
 * un nombre faux.
 */
export async function compterPrevisionnelDeLaLigne(args: {
  lineId: string
  month: string
}): Promise<number> { /* … via compterPrevisionnelParMission, scopé sur l'utilisateur */ }

/**
 * Génère le CRA du mois pour la mission de la prestation choisie.
 *
 * Le choix du prévisionnel vient de l'utilisateur, jamais d'un défaut : voir
 * `PanneauGeneration`.
 */
export async function genererCraAction(args: {
  lineId: string
  month: string
  previsionnel: ChoixPrevisionnel
}): Promise<ResultatGeneration> {
  const user = await requireUser()
  const r = await genererCra(user.id, args)

  if (r.ok) {
    revalidatePath(`/saisie/${args.month}`)
    revalidatePath('/cra')
  }
  return r
}
```

- [ ] **Étape 5 : brancher le bouton dans `SaisieClient`**

Dans le groupe de boutons conditionné par `ligne !== undefined`, après « Vider le CRA » :

```tsx
<Button
  type="button"
  onClick={async () => {
    const previsionnel = await compterPrevisionnelDeLaLigne({ lineId, month: props.month })
    // Rien à trancher : on génère sans poser de question.
    if (previsionnel === 0) await lancerGeneration('SUPPRIMER')
    else setGeneration({ previsionnel })
  }}
>
  Générer le CRA
</Button>
```

`lancerGeneration` appelle l'action, referme le panneau, et écrit le compte rendu dans le bandeau existant — avec le lien vers le CRA produit :

```tsx
async function lancerGeneration(choix: ChoixPrevisionnel): Promise<void> {
  setGeneration(null)
  const r = await genererCraAction({ lineId, month: props.month, previsionnel: choix })

  if (!r.ok) {
    setMessage(
      refus(
        r.raison === 'MOIS_VALIDE'
          ? `Le CRA de ce mois est déjà validé. Rouvrez-le depuis le suivi pour le regénérer.`
          : `Vous n'êtes pas affecté à cette prestation.`,
      ),
    )
    return
  }
  setMessage(information(`CRA généré. Retrouvez-le dans le suivi.`))
}
```

**L'écran reste sur la Saisie.** Rediriger vers le suivi arracherait l'utilisateur à un mois qu'il n'a pas fini de regarder.

- [ ] **Étape 6 : retirer le formulaire « Ouvrir un CRA »**

Dans `src/app/(app)/cra/page.tsx`, supprimer le `<form action={openCra}>` et l'import de `listMissionsForUser` s'il n'a plus d'usage. Dans `src/app/(app)/cra/actions.ts`, supprimer `openCra`.

- [ ] **Étape 7 : lancer la suite**

```bash
npm test
```

Attendu : SUCCÈS. Ajouter dans `SaisieClient.test.tsx` un test qui vérifie qu'un mois sans prévisionnel ne peint aucun panneau, et un qui vérifie que le refus `MOIS_VALIDE` s'affiche en refus (`tone="danger"`), pas en avertissement.

- [ ] **Étape 8 : commit**

```bash
git add "src/app/(app)/saisie/[month]" "src/app/(app)/cra"
git commit -m "feat(saisie): le CRA se genere la ou on saisit, et demande ce qu il emporte"
```

---

## Tâche 10 — G : `getBusyRange`, qui sait dire qu'il n'a pas pu répondre

**Fichiers :**
- Modifier : `src/services/availability.ts`
- Test : `src/services/availability.test.ts`

**Interfaces :**
- Consomme : `resolveConnector`, `CalendarConnector`.
- Produit :

```ts
export type RaisonAgenda = 'PAS_DE_CONNECTEUR' | 'ECHEC'

export type ResultatAgenda =
  | { ok: true; jours: string[] }
  | { ok: false; raison: RaisonAgenda }

export async function getBusyRange(
  userId: string,
  args: { du: string; au: string },   // 'YYYY-MM-DD', bornes incluses
  deps?: { connector?: CalendarConnector | null; fetchFn?: FetchLike; delaiMs?: number },
): Promise<ResultatAgenda>
```

`getBusyDays` **disparaît** : son seul appelant, la page de saisie, cesse d'appeler à la tâche 11.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter dans `src/services/availability.test.ts` :

```ts
describe('getBusyRange', () => {
  // LE test de cette section : l'absence d'occupation et l'echec de lecture
  // rendaient tous deux une liste vide. Indistinguables. Des lors que
  // l'utilisateur CLIQUE pour savoir, une liste vide qui veut dire « Google
  // n'a pas repondu » est un mensonge.
  it('distingue l absence d occupation d un echec de lecture', async () => {
    expect(await getBusyRange('u1', PLAGE, { connector: connecteurVide })).toEqual({
      ok: true,
      jours: [],
    })
    expect(await getBusyRange('u1', PLAGE, { connector: connecteurEnPanne })).toEqual({
      ok: false,
      raison: 'ECHEC',
    })
  })

  it('dit quand aucun connecteur n est configure', async () => {
    expect(await getBusyRange('u1', PLAGE, { connector: null })).toEqual({
      ok: false,
      raison: 'PAS_DE_CONNECTEUR',
    })
  })

  // La garantie de fond ne change pas : la saisie doit fonctionner un jour ou
  // Google est en panne.
  it('ne leve jamais', async () => {
    await expect(getBusyRange('u1', PLAGE, { connector: connecteurQuiExplose })).resolves.toEqual({
      ok: false,
      raison: 'ECHEC',
    })
  })

  it('rend un echec plutot que d attendre un agenda lent', async () => {
    const r = await getBusyRange('u1', PLAGE, { connector: connecteurLent, delaiMs: 5 })

    expect(r).toEqual({ ok: false, raison: 'ECHEC' })
  })

  it('couvre toute la plage demandee, pas seulement son premier mois', async () => {
    const r = await getBusyRange(
      'u1',
      { du: '2026-03-01', au: '2026-05-31' },
      { connector: connecteurAvec(['2026-05-12']) },
    )

    expect(r).toEqual({ ok: true, jours: ['2026-05-12'] })
  })

  it('ecarte le calendrier dedie, comme avant', async () => {
    await getBusyRange('u1', PLAGE, { connector: connecteurEspion })

    expect(freeBusyEspion).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarIds: ['primary', connecteurEspion.dedicatedCalendarId],
      }),
    )
  })

  it('rend les jours tries et sans doublon', async () => {
    const r = await getBusyRange('u1', PLAGE, {
      connector: connecteurAvec(['2026-03-12', '2026-03-04', '2026-03-12']),
    })

    expect(r).toEqual({ ok: true, jours: ['2026-03-04', '2026-03-12'] })
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run src/services/availability.test.ts
```

Attendu : ÉCHEC — `getBusyRange` n'existe pas.

- [ ] **Étape 3 : implémenter**

Dans `src/services/availability.ts` :

1. remplacer `monthBoundsIso(month)` par `bornesIso({ du, au })`, qui rend `startIso` au début du jour `du` et `endIso` au **début du lendemain** de `au` (borne ouverte à droite, comme aujourd'hui) ;
2. remplacer le filtre `jour.startsWith(month)` par un encadrement `du <= jour && jour <= au` — c'est ce qui fait échouer le test « toute la plage » si on l'oublie ;
3. réécrire l'enveloppe :

```ts
/**
 * Les jours d'une plage porteurs d'une occupation dans l'agenda principal.
 *
 * **Ne lève jamais** — la garantie n'a pas changé. Ce qui change, c'est
 * qu'elle sait désormais dire *pourquoi* elle ne rend rien.
 *
 * Tant que la lecture était automatique, une liste vide se lisait « rien à
 * signaler » et suffisait : le repère apparaissait ou non, et c'était un
 * confort. Depuis qu'elle n'a lieu que si l'utilisateur **clique**, une liste
 * vide qui signifie « Google n'a pas répondu » est un mensonge : il a demandé,
 * il doit obtenir une réponse honnête.
 *
 * **Le commentaire qui vivait ici — « Aucun cache en v1 : un appel `freeBusy`
 * est bon marché » — est retiré avec cette réécriture.** L'hypothèse ne tient
 * pas sur un quota serré ; c'est ce qui a fait passer la lecture à la demande.
 * Le laisser justifierait encore une décision abandonnée.
 */
export async function getBusyRange(
  userId: string,
  args: { du: string; au: string },
  deps: { connector?: CalendarConnector | null; fetchFn?: FetchLike; delaiMs?: number } = {},
): Promise<ResultatAgenda> {
  const delaiMs = deps.delaiMs ?? DELAI_OCCUPATION_MS

  try {
    return await Promise.race([
      lireOccupation(userId, args, deps),
      new Promise<ResultatAgenda>((_, rejeter) =>
        setTimeout(() => rejeter(new Error('Délai dépassé')), delaiMs).unref?.(),
      ),
    ])
  } catch {
    // Le seul `catch` muet que ce service s'autorise — mais il ne rend plus
    // une liste vide indistinguable d'un mois libre.
    return { ok: false, raison: 'ECHEC' }
  }
}
```

`lireOccupation` rend `{ ok: false, raison: 'PAS_DE_CONNECTEUR' }` quand `connector === null`, et `{ ok: true, jours }` sinon.

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
npx vitest run src/services/availability.test.ts
```

Attendu : SUCCÈS.

- [ ] **Étape 5 : commit**

```bash
git add src/services/availability.ts src/services/availability.test.ts
git commit -m "feat(agenda): une lecture sait dire qu elle n a pas pu repondre"
```

---

## Tâche 11 — G : le bouton « Vérifier l'agenda », et la page cesse d'appeler Google

**Fichiers :**
- Créer : `src/app/(app)/saisie/[month]/BoutonAgenda.tsx`
- Créer : `src/app/(app)/saisie/[month]/BoutonAgenda.test.tsx`
- Modifier : `src/app/(app)/saisie/[month]/actions.ts`
- Modifier : `src/app/(app)/saisie/[month]/page.tsx`
- Modifier : `src/app/(app)/saisie/[month]/page.test.tsx`
- Modifier : `src/app/(app)/saisie/[month]/SaisieClient.tsx`

**Interfaces :**
- Consomme : `getBusyRange` (tâche 10).
- Produit : action `verifierAgenda(args: { du: string; au: string }): Promise<ResultatAgenda>`, et l'état `occupations` local à `SaisieClient`.

- [ ] **Étape 1 : écrire le test le plus important du lot**

Dans `src/app/(app)/saisie/[month]/page.test.tsx` :

```tsx
// Le test qui porte toute la section G. Parcourir douze mois coutait douze
// appels freeBusy, pour un repere qu'on ne regardait peut-etre pas.
it('n appelle pas Google en ouvrant le mois', async () => {
  await SaisiePage({
    params: Promise.resolve({ month: '2026-03' }),
    searchParams: Promise.resolve({}),
  })

  expect(agendaEspion).not.toHaveBeenCalled()
})
```

où `agendaEspion` double `@/services/availability` **en entier** — si la page importe encore quoi que ce soit de ce module, le test le voit.

Et créer `src/app/(app)/saisie/[month]/BoutonAgenda.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoutonAgenda } from './BoutonAgenda'

const onResultat = vi.fn()

describe('BoutonAgenda', () => {
  afterEach(() => {
    cleanup()
    onResultat.mockClear()
  })

  it('affirme le vide plutot que de ne rien dire', async () => {
    render(
      <BoutonAgenda
        du="2026-03-01"
        au="2026-03-31"
        verifier={async () => ({ ok: true, jours: [] })}
        onResultat={onResultat}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Vérifier l’agenda/ }))

    expect(screen.getByRole('status').textContent).toContain('Aucune occupation')
  })

  it('compte les jours occupes', async () => {
    render(
      <BoutonAgenda
        du="2026-03-01"
        au="2026-03-31"
        verifier={async () => ({ ok: true, jours: ['2026-03-04', '2026-03-12'] })}
        onResultat={onResultat}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Vérifier l’agenda/ }))

    expect(screen.getByRole('status').textContent).toContain('2 jours occupés')
    expect(onResultat).toHaveBeenCalledWith(['2026-03-04', '2026-03-12'])
  })

  // L'utilisateur a demande. Le silence serait un mensonge.
  it('dit quand l agenda n a pas repondu', async () => {
    render(
      <BoutonAgenda
        du="2026-03-01"
        au="2026-03-31"
        verifier={async () => ({ ok: false, raison: 'ECHEC' })}
        onResultat={onResultat}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Vérifier l’agenda/ }))

    expect(screen.getByRole('status').textContent).toContain('n’a pas répondu')
    expect(screen.getByRole('status').textContent).toContain('La saisie continue')
  })
})
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

```bash
npx vitest run "src/app/(app)/saisie/[month]/BoutonAgenda.test.tsx" "src/app/(app)/saisie/[month]/page.test.tsx"
```

Attendu : ÉCHEC des deux.

- [ ] **Étape 3 : écrire l'action, avec sa borne**

Dans `src/app/(app)/saisie/[month]/actions.ts` :

```ts
/** Ce qu'une vue peut afficher au plus : trois mois. */
const PLAGE_MAX_JOURS = 93

/**
 * Lit l'occupation de l'agenda sur la plage affichée — **à la demande de
 * l'utilisateur, jamais au chargement**.
 *
 * La plage vient du client. Elle est bornée ici : un appel forgé demandant dix
 * ans brûlerait le quota Google d'un seul coup, et aucune vue n'affiche plus
 * de trois mois.
 */
export async function verifierAgenda(args: {
  du: string
  au: string
}): Promise<ResultatAgenda> {
  const user = await requireUser()

  const jours = (Date.parse(`${args.au}T00:00:00Z`) - Date.parse(`${args.du}T00:00:00Z`)) / 86_400_000
  if (!Number.isFinite(jours) || jours < 0 || jours > PLAGE_MAX_JOURS) {
    return { ok: false, raison: 'ECHEC' }
  }

  return await getBusyRange(user.id, args)
}
```

- [ ] **Étape 4 : écrire le bouton**

Créer `src/app/(app)/saisie/[month]/BoutonAgenda.tsx`. Il prend `verifier` en prop (l'action par défaut au point d'appel) pour être testable sans réseau, tient son propre état « en cours », et rend son compte rendu dans un `role="status"`.

- [ ] **Étape 5 : couper la lecture automatique**

Dans `src/app/(app)/saisie/[month]/page.tsx`, **supprimer** :

```ts
const busyDates = await getBusyDays(user.id, month)
```

et l'import de `@/services/availability`. Ne plus passer `busyDates` à `SaisieClient`.

Ajouter à la place une lecture **locale, sans réseau**, qui dit si un connecteur est configuré — un bouton qui échoue toujours n'apprend rien à personne :

```ts
const agendaConnecte = await aUnConnecteurAgenda(user.id)
```

Dans `SaisieClient`, `busyDates` devient la graine d'un état :

```tsx
// La prop reste : elle sert aux tests à ensemencer des occupations. La page,
// elle, ne la passe plus — l'agenda ne se lit qu'au clic.
const [occupations, setOccupations] = useState<string[]>(props.busyDates ?? [])
```

Remplacer les deux `busyDates={props.busyDates}` par `busyDates={occupations}`, et `messageDOccupation` lit `occupations`.

- [ ] **Étape 6 : régler la portée du résultat**

Le résultat porte la plage qu'il couvre. Dans `choisirVue`, effacer les occupations quand la nouvelle vue est **plus large** que la plage vérifiée :

```tsx
// Passer du calendrier à la vue 3 mois efface le résultat : la plage vérifiée
// ne couvre plus ce qu'on montre, et laisser des mois non vérifiés sans
// marqueur les ferait croire libres. L'inverse le conserve — la plage vérifiée
// contient ce qu'on affiche.
if (prochaine === 'TROIS_MOIS' && plageVerifiee !== '3MOIS') setOccupations([])
```

Changer de mois est une navigation : l'état repart à vide tout seul.

- [ ] **Étape 7 : lancer la suite**

```bash
npm test
```

Attendu : SUCCÈS.

- [ ] **Étape 8 : commit**

```bash
git add "src/app/(app)/saisie/[month]"
git commit -m "feat(agenda): on ne consulte Google que si on le demande"
```

---

## Tâche 12 — E : `getEntriesRange`

**Fichiers :**
- Modifier : `src/services/time-entries.ts:41`
- Test : `src/services/time-entries.test.ts`

**Interfaces :**
- Produit : `getEntriesRange(userId: string, args: { du: string; au: string }): Promise<MonthEntry[]>`. `getMonthEntries(userId, month)` reste exporté et s'y ramène.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
describe('getEntriesRange', () => {
  it('rend les saisies de toute la plage, bornes incluses', async () => {
    const entries = await getEntriesRange('u1', { du: '2026-03-01', au: '2026-05-31' })

    expect(entries.map((e) => e.date)).toContain('2026-05-31')
    expect(entries.map((e) => e.date)).toContain('2026-03-01')
  })

  it('exclut le lendemain de la borne haute', async () => {
    const entries = await getEntriesRange('u1', { du: '2026-03-01', au: '2026-03-31' })

    expect(entries.map((e) => e.date)).not.toContain('2026-04-01')
  })

  // Une seule regle de bornes, pas deux : `getMonthEntries` s'y ramene plutot
  // que d'en porter une copie.
  it('getMonthEntries rend exactement la plage du mois', async () => {
    expect(await getMonthEntries('u1', '2026-03')).toEqual(
      await getEntriesRange('u1', { du: '2026-03-01', au: '2026-03-31' }),
    )
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run src/services/time-entries.test.ts -t "getEntriesRange"
```

Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

```ts
/**
 * Les saisies d'une plage de dates, bornes incluses.
 *
 * La vue 3 mois lit 90 jours en **une** requête : trois lectures de mois
 * feraient payer l'écran au nombre de mois affichés, à chaque bascule de vue.
 */
export async function getEntriesRange(
  userId: string,
  args: { du: string; au: string },
): Promise<MonthEntry[]> {
  const start = new Date(`${args.du}T00:00:00.000Z`)
  // Borne ouverte à droite : le lendemain de `au`, à minuit.
  const end = new Date(Date.parse(`${args.au}T00:00:00.000Z`) + 86_400_000)

  const rows = await prisma.timeEntry.findMany({
    where: { userId, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
  })
  return rows.map(versMonthEntry)
}

/** Le mois, exprimé dans la plage : une seule règle de bornes, pas deux. */
export async function getMonthEntries(userId: string, month: string): Promise<MonthEntry[]> {
  const jours = joursDuMois(month)
  return await getEntriesRange(userId, { du: jours[0]!, au: jours[jours.length - 1]! })
}
```

Extraire la projection existante dans `versMonthEntry` pour que les deux la partagent.

- [ ] **Étape 4 : lancer la suite**

```bash
npm test
```

Attendu : SUCCÈS.

- [ ] **Étape 5 : commit**

```bash
git add src/services/time-entries.ts src/services/time-entries.test.ts
git commit -m "refactor(saisie): les saisies se lisent par plage, le mois n en est qu un cas"
```

---

## Tâche 13 — E : la densité compacte du calendrier

**Fichiers :**
- Modifier : `src/components/calendar/MonthCalendar.tsx:232`
- Modifier : `src/components/calendar/MonthCalendar.test.tsx`

**Interfaces :**
- Produit : `MonthCalendar` accepte `densite?: 'NORMALE' | 'COMPACTE'` (défaut `'NORMALE'`).

- [ ] **Étape 1 : écrire le test qui échoue**

```tsx
describe('MonthCalendar — densite compacte', () => {
  afterEach(cleanup)

  it('retire les libelles qui ne survivent pas a la reduction', () => {
    const { container } = renderCalendar({ densite: 'COMPACTE', entries: [entree()] })

    expect(container.textContent).not.toContain('h ')
  })

  it('garde le numero du jour, les marqueurs et le coin eclate', () => {
    renderCalendar({
      densite: 'COMPACTE',
      entries: [entree({ kind: 'PREVISIONNEL' })],
      busyDates: ['2026-03-10'],
    })

    expect(screen.getByTestId('previsionnel-2026-03-10')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()
  })

  // C'est une surface de saisie, pas un apercu : la cinematique est
  // identique, sinon la vue 3 mois ne sert qu'a regarder.
  it('reste cliquable et applique le meme cycle', async () => {
    const onApply = vi.fn(async () => true)
    renderCalendar({ densite: 'COMPACTE', onApply })

    await userEvent.click(screen.getByRole('button', { name: /10 mars/ }))

    expect(onApply).toHaveBeenCalled()
  })

  it('la densite normale ne change pas', () => {
    const { container } = renderCalendar({ entries: [entree()] })

    expect(container.textContent).toContain('1,00')
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
npx vitest run src/components/calendar/MonthCalendar.test.tsx -t "densite compacte"
```

Attendu : ÉCHEC — la prop n'existe pas.

- [ ] **Étape 3 : implémenter**

Ajouter la prop, documentée :

```tsx
  /**
   * Le calibre de la grille.
   *
   * `COMPACTE` sert la vue 3 mois : trois grilles dans l'emprise d'une seule
   * ramènent la case de ~145 à ~55 points. Elle perd alors ce qui ne survit
   * pas à la réduction — les libellés d'heures et de créneau — et garde ce qui
   * porte l'information : l'aplat, le numéro du jour, les marqueurs.
   *
   * **Une prop et non un second composant.** Deux dessins de la même grille
   * divergeraient au premier correctif, et une bascule de vue montrerait alors
   * deux fois le même fait de deux façons — c'est ce que la note d'`Aplat` dit
   * déjà du tableau et du calendrier.
   */
  densite?: 'NORMALE' | 'COMPACTE'
```

Conditionner uniquement l'affichage des libellés et les classes de corps de texte. **Ne rien conditionner de la cinématique** : `onApply`, `onRange`, `useDragSelect`, `useLongPress` et les raccourcis clavier restent identiques.

- [ ] **Étape 4 : mesurer la cible tactile en compacte**

Ajouter au bloc de budget de `MonthCalendar.test.tsx` un cas qui mesure la densité compacte **à sa largeur réelle** — 1600 points de contenu, trois grilles, six gouttières par grille :

```ts
it('laisse a chaque case compacte une cible utilisable sur ecran large', () => {
  const CONTENU = 1600 - 2 * MARGE_MD   // le gabarit de la tâche 1
  const colonne = (CONTENU / 3 - 6 * gap(grille)) / 7

  expect(colonne).toBeGreaterThanOrEqual(CIBLE)
})
```

**Ne pas exempter la densité compacte du contrôle.** Si la mesure ne passe pas, c'est le dessin qui doit céder, pas le test.

- [ ] **Étape 5 : lancer les tests**

```bash
npx vitest run src/components/calendar/MonthCalendar.test.tsx
```

Attendu : SUCCÈS.

- [ ] **Étape 6 : commit**

```bash
git add src/components/calendar/MonthCalendar.tsx src/components/calendar/MonthCalendar.test.tsx
git commit -m "feat(calendrier): une grille compacte, sans second dessin a maintenir"
```

---

## Tâche 14 — E : la vue 3 mois

**Fichiers :**
- Modifier : `src/app/(app)/saisie/[month]/page.tsx`
- Modifier : `src/app/(app)/saisie/[month]/page.test.tsx`
- Modifier : `src/app/(app)/saisie/[month]/SaisieClient.tsx`
- Modifier : `src/app/(app)/saisie/[month]/SaisieClient.test.tsx`

**Interfaces :**
- Consomme : `getEntriesRange` (tâche 12), `densite` (tâche 13), `shiftMonth` et `buildMonthDays` de `@/core/month/build`.
- Produit : la vue `TROIS_MOIS`, atteinte par `?vue=3mois`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```tsx
it('resout la vue 3 mois depuis l adresse', async () => {
  render(
    await SaisiePage({
      params: Promise.resolve({ month: '2026-03' }),
      searchParams: Promise.resolve({ vue: '3mois' }),
    }),
  )

  expect(screen.getByRole('button', { name: '3 mois' }).getAttribute('aria-pressed')).toBe('true')
})

it('montre le mois choisi et les deux suivants', async () => {
  rendreEnTroisMois('2026-11')

  expect(screen.getByText('novembre 2026')).toBeTruthy()
  expect(screen.getByText('décembre 2026')).toBeTruthy()
  // Le passage d'annee n'a pas de cas particulier : `shiftMonth` le gere.
  expect(screen.getByText('janvier 2027')).toBeTruthy()
})

it('ecrit a la bonne date quand on clique dans le troisieme mois', async () => {
  rendreEnTroisMois('2026-03')

  await userEvent.click(screen.getByRole('button', { name: /12 mai/ }))

  expect(appliquerCase).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-05-12' }))
})

// Vingt-et-une colonnes ne tiennent pas sur un telephone. Le calendrier
// reste la surface de saisie mobile.
it('n est pas atteignable sous md', async () => {
  rendreEnTroisMois('2026-03')

  expect(screen.getByRole('button', { name: '3 mois' }).className).toContain('hidden md:')
})
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

```bash
npx vitest run "src/app/(app)/saisie/[month]"
```

Attendu : ÉCHEC.

- [ ] **Étape 3 : la page charge trois mois**

```tsx
// Les deux mois suivants, pour la vue 3 mois. Construits toujours — ils ne
// coûtent aucune requête, `buildMonthDays` est un calcul pur — et lus en une
// seule requête de plage plutôt qu'en trois.
const mois = [month, shiftMonth(month, 1), shiftMonth(month, 2)]
const joursParMois = mois.map((m) => buildMonthDays(m, settings.workingDays, settings.holidays))
const entriesPlage = await getEntriesRange(user.id, {
  du: `${mois[0]}-01`,
  au: dernierJour(mois[2]!),
})
```

Transmettre `mois` et `joursParMois` à `SaisieClient`. Les vues calendrier et tableau continuent d'utiliser le premier mois et filtrent `entriesPlage` sur lui — ou, plus simple et sans double règle : leur passer `entriesPlage` tel quel, les composants filtrant déjà par date.

- [ ] **Étape 4 : la bascule et le rendu**

Étendre `type Vue` à `'CALENDRIER' | 'TROIS_MOIS' | 'TABLEAU'`, ajouter la résolution `vue === '3mois' ? 'TROIS_MOIS' : …` dans la page, et le paramètre `parametres.set('vue', '3mois')` dans `choisirVue`.

Le bouton, entre « Calendrier » et « Tableau multi-CRA », avec `className="hidden md:inline-flex"`.

Le rendu :

```tsx
{vue === 'TROIS_MOIS' && ligne !== undefined && (
  <>
    <div className="grid grid-cols-3 gap-3">
      {props.mois.map((m, i) => (
        <section key={m}>
          <h2 className="mb-1 text-sm font-medium">{monthLabel(m)}</h2>
          <MonthCalendar
            densite="COMPACTE"
            days={props.joursParMois[i]!}
            line={ligne}
            slots={props.slots}
            entries={props.entries}
            autresLignes={AUCUNE_AUTRE_LIGNE}
            toutLeMois={false}
            busyDates={occupations}
            aujourdhui={props.aujourdhui}
            onApply={handleApply}
            onRange={handleRange}
            onFormulaire={(date, etat) => setFormulaire({ date, etat })}
          />
        </section>
      ))}
    </div>
    {/* L'engagement se lit sur toute la durée de la ligne, pas sur un mois :
        une seule réglette, sous l'ensemble. L'empiler trois fois dirait trois
        fois le même chiffre. */}
    <div className="mt-3">
      <EngagementBar line={ligne} totals={props.engagementTotals[ligne.id] ?? AUCUN_TOTAL} pleineLargeur />
    </div>
  </>
)}
```

Le formulaire de case (`CellForm`) est rendu par la vue 3 mois comme par le calendrier : c'est le même geste.

- [ ] **Étape 5 : lancer toute la suite**

```bash
npm test
```

Attendu : SUCCÈS.

- [ ] **Étape 6 : commit**

```bash
git add "src/app/(app)/saisie/[month]"
git commit -m "feat(saisie): trois mois d un coup d oeil, et saisissables"
```

---

## Tâche 15 — Le mot de la fin : documentation et recette

**Fichiers :**
- Modifier : `README.md`
- Modifier : `docs/superpowers/ETAT.md`

- [ ] **Étape 1 : mettre à jour le README**

Chercher les mentions de l'écran « CRA », du formulaire « Ouvrir un CRA » et de la lecture automatique de l'agenda. Les trois ont changé de comportement, et un manuel qui décrit un écran disparu est pire qu'un manuel absent.

```bash
grep -n "Ouvrir un CRA\|écran CRA\|getBusyDays\|occupation" README.md
```

- [ ] **Étape 2 : lancer la suite complète une dernière fois**

```bash
npm test && npx tsc --noEmit
```

Attendu : SUCCÈS pour les deux.

- [ ] **Étape 3 : commit**

```bash
git add README.md docs/superpowers/ETAT.md
git commit -m "docs: le suivi CRA, la generation depuis la saisie et l agenda a la demande"
```

---

## Auto-revue du plan

**Couverture de la spec.** Section A → tâches 4, 5, 6. Section B → tâches 2, 3. Section C → tâche 9. Section D → tâches 7, 8, 9. Section E → tâches 12, 13, 14. Section F → tâche 1. Section G → tâches 10, 11. Chaque point de la section « Ce qui se teste » de la spec a un test nommé dans une tâche.

**Cohérence des noms.** `EtatSuivi`, `etatSuivi`, `estFacture`, `parseEtats`, `libelleEtat`, `ETATS_SUIVI`, `ETATS_PAR_DEFAUT` (tâche 4) sont consommés sous ces noms exacts en tâches 5 et 6. `listCrasSuivi` (5) est appelé en 6. `getCra` (2) en 3. `validerPrevisionnelDuMois` (7) en 8. `genererCra` / `ChoixPrevisionnel` / `ResultatGeneration` (8) en 9. `getBusyRange` / `ResultatAgenda` / `RaisonAgenda` (10) en 11. `getEntriesRange` (12) en 14. `densite` (13) en 14.

**Deux points laissés ouverts, et signalés comme tels :**

1. **Tâche 8, la transaction.** `getOrCreateCra` ouvre sa propre écriture et n'accepte pas de `tx`. La note de l'étape 3 dit quoi faire si le test d'atomicité ne passe pas avec la forme proposée — et ce qu'il faut alors reproduire (la capture de course).
2. **Tâche 6, étape 7.** « Suivi CRA » est plus long que « CRA » et le test de largeur des onglets sur téléphone peut légitimement échouer. La consigne est de ne pas l'assouplir mais de signaler le conflit.
