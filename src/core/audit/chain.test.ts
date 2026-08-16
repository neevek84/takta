import { describe, it, expect } from 'vitest'
import {
  GENESIS_HASH,
  hashAuditEntry,
  verifyAuditChain,
  type AuditEntryContent,
} from './chain'

function contenu(patch: Partial<AuditEntryContent> = {}): AuditEntryContent {
  return {
    seq: 1,
    occurredAtIso: '2026-08-15T09:12:03.000Z',
    actorId: 'usr_1',
    actorLabel: 'Keveen',
    action: 'cra.valide',
    entityType: 'Cra',
    entityId: 'cra_1',
    payloadJson: '{"missionId":"m1","month":"2026-07"}',
    prevHash: GENESIS_HASH,
    ...patch,
  }
}

/** Construit une chaîne bien formée de n entrées. */
function chaine(n: number): Array<AuditEntryContent & { hash: string }> {
  const out: Array<AuditEntryContent & { hash: string }> = []
  let prevHash = GENESIS_HASH
  for (let seq = 1; seq <= n; seq++) {
    const c = contenu({ seq, prevHash, payloadJson: `{"n":${seq}}` })
    const hash = hashAuditEntry(c)
    out.push({ ...c, hash })
    prevHash = hash
  }
  return out
}

describe('empreinte d une entrée', () => {
  it('est reproductible', () => {
    expect(hashAuditEntry(contenu())).toBe(hashAuditEntry(contenu()))
  })

  it('est une empreinte SHA-256 en hexadécimal', () => {
    expect(hashAuditEntry(contenu())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('change dès qu un champ change, quel qu il soit', () => {
    const reference = hashAuditEntry(contenu())
    const variantes: Array<Partial<AuditEntryContent>> = [
      { seq: 2 },
      { occurredAtIso: '2026-08-15T09:12:04.000Z' },
      { actorId: 'usr_2' },
      { actorLabel: 'Autre' },
      { action: 'cra.refuse' },
      { entityType: 'TimeEntry' },
      { entityId: 'cra_2' },
      { payloadJson: '{"missionId":"m1","month":"2026-08"}' },
      { prevHash: 'a'.repeat(64) },
    ]
    for (const patch of variantes) {
      expect(hashAuditEntry(contenu(patch)), JSON.stringify(patch)).not.toBe(reference)
    }
  })

  it('ne confond pas deux découpages de champs', () => {
    // Sans séparateur non ambigu, ('ab','c') et ('a','bc') donneraient la
    // même empreinte : le journal cesserait d être une preuve.
    const a = hashAuditEntry(contenu({ entityType: 'ab', entityId: 'c' }))
    const b = hashAuditEntry(contenu({ entityType: 'a', entityId: 'bc' }))
    expect(a).not.toBe(b)
  })
})

describe('vérification de la chaîne', () => {
  it('accepte une chaîne vide', () => {
    expect(verifyAuditChain([])).toEqual({ ok: true, verifiees: 0 })
  })

  it('accepte une chaîne bien formée', () => {
    expect(verifyAuditChain(chaine(5))).toEqual({ ok: true, verifiees: 5 })
  })

  it('détecte une entrée réécrite À LA BONNE ENTRÉE', () => {
    // Le test qui fait du journal une preuve plutôt qu un historique.
    const entrees = chaine(5)
    entrees[2] = { ...entrees[2]!, payloadJson: '{"n":999}' }

    expect(verifyAuditChain(entrees)).toEqual({
      ok: false,
      verifiees: 2,
      seq: 3,
      raison: 'EMPREINTE',
    })
  })

  it('détecte la rupture même quand le faussaire recalcule l empreinte', () => {
    // Recalculer le hash de l entrée 3 la rend cohérente avec elle-même,
    // mais l entrée 4 porte encore le prevHash de l ancienne version.
    const entrees = chaine(5)
    const falsifiee = { ...entrees[2]!, payloadJson: '{"n":999}' }
    entrees[2] = { ...falsifiee, hash: hashAuditEntry(falsifiee) }

    expect(verifyAuditChain(entrees)).toEqual({
      ok: false,
      verifiees: 3,
      seq: 4,
      raison: 'CHAINAGE',
    })
  })

  it('détecte une entrée retirée du milieu', () => {
    const entrees = chaine(5)
    entrees.splice(2, 1)
    expect(verifyAuditChain(entrees)).toMatchObject({ ok: false, seq: 4, raison: 'CHAINAGE' })
  })

  it('détecte une numérotation qui ne progresse pas', () => {
    const entrees = chaine(3)
    entrees[1] = { ...entrees[1]!, seq: 1 }
    expect(verifyAuditChain(entrees)).toMatchObject({ ok: false, seq: 1, raison: 'ORDRE' })
  })

  it('refuse une chaîne qui ne part pas de la genèse', () => {
    const entrees = chaine(3).slice(1)
    expect(verifyAuditChain(entrees)).toMatchObject({ ok: false, raison: 'CHAINAGE' })
  })

  it('vérifie une fenêtre à partir d un ancrage connu', () => {
    // La vérification quotidienne n a pas à relire tout le journal : elle
    // repart de l empreinte de la dernière entrée déjà vérifiée.
    const entrees = chaine(5)
    const fenetre = entrees.slice(2)
    expect(verifyAuditChain(fenetre, entrees[1]!.hash)).toEqual({ ok: true, verifiees: 3 })
  })
})
