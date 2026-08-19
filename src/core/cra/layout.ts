import {
  A4_PAYSAGE_HEIGHT_PT,
  A4_PAYSAGE_WIDTH_PT,
  largeurApprox,
  type PdfLine,
  type PdfPage,
  type PdfRect,
  type PdfText,
} from '../pdf/writer'
import { THEME_ENCRE_CLAIR } from '../theme/tokens'
import type { EngagementDetaille } from '../engagement/compute'
import { formatJours, type CraDocument, type CraLigne } from './document'
import {
  ANCRE_DATE,
  ANCRE_SIGNATURE,
  TAILLE_CHAMP_DATE,
  TAILLE_CHAMP_SIGNATURE,
} from './signature-zones'

/**
 * La mise en page du CRA : **A4 couché**, le mois d'un seul tenant.
 *
 * Le format n'est pas un goût. Trente-et-une colonnes de jours dans 515 points
 * de large donnent une case de 13 points, où aucun nombre ne tient ; les 630
 * points du paysage en donnent une de 20, où « 0,25 » tient. Tout le reste de
 * ce fichier découle de là.
 *
 * Les coordonnées y sont comptées **depuis le haut**, comme on lit une page,
 * et retournées une seule fois au moment de poser l'objet — voir `texte` et
 * `pave`. L'origine PDF est en bas à gauche, et laisser cette inversion se
 * propager dans quarante calculs est le plus sûr moyen de décaler un
 * calendrier d'une case sans le voir.
 */

const T = THEME_ENCRE_CLAIR

export const MARGE = 40
const LARGEUR = A4_PAYSAGE_WIDTH_PT
const HAUTEUR = A4_PAYSAGE_HEIGHT_PT
const DROITE = LARGEUR - MARGE

/**
 * Au-delà, la bande et le bloc d'engagement ne tiennent plus en hauteur : on
 * ouvre une page. Six lignes mènent le bas du bloc à 530 points sur 555
 * disponibles ; une septième le pousserait sous le pied de page.
 */
export const LIGNES_PAR_PAGE = 6

// --- La bande des jours ----------------------------------------------------
const X_BANDE = 172
const X_TOTAL_MOIS = 165
const LARGEUR_CASE = (DROITE - X_BANDE) / 31
const GOUTTIERE = 0.8
const HAUTEUR_CASE = 19
const PAS_LIGNE = 22
const Y_NUMEROS = 148
const Y_PREMIERE_LIGNE = Y_NUMEROS + 8

// --- Le bloc d'engagement --------------------------------------------------
const X_PISTE = 172
const LARGEUR_PISTE = 380
const PAS_ENGAGEMENT = 28
const HAUTEUR_PISTE = 10
/** Ce que le bloc occupe au minimum, pour que le pavé de signature tienne. */
const HAUTEUR_BLOC_MINIMUM = 200

// --- La colonne de droite --------------------------------------------------
const X_SEPARATEUR = 575
const X_DROITE = 600
const LARGEUR_DROITE = DROITE - X_DROITE

const Y_PIED = HAUTEUR - 40

const JOURS_INITIALE = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

/** Le motif de tiret du prévisionnel, partout le même. */
const TIRET_PREVU: readonly [number, number] = [2.4, 1.8]

/**
 * Une page en cours de composition, en coordonnées « depuis le haut ».
 *
 * Les trois listes se remplissent dans n'importe quel ordre : c'est
 * `renderPdf` qui garantit que les aplats passent sous les traits et les
 * textes, pas l'ordre des appels ici.
 */
class Feuille {
  readonly texts: PdfText[] = []
  readonly lines: PdfLine[] = []
  readonly rects: PdfRect[] = []

  texte(
    x: number,
    yHaut: number,
    text: string,
    options: { size?: number; bold?: boolean; color?: string; invisible?: boolean } = {},
  ): void {
    if (text === '') return
    this.texts.push({
      x,
      y: HAUTEUR - yHaut,
      size: options.size ?? 8,
      text,
      ...(options.bold === true ? { bold: true } : {}),
      ...(options.invisible === true ? { invisible: true } : {}),
      color: options.color ?? T.ink,
    })
  }

