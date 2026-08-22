import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { login } from './actions'
import { aucunUtilisateur } from '@/services/auth/comptes'
import { PremierAdminForm } from './PremierAdminForm'
import { version } from '@/core/identite'

const MESSAGE_ECHEC = 'Adresse e-mail ou mot de passe incorrect.'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; email?: string }>
}) {
  const { erreur, email } = await searchParams
  // Une instance neuve est murée : sans cet écran, il n'existe aucun moyen de
  // créer le premier compte sans terminal.
  const premierDemarrage = await aucunUtilisateur()

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-4">
      {/* Le seul écran où le produit se nomme. Le logotype porte le nom : le
          titre reste « Connexion », qui dit ce qu'on fait ici. Deux fois le
          même mot n'apprendrait rien.
          `alt` vide et `aria-hidden` : le nom est écrit juste en dessous par
          la baseline, et une image décorative annoncée deux fois encombre. */}
      <img src="/takta.svg" alt="" aria-hidden="true" className="mb-2 h-9 w-auto" />
      <p className="mb-6 text-sm text-muted">Le temps qui fait foi.</p>
      <h1 className="mb-6 text-xl font-semibold">
        {premierDemarrage ? 'Premier démarrage' : 'Connexion'}
      </h1>
      {premierDemarrage ? (
        <PremierAdminForm />
      ) : (
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
      )}
      {/* La navigation porte déjà ce numéro, mais elle est derrière la porte.
          Ici, il est lisible sans entrer : c'est ce qui permet de vérifier
          qu'une mise à jour est bien arrivée — Container Manager, lui,
          n'affiche que l'identifiant local de l'image, qui ne correspond à
          aucune empreinte du registre. */}
      {version() !== '' && (
        <footer className="mt-8 text-center text-xs text-muted">v{version()}</footer>
      )}
    </main>
  )
}
