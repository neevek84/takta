import { formatJours, libelleJour, type CraDocument } from '@/core/cra/document'
import type { EngagementDetaille } from '@/core/engagement/compute'
import { LINE_COLORS, SAISIE_COLOR, type LineColor } from '@/core/saisie/colors'
import { disposerAplats } from '@/core/saisie/disposition'
import type { Forme } from '@/core/saisie/forme'
import { Aplat } from '@/components/ui/Aplat'
import { SEGMENT_PREVU, SEGMENT_PREVU_BORDURE, SEGMENT_REALISE } from '@/components/ui/SegmentLegend'
import { cn } from '@/lib/cn'

const SEMAINE = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

function estWeekEnd(date: string): boolean {
  const j = new Date(`${date}T00:00:00Z`).getUTCDay()
  return j === 0 || j === 6
}

/** Rang du jour dans une semaine qui commence le lundi, en UTC comme `libelleJour`. */
function rangDansLaSemaine(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

/**
 * La teinte d'une prestation du document.
 *
 * Le contenu figé ne porte pas l'identifiant des prestations : la teinte se
 * tire donc de leur rang dans `lignes`, dans la même palette catégorielle que
 * le calendrier. Seule, une prestation prend l'aplat « saisi » — une couleur
 * catégorielle ne distingue rien quand il n'y a qu'une catégorie.
 */
function couleurDeLigne(rang: number, nombre: number): LineColor {
  return nombre <= 1 ? SAISIE_COLOR : LINE_COLORS[rang % LINE_COLORS.length]!
}

/**
 * La forme d'une quantité. Le document ne dit ni matin ni après-midi : une
 * fraction de journée se dessine donc à sa hauteur, depuis le bas.
 */
function formeDeQuantite(centiemes: number): Forme {
  if (centiemes <= 0) return { kind: 'AUCUNE' }
  if (centiemes >= 100) return { kind: 'PLEINE' }
  return { kind: 'PARTIELLE', fraction: Math.round(centiemes) / 100 }
}

/** Une part de la case, en pourcentage arrondi au centième de point. */
function pourcent(part: number): string {
  return `${Math.round(part * 10000) / 100}%`
}

/**
 * Les quatre segments d'une piste — validé, en validation, planifié, puis le
 * reste en fond —, à l'échelle du **vendu** comme sur le PDF : un dépassement
 * sature la piste au lieu de l'étirer, et se dit en toutes lettres à côté.
 *
 * Les teintes sont celles de l'application : le réalisé validé en accent, le
 * réalisé à valider en `saisie` — l'aplat des jours de ce CRA —, le planifié
 * en ambre tireté. Le tracé est décoratif : les chiffres sont écrits dessous.
 */
function Piste({ e }: { e: EngagementDetaille }) {
  let reste = e.venduCentiemes
  const largeur = (centiemes: number): string => {
    const pris = Math.max(0, Math.min(centiemes, reste))
    reste -= pris
    return e.venduCentiemes <= 0 ? '0%' : pourcent(pris / e.venduCentiemes)
  }
  const valide = largeur(e.valideCentiemes)
  const enValidation = largeur(e.enValidationCentiemes)
  const planifie = largeur(e.planifieCentiemes)
  return (
    <div
      aria-hidden="true"
      data-testid="piste"
      className="relative flex h-3 w-full overflow-hidden rounded-sm bg-off-strong"
    >
      <div data-segment="valide" className={SEGMENT_REALISE} style={{ width: valide }} />
      <div data-segment="en-validation" className="bg-saisie" style={{ width: enValidation }} />
      <div
        data-segment="planifie"
        className={cn(SEGMENT_PREVU, planifie !== '0%' && SEGMENT_PREVU_BORDURE)}
        style={{ width: planifie }}
      />
      {e.depassementCentiemes > 0 && (
        // Un bord, pas un fond : `dangerInk` est une encre, jamais un fond.
        <div data-segment="depassement" className="absolute inset-y-0 right-0 border-r-4 border-danger-ink" />
      )}
    </div>
  )
}

/** Le solde, ou le dépassement — le chiffre qui décide d'un avenant. */
function Solde({ e, unite = '' }: { e: EngagementDetaille; unite?: string }) {
  return e.depassementCentiemes > 0 ? (
    <span className="font-medium text-danger-ink">dépassement de {formatJours(e.depassementCentiemes)} j</span>
  ) : (
    <span>
      {formatJours(e.resteCentiemes)} {unite}restants
    </span>
  )
}

/**
 * Le CRA tel que le client l'a reçu — **en lecture seule, depuis le contenu
 * figé**. Aucun montant : le type `CraDocument` n'en porte pas.
 *
 * Week-ends et fériés sont **nommés** (« sam. », « férié »), pas seulement
 * grisés : aucune information par la seule couleur.
 */
export function CraLecture({ document }: { document: CraDocument }) {
  const feries = new Set(document.feries)
  const nombre = document.lignes.length
  const couleurs = document.lignes.map((_, rang) => couleurDeLigne(rang, nombre))

  // date -> les quantités du jour, une par prestation, dans l'ordre des lignes
  const parJour = new Map<string, { rang: number; centiemes: number }[]>()
  document.lignes.forEach((l, rang) => {
    for (const j of l.jours) parJour.set(j.date, [...(parJour.get(j.date) ?? []), { rang, centiemes: j.centiemes }])
  })

  const premier = document.joursDuMois[0]
  const decalage = premier === undefined ? 0 : rangDansLaSemaine(premier)
  const avecDepassement =
    document.lignes.some((l) => l.engagement.depassementCentiemes > 0) ||
    (nombre > 1 && document.engagementMission.depassementCentiemes > 0)

  const legende: ReadonlyArray<[string, string]> = [
    ['Validé', SEGMENT_REALISE],
    ['En validation', 'bg-saisie'],
    ['Planifié', cn(SEGMENT_PREVU, SEGMENT_PREVU_BORDURE)],
    ['Restant', 'bg-off-strong'],
    ...(avecDepassement ? [['Dépassement', 'border-r-4 border-danger-ink bg-off-strong'] as [string, string]] : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">{document.emetteur.nom}</p>
        <h1 className="text-xl">
          {document.clientNom} · {document.missionLabel}
        </h1>
        <p className="text-muted">Compte-rendu d’activité — {document.moisLibelle}</p>
      </header>

      <p>
        <span className="text-2xl font-medium">{formatJours(document.totalCentiemes)} j</span>{' '}
        <span className="text-muted">réalisés sur le mois</span>
      </p>

      <section aria-label="Calendrier du mois">
        {/* Les en-têtes sont redondants pour un lecteur d'écran : chaque jour
            porte déjà son nom dans son texte accessible. */}
        <div aria-hidden="true" data-testid="entete-semaine" className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-muted">
          {SEMAINE.map((j) => (
            <span key={j}>{j}</span>
          ))}
        </div>
        <ol data-testid="grille-mois" className="grid grid-cols-7 gap-1 text-center text-xs">
          {/* Le 1er tombe sous son jour de la semaine : des cases vides le
              précèdent, muettes pour les technologies d'assistance. */}
          {Array.from({ length: decalage }, (_, i) => (
            <li key={`vide-${i}`} aria-hidden="true" data-vide="true" />
          ))}
          {document.joursDuMois.map((date) => {
            const quantites = parJour.get(date) ?? []
            const c = quantites.reduce((s, q) => s + q.centiemes, 0)
            // `libelleJour` rend « sam. 05 » : l'abréviation est le premier mot.
            const repere = feries.has(date) ? 'férié' : estWeekEnd(date) ? libelleJour(date).split(' ')[0] : ''
            // Une prestation par bande, dans l'ordre des lignes : la même reste
            // du même côté d'un jour à l'autre (`disposerAplats`).
            const disposition = disposerAplats(
              quantites.map((q) => ({ lineId: String(q.rang), forme: formeDeQuantite(q.centiemes), previsionnel: false })),
            )
            const detail = quantites
              .map((q) => `${document.lignes[q.rang]!.label} : ${formatJours(q.centiemes)} j`)
              .join(', ')
            return (
              <li
                key={date}
                data-testid={`jour-${date}`}
                className="relative overflow-hidden rounded-md border border-rule p-1"
              >
                {/* Les aplats, posés en absolu : aucune largeur ajoutée aux
                    sept colonnes, et le chiffre passe par-dessus. */}
                {disposition.map((d) => (
                  <span
                    key={d.lineId}
                    aria-hidden="true"
                    data-testid={`bande-${d.lineId}-${date}`}
                    data-bande={d.bande}
                    data-bandes={d.bandes}
                    className="pointer-events-none absolute inset-y-0"
                    style={{ left: pourcent(d.bande / d.bandes), width: pourcent(1 / d.bandes) }}
                  >
                    <Aplat cle={`${d.lineId}-${date}`} forme={d.forme} couleur={couleurs[Number(d.lineId)]!} />
                  </span>
                ))}
                <span aria-hidden="true" className="relative block text-muted">
                  {Number(date.slice(8))}
                </span>
                <span aria-hidden="true" className="relative block font-medium text-ink">
                  {c > 0 ? formatJours(c) : '–'}
                </span>
                {repere !== '' && (
                  <span aria-hidden="true" className="relative block text-muted">
                    {repere}
                  </span>
                )}
                <span className="sr-only">
                  {`${libelleJour(date)} ${document.moisLibelle}${feries.has(date) ? ', férié' : ''} — `}
                  {detail === '' ? 'aucun jour réalisé' : detail}
                </span>
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-label="Détail par prestation">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-4">Prestation</th>
                <th className="py-1 pr-4">Jours</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {document.lignes.map((l, rang) => (
                <tr key={l.label} className="border-b border-rule align-top">
                  <td className="py-1 pr-4">
                    {/* La pastille sert de légende aux aplats du calendrier. */}
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        data-testid={`pastille-${rang}`}
                        className={cn('inline-block h-3 w-3 shrink-0 rounded-sm border', couleurs[rang]!.bg, couleurs[rang]!.border)}
                      />
                      {l.label}
                    </span>
                  </td>
                  <td className="py-1 pr-4">
                    {l.jours.map((j) => `${libelleJour(j.date)} : ${formatJours(j.centiemes)}`).join(' · ')}
                  </td>
                  <td className="py-1 text-right">{formatJours(l.totalCentiemes)} j</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {nombre > 0 && (
        <section aria-labelledby="titre-engagement" className="flex flex-col gap-3">
          <div>
            <h2 id="titre-engagement" className="text-lg">
              Où en est la mission
            </h2>
            {/* L'engagement est figé avec le document : ce qu'il dit est vrai
                à l'envoi, pas forcément au moment où le client le lit. */}
            <p className="text-xs text-muted">
              Toutes périodes confondues, au moment de l’envoi. « En validation » : les jours de ce CRA,
              soumis à votre signature.
            </p>
          </div>

          {/* Les segments nommés à l'écran : jamais par la seule couleur. */}
          <p data-testid="legende-engagement" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {legende.map(([nom, classes]) => (
              <span key={nom} className="inline-flex items-center gap-1">
                <span aria-hidden="true" className={cn('inline-block h-2 w-4 rounded-sm', classes)} />
                {nom}
              </span>
            ))}
          </p>

          <ul className="flex flex-col gap-3">
            {document.lignes.map((l, rang) => (
              <li key={l.label} data-testid={`engagement-${rang}`} className="flex flex-col gap-1 text-xs">
                <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-sm font-medium text-ink">{l.label}</span>
                  <span className="text-muted tabular-nums">{formatJours(l.engagement.venduCentiemes)} j vendus</span>
                </p>
                <Piste e={l.engagement} />
                <p className="flex flex-wrap justify-between gap-x-2 text-muted tabular-nums">
                  <span>
                    {formatJours(l.engagement.valideCentiemes)} validés ·{' '}
                    {formatJours(l.engagement.enValidationCentiemes)} en validation ·{' '}
                    {formatJours(l.engagement.planifieCentiemes)} planifiés
                  </span>
                  <Solde e={l.engagement} />
                </p>
              </li>
            ))}
          </ul>

          {/* Le cumul n'apprend rien quand il n'y a qu'une prestation. Il
              couvre toutes celles de la mission, servies ce mois-ci ou non. */}
          {nombre > 1 && (
            <div data-testid="engagement-mission" className="flex flex-col gap-1 border-t border-rule pt-3 text-xs">
              <p className="text-sm font-medium text-ink">Engagement total de la mission</p>
              <p className="text-muted tabular-nums">
                <span className="text-base font-medium text-ink">
                  {formatJours(document.engagementMission.consommeCentiemes)}
                </span>{' '}
                jours consommés sur {formatJours(document.engagementMission.venduCentiemes)} j vendus
              </p>
              <Piste e={document.engagementMission} />
              <p className="text-muted tabular-nums">
                <Solde e={document.engagementMission} unite="jours " />
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
