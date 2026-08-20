/**
 * Sauvegarde la base de **développement** du dépôt, et fait tourner les copies.
 *
 * Pourquoi un script à part de `sauvegarder.mjs` : celui-ci vise l'installation
 * portable et ses chemins ; ici c'est `prisma/dev.db`, la base sur laquelle le
 * porteur travaille réellement — et celle qui a perdu une demi-journée de
 * saisie parce que son journal WAL avait été effacé.
 *
 * `VACUUM INTO`, jamais une copie de fichier : en journalisation WAL, `cp`
 * attrape une base amputée de tout ce que le journal porte encore.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { horodatage, purgerAnciennes, poidsDesSauvegardes } from './lib/sauvegarde.mjs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = path.join(RACINE, 'prisma', 'dev.db')
const DOSSIER = process.env.CRA_SAUVEGARDES ?? path.join(homedir(), 'Sauvegardes-CRA')
const PREFIXE = 'dev'
/** Deux jours à la demi-heure. Une rotation, pas un archivage. */
const GARDER = Number(process.env.CRA_SAUVEGARDES_GARDER ?? 96)

if (!existsSync(BASE)) {
  console.error(`Aucune base à sauvegarder : ${BASE} n'existe pas.`)
  process.exit(1)
}

process.env.DATABASE_URL = `file:${BASE}?connection_limit=1`
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

try {
  const { sauvegarderBase } = await import('./lib/sauvegarde.mjs')
  const fichier = await sauvegarderBase(prisma, DOSSIER, PREFIXE)
  const retirees = purgerAnciennes(DOSSIER, PREFIXE, GARDER)
  const poids = (poidsDesSauvegardes(DOSSIER, PREFIXE) / 1024 / 1024).toFixed(1)

  console.log(`${horodatage()} · sauvegarde écrite : ${fichier}`)
  if (retirees.length > 0) console.log(`  ${retirees.length} ancienne(s) retirée(s)`)
  console.log(`  ${DOSSIER} occupe ${poids} Mo`)
} finally {
  await prisma.$disconnect()
}
