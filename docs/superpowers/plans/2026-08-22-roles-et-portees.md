# Rôles et portées — ce qui est administré, ce qui appartient au profil

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `User.role` soit enfin lu — les écrans d'administration réservés à
`ADMIN` avec un refus qui dit à qui demander — et que `dolibarrUserId` cesse
d'être un réglage d'instance pour devenir la correspondance du **propriétaire du
CRA**.

**Architecture :** le rôle est jugé par une fonction pure de `src/core/auth/`,
appliquée par deux gardes de `src/auth.ts` — une qui rend un verdict pour les
pages, une qui lève pour les actions — et **imposée par un contrôle structurel**
qui refuse tout écran d'administration sans garde, à la manière de
`src/frontieres.test.ts`. L'identifiant Dolibarr quitte
`ProviderCredential.metadata` pour un `ExternalLink` de type `User`, dont le type
existe déjà (`LIEN_UTILISATEUR`, posé par la reprise des temps) ; le push lit
celui du propriétaire du CRA et **refuse** plutôt que de retomber sur celui d'un
autre. Un écran « Mon profil » porte ce qui appartient à la personne — son
utilisateur Dolibarr, son agenda Google — et un écran « Comptes » porte ce qui
n'appartient qu'à l'administrateur : le rôle, et l'activation.

**Tech Stack :** Next.js 15 (App Router), Auth.js v5, Prisma 6 / SQLite, Vitest 4,
happy-dom.

**Spec :** `docs/superpowers/specs/2026-08-19-roles-et-portees-design.md`

## Dépendance : le plan de la double authentification

Ce lot **suit** `docs/superpowers/plans/2026-08-22-double-authentification.md` et
n'a de sens qu'après lui. Deux dépendances, nommées :

1. **Sa `Task 1` — « le rôle explicite, et le contrôle qui le garde ».** Elle
   corrige le défaut de colonne `role = "ADMIN"` : tout `prisma.user.create` de
   `src/` doit nommer son rôle, et `src/roles-explicites.test.ts` l'impose. **Ce
   plan ne refait rien de ce contenu.** Sans elle, poser une garde `ADMIN` ne
   protégerait rien : chaque auteur Dolibarr importé et chaque compte né de la
   porte Google naîtrait administrateur, et la garde laisserait tout passer.
   Les tâches 1 à 4 d'ici **présupposent** que cette tâche est faite.
2. **Sa `Task 11` — la dette qu'elle nomme dans `docs/superpowers/ETAT.md`.**
   Elle déclare que le lot des rôles suit immédiatement et qu'il **porte aussi le
   drapeau de désactivation d'un compte**. Les tâches 10 et 11 d'ici l'honorent ;
   la tâche 12 raye la dette.

Aucune autre dépendance : rien ici ne touche à `src/auth.config.ts`, aux
fournisseurs Auth.js ni au parcours de mot de passe.

## Ce que la spec demandait et qui est **déjà construit**

À ne pas replanifier — vérifié dans le code au 22 août 2026 :

| Exigence de la spec | État | Preuve |
| --- | --- | --- |
| Annexe « Gérer les clients et les missions locaux » — archiver, désarchiver, supprimer, avec l'impact compté avant | **fait** | `src/services/archivage.ts` (`impactSuppressionMission`, `archiverMission`, `supprimerMission`, `archiverClient`, `supprimerClient`, `inventaire`) ; `src/app/(app)/admin/donnees/` ; `src/app/(app)/missions/GestionMission.tsx` |
| « Le sort des correspondances » : archiver ne rompt rien, supprimer rompt sans rien effacer chez Dolibarr | **fait** | `supprimerMission` efface les `ExternalLink` **et** les lignes de file, jamais rien chez Dolibarr |
| Annexe « Un client Dolibarr créé sans passer par les réglages » | **fait le 19 août** | `src/services/dolibarr/commande.ts`, `clientVise` / `DEPUIS_LE_TIERS` |
| Arbitrage du 20 août : `listPendingSyncRows()` et `retrySyncRow()` sans `userId`, chaque ligne nommant son propriétaire | **fait** | `src/services/sync/queue.ts`, `src/app/(app)/admin/sync/` — **ce plan ne le défait pas** (tâche 5) |
| La séparation instance / profil pour les secrets | **faite pour la moitié** | `ownerScope` dans `src/services/credentials.ts` sépare déjà `USER` et `INSTANCE` ; il ne manque que le bon côté pour `dolibarrUserId` |
| Le type de correspondance `utilisateur local ↔ utilisateur Dolibarr` | **existe déjà** | `LIEN_UTILISATEUR` dans `src/services/dolibarr/liens.ts`, posé par `src/services/dolibarr/reprise-temps.ts` |

Deux écarts assumés, constatés et **non corrigés** par ce plan :

- la spec écrivait « la suppression doit être refusée » quand un client porte des
  CRA validés ; l'implémentation a choisi le **consentement éclairé** — impact
  compté, nom du client à recopier (`detruireClient`). Le porteur a tranché ainsi
  en construisant l'écran ; y revenir casserait des tests qui gardent ce choix ;
- la spec écrivait « Où : les réglages, et non la page des missions » ; la
  suppression d'une **mission** vit dans `GestionMission.tsx`, avec un renvoi
  explicite depuis `/admin/donnees` (« La suppression d'une mission se fait depuis
  son détail »). Le contenu d'une mission n'est visible que là.

## Global Constraints

- **`ADMIN` seul administre.** `MANAGER` et `CONSULTANT` ne sont pas
  administrateurs. `peutAdministrer` est la seule fonction qui en décide.
- **Le refus est nommé, jamais muet.** Pas de redirection vers `/saisie` : un
  écran qui disparaît apprend qu'il n'existe pas ; un refus apprend à qui
  demander. Le refus porte le rôle courant et l'adresse de l'administrateur.
- **Un CRA ne part jamais sous l'identifiant Dolibarr d'un autre.** Sans
  correspondance pour le propriétaire du CRA, le push **refuse** — exactement
  comme il refuse aujourd'hui l'absence d'identifiant.
- **Un identifiant Dolibarr appartient à un seul compte local.** Deux comptes qui
  déclarent le même `fk_user` reproduisent le défaut du 19 août.
- **La clé d'API Dolibarr reste de portée instance.** Elle ne bouge pas, et
  l'écran d'administration reste son seul lieu de saisie.
- **La file de synchronisation reste de portée instance** (arbitrage du 20 août) :
  `listPendingSyncRows()` et `retrySyncRow()` **ne reprennent pas de `userId`**.
  Ce que les rôles posent, c'est **qui la voit**, pas ce qu'elle contient.
- **Un mois dont le CRA est `VALIDE` refuse toute écriture** — inchangé, aucune
  tâche d'ici n'écrit dans un CRA.
- **Entiers partout** : l'identifiant Dolibarr est un entier strictement positif,
  jamais une chaîne.
- **`src/core/` reste pur** : ni Prisma, ni Next, ni React.
- **Aucune information portée par la seule couleur** ; tout couple texte/fond à
  4,5:1 — les bandeaux de refus passent par `Banner`, qui porte déjà son icône.
- **Deux jeux de migrations** à tenir : `prisma/migrations/` (Postgres,
  `TIMESTAMP(3)`) et `prisma/migrations-sqlite/` (SQLite, `DATETIME`). Deux tests
  les gardent : `src/db/schema-migration-sync.test.ts` et
  `src/distribution/migrations-sqlite.test.ts`.
- **Chaque règle est éprouvée par mutation** : casser la règle doit faire échouer
  au moins un test.
- **Français** pour les chaînes visibles et les commentaires, **anglais** pour les
  identifiants.

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `src/core/auth/roles.ts` | **créé** — pur : `ROLES`, `estRole`, `peutAdministrer`, `MOTIF_REFUS_ADMIN` |
| `src/core/auth/roles.test.ts` | **créé** — la hiérarchie, et le fait qu'elle ne s'élargit pas toute seule |
| `src/auth.ts` | modifié — `AccesRefuseError`, `accesAdministration()`, `exigerAdministration()`, refus d'un compte désactivé |
| `src/components/ui/AccesRefuse.tsx` | **créé** — le refus nommé, rendu par les écrans d'administration |
| `src/components/ui/AccesRefuse.test.tsx` | **créé** — dit le rôle, dit à qui demander, ne renvoie nulle part |
| `src/admin-garde.test.ts` | **créé** — contrôle structurel : aucun écran ni action d'administration sans garde |
| `src/app/(app)/admin/*/page.tsx` (8 écrans) | modifiés — `accesAdministration()` et `<AccesRefuse/>` |
| `src/app/(app)/admin/*/actions.ts` (8 fichiers) | modifiés — `exigerAdministration()` |
| `src/app/(app)/admin/sync/page.tsx` | modifié — la file d'instance n'est rendue que pour `ADMIN` |
| `src/app/(app)/admin/sync/SyncClient.tsx` | modifié — prop `voitLaFile`, carte « Connexion » retirée |
| `src/app/(app)/admin/sync/actions.ts` | modifié — `rejouer` exige `ADMIN`, les trois autres restent personnelles |
| `src/services/dolibarr/utilisateur.ts` | **créé** — la correspondance `utilisateur local ↔ utilisateur Dolibarr`, et sa reprise |
| `src/services/dolibarr/utilisateur.test.ts` | **créé** — l'unicité, la reprise, l'idempotence |
| `src/services/dolibarr/push.ts` | modifié — lit la correspondance du **propriétaire du CRA** |
| `src/app/(app)/profil/page.tsx` + `actions.ts` + `ProfilClient.tsx` | **créés** — l'écran « Mon profil » |
| `src/app/(app)/profil/ProfilClient.test.tsx` | **créé** |
| `src/app/api/google/callback/route.ts` | modifié — retour vers `/profil` |
| `src/app/(app)/admin/dolibarr/ConnexionForm.tsx` | modifié — le champ `dolibarrUserId` en sort |
| `src/app/(app)/admin/dolibarr/actions.ts` | modifié — `connecterDolibarr` ne lit plus le champ |
| `src/app/(app)/admin/dolibarr/page.tsx` | modifié — renvoi vers « Mon profil » |
| `prisma/schema.prisma` | modifié — `User.disabled` |
| `prisma/migrations/20260826000000_compte_desactive/migration.sql` | **créé** — jeu Postgres |
| `prisma/migrations-sqlite/20260826000000_compte_desactive/migration.sql` | **créé** — jeu SQLite |
| `src/services/roles.ts` + `src/services/roles.test.ts` | **créés** — `listerComptes`, `definirRole`, `definirActivation` |
| `src/app/(app)/admin/comptes/page.tsx` + `actions.ts` + `GestionComptes.tsx` | **créés** — l'écran « Comptes » |
| `src/components/nav/NavRail.tsx` | modifié — « Mon profil » et « Comptes » |
| `docs/superpowers/ETAT.md` | modifié — la dette du 22 août est rayée |

---

## Task 1 : le cœur pur du rôle

**Files:**
- Create: `src/core/auth/roles.ts`, `src/core/auth/roles.test.ts`

**Interfaces:**
- Consumes: `Role` de `@/core/types`.
- Produces:
  - `ROLES: readonly ['ADMIN', 'MANAGER', 'CONSULTANT']`
  - `estRole(valeur: string): valeur is Role`
  - `peutAdministrer(role: Role): boolean`
  - `MOTIF_REFUS_ADMIN: string`

- [ ] **Step 1: écrire le test**

`src/core/auth/roles.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { MOTIF_REFUS_ADMIN, ROLES, estRole, peutAdministrer } from './roles'

describe('peutAdministrer', () => {
  it('ouvre l administration au seul ADMIN', () => {
    expect(peutAdministrer('ADMIN')).toBe(true)
  })

  // `MANAGER` sonne comme un rôle d'encadrement, et c'est justement le piège :
  // il n'administre ni la clé d'API de l'instance, ni le client OAuth, ni les
  // rôles des autres. Tant qu'aucun écran ne lui est propre, il ne peut rien de
  // plus qu'un consultant.
  it("n'ouvre rien à MANAGER ni à CONSULTANT", () => {
    expect(peutAdministrer('MANAGER')).toBe(false)
    expect(peutAdministrer('CONSULTANT')).toBe(false)
  })

  it('couvre tous les rôles déclarés, sans en oublier un', () => {
    for (const role of ROLES) expect(typeof peutAdministrer(role)).toBe('boolean')
    expect(ROLES.filter(peutAdministrer)).toEqual(['ADMIN'])
  })
})

describe('estRole', () => {
  it('reconnaît les trois rôles', () => {
    expect(ROLES.every(estRole)).toBe(true)
  })

  // Le rôle vient d'une colonne `String`, pas d'une énumération de la base :
  // une valeur inventée à la main en SQL ne doit jamais être promue en `Role`.
  it("refuse ce qui n'en est pas un", () => {
    expect(estRole('ROOT')).toBe(false)
    expect(estRole('admin')).toBe(false)
    expect(estRole('')).toBe(false)
  })
})

describe('le motif du refus', () => {
  // Une redirection muette apprend que l'écran n'existe pas ; un refus nommé
  // apprend à qui demander. Le motif doit donc dire les deux : ce qui est exigé,
  // et vers qui se tourner.
  it('dit ce qui est exigé et à qui le demander', () => {
    expect(MOTIF_REFUS_ADMIN).toMatch(/administrateur/i)
    expect(MOTIF_REFUS_ADMIN.length).toBeGreaterThan(40)
  })
})
```

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/core/auth/roles.test.ts`
Expected: FAIL, `Failed to resolve import "./roles"`

- [ ] **Step 3: écrire le module**

`src/core/auth/roles.ts` :

```ts
/**
 * Qui a le droit d'administrer, et rien d'autre.
 *
 * Pur : ni base, ni session, ni React. La décision tient en une comparaison,
 * mais elle vit ici pour une raison précise — elle est lue par une page serveur,
 * par une action serveur et par un contrôle structurel, et trois écritures de la
 * même règle divergent le jour où un quatrième rôle apparaît.
 *
 * **`User.role` est une colonne `String`, pas une énumération de la base.** Une
 * valeur inventée à la main en SQL y entre sans que rien ne la refuse : d'où
 * `estRole`, qui est le seul chemin vers le type `Role`.
 */
import type { Role } from '@/core/types'

/** Les trois rôles, dans l'ordre décroissant de ce qu'ils peuvent. */
export const ROLES = ['ADMIN', 'MANAGER', 'CONSULTANT'] as const

export function estRole(valeur: string): valeur is Role {
  return (ROLES as readonly string[]).includes(valeur)
}

/**
 * L'administration est réservée à `ADMIN`, et à lui seul.
 *
 * `MANAGER` n'est pas une demi-administration : il n'a aujourd'hui aucun écran
 * qui lui soit propre, et lui ouvrir la clé d'API de l'instance ou les rôles des
 * autres serait décider à la place du porteur. Le jour où un écran lui revient,
 * c'est ici que ça se dira — et le test de couverture des rôles le verra.
 */
