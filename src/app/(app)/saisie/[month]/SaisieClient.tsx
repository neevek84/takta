'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { MonthCalendar } from '@/components/calendar/MonthCalendar'
import { EngagementBar } from '@/components/grid/EngagementBar'
import { CellForm } from '@/components/calendar/CellForm'
import { LineSelector } from '@/components/calendar/LineSelector'
import { monthLabel } from '@/components/MonthNav'
import { readSelection } from '@/components/calendar/selection-storage'
import { resolveSelection } from '@/core/saisie/selection'
import { formatClearReport, formatFillReport } from '@/core/saisie/report'
import { phraseOccupation } from '@/core/saisie/occupation'
import { phraseCreneauNonPrevu } from '@/core/saisie/slot-labels'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import type { CellState } from '@/core/saisie/cycle'
import type { Vue } from '@/core/saisie/vue'
import type { MonthDay } from '@/core/month/build'
import type { Slot } from '@/core/time/slots'
import type { CapacityMode } from '@/core/types'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'
import type { ChoixPrevisionnel } from '@/services/cra-generation'
import {
  appliquerCase,
  compterPrevisionnelDeLaLigne,
  genererCraAction,
  remplirMois,
  saveCell,
  viderMois,
} from './actions'
import { BoutonAgenda } from './BoutonAgenda'
import { PanneauGeneration } from './PanneauGeneration'

/**
 * Les bornes `du`/`au` (incluses) du mois affiché, telles que `props.days`
 * les porte déjà — `days[0]` est le premier jour du mois, le dernier élément
 * le dernier. Aucun calcul de calendrier à refaire ici.
 */
function bornesAffichees(days: MonthDay[]): { du: string; au: string } {
  return { du: days[0]?.date ?? '', au: days[days.length - 1]?.date ?? '' }
}

/**
 * Les bornes de la vue 3 mois : le premier jour du premier mois affiché, le
 * dernier jour du troisième. `bornesAffichees` ne porte qu'un seul mois — la
 * vue 3 mois vérifie l'agenda sur les trois grilles à la fois, jamais sur la
 * seule première.
 */
function bornesTroisMois(joursParMois: MonthDay[][]): { du: string; au: string } {
  const premier = joursParMois[0] ?? []
  const dernier = joursParMois[joursParMois.length - 1] ?? []
  return { du: premier[0]?.date ?? '', au: dernier[dernier.length - 1]?.date ?? '' }
}

/**
 * Constante de module et non littéral au point d'appel : un `[]` écrit dans le
 * JSX serait un tableau neuf à chaque rendu.
 */
const AUCUN_TOTAL: LineEngagementTotals = []

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

/**
 * Ce qui s'écrit dans le bandeau, et sur quel ton.
 *
 * `craId`, quand il est porté, fait apparaître un lien vers `/cra/<id>` à la
 * suite du texte — c'est ce que la génération du CRA utilise pour tenir la
 * promesse de la spec (§4 et §5) : le message annonce le sort de la
 * génération, le lien mène à ce qu'elle a produit ou à ce qui bloquait déjà.
 */
type Message = { texte: string; ton: 'info' | 'warning' | 'danger'; craId?: string }

function avertissement(texte: string, craId?: string): Message {
  return { texte, ton: 'warning', craId }
}

/**
 * Une occupation d'agenda n'est ni un refus ni un avertissement : rien n'est
 * en cause dans la saisie, on signale seulement que la journée porte déjà
 * autre chose. La tonalité `info` en fait un `role="status"`, annoncé au
 * moment opportun plutôt qu'en interrompant la frappe.
 */
function information(texte: string, craId?: string): Message {
  return { texte, ton: 'info', craId }
}

/** Un refus n'est pas un avertissement : rien n'a été enregistré. */
function refus(texte: string, craId?: string): Message {
  return { texte, ton: 'danger', craId }
}

