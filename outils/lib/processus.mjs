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
