// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TravauxPanel } from './TravauxPanel'
import type { JobView } from '@/services/jobs/scheduler'
import type { Ordonnanceur } from '@/services/supervision'

afterEach(cleanup)

function travail(patch: Partial<JobView> = {}): JobView {
  return {
    name: 'webhooks.distribute',
    label: 'Distribution des rappels sortants',
    intervalMinutes: 5,
    enabled: true,
    disponible: true,
    lastRunAt: new Date('2026-08-15T09:55:00.000Z'),
    nextRunAt: new Date('2026-08-15T10:00:00.000Z'),
    lastState: 'SUCCES',
    lastError: '',
    enCoursDepuis: null,
    ...patch,
  }
}

const SEUL: Ordonnanceur = {
  proprietaireId: 'u1',
  proprietaireLabel: 'Keveen',
  comptes: 1,
}

function rendre(travaux: JobView[], ordonnanceur: Ordonnanceur = SEUL) {
  return render(<TravauxPanel travaux={travaux} ordonnanceur={ordonnanceur} />)
}

describe('panneau des travaux', () => {
  it('affiche libellé, dernière exécution, prochaine échéance et état', () => {
    rendre([travail()])
    expect(screen.getByText('Distribution des rappels sortants')).toBeTruthy()
    expect(screen.getByText(/succès/i)).toBeTruthy()
    expect(screen.getByText('2026-08-15 09:55')).toBeTruthy()
    expect(screen.getByText('2026-08-15 10:00')).toBeTruthy()
  })

  it('donne un bouton d exécution immédiate à chaque travail disponible', () => {
    // Un automatisme qu'on ne peut pas déclencher soi-même ne se débogue pas.
    rendre([travail(), travail({ name: 'rappel.saisie', label: 'Rappel de saisie' })])
    expect(screen.getAllByRole('button', { name: /exécuter/i })).toHaveLength(2)
  })

  it('annonce un travail indisponible sans l afficher comme une panne', () => {
    rendre([
      travail({
        name: 'signature.relance',
        label: 'Relance de signature',
        disponible: false,
        enabled: false,
        lastState: 'INDISPONIBLE',
      }),
    ])
    expect(screen.getByText(/indisponible/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /exécuter/i })).toBeNull()
  })

  it('affiche la dernière erreur d un travail en échec', () => {
    rendre([travail({ lastState: 'ECHEC', lastError: 'URL injoignable' })])
    expect(screen.getByText(/URL injoignable/)).toBeTruthy()
  })

  it('n a jamais jamais exécuté : le dit plutôt que d afficher un vide', () => {
    rendre([travail({ lastRunAt: null, lastState: '' })])
    // Deux fois, et ce n'est pas un doublon : la colonne « Dernière » dit
    // qu'il n'a pas tourné, l'état dit qu'il n'a jamais tourné du tout.
    expect(screen.getByText('jamais')).toBeTruthy()
    expect(screen.getByText(/jamais exécuté/i)).toBeTruthy()
  })

  it('offre de désactiver un travail actif, et d activer un travail éteint', () => {
    rendre([travail(), travail({ name: 'rappel.saisie', label: 'Rappel de saisie', enabled: false })])
    expect(screen.getByRole('button', { name: 'Désactiver' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Activer' })).toBeTruthy()
  })

  it('MONTRE QU UN TRAVAIL EST EN COURS, verrou pris', () => {
    // La prise du verrou n'est pas atomique : deux déclenchements simultanés
    // exécuteraient le même travail. Voir le verrou pris est le seul moyen,
    // à l'écran, de ne pas être le second.
    rendre([travail({ enCoursDepuis: new Date('2026-08-15T09:58:00.000Z') })])
    expect(screen.getByText(/en cours depuis 2026-08-15 09:58/i)).toBeTruthy()
  })

  it('NOMME LE COMPTE POUR LEQUEL LES TRAVAUX TOURNENT', () => {
    rendre([travail()])
    expect(screen.getByText(/Keveen/)).toBeTruthy()
  })

  it('DIT QUE LES RAPPELS PASSENT PAR COMPTE, ET NON PAR PROPRIÉTAIRE', () => {
    // Cet écran portait l'avertissement inverse — « vous ne recevrez aucun
    // rappel » — et il disait vrai. Le garder maintenant que l'ordonnanceur
    // sert tout le monde mentirait dans l'autre sens ; ne rien dire du tout
    // laisserait croire que le silence d'hier dure.
    rendre([travail()], {
      proprietaireId: 'u1',
      proprietaireLabel: 'Keveen',
      comptes: 2,
    })
    const texte = document.body.textContent ?? ''
    expect(texte).toMatch(/une fois\s+par compte actif/)
    expect(texte).toMatch(/2 compte\(s\)/)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ne crie pas quand le compte servi est le vôtre', () => {
    rendre([travail()])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

/**
 * **`1970-01-01 00:00` n'est pas une date, c'est un marqueur.**
 *
 * `syncJobDefinitions` pose `nextRunAt: new Date(0)` à la création d'un
 * travail, délibérément : « dû au premier réveil », ce qui rend le réveil
 * observable et reproductible. Affiché tel quel, l'écran donne à lire une
 * échéance de 1970 — le porteur l'a pris pour un défaut, et il avait raison
 * de le prendre pour tel : un écran qui affiche 1970 ne dit rien de vrai.
 */
describe("l'échéance d'un travail jamais exécuté", () => {
  it('annonce le prochain réveil, pas 1970', () => {
    rendre([travail({ enabled: true, disponible: true, lastRunAt: null, nextRunAt: new Date(0) })])

    const texte = document.body.textContent ?? ''
    expect(texte).not.toContain('1970')
    expect(texte).toMatch(/dès le prochain réveil/i)
  })

  it('garde la date quand il y en a une vraie', () => {
    rendre([
      travail({
        enabled: true,
        disponible: true,
        lastRunAt: new Date('2026-08-22T10:00:00.000Z'),
        nextRunAt: new Date('2026-08-23T10:00:00.000Z'),
      }),
    ])

    expect(document.body.textContent).toContain('2026-08-23 10:00')
  })
})

/**
 * **Un ordonnanceur sans horloge.**
 *
 * `POST /api/jobs/tick` n'a pas de minuterie interne : il attend qu'un
 * déclencheur extérieur l'appelle — cron, un planificateur de NAS, n8n. Tant
 * que personne ne l'appelle, **rien ne tourne jamais**, et l'écran se
 * contentait d'afficher sept lignes « Jamais exécuté » sans dire pourquoi. Le
 * porteur a demandé si c'était normal ; la question prouve que l'écran ne
 * répondait pas.
 */
describe("quand personne n'a jamais réveillé l'ordonnanceur", () => {
  it('le dit, et dit ce qu il faut faire', () => {
    rendre([
      travail({ lastRunAt: null, lastState: '' }),
      travail({ name: 'journal.verification', lastRunAt: null, lastState: '' }),
    ])

    const bandeau = screen.getByRole('alert')
    expect(bandeau.textContent).toMatch(/réveil/i)
    // La route est **nommée** : « configurez un déclencheur » sans dire quoi
    // appeler envoie chercher dans la documentation ce que l'écran sait.
    expect(bandeau.textContent).toContain('/api/jobs/tick')
  })

  // Un seul travail qui a tourné prouve que le réveil existe : le dire encore
  // serait crier au loup, et on cesserait de lire les bandeaux de cet écran.
  it('se tait dès qu un travail a tourné', () => {
    rendre([
      travail({ lastRunAt: null, lastState: '' }),
      travail({ name: 'journal.verification', lastRunAt: new Date('2026-08-22T03:00:00.000Z') }),
    ])

    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Sept travaux tous désactivés : personne n'attend rien, et l'absence de
  // réveil n'est alors pas une anomalie.
  it('se tait quand aucun travail n est activé', () => {
    rendre([travail({ enabled: false, lastRunAt: null, lastState: '' })])

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
