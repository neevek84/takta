'use client'

import { useMemo, useState } from 'react'
import { libelleEngagement } from '@/core/dolibarr/engagement'
import type { MissionForUser } from '@/services/missions'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { addClient, addMission, addLine, creerMissionDepuisCommande } from './actions'
import { LigneForm } from './LigneForm'
import { SignataireForm } from './SignataireForm'

/** Une commande Dolibarr sur laquelle une mission peut naître. */
export interface CommandeOuverte {
  id: number
  ref: string
  refClient: string
  label: string
  /** tiers Dolibarr de la commande */
  socid: number
  thirdpartyName: string
  /** client local auquel ce tiers est rattaché, `null` s'il n'en a pas encore */
  clientId: string | null
  /** projet Dolibarr déjà porté par la commande, `null` sinon */
  projectId: number | null
  /** mission locale suivant déjà ce projet, `null` sinon */
  missionId: string | null
  /** `null` aussi quand cette mission appartient à un autre consultant */
  missionLabel: string | null
}

/** Le volet de droite : une mission, ou la création d'une nouvelle. */
const NOUVELLE = 'NOUVELLE'

/**
 * La page des missions en **maître-détail**.
 *
 * Le défaut qu'elle ferme : chaque mission dépliait la totalité de son contenu
 * — prestations, formulaire d'ajout, signataire. À vingt missions, la page
 * faisait plusieurs milliers de pixels et la seule façon d'atteindre la
 * dernière était de faire défiler tout le reste.
 *
 * Ici la liste ne défile jamais avec le détail, et le détail ne change jamais
 * de place. La recherche filtre la liste sans recharger la page : tout est déjà
 * chargé, et un aller-retour serveur par frappe serait pire que le mal.
 *
 * Composant client, donc : il ne reçoit que des données nues et n'importe du
 * serveur que des actions et des types (voir `src/frontieres.test.ts`).
 */
