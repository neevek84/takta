// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { chargerImpactPrestation, detruirePrestation, rangerPrestation } = vi.hoisted(() => ({
  chargerImpactPrestation: vi.fn(),
  detruirePrestation: vi.fn(),
  rangerPrestation: vi.fn(),
}))
vi.mock('./actions', () => ({ chargerImpactPrestation, detruirePrestation, rangerPrestation }))

import { GestionPrestation } from './GestionPrestation'

const IMPACT = { saisies: 41, saisiesValidees: 12, crasValides: 2, correspondances: 7 }

beforeEach(() => {
  chargerImpactPrestation.mockReset().mockResolvedValue(IMPACT)
  detruirePrestation.mockReset().mockResolvedValue({ ok: true, message: 'Supprimée.' })
  rangerPrestation.mockReset().mockResolvedValue({ ok: true, message: 'Prestation archivée.' })
})

afterEach(cleanup)

/** Ouvre le volet et attend que la transition soit **retombée**. */
async function ouvrir() {
  render(<GestionPrestation lineId="l1" label="Consultant ITSM" />)
  fireEvent.click(screen.getByRole('button', { name: /Archiver ou supprimer/ }))
  await screen.findByRole('button', { name: /Supprimer définitivement/ })
}

describe('GestionPrestation', () => {
  it('ne compte rien tant que le volet est fermé', () => {
    render(<GestionPrestation lineId="l1" label="Consultant ITSM" />)
    expect(chargerImpactPrestation).not.toHaveBeenCalled()
  })

  // Une suppression ne se rattrape pas : ce qu'elle emporte se montre avant.
  it('affiche ce que la suppression détruirait, avant de la proposer', async () => {
    await ouvrir()
    expect(screen.getByText('41')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText(/Rien ne sera supprimé dans Dolibarr/)).toBeTruthy()
  })

  // Une saisie dans un mois validé a déjà été envoyée au client, parfois
  // facturée : le CRA survit, mais il ne dira plus la même chose.
  it('avertit quand des saisies déjà validées seraient détruites', async () => {
    await ouvrir()
    expect(screen.getByText(/12/)).toBeTruthy()
    expect(screen.getByText(/2 CRA validé\(s\)/)).toBeTruthy()
    expect(screen.getByText(/ne sera pas détruit/)).toBeTruthy()
  })

  it('ne met pas en garde quand rien de validé n est en jeu', async () => {
    chargerImpactPrestation.mockResolvedValue({ ...IMPACT, saisiesValidees: 0, crasValides: 0 })
    await ouvrir()
    expect(screen.queryByText(/ne sera pas détruit/)).toBeNull()
  })

  // Un clic ne doit pas suffire à détruire des saisies déjà validées.
  it('refuse de supprimer tant que le libellé n est pas recopié', async () => {
    await ouvrir()
    expect(screen.getByRole('button', { name: /Supprimer définitivement/ })).toHaveProperty(
      'disabled',
      true,
    )

    fireEvent.change(screen.getByLabelText(/Recopiez/), { target: { value: 'Consultant' } })
    expect(screen.getByRole('button', { name: /Supprimer définitivement/ })).toHaveProperty(
      'disabled',
      true,
    )

    fireEvent.change(screen.getByLabelText(/Recopiez/), { target: { value: 'Consultant ITSM' } })
    expect(screen.getByRole('button', { name: /Supprimer définitivement/ })).toHaveProperty(
      'disabled',
      false,
    )
  })

  // Ce qui part est ce que l'utilisateur a **tapé**, jamais le libellé que le
  // composant connaît déjà : envoyer le second rendrait la vérification du
  // serveur vide de sens, et `disabled` n'est pas une barrière — un clic peut
  // être déclenché sans souris.
  it('transmet la confirmation exacte au service, telle que tapée', async () => {
    await ouvrir()
    fireEvent.change(screen.getByLabelText(/Recopiez/), {
      target: { value: 'Consultant ITSM ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Supprimer définitivement/ }))

    await waitFor(() => expect(detruirePrestation).toHaveBeenCalledWith('l1', 'Consultant ITSM '))
  })

  it('archive sans rien détruire', async () => {
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Archiver' }))

    await waitFor(() => expect(rangerPrestation).toHaveBeenCalledWith('l1', true))
    expect(await screen.findByText('Prestation archivée.')).toBeTruthy()
    expect(detruirePrestation).not.toHaveBeenCalled()
  })

  it('affiche le refus du service au lieu de laisser croire à une suppression', async () => {
    detruirePrestation.mockResolvedValue({ ok: false, erreur: 'Cette prestation n’existe plus.' })
    await ouvrir()
    fireEvent.change(screen.getByLabelText(/Recopiez/), { target: { value: 'Consultant ITSM' } })
    fireEvent.click(screen.getByRole('button', { name: /Supprimer définitivement/ }))

    expect(await screen.findByText('Cette prestation n’existe plus.')).toBeTruthy()
  })
})
