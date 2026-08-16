import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins, creerDossierDonnees } from './lib/chemins.mjs'
import { sauvegarderBase } from './lib/sauvegarde.mjs'

const c = chemins(racineDeLInstallation(fileURLToPath(import.meta.url)))
creerDossierDonnees(c)

if (!existsSync(c.base)) {
  console.error(
    "Aucune base à sauvegarder : l'application n'a jamais été démarrée sur cette installation.",
  )
  process.exit(1)
}

// Chemin ABSOLU : Prisma résout un `file:` relatif par rapport au schéma, pas
// au dossier courant.
process.env.DATABASE_URL = `file:${c.base}`
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

try {
  const fichier = await sauvegarderBase(prisma, c.sauvegardes, 'sauvegarde')
  console.log(`Sauvegarde écrite : ${fichier}`)
  console.log(
    "Elle est cohérente même si l'application tourne : c'est une archive SQLite, pas une copie de fichier.",
  )
  console.log(`Rappel : tout est dans ${c.donnees} — copier ce dossier, c'est tout sauvegarder.`)
} finally {
  await prisma.$disconnect()
}