export function peutAdministrer(role: Role): boolean {
  return role === 'ADMIN'
}

/**
 * Ce que le refus dit. Il ne renvoie nulle part : une redirection apprend que
 * l'écran n'existe pas, un refus apprend à qui demander.
 */
export const MOTIF_REFUS_ADMIN =
  'Cet écran est réservé aux administrateurs de cette installation. ' +
  'Demandez à l’un d’eux de faire le réglage, ou de vous donner le rôle depuis Réglages · Comptes.'
```

- [ ] **Step 4: exécuter**

Run: `npx vitest run src/core/auth/roles.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: muter**

Remplacer `role === 'ADMIN'` par `role !== 'CONSULTANT'` : le test « n'ouvre rien
à MANAGER ni à CONSULTANT » doit **échouer**. Restaurer.

- [ ] **Step 6: commit**

```bash
git add src/core/auth/roles.ts src/core/auth/roles.test.ts
git commit -m "feat(roles): la regle pure, et le motif du refus"
```

---

## Task 2 : les deux gardes, et le contrôle structurel qui les impose

Une garde qu'on peut oublier d'écrire n'est pas une garde. Deux formes, parce que
deux appelants : une page **rend** un refus, une action **lève**.

**Files:**
- Modify: `src/auth.ts`
- Create: `src/components/ui/AccesRefuse.tsx`, `src/components/ui/AccesRefuse.test.tsx`
- Create: `src/admin-garde.test.ts`

**Interfaces:**
- Consumes: `peutAdministrer`, `MOTIF_REFUS_ADMIN` (Task 1) ; `requireUser()`.
- Produces:
  - `class AccesRefuseError extends Error`
  - `accesAdministration(): Promise<{ autorise: boolean; user: { id: string; role: Role } }>`
  - `exigerAdministration(): Promise<{ id: string; role: Role }>`
  - `<AccesRefuse role={role} />`

- [ ] **Step 1: écrire le test du composant de refus**

`src/components/ui/AccesRefuse.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccesRefuse } from './AccesRefuse'

afterEach(cleanup)

describe('AccesRefuse', () => {
  // La spec §3 : « une redirection muette apprend au consultant que l'écran
  // n'existe pas ; un refus nommé lui apprend à qui demander ».
  it('dit à qui demander', () => {
    render(<AccesRefuse role="CONSULTANT" />)
    expect(document.body.textContent).toMatch(/administrateur/i)
  })

  it('dit le rôle dont on dispose, pour que le refus soit compréhensible', () => {
    render(<AccesRefuse role="CONSULTANT" />)
    expect(document.body.textContent).toContain('CONSULTANT')
  })

  // Un lien « retour à la saisie » transformerait le refus en redirection
  // déguisée : la personne quitterait l'écran sans avoir lu pourquoi.
  it('ne renvoie nulle part', () => {
    render(<AccesRefuse role="MANAGER" />)
    expect(screen.queryAllByRole('link')).toEqual([])
  })

  // « Aucune information portée par la seule couleur » : le bandeau porte son
  // icône et son titre, pas seulement un fond rouge.
  it('annonce le refus par un rôle d alerte, pas par une teinte', () => {
    render(<AccesRefuse role="CONSULTANT" />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
```

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/components/ui/AccesRefuse.test.tsx`
Expected: FAIL, `Failed to resolve import "./AccesRefuse"`

- [ ] **Step 3: écrire le composant**

`src/components/ui/AccesRefuse.tsx` :

```tsx
import type { Role } from '@/core/types'
import { MOTIF_REFUS_ADMIN } from '@/core/auth/roles'
import { Banner } from './Banner'
import { PageShell } from './PageShell'

/**
 * Le refus, à l'écran, à la place de ce qui est refusé.
 *
 * **Il ne redirige pas, et c'est tout son objet.** Une redirection vers
 * `/saisie` enseigne au consultant que l'écran n'existe pas : il le cherchera,
 * puis conclura que l'application ne sait pas faire. Un refus nommé lui apprend
 * que l'écran existe, qu'il ne lui est pas ouvert, et à qui le demander.
 *
 * Aucun lien de sortie : la navigation est déjà là, à gauche, et un bouton
 * « retour » ferait quitter l'écran avant d'avoir lu pourquoi.
 *
 * Composant **serveur** : il est rendu depuis les `page.tsx`, avant tout appel
 * de service. Rien de ce que la page allait lire n'a été lu.
 */
export function AccesRefuse({ role }: { role: Role }) {
  return (
    <PageShell title="Accès refusé">
      <Banner tone="danger" title="Cet écran ne vous est pas ouvert">
        <p>{MOTIF_REFUS_ADMIN}</p>
        <p>
          Votre rôle sur cette installation : <strong>{role}</strong>.
        </p>
      </Banner>
    </PageShell>
  )
}
```

- [ ] **Step 4: écrire les deux gardes**

À la fin de `src/auth.ts` :

```ts
/**
 * Une session valide qui n'a pas le rôle. Levée par `exigerAdministration`, et
 * par elle seule.
 *
 * Un type propre, et non un `Error` nu : les actions serveur rendent presque
 * toutes un état `{ ok: false, erreur }`, et elles doivent pouvoir distinguer
 * « vous n'avez pas le droit » — qui ne se réessaie pas — de « la base est
 * tombée » — qui se réessaie.
 */
export class AccesRefuseError extends Error {
  constructor(message: string = MOTIF_REFUS_ADMIN) {
    super(message)
    this.name = 'AccesRefuseError'
  }
}

/**
 * Le verdict, pour une **page**. Ne lève jamais.
 *
 * Les pages ne lèvent pas : en production, Next remplace le message d'une
 * exception de composant serveur par un condensé opaque, et le refus nommé —
 * tout l'objet de la spec §3 — se perdrait en route. La page reçoit donc un
 * verdict et rend `<AccesRefuse/>` elle-même, **avant** d'appeler le moindre
 * service : rien de ce qu'elle allait lire n'est lu.
 */
export async function accesAdministration(): Promise<{
  autorise: boolean
  user: { id: string; role: Role }
}> {
  const user = await requireUser()
  return { autorise: peutAdministrer(user.role), user }
}

/**
 * La garde, pour une **action serveur**. Lève `AccesRefuseError`.
 *
 * Une action ne rend rien à peindre : le seul refus qui ait du sens est une
 * interruption. Et elle est indispensable en plus de celle de la page — une
 * action serveur est un point d'entrée HTTP à part entière, atteignable sans
 * jamais avoir affiché l'écran qui la déclare.
 */
export async function exigerAdministration(): Promise<{ id: string; role: Role }> {
  const user = await requireUser()
  if (!peutAdministrer(user.role)) throw new AccesRefuseError()
  return user
}
```

et, en tête du fichier, compléter les imports :

```ts
import { MOTIF_REFUS_ADMIN, peutAdministrer } from '@/core/auth/roles'
```

- [ ] **Step 5: écrire le contrôle structurel**

`src/admin-garde.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Aucun écran d'administration derrière une simple session.
 *
 * Le défaut, relevé par les quatre revues adversariales et resté ouvert tant que
 * l'application n'a eu qu'un compte : `/admin/dolibarr`, `/admin/google` et
 * `/admin/sync` n'ont jamais lu que `requireUser()`. Tout compte authentifié
 * pouvait connecter, déconnecter ou repointer.
 *
 * Corriger les huit écrans connus laisserait le neuvième répéter le défaut. Ce
 * contrôle refuse donc la **forme**, à la manière de `src/frontieres.test.ts` :
 * un écran ajouté sans sa garde le fait tomber, et retirer la garde d'un écran
 * existant aussi.
 */
const ADMIN = join(process.cwd(), 'src', 'app', '(app)', 'admin')

function ecrans(): string[] {
  return readdirSync(ADMIN, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ADMIN, e.name, 'page.tsx')))
    .map((e) => join(ADMIN, e.name, 'page.tsx'))
}

function fichiersDActions(): string[] {
  return readdirSync(ADMIN, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ADMIN, e.name, 'actions.ts')))
    .map((e) => join(ADMIN, e.name, 'actions.ts'))
}

/**
 * L'unique écran **mixte**, et la raison de son exception.
 *
 * `/admin/sync` porte deux choses de portées différentes : les divergences et
 * les échecs d'une personne, et la file de l'instance. L'arbitrage du porteur du
 * 20 août 2026 tient — « un CRA s'envoie par mission, pas par consultant » —,
 * donc la file reste d'instance et l'écran reste ouvert. Ce que les rôles y
 * posent, c'est **qui voit la file**, et le contrôle l'exige explicitement plus
 * bas : l'exception n'est pas un trou, c'est une obligation différente.
 */
const ECRAN_MIXTE = 'admin/sync/page.tsx'

/**
 * Les actions d'administration qui restent **personnelles**, nommées une à une.
 *
 * Elles vivent sous `/admin/` pour des raisons d'histoire, mais elles n'agissent
 * que sur le compte de la session : les interdire à un consultant lui retirerait
 * l'arbitrage de ses propres divergences et le drainage de sa propre file.
 * Nommer les exceptions, plutôt qu'exempter le fichier, garde le contrôle
 * mordant : une action ajoutée à ce fichier sans garde le fait tomber.
 */
const ACTIONS_PERSONNELLES: Readonly<Record<string, readonly string[]>> = {
  'admin/sync/actions.ts': ['synchroniserMaintenant', 'arbitrer'],
}

function chemin(fichier: string): string {
  return relative(join(process.cwd(), 'src', 'app', '(app)'), fichier).split('\\').join('/')
}

describe('les écrans d administration exigent le rôle', () => {
  it('a bien plus de cinq écrans à garder', () => {
    // Le contrôle lit les dossiers : s'il n'en trouvait aucun, il passerait en
    // ne gardant rien.
    expect(ecrans().length).toBeGreaterThan(5)
  })

  it('ne laisse aucun écran derrière la seule session', () => {
    const fautifs: string[] = []

    for (const fichier of ecrans()) {
      const relatif = chemin(fichier)
      if (relatif === ECRAN_MIXTE) continue
      const contenu = readFileSync(fichier, 'utf8')
      if (!contenu.includes('accesAdministration(') || !contenu.includes('<AccesRefuse')) {
        fautifs.push(relatif)
      }
    }

    expect(
      fautifs,
      `${fautifs.join(', ')} : un écran d'administration doit appeler accesAdministration() et rendre <AccesRefuse/>`,
    ).toEqual([])
  })

  it('exige de l écran mixte qu il gate ce qui est d instance', () => {
    const contenu = readFileSync(join(ADMIN, 'sync', 'page.tsx'), 'utf8')
    expect(
      contenu.includes('peutAdministrer('),
      "/admin/sync est ouvert à tous : il doit lui-même décider qui voit la file d'instance",
    ).toBe(true)
  })

  it('ne laisse aucune action d administration sans garde', () => {
    const fautifs: string[] = []

    for (const fichier of fichiersDActions()) {
      const relatif = chemin(fichier)
      const exemptes = ACTIONS_PERSONNELLES[relatif] ?? []
      const contenu = readFileSync(fichier, 'utf8')

      for (const trouve of contenu.matchAll(/export async function (\w+)/g)) {
        const nom = trouve[1]!
        if (exemptes.includes(nom)) continue
        // Les 600 caractères qui suivent la signature : assez pour couvrir la
        // liste d'arguments et les premières lignes du corps, trop peu pour
        // attraper la garde de la fonction suivante.
        const corps = contenu.slice(trouve.index!, trouve.index! + 600)
        if (!corps.includes('exigerAdministration(')) fautifs.push(`${relatif}#${nom}`)
      }
    }

    expect(
      fautifs,
      `${fautifs.join(', ')} : une action d'administration doit appeler exigerAdministration()`,
    ).toEqual([])
  })
})
```

- [ ] **Step 6: exécuter, et constater l'échec**

```bash
npx vitest run src/components/ui/AccesRefuse.test.tsx src/admin-garde.test.ts
```

Expected: `AccesRefuse` PASS ; `admin-garde` FAIL, listant les huit écrans et
toutes les actions d'administration.

- [ ] **Step 7: commit**

```bash
git add src/core/auth src/auth.ts src/components/ui/AccesRefuse.tsx src/components/ui/AccesRefuse.test.tsx src/admin-garde.test.ts
git commit -m "feat(roles): les deux gardes, et le controle qui les impose"
```

Le contrôle est rouge, et c'est voulu : les tâches 3 et 4 le rendent vert.

---

## Task 3 : poser la garde sur les huit écrans

**Files:**
- Modify: `src/app/(app)/admin/dolibarr/page.tsx`, `src/app/(app)/admin/donnees/page.tsx`,
  `src/app/(app)/admin/google/page.tsx`, `src/app/(app)/admin/saisie/page.tsx`,
  `src/app/(app)/admin/supervision/page.tsx`, `src/app/(app)/admin/theme/page.tsx`,
  `src/app/(app)/admin/webhooks/page.tsx`
- Modify: `src/app/(app)/admin/sync/page.tsx` (tâche 5, forme différente)

**Interfaces:**
- Consumes: `accesAdministration()` (Task 2), `<AccesRefuse/>`.
- Produces: rien.

- [ ] **Step 1: les deux écrans sans `user`**

Dans `src/app/(app)/admin/theme/page.tsx`, remplacer `await requireUser()` par :

```tsx
  const { autorise, user } = await accesAdministration()
  if (!autorise) return <AccesRefuse role={user.role} />
```

Dans `src/app/(app)/admin/google/page.tsx`, remplacer `await requireUser()` par
exactement les mêmes deux lignes. Dans les deux fichiers, remplacer l'import
`import { requireUser } from '@/auth'` par :

```tsx
import { accesAdministration } from '@/auth'
import { AccesRefuse } from '@/components/ui/AccesRefuse'
```

**Le placement est la garde** : ces deux lignes viennent **avant** tout autre
`await`. Une lecture de `getGoogleOAuthClientView()` déjà effectuée serait une
lecture faite pour quelqu'un qui n'y a pas droit.

- [ ] **Step 2: les cinq écrans qui se servent de `user.id`**

Dans `src/app/(app)/admin/dolibarr/page.tsx`,
`src/app/(app)/admin/donnees/page.tsx`, `src/app/(app)/admin/saisie/page.tsx`,
`src/app/(app)/admin/supervision/page.tsx` et
`src/app/(app)/admin/webhooks/page.tsx`, remplacer la ligne
`const user = await requireUser()` (ou `await requireUser()`) par :

```tsx
  const { autorise, user } = await accesAdministration()
  if (!autorise) return <AccesRefuse role={user.role} />
