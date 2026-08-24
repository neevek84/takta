// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// La page est un composant serveur : elle appelle la session et les services
// avant de rendre. On leur substitue des doubles, le sujet du test étant le
// contrat de la page (filtre, mois transmis, sections annexes), pas la base.
const { cras, souffrance, etatsRecus, monthRecu } = vi.hoisted(() => ({
  cras: [] as unknown[],
  souffrance: [] as unknown[],
  etatsRecus: [] as unknown[],
  monthRecu: { valeur: undefined as string | undefined },
}))

vi.mock('@/auth', () => ({
  requireUser: async () => ({ id: 'u1', role: 'ADMIN' as const }),
}))
vi.mock('@/services/cra', () => ({
  listCrasSuivi: async (_userId: string, args: { etats: unknown[]; month?: string }) => {
    etatsRecus.length = 0
    etatsRecus.push(...args.etats)
    monthRecu.valeur = args.month
    return cras
  },
  listCrasEnSouffrance: async () => souffrance,
}))
vi.mock('./actions', () => ({
  lancerRelances: vi.fn(),
}))
// `FiltreEtats` est un composant client : il lit `next/navigation`, absent
// hors de Next. La page le rend réellement — seul le routeur est doublé.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import SuiviCraPage from './page'

function unCra(
  status = 'ENVOYE',
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
    previsionnelAAnnuler: 0,
    iraDansDolibarr: false,
    synthese: { totalCentiemes: 0, joursServis: 0, lignes: [] },
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
  jeu: {
    cras?: unknown[]
    souffrance?: unknown[]
    searchParams?: { etats?: string; month?: string }
  } = {},
): Promise<ReturnType<typeof render>> {
  cras.length = 0
  cras.push(...(jeu.cras ?? []))
  souffrance.length = 0
  souffrance.push(...(jeu.souffrance ?? []))
  return render(
    await SuiviCraPage({
      searchParams: Promise.resolve(jeu.searchParams ?? {}),
    }),
  )
}

afterEach(cleanup)

describe('page Suivi CRA — le tableau, pas les cartes', () => {
  it('rend un tableau et non des cartes', async () => {
    await rendre({ cras: [unCra('ENVOYE')] })

    expect(screen.getByRole('table')).toBeTruthy()
  })

  // Aucun bouton de transition n'atteint la page depuis le tableau : le
  // détail est le seul endroit qui puisse valider, envoyer ou refuser.
  it('n offre aucun bouton de transition sur les lignes du tableau', async () => {
    await rendre({ cras: [unCra('ENVOYE')] })

    expect(screen.queryByRole('button', { name: 'Marquer validé' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Marquer envoyé' })).toBeNull()
  })

  it('n annonce plus le mois dans le titre : le suivi couvre toutes les periodes', async () => {
    await rendre({ cras: [unCra('ENVOYE')] })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Suivi CRA')
  })
})

describe('page Suivi CRA — le filtre par etat', () => {
  it('applique le defaut quand l adresse ne dit rien', async () => {
    await rendre()

    expect(etatsRecus).toEqual(['BROUILLON', 'ENVOYE', 'REFUSE'])
  })

  it('transmet exactement les etats demandes par l adresse', async () => {
    await rendre({ searchParams: { etats: 'VALIDE,FACTURE' } })

    expect(etatsRecus).toEqual(['VALIDE', 'FACTURE'])
  })

  it('dit qu aucun etat n est selectionne plutot que de paraitre vide', async () => {
    await rendre({ searchParams: { etats: '' } })

    expect(screen.getByText(/Aucun état sélectionné/)).toBeTruthy()
  })

  // Zero etat coche n'interroge pas la base pour rien : `listCrasSuivi`
  // repond deja `[]`, mais le tableau ne doit meme pas etre demande.
  it('ne rend pas de tableau quand aucun etat n est selectionne', async () => {
    await rendre({ cras: [unCra('ENVOYE')], searchParams: { etats: '' } })

    expect(screen.queryByRole('table')).toBeNull()
  })

  it('propose les cases du filtre', async () => {
    await rendre()

    expect(screen.getByRole('checkbox', { name: 'Envoyé' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Facturé' })).toBeTruthy()
  })
})

describe('page Suivi CRA — le mois reste un parametre lu', () => {
  // Les ecrans qui liaient vers `/cra?month=…` (le plan de charge, les
  // rappels) doivent continuer de fonctionner : le mois filtre toujours la
  // liste quand il est present, sans devenir obligatoire.
  it('ne transmet aucun mois quand l adresse n en porte pas', async () => {
    await rendre()

    expect(monthRecu.valeur).toBeUndefined()
  })

  it('transmet le mois demande par l adresse', async () => {
    await rendre({ searchParams: { month: '2026-03' } })

    expect(monthRecu.valeur).toBe('2026-03')
  })
})

describe('page Suivi CRA — la souffrance et les relances', () => {
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

  it('offre les relances des qu une signature est en attente, sans souffrance prealable', async () => {
    await rendre({
      cras: [unCra('ENVOYE', 'cra-1', { signature: uneSignature() })],
      souffrance: [],
    })

    expect(screen.queryByRole('heading', { name: /en souffrance/i })).toBeNull()
    expect(screen.getByRole('button', { name: /lancer les relances/i })).toBeTruthy()
  })

  it('n offre pas les relances quand aucune signature n est en attente', async () => {
    await rendre({ cras: [unCra('BROUILLON'), unCra('VALIDE', 'cra-2')] })
    expect(screen.queryByRole('button', { name: /lancer les relances/i })).toBeNull()
  })

  // `lancerRelances` ne redirige plus vers un mois : le bouton n'a donc plus
  // besoin de le porter dans un champ caché.
  it('ne porte plus de mois cache sur le bouton de relance', async () => {
    const { container } = await rendre({
      cras: [unCra('ENVOYE', 'cra-1', { signature: uneSignature() })],
    })

    const bouton = screen.getByRole('button', { name: /lancer les relances/i })
    const formulaire = bouton.closest('form') as HTMLFormElement
    expect(formulaire.querySelector('input[name="month"]')).toBeNull()
  })
})
