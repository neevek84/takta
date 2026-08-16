/**
 * Ce qu'un appel à une API externe déclare de lui-même.
 *
 * Domaine pur : ni Prisma, ni Next, ni React, ni `node:fs`. La lecture d'un
 * fichier vit dans les tests et dans la génération, jamais ici.
 *
 * Le champ qui sert vraiment est `origine` : quand un système tiers change le
 * format d'un champ, la question n'est pas de retrouver l'appel, c'est de
 * savoir quoi recalculer pour le remplir autrement.
 */

export type MethodeHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** D'où vient la valeur d'un paramètre. */
export type SourceValeur =
  /** un réglage de l'application, modifiable par l'utilisateur */
  | 'REGLAGE'
  /** une valeur saisie par l'utilisateur */
  | 'SAISIE'
  /** dérivée par le domaine à partir d'autre chose */
  | 'CALCUL'
  /** fixée dans le code, jamais paramétrable */
  | 'CONSTANTE'
  /** identifiant d'un objet distant, déjà connu par une correspondance */
  | 'IDENTIFIANT'
  /** variable d'environnement */
  | 'ENVIRONNEMENT'

export interface ParametreAppel {
  nom: string
  source: SourceValeur
  /** module, réglage ou constante qui produit la valeur. Jamais une valeur réelle. */
  origine: string
  /** valeur d'illustration, manifestement factice, 40 caractères au plus */
  exemple: string
}

/** Ce que devient un appel qui échoue. */
export type ComportementEchec =
  /** remis en file, rejoué avec recul progressif */
  | 'REJOUE'
  /** abandonné : le rejouer donnerait le même refus */
  | 'ABANDONNE'
  /** toléré : l'état visé est déjà atteint */
  | 'TOLERE'

export interface PreuveAppel {
  /** version du système tiers, ex. '23.0.1' */
  version: string
  /** 'AAAA-MM-JJ' */
  date: string
  moyen: 'DOUBLE' | 'INSTANCE_JETABLE' | 'INSTANCE_PORTEUR'
}

export interface AppelExterne {
  /** ce que l'appel fait, en langage métier */
  operation: string
  methode: MethodeHttp
  /** gabarit de chemin, paramètres entre accolades : '/tasks/{taskId}/addtimespent' */
  gabarit: string
  /** false = redirection du navigateur, jamais émise par le serveur (voir D3) */
  emis: boolean
  /** module et fonction qui l'émettent */
  emisPar: string
  parametres: ParametreAppel[]
  preuve: PreuveAppel
  echec: { comportement: ComportementEchec; visible: string }
  /** réglages du système tiers dont dépend le sens des données */
  reglagesTiers: string[]
  /** précision que ni la route ni les paramètres ne portent */
  note?: string
}

export interface CatalogueSysteme {
  systeme: string
  /** gabarit de base, le réglage entre accolades */
  base: string
  appels: AppelExterne[]
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/
const DEBUT_METHODE = /^(GET|POST|PUT|PATCH|DELETE)\b/
const LONGUEUR_EXEMPLE_MAX = 40

export function cleAppel(a: { methode: MethodeHttp; gabarit: string }): string {
  return `${a.methode} ${a.gabarit}`
}

/**
 * Vrai pour ce qui a la forme d'un jeton ou d'une clé.
 *
 * Deux familles : les préfixes que Google publie (`ya29.`, `1//`), et les
 * chaînes opaques — longues, mêlant casses et chiffres, ou hexadécimales.
 * Un exemple de catalogue est court et lisible ; c'est ce qui les sépare.
 */
export function ressembleAUnSecret(valeur: string): boolean {
  if (/^ya29\./.test(valeur)) return true
  if (/^1\/\/[A-Za-z0-9_-]{15,}/.test(valeur)) return true
  if (/^sk-[A-Za-z0-9]{16,}/.test(valeur)) return true
  if (/^[0-9a-f]{32,}$/.test(valeur)) return true

  const opaque = /^[A-Za-z0-9+/]{32,}={0,2}$/.test(valeur)
  const melange = /[a-z]/.test(valeur) && /[A-Z]/.test(valeur) && /[0-9]/.test(valeur)
  return opaque && melange
}

function construireMotif(gabarit: string): RegExp {
  const echappe = gabarit
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '{' || c === '}' ? c : `\\${c}`))
    .replace(/\{[^}]+\}/g, '[^/]+')
  return new RegExp(`^${echappe}$`)
}

