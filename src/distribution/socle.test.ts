import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { parseKey } from '@/core/crypto/secret-box'
import {
  racineDeLInstallation,
  chemins,
  creerDossierDonnees,
} from '../../outils/lib/chemins.mjs'
import { chargerOuCreerEnv, SECRETS_ENGENDRES } from '../../outils/lib/env.mjs'
import {
  portLibre,
  choisirPort,
  resoudrePort,
  messageBascule,
  PORT_PREFERE,
} from '../../outils/lib/port.mjs'
import {
  lireFichierPid,
  quelquUnEcoute,
  etatDuProcessus,
  processusVivant,
  ancienneteEnMs,
} from '../../outils/lib/processus.mjs'

let bac = ''

beforeEach(() => {
  bac = mkdtempSync(path.join(tmpdir(), 'cra-socle-'))
  delete process.env.CRA_RACINE
})

afterEach(() => {
  delete process.env.CRA_RACINE
  rmSync(bac, { recursive: true, force: true })
})

describe('racineDeLInstallation', () => {
  it('honore CRA_RACINE en priorité', () => {
    process.env.CRA_RACINE = bac
    expect(racineDeLInstallation('/nulle/part/lancer.mjs')).toBe(path.resolve(bac))
  })

  it('remonte jusqu au dossier portant LISEZMOI.txt', () => {
    mkdirSync(path.join(bac, 'app/outils/lib'), { recursive: true })
    writeFileSync(path.join(bac, 'LISEZMOI.txt'), 'coucou')
    const depuis = path.join(bac, 'app/outils/lib/chemins.mjs')
    expect(racineDeLInstallation(depuis)).toBe(bac)
  })

  it('échoue clairement plutôt que de deviner', () => {
    mkdirSync(path.join(bac, 'a/b'), { recursive: true })
    expect(() => racineDeLInstallation(path.join(bac, 'a/b/x.mjs'))).toThrow(/racine/i)
  })
})

describe('chemins', () => {
  it('place toutes les données sous donnees/', () => {
    const c = chemins(bac)
    for (const p of [c.base, c.pid, c.env, c.journal, c.sauvegardes]) {
      expect(p.startsWith(c.donnees + path.sep)).toBe(true)
    }
    expect(c.donnees).toBe(path.join(bac, 'donnees'))
    expect(c.migrations).toBe(path.join(bac, 'app', 'prisma', 'migrations-sqlite'))
  })

  it('crée donnees/ et donnees/sauvegardes/ sans se plaindre deux fois', () => {
    const c = chemins(bac)
    creerDossierDonnees(c)
    creerDossierDonnees(c)
    expect(existsSync(c.donnees)).toBe(true)
    expect(existsSync(c.sauvegardes)).toBe(true)
  })
})

