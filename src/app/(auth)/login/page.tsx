import Link from 'next/link'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { connexionGoogle, login } from './actions'
import { aucunUtilisateur } from '@/services/auth/comptes'
import { PremierAdminForm } from './PremierAdminForm'
import { version } from '@/core/identite'
import { getGoogleOAuthClientView } from '@/services/google/oauth-client'

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
  // La seconde porte n'existe que si quelqu'un l'a installée. Un bouton sans
  // client enregistré mènerait à un `invalid_client` que personne ne sait
  // lire — et au premier démarrage, il créerait un compte `CONSULTANT` dans
  // une instance qui n'aurait alors jamais d'administrateur.
  const clientGoogle = premierDemarrage ? null : await getGoogleOAuthClientView()

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
      {clientGoogle !== null && (
        <form action={connexionGoogle} className="mt-3">
          <Button type="submit">Se connecter avec Google</Button>
        </form>
      )}
      {/* Hors du pied de page, qui ne porte que la version et disparaît avec
          elle. Absent au premier démarrage : sans aucun compte en base, ce
          lien ne mène qu'à un envoi qui n'aura pas lieu.
          C'est la seconde porte du mot de passe — celle par laquelle un compte
          né sans empreinte (reprise Dolibarr, connexion Google) s'en donne
          une, et pas seulement celle de l'oubli. */}
      {!premierDemarrage && (
        <p className="mt-4 text-sm">
          <Link href="/mot-de-passe" className="text-link underline">
            Définir ou réinitialiser mon mot de passe
          </Link>
        </p>
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
