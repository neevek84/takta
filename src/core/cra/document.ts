import type { TimeEntryKind } from '../types'
import { centiemesParFacteur, type MinutesAuFacteur } from '../time/units'
import { frenchHolidays } from '../calendar/holidays-fr'
import {
  cumulerEngagements,
  detaillerEngagement,
  type EngagementDetaille,
} from '../engagement/compute'

export interface CraEmetteur {
  nom: string
  adresse: string
  siret: string
  email: string
}

export interface CraJour {
  /** 'YYYY-MM-DD' */
  date: string
  centiemes: number
}

export interface CraLigne {
  label: string
  /** uniquement les jours servis, dans l'ordre chronologique */
  jours: CraJour[]
  /** somme exacte des cellules ci-dessus */
  totalCentiemes: number
  /**
   * Où en est la prestation de son enveloppe vendue, **toutes périodes
   * confondues** — pas seulement le mois de ce document. C'est ce qui donne au
   * client la visibilité qu'un relevé mensuel ne peut pas donner.
   */
  engagement: EngagementDetaille
}

/**
 * Le document tel qu'il sera imprimé.
 *
 * **Aucun champ monétaire, et ce n'est pas négociable.** Le CRA atteste du
 * temps passé, pas d'une somme due. Un total en euros en ferait une
 * pré-facture, et ferait rentrer par la fenêtre la facturation qu'on a sortie
 * par la porte. L'information n'entre pas dans ce type : aucune mise en page
 * ne peut donc l'imprimer par accident.
 */
export interface CraDocument {
  emetteur: CraEmetteur
  clientNom: string
  missionLabel: string
  /** 'YYYY-MM' */
  mois: string
  /** 'juin 2026' */
  moisLibelle: string
  signataireNom: string
  signataireEmail: string
  lignes: CraLigne[]
  totalCentiemes: number
  /** toutes les dates du mois, servies ou non — c'est l'axe du tableau */
  joursDuMois: string[]
  /** les fériés français tombant dans le mois, en 'YYYY-MM-DD' */
  feries: string[]
  /**
   * L'engagement cumulé de la mission, sur **toutes** ses prestations — y
   * compris celles qui n'ont rien servi ce mois-ci et qui n'apparaissent donc
   * pas dans `lignes`. C'est bien l'état de la mission, pas celui de ce seul
   * document, et son titre doit le dire.
   */
  engagementMission: EngagementDetaille
}

export interface CraDocumentInput {
  emetteur: CraEmetteur
  clientNom: string
  missionLabel: string
  /** 'YYYY-MM' */
  mois: string
  signataireNom: string
  signataireEmail: string
  /** les prestations de la mission, dans l'ordre d'affichage voulu */
  lignes: ReadonlyArray<{ id: string; label: string; soldCentiemes: number }>
  /**
   * Les mois dont le CRA est **validé** par le client, en 'YYYY-MM'. Tout le
   * réalisé qui n'y tombe pas est « en validation » — le mois du présent
   * document compris, puisque son CRA n'est pas encore validé quand on le
   * compose.
   */
  moisValides: ReadonlyArray<string>
  /**
   * Les saisies, chacune portant **son** facteur de conversion. Il n'y a
   * volontairement pas de facteur global dans cette entrée : le gel du facteur
   * se casse en lecture, et un document qui recalculerait les journées depuis
   * le réglage courant ferait changer un CRA validé sans qu'aucune donnée
   * n'ait bougé.
   */
  entries: ReadonlyArray<{
    lineId: string
    /** 'YYYY-MM-DD' */
    date: string
    minutes: number
    /** facteur figé à l'écriture de la saisie */
    minutesParJour: number
    kind: TimeEntryKind
  }>
}

/**
 * Les fériés d'un mois. Deux millésimes ne sont jamais interrogés : un mois
 * appartient à une seule année.
 */
export function feriesDuMois(mois: string): string[] {
  const annee = Number(mois.slice(0, 4))
  return frenchHolidays(annee)
    .filter((f) => f.date.slice(0, 7) === mois)
    .map((f) => f.date)
}

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

export function libelleMois(mois: string): string {
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  return `${MOIS[numero - 1]} ${annee}`
}

export function joursDuMois(mois: string): string[] {
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  // Le jour 0 du mois suivant est le dernier jour de celui-ci.
  const dernier = new Date(Date.UTC(annee, numero, 0)).getUTCDate()
  return Array.from(
    { length: dernier },
    (_, i) => `${mois}-${String(i + 1).padStart(2, '0')}`,
  )
}

/** Tout est calculé en UTC : le document ne doit pas changer selon le fuseau du serveur. */
export function libelleJour(date: string): string {
  const jour = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return `${JOURS[jour]} ${date.slice(8, 10)}`
}

