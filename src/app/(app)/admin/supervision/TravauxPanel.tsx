import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import {
  IconeAbsence,
  IconeDanger,
  IconeIgnore,
  IconeInfo,
  IconeSucces,
  type Icone,
} from '@/components/ui/icons'
import type { JobView } from '@/services/jobs/scheduler'
import type { Ordonnanceur } from '@/services/supervision'
import { executerTravail, basculerTravail } from './actions'

/** Chaque état porte une icône : la teinte seule ne se perçoit pas de tous. */
const ETATS: Record<string, { libelle: string; tone: Tone; icone: Icone }> = {
  SUCCES: { libelle: 'Succès', tone: 'success', icone: IconeSucces },
  ECHEC: { libelle: 'Échec', tone: 'danger', icone: IconeDanger },
  IGNORE: { libelle: 'Ignoré', tone: 'neutral', icone: IconeIgnore },
  INDISPONIBLE: { libelle: 'Indisponible', tone: 'info', icone: IconeInfo },
  '': { libelle: 'Jamais exécuté', tone: 'neutral', icone: IconeAbsence },
}

function horodatage(date: Date | null): string {
  return date === null ? 'jamais' : date.toISOString().slice(0, 16).replace('T', ' ')
}

export function TravauxPanel({
  travaux,
  ordonnanceur,
}: {
  travaux: JobView[]
  ordonnanceur: Ordonnanceur
}) {
  return (
    <Card title="Travaux">
      {/* Pour qui ces travaux tournent. Les deux rappels s'adressent à
          quelqu'un et passent une fois par compte actif ; le reste appartient
          à l'instance et ne passe qu'une fois. */}
      <p className="mb-3 text-sm text-muted">
        Les rappels de saisie et de clôture tournent <span className="font-medium">une fois
        par compte actif</span>, chacun à son adresse — {ordonnanceur.comptes} compte(s)
        enregistré(s). Les autres travaux appartiennent à l’installation et s’exécutent une
        seule fois, sous le compte{' '}
        <span className="font-medium">{ordonnanceur.proprietaireLabel}</span>, le plus ancien.
      </p>

      <DataTable caption="État des traitements récurrents">
        <thead>
          <tr>
            <th scope="col" className="p-2 text-left">Travail</th>
            <th scope="col" className="p-2 text-left">Récurrence</th>
            <th scope="col" className="p-2 text-left">Dernière</th>
            <th scope="col" className="p-2 text-left">Prochaine</th>
            <th scope="col" className="p-2 text-left">État</th>
            <th scope="col" className="p-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {travaux.map((travail) => {
            const etat = ETATS[travail.lastState] ?? ETATS['']!
            return (
              <tr key={travail.name} className="border-t border-rule align-top">
                <td className="p-2">
                  {travail.label}
                  {travail.lastError !== '' && (
                    <p className="text-xs text-danger-ink">{travail.lastError}</p>
                  )}
                </td>
                <td className="p-2">{travail.intervalMinutes} min</td>
                <td className="p-2">{horodatage(travail.lastRunAt)}</td>
                <td className="p-2">
                  {travail.disponible && travail.enabled ? horodatage(travail.nextRunAt) : '—'}
                </td>
                <td className="p-2">
                  <Badge tone={etat.tone} icone={etat.icone}>{etat.libelle}</Badge>
                  {/* Le verrou pris, en toutes lettres : la prise n'est pas
                      atomique, et deux déclenchements simultanés exécuteraient
                      le même travail deux fois. */}
                  {travail.enCoursDepuis !== null && (
                    <p className="text-xs text-warning-ink">
                      En cours depuis {horodatage(travail.enCoursDepuis)}
                    </p>
                  )}
                </td>
                <td className="p-2">
                  {travail.disponible ? (
                    <div className="flex gap-2">
                      <form action={executerTravail}>
                        <input type="hidden" name="name" value={travail.name} />
                        <Button type="submit" variant="secondary">Exécuter</Button>
                      </form>
                      <form action={basculerTravail}>
                        <input type="hidden" name="name" value={travail.name} />
                        <input type="hidden" name="enabled" value={travail.enabled ? '0' : '1'} />
                        <Button type="submit" variant="quiet">
                          {travail.enabled ? 'Désactiver' : 'Activer'}
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Livré par un lot ultérieur</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
    </Card>
  )
}
