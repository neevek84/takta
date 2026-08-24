import { PrismaClient } from '@prisma/client'
import { decryptSecret, encryptSecret, parseKey } from '../src/core/crypto/secret-box.ts'

// Reprise des blocs déjà posés dans le calendrier dédié, pour le correctif
// qui invite le compte connecté sur chaque bloc (voir calendar.ts · toBody).
//
// Sans ce script, seuls les blocs posés ou corrigés APRÈS le correctif
// portent l'invité : les blocs déjà en place à cette date continuent de ne
// jamais compter dans le libre/occupé de l'agenda principal, exactement le
// bug d'origine — pour eux seulement.
//
// PATCH plutôt que la reconstruction complète du bloc (comme le fait
// `flush.ts`) : ne touche que le champ `attendees`, jamais le résumé, la
// couleur ou les horaires déjà posés. Idempotent — un bloc déjà invité est
// simplement compté à part et laissé intact.
//
// Ne réimporte ni `calendar.ts` ni `oauth.ts` : ces modules passent par
// l'alias `@/…`, que ce script — un `.ts` exécuté tel quel par
// `--experimental-strip-types`, sans bundler — ne sait pas résoudre. Les
// mêmes routes Google sont donc rappelées ici, directement.
//
// Par défaut : aperçu seul, rien n'est écrit ni chez Google ni en base.
// `--appliquer` bascule en écriture.

const BASE = 'https://www.googleapis.com/calendar/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OWNER_SCOPE_USER = 'USER'
const OWNER_SCOPE_INSTANCE = 'INSTANCE'
const PROVIDER_GOOGLE = 'GOOGLE'
const MARGE_MS = 60_000

const appliquer = process.argv.includes('--appliquer')

const prisma = new PrismaClient()

function cle(): Buffer {
  const raw = process.env.CREDENTIALS_KEY ?? ''
  if (raw === '') {
    throw new Error(
      "CREDENTIALS_KEY est absente de l'environnement : les jetons ne peuvent pas être déchiffrés.",
    )
  }
  return parseKey(raw)
}

async function postToken(params: Record<string, string>): Promise<{
  access_token?: string
  expires_in?: number
}> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  if (!res.ok) {
    throw new Error(`Google a refusé la demande de jeton (HTTP ${res.status}).`)
  }
  return (await res.json()) as { access_token?: string; expires_in?: number }
}

async function main(): Promise<void> {
  const key = cle()

  const clientRow = await prisma.providerCredential.findUnique({
    where: {
      ownerScope_userId_provider: {
        ownerScope: OWNER_SCOPE_INSTANCE,
        userId: '',
        provider: PROVIDER_GOOGLE,
      },
    },
  })
  if (clientRow === null) {
    throw new Error(
      "Aucun client OAuth Google n'est enregistré (Administration · Google) : impossible de renouveler un jeton expiré.",
    )
  }
  const metadata = JSON.parse(clientRow.metadataJson) as Record<string, string>
  const clientId = metadata.clientId ?? ''
  const clientSecret = decryptSecret(clientRow.accessTokenEnc, key)
  if (clientId === '' || clientSecret === '') {
    throw new Error('Le client OAuth Google enregistré est incomplet.')
  }

  const comptes = await prisma.providerCredential.findMany({
    where: { ownerScope: OWNER_SCOPE_USER, provider: PROVIDER_GOOGLE, calendarId: { not: '' } },
  })

  console.log(
    appliquer
      ? `Mode écriture : ${comptes.length} compte(s) Google connecté(s) à reprendre.`
      : `Aperçu seul (relancer avec --appliquer pour écrire) : ${comptes.length} compte(s) trouvé(s).`,
  )

  let blocsCorriges = 0
  let blocsDejaOk = 0
  let blocsAbsents = 0

  for (const compte of comptes) {
    let accessToken = decryptSecret(compte.accessTokenEnc, key)
    const refreshToken = decryptSecret(compte.refreshTokenEnc, key)

    const expire = compte.expiresAt === null || compte.expiresAt.getTime() <= Date.now() + MARGE_MS
    if (expire) {
      const renouvele = await postToken({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      })
      if (typeof renouvele.access_token !== 'string' || renouvele.access_token === '') {
        console.log(`  [${compte.userId}] jeton expiré et non renouvelable — compte ignoré.`)
        continue
      }
      accessToken = renouvele.access_token
      if (appliquer) {
        await prisma.providerCredential.update({
          where: { id: compte.id },
          data: {
            accessTokenEnc: encryptSecret(accessToken, key),
            expiresAt: new Date(Date.now() + (renouvele.expires_in ?? 3600) * 1000),
          },
        })
      }
    }

    let ownerEmail = compte.ownerEmail
    if (ownerEmail === '') {
      const res = await fetch(`${BASE}/calendars/primary`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        console.log(
          `  [${compte.userId}] adresse du compte introuvable (HTTP ${res.status}) — compte ignoré.`,
        )
        continue
      }
      const primaire = (await res.json()) as { id?: string }
      ownerEmail = primaire.id ?? ''
      if (ownerEmail === '') {
        console.log(`  [${compte.userId}] adresse du compte vide — compte ignoré.`)
        continue
      }
      console.log(`  [${compte.userId}] adresse retrouvée : ${ownerEmail}`)
      if (appliquer) {
        await prisma.providerCredential.update({
          where: { id: compte.id },
          data: { ownerEmail },
        })
      }
    }

    const liens = await prisma.externalLink.findMany({
      where: { userId: compte.userId, provider: PROVIDER_GOOGLE },
    })
    console.log(`  [${compte.userId}] ${liens.length} bloc(s) posé(s) dans le calendrier dédié.`)

    for (const lien of liens) {
      const url = `${BASE}/calendars/${encodeURIComponent(compte.calendarId)}/events/${encodeURIComponent(lien.externalId)}`

      const lu = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
      if (lu.status === 404 || lu.status === 410) {
        blocsAbsents++
        continue
      }
      if (!lu.ok) {
        console.log(`    ${lien.externalId} : lecture refusée (HTTP ${lu.status}) — ignoré.`)
        continue
      }
      const evenement = (await lu.json()) as {
        status?: string
        attendees?: Array<{ email?: string }>
      }
      if (evenement.status === 'cancelled') {
        blocsAbsents++
        continue
      }
      const dejaInvite = (evenement.attendees ?? []).some((a) => a.email === ownerEmail)
      if (dejaInvite) {
        blocsDejaOk++
        continue
      }

      blocsCorriges++
      if (!appliquer) continue

      const patch = await fetch(`${url}?sendUpdates=none`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ attendees: [{ email: ownerEmail, responseStatus: 'accepted' }] }),
      })
      if (!patch.ok) {
        console.log(`    ${lien.externalId} : correction refusée (HTTP ${patch.status}).`)
        blocsCorriges--
      }
    }
  }

  console.log('')
  console.log(`Déjà à jour : ${blocsDejaOk}`)
  console.log(`${appliquer ? 'Corrigés' : 'À corriger'} : ${blocsCorriges}`)
  console.log(`Disparus côté Google (ignorés) : ${blocsAbsents}`)
  if (!appliquer && blocsCorriges > 0) {
    console.log('')
    console.log('Rien n’a été écrit. Relancer avec --appliquer pour corriger ces blocs.')
  }
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
