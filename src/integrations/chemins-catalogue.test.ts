import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { CATALOGUE_DOLIBARR } from './dolibarr/catalogue'
import { CATALOGUE_GOOGLE } from './google/catalogue'

/**
 * Les chemins que le catalogue cite doivent exister.
 *
 * Le rédacteur du catalogue a signalé la limite exacte de la couverture :
 * elle prouve qu'un appel est **exercé**, jamais qu'une **prose reste vraie**.
 * Une entrée portait « aucun service n'appelle encore cette opération », et la
 * tâche voisine l'a armée dans l'heure — sans qu'aucun test ne bronche.
 *
 * Ce test ne referme pas ce trou-là : il n'attrape pas une phrase devenue
 * fausse. Il attrape la moitié qui est mécanisable — un fichier renommé,
 * déplacé ou supprimé sous une entrée qui continue de le nommer. Le reste
 * relève de la relecture, et il faut le dire plutôt que de laisser croire que
 * le catalogue s'auto-garantit entièrement.
 */
const RACINE = process.cwd()
const CHEMIN_DANS_TEXTE = /\bsrc\/[A-Za-z0-9_\-/.[\]]+\.tsx?\b/g

function cheminsCites(): Array<{ operation: string; chemin: string }> {
  const trouves: Array<{ operation: string; chemin: string }> = []

  for (const catalogue of [CATALOGUE_DOLIBARR, CATALOGUE_GOOGLE]) {
    for (const entree of catalogue.appels) {
      const textes = [entree.emisPar ?? '', entree.note ?? '']
      for (const texte of textes) {
        for (const brut of texte.match(CHEMIN_DANS_TEXTE) ?? []) {
          trouves.push({ operation: entree.operation, chemin: brut })
        }
      }
    }
  }

  return trouves
}

describe('les chemins cites par le catalogue', () => {
  it('en cite au moins un, sans quoi ce test ne garde rien', () => {
    expect(cheminsCites().length).toBeGreaterThan(5)
  })

  it('designent tous un fichier qui existe', () => {
    const manquants = cheminsCites().filter((c) => !existsSync(path.join(RACINE, c.chemin)))

    expect(
      manquants,
      manquants.map((m) => `« ${m.operation} » cite ${m.chemin}, absent du depot`).join('\n'),
    ).toEqual([])
  })
})
