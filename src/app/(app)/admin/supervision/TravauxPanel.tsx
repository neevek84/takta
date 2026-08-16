import { Badge, type Tone } from '@/components/ui/Badge'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import type { JobView } from '@/services/jobs/scheduler'
import type { Ordonnanceur } from '@/services/supervision'
import { executerTravail, basculerTravail } from './actions'

/** Chaque état porte un glyphe : la teinte seule ne se perçoit pas de tous. */
const ETATS: Record<string, { libelle: string; tone: Tone; glyph: string }> = {
  SUCCES: { libelle: 'Succès', tone: 'success', glyph: '✓' },
  ECHEC: { libelle: 'Échec', tone: 'danger', glyph: '✕' },
  IGNORE: { libelle: 'Ignoré', tone: 'neutral', glyph: '·' },
  INDISPONIBLE: { libelle: 'Indisponible', tone: 'info', glyph: 'ℹ' },
  '': { libelle: 'Jamais exécuté', tone: 'neutral', glyph: '–' },
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
      {/* Pour qui ces travaux tournent. Le réveil externe n'a pas de session :
          il sert le compte le plus ancien de l'instance, et lui seul. */}
      <p className="mb-3 text-sm text-muted">
        Les réveils externes exécutent ces travaux pour le compte{' '}
        <span className="font-medium">{ordonnanceur.proprietaireLabel}</span> — le plus
        ancien de l’installation. {ordonnanceur.comptes} compte(s) enregistré(s).
      </p>

      {ordonnanceur.autreCompte && (
        <div className="mb-3">
          <Banner tone="warning" title="Ces travaux ne travaillent pas pour vous">
            <p className="text-sm">
              Les rappels de saisie et de clôture partent pour le compte{' '}
              {ordonnanceur.proprietaireLabel}. Vous ne recevrez aucun rappel tant que
              l’ordonnanceur servira un seul compte. Les exécutions lancées depuis ce bouton,
              elles, portent bien votre compte.
            </p>
          </Banner>
        </div>
      )}

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
                  <Badge tone={etat.tone} glyph={etat.glyph}>{etat.libelle}</Badge>
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
