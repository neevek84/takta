/**
 * Le contenu d'un CRA **tel qu'il est parti chez le client**.
 *
 * La page client ne lit que lui, jamais les saisies vivantes : ce que le
 * client voit et signe ne bouge donc pas, quoi que le consultant fasse
 * ensuite — y compris rouvrir le CRA ou changer un réglage de conversion.
 * C'est la règle « le gel se casse en lecture » appliquée au document entier :
 * un JSON figé ne se reconvertit plus.
 *
 * Pur : `node:crypto` seulement.
 */
import { createHash } from 'node:crypto'
import type { CraDocument } from '../cra/document'

export function figerContenu(document: CraDocument): { json: string; empreinte: string } {
  const json = JSON.stringify(document)
  return { json, empreinte: createHash('sha256').update(json, 'utf8').digest('hex') }
}

/**
 * Relit un contenu figé. **Lève** sur un contenu illisible : une page client
 * qui afficherait un document à moitié vide inviterait à signer autre chose
 * que ce qui a été envoyé.
 */
export function lireContenu(json: string): CraDocument {
  const valeur: unknown = JSON.parse(json)
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) {
    throw new Error('Contenu figé illisible.')
  }
  const doc = valeur as Partial<CraDocument>
  if (
    typeof doc.mois !== 'string' ||
    !Array.isArray(doc.lignes) ||
    !Array.isArray(doc.joursDuMois) ||
    typeof doc.totalCentiemes !== 'number'
  ) {
    throw new Error('Contenu figé incomplet.')
  }
  return doc as CraDocument
}
