// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SignatureCard } from './SignatureCard'
import type { CraSignatureView } from '@/services/cra'

function uneSignature(extra: Partial<CraSignatureView> = {}): CraSignatureView {
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

describe('SignatureCard', () => {
  afterEach(cleanup)

  // Perdue lors de la réécriture de l'ancienne page de liste en tableau : la
  // carte n'était plus rendue nulle part, et sa seule couverture avec elle.
  // Restaurée ici, isolée du reste de la page de détail qui l'englobe.
  it('affiche l etat en attente et le compte de relances', () => {
    render(<SignatureCard signature={uneSignature({ relances: 2 })} />)

    const texte = screen.getByText(/En attente de signature/).closest('div')?.textContent ?? ''
    expect(texte).toContain('En attente de signature')
    expect(texte).toContain('2 relances')
  })

  it('accorde le singulier sur une seule relance', () => {
    render(<SignatureCard signature={uneSignature({ relances: 1 })} />)

    expect(screen.getByText(/^1 relance(?!s)/)).toBeTruthy()
  })

  it('signale un document signe archive', () => {
    render(
      <SignatureCard signature={uneSignature({ status: 'SIGNE', archive: true })} />,
    )

    expect(screen.getByText('Document signé archivé')).toBeTruthy()
  })

  it('ne signale rien quand le document n est pas archive', () => {
    render(<SignatureCard signature={uneSignature({ status: 'SIGNE', archive: false })} />)

    expect(screen.queryByText('Document signé archivé')).toBeNull()
  })
})
