# SDD ledger — plan: docs/superpowers/plans/2026-08-15-lot-0-socle-cra.md

Exécution en vagues parallèles (override explicite du human partner).
Agents ne commitent pas ; le contrôleur commite par vague.

Task 1: complete (commit cc5f3c4, socle + toutes deps figees)
Task 1: defaut de plan corrige par le controleur — jsdom inutilisable (Node 22.11 < 22.12,
  @exodus/bytes en ESM pur) ET `environmentMatchGlobs` supprime en Vitest 4.1.
  Substitut valide empiriquement : happy-dom + directive par fichier
  `// @vitest-environment happy-dom`. Les taches 12/13 doivent l'utiliser.
Task 1: minor (deferred): npm audit signale 3 vulns high (deps transitives, hors perimetre).
Vague 2 (8 agents paralleles) : taches 2,3,4,5,6,10a,13a,16a
Task 2: complete (creneaux, 6 tests)
Task 3: complete (capacite 3 modes, 7 tests)
Task 4: complete (engagement, 6 tests)
Task 5: complete (machine a etats CRA, 9 tests)
Task 10a: complete (core/month/build, 6 tests) — services/time-entries reporte vague 4
Task 13a: complete (useDragSelect, 6 tests) — cablage MonthGrid reporte vague 7
Task 16a: complete (feries FR, 6 tests) — cablage settings/admin reporte vague 4
Task 6: complete apres 1 round de correction (schema portable, 4 tests SQLite)
Task 6: DEFAUT DE PLAN CORRIGE — slotId nullable rendait @@unique inoperante
  (NULL != NULL dans un index unique) sur 100% des lignes du lot 0, qui saisit
  a la journee. Corrige en `slotId String @default("")`, sentinelle = journee
  entiere. Plan + briefs 6/10/11/12 regeneres. Le contournement initial de
  l'agent (test sur slotId='AM') testait un cas que l'app ne produit jamais.
Task 6: minor (deferred): Postgres jamais valide empiriquement (aucun serveur
  joignable). Migration Postgres non generee -> a faire en tache 15.
DECISION CONTROLEUR: depot bascule sur SQLite pendant l'implementation
  (.env DATABASE_URL=file:./dev.db). Restauration provider postgresql +
  generation migration = responsabilite de la tache 15.
Vague 3 (2 agents paralleles) : taches 7, 8
Task 7: complete (auth Auth.js 5.0.0-beta.32, 4 tests). next-auth conforme au brief.
Task 7: hors perimetre accepte par le controleur — ajout de
  "noUncheckedSideEffectImports": false dans tsconfig.json. TypeScript 7
  (compilateur natif) applique ce flag par defaut, cassant l'import de
  globals.css dans layout.tsx. La valeur false restaure le defaut documente
  du tsc classique ; n'assouplit aucune autre verification.
Task 8: complete (reglages + ecran admin saisie, 6 tests)
Verif vague 3 : 72 tests / 11 fichiers, tsc 0 erreur, src/core/ pur,
  .env et prisma/dev.db bien ignores par git.
Vague 4 (3 agents paralleles) : taches 9, 10b, 16b
Task 9: complete (clients/missions/lignes + ecran, 6 tests)
Task 9: DEFAUT DE PLAN CORRIGE — le test verbatim creait deux missions
  homonymes ('ITSM') sous le meme userId ; listActiveLines scopant par
  userId, la ligne du test precedent remontait dans le filtre et faisait
  echouer le 3e test. Renomme en 'ITSM deux lignes'. Plan corrige.
Task 10b: complete (getMonthEntries scopee par userId) — saveEntry = tache 11
Task 16b: complete (loadFrenchHolidays + section admin hors du form principal)
Task 16b: DEFAUT D'INFRA CORRIGE par le controleur — vitest executait les
  fichiers de test en parallele sur une seule base SQLite partagee, d'ou des
  echecs non deterministes. `fileParallelism: false` dans vitest.config.ts.
  Verifie par 3 executions consecutives : 78/78 stables.
Verif vague 4 : 78 tests / 12 fichiers x3 runs, tsc 0 erreur.
Vague 5 (1 agent) : tache 11
Task 11: complete (saveEntry + controle de capacite + verrouillage, 9 tests)
Task 11: collision inter-fichiers corrigee — time-entries.test.ts laissait
  capacityMode=DESACTIVE, cassant settings.test.ts selon l'ordre. Ajout de
  prisma.settings.deleteMany({}) dans son afterAll. Donnee de test corrigee,
  pas l'implementation.
Verif vague 5 : 87 tests / 13 fichiers, stable sur 2 runs, tsc 0 erreur.
Vague 6 (2 agents paralleles) : taches 12, 14
Task 12: complete (grille, totaux, bandeau engagement, page saisie, 6 tests)
Task 12: fix d'infra de test legitime — @testing-library/react n'auto-nettoie
  pas le DOM sans test.globals ; ajout d'un afterEach(cleanup) explicite dans
  le fichier de test uniquement.
