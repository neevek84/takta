/**
 * Ce que cette application appelle chez Dolibarr — et rien d'autre.
 *
 * Ce n'est ni une réécriture de la documentation de Dolibarr, ni un client
 * générique. Toute entrée doit correspondre à un appel réellement émis par
 * `src/services/dolibarr/http.ts` : le double HTTP refuse une route absente
 * d'ici, et un test de couverture refuse une entrée que rien n'exerce.
 *
 * Aucune valeur réelle n'entre ici. Les exemples sont factices.
 *
 * Aucune opération de facturation n'y figure, et ce n'est pas un oubli :
 * Dolibarr facture les temps consommés depuis ses propres écrans, et
 * l'application ne crée aucune facture (voir `DolibarrApi` dans
 * `src/services/dolibarr/api.ts`).
 */
import type { CatalogueSysteme } from '@/core/integrations/catalogue'

/** Version contre laquelle l'environnement du porteur a été relevé. */
const VERSION = '23.0.1'
const DATE = '2026-08-16'
const PAR_LE_DOUBLE = { version: VERSION, date: DATE, moyen: 'DOUBLE' as const }

export const CATALOGUE_DOLIBARR: CatalogueSysteme = {
  systeme: 'Dolibarr',
  base: "{URL de l'instance, enregistrée dans Administration · Dolibarr}/api/index.php",
  appels: [
    {
      operation: 'Lister les tiers connus de Dolibarr',
      methode: 'GET',
      gabarit: '/thirdparties',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · listThirdparties',
      parametres: [
        {
          nom: 'limit',
          source: 'CONSTANTE',
          origine: 'src/services/dolibarr/http.ts · listThirdparties',
          exemple: '1000',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran Administration · Dolibarr affiche l'erreur ; rien n'est mis en file.",
      },
      reglagesTiers: [],
      note: 'Un 404 signifie « collection vide » et rend une liste vide, jamais une panne.',
    },
    {
      operation: 'Créer le tiers qui correspond à un client local',
      methode: 'POST',
      gabarit: '/thirdparties',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · createThirdparty',
      parametres: [
        {
          nom: 'name',
          source: 'SAISIE',
          origine: 'Client.name, via src/services/dolibarr/import.ts · pushClientToDolibarr',
          exemple: 'Client Exemple',
        },
        {
          nom: 'client',
          source: 'CONSTANTE',
          origine: 'src/services/dolibarr/http.ts · createThirdparty',
          exemple: '1',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran de reprise affiche le refus ; aucun lien de correspondance n'est posé.",
      },
      reglagesTiers: [],
      note: "Dolibarr rend un entier nu, pas un objet : c'est l'identifiant du tiers créé.",
    },
    {
      operation: 'Lister les projets facturables au temps consommé',
      methode: 'GET',
      gabarit: '/projects',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · listProjects',
      parametres: [
        {
          nom: 'limit',
          source: 'CONSTANTE',
          origine: 'src/services/dolibarr/http.ts · listProjects',
          exemple: '1000',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran de reprise affiche l'erreur ; aucune correspondance n'est proposée.",
      },
      reglagesTiers: ['usage_bill_time du projet (« Facturer le temps consommé »)'],
      note:
        'Dolibarr rend tous les projets ; le filtre sur `usage_bill_time` est appliqué ' +
        'localement par le client. Un projet non facturable au temps n’a aucune tâche où pousser.',
    },
    {
      operation: 'Lister les tâches d un projet, pour y retrouver une prestation',
      methode: 'GET',
      gabarit: '/projects/{projectId}/tasks',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · listTasks',
      parametres: [
        {
          nom: 'projectId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (mission → projet), posé par src/services/dolibarr/import.ts',
          exemple: '3',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible: "L'écran de synchronisation compte l'échec ; la file rejoue.",
      },
      reglagesTiers: [],
      note: 'La tâche est retrouvée par son libellé avant d’être créée : voir `POST /tasks`.',
    },
    {
      operation: 'Créer la tâche qui portera les temps d une ligne de mission',
      methode: 'POST',
      gabarit: '/tasks',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · createTask',
      parametres: [
        {
          nom: 'fk_project',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (mission → projet), posé par src/services/dolibarr/import.ts',
          exemple: '3',
        },
        {
          nom: 'label',
          source: 'CALCUL',
          origine: 'libellé de la ligne de mission, src/services/dolibarr/push.ts',
          exemple: 'Consultant ITSM',
        },
        {
          nom: 'ref',
          source: 'CALCUL',
          origine: 'libellé de la ligne de mission, src/services/dolibarr/push.ts',
          exemple: 'Consultant ITSM',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible: "L'écran de synchronisation compte l'échec ; la file rejoue.",
      },
      reglagesTiers: [],
      note: '`ref` reçoit le même libellé que `label`. Dolibarr rend un entier nu.',
    },
    {
      operation: 'Relire une propale pour en reprendre les lignes',
      methode: 'GET',
      gabarit: '/proposals/{proposalId}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · getProposal',
      parametres: [
        {
          nom: 'proposalId',
          source: 'SAISIE',
          origine: "référence de propale saisie au rattachement d'un engagement",
          exemple: '7',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran de rattachement affiche que la propale est introuvable.",
      },
      reglagesTiers: [],
      note:
        '`subprice` est relu en euros et converti en centimes (× 100) par le client. ' +
        'Appelée par `src/services/dolibarr/propal.ts` pour reprendre les lignes ' +
        "d'un engagement, après contrôle que la propale appartient bien au tiers " +
        'rattaché au client de la mission.',
    },
    {
      operation: 'Pousser un temps consommé sur une tâche',
      methode: 'POST',
      gabarit: '/tasks/{taskId}/addtimespent',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · addTimeSpent',
      parametres: [
        {
          nom: 'taskId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts',
          exemple: '17',
        },
        {
          nom: 'date',
          source: 'CALCUL',
          origine: 'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads',
          exemple: '2026-04-13',
        },
        {
          nom: 'duration',
          source: 'CALCUL',
          origine:
            'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads — minutes × 60, en secondes',
          exemple: '28800',
        },
        {
          nom: 'user_id',
          source: 'REGLAGE',
          origine:
            'ProviderCredential.metadata.dolibarrUserId, saisi dans Administration · Dolibarr',
          exemple: '42',
        },
        {
          nom: 'note',
          source: 'SAISIE',
          origine: 'commentaire de la saisie de temps',
          exemple: 'Atelier de cadrage',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible:
          "L'écran de synchronisation compte l'échec ; la file rejoue avec recul progressif.",
      },
      reglagesTiers: ['TIMESHEET_DAY_DURATION'],
      note:
        '`duration` est un nombre de secondes. TIMESHEET_DAY_DURATION ne change que la lecture ' +
        'jour/heure dans Dolibarr, jamais la valeur envoyée.',
    },
    {
      operation: 'Corriger un temps déjà poussé',
      methode: 'PUT',
      gabarit: '/tasks/{taskId}/timespent/{timespentId}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · updateTimeSpent',
      parametres: [
        {
          nom: 'taskId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts',
          exemple: '17',
        },
        {
          nom: 'timespentId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (cellule de saisie → temps passé), src/services/dolibarr/push.ts',
          exemple: '91',
        },
        {
          nom: 'date',
          source: 'CALCUL',
          origine: 'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads',
          exemple: '2026-04-13',
        },
        {
          nom: 'duration',
          source: 'CALCUL',
          origine:
            'src/core/dolibarr/timespent.ts · buildTimeSpentPayloads — minutes × 60, en secondes',
          exemple: '25200',
        },
        {
          nom: 'note',
          source: 'SAISIE',
          origine: 'commentaire de la saisie de temps',
          exemple: 'Atelier de cadrage',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'REJOUE',
        visible: "L'écran de synchronisation compte l'échec ; la file rejoue.",
      },
      reglagesTiers: ['TIMESHEET_DAY_DURATION'],
      note: "Mêmes paramètres que le push, moins `user_id` : Dolibarr ne réattribue pas la ligne.",
    },
    {
      operation: 'Retirer un temps qui n a plus lieu d être',
      methode: 'DELETE',
      gabarit: '/tasks/{taskId}/timespent/{timespentId}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · deleteTimeSpent',
      parametres: [
        {
          nom: 'taskId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts',
          exemple: '17',
        },
        {
          nom: 'timespentId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (cellule de saisie → temps passé), src/services/dolibarr/push.ts',
          exemple: '91',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'TOLERE',
        visible: 'Rien. Un temps déjà disparu est un objectif atteint.',
      },
      reglagesTiers: [],
      note: 'Le 404 est toléré par le client : lever bloquerait la file sur une cible conforme.',
    },
    {
      operation: 'Lire une constante de configuration de l instance',
      methode: 'GET',
      gabarit: '/setup/conf/{constante}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · getSetupValue',
      parametres: [
        {
          nom: 'constante',
          source: 'CONSTANTE',
          origine:
            'src/services/dolibarr/setup.ts — SOCIETE_FISCAL_MONTH_START, TIMESHEET_DAY_DURATION',
          exemple: 'TIMESHEET_DAY_DURATION',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'TOLERE',
        visible: "L'écran de reprise ne propose simplement pas la valeur.",
      },
      reglagesTiers: ['SOCIETE_FISCAL_MONTH_START', 'TIMESHEET_DAY_DURATION'],
      note:
        'La route n’existe pas sur toutes les versions : un 404 vaut « constante non lisible ' +
        'ici », jamais « instance en panne ». La valeur arrive nue ou enveloppée dans `value`.',
    },
  ],
}
