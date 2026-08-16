import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Le journal est en ajout seul : aucune fonction publique ne le modifie ni
// ne l'ampute. Ce test balaie TOUT le code applicatif, pas seulement
// `audit.ts` — la règle ne vaut que si personne d'autre ne peut la
// contourner depuis un autre service ou un server action.
//
// Les fichiers de test sont exclus : `audit.test.ts` doit précisément
// pouvoir falsifier une entrée en base pour prouver que la chaîne le voit.

const SRC = path.resolve(__dirname, '..')
const INTERDITS = [
  'auditEvent.update',
  'auditEvent.updateMany',
  'auditEvent.delete',
  'auditEvent.deleteMany',
  'auditEvent.upsert',
]

function fichiersApplicatifs(racine: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(racine, { withFileTypes: true })) {
    const complet = path.join(racine, entree.name)
    if (entree.isDirectory()) {
      out.push(...fichiersApplicatifs(complet))
      continue
    }
    if (!/\.tsx?$/.test(entree.name)) continue
    if (/\.test\.tsx?$/.test(entree.name)) continue
    out.push(complet)
  }
  return out
}

describe('le journal est inviolable en écriture', () => {
  it('le balayage voit bien des fichiers (sans quoi il ne garde rien)', () => {
    // Un test qui parcourt zéro fichier passe toujours. Celui-ci dit que la
    // liste est réelle avant que le suivant affirme qu'elle est propre.
    expect(fichiersApplicatifs(SRC).length).toBeGreaterThan(50)
  })

  it('aucun fichier applicatif ne modifie ni ne supprime une entrée', () => {
    const coupables: string[] = []
    for (const fichier of fichiersApplicatifs(SRC)) {
      const source = readFileSync(fichier, 'utf8')
      for (const interdit of INTERDITS) {
        if (source.includes(interdit)) {
          coupables.push(`${path.relative(SRC, fichier)} → ${interdit}`)
        }
      }
    }

    expect(
      coupables,
      [
        'Le journal de preuve est en ajout seul : ces appels le rendraient réécrivable.',
        coupables.join('\n'),
      ].join('\n'),
    ).toEqual([])
  })

  it('le service du journal n exporte aucune fonction de modification', async () => {
    const module = await import('./audit')
    for (const nom of Object.keys(module)) {
      expect(nom, `export « ${nom} »`).not.toMatch(/^(update|delete|remove|purge|edit)/i)
    }
  })
})
