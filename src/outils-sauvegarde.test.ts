import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { horodatage, purgerAnciennes, poidsDesSauvegardes } from '../outils/lib/sauvegarde.mjs'

function dossierAvec(noms: string[]): string {
  const d = mkdtempSync(path.join(tmpdir(), 'cra-sauv-'))
  for (const n of noms) writeFileSync(path.join(d, n), 'x')
  return d
}

describe('rotation des sauvegardes', () => {
  it('ne garde que les plus récentes, en se fiant au nom et non à la date du fichier', () => {
    // Une date de fichier se laisse réécrire par une copie ou une
    // restauration ; l'horodatage du nom, non.
    const d = dossierAvec([
      'dev-20260818-090000.db',
      'dev-20260819-090000.db',
      'dev-20260820-090000.db',
    ])

    const retirees = purgerAnciennes(d, 'dev', 2)

    expect(retirees).toEqual(['dev-20260818-090000.db'])
    expect(readdirSync(d).sort()).toEqual([
      'dev-20260819-090000.db',
      'dev-20260820-090000.db',
    ])
  })

  it('ne touche ni aux autres préfixes ni aux fichiers étrangers', () => {
    const d = dossierAvec([
      'dev-20260818-090000.db',
      'dev-20260819-090000.db',
      'sauvegarde-20260101-000000.db',
      'notes.txt',
    ])

    purgerAnciennes(d, 'dev', 1)

    expect(readdirSync(d).sort()).toEqual([
      'dev-20260819-090000.db',
      'notes.txt',
      'sauvegarde-20260101-000000.db',
    ])
  })

  it('ne retire rien quand il y en a moins que le quota', () => {
    const d = dossierAvec(['dev-20260819-090000.db'])
    expect(purgerAnciennes(d, 'dev', 5)).toEqual([])
  })

  it('refuse un quota nul : ce serait tout effacer', () => {
    const d = dossierAvec(['dev-20260819-090000.db'])
    expect(() => purgerAnciennes(d, 'dev', 0)).toThrow(/entier positif/i)
    expect(readdirSync(d)).toHaveLength(1)
  })

  it('compte le poids du dossier, pour que le script puisse le dire', () => {
    const d = dossierAvec(['dev-20260819-090000.db', 'dev-20260820-090000.db', 'notes.txt'])
    expect(poidsDesSauvegardes(d, 'dev')).toBe(2)
  })

  it('horodate de façon triable', () => {
    const t = horodatage(new Date(2026, 7, 20, 9, 3, 41))
    expect(t).toBe('20260820-090341')
  })
})
