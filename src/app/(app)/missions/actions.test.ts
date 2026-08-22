import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireUser, revalidatePath, createMission, updateMissionSignataire, updateLine } =
  vi.hoisted(() => ({
    requireUser: vi.fn(),
    revalidatePath: vi.fn(),
    createMission: vi.fn(),
    updateMissionSignataire: vi.fn(),
    updateLine: vi.fn(),
  }))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/clients', () => ({ createClient: vi.fn() }))
vi.mock('@/services/missions', () => ({
  createMission,
  createLine: vi.fn(),
  updateMissionSignataire,
  updateLine,
}))

import { addClient, addMission, modifierLigne, saveSignataire } from './actions'

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  createMission.mockReset().mockResolvedValue({ id: 'm1' })
  updateMissionSignataire.mockReset().mockResolvedValue({ ok: true })
  updateLine.mockReset().mockResolvedValue({ ok: true })
})

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