  /**
   * Une ancre : posée à un point précis, jamais peinte.
   *
   * `yHaut` désigne le **bas** du champ qu'elle marque, parce que c'est
   * l'origine que les coordonnées PDF utilisent et que `zonesSignature` rend
   * telle quelle. Le texte n'a ni taille lisible ni couleur : il n'est pas là
   * pour être vu.
   */
  ancre(x: number, yHaut: number, text: string): void {
    this.texte(x, yHaut, text, { size: 1, invisible: true })
  }

  /** Le même texte, aligné sur son bord droit. */
  texteADroite(
    xDroite: number,
    yHaut: number,
    text: string,
    options: { size?: number; bold?: boolean; color?: string } = {},
  ): void {
    this.texte(xDroite - largeurApprox(text, options.size ?? 8), yHaut, text, options)
  }

  /** Le même texte, centré sur `xCentre`. */
  texteCentre(
    xCentre: number,
    yHaut: number,
    text: string,
    options: { size?: number; bold?: boolean; color?: string } = {},
  ): void {
    this.texte(xCentre - largeurApprox(text, options.size ?? 8) / 2, yHaut, text, options)
  }

  pave(
    x: number,
    yHaut: number,
    w: number,
    h: number,
    options: Omit<PdfRect, 'x' | 'y' | 'w' | 'h'>,
  ): void {
    if (w <= 0 || h <= 0) return
    this.rects.push({ x, y: HAUTEUR - yHaut - h, w, h, ...options })
  }

  filet(x1: number, yHaut: number, x2: number, options: Partial<PdfLine> = {}): void {
    this.lines.push({
      x1,
      y1: HAUTEUR - yHaut,
      x2,
      y2: HAUTEUR - yHaut,
      thickness: options.thickness ?? 0.6,
      color: options.color ?? T.rule,
    })
  }

  filetVertical(x: number, yHaut1: number, yHaut2: number): void {
    this.lines.push({
      x1: x,
      y1: HAUTEUR - yHaut1,
      x2: x,
      y2: HAUTEUR - yHaut2,
      thickness: 0.6,
      color: T.rule,
    })
  }

  page(): PdfPage {
    return {
      texts: this.texts,
      lines: this.lines,
      rects: this.rects,
      width: LARGEUR,
      height: HAUTEUR,
    }
  }
}

function tronquer(texte: string, largeurMax: number, size: number): string {
  if (largeurApprox(texte, size) <= largeurMax) return texte
  let coupe = texte
  while (coupe.length > 1 && largeurApprox(`${coupe}…`, size) > largeurMax) {
    coupe = coupe.slice(0, -1)
  }
  return `${coupe.trimEnd()}…`
}

/** 0 = dimanche, comme `Date#getUTCDay`. Tout est calculé en UTC. */
function jourDeLaSemaine(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay()
}

function estWeekEnd(date: string): boolean {
  const jour = jourDeLaSemaine(date)
  return jour === 0 || jour === 6
}

export function layoutCraDocument(doc: CraDocument): PdfPage[] {
  const paquets: CraLigne[][] = []
  for (let i = 0; i < doc.lignes.length; i += LIGNES_PAR_PAGE) {
    paquets.push(doc.lignes.slice(i, i + LIGNES_PAR_PAGE))
  }
  if (paquets.length === 0) paquets.push([])

  return paquets.map((paquet, index) =>
    composerPage(doc, paquet, index + 1, paquets.length, index === paquets.length - 1),
  )
}