Task 14: complete (CRA, transitions manuelles, suivi facturation, 8 tests)
Task 14: verrouillage verifie de bout en bout (VALIDE -> saveEntry renvoie
  VERROUILLE ; ROUVRIR -> saisie a nouveau possible).
Verif vague 6 : 101 tests / 15 fichiers, tsc 0 erreur.

BLOQUANT IDENTIFIE (pre-existant, hors perimetre des taches 12/14) :
  `next build` echoue pour deux causes distinctes, toutes deux des defauts
  d'infra/plan et non des taches :
  1. typescript@7.0.2 (compilateur natif) non supporte par next@15.5.23.
     Installation non epinglee en tache 1. C'est aussi la cause du
     contournement noUncheckedSideEffectImports de la tache 7.
  2. src/middleware.ts tire @node-rs/argon2 dans le runtime edge.
     DEFAUT DE PLAN : Auth.js v5 impose de scinder la config (auth.config.ts
     edge-safe pour le middleware, provider Credentials cote Node uniquement).
     Le plan ne le prevoyait pas.
  -> Traite en vague 7 par un agent dedie, en parallele du cablage tache 13.
Vague 7 (2 agents paralleles) : tache 13b + correctif de build
Task 13b: complete (cablage useDragSelect dans MonthGrid, 12 tests grid verts)
Fix build: complete. typescript epingle a ^5.9.3 ; noUncheckedSideEffectImports
  retire de tsconfig (redevenu inutile hors TS7) ; auth scinde selon le patron
  officiel Auth.js v5 : src/auth.config.ts edge-safe (providers: []),
  middleware.ts n'importe plus que next-auth + auth.config, src/auth.ts porte
  Credentials + Prisma + argon2 cote Node.
Verif controleur vague 7 : tsc 0, 101 tests / 15 fichiers, `next build` REUSSI
  (8 routes, middleware 86.5 kB), et grep sur .next/server/src/middleware.js
  confirme l'absence d'argon2 et de PrismaClient dans le bundle edge.
Fix build: minor (deferred): warning jose/Edge Runtime (CompressionStream)
  preexistant, vient de next-auth, non bloquant.
Fix build: minor (deferred): npm audit 3 vulns high preexistantes.
Fix build: minor (deferred): le callback `authorized` laisse NextAuth gerer la
  redirection, qui peut ajouter ?callbackUrl=... ; aucun test n'exerce
  middleware.ts, donc non verifie automatiquement.
ETAT: prisma/schema.prisma est commite avec provider=sqlite (chemin qui tourne
  reellement ici). `npm run db:pg` bascule sur Postgres. Migration Postgres
  jamais generee ni validee dans cet environnement -> a documenter en tache 15.
Vague 8 (1 agent) : tache 15
Task 15: complete (Dockerfile, docker-compose, .dockerignore, README)
Task 15: adaptation — le brief copiait /app/public, qui n'existe pas dans le
  projet ; ligne COPY retiree (aurait fait echouer le build Docker).
