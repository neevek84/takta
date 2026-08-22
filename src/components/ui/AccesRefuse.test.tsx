// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccesRefuse } from './AccesRefuse'

afterEach(cleanup)

describe('AccesRefuse', () => {
  // La spec §3 : « une redirection muette apprend au consultant que l'écran
  // n'existe pas ; un refus nommé lui apprend à qui demander ».
  it('dit à qui demander', () => {
    render(<AccesRefuse role="CONSULTANT" />)
    expect(document.body.textContent).toMatch(/administrateur/i)
  })

  it('dit le rôle dont on dispose, pour que le refus soit compréhensible', () => {
    render(<AccesRefuse role="CONSULTANT" />)
    expect(document.body.textContent).toContain('CONSULTANT')
  })

  // Un lien « retour à la saisie » transformerait le refus en redirection
  // déguisée : la personne quitterait l'écran sans avoir lu pourquoi.
  it('ne renvoie nulle part', () => {
    render(<AccesRefuse role="MANAGER" />)
    expect(screen.queryAllByRole('link')).toEqual([])
  })

  // « Aucune information portée par la seule couleur » : le bandeau porte son
  // icône et son titre, pas seulement un fond rouge.
  it('annonce le refus par un rôle d alerte, pas par une teinte', () => {
    render(<AccesRefuse role="CONSULTANT" />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
