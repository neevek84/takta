import { notFound } from 'next/navigation'
import { requireUser } from '@/auth'
import { getCra } from '@/services/cra'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { etatSuivi } from '@/core/cra/etat-suivi'
import { formatJours, libelleMois } from '@/core/cra/document'
import { SignatureCard } from '@/components/cra/SignatureCard'
import { HistoriqueEnvois } from '@/components/cra/HistoriqueEnvois'
import { LienManuel } from '@/components/cra/LienManuel'
import { StatusBadge } from '@/components/cra/StatusBadge'
import { Origine } from '@/components/ui/Origine'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PageShell } from '@/components/ui/PageShell'
import { compterCourrielsEchoues, listerEnvois } from '@/services/signature/envois'
import {
  annulerEnvoiAction,
  copierLienClient,
  envoyerPourSignature,
  moveCra,
  rafraichirSignature,
  saveTracking,
} from './actions'

/**
 * Les motifs d'échec que les services de signature savent rendre, traduits en
 * une phrase. Le motif transite par l'URL parce qu'une server action qui
 * redirige ne rend rien : la page est le seul endroit qui puisse encore parler
 * à l'utilisateur.
 *
 * Vit ici et non dans `./actions.ts` : un fichier `'use server'` ne peut
 * exporter que des fonctions asynchrones — Next.js refuse la construction de
 * production sinon (« A "use server" file can only export async functions »),
 * une règle que ni `tsc` ni les tests ne vérifient.
 */
const ERREURS: Record<string, string> = {
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Le CRA reste téléchargeable et les transitions manuelles restent disponibles.',
  PAS_DE_SIGNATAIRE:
    'Renseignez le signataire de la mission (nom et adresse électronique) avant d’envoyer le CRA.',
  TRANSITION_IMPOSSIBLE: 'Ce CRA ne peut pas être envoyé dans son état actuel.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas accepté le document. Le CRA n’a pas changé d’état.',
  PAS_DE_SMTP:
    'Le serveur de courriel n’est pas configuré : le client ne pourrait pas recevoir son code. Configurez SMTP dans l’administration, ou utilisez les transitions manuelles.',
  PAS_D_ORIGINE:
    'L’adresse publique de l’outil est inconnue : renseignez AUTH_URL, sinon le lien envoyé au client serait inutilisable.',
  COURRIEL_NON_PARTI:
    'Le CRA est envoyé, mais le courriel au client n’est pas parti. Copiez le lien ci-dessous et transmettez-le vous-même.',
  PAS_DE_DEMANDE: 'Ce CRA n’a jamais été envoyé pour signature.',
  ANNULATION_TRANSITION_IMPOSSIBLE: 'Seul un CRA envoyé peut être retiré.',
  ANNULATION_CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas pu retirer le document. Le CRA reste envoyé : le client peut encore le signer.',
}

const LABELS: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
  RENVOYER: 'Marquer renvoyé',
  ANNULER_ENVOI: 'Annuler l’envoi',
}

// `ANNULER_ENVOI` n'est pas une transition manuelle : son bouton dédié
// (tâche 10) annule aussi l'enveloppe chez le prestataire.
const ALL: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR', 'RENVOYER']

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
  let envois
  let courrielsEchoues
  try {
    ;[cra, envois, courrielsEchoues] = await Promise.all([
      getCra(user.id, craId),
      listerEnvois(user.id, craId),
      compterCourrielsEchoues(user.id, craId),
    ])
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
          <Banner tone="warning" title={
              erreur === 'COURRIEL_NON_PARTI'
                ? 'Courriel non parti'
                : erreur?.startsWith('ANNULATION_')
                  ? 'Action impossible'
                  : 'Envoi impossible'
            }>
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
          <StatusBadge status={etatSuivi(cra)} />
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
        {courrielsEchoues > 0 && (
          <div className="mb-4">
            <Banner tone="warning" title="Courriel non parti">
              {courrielsEchoues} courriel{courrielsEchoues > 1 ? 's' : ''} du circuit de signature n’{courrielsEchoues > 1 ? 'ont' : 'a'} pas pu partir. Vérifiez la configuration SMTP, ou transmettez le lien vous-même.
            </Banner>
          </div>
        )}
        <HistoriqueEnvois envois={envois} />

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

          {(canTransition(cra.status, 'ENVOYER') || canTransition(cra.status, 'RENVOYER')) && (
            <form action={envoyerPourSignature}>
              <input type="hidden" name="craId" value={cra.id} />
              <Button variant="primary" disabled={cra.signataireEmail === ''}>
                {cra.status === 'REFUSE' ? 'Renvoyer pour signature' : 'Envoyer pour signature'}
              </Button>
            </form>
          )}

          {cra.signature !== null && (
            <form action={rafraichirSignature}>
              <input type="hidden" name="craId" value={cra.id} />
              <Button>Rafraîchir l’état</Button>
            </form>
          )}

          {cra.status === 'ENVOYE' && cra.signature !== null && (
            <form action={annulerEnvoiAction}>
              <input type="hidden" name="craId" value={cra.id} />
              <Button>Annuler l’envoi</Button>
            </form>
          )}
        </div>

        {cra.status === 'ENVOYE' && cra.signature?.status === 'EN_ATTENTE' && (
          <div className="mb-4">
            <LienManuel craId={cra.id} action={copierLienClient} />
          </div>
        )}

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
