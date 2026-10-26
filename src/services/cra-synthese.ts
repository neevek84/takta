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
import { TOUTE_LA_MISSION } from '@/core/cra/perimetre'
import { clePerimetre, saisiesDuPerimetre, type PerimetreCra } from './cra-perimetre'

export interface SyntheseCra {
  totalCentiemes: number
  joursServis: number
  lignes: Array<{ label: string; centiemes: number }>
}

const VIDE: SyntheseCra = { totalCentiemes: 0, joursServis: 0, lignes: [] }

/**
 * La synthèse de chaque mission pour ce mois, en une seule requête.
 *
 * Le cas d'un CRA qui couvre toute sa mission : `syntheseParPerimetre`, rendu
 * par mission.
 */
export async function syntheseParMission(args: {
  userId: string
  missionIds: ReadonlyArray<string>
  /** 'YYYY-MM' */
  month: string
}): Promise<Map<string, SyntheseCra>> {
  const perimetres = args.missionIds.map((missionId) => ({ missionId, lineId: TOUTE_LA_MISSION }))
  const par = await syntheseParPerimetre({ userId: args.userId, perimetres, month: args.month })
  const out = new Map<string, SyntheseCra>()
  for (const p of perimetres) {
    const synthese = par.get(clePerimetre(p))
    if (synthese !== undefined) out.set(p.missionId, synthese)
  }
  return out
}

/**
 * La synthèse de chaque périmètre de CRA — toute une mission, ou une seule
 * prestation — pour ce mois, en une seule requête. Rendu par `clePerimetre`.
 *
 * Les quantités passent par `centiemesParFacteur` : chaque saisie porte le
 * facteur figé à son écriture, et convertir avec le réglage courant ferait
 * bouger un CRA validé sans qu'aucune donnée n'ait changé.
 */
export async function syntheseParPerimetre(args: {
  userId: string
  perimetres: ReadonlyArray<PerimetreCra>
  /** 'YYYY-MM' */
  month: string
}): Promise<Map<string, SyntheseCra>> {
  if (args.perimetres.length === 0) return new Map()

  const [annee, mois] = args.month.split('-').map(Number) as [number, number]
  const debut = new Date(Date.UTC(annee, mois - 1, 1))
  const fin = new Date(Date.UTC(annee, mois, 1))

  const saisies = await prisma.timeEntry.findMany({
    where: {
      userId: args.userId,
      kind: 'REALISE',
      date: { gte: debut, lt: fin },
      OR: args.perimetres.map(saisiesDuPerimetre),
    },
    select: {
      minutes: true,
      minutesParJour: true,
      date: true,
      lineId: true,
      line: { select: { missionId: true, label: true } },
    },
  })

  const out = new Map<string, SyntheseCra>()
  for (const p of args.perimetres) {
    // prestation -> quantités, chacune avec son facteur
    const parPrestation = new Map<string, Array<{ minutes: number; minutesParJour: number }>>()
    const jours = new Set<string>()

    for (const s of saisies) {
      if (s.line.missionId !== p.missionId) continue
      if (p.lineId !== TOUTE_LA_MISSION && s.lineId !== p.lineId) continue
      const liste = parPrestation.get(s.line.label) ?? []
      liste.push({ minutes: s.minutes, minutesParJour: s.minutesParJour })
      parPrestation.set(s.line.label, liste)
      jours.add(s.date.toISOString().slice(0, 10))
    }
    if (parPrestation.size === 0) continue

    const lignes = [...parPrestation.entries()]
      .map(([label, quantites]) => ({ label, centiemes: centiemesParFacteur(quantites) }))
      // Par poids décroissant : c'est la prestation la plus servie qui décrit
      // le mois, et un tri alphabétique la noierait.
      .sort((a, b) => b.centiemes - a.centiemes || a.label.localeCompare(b.label))

    out.set(clePerimetre(p), {
      // Somme des lignes déjà converties, et non une conversion du total : le
      // facteur peut différer d'une prestation à l'autre.
      totalCentiemes: lignes.reduce((t, l) => t + l.centiemes, 0),
      joursServis: jours.size,
      lignes,
    })
  }
  return out
}

export { VIDE as SYNTHESE_VIDE }
