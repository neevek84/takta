import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Aucun écran d'administration derrière une simple session.
 *
 * Le défaut, relevé par les quatre revues adversariales et resté ouvert tant que
 * l'application n'a eu qu'un compte : `/admin/dolibarr`, `/admin/google` et
 * `/admin/sync` n'ont jamais lu que `requireUser()`. Tout compte authentifié
 * pouvait connecter, déconnecter ou repointer.
 *
 * Corriger les huit écrans connus laisserait le neuvième répéter le défaut. Ce
 * contrôle refuse donc la **forme**, à la manière de `src/frontieres.test.ts` :
 * un écran ajouté sans sa garde le fait tomber, et retirer la garde d'un écran
 * existant aussi.
 */
const ADMIN = join(process.cwd(), 'src', 'app', '(app)', 'admin')

function ecrans(): string[] {
  return readdirSync(ADMIN, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ADMIN, e.name, 'page.tsx')))
    .map((e) => join(ADMIN, e.name, 'page.tsx'))
}

function fichiersDActions(): string[] {
  return readdirSync(ADMIN, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ADMIN, e.name, 'actions.ts')))
    .map((e) => join(ADMIN, e.name, 'actions.ts'))
}

/**
 * L'unique écran **mixte**, et la raison de son exception.
 *
 * `/admin/sync` porte deux choses de portées différentes : les divergences et
 * les échecs d'une personne, et la file de l'instance. L'arbitrage du porteur du
 * 20 août 2026 tient — « un CRA s'envoie par mission, pas par consultant » —,
 * donc la file reste d'instance et l'écran reste ouvert. Ce que les rôles y
 * posent, c'est **qui voit la file**, et le contrôle l'exige explicitement plus
 * bas : l'exception n'est pas un trou, c'est une obligation différente.
 */
const ECRAN_MIXTE = 'admin/sync/page.tsx'

/**
 * Les actions d'administration qui restent **personnelles**, nommées une à une.
 *
 * Elles vivent sous `/admin/` pour des raisons d'histoire, mais elles n'agissent
 * que sur le compte de la session : les interdire à un consultant lui retirerait
 * l'arbitrage de ses propres divergences et le drainage de sa propre file.
 * Nommer les exceptions, plutôt qu'exempter le fichier, garde le contrôle
 * mordant : une action ajoutée à ce fichier sans garde le fait tomber.
 */
const ACTIONS_PERSONNELLES: Readonly<Record<string, readonly string[]>> = {
  'admin/sync/actions.ts': ['synchroniserMaintenant', 'arbitrer'],
}

/**
 * Où s'arrête la fonction ouverte à `debut`.
 *
 * Une accolade seule en début de ligne referme la fonction ; un `export` en
 * début de ligne ouvre la suivante. Le premier des deux borne le corps. Le
 * `(?=\n|$)` écarte le `}` d'un argument déstructuré sur plusieurs lignes, qui
 * n'est pas une fin de fonction.
 */
function finDuCorps(contenu: string, debut: number): number {
  const reste = contenu.slice(debut)
  const bornes = [/\n\}(?=\n|$)/, /\nexport /]
    .map((borne) => reste.search(borne))
    .filter((index) => index >= 0)
  return bornes.length === 0 ? contenu.length : debut + Math.min(...bornes)
}

/**
 * Les actions d'un fichier qui n'appellent pas la garde, hors exceptions nommées.
 *
 * La tranche lue s'arrête au corps de la fonction courante. Une fenêtre de
 * taille fixe — 600 caractères — débordait sur la fonction suivante dès qu'une
 * action était courte : la garde de la voisine couvrait l'action nue, et une
 * action d'administration sans aucune garde passait le contrôle.
 */
function actionsSansGarde(contenu: string, exemptes: readonly string[]): string[] {
  const fautifs: string[] = []

  for (const trouve of contenu.matchAll(/export async function (\w+)/g)) {
    const nom = trouve[1]!
    if (exemptes.includes(nom)) continue
    const corps = contenu.slice(trouve.index!, finDuCorps(contenu, trouve.index!))
    if (!corps.includes('exigerAdministration(')) fautifs.push(nom)
  }

  return fautifs
}

function chemin(fichier: string): string {
  return relative(join(process.cwd(), 'src', 'app', '(app)'), fichier).split('\\').join('/')
}

describe('les écrans d administration exigent le rôle', () => {
  it('a bien plus de cinq écrans à garder', () => {
    // Le contrôle lit les dossiers : s'il n'en trouvait aucun, il passerait en
    // ne gardant rien.
    expect(ecrans().length).toBeGreaterThan(5)
  })

  it('ne laisse aucun écran derrière la seule session', () => {
    const fautifs: string[] = []

    for (const fichier of ecrans()) {
      const relatif = chemin(fichier)
      if (relatif === ECRAN_MIXTE) continue
      const contenu = readFileSync(fichier, 'utf8')
      if (!contenu.includes('accesAdministration(') || !contenu.includes('<AccesRefuse')) {
        fautifs.push(relatif)
      }
    }

    expect(
      fautifs,
      `${fautifs.join(', ')} : un écran d'administration doit appeler accesAdministration() et rendre <AccesRefuse/>`,
    ).toEqual([])
  })

  it('exige de l écran mixte qu il gate ce qui est d instance', () => {
    const contenu = readFileSync(join(ADMIN, 'sync', 'page.tsx'), 'utf8')
    expect(
      contenu.includes('peutAdministrer('),
      "/admin/sync est ouvert à tous : il doit lui-même décider qui voit la file d'instance",
    ).toBe(true)
  })

  it('ne se laisse pas couvrir par la garde de l action suivante', () => {
    // Deux actions courtes qui se suivent : la garde de `seconde` tombait dans
    // la fenêtre ouverte après la signature de `premiere`, et une action nue
    // passait le contrôle. C'est exactement la forme de `admin/comptes`.
    const source = `'use server'

export async function premiere(userId: string): Promise<void> {
  await definirRole({ userId, role: 'ADMIN' })
}

export async function seconde(userId: string): Promise<void> {
  await exigerAdministration()
  await definirActivation({ userId, actif: false })
}
`
    expect(
      actionsSansGarde(source, []),
      "la garde d'une action ne doit jamais compter pour sa voisine",
    ).toEqual(['premiere'])
  })

  it('ne laisse aucune action d administration sans garde', () => {
    const fautifs: string[] = []

    for (const fichier of fichiersDActions()) {
      const relatif = chemin(fichier)
      const exemptes = ACTIONS_PERSONNELLES[relatif] ?? []
      const contenu = readFileSync(fichier, 'utf8')

      for (const nom of actionsSansGarde(contenu, exemptes)) fautifs.push(`${relatif}#${nom}`)
    }

    expect(
      fautifs,
      `${fautifs.join(', ')} : une action d'administration doit appeler exigerAdministration()`,
    ).toEqual([])
  })
})
