import { describe, it, expect } from 'vitest'
import {
  chargePrevueEnSecondes,
  joursVendusDepuisCharge,
  buildTimeSpentPayloads,
  compareDayLength,
  type PushableEntry,
} from './timespent'

function saisie(over: Partial<PushableEntry> = {}): PushableEntry {
  return {
    id: 'e1',
    lineId: 'l1',
    date: '2026-05-04',
    slotId: '',
    minutes: 480,
    kind: 'REALISE',
    minutesParJour: 480,
    comment: '',
    ...over,
  }
}

describe('buildTimeSpentPayloads', () => {
  it('convertit les minutes en secondes, sans autre facteur', () => {
    const [p] = buildTimeSpentPayloads([saisie({ minutes: 480 })])
    expect(p!.durationSeconds).toBe(28_800)
  })

  it('donne la même durée quel que soit le facteur figé de la saisie', () => {
    // Le facteur ne convertit pas des minutes en secondes : 8 heures restent
    // 8 heures. Il ne sert qu'à dire combien de JOURS ces minutes valent.
    const a = buildTimeSpentPayloads([saisie({ minutes: 480, minutesParJour: 480 })])[0]!
    const b = buildTimeSpentPayloads([saisie({ minutes: 480, minutesParJour: 420 })])[0]!
    expect(a.durationSeconds).toBe(b.durationSeconds)
    expect(a.centiemesDeJour).toBe(100)
    expect(b.centiemesDeJour).toBe(114)
  })

  it('exprime les jours au facteur figé de chaque saisie, jamais d un facteur commun', () => {
    const p = buildTimeSpentPayloads([
      saisie({ id: 'a', date: '2026-05-04', minutes: 480, minutesParJour: 480 }),
      saisie({ id: 'b', date: '2026-05-05', minutes: 420, minutesParJour: 420 }),
    ])
    expect(p.map((x) => x.centiemesDeJour)).toEqual([100, 100])
    expect(p.map((x) => x.durationSeconds)).toEqual([28_800, 25_200])
  })

  it('ne laisse jamais passer de prévisionnel', () => {
    // Le test central de la spec : un mois mêlant réalisé et prévu ne pousse
    // que le réalisé.
    const p = buildTimeSpentPayloads([
      saisie({ id: 'r', date: '2026-05-04', kind: 'REALISE' }),
      saisie({ id: 'p', date: '2026-05-05', kind: 'PREVISIONNEL' }),
    ])
    expect(p.map((x) => x.entryId)).toEqual(['r'])
  })

  it('ignore une saisie à zéro minute', () => {
    expect(buildTimeSpentPayloads([saisie({ minutes: 0 })])).toEqual([])
  })

  it('refuse une saisie dont le facteur figé est inexploitable', () => {
    // Sauter silencieusement une telle saisie la ferait disparaître de la
    // facturation sans que personne ne s'en aperçoive.
    expect(() => buildTimeSpentPayloads([saisie({ minutesParJour: 0 })])).toThrow(/inexploitable/)
    expect(() => buildTimeSpentPayloads([saisie({ minutesParJour: -420 })])).toThrow(/inexploitable/)
  })

  it('refuse un facteur figé fractionnaire, que rien ne saurait rendre entier', () => {
    // « Entiers partout » : un facteur de 450,5 minutes ne vient d'aucun
    // réglage légitime, et le laisser passer ferait dépendre la quantité
    // facturée d'un flottant.
    expect(() => buildTimeSpentPayloads([saisie({ minutesParJour: 450.5 })])).toThrow(
      /inexploitable/,
    )
  })

  it('reporte le commentaire de la saisie en note, débarrassé de ses blancs', () => {
    const [p] = buildTimeSpentPayloads([saisie({ comment: '  Recette V2  ' })])
    expect(p!.note).toBe('Recette V2')
  })

  it('trie par date puis par ligne, pour un push reproductible', () => {
    const p = buildTimeSpentPayloads([
      saisie({ id: 'c', lineId: 'l2', date: '2026-05-05' }),
      saisie({ id: 'a', lineId: 'l2', date: '2026-05-04' }),
      saisie({ id: 'b', lineId: 'l1', date: '2026-05-04' }),
    ])
    expect(p.map((x) => x.entryId)).toEqual(['b', 'a', 'c'])
  })

  it('départage deux créneaux d une même cellule par leur identifiant', () => {
    // Sans ce départage, l'ordre des deux créneaux d'une même journée sur une
    // même ligne dépendrait de l'ordre d'arrivée : le push cesserait d'être
    // reproductible là où il l'est le plus utile, sur une journée coupée.
    const p = buildTimeSpentPayloads([
      saisie({ id: 's', slotId: 'matin', minutes: 240 }),
      saisie({ id: 'a', slotId: 'apres-midi', minutes: 240 }),
    ])
    expect(p.map((x) => x.entryId)).toEqual(['a', 's'])
  })

  it('conserve le créneau, qui fait partie de l identité d une cellule', () => {
    const p = buildTimeSpentPayloads([
      saisie({ id: 'm', slotId: 'matin', minutes: 240 }),
      saisie({ id: 's', slotId: 'apres-midi', minutes: 240 }),
    ])
    expect(p.map((x) => x.slotId).sort()).toEqual(['apres-midi', 'matin'])
  })
})

