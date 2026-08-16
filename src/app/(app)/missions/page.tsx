import { requireUser } from '@/auth'
import { listClients } from '@/services/clients'
import { listMissionsForUser } from '@/services/missions'
import { getSettings } from '@/services/settings'
import { addClient, addMission, addLine } from './actions'
import { LigneForm } from './LigneForm'
import { SignataireForm } from './SignataireForm'
import { PageShell } from '@/components/ui/PageShell'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'

export default async function MissionsPage() {
  const user = await requireUser()
  const clients = await listClients(user.id)
  const missions = await listMissionsForUser(user.id)
  const settings = await getSettings()

  return (
    <PageShell title="Missions">
      <section className="mb-8 flex flex-wrap gap-8">
        <Card>
          <form action={addClient} className="flex flex-wrap items-end gap-2">
            <Field label="Nouveau client" name="name" required />
            <Field
              label="Durée d’une journée (h)"
              name="heuresParJour"
              type="number"
              step="0.25"
              min="0.25"
              max="24"
              placeholder={String(settings.minutesParJour / 60)}
              hint={`Vide = hérité (${settings.minutesParJour / 60} h)`}
            />
            <Button type="submit" variant="primary">
              Créer
            </Button>
          </form>
        </Card>

        <Card>
          <form action={addMission} className="flex flex-wrap items-end gap-2">
            <Field label="Nouvelle mission" name="label" required />
            <Select label="Client" name="clientId" required>
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
              placeholder={String(settings.minutesParJour / 60)}
              hint={`Vide = hérité (${settings.minutesParJour / 60} h)`}
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
      </section>

      {missions.map((m) => (
        <Card key={m.id} className="mb-8">
          <h2 className="mb-3 font-medium">
            {m.clientName} · {m.label}{' '}
            <span className="text-xs font-normal text-muted">
              {m.minutesParJourEffectif / 60} h{m.minutesParJourSurcharge === null ? ' (hérité)' : ''}
            </span>
          </h2>

          <ul className="mb-4 text-sm">
            {m.lines.map((l) => (
              <li key={l.id} className="border-b border-rule py-2 last:border-0">
                <div className="flex gap-4">
                  <span className="flex-1">{l.label}</span>
                  <span>{l.soldCentiemes / 100} j</span>
                  <span>{l.tjmCents / 100} €</span>
                  <span className="text-muted">{l.displayUnit}</span>
                  {/* La source est écrite, jamais seulement teintée. */}
                  <span className="text-muted">
                    {l.engagementSource === 'DOLIBARR_PROPALE'
                      ? 'Engagement : propale Dolibarr'
                      : 'Engagement : saisi ici'}
                  </span>
                </div>
                <LigneForm line={l} />
              </li>
            ))}
            {m.lines.length === 0 && <li className="text-muted">Aucune ligne</li>}
          </ul>

          <form action={addLine} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="missionId" value={m.id} />
            <Field label="Ligne" name="label" required />
            <Field label="Jours vendus" name="joursVendus" type="number" step="0.5" required className="w-28" />
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
            missionId={m.id}
            signataireNom={m.signataireNom}
            signataireEmail={m.signataireEmail}
          />
        </Card>
      ))}
    </PageShell>
  )
}