```

`user` garde son nom et son type `{ id, role }` : les usages de `user.id` plus bas
sont inchangés. Dans chacun, remplacer l'import de `requireUser` par les deux
lignes de l'étape 1.

Pour `/admin/donnees`, dont la page n'utilise pas `user`, écrire au lieu de la
déstructuration complète :

```tsx
  const { autorise, user } = await accesAdministration()
  if (!autorise) return <AccesRefuse role={user.role} />
  const etat = await inventaire()
```

- [ ] **Step 3: ajouter le test de comportement d'un écran représentatif**

À la fin de `src/app/(app)/admin/donnees/` — créer
`src/app/(app)/admin/donnees/page.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { accesAdministration, inventaire } = vi.hoisted(() => ({
  accesAdministration: vi.fn(),
  inventaire: vi.fn(),
}))
vi.mock('@/auth', () => ({ accesAdministration }))
vi.mock('@/services/archivage', () => ({ inventaire }))
vi.mock('./actions', () => ({
  rangerClient: vi.fn(),
  sortirMissionDeLArchive: vi.fn(),
  chargerImpactClient: vi.fn(),
  detruireClient: vi.fn(),
}))

import AdminDonneesPage from './page'

beforeEach(() => {
  accesAdministration.mockReset()
  inventaire.mockReset().mockResolvedValue({ clients: [], missionsArchivees: [] })
})
afterEach(cleanup)

describe('la garde de l écran Données', () => {
  it('rend l écran à un administrateur', async () => {
    accesAdministration.mockResolvedValue({ autorise: true, user: { id: 'u1', role: 'ADMIN' } })

    render(await AdminDonneesPage())

    expect(screen.getByRole('heading', { name: 'Données' })).toBeTruthy()
  })

  it('refuse un consultant, et le lui dit', async () => {
    accesAdministration.mockResolvedValue({
      autorise: false,
      user: { id: 'u2', role: 'CONSULTANT' },
    })

    render(await AdminDonneesPage())

    expect(screen.getByRole('heading', { name: 'Accès refusé' })).toBeTruthy()
    expect(document.body.textContent).toMatch(/administrateur/i)
  })

  // Le refus doit tomber **avant** la lecture : un inventaire déjà calculé est
  // une lecture faite pour quelqu'un qui n'y avait pas droit, même si elle
  // n'atteint jamais l'écran.
  it('ne lit rien quand il refuse', async () => {
    accesAdministration.mockResolvedValue({
      autorise: false,
      user: { id: 'u2', role: 'CONSULTANT' },
    })

    render(await AdminDonneesPage())

    expect(inventaire).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: exécuter**

```bash
npx tsc --noEmit
npx vitest run "src/app/(app)/admin"
```

Expected: PASS. Les tests d'écran existants qui simulent `@/auth` avec
`requireUser` seulement doivent recevoir `accesAdministration` : dans chaque
`page.test.tsx` d'administration, remplacer la fabrique
`vi.mock('@/auth', () => ({ requireUser }))` par
`vi.mock('@/auth', () => ({ requireUser, accesAdministration }))` et, dans le
`beforeEach`, ajouter
`accesAdministration.mockReset().mockResolvedValue({ autorise: true, user: { id: 'u1', role: 'ADMIN' } })`
avec la déclaration correspondante dans le `vi.hoisted`.

- [ ] **Step 5: muter**

Dans `src/app/(app)/admin/donnees/page.tsx`, remplacer `if (!autorise)` par
`if (false)` : les deux tests de refus doivent **échouer**. Restaurer.

- [ ] **Step 6: commit**

```bash
git add "src/app/(app)/admin"
git commit -m "feat(roles): les ecrans d'administration exigent le role"
```

---

## Task 4 : poser la garde sur les actions d'administration

Une action serveur est un point d'entrée HTTP : elle s'atteint sans avoir jamais
affiché l'écran qui la déclare. Garder les pages sans garder les actions ne garde
rien.

**Files:**
- Modify: `src/app/(app)/admin/dolibarr/actions.ts`, `src/app/(app)/admin/donnees/actions.ts`,
  `src/app/(app)/admin/google/actions.ts`, `src/app/(app)/admin/saisie/actions.ts`,
  `src/app/(app)/admin/supervision/actions.ts`, `src/app/(app)/admin/theme/actions.ts`,
  `src/app/(app)/admin/webhooks/actions.ts`
- Modify: `src/app/(app)/admin/sync/actions.ts` (tâche 5)

**Interfaces:**
- Consumes: `exigerAdministration()` (Task 2).
- Produces: rien.

- [ ] **Step 1: substituer dans les sept fichiers**

Dans chacun des sept fichiers listés, remplacer **chaque** occurrence de
`await requireUser()` par `await exigerAdministration()`, y compris les formes
`const user = await requireUser()` — la garde rend le même
`{ id, role }`, donc `user.id` reste valide. Puis remplacer l'import :

```ts
import { exigerAdministration } from '@/auth'
```

- [ ] **Step 2: ajouter le test de comportement sur une action représentative**

À la fin de `src/app/(app)/admin/donnees/` — créer
`src/app/(app)/admin/donnees/actions.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { exigerAdministration, archiverClient } = vi.hoisted(() => ({
  exigerAdministration: vi.fn(),
  archiverClient: vi.fn(),
}))
vi.mock('@/auth', () => ({
  exigerAdministration,
  AccesRefuseError: class extends Error {},
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/db/client', () => ({ prisma: { client: { findUnique: vi.fn() } } }))
vi.mock('@/services/archivage', () => ({
  archiverClient,
  archiverMission: vi.fn(),
  impactSuppressionClient: vi.fn(),
  supprimerClient: vi.fn(),
}))

import { rangerClient } from './actions'

beforeEach(() => {
  exigerAdministration.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  archiverClient.mockReset().mockResolvedValue(undefined)
})

describe("la garde d'une action d'administration", () => {
  it('archive quand la garde passe', async () => {
    const r = await rangerClient('c1', true)
    expect(r).toEqual({ ok: true, message: 'Client archivé.' })
    expect(archiverClient).toHaveBeenCalledWith('c1', true)
  })

  // Une action serveur s'atteint sans avoir jamais affiché son écran : la garde
  // de la page ne la protège pas. Et le refus doit tomber **avant** l'écriture.
  it("n'écrit rien quand la garde refuse", async () => {
    exigerAdministration.mockRejectedValue(new Error('refus'))

    await expect(rangerClient('c1', true)).rejects.toThrow()
    expect(archiverClient).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: exécuter le contrôle structurel, enfin vert**

```bash
npx tsc --noEmit
npx vitest run src/admin-garde.test.ts "src/app/(app)/admin"
```

Expected: PASS.

- [ ] **Step 4: muter**

Dans `src/app/(app)/admin/donnees/actions.ts`, retirer la ligne
`await exigerAdministration()` de `rangerClient` : `src/admin-garde.test.ts` **et**
le test « n'écrit rien quand la garde refuse » doivent échouer. Restaurer.

- [ ] **Step 5: commit**

```bash
git add "src/app/(app)/admin"
git commit -m "feat(roles): les actions d'administration exigent le role"
```

---

## Task 5 : la file de synchronisation, et ce qu'un consultant en voit

L'arbitrage du 20 août tient : la file est de portée instance, `listPendingSyncRows()`
et `retrySyncRow()` **ne reprennent pas de `userId`**. Ce que les rôles posent,
c'est qui la regarde.

**Files:**
- Modify: `src/app/(app)/admin/sync/page.tsx`, `src/app/(app)/admin/sync/SyncClient.tsx`,
  `src/app/(app)/admin/sync/actions.ts`
- Test: `src/app/(app)/admin/sync/SyncClient.test.tsx`, `src/app/(app)/admin/sync/page.test.tsx`

**Interfaces:**
- Consumes: `peutAdministrer` (Task 1), `exigerAdministration` (Task 2).
- Produces: `SyncClient` gagne la prop `voitLaFile: boolean`.

- [ ] **Step 1: écrire le test du client**

À la fin de `src/app/(app)/admin/sync/SyncClient.test.tsx`, dans un nouveau
`describe` (le fichier dispose déjà d'un assembleur de props ; les deux tests
ci-dessous passent explicitement toutes les props nécessaires) :

```tsx
describe('qui voit la file de l instance', () => {
  const EN_ATTENTE: PendingSyncRow[] = [
    {
      id: 'r1',
      entityId: 'cra-1',
      proprietaire: 'Camille Roux',
      entityType: 'Cra',
      provider: 'dolibarr',
      operation: 'UPSERT',
      attenteHeures: 2,
      attempts: 0,
      libelle: 'CRA de juillet · Client A',
    },
  ]

  it('montre la file, et le nom de chaque propriétaire, à un administrateur', () => {
    render(
      <SyncClient
        conflicts={[]}
        failures={[]}
        pending={EN_ATTENTE}
        voitLaFile={true}
      />,
    )

    expect(screen.getByText('Camille Roux')).toBeTruthy()
  })

  // « Un CONSULTANT ne voit que les missions qui le concernent, un ADMIN voit
  // toute l'instance » (spec, arbitrage du 20 août). La file **reste** de portée
  // instance — on ne la refiltre pas par `userId`, ce qui ferait retomber le
  // défaut que l'arbitrage a corrigé : on ne la montre simplement pas.
  it("ne montre pas la file d'instance à un consultant", () => {
    render(
      <SyncClient
        conflicts={[]}
        failures={[]}
        pending={EN_ATTENTE}
        voitLaFile={false}
      />,
    )

    expect(screen.queryByText('Camille Roux')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'En attente' })).toBeNull()
  })

  // Ses propres divergences et ses propres échecs, eux, restent à lui : les
  // masquer le laisserait devant un agenda faux sans aucun moyen de le voir.
  it('laisse au consultant ses divergences et ses échecs', () => {
    render(
      <SyncClient
        conflicts={[]}
        failures={[]}
        pending={EN_ATTENTE}
        voitLaFile={false}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Divergences' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Échecs' })).toBeTruthy()
  })
})
```

Ajouter `import type { PendingSyncRow } from '@/services/sync/queue'` en tête si
le fichier ne l'importe pas déjà.

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run "src/app/(app)/admin/sync/SyncClient.test.tsx"`
Expected: FAIL — la file est rendue dans les trois cas.

- [ ] **Step 3: poser la prop et le gate**

Dans `src/app/(app)/admin/sync/SyncClient.tsx`, ajouter à la signature, après
`pending`, la prop :

```tsx
  /**
   * La file est de **portée instance** : elle contient les CRA de tout le monde,
   * et chaque ligne nomme son propriétaire. Un consultant n'a donc rien à y
   * lire — mais on ne la refiltre pas pour autant sur son `userId` : ce filtre
   * est exactement ce que l'arbitrage du 20 août 2026 a retiré, parce qu'un CRA
   * s'envoie par mission et non par consultant. On montre, ou on ne montre pas.
   */
  voitLaFile: boolean
```

et envelopper la carte « En attente », de son `<Card title="En attente">` à son
`</Card>` fermant, dans :

```tsx
      {props.voitLaFile && (
        …la carte « En attente », inchangée…
      )}
```

- [ ] **Step 4: déplacer la décision dans la page**

Dans `src/app/(app)/admin/sync/page.tsx`, remplacer le corps du chargement par :

```tsx
  const user = await requireUser()
  // Cet écran est le seul de `/admin/` qui reste ouvert à tous, et c'est
  // délibéré : les divergences et les échecs qu'il porte sont **ceux de la
  // session**, et les masquer laisserait un consultant devant un agenda faux
  // sans moyen de le voir. Seule la file d'instance dépend du rôle.
  const voitLaFile = peutAdministrer(user.role)

  const [connection, conflicts, failures, pending] = await Promise.all([
    getConnectionState(user.id),
    listOpenConflicts(user.id),
    listFailedSyncRows(user.id),
    // Ne pas même la lire quand on ne la montre pas : une lecture d'instance
    // faite pour quelqu'un qui n'y a pas droit reste une lecture de trop.
    voitLaFile ? listPendingSyncRows() : Promise.resolve([]),
  ])
```

et passer `voitLaFile={voitLaFile}` à `<SyncClient …/>`. Ajouter en tête :

```tsx
import { peutAdministrer } from '@/core/auth/roles'
```

- [ ] **Step 5: réserver le rejeu à l'administrateur**

Dans `src/app/(app)/admin/sync/actions.ts`, remplacer le corps de `rejouer` :

```ts
export async function rejouer(rowId: string): Promise<boolean> {
  // La ligne n'est toujours pas filtrée sur son propriétaire : la file est de
  // portée instance (arbitrage du 20 août 2026), et remettre un filtre par
  // `userId` ferait tomber les tests qui gardent cette décision. Ce qui change,
  // c'est **qui** a le droit de forcer une ligne à repartir — pousser le CRA
  // d'un autre est un acte d'administration.
  await exigerAdministration()
  const r = await retrySyncRow(rowId)
  revalidatePath('/admin/sync')
  return r
}
```

`synchroniserMaintenant` et `arbitrer` gardent `requireUser()` : elles n'agissent
que sur le compte de la session, et `src/admin-garde.test.ts` les nomme
explicitement dans `ACTIONS_PERSONNELLES`. `deconnecterGoogle` part au profil à
la tâche 8. Compléter l'import :

```ts
import { exigerAdministration, requireUser } from '@/auth'
```

- [ ] **Step 6: exécuter, et muter**

```bash
npx tsc --noEmit
npx vitest run "src/app/(app)/admin/sync" src/admin-garde.test.ts
```

Expected: PASS. Les tests existants de `page.test.tsx` qui vérifient que la page
« donne au client ce que les services rendent » attendent désormais
`voitLaFile: true` dans les props transmises, avec
`requireUser` simulé à `{ id: 'u1', role: 'ADMIN' }`.

Deux mutations, restaurées aussitôt :
1. remplacer `voitLaFile={props.voitLaFile}` par `true` dans le gate de la carte
   → le test « ne montre pas la file d'instance à un consultant » doit échouer ;
2. remplacer `exigerAdministration()` par `requireUser()` dans `rejouer` →
   `src/admin-garde.test.ts` doit échouer.

- [ ] **Step 7: commit**

```bash
git add "src/app/(app)/admin/sync"
git commit -m "feat(roles): la file d'instance ne se montre qu'a l'administrateur"
```

---

## Task 6 : la correspondance `utilisateur local ↔ utilisateur Dolibarr`

Le cœur de la spec §1. Le type de correspondance existe déjà — `LIEN_UTILISATEUR`,
posé par la reprise des temps — et n'a jamais servi qu'à l'import. Il devient le
lieu où vit `dolibarrUserId`.

**Files:**
- Create: `src/services/dolibarr/utilisateur.ts`, `src/services/dolibarr/utilisateur.test.ts`

