'use client'

import { clientsOf, linesOf, missionsOf } from '@/core/saisie/selection'
import { Select } from '@/components/ui/Select'
import type { LineForGrid } from '@/services/missions'
import { writeSelection } from './selection-storage'

/** Client → Mission → Prestation. On choisit ce qu'on saisit, puis on saisit. */
export function LineSelector({
  lines,
  lineId,
  onChange,
}: {
  lines: LineForGrid[]
  lineId: string
  onChange: (lineId: string) => void
}) {
  const trouvee = lines.find((l) => l.id === lineId)

  if (trouvee === undefined) {
    return (
      <p className="text-sm text-muted">
        Aucune prestation ne vous est affectée. Créez-en une depuis l’écran Missions.
      </p>
    )
  }

  // Liée après la garde : TypeScript ne conserve pas le rétrécissement d'un
  // `find` à l'intérieur des fonctions déclarées plus bas.
  const courante = trouvee

  /**
   * On ne mémorise que ce que l'utilisateur choisit, jamais ce qu'il regarde :
   * écrire au montage écraserait la mémoire avec la valeur par défaut avant
   * que la page ait eu le temps de la relire — les effets de l'enfant partent
   * toujours avant ceux du parent.
   */
  function choisir(id: string): void {
    writeSelection(id)
    onChange(id)
  }

  function choisirClient(clientName: string): void {
    const mission = missionsOf(lines, clientName)[0] ?? ''
    const premiere = linesOf(lines, clientName, mission)[0]
    if (premiere !== undefined) choisir(premiere.id)
  }

  function choisirMission(missionLabel: string): void {
    const premiere = linesOf(lines, courante.clientName, missionLabel)[0]
    if (premiere !== undefined) choisir(premiere.id)
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Select
        label="Client"
        value={courante.clientName}
        onChange={(ev) => choisirClient(ev.target.value)}
      >
        {clientsOf(lines).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <Select
        label="Mission"
        value={courante.missionLabel}
        onChange={(ev) => choisirMission(ev.target.value)}
      >
        {missionsOf(lines, courante.clientName).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </Select>

      <Select label="Prestation" value={courante.id} onChange={(ev) => choisir(ev.target.value)}>
        {linesOf(lines, courante.clientName, courante.missionLabel).map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
