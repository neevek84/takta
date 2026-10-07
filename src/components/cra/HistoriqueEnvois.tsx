import type { EnvoiVue } from '@/services/signature/envois'

const LIBELLES: Record<EnvoiVue['status'], string> = {
  EN_ATTENTE: 'en attente de signature',
  SIGNE: 'signé',
  REFUSE: 'refusé',
  EXPIRE: 'expiré',
  ANNULE: 'retiré',
}

function jour(d: Date): string {
  return d.toISOString().slice(0, 10).split('-').reverse().join('/')
}

/**
 * Chaque envoi du CRA, du plus récent au plus ancien. L'état est écrit en
 * toutes lettres : aucune information n'est portée par la seule couleur.
 */
export function HistoriqueEnvois({ envois }: { envois: EnvoiVue[] }) {
  if (envois.length === 0) return null
  return (
    <section aria-labelledby="historique-envois" className="mb-4">
      <h3 id="historique-envois" className="mb-2 text-sm font-medium">Historique des envois</h3>
      <ol className="flex flex-col gap-2 text-sm">
        {envois.map((e) => (
          <li key={e.numero} className="rounded-md border border-rule p-2">
            <p>
              <span className="font-medium">Envoi n° {e.numero}</span>
              <span className="text-muted"> · le {jour(e.sentAt)} · {LIBELLES[e.status]}</span>
              {e.completedAt !== null && <span className="text-muted"> le {jour(e.completedAt)}</span>}
              {e.signataireNom !== '' && <span className="text-muted"> — {e.signataireNom}</span>}
            </p>
            {e.motifRefus !== '' && <p className="mt-1">« {e.motifRefus} »</p>}
            {e.empreinte !== '' && (
              <p className="mt-1 text-xs text-muted">
                Empreinte du document : {e.empreinte.slice(0, 4)}…{e.empreinte.slice(-4)}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
