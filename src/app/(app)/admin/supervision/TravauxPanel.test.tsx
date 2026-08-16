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
  autreCompte: false,
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

  it('AVERTIT LE CONSULTANT QUI NE SERA PAS SERVI', () => {
    // Sans cet avertissement, un second consultant ne reçoit aucun rappel et
    // rien ne le lui apprend : c'est le pire des silences.
    rendre([travail()], {
      proprietaireId: 'u1',
      proprietaireLabel: 'Keveen',
      autreCompte: true,
      comptes: 2,
    })
    const avertissement = screen.getByRole('alert')
    expect(avertissement.textContent).toMatch(/Keveen/)
    expect(avertissement.textContent).toMatch(/ne recevrez|aucun rappel/i)
  })

  it('ne crie pas quand le compte servi est le vôtre', () => {
    rendre([travail()])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