**Interfaces:**
- Consumes: `LIEN_UTILISATEUR`, `DOLIBARR` ; `getInstanceCredential`,
  `saveInstanceCredential` de `@/services/credentials` ; `journalAvertissement`.
- Produces:
  - `identifiantDolibarrDe(userId: string): Promise<number | null>`
  - `definirIdentifiantDolibarr(userId: string, identifiant: number): Promise<{ ok: boolean; motif: string }>`
  - `oublierIdentifiantDolibarr(userId: string): Promise<void>`
  - `suggestionDInstance(): Promise<number | null>`
  - `reprendreIdentifiantDolibarrDInstance(): Promise<string | null>`

- [ ] **Step 1: écrire le test**

`src/services/dolibarr/utilisateur.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { DOLIBARR } from './api'
import { LIEN_UTILISATEUR } from './liens'
import {
  definirIdentifiantDolibarr,
  identifiantDolibarrDe,
  oublierIdentifiantDolibarr,
  reprendreIdentifiantDolibarrDInstance,
  suggestionDInstance,
} from './utilisateur'

const CLE = 'cle-de-test-dolibarr'

let ancien = ''
let recent = ''

async function decor(): Promise<void> {
  await prisma.externalLink.deleteMany({ where: { entityType: LIEN_UTILISATEUR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'portee-' } } })

  const a = await prisma.user.create({
    data: {
      email: 'portee-ancien@test.local',
      name: 'Porteur',
      passwordHash: '',
      role: 'ADMIN',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  })
  const b = await prisma.user.create({
    data: {
      email: 'portee-recent@test.local',
      name: 'Camille',
      passwordHash: '',
      role: 'CONSULTANT',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  })
  ancien = a.id
  recent = b.id
}

beforeEach(decor)

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: LIEN_UTILISATEUR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'portee-' } } })
  await prisma.$disconnect()
})

/** Une clé d'instance portant l'ancien réglage, enregistrée à une date connue. */
async function cleAvecMetadonnee(identifiant: string, connectedAt: Date): Promise<void> {
  await prisma.providerCredential.create({
    data: {
      ownerScope: 'INSTANCE',
      userId: '',
      provider: DOLIBARR,
      accessTokenEnc: CLE,
      refreshTokenEnc: '',
      metadataJson: JSON.stringify({ dolibarrUserId: identifiant }),
      connectedAt,
    },
  })
}

describe('identifiantDolibarrDe', () => {
  it("rend null quand le compte n'en a pas", async () => {
    expect(await identifiantDolibarrDe(ancien)).toBeNull()
  })

  it('rend celui qui a été défini', async () => {
    await definirIdentifiantDolibarr(ancien, 3)
    expect(await identifiantDolibarrDe(ancien)).toBe(3)
  })

  // C'est **toute** la spec : « un CRA dont le propriétaire n'a pas de
  // correspondance ne doit pas partir sous celle d'un autre ».
  it("ne rend jamais celui d'un autre compte", async () => {
    await definirIdentifiantDolibarr(ancien, 3)
    expect(await identifiantDolibarrDe(recent)).toBeNull()
  })
})

describe('definirIdentifiantDolibarr', () => {
  it('remplace le sien sans en créer un second', async () => {
    await definirIdentifiantDolibarr(ancien, 3)
    const r = await definirIdentifiantDolibarr(ancien, 7)

    expect(r.ok).toBe(true)
    expect(await identifiantDolibarrDe(ancien)).toBe(7)
    expect(
      await prisma.externalLink.count({
        where: { entityType: LIEN_UTILISATEUR, entityId: ancien, provider: DOLIBARR },
      }),
    ).toBe(1)
  })

  // Le défaut du 19 août, exactement : deux consultants sous le même `fk_user`,
  // et rien à l'écran ne le dit. Ici, quelque chose le dit.
  it("refuse un identifiant déjà pris par quelqu'un d'autre", async () => {
    await definirIdentifiantDolibarr(ancien, 3)

    const r = await definirIdentifiantDolibarr(recent, 3)

    expect(r.ok).toBe(false)
    expect(r.motif).toContain('Porteur')
    expect(await identifiantDolibarrDe(recent)).toBeNull()
  })

  it('refuse un identifiant qui n en est pas un', async () => {
    expect((await definirIdentifiantDolibarr(ancien, 0)).ok).toBe(false)
    expect((await definirIdentifiantDolibarr(ancien, -2)).ok).toBe(false)
    expect((await definirIdentifiantDolibarr(ancien, 1.5)).ok).toBe(false)
    expect(await identifiantDolibarrDe(ancien)).toBeNull()
  })
})

describe('oublierIdentifiantDolibarr', () => {
  it('rompt la correspondance du seul compte visé', async () => {
    await definirIdentifiantDolibarr(ancien, 3)
    await definirIdentifiantDolibarr(recent, 7)

    await oublierIdentifiantDolibarr(ancien)

    expect(await identifiantDolibarrDe(ancien)).toBeNull()
    expect(await identifiantDolibarrDe(recent)).toBe(7)
  })
})

describe('suggestionDInstance', () => {
  it("rend l'ancien réglage, tel qu'il vit dans les métadonnées", async () => {
    await cleAvecMetadonnee('4', new Date('2026-08-19T10:00:00.000Z'))
    expect(await suggestionDInstance()).toBe(4)
  })

  it('rend null quand aucune clé n est enregistrée', async () => {
    expect(await suggestionDInstance()).toBeNull()
  })
})

describe('reprendreIdentifiantDolibarrDInstance', () => {
  // « La migration doit le convertir en correspondance pour le compte qui l'a
  // saisi, et non l'effacer. » Personne n'a enregistré *qui* l'a saisi : la
  // règle la plus proche du vrai est le compte le plus ancien **existant avant**
  // que la clé ne soit enregistrée. Un compte né après — par la porte Google,
  // par la reprise des temps — n'a pas pu la saisir.
  it("l'attribue au plus ancien compte antérieur à la clé", async () => {
    await cleAvecMetadonnee('4', new Date('2026-08-19T10:00:00.000Z'))

    const repris = await reprendreIdentifiantDolibarrDInstance()

    expect(repris).toBe(ancien)
    expect(await identifiantDolibarrDe(ancien)).toBe(4)
    expect(await identifiantDolibarrDe(recent)).toBeNull()
  })

  it('efface la métadonnée, pour que la confusion ne se reproduise pas', async () => {
    await cleAvecMetadonnee('4', new Date('2026-08-19T10:00:00.000Z'))

    await reprendreIdentifiantDolibarrDInstance()

    expect(await suggestionDInstance()).toBeNull()
  })

  it('ne fait rien une seconde fois', async () => {
    await cleAvecMetadonnee('4', new Date('2026-08-19T10:00:00.000Z'))
    await reprendreIdentifiantDolibarrDInstance()

    expect(await reprendreIdentifiantDolibarrDInstance()).toBeNull()
    expect(await identifiantDolibarrDe(ancien)).toBe(4)
  })

  it("n'écrase jamais une correspondance déjà posée à la main", async () => {
    await definirIdentifiantDolibarr(ancien, 9)
    await cleAvecMetadonnee('4', new Date('2026-08-19T10:00:00.000Z'))

    expect(await reprendreIdentifiantDolibarrDInstance()).toBeNull()
    expect(await identifiantDolibarrDe(ancien)).toBe(9)
  })

  it('ne fait rien quand aucun compte n est antérieur à la clé', async () => {
    await cleAvecMetadonnee('4', new Date('2025-01-01T00:00:00.000Z'))

    expect(await reprendreIdentifiantDolibarrDInstance()).toBeNull()
    expect(await identifiantDolibarrDe(ancien)).toBeNull()
  })
})
```

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/services/dolibarr/utilisateur.test.ts`
Expected: FAIL, `Failed to resolve import "./utilisateur"`

- [ ] **Step 3: écrire le service**

`src/services/dolibarr/utilisateur.ts` :

```ts
/**
 * Où vit `dolibarrUserId` — et pourquoi il ne vivait pas au bon endroit.
 *
 * **Le cas réel du 19 août 2026.** La première connexion à Dolibarr a été faite
 * avec la clé de l'utilisateur technique `n8n.cds`, n° 4. Le réglage étant de
 * portée instance, *tous* les temps poussés auraient été enregistrés chez
 * Dolibarr au nom de `n8n.cds` — sur des CRA appartenant au porteur, et c'est
 * sur ces temps que la facturation se fait. Rien à l'écran ne l'aurait dit.
 *
 * Ce n'est pas une erreur de saisie : c'est un défaut de portée. La clé d'API,
 * elle, reste bien d'instance — une clé par consultant multiplierait les secrets
 * à faire tourner, et Dolibarr attribue déjà le temps par `fk_user`. C'est
 * **cet axe-là** qui est personnel, pas la clé.
 *
 * **Pourquoi un `ExternalLink` et pas une colonne de `User`.** Le type de
 * correspondance existe déjà : `LIEN_UTILISATEUR`, posé par la reprise des temps
 * pour attribuer un temps importé à son auteur. Une colonne en aurait fait un
 * second lieu de vérité, et la reprise aurait continué d'écrire dans le premier.
 */
import { prisma } from '@/db/client'
import { getInstanceCredential, saveInstanceCredential } from '@/services/credentials'
import { journalAvertissement } from '@/services/log'
import { DOLIBARR } from './api'
import { LIEN_UTILISATEUR } from './liens'

/** La clé, dans les métadonnées de l'ancienne portée d'instance. */
const CLE_METADONNEE = 'dolibarrUserId'

/** L'identifiant Dolibarr d'un compte local, `null` s'il n'en a pas. */
export async function identifiantDolibarrDe(userId: string): Promise<number | null> {
  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_UTILISATEUR,
        entityId: userId,
        provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  if (lien === null) return null

  const id = Number(lien.externalId)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Déclare l'identifiant Dolibarr d'un compte.
 *
 * **Un identifiant appartient à un seul compte local.** La contrainte d'unicité
 * de `ExternalLink` porte sur `(entityType, entityId, provider)` : elle empêche
 * qu'un compte en ait deux, pas que deux comptes aient le même. Or deux comptes
 * sous le même `fk_user`, c'est exactement le défaut du 19 août rejoué à deux —
 * et il ne se verrait pas davantage. Le refus est donc ici, et il nomme le
 * compte qui tient déjà l'identifiant.
 */
export async function definirIdentifiantDolibarr(
  userId: string,
  identifiant: number,
): Promise<{ ok: boolean; motif: string }> {
  if (!Number.isInteger(identifiant) || identifiant <= 0) {
    return {
      ok: false,
      motif:
        'L’identifiant de l’utilisateur Dolibarr est un nombre entier positif — celui de votre ' +
        'fiche utilisateur, pas votre identifiant de connexion.',
    }
  }

  const pris = await prisma.externalLink.findFirst({
    where: {
      entityType: LIEN_UTILISATEUR,
      provider: DOLIBARR,
      externalId: String(identifiant),
      entityId: { not: userId },
    },
    select: { entityId: true },
  })
  if (pris !== null) {
    const autre = await prisma.user.findUnique({
      where: { id: pris.entityId },
      select: { name: true, email: true },
    })
    const nom = autre === null ? 'un autre compte' : `${autre.name} (${autre.email})`
    return {
      ok: false,
      motif:
        `L’utilisateur Dolibarr n° ${identifiant} est déjà celui de ${nom}. ` +
        'Deux comptes sous le même utilisateur Dolibarr feraient facturer les temps de l’un au nom de l’autre.',
    }
  }

  await prisma.externalLink.upsert({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_UTILISATEUR,
        entityId: userId,
        provider: DOLIBARR,
      },
    },
    create: {
      // Posée par la personne elle-même : elle est à la fois l'auteur du lien et
      // son objet. La reprise des temps, elle, pose `userId = createur`.
      userId,
      entityType: LIEN_UTILISATEUR,
      entityId: userId,
      provider: DOLIBARR,
      externalId: String(identifiant),
      syncedAt: new Date(),
      syncState: 'SYNCED',
    },
    update: { externalId: String(identifiant), syncState: 'SYNCED' },
  })

  return { ok: true, motif: '' }
}

/**
 * Rompt la correspondance d'un compte. Rien n'est supprimé chez Dolibarr : les
 * temps déjà poussés y restent, c'est l'historique du client — même promesse que
 * `detachEntity`.
 */
export async function oublierIdentifiantDolibarr(userId: string): Promise<void> {
  await prisma.externalLink.deleteMany({
    where: { entityType: LIEN_UTILISATEUR, entityId: userId, provider: DOLIBARR },
  })
}

/**
 * L'ancien réglage d'instance, s'il traîne encore dans les métadonnées de la
 * clé. Il ne sert plus à pousser quoi que ce soit : il ne sert qu'à **proposer**
 * une valeur à l'écran « Mon profil », que la personne confirme ou corrige.
 */
