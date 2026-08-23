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
    const { container } = await rendre(unCra())

    expect(screen.getByText('ACME · ITSM')).toBeTruthy()
    // Requête scopée sur le total : avec une seule ligne de synthèse, celle-ci
    // vaut forcément le même montant que le total (`unCra` en pose une seule,
    // « Run » à 1200 centièmes, égale au total) — `getByText('12,00 j')`
    // trouverait alors deux nœuds identiques. La ventilation par ligne reste
    // affichée, comme sur la liste ; seule la requête est précisée.
    const total = container.querySelector('.text-lg.font-medium')
    expect(total?.textContent).toBe('12,00 j')
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