describe('chargerOuCreerEnv', () => {
  it('engendre les trois secrets la première fois', () => {
    // AUTH_SECRET seul ne suffit pas : sans CREDENTIALS_KEY propre à
    // l'installation, l'archive diffuserait la clé de développement — et avec
    // elle le moyen de déchiffrer tous les jetons Google stockés en base.
    const f = path.join(bac, 'cra.env')
    const env = chargerOuCreerEnv(f)

    expect(SECRETS_ENGENDRES).toEqual(['AUTH_SECRET', 'CREDENTIALS_KEY', 'SYNC_FLUSH_TOKEN'])
    for (const nom of SECRETS_ENGENDRES) {
      expect(env[nom]!.length, `${nom} doit être engendré`).toBeGreaterThanOrEqual(40)
      expect(readFileSync(f, 'utf8')).toContain(`${nom}=`)
    }
  })

  it('engendre une CREDENTIALS_KEY que le chiffrement réel accepte', () => {
    // `parseKey` refuse tout ce qui n'est pas exactement 32 octets en base64
    // canonique. Une clé engendrée au mauvais format ne se manifesterait qu'au
    // retour de consentement Google, très loin du premier démarrage.
    const env = chargerOuCreerEnv(path.join(bac, 'cra.env'))
    expect(parseKey(env.CREDENTIALS_KEY!).length).toBe(32)
  })

  it('rend EXACTEMENT les mêmes secrets au démarrage suivant', () => {
    // Un secret régénéré à chaque lancement déconnecterait tout le monde à
    // chaque redémarrage, et une CREDENTIALS_KEY régénérée rendrait
    // définitivement illisibles les jetons déjà chiffrés — l'application
    // deviendrait celle qu'on n'ose pas éteindre.
    const f = path.join(bac, 'cra.env')
    const premier = chargerOuCreerEnv(f)
    const second = chargerOuCreerEnv(f)
    for (const nom of SECRETS_ENGENDRES) expect(second[nom]).toBe(premier[nom])
  })

  it('écrit le fichier en lecture propriétaire seule', () => {
    const f = path.join(bac, 'cra.env')
    chargerOuCreerEnv(f)
    expect(statSync(f).mode & 0o077).toBe(0)
  })

  it('regénère un secret si le fichier existe mais est vide', () => {
    const f = path.join(bac, 'cra.env')
    writeFileSync(f, '# rien\n')
    const env = chargerOuCreerEnv(f)
    for (const nom of SECRETS_ENGENDRES) {
      expect(env[nom]!.length).toBeGreaterThanOrEqual(40)
    }
  })

  it("complète un fichier d'une version antérieure sans toucher à l'existant", () => {
    // Cas réel de la mise à jour : une installation démarrée avant ce lot n'a
    // qu'AUTH_SECRET. Le compléter est indispensable ; le réécrire
    // déconnecterait la personne au moment même où elle met à jour.
    const f = path.join(bac, 'cra.env')
    writeFileSync(f, 'AUTH_SECRET=un-secret-deja-en-place-quon-ne-touche-pas\n', { mode: 0o600 })

    const env = chargerOuCreerEnv(f)

    expect(env.AUTH_SECRET).toBe('un-secret-deja-en-place-quon-ne-touche-pas')
    expect(env.CREDENTIALS_KEY!.length).toBeGreaterThanOrEqual(40)
    expect(env.SYNC_FLUSH_TOKEN!.length).toBeGreaterThanOrEqual(40)
    expect(chargerOuCreerEnv(f).CREDENTIALS_KEY).toBe(env.CREDENTIALS_KEY)
  })

  it('conserve les variables ajoutées à la main, et leurs commentaires', () => {
    // C'est dans ce fichier que se configure le connecteur Google : le
    // réécrire de zéro effacerait la configuration de la personne.
    const f = path.join(bac, 'cra.env')
    writeFileSync(f, '# mon connecteur\nGOOGLE_CLIENT_ID=abc.apps.googleusercontent.com\n', {
      mode: 0o600,
    })

    const env = chargerOuCreerEnv(f)
    const contenu = readFileSync(f, 'utf8')

    expect(env.GOOGLE_CLIENT_ID).toBe('abc.apps.googleusercontent.com')
    expect(contenu).toContain('# mon connecteur')
    expect(contenu).toContain('GOOGLE_CLIENT_ID=abc.apps.googleusercontent.com')
  })

  it('ne rend jamais un secret vide pour un secret déclaré vide', () => {
    // `SYNC_FLUSH_TOKEN=` (vide) est le réglage documenté côté serveur, mais
    // ici il signifierait « pas de jeton du tout » : on le remplit.
    const f = path.join(bac, 'cra.env')
    writeFileSync(f, 'SYNC_FLUSH_TOKEN=\n', { mode: 0o600 })
    expect(chargerOuCreerEnv(f).SYNC_FLUSH_TOKEN!.length).toBeGreaterThanOrEqual(40)
  })

  it('ne régénère RIEN quand le Bloc-notes Windows a réenregistré le fichier en CRLF', () => {
    // Le seul geste qui modifie ce fichier est celui de la personne : elle
    // l'ouvre pour ajouter une variable. Sous Windows, l'enregistrer convertit
    // tout le fichier en CRLF, sans un mot. Une ligne non reconnue passait pour
    // un secret absent : les trois étaient régénérés, et la CREDENTIALS_KEY
    // neuve rendait DÉFINITIVEMENT illisibles les jetons Google et la clé
    // Dolibarr déjà chiffrés.
    const f = path.join(bac, 'cra.env')
    const avant = chargerOuCreerEnv(f)
    const enCrlf = readFileSync(f, 'utf8').replace(/\r?\n/g, '\r\n')
    writeFileSync(f, `${enCrlf}SMTP_PASSWORD=ajoute-a-la-main\r\n`, { mode: 0o600 })

    const apres = chargerOuCreerEnv(f)

    for (const nom of SECRETS_ENGENDRES) {
      expect(apres[nom], `${nom} a été régénéré par un simple retour chariot`).toBe(avant[nom])
    }
    expect(apres.SMTP_PASSWORD).toBe('ajoute-a-la-main')
    // Et rien n'a été réécrit : le fichier ne gagne aucune ligne.
    expect(readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean)).toHaveLength(4)
  })

  it('retire les guillemets, la convention même de .env.example', () => {
    // `.env.example` — la convention documentée du dépôt — écrit
    // `AUTH_SECRET="..."`. Recopiée telle quelle dans `donnees/cra.env`, une
    // valeur qui garde ses guillemets donne une authentification SMTP refusée
    // sans explication et une CREDENTIALS_KEY que `parseKey` rejette.
    const f = path.join(bac, 'cra.env')
    writeFileSync(
      f,
      ['SMTP_PASSWORD="mon mot de passe"', "CRA_API_TOKEN='jeton123'", 'NU=sans-guillemets'].join(
        '\n',
      ) + '\n',
      { mode: 0o600 },
    )

    const env = chargerOuCreerEnv(f)

    expect(env.SMTP_PASSWORD).toBe('mon mot de passe')
    expect(env.CRA_API_TOKEN).toBe('jeton123')
    expect(env.NU).toBe('sans-guillemets')
  })

  it("reconnaît un secret déclaré avec le préfixe `export`", () => {
    const f = path.join(bac, 'cra.env')
    writeFileSync(f, 'export AUTH_SECRET=pose-avec-export\n', { mode: 0o600 })
    expect(chargerOuCreerEnv(f).AUTH_SECRET).toBe('pose-avec-export')
  })

  it('retire une déclaration vide même écrite en CRLF', () => {
    // Sinon la ligne vide survit au-dessus de la valeur engendrée et l'écrase
    // à la lecture suivante — le jeton redeviendrait vide en silence.
    const f = path.join(bac, 'cra.env')
    writeFileSync(f, 'SYNC_FLUSH_TOKEN=\r\n', { mode: 0o600 })
    const jeton = chargerOuCreerEnv(f).SYNC_FLUSH_TOKEN!
    expect(jeton.length).toBeGreaterThanOrEqual(40)
    expect(chargerOuCreerEnv(f).SYNC_FLUSH_TOKEN).toBe(jeton)
  })

  it("garde les fins de ligne du fichier tel qu'il a été enregistré", () => {
    // Un fichier CRLF complété par des lignes LF devient mixte : illisible
    // dans les éditeurs Windows les plus anciens, ceux-là mêmes qui l'ont
    // converti.
    const f = path.join(bac, 'cra.env')
    writeFileSync(f, 'GOOGLE_CLIENT_ID=abc\r\n', { mode: 0o600 })
    chargerOuCreerEnv(f)
    const contenu = readFileSync(f, 'utf8')
    expect((contenu.match(/\r\n/g) ?? []).length).toBe((contenu.match(/\n/g) ?? []).length)
  })
})

