/**
 * D'où vient un objet : de Dolibarr, ou d'ici.
 *
 * **Jamais la couleur seule.** Le pictogramme est doublé du mot, et le mot est
 * lisible sans lui — c'est la règle du système de design, et elle vaut
 * particulièrement ici : « rattaché à Dolibarr » décide de ce qui partira chez
 * le client, et un daltonien ne doit pas avoir à deviner.
 *
 * `detail` ne change pas ce que l'étiquette dit ; il le précise pour qui
 * survole ou lit à la voix — la référence du projet, le numéro de la tâche.
 */
export function Origine({
  dansDolibarr,
  detail,
}: {
  dansDolibarr: boolean
  /** ce que l'infobulle ajoute, sans lequel l'étiquette reste vraie */
  detail?: string
}) {
  const texte = dansDolibarr ? 'Dolibarr' : 'Local'
  const titre = detail === undefined ? texte : `${texte} — ${detail}`

  return (
    <span
      title={titre}
      aria-label={titre}
      className={
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs ' +
        (dansDolibarr ? 'border-rule bg-off text-ink' : 'border-rule text-muted')
      }
    >
      <span aria-hidden="true">{dansDolibarr ? '⇄' : '•'}</span>
      {texte}
    </span>
  )
}