/**
 * Trois vues : le calendrier — la seule surface de saisie mobile —, le
 * tableau multi-CRA, et la vue 3 mois : le mois choisi et les deux suivants,
 * en grilles compactes côte à côte (voir le rendu plus bas).
 *
 * Le type vit dans `core/saisie/vue.ts` — et non ici — parce que la
 * préférence de profil (`services/saisie/vue-par-defaut.ts`) doit reconnaître
 * exactement les mêmes valeurs sans dépendre d'un composant client.
 */
export type { Vue }

/**
 * La largeur de la dernière vérification d'agenda réussie, `null` avant tout
 * clic. `'1MOIS'` sert au calendrier et au tableau, qui n'affichent jamais que
 * le mois courant ; `'3MOIS'` sert à la vue 3 mois, vérifiée sur ses trois
 * mois à la fois — jamais sur le seul premier.
 */
export type PlageVerifiee = '1MOIS' | '3MOIS' | null

/**
 * Le résultat d'une vérification d'agenda porte la plage qu'il couvre : passer
 * du calendrier à la vue 3 mois doit effacer le résultat quand cette plage ne
 * couvrait qu'un mois — laisser des mois non vérifiés sans marqueur les
 * ferait croire libres. L'inverse (revenir à une vue plus étroite ou égale)
 * le conserve, puisque la plage vérifiée continue de couvrir ce qu'on montre.
 *
 * Fonction pure, indépendante de tout état de composant : testable seule,
 * avant même que la vue 3 mois n'ait de bouton pour l'atteindre.
 */
export function doitEffacerOccupations(prochaine: Vue, plageVerifiee: PlageVerifiee): boolean {
  return prochaine === 'TROIS_MOIS' && plageVerifiee !== '3MOIS'
}

