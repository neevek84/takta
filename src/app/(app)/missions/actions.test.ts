import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  requireUser,
  revalidatePath,
  createMission,
  updateMissionSignataire,
  updateMissionLabel,
  updateLine,
  archiverPrestation,
  impactSuppressionPrestation,
  supprimerPrestation,
  ligneTrouvee,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  createMission: vi.fn(),
  updateMissionSignataire: vi.fn(),
  updateMissionLabel: vi.fn(),
  updateLine: vi.fn(),
  archiverPrestation: vi.fn(),
  impactSuppressionPrestation: vi.fn(),
  supprimerPrestation: vi.fn(),
  ligneTrouvee: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser,
  // Les gardes de rôle s'appuient sur la même session, et **appliquent la vraie
  // règle** : `peutAdministrer` est importée, pas recopiée. Un double qui
  // laisserait passer un consultant ferait passer au vert une action sans
  // garde — c'est arrivé, et c'est ce test-ci qui l'a dit.
  exigerAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer, MOTIF_REFUS_ADMIN } = await import('@/core/auth/roles')
    if (!peutAdministrer(u.role)) throw new Error(MOTIF_REFUS_ADMIN)
    return u
  },
  accesAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer } = await import('@/core/auth/roles')
    return { autorise: peutAdministrer(u.role), user: u }
  },
}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/clients', () => ({ createClient: vi.fn() }))
vi.mock('@/services/missions', () => ({
  createMission,
  createLine: vi.fn(),
  updateMissionSignataire,
  updateMissionLabel,
  updateLine,
}))
vi.mock('@/services/archivage', () => ({
  archiverMission: vi.fn(),
  archiverPrestation,
  impactSuppressionMission: vi.fn(),
  impactSuppressionPrestation,
  supprimerMission: vi.fn(),
  supprimerPrestation,
}))
// Les actions relisent le libellé en base pour exiger sa recopie : c'est la
// seule chose que la base leur apporte ici.
vi.mock('@/db/client', () => ({
  prisma: {
    mission: { findUnique: vi.fn() },
    missionLine: { findUnique: ligneTrouvee },
  },
}))

import {
  addClient,
  addMission,
  chargerImpactPrestation,
  detruirePrestation,
  modifierLigne,
  rangerPrestation,
  renommerMission,
  saveSignataire,
} from './actions'

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  createMission.mockReset().mockResolvedValue({ id: 'm1' })
  updateMissionSignataire.mockReset().mockResolvedValue({ ok: true })
  updateLine.mockReset().mockResolvedValue({ ok: true })
  updateMissionLabel.mockReset().mockResolvedValue({ ok: true })
  archiverPrestation.mockReset().mockResolvedValue({ ok: true })
  supprimerPrestation.mockReset().mockResolvedValue({ ok: true, impact: IMPACT })
  impactSuppressionPrestation.mockReset().mockResolvedValue(IMPACT)
  ligneTrouvee.mockReset().mockResolvedValue({ label: 'Cadrage' })
})

const IMPACT = { saisies: 12, saisiesValidees: 4, crasValides: 1, correspondances: 3 }

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur)
  return fd
}

describe('addMission', () => {
  it('transmet le signataire saisi à la création', async () => {
    await addMission(
      formulaire({
        clientId: 'c1',
        label: 'ITSM',
        signataireNom: 'Claire Martin',
        signataireEmail: 'claire@acme.test',
      }),
    )

    expect(createMission).toHaveBeenCalledWith({
      clientId: 'c1',
      label: 'ITSM',
      minutesParJour: null,
      signataireNom: 'Claire Martin',
      signataireEmail: 'claire@acme.test',
      // Le formulaire de ce cas ne porte pas de date : `null`, et le projet
      // Dolibarr sera créé sans `date_start`.
      startDate: null,
      // L'utilisateur de la session est transmis pour que le journal de
      // preuve nomme l'auteur réel : un acte humain attribué à `SYSTEME`
      // serait une preuve fausse.
      userId: 'u1',
    })
  })

  it('attribue la création à l utilisateur de la session', async () => {
    await addMission(formulaire({ clientId: 'c1', label: 'ITSM' }))
    expect(createMission).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }))
  })

  it('laisse le signataire vide quand le formulaire ne le porte pas', async () => {
    await addMission(formulaire({ clientId: 'c1', label: 'ITSM' }))
    expect(createMission).toHaveBeenCalledWith(
      expect.objectContaining({ signataireNom: '', signataireEmail: '' }),
    )
  })
})

