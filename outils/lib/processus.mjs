import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'

/** Contenu du fichier PID, ou null si absent, illisible ou incomplet. */
export function lireFichierPid(chemin) {
  if (!existsSync(chemin)) return null
  try {
    const brut = JSON.parse(readFileSync(chemin, 'utf8'))
    if (!Number.isInteger(brut.pid) || !Number.isInteger(brut.port)) return null
    return { pid: brut.pid, port: brut.port, demarreLe: brut.demarreLe ?? null }
  } catch {
    return null
  }
}

/** Vrai si quelque chose accepte une connexion sur ce port en local. */
export function quelquUnEcoute(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.setTimeout(500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    const non = () => {
      socket.destroy()
      resolve(false)
    }
    socket.once('error', non)
    socket.once('timeout', non)
  })
}

/** Vrai si le noyau connaît ce PID. `EPERM` = il existe, mais appartient à un autre. */
function pidConnuDuNoyau(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/**
 * Ancienneté rendue par `ps -o etime=`, en millisecondes.
 *
 * Formats possibles : `mm:ss`, `hh:mm:ss`, `jj-hh:mm:ss`. Volontairement lu
 * plutôt que `lstart`, qui est traduit dans la langue du système et devient
 * illisible dès qu'on sort de l'anglais.
 *
 * @returns {number | null}
 */
export function ancienneteEnMs(etime) {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!m) return null
  const [, j = '0', h = '0', min, s] = m
  return ((Number(j) * 24 + Number(h)) * 60 + Number(min)) * 60_000 + Number(s) * 1000
}

/**
 * État, ligne de commande et instant de démarrage lus au système, ou
 * `undefined` si l'outil d'interrogation n'est pas disponible ici (on ne sait
 * pas), ou `null` si le système répond que ce PID n'existe pas.
 */
function interrogerPs(pid) {
  try {
    const brut = execFileSync(
      'ps',
      ['-ww', '-p', String(pid), '-o', 'state=', '-o', 'etime=', '-o', 'command='],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (brut === '') return null
    const maintenant = Date.now()
    const m = brut.match(/^(\S+)\s+(\S+)\s*([\s\S]*)$/)
    if (!m) return { etat: null, commande: brut, demarreA: null }
    const age = ancienneteEnMs(m[2])
    return {
      etat: m[1],
      commande: m[3],
      demarreA: age === null ? null : maintenant - age,
    }
  } catch (e) {
    // `ps -p` sort en 1 quand aucun processus ne correspond : c'est une
    // réponse, pas une panne. Tout le reste (ps absent, refusé) est une
    // ignorance, qu'il ne faut surtout pas confondre avec « mort ».
    if (e.status === 1) return null
    return undefined
  }
}

function interrogerWindows(pid) {
  try {
    const brut = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; ` +
          'if ($p) { $p.CreationDate.ToUniversalTime().ToString("o"); $p.CommandLine }',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (brut === '') return pidConnuDuNoyau(pid) ? { etat: null, commande: null, demarreA: null } : null
    const [dateBrute = '', ...reste] = brut.split(/\r?\n/)
    const demarreA = Date.parse(dateBrute)
    return {
      etat: null,
      commande: reste.join('\n').trim() || null,
      demarreA: Number.isFinite(demarreA) ? demarreA : null,
    }
  } catch {
    return undefined
  }
}

/**
 * Ce que le système sait du processus : `null` s'il n'existe pas,
 * `{ etat, commande, demarreA }` sinon — chaque champ pouvant être `null` quand
 * le système ne le dit pas.
 */
export function infoProcessus(pid) {
  const lu = process.platform === 'win32' ? interrogerWindows(pid) : interrogerPs(pid)
  if (lu !== undefined) return lu
  // Repli : le noyau sait au moins si le numéro est attribué.
  return pidConnuDuNoyau(pid) ? { etat: null, commande: null, demarreA: null } : null
}

/**
 * Vrai si le processus tourne encore. Un zombie (état `Z`) est mort : il ne
 * subsiste que le temps que son parent le récolte, et attendre sa disparition
 * du tableau des processus ferait patienter `arreter` pour rien.
 */
export function processusVivant(pid, lire = infoProcessus) {
  const info = lire(pid)
  return info !== null && !(info.etat ?? '').startsWith('Z')
}

/** Écart toléré entre l'instant inscrit au repère et celui que dit le système. */
export const TOLERANCE_DEMARRAGE_MS = 120_000

/**
 * Ce que le repère `donnees/cra.pid` désigne réellement.
 *
 * **Le fichier de processus fait foi, pas le port.** Juger par le port était le
 * défaut d'origine, et il se trompait dans les deux sens :
 *
 *  - un serveur CRA vivant mais qui n'écoute pas *encore* (première migration,
 *    moteur Prisma froid, veille/reprise) ou *plus* (listener tombé alors que
 *    l'ordonnanceur tient la boucle d'événements) répondait « non », et
 *    `arreter` effaçait le repère sans rien tuer ;
 *  - un port libre en IPv4 ne l'est pas forcément en IPv6, et le serveur d'un
 *    autre programme sur le même port se faisait prendre pour le nôtre.
 *
 * Reste la question que le repère seul ne tranche pas : un numéro de processus
 * est **recyclé** par le système, et peut désigner aujourd'hui un tout autre
 * programme. Deux signaux y répondent, dans cet ordre :
 *
 *  1. **L'instant de démarrage.** Le lanceur inscrit `demarreLe` juste après le
 *     `spawn` ; le système, lui, sait depuis quand le processus tourne. Deux
 *     dates qui coïncident à la minute près désignent le même démarrage. C'est
 *     le seul signal solide, et surtout le seul qui résiste au fait que **Next
 *     renomme son propre processus** : mesuré sur l'archive réelle,
 *     `ps -o command=` rend `next-server (v15.5.23)` et non la ligne
 *     `node .../app/server.js` que le lanceur a exécutée.
 *  2. **La ligne de commande**, quand elle porte encore le chemin de CETTE
 *     installation — vrai pendant les premières secondes, avant que Next ne se
 *     renomme, et vrai pour tout autre programme lancé de la même façon. Elle
 *     ne sert qu'à confirmer, jamais à infirmer.
 *
 * @param {number} pid
 * @param {{ marqueur?: string | null, demarreLe?: string | null, tolerance?: number }} attendu
 * @returns {'absent'|'notre'|'etranger'|'indetermine'}
 *  - `absent` : plus personne derrière ce numéro (ou zombie) ;
 *  - `notre` : vivant, et c'est bien le processus que le lanceur a démarré ;
 *  - `etranger` : vivant, mais démarré à un tout autre moment — le numéro a été
 *    recyclé, il ne faut surtout pas le tuer ;
 *  - `indetermine` : vivant, sans moyen d'en dire plus ici.
 */
export function etatDuProcessus(
  pid,
  { marqueur = null, demarreLe = null, tolerance = TOLERANCE_DEMARRAGE_MS } = {},
  lire = infoProcessus,
) {
  const info = lire(pid)
  if (info === null) return 'absent'
  if ((info.etat ?? '').startsWith('Z')) return 'absent'

  if (marqueur !== null && typeof info.commande === 'string' && info.commande.includes(marqueur)) {
    return 'notre'
  }

  const attendu = demarreLe === null ? NaN : Date.parse(demarreLe)
  if (typeof info.demarreA === 'number' && Number.isFinite(attendu)) {
    return Math.abs(info.demarreA - attendu) <= tolerance ? 'notre' : 'etranger'
  }

  return 'indetermine'
}
