import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins, creerDossierDonnees } from './lib/chemins.mjs'
import { urlBaseDurable } from './lib/migrations.mjs'

const [email, nom, motDePasse] = process.argv.slice(2)
if (!email || !nom || !motDePasse) {
  console.error('Usage : ./creer-utilisateur.sh <email> "<nom>" <motdepasse>')
  console.error('Exemple : ./creer-utilisateur.sh moi@exemple.fr "Mon Nom" monmotdepasse')
  process.exit(1)
}

const c = chemins(racineDeLInstallation(fileURLToPath(import.meta.url)))
creerDossierDonnees(c)

if (!existsSync(c.base)) {
  console.error(
    "La base n'existe pas encore. Lance d'abord ./demarrer.sh une première fois,\n" +
      'puis relance cette commande dans un autre terminal.',
  )
  process.exit(1)
}

// Chemin ABSOLU : Prisma résout un `file:` relatif par rapport au schéma, pas
// au dossier courant. Connexion unique, comme le lanceur : c'est la condition
// pour que « synchronous=FULL » couvre réellement ce qui est écrit ici.
process.env.DATABASE_URL = urlBaseDurable(c.base)
const { PrismaClient } = await import('@prisma/client')
const { hash } = await import('@node-rs/argon2')

const prisma = new PrismaClient()
try {
  const passwordHash = await hash(motDePasse)
  await prisma.user.upsert({
    where: { email },
    create: { email, name: nom, passwordHash, role: 'ADMIN' },
    update: { passwordHash },
  })
  console.log(`Utilisateur ${email} créé (ou mot de passe mis à jour).`)
} finally {
  await prisma.$disconnect()
}