export async function suggestionDInstance(): Promise<number | null> {
  const credential = await getInstanceCredential(DOLIBARR)
  const id = Number(credential?.metadata[CLE_METADONNEE] ?? '')
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * La reprise : convertit l'ancien réglage d'instance en correspondance
 * personnelle, **une seule fois**, et rend l'identifiant du compte servi.
 *
 * « La migration doit le convertir en correspondance pour le compte qui l'a
 * saisi, et non l'effacer. » Personne n'a enregistré *qui* l'a saisi — les
 * métadonnées ne portent que la valeur. La règle la plus proche du vrai est
 * donc : **le plus ancien compte existant avant l'enregistrement de la clé**.
 * Seul un administrateur atteint l'écran qui la saisit, et un compte né après
 * — par la porte Google, par la reprise des temps — n'a pas pu le faire.
 *
 * Elle n'écrase jamais une correspondance déjà posée à la main, et elle efface
 * la métadonnée en réussissant : la source de la confusion disparaît avec elle.
 *
 * **Où elle est appelée** : au moment exact où l'absence allait faire refuser un
 * push (`src/services/dolibarr/push.ts`). Pas au démarrage — l'application n'en
 * a pas —, pas au rendu d'une page — un rendu n'écrit pas. Elle est idempotente
 * et ne peut servir qu'un seul compte, celui que la règle désigne : appelée par
 * n'importe qui, elle ne donne rien à n'importe qui.
 */
export async function reprendreIdentifiantDolibarrDInstance(): Promise<string | null> {
  const credential = await getInstanceCredential(DOLIBARR)
  if (credential === null) return null

  const brut = Number(credential.metadata[CLE_METADONNEE] ?? '')
  if (!Number.isInteger(brut) || brut <= 0) return null

  const candidat = await prisma.user.findFirst({
    where: { createdAt: { lte: credential.connectedAt } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  if (candidat === null) {
    journalAvertissement('dolibarr.reprise-utilisateur', {
      raison: 'aucun-compte-anterieur-a-la-cle',
      identifiant: String(brut),
    })
    return null
  }

  if ((await identifiantDolibarrDe(candidat.id)) !== null) return null

  const pose = await definirIdentifiantDolibarr(candidat.id, brut)
  if (!pose.ok) {
    journalAvertissement('dolibarr.reprise-utilisateur', {
      raison: 'identifiant-deja-pris',
      identifiant: String(brut),
    })
    return null
  }

  // La métadonnée part : la laisser laisserait deux vérités en base, et la
  // suggestion de l'écran continuerait de proposer une valeur déjà attribuée.
  // `saveInstanceCredential` réécrit la ligne en bloc — la clé est donc relue et
  // rescellée à l'identique, ce que seule cette fonction sait faire.
  const restantes = { ...credential.metadata }
  delete restantes[CLE_METADONNEE]
  const secret = await readInstanceSecretPourReecriture()
  if (secret !== null) {
    await saveInstanceCredential({
      provider: DOLIBARR,
      secret,
      baseUrl: credential.baseUrl,
      metadata: restantes,
    })
  }

  return candidat.id
}

/**
 * Relit la clé d'API pour pouvoir la réécrire avec des métadonnées amputées.
 *
 * `saveInstanceCredential` écrit la ligne entière : sans le secret, la réécriture
 * poserait un scellé vide et **couperait Dolibarr**. Un secret illisible — clé de
 * chiffrement perdue — fait donc renoncer à l'effacement plutôt que de casser la
 * connexion : la métadonnée survit, inoffensive, et la correspondance est posée.
 */
async function readInstanceSecretPourReecriture(): Promise<string | null> {
  const { readInstanceSecret } = await import('@/services/credentials')
  return readInstanceSecret(DOLIBARR)
}
```

- [ ] **Step 4: exécuter**

Run: `npx vitest run src/services/dolibarr/utilisateur.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: muter**

Trois mutations, chacune restaurée aussitôt :
1. dans `definirIdentifiantDolibarr`, supprimer le bloc `if (pris !== null)` →
   « refuse un identifiant déjà pris » doit échouer ;
2. dans `reprendreIdentifiantDolibarrDInstance`, remplacer
   `createdAt: { lte: credential.connectedAt }` par `{}` et l'ordre par
   `{ createdAt: 'desc' }` → « l'attribue au plus ancien compte antérieur » doit
   échouer ;
3. supprimer le `if ((await identifiantDolibarrDe(candidat.id)) !== null) return null`
   → « n'écrase jamais une correspondance déjà posée à la main » doit échouer.

- [ ] **Step 6: commit**

```bash
git add src/services/dolibarr/utilisateur.ts src/services/dolibarr/utilisateur.test.ts
git commit -m "feat(dolibarr): l'identifiant utilisateur devient une correspondance personnelle"
```

---

## Task 7 : le push lit la correspondance du **propriétaire du CRA**

**Files:**
- Modify: `src/services/dolibarr/push.ts`
- Test: `src/services/dolibarr/push.test.ts`

**Interfaces:**
- Consumes: `identifiantDolibarrDe`, `reprendreIdentifiantDolibarrDInstance` (Task 6).
- Produces: rien de nouveau — `pushCraTimes` garde sa signature.

- [ ] **Step 1: écrire les tests**

À la fin de `src/services/dolibarr/push.test.ts`, dans un nouveau `describe` (le
fichier dispose déjà de son décor : `userId`, `api`, et une clé d'instance dont
les métadonnées portent `{ dolibarrUserId: '7' }`) :

```ts
describe("l'identifiant Dolibarr est celui du propriétaire du CRA", () => {
  it("pousse sous la correspondance du propriétaire, pas sous celle d'un autre", async () => {
    // Deux comptes, deux identifiants Dolibarr. Le CRA appartient au premier :
    // c'est son `fk_user` qui doit partir, et lui seul — c'est sur ces temps que
    // la facturation se fait.
    await definirIdentifiantDolibarr(userId, 3)
    const autre = await prisma.user.create({
      data: { email: 'push-autre@test.local', name: 'Autre', passwordHash: '', role: 'CONSULTANT' },
    })
    await definirIdentifiantDolibarr(autre.id, 11)

    const cra = await craValideAvecUneJournee()
    await pushCraTimes({ userId, craId: cra.id, api })

    expect(api.timespents.map((t) => t.dolibarrUserId)).toEqual([3])
  })

  // « Un CRA dont le propriétaire n'a pas de correspondance ne doit pas partir
  // sous celle d'un autre : il doit être refusé. » C'est le cœur de la spec §1.
  it('refuse un CRA dont le propriétaire n a pas de correspondance', async () => {
    const autre = await prisma.user.create({
      data: { email: 'push-seul@test.local', name: 'Seul', passwordHash: '', role: 'CONSULTANT' },
    })
    await definirIdentifiantDolibarr(autre.id, 11)

    const cra = await craValideAvecUneJournee()

    await expect(pushCraTimes({ userId, craId: cra.id, api })).rejects.toThrow(DolibarrMappingError)
    expect(api.timespents).toEqual([])
  })

  it('dit où le renseigner', async () => {
    const cra = await craValideAvecUneJournee()

    await expect(pushCraTimes({ userId, craId: cra.id, api })).rejects.toThrow(/Mon profil/)
  })

  // La reprise de l'ancien réglage d'instance : le porteur ne doit pas voir son
  // premier push refusé pour un réglage qu'il avait déjà fait.
  it("reprend l'ancien réglage d'instance plutôt que de refuser le porteur", async () => {
    // Le décor du fichier a déjà enregistré la clé avec `{ dolibarrUserId: '7' }`,
    // et `userId` est le plus ancien compte de la base de test.
    const cra = await craValideAvecUneJournee()

    await pushCraTimes({ userId, craId: cra.id, api })

    expect(api.timespents.map((t) => t.dolibarrUserId)).toEqual([7])
    expect(await identifiantDolibarrDe(userId)).toBe(7)
  })
})
```

Ajouter en tête du fichier :

```ts
import { definirIdentifiantDolibarr, identifiantDolibarrDe } from './utilisateur'
```

et, dans le `beforeEach` du fichier, après la remise à zéro existante, ajouter la
purge des correspondances d'utilisateur — sans quoi la reprise du dernier test
survivrait aux précédents :

```ts
  await prisma.externalLink.deleteMany({ where: { entityType: LIEN_UTILISATEUR } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'push-' } } })
```

avec `LIEN_UTILISATEUR` ajouté à l'import de `./liens`. `craValideAvecUneJournee()`
est l'assembleur déjà employé par les tests de push de ce fichier : réutiliser
celui qui s'y trouve, sous son nom réel, plutôt que d'en écrire un second.

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/services/dolibarr/push.test.ts`
Expected: FAIL — le push pousse `7` pour tout le monde.

- [ ] **Step 3: remplacer la lecture d'instance**

Dans `src/services/dolibarr/push.ts`, remplacer la fonction `dolibarrUserId` par :

```ts
/**
 * L'utilisateur Dolibarr sous lequel les temps de **ce CRA** seront enregistrés.
 *
 * `llx_projet_task_time` porte un `fk_user` obligatoire, et c'est sur ce champ
 * que Dolibarr attribue — donc facture — le temps. Il vient de la correspondance
 * du **propriétaire du CRA**, jamais d'un réglage global : c'était le défaut du
 * 19 août 2026, où tous les temps seraient partis au nom de l'utilisateur
 * technique dont la clé d'API avait servi à la connexion.
 *
 * **Sans correspondance, on refuse.** Retomber sur celle d'un autre — ou sur une
 * quelconque valeur par défaut — enverrait chez le client du temps attribué à
 * quelqu'un qui ne l'a pas passé. Le manque est une erreur de configuration, pas
 * une panne : rejouer n'y changerait rien, d'où la `DolibarrMappingError` que le
 * gestionnaire traduit en abandon.
 *
 * La reprise de l'ancien réglage d'instance est tentée **ici**, au moment exact
 * où son absence allait faire refuser : le porteur ne doit pas voir son premier
 * push refusé pour un réglage qu'il avait déjà fait. Elle est idempotente, et
 * elle ne peut servir que le compte que sa propre règle désigne.
 */
async function dolibarrUserIdDe(userId: string): Promise<number> {
  const direct = await identifiantDolibarrDe(userId)
  if (direct !== null) return direct

  const servi = await reprendreIdentifiantDolibarrDInstance()
  if (servi === userId) {
    const apresReprise = await identifiantDolibarrDe(userId)
    if (apresReprise !== null) return apresReprise
  }

  throw new DolibarrMappingError(
    "Aucun utilisateur Dolibarr n'est associé au propriétaire de ce CRA : " +
      "l'enregistrement d'un temps passé en exige un, et il ne peut pas partir sous celui de " +
      'quelqu’un d’autre. Renseignez-le dans Mon profil.',
  )
}
```

et, dans `pushCraTimes`, remplacer :

```ts
  const dolUser = await dolibarrUserId()
```

par :

```ts
  const dolUser = await dolibarrUserIdDe(args.userId)
```

Ajouter en tête :

```ts
import {
  identifiantDolibarrDe,
  reprendreIdentifiantDolibarrDInstance,
} from './utilisateur'
```

et retirer `getInstanceCredential` de l'import de `@/services/credentials` s'il
n'y a plus d'autre appelant dans le fichier — `isDolibarrPushArmed` l'utilise
encore, donc **le conserver**.

- [ ] **Step 4: exécuter, et muter**

Run: `npx vitest run src/services/dolibarr/push.test.ts`
Expected: PASS.

Deux mutations, restaurées aussitôt :
1. remplacer `dolibarrUserIdDe(args.userId)` par `dolibarrUserIdDe(cra.id)` → au
   moins un test doit échouer ;
2. remplacer le `throw` par `return 7` → « refuse un CRA dont le propriétaire n'a
   pas de correspondance » doit échouer.

- [ ] **Step 5: commit**

```bash
git add src/services/dolibarr/push.ts src/services/dolibarr/push.test.ts
git commit -m "fix(dolibarr): un CRA part sous l'utilisateur de son proprietaire, ou ne part pas"
```

---

## Task 8 : l'écran « Mon profil »

Ce qui appartient à la personne, rassemblé : son utilisateur Dolibarr, son agenda
Google. La carte « Connexion » **quitte** `/admin/sync` — elle n'y était que par
habitude, et l'y laisser aurait été deux lieux pour une même chose.

**Files:**
- Create: `src/app/(app)/profil/page.tsx`, `src/app/(app)/profil/actions.ts`,
  `src/app/(app)/profil/ProfilClient.tsx`, `src/app/(app)/profil/ProfilClient.test.tsx`
- Modify: `src/app/(app)/admin/sync/SyncClient.tsx`, `src/app/(app)/admin/sync/page.tsx`,
  `src/app/(app)/admin/sync/actions.ts`, `src/app/(app)/admin/sync/SyncClient.test.tsx`
- Modify: `src/app/api/google/callback/route.ts`
- Modify: `src/components/nav/NavRail.tsx`

**Interfaces:**
- Consumes: `identifiantDolibarrDe`, `definirIdentifiantDolibarr`,
  `oublierIdentifiantDolibarr`, `suggestionDInstance` (Task 6) ;
  `getConnectionState`, `disconnectGoogle`.
- Produces: la route `/profil`.

- [ ] **Step 1: écrire les actions**

`src/app/(app)/profil/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { disconnectGoogle } from '@/services/google/connect'
import {
  definirIdentifiantDolibarr,
  oublierIdentifiantDolibarr,
} from '@/services/dolibarr/utilisateur'

export type ProfilState = { ok: boolean; message: string } | null

/**
 * `requireUser()` et non `exigerAdministration()` : ce sont les réglages de la
 * personne, et un consultant doit pouvoir les poser. Le cloisonnement est
 * ailleurs — chaque fonction appelée ne touche que le compte de la session, et
 * l'identifiant visé n'est jamais lu du formulaire.
 */
export async function enregistrerIdentifiantDolibarr(
  _precedent: ProfilState,
  formData: FormData,
): Promise<ProfilState> {
  const user = await requireUser()
  const brut = String(formData.get('identifiant') ?? '').trim()

  if (brut === '') {
    await oublierIdentifiantDolibarr(user.id)
    revalidatePath('/profil')
    return {
      ok: true,
      message:
        'Correspondance rompue. Vos CRA ne partiront plus vers Dolibarr tant qu’aucun identifiant ' +
        'n’est renseigné — rien n’a été supprimé dans Dolibarr.',
    }
  }

  if (!/^\d+$/.test(brut)) {
    return {
      ok: false,
      message:
        'L’identifiant de l’utilisateur Dolibarr est un nombre — celui de votre fiche utilisateur, ' +
        'pas votre identifiant de connexion. Dans Dolibarr : Utilisateurs & groupes, ouvrez votre ' +
        'fiche, le nombre est à la fin de son adresse (…?id=3).',
    }
  }

  const r = await definirIdentifiantDolibarr(user.id, Number(brut))
  revalidatePath('/profil')
  return r.ok
    ? { ok: true, message: `Vos temps partiront sous l’utilisateur Dolibarr n° ${brut}.` }
    : { ok: false, message: r.motif }
}

/**
 * Déconnecte l'agenda de la session — au sens strict : les jetons stockés ici
 * sont effacés, rien de plus. L'autorisation accordée chez Google reste active
 * jusqu'à ce que la personne l'y retire elle-même ; l'écran le dit.
 */
export async function deconnecterGoogle(): Promise<void> {
  const user = await requireUser()
  await disconnectGoogle(user.id)
  revalidatePath('/profil')
}
```

- [ ] **Step 2: écrire le test du composant**

`src/app/(app)/profil/ProfilClient.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { enregistrerIdentifiantDolibarr, deconnecterGoogle } = vi.hoisted(() => ({
  enregistrerIdentifiantDolibarr: vi.fn(),
  deconnecterGoogle: vi.fn(),
}))
vi.mock('./actions', () => ({ enregistrerIdentifiantDolibarr, deconnecterGoogle }))

import { ProfilClient } from './ProfilClient'

const CONNECTE = { connected: true, calendarId: 'cal-1', scope: '', connectedAt: null }
const ABSENT = { connected: false, calendarId: '', scope: '', connectedAt: null }

beforeEach(() => {
  enregistrerIdentifiantDolibarr.mockReset()
  deconnecterGoogle.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('l identifiant Dolibarr', () => {
  it('montre celui de la personne quand elle en a un', () => {
    render(<ProfilClient identifiant={3} suggestion={null} connection={ABSENT} />)

    const champ = screen.getByLabelText('Identifiant utilisateur Dolibarr') as HTMLInputElement
    expect(champ.value).toBe('3')
  })

  // Le porteur avait déjà saisi cette valeur, du temps où elle était d'instance.
  // La lui redemander sans la lui montrer serait lui faire chercher un nombre
  // que l'application connaît.
  it("propose l'ancien réglage d'instance, en disant d'où il vient", () => {
    render(<ProfilClient identifiant={null} suggestion={4} connection={ABSENT} />)

    const champ = screen.getByLabelText('Identifiant utilisateur Dolibarr') as HTMLInputElement
    expect(champ.value).toBe('4')
    expect(document.body.textContent).toMatch(/réglages de l’instance/i)
  })

  // Une suggestion n'est pas un réglage : tant qu'elle n'est pas confirmée, rien
  // ne part. L'écran doit donc dire que le geste reste à faire.
  it('ne fait pas passer la suggestion pour un réglage enregistré', () => {
    render(<ProfilClient identifiant={null} suggestion={4} connection={ABSENT} />)

    expect(document.body.textContent).toMatch(/n’est pas encore enregistré/i)
  })

  it('dit quand rien n est renseigné, et ce que ça empêche', () => {
    render(<ProfilClient identifiant={null} suggestion={null} connection={ABSENT} />)

    const champ = screen.getByLabelText('Identifiant utilisateur Dolibarr') as HTMLInputElement
    expect(champ.value).toBe('')
    expect(document.body.textContent).toMatch(/ne partiront pas/i)
  })
})

describe("l'agenda Google", () => {
  it('propose de connecter quand aucun agenda ne l est', () => {
    render(<ProfilClient identifiant={null} suggestion={null} connection={ABSENT} />)

    expect(screen.getByRole('link', { name: /Connecter Google Calendar/ }).getAttribute('href')).toBe(
      '/api/google/connect',
    )
  })

  it('affiche le calendrier dédié et propose de se déconnecter', () => {
    render(<ProfilClient identifiant={null} suggestion={null} connection={CONNECTE} />)

    expect(screen.getByText('cal-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Déconnecter' })).toBeTruthy()
  })

  // `disconnectGoogle` n'appelle aucun point de révocation chez Google : sans
  // cette phrase, la personne croit avoir tout coupé alors que l'application
  // reste autorisée dans son compte Google.
  it("dit que l'autorisation reste active côté Google", async () => {
    render(<ProfilClient identifiant={null} suggestion={null} connection={CONNECTE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Déconnecter' }))

    expect(document.body.textContent).toMatch(/reste autorisée/i)
  })
})
```

- [ ] **Step 3: exécuter, et constater l'échec**

Run: `npx vitest run "src/app/(app)/profil/ProfilClient.test.tsx"`
Expected: FAIL, `Failed to resolve import "./ProfilClient"`

- [ ] **Step 4: écrire le composant et la page**

`src/app/(app)/profil/ProfilClient.tsx` :

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import {
  deconnecterGoogle,
  enregistrerIdentifiantDolibarr,
  type ProfilState,
} from './actions'

/**
 * Ce qui appartient à la personne, et à elle seule.
 *
 * Deux réglages y vivent, et ils ont la même nature : ils désignent **qui** est
 * cette personne chez un fournisseur. L'agenda Google l'était déjà ; l'utilisateur
 * Dolibarr ne l'était pas, et c'est ce défaut de portée qui aurait fait facturer
 * les temps du porteur au nom d'un utilisateur technique.
 *
 * La clé d'API Dolibarr et le client OAuth Google, eux, restent en
 * administration : ce sont des secrets d'instance, saisis une fois pour tous.
 */
export function ProfilClient({
  identifiant,
  suggestion,
  connection,
}: {
  /** l'identifiant Dolibarr **enregistré** pour ce compte, `null` s'il n'en a pas */
  identifiant: number | null
  /** l'ancien réglage d'instance, proposé mais **pas** enregistré */
  suggestion: number | null
  connection: { connected: boolean; calendarId: string; scope: string; connectedAt: Date | null }
}) {
  const [etat, formAction, enCours] = useActionState<ProfilState, FormData>(
    enregistrerIdentifiantDolibarr,
    null,
  )
  const [avis, setAvis] = useState<string | null>(null)

  const propose = identifiant === null && suggestion !== null

  return (
    <>
      <Card title="Mon utilisateur Dolibarr">
        <p className="mb-3 text-sm text-muted">
          Les temps de vos CRA sont enregistrés dans Dolibarr <strong>sous cet utilisateur</strong>,
          et c’est sur eux que la facturation se fait. Il vous appartient : celui d’un collègue
          attribuerait vos journées à quelqu’un d’autre.
        </p>

        {identifiant === null && !propose && (
          <div className="mb-3">
            <Banner tone="warning" title="Aucun utilisateur Dolibarr renseigné">
              <p>
                Vos CRA validés <strong>ne partiront pas</strong> vers Dolibarr tant que ce champ est
                vide. Le reste de l’application fonctionne normalement.
              </p>
            </Banner>
          </div>
        )}

        {propose && (
          <div className="mb-3">
            <Banner tone="info" title="Une valeur vous est proposée">
              <p>
                L’identifiant n° {suggestion} vient des réglages de l’instance, où il était saisi
                pour tout le monde. Il <strong>n’est pas encore enregistré</strong> pour votre
                compte : vérifiez que c’est bien le vôtre, puis enregistrez.
              </p>
            </Banner>
          </div>
        )}

        {etat !== null && (
          <div className="mb-3">
            <Banner tone={etat.ok ? 'success' : 'danger'}>{etat.message}</Banner>
          </div>
        )}

        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <Field
            label="Identifiant utilisateur Dolibarr"
            name="identifiant"
            defaultValue={identifiant !== null ? String(identifiant) : (suggestion ?? '')}
            inputMode="numeric"
            hint="Un nombre, pas votre identifiant de connexion : celui de votre fiche dans Dolibarr (…?id=3). Vider le champ rompt la correspondance."
            className="w-56"
          />
          <Button type="submit" variant="primary" loading={enCours}>
            Enregistrer
          </Button>
        </form>
      </Card>

      <Card title="Mon agenda Google" className="mt-6">
        {avis !== null && (
          <div className="mb-3">
            <Banner tone="info">{avis}</Banner>
          </div>
        )}

        {connection.connected ? (
          <div className="flex flex-col items-start gap-3 text-sm">
            <p>
              Connecté. Calendrier dédié : <code>{connection.calendarId}</code>
            </p>
            <Button
              onClick={() => {
                void deconnecterGoogle().then(() =>
                  setAvis(
                    'Agenda déconnecté ici. L’application reste autorisée dans votre compte Google : ' +
                      'retirez-la depuis les autorisations de votre compte si vous le souhaitez. Les blocs ' +
                      'déjà posés restent dans le calendrier dédié.',
                  ),
                )
              }}
            >
              Déconnecter
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 text-sm">
            <p className="text-muted">
              Aucun agenda connecté. La saisie fonctionne normalement ; rien n’est poussé.
            </p>
            <a
              href="/api/google/connect"
              className="touch-target inline-flex items-center rounded-md border border-rule px-4 text-sm font-medium text-link hover:bg-off"
            >
              Connecter Google Calendar
            </a>
          </div>
        )}
      </Card>
    </>
  )
}
```

`src/app/(app)/profil/page.tsx` :

```tsx
import { requireUser } from '@/auth'
import { PageShell } from '@/components/ui/PageShell'
import { Banner } from '@/components/ui/Banner'
import { getConnectionState } from '@/services/google/connect'
import { identifiantDolibarrDe, suggestionDInstance } from '@/services/dolibarr/utilisateur'
import { ProfilClient } from './ProfilClient'

/**
 * L'écran qu'un `CONSULTANT` a le droit d'ouvrir — et le seul de ce lot.
 *
 * `requireUser()` et non `accesAdministration()` : tout ce qu'il porte est de
 * portée utilisateur, et les services appelés ne lisent que le compte de la
 * session. Il vit hors de `/admin/` pour cette raison, et pour que le contrôle
 * structurel de `src/admin-garde.test.ts` ne le prenne pas pour un écran
 * d'administration mal gardé.
 */
export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; tone?: string }>
}) {
  const user = await requireUser()
  const { message, tone } = await searchParams
  // Rien ne se fait passer pour une réussite : une tonalité absente ou forgée
  // retombe sur l'avertissement.
  const toneMessage = tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'warning'

  const [identifiant, suggestion, connection] = await Promise.all([
    identifiantDolibarrDe(user.id),
    suggestionDInstance(),
    getConnectionState(user.id),
  ])

  return (
    <PageShell title="Mon profil">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}
      <ProfilClient
        identifiant={identifiant}
        suggestion={suggestion}
        connection={connection}
      />
    </PageShell>
  )
}
```

- [ ] **Step 5: retirer la carte « Connexion » de `/admin/sync`**

Dans `src/app/(app)/admin/sync/SyncClient.tsx` :

- supprimer la prop `connection` de la signature ;
- supprimer le bloc `<Card title="Connexion">…</Card>` en entier ;
- supprimer la fonction `onDeconnecter` et l'import de `deconnecterGoogle`.

Dans `src/app/(app)/admin/sync/page.tsx`, retirer `getConnectionState(user.id)`
du `Promise.all`, la variable `connection` et la prop du même nom, ainsi que
l'import `import { getConnectionState } from '@/services/google/connect'`.

Dans `src/app/(app)/admin/sync/actions.ts`, supprimer `deconnecterGoogle` et
l'import `disconnectGoogle` : elle vit désormais dans `/profil/actions.ts`. La
retirer aussi de `ACTIONS_PERSONNELLES` dans `src/admin-garde.test.ts` si elle y
figurait — la liste finale n'y garde que `synchroniserMaintenant` et `arbitrer`.

Dans `src/app/(app)/admin/sync/SyncClient.test.tsx`, supprimer les deux `describe`
« état de la connexion » et « déconnexion Google » : leur objet a migré dans
`ProfilClient.test.tsx`, où les mêmes garanties sont reprises. Retirer la prop
`connection` de l'assembleur de props du fichier.

- [ ] **Step 6: faire revenir Google au bon endroit**

Dans `src/app/api/google/callback/route.ts`, remplacer la construction de l'URL
de retour :

```ts
  // Le retour va désormais à « Mon profil » : c'est là que l'agenda se connecte
  // et se déconnecte depuis que les portées sont séparées. `/admin/sync` est
  // réservé à ce qui est d'instance, et un consultant n'y verrait rien.
  const url = new URL('/profil', request.url)
```

- [ ] **Step 7: ajouter l'entrée de navigation**

Dans `src/components/nav/NavRail.tsx`, ajouter en **tête** de la liste `REGLAGES` :

```tsx
  { href: '/profil', label: 'Mon profil' },
```

Le commentaire de la liste dit « les sept écrans de réglage » alors qu'elle en
porte huit ; le corriger en « les écrans de réglage, et l'écran de profil : la
liste **s'étend**, elle ne se remplace pas ».

- [ ] **Step 8: exécuter**

```bash
npx tsc --noEmit
npx vitest run "src/app/(app)/profil" "src/app/(app)/admin/sync" src/components/nav src/app/\(app\)/layout.test.tsx
```

Expected: PASS.

- [ ] **Step 9: muter**

Dans `ProfilClient.tsx`, remplacer `const propose = identifiant === null && suggestion !== null`
par `const propose = suggestion !== null` : le test « montre celui de la personne
quand elle en a un » ne bronchera pas, mais « ne fait pas passer la suggestion
pour un réglage enregistré » cessera de garder quoi que ce soit — vérifier alors
qu'un `identifiant={3} suggestion={4}` afficherait les deux, puis restaurer.
Mutation qui mord vraiment : supprimer `defaultValue` du champ → deux tests
doivent échouer.

- [ ] **Step 10: commit**

```bash
git add "src/app/(app)/profil" "src/app/(app)/admin/sync" src/app/api/google/callback/route.ts src/components/nav/NavRail.tsx src/admin-garde.test.ts
git commit -m "feat(profil): l'ecran qui porte ce qui appartient a la personne"
```

---

## Task 9 : le champ quitte Administration · Dolibarr

Tant que le champ reste là, deux lieux règlent la même chose et le second gagne
en silence.

**Files:**
- Modify: `src/app/(app)/admin/dolibarr/ConnexionForm.tsx`,
  `src/app/(app)/admin/dolibarr/ConnexionForm.test.tsx`,
  `src/app/(app)/admin/dolibarr/actions.ts`, `src/app/(app)/admin/dolibarr/actions.test.ts`,
  `src/app/(app)/admin/dolibarr/page.tsx`, `src/app/(app)/admin/dolibarr/page.test.tsx`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `ConnexionForm` perd la prop `dolibarrUserId`.

- [ ] **Step 1: écrire le test de l'absence**

Dans `src/app/(app)/admin/dolibarr/ConnexionForm.test.tsx`, remplacer le test qui
vérifie l'envoi des trois champs par celui-ci, et ajouter le second :

```tsx
  it('envoie l’URL et la clé, et rien d’autre', async () => {
    rendre({ instanceUrl: '', connecte: false, connectedAt: null })

    await userEvent.type(screen.getByLabelText("URL de l'instance Dolibarr"), INSTANCE_FICTIVE)
    await userEvent.type(screen.getByLabelText("Clé d'API"), 'cle-de-test')
    await userEvent.click(screen.getByRole('button', { name: 'Connecter' }))

    const fd = connecterDolibarr.mock.calls[0]![1] as FormData
    expect({ instanceUrl: fd.get('instanceUrl'), apiKey: fd.get('apiKey') }).toEqual({
      instanceUrl: INSTANCE_FICTIVE,
      apiKey: 'cle-de-test',
    })
    expect(fd.get('dolibarrUserId')).toBeNull()
  })

  // Deux lieux pour un même réglage, et c'est le second qui gagne en silence :
  // l'identifiant est personnel depuis que le push lit celui du propriétaire du
  // CRA. Le laisser ici le ferait ressaisir pour tout le monde.
  it('ne demande plus l’identifiant utilisateur, qui est personnel', () => {
    rendre({ instanceUrl: '', connecte: true, connectedAt: null })

    expect(screen.queryByLabelText('Identifiant utilisateur Dolibarr')).toBeNull()
    expect(document.body.textContent).toMatch(/Mon profil/)
  })
```

Retirer `dolibarrUserId` de l'assembleur `rendre` du fichier.

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run "src/app/(app)/admin/dolibarr/ConnexionForm.test.tsx"`
Expected: FAIL — le champ est toujours là.

- [ ] **Step 3: retirer le champ**

Dans `src/app/(app)/admin/dolibarr/ConnexionForm.tsx` :

- supprimer `dolibarrUserId` de la déstructuration et du type des props ;
- supprimer le `<Field label="Identifiant utilisateur Dolibarr" …/>` en entier ;
- ajouter, sous le formulaire, le renvoi :

```tsx
      <p className="mt-3 text-sm text-muted">
        L’identifiant de <em>votre</em> utilisateur Dolibarr n’est plus ici : il est personnel, et
        il se renseigne dans <strong>Mon profil</strong>. C’est sous lui que vos temps sont
        enregistrés chez Dolibarr, et deux consultants ne peuvent pas partager le même.
      </p>
```

- [ ] **Step 4: retirer la lecture et la validation**

Dans `src/app/(app)/admin/dolibarr/actions.ts`, fonction `connecterDolibarr` :

- supprimer la ligne `const dolibarrUserId = String(formData.get('dolibarrUserId') ?? '').trim()` ;
- supprimer le bloc `if (!/^\d+$/.test(dolibarrUserId)) { … }` en entier ;
- remplacer l'appel d'enregistrement par :

```ts
  await saveInstanceCredential({
    provider: DOLIBARR,
    secret: apiKey,
    baseUrl,
    // Aucune métadonnée : `dolibarrUserId` était le seul contenu de cet objet, et
    // il est devenu personnel. Le laisser ici en ferait un second lieu de vérité,
    // que le push ne lit plus — donc un réglage qui ne règle rien.
    metadata: {},
  })
```

Dans `src/app/(app)/admin/dolibarr/page.tsx`, retirer la prop
`dolibarrUserId={credential?.metadata.dolibarrUserId ?? ''}` de `<ConnexionForm/>`.

- [ ] **Step 5: mettre à jour les tests d'action et de page**

Dans `src/app/(app)/admin/dolibarr/actions.test.ts` :

- retirer `dolibarrUserId` de l'assembleur `formulaireConnexion` ;
- supprimer les deux tests qui exigeaient un identifiant numérique
  (`formulaireConnexion({ instanceUrl: '', apiKey: '', dolibarrUserId: 'moi' })` et
  `formulaireConnexion({ dolibarrUserId: 'keveen' })`) : ce que la règle gardait est
  gardé désormais par `definirIdentifiantDolibarr` et son test ;
- remplacer l'attente `metadata: { dolibarrUserId: '7' }` par `metadata: {}`.

Dans `src/app/(app)/admin/dolibarr/page.test.tsx`, retirer les attentes portant
sur `dolibarrUserId` dans les props de `ConnexionForm`, et remplacer le décor
`metadata: { dolibarrUserId: '7' }` par `metadata: {}`.

- [ ] **Step 6: exécuter**

```bash
npx tsc --noEmit
npx vitest run "src/app/(app)/admin/dolibarr" src/services/dolibarr
```

Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add "src/app/(app)/admin/dolibarr"
git commit -m "feat(dolibarr): l'identifiant utilisateur quitte les reglages d'instance"
```

---

## Task 10 : le drapeau de désactivation

Honore la dette nommée par `docs/superpowers/plans/2026-08-22-double-authentification.md`,
Task 11 : « couper un accès oblige à supprimer le compte, ce qui détruit ses
saisies ».

**Files:**
- Modify: `prisma/schema.prisma`, `src/auth.ts`
- Create: `prisma/migrations/20260826000000_compte_desactive/migration.sql`
- Create: `prisma/migrations-sqlite/20260826000000_compte_desactive/migration.sql`
- Test: `src/auth.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `User.disabled: Boolean @default(false)`, et le refus de session qui
  va avec.

- [ ] **Step 1: ajouter la colonne au schéma**

Dans `prisma/schema.prisma`, modèle `User`, après `role` :

```prisma
  /// Accès coupé, sans rien détruire. La seule autre façon de fermer une porte
  /// était de supprimer le compte — ce qui emporte ses saisies, ses CRA et
  /// l'attribution de tout ce qui a été poussé chez Dolibarr.
  disabled     Boolean  @default(false)
```

- [ ] **Step 2: écrire les deux migrations**

`prisma/migrations/20260826000000_compte_desactive/migration.sql` :

```sql
-- Couper un accès sans rien détruire.
-- Jusqu'ici, fermer une porte obligeait à supprimer le compte : ses saisies,
-- ses CRA et l'attribution de tout ce qui a été poussé chez Dolibarr partaient
-- avec. Le drapeau sépare les deux gestes — la session d'un compte désactivé
-- est refusée à la lecture, et rien de son histoire ne bouge.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabled" BOOLEAN NOT NULL DEFAULT false;
```

`prisma/migrations-sqlite/20260826000000_compte_desactive/migration.sql` :

```sql
-- Couper un accès sans rien détruire.
-- Jusqu'ici, fermer une porte obligeait à supprimer le compte : ses saisies,
-- ses CRA et l'attribution de tout ce qui a été poussé chez Dolibarr partaient
-- avec. Le drapeau sépare les deux gestes.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: appliquer et vérifier les deux jeux**

```bash
npx prisma db push --skip-generate && npx prisma generate
npx vitest run src/db/schema-migration-sync.test.ts src/distribution/migrations-sqlite.test.ts
```

Expected: PASS.

- [ ] **Step 4: écrire le test du refus de session**

À la fin de `src/auth.test.ts` :

```ts
describe('un compte désactivé n a plus de session', () => {
  // Un jeton signé survit à la désactivation : il ne prouve que sa propre
  // signature. Sans cette relecture, couper un accès ne couperait rien avant
  // l'expiration du jeton — c'est-à-dire trente jours, par défaut.
  it('refuse la session d un compte désactivé', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'desactive@test.local',
        name: 'Coupé',
        passwordHash: '',
        role: 'CONSULTANT',
        disabled: true,
      },
    })
    auth.mockResolvedValue({ user: { id: u.id } })

    await expect(requireUser()).rejects.toThrow('Non authentifié')

    await prisma.user.delete({ where: { id: u.id } })
  })

  it('laisse entrer un compte actif', async () => {
    const u = await prisma.user.create({
      data: { email: 'actif@test.local', name: 'Actif', passwordHash: '', role: 'CONSULTANT' },
    })
    auth.mockResolvedValue({ user: { id: u.id } })

    await expect(requireUser()).resolves.toEqual({ id: u.id, role: 'CONSULTANT' })

    await prisma.user.delete({ where: { id: u.id } })
  })
})
```

Si `src/auth.test.ts` n'existe pas, le créer avec l'en-tête suivant, qui simule le
seul appel non déterministe — la session d'Auth.js :

```ts
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/db/client'

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, auth, signIn: vi.fn(), signOut: vi.fn() }),
}))

import { requireUser } from './auth'
```

- [ ] **Step 5: exécuter, et constater l'échec**

Run: `npx vitest run src/auth.test.ts`
Expected: FAIL — la session d'un compte désactivé est acceptée.

- [ ] **Step 6: refuser la session**

Dans `src/auth.ts`, remplacer `loadSessionUser` et la fin de `requireUser` :

```ts
const loadSessionUser = cache(async (id: string) =>
  prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, disabled: true },
  }),
)
```

et, dans `requireUser`, après `if (user === null) throw new Error('Non authentifié')` :

```ts
  // Un jeton signé survit à la désactivation : il ne prouve que sa propre
  // signature, pas que son porteur ait encore le droit d'entrer. Le drapeau est
  // donc relu à chaque requête, comme le rôle — couper un accès coupe la
  // session en cours, et pas seulement les suivantes.
  //
  // Le message est **identique** à celui d'un compte absent : distinguer les
  // deux apprendrait à un compte coupé qu'il existe encore, et à qui teste des
  // identifiants qu'une adresse est connue.
  if (user.disabled) throw new Error('Non authentifié')
```

Compléter le commentaire d'en-tête de `requireUser` : « Le rôle **et le drapeau
de désactivation** sont relus en base, le jeton pouvant porter l'un comme l'autre
périmés. »

- [ ] **Step 7: exécuter, et muter**

```bash
npx tsc --noEmit
npx vitest run src/auth.test.ts
```

Expected: PASS. Puis supprimer `if (user.disabled) throw` : « refuse la session
d'un compte désactivé » doit **échouer**. Restaurer.

- [ ] **Step 8: commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/migrations-sqlite src/auth.ts src/auth.test.ts
git commit -m "feat(comptes): couper un acces sans detruire les saisies"
```

---

## Task 11 : l'écran « Comptes »

Sans lui, les rôles ne s'administrent pas : la porte Google crée des
`CONSULTANT`, la reprise Dolibarr aussi, et rien ne permet d'en élever un.

**Files:**
- Create: `src/services/roles.ts`, `src/services/roles.test.ts`
- Create: `src/app/(app)/admin/comptes/page.tsx`, `src/app/(app)/admin/comptes/actions.ts`,
  `src/app/(app)/admin/comptes/GestionComptes.tsx`
- Modify: `src/components/nav/NavRail.tsx`

**Interfaces:**
- Consumes: `estRole`, `peutAdministrer` (Task 1) ; `identifiantDolibarrDe` (Task 6).
- Produces:
  - `listerComptes(): Promise<CompteVue[]>`
  - `definirRole(args: { userId: string; role: Role; parId: string }): Promise<{ ok: boolean; motif: string }>`
  - `definirActivation(args: { userId: string; actif: boolean; parId: string }): Promise<{ ok: boolean; motif: string }>`

- [ ] **Step 1: écrire le test du service**

`src/services/roles.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { definirActivation, definirRole, listerComptes } from './roles'

let patron = ''
let second = ''
let simple = ''

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'roles-' } } })
  const a = await prisma.user.create({
    data: { email: 'roles-patron@test.local', name: 'Patron', passwordHash: '', role: 'ADMIN' },
  })
  const b = await prisma.user.create({
    data: { email: 'roles-second@test.local', name: 'Second', passwordHash: '', role: 'ADMIN' },
  })
  const c = await prisma.user.create({
    data: { email: 'roles-simple@test.local', name: 'Simple', passwordHash: '', role: 'CONSULTANT' },
  })
  patron = a.id
  second = b.id
  simple = c.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'roles-' } } })
  await prisma.$disconnect()
})

