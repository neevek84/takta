# Double authentification — mot de passe et Google, un seul compte

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** entrer dans l'application par mot de passe **ou** par Google, sur le
même compte, et obtenir l'accès à l'agenda dans le même consentement.

**Architecture :** le fournisseur Google d'Auth.js s'ajoute à côté de
`Credentials`, en session JWT et **sans adaptateur de base** ; la fusion des
comptes est du code que nous écrivons dans le rappel de connexion, la clé étant
`User.email`. Le jeton d'agenda obtenu au passage est écrit dans
`ProviderCredential`, là où le connecteur Calendar le lit déjà. La configuration
d'Auth.js devient **paresseuse**, parce que le client OAuth de l'instance vit
chiffré en base et non dans l'environnement.

**Tech Stack :** Next.js 15 (App Router), Auth.js v5 (`next-auth@^5.0.0-beta.32`),
Prisma 6 / SQLite, Vitest 4, happy-dom, `@node-rs/argon2`, `nodemailer`.

**Spec :** `docs/superpowers/specs/2026-08-22-double-authentification-design.md`

## Global Constraints

- **La connexion par mot de passe ne disparaît pas.** C'est une propriété du
  produit, pas une transition.
- **`src/auth.config.ts` reste sans Prisma ni code natif** : il est importé par
  `src/middleware.ts`, qui tourne en edge. Tout ce qui touche la base va dans
  `src/auth.ts`.
- **Un compte créé sans qu'un humain décide de son rôle est `CONSULTANT`.** Seul
  l'écran de premier démarrage crée un `ADMIN`, explicitement.
- **`passwordHash = ''` signifie « pas de mot de passe ».** `verifyPassword`
  refuse déjà l'empreinte vide.
- **Lien de réinitialisation : 10 minutes, usage unique**, empreinte SHA-256 en
  base, jamais le jeton.
- **Le formulaire d'oubli répond identiquement** pour une adresse connue et une
  inconnue.
- **Deux jeux de migrations** à tenir : `prisma/migrations/` (Postgres,
  `TIMESTAMP(3)`) et `prisma/migrations-sqlite/` (SQLite, `DATETIME`). Deux tests
  les gardent : `src/db/schema-migration-sync.test.ts` et
  `src/distribution/migrations-sqlite.test.ts`.
- **Chaque règle est éprouvée par mutation** : casser la règle doit faire échouer
  au moins un test. Un test qui survit à la suppression de ce qu'il prétend
  garder ne garde rien — le corriger fait partie de la tâche.
- **Commentaires en français**, denses, disant *pourquoi* et non *quoi*, à
  l'image du dépôt.

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `src/roles-explicites.test.ts` | **créé** — refuse tout `prisma.user.create` muet sur son rôle |
| `src/services/auth/comptes.ts` | **créé** — `aUnMotDePasse`, `lierOuCreerCompteGoogle`, `aucunUtilisateur`, `creerPremierAdministrateur` |
| `src/core/auth/reinitialisation.ts` | **créé** — pur : fabriquer un jeton, l'empreindre, calculer et juger l'expiration |
| `src/services/auth/mot-de-passe.ts` | **créé** — demander un lien, le consommer, définir le mot de passe |
| `src/app/(auth)/mot-de-passe/page.tsx` + `actions.ts` | **créés** — écrans « oublié » et « définir » |
| `prisma/schema.prisma` | modifié — modèle `PasswordReset` |
| `prisma/migrations/20260825000000_password_reset/migration.sql` | **créé** — jeu Postgres |
| `prisma/migrations-sqlite/20260825000000_password_reset/migration.sql` | **créé** — jeu SQLite |
| `src/core/notify/templates.ts` | modifié — `gabaritReinitialisation` |
| `src/services/google/connect.ts` | modifié — extraction de `enregistrerEtPreparerAgenda` |
| `src/auth.ts` | modifié — configuration paresseuse, fournisseur Google, rappels |
| `src/app/(auth)/login/page.tsx` | modifié — bouton Google, lien d'oubli, premier démarrage |
| `src/app/(auth)/login/actions.ts` | modifié — action de connexion Google, action de premier démarrage |
| `src/services/dolibarr/reprise-temps.ts` | modifié — rôle `CONSULTANT` explicite |
| `docs/MISE-EN-OEUVRE.md` | modifié — les deux URI de retour |

---

## Task 1 : le rôle explicite, et le contrôle qui le garde

Ferme un défaut **déjà en base** : la reprise des temps crée des utilisateurs
sans rôle, et le défaut de colonne est `ADMIN`. Les auteurs Dolibarr importés
naissent donc administrateurs. On corrige le cas **et** la classe.

**Files:**
- Create: `src/roles-explicites.test.ts`
- Modify: `src/services/dolibarr/reprise-temps.ts` (dans `utilisateurLocal`)
- Test: `src/services/dolibarr/reprise-temps.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: la garantie que tout `prisma.user.create` de `src/` nomme son rôle.

- [ ] **Step 1: écrire le test de la classe de défaut**

`src/roles-explicites.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Un compte créé sans rôle explicite reçoit `ADMIN`, qui est le défaut de la
 * colonne. C'est arrivé : la reprise des temps Dolibarr fabriquait des
 * administrateurs à chaque auteur importé, sans que rien ne le signale.
 *
 * Corriger les appels connus laisserait le prochain répéter le défaut. Ce
 * contrôle refuse donc la **forme**, à la manière de `src/frontieres.test.ts`.
 */
const RACINE = join(process.cwd(), 'src')

function sources(dossier: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, e.name)
    if (e.isDirectory()) out.push(...sources(chemin))
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(chemin)
  }
  return out
}

describe('la création d un utilisateur nomme toujours son rôle', () => {
  it('n a aucun prisma.user.create muet', () => {
    const fautifs: string[] = []

    for (const fichier of sources(RACINE)) {
      const contenu = readFileSync(fichier, 'utf8')
      // On découpe sur l'appel, puis on lit les 400 caractères qui suivent :
      // assez pour couvrir un objet `data` sur plusieurs lignes, trop peu pour
      // attraper le `role` d'un appel voisin.
      const morceaux = contenu.split(/prisma\.user\.create\s*\(/).slice(1)
      for (const morceau of morceaux) {
        if (!/\brole\s*:/.test(morceau.slice(0, 400))) {
          fautifs.push(relative(process.cwd(), fichier))
        }
      }
    }

    expect(fautifs, `${fautifs.join(', ')} crée(nt) un utilisateur sans dire son rôle`).toEqual([])
  })
})
```

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/roles-explicites.test.ts`
Expected: FAIL, `src/services/dolibarr/reprise-temps.ts crée(nt) un utilisateur sans dire son rôle`

- [ ] **Step 3: corriger l'appel fautif**

Dans `src/services/dolibarr/reprise-temps.ts`, fonction `utilisateurLocal`,
remplacer le bloc `prisma.user.create` par :

```ts
    (await prisma.user.create({
      data: {
        email,
        name: distant.nom === '' ? distant.login : distant.nom,
        passwordHash: '',
        // **Jamais le défaut de la colonne**, qui vaut `ADMIN`. Un auteur
        // importé n'a été choisi par personne : il entre au rôle le moins doté,
        // et c'est un geste humain qui l'élève.
        role: 'CONSULTANT',
      },
      select: { id: true },
    }))
```

- [ ] **Step 4: ajouter le test de comportement**

À la fin de `src/services/dolibarr/reprise-temps.test.ts`, dans le `describe`
`reprendreLesTemps` :

```ts
  // Le défaut de la colonne vaut `ADMIN` : un auteur importé deviendrait
  // administrateur sans que personne l'ait décidé.
  it("crée l'auteur au rôle le moins doté", async () => {
    const d = await decor()
    seedTemps({ taskId: d.tache.id, dolibarrUserId: d.auteur.id, date: '2026-07-15', durationSeconds: 25_200 })

    await reprendreLesTemps({ missionId: d.mission.id, userId, api, aujourdhui: AUJOURDHUI })

    const cree = await prisma.user.findUniqueOrThrow({ where: { email: 'camille@exemple.test' } })
    expect(cree.role).toBe('CONSULTANT')
  })
```

- [ ] **Step 5: exécuter les deux, et muter**

Run: `npx vitest run src/roles-explicites.test.ts src/services/dolibarr/reprise-temps.test.ts`
Expected: PASS.

Puis vérifier que le test de comportement mord : remplacer `role: 'CONSULTANT'`
par `role: 'ADMIN'`, relancer — le test doit **échouer** — et remettre.

- [ ] **Step 6: commit**

```bash
git add src/roles-explicites.test.ts src/services/dolibarr/reprise-temps.ts src/services/dolibarr/reprise-temps.test.ts
git commit -m "fix(auth): un compte cree sans decision humaine nait CONSULTANT"
```

---

## Task 2 : la convention de l'empreinte vide, enfin nommée

`passwordHash = ''` veut déjà dire « pas de mot de passe » — c'est l'état des
comptes créés par la reprise. La convention devient explicite et éprouvée, parce
que trois écrans vont s'appuyer dessus.

**Files:**
- Create: `src/services/auth/comptes.ts`
- Test: `src/services/auth/comptes.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `aUnMotDePasse(userId: string): Promise<boolean>`

- [ ] **Step 1: écrire le test**

`src/services/auth/comptes.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { hashPassword } from '@/auth-password'
import { aUnMotDePasse } from './comptes'

let avec = ''
let sans = ''

beforeAll(async () => {
  const a = await prisma.user.create({
    data: {
      email: 'comptes-avec@test.local',
      name: 'A',
      passwordHash: await hashPassword('secret'),
      role: 'CONSULTANT',
    },
  })
  const b = await prisma.user.create({
    data: { email: 'comptes-sans@test.local', name: 'B', passwordHash: '', role: 'CONSULTANT' },
  })
  avec = a.id
  sans = b.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'comptes-' } } })
  await prisma.$disconnect()
})

