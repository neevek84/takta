'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import {
  IconeCharge,
  IconeCra,
  IconeMissions,
  IconeReglages,
  IconeSaisie,
  type Icone,
} from '@/components/ui/icons'
import { cn } from '@/lib/cn'

/**
 * Les quatre écrans du travail quotidien. Ce sont eux, et eux seuls, qui
 * deviennent des onglets sur téléphone : ce sont les seuls qu'on ouvre
 * plusieurs fois par jour.
 */
const TRAVAIL: { href: string; label: string; icone: Icone }[] = [
  { href: '/saisie', label: 'Saisie', icone: IconeSaisie },
  { href: '/charge', label: 'Charge', icone: IconeCharge },
  { href: '/missions', label: 'Missions', icone: IconeMissions },
  { href: '/cra', label: 'CRA', icone: IconeCra },
]

/**
 * Les sept écrans de réglage. `src/app/(app)/admin/` en contient exactement
 * sept, et `layout.test.tsx` lit ce dossier pour exiger un lien par écran :
 * cette liste **s'étend**, elle ne se remplace pas.
 *
 * Deux libellés seulement changent, et ce sont les deux qui nommaient la route
 * plutôt que ce que la personne contrôle : « Admin » → « Règles de saisie »,
 * « Thème » → « Apparence ». Les cinq autres gardent leur nom exact — la clé
 * d'API Dolibarr, le client OAuth Google, la file de synchronisation, les
 * abonnements sortants et la supervision ne se saisissent ni ne se consultent
 * nulle part ailleurs, et quatre tests les cherchent par ce nom-là.
 */
const REGLAGES = [
  { href: '/admin/saisie', label: 'Règles de saisie' },
  { href: '/admin/theme', label: 'Apparence' },
  { href: '/admin/dolibarr', label: 'Dolibarr' },
  { href: '/admin/google', label: 'Google' },
  { href: '/admin/sync', label: 'Synchro' },
  { href: '/admin/webhooks', label: 'Abonnements' },
  { href: '/admin/supervision', label: 'Supervision' },
] as const

/**
 * La route courante active-t-elle cette entrée ?
 *
 * La comparaison part **du début** : `/saisie/2026-08` active « Saisie », mais
 * `/admin/saisie` ne l'active pas, alors que les deux finissent par le même
 * mot. Le séparateur est exigé pour que `/craie` n'active jamais `/cra`.
 */
