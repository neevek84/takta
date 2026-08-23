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
import { Banner } from '@/components/ui/Banner'

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

/**
 * L'échéance d'un travail, ou ce qu'elle veut dire quand il n'y en a pas.
 *
 * **`new Date(0)` est un marqueur, pas une date.** `syncJobDefinitions` le
 * pose à la création d'un travail — « dû au premier réveil » — et c'est ce qui
 * rend le réveil observable et reproductible. Affiché tel quel, l'écran donne
 * à lire une échéance de 1970 : le porteur l'a pris pour un défaut, et il
 * avait raison. Un écran qui affiche 1970 ne dit rien de vrai.
 */
function echeance(date: Date): string {
  return date.getTime() === 0 ? 'dès le prochain réveil' : horodatage(date)
}

export function TravauxPanel({
  travaux,
  ordonnanceur,
}: {
  travaux: JobView[]
  ordonnanceur: Ordonnanceur
}) {
  // Un travail activé qui n'a jamais tourné, et pas un seul qui ait tourné :
  // c'est la signature d'un réveil qui n'existe pas, et non d'un travail qui
  // attend son échéance.
  const jamaisReveille =
    travaux.some((t) => t.enabled) && travaux.every((t) => t.lastRunAt === null)

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

      {/* **L'horloge est interne, et c'est un revirement.** L'ordonnanceur
          attendait un declencheur exterieur ; le porteur a tranche le 23 aout
          2026 — l'API existe pour que d'autres outils viennent parler a
          l'application, pas pour qu'elle se fasse marcher elle-meme.

          Ce bandeau ne dit donc plus « posez un cron » : il dit qu'un reveil
          aurait deja du avoir lieu, et ou regarder. Il se tait des qu'un
          travail a tourne, et quand aucun n'est active — autrement il
          crierait au loup, et on cesserait de lire les bandeaux de cet
          ecran. */}
      {jamaisReveille && (
        <div className="mb-3">
          <Banner tone="warning" title="Aucun réveil n’a encore eu lieu">
            <p className="text-sm">
              L’ordonnanceur se réveille tout seul toutes les cinq minutes, dès le démarrage du
              serveur. Si cette ligne persiste au-delà, c’est que le réveil ne se fait pas :
              regardez les journaux du serveur, l’entrée <code>horloge</code>. Tant qu’il ne tourne
              pas, aucun rappel ne part et la file de sortie ne se vide pas d’elle-même.
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
                  {travail.disponible && travail.enabled ? echeance(travail.nextRunAt) : '—'}
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