describe('aUnMotDePasse', () => {
  it('reconnaît un compte qui en porte un', async () => {
    expect(await aUnMotDePasse(avec)).toBe(true)
  })

  // L'empreinte vide est l'état des comptes nés de la reprise Dolibarr et de la
  // connexion Google : ils existent, mais la porte mot de passe leur est fermée
  // tant qu'ils n'en ont pas défini un.
  it("refuse l'empreinte vide, qui n'est pas un mot de passe", async () => {
    expect(await aUnMotDePasse(sans)).toBe(false)
  })

  it('refuse un compte qui n existe pas', async () => {
    expect(await aUnMotDePasse('inexistant')).toBe(false)
  })
})
```

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/services/auth/comptes.test.ts`
Expected: FAIL, `Failed to resolve import "./comptes"`

- [ ] **Step 3: écrire le module**

`src/services/auth/comptes.ts` :

```ts
/**
 * Ce qui fait exister un compte, et ce qui lui ouvre une porte.
 *
 * **La convention de l'empreinte vide.** `passwordHash = ''` signifie « pas de
 * mot de passe ». C'est l'état des comptes que la reprise des temps Dolibarr
 * crée pour porter l'attribution des saisies, et de ceux que la connexion
 * Google crée. `verifyPassword` refuse déjà cette empreinte — `verify('')`
 * lève, le `catch` rend `false` — mais rien ne le **disait**. Trois écrans
 * s'appuient maintenant dessus : il faut que ce soit une règle, pas un accident
 * heureux.
 */
import { prisma } from '@/db/client'

/** Ce compte peut-il entrer par la porte mot de passe ? */
export async function aUnMotDePasse(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  })
  return user !== null && user.passwordHash !== ''
}
```

- [ ] **Step 4: exécuter**

Run: `npx vitest run src/services/auth/comptes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: commit**

```bash
git add src/services/auth/comptes.ts src/services/auth/comptes.test.ts
git commit -m "feat(auth): nommer la convention de l'empreinte vide"
```

---

## Task 3 : la table `PasswordReset` et le cœur pur du jeton

**Files:**
- Create: `src/core/auth/reinitialisation.ts`, `src/core/auth/reinitialisation.test.ts`
- Create: `prisma/migrations/20260825000000_password_reset/migration.sql`
- Create: `prisma/migrations-sqlite/20260825000000_password_reset/migration.sql`
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `DUREE_LIEN_MINUTES: 10`
  - `fabriquerJeton(): string` — 64 caractères hexadécimaux
  - `empreinteJeton(jeton: string): string` — SHA-256 hexadécimal
  - `expirationDepuis(maintenant: Date): Date`
  - `lienExpire(expiration: Date, maintenant: Date): boolean`

- [ ] **Step 1: écrire le test du cœur pur**

`src/core/auth/reinitialisation.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  DUREE_LIEN_MINUTES,
  empreinteJeton,
  expirationDepuis,
  fabriquerJeton,
  lienExpire,
} from './reinitialisation'

describe('fabriquerJeton', () => {
  it('rend 32 octets, en hexadécimal', () => {
    expect(fabriquerJeton()).toMatch(/^[0-9a-f]{64}$/)
  })

  // Un jeton prévisible serait un mot de passe universel à durée limitée.
  it('ne rend jamais deux fois le même', () => {
    const tires = new Set(Array.from({ length: 200 }, () => fabriquerJeton()))
    expect(tires.size).toBe(200)
  })
})

