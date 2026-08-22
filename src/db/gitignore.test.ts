import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Les fichiers d'accompagnement de SQLite doivent être ignorés par git.
 *
 * Le défaut, constaté et non supposé : `.gitignore` couvrait `*.db` et
 * `*.db-journal`, mais pas `*.db-wal` ni `*.db-shm`. Or l'application tourne en
 * **WAL** — c'est `-wal` qui porte les écritures pas encore repliées dans le
 * fichier principal, parfois pendant des heures, l'auto-repli de SQLite ne se
 * déclenchant qu'au bout de mille pages.
 *
 * Non ignorés, ces fichiers apparaissaient en « non suivis ». Un `git clean
 * -fd` — la forme qui épargne justement les fichiers ignorés, donc celle qu'on
 * lance sans crainte — les emportait : la base restait en place, et toutes les
 * saisies non repliées disparaissaient sans un message.
 */
const RACINE = process.cwd()

describe('.gitignore', () => {
  it('ignore le journal WAL de SQLite, pas seulement la base', () => {
    const regles = readFileSync(path.join(RACINE, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())

    for (const motif of ['*.db', '*.db-wal', '*.db-shm', '*.db-journal']) {
      expect(regles, `${motif} doit être ignoré`).toContain(motif)
    }
  })
})
