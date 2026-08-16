import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/db/client'
import { fuseauSysteme, getSettings, updateSettings, validateSettingsPatch } from './settings'

// Le fuseau quitte l'environnement pour les réglages. Fichier à part : le
// fichier de tests des réglages est en cours de modification par un autre lot,
// et un ajout au milieu n'aurait servi qu'à provoquer un conflit.

beforeEach(async () => {
  await prisma.settings.deleteMany({})
  delete process.env.CRA_TIMEZONE
})

afterEach(() => {
  delete process.env.CRA_TIMEZONE
})

afterAll(async () => {
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('fuseauSysteme', () => {
  it('rend le fuseau de la machine', () => {
    // Personne ne devrait avoir à déclarer qu'il vit à Paris.
    expect(fuseauSysteme()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('rend un fuseau IANA exploitable', () => {
    expect(() => new Intl.DateTimeFormat('fr-FR', { timeZone: fuseauSysteme() })).not.toThrow()
  })

  it('ignore CRA_TIMEZONE', () => {
    // C'est la règle du lot : une valeur que l'utilisateur tape ne vit pas
    // dans un fichier d'environnement, et une valeur qui y retomberait
    // rendrait le réglage à l'écran décoratif sur les postes qui l'ont gardée.
    process.env.CRA_TIMEZONE = 'Pacific/Kiritimati'
    expect(fuseauSysteme()).not.toBe('Pacific/Kiritimati')
  })
})

describe('le fuseau est un réglage', () => {
  it('vaut celui du système tant que personne ne l a choisi', async () => {
    expect((await getSettings()).timeZone).toBe(fuseauSysteme())
  })

  it('ne retombe jamais sur CRA_TIMEZONE', async () => {
    // La mutation qui compte : rétablir `process.env.CRA_TIMEZONE ?? …` ici
    // fait tomber ce test, et lui seul suffit à le dire.
    process.env.CRA_TIMEZONE = 'Pacific/Kiritimati'
    expect((await getSettings()).timeZone).toBe(fuseauSysteme())
  })

  it('se règle et se relit', async () => {
    await updateSettings({ timeZone: 'Indian/Reunion' })
    expect((await getSettings()).timeZone).toBe('Indian/Reunion')
  })

  it('survit à un CRA_TIMEZONE contradictoire une fois réglé', async () => {
    await updateSettings({ timeZone: 'Indian/Reunion' })
    process.env.CRA_TIMEZONE = 'Pacific/Kiritimati'
    expect((await getSettings()).timeZone).toBe('Indian/Reunion')
  })

  it('refuse un fuseau que le système ne connaît pas', async () => {
    // Un fuseau inconnu ne se manifesterait qu'au moment de poser un bloc dans
    // l'agenda, très loin d'ici, par un refus de Google.
    const v = validateSettingsPatch({ timeZone: 'Europe/Nulle-Part' })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.errors.join(' ')).toContain('fuseau')

    await expect(updateSettings({ timeZone: 'Europe/Nulle-Part' })).rejects.toThrow()
  })

  it('refuse un fuseau vide plutôt que d écrire « pas de fuseau »', async () => {
    // La colonne vide veut dire « jamais choisi, prends celui du système ».
    // L'accepter en écriture rendrait les deux états indiscernables.
    expect(validateSettingsPatch({ timeZone: '   ' }).ok).toBe(false)
  })

  it('accepte les fuseaux courants d une installation française', () => {
    for (const tz of ['Europe/Paris', 'Indian/Reunion', 'America/Guadeloupe', 'UTC']) {
      expect(validateSettingsPatch({ timeZone: tz }).ok, tz).toBe(true)
    }
  })
})
