import type { Metadata } from 'next'
import { CraLecture } from '@/components/client/CraLecture'
import { CadreSignature } from '@/components/client/CadreSignature'
import { FormulaireCode } from '@/components/client/FormulaireCode'
import { Banner } from '@/components/ui/Banner'
import { lireVueClient, resoudreLien } from '@/services/signature/lien-client'
import { origineDocumensoEnVigueur } from '@/services/signature/reglages'
import { confirmerSignature, renouvelerSignature } from './actions'
import { lienDeLaSession } from './session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Compte-rendu d’activité',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

function Neutre({ titre, texte }: { titre: string; texte: string }) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-2 text-xl">{titre}</h1>
      <p className="text-muted">{texte}</p>
    </main>
  )
}

/**
 * La politique des cadres de la page : l'instance Documenso **en vigueur**
 * (écran, sinon environnement), et rien d'autre ; `'none'` sans instance.
 *
 * Une balise meta et non un en-tête : l'instance se règle à l'écran et vit en
 * base, que le middleware — en Edge, sans Prisma — ne peut pas lire. React
 * place la balise dans le `<head>`, avant le cadre ; `frame-src` y est
 * valide, contrairement à `frame-ancestors`, qui reste posé par le middleware.
 */
function PolitiqueCadres({ origine }: { origine: string }) {
  return (
    <meta
      httpEquiv="Content-Security-Policy"
      content={`frame-src ${origine !== '' ? origine : "'none'"}`}
    />
  )
}

function jour(d: Date): string {
  return d.toISOString().slice(0, 10).split('-').reverse().join('/')
}

/**
 * La page du client — **la seule de l'outil sans session**. Elle ne montre que
 * le contenu figé de l'envoi, après un code à usage unique.
 */
export default async function PageClient(props: {
  params: Promise<{ jeton: string }>
  searchParams: Promise<{ etape?: string; erreur?: string }>
}) {
  const [origine, contenu] = await Promise.all([origineDocumensoEnVigueur(), Contenu(props)])
  return (
    <>
      <PolitiqueCadres origine={origine} />
      {contenu}
    </>
  )
}

async function Contenu({
  params,
  searchParams,
}: {
  params: Promise<{ jeton: string }>
  searchParams: Promise<{ etape?: string; erreur?: string }>
}) {
  const { jeton } = await params
  const { etape, erreur } = await searchParams
  const { etat } = await resoudreLien(jeton)

  if (etat === 'INCONNU') return <Neutre titre="Lien non valable" texte="Ce lien n’est pas ou plus valable. Utilisez le lien du dernier courriel reçu." />
  if (etat === 'REMPLACE') return <Neutre titre="Une version plus récente existe" texte="Une version plus récente de ce compte-rendu vous a été envoyée. Utilisez le lien du dernier courriel reçu." />
  if (etat === 'RETIRE') return <Neutre titre="Document retiré" texte="Ce compte-rendu a été retiré par son émetteur. Une nouvelle version vous sera envoyée." />

  const lienId = await lienDeLaSession(jeton)
  if (lienId === null) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-xl">Compte-rendu d’activité</h1>
        <FormulaireCode jeton={jeton} etape={etape === 'code' ? 'code' : 'demande'} erreur={erreur} />
      </main>
    )
  }

  const vue = await lireVueClient(lienId)
  if (vue.document === null) return <Neutre titre="Document indisponible" texte="Ce compte-rendu n’est plus disponible." />

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <CraLecture document={vue.document} />

      {vue.statut === 'SIGNE' && (
        <Banner tone="success" title={`Signé le ${vue.signeLe !== null ? jour(vue.signeLe) : ''}`}>
          {vue.pdfSigneDisponible ? (
            <a href={`/v/${jeton}/pdf`} className="text-link underline">Télécharger le document signé</a>
          ) : (
            'Le document signé sera disponible ici dans quelques instants.'
          )}
        </Banner>
      )}
      {vue.statut === 'REFUSE' && (
        <Banner tone="danger" title={`Refusé le ${vue.refuseLe !== null ? jour(vue.refuseLe) : ''}`}>
          Motif transmis : « {vue.motifRefus} ». Une version corrigée vous sera adressée.
        </Banner>
      )}
      {vue.statut === 'EXPIRE' && (
        <Banner tone="warning" title="Demande expirée">Contactez l’émetteur pour recevoir une nouvelle version.</Banner>
      )}

      {vue.statut === 'A_SIGNER' && vue.urlEmbarquee !== null && (
        <>
          <p>
            Vérifiez le détail ci-dessus, puis <strong>signez</strong> dans le cadre ci-dessous. Pour{' '}
            <strong>refuser</strong>, utilisez le bouton « Refuser » du cadre et indiquez votre motif.
          </p>
          <CadreSignature
            url={vue.urlEmbarquee}
            confirmer={confirmerSignature.bind(null, jeton)}
            renouveler={renouvelerSignature.bind(null, jeton)}
          />
        </>
      )}

      <p className="text-xs text-muted">
        Empreinte du document : {vue.empreinte.slice(0, 4)}…{vue.empreinte.slice(-4)}
      </p>
    </main>
  )
}