function composerPage(
  doc: CraDocument,
  lignes: CraLigne[],
  numero: number,
  total: number,
  derniere: boolean,
): PdfPage {
  const f = new Feuille()

  entete(f, doc)
  const basBande = bandeDesJours(f, doc, lignes)
  const yEngagement = basBande + 34
  const basBloc = engagementParPrestation(f, lignes, yEngagement)

  // Le cumul de la mission et la signature ne paraissent qu'une fois : un
  // document qu'on peut signer deux fois est un document qui sera signé deux
  // fois.
  if (derniere) colonneDeDroite(f, doc, yEngagement, basBloc)

  pied(f, numero, total)
  return f.page()
}

function entete(f: Feuille, doc: CraDocument): void {
  f.pave(0, 0, LARGEUR, 28, { fill: T.accent })
  f.texte(MARGE, 18.5, 'Compte rendu d’activité', {
    size: 12,
    bold: true,
    color: T.onAccent,
  })
  f.texteADroite(DROITE, 18.5, `${doc.moisLibelle} · ${doc.clientNom}`, {
    size: 9,
    color: T.onAccent,
  })

  // « Temps de travail » ne s'écrit nulle part sur ce document : le mot
  // appartient au droit du travail, et rien n'oblige un compte rendu de
  // prestation à le prêter à une requalification.
  f.texte(MARGE, 54, 'TOTAL DU MOIS', { size: 7, bold: true, color: T.accentDark })
  const totalDuMois = formatJours(doc.totalCentiemes)
  f.texte(MARGE, 86, totalDuMois, { size: 31, bold: true })
  f.texte(MARGE + largeurApprox(totalDuMois, 31) + 8, 86, 'jours', { size: 13, color: T.muted })
  f.texte(MARGE, 101, `sur ${doc.lignes.length} prestation${doc.lignes.length > 1 ? 's' : ''}`, {
    size: 8,
    color: T.muted,
  })

  f.texte(320, 54, 'PRESTATAIRE', { size: 7, bold: true, color: T.accentDark })
  f.texte(320, 69, tronquer(doc.emetteur.nom, 230, 9.5), { size: 9.5, bold: true })
  f.texte(320, 81, tronquer(doc.emetteur.adresse, 230, 8), { size: 8, color: T.muted })
  // SIRET et courriel partagent la troisième ligne : le paysage donne de la
  // largeur, pas de la hauteur, et l'entête ne doit pas manger la bande.
  const identifiants = [doc.emetteur.siret, doc.emetteur.email].filter((v) => v !== '').join(' · ')
  f.texte(320, 93, tronquer(identifiants, 230, 8), { size: 8, color: T.muted })

  f.texte(570, 54, 'CLIENT', { size: 7, bold: true, color: T.accentDark })
  f.texte(570, 69, tronquer(doc.clientNom, 232, 9.5), { size: 9.5, bold: true })
  f.texte(570, 81, tronquer(`Mission : ${doc.missionLabel}`, 232, 8), {
    size: 8,
    color: T.muted,
  })
  f.texte(570, 93, tronquer(`Signataire : ${doc.signataireNom}`, 232, 8), {
    size: 8,
    color: T.muted,
  })

  f.filet(MARGE, 114, DROITE)
}

