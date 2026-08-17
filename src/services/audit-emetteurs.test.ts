import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { AUDIT_ACTIONS } from '@/core/audit/events'

/**
 * **Chaque nom du catalogue a un émetteur.**
 *
 * Le catalogue est un contrat public : le formulaire d'abonnement
 * (`admin/webhooks/WebhookForm.tsx`) itère `AUDIT_ACTIONS` et propose chacun de
 * ses noms à la souscription, case à cocher comprise. Un nom que personne
 * n'émet est donc une promesse fausse — l'intégrateur coche `signature.recue`
 * pour déclencher sa facturation, l'écran lui confirme l'abonnement, l'URL est
 * vivante, l'essai répond 200, et rien ne part jamais.
 *
 * C'est exactement le raisonnement qui a fait **retirer** `facture.demandee` du
 * catalogue quand la demande de facture a quitté le produit (`events.ts:13-22`).
 * La règle vaut dans les deux sens : soit l'acte existe et on émet, soit il
 * n'existe pas et le nom sort du catalogue. Sept noms sur vingt-cinq vivaient
 * entre les deux ; rien ne le disait, parce que `events.test.ts` ne vérifie que
 * la présence des noms dans la liste.
 *
 * Ce que le balayage ne prouve pas : que l'émission soit *atteignable*. Il voit
 * une occurrence littérale du nom dans un fichier applicatif, pas un chemin
 * d'exécution. Les tests de chaque émetteur portent cette moitié-là ; celui-ci
 * empêche seulement qu'un nom soit publié sans que personne ne l'écrive.
 */

const SRC = path.resolve(__dirname, '..')

/** Le catalogue lui-même : il énumère les noms, il n'en émet aucun. */
const CATALOGUE = path.join(SRC, 'core', 'audit', 'events.ts')

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
    if (complet === CATALOGUE) continue
    out.push(complet)
  }
  return out
}

/**
 * Les commentaires sont retirés avant la recherche : une documentation qui
 * *cite* un nom d'événement ne l'émet pas, et compter la citation ferait
 * passer pour couvert exactement ce que ce test cherche.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const SOURCES = fichiersApplicatifs(SRC).map((fichier) => ({
  chemin: path.relative(SRC, fichier),
  code: sansCommentaires(readFileSync(fichier, 'utf8')),
}))

function emetteurs(action: string): string[] {
  const litteral = new RegExp(`['"\`]${action.replace(/\./g, '\\.')}['"\`]`)
  return SOURCES.filter((s) => litteral.test(s.code)).map((s) => s.chemin)
}

describe('le catalogue ne promet rien qu il n émette', () => {
  it('le balayage voit bien des fichiers (sans quoi il ne garde rien)', () => {
    // Un test qui parcourt zéro fichier passe toujours.
    expect(SOURCES.length).toBeGreaterThan(50)
    // Et il voit bien du code, pas seulement des commentaires.
    expect(SOURCES.some((s) => s.code.includes('appendAudit'))).toBe(true)
  })

  it('GARDE-FOU INVERSE : un nom absent du dépôt n a évidemment aucun émetteur', () => {
    expect(emetteurs('facture.demandee')).toEqual([])
  })

  it('CHAQUE ÉVÉNEMENT DU CATALOGUE EST ÉMIS PAR AU MOINS UN FICHIER APPLICATIF', () => {
    const orphelins = [...AUDIT_ACTIONS].filter((action) => emetteurs(action).length === 0)

    expect(
      orphelins,
      [
        'Ces événements sont proposés à l’abonnement et personne ne les émet :',
        orphelins.join(', '),
        'Émettez-les, ou retirez-les du catalogue — un nom sans émetteur est une',
        'promesse fausse, et c’est la raison pour laquelle `facture.demandee` a été retiré.',
      ].join('\n'),
    ).toEqual([])
  })
})
