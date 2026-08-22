import { describe, it, expect } from 'vitest'
import {
  buildCraDocument,
  formatJours,
  libelleMois,
  libelleJour,
  joursDuMois,
  type CraDocumentInput,
} from './document'

const EMETTEUR = {
  nom: 'KREATIV PROJECT MANAGEMENT',
  adresse: '1 rue des Tests, 75000 Paris',
  siret: '000 000 000 00000',
  email: 'contact@exemple.test',
}

function saisie(
  lineId: string,
  date: string,
  minutes: number,
  extra: { minutesParJour?: number; kind?: 'REALISE' | 'PREVISIONNEL' } = {},
) {
  return {
    lineId,
    date,
    minutes,
    minutesParJour: extra.minutesParJour ?? 480,
    kind: extra.kind ?? ('REALISE' as const),
  }
}

function entree(partiel: Partial<CraDocumentInput> = {}): CraDocumentInput {
  return {
    emetteur: EMETTEUR,
    clientNom: 'ACME',
    missionLabel: 'Consultant ITSM',
    mois: '2026-06',
    signataireNom: 'Claire Martin',
    signataireEmail: 'claire.martin@acme.test',
    lignes: [{ id: 'l1', label: 'Consultant ITSM 30j', soldCentiemes: 3000 }],
    moisValides: [],
    entries: [saisie('l1', '2026-06-01', 480)],
    ...partiel,
  }
}

/**
 * Vocabulaire monétaire proscrit. On compare des **mots** — clés découpées sur
 * les bosses de casse comprises — et non des sous-chaînes : `emetteur`
 * contient « eur » et `totalCentiemes` contient « cent », si bien qu'un test
 * par sous-chaîne échouerait sur un document parfaitement sain, puis serait
 * relâché jusqu'à ne plus rien vérifier.
 */
const MOTS_INTERDITS = new Set([
  'eur', 'euro', 'euros', 'tjm', 'montant', 'montants', 'prix', 'facture',
  'facturation', 'tarif', 'tarifs', 'centime', 'centimes', 'ht', 'ttc',
  'honoraires',
])

function decouper(texte: string): string[] {
  return texte
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-zà-öø-ÿ]+/)
    .filter((mot) => mot !== '')
}

/** Tous les mots du document : noms de champs **et** valeurs. */
function motsDu(valeur: unknown, sortie: string[] = []): string[] {
  if (typeof valeur === 'string') sortie.push(...decouper(valeur))
  else if (Array.isArray(valeur)) for (const v of valeur) motsDu(v, sortie)
  else if (valeur !== null && typeof valeur === 'object') {
    for (const [cle, v] of Object.entries(valeur)) {
      sortie.push(...decouper(cle))
      motsDu(v, sortie)
    }
  }
  return sortie
}