describe('listerComptes', () => {
  it('rend les comptes avec leur rôle et leur activation', async () => {
    const comptes = await listerComptes()
    const vue = comptes.find((c) => c.id === simple)

    expect(vue).toMatchObject({ name: 'Simple', role: 'CONSULTANT', disabled: false })
  })

  // L'écran ne montre que ce qu'un administrateur a besoin de voir. L'empreinte
  // de mot de passe n'en fait pas partie, et une vue qui la porterait finirait
  // par la peindre.
  it('ne rend aucune empreinte de mot de passe', async () => {
    const comptes = await listerComptes()
    expect(JSON.stringify(comptes)).not.toContain('passwordHash')
  })
})

describe('definirRole', () => {
  it('élève un consultant', async () => {
    const r = await definirRole({ userId: simple, role: 'ADMIN', parId: patron })

    expect(r.ok).toBe(true)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: simple } })).role).toBe('ADMIN')
  })

  // Se retirer soi-même le rôle est le geste qui mure l'instance : plus personne
  // pour le rendre, et aucun écran pour rouvrir.
  it('refuse de se retirer son propre rôle', async () => {
    const r = await definirRole({ userId: patron, role: 'CONSULTANT', parId: patron })

    expect(r.ok).toBe(false)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: patron } })).role).toBe('ADMIN')
  })

  it('accepte de rétrograder un autre administrateur, tant qu il en reste un', async () => {
    const r = await definirRole({ userId: second, role: 'CONSULTANT', parId: patron })

    expect(r.ok).toBe(true)
  })

  it('refuse de retirer le dernier administrateur', async () => {
    await definirRole({ userId: second, role: 'CONSULTANT', parId: patron })
    // `patron` est désormais seul. Il ne peut pas non plus être rétrogradé par
    // lui-même — mais la règle vaut aussi de la part d'un autre.
    const r = await definirRole({ userId: patron, role: 'CONSULTANT', parId: second })

    expect(r.ok).toBe(false)
    expect(r.motif).toMatch(/dernier administrateur/i)
  })

  it('refuse un rôle inventé', async () => {
    const r = await definirRole({
      userId: simple,
      role: 'ROOT' as unknown as 'ADMIN',
      parId: patron,
    })

    expect(r.ok).toBe(false)
  })
})

