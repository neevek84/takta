import { describe, it, expect } from 'vitest'
import { engendrerChapitre, versionAffichee } from './document'
import type { CatalogueSysteme } from './catalogue'

const CATALOGUE: CatalogueSysteme = {
  systeme: 'Dolibarr',
  base: "{URL de l'instance}/api/index.php",
  appels: [
    {
      operation: 'Pousser un temps consommé sur une tâche',
      methode: 'POST',
      gabarit: '/tasks/{taskId}/addtimespent',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · addTimeSpent',
      parametres: [
        {
          nom: 'duration',
          source: 'CALCUL',
          origine: 'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads',
          exemple: '28800',
        },
      ],
      preuve: { version: '23.0.1', date: '2026-08-16', moyen: 'INSTANCE_JETABLE' },
      echec: { comportement: 'REJOUE', visible: 'La file rejoue.' },
      reglagesTiers: ['TIMESHEET_DAY_DURATION'],
    },
    {
      operation: 'Lister les tiers connus de Dolibarr',
      methode: 'GET',
      gabarit: '/thirdparties',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · listThirdparties',
      parametres: [],
      preuve: { version: '23.0.1', date: '2026-08-16', moyen: 'DOUBLE' },
      echec: { comportement: 'ABANDONNE', visible: "L'écran affiche l'erreur." },
      reglagesTiers: [],
    },
  ],
}

const ARGS = {
  titre: 'Intégrations',
  preambule: [{ titre: 'À quoi sert ce chapitre', corps: 'Prose.' }],
  catalogues: [CATALOGUE],
  final: [{ titre: 'Monter de version', corps: 'Procédure.' }],
}

describe('génération du chapitre', () => {
  it('avertit que le fichier est engendré', () => {
    expect(engendrerChapitre(ARGS).split('\n')[0]).toBe(
      '<!-- ENGENDRÉ depuis les catalogues — ne pas modifier à la main. Voir npm run doc:integrations. -->',
    )
  })

  it('trie les appels par méthode et chemin, pas par ordre de déclaration', () => {
    const rendu = engendrerChapitre(ARGS)
    expect(rendu.indexOf('`GET /thirdparties`')).toBeLessThan(
      rendu.indexOf('`POST /tasks/{taskId}/addtimespent`'),
    )
  })

  it('dit d où vient la valeur de chaque paramètre', () => {
    expect(engendrerChapitre(ARGS)).toContain(
      '| `duration` | calcul | `src/core/dolibarr/timespent.ts · buildTimeSpentPayloads` | `28800` |',
    )
  })

  it('dit contre quelle version et à quelle date l appel a été prouvé', () => {
    expect(engendrerChapitre(ARGS)).toContain(
      'Prouvé contre Dolibarr 23.0.1 le 2026-08-16, sur instance jetable.',
    )
  })

  it('nomme le réglage tiers dont l appel dépend', () => {
    expect(engendrerChapitre(ARGS)).toContain('Réglage tiers : `TIMESHEET_DAY_DURATION`.')
  })

  it('ne porte aucune date de génération', () => {
    const premier = engendrerChapitre(ARGS)
    const second = engendrerChapitre(ARGS)
    expect(premier).toBe(second)
    // Les dates de preuve vivent légitimement dans le corps des entrées ;
    // seul l'en-tête doit être sans date, sans quoi le test de non-divergence
    // rougirait dès le lendemain de la génération.
    expect(premier.split('\n').slice(0, 4).join('\n')).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('signale une opération non émise pour ce qu elle est', () => {
    const avecRedirection: CatalogueSysteme = {
      ...CATALOGUE,
      appels: [{ ...CATALOGUE.appels[1]!, emis: false }],
    }
    expect(engendrerChapitre({ ...ARGS, catalogues: [avecRedirection] })).toContain(
      'Redirection du navigateur — jamais émise par le serveur.',
    )
  })
})

describe('version affichée', () => {
  it('préfixe la version du nom du système', () => {
    expect(versionAffichee('Dolibarr', '23.0.1')).toBe('Dolibarr 23.0.1')
  })

  it('ne le préfixe pas deux fois quand la version le porte déjà', () => {
    expect(versionAffichee('Google Calendar', 'Google Calendar API v3')).toBe(
      'Google Calendar API v3',
    )
  })
})
