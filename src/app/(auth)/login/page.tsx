import { signIn } from '@/auth'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'

export default function LoginPage() {
  async function login(formData: FormData) {
    'use server'
    await signIn('credentials', {
      email: String(formData.get('email')),
      password: String(formData.get('password')),
      redirectTo: '/saisie',
    })
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-4">
      <h1 className="mb-6 text-xl font-semibold">Connexion</h1>
      <Card>
        <form action={login} className="flex flex-col gap-3">
          <Field label="Adresse e-mail" name="email" type="email" required />
          <Field label="Mot de passe" name="password" type="password" required />
          <Button type="submit" variant="primary">
            Se connecter
          </Button>
        </form>
      </Card>
    </main>
  )
}
