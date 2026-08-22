import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { extraireTextes } from '@/core/pdf/writer'
import { formatJours } from '@/core/cra/document'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry } from './time-entries'
import { getOrCreateCra } from './cra'
import { updateSettings } from './settings'
import { buildCraPdf, getCraPdfForDownload, nomFichierCra } from './cra-pdf'

let userId = ''
let autreUserId = ''
let missionId = ''
let ligneJour = ''
let ligneNuit = ''
let ligneHorsPerimetre = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'pdf@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const autre = await prisma.user.create({
    data: { email: 'pdf-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = autre.id

  const c = await createClient('PDF client')
  const m = await createMission({ clientId: c.id, label: 'Consultant ITSM' })
  missionId = m.id
  await prisma.mission.update({
    where: { id: missionId },
    data: { signataireNom: 'Claire Martin', signataireEmail: 'claire@pdf.test' },
  })

  ligneJour = (
    await createLine({ missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })
  ).id
  ligneNuit = (
    await createLine({ missionId, userId, label: 'Nuit', soldCentiemes: 1000, tjmCents: 120000 })
  ).id

  // Une mission concurrente, dont rien ne doit apparaître sur ce CRA.
  const autreMission = await createMission({ clientId: c.id, label: 'Hors périmètre' })
  ligneHorsPerimetre = (
    await createLine({
      missionId: autreMission.id,
      userId,
      label: 'Ne doit pas figurer',
      soldCentiemes: 100,
      tjmCents: 0,
    })
  ).id
})

