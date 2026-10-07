// @vitest-environment happy-dom
// (jsdom ne démarre pas ici : voir le commentaire de vitest.config.ts sur Node.)
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CadreSignature } from './CadreSignature'

// Le cadre ne doit rien charger pour de bon : le test n'a besoin que de sa
// fenêtre. happy-dom écrit alors « Iframe page loading is disabled » (avec sa
// pile) directement sur stderr ; ce message-là seul est retenu, toute autre
// écriture sur stderr fait échouer le test.
;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true
const autres: string[] = []
let ecriture: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  autres.length = 0
  ecriture = vi.spyOn(process.stderr, 'write').mockImplementation(((morceau: unknown) => {
    const texte = String(morceau)
    // Ni la pile ni le saut de ligne qui suit ne sont des messages à part.
    if (/Iframe page loading is disabled|^\s*at |^\s*$/.test(texte)) return true
    autres.push(texte)
    return true
  }) as never)
})
afterEach(() => {
  cleanup()
  ecriture?.mockRestore()
  expect(autres).toEqual([])
})

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

  it('un échec de la confirmation ne lève pas : message neutre, et la page se relit', async () => {
    refresh.mockClear()
    const rejets: unknown[] = []
    const surRejet = (e: PromiseRejectionEvent) => rejets.push(e.reason)
    window.addEventListener('unhandledrejection', surRejet)
    const confirmer = vi.fn().mockRejectedValue(new Error('500'))
    const { container, findByText } = render(
      <CadreSignature url={URL_CADRE} confirmer={confirmer} renouveler={vi.fn()} />,
    )
    const iframe = container.querySelector('iframe')!
    poster(iframe.contentWindow, 'https://sign.exemple.fr', 'document-completed')

    expect(await findByText(/La confirmation prend plus de temps que prévu/)).toBeDefined()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    window.removeEventListener('unhandledrejection', surRejet)
    expect(rejets).toEqual([])
  })

  it('un échec du renouvellement ne lève pas non plus', async () => {
    refresh.mockClear()
    const renouveler = vi.fn().mockRejectedValue(new Error('500'))
    const { container, findByText } = render(
      <CadreSignature url={URL_CADRE} confirmer={vi.fn()} renouveler={renouveler} />,
    )
    const iframe = container.querySelector('iframe')!
    poster(iframe.contentWindow, 'https://sign.exemple.fr', 'document-error')

    expect(await findByText(/La confirmation prend plus de temps que prévu/)).toBeDefined()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
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