/** Dessine la bande et rend l'ordonnée de sa dernière case. */
function bandeDesJours(f: Feuille, doc: CraDocument, lignes: CraLigne[]): number {
  f.texte(MARGE, 132, 'DÉTAIL DU MOIS, JOUR PAR JOUR', {
    size: 7,
    bold: true,
    color: T.accentDark,
  })

  const nombreDeLignes = Math.max(lignes.length, 1)
  const basDesCases = Y_PREMIERE_LIGNE + (nombreDeLignes - 1) * PAS_LIGNE + HAUTEUR_CASE

  const feries = new Set(doc.feries)
  const xCase = (rang: number): number => X_BANDE + rang * LARGEUR_CASE

  // Le tapis des jours non ouvrés, posé sous toute la hauteur de la bande :
  // c'est ce qui donne au mois sa respiration hebdomadaire sans ajouter un
  // seul trait.
  doc.joursDuMois.forEach((date, rang) => {
    const ferie = feries.has(date)
    if (!ferie && !estWeekEnd(date)) return
    f.pave(xCase(rang), Y_NUMEROS - 18, LARGEUR_CASE, basDesCases - Y_NUMEROS + 18, {
      fill: ferie ? T.offStrong : T.off,
    })
  })

  f.texteADroite(X_TOTAL_MOIS, Y_NUMEROS, 'MOIS', { size: 6.5, bold: true, color: T.muted })
  doc.joursDuMois.forEach((date, rang) => {
    const centre = xCase(rang) + LARGEUR_CASE / 2
    const chome = estWeekEnd(date) || feries.has(date)
    f.texteCentre(centre, Y_NUMEROS - 9, JOURS_INITIALE[jourDeLaSemaine(date)] as string, {
      size: 6,
      color: T.muted,
    })
    f.texteCentre(centre, Y_NUMEROS, String(Number(date.slice(8, 10))), {
      size: 7,
      bold: !chome,
      color: chome ? T.muted : T.ink,
    })
  })

  if (lignes.length === 0) {
    f.texte(X_BANDE, Y_PREMIERE_LIGNE + 13, 'Aucun temps réalisé n’a été saisi sur ce mois.', {
      size: 9,
      color: T.muted,
    })
    return basDesCases
  }

  lignes.forEach((ligne, rangLigne) => {
    const y = Y_PREMIERE_LIGNE + rangLigne * PAS_LIGNE
    f.texte(MARGE, y + 13, tronquer(ligne.label, X_TOTAL_MOIS - MARGE - 34, 8.5), { size: 8.5 })
    f.texteADroite(X_TOTAL_MOIS, y + 13, formatJours(ligne.totalCentiemes), {
      size: 8,
      bold: true,
      color: T.muted,
    })

    const parJour = new Map(ligne.jours.map((j) => [j.date, j.centiemes]))
    doc.joursDuMois.forEach((date, rang) => {
      const x = xCase(rang) + GOUTTIERE
      const w = LARGEUR_CASE - GOUTTIERE * 2
      const centiemes = parJour.get(date)
      f.pave(x, y, w, HAUTEUR_CASE, {
        // Une case vide de week-end laisse voir le tapis : la remplir de blanc
        // reviendrait à l'effacer case par case.
        ...(centiemes === undefined && (estWeekEnd(date) || feries.has(date))
          ? {}
          : { fill: centiemes === undefined ? T.surface : T.saisie }),
        stroke: T.rule,
        thickness: 0.4,
        radius: 2,
      })
      if (centiemes !== undefined) {
        f.texteCentre(x + w / 2, y + 12.5, formatJours(centiemes), { size: 6.5, bold: true })
      }
    })
  })

  return basDesCases
}

/**
 * Les quatre segments d'une piste d'engagement.
 *
 * La piste reste à l'échelle du **vendu** d'une ligne à l'autre : c'est ce qui
 * permet de comparer deux barres voisines. Un dépassement ne l'étire donc pas,
 * il la sature — et se dit en toutes lettres sous la piste.
 */
function piste(f: Feuille, x: number, yHaut: number, largeur: number, e: EngagementDetaille): void {
  f.pave(x, yHaut, largeur, HAUTEUR_PISTE, { fill: T.offStrong, radius: 2 })
  if (e.venduCentiemes <= 0) return

  const points = (centiemes: number): number => (centiemes / e.venduCentiemes) * largeur
  let curseur = x
  let reste = largeur

  const segment = (centiemes: number, fill: string): { x: number; w: number } => {
    const w = Math.max(0, Math.min(points(centiemes), reste))
    if (w > 0) f.pave(curseur, yHaut, w, HAUTEUR_PISTE, { fill })
    const pose = { x: curseur, w }
    curseur += w
    reste -= w
    return pose
  }

  segment(e.valideCentiemes, T.accentDark)
  segment(e.enValidationCentiemes, T.saisie)
  const planifie = segment(e.planifieCentiemes, T.prevu)

  // Le prévisionnel porte sa teinte **et** son tireté : deux aplats seuls ne
  // se distingueraient pas en vision monochrome, ni sur une photocopie.
  if (planifie.w > 1) {
    f.pave(planifie.x + 0.4, yHaut + 0.4, planifie.w - 0.8, HAUTEUR_PISTE - 0.8, {
      stroke: T.prevuEdge,
      thickness: 0.8,
      dash: TIRET_PREVU,
    })
  }

  if (e.depassementCentiemes > 0) {
    f.pave(x + largeur - 5, yHaut, 5, HAUTEUR_PISTE, { fill: T.dangerInk })
  }
}