describe('empreinteJeton', () => {
  // La base porte l'empreinte, jamais le jeton : une base qui fuite ne doit pas
  // livrer des liens utilisables.
  it('ne laisse pas retrouver le jeton', () => {
    const jeton = fabriquerJeton()
    expect(empreinteJeton(jeton)).not.toContain(jeton)
    expect(empreinteJeton(jeton)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rend la même empreinte pour le même jeton', () => {
    const jeton = fabriquerJeton()
    expect(empreinteJeton(jeton)).toBe(empreinteJeton(jeton))
  })

  it('rend une empreinte différente pour un autre jeton', () => {
    expect(empreinteJeton('a')).not.toBe(empreinteJeton('b'))
  })
})

describe("l'expiration", () => {
  it('est de dix minutes', () => {
    expect(DUREE_LIEN_MINUTES).toBe(10)
    const depart = new Date('2026-08-22T10:00:00.000Z')
    expect(expirationDepuis(depart).toISOString()).toBe('2026-08-22T10:10:00.000Z')
  })

  it('juge un lien encore valide une seconde avant', () => {
    const expiration = new Date('2026-08-22T10:10:00.000Z')
    expect(lienExpire(expiration, new Date('2026-08-22T10:09:59.000Z'))).toBe(false)
  })

  // À la seconde près : un lien « valide pile à l'expiration » est un lien dont
  // la durée n'est pas celle qu'on annonce.
  it('juge un lien expiré à sa seconde d expiration', () => {
    const expiration = new Date('2026-08-22T10:10:00.000Z')
    expect(lienExpire(expiration, new Date('2026-08-22T10:10:00.000Z'))).toBe(true)
  })
})
```

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/core/auth/reinitialisation.test.ts`
Expected: FAIL, `Failed to resolve import "./reinitialisation"`

- [ ] **Step 3: écrire le cœur pur**

`src/core/auth/reinitialisation.ts` :

```ts
/**
 * Les règles d'un lien de réinitialisation de mot de passe.
 *
 * Pur : aucune base, aucun réseau. `maintenant` est toujours passé en argument —
 * une expiration qui lit l'horloge ne se teste pas.
 */
import { createHash, randomBytes } from 'node:crypto'

/**
 * Dix minutes, arbitrage du porteur le 22 août 2026.
 *
 * Court est plus sûr, et le prix est connu : un courriel qui traîne dans une
 * file d'attente peut arriver après l'expiration. Le remède est d'en redemander
 * un, et l'écran le dit.
 */
export const DUREE_LIEN_MINUTES = 10

/** Un secret de 256 bits, hexadécimal : c'est lui qui voyage dans l'URL. */
export function fabriquerJeton(): string {
  return randomBytes(32).toString('hex')
}

/**
 * L'empreinte que la base porte — **jamais le jeton**.
 *
 * SHA-256 et non argon2, contrairement aux mots de passe : un secret de 256 bits
 * tiré au hasard n'a pas de dictionnaire, donc rien à ralentir. Ralentir ici ne
 * protégerait de rien et coûterait à chaque vérification.
 */
export function empreinteJeton(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex')
}

export function expirationDepuis(maintenant: Date): Date {
  return new Date(maintenant.getTime() + DUREE_LIEN_MINUTES * 60_000)
}

/** Un lien atteint sa seconde d'expiration est expiré, pas encore valide. */
export function lienExpire(expiration: Date, maintenant: Date): boolean {
  return maintenant.getTime() >= expiration.getTime()
}
```

- [ ] **Step 4: exécuter**

Run: `npx vitest run src/core/auth/reinitialisation.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: ajouter le modèle au schéma**

Dans `prisma/schema.prisma`, après le modèle `User` :

```prisma
model PasswordReset {
  id        String    @id @default(cuid())
  userId    String
  /// empreinte SHA-256 du jeton — jamais le jeton lui-même
  tokenHash String    @unique
  expiresAt DateTime
  /// date de consommation ; null tant que le lien n'a pas servi
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

Et, dans le modèle `User`, ajouter la relation inverse à côté des autres :

```prisma
  passwordResets PasswordReset[]
```

- [ ] **Step 6: écrire les deux migrations**

`prisma/migrations/20260825000000_password_reset/migration.sql` :

```sql
-- Un lien de réinitialisation de mot de passe : dix minutes, usage unique.
-- La colonne porte l'EMPREINTE du jeton, jamais le jeton : une base qui fuite
-- ne doit pas livrer des liens utilisables. `usedAt` reste nul tant que le lien
-- n'a pas servi ; c'est lui qui rend l'usage unique.
-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

`prisma/migrations-sqlite/20260825000000_password_reset/migration.sql` :

```sql
-- Un lien de réinitialisation de mot de passe : dix minutes, usage unique.
-- La colonne porte l'EMPREINTE du jeton, jamais le jeton.
-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");
```

- [ ] **Step 7: appliquer et vérifier les deux jeux**

```bash
npx prisma db push --skip-generate && npx prisma generate
npx vitest run src/db/schema-migration-sync.test.ts src/distribution/migrations-sqlite.test.ts
```

Expected: PASS. Ces deux tests comparent le schéma aux migrations ; ils échouent
si une colonne manque d'un côté.

- [ ] **Step 8: commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/migrations-sqlite src/core/auth
git commit -m "feat(auth): la table PasswordReset et les regles du lien"
```

---

## Task 4 : demander et consommer un lien

**Files:**
- Create: `src/services/auth/mot-de-passe.ts`, `src/services/auth/mot-de-passe.test.ts`
- Modify: `src/core/notify/templates.ts`
- Test: `src/core/notify/templates.test.ts`

**Interfaces:**
- Consumes: `fabriquerJeton`, `empreinteJeton`, `expirationDepuis`, `lienExpire`
  (Task 3) ; `notify(gabarit, {destinataire})` de `@/services/notify` ;
  `hashPassword` de `@/auth-password`.
- Produces:
  - `demanderReinitialisation(args: { email: string; origine: string; maintenant?: Date }): Promise<void>`
  - `definirMotDePasse(args: { jeton: string; motDePasse: string; maintenant?: Date }): Promise<{ ok: boolean; motif: string }>`
  - `gabaritReinitialisation(args: { lien: string; minutes: number }): Gabarit`

- [ ] **Step 1: écrire le test du gabarit**

À la fin de `src/core/notify/templates.test.ts` :

```ts
describe('gabaritReinitialisation', () => {
  it('porte le lien et sa durée', () => {
    const g = gabaritReinitialisation({ lien: 'https://cra.test/mot-de-passe?jeton=abc', minutes: 10 })
    expect(g.corps).toContain('https://cra.test/mot-de-passe?jeton=abc')
    expect(g.corps).toContain('10 minutes')
  })

  // Le parcours sert aussi les comptes qui n'ont jamais eu de mot de passe :
  // ceux que Google crée, ceux que la reprise Dolibarr a créés. Parler
  // uniquement d'oubli les laisserait croire que le lien ne les concerne pas.
  it('parle de définir autant que de réinitialiser', () => {
    const g = gabaritReinitialisation({ lien: 'https://cra.test/x', minutes: 10 })
    expect(`${g.sujet} ${g.corps}`).toMatch(/définir/i)
  })
})
```

Ajouter `gabaritReinitialisation` à la ligne d'import du fichier.

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/core/notify/templates.test.ts`
Expected: FAIL, `gabaritReinitialisation is not a function`

- [ ] **Step 3: écrire le gabarit**

À la fin de `src/core/notify/templates.ts` :

```ts
/**
 * Le courriel qui porte un lien de réinitialisation.
 *
 * Il dit **définir** autant que **réinitialiser** : ce parcours est aussi celui
 * par lequel un compte né sans mot de passe — connexion Google, reprise
 * Dolibarr — s'en donne un pour la première fois.
 */
export function gabaritReinitialisation(args: { lien: string; minutes: number }): Gabarit {
  return {
    sujet: 'CRA — définir ou réinitialiser votre mot de passe',
    corps: [
      'Vous avez demandé à définir ou réinitialiser le mot de passe de votre compte CRA.',
      '',
      args.lien,
      '',
      `Ce lien est valable ${args.minutes} minutes et ne sert qu'une fois.`,
      "Passé ce délai, redemandez-en un depuis l'écran de connexion.",
      '',
      "Si vous n'êtes pas à l'origine de cette demande, ce message ne demande aucune action :",
      "sans le lien ci-dessus, personne ne peut changer votre mot de passe.",
    ].join('\n'),
  }
}
```

- [ ] **Step 4: écrire le test du service**

`src/services/auth/mot-de-passe.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/db/client'
import { verifyPassword } from '@/auth-password'
import { empreinteJeton } from '@/core/auth/reinitialisation'

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }))
vi.mock('@/services/notify', () => ({ notify }))

import { definirMotDePasse, demanderReinitialisation } from './mot-de-passe'

const MAINTENANT = new Date('2026-08-22T10:00:00.000Z')
let userId = ''

beforeEach(async () => {
  notify.mockReset().mockResolvedValue({ envoye: true, motif: '' })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'mdp-' } } })
  const u = await prisma.user.create({
    data: { email: 'mdp-cible@test.local', name: 'C', passwordHash: '', role: 'CONSULTANT' },
  })
  userId = u.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'mdp-' } } })
  await prisma.$disconnect()
})

/** Le jeton tel qu'il est parti dans le courriel. */
function jetonEnvoye(): string {
  const corps = String(notify.mock.calls[0]![0].corps)
  return /jeton=([0-9a-f]{64})/.exec(corps)![1]!
}

describe('demanderReinitialisation', () => {
  it('envoie un lien et ne garde que son empreinte', async () => {
    await demanderReinitialisation({
      email: 'mdp-cible@test.local',
      origine: 'https://cra.test',
      maintenant: MAINTENANT,
    })

    const jeton = jetonEnvoye()
    const ligne = await prisma.passwordReset.findFirstOrThrow({ where: { userId } })
    expect(ligne.tokenHash).toBe(empreinteJeton(jeton))
    // La base ne porte nulle part le jeton lui-même.
    expect(JSON.stringify(ligne)).not.toContain(jeton)
    expect(ligne.expiresAt.toISOString()).toBe('2026-08-22T10:10:00.000Z')
  })

  // Sans cette précaution, le formulaire devient un annuaire : on y teste des
  // adresses jusqu'à savoir qui travaille ici.
  it("n'envoie rien pour une adresse inconnue, et ne lève pas", async () => {
    await expect(
      demanderReinitialisation({ email: 'inconnu@test.local', origine: 'https://cra.test' }),
    ).resolves.toBeUndefined()
    expect(notify).not.toHaveBeenCalled()
  })

  it('adresse le courriel au compte visé, pas au destinataire des notifications', async () => {
    await demanderReinitialisation({ email: 'mdp-cible@test.local', origine: 'https://cra.test' })
    expect(notify.mock.calls[0]![1]).toEqual({ destinataire: 'mdp-cible@test.local' })
  })
})

