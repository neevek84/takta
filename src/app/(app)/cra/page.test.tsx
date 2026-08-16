// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { CraStatus } from '@/core/types'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'

// La page est un composant serveur : elle appelle la session et les services
// avant de rendre. On leur substitue des doubles, le sujet du test étant le
// contrat de formulaire et le respect de la machine à états, pas la base.
const { cras, missions, previewCraInvoice } = vi.hoisted(() => ({
  cras: [] as unknown[],
  missions: [] as unknown[],
  previewCraInvoice: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser: async () => ({ id: 'u1', role: 'ADMIN' as const }),
}))
vi.mock('@/services/cra', () => ({ listCras: async () => cras }))
vi.mock('@/services/missions', () => ({ listMissionsForUser: async () => missions }))
vi.mock('@/services/dolibarr/invoicing', () => ({ previewCraInvoice }))
vi.mock('./actions', () => ({
  openCra: vi.fn(),
  moveCra: vi.fn(),
  saveTracking: vi.fn(),
  demanderFacture: vi.fn(),
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import CraPage from './page'

const LIBELLES: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
}

const TOUTES: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR']
const STATUTS: CraStatus[] = ['BROUILLON', 'ENVOYE', 'VALIDE', 'REFUSE']

function unCra(status: CraStatus, id = 'cra-1'): Record<string, unknown> {
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
  }
}

/** Un brouillon tel que `previewCraInvoice` le rend : entiers partout. */
const DRAFT = {
  socid: 42,
  month: '2026-03',
  lines: [
    { lineId: 'l1', label: 'Développement', qteCentiemes: 2000, tjmCents: 80_000, totalHtCents: 1_600_000 },
  ],
  totalHtCents: 1_600_000,
}

async function rendre(
  jeu: {
    cras?: unknown[]
    missions?: unknown[]
    draft?: unknown
    params?: { message?: string; tone?: string }
  } = {},
): Promise<ReturnType<typeof render>> {
  cras.length = 0
  cras.push(...(jeu.cras ?? []))
  missions.length = 0
  missions.push(...(jeu.missions ?? [{ id: 'm1', clientName: 'ACME', label: 'ITSM' }]))
  previewCraInvoice.mockReset().mockResolvedValue(jeu.draft ?? null)
  return render(
    await CraPage({
      searchParams: Promise.resolve({ month: '2026-03', ...(jeu.params ?? {}) }),
    }),
  )
}

describe('page CRA', () => {
  afterEach(cleanup)

  it('affiche le mois demandé', async () => {
    await rendre()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('2026-03')
  })

  it('n ouvre pas un CRA sans mission choisie', async () => {
    // Le service crée le CRA à partir de `missionId` : soumettre le formulaire
    // vide écrirait sur une chaîne vide sans que rien ne l'arrête côté client.
    await rendre()
    const choix = screen.getByLabelText('Mission') as HTMLSelectElement
    expect(choix.required).toBe(true)
    expect(choix.name).toBe('missionId')
  })

  it('transmet le mois affiché au formulaire d ouverture', async () => {
    const { container } = await rendre()
    const mois = container.querySelector('input[name="month"]') as HTMLInputElement | null
    expect(mois).not.toBeNull()
    expect(mois!.value).toBe('2026-03')
  })

  it('affiche un message quand aucun CRA n est ouvert', async () => {
    await rendre({ cras: [] })
    expect(screen.getByText(/Aucun CRA ouvert/)).toBeDefined()
  })

  // Sans `craId`, le suivi de facturation s'écrirait sur un identifiant vide :
  // `saveTracking` lit ce champ et n'a aucun autre moyen de savoir quel CRA
  // il met à jour.
  it('porte l identifiant du CRA sur chaque formulaire de la carte', async () => {
    const { container } = await rendre({ cras: [unCra('ENVOYE', 'cra-42')] })
    const formulaires = Array.from(container.querySelectorAll('form'))
    // Ouverture + transitions de `ENVOYE` (valider, refuser) + suivi.
    expect(formulaires.length).toBeGreaterThan(1)

    for (const formulaire of formulaires.slice(1)) {
      const champ = formulaire.querySelector('input[name="craId"]') as HTMLInputElement | null
      expect(champ, formulaire.outerHTML).not.toBeNull()
      expect(champ!.value).toBe('cra-42')
    }
  })

  it('nomme les champs de suivi comme l action serveur les lit', async () => {
    const { container } = await rendre({ cras: [unCra('BROUILLON')] })
    for (const nom of ['invoiceNumber', 'invoicedAt', 'paidAt']) {
      expect(container.querySelector(`[name="${nom}"]`), nom).not.toBeNull()
    }
  })

  // La machine à états est la règle ; l'interface ne doit jamais proposer une
  // transition que `canTransition` refuse.
  describe('transitions offertes', () => {
    for (const status of STATUTS) {
      const autorisees = TOUTES.filter((t) => canTransition(status, t))
      const refusees = TOUTES.filter((t) => !canTransition(status, t))

      it(`n offre depuis ${status} que ${autorisees.join(', ') || 'rien'}`, async () => {
        await rendre({ cras: [unCra(status)] })

        for (const t of autorisees) {
          expect(screen.queryByRole('button', { name: LIBELLES[t] }), t).not.toBeNull()
        }
        for (const t of refusees) {
          expect(screen.queryByRole('button', { name: LIBELLES[t] }), t).toBeNull()
        }
      })

      it(`transmet la transition demandée depuis ${status}`, async () => {
        const { container } = await rendre({ cras: [unCra(status)] })
        const valeurs = Array.from(
          container.querySelectorAll('input[name="transition"]'),
        ).map((n) => (n as HTMLInputElement).value)
        expect(valeurs.sort()).toEqual([...autorisees].sort())
      })
    }
  })

  describe('proposition de facture', () => {
    const BOUTON = 'Demander la facture à Dolibarr (brouillon)'

    it('propose la facture d un CRA validé, et dit ce qui serait demandé', async () => {
      await rendre({ cras: [unCra('VALIDE')], draft: DRAFT })

      expect(previewCraInvoice).toHaveBeenCalledWith({ userId: 'u1', craId: 'cra-1' })
      expect(screen.getByRole('button', { name: BOUTON })).toBeTruthy()
      // Câblée sur un tableau vide, la section annoncerait un total sans dire
      // sur quoi il porte.
      expect(screen.getByText(/Développement/)).toBeTruthy()
      expect(screen.getByText(/20,00 jour/)).toBeTruthy()
      expect(screen.getByText(/16 000,00/)).toBeTruthy()
    })

    it('ne propose rien quand le service n a rien à proposer', async () => {
      // Dolibarr non connecté, client sans tiers, mois sans réalisé : la page
      // ne distingue pas, elle n'affiche simplement pas de bouton.
      await rendre({ cras: [unCra('VALIDE')], draft: null })
      expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
    })

    for (const status of STATUTS.filter((s) => s !== 'VALIDE')) {
      it(`ne demande même pas de proposition depuis ${status}`, async () => {
        await rendre({ cras: [unCra(status)], draft: DRAFT })
        expect(previewCraInvoice).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
      })
    }

    it('porte le CRA et le mois affiché sur la demande', async () => {
      const { container } = await rendre({ cras: [unCra('VALIDE', 'cra-42')], draft: DRAFT })
      const formulaire = screen
        .getByRole('button', { name: BOUTON })
        .closest('form') as HTMLFormElement
      expect(container.contains(formulaire)).toBe(true)

      const champ = (nom: string) =>
        (formulaire.querySelector(`input[name="${nom}"]`) as HTMLInputElement | null)?.value
      expect(champ('craId')).toBe('cra-42')
      // Sans le mois, répondre ramènerait l'utilisateur sur le mois courant.
      expect(champ('month')).toBe('2026-03')
    })

    it('rappelle que Dolibarr facture, pas l application', async () => {
      await rendre({ cras: [unCra('VALIDE')], draft: DRAFT })
      expect(screen.getByText(/ne numérote rien/)).toBeTruthy()
      expect(screen.getByText(/aucune conséquence/)).toBeTruthy()
    })
  })

  describe('message de retour', () => {
    it('rend un refus comme un refus, glyphe compris', async () => {
      await rendre({ params: { message: 'Dolibarr a refusé la demande.', tone: 'danger' } })

      const bandeau = screen.getByRole('alert')
      expect(bandeau.textContent).toContain('Dolibarr a refusé la demande.')
      // Le ton ne peut pas tenir à la seule teinte : le glyphe le porte aussi,
      // et « ✓ » sur un refus contredirait le texte qu'il accompagne.
      expect(bandeau.querySelector('[aria-hidden="true"]')!.textContent).toBe('✕')
    })

    it('rend un succès comme un succès', async () => {
      await rendre({ params: { message: 'Brouillon (PROV12) créé.', tone: 'success' } })
      const bandeau = screen.getByRole('status')
      expect(bandeau.textContent).toContain('Brouillon (PROV12) créé.')
      expect(bandeau.querySelector('[aria-hidden="true"]')!.textContent).toBe('✓')
    })

    it('n invente pas de tonalité à partir d une valeur forgée', async () => {
      await rendre({ params: { message: 'Message.', tone: 'succès-déguisé' } })
      const bandeau = screen.getByRole('status')
      expect(bandeau.querySelector('[aria-hidden="true"]')!.textContent).toBe('ℹ')
    })

    it('n affiche aucun bandeau sans message', async () => {
      await rendre()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  it('donne au statut un glyphe en plus de sa teinte', async () => {
    await rendre({ cras: [unCra('REFUSE')] })
    const badge = screen.getByTestId('cra-statut')
    expect(badge.querySelector('[aria-hidden="true"]')!.textContent).not.toBe('')
    expect(badge.textContent).toContain('Refusé')
  })
})
