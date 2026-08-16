import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(__dirname, '../../distribution')
const PAIRES = [
  { nom: 'demarrer', outil: 'lancer' },
  { nom: 'arreter', outil: 'arreter' },
  { nom: 'sauvegarder', outil: 'sauvegarder' },
  { nom: 'creer-utilisateur', outil: 'creer-utilisateur' },
]

describe('scripts d entree', () => {
  it('existent par paire, POSIX et Windows', () => {
    for (const { nom } of PAIRES) {
      expect(existsSync(path.join(DIR, `${nom}.sh`)), `${nom}.sh`).toBe(true)
      expect(existsSync(path.join(DIR, `${nom}.cmd`)), `${nom}.cmd`).toBe(true)
    }
  })

  it('appellent chacun le bon outil, des deux côtés', () => {
    for (const { nom, outil } of PAIRES) {
      const sh = readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')
      const cmd = readFileSync(path.join(DIR, `${nom}.cmd`), 'utf8')
      expect(sh, `${nom}.sh`).toContain(`app/outils/${outil}.mjs`)
      expect(cmd, `${nom}.cmd`).toContain(`app\\outils\\${outil}.mjs`)
    }
  })

  it('posent CRA_RACINE des deux côtés', () => {
    for (const { nom } of PAIRES) {
      expect(readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')).toContain('CRA_RACINE')
      expect(readFileSync(path.join(DIR, `${nom}.cmd`), 'utf8')).toContain('CRA_RACINE')
    }
  })

  it('exigent Node 20 des deux côtés, avant toute autre chose', () => {
    for (const { nom, outil } of PAIRES) {
      const sh = readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')
      const cmd = readFileSync(path.join(DIR, `${nom}.cmd`), 'utf8')
      expect(sh).toContain('-lt 20')
      expect(cmd).toContain('LSS 20')
      // Le contrôle doit précéder l'appel : sinon Node ancien produit une pile.
      expect(sh.indexOf('-lt 20')).toBeLessThan(sh.indexOf(`${outil}.mjs`))
      expect(cmd.indexOf('LSS 20')).toBeLessThan(cmd.indexOf(`${outil}.mjs`))
    }
  })

  it('nomment nodejs.org dans chaque message d échec', () => {
    for (const { nom } of PAIRES) {
      for (const ext of ['sh', 'cmd']) {
        expect(readFileSync(path.join(DIR, `${nom}.${ext}`), 'utf8')).toContain(
          'https://nodejs.org',
        )
      }
    }
  })

  it('livrent les .cmd en CRLF', () => {
    // Un .cmd en LF se comporte de façon erratique sous cmd.exe.
    for (const { nom } of PAIRES) {
      const brut = readFileSync(path.join(DIR, `${nom}.cmd`), 'utf8')
      const lf = (brut.match(/\n/g) ?? []).length
      const crlf = (brut.match(/\r\n/g) ?? []).length
      expect(crlf, `${nom}.cmd`).toBe(lf)
      expect(lf, `${nom}.cmd doit avoir des lignes`).toBeGreaterThan(0)
    }
  })

  it('livrent les .sh en LF, avec un shebang', () => {
    for (const { nom } of PAIRES) {
      const brut = readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')
      expect(brut.startsWith('#!/bin/sh')).toBe(true)
      expect(brut).not.toContain('\r\n')
    }
  })

  it('portent le bit d exécution côté POSIX', () => {
    // Un .sh non exécutable dans le dépôt donnerait un `permission denied` à la
    // première commande du LISEZMOI : `zip` conserve les droits du fichier
    // source, et l'empaquetage recopie ces fichiers tels quels.
    for (const { nom } of PAIRES) {
      const mode = statSync(path.join(DIR, `${nom}.sh`)).mode
      expect(Boolean(mode & 0o100), `${nom}.sh doit être exécutable`).toBe(true)
    }
  })

  it('ne nettoie la quarantaine macOS que dans demarrer.sh', () => {
    expect(readFileSync(path.join(DIR, 'demarrer.sh'), 'utf8')).toContain('com.apple.quarantine')
    for (const { nom } of PAIRES.filter((p) => p.nom !== 'demarrer')) {
      expect(readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')).not.toContain(
        'com.apple.quarantine',
      )
    }
  })
})
