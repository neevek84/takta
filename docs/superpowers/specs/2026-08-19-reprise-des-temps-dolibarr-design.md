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

## Cinq questions que la spec devra trancher

1. **La route de lecture n'existe pas.** Le port sait ajouter, modifier et
   supprimer un temps passé ; il ne sait pas les lire. Il faut une route,
   cataloguée et éprouvée contre l'instance du porteur — sa forme n'est pas
   connue avec certitude sur la 23.0.1.
2. **Quel facteur figer.** Chaque saisie porte son `minutesParJour`, figé à
   l'écriture. Un temps Dolibarr est une durée en secondes : la convertir en
   fraction de journée exige un facteur, et c'est lui qui décide du nombre de
   jours facturés. Celui de l'instance Dolibarr (`TIMESHEET_DAY_DURATION`) ou
   celui de la mission locale ? Les deux se défendent, et ils diffèrent chez le
   porteur.
3. **À qui appartiennent ces temps.** Dolibarr les attribue par `fk_user`.
   N'importer que ceux de l'utilisateur configuré, sans quoi le CRA du porteur
   se remplirait du travail d'un collègue.
4. **Quelle prestation.** La correspondance `prestation → tâche` n'existe que
   pour les prestations créées ici. Un projet existant porte des tâches qui ne
   correspondent à rien localement : il faut soit créer une prestation par
   tâche, soit demander l'appariement.
5. **Où se posent les heures.** Un temps Dolibarr porte une date et une durée,
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

## Recommandation

Un lot à part entière, à faire **après** la recette de bout en bout du flux
commande → projet → tâches → saisie → push. Cette recette donnera la seule
chose qui manque pour l'écrire : la forme réelle des temps que l'instance du
porteur renvoie, et la preuve que le push ne double rien.
