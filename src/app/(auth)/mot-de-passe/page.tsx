import Link from 'next/link'
import { FormulaireMotDePasse } from './FormulaireMotDePasse'

export default async function MotDePassePage({
  searchParams,
}: {
  searchParams: Promise<{ jeton?: string }>
}) {
  const { jeton } = await searchParams

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-4">
      <h1 className="mb-6 text-xl font-semibold">Mot de passe</h1>
      <FormulaireMotDePasse jeton={jeton ?? ''} />
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-link underline">
          Retour à la connexion
        </Link>
      </p>
    </main>
  )
}
