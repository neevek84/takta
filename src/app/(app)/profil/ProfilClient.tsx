'use client'

import { useActionState, useState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import {
  deconnecterGoogle,
  enregistrerIdentifiantDolibarr,
  type ProfilState,
} from './actions'

/**
 * Ce qui appartient à la personne, et à elle seule.
 *
 * Deux réglages y vivent, et ils ont la même nature : ils désignent **qui** est
 * cette personne chez un fournisseur. L'agenda Google l'était déjà ; l'utilisateur
 * Dolibarr ne l'était pas, et c'est ce défaut de portée qui aurait fait facturer
 * les temps du porteur au nom d'un utilisateur technique.
 *
 * La clé d'API Dolibarr et le client OAuth Google, eux, restent en
 * administration : ce sont des secrets d'instance, saisis une fois pour tous.
 */
export function ProfilClient({
  identifiant,
  suggestion,
  connection,
}: {
  /** l'identifiant Dolibarr **enregistré** pour ce compte, `null` s'il n'en a pas */
  identifiant: number | null
  /** l'ancien réglage d'instance, proposé mais **pas** enregistré */
  suggestion: number | null
  connection: { connected: boolean; calendarId: string; scope: string; connectedAt: Date | null }
}) {
  const [etat, formAction, enCours] = useActionState<ProfilState, FormData>(
    enregistrerIdentifiantDolibarr,
    null,
  )
  const [avis, setAvis] = useState<string | null>(null)

  const propose = identifiant === null && suggestion !== null

  return (
    <>
      <Card title="Mon utilisateur Dolibarr">
        <p className="mb-3 text-sm text-muted">
          Les temps de vos CRA sont enregistrés dans Dolibarr <strong>sous cet utilisateur</strong>,
          et c’est sur eux que la facturation se fait. Il vous appartient : celui d’un collègue
          attribuerait vos journées à quelqu’un d’autre.
        </p>

        {identifiant === null && !propose && (
          <div className="mb-3">
            <Banner tone="warning" title="Aucun utilisateur Dolibarr renseigné">
              <p>
                Vos CRA validés <strong>ne partiront pas</strong> vers Dolibarr tant que ce champ est
                vide. Le reste de l’application fonctionne normalement.
              </p>
            </Banner>
          </div>
        )}

        {propose && (
          <div className="mb-3">
            <Banner tone="info" title="Une valeur vous est proposée">
              <p>
                L’identifiant n° {suggestion} vient des réglages de l’instance, où il était saisi
                pour tout le monde. Il <strong>n’est pas encore enregistré</strong> pour votre
                compte : vérifiez que c’est bien le vôtre, puis enregistrez.
              </p>
            </Banner>
          </div>
        )}

        {etat !== null && (
          <div className="mb-3">
            <Banner tone={etat.ok ? 'success' : 'danger'}>{etat.message}</Banner>
          </div>
        )}

        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <Field
            label="Identifiant utilisateur Dolibarr"
            name="identifiant"
            defaultValue={identifiant !== null ? String(identifiant) : (suggestion ?? '')}
            inputMode="numeric"
            hint="Un nombre, pas votre identifiant de connexion : celui de votre fiche dans Dolibarr (…?id=3). Vider le champ rompt la correspondance."
            className="w-56"
          />
          <Button type="submit" variant="primary" loading={enCours}>
            Enregistrer
          </Button>
        </form>
      </Card>

      <Card title="Mon agenda Google" className="mt-6">
        {avis !== null && (
          <div className="mb-3">
            <Banner tone="info">{avis}</Banner>
          </div>
        )}

        {connection.connected ? (
          <div className="flex flex-col items-start gap-3 text-sm">
            <p>
              Connecté. Calendrier dédié : <code>{connection.calendarId}</code>
            </p>
            <Button
              onClick={() => {
                void deconnecterGoogle().then(() =>
                  setAvis(
                    'Agenda déconnecté ici. L’application reste autorisée dans votre compte Google : ' +
                      'retirez-la depuis les autorisations de votre compte si vous le souhaitez. Les blocs ' +
                      'déjà posés restent dans le calendrier dédié.',
                  ),
                )
              }}
            >
              Déconnecter
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 text-sm">
            <p className="text-muted">
              Aucun agenda connecté. La saisie fonctionne normalement ; rien n’est poussé.
            </p>
            <a
              href="/api/google/connect"
              className="touch-target inline-flex items-center rounded-md border border-rule px-4 text-sm font-medium text-link hover:bg-off"
            >
              Connecter Google Calendar
            </a>
          </div>
        )}
      </Card>
    </>
  )
}
