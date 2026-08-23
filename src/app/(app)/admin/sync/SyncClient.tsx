'use client'

import { useState } from 'react'
import { Field } from '@/components/ui/Field'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { ConflictResolution } from '@/core/sync/policy'
import type { OpenConflict } from '@/services/sync/conflicts'
import type { FailedSyncRow, PendingSyncRow } from '@/services/sync/queue'
import type { DrainReport } from '@/services/sync/flush'
import { arbitrer, rejouer, renvoyerAgenda, synchroniserMaintenant } from './actions'

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
  // `nonConnecte` ne vaut que si **aucun** fournisseur n'est joignable : ni
  // l'agenda, ni Dolibarr. Nommer le seul agenda ferait chercher une panne de
  // Google à qui n'a jamais eu que Dolibarr.
  if (r.nonConnecte) {
    return {
      tone: 'info',
      texte:
        'Aucun connecteur joignable. La saisie et la validation continuent de fonctionner normalement.',
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

export function SyncClient(props: {
  conflicts: OpenConflict[]
  failures: FailedSyncRow[]
  /**
   * Ce qui attend de partir.
   *
   * L'écran ne montrait que les échecs. Or une file qui ne s'écoule pas ne
   * produit **aucun** échec : elle reste pleine, en silence. C'est dans cet
   * angle mort qu'un CRA validé peut attendre des semaines.
   */
  pending: PendingSyncRow[]
}) {
  const [message, setMessage] = useState<Message | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Vides au départ : proposer un mois par défaut ferait partir un rattrapage
  // que personne n'a choisi, d'un seul clic distrait.
  const [du, setDu] = useState('')
  const [au, setAu] = useState('')
  const [renvoiEnCours, setRenvoiEnCours] = useState(false)

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

  async function onRenvoyer(): Promise<void> {
    setRenvoiEnCours(true)
    try {
      const r = await renvoyerAgenda(du, au)
      setMessage(
        r.ok
          ? {
              tone: 'info',
              // Le nombre est **dit** : « c’est fait » ne distingue pas un
              // rattrapage de quatre cents blocs d’une période vide.
              texte: `${r.misesEnFile} saisie(s) remise(s) en file vers l’agenda.`,
            }
          : { tone: 'danger', texte: r.motif },
      )
    } catch {
      setMessage(panne('Le renvoi vers l’agenda'))
    } finally {
      setRenvoiEnCours(false)
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

      <Card title="Synchronisation">
        <div className="flex flex-col items-start gap-3 text-sm">
          {/*
            Ce texte annonçait « aucun drainage automatique n’est installé ».
            C’était vrai jusqu’à l’horloge interne : le laisser ferait chercher
            un cron que personne n’a plus à poser. Ce qui reste vrai, et qu’il
            faut dire, c’est que l’écoulement dépend d’un travail qu’on peut
            avoir coupé.
          */}
          <p className="text-muted">
            La file s’écoule toute seule, <strong>toutes les cinq minutes</strong>, tant que le
            travail « Vidage de la file de sortie » est actif — il se règle dans Supervision.
            Ce bouton force un écoulement immédiat.
          </p>
          <Button variant="primary" loading={enCours} onClick={() => void onSynchroniser()}>
            Synchroniser maintenant
          </Button>
        </div>
      </Card>

      {/*
        **Le rattrapage.** Deux chemins ont écrit des saisies sans jamais les
        mettre en file : la reprise Dolibarr — corrigée depuis, mais
        l’historique déjà repris reste muet — et toute saisie antérieure à la
        connexion de l’agenda. On ne voyait alors dans l’agenda que les
        prévisionnels tapés à la main.

        La période est demandée, jamais « tout » : un rattrapage sur toute
        l’histoire d’une installation enverrait des milliers d’écritures chez
        un tiers sans que personne ne l’ait voulu.
      */}
      <Card title="Renvoyer des saisies vers l’agenda">
        <div className="flex flex-col items-start gap-3 text-sm">
          <p className="text-muted">
            Remet en file les saisies d’une période, réalisé compris, qu’elles soient déjà parties
            ou non. Sans effet double : un bloc déjà présent est mis à jour, pas recréé.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Du" name="renvoiDu" type="date" value={du} onChange={(e) => setDu(e.target.value)} />
            <Field label="Au" name="renvoiAu" type="date" value={au} onChange={(e) => setAu(e.target.value)} />
            <Button loading={renvoiEnCours} onClick={() => void onRenvoyer()}>
              Renvoyer vers l’agenda
            </Button>
          </div>
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

      <Card title="En attente">
        {props.pending.length === 0 ? (
          <p className="text-sm text-muted">La file est vide : tout est parti.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              {props.pending.length} enregistrement{props.pending.length > 1 ? 's' : ''} attend
              {props.pending.length > 1 ? 'ent' : ''} de partir. Rien ne s’écoule tout seul :
              utilisez « Synchroniser maintenant » ci-dessus, ou forcez une ligne.
            </p>
            <ul className="flex flex-col gap-3">
              {props.pending.map((p) => (
                <li key={p.id} className="rounded-md border border-rule p-3 text-sm">
                  <p className="font-medium">{p.libelle}</p>
                  <p className="text-muted">
                    {p.proprietaire} · {p.provider} · {p.operation}
                    {/* L'attente est dite en clair : c'est elle qui révèle qu'un
                        drainage manque, là où un simple compte ne dirait rien. */}
                    {p.attenteHeures > 0 && ` · en attente depuis ${p.attenteHeures} h`}
                    {p.attempts > 0 && ` · ${p.attempts} tentative(s)`}
                  </p>
                  <Button className="mt-2" onClick={() => void onRejouer(p.id)}>
                    Forcer maintenant
                  </Button>
                </li>
              ))}
            </ul>
          </>
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