describe('buildCraDocument', () => {
  it('reprend l entête, le client, la mission et le mois', () => {
    const doc = buildCraDocument(entree())
    expect(doc.emetteur.nom).toBe('KREATIV PROJECT MANAGEMENT')
    expect(doc.clientNom).toBe('ACME')
    expect(doc.missionLabel).toBe('Consultant ITSM')
    expect(doc.mois).toBe('2026-06')
    expect(doc.moisLibelle).toBe('juin 2026')
    expect(doc.signataireNom).toBe('Claire Martin')
  })

  it('détaille chaque ligne de prestation jour par jour', () => {
    const doc = buildCraDocument(
      entree({
        lignes: [
          { id: 'l1', label: 'Jour', soldCentiemes: 3000 },
          { id: 'l2', label: 'Nuit', soldCentiemes: 3000 },
        ],
        entries: [
          saisie('l1', '2026-06-01', 480),
          saisie('l1', '2026-06-02', 240),
          saisie('l2', '2026-06-02', 480),
        ],
      }),
    )

    expect(doc.lignes.map((l) => l.label)).toEqual(['Jour', 'Nuit'])
    expect(doc.lignes[0]!.jours).toEqual([
      { date: '2026-06-01', centiemes: 100 },
      { date: '2026-06-02', centiemes: 50 },
    ])
    expect(doc.lignes[1]!.jours).toEqual([{ date: '2026-06-02', centiemes: 100 }])
  })

  it('n imprime que le réalisé — un document qui atteste ne contient pas du prévu', () => {
    const doc = buildCraDocument(
      entree({
        entries: [
          saisie('l1', '2026-06-01', 480),
          saisie('l1', '2026-06-02', 480, { kind: 'PREVISIONNEL' }),
        ],
      }),
    )
    expect(doc.lignes[0]!.jours).toEqual([{ date: '2026-06-01', centiemes: 100 }])
    expect(doc.totalCentiemes).toBe(100)
  })

  it('cumule les créneaux d un même jour avant de convertir', () => {
    // Deux demi-journées de 60 min à 480 : converties séparément, 13 + 13 = 26.
    // Cumulées puis converties, 120/480 = 25. C est 25 qui doit figurer.
    const doc = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 60), saisie('l1', '2026-06-01', 60)] }),
    )
    expect(doc.lignes[0]!.jours).toEqual([{ date: '2026-06-01', centiemes: 25 }])
  })

  it('ne cumule jamais des minutes de facteurs différents', () => {
    // 420 min à 420/jour et 480 min à 480/jour : deux journées pleines.
    // Un cumul aveugle donnerait 900/480 = 188 au lieu de 200.
    const doc = buildCraDocument(
      entree({
        entries: [
          saisie('l1', '2026-06-01', 420, { minutesParJour: 420 }),
          saisie('l1', '2026-06-01', 480, { minutesParJour: 480 }),
        ],
      }),
    )
    expect(doc.lignes[0]!.jours).toEqual([{ date: '2026-06-01', centiemes: 200 }])
  })

  it('lit chaque saisie au facteur figé à son écriture, jamais à un réglage courant', () => {
    // Le gel du facteur se casse **en lecture**. Un document qui recalculerait
    // les journées depuis le réglage du moment ferait changer un CRA déjà
    // validé sans qu'aucune donnée n'ait bougé : 420 minutes écrites sous une
    // journée de 420 valent une journée pleine, et le resteront quand le
    // réglage de l'application passera à 480.
    const gele = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 420, { minutesParJour: 420 })] }),
    )
    expect(gele.lignes[0]!.jours).toEqual([{ date: '2026-06-01', centiemes: 100 }])

    // Les mêmes minutes écrites sous une journée de 480 n'en font que 88 : la
    // valeur suit le facteur de la saisie, et rien d'autre.
    const autre = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 420, { minutesParJour: 480 })] }),
    )
    expect(autre.lignes[0]!.jours).toEqual([{ date: '2026-06-01', centiemes: 88 }])
  })

  it('ne laisse pas un facteur inexploitable atteindre le document', () => {
    // Une journée de zéro minute donnerait un Infinity imprimé tel quel sur un
    // document signé. La conversion partagée l'écarte : on la consomme, on ne
    // la réécrit pas.
    const doc = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 480, { minutesParJour: 0 })] }),
    )
    expect(doc.lignes).toEqual([])
    expect(doc.totalCentiemes).toBe(0)
  })

  it('fait du total d une ligne la somme exacte des cellules imprimées', () => {
    const doc = buildCraDocument(
      entree({
        entries: [
          saisie('l1', '2026-06-01', 60),
          saisie('l1', '2026-06-02', 60),
          saisie('l1', '2026-06-03', 60),
        ],
      }),
    )
    const cellules = doc.lignes[0]!.jours.map((j) => j.centiemes)
    expect(cellules).toEqual([13, 13, 13])
    expect(doc.lignes[0]!.totalCentiemes).toBe(39)
  })

  it('fait du total général la somme des totaux de ligne', () => {
    const doc = buildCraDocument(
      entree({
        lignes: [
          { id: 'l1', label: 'Jour', soldCentiemes: 3000 },
          { id: 'l2', label: 'Nuit', soldCentiemes: 3000 },
        ],
        entries: [saisie('l1', '2026-06-01', 480), saisie('l2', '2026-06-02', 240)],
      }),
    )
    expect(doc.totalCentiemes).toBe(150)
  })

  it('écarte les lignes sans aucune saisie sur le mois', () => {
    const doc = buildCraDocument(
      entree({
        lignes: [
          { id: 'l1', label: 'Jour', soldCentiemes: 3000 },
          { id: 'l2', label: 'Jamais servie', soldCentiemes: 3000 },
        ],
        entries: [saisie('l1', '2026-06-01', 480)],
      }),
    )
    expect(doc.lignes.map((l) => l.label)).toEqual(['Jour'])
  })

  it('ignore une saisie hors du mois du document', () => {
    const doc = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 480), saisie('l1', '2026-07-01', 480)] }),
    )
    expect(doc.totalCentiemes).toBe(100)
  })

  it('ignore une saisie dont la ligne n appartient pas à la mission', () => {
    const doc = buildCraDocument(
      entree({ entries: [saisie('l1', '2026-06-01', 480), saisie('inconnue', '2026-06-02', 480)] }),
    )
    expect(doc.totalCentiemes).toBe(100)
  })

  it('produit un document vide mais complet quand rien n a été saisi', () => {
    const doc = buildCraDocument(entree({ entries: [] }))
    expect(doc.lignes).toEqual([])
    expect(doc.totalCentiemes).toBe(0)
    expect(doc.joursDuMois).toHaveLength(30)
  })

  it('ne porte aucun montant, par construction', () => {
    // Le test qui protège la frontière du produit, au niveau du modèle.
    // Le même contrôle est refait sur les octets du PDF (voir layout.test.ts).
    const doc = buildCraDocument(entree())
    const mots = motsDu(doc)
    expect(mots).not.toHaveLength(0)
    for (const mot of mots) expect(MOTS_INTERDITS.has(mot)).toBe(false)
    expect(JSON.stringify(doc)).not.toContain('€')
  })

  it('le contrôle « aucun montant » voit un montant qu on y glisserait', () => {
    // Un test de garde qu'on ne sait pas faire échouer ne garde rien : celui-ci
    // tombe bien sur un champ monétaire, et ne tombe pas sur `emetteur` ni
    // sur `totalCentiemes`.
    const contamine = { ...buildCraDocument(entree()), totalEuros: 4200, tjmCentimes: 55000 }
    expect(motsDu(contamine).some((mot) => MOTS_INTERDITS.has(mot))).toBe(true)
  })
})

