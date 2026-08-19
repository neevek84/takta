import { requireUser } from '@/auth'
import { listCras, listCrasEnSouffrance, type CraView } from '@/services/cra'
import { listMissionsForUser } from '@/services/missions'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { SignatureCard } from '@/components/cra/SignatureCard'
import { StatusBadge } from '@/components/cra/StatusBadge'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PageShell } from '@/components/ui/PageShell'
import { Select } from '@/components/ui/Select'
import {
  envoyerPourSignature,
  lancerRelances,
  moveCra,
  openCra,
  rafraichirSignature,
  saveTracking,
} from './actions'

const LABELS: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
}

const ALL: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR']

/**
 * Les motifs d'échec que les services de signature savent rendre, traduits en
 * une phrase. Le motif transite par l'URL parce qu'une server action qui
 * redirige ne rend rien : la page est le seul endroit qui puisse encore parler
 * à l'utilisateur.
 */
const ERREURS: Record<string, string> = {
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Le CRA reste téléchargeable et les transitions manuelles restent disponibles.',
  PAS_DE_SIGNATAIRE:
    'Renseignez le signataire de la mission (nom et adresse électronique) avant d’envoyer le CRA.',
  TRANSITION_IMPOSSIBLE: 'Ce CRA ne peut pas être envoyé dans son état actuel.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas accepté le document. Le CRA n’a pas changé d’état.',
  PAS_DE_DEMANDE: 'Ce CRA n’a jamais été envoyé pour signature.',
}

export default async function CraPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; erreur?: string }>
}) {
  const user = await requireUser()
  const { month: raw, erreur } = await searchParams
  const month = raw ?? new Date().toISOString().slice(0, 7)

  const cras = await listCras(user.id, month)
  const missions = await listMissionsForUser(user.id)
  const souffrance = await listCrasEnSouffrance(user.id)
  const messageErreur = erreur === undefined ? undefined : ERREURS[erreur]

  return (
    <PageShell title={`CRA · ${month}`}>
      {messageErreur !== undefined && (
        <div className="mb-6">
          <Banner tone="warning" title="Envoi impossible">
            {messageErreur}
          </Banner>
        </div>
      )}

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
            <StatusBadge status={cra.status} />
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