describe('compareDayLength', () => {
  it('signale l écart entre 8 h locales et 7 h Dolibarr', () => {
    const c = compareDayLength({ minutesParJourLocal: 480, heuresParJourDolibarr: 7 })
    expect(c.minutesParJourDolibarr).toBe(420)
    expect(c.divergent).toBe(true)
    // Une journée locale pleine s'affichera comme 1,14 jour chez Dolibarr :
    // le fameux septième de trop.
    expect(c.centiemesAffichesParDolibarr).toBe(114)
  })

  it('ne signale rien quand les deux côtés comptent pareil', () => {
    const c = compareDayLength({ minutesParJourLocal: 420, heuresParJourDolibarr: 7 })
    expect(c.divergent).toBe(false)
    expect(c.centiemesAffichesParDolibarr).toBe(100)
  })

  it('accepte une durée Dolibarr fractionnaire', () => {
    const c = compareDayLength({ minutesParJourLocal: 450, heuresParJourDolibarr: 7.5 })
    expect(c.minutesParJourDolibarr).toBe(450)
    expect(c.divergent).toBe(false)
  })

  it('ramène une durée Dolibarr à la minute entière', () => {
    // 7,5 h tombe juste et ne prouve rien de l'arrondi. 8,2 h vaut
    // 491,999999... en flottant, et 7,005 h vaut 420,3 : les deux doivent
    // ressortir en minutes entières, sans quoi un flottant se propagerait
    // jusqu'à la comparaison des journées.
    const bruit = compareDayLength({ minutesParJourLocal: 480, heuresParJourDolibarr: 8.2 })
    expect(bruit.minutesParJourDolibarr).toBe(492)
    expect(Number.isInteger(bruit.minutesParJourDolibarr)).toBe(true)
    expect(bruit.divergent).toBe(true)

    const fraction = compareDayLength({ minutesParJourLocal: 420, heuresParJourDolibarr: 7.005 })
    expect(fraction.minutesParJourDolibarr).toBe(420)
    expect(fraction.divergent).toBe(false)
  })

  it('refuse une durée Dolibarr inexploitable', () => {
    expect(() =>
      compareDayLength({ minutesParJourLocal: 480, heuresParJourDolibarr: 0 }),
    ).toThrow(/inexploitable/)
  })
})

describe('chargePrevueEnSecondes', () => {
  // `planned_workload` est en secondes chez Dolibarr : `projet/tasks/task.php`
  // le compose en `heures × 3600 + minutes × 60`.
  it('convertit des jours vendus en secondes, au facteur de la prestation', () => {
    // 5 jours sur une journée de 7 h : 5 × 420 × 60
    expect(chargePrevueEnSecondes({ soldCentiemes: 500, minutesParJour: 420 })).toBe(126_000)
  })

  it("suit le facteur, qui n'est pas toujours sept heures", () => {
    // La même vente sur une journée de 8 h pèse plus lourd.
    expect(chargePrevueEnSecondes({ soldCentiemes: 500, minutesParJour: 480 })).toBe(144_000)
  })

  it('rend un entier sur une demi-journée', () => {
    expect(chargePrevueEnSecondes({ soldCentiemes: 50, minutesParJour: 420 })).toBe(12_600)
  })

  // Rien de vendu n'est pas zéro heure de charge : c'est une charge inconnue,
  // et Dolibarr distingue les deux — `null` laisse la colonne vide.
  it("rend null quand rien n'est vendu", () => {
    expect(chargePrevueEnSecondes({ soldCentiemes: 0, minutesParJour: 420 })).toBeNull()
  })

  it("rend null sur un facteur inexploitable plutôt qu'une charge fausse", () => {
    expect(chargePrevueEnSecondes({ soldCentiemes: 500, minutesParJour: 0 })).toBeNull()
  })
})

describe('joursVendusDepuisCharge', () => {
  it("rend l'inverse exact de la charge prévue", () => {
    // 5 jours vendus sur une journée de 7 h : 5 × 7 × 3600 = 126 000 s.
    const charge = chargePrevueEnSecondes({ soldCentiemes: 500, minutesParJour: 420 })
    expect(charge).toBe(126_000)
    expect(joursVendusDepuisCharge({ plannedWorkloadSeconds: charge, minutesParJour: 420 })).toBe(
      500,
    )
  })

  it('suit le facteur, qui ne vaut pas sept heures partout', () => {
    // 126 000 s valent 5 jours à 7 h, mais 4,375 jours à 8 h.
    expect(joursVendusDepuisCharge({ plannedWorkloadSeconds: 126_000, minutesParJour: 480 })).toBe(
      438,
    )
  })

  it("rend zéro quand la tâche ne porte aucune charge, sans l'inventer", () => {
    expect(joursVendusDepuisCharge({ plannedWorkloadSeconds: null, minutesParJour: 420 })).toBe(0)
    expect(joursVendusDepuisCharge({ plannedWorkloadSeconds: 0, minutesParJour: 420 })).toBe(0)
  })

  it('rend zéro sur un facteur inexploitable plutôt que de diviser par lui', () => {
    expect(joursVendusDepuisCharge({ plannedWorkloadSeconds: 126_000, minutesParJour: 0 })).toBe(0)
  })

  // Dolibarr omet `planned_workload` sur une tâche qui n'en porte pas, et le
  // `Number()` du transport en fait un `NaN`. Sans garde, il traverserait
  // jusqu'aux jours vendus de la prestation créée.
  it("rend zéro sur une charge illisible, jamais un NaN", () => {
    expect(
      joursVendusDepuisCharge({ plannedWorkloadSeconds: Number.NaN, minutesParJour: 420 }),
    ).toBe(0)
  })
})
