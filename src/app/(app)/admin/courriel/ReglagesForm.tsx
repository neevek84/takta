'use client'

import { useActionState, useState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import {
  CLES_PRESET,
  PRESETS_SMTP,
  adresseExpediteur,
  presetPourServeur,
  type ClePreset,
} from '@/core/courriel/smtp'
import type { ProvenanceMotDePasse } from '@/services/courriel/mot-de-passe'
import { enregistrerCourriel, type ReglagesCourrielState } from './actions'

/** La provenance du mot de passe, en toutes lettres : c'est elle qui dit où corriger. */
export const LIBELLE_PROVENANCE: Record<ProvenanceMotDePasse, string> = {
  ecran: 'enregistré sur cet écran',
  env: 'variable SMTP_PASSWORD',
  aucune: 'aucun',
}

/**
 * Le formulaire du serveur d'envoi.
 *
 * Un préréglage **remplit** les champs, il ne les fige pas : chaque valeur
 * reste modifiable, et c'est ce qui est dans les champs qui s'enregistre.
 *
 * Il ne reçoit **aucun secret** : le mot de passe se saisit, il ne se relit
 * jamais, et le champ repart vide à chaque rendu.
 */
export function ReglagesForm({
  host,
  port,
  secure,
  user,
  from,
  provenance,
  enregistreLe,
  illisible = false,
}: {
  host: string
  port: number
  secure: boolean
  user: string
  from: string
  provenance: ProvenanceMotDePasse
  enregistreLe: Date | null
  /** un mot de passe est enregistré mais ne se déchiffre plus */
  illisible?: boolean
}) {
  const [state, formAction, enCours] = useActionState<ReglagesCourrielState, FormData>(
    enregistrerCourriel,
    null,
  )
  const [preset, setPreset] = useState<ClePreset>(() => presetPourServeur(host, port))
  const [champs, setChamps] = useState({
    host,
    port: port > 0 ? String(port) : '',
    chiffrement: secure ? 'tls' : 'starttls',
    user,
    from,
  })
  // L'utilisateur recopie l'adresse d'expédition tant qu'on ne l'a pas touché
  // (Google, Microsoft : l'identifiant est l'adresse elle-même).
  const [suivreExpediteur, setSuivreExpediteur] = useState(false)

  const choisirPreset = (cle: ClePreset) => {
    setPreset(cle)
    if (cle === 'autre') {
      setSuivreExpediteur(false)
      return
    }
    const p = PRESETS_SMTP[cle]
    setSuivreExpediteur(p.utilisateurEgalExpediteur)
    setChamps((c) => ({
      ...c,
      host: p.host,
      port: String(p.port),
      chiffrement: p.secure ? 'tls' : 'starttls',
      user: p.sansAuthentification
        ? ''
        : p.utilisateurEgalExpediteur && c.from.trim() !== ''
          ? (adresseExpediteur(c.from) ?? c.user)
          : c.user,
    }))
  }

  const changerExpediteur = (valeur: string) => {
    setChamps((c) => ({
      ...c,
      from: valeur,
      user: suivreExpediteur ? (adresseExpediteur(valeur) ?? valeur.trim()) : c.user,
    }))
  }

  const sansAuthentification = PRESETS_SMTP[preset].sansAuthentification && champs.user === ''
  const motDePasseEnVigueur = provenance !== 'aucune'

  return (
    <Card title="Serveur d'envoi">
      <p className="mb-3 text-sm text-ink">
        Mot de passe en vigueur : <strong>{LIBELLE_PROVENANCE[provenance]}</strong>.
      </p>
      <p className="mb-3 text-sm text-muted">
        {provenance === 'env'
          ? "La variable SMTP_PASSWORD sert de repli. Un mot de passe enregistré ici l'emporte sur elle."
          : provenance === 'ecran'
            ? "Le mot de passe est chiffré au repos et n'est jamais réaffiché."
            : 'Aucun mot de passe : seul un relais sans authentification peut envoyer.'}
        {provenance === 'ecran' && enregistreLe !== null && (
          <>
            {' '}
            Enregistré le{' '}
            <time dateTime={enregistreLe.toISOString()}>
              {enregistreLe.toISOString().slice(0, 10)}
            </time>
            .
          </>
        )}
      </p>
      {illisible && (
        <div className="mb-3">
          <Banner tone="warning" title="Mot de passe enregistré illisible">
            Le mot de passe enregistré sur cet écran ne peut plus être déchiffré (la clé de
            chiffrement a changé) : il n'est pas en vigueur. Ressaisissez-le.
          </Banner>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Fournisseur"
            value={preset}
            onChange={(e) => choisirPreset(e.target.value as ClePreset)}
            className="w-96 max-w-full"
          >
            {CLES_PRESET.map((cle) => (
              <option key={cle} value={cle}>
                {PRESETS_SMTP[cle].libelle}
              </option>
            ))}
          </Select>
        </div>
        <div className="text-sm text-muted" aria-live="polite">
          <ul className="ml-5 list-disc">
            {PRESETS_SMTP[preset].aide.map((ligne) => (
              <li key={ligne}>{ligne}</li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="Serveur SMTP"
            name="host"
            value={champs.host}
            onChange={(e) => setChamps((c) => ({ ...c, host: e.target.value }))}
            placeholder="smtp.exemple.fr"
            autoComplete="off"
            className="w-72 max-w-full"
          />
          <Field
            label="Port"
            name="port"
            value={champs.port}
            onChange={(e) => setChamps((c) => ({ ...c, port: e.target.value }))}
            inputMode="numeric"
            placeholder="465"
            className="w-24"
          />
          <Select
            label="Chiffrement"
            name="chiffrement"
            value={champs.chiffrement}
            onChange={(e) => setChamps((c) => ({ ...c, chiffrement: e.target.value }))}
          >
            <option value="tls">TLS direct (port 465)</option>
            <option value="starttls">STARTTLS (port 587)</option>
          </Select>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="Adresse d'expédition"
            name="from"
            value={champs.from}
            onChange={(e) => changerExpediteur(e.target.value)}
            placeholder="Kreativ <noreply@exemple.fr>"
            autoComplete="off"
            hint="Une adresse, éventuellement précédée d'un nom affiché."
            className="w-80 max-w-full"
          />
          <Field
            label="Utilisateur"
            name="user"
            value={champs.user}
            onChange={(e) => {
              setSuivreExpediteur(false)
              setChamps((c) => ({ ...c, user: e.target.value }))
            }}
            autoComplete="off"
            hint="Vide pour un relais sans authentification."
            className="w-72 max-w-full"
          />
          <Field
            label="Mot de passe"
            name="motDePasse"
            type="password"
            autoComplete="new-password"
            // Aucune `defaultValue` : la saisie repart vide, toujours.
            disabled={sansAuthentification}
            hint={
              sansAuthentification
                ? "Le relais n'utilise pas de mot de passe."
                : motDePasseEnVigueur
                  ? 'Un mot de passe est en vigueur : laisser vide pour conserver.'
                  : undefined
            }
            className="w-64 max-w-full"
          />
        </div>

        <div>
          <Button type="submit" variant="primary" loading={enCours}>
            {enCours ? 'Enregistrement' : 'Enregistrer'}
          </Button>
        </div>
      </form>

      {state !== null && state.ok && (
        <div className="mt-3">
          <Banner tone="success">{state.message}</Banner>
        </div>
      )}
      {state !== null && !state.ok && (
        <div className="mt-3">
          <Banner tone="danger" title="Le réglage n'a pas été enregistré">
            <ul className="list-disc pl-5">
              {state.erreurs.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}
    </Card>
  )
}