describe('definirActivation', () => {
  it('coupe un accès sans rien détruire', async () => {
    const r = await definirActivation({ userId: simple, actif: false, parId: patron })

    expect(r.ok).toBe(true)
    const apres = await prisma.user.findUniqueOrThrow({ where: { id: simple } })
    expect(apres.disabled).toBe(true)
    expect(apres.email).toBe('roles-simple@test.local')
  })

  it('rouvre un accès coupé', async () => {
    await definirActivation({ userId: simple, actif: false, parId: patron })
    await definirActivation({ userId: simple, actif: true, parId: patron })

    expect((await prisma.user.findUniqueOrThrow({ where: { id: simple } })).disabled).toBe(false)
  })

  // Se désactiver soi-même, c'est se mettre dehors et jeter la clé.
  it('refuse de se désactiver soi-même', async () => {
    const r = await definirActivation({ userId: patron, actif: false, parId: patron })

    expect(r.ok).toBe(false)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: patron } })).disabled).toBe(false)
  })

  it('refuse de désactiver le dernier administrateur', async () => {
    await definirRole({ userId: second, role: 'CONSULTANT', parId: patron })

    const r = await definirActivation({ userId: patron, actif: false, parId: second })

    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/services/roles.test.ts`
Expected: FAIL, `Failed to resolve import "./roles"`

- [ ] **Step 3: écrire le service**

`src/services/roles.ts` :

```ts
/**
 * Donner un rôle, couper un accès.
 *
 * **Pourquoi cet écran existe.** La porte Google crée des comptes au rôle le
 * moins doté, la reprise des temps Dolibarr aussi. Sans un endroit où élever
 * l'un d'eux, un `CONSULTANT` le reste pour toujours, et la première personne
 * qui rejoint l'installation ne peut jamais administrer quoi que ce soit.
 *
 * **Deux règles gardent l'instance de se murer** : on ne se retire pas son
 * propre rôle, et on ne retire pas le dernier administrateur. Sans elles, un
 * seul clic ferme définitivement l'administration — il n'existe aucun écran pour
 * la rouvrir, et l'écran de premier démarrage ne se rouvre que sur une base sans
 * aucun compte.
 *
 * **Désactiver n'est pas supprimer.** Un compte porte des saisies, des CRA et
 * l'attribution de tout ce qui a été poussé chez Dolibarr : le supprimer pour
 * fermer une porte détruirait cet historique. Le drapeau ferme la porte et ne
 * touche à rien.
 */
import { prisma } from '@/db/client'
import { estRole } from '@/core/auth/roles'
import type { Role } from '@/core/types'
import { identifiantDolibarrDe } from '@/services/dolibarr/utilisateur'

/** Ce que l'écran des comptes montre — et rien de plus. */
export interface CompteVue {
  id: string
  name: string
  email: string
  role: Role
  disabled: boolean
  createdAt: Date
  /** son utilisateur Dolibarr, pour voir d'un coup d'œil qui n'en a pas */
  identifiantDolibarr: number | null
}

export async function listerComptes(): Promise<CompteVue[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ disabled: 'asc' }, { createdAt: 'asc' }],
    // Jamais `passwordHash` : une vue qui le porte finit par le peindre.
    select: { id: true, name: true, email: true, role: true, disabled: true, createdAt: true },
  })

  const vues: CompteVue[] = []
  for (const u of users) {
    vues.push({
      ...u,
      role: (estRole(u.role) ? u.role : 'CONSULTANT') as Role,
      identifiantDolibarr: await identifiantDolibarrDe(u.id),
    })
  }
  return vues
}

