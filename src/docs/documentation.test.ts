import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { ressembleAUnSecret } from '@/core/integrations/catalogue'

const RACINE = process.cwd()

/** La documentation publiée : le README et tout `docs/*.md`. Pas `docs/superpowers/` — documents de travail. */
function documentsPublies(): string[] {
  const dansDocs = readdirSync(path.join(RACINE, 'docs'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join('docs', e.name))
  return ['README.md', ...dansDocs]
}

describe('documentation publiée', () => {
  it('ne porte aucun secret', () => {
    const trouves: string[] = []
    for (const doc of documentsPublies()) {
      const texte = readFileSync(path.join(RACINE, doc), 'utf8')
      // Les mots isolés du texte : un secret se reconnaît à sa forme, pas à
      // son voisinage. Les délimiteurs Markdown sont retirés d'abord.
      for (const mot of texte.split(/[\s`"'(),;:<>|]+/)) {
        if (mot.length >= 20 && ressembleAUnSecret(mot)) trouves.push(`${doc} : ${mot}`)
      }
    }
    expect(trouves).toEqual([])
  })

  it('n a aucun lien relatif mort', () => {
    const morts: string[] = []
    for (const doc of documentsPublies()) {
      const texte = readFileSync(path.join(RACINE, doc), 'utf8')
      for (const [, cible] of texte.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        // `noUncheckedIndexedAccess` rend le groupe optionnel pour le type ;
        // le motif le rend obligatoire pour l'exécution.
        if (cible === undefined) continue
        if (cible.startsWith('http://') || cible.startsWith('https://')) continue
        const resolu = path.resolve(RACINE, path.dirname(doc), cible)
        if (!existsSync(resolu)) morts.push(`${doc} → ${cible}`)
      }
    }
    expect(morts).toEqual([])
  })

  it('ne renvoie vers aucun document retiré', () => {
    for (const doc of documentsPublies()) {
      expect(readFileSync(path.join(RACINE, doc), 'utf8')).not.toContain('ETAT.md')
    }
  })

  it('ne cite aucune commande npm qui n existe pas', () => {
    const scripts = Object.keys(
      (
        JSON.parse(readFileSync(path.join(RACINE, 'package.json'), 'utf8')) as {
          scripts: Record<string, string>
        }
      ).scripts,
    )
    const inconnues: string[] = []
    for (const doc of documentsPublies()) {
      const texte = readFileSync(path.join(RACINE, doc), 'utf8')
      for (const [, nom] of texte.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
        if (nom === undefined) continue
        if (!scripts.includes(nom)) inconnues.push(`${doc} : npm run ${nom}`)
      }
    }
    expect(inconnues).toEqual([])
  })

  it('ne cite aucun script qui n existe pas', () => {
    const absents: string[] = []
    for (const doc of documentsPublies()) {
      const texte = readFileSync(path.join(RACINE, doc), 'utf8')
      for (const [, fichier] of texte.matchAll(/node (scripts\/[A-Za-z0-9._-]+)/g)) {
        if (fichier === undefined) continue
        if (!existsSync(path.join(RACINE, fichier))) absents.push(`${doc} : ${fichier}`)
      }
    }
    expect(absents).toEqual([])
  })

  it('rattache chaque document publié à un public', () => {
    // Un document que rien ne référence est un document que personne ne lira.
    const references = documentsPublies()
      .map((d) => readFileSync(path.join(RACINE, d), 'utf8'))
      .join('\n')
    for (const doc of documentsPublies()) {
      if (doc === 'README.md') continue
      expect(references).toContain(path.basename(doc))
    }
  })
})
