import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import type { SetupProposal } from '@/services/dolibarr/setup'
import { reprendreReglages } from './actions'

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/** « 4 » ne dit pas avril : le numéro seul oblige à compter sur ses doigts. */
function nomDuMois(mois: number): string {
  return MOIS[mois - 1] ?? String(mois)
}

/** 420 → « 7 h », 450 → « 7,5 h ». */
function heures(minutes: number): string {
  return `${String(minutes / 60).replace('.', ',')} h`
}

/** 114 centièmes → « 1,14 jour », tel que Dolibarr l'affichera. */
function jours(centiemes: number): string {
  return `${(centiemes / 100).toFixed(2).replace('.', ',')} jour`
}

/**
 * Propose de reprendre les réglages de l'instance Dolibarr — et dit, à
 * l'endroit exact où on les change, ce que la reprise déplace.
 *
 * **Ce qu'elle ne déplace jamais : un CRA déjà validé.** Chaque saisie porte sa
 * durée de journée figée à l'écriture ; le réétalonnage proposé ici ne touche
 * que les mois ouverts, et l'écran n'offre pas l'option pour les mois validés
 * plutôt que de la refuser après coup.
 *
 * **Ce que la durée de journée change vraiment.** Les temps partent chez
 * Dolibarr en secondes : huit heures valent 28 800 secondes des deux côtés,
 * quelle que soit la valeur de `TIMESHEET_DAY_DURATION`. Ce que le réglage
 * change est l'affichage jour/heure de Dolibarr, et les objectifs à venir
 * d'ici. C'est un écart de convention à aligner, jamais un temps à compenser —
 * compenser serait le seul moyen de fausser réellement les temps.
 */
export function RepriseReglages({ preview }: { preview: SetupProposal }) {
  const exercice = preview.debutExerciceMois
  const journee = preview.minutesParJour
  const { concernees, verrouillees } = preview.reetalonnage

  const journeeDivergente = journee.divergent && journee.dolibarr !== null

  if (!exercice.divergent && !journeeDivergente) {
    return (
      <Card title="Réglages repris de Dolibarr" className="mt-6">
        <p className="text-sm text-muted">
          Les réglages de l’application correspondent déjà à ceux de l’instance Dolibarr : il n’y a
          rien à reprendre.
        </p>
      </Card>
    )
  }

  const noteVerrouillees =
    `${verrouillees} saisie(s) appartiennent à un CRA validé : elles ne sont jamais réétalonnées` +
    (concernees === 0 ? ', l’option n’est donc pas proposée.' : '.')

  return (
    <Card title="Réglages repris de Dolibarr" className="mt-6">
      <p className="mb-3 text-sm text-muted">
        Rien n’est repris sans être coché ici. Chaque reprise indique ce qu’elle déplace avant
        d’être appliquée.
      </p>

      <form action={reprendreReglages} className="flex flex-col gap-4">
        {exercice.divergent && exercice.dolibarr !== null && (
          <div className="flex flex-col gap-2">
            <Checkbox
              name="reprendreExercice"
              label={`Reprendre le mois de début d’exercice de Dolibarr : ${nomDuMois(exercice.dolibarr)} (actuellement ${nomDuMois(exercice.local)})`}
            />
            {preview.exerciceApresReprise !== null && (
              <Banner tone="warning" title="Cela déplace les bornes de votre objectif de chiffre d’affaires">
                <p>
                  {`Votre objectif de chiffre d’affaires sera désormais calculé sur ${preview.exerciceApresReprise.label}, du ${preview.exerciceApresReprise.debut} au ${preview.exerciceApresReprise.fin}.`}
                </p>
              </Banner>
            )}
          </div>
        )}

        {journeeDivergente && (
          <div className="flex flex-col gap-2">
            <Checkbox
              name="reprendreDureeJournee"
              label={`Aligner la durée d’une journée sur Dolibarr : ${heures(journee.dolibarr!)} (actuellement ${heures(journee.local)})`}
            />
            <Banner tone="warning" title="Cela change vos objectifs et l’affichage à venir">
              <p>
                Les CRA déjà validés ne sont jamais recalculés : chaque saisie garde la durée de
                journée figée au moment où elle a été écrite.
              </p>
              {journee.centiemesAffichesParDolibarr !== null && (
                <p>
                  {`Sans alignement, une journée pleine saisie ici s’affiche « ${jours(journee.centiemesAffichesParDolibarr)} » dans Dolibarr, qui convertit en jours les secondes reçues avec sa propre durée de journée. Les temps poussés restent identiques des deux côtés : ils voyagent en secondes.`}
                </p>
              )}
            </Banner>
          </div>
        )}

        {journeeDivergente && concernees > 0 && (
          <Checkbox
            name="reetalonner"
            label={`Réétalonner ${concernees} saisie(s) des mois ouverts sur la nouvelle durée`}
          />
        )}

        {verrouillees > 0 && <p className="text-sm text-muted">{noteVerrouillees}</p>}

        <div>
          <Button type="submit" variant="primary">
            Appliquer la reprise
          </Button>
        </div>
      </form>
    </Card>
  )
}
