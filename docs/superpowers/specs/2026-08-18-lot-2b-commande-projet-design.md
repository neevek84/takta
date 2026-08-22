# Lot 2b — La commande client crée le projet Dolibarr

## Le flux réel du porteur

Propale → signature client → **commande (BDC)** → projet → tâches → saisie des
temps. La commande est le document ferme : c'est elle qui porte la référence du
bon de commande client, et c'est cette référence qui doit se retrouver sur la
facture.

Aujourd'hui l'application ne sait que **rattacher un projet existant**. Le
projet doit donc être créé à la main dans Dolibarr avant toute configuration,
et rien ne relie la commande au projet.

## Ce que le lot ajoute

À la configuration d'une mission, deux voies au lieu d'une :

1. rattacher un projet Dolibarr existant — inchangé ;
2. **créer le projet depuis une commande client**.

## Le report de la référence client

Le projet Dolibarr n'a **pas** de champ « référence client » : il porte `ref`
(auto, `PJ…`), `title`, `ref_ext`, `description` et des extrafields. La
commande, elle, porte `ref_client`. La référence ne suit donc que si on la loge
explicitement, en deux endroits complémentaires :

- `ref_ext` du projet = `ref_client` de la commande — champ machine, jamais
  retouché, qui survit à un renommage ;
- `title` du projet = « `{ref_client}` — `{nom du tiers}` — `{libellé}` —
  `{ref de la commande}` », les parties absentes étant simplement omises et la
  référence de commande n'étant jamais répétée quand elle tient déjà la tête.
  Mesuré sur l'instance du porteur : **aucune commande ne porte de libellé**, et
  la commande ne porte pas non plus le nom du tiers — seulement `socid`, que le
  service résout. Sans le nom, le titre se réduirait à deux références opaques.

Et surtout : la commande est **rattachée au projet** (`fk_project`). C'est ce
rattachement, et lui seul, qui fait apparaître la commande sous le projet dans
Dolibarr et permet à la facturation des temps consommés de retrouver le BDC.
Sans lui, la chaîne est rompue côté Dolibarr quoi qu'on écrive dans le titre.

**Une commande sans `ref_client` est acceptée mais signalée** : le projet prend
alors pour titre la référence de la commande, et l'écran le dit en toutes
lettres. Refuser bloquerait des cas légitimes ; se taire laisserait partir une
facture sans la référence attendue par le client.

## L'engagement vient de la commande

La reprise d'engagement (jours vendus, TJM) existe depuis une ligne de propale.
Elle est étendue aux **lignes de commande**, sans retirer la propale : la
propale sert avant signature, la commande après. `engagementSource` gagne la
valeur `DOLIBARR_COMMANDE`.

La règle de conversion est la même — une ligne vend des jours, `soldCentiemes`
compte des centièmes de jour, et le facteur de conversion d'une journée
n'intervient jamais. Elle est extraite dans `core/dolibarr/ligne-vendue.ts` pour
que les deux documents partagent une implémentation unique plutôt que deux qui
dérivent.

## Ce qui ne peut pas être annulé, et comment on le dit

Un projet créé chez Dolibarr ne se supprime pas d'ici — le port ne porte aucune
suppression, et n'en portera pas. L'ordre est donc :

1. lire la commande (appel distant d'abord : une panne ne laisse rien derrière) ;
2. **vérifier la cohérence des tiers** — la commande du tiers A ne crée pas de
   projet pour une mission du client B — avant toute écriture distante ;
3. si la commande porte déjà un projet, **ne pas en créer un second** : la
   mission est rattachée à ce projet-là ;
4. créer le projet (`usage_task = 1`, `usage_bill_time = 1` imposés : sans eux
   aucun temps ne peut y être poussé) ;
5. rattacher la mission au projet localement, ce qui déclenche le rattrapage
   des CRA déjà validés, comme tout rattachement ;
6. rattacher la commande au projet. **Si cette dernière étape échoue, le projet
   existe** : l'écran l'annonce et invite à faire le lien à la main, au lieu de
   laisser croire à un échec complet qui pousserait à tout recommencer — et à
   créer un second projet.

## Appels Dolibarr ajoutés

| Opération | Méthode | Route |
| --- | --- | --- |
| Lister les commandes d'un tiers | GET | `/orders` |
| Lire une commande et ses lignes | GET | `/orders/{id}` |
| Créer le projet | POST | `/projects` |
| Rattacher la commande au projet | PUT | `/orders/{id}` |

Ne sont proposées que les commandes **qui restent à faire** : ni brouillon (rien
n'est engagé), ni annulée (plus rien ne l'est), ni livrée (close), ni
entièrement facturée (`billed`) — le projet qu'on ouvrirait dessus ne serait
jamais facturé. Une commande partiellement facturée reste proposée : c'est le
cas courant d'une prestation en cours.

Toutes les quatre entrent au catalogue `src/integrations/dolibarr/catalogue.ts`,
que le double HTTP et le test de couverture rendent obligatoire.