describe('definirMotDePasse', () => {
  async function unLien(): Promise<string> {
    await demanderReinitialisation({
      email: 'mdp-cible@test.local',
      origine: 'https://cra.test',
      maintenant: MAINTENANT,
    })
    return jetonEnvoye()
  }

  it('pose le mot de passe et marque le lien consommé', async () => {
    const jeton = await unLien()

    const r = await definirMotDePasse({ jeton, motDePasse: 'un-bon-secret', maintenant: MAINTENANT })

    expect(r.ok).toBe(true)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(await verifyPassword(user.passwordHash, 'un-bon-secret')).toBe(true)
    const ligne = await prisma.passwordReset.findFirstOrThrow({ where: { userId } })
    expect(ligne.usedAt).not.toBeNull()
  })

  it('refuse un lien déjà consommé', async () => {
    const jeton = await unLien()
    await definirMotDePasse({ jeton, motDePasse: 'premier-secret', maintenant: MAINTENANT })

    const r = await definirMotDePasse({ jeton, motDePasse: 'second-secret', maintenant: MAINTENANT })

    expect(r.ok).toBe(false)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(await verifyPassword(user.passwordHash, 'second-secret')).toBe(false)
  })

  it('refuse un lien expiré', async () => {
    const jeton = await unLien()

    const r = await definirMotDePasse({
      jeton,
      motDePasse: 'trop-tard',
      maintenant: new Date('2026-08-22T10:10:00.000Z'),
    })

    expect(r.ok).toBe(false)
  })

  it('refuse un jeton inventé', async () => {
    const r = await definirMotDePasse({ jeton: 'f'.repeat(64), motDePasse: 'x-secret' })
    expect(r.ok).toBe(false)
  })

  // Deux demandes de suite, puis une consommation : la première ne doit pas
  // rester ouverte derrière.
  it('annule les autres liens en attente du même compte', async () => {
    await unLien()
    const second = await unLien()

    await definirMotDePasse({ jeton: second, motDePasse: 'un-bon-secret', maintenant: MAINTENANT })

    const restants = await prisma.passwordReset.count({ where: { userId, usedAt: null } })
    expect(restants).toBe(0)
  })
})
```

- [ ] **Step 5: exécuter, et constater l'échec**

Run: `npx vitest run src/services/auth/mot-de-passe.test.ts`
Expected: FAIL, `Failed to resolve import "./mot-de-passe"`

- [ ] **Step 6: écrire le service**

`src/services/auth/mot-de-passe.ts` :

```ts
/**
 * Définir ou réinitialiser un mot de passe par courriel.
 *
 * **Ce parcours ne sert pas que l'oubli.** C'est par lui qu'un compte né *sans*
 * mot de passe s'en donne un : ceux que la connexion Google crée, ceux que la
 * reprise des temps Dolibarr a créés. Sans lui, la seconde porte leur resterait
 * fermée à jamais.
 *
 * **Rien ne dit si le compte existe.** `demanderReinitialisation` se tait dans
 * tous les cas — même signature, même absence de retour. Distinguer les deux
 * ferait du formulaire d'oubli un annuaire du personnel.
 */
import { prisma } from '@/db/client'
import { hashPassword } from '@/auth-password'
import {
  DUREE_LIEN_MINUTES,
  empreinteJeton,
  expirationDepuis,
  fabriquerJeton,
  lienExpire,
} from '@/core/auth/reinitialisation'
import { gabaritReinitialisation } from '@/core/notify/templates'
import { notify } from '@/services/notify'

export async function demanderReinitialisation(args: {
  email: string
  /** origine de l'application, sans barre finale : `https://cra.exemple.fr` */
  origine: string
  maintenant?: Date
}): Promise<void> {
  const maintenant = args.maintenant ?? new Date()
  const user = await prisma.user.findUnique({
    where: { email: args.email.trim().toLowerCase() },
    select: { id: true, email: true },
  })
  // Aucun retour, aucune levée : l'appelant ne peut pas distinguer ce cas.
  if (user === null) return

  const jeton = fabriquerJeton()
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: empreinteJeton(jeton),
      expiresAt: expirationDepuis(maintenant),
    },
  })

  await notify(
    gabaritReinitialisation({
      lien: `${args.origine}/mot-de-passe?jeton=${jeton}`,
      minutes: DUREE_LIEN_MINUTES,
    }),
    // Au compte visé, jamais au destinataire des notifications d'instance :
    // celui-ci recevrait les liens de tout le monde.
    { destinataire: user.email },
  )
}

export async function definirMotDePasse(args: {
  jeton: string
  motDePasse: string
  maintenant?: Date
}): Promise<{ ok: boolean; motif: string }> {
  const maintenant = args.maintenant ?? new Date()
  const refus = {
    ok: false,
    motif: 'Ce lien n’est plus valable. Demandez-en un nouveau depuis l’écran de connexion.',
  }

  const ligne = await prisma.passwordReset.findUnique({
    where: { tokenHash: empreinteJeton(args.jeton) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  })
  if (ligne === null) return refus
  if (ligne.usedAt !== null) return refus
  if (lienExpire(ligne.expiresAt, maintenant)) return refus

  const empreinte = await hashPassword(args.motDePasse)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ligne.userId }, data: { passwordHash: empreinte } })
    await tx.passwordReset.update({ where: { id: ligne.id }, data: { usedAt: maintenant } })
    // Les autres liens en attente tombent avec celui-ci : en laisser un ouvert
    // laisserait une seconde clé en circulation après le changement.
    await tx.passwordReset.updateMany({
      where: { userId: ligne.userId, usedAt: null },
      data: { usedAt: maintenant },
    })
  })

  return { ok: true, motif: '' }
}
```

- [ ] **Step 7: exécuter, et muter**

Run: `npx vitest run src/services/auth/mot-de-passe.test.ts src/core/notify/templates.test.ts`
Expected: PASS.

Puis trois mutations, chacune restaurée aussitôt :
1. supprimer `if (ligne.usedAt !== null) return refus` → un test doit échouer ;
2. remplacer `lienExpire(...)` par `false` → un test doit échouer ;
3. supprimer le `updateMany` final → un test doit échouer.

- [ ] **Step 8: commit**

```bash
git add src/services/auth/mot-de-passe.ts src/services/auth/mot-de-passe.test.ts src/core/notify/templates.ts src/core/notify/templates.test.ts
git commit -m "feat(auth): demander et consommer un lien de mot de passe"
```

---

## Task 5 : les écrans « oublié » et « définir »

**Files:**
- Create: `src/app/(auth)/mot-de-passe/page.tsx`, `src/app/(auth)/mot-de-passe/actions.ts`,
  `src/app/(auth)/mot-de-passe/FormulaireMotDePasse.tsx`,
  `src/app/(auth)/mot-de-passe/FormulaireMotDePasse.test.tsx`
- Modify: `src/app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: `demanderReinitialisation`, `definirMotDePasse` (Task 4).
- Produces: la route `/mot-de-passe`, avec ou sans `?jeton=`.

- [ ] **Step 1: écrire les actions**

`src/app/(auth)/mot-de-passe/actions.ts` :

```ts
'use server'

import { headers } from 'next/headers'
import { demanderReinitialisation, definirMotDePasse } from '@/services/auth/mot-de-passe'

export type MotDePasseState = { ok: boolean; message: string } | null

/**
 * La réponse est **la même** que l'adresse soit connue ou non. Le motif réel
 * d'un non-envoi — compte inconnu, SMTP absent — n'apparaît jamais ici.
 */
export async function demanderLien(
  _precedent: MotDePasseState,
  formData: FormData,
): Promise<MotDePasseState> {
  const email = String(formData.get('email') ?? '')
  // L'origine vient de la requête : l'application ne connaît pas sa propre URL
  // publique, et la coder en dur produirait des liens morts derrière un proxy.
  const entetes = await headers()
  const hote = entetes.get('x-forwarded-host') ?? entetes.get('host') ?? 'localhost:3000'
  const schema = entetes.get('x-forwarded-proto') ?? 'http'

  await demanderReinitialisation({ email, origine: `${schema}://${hote}` })

  return {
    ok: true,
    message:
      'Si un compte porte cette adresse, un lien vient de partir. Il est valable dix minutes.',
  }
}

export async function poserMotDePasse(
  _precedent: MotDePasseState,
  formData: FormData,
): Promise<MotDePasseState> {
  const jeton = String(formData.get('jeton') ?? '')
  const motDePasse = String(formData.get('motDePasse') ?? '')

  if (motDePasse.length < 12) {
    return { ok: false, message: 'Choisissez un mot de passe d’au moins 12 caractères.' }
  }

  const r = await definirMotDePasse({ jeton, motDePasse })
  return r.ok
    ? { ok: true, message: 'Mot de passe enregistré. Vous pouvez vous connecter.' }
    : { ok: false, message: r.motif }
}
```

- [ ] **Step 2: écrire le test du composant**

`src/app/(auth)/mot-de-passe/FormulaireMotDePasse.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { demanderLien, poserMotDePasse } = vi.hoisted(() => ({
  demanderLien: vi.fn(),
  poserMotDePasse: vi.fn(),
}))
vi.mock('./actions', () => ({ demanderLien, poserMotDePasse }))

import { FormulaireMotDePasse } from './FormulaireMotDePasse'

beforeEach(() => {
  demanderLien.mockReset()
  poserMotDePasse.mockReset()
})
afterEach(cleanup)

