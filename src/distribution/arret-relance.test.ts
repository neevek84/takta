import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  cpSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'

/**
 * Les deux commandes que la personne tape tous les jours — `./demarrer.sh` et
 * `./arreter.sh` — n'étaient couvertes par aucun test. Ce fichier les exécute
 * pour de vrai : vrais processus, vrais fichiers, vrais scripts d'outillage,
 * sur une installation factice montée dans un dossier temporaire.
 *
 * La promesse mise à l'épreuve est celle du porteur : « être sûr d'avoir la
 * bonne ligne de commande pour éteindre et relancer proprement sans perdre la
 * base ».
 */

const RACINE_DEPOT = path.resolve(__dirname, '../..')
const ARRETER = path.join(RACINE_DEPOT, 'outils/arreter.mjs')
const LANCER = path.join(RACINE_DEPOT, 'outils/lancer.mjs')
const JEU_REEL = path.join(RACINE_DEPOT, 'prisma/migrations-sqlite')

let bac = ''
let aTuer: number[] = []

beforeEach(() => {
  bac = mkdtempSync(path.join(tmpdir(), 'cra-arret-'))
  mkdirSync(path.join(bac, 'app'), { recursive: true })
  mkdirSync(path.join(bac, 'donnees'), { recursive: true })
  writeFileSync(path.join(bac, 'LISEZMOI.txt'), 'installation factice\n')
  aTuer = []
})

afterEach(() => {
  // Le serveur démarré par `lancer.mjs` n'est pas un enfant de ce test : son
  // seul lien est le repère. Sans ce ramassage, un test en échec laisserait un
  // processus derrière lui — ce qui est arrivé pendant la vérification par
  // mutation, et se voit alors dans `ps` bien après la fin de la suite.
  const repere = path.join(bac, 'donnees/cra.pid')
  if (existsSync(repere)) {
    try {
      aTuer.push(JSON.parse(readFileSync(repere, 'utf8')).pid)
    } catch {
      // repère illisible : rien à ramasser
    }
  }
  for (const pid of aTuer) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // déjà mort : c'est le cas nominal
    }
  }
  rmSync(bac, { recursive: true, force: true })
})

/** Vrai si le processus existe encore ET n'est pas un zombie en attente de récolte. */
function vivant(pid: number): boolean {
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'state='], { encoding: 'utf8' })
  const etat = r.stdout.trim()
  return etat !== '' && !etat.startsWith('Z')
}

/** Un port sûrement libre, pour que la sonde de port réponde « non ». */
function portLibrePourDeVrai(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })
}

/**
 * Écrit `app/server.js`, le fichier que le lanceur exécute réellement.
 *
 * `ecoute: false` reproduit le serveur vivant qui n'écoute pas (encore) —
 * premier démarrage lent, veille/reprise, ou listener tombé alors que
 * l'ordonnanceur tient la boucle d'événements.
 *
 * Le serveur **se renomme**, comme le vrai : mesuré sur l'archive dézippée,
 * `ps -o command=` rend `next-server (v15.5.23)` et non la ligne
 * `node .../app/server.js` que le lanceur a exécutée. Un test avec un serveur
 * factice anonyme passait pour une raison qui n'existe pas en production.
 */
function serveurFactice({ ecoute, renomme = true }: { ecoute: boolean; renomme?: boolean }): string {
  const fichier = path.join(bac, 'app/server.js')
  const corps = [
    renomme ? "process.title = 'next-server (v15.5.23)'" : '',
    // Le serveur note l'environnement qu'il a réellement reçu du lanceur.
    `require('node:fs').writeFileSync(${JSON.stringify(path.join(bac, 'donnees/env-recu.json'))}, JSON.stringify(process.env))`,
    ecoute
      ? [
          "const http = require('node:http')",
          'const port = Number(process.env.PORT)',
          "http.createServer((req, res) => { res.statusCode = 200; res.end('ok') }).listen(port, '127.0.0.1')",
        ].join('\n')
      : 'setTimeout(() => {}, 120000)',
  ]
    .filter(Boolean)
    .join('\n')
  writeFileSync(fichier, `${corps}\n`)
  return fichier
}

/** Démarre `app/server.js` comme le fait le lanceur, et inscrit le repère. */
function demarrerCommeLeLanceur(port: number): number {
  const serveur = path.join(bac, 'app/server.js')
  const enfant = spawn(process.execPath, [serveur], {
    cwd: path.join(bac, 'app'),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(port) },
  })
  enfant.unref()
  aTuer.push(enfant.pid!)
  writeFileSync(
    path.join(bac, 'donnees/cra.pid'),
    JSON.stringify({ pid: enfant.pid, port, demarreLe: new Date().toISOString() }) + '\n',
  )
  return enfant.pid!
}

function executer(script: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, CRA_RACINE: bac, ...env },
    encoding: 'utf8',
    timeout: 90_000,
  })
}

