// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { CraStatus } from '@/core/types'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'

// La page est un composant serveur : elle appelle la session et les services
// avant de rendre. On leur substitue des doubles, le sujet du test étant le
// contrat de formulaire et le respect de la machine à états, pas la base.
const { cras, missions, souffrance } = vi.hoisted(() => ({
  cras: [] as unknown[],
  missions: [] as unknown[],
  souffrance: [] as unknown[],
}))

vi.mock('@/auth', () => ({
  requireUser: async () => ({ id: 'u1', role: 'ADMIN' as const }),
}))
vi.mock('@/services/cra', () => ({
  listCras: async () => cras,
  listCrasEnSouffrance: async () => souffrance,
}))
vi.mock('@/services/missions', () => ({ listMissionsForUser: async () => missions }))
vi.mock('./actions', () => ({
  openCra: vi.fn(),
  moveCra: vi.fn(),
  saveTracking: vi.fn(),
  envoyerPourSignature: vi.fn(),
  rafraichirSignature: vi.fn(),
  lancerRelances: vi.fn(),
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
    previsionnelAAnnuler: 0,
    iraDansDolibarr: false,
    synthese: { totalCentiemes: 0, joursServis: 0, lignes: [] },
    ...extra,
  }
}

describe('page CRA — ce qui partira, et ce qui ne partira pas', () => {
  afterEach(cleanup)

  it('avertit qu’un CRA sans projet Dolibarr n’enverra rien', async () => {
    // Le défaut vécu : deux missions aux noms presque identiques, une seule
    // rattachée. Le CRA validé n'a rien mis en file, et rien ne le disait.
    await rendre({ cras: [unCra('BROUILLON', 'cra-1', { iraDansDolibarr: false })] })
    const texte = document.body.textContent ?? ''

    expect(texte).toContain('Ce CRA n’ira pas dans Dolibarr')
    expect(texte).toContain('rien n’arrivera chez le client')
  })

  it('n’avertit pas quand la mission est rattachée', async () => {
    await rendre({ cras: [unCra('BROUILLON', 'cra-1', { iraDansDolibarr: true })] })
    expect(document.body.textContent ?? '').not.toContain('n’ira pas dans Dolibarr')
  })

  it('se tait sur un CRA déjà validé : l’avertissement arriverait trop tard', async () => {
    await rendre({ cras: [unCra('VALIDE', 'cra-1', { iraDansDolibarr: false })] })
    expect(document.body.textContent ?? '').not.toContain('n’ira pas dans Dolibarr')
  })

  it('affiche la période sur la carte, pas seulement en tête de page', async () => {
    // Deux missions voisines et un mois implicite : on ne sait plus quel CRA
    // on vient d'engendrer.
    await rendre({ cras: [unCra('BROUILLON')] })
    expect(document.body.textContent ?? '').toContain('mars 2026')
  })
})

describe('page CRA — la synthèse', () => {
  afterEach(cleanup)

  it('dit combien de jours et sur quelles prestations', async () => {
    // Sans elle, il fallait ouvrir le PDF pour savoir ce qu'on s'apprêtait à
    // faire signer.
    await rendre({
      cras: [
        unCra('BROUILLON', 'cra-1', {
          synthese: {
            totalCentiemes: 1750,
            joursServis: 18,
            lignes: [
              { label: 'Consultant', centiemes: 1500 },
              { label: 'Astreinte', centiemes: 250 },
            ],
          },
        }),
      ],
    })
    const texte = document.body.textContent ?? ''

    expect(texte).toContain('17,50 j')
    expect(texte).toContain('18 jours')
    expect(texte).toContain('Consultant')
    expect(texte).toContain('15,00 j')
    expect(texte).toContain('Astreinte')
  })

  it('annonce un CRA vide au lieu d’un tableau muet', async () => {
    await rendre({ cras: [unCra('BROUILLON')] })
    expect(document.body.textContent ?? '').toContain('Le CRA serait vide')
  })
})

describe('page CRA — le prévisionnel emporté par la validation', () => {
  // Chaque describe de ce fichier pose son propre nettoyage : sans lui, les
  // rendus s'empilent dans le même document et les tests se lisent entre eux.
  afterEach(cleanup)

  it('annonce ce qui sera annulé, avant la validation', async () => {
    // Un jour prévu emporté sans préavis est une donnée perdue dont personne
    // ne saura qu'elle a existé.
    await rendre({ cras: [unCra('BROUILLON', 'cra-1', { previsionnelAAnnuler: 3 })] })
    const texte = document.body.textContent ?? ''

    expect(texte).toContain('3 jours en prévisionnel')
    expect(texte).toContain('seront annulées')
  })

  it('accorde le singulier sur un seul jour', async () => {
    await rendre({ cras: [unCra('BROUILLON', 'cra-1', { previsionnelAAnnuler: 1 })] })
    expect(document.body.textContent ?? '').toContain('1 jour en prévisionnel')
  })

  it('ne dit rien quand le mois n’a rien de prévu', async () => {
    await rendre({ cras: [unCra('BROUILLON')] })
    expect(document.body.textContent ?? '').not.toContain('prévisionnel')
  })
})

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
    missions?: unknown[]
    souffrance?: unknown[]
    erreur?: string
  } = {},
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

  // L'application ne demande aucune facture : elle pousse les temps, et la
  // facturation se fait dans Dolibarr, sur ses propres écrans. L'écran ne doit
  // donc offrir aucun bouton qui prétendrait la déclencher d'ici.
  it('ne propose jamais de demander une facture, même sur un CRA validé', async () => {
    await rendre({ cras: [unCra('VALIDE')] })
    expect(screen.queryByRole('button', { name: /facture/i })).toBeNull()
  })

  it('donne au statut une icône en plus de sa teinte', async () => {
    await rendre({ cras: [unCra('REFUSE')] })
    const badge = screen.getByTestId('cra-statut')
    const icone = badge.querySelector('[aria-hidden="true"]')
    expect(icone).not.toBeNull()
    expect(icone!.getAttribute('data-icone')).toBe('danger')
    expect(badge.textContent).toContain('Refusé')
  })
})

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

  // Un lien de téléchargement qui servirait le PDF d'un autre CRA est une fuite
  // — nominative, et invisible tant qu'un seul CRA est affiché. La page en
  // affiche autant qu'il y a de missions : le contrôle porte sur plusieurs.
  it('DONNE À CHAQUE CARTE LE LIEN DE SON PROPRE PDF', async () => {
    await rendre({
      cras: [unCra('BROUILLON', 'cra-aa'), unCra('ENVOYE', 'cra-bb'), unCra('VALIDE', 'cra-cc')],
    })
    const liens = screen
      .getAllByRole('link', { name: /télécharger le pdf/i })
      .map((a) => a.getAttribute('href'))
    expect(liens).toEqual(['/cra/cra-aa/pdf', '/cra/cra-bb/pdf', '/cra/cra-cc/pdf'])
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
      cras: [
        unCra('VALIDE', 'cra-1', { signature: uneSignature({ status: 'SIGNE', archive: true }) }),
      ],
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
    expect(screen.getByRole('button', { name: /lancer les relances/i })).toBeTruthy()
  })

  it('OFFRE LES RELANCES DÈS QU UNE SIGNATURE EST EN ATTENTE, sans souffrance préalable', async () => {
    // La boucle morte que ce test ferme : le bouton vivait à l'intérieur de
    // `{souffrance.length > 0 && …}`, et `souffrance` n'est alimentée que par
    // `abandoned`, que seul `runSignatureReminders` pose — le travail que ce
    // bouton déclenche. Sur une instance neuve, aucune demande n'était
    // abandonnée, donc le bouton n'existait pas, donc rien n'abandonnait
    // jamais : « trois relances puis abandon » était inatteignable.
    await rendre({
      cras: [unCra('ENVOYE', 'cra-1', { signature: uneSignature() })],
      souffrance: [],
    })

    expect(screen.queryByRole('heading', { name: /en souffrance/i })).toBeNull()
    expect(screen.getByRole('button', { name: /lancer les relances/i })).toBeTruthy()
  })

  it('n offre pas les relances quand aucune signature n est en attente', async () => {
    // Un bouton qui ne peut rien faire n'a rien à dire : sans aucune demande
    // ouverte, le déclencher ne relancerait personne.
    await rendre({ cras: [unCra('BROUILLON'), unCra('VALIDE', 'cra-2')] })
    expect(screen.queryByRole('button', { name: /lancer les relances/i })).toBeNull()
  })

  it('offre encore les relances quand seule la liste des souffrances est peuplée', async () => {
    // Le cas d'un CRA déjà abandonné dont la carte n'est pas sur le mois
    // affiché : la section de souffrance porte alors le bouton à elle seule.
    await rendre({
      cras: [],
      souffrance: [
        unCra('ENVOYE', 'cra-9', { signature: uneSignature({ relances: 3, abandoned: true }) }),
      ],
    })
    expect(screen.getByRole('button', { name: /lancer les relances/i })).toBeTruthy()
  })

  it('affiche le motif d échec remonté par l action', async () => {
    await rendre({ cras: [unCra('BROUILLON')], erreur: 'PAS_DE_CONNECTEUR' })
    expect(document.body.textContent).toContain('Aucun outil de signature')
  })
})