describe('FormulaireMotDePasse', () => {
  it('demande une adresse quand il n y a pas de jeton', () => {
    render(<FormulaireMotDePasse jeton="" />)
    expect(screen.getByLabelText('Adresse e-mail')).toBeTruthy()
    expect(screen.queryByLabelText('Nouveau mot de passe')).toBeNull()
  })

  // Le jeton voyage dans un champ caché : le remettre à l'écran le ferait
  // apparaître dans une capture ou une copie d'URL partagée.
  it('demande un mot de passe quand un jeton est présent, sans le montrer', () => {
    render(<FormulaireMotDePasse jeton="abc123" />)
    expect(screen.getByLabelText('Nouveau mot de passe')).toBeTruthy()
    expect(screen.queryByText('abc123')).toBeNull()
    const cache = document.querySelector('input[name="jeton"]') as HTMLInputElement
    expect(cache.type).toBe('hidden')
    expect(cache.value).toBe('abc123')
  })

  it('parle de définir autant que de réinitialiser', () => {
    render(<FormulaireMotDePasse jeton="" />)
    expect(document.body.textContent).toMatch(/définir/i)
  })
})
```

- [ ] **Step 3: exécuter, et constater l'échec**

Run: `npx vitest run "src/app/(auth)/mot-de-passe/FormulaireMotDePasse.test.tsx"`
Expected: FAIL, `Failed to resolve import "./FormulaireMotDePasse"`

- [ ] **Step 4: écrire le composant et la page**

`src/app/(auth)/mot-de-passe/FormulaireMotDePasse.tsx` :

```tsx
'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { demanderLien, poserMotDePasse, type MotDePasseState } from './actions'

/**
 * Un seul écran pour deux moments : demander un lien, et poser le mot de passe
 * qu'il autorise. La présence du jeton dans l'URL décide lequel.
 *
 * Le vocabulaire dit **définir** autant que **réinitialiser** : ce parcours est
 * aussi celui d'un compte né sans mot de passe, qui n'a rien oublié.
 */
export function FormulaireMotDePasse({ jeton }: { jeton: string }) {
  const action = jeton === '' ? demanderLien : poserMotDePasse
  const [etat, formAction, enCours] = useActionState<MotDePasseState, FormData>(action, null)

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-3">
        {etat !== null && <Banner tone={etat.ok ? 'success' : 'danger'}>{etat.message}</Banner>}

        {jeton === '' ? (
          <>
            <p className="text-sm text-muted">
              Indiquez votre adresse : nous enverrons un lien pour définir ou réinitialiser votre
              mot de passe. Il est valable dix minutes.
            </p>
            <Field label="Adresse e-mail" name="email" type="email" required />
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Choisissez votre mot de passe — au moins 12 caractères.
            </p>
            <input type="hidden" name="jeton" value={jeton} />
            <Field label="Nouveau mot de passe" name="motDePasse" type="password" required />
          </>
        )}

        <Button type="submit" variant="primary" disabled={enCours}>
          {jeton === '' ? 'Envoyer le lien' : 'Enregistrer le mot de passe'}
        </Button>
      </form>
    </Card>
  )
}
```

`src/app/(auth)/mot-de-passe/page.tsx` :

```tsx
import Link from 'next/link'
import { FormulaireMotDePasse } from './FormulaireMotDePasse'

export default async function MotDePassePage({
  searchParams,
}: {
  searchParams: Promise<{ jeton?: string }>
}) {
  const { jeton } = await searchParams

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-4">
      <h1 className="mb-6 text-xl font-semibold">Mot de passe</h1>
      <FormulaireMotDePasse jeton={jeton ?? ''} />
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-link underline">
          Retour à la connexion
        </Link>
      </p>
    </main>
  )
}
```

- [ ] **Step 5: ajouter le lien depuis l'écran de connexion**

Dans `src/app/(auth)/login/page.tsx`, après le `</Card>` :

```tsx
      <p className="mt-4 text-sm">
        <Link href="/mot-de-passe" className="text-link underline">
          Définir ou réinitialiser mon mot de passe
        </Link>
      </p>
```

et ajouter `import Link from 'next/link'` en tête.

- [ ] **Step 6: vérifier que la route est publique**

`src/auth.config.ts`, rappel `authorized` : la condition ne laisse passer que
`/login`. Étendre :

```ts
      const isLogin = request.nextUrl.pathname.startsWith('/login')
      // La réinitialisation s'atteint **sans** être connecté : c'est tout son
      // objet. L'oublier renverrait vers /login le porteur d'un lien valide.
      const isMotDePasse = request.nextUrl.pathname.startsWith('/mot-de-passe')
      if (isLogin || isMotDePasse) return true
```

- [ ] **Step 7: exécuter**

```bash
npx tsc --noEmit
npx vitest run "src/app/(auth)" src/middleware.test.ts
```

Expected: PASS.

- [ ] **Step 8: commit**

```bash
git add "src/app/(auth)/mot-de-passe" "src/app/(auth)/login/page.tsx" src/auth.config.ts
git commit -m "feat(auth): les ecrans de definition et de reinitialisation"
```

---

## Task 6 : l'écran de premier démarrage

Une instance neuve est murée : `hashPassword` n'a aucun appelant, il n'existe
aucun moyen supporté de créer le premier compte.

**Files:**
- Modify: `src/services/auth/comptes.ts`, `src/services/auth/comptes.test.ts`
- Modify: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/actions.ts`

**Interfaces:**
- Consumes: `hashPassword` de `@/auth-password`.
- Produces:
  - `aucunUtilisateur(): Promise<boolean>`
  - `creerPremierAdministrateur(args: { email: string; name: string; motDePasse: string }): Promise<{ ok: boolean; motif: string }>`

- [ ] **Step 1: écrire le test**

À la fin de `src/services/auth/comptes.test.ts`, dans un nouveau `describe` :

```ts
describe('le premier administrateur', () => {
  it("n'est proposé que sur une base sans aucun utilisateur", async () => {
    // Les comptes du décor existent : la fenêtre est fermée.
    expect(await aucunUtilisateur()).toBe(false)
  })

  it('refuse dès qu un compte existe, même si l écran l a proposé', async () => {
    const r = await creerPremierAdministrateur({
      email: 'intrus@test.local',
      name: 'Intrus',
      motDePasse: 'un-tres-bon-secret',
    })

    expect(r.ok).toBe(false)
    expect(await prisma.user.count({ where: { email: 'intrus@test.local' } })).toBe(0)
  })
})
```

Compléter la ligne d'import : `import { aUnMotDePasse, aucunUtilisateur, creerPremierAdministrateur } from './comptes'`.

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/services/auth/comptes.test.ts`
Expected: FAIL, `aucunUtilisateur is not a function`

- [ ] **Step 3: écrire les deux fonctions**

À la fin de `src/services/auth/comptes.ts` :

```ts
import { hashPassword } from '@/auth-password'

/**
 * L'instance n'a aucun compte : c'est la seule fenêtre où l'écran de premier
 * démarrage s'ouvre.
 *
 * **Elle ne se reproduit jamais d'elle-même.** Vraie une fois, à l'installation,
 * et fausse pour toujours ensuite — rouvrir exigerait de supprimer tous les
 * comptes, ce qu'aucun écran ne permet. C'est pourquoi cet écran n'ajoute
 * aucune surface d'attaque.
 */
export async function aucunUtilisateur(): Promise<boolean> {
  return (await prisma.user.count()) === 0
}

/**
 * Crée le premier compte d'une instance neuve, **administrateur**.
 *
 * C'est le seul endroit du produit où un humain décide du rôle d'un compte, et
 * c'est bien un administrateur qu'il faut : lui seul pourra ensuite configurer
 * Dolibarr et Google. Le rôle est donc écrit explicitement — le contrôle de
 * `src/roles-explicites.test.ts` s'applique ici comme ailleurs.
 */
export async function creerPremierAdministrateur(args: {
  email: string
  name: string
  motDePasse: string
}): Promise<{ ok: boolean; motif: string }> {
  if (args.motDePasse.length < 12) {
    return { ok: false, motif: 'Choisissez un mot de passe d’au moins 12 caractères.' }
  }

  const empreinte = await hashPassword(args.motDePasse)

  try {
    await prisma.$transaction(async (tx) => {
      // Revérifié **dans** la transaction : deux requêtes simultanées sur une
      // base neuve ne doivent pas fabriquer deux administrateurs.
      if ((await tx.user.count()) > 0) throw new Error('DEJA_PEUPLEE')
      await tx.user.create({
        data: {
          email: args.email.trim().toLowerCase(),
          name: args.name.trim(),
          passwordHash: empreinte,
          role: 'ADMIN',
        },
      })
    })
  } catch {
    return {
      ok: false,
      motif: 'Cette instance a déjà un compte : la création du premier administrateur est close.',
    }
  }

  return { ok: true, motif: '' }
}
```

- [ ] **Step 4: brancher l'écran**

Dans `src/app/(auth)/login/actions.ts`, ajouter :

```ts
export type PremierAdminState = { ok: boolean; message: string } | null

