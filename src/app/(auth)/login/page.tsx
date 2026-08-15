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
