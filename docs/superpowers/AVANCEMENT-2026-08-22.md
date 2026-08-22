# Point d'avancement — 22 août 2026

Confronté au code, pas au document précédent : `ETAT.md` datait du 16 août et
annonçait 1 253 tests là où la suite en compte **3 224**.

**Vérifications faites pour ce point** : suite complète verte (3 224 tests),
`tsc` à zéro, `next build` vert (14 routes + middleware).

---

## 1. Ce qui est livré

| Lot | Contenu | État | Preuve |
|---|---|---|---|
| 0 | Socle : authentification, missions, grille, capacité, CRA | **fusionné** | `/login` `/saisie/[month]` `/missions` `/cra` |
| 1a | Prévisionnel, exercice fiscal, plan de charge | **fusionné** | `/charge`, `cra-previsionnel.ts` |
| 1b | Connecteur Google Calendar, file de synchronisation | **fusionné** | éprouvé en réel le 22 août |
| 1c | Calendrier, saisie cyclique, PWA | **fusionné** | `MonthCalendar`, manifeste |
| 1d | Gel du facteur, cascade client/mission/prestation | **fusionné** | `minutesParJour` figé par saisie |
| 1e·1f·1g | Système de design, lisibilité, identité « Encre » | **fusionné** | 48 jetons, contraste vérifié au calcul |
| 2 | Connecteur Dolibarr | **fusionné** | 22 appels catalogués |
| 3 | Validation client : PDF, signature, relances | **fusionné** | `/cra/[craId]/pdf`, `webhooks/signature` |
| 4 | Journal de preuve, API d'événements, ordonnanceur | **fusionné** | `audit.ts`, `/api/events`, `/api/jobs/tick` |
| 5 | Distribution portable **et conteneur** | **fusionné** | `Dockerfile`, `docker-compose.yml` |
| 6 | Catalogue des appels externes et ses gardes | **partiel** | tâches 1 à 7 faites, 8 à 14 non |

**Écrans** : 14 pages, 7 routes d'API.

### Non fusionné : la branche `lot-2b-commande-projet`

**43 commits d'avance sur `main`.** C'est tout le travail des quatre derniers
jours :

- la chaîne commande → projet → tâches → temps, éprouvée contre l'instance réelle ;
- la reprise des tâches en prestations, et la reprise des temps déjà saisis ;
- détacher, archiver, supprimer clients et missions ;
- une douzaine de corrections nées de la recette (statut de tâche, date de
  démarrage, charge prévue, identifiant du temps poussé, affectation au projet).

**Rien de tout cela n'est sur `main`.** C'est le premier obstacle à la mise en
production, et le plus simple à lever.

---

## 2. Ce qui reste

### Lot 6, tâches 8 à 14 — la documentation

Le catalogue des appels externes existe et il est gardé par des tests. Ce qui
manque, ce sont les documents qui s'en servent :

| Livrable | Pour qui | État |
|---|---|---|
| `docs/integrations.md` | qui exploite | absent |
| `docs/reprise-du-code.md` | qui reprend le code | absent |
| `docs/decisions.md` | le porteur | absent |
| `README.md` | qui déploie | présent, à revoir |
| Procédure de montée de version | qui met à jour | absente |

### Chantiers spécifiés, non construits

- **Rôles et portées** — spécifié le 19 août. Aujourd'hui « tout le monde voit
  tout », et l'ordonnanceur ne sert que le compte le plus ancien : un second
  consultant ne recevrait aucun rappel. L'écran de supervision le dit ; le dire
  n'est pas le corriger.
- **Pièce jointe aux courriels** — l'application envoie par SMTP (relances,
  notifications) mais **ne sait pas joindre le PDF**. Le CRA se télécharge et
  s'envoie à la main.

---

## 3. Ce qui doit être fait avant la production

Dans l'ordre, et aucun n'est facultatif.

1. **Fusionner la branche dans `main`.** 43 commits, suite verte, construction
   verte.
2. **`CREDENTIALS_KEY` et `AUTH_SECRET`** : les générer pour la production et
   les garder. **Il n'existe aucune rotation** — perdre `CREDENTIALS_KEY`
   impose de reconnecter Google et Dolibarr, aucun jeton n'étant récupérable
   sans elle.
3. **Rejouer `npm run theme:reprise`** sur l'installation cible, faute de quoi
   une palette enregistrée masque l'identité « Encre ».
4. **Purger les données de test.** La base de développement porte des missions,
   des saisies et trois événements d'agenda qui ne valent rien. La production
   part d'une base neuve.
5. **Réactiver le drainage** — l'agent `launchd` est déchargé depuis le 22 août
   à la demande du porteur. En conteneur, il faudra son équivalent.
6. **Enregistrer les URL de retour de production** chez Google, en HTTPS.

---

## 4. Le déploiement — ce qui existe déjà

**Le conteneur est écrit.** `Dockerfile` multi-étapes vers Postgres,
`docker-compose.yml` avec sa base, ses sondes de santé et ses variables
documentées une par une. `next.config.ts` est en `output: 'standalone'`.

Ce qui reste à décider pour une cible Synology :

- **Où vivent les données.** Postgres en conteneur voisin, ou SQLite sur un
  volume ? Le schéma supporte les deux — c'est une décision du porteur, pas une
  contrainte technique.
- **La sauvegarde.** L'agent `launchd` du Mac ne suit pas dans un conteneur ; il
  faut son équivalent, et un chemin hors du conteneur.
- **HTTPS et nom de domaine**, exigés par Google hors `localhost`.
- **La mise à jour automatique**, qui n'existe pas encore.

---

## 5. Dettes connues, à ne pas découvrir plus tard

- **`tick` sert le compte le plus ancien.** Provision multi-consultants
  incomplète.
- **Un échec de test intermittent**, vu une fois le 21 août, jamais reproduit en
  cinq exécutions. Non expliqué, donc non clos.
- **Aucune rotation de clé de chiffrement.**
- **Le glissement au doigt** n'a jamais été essayé sur un téléphone réel.
