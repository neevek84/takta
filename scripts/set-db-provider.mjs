import { readFileSync, writeFileSync } from 'node:fs'

const provider = process.argv[2]
if (provider !== 'sqlite' && provider !== 'postgresql') {
  console.error('Usage: node scripts/set-db-provider.mjs <sqlite|postgresql>')
  process.exit(1)
}

const path = 'prisma/schema.prisma'
const src = readFileSync(path, 'utf8')
const out = src.replace(/provider = "(sqlite|postgresql)"/, `provider = "${provider}"`)

if (out === src && !src.includes(`provider = "${provider}"`)) {
  console.error('Bloc datasource introuvable dans prisma/schema.prisma')
  process.exit(1)
}

writeFileSync(path, out)
console.log(`Provider Prisma : ${provider}`)