function phraseDEngagement(e: EngagementDetaille): { avant: string; fin: string; alerte: boolean } {
  return {
    avant:
      `${formatJours(e.valideCentiemes)} validés · ` +
      `${formatJours(e.enValidationCentiemes)} en validation · ` +
      `${formatJours(e.planifieCentiemes)} planifiés`,
    fin:
      e.depassementCentiemes > 0
        ? `dépassement de ${formatJours(e.depassementCentiemes)} j`
        : `${formatJours(e.resteCentiemes)} restants`,
    alerte: e.depassementCentiemes > 0,
  }
}

/** Dessine le bloc par prestation et rend l'ordonnée de son bas. */
function engagementParPrestation(f: Feuille, lignes: CraLigne[], yHaut: number): number {
  const basBloc = yHaut + Math.max(40 + lignes.length * PAS_ENGAGEMENT, HAUTEUR_BLOC_MINIMUM)
  if (lignes.length === 0) return basBloc

  f.texte(MARGE, yHaut, 'ENGAGEMENT PAR PRESTATION, TOUTES PÉRIODES', {
    size: 7,
    bold: true,
    color: T.accentDark,
  })
  f.texte(305, yHaut, '« En validation » : les jours de ce CRA, soumis à votre signature.', {
    size: 7,
    color: T.muted,
  })

  const legende: ReadonlyArray<[string, string, boolean]> = [
    ['Validé', T.accentDark, false],
    ['En validation', T.saisie, false],
    ['Planifié', T.prevu, true],
    ['Restant', T.offStrong, false],
    ['Dépassement', T.dangerInk, false],
  ]
  let x = MARGE
  for (const [nom, fond, tirete] of legende) {
    f.pave(x, yHaut + 8, 12, 8, {
      fill: fond,
      radius: 1.5,
      ...(tirete ? { stroke: T.prevuEdge, thickness: 0.7, dash: TIRET_PREVU } : {}),
    })
    f.texte(x + 16, yHaut + 15, nom, { size: 7.5, color: T.muted })
    x += 16 + largeurApprox(nom, 7.5) + 20
  }

  lignes.forEach((ligne, rang) => {
    const y = yHaut + 40 + rang * PAS_ENGAGEMENT
    f.texte(MARGE, y, tronquer(ligne.label, X_PISTE - MARGE - 12, 9), { size: 9, bold: true })
    f.texte(MARGE, y + 11, `${formatJours(ligne.engagement.venduCentiemes)} j vendus`, {
      size: 7,
      color: T.muted,
    })

    piste(f, X_PISTE, y - 8, LARGEUR_PISTE, ligne.engagement)

    // Le détail à gauche, le solde calé sur le bout de la piste : c'est le
    // chiffre qui décide d'un avenant, et il se lit en colonne d'une
    // prestation à l'autre plutôt qu'au fil de la phrase.
    const phrase = phraseDEngagement(ligne.engagement)
    f.texte(X_PISTE, y + 11, phrase.avant, { size: 7, color: T.muted })
    f.texteADroite(X_PISTE + LARGEUR_PISTE, y + 11, phrase.fin, {
      size: 7,
      bold: phrase.alerte,
      color: phrase.alerte ? T.dangerInk : T.muted,
    })
  })

  return basBloc
}

