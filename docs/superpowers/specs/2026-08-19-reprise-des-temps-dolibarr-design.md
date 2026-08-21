# Reprendre les temps déjà saisis dans Dolibarr

**Statut : analyse, aucune implémentation.** Demandé le 19 août : au moment où
une mission se rattache à un projet **existant**, remonter dans l'application
les temps déjà consommés côté Dolibarr.

## Ce que ça vaut

Réel et utile. Un projet ouvert depuis des mois porte déjà des temps ; sans
eux, l'engagement affiché dans l'application et sur le CRA est faux dès le
premier jour — il annonce un reste à consommer qui ne tient pas compte de ce
qui a déjà été servi. C'est exactement le chiffre sur lequel le client
s'appuie.

## Le danger, et il domine tout le reste

**Le rebond.** L'application pousse les temps d'un CRA validé. Si elle
importe un temps venu de Dolibarr sans mémoriser qu'il en vient, le premier
CRA validé le **repoussera** — et le client se retrouvera facturé deux fois
la même journée.

L'idempotence du push tient entièrement à la table `CraTimeSpent`, dont la clé
est `craId|lineId|date|slotId`. Or au moment d'un rattachement, le CRA du mois
concerné n'existe pas forcément. Toute reprise doit donc **poser la
correspondance en même temps qu'elle crée la saisie**, et la poser pour le CRA
qui portera ce mois — quitte à le créer. Une reprise qui n'y arrive pas ne doit
rien créer du tout : mieux vaut un engagement faux qu'une double facture.

## Les arbitrages du porteur, rendus le 20 août

| Question | Décision |
| --- | --- |
| Quel facteur figer sur les saisies reprises | **Celui de Dolibarr**, repris comme l'est déjà la période fiscale (`TIMESHEET_DAY_DURATION`, écran de reprise des réglages). |
| Quels temps importer | **Tous**, sans filtrer par utilisateur : les prestations sont censées correspondre à la commande, et un écart signalerait un défaut de rigueur côté Dolibarr — pas une raison de masquer. |
| Apparier tâche et prestation | **Une fenêtre de conversion**, où le porteur fait correspondre chaque tâche à une prestation. |
| Jusqu'où reprendre | **Jusqu'au dernier jour du mois précédent.** Le mois en cours se saisit dans l'application, qui le poussera. |
| Effacer les temps repris chez Dolibarr | **Jamais par l'application.** C'est le porteur qui supprime, dans Dolibarr, les temps du mois en cours qu'il va ressaisir. L'application **rappelle** ce geste au moment de l'import, et la procédure de mise en œuvre le documente. |

La dernière décision est la plus importante, et elle est juste : une suppression
faite par l'application porterait sur des temps peut-être déjà rattachés à des
factures émises, que Dolibarr ne rend pas. Le rappel remplace le risque par une
consigne — et la coupure au dernier jour du mois précédent fait que ce que le
porteur a à supprimer tient dans un mois, pas dans un historique.

## Deux questions techniques que la spec devra trancher

1. **La route de lecture n'existe pas.** Le port sait ajouter, modifier et
   supprimer un temps passé ; il ne sait pas les lire. Il faut une route,
   cataloguée et éprouvée contre l'instance du porteur — sa forme n'est pas
   connue avec certitude sur la 23.0.1.
2. **Où se posent les heures.** Un temps Dolibarr porte une date et une durée,
   jamais un créneau. Les saisies locales ont un créneau, une heure de début et
   une heure de fin, et leur clé d'unicité porte l'heure de début : deux temps
   du même jour sur la même prestation doivent recevoir deux heures distinctes,
   inventées.

## Ce qui reste vrai quoi qu'il arrive

- Un mois dont le CRA est **validé** est verrouillé : aucune reprise n'y entre.
- La reprise est un geste **explicite**, jamais automatique au rattachement :
  elle crée des saisies chez l'utilisateur, et une importation surprise sur une
  mission de plusieurs années serait irréversible à la main.
- Elle s'annonce comme le reste : combien de temps repris, sur quelles
  prestations, et ce qui a été **écarté** — le mois verrouillé, le temps d'un
  autre utilisateur, la tâche sans prestation.

## Ce que la mise en œuvre devra documenter

La procédure d'intégration en cours de commande, dans l'ordre :

1. rattacher la mission au projet Dolibarr existant ;
2. apparier les tâches aux prestations ;
3. importer les temps **jusqu'au dernier jour du mois précédent** ;
4. **supprimer dans Dolibarr** les temps du mois en cours — geste manuel, que
   l'application rappelle mais ne fait pas ;
5. saisir le mois en cours dans l'application, qui le poussera à la validation.

## Recommandation

Un lot à part entière, à faire **après** la recette de bout en bout du flux
commande → projet → tâches → saisie → push. Cette recette donnera la seule
chose qui manque pour l'écrire : la forme réelle des temps que l'instance du
porteur renvoie, et la preuve que le push ne double rien.

Le besoin, lui, est daté : le porteur intègre l'outil **en cours de commande**
et veut envoyer un CRA juste. Sans reprise, le premier CRA annoncera un reste à
consommer faux de tout ce qui a déjà été servi.