async function patienter(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

describe('arreter.mjs', () => {
  it(
    "arrête vraiment un serveur vivant qui n'écoute pas encore",
    async () => {
      // Le défaut C1 : la sonde de port répond « non » à tort, le script efface
      // le repère SANS tuer le serveur, et annonce l'arrêt. Le démarrage suivant
      // lance alors un second serveur sur le port suivant ; le premier devient un
      // orphelin qu'aucune commande ne peut plus désigner.
      serveurFactice({ ecoute: false })
      const port = await portLibrePourDeVrai()
      const pid = demarrerCommeLeLanceur(port)
      await patienter(300)
      expect(vivant(pid), 'le serveur doit être vivant avant l’arrêt').toBe(true)

      const r = executer(ARRETER)

      await patienter(300)
      expect(vivant(pid), `le serveur ${pid} survit à ./arreter.sh`).toBe(false)
      expect(existsSync(path.join(bac, 'donnees/cra.pid'))).toBe(false)
      expect(r.status).toBe(0)
    },
    30_000,
  )

  it(
    "arrête un serveur qui porte encore son nom d'origine",
    async () => {
      // L'autre moitié du cas réel : pendant les toutes premières secondes,
      // avant que Next ne se renomme, la ligne de commande porte le chemin de
      // l'installation. Les deux chemins de reconnaissance doivent marcher.
      serveurFactice({ ecoute: false, renomme: false })
      const port = await portLibrePourDeVrai()
      const pid = demarrerCommeLeLanceur(port)
      await patienter(300)

      executer(ARRETER)

      await patienter(300)
      expect(vivant(pid)).toBe(false)
    },
    30_000,
  )

  it(
    'arrête un serveur qui écoute, et rend la main',
    async () => {
      serveurFactice({ ecoute: true })
      const port = await portLibrePourDeVrai()
      const pid = demarrerCommeLeLanceur(port)
      await patienter(400)

      const r = executer(ARRETER)

      await patienter(300)
      expect(vivant(pid)).toBe(false)
      expect(r.stdout).toContain('Application arrêtée.')
      expect(existsSync(path.join(bac, 'donnees/cra.pid'))).toBe(false)
    },
    30_000,
  )

  it(
    "vient à bout d'un serveur qui ignore SIGTERM, et ne l'annonce qu'une fois fait",
    async () => {
      // C'est exactement ce que faisait le vrai `next-server` avant qu'on
      // demande à Next de rendre SIGTERM : le port se libérait, le processus
      // restait. Annoncer l'arrêt sur la foi du port était donc faux à chaque
      // arrêt, pas seulement dans les cas limites.
      writeFileSync(
        path.join(bac, 'app/server.js'),
        [
          "process.title = 'next-server (v15.5.23)'",
          "process.on('SIGTERM', () => {})",
          'setTimeout(() => {}, 120000)',
        ].join('\n') + '\n',
      )
      const port = await portLibrePourDeVrai()
      const pid = demarrerCommeLeLanceur(port)
      await patienter(300)

      const r = executer(ARRETER)

      await patienter(300)
      expect(vivant(pid)).toBe(false)
      expect(r.stdout).toContain('arrêt forcé')
      expect(r.stdout).toContain('Application arrêtée.')
      expect(existsSync(path.join(bac, 'donnees/cra.pid'))).toBe(false)
    },
    60_000,
  )

  it('nettoie un repère périmé quand le processus est bel et bien mort', async () => {
    const port = await portLibrePourDeVrai()
    // 2 est réservé au système et n'est jamais un serveur CRA ; on prend plutôt
    // un PID improbable et libre.
    writeFileSync(
      path.join(bac, 'donnees/cra.pid'),
      JSON.stringify({ pid: 999_999, port, demarreLe: new Date().toISOString() }) + '\n',
    )

    const r = executer(ARRETER)

    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/n['’]était plus en cours d['’]exécution/)
    expect(existsSync(path.join(bac, 'donnees/cra.pid'))).toBe(false)
  })

  it(
    "ne tue pas le programme de quelqu'un d'autre quand le PID a été recyclé",
    async () => {
      // Un PID est recyclé par le système : celui inscrit dans le repère peut
      // désigner aujourd'hui un tout autre programme. Le tuer serait pire que
      // le défaut qu'on corrige. Le repère date d'il y a trois heures ; le
      // programme qui porte ce numéro vient, lui, de démarrer.
      const etranger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
        detached: true,
        stdio: 'ignore',
      })
      etranger.unref()
      aTuer.push(etranger.pid!)
      const port = await portLibrePourDeVrai()
      writeFileSync(
        path.join(bac, 'donnees/cra.pid'),
        JSON.stringify({
          pid: etranger.pid,
          port,
          demarreLe: new Date(Date.now() - 3 * 3600_000).toISOString(),
        }) + '\n',
      )
      await patienter(300)

      const r = executer(ARRETER)

      await patienter(300)
      expect(vivant(etranger.pid!), "le programme étranger a été tué").toBe(true)
      expect(existsSync(path.join(bac, 'donnees/cra.pid'))).toBe(false)
      expect(r.status).toBe(0)
    },
    30_000,
  )
})

