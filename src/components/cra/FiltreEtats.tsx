'use client'

import { useRouter } from 'next/navigation'
import { Checkbox } from '@/components/ui/Checkbox'
import { ETATS_SUIVI, libelleEtat, type EtatSuivi } from '@/core/cra/etat-suivi'

/**
 * Le filtre du suivi, écrit dans l'adresse.
 *
 * **`router.push` et non un état local.** Le filtre est appliqué en base : le
 * changer doit refaire le rendu serveur, sinon il ne filtrerait rien. C'est
 * l'inverse exact du choix de vue de la Saisie, qui est entièrement local et
 * passe donc par `history.replaceState`.
 *
 * Le paramètre est toujours écrit, **même vide** : l'absence signifie « le
 * défaut », le vide signifie « l'utilisateur a tout décoché ». Confondre les
 * deux ressusciterait un filtre qu'il vient de retirer.
 */
export function FiltreEtats({
  etats,
  month,
}: {
  etats: EtatSuivi[]
  month: string | undefined
}) {
  const router = useRouter()
  const actifs = new Set(etats)

  function basculer(etat: EtatSuivi): void {
    const prochains = new Set(actifs)
    if (prochains.has(etat)) prochains.delete(etat)
    else prochains.add(etat)

    // L'ordre du catalogue, pas celui des clics : deux adresses identiques
    // pour un même filtre.
    const retenus = ETATS_SUIVI.filter((e) => prochains.has(e))
    const parametres = new URLSearchParams()
    parametres.set('etats', retenus.join(','))
    if (month !== undefined) parametres.set('month', month)

    router.push(`/cra?${parametres.toString()}`)
  }

  return (
    <fieldset className="mb-4 flex flex-wrap items-center gap-3">
      <legend className="sr-only">Filtrer par état</legend>
      {ETATS_SUIVI.map((etat) => (
        <Checkbox
          key={etat}
          label={libelleEtat(etat)}
          checked={actifs.has(etat)}
          onChange={() => basculer(etat)}
        />
      ))}
    </fieldset>
  )
}
