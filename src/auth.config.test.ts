import { describe, it, expect } from 'vitest'
import { authConfig } from './auth.config'

type Autorise = NonNullable<NonNullable<typeof authConfig.callbacks>['authorized']>

const autorise = authConfig.callbacks!.authorized! as Autorise

function juger(chemin: string, connecte: boolean): boolean {
  return Boolean(
    autorise({
      auth: connecte ? ({ user: { id: 'u1' } } as never) : null,
      request: { nextUrl: new URL(`https://takta.test${chemin}`) } as never,
    }),
  )
}

/**
 * **Le portier du milieu**, celui qui tourne dans le runtime edge, avant toute
 * page. Aucun test ne le couvrait, et il décide pourtant de ce qui est
 * atteignable sans session — c'est-à-dire de la surface entière de
 * l'application pour un visiteur.
 */
describe('ce que le portier laisse passer sans session', () => {
  it("ouvre l'écran de connexion", () => {
    expect(juger('/login', false)).toBe(true)
  })

  /**
   * **Sans cette ligne, tout le parcours du mot de passe est mort.**
   *
   * Il s'adresse par construction à qui **ne peut pas** se connecter : celui
   * qui a oublié son mot de passe, et celui qui n'en a jamais eu — les comptes
   * nés de la reprise Dolibarr, ceux que Google créera. Exiger une session
   * pour y accéder renvoie le porteur d'un lien valide vers `/login`, c'est-
   * à-dire vers la porte qu'il ne sait justement pas ouvrir.
   *
   * Ce n'est pas un trou : le jeton **est** le laissez-passer, il vit dix
   * minutes, la base n'en porte que l'empreinte, et il tombe dès qu'il sert.
   */
  it('ouvre le parcours du mot de passe', () => {
    expect(juger('/mot-de-passe', false)).toBe(true)
    expect(juger('/mot-de-passe?jeton=abc', false)).toBe(true)
  })

  it('ferme tout le reste', () => {
    for (const chemin of ['/saisie', '/cra', '/missions', '/admin/comptes', '/profil', '/']) {
      expect(juger(chemin, false), chemin).toBe(false)
    }
  })

  it('ouvre le reste à qui porte une session', () => {
    expect(juger('/saisie', true)).toBe(true)
    expect(juger('/admin/comptes', true)).toBe(true)
  })
})
