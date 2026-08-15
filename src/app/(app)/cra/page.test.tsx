// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { CraStatus } from '@/core/types'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'

// La page est un composant serveur : elle appelle la session et les services
// avant de rendre. On leur substitue des doubles, le sujet du test étant le
// contrat de formulaire et le respect de la machine à états, pas la base.
const { cras, missions } = vi.hoisted(() => ({
  cras: [] as unknown[],
  missions: [] as unknown[],
}))

vi.mock('@/auth', () => ({
  requireUser: async () => ({ id: 'u1', role: 'ADMIN' as const }),
}))
vi.mock('@/services/cra', () => ({ listCras: async () => cras }))
vi.mock('@/services/missions', () => ({ listMissionsForUser: async () => missions }))
vi.mock('./actions', () => ({
  openCra: vi.fn(),
  moveCra: vi.fn(),
  saveTracking: vi.fn(),
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

async function rendre(
  jeu: { cras?: unknown[]; missions?: unknown[] } = {},
): Promise<ReturnType<typeof render>> {
  cras.length = 0
  cras.push(...(jeu.cras ?? []))
  missions.length = 0
  missions.push(...(jeu.missions ?? [{ id: 'm1', clientName: 'ACME', label: 'ITSM' }]))
  return render(await CraPage({ searchParams: Promise.resolve({ month: '2026-03' }) }))
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

  it('donne au statut un glyphe en plus de sa teinte', async () => {
    await rendre({ cras: [unCra('REFUSE')] })
    const badge = screen.getByTestId('cra-statut')
    expect(badge.querySelector('[aria-hidden="true"]')!.textContent).not.toBe('')
    expect(badge.textContent).toContain('Refusé')
  })
})