/**
 * Le cumul de la mission et le pavé de signature.
 *
 * Le total du mois ne s'y répète pas : il est déjà en tête, en grand. Deux
 * totaux sur une même page sont une invitation à les comparer.
 */
function colonneDeDroite(
  f: Feuille,
  doc: CraDocument,
  yHaut: number,
  basBloc: number,
): void {
  f.filetVertical(X_SEPARATEUR, yHaut - 10, basBloc - 4)

  const e = doc.engagementMission
  f.texte(X_DROITE, yHaut, 'ENGAGEMENT TOTAL', { size: 7, bold: true, color: T.accentDark })
  const consomme = formatJours(e.consommeCentiemes)
  f.texte(X_DROITE, yHaut + 28, consomme, { size: 22, bold: true })
  f.texte(X_DROITE + largeurApprox(consomme, 22) + 4, yHaut + 28, 'jours consommés', {
    size: 9,
    color: T.muted,
  })
  f.texte(X_DROITE, yHaut + 42, `sur ${formatJours(e.venduCentiemes)} jours vendus`, {
    size: 8,
    color: T.muted,
  })

  piste(f, X_DROITE, yHaut + 52, LARGEUR_DROITE, e)

  const enAlerte = e.depassementCentiemes > 0
  f.texte(
    X_DROITE,
    yHaut + 76,
    enAlerte
      ? `dépassement de ${formatJours(e.depassementCentiemes)} j`
      : `${formatJours(e.resteCentiemes)} jours restants`,
    { size: 8, bold: true, color: enAlerte ? T.dangerInk : T.muted },
  )

  const yPave = yHaut + 112
  const hauteurPave = basBloc - 8 - yPave
  const titre = 'Bon pour accord'
  f.texte(X_DROITE, yPave - 8, titre, { size: 10, bold: true })
  f.texte(X_DROITE + largeurApprox(titre, 10) + 6, yPave - 8, '— validation du client', {
    size: 8,
    color: T.muted,
  })

  f.pave(X_DROITE, yPave, LARGEUR_DROITE, hauteurPave, {
    fill: T.surface,
    stroke: T.rule,
    radius: 3,
  })
  f.pave(X_DROITE, yPave, LARGEUR_DROITE, 2.5, { fill: T.accent })
  f.texte(X_DROITE + 9, yPave + 17, 'DATE', { size: 6.5, bold: true, color: T.muted })
  f.texte(X_DROITE + 88, yPave + 17, 'SIGNATURE', { size: 6.5, bold: true, color: T.muted })

  // Les deux ancres, à l'aplomb de leur intitulé et au ras du bas de leur
  // champ. Elles ne se voient pas et ne se lisent qu'à l'extraction : c'est ce
  // qui permet à un outil de signature de trouver l'emplacement sans que rien
  // ne s'ajoute à ce que le client lit. `zonesSignature` rend leur position
  // telle quelle — une seule vérité pour le dessin et pour les coordonnées.
  f.ancre(X_DROITE + 9, yPave + 22 + TAILLE_CHAMP_DATE.hauteur, ANCRE_DATE)
  f.ancre(X_DROITE + 88, yPave + 22 + TAILLE_CHAMP_SIGNATURE.hauteur, ANCRE_SIGNATURE)
  f.texte(X_DROITE + 9, yPave + hauteurPave - 12, doc.signataireNom, {
    size: 7.5,
    color: T.muted,
  })
  f.texte(X_DROITE + 9, yPave + hauteurPave - 3, doc.signataireEmail, {
    size: 7.5,
    color: T.muted,
  })
}

function pied(f: Feuille, numero: number, total: number): void {
  f.filet(MARGE, Y_PIED, DROITE)
  f.texte(MARGE, Y_PIED + 12, 'Document attestant du temps passé', {
    size: 7.5,
    color: T.muted,
  })
  f.texteADroite(DROITE, Y_PIED + 12, `Page ${numero} / ${total}`, { size: 7.5, color: T.muted })
}