Task 15: NON VERIFIE — Docker absent de l'environnement, `docker compose
  up --build` jamais execute. Postgres jamais joignable, aucune migration
  generee. Les deux sont documentes explicitement dans le README.

=== REVUE FINALE DE BRANCHE (opus) : 4 Critiques, 9 Importants, 12 Mineurs ===
Rapport complet : final-review.md. FUSION BLOQUEE.
Les 4 critiques sont tous des defauts de JOINTURE entre taches paralleles.
C1 postcss.config.mjs absent -> Tailwind jamais execute, UI sans aucun style
C2 Dockerfile genere le client Prisma sur provider=sqlite, compose injecte
   une URL postgresql -> conteneur non demarrable ; aucune migration Postgres
C3 EngagementBar compare les saisies du mois affiche aux jours vendus du
   contrat entier -> chiffre faux des le 2e mois
C4 saveSettings ne valide rien -> minutesParJour=0 atteignable -> toute saisie
   vaut 0 -> saveEntry SUPPRIME la ligne en renvoyant ok:true
I1 mode AVERTISSEMENT strictement equivalent a DESACTIVE (verdict warn jete)
I2 totaux formates avec le minutesParJour de la 1ere ligne, pas du reglage
I3 cellules non controlees -> saisie refusee reste affichee
I4 grille indexe sur (ligne,date) en ignorant slotId
I5 missions/page et cra/page interrogent Prisma sans userId ; listClients()
   ne prend aucun userId -> provision multi-consultants percee
I6 saveEntry ne verifie aucune affectation de l'utilisateur sur la ligne
I7 admin n'expose que 3 des 7 reglages ; allowedSlotIds est du code mort
I8 aucune navigation, aucune deconnexion, pas de src/app/page.tsx -> 404
I9 deux affirmations fausses dans le README
Reportables confirmes : 3 vulns npm (via next, surface de build), warning jose,
   ?callbackUrl. Manque de test sur middleware.ts -> a combler en lot 1.
VAGUE DE CORRECTION : 4 agents paralleles, perimetres disjoints.
  Fix A infra   : C1, C2, I9
  Fix B grille  : C3, I1, I2, I3, I4, I6
  Fix C reglages: C4, I7
  Fix D scope   : I5, I8

=== VAGUE DE CORRECTION (4 agents paralleles) — tous rendus ===
Fix A: C1 postcss.config.mjs cree (Tailwind produit enfin du CSS, prouve) ;
  C2 Dockerfile bascule le provider via db:pg avant generate/build, CMD
  applique migrate deploy ; migration Postgres initiale generee HORS LIGNE
  via `prisma migrate diff --from-empty --to-schema-datamodel --script` ;
  I9 README rendu exact.
Fix B: C3 getLineEngagementTotals sans borne de mois -> l'engagement cumule
  enfin sur toute la ligne ; I1 SaveResult porte `warning`, bandeau ambre ;
  I2 minutesParJour global descend jusqu'a TotalsRow ; I3 cellules
  controlees, valeur refusee restauree ; I4 la cle (ligne,date) agrege les
  creneaux ; I6 saveEntry verifie l'Assignment -> NON_AFFECTE.
  src/core/ non touche : computeEngagement etait juste, son raccordement
  etait faux.
Fix C: C4 zod dans updateSettings (le service est la barriere, pas le
  formulaire) ; I7 les 7 reglages de la spec sont exposes, editeur de
  creneaux gerant le franchissement de minuit.
Fix D: I5 listMissionsForUser + listClients(userId) via Assignment, pages
  repassent par la couche service ; I8 src/app/page.tsx + (app)/layout.tsx
  avec navigation et deconnexion reelle, /login reste sans menu.
VERIF CONTROLEUR SUR ARBRE INTEGRE : tsc 0 ; 152 tests / 17 fichiers stables
  sur 2 runs ; `next build` reussi (8 routes) ; CSS 13290 octets, 0 directive
  @tailwind brute restante, regles reelles presentes.
Minors reportes par la vague : node_modules complet copie dans l'image runner
  (taille contre fiabilite du CLI prisma) ; NON_AFFECTE non atteignable depuis
  l'UI actuelle (saveCell filtre deja par listActiveLines) ; cellule
  multi-creneaux en lecture seule sans surface de correction en lot 0 ;
  toAppSettings resubstitue DEFAULT_SLOTS sur liste vide ; fenetre transitoire
  ou un client/mission sans ligne est visible a tous.

=== RE-REVUE CIBLEE (opus) : 13/13 CORRIGES, branche fusionnable ===
Rapport : re-review.md. Verifie par execution : C1 (CSS reel), C2 (migration
regeneree = diff vide), C3 (cumul inter-mois), C4 (valeur aberrante refusee),
I5/I6 (isolation entre utilisateurs). Aucun test existant supprime ni affaibli.
Reserve sur I7 : 6,5/7 reglages et non 7/7 comme l'affirmait l'agent C — le
rechargement des feries reste destructif en bloc.

PARKED (5 mineurs nouveaux, tous sans effet au lot 0 mono-consultant,
tous meilleurs que l'etat d'avant correctif) :
R1 cellule en lecture seule des UN seul creneau, alors que le message parle
   d'agregation -> reformuler le message. Ruling: acceptable, l'alternative
   doublait le total du jour.
R2 creer une mission sans ligne sur un client deja revendique le re-expose a
   tous. Ruling: acceptable, seuls des noms fuient, jamais jours ni TJM ;
   avant le correctif listClients() n'avait aucun scope du tout.
R3 supprimer tous les creneaux affiche "enregistre" mais les defauts
   reviennent au rechargement (toAppSettings resubstitue DEFAULT_SLOTS).
R4 un second consultant ne peut pas s'ajouter une ligne sur une mission deja
   revendiquee. Ruling: sans objet en mono-consultant, a traiter au lot 1.
R5 step="0.5" sur le seuil de capacite bloque la soumission du formulaire
   entier si capacityCentiemes n'est pas multiple de 50.
-> R3 et R5 sont des pieges immediats bien que mineurs ; recommandes en
   premier correctif du lot 1, ou en passe rapide si le user le souhaite.
AVANT MISE EN SERVICE (pas avant fusion) : un `docker compose up --build` reel
et la validation du chemin Postgres, jamais eprouves ici.
