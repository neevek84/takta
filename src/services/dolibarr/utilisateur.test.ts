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
