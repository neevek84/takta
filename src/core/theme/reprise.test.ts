import { describe, it, expect } from 'vitest'
import {
  verdictDeReprise,
  configDeReprise,
  NEUTRE_AVANT_1G_CLAIR,
  NEUTRE_AVANT_1G_SOMBRE,
  NEUTRE_LOT_1E,
} from './reprise'
import {
  THEME_ENCRE_CLAIR,
  THEME_ENCRE_SOMBRE,
  THEME_KREATIVPM,
  THEME_TOKEN_KEYS,
} from './tokens'

describe('reprise du thème au lot 1g', () => {
  it('fige 44 jetons, ceux d’avant le lot 1g — ni plus, ni moins', () => {
    // Le lot 1g en a ajouté trois (`prevu`, `prevuInk`, `prevuEdge`) puis un
    // quatrième (`saisie`). Une base existante n'en porte aucun : les inscrire
    // dans la référence ferait échouer toutes les reconnaissances.
    expect(Object.keys(NEUTRE_AVANT_1G_CLAIR)).toHaveLength(44)
    expect(Object.keys(NEUTRE_AVANT_1G_SOMBRE)).toHaveLength(44)
    for (const nouveau of ['prevu', 'prevuInk', 'prevuEdge', 'saisie']) {
      expect(THEME_TOKEN_KEYS).toContain(nouveau)
      expect(NEUTRE_AVANT_1G_CLAIR).not.toHaveProperty(nouveau)
      expect(NEUTRE_AVANT_1G_SOMBRE).not.toHaveProperty(nouveau)
    }
  })

  it('reprend le défaut neutre à plat du lot 1e', () => {
    expect(verdictDeReprise(NEUTRE_AVANT_1G_CLAIR)).toEqual({ kind: 'REPRISE', mode: 'systeme' })
  })

  it('reprend le défaut neutre à deux versants, en gardant le mode choisi', () => {
    const stocke = {
      mode: 'sombre',
      clair: NEUTRE_AVANT_1G_CLAIR,
      sombre: NEUTRE_AVANT_1G_SOMBRE,
    }
    expect(verdictDeReprise(stocke)).toEqual({ kind: 'REPRISE', mode: 'sombre' })
  })

  it('LAISSE INTACTE la palette de marque : c’est une décision, pas un défaut', () => {
    // Le cas qui compte. KreativPM enregistré au lot 1e est un choix de marque ;
    // l'écraser au nom d'une identité produit serait pire que le défaut réparé.
    expect(verdictDeReprise(THEME_KREATIVPM).kind).toBe('PERSONNALISE')
  })

  it('laisse intacte une palette dont UN SEUL jeton diffère', () => {
    const retouche = { ...NEUTRE_AVANT_1G_CLAIR, accent: '#123456' }
    expect(verdictDeReprise(retouche).kind).toBe('PERSONNALISE')
  })

  it('laisse intacte une configuration dont seul le versant sombre a été retouché', () => {
    const stocke = {
      mode: 'systeme',
      clair: NEUTRE_AVANT_1G_CLAIR,
      sombre: { ...NEUTRE_AVANT_1G_SOMBRE, page: '#000000' },
    }
    expect(verdictDeReprise(stocke).kind).toBe('PERSONNALISE')
  })

  it('ne refait rien sur une palette déjà reprise', () => {
    const dejaEncre = { mode: 'systeme', clair: THEME_ENCRE_CLAIR, sombre: THEME_ENCRE_SOMBRE }
    expect(verdictDeReprise(dejaEncre).kind).toBe('DEJA_A_JOUR')
    // Idempotence : le script peut être relancé sans effet.
    expect(verdictDeReprise(THEME_ENCRE_CLAIR).kind).toBe('DEJA_A_JOUR')
  })

  it('ne touche pas une colonne vide : la lecture y rend déjà le défaut', () => {
    expect(verdictDeReprise({}).kind).toBe('DEJA_A_JOUR')
    expect(verdictDeReprise(null).kind).toBe('DEJA_A_JOUR')
    expect(verdictDeReprise('pas un objet').kind).toBe('DEJA_A_JOUR')
  })

  it('reconnaît la casse, qu’un enregistrement ait pu changer', () => {
    const majuscules = Object.fromEntries(
      Object.entries(NEUTRE_AVANT_1G_CLAIR).map(([k, v]) => [k, v.toUpperCase()]),
    )
    expect(verdictDeReprise(majuscules)).toEqual({ kind: 'REPRISE', mode: 'systeme' })
  })

  it('n’exige pas les jetons que la base d’avant ne portait pas', () => {
    // Une palette d'avant le lot 1g n'a ni `prevu` ni `saisie`. La
    // reconnaissance doit passer quand même, sans quoi la reprise ne
    // s'appliquerait jamais — c'est-à-dire ne servirait à rien.
    expect(NEUTRE_AVANT_1G_CLAIR).not.toHaveProperty('saisie')
    expect(verdictDeReprise(NEUTRE_AVANT_1G_CLAIR).kind).toBe('REPRISE')
  })

  it('reprend AUSSI le défaut du lot 1e, la génération d’avant', () => {
    // Trouvé en exécutant la reprise sur une base réelle : elle refusait
    // poliment une palette que personne n'avait choisie, faute de connaître
    // la génération antérieure du défaut. Les installations les plus anciennes
    // sont précisément celles qui ont le plus besoin d'être reprises.
    expect(verdictDeReprise(NEUTRE_LOT_1E)).toEqual({ kind: 'REPRISE', mode: 'systeme' })
  })

  it('distingue les deux générations de défaut : ce sont bien deux palettes', () => {
    // Sans cet écart, une seule référence aurait suffi et l'ajout serait mort.
    const ecarts = Object.keys(NEUTRE_LOT_1E).filter(
      (k) => NEUTRE_LOT_1E[k] !== NEUTRE_AVANT_1G_CLAIR[k],
    )
    expect(ecarts.length).toBeGreaterThan(20)
    // La fenêtre chaude du lot 1e, que le lot 1f a quittée.
    expect(NEUTRE_LOT_1E.catA).not.toBe(NEUTRE_AVANT_1G_CLAIR.catA)
  })

  it('laisse intacte une palette du lot 1e dont un seul jeton a été retouché', () => {
    expect(verdictDeReprise({ ...NEUTRE_LOT_1E, accent: '#123456' }).kind).toBe('PERSONNALISE')
  })

  it('écrit Encre des deux côtés, en gardant le mode', () => {
    expect(configDeReprise('clair')).toEqual({
      mode: 'clair',
      clair: THEME_ENCRE_CLAIR,
      sombre: THEME_ENCRE_SOMBRE,
    })
  })
})
