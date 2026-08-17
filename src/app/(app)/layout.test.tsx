// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const { requireUser, signOut } = vi.hoisted(() => ({ requireUser: vi.fn(), signOut: vi.fn() }))
vi.mock('@/auth', () => ({ requireUser, signOut }))

// Depuis le lot 1g, le layout pose un rail client qui lit la route courante
// pour marquer la page active. Hors de Next, le contexte de routeur n'existe
// pas et `usePathname()` rend `null` : on le fournit ici.
vi.mock('next/navigation', () => ({ usePathname: () => '/saisie/2026-08' }))

import AppLayout from './layout'

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  signOut.mockReset()
})
afterEach(cleanup)

describe('navigation de l application', () => {
  it('mène à l écran de supervision de la synchronisation', async () => {
    // Sans ce lien, l'écran existe et personne ne peut l'atteindre : les
    // divergences et les échecs resteraient invisibles jusqu'à ce qu'on
    // connaisse l'URL par cœur.
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Synchro' })
    expect(lien.getAttribute('href')).toBe('/admin/sync')
  })

  it('mène à l écran de supervision des travaux et du journal', async () => {
    // Les avertissements vivent dans l'outil, pas seulement dans un courriel
    // qu'on n'a pas lu : encore faut-il pouvoir ouvrir l'écran qui les porte.
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Supervision' })
    expect(lien.getAttribute('href')).toBe('/admin/supervision')
  })

  it('mène à l écran des abonnements sortants', async () => {
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Abonnements' })
    expect(lien.getAttribute('href')).toBe('/admin/webhooks')
  })

  it('N ABANDONNE AUCUN ÉCRAN D ADMINISTRATION derrière une URL à connaître', async () => {
    // Ce contrôle ne dépend d'aucune liste écrite à la main : il lit les
    // dossiers. Ajouter un écran sans son lien le fait tomber, et retirer le
    // lien d'un écran existant aussi — c'est exactement ce qui manquait quand
    // un plan a proposé de remplacer la liste des liens au lieu de l'étendre.
    render(await AppLayout({ children: null }))

    const racine = path.join(__dirname, 'admin')
    const ecrans = readdirSync(racine, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(racine, e.name, 'page.tsx')))
      .map((e) => `/admin/${e.name}`)

    expect(ecrans.length).toBeGreaterThan(5)

    // `hidden: false` est écrit **explicitement** : c'est le défaut de
    // `*ByRole`, et c'est justement ce qui fait la valeur de ce contrôle.
    // Le contrôle vérifiait auparavant la simple présence dans le document,
    // et le tiroir se repliait par une classe `hidden` qu'aucune feuille de
    // style ne portait en test : sept écrans pouvaient devenir invisibles en
    // navigateur — `display:none` les retire de l'arbre d'accessibilité et de
    // l'ordre de tabulation — sans que ce test bronche. Le repli passe
    // désormais par l'attribut `hidden`, que l'environnement honore : replier
    // le tiroir par défaut fait tomber ce garde-fou, comme il le doit.
    const liens = screen
      .getAllByRole('link', { hidden: false })
      .map((lien) => lien.getAttribute('href'))
    for (const ecran of ecrans) {
      expect(liens, `aucun lien ne mène à ${ecran}`).toContain(ecran)
    }
  })

  it('pose le rail à deux groupes, et lui seul', async () => {
    // La barre horizontale alignait onze entrées à plat et débordait. Le
    // layout ne rend plus qu'un rail, qui groupe le travail et les réglages :
    // si ce rail disparaissait du layout, les cinq contrôles de ce fichier
    // tomberaient ensemble, mais aucun ne dirait pourquoi.
    render(await AppLayout({ children: null }))

    expect(screen.getByRole('navigation', { name: 'Travail' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Réglages' })).toBeTruthy()
  })

  it('mène à l écran de connexion et de rattachement Dolibarr', async () => {
    // C'est l'écran par lequel la clé d'API se saisit : sans lien, le
    // connecteur ne peut pas être configuré du tout.
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Dolibarr' })
    expect(lien.getAttribute('href')).toBe('/admin/dolibarr')
  })
})