export function MissionsExplorer({
  missions,
  clients,
  heuresParJourDefaut,
  commandes,
  panneDolibarr,
}: {
  missions: MissionForUser[]
  clients: Array<{ id: string; name: string }>
  heuresParJourDefaut: number
  /** vide quand Dolibarr n'est pas connecté : la création manuelle suffit */
  commandes: CommandeOuverte[]
  /** message d'une instance Dolibarr injoignable, `null` sinon */
  panneDolibarr: string | null
}) {
  const [recherche, setRecherche] = useState('')
  const [selection, setSelection] = useState<string>(missions[0]?.id ?? NOUVELLE)
  // Le sélecteur de la carte Dolibarr porte des **tiers**, pas des clients
  // locaux : c'est chez Dolibarr que vivent les commandes, et exiger un
  // rattachement préalable obligeait à quitter la page pour y revenir.
  const [tiersCible, setTiersCible] = useState<number | null>(null)

  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (q === '') return missions
    return missions.filter(
      (m) =>
        m.label.toLowerCase().includes(q) || m.clientName.toLowerCase().includes(q),
    )
  }, [missions, recherche])

  // Groupées par client, dans l'ordre où les missions arrivent : le service les
  // rend déjà triées, et réordonner ici ferait diverger deux écrans.
  const groupes = useMemo(() => {
    const par = new Map<string, MissionForUser[]>()
    for (const m of filtrees) {
      const liste = par.get(m.clientName)
      if (liste === undefined) par.set(m.clientName, [m])
      else liste.push(m)
    }
    return [...par.entries()]
  }, [filtrees])

  const mission = missions.find((m) => m.id === selection) ?? null

  // Un tiers par commande ouverte, sans doublon, dans l'ordre des commandes.
  const tiers = useMemo(() => {
    const par = new Map<number, { socid: number; name: string; clientId: string | null }>()
    for (const c of commandes) {
      if (!par.has(c.socid)) {
        par.set(c.socid, { socid: c.socid, name: c.thirdpartyName, clientId: c.clientId })
      }
    }
    return [...par.values()]
  }, [commandes])

  const socidRetenu = tiersCible ?? tiers[0]?.socid ?? null
  const commandesDuTiers = commandes.filter((c) => c.socid === socidRetenu)

  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr] md:items-start">
      <nav aria-label="Missions" className="flex flex-col gap-3">
        <Field
          label="Rechercher une mission"
          name="recherche"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="client ou mission"
        />

        <Button
          type="button"
          variant={selection === NOUVELLE ? 'primary' : undefined}
          onClick={() => setSelection(NOUVELLE)}
          aria-current={selection === NOUVELLE ? 'true' : undefined}
        >
          Nouvelle mission
        </Button>

        {groupes.length === 0 && (
          <p className="text-sm text-muted">Aucune mission ne correspond.</p>
        )}

        <ul className="flex flex-col gap-3">
          {groupes.map(([client, siennes]) => (
            <li key={client}>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{client}</h2>
              <ul className="mt-1 flex flex-col">
                {siennes.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setSelection(m.id)}
                      aria-current={selection === m.id ? 'true' : undefined}
                      className={
                        'touch-target w-full rounded-md px-2 text-left text-sm ' +
                        (selection === m.id ? 'bg-off font-medium text-ink' : 'text-ink hover:bg-off')
                      }
                    >
                      {m.label}
                      <span className="ml-2 text-xs text-muted">
                        {m.lines.length} prestation{m.lines.length > 1 ? 's' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0">
        {selection === NOUVELLE || mission === null ? (
          <Nouvelle
            clients={clients}
            heuresParJourDefaut={heuresParJourDefaut}
            tiers={tiers}
            socidRetenu={socidRetenu}
            setTiersCible={setTiersCible}
            commandes={commandesDuTiers}
            panneDolibarr={panneDolibarr}
          />
        ) : (
          <Detail mission={mission} />
        )}
      </div>
    </div>
  )
}

function Detail({ mission }: { mission: MissionForUser }) {
  return (
    <Card>
      <h2 className="mb-3 font-medium">
        {mission.clientName} · {mission.label}{' '}
        <span className="text-xs font-normal text-muted">
          {mission.minutesParJourEffectif / 60} h
          {mission.minutesParJourSurcharge === null ? ' (hérité)' : ''}
        </span>
      </h2>

      <ul className="mb-4 text-sm">
        {mission.lines.map((l) => (
          <li key={l.id} className="border-b border-rule py-2 last:border-0">
            <div className="flex flex-wrap gap-4">
              <span className="flex-1">{l.label}</span>
              <span>{l.soldCentiemes / 100} j</span>
              <span>{l.tjmCents / 100} €</span>
              <span className="text-muted">{l.displayUnit}</span>
              {/* La source est écrite, jamais seulement teintée. Et elle vient
                  d'une table exhaustive : un ternaire affichait « saisi ici »
                  pour un engagement repris d'une commande. */}
              <span className="text-muted">Engagement : {libelleEngagement(l.engagementSource)}</span>
            </div>
            <LigneForm line={l} />
          </li>
        ))}
        {mission.lines.length === 0 && <li className="text-muted">Aucune prestation</li>}
      </ul>

      <form action={addLine} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="missionId" value={mission.id} />
        <Field label="Prestation" name="label" required />
        <Field
          label="Jours vendus"
          name="joursVendus"
          type="number"
          step="0.5"
          required
          className="w-28"
        />
        <Field label="TJM (€)" name="tjm" type="number" step="1" defaultValue={0} className="w-28" />
        <Select label="Unité d’affichage" name="displayUnit">
          <option value="JOUR">Jour</option>
          <option value="DEMI_JOUR">Demi-journée</option>
          <option value="HEURE">Heure</option>
        </Select>
        <Button type="submit" variant="primary">
          Ajouter
        </Button>
      </form>

      <SignataireForm
        missionId={mission.id}
        signataireNom={mission.signataireNom}
        signataireEmail={mission.signataireEmail}
      />
    </Card>
  )
}

function Nouvelle({
  clients,
  heuresParJourDefaut,
  tiers,
  socidRetenu,
  setTiersCible,
  commandes,
  panneDolibarr,
}: {
  clients: Array<{ id: string; name: string }>
  heuresParJourDefaut: number
  tiers: Array<{ socid: number; name: string; clientId: string | null }>
  socidRetenu: number | null
  setTiersCible: (socid: number) => void
  commandes: CommandeOuverte[]
  panneDolibarr: string | null
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card title="Depuis une commande Dolibarr">
        <p className="mb-3 text-sm text-muted">
          Choisissez le client, puis la commande qui reste à faire. La mission naît avec son projet
          Dolibarr, qui porte la référence du bon de commande — et la commande lui est rattachée.
        </p>

        {panneDolibarr !== null && (
          <Banner tone="warning" title="Dolibarr est momentanément injoignable">
            <p>{panneDolibarr}</p>
            <p>La création manuelle, elle, fonctionne normalement.</p>
          </Banner>
        )}

        {tiers.length === 0 ? (
          panneDolibarr === null && (
            <p className="text-sm text-muted">
              Aucune commande à faire chez vos clients Dolibarr. Les brouillons, les annulées, les
              livrées et les commandes entièrement facturées ne sont pas proposés.
            </p>
          )
        ) : (
          <>
            <Select
              label="Client Dolibarr"
              name="tiersCible"
              value={socidRetenu ?? ''}
              onChange={(e) => setTiersCible(Number(e.target.value))}
              className="w-96"
            >
              {tiers.map((t) => (
                <option key={t.socid} value={t.socid}>
                  {t.name}
                  {t.clientId === null ? ' — client local à créer' : ''}
                </option>
              ))}
            </Select>

            {commandes.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Aucune commande à faire pour ce client.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {commandes.map((c) => (
                  <li key={c.id} className="rounded-md border border-rule p-3">
                    <fieldset>
                      <legend className="text-sm font-medium text-ink">
                        {c.ref}
                        {c.label === '' ? '' : ` · ${c.label}`}
                      </legend>
                      <p className="mt-1 text-sm text-muted">
                        {c.refClient === ''
                          ? 'Aucune référence client : le projet prendra la référence de la commande.'
                          : `Référence client : ${c.refClient}`}
                      </p>
                      {c.projectId !== null && c.missionId === null && (
                        <p className="mt-1 text-sm text-muted">
                          Cette commande porte déjà un projet Dolibarr : la mission s’y rattachera,
                          aucun second projet ne sera créé.
                        </p>
                      )}
                      {c.missionId === null ? (
                        <form
                          action={creerMissionDepuisCommande}
                          className="mt-2 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="orderId" value={c.id} />
                          <Button
                            type="submit"
                            variant="primary"
                            aria-label={`Créer la mission depuis « ${c.ref} »`}
                          >
                            Créer la mission
                          </Button>
                        </form>
                      ) : (
                        // En créer une seconde sur le même projet ferait partir
                        // deux CRA vers les mêmes tâches.
                        <p className="mt-2 text-sm text-muted">
                          {c.missionLabel === null
                            ? 'Son projet est déjà suivi par la mission d’un autre consultant.'
                            : `Son projet est déjà suivi par la mission « ${c.missionLabel} ».`}
                        </p>
                      )}
                    </fieldset>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card title="À la main">
        <form action={addMission} className="flex flex-wrap items-end gap-2">
          <Field label="Nouvelle mission" name="label" required />
          <Select label="Client de la mission" name="clientId" required>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Field
            label="Durée d’une journée (h)"
            name="heuresParJour"
            type="number"
            step="0.25"
            min="0.25"
            max="24"
            placeholder={String(heuresParJourDefaut)}
            hint={`Vide = hérité (${heuresParJourDefaut} h)`}
          />
          <Field label="Signataire du CRA" name="signataireNom" placeholder="Nom du contact" />
          <Field
            label="Adresse électronique du signataire"
            name="signataireEmail"
            type="email"
            hint="Facultatif, et modifiable ensuite."
          />
          <Button type="submit" variant="primary">
            Créer
          </Button>
        </form>
      </Card>

      <Card title="Nouveau client">
        <form action={addClient} className="flex flex-wrap items-end gap-2">
          <Field label="Nom du client" name="name" required />
          <Field
            label="Durée d’une journée (h)"
            name="heuresParJour"
            type="number"
            step="0.25"
            min="0.25"
            max="24"
            placeholder={String(heuresParJourDefaut)}
            hint={`Vide = hérité (${heuresParJourDefaut} h)`}
          />
          <Button type="submit" variant="primary">
            Créer
          </Button>
        </form>
      </Card>
    </div>
  )
}
