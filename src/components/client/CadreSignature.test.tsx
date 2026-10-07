// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CadreSignature } from './CadreSignature'

afterEach(cleanup)

// Le cadre ne doit rien charger pour de bon : le test n'a besoin que de sa fenêtre.
;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true

const URL_CADRE = 'https://sign.exemple.fr/embed/sign/jeton-1#abc'

function poster(source: MessageEventSource | null, origin: string, action: string) {
  window.dispatchEvent(new MessageEvent('message', { data: { action }, origin, source }))
}

describe('CadreSignature', () => {
  it('sur « signé » venu du cadre, demande au serveur de relire', async () => {
    const confirmer = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<CadreSignature url={URL_CADRE} confirmer={confirmer} renouveler={vi.fn()} />)
    const iframe = container.querySelector('iframe')!
    poster(iframe.contentWindow, 'https://sign.exemple.fr', 'document-completed')
    await waitFor(() => expect(confirmer).toHaveBeenCalledTimes(1))
  })

  it('IGNORE un message d une autre origine ou d une autre fenêtre', async () => {
    const confirmer = vi.fn()
    const { container } = render(<CadreSignature url={URL_CADRE} confirmer={confirmer} renouveler={vi.fn()} />)
    const iframe = container.querySelector('iframe')!
    poster(iframe.contentWindow, 'https://pirate.test', 'document-completed')
    poster(window, 'https://sign.exemple.fr', 'document-completed')
    await new Promise((r) => setTimeout(r, 10))
    expect(confirmer).not.toHaveBeenCalled()
  })

  it('propose toujours d ouvrir le document dans un nouvel onglet', () => {
    const { getByText } = render(<CadreSignature url={URL_CADRE} confirmer={vi.fn()} renouveler={vi.fn()} />)
    const lien = getByText(/nouvel onglet/) as HTMLAnchorElement
    expect(lien.getAttribute('href')).toBe(URL_CADRE)
    expect(lien.getAttribute('rel')).toContain('noopener')
  })
})
