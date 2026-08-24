// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { CRA_STATUSES } from '@/core/types'

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

  // Le tableau de suivi affiche l'état dérivé (`etatSuivi`), pas le statut
  // brut : un CRA validé et facturé s'y lit « Facturé ». La page de détail
  // doit dire la même chose — sans quoi les deux moitiés d'un même écran se
  // contredisent sur le même CRA.
  it('affiche Facture, pas Valide, sur un CRA valide portant une facture', async () => {
    await rendre(unCra({ status: 'VALIDE', invoiceNumber: 'F-2026-042' }))

    expect(screen.getByText('Facturé')).toBeTruthy()
    expect(screen.queryByText('Validé')).toBeNull()
  })
})

/**
 * Minor 5 — cette matrice vivait sur l'ancienne page de liste
 * (`cra/page.test.tsx`, décrite en cartes), retirée avec elle lors du passage
 * au tableau de suivi. Le bloc de transitions qu'elle couvrait n'a pas bougé
 * — c'est le même `ALL.filter((t) => canTransition(cra.status, t))`, rendu
 * ici plutôt que sur une carte — mais seule sa couverture avait disparu.
 * `transitionCra` refuse déjà toute transition illégale côté serveur : ce
 * n'est pas un bug vivant, c'est un garde-fou de régression à restaurer.
 */
const LIBELLES: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
}
const TOUTES: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR']

describe('transitions offertes', () => {
  afterEach(cleanup)

  for (const status of CRA_STATUSES) {
    const autorisees = TOUTES.filter((t) => canTransition(status, t))
    const refusees = TOUTES.filter((t) => !canTransition(status, t))

    it(`n offre depuis ${status} que ${autorisees.join(', ') || 'rien'}`, async () => {
      await rendre(unCra({ status }))

      for (const t of autorisees) {
        expect(screen.queryByRole('button', { name: LIBELLES[t] }), t).not.toBeNull()
      }
      for (const t of refusees) {
        expect(screen.queryByRole('button', { name: LIBELLES[t] }), t).toBeNull()
      }
    })

    it(`transmet la transition demandée depuis ${status}`, async () => {
      const { container } = await rendre(unCra({ status }))
      const valeurs = Array.from(container.querySelectorAll('input[name="transition"]')).map(
        (n) => (n as HTMLInputElement).value,
      )
      expect(valeurs.sort()).toEqual([...autorisees].sort())
    })
  }
})

// Cette couverture vivait sur l'ancienne page de liste, retirée avec le
// rendu par cartes lors du passage au tableau de suivi. Le comportement, lui,
// n'a pas bougé : `SignatureCard`, le formulaire d'envoi et celui de
// rafraîchissement sont toujours rendus ici, sur la page de détail — seule
// leur couverture avait disparu avec les cartes.
describe('signature du CRA', () => {
  afterEach(() => {
    cleanup()
    introuvable.mockClear()
  })

  it('propose l envoi pour signature sur un brouillon', async () => {
    await rendre(unCra({ status: 'BROUILLON' }))

    const bouton = screen.getByRole('button', { name: /envoyer pour signature/i })
    expect(bouton.hasAttribute('disabled')).toBe(false)
  })

  it('desactive l envoi et l explique quand la mission n a pas de signataire', async () => {
    await rendre(
      unCra({ status: 'BROUILLON', signataireNom: '', signataireEmail: '' }),
    )

    const bouton = screen.getByRole('button', { name: /envoyer pour signature/i })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(document.body.textContent).toContain('signataire')
  })

  it('ne propose pas l envoi quand la transition est impossible', async () => {
    // `unCra()` est `ENVOYE` par défaut : `ENVOYER` n'y mène que depuis
    // `BROUILLON`, donc le bouton ne doit pas apparaître ici.
    await rendre(unCra())

    expect(screen.queryByRole('button', { name: /envoyer pour signature/i })).toBeNull()
  })

  it('propose le rafraichissement des qu une demande de signature existe', async () => {
    await rendre(
      unCra({
        signature: {
          provider: 'documenso',
          status: 'EN_ATTENTE',
          sentAt: new Date('2026-03-05T09:00:00.000Z'),
          relances: 0,
          lastRelanceAt: null,
          abandoned: false,
          archive: false,
        },
      }),
    )

    expect(screen.getByRole('button', { name: /rafraîchir l’état/i })).toBeTruthy()
  })

  it('ne propose pas le rafraichissement sans demande de signature', async () => {
    await rendre(unCra({ signature: null }))

    expect(screen.queryByRole('button', { name: /rafraîchir l’état/i })).toBeNull()
  })
})