export function SaisieClient(props: {
  month: string
  days: MonthDay[]
  /**
   * les trois mois de la vue 3 mois : `month`, `month + 1`, `month + 2`.
   *
   * Construits par la page avec `shiftMonth` — jamais recalculés ici, un
   * calcul de calendrier réécrit à deux endroits finit par diverger.
   */
  mois: string[]
  /** les jours de chacun des trois mois ci-dessus, dans le même ordre. */
  joursParMois: MonthDay[][]
  lines: LineForGrid[]
  entries: MonthEntry[]
  engagementTotals: Record<string, LineEngagementTotals>
  capacityCentiemes: number
  capacityMode: CapacityMode
  slots: Slot[]
  /**
   * bornes de la journée de travail, minutes depuis minuit.
   *
   * Elles ne servent qu'à **pré-remplir** le formulaire d'une case vide : les
   * heures d'une saisie sont figées à son écriture, et rien ici ne les
   * recalcule pour une saisie existante.
   */
  journeeDebutMinute: number
  journeeFinMinute: number
  /**
   * jours déjà occupés dans l'agenda externe, connus au premier rendu.
   *
   * La prop reste : elle sert aux tests à ensemencer des occupations. La
   * page, elle, ne la passe plus — l'agenda ne se lit qu'au clic sur
   * `BoutonAgenda`, jamais au chargement (voir `page.tsx`). C'est la graine
   * de l'état `occupations`, pas la valeur affichée : voir plus bas.
   */
  busyDates?: string[]
  /**
   * Un connecteur d'agenda est-il configuré ? Une lecture locale, faite par
   * la page, sans réseau. `BoutonAgenda` s'efface quand elle est fausse : un
   * bouton qui échouerait à tous les coups n'apprendrait rien à personne.
   */
  agendaConnecte?: boolean
  /**
   * le jour courant, 'YYYY-MM-DD'.
   *
   * Calculé par la page — qui le calcule déjà pour le prévisionnel échu — et
   * non lu ici à l'horloge du navigateur : le rendu serveur et le rendu client
   * doivent tomber d'accord.
   */
  aujourdhui?: string
  /**
   * La vue résolue par la page depuis l'adresse.
   *
   * Elle arrive d'en haut et non d'un `useState` nu : chaque mois est une
   * route à part, et l'état d'un composant ne survit pas à la navigation.
   * Travailler en tableau multi-CRA et retomber en calendrier au mois suivant,
   * c'est ce qui arrivait.
   */
  vueInitiale?: Vue
}) {
  const [message, setMessage] = useState<Message | null>(null)
  const [vue, setVue] = useState<Vue>(props.vueInitiale ?? 'CALENDRIER')

  /**
   * Vrai à partir de `md` (48rem) — même seuil que `RAIL_MEDIA` dans
   * `NavRail`. Faux par défaut, comme au premier rendu serveur : la vue 3
   * mois et le tableau, réservés au poste, ne doivent pas apparaître dans la
   * liste avant que le client n'ait pu lire la largeur réelle de l'écran.
   */
  const [ecranLarge, setEcranLarge] = useState(false)
  useEffect(() => {
    setEcranLarge(window.matchMedia('(min-width: 48rem)').matches)
  }, [])

  /**
   * Les jours occupés, tels que `BoutonAgenda` les a rapportés — ou tels que
   * les tests les ont ensemencés via `props.busyDates`. Purement local : ni
   * cache serveur, ni persistance. Le résultat d'un clic **remplace** cette
   * liste, il ne s'y ajoute pas.
   */
  const [occupations, setOccupations] = useState<string[]>(props.busyDates ?? [])
  // Voir `PlageVerifiee` : `'1MOIS'` est la seule valeur que ce lot produit.
  const [plageVerifiee, setPlageVerifiee] = useState<PlageVerifiee>(null)

  /**
   * Choisir une vue, et l'inscrire dans l'adresse.
   *
   * **Par l'API d'historique du navigateur, pas par le routeur.** Un
   * `router.replace` refait le rendu serveur de la page : il rejouerait toutes
   * ses lectures à chaque bascule, pour un changement qui est entièrement
   * local. Next tient `useSearchParams` à jour après un `replaceState` natif,
   * et c'est ce dont `MonthNav` a besoin pour reporter le choix sur les mois
   * voisins.
   *
   * Le calendrier ne laisse rien derrière lui : c'est le défaut, et un
   * paramètre qui ne dit rien de plus que son absence encombrerait tous les
   * liens.
   */
  function choisirVue(prochaine: Vue): void {
    setVue(prochaine)
    // `occupations` ET `plageVerifiee` tombent ensemble : laisser la seconde
    // décrire une plage qu'on ne montre plus ferait tenir au bouton un
    // verdict ("2 jours occupés…") que plus rien n'a vérifié pour la
    // nouvelle portée.
    if (doitEffacerOccupations(prochaine, plageVerifiee)) {
      setOccupations([])
      setPlageVerifiee(null)
    }
    const parametres = new URLSearchParams(window.location.search)
    if (prochaine === 'TABLEAU') parametres.set('vue', 'tableau')
    else if (prochaine === 'TROIS_MOIS') parametres.set('vue', '3mois')
    else parametres.delete('vue')
    const requete = parametres.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${requete === '' ? '' : `?${requete}`}`,
    )
  }
  const [toutLeMois, setToutLeMois] = useState(false)
  const [confirmationVidage, setConfirmationVidage] = useState(false)
  const [formulaire, setFormulaire] = useState<{ date: string; etat: CellState } | null>(null)
  /**
   * Ce que le panneau de génération montre, `null` tant qu'aucune génération
   * n'est en cours. Le compte vient du clic, jamais du rendu — voir
   * `compterPrevisionnelDeLaLigne`.
   *
   * **`lineId` et `missionLabel` sont figés ici, pas relus depuis `ligne`.**
   * `LineSelector` reste actif tant que le panneau est ouvert : sans ce gel,
   * changer de prestation pendant que le panneau affiche « 7 jours … sur la
   * mission A » ferait basculer le libellé sur la mission B tout en gardant
   * le chiffre de A à l'écran — puis générerait bel et bien pour B au clic. Un
   * choix pris sur un nombre que l'utilisateur n'a jamais vu, exactement ce
   * que ce panneau existe pour empêcher.
   */
  const [generation, setGeneration] = useState<{
    lineId: string
    missionLabel: string
    previsionnel: number
  } | null>(null)

  // La sélection mémorisée ne peut être lue qu'après le montage : la lire dans
  // l'initialiseur ferait diverger le rendu serveur du rendu client.
  const [lineId, setLineId] = useState(() => resolveSelection(props.lines, null)?.lineId ?? '')
  useEffect(() => {
    const memorise = resolveSelection(props.lines, readSelection())?.lineId
    if (memorise !== undefined) setLineId(memorise)
  }, [props.lines])

  const ligne = props.lines.find((l) => l.id === lineId)

  // La plage que `BoutonAgenda` vérifie : le mois affiché en calendrier et en
  // tableau, les trois mois en vue 3 mois — jamais recalculée, `props.days` et
  // `props.joursParMois` la portent déjà.
  const { du, au } =
    vue === 'TROIS_MOIS' ? bornesTroisMois(props.joursParMois) : bornesAffichees(props.days)

  /**
   * Le signalement d'occupation, quand il n'y a rien de plus important à dire.
   *
   * Il vient en dernier : un dépassement de capacité et un créneau non
   * autorisé parlent de la saisie elle-même, l'occupation ne parle que de son
   * contexte. Aucun des trois ne bloque quoi que ce soit.
   */
  function messageDOccupation(date: string): Message | null {
    return occupations.includes(date) ? information(phraseOccupation(date)) : null
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

  /**
   * Génère le CRA du mois, une fois le sort du prévisionnel réglé — par le
   * panneau, ou d'office quand il n'y avait rien à trancher.
   *
   * `lineIdCible` est un paramètre explicite, jamais relu depuis `lineId` : ce
   * dernier peut avoir changé sous le panneau pendant que l'utilisateur
   * regardait la question posée pour une autre prestation. La générer pour la
   * prestation courante au lieu de celle affichée traiterait un prévisionnel
   * que personne n'a vu.
   *
   * **L'écran reste sur la Saisie.** Rediriger vers le suivi arracherait
   * l'utilisateur à un mois qu'il n'a pas fini de regarder ; le compte rendu
   * s'écrit dans le bandeau existant, avec le renvoi vers le suivi pour qui
   * veut voir le document.
   */
  async function lancerGeneration(lineIdCible: string, choix: ChoixPrevisionnel): Promise<void> {
    setGeneration(null)
    const r = await genererCraAction({ lineId: lineIdCible, month: props.month, previsionnel: choix })

    if (!r.ok) {
      // MOIS_VALIDE n'a rien posé : c'est un refus, pas un avertissement.
      // Il porte `craId` : le CRA existant, déjà validé, reste à un clic —
      // la spec (§5) demande explicitement ce lien sur ce refus-là.
      setMessage(
        r.raison === 'MOIS_VALIDE'
          ? refus(
              `Le CRA de ce mois est déjà validé. Rouvrez-le depuis le suivi pour le regénérer.`,
              r.craId,
            )
          : refus(`Vous n'êtes pas affecté à cette prestation.`),
      )
      return
    }
    setMessage(information(`CRA généré. Retrouvez-le dans le suivi.`, r.craId))
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Select
          label="Vue"
          value={vue}
          onChange={(ev) => choisirVue(ev.target.value as Vue)}
          className="w-auto"
        >
          <option value="CALENDRIER">Calendrier</option>
          {/* Vingt et une colonnes ne tiennent pas sur un téléphone — trois
              grilles de sept, réduites en densité compacte. Sept colonnes
              tiennent en tableau ; trente et une, non. Le calendrier reste
              la seule surface de saisie mobile ; ces deux vues ne s'atteignent
              qu'au poste — retirées de la liste plutôt que grisées, une
              option qu'on ne peut pas choisir n'apprend rien qu'un menu plus
              court n'apprenne aussi bien. */}
          {ecranLarge && <option value="TROIS_MOIS">3 mois</option>}
          {/* Le tableau montre toutes les missions et prestations auxquelles
              on est affecté : son nom le dit, plutôt que de laisser croire à
              une autre présentation de la seule prestation saisie. */}
          {ecranLarge && <option value="TABLEAU">Tableau multi-CRA</option>}
        </Select>

        {/* La bascule de portée ne vaut que pour le calendrier et la vue 3
            mois : au tableau, elle n'aurait aucun effet, et un réglage sans
            effet visible apprend à l'utilisateur que l'interface ment. */}
        {(vue === 'CALENDRIER' || vue === 'TROIS_MOIS') && (
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

        {/* Un clic, un appel, sur exactement la plage affichée ici — jamais
            au chargement (voir `page.tsx`). Absent quand aucun connecteur
            n'est configuré : un bouton qui échouerait à tous les coups
            n'apprendrait rien à personne. Au même niveau que la vue et non
            plus sur sa propre ligne : les deux réglages de cette barre
            portent sur ce qu'on regarde, une ligne à part n'annonçait rien
            de plus qu'un retour à la ligne. */}
        {props.agendaConnecte === true && (
          // `key` force un remontage — donc une remise à zéro de l'état
          // interne du bouton (`etat: 'INACTIF'`) — chaque fois que la plage
          // vérifiée change. `BoutonAgenda` reste monté au même endroit de
          // l'arbre à travers une bascule de vue : sans cette clé, son
          // verdict ("n jours occupés…") survivrait à un changement de plage
          // qu'il n'a jamais vérifiée.
          <BoutonAgenda
            key={`${du}-${au}`}
            du={du}
            au={au}
            onResultat={(jours) => {
              setOccupations(jours)
              setPlageVerifiee(vue === 'TROIS_MOIS' ? '3MOIS' : '1MOIS')
            }}
          />
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
            <Button
              type="button"
              onClick={async () => {
                // Figés dès le clic : `lineId` peut changer pendant l'attente
                // du compte (sélecteur de prestation toujours actif), et le
                // panneau — s'il s'ouvre — doit rester celui de la
                // prestation pour laquelle la question a été posée.
                const lineIdVise = lineId
                const missionLabelVise = `${ligne.clientName} · ${ligne.missionLabel}`
                const previsionnel = await compterPrevisionnelDeLaLigne({
                  lineId: lineIdVise,
                  month: props.month,
                })
                // Rien à trancher : on génère sans poser de question — une
                // question sur zéro jour apprendrait à cliquer sans lire.
                if (previsionnel === 0) await lancerGeneration(lineIdVise, 'SUPPRIMER')
                else setGeneration({ lineId: lineIdVise, missionLabel: missionLabelVise, previsionnel })
              }}
            >
              Générer le CRA
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

      {/* `missionLabel` et le `lineId` visé viennent de `generation`, figés au
          clic — jamais de `ligne` / `lineId`, qui suivent le sélecteur resté
          actif sous le panneau. Un choix doit porter sur ce que l'écran a
          montré, pas sur ce que le sélecteur affiche au moment du clic. */}
      {generation !== null && (
        <PanneauGeneration
          month={props.month}
          missionLabel={generation.missionLabel}
          previsionnel={generation.previsionnel}
          onChoix={(choix) => {
            void lancerGeneration(generation.lineId, choix)
          }}
          onAnnuler={() => setGeneration(null)}
        />
      )}

      {message !== null && (
        <div className="mb-3">
          <Banner tone={message.ton}>
            {message.texte}
            {message.craId !== undefined && (
              <>
                {' '}
                <Link href={`/cra/${message.craId}`} className="text-link underline">
                  Ouvrir le CRA
                </Link>
              </>
            )}
          </Banner>
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
            busyDates={occupations}
            // La frontière entre réalisé et prévisionnel passe exactement là.
            aujourdhui={props.aujourdhui}
            onApply={handleApply}
            onRange={handleRange}
            onFormulaire={(date, etat) => setFormulaire({ date, etat })}
          />
          {/* La réglette du mois : à la largeur de la grille, sous elle, en
              permanence. Le calendrier n'affichait aucun total — on saisissait
              douze jours sans jamais voir combien —, et l'engagement ne vivait
              que dans la vue tableau. Elle ne montre que la ligne affichée :
              empiler celui des autres dirait des chiffres qui ne concernent
              pas ce qu'on regarde. */}
          <div className="mt-3">
            <EngagementBar
              line={ligne}
              totals={props.engagementTotals[ligne.id] ?? AUCUN_TOTAL}
              pleineLargeur
            />
          </div>
        </>
      )}

      {/* Le mois choisi et les deux suivants (`shiftMonth`), trois grilles
          `MonthCalendar` en densité compacte plutôt que trois vues distinctes :
          diverger au premier correctif dessinerait deux fois le même fait de
          deux façons (voir la documentation de `densite`). Chaque grille garde
          exactement la cinématique du calendrier — même `onApply`, même
          `onRange`, même formulaire, même bascule de portée — c'est une
          surface de saisie, pas un aperçu à trois volets. */}
      {vue === 'TROIS_MOIS' && ligne !== undefined && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {props.mois.map((m, i) => (
              <section key={m}>
                <h2 className="mb-1 text-sm font-medium">{monthLabel(m)}</h2>
                <MonthCalendar
                  densite="COMPACTE"
                  days={props.joursParMois[i]!}
                  line={ligne}
                  slots={props.slots}
                  entries={props.entries}
                  autresLignes={props.lines.filter((l) => l.id !== ligne.id)}
                  toutLeMois={toutLeMois}
                  busyDates={occupations}
                  aujourdhui={props.aujourdhui}
                  onApply={handleApply}
                  onRange={handleRange}
                  onFormulaire={(date, etat) => setFormulaire({ date, etat })}
                />
              </section>
            ))}
          </div>
          {/* L'engagement se lit sur toute la durée de la ligne, pas sur un
              mois affiché : une seule réglette, sous l'ensemble des trois
              grilles. L'empiler trois fois dirait trois fois le même chiffre. */}
          <div className="mt-3">
            <EngagementBar
              line={ligne}
              totals={props.engagementTotals[ligne.id] ?? AUCUN_TOTAL}
              pleineLargeur
            />
          </div>
        </>
      )}

      {/* Le formulaire de case : le même geste, qu'il soit ouvert depuis le
          calendrier ou depuis l'une des trois grilles de la vue 3 mois — le
          rendre deux fois répéterait la même boîte pour la même raison. */}
      {(vue === 'CALENDRIER' || vue === 'TROIS_MOIS') && ligne !== undefined && formulaire !== null && (
        <CellForm
          date={formulaire.date}
          etat={formulaire.etat}
          line={ligne}
          slots={props.slots}
          // La plage journée pré-remplit les deux heures d'une case vide, et
          // les créneaux nommés celles d'un créneau choisi. Aucune n'est
          // imposée : ce sont des pré-remplissages, pas des règles.
          journeeDebutMinute={props.journeeDebutMinute}
          journeeFinMinute={props.journeeFinMinute}
          onSubmit={async (minutes, slotId, startMinute, endMinute) => {
            setFormulaire(null)
            await handleApply(formulaire.date, {
              kind: 'LIBRE',
              minutes,
              slotId,
              startMinute,
              endMinute,
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
            busyDates={occupations}
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
    | { ok: false; reason: 'CHEVAUCHEMENT'; startMinute: number }
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
  // Depuis le lot 1f, une saisie est identifiée par son heure de début : deux
  // blocs partis à la même minute se superposeraient dans l'agenda. On dit
  // laquelle, plutôt que « saisie invalide ».
  if (r.reason === 'CHEVAUCHEMENT') {
    return `Une autre saisie de ${quoi} commence déjà à ${heure(r.startMinute)} le ${date}. Modifiez-la, ou décalez celle-ci.`
  }
  return `Saisie invalide.`
}

/** Minutes depuis minuit → « 9 h 00 », comme un humain les lit. */
function heure(minutes: number): string {
  const borne = ((minutes % 1440) + 1440) % 1440
  return `${Math.floor(borne / 60)} h ${String(borne % 60).padStart(2, '0')}`
}
