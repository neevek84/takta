import { describe, it, expect } from 'vitest'
import { checkCapacity } from './check'
import { computeEngagement } from '../engagement/compute'

/**
 * La capacité est un nombre de centièmes de jour, jamais un nombre de minutes :
 * c'est tout l'objet de la correction. Le seuil n'a donc pas de facteur de
 * conversion à choisir, et il n'y en a aucun à passer à `checkCapacity`.
 */
const CAP = 100 // une journée

/** Saisie écrite sous le facteur le plus courant du projet (8 h). */
function j480(minutes: number): { minutes: number; minutesParJour: number } {
  return { minutes, minutesParJour: 480 }
}

describe('checkCapacity', () => {
  it('accepte un total sous la capacité', () => {
    const v = checkCapacity({ existing: [], added: [j480(240)], capacityCentiemes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(true)
  })

  it('accepte un total exactement égal à la capacité', () => {
    const v = checkCapacity({ existing: [j480(240)], added: [j480(240)], capacityCentiemes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(true)
  })

  it('autorise deux demi-journées sur deux lignes différentes', () => {
    const v = checkCapacity({ existing: [j480(240)], added: [j480(240)], capacityCentiemes: CAP, mode: 'AVERTISSEMENT' })
    expect(v.ok).toBe(true)
  })

  it('bloque le dépassement en mode BLOCAGE', () => {
    const v = checkCapacity({ existing: [j480(480)], added: [j480(240)], capacityCentiemes: CAP, mode: 'BLOCAGE' })
    expect(v).toEqual({ ok: false, severity: 'block', totalCentiemes: 150, capacityCentiemes: 100 })
  })

  it('avertit sans bloquer en mode AVERTISSEMENT', () => {
    const v = checkCapacity({ existing: [j480(480)], added: [j480(240)], capacityCentiemes: CAP, mode: 'AVERTISSEMENT' })
    expect(v).toEqual({ ok: false, severity: 'warn', totalCentiemes: 150, capacityCentiemes: 100 })
  })

  it('ne dit jamais rien en mode DESACTIVE', () => {
    const v = checkCapacity({ existing: [j480(4800)], added: [j480(480)], capacityCentiemes: CAP, mode: 'DESACTIVE' })
    expect(v.ok).toBe(true)
  })

  it('applique la même règle un dimanche qu un mardi', () => {
    // la fonction ne connaît pas la date : c'est la garantie
    const v = checkCapacity({ existing: [j480(480)], added: [j480(1)], capacityCentiemes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(false)
  })

  // --- Le défaut que la tâche 14 corrige -----------------------------------
  //
  // La comparaison arrondissait au centième de jour avant de comparer : à 480
  // minutes par jour, un centième vaut 4,8 minutes, et tout ce qui dépassait
  // de moins de la moitié — près de deux minutes et demie — franchissait le
  // garde-fou sans un mot. Le centième est la bonne unité pour *afficher* des
  // jours, pas pour *comparer* : la comparaison se fait désormais au
  // millicentième, où une minute pèse au moins 69 unités. Le verdict, lui,
  // continue d'exposer des centièmes — c'est ce que l'affichage sait lire.

  it('signale une minute au-delà de la capacité', () => {
    // Une journée pleine chez un client à 420 min/jour, plus une minute :
    // 421 min valent 100,238 centièmes. Arrondis à 100, ils tenaient
    // exactement dans la capacité et passaient inaperçus.
    const v = checkCapacity({
      existing: [{ minutes: 300, minutesParJour: 420 }],
      added: [{ minutes: 121, minutesParJour: 420 }],
      capacityCentiemes: CAP,
      mode: 'BLOCAGE',
    })
    expect(v).toEqual({ ok: false, severity: 'block', totalCentiemes: 100, capacityCentiemes: 100 })
  })

  it('voit la minute de trop même quand la journée mêle deux facteurs', () => {
    // 211 min à 420 (50,238 centièmes) et 300 min à 600 (50 centièmes) : la
    // journée dépasse d'une minute exactement. La somme des centièmes arrondis
    // vaut 100 et la ramenait à une journée pile — et le total exposé, lui,
    // reste bien cette valeur d'affichage.
    const v = checkCapacity({
      existing: [{ minutes: 211, minutesParJour: 420 }],
      added: [{ minutes: 300, minutesParJour: 600 }],
      capacityCentiemes: CAP,
      mode: 'AVERTISSEMENT',
    })
    expect(v).toEqual({ ok: false, severity: 'warn', totalCentiemes: 100, capacityCentiemes: 100 })
  })

  it('accepte encore la journée exactement pleine, à facteurs mêlés', () => {
    // La même journée à la minute près : 210 min à 420 plus 300 min à 600 font
    // une journée pile. Comparer plus fin ne doit pas transformer l'égalité en
    // dépassement.
    const v = checkCapacity({
      existing: [{ minutes: 210, minutesParJour: 420 }],
      added: [{ minutes: 300, minutesParJour: 600 }],
      capacityCentiemes: CAP,
      mode: 'BLOCAGE',
    })
    expect(v).toEqual({ ok: true })
  })

  it('accepte encore une journée que l arrondi au centième gonflait', () => {
    // 419 min à 420 : 99,76 centièmes, soit 100 une fois arrondis. Comparer au
    // centième aurait pu faire passer cette journée incomplète pour pleine ;
    // elle l'est de toute façon moins que la capacité, dans les deux unités.
    const v = checkCapacity({
      existing: [{ minutes: 419, minutesParJour: 420 }],
      added: [],
      capacityCentiemes: CAP,
      mode: 'BLOCAGE',
    })
    expect(v).toEqual({ ok: true })
  })

  // --- Le défaut que la tâche 12 corrige -----------------------------------
  //
  // Réglage global à 480 minutes par jour, capacité à 100 centièmes. Les deux
  // cas ci-dessous ne tombent pas juste : ils n'auraient rien prouvé avec des
  // valeurs qui se divisent exactement, puisque l'arrondi ne serait jamais
  // sollicité.

  it('accepte une journée pleine chez un client dont la journée fait 600 minutes', () => {
    // 590 minutes valent 0,98 j chez ce client (98,33 arrondi à 98), pas
    // 1,23 j : comparées en minutes au seuil converti au facteur global
    // (480 min), elles étaient refusées alors que la journée n'est même pas
    // complète.
    const v = checkCapacity({
      existing: [{ minutes: 350, minutesParJour: 600 }],
      added: [{ minutes: 240, minutesParJour: 600 }],
      capacityCentiemes: CAP,
      mode: 'BLOCAGE',
    })
    expect(v).toEqual({ ok: true })
  })

  it('signale le dépassement chez un client dont la journée fait 420 minutes', () => {
    // Une journée pleine (420 min) plus 60 minutes : 480 min valent 1,14 j
    // (114,28 arrondi à 114). Comparées en minutes au seuil converti au
    // facteur global, elles passaient pour tout juste dans la capacité.
    const v = checkCapacity({
      existing: [{ minutes: 420, minutesParJour: 420 }],
      added: [{ minutes: 60, minutesParJour: 420 }],
      capacityCentiemes: CAP,
      mode: 'AVERTISSEMENT',
    })
    expect(v).toEqual({ ok: false, severity: 'warn', totalCentiemes: 114, capacityCentiemes: 100 })
  })

  it('somme les conversions par facteur, jamais la conversion de la somme', () => {
    // 330 min à 420 → 78,57 → 79 centièmes ; 150 min à 600 → 25 centièmes.
    // Total : 104.
    //
    // La somme brute des minutes vaut 480. La convertir en une fois donnerait
    // 100 au facteur global (480), 114 au facteur 420 ou 80 au facteur 600 :
    // aucune de ces trois valeurs n'est 104, et la première laisserait même
    // passer le dépassement.
    const v = checkCapacity({
      existing: [
        { minutes: 200, minutesParJour: 420 },
        { minutes: 150, minutesParJour: 600 },
      ],
      added: [{ minutes: 130, minutesParJour: 420 }],
      capacityCentiemes: CAP,
      mode: 'BLOCAGE',
    })
    expect(v).toEqual({ ok: false, severity: 'block', totalCentiemes: 104, capacityCentiemes: 100 })
  })

  it('cumule les minutes d un même facteur avant de convertir', () => {
    // Trois saisies chez un client à 600 minutes par jour, qui font ensemble
    // une journée pleine : 213 + 213 + 174 = 600 min → 100 centièmes, tout
    // juste dans la capacité.
    //
    // Converties une par une, elles donneraient 36 + 36 + 29 = 101 centièmes
    // et feraient refuser une journée pourtant exactement pleine : d'où
    // « cumuler les minutes, convertir une fois », et non « convertir chaque
    // saisie puis sommer ».
    const v = checkCapacity({
      existing: [
        { minutes: 213, minutesParJour: 600 },
        { minutes: 213, minutesParJour: 600 },
      ],
      added: [{ minutes: 174, minutesParJour: 600 }],
      capacityCentiemes: CAP,
      mode: 'BLOCAGE',
    })
    expect(v).toEqual({ ok: true })
  })

  it('ne dit rien en mode DESACTIVE même à facteurs mêlés', () => {
    const v = checkCapacity({
      existing: [
        { minutes: 420, minutesParJour: 420 },
        { minutes: 600, minutesParJour: 600 },
      ],
      added: [{ minutes: 130, minutesParJour: 420 }],
      capacityCentiemes: CAP,
      mode: 'DESACTIVE',
    })
    expect(v).toEqual({ ok: true })
  })

  // --- Aucun CRA validé ne change de calcul --------------------------------

  it('convertit les saisies existantes exactement comme le calcul d engagement', () => {
    // Saisies d'un CRA déjà validé : chacune porte le facteur figé à son
    // écriture (lot 1d), deux d'entre elles sous un réglage à 420 minutes, la
    // troisième sous un réglage à 600.
    const saisies = [
      { kind: 'REALISE' as const, minutes: 200, minutesParJour: 420 },
      { kind: 'REALISE' as const, minutes: 130, minutesParJour: 420 },
      { kind: 'REALISE' as const, minutes: 150, minutesParJour: 600 },
    ]

    // Valeur de référence, figée à la main : c'est ce que l'engagement
    // produisait déjà avant cette tâche (79 + 25). Si elle bouge, un CRA
    // validé a changé de calcul.
    const engagement = computeEngagement({ venduCentiemes: 3000, entries: saisies })
    expect(engagement.realiseCentiemes).toBe(104)

    // La capacité lit désormais les mêmes saisies dans la même unité et en
    // tire le même total — sans jamais recevoir de facteur global, donc sans
    // pouvoir réinterpréter l'historique quand le réglage change.
    const v = checkCapacity({ existing: saisies, added: [], capacityCentiemes: 103, mode: 'BLOCAGE' })
    expect(v).toEqual({ ok: false, severity: 'block', totalCentiemes: 104, capacityCentiemes: 103 })
  })
})
