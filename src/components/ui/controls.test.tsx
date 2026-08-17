// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Field } from './Field'
import { Select } from './Select'
import { Checkbox } from './Checkbox'

afterEach(cleanup)

describe('cn', () => {
  it('résout un conflit d utilitaire standard au lieu de le laisser à l ordre CSS', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2')
    expect(cn('rounded-sm', 'rounded-none')).toBe('rounded-none')
  })

  // La spec affirme que `tailwind-merge` « laisse intacts les jetons du
  // projet ». Sans ces assertions, c'est une hypothèse : la vérification porte
  // donc sur des jetons réellement employés dans `src/`, pas sur des exemples.
  it('laisse intacts les jetons réels du projet, qu il ne connaît pas', () => {
    // Les trois classes de la variante `primary` de Button.
    expect(cn('bg-accent', 'text-on-accent', 'border-accent-dark')).toBe(
      'bg-accent text-on-accent border-accent-dark',
    )
    // Une teinte catégorielle et trois utilitaires déclarés dans `globals.css`.
    expect(cn('bg-cat-a', 'touch-target', 'clip-half-am', 'pattern-dots')).toBe(
      'bg-cat-a touch-target clip-half-am pattern-dots',
    )
    // La case du jour, dans `MonthCalendar` : une épaisseur standard et un
    // jeton de teinte partagent le préfixe `border-` sans se recouvrir.
    expect(cn('border-2', 'border-ink')).toBe('border-2 border-ink')
  })

  it('ne prend pas une teinte de jeton pour une taille de texte', () => {
    // Le vrai risque de la fusion : `text-ink` est une **couleur**, pas une
    // taille. S'il était rangé avec `text-sm`, chaque `DataTable` perdrait sa
    // densité sans qu'aucune couleur ne change — une régression muette.
    expect(cn('text-sm', 'text-ink')).toBe('text-sm text-ink')
    expect(cn('text-xs', 'text-muted', 'tabular-nums')).toBe('text-xs text-muted tabular-nums')
  })

  it('départage deux jetons qui posent la même propriété', () => {
    // Le cas de `Field` : la bordure d'erreur doit l'emporter sur la bordure
    // ordinaire, quel que soit l'ordre d'insertion des règles CSS.
    expect(cn('border border-rule', 'border-danger-edge')).toBe('border border-danger-edge')
  })
})

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

  it('accompagne son survol d une transition brève', () => {
    // Un survol qui saute d'une teinte à l'autre se lit comme un défaut
    // d'affichage. 150 ms suffit à le rendre continu sans le rendre lent ;
    // `prefers-reduced-motion` le neutralise pour qui le demande.
    render(<Button variant="primary">Enregistrer</Button>)
    const bouton = screen.getByRole('button')
    expect(bouton.className).toContain('transition-')
    expect(bouton.className).toContain('duration-150')
  })

  it('laisse l appelant corriger un utilitaire sans dépendre de l ordre CSS', () => {
    // La raison d'être de `cn()` : `px-2` passé par l'appelant doit chasser le
    // `px-4` du bouton, et non cohabiter avec lui.
    render(<Button className="px-2">Étroit</Button>)
    const classes = screen.getByRole('button').className
    expect(classes).toContain('px-2')
    expect(classes).not.toContain('px-4')
  })

  it('reste cliquable hors chargement', () => {
    render(<Button>Enregistrer</Button>)
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false)
    // `aria-busy="false"` sur tous les boutons de l'application est du bruit :
    // hors chargement, l'attribut n'a rien à dire et ne doit pas être émis.
    expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false)
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

  it('adoucit le changement de bordure au lieu de le faire sauter', () => {
    render(<Field label="Seuil" name="seuil" />)
    const classes = screen.getByLabelText('Seuil').className
    expect(classes).toContain('transition-colors')
    expect(classes).toContain('duration-150')
  })

  it('laisse la bordure d erreur l emporter sur la bordure ordinaire', () => {
    render(<Field label="Seuil" name="seuil" error="Le seuil doit être positif." />)
    const classes = screen.getByLabelText('Seuil').className
    expect(classes).toContain('border-danger-edge')
    expect(classes).not.toContain('border-rule')
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
