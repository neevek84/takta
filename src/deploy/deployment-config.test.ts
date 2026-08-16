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

/** Les sources de production : les tests ont le droit de poser une variable. */
function sourcesDeProduction(dossier = path.join(RACINE, 'src')): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name)
    if (entree.isDirectory()) out.push(...sourcesDeProduction(chemin))
    else if (/\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) out.push(chemin)
  }
  return out
}

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

  it.each(['AUTH_SECRET', 'CREDENTIALS_KEY', 'SYNC_FLUSH_TOKEN'])(
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
    // Le déclenchement externe est optionnel : une installation qui n'expose
    // rien à l'extérieur est un état légitime, pas une panne. Le rendre
    // obligatoire empêcherait de démarrer une installation qui n'en veut pas.
    for (const nom of ['SYNC_FLUSH_TOKEN', 'CRA_API_TOKEN']) {
      expect(valeurCompose(nom) ?? '', `${nom} ne doit pas bloquer le démarrage`).not.toContain(':?')
    }
  })
})

// La règle du lot « configuration application vs environnement » : **si
// l'utilisateur doit taper la valeur, elle n'a rien à faire dans un fichier**.
//
// Le client OAuth Google et le fuseau horaire se saisissent à l'écran et
// vivent en base — le premier chiffré, comme la clé d'API Dolibarr. Les
// remettre dans un fichier n'annulerait pas seulement le déplacement : cela
// rendrait de nouveau le secret du client lisible par quiconque ouvre le
// fichier, alors qu'en base il exige AUSSI `CREDENTIALS_KEY`.
//
// Ce garde-fou est statique parce que la régression l'est : personne ne
// remarque une ligne réapparue dans un `.env.example`, et aucun test unitaire
// ne regarde ces fichiers.
describe("les valeurs saisies par l'utilisateur ne reviennent pas dans un fichier", () => {
  const DEPLACEES = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'CRA_TIMEZONE',
  ]

  it.each(DEPLACEES)('%s ne figure pas dans .env.example', (nom) => {
    const declarees = lignesActives(ENV_EXAMPLE)
      .map((l) => /^([A-Z_][A-Z0-9_]*)=/.exec(l)?.[1] ?? '')
      .filter((n) => n !== '')
    expect(declarees, `${nom} se saisit à l'écran : il n'a rien à faire dans un fichier`).not.toContain(nom)
  })

  it.each(DEPLACEES)('%s n est plus injectée par docker-compose', (nom) => {
    expect(valeurCompose(nom), `${nom} ne doit plus être transmise au conteneur`).toBeNull()
  })

  it.each(DEPLACEES)('%s n est plus lue nulle part dans le code de production', (nom) => {
    // La contrepartie du garde-fou : retirer la variable des fichiers ne sert
    // à rien si le code continue de la lire — le déplacement serait à moitié
    // fait, et un `.env` oublié suffirait à faire fonctionner l'écran « par
    // hasard » sur un poste et pas sur un autre.
    const fautifs = sourcesDeProduction().filter((chemin) =>
      readFileSync(chemin, 'utf8').includes(`process.env.${nom}`),
    )
    expect(fautifs.map((c) => path.relative(RACINE, c))).toEqual([])
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
    for (const nom of ['AUTH_SECRET', 'CREDENTIALS_KEY', 'SYNC_FLUSH_TOKEN', 'SIGNATURE_WEBHOOK_SECRET']) {
      const brut: string = new RegExp(`^${nom}=(.*)$`, 'm').exec(ENV_EXAMPLE)?.[1] ?? ''
      const valeur = brut.replace(/^"|"$/g, '')
      const factice = valeur === '' || /remplacer|exemple|changeme|xxx/i.test(valeur)
      expect(factice, `${nom} de .env.example doit rester vide ou manifestement factice`).toBe(true)
    }
  })
})