/** Combien d'administrateurs **actifs** l'instance compte, en dehors d'un compte donné. */
async function autresAdministrateurs(sauf: string): Promise<number> {
  return prisma.user.count({ where: { role: 'ADMIN', disabled: false, id: { not: sauf } } })
}

export async function definirRole(args: {
  userId: string
  role: Role
  parId: string
}): Promise<{ ok: boolean; motif: string }> {
  if (!estRole(args.role)) {
    return { ok: false, motif: 'Ce rôle n’existe pas.' }
  }

  const cible = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { role: true },
  })
  if (cible === null) return { ok: false, motif: 'Ce compte n’existe plus.' }

  const perdLAdministration = cible.role === 'ADMIN' && args.role !== 'ADMIN'

  if (perdLAdministration && args.userId === args.parId) {
    return {
      ok: false,
      motif:
        'Vous ne pouvez pas vous retirer votre propre rôle d’administrateur. Demandez à un autre ' +
        'administrateur de le faire.',
    }
  }

  if (perdLAdministration && (await autresAdministrateurs(args.userId)) === 0) {
    return {
      ok: false,
      motif:
        'Ce compte est le dernier administrateur actif : le rétrograder fermerait l’administration ' +
        'de cette installation, et aucun écran ne permettrait de la rouvrir.',
    }
  }

  await prisma.user.update({ where: { id: args.userId }, data: { role: args.role } })
  return { ok: true, motif: '' }
}

export async function definirActivation(args: {
  userId: string
  actif: boolean
  parId: string
}): Promise<{ ok: boolean; motif: string }> {
  const cible = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { role: true },
  })
  if (cible === null) return { ok: false, motif: 'Ce compte n’existe plus.' }

  if (!args.actif && args.userId === args.parId) {
    return {
      ok: false,
      motif: 'Vous ne pouvez pas désactiver votre propre compte : vous seriez aussitôt déconnecté.',
    }
  }

  if (!args.actif && cible.role === 'ADMIN' && (await autresAdministrateurs(args.userId)) === 0) {
    return {
      ok: false,
      motif:
        'Ce compte est le dernier administrateur actif : le désactiver fermerait l’administration ' +
        'de cette installation.',
    }
  }

  await prisma.user.update({ where: { id: args.userId }, data: { disabled: !args.actif } })
  return { ok: true, motif: '' }
}
```

- [ ] **Step 4: exécuter, et muter**

Run: `npx vitest run src/services/roles.test.ts`
Expected: PASS (11 tests)

Deux mutations, restaurées aussitôt :
1. supprimer le bloc `if (perdLAdministration && args.userId === args.parId)` →
   « refuse de se retirer son propre rôle » doit échouer ;
2. remplacer `autresAdministrateurs` par `async () => 1` → deux tests doivent
   échouer.

- [ ] **Step 5: écrire les actions et l'écran**

`src/app/(app)/admin/comptes/actions.ts` :

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { exigerAdministration } from '@/auth'
import { definirActivation, definirRole } from '@/services/roles'
import type { Role } from '@/core/types'

export type ComptesState = { ok: boolean; message: string } | null

export async function changerRole(userId: string, role: Role): Promise<ComptesState> {
  const moi = await exigerAdministration()
  const r = await definirRole({ userId, role, parId: moi.id })
  revalidatePath('/admin/comptes')
  return r.ok ? { ok: true, message: `Rôle changé en ${role}.` } : { ok: false, message: r.motif }
}

export async function changerActivation(userId: string, actif: boolean): Promise<ComptesState> {
  const moi = await exigerAdministration()
  const r = await definirActivation({ userId, actif, parId: moi.id })
  revalidatePath('/admin/comptes')
  return r.ok
    ? {
        ok: true,
        message: actif
          ? 'Accès rouvert.'
          : 'Accès coupé. Rien n’a été supprimé : ses saisies, ses CRA et l’attribution de ses temps restent.',
      }
    : { ok: false, message: r.motif }
}
```

`src/app/(app)/admin/comptes/GestionComptes.tsx` :

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { changerActivation, changerRole, type ComptesState } from './actions'
import type { Role } from '@/core/types'
import type { CompteVue } from '@/services/roles'

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'CONSULTANT']

/**
 * Qui entre, et ce qu'il peut.
 *
 * L'état de chaque compte est dit **en toutes lettres** — « actif », « accès
 * coupé », le rôle dans un menu déroulant — et jamais par la seule teinte d'une
 * ligne : un fond grisé ne se lit pas en niveaux de gris, et ne s'annonce à
 * aucun lecteur d'écran.
 */
export function GestionComptes({ comptes }: { comptes: CompteVue[] }) {
  const [etat, setEtat] = useState<ComptesState>(null)
  const [enCours, demarrer] = useTransition()

  function agir(action: () => Promise<ComptesState>) {
    demarrer(async () => setEtat(await action()))
  }

  return (
    <>
      {etat !== null && (
        <div className="mb-4">
          <Banner tone={etat.ok ? 'success' : 'danger'}>{etat.message}</Banner>
        </div>
      )}

      <Card title="Comptes">
        <p className="mb-3 text-sm text-muted">
          Un compte créé sans qu’un humain décide de son rôle est <strong>consultant</strong> :
          c’est le cas de ceux que la connexion Google ouvre, et de ceux que la reprise des temps
          Dolibarr crée pour porter l’attribution. C’est ici qu’on l’élève.
        </p>
        <ul className="text-sm">
          {comptes.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-end gap-3 border-b border-rule py-2 last:border-0"
            >
              <span className="flex-1">
                {c.name} <span className="text-muted">· {c.email}</span>
              </span>
              <span className="text-muted">{c.disabled ? 'Accès coupé' : 'Actif'}</span>
              <span className="text-muted">
                {c.identifiantDolibarr === null
                  ? 'Dolibarr : aucun'
                  : `Dolibarr n° ${c.identifiantDolibarr}`}
              </span>
              <Select
                label={`Rôle de ${c.name}`}
                name={`role-${c.id}`}
                defaultValue={c.role}
                disabled={enCours}
                onChange={(e) => agir(() => changerRole(c.id, e.target.value as Role))}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant={c.disabled ? 'secondary' : 'danger'}
                disabled={enCours}
                onClick={() => agir(() => changerActivation(c.id, c.disabled))}
              >
                {c.disabled ? 'Rouvrir l’accès' : 'Couper l’accès'}
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          Couper un accès ne détruit rien : les saisies, les CRA et l’attribution de tout ce qui a
          été poussé chez Dolibarr restent. C’est la raison d’être de ce geste — supprimer un compte
          les emporterait.
        </p>
      </Card>
    </>
  )
}
```

`src/app/(app)/admin/comptes/page.tsx` :

```tsx
import { accesAdministration } from '@/auth'
import { AccesRefuse } from '@/components/ui/AccesRefuse'
import { PageShell } from '@/components/ui/PageShell'
import { listerComptes } from '@/services/roles'
import { GestionComptes } from './GestionComptes'

export default async function AdminComptesPage() {
  const { autorise, user } = await accesAdministration()
  if (!autorise) return <AccesRefuse role={user.role} />

  const comptes = await listerComptes()

  return (
    <PageShell title="Administration · Comptes">
      <GestionComptes comptes={comptes} />
    </PageShell>
  )
}
```

- [ ] **Step 6: ajouter l'entrée de navigation**

Dans `src/components/nav/NavRail.tsx`, ajouter à la fin de la liste `REGLAGES` :

```tsx
  { href: '/admin/comptes', label: 'Comptes' },
```

`src/app/(app)/layout.test.tsx` lit le dossier `admin/` et exige un lien par
écran : sans cette ligne, il tombe — et c'est exactement ce qu'il doit faire.

- [ ] **Step 7: exécuter**

```bash
npx tsc --noEmit
npx vitest run src/services/roles.test.ts "src/app/(app)/admin/comptes" src/admin-garde.test.ts src/app/\(app\)/layout.test.tsx src/components/nav
```

Expected: PASS.

- [ ] **Step 8: commit**

```bash
git add src/services/roles.ts src/services/roles.test.ts "src/app/(app)/admin/comptes" src/components/nav/NavRail.tsx
git commit -m "feat(comptes): donner un role, couper un acces"
```

---

## Task 12 : la recette, et la dette rayée

**Files:**
- Modify: `docs/superpowers/ETAT.md`

**Interfaces:**
- Consumes: rien.
- Produces: rien.

- [ ] **Step 1: vérifier la suite entière**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: tout au vert. Aucun des trois n'est facultatif : le `build` attrape ce
que `tsc` laisse passer sur les composants serveur.

- [ ] **Step 2: recette manuelle, contre l'instance du porteur**

Dans cet ordre :

1. se connecter avec le compte administrateur : les dix entrées de réglages sont
   visibles — les huit d'origine, plus « Mon profil » et « Comptes » —,
   `/admin/dolibarr` s'ouvre, et le champ « Identifiant utilisateur
   Dolibarr » **n'y est plus** ;
2. ouvrir « Mon profil » : l'identifiant n° 4 y est **proposé** avec la mention
   qu'il vient des réglages de l'instance et qu'il n'est pas enregistré ;
   le corriger par le vrai, enregistrer, recharger — il est là, et la suggestion
   a disparu ;
3. connecter puis déconnecter l'agenda Google **depuis « Mon profil »** : le
   retour de Google atterrit bien sur `/profil` ;
4. depuis Réglages · Comptes, créer la situation à deux : élever un compte, puis
   tenter de se retirer son propre rôle — le refus doit nommer la raison ;
5. se connecter avec un compte `CONSULTANT` : `/admin/dolibarr` affiche « Accès
   refusé » avec le rôle et à qui demander, `/admin/sync` s'ouvre **sans** la
   carte « En attente », et « Mon profil » s'ouvre normalement ;
6. valider un CRA avec le compte consultant, sans lui avoir donné d'identifiant
   Dolibarr : la ligne de file échoue avec « Renseignez-le dans Mon profil », et
   **rien** n'est parti sous l'identifiant du porteur — le vérifier dans Dolibarr ;
7. lui donner son identifiant, rejouer la ligne depuis le compte administrateur :
   le temps arrive chez Dolibarr sous **son** `fk_user` ;
8. couper l'accès de ce compte : sa session en cours est refusée dès la requête
   suivante, et ses saisies sont toujours là.

- [ ] **Step 3: rayer la dette**

Dans `docs/superpowers/ETAT.md`, remplacer la section « Dette ouverte par la
double authentification (22 août 2026) » par :

```markdown
## Dette de la double authentification : refermée (22 août 2026)

Le lot de la double authentification créait un compte à la première connexion
Google, au rôle `CONSULTANT`, sans qu'aucun écran n'applique les rôles : toute
personne du domaine Workspace de l'hébergeur pouvait entrer et tout faire. La
fenêtre était bornée, et le lot des rôles l'a refermée.

Ce qui est posé :

- `peutAdministrer` décide, et rien d'autre. Les neuf écrans de `/admin/` et
  leurs actions l'exigent, `src/admin-garde.test.ts` interdit d'en ajouter un
  dixième sans garde, et le refus est **nommé** — il dit le rôle et à qui
  demander, au lieu de rediriger en silence ;
- `/admin/sync` reste ouvert à tous parce qu'il porte les divergences et les
  échecs de la session, mais la file d'instance ne s'y montre qu'à un `ADMIN`.
  L'arbitrage du 20 août 2026 tient : la file n'est pas refiltrée par `userId` ;
- `dolibarrUserId` a quitté les réglages d'instance. Il est la correspondance du
  propriétaire du CRA, et un CRA dont le propriétaire n'en a pas est **refusé**
  plutôt que poussé sous celle d'un autre ;
- `User.disabled` ferme une porte sans détruire les saisies, les CRA ni
  l'attribution de ce qui a été poussé chez Dolibarr. `requireUser()` le relit à
  chaque requête : couper un accès coupe la session en cours.

Ce qui reste ouvert, et qui est nommé pour ne pas être découvert en chemin :
`MANAGER` n'a toujours aucun écran qui lui soit propre, et un `CONSULTANT` voit
encore toutes les missions et tous les clients de l'instance dans `/missions` —
c'est le cloisonnement des données, pas celui des écrans, et il attend sa propre
spec.
```

- [ ] **Step 4: commit**

```bash
git add docs/superpowers/ETAT.md
git commit -m "docs: la dette des roles est refermee, et ce qui reste est nomme"
```

---

## Ce que ce plan ne fait pas

Repris de la spec et des arbitrages, pour qu'un exécutant ne le redécouvre pas en
chemin :

- **Il ne cloisonne pas les données.** Un `CONSULTANT` voit encore tous les
  clients et toutes les missions de l'instance dans `/missions` et `/charge`. La
  spec l'annonce comme la suite (« un `CONSULTANT` ne voit que les missions qui
  le concernent ») et la donnée nécessaire est là — l'affectation des prestations
  — mais c'est un lot à part : il touche à `listMissionsForUser`, à `listClients`
  et à la synthèse, et il change ce que les écrans de travail montrent.
- **Il ne donne aucun écran propre à `MANAGER`.** Le rôle existe et ne peut rien
  de plus qu'un consultant. Lui ouvrir la moitié de l'administration serait
  décider à la place du porteur.
- **Il ne remet pas de filtre par `userId` sur la file de synchronisation.**
  L'arbitrage du 20 août tient, et deux mutations le gardent.
- **Il ne change pas la clé d'API Dolibarr de portée.** Une clé par consultant
  multiplierait les secrets à faire tourner, et Dolibarr attribue déjà le temps
  par `fk_user` — c'est cet axe-là qui devient personnel, pas la clé.
- **Il ne transforme pas la suppression d'un client en refus.** L'écran compte
  l'impact et exige que le nom soit recopié ; le porteur a tranché ainsi en le
  construisant, et des tests gardent ce choix.
- **Il ne touche ni à `src/auth.config.ts`, ni aux fournisseurs Auth.js, ni au
  parcours de mot de passe.** Tout cela appartient au plan de la double
  authentification.
