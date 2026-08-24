import type { ReactNode } from 'react'

export function PageShell({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    // 1600 points de contenu au lieu de 1024 : à côté d'un rail de 224, un
    // écran de 1920 laissait plus d'un tiers de sa largeur inutilisée, et la
    // vue 3 mois y serait à l'étroit sans raison.
    //
    // La marge tombe à 16 points sous `md`, et c'est un gain là où la place
    // manque le plus : la colonne du calendrier sur un écran de 375 passe de
    // 45,0 à 47,3 points, pour une cible tactile de 44. `MonthCalendar.test.tsx`
    // lit cette marge ici même et refuse qu'elle repasse sous le budget.
    <main className="mx-auto w-full max-w-[100rem] p-4 md:px-8 md:py-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl">{title}</h1>
        {actions}
      </div>
      {children}
    </main>
  )
}