describe('joursDuMois', () => {
  it('couvre le mois entier', () => {
    expect(joursDuMois('2026-06')).toHaveLength(30)
    expect(joursDuMois('2026-07')).toHaveLength(31)
    expect(joursDuMois('2026-02')).toHaveLength(28)
    expect(joursDuMois('2028-02')).toHaveLength(29)
  })

  it('rend des dates ISO ordonnées', () => {
    const jours = joursDuMois('2026-06')
    expect(jours[0]).toBe('2026-06-01')
    expect(jours[29]).toBe('2026-06-30')
  })
})

describe('formatJours', () => {
  it('rend des centièmes en jours, virgule française, deux décimales', () => {
    expect(formatJours(100)).toBe('1,00')
    expect(formatJours(50)).toBe('0,50')
    expect(formatJours(2000)).toBe('20,00')
    expect(formatJours(13)).toBe('0,13')
  })

  it('ne sépare pas les milliers — l espace fine insécable n a rien à faire dans un PDF', () => {
    expect(formatJours(123456)).toBe('1234,56')
  })
})

describe('libelleMois', () => {
  it('nomme le mois en français', () => {
    expect(libelleMois('2026-01')).toBe('janvier 2026')
    expect(libelleMois('2026-06')).toBe('juin 2026')
    expect(libelleMois('2026-12')).toBe('décembre 2026')
  })
})

describe('libelleJour', () => {
  it('donne le jour de la semaine et le quantième', () => {
    expect(libelleJour('2026-06-01')).toBe('lun. 01')
    expect(libelleJour('2026-06-06')).toBe('sam. 06')
    expect(libelleJour('2026-06-07')).toBe('dim. 07')
  })
})

