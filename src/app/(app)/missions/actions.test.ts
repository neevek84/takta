import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireUser, revalidatePath, createMission, updateMissionSignataire } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  createMission: vi.fn(),
  updateMissionSignataire: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/clients', () => ({ createClient: vi.fn() }))
vi.mock('@/services/missions', () => ({
  createMission,
  createLine: vi.fn(),
  updateMissionSignataire,
}))

import { addMission, saveSignataire } from './actions'

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  createMission.mockReset().mockResolvedValue({ id: 'm1' })
  updateMissionSignataire.mockReset().mockResolvedValue({ ok: true })
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
    })
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