describe('choisirPort', () => {
  it('rend le port de départ quand il est libre', async () => {
    const p = await choisirPort(45000, 20)
    expect(p).toBe(45000)
  })

  it('saute un port occupé au lieu d échouer', async () => {
    // C'est la règle métier : un port occupé n'empêche jamais le démarrage.
    const squatteur = net.createServer()
    await new Promise<void>((r) => squatteur.listen(45100, '127.0.0.1', r))
    try {
      expect(await portLibre(45100)).toBe(false)
      expect(await choisirPort(45100, 20)).toBe(45101)
    } finally {
      await new Promise<void>((r) => squatteur.close(() => r()))
    }
  })

  it('échoue explicitement si toute la plage est prise', async () => {
    const squatteur = net.createServer()
    await new Promise<void>((r) => squatteur.listen(45200, '127.0.0.1', r))
    try {
      await expect(choisirPort(45200, 1)).rejects.toThrow(/port libre/i)
    } finally {
      await new Promise<void>((r) => squatteur.close(() => r()))
    }
  })
})

describe('resoudrePort', () => {
  it('préfère 3000 par défaut', () => {
    // Google exige une URL de retour enregistrée à l'avance et EXACTE. Un port
    // qui change à chaque démarrage casserait la connexion Google à chaque
    // fois : le port stable est la règle, la bascule l'exception.
    expect(PORT_PREFERE).toBe(3000)
  })

  it('rend le port préféré sans bascule quand il est libre', async () => {
    const r = await resoudrePort({ prefere: 45400 })
    expect(r).toEqual({ port: 45400, bascule: false, demande: false })
  })

  it('ne bascule qu en dernier recours, et le signale', async () => {
    const squatteur = net.createServer()
    await new Promise<void>((r) => squatteur.listen(45500, '127.0.0.1', r))
    try {
      const r = await resoudrePort({ prefere: 45500, essais: 10 })
      expect(r.port).toBe(45501)
      expect(r.bascule).toBe(true)
    } finally {
      await new Promise<void>((r) => squatteur.close(() => r()))
    }
  })

  it('respecte un port explicitement demandé', async () => {
    const r = await resoudrePort({ demande: 45600 })
    expect(r).toEqual({ port: 45600, bascule: false, demande: true })
  })

  it('refuse de basculer en douce quand le port demandé est pris', async () => {
    // Poser CRA_PORT, c'est déclarer une URL de retour Google. Basculer
    // silencieusement casserait la connexion Google sans rien dire ; mieux
    // vaut ne pas démarrer et nommer le port occupé.
    const squatteur = net.createServer()
    await new Promise<void>((r) => squatteur.listen(45700, '127.0.0.1', r))
    try {
      await expect(resoudrePort({ demande: 45700 })).rejects.toThrow(/45700/)
    } finally {
      await new Promise<void>((r) => squatteur.close(() => r()))
    }
  })

  it('rejette un CRA_PORT qui n est pas un port', async () => {
    await expect(resoudrePort({ demande: 'trois-mille' })).rejects.toThrow(/CRA_PORT/)
    await expect(resoudrePort({ demande: 70000 })).rejects.toThrow(/CRA_PORT/)
  })
})

