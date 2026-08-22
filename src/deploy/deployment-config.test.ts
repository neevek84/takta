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
const COMPOSE_PROD = lit('docker-compose.prod.yml')
const DOCKERIGNORE = lit('.dockerignore')
const ENV_EXAMPLE = lit('.env.example')

/**
 * Variables que **la composition** consomme, et que l'application ne lit
 * jamais. Elles se documentent dans `.env.example` — il faut bien que le
 * porteur sache les renseigner — mais elles n'ont rien à faire dans le bloc
 * `environment:` du service applicatif.
 *
 * `POSTGRES_PASSWORD` en est le seul cas : le service `db` s'en sert pour
 * créer son compte, et la composition la compose dans `DATABASE_URL`. Le code
 * de l'application, lui, ne connaît que `DATABASE_URL`. La passer au service
 * applicatif y ferait entrer un secret dont il n'a aucun usage.
 */
const HORS_APPLICATION = new Set(['POSTGRES_PASSWORD'])

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

/** Les mêmes, moins celles que l'application ne lit jamais. */
function variablesDeLApplication(): string[] {
  return variablesDocumentees().filter((n) => !HORS_APPLICATION.has(n))
}

/** Bloc `environment:` du service `app`, en lignes, dans la composition donnée. */
function environnementApp(compose: string = COMPOSE): string[] {
  const lignes = compose.split('\n')
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
function valeurCompose(nom: string, compose: string = COMPOSE): string | null {
  for (const ligne of environnementApp(compose)) {
    const m = new RegExp(`^${nom}\\s*:\\s*(.*)$`).exec(ligne)
    if (m !== null) return (m[1] ?? '').trim()
  }
  return null
}

describe('docker-compose.yml — les variables documentées atteignent le conteneur', () => {
  it.each(variablesDeLApplication())(
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
    //
    // La question posée est l'EFFET du fichier, pas la présence d'une ligne :
    // chercher le texte `.env` restait vert alors même que `prisma/dev.db`,
    // couvert par une ligne tout aussi présente, entrait dans l'image.
    expect(ignoreParDocker('.env')).toBe(true)
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

/**
 * Sémantique réelle de `.dockerignore`, reproduite ici.
 *
 * Elle n'est PAS celle de `.gitignore`, et c'est toute l'affaire : un motif sans
 * barre oblique y est **ancré à la racine du contexte**, et `*` ne franchit
 * jamais un `/` (BuildKit applique `filepath.Match` segment par segment, `**`
 * étant le seul joker qui traverse les dossiers). `*.db` protège donc
 * correctement le dépôt git — où le même motif s'applique à toute profondeur —
 * et ne protège pas l'image : `prisma/dev.db` entrait dans le contexte, puis
 * dans l'étage final par `COPY --from=builder /app/prisma ./prisma`.
 *
 * C'est cette asymétrie qui rendait le défaut invisible : la même ligne, lue par
 * deux outils, ne veut pas dire la même chose.
 */
function ignoreParDocker(chemin: string): boolean {
  const enRegex = (motif: string): RegExp => {
    const corps = motif
      .split('/')
      .map((segment) =>
        segment === '**'
          ? '(?:[^/]+/)*[^/]*'
          : segment
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '[^/]*')
              .replace(/\?/g, '[^/]'),
      )
      .join('/')
      .replace(/\(\?:\[\^\/\]\+\/\)\*\[\^\/\]\*\//g, '(?:[^/]+/)*')
    return new RegExp(`^${corps}$`)
  }

  const motifs = lignesActives(DOCKERIGNORE)
  // Un motif qui exclut un dossier exclut tout ce qu'il contient : on teste
  // donc le chemin ET chacun de ses préfixes.
  const segments = chemin.split('/')
  const prefixes = segments.map((_, i) => segments.slice(0, i + 1).join('/'))
  return motifs.some((motif) => prefixes.some((p) => enRegex(motif).test(p)))
}

describe("l'image Docker n'emporte pas la base de développement", () => {
  it('reproduit fidèlement la sémantique qui a laissé passer le défaut', () => {
    // Sans cette vérification, le reste du bloc ne prouverait rien : un
    // « matcher » trop permissif rendrait tout exclu, donc tout vert.
    expect(ignoreParDocker('prisma/schema.prisma')).toBe(false)
    expect(ignoreParDocker('package.json')).toBe(false)
    expect(ignoreParDocker('src/db/client.ts')).toBe(false)
    expect(ignoreParDocker('.git/config')).toBe(true)
    expect(ignoreParDocker('node_modules/next/package.json')).toBe(true)
  })

  it.each([
    'prisma/dev.db',
    'prisma/test-90254.db',
    'prisma/dev.db-wal',
    'prisma/dev.db-shm',
    'donnees/cra.db',
  ])('%s reste hors du contexte de construction', (chemin) => {
    // Mesuré par la revue sur `prisma/dev.db` : 320 Ko contenant un utilisateur
    // avec son hash argon2, deux clients et deux missions — les données réelles
    // de qui construit l'image, livrées à qui la reçoit.
    expect(ignoreParDocker(chemin), `${chemin} entre dans l'image`).toBe(true)
  })

  it.each(['.env', '.env.local', '.next-rev56/standalone/.env', 'donnees/cra.env'])(
    '%s reste hors du contexte de construction',
    (chemin) => {
      // `next build` recopie le `.env` du dépôt dans sa sortie standalone, et
      // `distDir` est arbitraire (`CRA_DIST_DIR`) : énumérer `.next` et
      // `.next-dist` par leur nom ne suffit pas.
      expect(ignoreParDocker(chemin), `${chemin} entre dans l'image`).toBe(true)
    },
  )

  it('laisse entrer ce dont la construction a besoin', () => {
    for (const chemin of [
      'prisma/schema.prisma',
      'prisma/migrations/migration_lock.toml',
      'prisma/migrations-sqlite/migration_lock.toml',
      'src/instrumentation.ts',
      'next.config.ts',
      'public/manifest.webmanifest',
    ]) {
      expect(ignoreParDocker(chemin), `${chemin} manquerait à la construction`).toBe(false)
    }
  })
})

/**
 * La composition de **production** est celle qui sera réellement déployée, et
 * c'est elle qui recevra les mises à jour. Une variable qui lui manque ne se
 * découvrirait qu'au démarrage du conteneur, chez le porteur, après un clic sur
 * « Mettre à jour » — c'est-à-dire au pire moment.
 */
describe('docker-compose.prod.yml — la composition qui sera déployée', () => {
  it.each(variablesDeLApplication())('%s est transmise au service app', (nom) => {
    expect(
      valeurCompose(nom, COMPOSE_PROD),
      `${nom} manque au bloc environment: du service app de production`,
    ).not.toBeNull()
  })

  it.each(['AUTH_SECRET', 'CREDENTIALS_KEY'])(
    '%s vient de l environnement, jamais écrite en dur',
    (nom) => {
      expect(valeurCompose(nom, COMPOSE_PROD) ?? '').toMatch(/\$\{/)
    },
  )

  // `build:` construirait sur place, et une composition qui construit ne reçoit
  // jamais de mise à jour : Container Manager surveille un registre, pas un
  // Dockerfile local. C'est toute la raison d'être de ce second fichier.
  it('tire une image publiée, elle ne la construit pas', () => {
    expect(COMPOSE_PROD).toMatch(/^\s{4}image:\s*\S+\/takta:latest\s*$/m)
    expect(lignesActives(COMPOSE_PROD).some((l) => l.startsWith('build:'))).toBe(false)
  })

  // Un volume anonyme serait recréé vide à chaque recréation du conteneur —
  // c'est-à-dire à chaque mise à jour. Les données doivent survivre au clic.
  it('range les données dans un volume nommé, qui survit à la mise à jour', () => {
    expect(COMPOSE_PROD).toMatch(/db-data:\/var\/lib\/postgresql\/data/)
    expect(COMPOSE_PROD).toMatch(/^volumes:\s*$/m)
  })

  // Une migration s'applique au démarrage : une mise à jour qui la rate laisse
  // le service arrêté. Sans sauvegarde, il n'y a pas de retour en arrière.
  it('emporte une sauvegarde, et elle est logique et non un copie de fichiers', () => {
    expect(COMPOSE_PROD).toMatch(/pg_dump/)
    expect(COMPOSE_PROD).not.toMatch(/cp -r .*postgresql\/data/)
  })
})

/**
 * Le contrôle **en sens inverse**, et il manquait.
 *
 * Les contrôles précédents vérifient que tout ce que `.env.example` documente
 * atteint le conteneur. Rien ne vérifiait le contraire : une variable réclamée
 * par une composition et **absente du fichier d'exemple** est une variable que
 * personne ne pense à renseigner — l'installation refuse alors de démarrer sur
 * un nom que le porteur n'a jamais vu.
 *
 * C'est arrivé le 22 août 2026 : `POSTGRES_PASSWORD` a été introduit dans la
 * composition de production sans être documenté, et c'est le porteur qui l'a
 * remarqué en lisant le fichier.
 */
describe('les compositions ne réclament rien que .env.example ne documente', () => {
  /** Noms interpolés depuis l'environnement dans une composition. */
  function variablesReclamees(compose: string): string[] {
    const noms = [...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)]
      .map((m) => m[1])
      .filter((n): n is string => n !== undefined)
    return [...new Set(noms)]
  }

  it.each([
    ['docker-compose.yml', COMPOSE],
    ['docker-compose.prod.yml', COMPOSE_PROD],
  ])('%s ne réclame que des variables documentées', (nom, compose) => {
    const documentees = new Set(variablesDocumentees())
    const orphelines = variablesReclamees(compose).filter((v) => !documentees.has(v))

    expect(
      orphelines,
      `${nom} réclame ${orphelines.join(', ')} — absente(s) de .env.example, ` +
        'donc invisible(s) pour qui installe',
    ).toEqual([])
  })
})

/**
 * Les deux fichiers **prêts à l'emploi**, un par cible d'installation.
 *
 * `.env.example` liste tout, y compris ce qui ne vaut que pour une cible : le
 * porteur l'a lu et l'a trouvé incompréhensible, à juste titre — il y voisinait
 * « la composition fabrique DATABASE_URL » et une ligne `DATABASE_URL=`. Soit on
 * la met, soit on ne la met pas. Ces deux fichiers-ci tranchent, chacun pour sa
 * cible, et ces contrôles refusent qu'ils se remettent à mentir.
 */
describe("les fichiers d'environnement prêts à l'emploi", () => {
  const DOCKER = lit('.env.docker.example')
  const LOCAL = lit('.env.local.example')

  function declarees(contenu: string): string[] {
    return lignesActives(contenu)
      .map((l) => /^([A-Z_][A-Z0-9_]*)=/.exec(l)?.[1] ?? '')
      .filter((n) => n !== '')
  }

  // Une variable réclamée par la composition et absente du fichier qu'on dit
  // « prêt à l'emploi » est une installation qui refuse de démarrer.
  it('celui du conteneur couvre tout ce que la composition de production réclame', () => {
    const reclamees = [...COMPOSE_PROD.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)]
      .map((m) => m[1])
      .filter((n): n is string => n !== undefined)
    const presentes = new Set(declarees(DOCKER))

    expect([...new Set(reclamees)].filter((v) => !presentes.has(v))).toEqual([])
  })

  // C'est toute la raison d'être du découpage : la composition fabrique
  // `DATABASE_URL`, donc la proposer ici ferait renseigner une valeur ignorée.
  it("celui du conteneur ne propose pas DATABASE_URL, que la composition fabrique", () => {
    expect(declarees(DOCKER)).not.toContain('DATABASE_URL')
  })

  // Symétriquement : hors conteneur, il n'y a pas de serveur Postgres à qui
  // donner un mot de passe.
  it('celui du poste local ne propose pas POSTGRES_PASSWORD', () => {
    expect(declarees(LOCAL)).not.toContain('POSTGRES_PASSWORD')
    expect(declarees(LOCAL)).toContain('DATABASE_URL')
  })

  // Les deux exigent les mêmes secrets d'installation : les oublier dans l'un
  // ferait une cible qui ne démarre pas.
  it.each(['AUTH_SECRET', 'CREDENTIALS_KEY'])('%s figure dans les deux', (nom) => {
    expect(declarees(DOCKER)).toContain(nom)
    expect(declarees(LOCAL)).toContain(nom)
  })

  // Aucune valeur ne doit être livrée remplie : un secret d'exemple finit en
  // production, et il est le même chez tout le monde.
  it.each([
    ['.env.docker.example', DOCKER],
    ['.env.local.example', LOCAL],
  ])('%s ne livre aucun secret pré-rempli', (nom, contenu) => {
    const remplis = lignesActives(contenu).filter((l) =>
      /^(AUTH_SECRET|CREDENTIALS_KEY|POSTGRES_PASSWORD)="?.+"?$/.test(l.replace(/=""$/, '=')),
    )
    expect(remplis, `${nom} livre une valeur toute faite`).toEqual([])
  })
})

