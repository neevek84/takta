import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'

const [email, name, password] = process.argv.slice(2)
if (!email || !name || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <nom> <motdepasse>')
  process.exit(1)
}

const prisma = new PrismaClient()
const passwordHash = await hash(password)

await prisma.user.upsert({
  where: { email },
  create: { email, name, passwordHash, role: 'ADMIN' },
  update: { passwordHash },
})

console.log(`Utilisateur ${email} créé.`)
await prisma.$disconnect()