beforeEach(async () => {
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  await prisma.settings.update({
    where: { id: 'singleton' },
    data: {
      emetteurNom: 'KREATIV PROJECT MANAGEMENT',
      emetteurAdresse: '1 rue des Tests, 75000 Paris',
      emetteurSiret: '000 000 000 00000',
      emetteurEmail: 'contact@exemple.test',
    },
  })
  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['pdf@test.local', 'pdf-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'PDF client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function saisir(lineId: string, date: string, minutes: number): Promise<void> {
  const r = await saveEntry({ userId, lineId, date, minutes, kind: 'REALISE' })
  expect(r.ok).toBe(true)
}

describe('buildCraPdf', () => {
  it('rend les deux champs à signer, situés dans le fichier livré', async () => {
    // Sans eux le prestataire de signature reçoit un PDF muet, et il faut
    // poser les champs à la main sur chaque CRA, tous les mois.
    await saisir(ligneJour, '2026-06-01', 480)
    const { champs, bytes } = await buildCraPdf(userId, craId)

    expect(champs.map((c) => c.nature).sort()).toEqual(['DATE', 'SIGNATURE'])
    for (const champ of champs) {
      expect(champ.page).toBeGreaterThanOrEqual(1)
      expect(champ.largeur).toBeGreaterThan(0)
      expect(champ.hauteur).toBeGreaterThan(0)
      // Le champ tient dans sa page — une zone qui déborde fait signer dans le vide.
      expect(champ.x + champ.largeur).toBeLessThanOrEqual(champ.pageLargeur)
      expect(champ.y + champ.hauteur).toBeLessThanOrEqual(champ.pageHauteur)
      // Et son ancre est réellement dans le fichier : c'est ce que cherchent
      // les outils qui placent leurs champs par le texte.
      expect(Buffer.from(bytes).toString('latin1')).toContain(champ.ancre)
    }
  })

  it('produit un fichier PDF', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const { bytes } = await buildCraPdf(userId, craId)
    expect(Buffer.from(bytes).toString('latin1').startsWith('%PDF-')).toBe(true)
  })

  it('NE PORTE AUCUN MONTANT — le test qui protège la frontière du produit', async () => {
    // Les prestations portent un TJM de 800 € et 1 200 € : si un montant
    // devait fuiter, c est ici qu on le verrait. La vérification porte sur
    // les chaînes réellement dessinées dans le fichier, pas sur un modèle.
    await saisir(ligneJour, '2026-06-01', 480)
    await saisir(ligneNuit, '2026-06-02', 480)

    const { bytes } = await buildCraPdf(userId, craId)
    const imprime = extraireTextes(bytes).join(' | ')
    const minuscules = imprime.toLowerCase()

    for (const interdit of ['€', 'eur', 'tjm', 'total ht', 'facture', 'prix']) {
      expect(minuscules).not.toContain(interdit)
    }
    // Le pied de page porte volontairement la mention de garde « aucun montant
    // n’y figure » : le mot est donc toléré, mais **jamais accompagné d un
    // chiffre**, sans quoi la mention deviendrait la faille par laquelle un
    // total passerait le contrôle.
    for (const phrase of imprime.split(' | ')) {
      if (phrase.toLowerCase().includes('montant')) expect(phrase).not.toMatch(/\d/)
    }
    expect(imprime).not.toContain('800')
    expect(imprime).not.toContain('1200')
    expect(imprime).not.toContain('80000')
  })

  it('porte l entête émetteur, le client, la mission et le mois', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const imprime = extraireTextes((await buildCraPdf(userId, craId)).bytes).join(' | ')
    expect(imprime).toContain('KREATIV PROJECT MANAGEMENT')
    expect(imprime).toContain('PDF client')
    expect(imprime).toContain('Consultant ITSM')
    expect(imprime).toContain('juin 2026')
  })

  it('détaille chaque prestation jour par jour', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    await saisir(ligneJour, '2026-06-02', 240)
    await saisir(ligneNuit, '2026-06-02', 480)

    const imprime = extraireTextes((await buildCraPdf(userId, craId)).bytes)
    expect(imprime).toContain('Jour')
    expect(imprime).toContain('Nuit')
    // La bande paysage écrit le quantième seul, surmonté de l'initiale du
    // jour : « lun. 01 » ne tient pas dans une case de vingt points.
    expect(imprime).toContain('1')
    expect(imprime).toContain('30')
    expect(imprime).toContain(formatJours(50))
    expect(imprime.join(' | ')).toContain('TOTAL DU MOIS')
  })

  it('n emprunte rien à une autre mission', async () => {
    // La prestation hors périmètre porte du temps **du même utilisateur, sur
    // le même mois** : sans cela, elle serait écartée du document faute de
    // cellule et le test passerait sans que le filtre `missionId` existe.
    await saisir(ligneJour, '2026-06-01', 480)
    await saisir(ligneHorsPerimetre, '2026-06-05', 480)

    const { bytes, document } = await buildCraPdf(userId, craId)
    expect(extraireTextes(bytes).join(' | ')).not.toContain('Ne doit pas figurer')
    expect(document.totalCentiemes).toBe(100)
  })

  it('n emprunte rien aux saisies d un autre utilisateur', async () => {
    await prisma.timeEntry.create({
      data: {
        lineId: ligneJour,
        userId: autreUserId,
        date: new Date('2026-06-10T00:00:00.000Z'),
        minutes: 480,
        kind: 'REALISE',
        minutesParJour: 480,
      },
    })
    await saisir(ligneJour, '2026-06-01', 480)

    const { document } = await buildCraPdf(userId, craId)
    expect(document.totalCentiemes).toBe(100)
  })

  it('n emprunte rien à la prestation d un autre consultant sur la même mission', async () => {
    // Honnêteté sur ce que ce test prouve : c est le filtre `userId` de la
    // requête des saisies qui le fait tomber, pas le filtre d affectation des
    // lignes — une ligne sans aucune cellule ne s imprime de toute façon pas.
    // Il nomme la promesse (une mission partagée ne fuite pas), il ne fait pas
    // croire que les deux filtres sont couverts.
    const partagee = await createLine({
      missionId,
      userId: autreUserId,
      label: 'Prestation du confrère',
      soldCentiemes: 500,
      tjmCents: 0,
    })
    await prisma.timeEntry.create({
      data: {
        lineId: partagee.id,
        userId: autreUserId,
        date: new Date('2026-06-03T00:00:00.000Z'),
        minutes: 480,
        kind: 'REALISE',
        minutesParJour: 480,
      },
    })
    await saisir(ligneJour, '2026-06-01', 480)

    const { bytes, document } = await buildCraPdf(userId, craId)
    expect(extraireTextes(bytes).join(' | ')).not.toContain('Prestation du confrère')
    expect(document.totalCentiemes).toBe(100)

    await prisma.timeEntry.deleteMany({ where: { lineId: partagee.id } })
    await prisma.missionLine.delete({ where: { id: partagee.id } })
  })

  it('convertit chaque saisie avec le facteur qu elle porte', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    await updateSettings({ minutesParJour: 420 })
    await saisir(ligneJour, '2026-06-02', 420)

    const { document } = await buildCraPdf(userId, craId)
    expect(document.totalCentiemes).toBe(200)
  })

  it('se génère même sans identité émetteur configurée', async () => {
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { emetteurNom: '', emetteurAdresse: '', emetteurSiret: '', emetteurEmail: '' },
    })
    await saisir(ligneJour, '2026-06-01', 480)
    const { bytes } = await buildCraPdf(userId, craId)
    expect(bytes.length).toBeGreaterThan(300)
  })

  it('se génère sur un mois sans aucune saisie', async () => {
    const imprime = extraireTextes((await buildCraPdf(userId, craId)).bytes).join(' | ')
    expect(imprime).toContain('Aucun temps réalisé')
  })

  it('refuse le CRA d un autre utilisateur', async () => {
    await expect(buildCraPdf(autreUserId, craId)).rejects.toThrow()
  })

  it('refuse un mois hors calendrier plutôt que de composer un document faux', async () => {
    // `libelleMois` et `joursDuMois` ne valident pas leur entrée : un mois
    // aberrant y produirait « undefined NaN » et un tableau vide, dans un
    // document destiné à être signé. Un millésime à cinq chiffres — une
    // coquille de reprise suffit — sort du format ISO court et doit être
    // refusé ici, à la frontière, et non imprimé.
    // Écrit en SQL brut, et c est le point : Prisma refuse lui-même une date
    // hors plage, donc le seul chemin qui produit une telle ligne est celui
    // d un script de reprise ou d un import qui écrit la base directement —
    // exactement le chemin que ce garde-fou couvre.
    await prisma.$executeRawUnsafe(
      'INSERT INTO "Cra" ("id", "missionId", "userId", "month", "status", "updatedAt")' +
        ' VALUES (?, ?, ?, ?, ?, ?)',
      'cra-mois-aberrant',
      missionId,
      userId,
      Date.UTC(12026, 5, 1),
      'BROUILLON',
      Date.now(),
    )

    // Le message est vérifié, et pas seulement le rejet : sans le garde-fou,
    // un mois illisible fait quand même échouer la requête plus loin, mais sur
    // une erreur opaque — un test qui se contente d un rejet passerait alors
    // sans rien protéger.
    await expect(buildCraPdf(userId, 'cra-mois-aberrant')).rejects.toThrow(
      /Mois de CRA invalide/,
    )
    await prisma.$executeRawUnsafe('DELETE FROM "Cra" WHERE "id" = ?', 'cra-mois-aberrant')
  })
})