describe('lancer.mjs', () => {
  it(
    'refuse de démarrer deux fois quand notre serveur tourne déjà',
    async () => {
      serveurFactice({ ecoute: true })
      const port = await portLibrePourDeVrai()
      demarrerCommeLeLanceur(port)
      await patienter(400)

      const r = executer(LANCER)

      expect(r.stdout).toContain('tourne déjà')
      expect(r.status).toBe(0)
    },
    30_000,
  )

  it(
    "ne prend pas le serveur d'un autre programme pour le nôtre",
    async () => {
      // M5 : un repère périmé sur le port 3000 et un autre programme sur ce
      // port, et `demarrer.sh` envoyait la personne vers l'application de
      // quelqu'un d'autre en affirmant que CRA y tournait — sans lui laisser
      // aucune commande pour démarrer CRA.
      const port = await portLibrePourDeVrai()
      const squatteur = net.createServer()
      await new Promise<void>((r) => squatteur.listen(port, '127.0.0.1', () => r()))
      try {
        writeFileSync(
          path.join(bac, 'donnees/cra.pid'),
          JSON.stringify({ pid: 999_999, port, demarreLe: new Date().toISOString() }) + '\n',
        )
        mkdirSync(path.join(bac, 'app/prisma'), { recursive: true })
        cpSync(JEU_REEL, path.join(bac, 'app/prisma/migrations-sqlite'), { recursive: true })
        serveurFactice({ ecoute: true })

        const r = executer(LANCER, { CRA_PORT: String(await portLibrePourDeVrai()) })

        expect(r.stdout).not.toContain('tourne déjà')
        expect(r.stdout).toContain('CRA est démarré')
      } finally {
        await new Promise<void>((r) => squatteur.close(() => r()))
        const apres = executer(ARRETER)
        expect(apres.status).toBe(0)
      }
    },
    120_000,
  )

  it(
    'démarre puis arrête proprement, en laissant la base intacte',
    async () => {
      // Le trajet complet du porteur, de bout en bout, sur une vraie base
      // SQLite migrée par le vrai code de production.
      mkdirSync(path.join(bac, 'app/prisma'), { recursive: true })
      cpSync(JEU_REEL, path.join(bac, 'app/prisma/migrations-sqlite'), { recursive: true })
      serveurFactice({ ecoute: true })
      const port = await portLibrePourDeVrai()

      const depart = executer(LANCER, { CRA_PORT: String(port) })
      expect(depart.stdout, depart.stderr).toContain('CRA est démarré')
      expect(existsSync(path.join(bac, 'donnees/cra.db'))).toBe(true)

      const arret = executer(ARRETER)
      expect(arret.stdout).toContain('Application arrêtée.')
      expect(existsSync(path.join(bac, 'donnees/cra.pid'))).toBe(false)
      // La base survit à l'aller-retour : c'est la promesse même du porteur.
      expect(existsSync(path.join(bac, 'donnees/cra.db'))).toBe(true)

      // Et le second démarrage réutilise la même base, sans en créer une seconde.
      const relance = executer(LANCER, { CRA_PORT: String(port) })
      expect(relance.stdout).toContain('CRA est démarré')
      expect(relance.stdout).not.toContain('migration(s) appliquée(s)')
      executer(ARRETER)
    },
    120_000,
  )

  it(
    'demande à Next de ne pas confisquer SIGTERM, sans quoi rien ne s arrête',
    async () => {
      // Mesuré sur l'archive réelle : avec le gestionnaire de Next, le
      // `next-server` était TOUJOURS VIVANT 25 secondes après SIGTERM — le port
      // se libère, le processus non. Sans cette variable, `./arreter.sh` attend
      // dix secondes puis tue de force, à chaque arrêt.
      mkdirSync(path.join(bac, 'app/prisma'), { recursive: true })
      cpSync(JEU_REEL, path.join(bac, 'app/prisma/migrations-sqlite'), { recursive: true })
      serveurFactice({ ecoute: true })
      const port = await portLibrePourDeVrai()

      executer(LANCER, { CRA_PORT: String(port) })
      const recu = JSON.parse(readFileSync(path.join(bac, 'donnees/env-recu.json'), 'utf8'))

      expect(recu.NEXT_MANUAL_SIG_HANDLE).toBe('1')
      // Et la base du serveur est bien celle de l'installation, en connexion unique.
      expect(recu.DATABASE_URL).toBe(`file:${path.join(bac, 'donnees/cra.db')}?connection_limit=1`)
      executer(ARRETER)
    },
    120_000,
  )
})
