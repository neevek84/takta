/**
 * Engendre le chapitre des intégrations depuis les catalogues.
 *
 * Pur et déterministe : aucune horloge, aucun système de fichiers. Une date
 * de génération dans le fichier ferait échouer le test de non-divergence dès
 * le lendemain — les dates qui comptent sont dans le catalogue, entrée par
 * entrée, et ce sont des dates de preuve.
 */
import { cleAppel, type AppelExterne, type CatalogueSysteme, type SourceValeur } from './catalogue'

export interface SectionProse {
  titre: string
  corps: string
}

const AVERTISSEMENT =
  '<!-- ENGENDRÉ depuis les catalogues — ne pas modifier à la main. Voir npm run doc:integrations. -->'

const LIBELLE_SOURCE: Record<SourceValeur, string> = {
  REGLAGE: 'réglage',
  SAISIE: 'saisie',
  CALCUL: 'calcul',
  CONSTANTE: 'constante',
  IDENTIFIANT: 'identifiant externe',
  ENVIRONNEMENT: 'environnement',
}

const LIBELLE_ECHEC = {
  REJOUE: 'Rejoué par la file de synchronisation',
  ABANDONNE: 'Abandonné — le rejouer donnerait le même refus',
  TOLERE: "Toléré — l'état visé est déjà atteint",
} as const

const LIBELLE_MOYEN = {
  DOUBLE: 'contre le double d’API',
  INSTANCE_JETABLE: 'sur instance jetable',
  INSTANCE_PORTEUR: "sur l'instance du porteur",
} as const

/**
 * Le nom du système devant sa version, sauf quand la version le porte déjà.
 *
 * Sans cette règle, `Google Calendar API v3` deviendrait « Google Calendar
 * Google Calendar API v3 » : les catalogues ne nomment pas leur version de la
 * même façon, et c'est légitime — Dolibarr a un numéro, Google a un nom d'API.
 */
export function versionAffichee(systeme: string, version: string): string {
  return version.startsWith(systeme) ? version : `${systeme} ${version}`
}

function rendreAppel(a: AppelExterne, systeme: string): string[] {
  const lignes: string[] = []
  lignes.push(`### ${a.operation}`, '')
  lignes.push(`\`${cleAppel(a)}\` — émis par \`${a.emisPar}\``, '')
  if (!a.emis) lignes.push('Redirection du navigateur — jamais émise par le serveur.', '')

  if (a.parametres.length > 0) {
    lignes.push("| Paramètre | Source | D'où vient la valeur | Exemple |", '|---|---|---|---|')
    for (const p of a.parametres) {
      lignes.push(
        `| \`${p.nom}\` | ${LIBELLE_SOURCE[p.source]} | \`${p.origine}\` | \`${p.exemple}\` |`,
      )
    }
    lignes.push('')
  }

  lignes.push(
    `Prouvé contre ${versionAffichee(systeme, a.preuve.version)} le ${a.preuve.date}, ${LIBELLE_MOYEN[a.preuve.moyen]}.`,
    '',
  )
  lignes.push(`En échec : ${LIBELLE_ECHEC[a.echec.comportement]}. ${a.echec.visible}`, '')
  if (a.reglagesTiers.length > 0) {
    lignes.push(`Réglage tiers : ${a.reglagesTiers.map((r) => `\`${r}\``).join(', ')}.`, '')
  }
  if (a.note !== undefined) lignes.push(`> ${a.note}`, '')
  return lignes
}

function rendreSection(s: SectionProse): string[] {
  return [`## ${s.titre}`, '', s.corps, '']
}

export function engendrerChapitre(args: {
  titre: string
  preambule: SectionProse[]
  catalogues: ReadonlyArray<CatalogueSysteme>
  final: SectionProse[]
}): string {
  const lignes: string[] = [AVERTISSEMENT, '', `# ${args.titre}`, '']

  for (const s of args.preambule) lignes.push(...rendreSection(s))

  for (const c of args.catalogues) {
    lignes.push(`## ${c.systeme}`, '', `Base : \`${c.base}\``, '')
    // Trié par clé, jamais par ordre de déclaration : l'ordre du fichier de
    // catalogue suit l'histoire du code, celui du document doit être stable
    // pour qu'un ajout ne réécrive pas la moitié du fichier engendré.
    const appels = [...c.appels].sort((x, y) => cleAppel(x).localeCompare(cleAppel(y)))
    for (const a of appels) lignes.push(...rendreAppel(a, c.systeme))
  }

  for (const s of args.final) lignes.push(...rendreSection(s))

  return lignes.join('\n')
}