describe('les fériés du mois', () => {
  it('rend les fériés français qui tombent dans le mois', () => {
    // Mai 2026 : Fête du Travail, Victoire 1945, et l'Ascension le 14.
    const doc = buildCraDocument(entree({ mois: '2026-05' }))
    expect(doc.feries).toContain('2026-05-01')
    expect(doc.feries).toContain('2026-05-08')
    expect(doc.feries).toContain('2026-05-14')
  })

  it('rend une liste vide pour un mois sans férié', () => {
    expect(buildCraDocument(entree({ mois: '2026-06' })).feries).toEqual([])
  })

  it('ne rend jamais un férié d un autre mois', () => {
    for (const date of buildCraDocument(entree({ mois: '2026-05' })).feries) {
      expect(date.slice(0, 7)).toBe('2026-05')
    }
  })
})

describe('l engagement des prestations', () => {
  const troisMois = {
    lignes: [{ id: 'l1', label: 'Consultant', soldCentiemes: 3000 }],
    mois: '2026-06',
    moisValides: ['2026-04', '2026-05'],
    entries: [
      saisie('l1', '2026-04-10', 480),
      saisie('l1', '2026-05-11', 480),
      saisie('l1', '2026-06-01', 480),
      saisie('l1', '2026-06-02', 240),
      saisie('l1', '2026-07-01', 480, { kind: 'PREVISIONNEL' }),
    ],
  }

  it('range le réalisé selon le statut du CRA de son mois', () => {
    const e = buildCraDocument(entree(troisMois)).lignes[0]!.engagement
    expect(e.venduCentiemes).toBe(3000)
    // Avril et mai sont validés : deux journées pleines.
    expect(e.valideCentiemes).toBe(200)
    // Juin ne l'est pas — c'est le mois de ce document : 1,00 + 0,50.
    expect(e.enValidationCentiemes).toBe(150)
    expect(e.planifieCentiemes).toBe(100)
    expect(e.resteCentiemes).toBe(2550)
  })

  it('compte en validation le réalisé d un mois passé resté non validé', () => {
    // Le trou que la règle ferme : sans cela, mai ne serait dans aucun
    // segment et le reste à consommer serait trop grand d'autant.
    const e = buildCraDocument(
      entree({ ...troisMois, moisValides: ['2026-04'] }),
    ).lignes[0]!.engagement
    expect(e.valideCentiemes).toBe(100)
    expect(e.enValidationCentiemes).toBe(250)
    expect(e.consommeCentiemes).toBe(450)
    expect(e.resteCentiemes).toBe(2550)
  })

  it('ne compte l engagement qu une fois par saisie', () => {
    const e = buildCraDocument(entree(troisMois)).lignes[0]!.engagement
    expect(e.valideCentiemes + e.enValidationCentiemes + e.planifieCentiemes).toBe(
      e.consommeCentiemes,
    )
    expect(e.consommeCentiemes + e.resteCentiemes - e.depassementCentiemes).toBe(
      e.venduCentiemes,
    )
  })

  it('cumule la mission sur toutes ses prestations, servies ce mois-ci ou non', () => {
    // `l2` n'a rien servi en juin : elle ne paraît pas dans le tableau, mais
    // ses jours vendus font toujours partie de la mission.
    const doc = buildCraDocument(
      entree({
        ...troisMois,
        lignes: [
          { id: 'l1', label: 'Consultant', soldCentiemes: 3000 },
          { id: 'l2', label: 'Astreinte', soldCentiemes: 1000 },
        ],
      }),
    )
    expect(doc.lignes).toHaveLength(1)
    expect(doc.engagementMission.venduCentiemes).toBe(4000)
    expect(doc.engagementMission.consommeCentiemes).toBe(450)
  })

  it('ne compte pas dans l engagement une saisie d une autre mission', () => {
    const doc = buildCraDocument(
      entree({ ...troisMois, entries: [...troisMois.entries, saisie('inconnue', '2026-06-03', 480)] }),
    )
    expect(doc.engagementMission.consommeCentiemes).toBe(450)
  })
})
