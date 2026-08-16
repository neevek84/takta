import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins, creerDossierDonnees } from './lib/chemins.mjs'
import { chargerOuCreerEnv } from './lib/env.mjs'
import { resoudrePort, messageBascule } from './lib/port.mjs'
import { lireFichierPid, quelquUnEcoute } from './lib/processus.mjs'
import { appliquerMigrations } from './lib/migrations.mjs'
import { sauvegarderBase } from './lib/sauvegarde.mjs'
import { FICHIERS_ENV_PARASITES } from './lib/paquet.mjs'

const racine = racineDeLInstallation(fileURLToPath(import.meta.url))
const c = chemins(racine)
creerDossierDonnees(c)

function echoue(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

// ── 1. Déjà démarré ? ────────────────────────────────────────────────────────
const enCours = lireFichierPid(c.pid)
if (enCours && (await quelquUnEcoute(enCours.port))) {
  console.log(`L'application tourne déjà : http://127.0.0.1:${enCours.port}`)
  console.log("Pour l'arrêter : ./arreter.sh")
  process.exit(0)
}
rmSync(c.pid, { force: true })

// ── 2. Environnement ─────────────────────────────────────────────────────────
// Chemin ABSOLU : Prisma résout un `file:` relatif par rapport au schéma, pas
// au dossier courant. Un chemin relatif créerait une base au mauvais endroit.
process.env.DATABASE_URL = `file:${c.base}`
const secrets = chargerOuCreerEnv(c.env)

// `next build` recopie le `.env` du dépôt dans sa sortie `standalone` : une
// archive construite sans précaution embarquerait donc les secrets de
// développement, dont la clé qui déchiffre les jetons. `outils/lib/paquet.mjs`
// les exclut à l'empaquetage ; ce nettoyage est la seconde ligne, pour une
// archive plus ancienne ou bricolée à la main. Aucune perte : dans la mise en
// page portable, la configuration vit dans `donnees/cra.env`, jamais dans
// `app/`.
for (const nom of FICHIERS_ENV_PARASITES) {
  const parasite = path.join(c.app, nom)
  if (!existsSync(parasite)) continue
  rmSync(parasite, { force: true })
  console.log(`Fichier de secrets étranger supprimé de l'archive : app/${nom}`)
  console.log(`La configuration de cette installation est dans ${c.env}.`)
}

// ── 3. Migrations, précédées de leur copie de sauvegarde ─────────────────────
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

let nbUtilisateurs = 0
let echecBase = null
try {
  const r = await appliquerMigrations({
    prisma,
    dossier: c.migrations,
    avantMigration: () => sauvegarderBase(prisma, c.sauvegardes, 'avant-migration'),
  })
  if (r.sauvegarde) {
    console.log(`Copie de sauvegarde écrite avant migration : ${r.sauvegarde}`)
  }
  if (r.appliquees.length > 0) {
    console.log(`Mise à jour de la base : ${r.appliquees.length} migration(s) appliquée(s).`)
  }
  nbUtilisateurs = await prisma.user.count()
} catch (e) {
  echecBase = e
} finally {
  // Toujours refermer : `echoue` appelle process.exit, qui saute le finally.
  await prisma.$disconnect()
}

if (echecBase) {
  echoue(
    "La préparation de la base a échoué et l'application n'a pas démarré.\n" +
      `Détail : ${echecBase.message}\n` +
      `Tes données sont intactes dans ${c.donnees}, avec les copies de sauvegarde sous ${c.sauvegardes}.`,
  )
}

// ── 4. Port ──────────────────────────────────────────────────────────────────
// Le port préféré est stable (3000) parce que l'URL de retour Google est
// enregistrée une fois pour toutes. `CRA_PORT` en fait une exigence ferme.
let choix
try {
  choix = await resoudrePort({ demande: process.env.CRA_PORT ?? null })
} catch (e) {
  echoue(e.message)
}
const port = choix.port
if (choix.bascule) {
  console.log('')
  console.log(messageBascule(port))
  console.log('')
}

// ── 5. Démarrage du serveur ──────────────────────────────────────────────────
const serveur = path.join(c.app, 'server.js')
if (!existsSync(serveur)) {
  echoue(
    `Fichier introuvable : ${serveur}\n` +
      "L'archive semble incomplète. Dézippe-la de nouveau, entièrement.",
  )
}

const url = `http://127.0.0.1:${port}`

const journal = openSync(c.journal, 'a')
const enfant = spawn(process.execPath, [serveur], {
  cwd: c.app,
  detached: true,
  stdio: ['ignore', journal, journal],
  env: {
    ...process.env,
    // `donnees/cra.env` a le dernier mot sur l'environnement hérité : c'est
    // là que vivent les secrets de CETTE installation. Un `.env` resté dans
    // `app/` ne pourrait de toute façon pas les écraser — `@next/env`
    // n'écrase jamais une variable déjà posée (vérifié dans
    // node_modules/@next/env/dist/index.js, fonction `populate`) — mais on ne
    // s'en remet pas à ça : il est supprimé plus haut.
    ...secrets,
    // Sans URL de retour explicite, on donne celle du port réellement servi :
    // c'est aussi celle que l'écran d'administration affiche à enregistrer.
    GOOGLE_REDIRECT_URI:
      secrets.GOOGLE_REDIRECT_URI && secrets.GOOGLE_REDIRECT_URI !== ''
        ? secrets.GOOGLE_REDIRECT_URI
        : `http://localhost:${port}/api/google/callback`,
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    // Auth.js v5 refuse un hôte non déclaré hors Vercel dès que NODE_ENV vaut
    // production : sans cette ligne, la page de connexion tombe en UntrustedHost.
    AUTH_TRUST_HOST: 'true',
  },
})
enfant.unref()

writeFileSync(
  c.pid,
  JSON.stringify({ pid: enfant.pid, port, demarreLe: new Date().toISOString() }) + '\n',
)

// ── 6. Attente de la première réponse ────────────────────────────────────────
const limite = Date.now() + 60_000
let repond = false
while (Date.now() < limite) {
  try {
    const res = await fetch(`${url}/login`, { redirect: 'manual' })
    if (res.status < 500) {
      repond = true
      break
    }
  } catch {
    // pas encore là
  }
  await new Promise((r) => setTimeout(r, 300))
}

if (!repond) {
  const fin = existsSync(c.journal)
    ? readFileSync(c.journal, 'utf8').split('\n').slice(-25).join('\n')
    : ''
  echoue(
    "L'application n'a pas répondu au bout de 60 secondes. Elle a été laissée en place ;\n" +
      `pour l'arrêter : ./arreter.sh\n\nDernières lignes de ${c.journal} :\n${fin}`,
  )
}

// ── 7. Compte rendu ──────────────────────────────────────────────────────────
console.log('')
console.log(`  CRA est démarré : ${url}`)
console.log('')

if (nbUtilisateurs === 0) {
  console.log("  Aucun utilisateur n'existe encore. Dans un autre terminal, lance :")
  console.log('')
  console.log('    ./creer-utilisateur.sh moi@exemple.fr "Mon Nom" monmotdepasse')
  console.log('')
  console.log(`  puis ouvre ${url} dans ton navigateur.`)
  console.log('')
} else {
  ouvrirNavigateur(url)
  console.log("  Le navigateur devrait s'ouvrir. Sinon, saisis l'adresse ci-dessus.")
  console.log('')
}

console.log('  Pour arrêter : ./arreter.sh — aucune donnée enregistrée ne sera perdue.')
console.log('')

function ouvrirNavigateur(adresse) {
  const [commande, args] =
    process.platform === 'darwin'
      ? ['open', [adresse]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', adresse]]
        : ['xdg-open', [adresse]]
  try {
    spawn(commande, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // Pas de navigateur joignable : l'adresse est déjà affichée, ce n'est pas un échec.
  }
}
