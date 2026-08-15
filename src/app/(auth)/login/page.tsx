import { signIn } from '@/auth'

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
      <form action={login} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="Adresse e-mail"
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Mot de passe"
          className="rounded border px-3 py-2"
        />
        <button type="submit" className="rounded bg-slate-900 px-3 py-2 text-white">
          Se connecter
        </button>
      </form>
    </main>
  )
}