export async function creerPremierAdmin(
  _precedent: PremierAdminState,
  formData: FormData,
): Promise<PremierAdminState> {
  const r = await creerPremierAdministrateur({
    email: String(formData.get('email') ?? ''),
    name: String(formData.get('name') ?? ''),
    motDePasse: String(formData.get('motDePasse') ?? ''),
  })
  if (!r.ok) return { ok: false, message: r.motif }
  return { ok: true, message: 'Compte créé. Connectez-vous avec ces identifiants.' }
}
```

avec `import { creerPremierAdministrateur } from '@/services/auth/comptes'` en tête.

Créer `src/app/(auth)/login/PremierAdminForm.tsx` :

```tsx
'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { creerPremierAdmin, type PremierAdminState } from './actions'

/**
 * Le seul écran du produit où un humain décide du rôle d'un compte — et c'est
 * un administrateur, parce que lui seul pourra ensuite configurer Dolibarr et
 * Google.
 *
 * Il ne s'affiche que sur une base **sans aucun utilisateur**. Cette condition
 * ne se reproduit jamais d'elle-même : vraie une fois, à l'installation, fausse
 * pour toujours ensuite.
 */
export function PremierAdminForm() {
  const [etat, formAction, enCours] = useActionState<PremierAdminState, FormData>(
    creerPremierAdmin,
    null,
  )

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-3">
        {etat !== null && <Banner tone={etat.ok ? 'success' : 'danger'}>{etat.message}</Banner>}
        <p className="text-sm text-muted">
          Cette instance n’a encore aucun compte. Créez celui de l’administrateur : il pourra
          ensuite connecter Dolibarr et Google.
        </p>
        <Field label="Nom" name="name" required />
        <Field label="Adresse e-mail" name="email" type="email" required />
        <Field label="Mot de passe" name="motDePasse" type="password" required />
        <Button type="submit" variant="primary" disabled={enCours}>
          Créer le premier administrateur
        </Button>
      </form>
    </Card>
  )
}
```

Dans `src/app/(auth)/login/page.tsx`, en tête du composant :

```tsx
  const premierDemarrage = await aucunUtilisateur()
```

et, juste après le `<h1>` :

```tsx
      {premierDemarrage ? (
        <PremierAdminForm />
      ) : (
        <>{/* le formulaire de connexion existant, inchangé, et la suite */}</>
      )}
```

avec `import { aucunUtilisateur } from '@/services/auth/comptes'` et
`import { PremierAdminForm } from './PremierAdminForm'` en tête du fichier.

- [ ] **Step 5: exécuter**

```bash
npx tsc --noEmit
npx vitest run src/services/auth/comptes.test.ts "src/app/(auth)"
```

Expected: PASS.

- [ ] **Step 6: muter**

Supprimer la revérification `if ((await tx.user.count()) > 0) throw` — le test
« refuse dès qu un compte existe » doit **échouer**. Restaurer.

- [ ] **Step 7: commit**

```bash
git add src/services/auth "src/app/(auth)/login"
git commit -m "feat(auth): l'ecran de premier demarrage brise le cercle"
```

---

## Task 7 : extraire la seconde moitié de `connectGoogle`

Remaniement pur, sans changement de comportement : c'est la fonction que le
parcours Auth.js appellera avec des jetons, là où `connectGoogle` part d'un code.

**Files:**
- Modify: `src/services/google/connect.ts`
- Test: `src/services/google/connect.test.ts`

**Interfaces:**
- Consumes: `saveCredential`, `setCalendarId`, `revokeCredential`,
  `ensureDedicatedCalendar`, `CALENDRIER_DEDIE`.
- Produces:
  `enregistrerEtPreparerAgenda(args: { userId: string; jetons: { accessToken: string; refreshToken: string; expiresAt: Date; scope: string }; fetchFn?: FetchLike }): Promise<{ calendarId: string }>`

- [ ] **Step 1: écrire le test de la fonction extraite**

À la fin de `src/services/google/connect.test.ts` :

Ce fichier dispose déjà, au niveau du module, de `userId` et de
`api: FakeGoogleApi` (créé par `createFakeGoogleApi()` dans son `beforeEach`).
Les tests existants appellent `connectGoogle({ userId, code: '…', fetchFn: api.fetchFn })` ;
les deux nouveaux suivent le même idiome.

```ts
const JETONS = {
  accessToken: 'jeton-acces',
  refreshToken: 'jeton-rafraichissement',
  expiresAt: new Date('2026-08-22T11:00:00.000Z'),
  scope: 'https://www.googleapis.com/auth/calendar',
}

describe('enregistrerEtPreparerAgenda', () => {
  it('enregistre le jeton et pose le calendrier dédié', async () => {
    const r = await enregistrerEtPreparerAgenda({
      userId,
      jetons: JETONS,
      fetchFn: api.fetchFn,
    })

    expect(r.calendarId).not.toBe('')
    const etat = await getConnectionState(userId)
    expect(etat.connected).toBe(true)
    expect(etat.calendarId).toBe(r.calendarId)
  })

  // Un compte enregistré sans calendrier afficherait « connecté » tout en étant
  // inutilisable, et l'utilisateur n'aurait aucune raison de recommencer.
  it("n'enregistre rien quand le calendrier échoue", async () => {
    const fetchFn: typeof api.fetchFn = async (url, init) => {
      if (String(url).includes('/calendars')) throw new Error('calendrier indisponible')
      return api.fetchFn(url, init)
    }

    await expect(
      enregistrerEtPreparerAgenda({ userId, jetons: JETONS, fetchFn }),
    ).rejects.toThrow()

    expect((await getConnectionState(userId)).connected).toBe(false)
  })
})
```

Ajouter `enregistrerEtPreparerAgenda` à la ligne d'import depuis `./connect`.

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/services/google/connect.test.ts`
Expected: FAIL, `enregistrerEtPreparerAgenda is not exported`

- [ ] **Step 3: extraire**

Dans `src/services/google/connect.ts`, remplacer le corps de `connectGoogle`
après l'échange par un appel, et exporter la nouvelle fonction :

```ts
/**
 * Enregistre les jetons et pose le calendrier dédié — **ou n'enregistre rien**.
 *
 * Les deux entrées de la connexion Google passent par ici : le connecteur, qui
 * part d'un code d'autorisation, et la connexion à l'application, où Auth.js a
 * déjà fait l'échange. Une seule implémentation du comportement, deux portes
 * vers elle : c'est ce qui garantit qu'elles ne divergeront pas.
 */
export async function enregistrerEtPreparerAgenda(args: {
  userId: string
  jetons: { accessToken: string; refreshToken: string; expiresAt: Date; scope: string }
  fetchFn?: FetchLike
}): Promise<{ calendarId: string }> {
  const fetchFn = args.fetchFn ?? (globalThis.fetch as unknown as FetchLike)
  await saveCredential(args.userId, PROVIDER_GOOGLE, { ...args.jetons, calendarId: '' })

  try {
    const calendarId = await ensureDedicatedCalendar(
      fetchFn,
      args.jetons.accessToken,
      CALENDRIER_DEDIE,
    )
    await setCalendarId(args.userId, PROVIDER_GOOGLE, calendarId)
    return { calendarId }
  } catch (err) {
    journalErreur('google.connexion', err, { userId: args.userId, etape: 'calendrier-dedie' })
    await revokeCredential(args.userId, PROVIDER_GOOGLE)
    throw err
  }
}
```

et `connectGoogle` devient :

```ts
  const jetons = await exchangeCode(fetchFn, client, args.code)
  return enregistrerEtPreparerAgenda({ userId: args.userId, jetons, fetchFn })
```

- [ ] **Step 4: exécuter la suite entière**

Run: `npx vitest run src/services/google`
Expected: PASS. Les tests existants de `connectGoogle` doivent passer
**inchangés** — c'est la preuve que le remaniement n'a rien déplacé.

- [ ] **Step 5: commit**

```bash
git add src/services/google/connect.ts src/services/google/connect.test.ts
git commit -m "refactor(google): une seule implementation, deux portes vers elle"
```

---

## Task 8 : la configuration paresseuse d'Auth.js

Le client OAuth vit **chiffré en base** ; un fournisseur Auth.js se déclare au
chargement du module. Cette tâche règle la contradiction **sans** encore ajouter
Google : elle prouve que rien ne casse.

