# Recette Dolibarr — 18 août 2026

Instance : Dolibarr 23.0.1, atteinte et répondante (connecteur MCP vérifié).
Application : `npm run dev`, http://localhost:3000, base `prisma/dev.db`.

## État de départ, mesuré et non supposé

| Point | Valeur |
| --- | --- |
| Identifiant utilisateur Dolibarr | `1` — l'administrateur de l'instance |
| Projets facturables au temps (`usage_bill_time = 1`) | six |
| Clés d'API enregistrées dans l'application | aucune |
| Correspondances `ExternalLink` | aucune |
| File de synchronisation | 68 travaux en attente, **tous GOOGLE**, aucun DOLIBARR |
| CRA existants | deux, août 2026, tous deux `BROUILLON` |

Le dernier point de la file compte : connecter Dolibarr ne déclenchera
aucun envoi rétroactif inattendu, la file ne contenant rien pour lui.

## L'ordre n'est pas indifférent

Un CRA validé **avant** que Dolibarr soit connecté et la mission rattachée
n'est jamais mis en file : `isDolibarrPushArmed` exige les deux, et sans elles
la validation n'arme rien. Le rattrapage existe (`rattrapage.ts`) et se
déclenche au rattachement du projet, mais la recette ne doit pas dépendre de
lui pour son premier passage.

**Ordre : connecter → rattacher le tiers → rattacher le projet → valider.**

## Scénario A — projet existant (testable aujourd'hui)

1. Se connecter à l'application, aller sur Administration · Dolibarr.
2. Renseigner l'URL de l'API, la clé, et l'identifiant utilisateur `1`.
   La clé est essayée avant d'être enregistrée : une clé fausse est refusée
   tout de suite, pas au premier envoi.
3. Rattacher le tiers Dolibarr au client local.
4. Rattacher le projet à la mission.
5. Valider le CRA d'août.
6. Vider la file, puis vérifier côté Dolibarr : la tâche créée, les temps
   passés, leur durée et leur date.

## Scénario B — sans projet : ce que l'application sait et ne sait pas faire

Le port `DolibarrApi` porte `createTask`, **pas** `createProject`. La tâche est
créée automatiquement au moment de l'envoi, une par prestation ; le projet, non.

La reprise de propale (`propal.ts`) est **en lecture seule** : elle recopie les
jours vendus et le TJM d'une ligne de propale sur une prestation existante.
Elle ne crée ni projet ni tâche.

Donc la chaîne « propale validée → projet → tâche » n'existe pas. Le scénario B
se réduit aujourd'hui à : projet créé à la main dans Dolibarr, puis scénario A.
