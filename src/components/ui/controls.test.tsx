// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Button } from './Button'
import { Field } from './Field'
import { Select } from './Select'
import { Checkbox } from './Checkbox'

afterEach(cleanup)

describe('Button', () => {
  it('rend son libellé et réagit au clic', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Enregistrer</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('porte une cible tactile de 44 points quelle que soit la variante', () => {
    render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="secondary">B</Button>
        <Button variant="quiet">C</Button>
        <Button variant="danger">D</Button>
      </>,
    )
    for (const bouton of screen.getAllByRole('button')) {
      expect(bouton.className).toContain('touch-target')
    }
  })

  it('n habille aucune variante d une couleur en dur', () => {
    render(<Button variant="danger">Supprimer</Button>)
    expect(screen.getByRole('button').className).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(screen.getByRole('button').className).toMatch(/danger/)
  })

  it('annonce le chargement autrement que par la couleur', () => {
    render(<Button loading>Enregistrer</Button>)
    const bouton = screen.getByRole('button')
    expect(bouton.getAttribute('aria-busy')).toBe('true')
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.textContent).toContain('…')
  })

  it('reste cliquable hors chargement', () => {
    render(<Button>Enregistrer</Button>)
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('false')
  })
})

describe('Field', () => {
  it('lie le libellé au champ', () => {
    render(<Field label="N° de facture" name="invoiceNumber" />)
    const input = screen.getByLabelText('N° de facture') as HTMLInputElement
    expect(input.name).toBe('invoiceNumber')
  })

  it('rend l erreur et la rattache au champ', () => {
    render(<Field label="Seuil" name="seuil" error="Le seuil doit être positif." />)
    const input = screen.getByLabelText('Seuil')
    const erreur = screen.getByText('Le seuil doit être positif.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(erreur.id)
  })

  it('ne signale rien quand il n y a pas d erreur', () => {
    render(<Field label="Seuil" name="seuil" />)
    expect(screen.getByLabelText('Seuil').getAttribute('aria-invalid')).toBeNull()
  })

  it('affiche l indication sans la confondre avec une erreur', () => {
    render(<Field label="Durée" name="duree" hint="Vide = hérité" />)
    expect(screen.getByText('Vide = hérité')).toBeDefined()
    expect(screen.getByLabelText('Durée').getAttribute('aria-invalid')).toBeNull()
  })

  it('donne des identifiants distincts à deux champs de même libellé', () => {
    render(
      <>
        <Field label="Durée" name="a" />
        <Field label="Durée" name="b" />
      </>,
    )
    const [a, b] = screen.getAllByLabelText('Durée')
    expect(a!.id).not.toBe(b!.id)
  })
})

describe('Select', () => {
  it('lie le libellé et rend ses options', () => {
    render(
      <Select label="Mission" name="missionId">
        <option value="m1">ACME · ITSM</option>
      </Select>,
    )
    const select = screen.getByLabelText('Mission') as HTMLSelectElement
    expect(select.name).toBe('missionId')
    expect(screen.getByRole('option', { name: 'ACME · ITSM' })).toBeDefined()
  })

  it('porte une cible tactile de 44 points', () => {
    render(
      <Select label="Mission" name="missionId">
        <option value="m1">M</option>
      </Select>,
    )
    expect(screen.getByLabelText('Mission').className).toContain('touch-target')
  })
})

describe('Checkbox', () => {
  it('lie le libellé et bascule', () => {
    render(<Checkbox label="Lundi" name="workingDays" value="1" />)
    const case_ = screen.getByLabelText('Lundi') as HTMLInputElement
    expect(case_.type).toBe('checkbox')
    fireEvent.click(case_)
    expect(case_.checked).toBe(true)
  })

  it('offre une zone cliquable de 44 points', () => {
    const { container } = render(<Checkbox label="Lundi" name="workingDays" value="1" />)
    expect(container.querySelector('label')!.className).toContain('touch-target')
  })
})
