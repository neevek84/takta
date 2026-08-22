import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { login } from './actions'

const MESSAGE_ECHEC = 'Adresse e-mail ou mot de passe incorrect.'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; email?: string }>
}) {
  const { erreur, email } = await searchParams

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-4">
      {/* Le seul écran où le produit se nomme. Le logotype porte le nom : le
          titre reste « Connexion », qui dit ce qu'on fait ici. Deux fois le
          même mot n'apprendrait rien.
          `alt` vide et `aria-hidden` : le nom est écrit juste en dessous par
          la baseline, et une image décorative annoncée deux fois encombre. */}
      <img src="/takta.svg" alt="" aria-hidden="true" className="mb-2 h-9 w-auto" />
      <p className="mb-6 text-sm text-muted">Le temps qui fait foi.</p>
      <h1 className="mb-6 text-xl font-semibold">Connexion</h1>
      <Card>
        <form action={login} className="flex flex-col gap-3">
          {erreur !== undefined && <Banner tone="danger">{MESSAGE_ECHEC}</Banner>}
          <Field
            label="Adresse e-mail"
            name="email"
            type="email"
            defaultValue={email ?? ''}
            required
          />
          <Field label="Mot de passe" name="password" type="password" required />
          <Button type="submit" variant="primary">
            Se connecter
          </Button>
        </form>
      </Card>
    </main>
  )
}
