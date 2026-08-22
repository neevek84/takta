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
/**
 * Éprouvé contre l'instance réelle du porteur, et pas seulement contre le
 * double. La date est en UTC, comme celle que le contrôle du catalogue
 * compare.
 */
const PAR_L_INSTANCE = { version: VERSION, date: '2026-08-19', moyen: 'INSTANCE_PORTEUR' as const }

export const CATALOGUE_DOLIBARR: CatalogueSysteme = {
  systeme: 'Dolibarr',
  base: "{URL de l'instance, saisie dans Administration · Dolibarr}/api/index.php",
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
      reglagesTiers: ['drapeau « Client » du tiers'],
      note:
        'Un 404 signifie « collection vide » et rend une liste vide, jamais une panne. ' +
        'Dolibarr rend tous les tiers ; le client ne garde que ceux dont le drapeau `client` ' +
        'vaut 1 ou 3. Un fournisseur, un prospect seul ou un tiers neutre n’a pas de mission ' +
        'et ne recevra jamais de temps.',
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
          nom: 'planned_workload',
          source: 'CALCUL',
          origine:
            'src/core/dolibarr/timespent.ts · chargePrevueEnSecondes — jours vendus de la prestation × durée de journée résolue',
          exemple: '126000',
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
      note:
        '`ref` reçoit le même libellé que `label`. Dolibarr rend un entier nu. ' +
        '`status: 1` est **obligatoire** : sans lui la tâche naît en brouillon ' +
        '(`Task::STATUS_DRAFT = 0`) et reste inexploitable dans le projet. ' +
        '`planned_workload` est envoyée en **secondes** — unité vérifiée dans ' +
        '`projet/tasks/task.php`, qui la compose en `heures × 3600 + minutes × 60` et la relit ' +
        'par `convertSecondToTime` ; elle est omise quand la prestation ne vend rien de chiffré, ' +
        'une charge inconnue ne valant pas une charge nulle.',
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
      operation: 'Lire les contacts déjà posés sur le projet',
      methode: 'GET',
      gabarit: '/projects/{projectId}/contacts',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · createProject, assignerAuProjet',
      parametres: [
        {
          nom: 'projectId',
          source: 'IDENTIFIANT',
          origine: 'projet Dolibarr de la mission',
          exemple: '179',
        },
      ],
      preuve: PAR_L_INSTANCE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran affiche le refus ; aucune affectation n'est tentée.",
      },
      reglagesTiers: [],
      note:
        "**Lue avant d'écrire, parce que l'affectation n'est pas idempotente.** " +
        '`CommonObject::add_contact()` rend `0` quand le contact est déjà posé, et ' +
        "`addToContact` traduit ce `0` en **500 sans message**. Constaté sur l'instance du " +
        'porteur le 21 août 2026 : la seconde affectation du même utilisateur au projet 179 ' +
        "a échoué ainsi. On lit donc les contacts existants et on saute l'écriture si le rôle " +
        'est déjà là.',
    },
    {
      operation: 'Lire les contacts déjà posés sur la tâche',
      methode: 'GET',
      gabarit: '/tasks/{taskId}/contacts',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · createTask',
      parametres: [
        {
          nom: 'taskId',
          source: 'IDENTIFIANT',
          origine: 'tâche Dolibarr de la prestation',
          exemple: '317',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran affiche le refus ; aucune affectation n'est tentée.",
      },
      reglagesTiers: [],
      note: "Même raison que côté projet : l'affectation n'est pas idempotente chez Dolibarr.",
    },
    {
      operation: "Affecter l'utilisateur de la clé au projet, comme chef de projet",
      methode: 'POST',
      gabarit: '/projects/{projectId}/contacts',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · createProject, assignerAuProjet',
      parametres: [
        {
          nom: 'fk_socpeople',
          source: 'REGLAGE',
          origine: 'ExternalLink de type LIEN_UTILISATEUR, renseigné dans Mon profil',
          exemple: '7',
        },
        {
          nom: 'type_contact',
          source: 'CONSTANTE',
          origine: "PROJECTLEADER, code de llx_c_type_contact pour l'élément « project »",
          exemple: 'PROJECTLEADER',
        },
        {
          nom: 'source',
          source: 'CONSTANTE',
          origine: "internal : fk_socpeople désigne alors un utilisateur Dolibarr, pas un contact de tiers",
          exemple: 'internal',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible:
          "L'écran affiche le refus. Le projet existe, mais ses tâches resteront invisibles à " +
          "la clé tant que l'affectation n'est pas posée.",
      },
      reglagesTiers: [],
      note:
        "**C'est l'appel qui rend le projet lisible à la clé qui vient de le créer.** Sur un " +
        "projet non public, `Task::getTasksArray()` écarte toute tâche dont le projet ne " +
        "rend aucun rôle à l'utilisateur (`getUserRolesForProjectsOrTasks`). Le filtre porte " +
        'sur le **projet**, pas sur la tâche, et ne joue que si le projet est privé. Sans ' +
        "cette affectation, `GET /projects/{id}/tasks` revient vide, le connecteur croit la " +
        "tâche absente, la recrée, et Dolibarr refuse par « Error creating task ». Omis quand " +
        "aucun identifiant d'utilisateur n'est configuré.",
    },
    {
      operation: "Affecter l'utilisateur de la clé à la tâche, comme responsable",
      methode: 'POST',
      gabarit: '/tasks/{taskId}/contacts',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · createTask',
      parametres: [
        {
          nom: 'fk_socpeople',
          source: 'REGLAGE',
          origine: 'ExternalLink de type LIEN_UTILISATEUR, renseigné dans Mon profil',
          exemple: '7',
        },
        {
          nom: 'type_contact',
          source: 'CONSTANTE',
          origine: "TASKEXECUTIVE, code de llx_c_type_contact pour l'élément « project_task »",
          exemple: 'TASKEXECUTIVE',
        },
        {
          nom: 'source',
          source: 'CONSTANTE',
          origine: 'internal : fk_socpeople désigne un utilisateur Dolibarr',
          exemple: 'internal',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran affiche le refus ; la tâche existe mais n'est affectée à personne.",
      },
      reglagesTiers: [],
      note:
        'Miroir de PROJECTLEADER côté projet : la même personne pilote le projet et ses ' +
        "tâches. Omis quand aucun identifiant d'utilisateur n'est configuré.",
    },
    {
      operation: 'Relire les temps consommés pour identifier la ligne créée',
      methode: 'GET',
      gabarit: '/tasks/{taskId}/timespent',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · addTimeSpent, listTimeSpent',
      parametres: [
        {
          nom: 'taskId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (ligne de mission → tâche), posé par src/services/dolibarr/push.ts',
          exemple: '17',
        },
      ],
      preuve: PAR_L_INSTANCE,
      echec: {
        comportement: 'ABANDONNE',
        visible:
          "La cellule reste en échec dans l'écran de synchronisation, en disant que le temps " +
          "est bien parti mais qu'il ne pourra pas être modifié depuis l'application.",
      },
      reglagesTiers: [],
      note:
        "Appelée juste après `addtimespent`, qui ne rend qu'un accusé " +
        '`{success:{code,message}}` sans identifiant de ligne — vérifié dans le code de ' +
        "l'API Dolibarr, en 23.0.1 comme en 23.0.4. La ligne posée est retrouvée par sa " +
        'signature (utilisateur, durée, note) et son `timespent_line_id` est mémorisé : ' +
        'sans lui, aucune modification ultérieure de la cellule ne serait possible.',
    },
    {
      operation: 'Relire une tâche par son identifiant',
      methode: 'GET',
      gabarit: '/tasks/{taskId}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · getTask',
      parametres: [
        {
          nom: 'taskId',
          source: 'IDENTIFIANT',
          origine: 'ExternalLink (prestation → tâche), posé par src/services/dolibarr/taches.ts',
          exemple: '34',
        },
      ],
      preuve: PAR_L_INSTANCE,
      echec: {
        comportement: 'ABANDONNE',
        visible:
          "La prestation est traitée comme si sa tâche n'existait plus, et une nouvelle est " +
          'ouverte à la place.',
      },
      reglagesTiers: [],
      note:
        "Une correspondance mémorisée ne se juge pas sur la liste du projet : celle-ci ne rend " +
        "les tâches qu'aux utilisateurs qui ont un rôle sur le projet, et une tâche existante " +
        'peut donc en disparaître. Un 404 est toléré et signifie « supprimée chez Dolibarr », ' +
        'auquel cas la correspondance est abandonnée. La charge prévue est relue au passage : ' +
        "c'est d'elle que la reprise tire les jours vendus.",
    },
    {
      operation: "Lire un utilisateur Dolibarr pour lui attribuer les temps repris",
      methode: 'GET',
      gabarit: '/users/{userId}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · getUser',
      parametres: [
        {
          nom: 'userId',
          source: 'IDENTIFIANT',
          origine: 'timespent_line_fk_user des temps lus sur la tâche',
          exemple: '1',
        },
      ],
      preuve: PAR_L_INSTANCE,
      echec: {
        comportement: 'ABANDONNE',
        visible:
          "L'écran de reprise indique que l'auteur du temps n'a pas pu être identifié, et le " +
          'temps est écarté plutôt que attribué à quelqu un d autre.',
      },
      reglagesTiers: [],
      note:
        "Appelée une fois par auteur rencontré, pas une fois par temps. L'utilisateur local " +
        "créé à partir de cette lecture naît **sans mot de passe** : il ne peut pas se " +
        "connecter — `verify('')` lève et le refus est le comportement par défaut — il n'existe " +
        "que pour porter l'attribution jusqu'à ce que les rôles arrivent.",
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
            'ExternalLink de type LIEN_UTILISATEUR, renseigné dans Mon profil',
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
      operation: 'Lister les commandes clients utilisables',
      methode: 'GET',
      gabarit: '/orders',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · listOrders',
      parametres: [
        {
          nom: 'limit',
          source: 'CONSTANTE',
          origine: 'src/services/dolibarr/http.ts · listOrders',
          exemple: '1000',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran Administration · Dolibarr affiche l'erreur ; aucun projet n'est créé.",
      },
      reglagesTiers: [],
      note:
        'Deux filtres, tous deux côté client. Le statut : seules 1 (validée) et 2 (en cours) ' +
        'sont retenues — un brouillon n’engage rien, une annulée n’engage plus, une livrée est ' +
        'close. Et `billed` : une commande entièrement facturée n’a plus rien à consommer, et ' +
        'le projet qu’on ouvrirait dessus ne serait jamais facturé. Une commande ' +
        'partiellement facturée reste proposée : c’est le cas courant d’une prestation en cours.',
    },
    {
      operation: 'Lire une commande client et ses lignes',
      methode: 'GET',
      gabarit: '/orders/{orderId}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · getOrder',
      parametres: [
        {
          nom: 'orderId',
          source: 'IDENTIFIANT',
          origine: 'src/services/dolibarr/commande.ts · creerProjetDepuisCommande, attachOrderLine',
          exemple: '42',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran affiche le refus ; rien n'est créé ni écrit.",
      },
      reglagesTiers: [],
      note:
        '`ref_client` porte la référence du bon de commande du client — le champ que le lot 2b ' +
        'reporte sur le projet. Il est nul sur la plupart des commandes, et `ref_customer` en est ' +
        'l’alias sur certaines versions. La commande ne porte **pas** le nom du tiers, seulement ' +
        '`socid` : le titre du projet le résout par `GET /thirdparties`.',
    },
    {
      operation: 'Créer un projet facturable au temps depuis une commande',
      methode: 'POST',
      gabarit: '/projects',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · createProject',
      parametres: [
        {
          nom: 'ref',
          source: 'CALCUL',
          origine: 'src/core/dolibarr/commande.ts · referenceProjetDepuisCommande',
          exemple: 'CO-EXEMPLE',
        },
        {
          nom: 'title',
          source: 'SAISIE',
          origine: 'src/core/dolibarr/commande.ts · titreProjetDepuisCommande',
          exemple: 'BDC-EXEMPLE — Libellé de la commande',
        },
        {
          nom: 'socid',
          source: 'IDENTIFIANT',
          origine: 'socid de la commande, via src/services/dolibarr/commande.ts',
          exemple: '7',
        },
        {
          nom: 'ref_ext',
          source: 'SAISIE',
          origine: 'src/core/dolibarr/commande.ts · referenceExterneCommande',
          exemple: 'BDC-EXEMPLE',
        },
        {
          nom: 'description',
          source: 'SAISIE',
          origine: 'src/services/dolibarr/commande.ts · creerProjetDepuisCommande',
          exemple: 'Ouvert depuis la commande CO-EXEMPLE.',
        },
        {
          nom: 'usage_task',
          source: 'CONSTANTE',
          origine: 'src/services/dolibarr/http.ts · createProject',
          exemple: '1',
        },
        {
          nom: 'usage_bill_time',
          source: 'CONSTANTE',
          origine: 'src/services/dolibarr/http.ts · createProject',
          exemple: '1',
        },
      ],
      preuve: PAR_L_INSTANCE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran affiche le refus ; aucune correspondance locale n'est posée.",
      },
      reglagesTiers: [],
      note:
        '`ref` est **obligatoire** : l’interface de Dolibarr la fabrique par son module de ' +
        'numérotation, son API non — elle refuse par « Bad Request: ref field missing ». Jamais ' +
        'préfixée `PJ`, qui est celui de sa séquence automatique. `usage_task` et ' +
        '`usage_bill_time` sont imposés et non paramétrables : sans eux le projet n’accepte ni ' +
        'tâche ni temps facturable, et `listProjects` le filtrerait aussitôt. Dolibarr rend un ' +
        'entier nu.',
    },
    {
      operation: 'Relire le projet créé pour connaître la référence attribuée',
      methode: 'GET',
      gabarit: '/projects/{projectId}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · createProject',
      parametres: [
        {
          nom: 'projectId',
          source: 'IDENTIFIANT',
          origine: 'identifiant rendu par POST /projects',
          exemple: '12',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'ABANDONNE',
        visible: "L'écran affiche le refus, alors que le projet, lui, a bien été créé.",
      },
      reglagesTiers: [],
      note:
        'La référence (`PJxxxx-nnnn`) est attribuée par Dolibarr : la relire évite qu’un refus ' +
        'ultérieur nomme un projet sous une référence inventée.',
    },
    {
      operation: 'Rattacher la commande au projet créé',
      methode: 'PUT',
      gabarit: '/orders/{orderId}',
      emis: true,
      emisPar: 'src/services/dolibarr/http.ts · linkOrderToProject',
      parametres: [
        {
          nom: 'orderId',
          source: 'IDENTIFIANT',
          origine: 'src/services/dolibarr/commande.ts · creerProjetDepuisCommande',
          exemple: '42',
        },
        {
          nom: 'fk_project',
          source: 'IDENTIFIANT',
          origine: 'identifiant du projet créé',
          exemple: '12',
        },
      ],
      preuve: PAR_LE_DOUBLE,
      echec: {
        comportement: 'TOLERE',
        visible:
          "L'écran annonce que le projet existe mais que la commande n'a pas pu y être " +
          'rattachée, et invite à faire le lien dans Dolibarr.',
      },
      reglagesTiers: [],
      note:
        'Seul `fk_project` est envoyé. C’est la seule écriture de l’application sur un document ' +
        'commercial, et c’est elle qui fait remonter la référence du bon de commande jusqu’à la ' +
        'facture. Renvoyer la commande entière la ferait réenregistrer telle que l’API l’a rendue.',
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
        'ici », jamais « instance en panne ». Le 403 est tolere de meme — `/setup` est reserve ' +
        'aux administrateurs, et une cle portee par un utilisateur ordinaire ne doit pas faire ' +
        'tomber l’ecran pour une valeur facultative. La valeur arrive nue ou enveloppée dans `value`.',
    },
  ],
}