describe('messageBascule', () => {
  it("nomme l'URL de retour Google exacte à ré-enregistrer", () => {
    // Sans cette URL affichée telle quelle, il faudrait la deviner — et Google
    // rejette toute URL qui ne correspond pas au caractère près.
    const m = messageBascule(3001)
    expect(m).toContain('3001')
    expect(m).toContain('http://localhost:3001/api/google/callback')
    expect(m).toMatch(/google/i)
  })
})

describe('lireFichierPid', () => {
  it('rend null quand le fichier est absent', () => {
    expect(lireFichierPid(path.join(bac, 'cra.pid'))).toBeNull()
  })

  it('rend null sur un fichier illisible plutôt que de lever', () => {
    // Un PID corrompu ne doit pas transformer `arreter` en pile d'appels.
    const f = path.join(bac, 'cra.pid')
    writeFileSync(f, 'ceci n est pas du JSON')
    expect(lireFichierPid(f)).toBeNull()
  })

  it('rend null quand le pid ou le port manque', () => {
    const f = path.join(bac, 'cra.pid')
    writeFileSync(f, JSON.stringify({ pid: 42 }))
    expect(lireFichierPid(f)).toBeNull()
  })

  it('relit ce que le lanceur a écrit', () => {
    const f = path.join(bac, 'cra.pid')
    writeFileSync(
      f,
      JSON.stringify({ pid: 4242, port: 3001, demarreLe: '2026-08-16T09:00:00.000Z' }),
    )
    expect(lireFichierPid(f)).toEqual({
      pid: 4242,
      port: 3001,
      demarreLe: '2026-08-16T09:00:00.000Z',
    })
  })
})

