import { describe, it, expect } from 'vitest'
import {
  cleAppel,
  comparerCouverture,
  gabaritCorrespondant,
  ressembleAUnSecret,
  verifierCatalogue,
  type CatalogueSysteme,
} from './catalogue'

const APPEL = {
  operation: 'Pousser un temps consommé sur une tâche',
  methode: 'POST' as const,
  gabarit: '/tasks/{taskId}/addtimespent',
  emis: true,
  emisPar: 'src/services/dolibarr/http.ts · addTimeSpent',
  parametres: [
    {
      nom: 'duration',
      source: 'CALCUL' as const,
      origine: 'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads',
      exemple: '28800',
    },
  ],
  preuve: { version: '23.0.1', date: '2026-08-16', moyen: 'DOUBLE' as const },
  echec: { comportement: 'REJOUE' as const, visible: 'La file rejoue ; l écran compte l échec.' },
  reglagesTiers: ['TIMESHEET_DAY_DURATION'],
}

const CATALOGUE: CatalogueSysteme = {
  systeme: 'Dolibarr',
  base: "{URL de l'instance}/api/index.php",
  appels: [APPEL],
}

describe('forme du catalogue', () => {
  it('accepte un catalogue complet', () => {
    expect(verifierCatalogue(CATALOGUE, '2026-08-16')).toEqual([])
  })

  it('refuse une date de preuve mal formée', () => {
    const casse: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, preuve: { ...APPEL.preuve, date: '16/08/2026' } }],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      "POST /tasks/{taskId}/addtimespent : la date de preuve « 16/08/2026 » n'est pas au format AAAA-MM-JJ.",
    ])
  })

  it('refuse une date de preuve dans le futur', () => {
    const casse: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, preuve: { ...APPEL.preuve, date: '2026-09-01' } }],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      'POST /tasks/{taskId}/addtimespent : la date de preuve 2026-09-01 est postérieure à 2026-08-16.',
    ])
  })

  it('refuse une version de preuve vide', () => {
    const casse: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, preuve: { ...APPEL.preuve, version: '' } }],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      'POST /tasks/{taskId}/addtimespent : aucune version de preuve.',
    ])
  })

  it('refuse une opération qui récite la route au lieu de la dire en métier', () => {
    const casse: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, operation: 'POST /tasks/{id}/addtimespent' }],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      "POST /tasks/{taskId}/addtimespent : l'opération doit se dire en langage métier, pas en méthode et chemin.",
    ])
  })

  it('refuse un paramètre sans origine', () => {
    const casse: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, parametres: [{ ...APPEL.parametres[0]!, origine: '  ' }] }],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      "POST /tasks/{taskId}/addtimespent : le paramètre « duration » ne dit pas d'où vient sa valeur.",
    ])
  })

  it('refuse deux entrées de même méthode et même gabarit', () => {
    const casse: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [APPEL, { ...APPEL, operation: 'Autre chose' }],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      'POST /tasks/{taskId}/addtimespent : deux entrées portent le même couple méthode et chemin.',
    ])
  })

  it('refuse un exemple qui ressemble à un secret', () => {
    const casse: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [
        {
          ...APPEL,
          parametres: [{ ...APPEL.parametres[0]!, exemple: 'ya29.A0ARrdaM9kQq3xVbN7tLpZ' }],
        },
      ],
    }
    expect(verifierCatalogue(casse, '2026-08-16')).toEqual([
      'POST /tasks/{taskId}/addtimespent : le paramètre « duration » porte un exemple qui ressemble à un secret.',
    ])
  })

  it('refuse un exemple trop long pour être une illustration', () => {
    const casse: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, parametres: [{ ...APPEL.parametres[0]!, exemple: 'x'.repeat(41) }] }],
    }
    expect(verifierCatalogue(casse, '2026-08-16')[0]).toContain('exemple de plus de 40 caractères')
  })
})

describe('reconnaissance des secrets', () => {
  it.each([
    'ya29.A0ARrdaM9kQq3xVbN7tLpZ',
    '1//04dXfKq2mZpLrTvYnB8sQ9wE3',
    'aGVsbG9Xb3JsZFRoaXNJc0FMb25nQmFzZTY0VmFsdWU9',
    '9f8c1d2e3a4b5c6d7e8f9a0b1c2d3e4f',
  ])('reconnaît %s', (valeur) => {
    expect(ressembleAUnSecret(valeur)).toBe(true)
  })

  it.each(['28800', '2026-04-13', 'Client Exemple', 'Europe/Paris', 'CRA — disponibilités'])(
    'laisse passer %s',
    (valeur) => {
      expect(ressembleAUnSecret(valeur)).toBe(false)
    },
  )
})

describe('rapprochement d une URL et d un gabarit', () => {
  const base = 'https://erp.invalide.test/api/index.php'

  it('rapproche un chemin paramétré', () => {
    const trouve = gabaritCorrespondant({
      catalogue: CATALOGUE,
      base,
      methode: 'POST',
      url: `${base}/tasks/17/addtimespent`,
    })
    expect(trouve?.gabarit).toBe('/tasks/{taskId}/addtimespent')
  })

  it('ignore la chaîne de requête', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, methode: 'GET', gabarit: '/thirdparties' }],
    }
    expect(
      gabaritCorrespondant({
        catalogue: c,
        base,
        methode: 'GET',
        url: `${base}/thirdparties?limit=1000`,
      }),
    ).not.toBeNull()
  })

  it('ne confond pas deux chemins de même forme', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, methode: 'GET', gabarit: '/tasks' }],
    }
    expect(
      gabaritCorrespondant({ catalogue: c, base, methode: 'GET', url: `${base}/projects/3/tasks` }),
    ).toBeNull()
  })

  it('rapproche un gabarit absolu', () => {
    const c: CatalogueSysteme = {
      systeme: 'Google',
      base: 'https://www.googleapis.com/calendar/v3',
      appels: [{ ...APPEL, methode: 'POST', gabarit: 'https://oauth2.googleapis.com/token' }],
    }
    expect(
      gabaritCorrespondant({
        catalogue: c,
        base: c.base,
        methode: 'POST',
        url: 'https://oauth2.googleapis.com/token',
      }),
    ).not.toBeNull()
  })

  it('ne rapproche jamais une entrée non émise', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...APPEL, emis: false, methode: 'GET', gabarit: '/thirdparties' }],
    }
    expect(
      gabaritCorrespondant({ catalogue: c, base, methode: 'GET', url: `${base}/thirdparties` }),
    ).toBeNull()
  })
})

describe('couverture', () => {
  it('nomme les entrées que rien n exerce', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [APPEL, { ...APPEL, methode: 'GET', gabarit: '/proposals/{proposalId}' }],
    }
    expect(comparerCouverture({ catalogue: c, observes: [cleAppel(APPEL)] })).toEqual({
      manquants: ['GET /proposals/{proposalId}'],
      inconnus: [],
    })
  })

  it('ignore les entrées non émises', () => {
    const c: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [APPEL, { ...APPEL, emis: false, methode: 'GET', gabarit: '/consentement' }],
    }
    expect(comparerCouverture({ catalogue: c, observes: [cleAppel(APPEL)] }).manquants).toEqual([])
  })
})
