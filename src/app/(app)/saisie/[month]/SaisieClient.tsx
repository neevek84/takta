'use client'

import { useEffect, useState } from 'react'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { MonthCalendar } from '@/components/calendar/MonthCalendar'
import { CellForm } from '@/components/calendar/CellForm'
import { LineSelector } from '@/components/calendar/LineSelector'
import { readSelection } from '@/components/calendar/selection-storage'
import { resolveSelection } from '@/core/saisie/selection'
import { formatClearReport, formatFillReport } from '@/core/saisie/report'
import { phraseOccupation } from '@/core/saisie/occupation'
import { phraseCreneauNonPrevu } from '@/core/saisie/slot-labels'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import type { CellState } from '@/core/saisie/cycle'
import type { MonthDay } from '@/core/month/build'
import type { Slot } from '@/core/time/slots'
import type { CapacityMode } from '@/core/types'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'
import { appliquerCase, remplirMois, saveCell, viderMois } from './actions'

/**
 * Centièmes de jour → jours, comme la charge et l'engagement les affichent
 * déjà. Le contrôle de capacité raisonne dans cette unité : le message la
 * reprend plutôt que de reconvertir en heures avec un facteur qu'il n'a pas.
 *
 * Pas `formatJours` : celui-ci laisse le zéro vide, ce qui écrirait ici « pour
 * une capacité de  j » quand la capacité est réglée à zéro.
 */
function jours(centiemes: number): string {
  return String(centiemes / 100).replace('.', ',')
}

/**
 * Le dépassement de capacité, dit sans se contredire.
 *
 * Le contrôle juge au millicentième, l'affichage montre des centièmes : à 481
 * minutes contre 480, le total vaut 100,208 centièmes et s'affiche « 1 j »
 * pour une capacité de « 1 j ». La phrase d'origine affirmait donc l'égalité
 * tout en refusant la saisie. Le nombre ne bouge pas — l'arrondir vers le haut
 * le désaccorderait du bandeau et de la ligne de totaux, qui montrent le même
 * total ailleurs sur le même écran ; c'est la phrase qui cesse de prétendre à
 * une égalité qu'elle vient de démentir.
 */
function phraseCapacite(date: string, totalCentiemes: number, capacityCentiemes: number): string {
  if (totalCentiemes > capacityCentiemes) {
    return `Capacité dépassée le ${date} : ${jours(totalCentiemes)} j saisis pour une capacité de ${jours(capacityCentiemes)} j.`
  }
  return `Capacité dépassée le ${date} : le total dépasse la capacité de ${jours(capacityCentiemes)} j d'une fraction de journée trop petite pour s'y voir, l'affichage étant au centième de jour.`
}

/** Ce qui s'écrit dans le bandeau, et sur quel ton. */
type Message = { texte: string; ton: 'info' | 'warning' | 'danger' }

function avertissement(texte: string): Message {
  return { texte, ton: 'warning' }
}

/**
 * Une occupation d'agenda n'est ni un refus ni un avertissement : rien n'est
 * en cause dans la saisie, on signale seulement que la journée porte déjà
 * autre chose. La tonalité `info` en fait un `role="status"`, annoncé au
 * moment opportun plutôt qu'en interrompant la frappe.
 */
function information(texte: string): Message {
  return { texte, ton: 'info' }
}

/** Un refus n'est pas un avertissement : rien n'a été enregistré. */
function refus(texte: string): Message {
  return { texte, ton: 'danger' }
}

type Vue = 'CALENDRIER' | 'TABLEAU'