describe('saveSignataire', () => {
  it('scope la mise à jour sur l utilisateur de la session', async () => {
    await saveSignataire(null, formulaire({ missionId: 'm1', signataireNom: 'C', signataireEmail: 'c@a.test' }))

    expect(updateMissionSignataire).toHaveBeenCalledWith('u1', 'm1', {
      nom: 'C',
      email: 'c@a.test',
    })
  })

  it('relaie le refus du service au lieu de l avaler', async () => {
    updateMissionSignataire.mockResolvedValue({ ok: false, erreur: 'L’adresse est invalide.' })

    const r = await saveSignataire(null, formulaire({ missionId: 'm1', signataireEmail: 'nope' }))
    expect(r).toEqual({ ok: false, erreur: 'L’adresse est invalide.' })
  })

  it('ne revalide aucune page quand rien n a été écrit', async () => {
    updateMissionSignataire.mockResolvedValue({ ok: false, erreur: 'refus' })
    await saveSignataire(null, formulaire({ missionId: 'm1', signataireEmail: 'nope' }))
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('revalide les missions et les CRA après une écriture — le CRA lit ce destinataire', async () => {
    await saveSignataire(null, formulaire({ missionId: 'm1', signataireEmail: 'c@a.test' }))
    expect(revalidatePath).toHaveBeenCalledWith('/missions')
    expect(revalidatePath).toHaveBeenCalledWith('/cra')
  })
})

describe('modifierLigne', () => {
  it('scope la modification sur l utilisateur de la session', async () => {
    await modifierLigne(null, formulaire({ lineId: 'l1', label: 'Dev', displayUnit: 'JOUR' }))
    expect(updateLine).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', lineId: 'l1' }),
    )
  })

  it('convertit les saisies en entiers — centièmes de jour et centimes', async () => {
    await modifierLigne(
      null,
      formulaire({ lineId: 'l1', label: 'Dev', joursVendus: '30.5', tjmEuros: '800' }),
    )
    expect(updateLine).toHaveBeenCalledWith(
      expect.objectContaining({ soldCentiemes: 3050, tjmCents: 80_000 }),
    )
  })

  it('n envoie aucun chiffre d engagement quand le formulaire ne le porte pas', async () => {
    // Le formulaire d'une ligne reprise ne soumet ni les jours vendus ni le
    // TJM. Les fabriquer ici enverrait `NaN`, ou pire, un zéro.
    await modifierLigne(null, formulaire({ lineId: 'l1', label: 'Dev', displayUnit: 'HEURE' }))

    const args = updateLine.mock.calls[0]![0] as Record<string, unknown>
    expect('soldCentiemes' in args).toBe(false)
    expect('tjmCents' in args).toBe(false)
    expect(args.displayUnit).toBe('HEURE')
  })

  it('relaie le refus du service avec son message, au lieu de l avaler', async () => {
    updateLine.mockResolvedValue({
      ok: false,
      reason: 'ENGAGEMENT_EXTERNE',
      message: 'Les jours vendus proviennent de la propale Dolibarr.',
    })

    const r = await modifierLigne(null, formulaire({ lineId: 'l1', joursVendus: '40' }))
    expect(r).toEqual({
      ok: false,
      message: 'Les jours vendus proviennent de la propale Dolibarr.',
    })
  })

  it('dit le refus de portée en français, sans code technique', async () => {
    updateLine.mockResolvedValue({ ok: false, reason: 'NON_AFFECTE' })

    const r = await modifierLigne(null, formulaire({ lineId: 'l1', label: 'X' }))
    expect(r).toEqual({ ok: false, message: expect.stringContaining('affectée') })
  })

  it('ne revalide aucune page quand rien n a été écrit', async () => {
    updateLine.mockResolvedValue({ ok: false, reason: 'NON_AFFECTE' })
    await modifierLigne(null, formulaire({ lineId: 'l1', label: 'X' }))
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('revalide les missions et la saisie — la grille lit ces chiffres', async () => {
    await modifierLigne(null, formulaire({ lineId: 'l1', label: 'X' }))
    expect(revalidatePath).toHaveBeenCalledWith('/missions')
    expect(revalidatePath).toHaveBeenCalledWith('/saisie')
  })
})

describe('addClient', () => {
  it('attribue la création à l utilisateur de la session', async () => {
    const { createClient } = await import('@/services/clients')
    await addClient(formulaire({ name: 'ACME' }))
    expect(createClient).toHaveBeenCalledWith('ACME', null, 'u1')
  })
})

describe('renommerMission', () => {
  it('scope le renommage sur l utilisateur de la session', async () => {
    await renommerMission('m1', 'AMOA ITSM')
    expect(updateMissionLabel).toHaveBeenCalledWith('u1', 'm1', 'AMOA ITSM')
  })

  // Renommer est local : le projet Dolibarr garde sa référence et son titre.
  it('dit que rien n a bougé chez Dolibarr', async () => {
    const r = await renommerMission('m1', 'AMOA ITSM')
    expect(r).toEqual({ ok: true, message: expect.stringContaining('Dolibarr') })
  })

  it('relaie le refus du service au lieu de l avaler', async () => {
    updateMissionLabel.mockResolvedValue({ ok: false, erreur: 'Le libellé ne peut pas être vide.' })

    expect(await renommerMission('m1', '  ')).toEqual({
      ok: false,
      erreur: 'Le libellé ne peut pas être vide.',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  // Le libellé de la mission s affiche dans la grille de saisie et sur le CRA :
  // les laisser sur l ancien nom afficherait deux noms pour une même mission.
  it('revalide les missions, la saisie et les CRA', async () => {
    await renommerMission('m1', 'AMOA ITSM')
    for (const chemin of ['/missions', '/saisie', '/cra']) {
      expect(revalidatePath).toHaveBeenCalledWith(chemin)
    }
  })
})

describe('rangerPrestation', () => {
  it('scope l archivage sur l utilisateur de la session', async () => {
    await rangerPrestation('l1', true)
    expect(archiverPrestation).toHaveBeenCalledWith({ userId: 'u1', lineId: 'l1', archive: true })
  })

  it('dit lequel des deux gestes a été fait', async () => {
    expect(await rangerPrestation('l1', true)).toEqual({
      ok: true,
      message: expect.stringContaining('archivée'),
    })
    expect(await rangerPrestation('l1', false)).toEqual({
      ok: true,
      message: expect.stringContaining('désarchivée'),
    })
  })

  it('dit le refus de portée en français, sans code technique', async () => {
    archiverPrestation.mockResolvedValue({ ok: false, reason: 'NON_AFFECTE' })

    const r = await rangerPrestation('l1', true)
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining('affectée') })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  // La grille de saisie liste les prestations actives : une prestation rangée
  // qui y resterait continuerait de recevoir des temps.
  it('revalide les missions et la saisie', async () => {
    await rangerPrestation('l1', true)
    expect(revalidatePath).toHaveBeenCalledWith('/missions')
    expect(revalidatePath).toHaveBeenCalledWith('/saisie')
  })
})

describe('detruirePrestation', () => {
  // Un clic ne doit pas suffire à détruire des saisies déjà validées.
  it('refuse tant que le libellé n est pas recopié exactement', async () => {
    const r = await detruirePrestation('l1', 'cadrage')

    expect(r).toEqual({ ok: false, erreur: expect.stringContaining('Cadrage') })
    expect(supprimerPrestation).not.toHaveBeenCalled()
  })

  it('détruit quand la recopie est exacte, et rend le compte', async () => {
    const r = await detruirePrestation('l1', '  Cadrage  ')

    expect(supprimerPrestation).toHaveBeenCalledWith({ userId: 'u1', lineId: 'l1' })
    // `GestionMissionState` porte aussi `null` — l'état « rien n'a encore été
    // soumis » de l'écran : il faut l'écarter avant de lire le message.
    expect(r?.ok).toBe(true)
    if (r?.ok === true) {
      expect(r.message).toContain('12')
      expect(r.message).toContain('3')
      expect(r.message).toContain('Dolibarr')
    }
  })

  it('le dit quand la prestation a déjà disparu', async () => {
    ligneTrouvee.mockResolvedValue(null)

    const r = await detruirePrestation('l1', 'Cadrage')
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining('n’existe plus') })
    expect(supprimerPrestation).not.toHaveBeenCalled()
  })

  it('dit le refus de portée en français, sans code technique', async () => {
    supprimerPrestation.mockResolvedValue({ ok: false, reason: 'NON_AFFECTE' })

    const r = await detruirePrestation('l1', 'Cadrage')
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining('affectée') })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('revalide les missions, la saisie et les CRA', async () => {
    await detruirePrestation('l1', 'Cadrage')
    for (const chemin of ['/missions', '/saisie', '/cra']) {
      expect(revalidatePath).toHaveBeenCalledWith(chemin)
    }
  })
})

describe('chargerImpactPrestation', () => {
  it('compte ce que la suppression emporterait, avant de la proposer', async () => {
    expect(await chargerImpactPrestation('l1')).toEqual(IMPACT)
    expect(impactSuppressionPrestation).toHaveBeenCalledWith('l1')
  })
})
