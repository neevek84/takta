import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Garde-fou anti-dérive sur la configuration de déploiement.
//
// Contexte : aucun test unitaire ne regarde `Dockerfile`, `docker-compose.yml`
// ni `.dockerignore`. Deux défauts établis par la revue en découlent :
//
//   - le `docker-compose.yml` n'injectait aucune des variables du connecteur
//     Google ni `CREDENTIALS_KEY`, alors que `docker compose up` est le seul
//     chemin serveur documenté — la connexion Google était donc impossible à
//     activer, suite verte ;
//   - le `Dockerfile` ne copiait pas `public/`, créé après lui : le manifeste,
//     le service worker et les icônes renvoyaient 404 dans l'image, ce qui
//     défait le correctif d'installabilité, suite verte.
//
// Ces deux familles se ressemblent : un fichier de configuration absent ou
// incomplet ne fait tomber aucun test unitaire. Ce fichier lit donc les
// fichiers réels en pur texte — pas de Docker, pas de démarrage de conteneur,
// utilisable partout.

const RACINE = path.resolve(__dirname, '../..')

function lit(nom: string): string {
  return readFileSync(path.join(RACINE, nom), 'utf8')
}

/** Lignes utiles d'un fichier : les commentaires `#` ne configurent rien. */
function lignesActives(contenu: string): string[] {
  return contenu
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
}

const DOCKERFILE = lit('Dockerfile')
const COMPOSE = lit('docker-compose.yml')
const DOCKERIGNORE = lit('.dockerignore')
const ENV_EXAMPLE = lit('.env.example')

/**
 * Noms de variables déclarés (non commentés) par `.env.example`. C'est le
 * contrat documenté de l'installation : tout ce qui est là doit pouvoir être
 * fourni au conteneur.
 */
function variablesDocumentees(): string[] {
  const noms = lignesActives(ENV_EXAMPLE)
    .map((l) => /^([A-Z_][A-Z0-9_]*)=/.exec(l)?.[1] ?? '')
    .filter((n) => n !== '')
  return [...new Set(noms)]
}

/** Bloc `environment:` du service `app` du docker-compose, en lignes. */
function environnementApp(): string[] {
  const lignes = COMPOSE.split('\n')
  const debutApp = lignes.findIndex((l) => /^\s{2}app:\s*$/.test(l))
  expect(debutApp, 'le service `app` doit exister dans docker-compose.yml').toBeGreaterThan(-1)

  const debutEnv = lignes.findIndex((l, i) => i > debutApp && /^\s{4}environment:\s*$/.test(l))
  expect(debutEnv, 'le service `app` doit porter un bloc `environment:`').toBeGreaterThan(-1)

  const out: string[] = []
  for (let i = debutEnv + 1; i < lignes.length; i++) {
    const ligne = lignes[i] ?? ''
    if (ligne.trim() === '') continue
    // Sortie du bloc dès qu'on remonte au niveau d'indentation d'une clé de
    // service (moins de 6 espaces avec du contenu).
    if (!/^\s{6}/.test(ligne)) break
    out.push(ligne.trim())
  }
  return out
}

/** Valeur brute déclarée pour `nom` dans le bloc `environment:` du service app. */
function valeurCompose(nom: string): string | null {
  for (const ligne of environnementApp()) {
    const m = new RegExp(`^${nom}\\s*:\\s*(.*)$`).exec(ligne)
    if (m !== null) return (m[1] ?? '').trim()
  }
  return null
}

