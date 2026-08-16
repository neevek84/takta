'use client'

import { useState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { ConflictResolution } from '@/core/sync/policy'
import type { OpenConflict } from '@/services/sync/conflicts'
import type { FailedSyncRow } from '@/services/sync/queue'
import type { DrainReport } from '@/services/sync/flush'
import { arbitrer, deconnecterGoogle, rejouer, synchroniserMaintenant } from './actions'

const ISSUES: Array<{ resolution: ConflictResolution; label: string }> = [
  { resolution: 'RETABLIR', label: 'Rétablir' },
  { resolution: 'ACCEPTER', label: 'Accepter' },
  { resolution: 'DETACHER', label: 'Détacher' },
]

const KIND_LABELS: Record<string, string> = {
  REMOTE_MODIFIED: "L'événement a été modifié dans l'agenda",
  REMOTE_DELETED: "L'événement a été supprimé de l'agenda",
}

/**
 * Un seul message à l'écran à la fois : deux bandeaux concurrents laisseraient
 * un refus d'hier cohabiter avec un succès d'aujourd'hui.
 *
 * `info` attend son tour (`status`), `warning` et `danger` interrompent
 * (`alert`) : un reste à drainer et une action qui a levé doivent être
 * annoncés, un compte rendu nominal non.
 */
type Message = { tone: 'info' | 'warning' | 'danger'; title?: string; texte: string }

function compteRendu(r: DrainReport): Message {
  if (r.nonConnecte) {
    return {
      tone: 'info',
      texte: 'Aucun agenda joignable. La saisie continue de fonctionner normalement.',
    }
  }

  const fait = `${r.traitees} élément(s) traité(s) : ${r.reussies} synchronisé(s), ${r.conflits} divergence(s), ${r.echecs} échec(s).`

  // Sans cette phrase, « 50 traité(s), 50 synchronisé(s) » est strictement
  // indiscernable d'une file vidée : l'utilisateur referme l'écran en croyant
  // son agenda à jour, et des journées qu'il pense bloquées restent libres.
  return r.reste === 0
    ? { tone: 'info', texte: fait }
    : {
        tone: 'warning',
        title: 'File non vidée',
        texte: `${fait} Il en reste ${r.reste} à traiter : relancez la synchronisation.`,
      }
}

/**
 * Toute action serveur peut lever : panne de base, session expirée, contrainte
 * violée. Sans ce traitement, le rejet reste non traité — le bouton se
 * rétablit, aucun message n'apparaît, et l'utilisateur conclut que son geste a
 * été pris en compte. C'est le vecteur qui rend un défaut d'écriture muet.
 */
function panne(quoi: string): Message {
  return {
    tone: 'danger',
    title: 'Action impossible',
    texte: `${quoi} a échoué. Rien n'a peut-être été enregistré : rechargez l'écran, puis réessayez.`,
  }
}

/**
 * Ce que la déconnexion fait, et ce qu'elle ne fait pas.
 *
 * `deconnecterGoogle` n'appelle aucun point de révocation chez Google : elle
 * efface seulement ce qui est stocké ici. Sans ce message, l'utilisateur
 * croit avoir tout coupé alors que l'application reste autorisée dans son
 * compte Google jusqu'à ce qu'il l'y retire lui-même — le porteur a choisi ce
 * comportement limité plutôt qu'un appel réseau qui peut échouer à moitié,
 * mais un choix limité doit se dire, pas se taire.
 */
function messageDeconnexion(): Message {
  return {
    tone: 'warning',
    title: 'Déconnecté ici, pas dans votre compte Google',
    texte:
      "L'accès stocké sur cet ordinateur est bien supprimé. Mais votre compte Google, lui, autorise toujours cette application : ça ne s'efface pas tout seul en cliquant ici. Pour la retirer, ouvrez la page de vos autorisations Google — myaccount.google.com/permissions — et retirez-la vous-même.",
  }
}

export function SyncClient(props: {
  connection: { connected: boolean; calendarId: string; scope: string; connectedAt: Date | null }
  conflicts: OpenConflict[]
  failures: FailedSyncRow[]
}) {
  const [message, setMessage] = useState<Message | null>(null)
  const [enCours, setEnCours] = useState(false)

  async function onArbitrer(id: string, resolution: ConflictResolution): Promise<void> {
    try {
      const r = await arbitrer(id, resolution)
      // Si la règle refuse, le conflit reste ouvert et le motif est affiché :
      // un arbitrage silencieusement sans effet serait pire que pas d'arbitrage.
      setMessage(
        r.ok
          ? { tone: 'info', texte: 'Divergence arbitrée.' }
          : { tone: 'warning', title: 'Arbitrage refusé', texte: r.message },
      )
    } catch {
      setMessage(panne("L'arbitrage de la divergence"))
    }
  }

  async function onRejouer(id: string): Promise<void> {
    try {
      await rejouer(id)
      setMessage({ tone: 'info', texte: 'Ligne remise en file.' })
    } catch {
      setMessage(panne('La remise en file'))
    }
  }

  async function onDeconnecter(): Promise<void> {
    try {
      await deconnecterGoogle()
      setMessage(messageDeconnexion())
    } catch {
      setMessage(panne('La déconnexion'))
    }
  }

  async function onSynchroniser(): Promise<void> {
    setEnCours(true)
    try {
      setMessage(compteRendu(await synchroniserMaintenant()))
    } catch {
      setMessage(panne('La synchronisation'))
    } finally {
      // Un second déclenchement pendant le premier repousserait les mêmes
      // lignes deux fois ; le bouton reste rendu, simplement inactif.
      setEnCours(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* `Banner` porte le rôle : `status` attend son tour, `alert` interrompt. */}
      {message !== null && (
        <Banner
          tone={message.tone}
          {...(message.title === undefined ? {} : { title: message.title })}
        >
          {message.texte}
        </Banner>
      )}

      <Card title="Connexion">
        {props.connection.connected ? (
          <div className="flex flex-col items-start gap-3 text-sm">
            <p>
              Connecté. Calendrier dédié : <code>{props.connection.calendarId}</code>
            </p>
            <Button onClick={() => void onDeconnecter()}>Déconnecter</Button>
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

      <Card title="Synchronisation">
        <div className="flex flex-col items-start gap-3 text-sm">
          {/*
            Rien n’ordonnance le drainage dans le dépôt : ni `instrumentation.ts`,
            ni `setInterval`, ni service, ni cron. Annoncer un écoulement
            automatique ferait croire que l’agenda part tout seul alors que ce
            bouton est le seul. On dit donc ce qui est, et ce qu’il faut poser
            pour obtenir mieux.
          */}
          <p className="text-muted">
            Aucun drainage automatique n’est installé : ce bouton est le seul écoulement de la file.
          </p>
          <p className="text-muted">
            Pour un drainage régulier, faites appeler <code>POST /api/sync/flush</code> par un cron
            ou par n8n, après avoir défini <code>SYNC_FLUSH_TOKEN</code> — vide, l’endpoint reste
            fermé.
          </p>
          <Button variant="primary" loading={enCours} onClick={() => void onSynchroniser()}>
            Synchroniser maintenant
          </Button>
        </div>
      </Card>

      <Card title="Divergences">
        {props.conflicts.length === 0 ? (
          <p className="text-sm text-muted">Aucune divergence à arbitrer.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {props.conflicts.map((c) => (
              <li key={c.id} className="rounded-md border border-rule p-3 text-sm">
                <p className="font-medium">{c.libelle}</p>
                <p className="text-muted">{KIND_LABELS[c.kind] ?? c.kind}</p>
                {c.remote !== null && (
                  <p className="text-muted">
                    Agenda : « {c.remote.summary} » {c.remote.startLocal} → {c.remote.endLocal}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {ISSUES.map((i) => (
                    <Button key={i.resolution} onClick={() => void onArbitrer(c.id, i.resolution)}>
                      {i.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Échecs">
        {props.failures.length === 0 ? (
          <p className="text-sm text-muted">Aucun échec en attente.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {props.failures.map((f) => (
              <li key={f.id} className="rounded-md border border-rule p-3 text-sm">
                <p className="font-medium">{f.libelle}</p>
                <p className="text-muted">
                  {f.operation} · {f.attempts} tentative(s) · {f.lastError}
                </p>
                <Button className="mt-2" onClick={() => void onRejouer(f.id)}>
                  Rejouer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