**Files:**
- Modify: `src/auth.ts`
- Test: `src/auth.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `NextAuth` construit par une fonction, prêt à recevoir un
  fournisseur lu en base.

- [ ] **Step 1: transformer l'appel**

Dans `src/auth.ts`, remplacer `NextAuth({ ...authConfig, providers: [...] })` par :

```ts
/**
 * La configuration est construite **par requête**, et non figée au chargement.
 *
 * La raison est concrète : le client OAuth de l'instance — identifiant et
 * secret — est saisi dans Administration · Google et stocké chiffré en base. Un
 * fournisseur déclaré à l'import ne pourrait pas le lire. La bibliothèque
 * accepte une fonction là où on attendrait un objet ; c'est ce qui permet de
 * n'exposer une porte que lorsqu'elle mène quelque part.
 *
 * Le coût est d'une lecture par requête d'authentification — le même prix que
 * `requireUser()` paie déjà, pour la même raison : une configuration qui dit
 * vrai vaut mieux qu'une configuration figée au démarrage.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(async () => ({
  ...authConfig,
  providers: [fournisseurMotDePasse()],
}))
```

en déplaçant le `Credentials({...})` existant dans une fonction
`fournisseurMotDePasse()` déclarée juste au-dessus, **sans en changer une ligne**.

- [ ] **Step 2: exécuter la suite d'authentification**

```bash
npx tsc --noEmit
npx vitest run src/auth.test.ts src/middleware.test.ts "src/app/(auth)"
```

Expected: PASS, sans modifier un seul test. Un test qui casserait ici signalerait
que le remaniement a changé le comportement, ce qu'il ne doit pas.

- [ ] **Step 3: commit**

```bash
git add src/auth.ts
git commit -m "refactor(auth): configuration paresseuse, pour lire le client en base"
```

---

## Task 9 : le fournisseur Google et la règle de liaison

**Files:**
- Modify: `src/services/auth/comptes.ts`, `src/services/auth/comptes.test.ts`
- Modify: `src/auth.ts`

**Interfaces:**
- Consumes: `readGoogleOAuthClient()` de `@/services/google/oauth-client` ;
  `enregistrerEtPreparerAgenda` (Task 7).
- Produces:
  `lierOuCreerCompteGoogle(args: { email: string; emailVerifie: boolean; nom: string }): Promise<{ id: string; role: string } | null>`

- [ ] **Step 1: écrire le test de la règle**

À la fin de `src/services/auth/comptes.test.ts` :

```ts
describe('lierOuCreerCompteGoogle', () => {
  // La fusion repose entièrement sur l'adresse : une adresse non vérifiée
  // permettrait de prendre le compte de quelqu'un d'autre en la déclarant.
  it('refuse une adresse que Google ne déclare pas vérifiée', async () => {
    expect(
      await lierOuCreerCompteGoogle({
        email: 'comptes-avec@test.local',
        emailVerifie: false,
        nom: 'A',
      }),
    ).toBeNull()
  })

  it('retrouve le compte existant, sans le dupliquer', async () => {
    const r = await lierOuCreerCompteGoogle({
      email: 'comptes-avec@test.local',
      emailVerifie: true,
      nom: 'Autre nom',
    })

    expect(r?.id).toBe(avec)
    expect(await prisma.user.count({ where: { email: 'comptes-avec@test.local' } })).toBe(1)
  })

  it('crée le compte absent, au rôle le moins doté', async () => {
    const r = await lierOuCreerCompteGoogle({
      email: 'comptes-nouveau@test.local',
      emailVerifie: true,
      nom: 'Nouvelle Personne',
    })

    expect(r).not.toBeNull()
    const cree = await prisma.user.findUniqueOrThrow({
      where: { email: 'comptes-nouveau@test.local' },
    })
    expect(cree.role).toBe('CONSULTANT')
    expect(cree.name).toBe('Nouvelle Personne')
    // Pas de mot de passe : la seconde porte reste fermée jusqu'à ce qu'il en
    // définisse un par courriel.
    expect(cree.passwordHash).toBe('')
  })

  // Google rend l'adresse telle que l'utilisateur l'a écrite ; la nôtre est
  // unique et stockée en minuscules. Sans normalisation, « Keveen@… » créerait
  // un second compte à côté de « keveen@… ».
  it('normalise la casse de l adresse', async () => {
    const r = await lierOuCreerCompteGoogle({
      email: 'Comptes-Avec@Test.Local',
      emailVerifie: true,
      nom: 'A',
    })
    expect(r?.id).toBe(avec)
  })
})
```

- [ ] **Step 2: exécuter, et constater l'échec**

Run: `npx vitest run src/services/auth/comptes.test.ts`
Expected: FAIL, `lierOuCreerCompteGoogle is not a function`

- [ ] **Step 3: écrire la règle**

À la fin de `src/services/auth/comptes.ts` :

```ts
/**
 * La règle de fusion : un compte Google et un compte local qui portent la même
 * adresse sont **le même compte**.
 *
 * Auth.js sait parler à Google ; il ne sait pas, seul, fusionner deux comptes.
 * L'application n'ayant pas d'adaptateur de base, il n'existe pas de table
 * `Account` dont le comportement par défaut refuserait une adresse déjà prise :
 * la règle est ici, en clair, et elle s'éprouve.
 *
 * **L'adresse vérifiée n'est pas une formalité.** Toute la fusion repose sur
 * elle : accepter une adresse non vérifiée reviendrait à laisser quiconque
 * prendre le compte d'un autre en la déclarant.
 */
export async function lierOuCreerCompteGoogle(args: {
  email: string
  emailVerifie: boolean
  nom: string
}): Promise<{ id: string; role: string } | null> {
  if (!args.emailVerifie) return null

  // Google rend l'adresse telle que l'utilisateur l'a écrite ; la nôtre est
  // unique. Sans normalisation, une majuscule créerait un second compte.
  const email = args.email.trim().toLowerCase()
  if (email === '') return null

  const existant = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  })
  if (existant !== null) return existant

  const cree = await prisma.user.create({
    data: {
      email,
      name: args.nom.trim() === '' ? email : args.nom.trim(),
      // Pas de mot de passe : la porte locale reste fermée jusqu'à ce qu'il en
      // définisse un par courriel.
      passwordHash: '',
      // Jamais le défaut de la colonne, qui vaut `ADMIN`.
      role: 'CONSULTANT',
    },
    select: { id: true, role: true },
  })
  return cree
}
```

- [ ] **Step 4: brancher le fournisseur**

Dans `src/auth.ts`, ajouter au-dessus de l'appel `NextAuth` :

```ts
/**
 * Le fournisseur Google, **ou rien**.
 *
 * Sans client OAuth enregistré, la liste ne le porte pas — et le bouton
 * disparaît de l'écran de connexion. Une porte qui ne mène nulle part ne
 * s'affiche pas grisée : elle ne s'affiche pas.
 */
