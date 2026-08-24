import { requireUser } from '@/auth'
import { listCrasSuivi, listCrasEnSouffrance, type CraView } from '@/services/cra'
import { parseEtats } from '@/core/cra/etat-suivi'
import { FiltreEtats } from '@/components/cra/FiltreEtats'
import { SuiviTable } from '@/components/cra/SuiviTable'
import { PageShell } from '@/components/ui/PageShell'
import { Button } from '@/components/ui/Button'
import { lancerRelances } from './actions'

export default async function SuiviCraPage({
  searchParams,
}: {
  searchParams: Promise<{ etats?: string; month?: string }>
}) {
  const user = await requireUser()
  const { etats: brut, month } = await searchParams
  const etats = parseEtats(brut)

  const cras = await listCrasSuivi(user.id, { etats, ...(month === undefined ? {} : { month }) })
  const souffrance = await listCrasEnSouffrance(user.id)

  return (
    <PageShell title="Suivi CRA">
      <FiltreEtats etats={etats} month={month} />

      {/* Zéro état coché n'est pas « aucun CRA » : c'est un filtre qui exclut
          tout, et le dire évite de croire que la base est vide. */}
      {etats.length === 0 ? (
        <p className="text-muted">
          Aucun état sélectionné : cochez au moins un état pour voir des CRA.
        </p>
      ) : (
        <SuiviTable cras={cras} />
      )}

      {/* La souffrance et les relances restent en bas, et hors du filtre : un
          CRA en souffrance l'est quel que soit l'état coché. */}
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

          La condition porte sur ce que le bouton peut faire — une signature
          encore en attente, ou une souffrance à reprendre — et non sur le
          résultat de son propre effet : sinon, sur une instance neuve, aucune
          demande n'est jamais abandonnée et le bouton n'apparaît jamais. */}
      {(souffrance.length > 0 ||
        cras.some((cra) => cra.signature !== null && cra.signature.status === 'EN_ATTENTE')) && (
        <form action={lancerRelances} className="mt-6">
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
