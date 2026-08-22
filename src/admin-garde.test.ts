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

  it('ne laisse aucune action d administration sans garde', () => {
    const fautifs: string[] = []

    for (const fichier of fichiersDActions()) {
      const relatif = chemin(fichier)
      const exemptes = ACTIONS_PERSONNELLES[relatif] ?? []
      const contenu = readFileSync(fichier, 'utf8')

      for (const trouve of contenu.matchAll(/export async function (\w+)/g)) {
        const nom = trouve[1]!
        if (exemptes.includes(nom)) continue
        // Les 600 caractères qui suivent la signature : assez pour couvrir la
        // liste d'arguments et les premières lignes du corps, trop peu pour
        // attraper la garde de la fonction suivante.
        const corps = contenu.slice(trouve.index!, trouve.index! + 600)
        if (!corps.includes('exigerAdministration(')) fautifs.push(`${relatif}#${nom}`)
      }
    }

    expect(
      fautifs,
      `${fautifs.join(', ')} : une action d'administration doit appeler exigerAdministration()`,
    ).toEqual([])
  })
})