async function fournisseurGoogle() {
  const client = await readGoogleOAuthClient()
  if (client === null) return []

  return [
    Google({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      authorization: {
        params: {
          // L'agenda dans le même consentement — arbitrage du porteur.
          //
          // **Quatre scopes ici, un seul dans le connecteur** : c'est voulu, et
          // `src/services/google/connect.test.ts` garde la règle inverse. Le
          // connecteur ne demande que le calendrier parce qu'il ne fait que ça ;
          // cette porte identifie **et** connecte, donc elle demande les deux.
          // Ce qu'aucune des deux ne fait, c'est `include_granted_scopes` :
          // mesuré le 22 août 2026 sur l'instance du porteur, il fait hériter le
          // jeton de tout ce que le projet Google a jamais obtenu — `gmail.send`
          // compris. Auth.js ne l'ajoute pas ; ne pas l'ajouter non plus.
          scope: 'openid email profile https://www.googleapis.com/auth/calendar',
          // `offline` demande un jeton de rafraîchissement ; `consent` garantit
          // qu'il revient **à chaque connexion**. Sans lui, Google ne le rend
          // qu'à la première autorisation, et un compte reconnecté après une
          // révocation resterait sans jeton, silencieusement.
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ]
}
```

et la configuration devient :

```ts
export const { handlers, auth, signIn, signOut } = NextAuth(async () => ({
  ...authConfig,
  providers: [fournisseurMotDePasse(), ...(await fournisseurGoogle())],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile, user }) {
      if (account?.provider !== 'google') return true

      const compte = await lierOuCreerCompteGoogle({
        email: String(profile?.email ?? ''),
        emailVerifie: profile?.email_verified === true,
        nom: String(profile?.name ?? ''),
      })
      if (compte === null) return false

      // Le jeton d'agenda part vers `ProviderCredential`, là où le connecteur
      // Calendar le lit déjà. L'échec ne bloque pas l'entrée : `connectGoogle`
      // annule alors son propre enregistrement, Synchro affiche « non
      // connecté », et son bouton répare. Entrer pour saisir ses temps ne
      // dépend pas de la santé de l'API Calendar.
      if (typeof account.access_token === 'string' && typeof account.refresh_token === 'string') {
        try {
          await enregistrerEtPreparerAgenda({
            userId: compte.id,
            jetons: {
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: new Date((account.expires_at ?? 0) * 1000),
              scope: String(account.scope ?? ''),
            },
          })
        } catch {
          // Déjà journalisé par `enregistrerEtPreparerAgenda`.
        }
      }

      // Le jeton de session doit porter **notre** identifiant, pas celui de
      // Google : tout le reste de l'application lit `User.id`.
      user.id = compte.id
      ;(user as { role?: string }).role = compte.role
      return true
    },
  },
}))
```

avec, en tête du fichier :

```ts
import Google from 'next-auth/providers/google'
import { readGoogleOAuthClient } from '@/services/google/oauth-client'
import { enregistrerEtPreparerAgenda } from '@/services/google/connect'
import { lierOuCreerCompteGoogle } from '@/services/auth/comptes'
```

- [ ] **Step 5: exécuter, et muter**

```bash
npx tsc --noEmit
npx vitest run src/services/auth src/auth.test.ts
```

Expected: PASS.

Puis deux mutations, restaurées aussitôt :
1. `if (!args.emailVerifie) return null` → `if (false) return null` : un test doit
   échouer ;
2. `role: 'CONSULTANT'` → `role: 'ADMIN'` : un test doit échouer.

- [ ] **Step 6: commit**

```bash
git add src/auth.ts src/services/auth/comptes.ts src/services/auth/comptes.test.ts
git commit -m "feat(auth): la porte Google, et la fusion par adresse verifiee"
```

---

## Task 10 : le bouton Google sur l'écran de connexion

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/actions.ts`
- Create: `src/app/(auth)/login/page.test.tsx`

**Interfaces:**
- Consumes: `signIn` de `@/auth` ; `getGoogleOAuthClientView()` de
  `@/services/google/oauth-client`.
- Produces: rien.

- [ ] **Step 1: écrire l'action**

Dans `src/app/(auth)/login/actions.ts` :

```ts
/**
 * `signIn('google')` redirige ; la redirection de Next passe par une exception
 * qu'il ne faut surtout pas avaler.
 */
export async function connexionGoogle(): Promise<void> {
  await signIn('google', { redirectTo: '/saisie' })
}
```

- [ ] **Step 2: écrire le test de l'écran**

`src/app/(auth)/login/page.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { getGoogleOAuthClientView, aucunUtilisateur } = vi.hoisted(() => ({
  getGoogleOAuthClientView: vi.fn(),
  aucunUtilisateur: vi.fn(),
}))
vi.mock('@/services/google/oauth-client', () => ({ getGoogleOAuthClientView }))
vi.mock('@/services/auth/comptes', () => ({ aucunUtilisateur }))
vi.mock('./actions', () => ({ login: vi.fn(), connexionGoogle: vi.fn(), creerPremierAdmin: vi.fn() }))

import LoginPage from './page'

beforeEach(() => {
  getGoogleOAuthClientView.mockReset().mockResolvedValue({ clientId: '123', redirectUri: 'x' })
  aucunUtilisateur.mockReset().mockResolvedValue(false)
})
afterEach(cleanup)

async function rendre() {
  render(await LoginPage({ searchParams: Promise.resolve({}) }))
}

describe('l écran de connexion', () => {
  it('propose les deux portes quand un client Google est enregistré', async () => {
    await rendre()
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Google/ })).toBeTruthy()
  })

  // Une porte qui ne mène nulle part ne s'affiche pas grisée : elle ne
  // s'affiche pas. Sans client, `signIn('google')` échouerait sur un
  // `invalid_client` illisible.
  it("n'affiche pas le bouton Google sans client enregistré", async () => {
    getGoogleOAuthClientView.mockResolvedValue(null)
    await rendre()
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy()
  })

  it('renvoie vers la définition du mot de passe', async () => {
    await rendre()
    const lien = screen.getByRole('link', { name: /mot de passe/i })
    expect(lien.getAttribute('href')).toBe('/mot-de-passe')
  })
})
```

- [ ] **Step 3: exécuter, et constater l'échec**

Run: `npx vitest run "src/app/(auth)/login/page.test.tsx"`
Expected: FAIL, pas de bouton Google.

- [ ] **Step 4: rendre le bouton**

Dans `src/app/(auth)/login/page.tsx`, après le formulaire de connexion :

```tsx
        {clientGoogle !== null && (
          <form action={connexionGoogle} className="mt-3">
            <Button type="submit">Se connecter avec Google</Button>
          </form>
        )}
```

avec, en tête du composant :

```tsx
  const clientGoogle = await getGoogleOAuthClientView()
```

- [ ] **Step 5: exécuter, et muter**

Run: `npx vitest run "src/app/(auth)/login/page.test.tsx"`
Expected: PASS.

Mutation : remplacer `clientGoogle !== null` par `true` — le test « n'affiche pas
le bouton Google sans client » doit **échouer**. Restaurer.

- [ ] **Step 6: commit**

```bash
git add "src/app/(auth)/login"
git commit -m "feat(auth): le bouton Google, present seulement s'il mene quelque part"
```

---

## Task 11 : la recette, et la dette nommée

**Files:**
- Modify: `docs/MISE-EN-OEUVRE.md` (le créer s'il n'existe pas)
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

Expected: tout au vert. Aucun de ces trois n'est facultatif : le `build` attrape
ce que `tsc` laisse passer sur les composants serveur.

- [ ] **Step 2: recette manuelle, contre l'instance du porteur**

Déclarer chez Google, dans « URI de redirection autorisés », **les deux** :

```
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/google/callback
```

Puis, dans cet ordre :

1. se connecter par mot de passe — inchangé ;
2. se déconnecter, se connecter par Google — on retombe sur **le même compte** ;
3. vérifier dans Réglages · Synchro que l'agenda est connecté ;
4. « Définir ou réinitialiser mon mot de passe » sur une adresse connue, puis sur
   une inconnue : **même message** ;
5. suivre le lien reçu, poser un mot de passe, se connecter avec.

- [ ] **Step 3: écrire la note de mise en œuvre**

Ajouter à `docs/MISE-EN-OEUVRE.md` une section « Connexion » portant les deux URI
ci-dessus, la mention que **le port en fait partie**, et le rappel que le type
« Interne » de l'écran de consentement exige une organisation Google Workspace ou
Cloud Identity.

- [ ] **Step 4: nommer la dette**

Ajouter à `docs/superpowers/ETAT.md` :

```markdown
## Dette ouverte par la double authentification (22 août 2026)

Ce lot crée automatiquement un compte à la première connexion Google, au rôle
`CONSULTANT`. Mais **les rôles ne sont pas appliqués** : un compte `CONSULTANT`
voit aujourd'hui exactement ce que voit un administrateur. Toute personne du
domaine Workspace de l'hébergeur peut donc entrer et tout faire.

Le porteur a assumé cette fenêtre en la bornant : le lot des rôles — spécifié le
19 août — **suit immédiatement**. Il porte aussi le drapeau de désactivation d'un
compte, aujourd'hui absent : couper un accès oblige à supprimer le compte, ce qui
détruit ses saisies.

Ce n'est pas une évolution souhaitable, c'est une dette datée.
```

- [ ] **Step 5: commit**

```bash
git add docs/MISE-EN-OEUVRE.md docs/superpowers/ETAT.md
git commit -m "docs: la recette des deux portes, et la dette qu'elles ouvrent"
```

---

## Ce que ce plan ne fait pas

Repris de la spec, pour qu'un exécutant ne le redécouvre pas en chemin : pas de
dissociation d'un compte et de son Google, pas de changement d'adresse, pas de
second facteur, pas de limitation de débit, pas d'application des rôles, pas de
flux iCal ni de Microsoft 365. Chacune de ces absences a son cas d'usage et son
coût dans la section « Ce que le lot ne fait pas, et ce que ça coûte » de la
spec. Aucune n'est un oubli.