describe('etatDuProcessus', () => {
  // C'est ce jugement, et non la sonde de port, qui décide de tuer ou non.
  const MARQUEUR = '/Applications/cra/app/server.js'
  const DEMARRE_LE = '2026-08-17T09:39:10.282Z'
  const INSTANT = Date.parse(DEMARRE_LE)
  const ATTENDU = { marqueur: MARQUEUR, demarreLe: DEMARRE_LE }

  it('dit `absent` quand plus personne ne porte ce numéro', () => {
    expect(etatDuProcessus(4242, ATTENDU, () => null)).toBe('absent')
  })

  it('dit `absent` pour un zombie, qui ne tourne plus', () => {
    const info = { etat: 'Z+', commande: '(node)', demarreA: INSTANT }
    expect(etatDuProcessus(4242, ATTENDU, () => info)).toBe('absent')
  })

  it("reconnaît notre serveur MÊME quand Next l'a renommé", () => {
    // Mesuré sur l'archive réelle : quelques secondes après le démarrage,
    // `ps -o command=` ne rend plus `node .../app/server.js` mais
    // `next-server (v15.5.23)`. Un jugement fondé sur la seule ligne de
    // commande déclarait donc notre propre serveur étranger, et refusait de
    // l'arrêter — le défaut d'origine, déplacé d'un cran.
    const info = { etat: 'S', commande: 'next-server (v15.5.23)', demarreA: INSTANT + 400 }
    expect(etatDuProcessus(4242, ATTENDU, () => info)).toBe('notre')
  })

  it('reconnaît notre serveur à la ligne de commande tant qu il la porte', () => {
    const info = { etat: 'S', commande: `/usr/local/bin/node ${MARQUEUR}`, demarreA: null }
    expect(etatDuProcessus(4242, ATTENDU, () => info)).toBe('notre')
  })

  it("dit `etranger` quand le numéro a été recyclé par un autre programme", () => {
    // Un processus démarré des heures après l'instant inscrit au repère n'est
    // pas le nôtre. Le tuer serait pire que le défaut qu'on corrige.
    const info = {
      etat: 'S',
      commande: '/usr/bin/python3 /home/moi/sauvegarde.py',
      demarreA: INSTANT + 3 * 3600_000,
    }
    expect(etatDuProcessus(4242, ATTENDU, () => info)).toBe('etranger')
  })

  it("dit `indetermine` quand le système ne dit ni date ni ligne de commande", () => {
    const info = { etat: null, commande: null, demarreA: null }
    expect(etatDuProcessus(4242, ATTENDU, () => info)).toBe('indetermine')
  })
})

describe('ancienneteEnMs', () => {
  // `ps -o etime=` plutôt que `lstart=` : le second est traduit dans la langue
  // du système et devient illisible hors de l'anglais.
  it.each([
    ['01:26', 86_000],
    ['00:07', 7_000],
    ['02:03:04', 7_384_000],
    ['3-04:05:06', 273_906_000],
  ])('lit « %s »', (brut, ms) => {
    expect(ancienneteEnMs(brut)).toBe(ms)
  })

  it('rend null plutôt que de deviner sur une forme inconnue', () => {
    expect(ancienneteEnMs('depuis un moment')).toBeNull()
  })
})

describe('processusVivant', () => {
  it('voit vivant le processus courant, pour de vrai', () => {
    expect(processusVivant(process.pid)).toBe(true)
  })

  it('voit mort un numéro que personne ne porte', () => {
    expect(processusVivant(999_999)).toBe(false)
  })

  it('ne fait pas attendre sur un zombie', () => {
    expect(processusVivant(4242, () => ({ etat: 'Z', commande: '(node)', demarreA: null }))).toBe(
      false,
    )
  })
})

describe('quelquUnEcoute', () => {
  it('voit un port occupé', async () => {
    const s = net.createServer()
    await new Promise<void>((r) => s.listen(45300, '127.0.0.1', r))
    try {
      expect(await quelquUnEcoute(45300)).toBe(true)
    } finally {
      await new Promise<void>((r) => s.close(() => r()))
    }
  })

  it('voit un port libre', async () => {
    expect(await quelquUnEcoute(45301)).toBe(false)
  })
})