describe('docker-compose.yml — les variables documentées atteignent le conteneur', () => {
  it.each(variablesDocumentees())(
    '%s est transmise au service app',
    (nom) => {
      // `docker compose` ne propage RIEN de l'environnement de l'hôte tout
      // seul, et `.dockerignore` exclut `.env` : une variable absente d'ici
      // est une variable qui n'existe pas dans le conteneur.
      expect(valeurCompose(nom), `${nom} manque au bloc environment: du service app`).not.toBeNull()
    },
  )

  it.each(['AUTH_SECRET', 'CREDENTIALS_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SYNC_FLUSH_TOKEN'])(
    '%s vient de l environnement, jamais écrite en dur dans le fichier committé',
    (nom) => {
      const valeur = valeurCompose(nom) ?? ''
      expect(valeur, `${nom} doit être interpolée depuis l'environnement`).toMatch(
        new RegExp(`^"?\\$\\{${nom}[:?-]`),
      )
    },
  )

  it('rend AUTH_SECRET et CREDENTIALS_KEY obligatoires plutôt que silencieusement vides', () => {
    // `${VAR:?message}` fait échouer `docker compose up` en nommant la
    // variable. Sans cela, `CREDENTIALS_KEY` absente ne se manifeste qu'au
    // moment du retour de consentement Google, très loin du déploiement.
    expect(valeurCompose('AUTH_SECRET') ?? '').toContain(':?')
    expect(valeurCompose('CREDENTIALS_KEY') ?? '').toContain(':?')
  })

  it('laisse les variables purement optionnelles démarrer à vide', () => {
    // Le connecteur Google est optionnel : une installation sans identifiants
    // Google est un état légitime, pas une panne. Les rendre obligatoires
    // empêcherait de démarrer une installation qui n'en veut pas.
    for (const nom of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SYNC_FLUSH_TOKEN']) {
      expect(valeurCompose(nom) ?? '', `${nom} ne doit pas bloquer le démarrage`).not.toContain(':?')
    }
  })
})

describe('Dockerfile — l image embarque ce que le serveur sert', () => {
  const fichiersPublics = readdirSync(path.join(RACINE, 'public'))

  it('le dossier public/ n est pas vide (sinon ce garde-fou ne garde rien)', () => {
    expect(fichiersPublics.length).toBeGreaterThan(0)
  })

  it('copie public/ dans l étage final', () => {
    // `output: 'standalone'` ne trace pas les fichiers statiques : sans ce
    // COPY, manifeste, service worker et icônes renvoient 404 dans l'image —
    // le manifeste n'est jamais analysé, le service worker jamais enregistré,
    // et l'invite « Installer l'application » n'apparaît pas.
    const copies = lignesActives(DOCKERFILE).filter((l) => l.startsWith('COPY '))
    expect(copies.some((l) => /\/app\/public\s+\.\/public\s*$/.test(l))).toBe(true)
  })

  it.each(['/manifest.webmanifest', '/sw.js', '/icon.svg', '/apple-touch-icon.png'])(
    '%s, laissé passer sans session par le middleware, existe bien dans public/',
    (chemin) => {
      // Le middleware ouvre ces quatre chemins précisément pour rendre
      // l'application installable. Un fichier absent de `public/` transforme
      // cette exception en trou : une URL ouverte qui ne sert rien.
      expect(fichiersPublics).toContain(chemin.slice(1))
    },
  )
})

describe('le .env de développement ne part pas dans l image', () => {
  it('.dockerignore exclut .env', () => {
    // `next build` recopie le `.env` du dépôt dans `.next/standalone` : sans
    // cette exclusion, l'image embarquerait le secret d'authentification et la
    // clé de chiffrement de développement, donc les mêmes chez tout le monde.
    expect(lignesActives(DOCKERIGNORE)).toContain('.env')
  })

  it('.env.example ne porte aucune valeur de secret exploitable', () => {
    for (const nom of ['AUTH_SECRET', 'CREDENTIALS_KEY', 'GOOGLE_CLIENT_SECRET', 'SYNC_FLUSH_TOKEN']) {
      const brut: string = new RegExp(`^${nom}=(.*)$`, 'm').exec(ENV_EXAMPLE)?.[1] ?? ''
      const valeur = brut.replace(/^"|"$/g, '')
      const factice = valeur === '' || /remplacer|exemple|changeme|xxx/i.test(valeur)
      expect(factice, `${nom} de .env.example doit rester vide ou manifestement factice`).toBe(true)
    }
  })
})
