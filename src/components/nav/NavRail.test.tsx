// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Le rail lit la route courante pour marquer la page active. Le contexte de
// routeur n'existe pas hors de Next : on le fournit ici, et on le fournit
// **avec un segment de mois** — `/saisie` seul n'aurait rien prouvé du calcul
// de préfixe. La route est portée par un objet mutable : le tiroir mobile se
// referme au changement de route, ce qu'une constante ne permettrait pas de
// vérifier.
const routeur = vi.hoisted(() => ({ route: '/saisie/2026-08' }))
vi.mock('next/navigation', () => ({ usePathname: () => routeur.route }))

import { NavRail, RAIL_MEDIA, estActif } from './NavRail'

afterEach(() => {
  cleanup()
  routeur.route = '/saisie/2026-08'
  vi.restoreAllMocks()
})

const rien = async () => {}

describe('route courante', () => {
  it('active une entrée sur ses segments suivants', () => {
    // La saisie vit sous `/saisie/2026-08` : comparer à l'égalité seule
    // n'allumerait jamais l'entrée qu'on est justement en train de lire.
    expect(estActif('/saisie/2026-08', '/saisie')).toBe(true)
    expect(estActif('/saisie', '/saisie')).toBe(true)
  })

  it("n'active pas une entrée dont l'adresse n'est qu'un morceau de la route", () => {
    // Ces deux couples séparent trois implémentations plausibles.
    // `/admin/saisie` finit par le même mot que la page courante : une
    // comparaison par `includes` ou `endsWith` allumerait les deux entrées.
    expect(estActif('/saisie/2026-08', '/admin/saisie')).toBe(false)
    // Et `/cra` est un préfixe de caractères de `/craie` sans en être un
    // préfixe de chemin : sans le séparateur exigé, l'entrée « CRA »
    // s'allumerait sur une route qui ne lui appartient pas. Aucune route de
    // l'application ne s'appelle ainsi aujourd'hui — c'est le contrat de la
    // fonction qui est vérifié, et c'est lui qui protège la prochaine entrée
    // ajoutée à `TRAVAIL` ou à `REGLAGES`.
    expect(estActif('/craie', '/cra')).toBe(false)
  })

  it("n'active pas une entrée étrangère à la route", () => {
    expect(estActif('/saisie/2026-08', '/charge')).toBe(false)
  })
})

