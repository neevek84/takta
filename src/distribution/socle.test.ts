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
import { lireFichierPid, quelquUnEcoute } from '../../outils/lib/processus.mjs'

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