/**
 * Rend l'entrée du catalogue qui correspond à cette requête, ou `null`.
 *
 * La base est fournie par l'appelant — le double sait avec quelle base il a
 * été construit. Comparer par suffixe ferait passer `/projects/3/tasks` pour
 * `/tasks` : c'est précisément le genre de rapprochement approximatif qui
 * laisserait un appel non catalogué passer.
 */
export function gabaritCorrespondant(args: {
  catalogue: CatalogueSysteme
  base: string
  methode: string
  url: string
}): AppelExterne | null {
  const chemin = args.url.split('?')[0] ?? ''

  for (const appel of args.catalogue.appels) {
    if (!appel.emis) continue
    if (appel.methode !== args.methode) continue

    if (appel.gabarit.startsWith('https://')) {
      if (construireMotif(appel.gabarit).test(chemin)) return appel
      continue
    }

    if (!chemin.startsWith(args.base)) continue
    if (construireMotif(appel.gabarit).test(chemin.slice(args.base.length))) return appel
  }
  return null
}

/**
 * `manquants` : catalogué mais jamais exercé — une entrée inventée.
 * `inconnus` : exercé mais absent du catalogue — impossible si le double
 * refuse, gardé parce qu'un double mal branché doit se voir.
 */
export function comparerCouverture(args: {
  catalogue: CatalogueSysteme
  observes: ReadonlyArray<string>
}): { manquants: string[]; inconnus: string[] } {
  const vus = new Set(args.observes)
  const attendus = new Set(args.catalogue.appels.filter((a) => a.emis).map((a) => cleAppel(a)))

  return {
    manquants: [...attendus].filter((c) => !vus.has(c)).sort(),
    inconnus: [...vus].filter((c) => !attendus.has(c)).sort(),
  }
}

/** Rend la liste des anomalies, vide quand le catalogue est en règle. */
export function verifierCatalogue(c: CatalogueSysteme, aujourdhui: string): string[] {
  const anomalies: string[] = []
  const vus = new Set<string>()

  if (c.systeme.trim() === '') anomalies.push('Le catalogue ne nomme pas son système.')
  if (c.base.trim() === '') anomalies.push(`${c.systeme} : le catalogue ne dit pas sa base.`)
  if (c.appels.length === 0) anomalies.push(`${c.systeme} : catalogue vide.`)

  for (const a of c.appels) {
    const cle = cleAppel(a)
    const dire = (message: string): void => void anomalies.push(`${cle} : ${message}`)

    if (vus.has(cle)) dire('deux entrées portent le même couple méthode et chemin.')
    vus.add(cle)

    if (!a.gabarit.startsWith('/') && !a.gabarit.startsWith('https://')) {
      dire('le chemin doit commencer par « / » ou être une URL absolue.')
    }
    if (a.operation.trim() === '') dire("l'opération n'est pas dite.")
    else if (DEBUT_METHODE.test(a.operation) || a.operation.includes('/')) {
      dire("l'opération doit se dire en langage métier, pas en méthode et chemin.")
    }
    if (!a.emisPar.includes('.ts')) dire('le module émetteur n est pas nommé.')

    if (a.preuve.version.trim() === '') dire('aucune version de preuve.')
    if (!DATE_ISO.test(a.preuve.date)) {
      dire(`la date de preuve « ${a.preuve.date} » n'est pas au format AAAA-MM-JJ.`)
    } else if (a.preuve.date > aujourdhui) {
      dire(`la date de preuve ${a.preuve.date} est postérieure à ${aujourdhui}.`)
    }

    if (a.echec.visible.trim() === '') {
      dire("l'entrée ne dit pas ce que l'utilisateur voit en échec.")
    }

    for (const p of a.parametres) {
      if (p.nom.trim() === '') dire('un paramètre est sans nom.')
      if (p.origine.trim() === '') dire(`le paramètre « ${p.nom} » ne dit pas d'où vient sa valeur.`)
      if (p.exemple.length > LONGUEUR_EXEMPLE_MAX) {
        dire(
          `le paramètre « ${p.nom} » porte un exemple de plus de ${LONGUEUR_EXEMPLE_MAX} caractères.`,
        )
      } else if (ressembleAUnSecret(p.exemple)) {
        dire(`le paramètre « ${p.nom} » porte un exemple qui ressemble à un secret.`)
      }
    }
  }

  return anomalies
}
