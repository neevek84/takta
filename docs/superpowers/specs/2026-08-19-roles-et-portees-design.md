# Rôles et portées : ce qui est administré, ce qui appartient au profil

**Statut : constat et cadrage. Aucune implémentation.** Le porteur a demandé
de valider d'abord le fonctionnement actuel, puis de faire l'évolution.

## Le constat, né d'un cas réel

Le 19 août, la première connexion à Dolibarr a été faite avec la clé d'API de
l'utilisateur technique `n8n.cds` (n° 4). Deux conséquences, l'une visible,
l'autre non :

- visible : `/setup/conf/…` est réservé aux administrateurs, et cet
  utilisateur n'en est pas un — l'écran a affiché un refus (corrigé depuis :
  un 403 n'est plus confondu avec une clé refusée) ;
- **invisible** : `dolibarrUserId` valant 4, tous les temps poussés auraient
  été enregistrés dans Dolibarr au nom de `n8n.cds`, sur des CRA appartenant
  au porteur, et c'est sur ces temps que la facturation se fait.

Le second point n'est pas une erreur de saisie. C'est un défaut de portée.

## Deux natures de réglage, aujourd'hui confondues pour Dolibarr

| Réglage | Nature | Portée actuelle |
| --- | --- | --- |
| URL de l'instance Dolibarr | administration | instance ✅ |
| Clé d'API Dolibarr | administration | instance ✅ |
| Correspondances client ↔ tiers, mission ↔ projet | administration | instance ✅ |
| **`dolibarrUserId`** | **profil** | **instance ❌** |
| Client OAuth Google (id, secret, URI de redirection) | administration | instance ✅ |
| Jeton du calendrier Google, `calendarId` | profil | utilisateur ✅ |

Google porte donc déjà la séparation ; Dolibarr ne la porte que pour la moitié
de ses réglages. À un seul consultant, la confusion ne se voit pas. À deux,
les deux CRA partent sous le même utilisateur Dolibarr — et rien à l'écran ne
le dit.

## Le rôle existe et n'est jamais lu

`User.role` vaut `ADMIN`, `MANAGER` ou `CONSULTANT`. `requireUser()` le rend.
**Aucun écran ne le vérifie** : tout compte authentifié atteint
`/admin/dolibarr`, `/admin/google`, `/admin/sync` et peut connecter,
déconnecter ou repointer. Les quatre revues adversariales l'avaient relevé
comme défaut majeur ; il est resté ouvert parce que l'application n'a eu qu'un
seul compte.

## Ce que l'évolution doit trancher

1. **Où vit `dolibarrUserId`.** Candidat : une correspondance
   `utilisateur local ↔ utilisateur Dolibarr`, de portée utilisateur, à côté
   des autres `ExternalLink`. Le push lirait celle du propriétaire du CRA, et
   non un réglage global. Un CRA dont le propriétaire n'a pas de
   correspondance ne doit pas partir sous celle d'un autre : il doit être
   refusé, comme l'est aujourd'hui l'absence d'identifiant.
2. **Ce que voit un `CONSULTANT`.** Un écran « Mon profil » portant ce qui lui
   appartient — son utilisateur Dolibarr, son calendrier Google — et les
   écrans d'administration réservés à `ADMIN`.
3. **Comment le refus se manifeste.** Une redirection muette apprend au
   consultant que l'écran n'existe pas ; un refus nommé lui apprend à qui
   demander.
4. **La reprise.** L'instance existante porte `dolibarrUserId` dans les
   métadonnées de la clé. La migration doit le convertir en correspondance
   pour le compte qui l'a saisi, et non l'effacer.

## Ce qui ne doit pas bouger

La clé d'API reste de portée instance. Une clé par consultant multiplierait
les secrets à faire tourner, et Dolibarr attribue déjà le temps par
`fk_user` — c'est le bon axe, pas la clé.


---

# Annexe — deux demandes du porteur, cadrées et non implémentées

## Gérer les clients et les missions « locaux »

Demandé le 19 août : pouvoir **archiver ou supprimer** un client local et une
mission depuis les réglages.

Le modèle porte déjà `Mission.archived` et `MissionLine.archived`, et
`listMissionsForUser` filtre sur `archived: false` — l'archivage existe donc en
base sans aucun écran pour le poser. `Client` n'a pas de drapeau.

Ce que l'évolution doit trancher :

1. **Archiver n'est pas supprimer.** Un client ou une mission qui porte des CRA
   validés, des temps poussés chez Dolibarr ou des correspondances ne peut pas
   disparaître sans détruire de l'historique facturé. La suppression doit être
   refusée dans ce cas, et le refus doit dire ce qui la retient.
2. **Ce que l'archivage cache, et ce qu'il garde.** Une mission archivée sort
   des écrans de saisie et de la liste, mais ses CRA restent consultables.
3. **Le sort des correspondances.** Archiver ne rompt rien ; supprimer doit
   rompre, sans rien effacer chez Dolibarr — c'est déjà la règle de
   `detachEntity`.
4. **Où.** Les réglages, et non la page des missions : ce n'est pas un geste de
   travail quotidien.

## Un client Dolibarr créé sans passer par les réglages

**Fait le 19 août**, et noté ici parce que c'est le même axe : l'écran des
missions propose désormais les **tiers Dolibarr** et crée le client local, avec
sa correspondance, au moment où la mission naît. Le rattachement préalable dans
les réglages n'est plus un passage obligé.
