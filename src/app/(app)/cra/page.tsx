import { requireUser } from '@/auth'
import { listCrasSuivi, listCrasEnSouffrance, type CraView } from '@/services/cra'
import { listMissionsForUser } from '@/services/missions'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { ETATS_SUIVI } from '@/core/cra/etat-suivi'
import { SignatureCard } from '@/components/cra/SignatureCard'
import { StatusBadge } from '@/components/cra/StatusBadge'
import { Origine } from '@/components/ui/Origine'
import { formatJours, libelleMois } from '@/core/cra/document'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PageShell } from '@/components/ui/PageShell'
import { Select } from '@/components/ui/Select'
import { lancerRelances, openCra } from './actions'
// Les quatre actions de signature/transition/suivi vivent désormais à côté de
// la page de détail — c'est là qu'elles redirigent. La carte de cette liste
// les invoque encore le temps que la tâche 6 la remplace par un tableau.
import {
  envoyerPourSignature,
  moveCra,
  rafraichirSignature,
  saveTracking,
} from './[craId]/actions'

const LABELS: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
}

const ALL: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR']

export default async function CraPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requireUser()
  const { month: raw } = await searchParams
  const month = raw ?? new Date().toISOString().slice(0, 7)

  // La carte de cette liste reprend encore un unique mois : c'est la tâche 6
  // qui la réécrit en tableau multi-périodes filtrable. En attendant, tous les
  // états sont demandés pour reproduire le comportement de l'ancien
  // `listCras` — aucune ligne du mois ne doit disparaître ici.
  const cras = await listCrasSuivi(user.id, { etats: [...ETATS_SUIVI], month })
  const missions = await listMissionsForUser(user.id)
  const souffrance = await listCrasEnSouffrance(user.id)

  return (
    <PageShell title={`CRA · ${month}`}>
      <form action={openCra} className="mb-8 flex flex-wrap items-end gap-2">
        <input type="hidden" name="month" value={month} />
        <Select label="Mission" name="missionId" required>
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.clientName} · {m.label}
            </option>
          ))}
        </Select>
        <Button variant="primary">Ouvrir un CRA</Button>
      </form>

      {cras.map((cra) => (
        <Card key={cra.id} className="mb-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-lg">
              {cra.clientName} · {cra.missionLabel}
            </h2>
            {/* La période, sur la carte et pas seulement en tête de page : deux
                missions aux noms voisins et un mois implicite, et l'on ne sait
                plus quel CRA on vient d'engendrer. */}
            <span className="text-sm text-muted">{libelleMois(cra.month)}</span>
            <StatusBadge status={cra.status} />
            <Origine
              dansDolibarr={cra.iraDansDolibarr}
              detail={
                cra.iraDansDolibarr
                  ? 'les temps de ce CRA partiront à la validation'
                  : 'aucun projet Dolibarr sur cette mission : la validation n’enverra rien'
              }
            />
          </div>

          {/* Dit **avant** la validation. Un CRA validé sans correspondance ne
              met rien en file : rien n'arrive chez le client, l'écran de
              synchronisation reste muet, et on ne s'en aperçoit qu'à la facture
              manquante. */}
          {!cra.iraDansDolibarr && cra.status !== 'VALIDE' && (
            <div className="mb-4">
              <Banner tone="warning" title="Ce CRA n’ira pas dans Dolibarr">
                <p>
                  La mission « {cra.missionLabel} » n’est rattachée à aucun projet Dolibarr. La
                  validation ne mettra aucun temps en file, et rien n’arrivera chez le client.
                </p>
                <p>
                  Rattachez-la depuis l’écran Missions si c’est bien elle que vous voulez pousser —
                  le rattachement rattrape les mois déjà validés.
                </p>
              </Banner>
            </div>
          )}

          {/* La synthèse : ce que le client signera, en un coup d'œil. Sans
              elle, il fallait ouvrir le PDF pour savoir combien de jours et
              sur quoi. */}
          <div className="mb-4 rounded-md border border-rule p-3">
            {cra.synthese.lignes.length === 0 ? (
              <p className="text-sm text-muted">
                Aucun temps réalisé sur ce mois. Le CRA serait vide.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="text-lg font-medium">
                    {formatJours(cra.synthese.totalCentiemes)} j
                  </span>{' '}
                  <span className="text-muted">
                    réalisés sur {cra.synthese.joursServis} jour
                    {cra.synthese.joursServis > 1 ? 's' : ''}
                  </span>
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {cra.synthese.lignes.map((l) => (
                    <li key={l.label} className="flex justify-between gap-4">
                      <span>{l.label}</span>
                      <span className="text-muted">{formatJours(l.centiemes)} j</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {cra.signature !== null && <SignatureCard signature={cra.signature} />}

          {/* Dit **avant** la validation, jamais après : un jour prévu emporté
              sans préavis est une donnée perdue dont personne ne saura qu'elle
              a existé. */}
          {cra.previsionnelAAnnuler > 0 && (
            <div className="mb-4">
              <Banner tone="info" title="Du prévisionnel sera annulé à la validation">
                <p>
                  Ce mois porte encore {cra.previsionnelAAnnuler} jour
                  {cra.previsionnelAAnnuler > 1 ? 's' : ''} en prévisionnel. La validation clôt le
                  mois : ce qui n’a pas eu lieu n’aura plus lieu, et ces saisies seront annulées —
                  leurs blocs d’agenda avec elles.
                </p>
                <p>
                  Passez-les en réalisé avant de valider si le temps a bien été servi.
                </p>
              </Banner>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {/* Le téléchargement ne dépend d'aucun connecteur et d'aucun état :
                c'est ce qui rend le lot utile tout seul. Le lien porte
                l'identifiant de SA carte — jamais celui du premier CRA de la
                liste, qui servirait le document nominatif d'un autre. */}
            <a
              href={`/cra/${cra.id}/pdf`}
              className="touch-target inline-flex items-center rounded-md border border-rule px-3 text-sm text-link hover:bg-off"
            >
              Télécharger le PDF
            </a>

            {canTransition(cra.status, 'ENVOYER') && (
              <form action={envoyerPourSignature}>
                <input type="hidden" name="craId" value={cra.id} />
                <input type="hidden" name="month" value={month} />
                <Button variant="primary" disabled={cra.signataireEmail === ''}>
                  Envoyer pour signature
                </Button>
              </form>
            )}

            {cra.signature !== null && (
              <form action={rafraichirSignature}>
                <input type="hidden" name="craId" value={cra.id} />
                <input type="hidden" name="month" value={month} />
                <Button>Rafraîchir l’état</Button>
              </form>
            )}
          </div>

          {cra.signataireEmail === '' && (
            <p className="mb-4 text-xs text-muted">
              Aucun signataire n’est renseigné sur cette mission : renseignez-le depuis l’écran
              Missions pour pouvoir envoyer le CRA. Le téléchargement et les transitions manuelles
              restent disponibles.
            </p>
          )}

          {/* Les transitions manuelles, toujours affichées : connecteur ou pas,
              signature en cours ou pas. C'est ce qui garantit qu'aucun blocage
              extérieur ne rend l'application inutilisable. */}
          <div className="mb-4 flex flex-wrap gap-2">
            {ALL.filter((t) => canTransition(cra.status, t)).map((t) => (
              <form key={t} action={moveCra}>
                <input type="hidden" name="craId" value={cra.id} />
                <input type="hidden" name="transition" value={t} />
                <Button variant={t === 'REFUSER' ? 'danger' : 'secondary'}>{LABELS[t]}</Button>
              </form>
            ))}
          </div>

          <form action={saveTracking} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="craId" value={cra.id} />
            <Field label="N° de facture" name="invoiceNumber" defaultValue={cra.invoiceNumber ?? ''} />
            <Field
              label="Facturé le"
              name="invoicedAt"
              type="date"
              defaultValue={cra.invoicedAt?.toISOString().slice(0, 10) ?? ''}
            />
            <Field
              label="Payé le"
              name="paidAt"
              type="date"
              defaultValue={cra.paidAt?.toISOString().slice(0, 10) ?? ''}
            />
            <Button>Enregistrer le suivi</Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            Champs de suivi uniquement — l’application ne produit aucune facture.
          </p>
        </Card>
      ))}

      {cras.length === 0 && <p className="text-muted">Aucun CRA ouvert sur ce mois.</p>}

      {souffrance.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg">CRA en souffrance</h2>
          <p className="mb-3 text-sm text-muted">
            Relances épuisées, ou demande expirée chez le prestataire. Ces CRA restent envoyés : à
            reprendre à la main avec le client, ou à renvoyer après réouverture.
          </p>
          {souffrance.map((cra: CraView) => (
            <p key={cra.id} className="text-sm">
              {cra.clientName} · {cra.missionLabel} · {cra.month} — envoyé le{' '}
              {cra.signature?.sentAt.toISOString().slice(0, 10)}
            </p>
          ))}
        </section>
      )}

      {/* Ce bouton est ce qui rend l'ordonnanceur facultatif : sans cron ni
          n8n, le porteur du produit relance depuis l'écran.

          **Hors de la section « en souffrance », et c'est le correctif.** Il y
          vivait, à l'intérieur de `{souffrance.length > 0 && …}` — or cette
          liste n'est alimentée que par `abandoned`, que seul
          `runSignatureReminders` pose, c'est-à-dire le travail que ce bouton
          déclenche. Sur une instance neuve, aucune demande abandonnée, donc pas
          de section, donc pas de bouton, donc rien n'était jamais relancé :
          « trois relances puis abandon » était inatteignable dans le produit
          livré.

          La condition porte désormais sur ce que le bouton peut faire — une
          signature encore en attente, ou une souffrance à reprendre — et non
          sur le résultat de son propre effet. */}
      {(souffrance.length > 0 ||
        cras.some((cra) => cra.signature !== null && cra.signature.status === 'EN_ATTENTE')) && (
        <form action={lancerRelances} className="mt-6">
          <input type="hidden" name="month" value={month} />
          <Button>Lancer les relances échues</Button>
          <p className="mt-2 text-xs text-muted">
            Relance les signatures dont le délai est écoulé, et abandonne au-delà de trois relances
            sans réponse. Le travail « Relance de signature » le fait aussi tout seul, s’il est
            activé dans Administration · Supervision.
          </p>
        </form>
      )}
    </PageShell>
  )
}