/**
 * Centièmes de jour vers une quantité française à deux décimales, sans
 * séparateur de milliers.
 *
 * Homonyme volontaire du `formatJours` de `time/units`, mais pas le même
 * contrat : celui de l'écran laisse la cellule vide à zéro et rogne les
 * décimales inutiles, quand un tableau destiné à être additionné à la main par
 * le client veut deux décimales, toujours.
 */
export function formatJours(centiemes: number): string {
  return (centiemes / 100).toFixed(2).replace('.', ',')
}

/** Les trois seaux d'engagement d'une prestation, avant conversion. */
interface SeauxDEngagement {
  valide: MinutesAuFacteur[]
  enValidation: MinutesAuFacteur[]
  planifie: MinutesAuFacteur[]
}

export function buildCraDocument(input: CraDocumentInput): CraDocument {
  const idsConnus = new Set(input.lignes.map((l) => l.id))
  const moisValides = new Set(input.moisValides)

  // (ligne, jour) -> les saisies de la cellule, chacune avec son facteur
  const cellules = new Map<string, MinutesAuFacteur[]>()
  // ligne -> ses saisies de toutes les périodes, rangées par état
  const seaux = new Map<string, SeauxDEngagement>()
  for (const ligne of input.lignes) {
    seaux.set(ligne.id, { valide: [], enValidation: [], planifie: [] })
  }

  for (const saisie of input.entries) {
    if (!idsConnus.has(saisie.lineId)) continue
    const quantite = { minutes: saisie.minutes, minutesParJour: saisie.minutesParJour }
    const seau = seaux.get(saisie.lineId) as SeauxDEngagement

    // L'engagement porte sur **toute** la durée de la prestation : le borner
    // au mois affiché donnerait un reste à consommer faux dès le deuxième
    // mois de la mission.
    if (saisie.kind === 'PREVISIONNEL') seau.planifie.push(quantite)
    else if (moisValides.has(saisie.date.slice(0, 7))) seau.valide.push(quantite)
    else seau.enValidation.push(quantite)

    // Le tableau du mois, lui, n'imprime que le réalisé de ce mois-ci.
    if (saisie.kind !== 'REALISE') continue
    if (saisie.date.slice(0, 7) !== input.mois) continue

    const cle = `${saisie.lineId}|${saisie.date}`
    const deLaCellule = cellules.get(cle) ?? []
    deLaCellule.push(quantite)
    cellules.set(cle, deLaCellule)
  }

  const engagements = new Map<string, EngagementDetaille>(
    input.lignes.map((ligne) => {
      const seau = seaux.get(ligne.id) as SeauxDEngagement
      return [
        ligne.id,
        detaillerEngagement({
          venduCentiemes: ligne.soldCentiemes,
          valideCentiemes: centiemesParFacteur(seau.valide),
          enValidationCentiemes: centiemesParFacteur(seau.enValidation),
          planifieCentiemes: centiemesParFacteur(seau.planifie),
        }),
      ]
    }),
  )

  const dates = joursDuMois(input.mois)
  const lignes: CraLigne[] = []

  for (const ligne of input.lignes) {
    const jours: CraJour[] = []
    let total = 0

    for (const date of dates) {
      const deLaCellule = cellules.get(`${ligne.id}|${date}`)
      if (deLaCellule === undefined) continue
      // Point de passage unique du domaine : « cumuler les minutes, convertir
      // une fois », mais groupe de facteur par groupe de facteur. Le
      // réécrire ici, c'est se tromper une sixième fois.
      const centiemes = centiemesParFacteur(deLaCellule)
      if (centiemes === 0) continue
      jours.push({ date, centiemes })
      // Le total est la somme des cellules **imprimées**, jamais une
      // reconversion : sinon le client additionne les cases du tableau et
      // trouve autre chose que le total, ce qui suffit à faire contester le
      // document.
      total += centiemes
    }

    if (jours.length === 0) continue
    lignes.push({
      label: ligne.label,
      jours,
      totalCentiemes: total,
      engagement: engagements.get(ligne.id) as EngagementDetaille,
    })
  }

  return {
    emetteur: input.emetteur,
    clientNom: input.clientNom,
    missionLabel: input.missionLabel,
    mois: input.mois,
    moisLibelle: libelleMois(input.mois),
    signataireNom: input.signataireNom,
    signataireEmail: input.signataireEmail,
    lignes,
    totalCentiemes: lignes.reduce((somme, l) => somme + l.totalCentiemes, 0),
    joursDuMois: dates,
    feries: feriesDuMois(input.mois),
    // Sur **toutes** les prestations, servies ce mois-ci ou non : une mission
    // dont une ligne a dormi ce mois-ci n'en a pas moins vendu ses jours.
    engagementMission: cumulerEngagements([...engagements.values()]),
  }
}