describe('nomFichierCra', () => {
  it('compose un nom de fichier sans espace ni accent', () => {
    expect(nomFichierCra('ACME Systèmes', 'Consultant ITSM', '2026-06')).toBe(
      'CRA-ACME-Systemes-Consultant-ITSM-2026-06.pdf',
    )
  })

  it('ne laisse jamais de séparateur de chemin s échapper', () => {
    expect(nomFichierCra('a/b', 'c\\d', '2026-06')).toBe('CRA-a-b-c-d-2026-06.pdf')
  })

  it('ne laisse jamais un guillemet casser l en-tête HTTP qui le transporte', () => {
    // Le nom part dans `Content-Disposition: attachment; filename="…"` : un
    // guillemet non filtré y refermerait la valeur et laisserait le reste du
    // libellé client piloter l en-tête.
    expect(nomFichierCra('A"; x="y', 'M', '2026-06')).toBe('CRA-A-x-y-M-2026-06.pdf')
  })
})

describe('getCraPdfForDownload', () => {
  it('regénère le document tant qu aucun PDF signé n est archivé', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const r = await getCraPdfForDownload(userId, craId)
    expect(r.archive).toBe(false)
    expect(r.fileName).toBe('CRA-PDF-client-Consultant-ITSM-2026-06.pdf')
  })

  it('sert le PDF signé archivé, et ne le regénère jamais', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    const archive = Buffer.from('%PDF-1.4 signé par le client', 'latin1')
    await prisma.signatureRequest.create({
      data: { craId, provider: 'test', status: 'SIGNE', signedPdf: archive },
    })

    const r = await getCraPdfForDownload(userId, craId)
    expect(r.archive).toBe(true)
    expect(Buffer.from(r.bytes)).toEqual(archive)
    expect(r.fileName).toBe('CRA-PDF-client-Consultant-ITSM-2026-06-signe.pdf')
  })

  it('regénère quand la demande existe mais sans PDF archivé', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    await prisma.signatureRequest.create({ data: { craId, provider: 'test' } })
    expect((await getCraPdfForDownload(userId, craId)).archive).toBe(false)
  })

  it('refuse le CRA d un autre utilisateur, archive ou non', async () => {
    await saisir(ligneJour, '2026-06-01', 480)
    await prisma.signatureRequest.create({
      data: { craId, provider: 'test', status: 'SIGNE', signedPdf: Buffer.from('%PDF-1.4 signé') },
    })
    await expect(getCraPdfForDownload(autreUserId, craId)).rejects.toThrow()
  })
})
