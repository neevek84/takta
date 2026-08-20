/**
 * Ce qu'un CRA porte, dit en trois chiffres.
 *
 * **Le manque que ça comble.** La carte d'un CRA nommait sa mission et son
 * statut, rien d'autre : ni la période, ni le nombre de jours, ni sur quelles
 * prestations. Il fallait ouvrir le PDF pour savoir ce qu'on s'apprêtait à
 * faire signer — et avec deux missions aux noms voisins, pour savoir tout court
 * de quel CRA il s'agissait.
 *
 * Seul le **réalisé** du mois y entre : c'est ce que le client signe. Le
 * prévisionnel, lui, est annoncé à part, parce qu'il sera annulé.
 */
import { prisma } from '@/db/client'
import { centiemesParFacteur } from '@/core/time/units'

export interface SyntheseCra {
  totalCentiemes: number
  joursServis: number
  lignes: Array<{ label: string; centiemes: number }>
}

const VIDE: SyntheseCra = { totalCentiemes: 0, joursServis: 0, lignes: [] }

/**
 * La synthèse de chaque mission pour ce mois, en une seule requête.
 *
 * Les quantités passent par `centiemesParFacteur` : chaque saisie porte le
 * facteur figé à son écriture, et convertir avec le réglage courant ferait
 * bouger un CRA validé sans qu'aucune donnée n'ait changé.
 */
export async function syntheseParMission(args: {
  userId: string
  missionIds: ReadonlyArray<string>
  /** 'YYYY-MM' */
  month: string
}): Promise<Map<string, SyntheseCra>> {
  if (args.missionIds.length === 0) return new Map()

  const [annee, mois] = args.month.split('-').map(Number) as [number, number]
  const debut = new Date(Date.UTC(annee, mois - 1, 1))
  const fin = new Date(Date.UTC(annee, mois, 1))

  const saisies = await prisma.timeEntry.findMany({
    where: {
      userId: args.userId,
      kind: 'REALISE',
      date: { gte: debut, lt: fin },
      line: { missionId: { in: [...args.missionIds] } },
    },
    select: {
      minutes: true,
      minutesParJour: true,
      date: true,
      line: { select: { missionId: true, label: true } },
    },
  })

  // mission -> prestation -> quantités, chacune avec son facteur
  const par = new Map<string, Map<string, Array<{ minutes: number; minutesParJour: number }>>>()
  const jours = new Map<string, Set<string>>()

  for (const s of saisies) {
    const m = s.line.missionId
    const parPrestation = par.get(m) ?? new Map()
    const liste = parPrestation.get(s.line.label) ?? []
    liste.push({ minutes: s.minutes, minutesParJour: s.minutesParJour })
    parPrestation.set(s.line.label, liste)
    par.set(m, parPrestation)

    const dates = jours.get(m) ?? new Set<string>()
    dates.add(s.date.toISOString().slice(0, 10))
    jours.set(m, dates)
  }

  const out = new Map<string, SyntheseCra>()
  for (const [missionId, parPrestation] of par) {
    const lignes = [...parPrestation.entries()]
      .map(([label, quantites]) => ({ label, centiemes: centiemesParFacteur(quantites) }))
      // Par poids décroissant : c'est la prestation la plus servie qui décrit
      // le mois, et un tri alphabétique la noierait.
      .sort((a, b) => b.centiemes - a.centiemes || a.label.localeCompare(b.label))

    out.set(missionId, {
      // Somme des lignes déjà converties, et non une conversion du total : le
      // facteur peut différer d'une prestation à l'autre.
      totalCentiemes: lignes.reduce((t, l) => t + l.centiemes, 0),
      joursServis: jours.get(missionId)?.size ?? 0,
      lignes,
    })
  }
  return out
}

export { VIDE as SYNTHESE_VIDE }
