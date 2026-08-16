import { describe, it, expect } from 'vitest'
import { GOOGLE_CALLBACK_PATH, redirectUriPour, validerClientOAuth } from './oauth-client'

describe('redirectUriPour', () => {
  it('colle le chemin de retour à l origine réellement servie', () => {
    expect(redirectUriPour('http://localhost:3000')).toBe(
      `http://localhost:3000${GOOGLE_CALLBACK_PATH}`,
    )
  })

  it('produit une URL différente pour un port différent', () => {
    // C'est exactement ce que le mode portable fait quand le 3000 est pris, et
    // c'est ce que Google refuse en silence si personne ne le ré-enregistre.
    expect(redirectUriPour('http://localhost:3000')).not.toBe(
      redirectUriPour('http://localhost:3001'),
    )
    expect(redirectUriPour('http://localhost:3001')).toContain(':3001')
  })

  it('ignore le chemin, la requête et le fragment de l adresse fournie', () => {
    // L'écran passe l'URL de la page courante ; Google n'accepte qu'une URL de
    // retour nue. Recopier `/admin/google?message=…` produirait une URL que
    // Google refuse, avec une erreur venue de chez lui.
    expect(redirectUriPour('https://cra.exemple.fr/admin/google?message=ok#bas')).toBe(
      `https://cra.exemple.fr${GOOGLE_CALLBACK_PATH}`,
    )
  })

  it('rend la chaîne vide pour une adresse illisible, au lieu d inventer', () => {
    expect(redirectUriPour('')).toBe('')
    expect(redirectUriPour('pas une url')).toBe('')
  })
})

describe('validerClientOAuth', () => {
  const valide = {
    clientId: '1234.apps.googleusercontent.com',
    clientSecret: 'un-secret-de-client',
    redirectUri: `http://localhost:3000${GOOGLE_CALLBACK_PATH}`,
  }

  it('accepte un client complet', () => {
    expect(validerClientOAuth(valide).ok).toBe(true)
  })

  it('rogne les espaces autour des valeurs saisies', () => {
    // Un identifiant collé depuis la console Google arrive régulièrement avec
    // un espace ou un retour ligne : Google le refuserait sans rien expliquer.
    const r = validerClientOAuth({
      clientId: `  ${valide.clientId}\n`,
      clientSecret: ` ${valide.clientSecret} `,
      redirectUri: ` ${valide.redirectUri} `,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.client).toEqual(valide)
  })

  it('refuse un identifiant de client vide', () => {
    const r = validerClientOAuth({ ...valide, clientId: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.join(' ')).toContain("L'identifiant du client")
  })

  it('refuse un secret de client vide', () => {
    const r = validerClientOAuth({ ...valide, clientSecret: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.join(' ')).toContain('secret du client')
  })

  it('refuse une URL de retour qui n est pas absolue', () => {
    const r = validerClientOAuth({ ...valide, redirectUri: '/api/google/callback' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.join(' ')).toContain('complète')
  })

  it('refuse une URL de retour dont le chemin n est pas celui du retour', () => {
    // Google compare au caractère près : une URL qui ne pointe pas sur la
    // route de retour ne peut produire qu'un échec chez Google, plus tard.
    const r = validerClientOAuth({ ...valide, redirectUri: 'http://localhost:3000/admin/google' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.join(' ')).toContain(GOOGLE_CALLBACK_PATH)
  })

  it('refuse une URL de retour porteuse d une requête ou d un fragment', () => {
    for (const suffixe of ['?x=1', '#bas']) {
      const r = validerClientOAuth({ ...valide, redirectUri: `${valide.redirectUri}${suffixe}` })
      expect(r.ok, suffixe).toBe(false)
    }
  })

  it('refuse http ailleurs que sur la machine locale', () => {
    // Règle de Google, pas la nôtre : hors localhost, seule https est
    // acceptée. L'accepter ici ne ferait que déplacer le refus chez Google.
    const r = validerClientOAuth({
      ...valide,
      redirectUri: `http://cra.exemple.fr${GOOGLE_CALLBACK_PATH}`,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.join(' ')).toContain('https')
  })

  it('accepte http sur 127.0.0.1 comme sur localhost', () => {
    for (const hote of ['localhost', '127.0.0.1']) {
      const r = validerClientOAuth({
        ...valide,
        redirectUri: `http://${hote}:3000${GOOGLE_CALLBACK_PATH}`,
      })
      expect(r.ok, hote).toBe(true)
    }
  })

  it('cumule les refus au lieu de s arrêter au premier', () => {
    const r = validerClientOAuth({ clientId: '', clientSecret: '', redirectUri: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.length).toBe(3)
  })

  it('ne recopie jamais le secret dans un message de refus', () => {
    // Un message d'erreur part à l'écran et parfois au journal : y recopier la
    // valeur qu'on vient de saisir suffit à la compromettre.
    const r = validerClientOAuth({ ...valide, redirectUri: 'pas-une-url' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs.join(' ')).not.toContain(valide.clientSecret)
  })
})