describe('rail de navigation', () => {
  it('groupe le travail et les réglages, et les nomme', () => {
    // Onze entrées à plat débordaient la barre horizontale. Deux groupes
    // nommés, c'est ce qui permet d'en replier sept sans en perdre aucune.
    render(<NavRail onSignOut={rien} />)

    expect(screen.getByRole('navigation', { name: 'Travail' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Réglages' })).toBeTruthy()
  })

  it('marque la page courante', () => {
    render(<NavRail onSignOut={rien} />)

    expect(screen.getByRole('link', { name: 'Saisie' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Charge' }).getAttribute('aria-current')).toBeNull()
  })

  it('distingue la page courante autrement que par la teinte', () => {
    // « Aucune information portée par la seule couleur » : le lien actif
    // porte une graisse et un filet, pas seulement une encre.
    render(<NavRail onSignOut={rien} />)

    const actif = screen.getByRole('link', { name: 'Saisie' })
    expect(actif.className).toContain('font-medium')
    expect(actif.className).toContain('border-l-accent-dark')
  })

  it('nomme les réglages par ce qu ils contrôlent, pas par leur route', () => {
    render(<NavRail onSignOut={rien} />)

    expect(screen.getByRole('link', { name: 'Règles de saisie' }).getAttribute('href')).toBe(
      '/admin/saisie',
    )
    expect(screen.getByRole('link', { name: 'Apparence' }).getAttribute('href')).toBe(
      '/admin/theme',
    )
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Thème' })).toBeNull()
  })

  it('garde le nom exact des quatre écrans que la navigation nommait déjà', () => {
    // Quatre tests de `layout.test.tsx` cherchent ces liens par leur nom
    // exact. Les renommer au passage rendrait ces écrans introuvables pour
    // qui les connaît, et ferait tomber ces tests sans rien améliorer.
    render(<NavRail onSignOut={rien} />)

    const href = (nom: string) => screen.getByRole('link', { name: nom }).getAttribute('href')
    expect(href('Dolibarr')).toBe('/admin/dolibarr')
    expect(href('Google')).toBe('/admin/google')
    expect(href('Synchro')).toBe('/admin/sync')
    expect(href('Abonnements')).toBe('/admin/webhooks')
    expect(href('Supervision')).toBe('/admin/supervision')
  })

  it('déplie les réglages sur le rail, et les replie hors de l’arbre d’accessibilité', async () => {
    // Ce test disait auparavant que les `<a>` restaient « atteignables »
    // repliés, parce qu'ils restaient dans le document. C'était faux : le
    // repli passe par `display:none`, qui les retire de l'arbre
    // d'accessibilité et de l'ordre de tabulation exactement comme un
    // démontage — et le test ne passait que parce que happy-dom ne charge
    // aucune feuille de style. Le repli porte donc maintenant l'attribut
    // `hidden`, que l'environnement de test honore, et c'est cette vérité-là
    // qui est vérifiée : sur le rail, le tiroir est déplié à l'arrivée.
    render(<NavRail onSignOut={rien} />)

    const bascule = screen.getByRole('button', { name: 'Réglages' })
    expect(bascule.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('link', { name: 'Supervision' })).toBeTruthy()

    await userEvent.click(bascule)
    expect(bascule.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Supervision' })).toBeNull()
    // Toujours monté, jamais démonté — mais masqué pour de bon.
    expect(screen.getByText('Supervision')).toBeTruthy()
  })

  it('ne rend jamais deux fois la même destination', () => {
    // Le rail et la barre basse sont **le même** jeu d'éléments, replacé par
    // le CSS. Deux jeux distincts doubleraient chaque lien dans le document,
    // et `getByRole` au singulier lèverait sur la moitié des tests de ce
    // fichier comme de `layout.test.tsx`.
    render(<NavRail onSignOut={rien} />)

    const href = screen.getAllByRole('link').map((lien) => lien.getAttribute('href'))
    expect(href).toHaveLength(new Set(href).size)
  })

  it('rend cinq onglets, chacun à la cible tactile', () => {
    render(<NavRail onSignOut={rien} />)

    const onglets = screen.getAllByTestId('onglet-mobile')
    expect(onglets).toHaveLength(5)
    for (const onglet of onglets) expect(onglet.className).toContain('touch-target')
  })

  it('donne à chaque onglet une icône dessinée qui lui est propre', () => {
    // Sur téléphone, cinq onglets partagent 375 points : l'icône est ce qui
    // se lit avant le libellé. Deux onglets au même tracé ne se distingueraient
    // qu'au texte, et une icône absente laisserait un onglet muet.
    render(<NavRail onSignOut={rien} />)

    const noms = screen.getAllByTestId('onglet-mobile').map((onglet) => {
      const icone = onglet.querySelector('svg[data-icone]')
      expect(icone, onglet.textContent ?? '').not.toBeNull()
      // `aria-hidden` : c'est le texte du lien qui nomme, jamais le tracé.
      expect(icone!.getAttribute('aria-hidden'), onglet.textContent ?? '').toBe('true')
      return icone!.getAttribute('data-icone')
    })
    expect(new Set(noms).size).toBe(5)
  })

  it('offre la déconnexion', () => {
    render(<NavRail onSignOut={rien} />)

    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy()
  })
})

/**
 * Le tiroir des réglages ne s'ouvre pas tout seul par-dessus le contenu.
 *
 * Sur le rail de bureau, le déplier à l'arrivée est le bon choix : sept écrans
 * cachés derrière un geste supplémentaire sont sept écrans qu'on oublie
 * d'ouvrir. Sous `md`, le même état produit un panneau flottant de 224 × 427
 * points — 31 % d'un écran de 375 × 812 — posé sur le calendrier à **chaque**
 * arrivée sur **chaque** page, et que rien ne refermait sinon un second appui
 * sur le bouton qu'il recouvre à moitié. Le plan l'interdit en toutes lettres :
 * « Aucun popover ».
 *
 * L'ancien test épinglait le défaut au lieu de le voir — il exigeait
 * `aria-expanded="true"` au premier rendu, sans distinguer les deux largeurs.
 */
describe('le tiroir des réglages selon la largeur', () => {
  /**
   * Un écran de largeur donnée, vu par `matchMedia`.
   *
   * La requête n'est pas ignorée mais **interprétée** : un composant qui
   * n'interrogerait aucune requête média, ou qui en interrogerait une autre
   * que celle du rail, ne passerait pas — la fonction lève sur une requête
   * qu'elle ne sait pas lire, et le seuil est celui que le composant écrit.
   */
  function ecranDe(largeur: number): void {
    vi.spyOn(window, 'matchMedia').mockImplementation((requete: string) => {
      const trouve = /min-width:\s*([\d.]+)(rem|px)/.exec(requete)
      if (trouve === null) throw new Error(`requête média inattendue : ${requete}`)
      const seuil = trouve[2] === 'rem' ? Number(trouve[1]) * 16 : Number(trouve[1])
      return {
        matches: largeur >= seuil,
        media: requete,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as MediaQueryList
    })
  }

  const bascule = () => screen.getByRole('button', { name: 'Réglages' })

  it('reste replié à l’arrivée sur un écran de 375 points', () => {
    ecranDe(375)
    render(<NavRail onSignOut={rien} />)

    expect(bascule().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Supervision' })).toBeNull()
  })

  it('se déplie à l’arrivée dès que le rail vertical s’applique', () => {
    // Le seuil est celui que le composant déclare, lu ici plutôt que recopié.
    ecranDe(768)
    render(<NavRail onSignOut={rien} />)

    expect(RAIL_MEDIA).toContain('min-width')
    expect(bascule().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('link', { name: 'Supervision' })).toBeTruthy()
  })

  it('referme le tiroir mobile au changement de route', async () => {
    // Sans cela, suivre un lien du tiroir laissait le panneau ouvert sur
    // l'écran d'arrivée, et il fallait revenir le fermer à la main.
    ecranDe(375)
    const { rerender } = render(<NavRail onSignOut={rien} />)

    await userEvent.click(bascule())
    expect(bascule().getAttribute('aria-expanded')).toBe('true')

    routeur.route = '/admin/supervision'
    rerender(<NavRail onSignOut={rien} />)
    expect(bascule().getAttribute('aria-expanded')).toBe('false')
  })

  it('referme le tiroir sur Échap', async () => {
    ecranDe(375)
    render(<NavRail onSignOut={rien} />)

    await userEvent.click(bascule())
    expect(bascule().getAttribute('aria-expanded')).toBe('true')

    await userEvent.keyboard('{Escape}')
    expect(bascule().getAttribute('aria-expanded')).toBe('false')
  })
})

/**
 * La barre basse tient-elle dans 375 points — mesurée, pas affirmée.
 *
 * Le test qui portait ce nom comptait cinq éléments et cherchait la chaîne
 * `touch-target` : il survivait à un `px-3` multiplié par 6,7 et à une barre
 * ramenée à 64 points de large. Son commentaire faisait pourtant le calcul
 * — « cinq entrées à 44 points font 220 points » —, sur une prémisse fausse :
 * la mise en page ne partageait pas la barre en cinq colonnes mais en deux
 * moitiés, si bien que les quatre onglets du travail recevaient 41,4 points
 * chacun, sous la cible tactile, pour 64 à 92 points de contenu.
 *
 * La méthode est celle du budget des sept colonnes du calendrier : les jetons
 * se lisent dans `globals.css`, les rembourrages, gouttières, bordures et
 * parts de flex se lisent sur les éléments rendus, et l'avance d'un caractère
 * est prise volontairement pessimiste.
 */
describe('barre basse — le budget de 375 points', () => {
  const CSS = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')

  /** Un écran de 375 points : l'iPhone le plus étroit encore en service. */
  const ECRAN = 375

  const rem = (valeur: string): number => Number(valeur) * 16

  const bloc = /@utility\s+touch-target\s*\{([^}]*)\}/.exec(CSS)
  expect(bloc, '@utility touch-target introuvable dans globals.css').not.toBeNull()
  const CIBLE = rem(/min-width:\s*([\d.]+)rem/.exec(bloc![1]!)![1]!)

  const pasTrouve = /--spacing:\s*([\d.]+)rem/.exec(CSS)
  expect(pasTrouve, '--spacing introuvable dans globals.css').not.toBeNull()
  const PAS = rem(pasTrouve![1]!)

  /**
   * Avance horizontale d'un caractère, en fraction du corps — la même valeur
   * pessimiste que le budget des sept colonnes du calendrier. Sous-estimer
   * ferait passer un test qui doit refuser.
   */
  const AVANCE = 0.75

  /** Nombre de pas d'une classe `px-N`, en tenant compte du variant mobile. */
  function espacement(el: Element, propriete: string): number {
    const classes = el.className.split(/\s+/)
    // `max-md:` l'emporte : c'est la barre basse qu'on mesure, pas le rail.
    const mobile = classes.find((c) => c.startsWith(`max-md:${propriete}-`))
    const base = classes.find((c) => c.startsWith(`${propriete}-`))
    const retenue = mobile ?? base
    expect(retenue, `aucun ${propriete}-* sur « ${el.className} »`).toBeDefined()
    const valeur = retenue!.slice(retenue!.lastIndexOf('-') + 1)
    return Number(valeur) * PAS
  }

  /** Le corps du libellé sur téléphone, lu sur la classe `max-md:text-[Npx]`. */
  function corps(el: Element): number {
    const trouve = /max-md:text-\[(\d+)px\]/.exec(el.className)
    expect(trouve, `aucun corps mobile déclaré sur « ${el.className} »`).not.toBeNull()
    return Number(trouve![1]!)
  }

  /** Part de flex d'un `<nav>` sous `md` : `flex-[4]` ou `flex-1`. */
  function part(el: Element): number {
    const trouve = /(?:^|\s)flex-(?:\[(\d+)\]|(\d+))(?:\s|$)/.exec(el.className)
    expect(trouve, `aucune part de flex sur « ${el.className} »`).not.toBeNull()
    return Number(trouve![1] ?? trouve![2])
  }

  function racine(): HTMLElement {
    return screen.getByRole('navigation', { name: 'Travail' }).parentElement as HTMLElement
  }

  it('loge la largeur intrinsèque des cinq onglets dans 375 points', () => {
    render(<NavRail onSignOut={rien} />)

    const conteneur = racine()
    const gouttiere = espacement(conteneur, 'gap')
    const onglets = screen.getAllByTestId('onglet-mobile')
    expect(onglets).toHaveLength(5)

    let requis = 2 * espacement(conteneur, 'px') + (onglets.length - 1) * gouttiere
    for (const onglet of onglets) {
      const icone = onglet.querySelector('svg[data-icone]')
      expect(icone, onglet.textContent ?? '').not.toBeNull()
      const largeurIcone = Number(icone!.getAttribute('width'))
      expect(largeurIcone).toBeGreaterThan(0)

      const libelle = (onglet.textContent ?? '').trim()
      expect(libelle.length).toBeGreaterThan(0)
      const largeurLibelle = libelle.length * AVANCE * corps(onglet)

      // Le libellé passe **sous** l'icône : la largeur de l'onglet est celle du
      // plus large des deux, plus son rembourrage. Le poser à côté additionnait
      // les deux termes et demandait 552 points pour 375 disponibles. Cette
      // prémisse est vérifiée et non supposée : sans l'empilement, le `max`
      // ci-dessous mesurerait une largeur que l'onglet n'a pas.
      expect(onglet.className, onglet.textContent ?? '').toContain('max-md:flex-col')
      const contenu = Math.max(largeurIcone, largeurLibelle)
      requis += Math.max(CIBLE, 2 * espacement(onglet, 'px') + contenu)
    }

    expect(requis).toBeLessThanOrEqual(ECRAN)
  })

  it('donne à chaque onglet la place de sa cible tactile', () => {
    // Deux `<nav>` à parts égales donnaient au seul bouton « Réglages » autant
    // de largeur qu'aux quatre onglets du travail réunis : chacun tombait à
    // 41,4 points, sous la cible de 44, et son contenu débordait de sa propre
    // boîte de clic — le libellé se peignait sur l'onglet voisin.
    render(<NavRail onSignOut={rien} />)

    const conteneur = racine()
    const travail = screen.getByRole('navigation', { name: 'Travail' })
    const reglages = screen.getByRole('navigation', { name: 'Réglages' })
    const gouttiere = espacement(conteneur, 'gap')

    const disponible = ECRAN - 2 * espacement(conteneur, 'px') - gouttiere
    const parts = part(travail) + part(reglages)
    const largeurTravail = (disponible * part(travail)) / parts
    const largeurReglages = (disponible * part(reglages)) / parts

    const onglets = travail.querySelectorAll('[data-testid="onglet-mobile"]')
    expect(onglets).toHaveLength(4)
    const parOnglet = (largeurTravail - (onglets.length - 1) * gouttiere) / onglets.length

    expect(parOnglet).toBeGreaterThanOrEqual(CIBLE)
    expect(largeurReglages).toBeGreaterThanOrEqual(CIBLE)
  })
})
