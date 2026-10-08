// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { enregistrerCourriel, testerCourriel } = vi.hoisted(() => ({
  enregistrerCourriel: vi.fn(),
  testerCourriel: vi.fn(),
}))
vi.mock('./actions', () => ({ enregistrerCourriel, testerCourriel }))

import { ReglagesForm } from './ReglagesForm'
import { TestEnvoi } from './TestEnvoi'

const VIDE = {
  host: '',
  port: 0,
  secure: true,
  user: '',
  from: '',
  provenance: 'aucune' as const,
  enregistreLe: null,
}

function valeur(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value
}

beforeEach(() => {
  enregistrerCourriel.mockReset().mockResolvedValue({ ok: true, message: 'Réglage enregistré.' })
  testerCourriel.mockReset()
})
afterEach(cleanup)

describe('ReglagesForm (courriel)', () => {
  it('le préréglage Google Workspace — mot de passe d application remplit les champs', async () => {
    render(<ReglagesForm {...VIDE} />)
    await userEvent.selectOptions(
      screen.getByLabelText('Fournisseur'),
      "Google Workspace — mot de passe d'application",
    )
    expect(valeur('Serveur SMTP')).toBe('smtp.gmail.com')
    expect(valeur('Port')).toBe('465')
    expect(valeur('Chiffrement')).toBe('tls')

    // L'utilisateur suit l'adresse d'expédition.
    await userEvent.type(screen.getByLabelText("Adresse d'expédition"), 'cra@exemple.test')
    expect(valeur('Utilisateur')).toBe('cra@exemple.test')
    expect(document.body.textContent).toMatch(/validation en deux étapes/)
    expect(document.body.textContent).toMatch(/mars 2025/)
  })

  it('le relais Google : STARTTLS 587, ni utilisateur ni mot de passe, et l aide de la console', async () => {
    render(<ReglagesForm {...VIDE} user="ancien@exemple.test" />)
    await userEvent.selectOptions(screen.getByLabelText('Fournisseur'), 'Google Workspace — relais SMTP')
    expect(valeur('Serveur SMTP')).toBe('smtp-relay.gmail.com')
    expect(valeur('Port')).toBe('587')
    expect(valeur('Chiffrement')).toBe('starttls')
    expect(valeur('Utilisateur')).toBe('')
    expect(document.body.textContent).toMatch(/console d'administration/)
    expect(document.body.textContent).toMatch(/adresse IP publique du NAS/)
  })

  it('Microsoft 365 : smtp.office365.com, 587, STARTTLS ; les champs restent modifiables', async () => {
    render(<ReglagesForm {...VIDE} />)
    await userEvent.selectOptions(screen.getByLabelText('Fournisseur'), 'Microsoft 365')
    expect(valeur('Serveur SMTP')).toBe('smtp.office365.com')
    await userEvent.clear(screen.getByLabelText('Port'))
    await userEvent.type(screen.getByLabelText('Port'), '25')
    expect(valeur('Port')).toBe('25')
  })

  it('envoie la saisie ; le mot de passe repart vide et masqué', async () => {
    render(<ReglagesForm {...VIDE} />)
    const mdp = screen.getByLabelText('Mot de passe') as HTMLInputElement
    expect(mdp.getAttribute('type')).toBe('password')

    await userEvent.type(screen.getByLabelText('Serveur SMTP'), 'mail.exemple.test')
    await userEvent.type(screen.getByLabelText('Port'), '587')
    await userEvent.selectOptions(screen.getByLabelText('Chiffrement'), 'starttls')
    await userEvent.type(screen.getByLabelText('Utilisateur'), 'cra')
    await userEvent.type(screen.getByLabelText("Adresse d'expédition"), 'Kreativ <cra@exemple.test>')
    await userEvent.type(mdp, 'secret-de-test')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(enregistrerCourriel).toHaveBeenCalled())
    const fd = enregistrerCourriel.mock.calls[0]![1] as FormData
    expect(Object.fromEntries(fd.entries())).toMatchObject({
      host: 'mail.exemple.test',
      port: '587',
      chiffrement: 'starttls',
      user: 'cra',
      from: 'Kreativ <cra@exemple.test>',
      motDePasse: 'secret-de-test',
    })
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('reconnaît le préréglage d un réglage enregistré et dit d où vient le mot de passe', () => {
    render(
      <ReglagesForm
        {...VIDE}
        host="smtp.gmail.com"
        port={465}
        user="cra@exemple.test"
        from="cra@exemple.test"
        provenance="ecran"
        enregistreLe={new Date('2026-10-01T08:00:00Z')}
      />,
    )
    expect(valeur('Fournisseur')).toBe('google-app')
    expect(document.body.textContent).toContain('Mot de passe en vigueur : enregistré sur cet écran')
    expect(document.body.textContent).toContain('laisser vide pour conserver')
    expect(valeur('Mot de passe')).toBe('')
  })

  it('dit quand le mot de passe vient de SMTP_PASSWORD, ou qu il est illisible', () => {
    render(<ReglagesForm {...VIDE} provenance="env" illisible />)
    expect(document.body.textContent).toContain('Mot de passe en vigueur : variable SMTP_PASSWORD')
    expect(document.body.textContent).toContain('Mot de passe enregistré illisible')
  })

  it('annonce les refus', async () => {
    enregistrerCourriel.mockResolvedValue({ ok: false, erreurs: ['Le serveur SMTP est requis.'] })
    render(<ReglagesForm {...VIDE} />)
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur SMTP est requis.')
  })
})

describe('TestEnvoi', () => {
  it('propose l adresse de l administrateur et envoie à l adresse saisie', async () => {
    testerCourriel.mockResolvedValue({ ok: true, message: 'Courriel de test envoyé à a@b.test.' })
    render(<TestEnvoi adresseParDefaut="admin@exemple.test" />)
    const champ = screen.getByLabelText('Destinataire du test') as HTMLInputElement
    expect(champ.value).toBe('admin@exemple.test')

    await userEvent.clear(champ)
    await userEvent.type(champ, 'a@b.test')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer un courriel de test' }))

    await waitFor(() => expect(testerCourriel).toHaveBeenCalled())
    expect((testerCourriel.mock.calls[0]![1] as FormData).get('destinataire')).toBe('a@b.test')
    expect((await screen.findByRole('status')).textContent).toContain('Réussi')
  })

  it('dit l échec en toutes lettres', async () => {
    testerCourriel.mockResolvedValue({ ok: false, message: 'Le serveur a refusé les identifiants.' })
    render(<TestEnvoi adresseParDefaut="" />)
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer un courriel de test' }))
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toContain('Échec')
    expect(alerte.textContent).toContain('refusé les identifiants')
  })
})