export function SaisieClient(props: {
  month: string
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  engagementTotals: Record<string, LineEngagementTotals>
  capacityCentiemes: number
  capacityMode: CapacityMode
  slots: Slot[]
  /**
   * jours du mois déjà occupés dans l'agenda externe.
   *
   * Vide par défaut, et vide aussi quand la lecture a échoué : une panne de
   * Google retire le repère, jamais la saisie.
   */
  busyDates?: string[]
  /**
   * le jour courant, 'YYYY-MM-DD'.
   *
   * Calculé par la page — qui le calcule déjà pour le prévisionnel échu — et
   * non lu ici à l'horloge du navigateur : le rendu serveur et le rendu client
   * doivent tomber d'accord.
   */
  aujourdhui?: string
}) {
  const [message, setMessage] = useState<Message | null>(null)
  const [vue, setVue] = useState<Vue>('CALENDRIER')
  const [toutLeMois, setToutLeMois] = useState(false)
  const [confirmationVidage, setConfirmationVidage] = useState(false)
  const [formulaire, setFormulaire] = useState<{ date: string; etat: CellState } | null>(null)

  // La sélection mémorisée ne peut être lue qu'après le montage : la lire dans
  // l'initialiseur ferait diverger le rendu serveur du rendu client.
  const [lineId, setLineId] = useState(() => resolveSelection(props.lines, null)?.lineId ?? '')
  useEffect(() => {
    const memorise = resolveSelection(props.lines, readSelection())?.lineId
    if (memorise !== undefined) setLineId(memorise)
  }, [props.lines])

  const ligne = props.lines.find((l) => l.id === lineId)

  /**
   * Le signalement d'occupation, quand il n'y a rien de plus important à dire.
   *
   * Il vient en dernier : un dépassement de capacité et un créneau non
   * autorisé parlent de la saisie elle-même, l'occupation ne parle que de son
   * contexte. Aucun des trois ne bloque quoi que ce soit.
   */
  function messageDOccupation(date: string): Message | null {
    return (props.busyDates ?? []).includes(date) ? information(phraseOccupation(date)) : null
  }

  /**
   * Renvoie `true` quand la valeur a bien été enregistrée. — vue tableau
   *
   * Aucun `kind` n'est transmis : le réalisé et le prévisionnel se départagent
   * sur l'horloge du serveur, dans l'action, comme pour la vue calendrier. Les
   * deux vues du même écran écrivaient sinon le même champ sous deux autorités
   * différentes — et une machine à l'horloge décalée écrivait le mauvais.
   */
  async function handleSave(
    lineIdCellule: string,
    date: string,
    raw: string,
    slotId = '',
  ): Promise<boolean> {
    const r = await saveCell({ lineId: lineIdCellule, date, raw, month: props.month, slotId })

    if (r.ok) {
      // Trois choses peuvent être dites, dans cet ordre et aucune bloquante :
      // le dépassement de capacité, le créneau non prévu par la prestation,
      // puis l'occupation de l'agenda — la moins liée à la saisie elle-même.
      if (r.warning) {
        setMessage(
          avertissement(
            `${phraseCapacite(date, r.warning.totalCentiemes, r.warning.capacityCentiemes)} La saisie est conservée.`,
          ),
        )
      } else if (r.slotWarning) {
        // Mêmes libellés que la vue calendrier (`applyCellState`) : le
        // serveur ne renvoie que des identifiants, `props.slots` — déjà
        // transmis pour la cinématique — porte les libellés réglés en
        // administration, avec repli sur l'identifiant si le créneau a été
        // retiré des réglages depuis la saisie.
        setMessage(
          avertissement(phraseCreneauNonPrevu(r.slotWarning.allowedSlotIds, props.slots)),
        )
      } else {
        setMessage(messageDOccupation(date))
      }
      return true
    }

    setMessage(refus(messageDeRefus(r, date, 'cette ligne de prestation')))
    return false
  }

  /** Renvoie `true` quand l'état a bien été enregistré. — vue calendrier */
  async function handleApply(date: string, state: CellState): Promise<boolean> {
    const r = await appliquerCase({ lineId, date, state, month: props.month })

    if (r.ok) {
      // Le signalement de créneau prime : il dit ce que la saisie a de
      // particulier, là où l'avertissement de capacité redit ce que la ligne
      // de totaux montre déjà.
      const texte =
        r.signalement ??
        (r.warning
          ? `${phraseCapacite(date, r.warning.totalCentiemes, r.warning.capacityCentiemes)} La saisie est conservée.`
          : null)
      setMessage(texte === null ? messageDOccupation(date) : avertissement(texte))
      return true
    }

    setMessage(refus(messageDeRefus(r, date, 'cette prestation')))
    return false
  }

  async function handleRange(dates: string[], state: CellState): Promise<void> {
    // Séquentiel et non `Promise.all` : chaque jour est contrôlé contre la
    // capacité du jour, et les lancer de front ferait juger chacun sur un
    // total que les autres n'ont pas encore modifié.
    for (const date of dates) await handleApply(date, state)
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          aria-pressed={vue === 'CALENDRIER'}
          variant={vue === 'CALENDRIER' ? 'primary' : 'secondary'}
          onClick={() => setVue('CALENDRIER')}
        >
          Calendrier
        </Button>
        {/* Sept colonnes tiennent sur un téléphone ; trente et une, non. La
            vue calendrier, elle, reste offerte sur les deux. */}
        {/* Le tableau montre toutes les missions et prestations auxquelles on
            est affecté : son nom le dit, plutôt que de laisser croire à une
            autre présentation de la seule prestation saisie. */}
        <Button
          type="button"
          aria-pressed={vue === 'TABLEAU'}
          variant={vue === 'TABLEAU' ? 'primary' : 'secondary'}
          onClick={() => setVue('TABLEAU')}
          className="hidden md:inline-flex"
        >
          Tableau multi-CRA
        </Button>

        {/* La bascule de portée ne vaut que pour le calendrier : elle n'est
            transmise qu'à lui, et un réglage sans effet visible apprend à
            l'utilisateur que l'interface ment. */}
        {vue === 'CALENDRIER' && (
          <>
            {/* Séparateur tracé par un filet et non par un aplat : un fond de
                jeton doit porter une encre déclarée, ce que ce trait n'a pas. */}
            <span className="mx-2 h-5 w-0 border-l border-rule" aria-hidden="true" />

            {/* Portée de **prestations**, jamais de temps : « Tout le mois »
                annonçait une portée de temps quand la bascule choisit
                d'afficher, ou non, les autres prestations en lecture seule à
                côté de celle qu'on saisit. */}
            <Button
              type="button"
              aria-pressed={!toutLeMois}
              variant={toutLeMois ? 'secondary' : 'primary'}
              onClick={() => setToutLeMois(false)}
            >
              Cette prestation
            </Button>
            <Button
              type="button"
              aria-pressed={toutLeMois}
              variant={toutLeMois ? 'primary' : 'secondary'}
              onClick={() => setToutLeMois(true)}
            >
              Toutes les prestations
            </Button>
          </>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <LineSelector lines={props.lines} lineId={lineId} onChange={setLineId} />

        {ligne !== undefined && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={async () => {
                // Un mois validé n'a rien posé : c'est un refus, pas un
                // avertissement.
                const rapport = await remplirMois({ lineId, month: props.month })
                const texte = formatFillReport(rapport)
                setMessage(rapport.verrouille ? refus(texte) : avertissement(texte))
              }}
            >
              Remplir le CRA
            </Button>
            <Button type="button" onClick={() => setConfirmationVidage(true)}>
              Vider le CRA
            </Button>
          </div>
        )}
      </div>

      {/* C'est destructeur et ça doit se dire. Un panneau en ligne plutôt que
          `window.confirm`, qui bloque le fil et n'existe pas au test. */}
      {confirmationVidage && ligne !== undefined && (
        <div className="mb-3">
          <Banner tone="danger" title={`Vider le CRA de « ${ligne.label} » sur ${props.month} ?`}>
            <p className="mb-2">
              Toutes les saisies de cette prestation sur ce mois seront retirées. Cette action est
              irréversible.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                onClick={async () => {
                  setConfirmationVidage(false)
                  const rapport = await viderMois({ lineId, month: props.month })
                  const texte = formatClearReport(rapport)
                  setMessage(rapport.verrouille ? refus(texte) : avertissement(texte))
                }}
              >
                Confirmer le vidage
              </Button>
              <Button type="button" variant="quiet" onClick={() => setConfirmationVidage(false)}>
                Annuler le vidage
              </Button>
            </div>
          </Banner>
        </div>
      )}

      {message !== null && (
        <div className="mb-3">
          <Banner tone={message.ton}>{message.texte}</Banner>
        </div>
      )}

      {vue === 'CALENDRIER' && ligne !== undefined && (
        <>
          <MonthCalendar
            days={props.days}
            line={ligne}
            slots={props.slots}
            entries={props.entries}
            autresLignes={props.lines.filter((l) => l.id !== ligne.id)}
            toutLeMois={toutLeMois}
            // Le calendrier est la seule surface de saisie sous la largeur
            // `md` : un marquage réservé au tableau n'existerait pas pour un
            // usage au téléphone.
            busyDates={props.busyDates}
            // La frontière entre réalisé et prévisionnel passe exactement là.
            aujourdhui={props.aujourdhui}
            onApply={handleApply}
            onRange={handleRange}
            onFormulaire={(date, etat) => setFormulaire({ date, etat })}
          />
          {formulaire !== null && (
            <CellForm
              date={formulaire.date}
              etat={formulaire.etat}
              line={ligne}
              slots={props.slots}
              onSubmit={async (minutes, slotId) => {
                setFormulaire(null)
                await handleApply(formulaire.date, {
                  kind: 'LIBRE',
                  minutes,
                  slotId,
                  eclatee: false,
                })
              }}
              onDelete={async () => {
                setFormulaire(null)
                await handleApply(formulaire.date, { kind: 'VIDE' })
              }}
              onCancel={() => setFormulaire(null)}
            />
          )}
        </>
      )}

      {vue === 'TABLEAU' && (
        <>
          {/* Ce que le tableau est, dit là où il s'affiche : la bascule de
              portée vient de disparaître, et sans cette phrase l'utilisateur
              n'a plus rien qui explique pourquoi il voit trois lignes. */}
          <p data-testid="nature-tableau" className="mb-2 text-xs text-muted">
            Le tableau montre toutes les missions et prestations auxquelles vous êtes affecté.
          </p>
          <MonthGrid
            days={props.days}
            lines={props.lines}
            entries={props.entries}
            engagementTotals={props.engagementTotals}
            capacityCentiemes={props.capacityCentiemes}
            capacityMode={props.capacityMode}
            busyDates={props.busyDates}
            // Les créneaux réglés en administration : le tableau les propose
            // cellule par cellule, comme le formulaire du calendrier le fait déjà.
            slots={props.slots}
            onSave={handleSave}
          />
        </>
      )}
    </>
  )
}

/**
 * Le refus, dit en français. Les deux vues partagent les mêmes raisons de
 * refus : les formuler deux fois les ferait diverger au premier ajout.
 */
function messageDeRefus(
  r:
    | { ok: false; reason: 'CAPACITE'; totalCentiemes: number; capacityCentiemes: number }
    | { ok: false; reason: 'VERROUILLE' }
    | { ok: false; reason: 'NON_AFFECTE' }
    | { ok: false; reason: 'SAISIE_INVALIDE' },
  date: string,
  quoi: string,
): string {
  if (r.reason === 'CAPACITE') {
    return `${phraseCapacite(date, r.totalCentiemes, r.capacityCentiemes)} La saisie est refusée.`
  }
  if (r.reason === 'VERROUILLE') {
    return `Le CRA de ce mois est validé. Rouvrez-le pour modifier la saisie.`
  }
  if (r.reason === 'NON_AFFECTE') return `Vous n'êtes pas affecté à ${quoi}.`
  return `Saisie invalide.`
}