export function estActif(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Le point de rupture du rail, écrit une fois. `md` vaut 48rem chez Tailwind :
 * au-dessus, la navigation est un rail vertical ; en dessous, une barre basse.
 * La valeur sert aussi en JavaScript — l'état déplié du tiroir n'est pas le
 * même des deux côtés —, et deux écritures divergentes donneraient un rendu
 * qui ne correspond à aucun des deux.
 */
export const RAIL_MEDIA = '(min-width: 48rem)'

/**
 * L'état actif ne se dit jamais par la seule teinte : il porte un filet et une
 * graisse, et `aria-current="page"` le nomme. Le filet est latéral dans le
 * rail, et passe au sommet dans la barre basse — un flanc de 2 points entre
 * deux onglets côte à côte ne se rattache à aucun des deux.
 *
 * Le filet est en `accentDark`, tenu à 3:1 sur la page et sur la surface par
 * `NON_TEXT_PAIRS` — `accent` n'y est pas, et un repère non textuel invisible
 * ne repère rien.
 *
 * Le fond actif est `off`, et non `offStrong` : `link` sur `offStrong` n'est
 * pas un couple déclaré, et le balayage de `tokens.test.ts` le refuse — il a
 * refusé cette première écriture.
 *
 * **Sous `md`, le libellé passe sous l'icône.** Cinq entrées se partagent 375
 * points : posé à côté de l'icône, le libellé demandait 552 points de largeur
 * intrinsèque et se peignait hors de sa propre boîte de clic, sur l'onglet
 * voisin. Empilé, corps ramené à 10 points et rembourrage à un demi-pas, le
 * budget retombe à 302 points — mesuré par `NavRail.test.tsx`, pas supposé.
 */
function classesDuLien(actif: boolean, onglet = false): string {
  return cn(
    'touch-target flex w-full items-center gap-2 rounded-md px-3 text-sm',
    'border-l-2 transition-colors duration-150',
    // Les sept entrées du tiroir n'en sont pas : elles vivent dans un panneau
    // de 224 points, où le libellé a toute sa place et garde le dessin du
    // rail. Les empiler et les réduire à 10 points là aussi n'économiserait
    // aucune largeur et rendrait sept lignes illisibles.
    onglet && 'max-md:flex-col max-md:justify-center max-md:gap-0.5 max-md:px-0.5 max-md:text-[10px]',
    onglet && 'max-md:border-l-0 max-md:border-t-2',
    actif
      ? cn('border-l-accent-dark bg-off font-medium text-link', onglet && 'max-md:border-t-accent-dark')
      : cn(
          'border-l-transparent text-muted hover:bg-off hover:text-ink',
          onglet && 'max-md:border-t-transparent',
        ),
  )
}

/**
 * La navigation de l'application : un rail vertical sur écran large, une barre
 * d'onglets basse sur téléphone.
 *
 * **C'est un seul jeu d'éléments, replacé par le CSS**, et non deux rendus
 * concurrents. Rendre le rail et la barre séparément doublerait chaque lien
 * dans le document : `getByRole('link', { name: 'Synchro' })` lèverait
 * « found multiple elements » alors même que l'écran, lui, serait correct.
 *
 * Chaque entrée porte son icône. Elles ne changent aucun nom accessible :
 * elles portent toutes `aria-hidden`, et c'est le texte du lien qui nomme.
 * Elles ne portent donc **aucune information à elles seules** — sur téléphone,
 * où la place manque, c'est le libellé qui reste, jamais l'inverse.
 */
export function NavRail({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const pathname = usePathname()
  /**
   * Déplié dans le rail, replié dans la barre basse — et l'état repart de la
   * largeur à chaque changement de route.
   *
   * Dans le rail, sept écrans de réglage cachés derrière un geste
   * supplémentaire sont sept écrans qu'on oublie d'ouvrir. Sur téléphone, le
   * même état déplié produit tout autre chose : le tiroir y est un panneau
   * flottant de 224 × 427 points, soit 31 % de l'écran couverts dès la
   * première peinture de **chaque** page, que rien ne refermait sinon un
   * second appui. Le plan l'interdit en toutes lettres.
   *
   * L'état initial est donc `false` et non la largeur : le rendu serveur ne
   * connaît pas l'écran, et poser `true` y ferait clignoter le panneau sur
   * téléphone. L'effet le déplie au premier rendu client sur écran large.
   */
  const [ouvert, setOuvert] = useState(false)

  useEffect(() => {
    setOuvert(window.matchMedia(RAIL_MEDIA).matches)
  }, [pathname])

  return (
    <div
      onKeyDown={(ev) => {
        // Échap referme le tiroir : sur téléphone c'est un panneau posé sur le
        // contenu, et le seul autre moyen de s'en défaire était de retrouver
        // le bouton qu'il recouvre à moitié.
        if (ev.key === 'Escape') setOuvert(false)
      }}
      className={cn(
        'fixed inset-x-0 bottom-0 z-20 flex items-stretch gap-1 border-t border-rule bg-surface px-2 py-1',
        'md:static md:h-dvh md:w-56 md:shrink-0 md:flex-col md:items-stretch md:gap-4',
        'md:border-t-0 md:border-r md:px-3 md:py-4',
      )}
    >
      {/* Quatre parts contre une : les deux `<nav>` étaient tous deux
          `flex-1`, si bien que le seul bouton « Réglages » recevait autant de
          largeur que les quatre onglets du travail réunis — 41,4 points
          chacun, sous la cible tactile de 44 que ce lot s'engage à tenir. */}
      <nav aria-label="Travail" className="min-w-0 flex-[4] md:flex-none">
        <ul className="flex items-stretch gap-1 md:flex-col md:gap-1">
          {TRAVAIL.map((entree) => (
            <li key={entree.href} className="min-w-0 flex-1 md:flex-none">
              <Link
                href={entree.href}
                aria-current={estActif(pathname, entree.href) ? 'page' : undefined}
                data-testid="onglet-mobile"
                className={classesDuLien(estActif(pathname, entree.href), true)}
              >
                <entree.icone className="shrink-0" />
                {entree.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Réglages" className="relative min-w-0 flex-[1] md:flex-none">
        <button
          type="button"
          aria-expanded={ouvert}
          onClick={() => setOuvert((etat) => !etat)}
          data-testid="onglet-mobile"
          // Le même habillage que les quatre onglets du travail, et non une
          // copie de ses classes : deux écritures divergeaient dès la première
          // correction de largeur.
          className={classesDuLien(false, true)}
        >
          <IconeReglages className="shrink-0" />
          Réglages
        </button>

        {/* Le repli est porté par l'attribut `hidden`, et pas seulement par la
            classe du même nom. Une version antérieure affirmait ici que le
            tiroir replié « n'est que masqué » et que ses `<a>` restaient
            atteignables : c'est faux — `display:none` les retire de l'arbre
            d'accessibilité et de l'ordre de tabulation, exactement comme un
            démontage. Le contrôle de couverture des sept écrans
            (`layout.test.tsx`) ne le voyait pas, faute de feuille de style en
            test. L'attribut, lui, se voit partout : le garde-fou tombe
            désormais si quelqu'un replie le tiroir par défaut sur le rail. */}
        <div
          hidden={!ouvert}
          className={cn(
            'absolute right-0 bottom-full mb-1 w-56 rounded-md border border-rule bg-surface p-2 shadow-card',
            'md:static md:mb-0 md:w-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none',
          )}
        >
          <ul className="flex flex-col gap-1">
            {REGLAGES.map((entree) => (
              <li key={entree.href}>
                <Link
                  href={entree.href}
                  aria-current={estActif(pathname, entree.href) ? 'page' : undefined}
                  className={classesDuLien(estActif(pathname, entree.href))}
                >
                  {entree.label}
                </Link>
              </li>
            ))}
          </ul>

          <form action={onSignOut} className="mt-2 border-t border-rule pt-2">
            <Button variant="quiet" type="submit" className="w-full justify-start">
              Se déconnecter
            </Button>
          </form>
        </div>
      </nav>
    </div>
  )
}
