import { notFound } from 'next/navigation'
import { requireUser } from '@/auth'
import { getCra } from '@/services/cra'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { formatJours, libelleMois } from '@/core/cra/document'
import { SignatureCard } from '@/components/cra/SignatureCard'
import { StatusBadge } from '@/components/cra/StatusBadge'
import { Origine } from '@/components/ui/Origine'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PageShell } from '@/components/ui/PageShell'
import {
  ERREURS,
  envoyerPourSignature,
  moveCra,
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

export default async function CraDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ craId: string }>
  searchParams: Promise<{ erreur?: string }>
}) {
  const user = await requireUser()
  const { craId } = await params
  const { erreur } = await searchParams
  const messageErreur = erreur === undefined ? undefined : ERREURS[erreur]

  // `getCra` lève quand le CRA n'existe pas OU qu'il appartient à quelqu'un
  // d'autre — et les deux cas rendent la même chose. Distinguer « absent » de
  // « pas à vous » apprendrait à un tiers quels identifiants existent.
  let cra
  try {
    cra = await getCra(user.id, craId)
  } catch {
    // `notFound()` interrompt le rendu en levant — ce `return` ne s'exécute
    // donc jamais en production. Il existe pour que `cra` ne soit jamais lu
    // non assigné, ici comme sous un double qui ne lève pas.
    notFound()
    return null
  }

  return (
    <PageShell title={`${cra.clientName} · ${cra.missionLabel} — ${libelleMois(cra.month)}`}>
      {messageErreur !== undefined && (
        <div className="mb-6">
          <Banner tone="warning" title="Envoi impossible">
            {messageErreur}
          </Banner>
        </div>
      )}

      <Card>
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
            <p className="text-sm text-muted">Aucun temps réalisé sur ce mois. Le CRA serait vide.</p>
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
              {/* Une seule ligne, forcément égale au total : la détailler la
                  répéterait sans rien ajouter. La ventilation ne prend sens
                  qu'à partir de deux prestations. */}
              {cra.synthese.lignes.length > 1 && (
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {cra.synthese.lignes.map((l) => (
                    <li key={l.label} className="flex justify-between gap-4">
                      <span>{l.label}</span>
                      <span className="text-muted">{formatJours(l.centiemes)} j</span>
                    </li>
                  ))}
                </ul>
              )}
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
              <p>Passez-les en réalisé avant de valider si le temps a bien été servi.</p>
            </Banner>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {/* Le téléchargement ne dépend d'aucun connecteur et d'aucun état :
              c'est ce qui rend le CRA utile tout seul. Le lien porte
              l'identifiant de CE CRA — jamais celui d'un autre, qui servirait
              le document nominatif d'un autre. */}
          <a
            href={`/cra/${cra.id}/pdf`}
            className="touch-target inline-flex items-center rounded-md border border-rule px-3 text-sm text-link hover:bg-off"
          >
            Télécharger le PDF
          </a>

          {canTransition(cra.status, 'ENVOYER') && (
            <form action={envoyerPourSignature}>
              <input type="hidden" name="craId" value={cra.id} />
              <Button variant="primary" disabled={cra.signataireEmail === ''}>
                Envoyer pour signature
              </Button>
            </form>
          )}

          {cra.signature !== null && (
            <form action={rafraichirSignature}>
              <input type="hidden" name="craId" value={cra.id} />
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
    </PageShell>
  )
}
