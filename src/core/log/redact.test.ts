import { describe, it, expect } from 'vitest'
import { estCleSensible, redige } from './redact'

describe('valeurs connues du déploiement', () => {
  it('efface une valeur de secret fournie, où qu elle apparaisse', () => {
    const cle = 'K7fQ2mZp9xA4bC6dE8gH1jL3nP5rT0vW'
    const texte = `échec avec la clé ${cle} (et encore ${cle})`

    expect(redige(texte, [cle])).toBe('échec avec la clé [secret] (et encore [secret])')
  })

  it('efface une valeur qui contient des caractères spéciaux d expression régulière', () => {
    // Un secret base64 contient `+`, `/` et `=` : les interpoler tels quels
    // dans une expression régulière produirait au mieux une non-correspondance,
    // au pire une exception — donc un secret laissé en clair.
    const cle = 'a+b/c=dEfGhIjKlMnOpQrStUvWxYz0123456789=='
    expect(redige(`clé=${cle} refusée`, [cle])).toBe('clé=[secret] refusée')
  })

  it('ignore les valeurs trop courtes pour être des secrets', () => {
    // Effacer « true » ou « 3 » découperait tous les messages en confettis.
    expect(redige('mode true, tentative 3', ['true', '3', ''])).toBe('mode true, tentative 3')
  })
})

describe('formes reconnaissables de secret', () => {
  it('efface la valeur des paramètres nommés comme un secret', () => {
    const texte =
      'POST /token?client_id=1234567890-abc.apps.googleusercontent.com&client_secret=GOCSPX-abcdef&code=4/0Ab_c'

    const sortie = redige(texte)

    expect(sortie).not.toContain('GOCSPX-abcdef')
    expect(sortie).not.toContain('googleusercontent')
    expect(sortie).not.toContain('4/0Ab_c')
    // Le nom du paramètre reste : c'est lui qui rend le message diagnosticable.
    expect(sortie).toContain('client_secret=[secret]')
  })

  it('efface la valeur des champs JSON nommés comme un secret', () => {
    const texte = '{"access_token":"ya29.a0AfH6SMB","expires_in":3599}'

    const sortie = redige(texte)

    expect(sortie).not.toContain('ya29.a0AfH6SMB')
    expect(sortie).toContain('expires_in')
  })

  it('efface un jeton porté par un en-tête Authorization', () => {
    const sortie = redige('authorization: Bearer ya29.A0ARrdaM9xKqLmNoPqRsTuVwXyZ')

    expect(sortie).not.toContain('ya29')
    expect(sortie).toContain('Bearer [secret]')
  })

  it('efface une longue chaîne opaque non nommée', () => {
    // Un jeton recopié sans nom de champ dans un message d'erreur reste un
    // jeton : la longueur et le mélange majuscules/chiffres le trahissent.
    const sortie = redige('refus sur ya29A0ARrdaM9xKqLmNoPqRsTuVwXyZ1234')

    expect(sortie).toBe('refus sur [secret]')
  })
})

describe('ce que la rédaction doit laisser passer', () => {
  it('laisse intact le nom des variables d environnement', () => {
    // Le README promet un message nommant CREDENTIALS_KEY : le rédacteur qui
    // l'effacerait supprimerait précisément l'information utile.
    const texte = "CREDENTIALS_KEY est absente de l'environnement."
    expect(redige(texte)).toBe(texte)
  })

  it('laisse intacts les chemins et les URL de diagnostic', () => {
    const texte =
      'échec sur https://www.googleapis.com/calendar/v3/calendars/primary/events (HTTP 403)'
    expect(redige(texte)).toBe(texte)
  })

  it('laisse intact un identifiant interne minuscule', () => {
    // Les `cuid()` de Prisma sont en minuscules : ils doivent survivre, c'est
    // par eux qu'on retrouve la ligne concernée.
    const texte = 'userId=clx1n2o3p4q5r6s7t8u9v0w1'
    expect(redige(texte)).toBe(texte)
  })

  it('rend une chaîne vide sans erreur', () => {
    expect(redige('')).toBe('')
  })
})

describe('estCleSensible', () => {
  it.each([
    'token',
    'accessToken',
    'refresh_token',
    'CREDENTIALS_KEY',
    'clientSecret',
    'client_id',
    'password',
    'authorization',
    'code',
  ])('%s est traitée comme sensible', (nom) => {
    expect(estCleSensible(nom)).toBe(true)
  })

  it.each(['userId', 'provider', 'etape', 'raison', 'statut', 'entryId'])(
    '%s n est pas traitée comme sensible',
    (nom) => {
      expect(estCleSensible(nom)).toBe(false)
    },
  )
})
