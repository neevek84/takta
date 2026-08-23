# Suivi CRA, génération depuis la saisie, vue 3 mois

**Date :** 2026-08-23
**Statut :** design validé, en attente de plan d'implémentation

---

## 1. Intention

Six évolutions, demandées ensemble parce qu'elles racontent une seule chose :
**le CRA se génère là où on saisit, et l'écran CRA cesse d'être un lieu de
travail pour devenir un lieu de suivi.**

Aujourd'hui l'écran `/cra` fait les deux : il ouvre les CRA *et* il les
présente, en cartes, sur un seul mois. Les cartes tiennent tant qu'il y en a
trois ; à trente elles deviennent illisibles. Et l'ouverture d'un CRA depuis un
écran qui ne montre aucune saisie oblige à faire confiance de mémoire à ce
qu'on est en train d'arrêter.

| # | Évolution |
|---|---|
| A | `/cra` devient **Suivi CRA** : un tableau, toutes périodes, filtrable |
| B | Le contenu d'une carte déménage sur une page de détail `/cra/[craId]` |
| C | La génération d'un CRA part de l'écran **Saisie** |
| D | À la génération, le sort du prévisionnel du mois devient un **choix humain** |
| E | Une troisième vue de saisie : **3 mois** (mois affiché, +1, +2) |
| F | Le gabarit de page s'élargit et ses marges se resserrent |

### Ce que ces évolutions ne font pas

**Elles ne touchent pas à la machine à états du CRA.** `BROUILLON · ENVOYE ·
VALIDE · REFUSE` et leurs quatre transitions restent exactement ce qu'elles
sont. Aucune migration de base n'est nécessaire — la seule notion nouvelle,
« facturé », est **dérivée** de champs qui existent déjà.

**Elles ne changent rien à la synchronisation ni à la signature.** Le drainage
Dolibarr, les relances, l'archive du PDF signé : rien n'est déplacé, rien n'est
reformulé.

---

## 2. A — Suivi CRA

### La route et le nom

`/cra` est conservée. Le libellé change partout où il se dit : entrée de
navigation ([`NavRail`](../../../src/components/nav/NavRail.tsx), tableau
`TRAVAIL`), titre de la page, et les tests qui cherchent le lien par son nom
accessible.

L'icône `IconeCra` ne change pas : c'est le même écran, il porte le même repère.

### L'état affiché, et pourquoi il est dérivé

Le filtre demandé nomme cinq choses, dont une qui n'est pas un statut :

```
Brouillon · Envoyé · Validé · Refusé · Facturé
```

« Facturé » n'existe pas dans `CraStatus`. C'est le résultat du **suivi saisi à
la main** (`invoiceNumber`, `invoicedAt`, `paidAt`), dont
[`services/cra.ts`](../../../src/services/cra.ts) rappelle qu'il n'est le
produit d'aucun calcul : l'application ne facture pas, et ne facturera pas.

On introduit donc un module pur, `src/core/cra/etat-suivi.ts` :

```ts
export type EtatSuivi = CraStatus | 'FACTURE'

/**
 * Un CRA validé dont la facture est renseignée n'est plus « à surveiller » :
 * le cycle est allé jusqu'au bout. C'est ce que le filtre masque par défaut.
 */
export function etatSuivi(cra: {
  status: CraStatus
  invoiceNumber: string | null
  invoicedAt: Date | null
}): EtatSuivi
```

`FACTURE` vaut quand `status === 'VALIDE'` **et** (`invoiceNumber` non vide
**ou** `invoicedAt` non nul). `paidAt` n'entre pas dans la règle : on peut
facturer sans être payé, et un CRA facturé impayé doit rester visible sous
« Facturé » plutôt que de disparaître dans une sixième catégorie que personne
n'a demandée.

**Pourquoi dérivé et pas un vrai statut.** Ajouter `FACTURE` à la machine à
états demanderait une transition, un événement de journal, une migration, et
surtout une réponse à « que se passe-t-il si on rouvre un CRA facturé ? ». La
question n'a pas d'intérêt : le cycle *du document* s'arrête à la validation,
la facturation est un fait qu'on note à côté. Un état dérivé dit exactement
cela.

### La portée : toutes périodes, filtre de mois optionnel

`listCras(userId, month)` devient :

```ts
listCrasSuivi(userId, { etats: EtatSuivi[]; month?: string }): Promise<CraView[]>
```

Sans `month`, toutes périodes confondues, triées **mois décroissant puis
mission**. Le mois le plus récent en tête : c'est celui sur lequel on agit.

Le filtre d'états est appliqué **en base**, pas après lecture. Traduction du
tableau d'états en clause Prisma :

- les statuts simples deviennent un `status: { in: [...] }` ;
- `FACTURE` devient `{ status: 'VALIDE', OR: [{ NOT: { invoiceNumber: null } }, { NOT: { invoicedAt: null } }] }` ;
- `VALIDE` **sans** `FACTURE` doit exclure les facturés, sans quoi cocher
  « Validé » ramènerait ce que « Facturé » décoché venait de masquer. C'est le
  piège de cet écran, et il se teste.

Une liste d'états vide ne rend rien — et l'écran le dit en toutes lettres
(« Aucun état sélectionné »), plutôt que de laisser croire qu'il n'existe aucun
CRA.

### Ce que le tableau montre

Rendu par [`DataTable`](../../../src/components/ui/DataTable.tsx), qui existe
déjà et porte le défilement horizontal et les chiffres à chasse fixe.

| Colonne | Contenu |
|---|---|
| Mois | `libelleMois(cra.month)` |
| Client | `cra.clientName` |
| Mission | `cra.missionLabel` |
| Jours | `formatJours(cra.synthese.totalCentiemes)` |
| État | `StatusBadge`, étendu à `FACTURE` |
| N° facture | `invoiceNumber ?? '—'` |
| Facturé le | `invoicedAt` au format court, ou `—` |
| — | lien **Ouvrir** vers `/cra/<id>` |

`StatusBadge` gagne le cas `FACTURE`. Sa teinte doit être un couple déclaré du
système de jetons — `tokens.test.ts` refuse le reste, et il a déjà refusé une
première écriture ailleurs dans ce code.

**Aucune transition n'est offerte dans le tableau.** C'est délibéré et
c'est un point de sécurité, pas d'ergonomie : les deux bandeaux qui prémunissent
contre une validation aveugle — « ce CRA n'ira pas dans Dolibarr » et « du
prévisionnel sera annulé » — vivent sur la page de détail. Un bouton
« Valider » dans une ligne de tableau permettrait de valider sans les avoir vus.
**La liste montre et filtre ; le détail agit.**

### Le filtre à l'écran

Cinq cases à cocher, plus un sélecteur de mois vide par défaut. L'état vit dans
l'adresse :

```
/cra?etats=BROUILLON,ENVOYE,REFUSE
/cra?etats=BROUILLON,ENVOYE,REFUSE&month=2026-08
```

**Dans l'URL et résolu côté serveur**, comme la vue de saisie l'est déjà : lu
après le montage, l'écran afficherait d'abord tout puis se replierait, et ce
clignotement porte sur toute la liste. L'adresse est aussi ce qui rend un
filtrage partageable et rejouable.

L'absence de `etats` vaut le défaut : **`BROUILLON`, `ENVOYE`, `REFUSE`** —
c'est-à-dire tout sauf `VALIDE` et `FACTURE`. Un paramètre qui ne dit rien de
plus que son absence n'est pas écrit dans l'adresse.

### Ce qui ne bouge pas

La section « CRA en souffrance » et le bouton « Lancer les relances échues »
restent en bas de l'écran, avec leur condition d'affichage actuelle. Ils ne
sont pas concernés par le filtre : une souffrance est une souffrance quel que
soit l'état coché.

---

## 3. B — La page de détail `/cra/[craId]`

La route existe déjà pour le PDF (`/cra/[craId]/pdf`). On lui ajoute une
`page.tsx`.

Elle reçoit, dans cet ordre, tout ce que la carte portait :

1. le bandeau d'erreur d'envoi (le dictionnaire `ERREURS` déménage ici) ;
2. l'en-tête — client, mission, mois, `StatusBadge`, `Origine` ;
3. le bandeau « ce CRA n'ira pas dans Dolibarr » ;
4. la synthèse — jours réalisés, ligne par ligne ;
5. `SignatureCard`, quand une demande existe ;
6. le bandeau « du prévisionnel sera annulé à la validation » ;
7. le téléchargement du PDF, l'envoi pour signature, le rafraîchissement ;
8. les transitions manuelles ;
9. le formulaire de suivi de facturation.

Nouveau service :

```ts
getCra(userId, craId): Promise<CraView>
```

Scopé sur `userId` comme tous ses voisins — c'est ce qui garantit qu'on
n'affiche jamais le CRA d'un autre — et il lève quand rien ne correspond, ce
que la page traduit en `notFound()`.

Il rend un `CraView` complet : la synthèse, le prévisionnel restant et
l'armement Dolibarr sont calculés pour **un seul** CRA. Les fonctions de lot
existantes (`syntheseParMission`, `compterPrevisionnelParMission`,
`missionsArmeesPourDolibarr`) acceptent déjà un tableau d'identifiants : on les
appelle avec un seul élément plutôt que d'écrire un second chemin de calcul qui
finirait par diverger du premier.

Les server actions de signature retournent désormais vers `/cra/<id>` :

```ts
function retour(craId: string, raison?: string): never
```

`moveCra` et `saveTracking` revalident `/cra` **et** `/cra/[craId]` : la liste
montre l'état et le numéro de facture, elle doit suivre.

---

## 4. C — La génération part de la Saisie

### Ce qui disparaît

Le formulaire « Ouvrir un CRA » — sélecteur de mission plus bouton — est retiré
de l'écran de suivi. `openCra` quitte `src/app/(app)/cra/actions.ts`.

### Ce qui apparaît

Dans [`SaisieClient`](../../../src/app/(app)/saisie/[month]/SaisieClient.tsx),
à côté de « Remplir le CRA » et « Vider le CRA », dans le même groupe de
boutons conditionné par `ligne !== undefined` :

> **Générer le CRA**

Il vise **la mission de la prestation sélectionnée**, sur **le mois affiché**.
Le geste suit le regard : on voit ce qu'on arrête au moment où on l'arrête, et
la question du prévisionnel (section D) ne porte que sur cette mission-là.

Le bouton n'agit jamais seul. Il ouvre un panneau en ligne — **jamais
`window.confirm`**, qui bloque le fil et n'existe pas au test, et pour la même
raison que la confirmation de vidage juste au-dessus.

Après génération, l'écran reste sur la Saisie et affiche un message portant le
lien vers le CRA produit. Rediriger vers le suivi arracherait l'utilisateur à
un mois qu'il n'a pas fini de regarder.

---

## 5. D — Le sort du prévisionnel devient un choix humain

### Le problème que ça ferme

Un client demande son CRA le 20 du mois. Les jours du 21 au 31 sont saisis en
**prévisionnel** : ils sont connus, ils sont engagés, et ils doivent figurer sur
le document. Aujourd'hui ils n'y figurent pas — la synthèse ne compte que le
réalisé — et pire, la validation les **supprime** sans que personne l'ait
décidé (`annulerPrevisionnelDuMois`, appelée dans la transaction de
`transitionCra`).

Le porteur l'a dit sans ambiguïté : *ça ne doit pas disparaître, mais ça doit
être un choix humain et pas auto.*

### Le panneau

Il annonce ce qu'il a trouvé, en nommant la mission et le mois :

> Ce mois porte encore **7 jours en prévisionnel** sur la mission
> *Acme · Delivery*.
> Validez-vous ces jours pour ce mois ?

Puis deux chemins, tous deux explicites, **aucun par défaut** :

| Choix | Effet |
|---|---|
| **Valider ces jours** | Ils passent en `REALISE`. Tout le mois — échu **et** à venir — pour cette mission seulement. |
| **Les supprimer** | Suppression sèche, blocs d'agenda mis en file de suppression. |
| *Annuler* | Rien n'est généré, rien n'est touché. |

**Quand le mois ne porte aucun prévisionnel sur cette mission, aucune question
n'est posée** : le CRA s'ouvre directement. Une boîte de dialogue qui demande
quoi faire de zéro jour apprend à l'utilisateur à cliquer sans lire.

### Ce que « valider » veut dire ici

Pas `convertPastForecast`. Celle-ci ne prend que le prévisionnel **échu** et
n'est **pas scopée mission** — s'en servir convertirait le prévisionnel des
autres clients et laisserait de côté précisément les jours qu'on veut projeter.

Nouvelle fonction, voisine immédiate de l'annulation dans
[`cra-previsionnel.ts`](../../../src/services/cra-previsionnel.ts), et de même
forme (elle prend la transaction, elle rend le compte) :

```ts
validerPrevisionnelDuMois(
  tx: Prisma.TransactionClient,
  args: { userId: string; missionId: string; month: string },
): Promise<number>
```

Elle passe les saisies `PREVISIONNEL` du mois et de la mission en `REALISE`, et
met chacune en file `UPSERT` — le prévisionnel converti change de couleur dans
l'agenda, exactement comme le fait déjà `convertPastForecast`.

Elle ne consulte pas le verrou de CRA validé, et n'a pas à le faire : le cas
« CRA déjà validé » est refusé **en amont**, par le service de génération, avant
qu'aucune saisie ne soit touchée. Voir plus bas.

### Le service de génération

```ts
genererCra(userId, {
  lineId: string
  month: string
  previsionnel: 'VALIDER' | 'SUPPRIMER'
}): Promise<{ craId: string; previsionnelTraite: number }>
```

Une seule transaction : conversion **ou** suppression, puis création du CRA.
Les deux doivent tomber ensemble — un prévisionnel supprimé sans CRA créé est
une perte de données que rien ne rattrape, et un CRA créé sur un prévisionnel
non traité ment sur ce qu'il porte.

`lineId` et non `missionId` : c'est ce que l'écran connaît. Le service résout
la mission depuis la ligne, **et vérifie au passage que l'utilisateur y est
affecté** — le client ne décide pas seul sur quelle mission il écrit.

Le CRA lui-même vient de `getOrCreateCra`, inchangée : elle sait déjà ne
consigner l'ouverture qu'une fois et encaisser la course entre deux rendus.

**Si le CRA du mois existe déjà et qu'il est validé**, le service refuse et rend
un motif : un mois clos ne se regénère pas, et y toucher le prévisionnel
contournerait le verrou que toute la saisie respecte. Le panneau le dit et
propose le lien vers le CRA existant.

**S'il existe sans être validé** — brouillon, envoyé ou refusé — la génération
se poursuit normalement : la question du prévisionnel est reposée, le traitement
choisi s'applique, et `getOrCreateCra` rend le CRA existant sans rien consigner
de neuf. C'est ce qui permet de projeter une seconde fois un mois dont le CRA
est parti mais pas encore validé.

### Journal

La conversion réutilise `previsionnel.converti` — c'est le même fait, décidé au
même titre par un humain ; le payload porte `missionId` et l'origine
(`genere-cra`) pour qu'on sache d'où vient le geste.

La suppression a besoin d'un événement propre : **`previsionnel.supprime`**.
Jusqu'ici elle n'était tracée que dans le payload de `cra.valide`
(`previsionnelAnnule`), ce qui n'a plus de sens quand elle ne tombe plus à la
validation. `AuditAction` s'étend d'une entrée.

### Ce qu'on ne touche pas

**L'annulation automatique à la validation reste.** Elle devient un filet : si
du prévisionnel est ressaisi après la génération, la validation l'emporte comme
aujourd'hui, avec son bandeau qui l'annonce. Le retirer laisserait des jours
prévus jamais servis peser sur l'engagement de la mission pour toujours.

---

## 6. E — La vue 3 mois

### La bascule

Un troisième bouton dans la barre de vues de `SaisieClient` :

```
Calendrier · 3 mois · Tableau multi-CRA
```

Le type `Vue` s'étend : `'CALENDRIER' | 'TROIS_MOIS' | 'TABLEAU'`. L'adresse
porte `?vue=3mois`, résolue par la page comme `?vue=tableau` l'est déjà — et
`MonthNav` la reporte donc automatiquement sur les mois voisins, puisqu'il
recopie toute la chaîne de requête.

Comme le tableau multi-CRA, elle est **réservée aux écrans ≥ `md`** : vingt et
une colonnes ne tiennent pas sur un téléphone, et le calendrier reste la
surface de saisie mobile.

### Ce que la page charge

Les trois mois sont `month`, `shiftMonth(month, 1)`, `shiftMonth(month, 2)` —
`buildMonthDays` pour chacun, avec les mêmes jours ouvrés et les mêmes fériés.

Les saisies et l'occupation d'agenda passent à une **lecture de plage** plutôt
que trois lectures de mois :

```ts
getEntriesRange(userId, { du: string, au: string }): Promise<MonthEntry[]>
getBusyRange(userId, { du: string, au: string }): Promise<string[]>
```

`getMonthEntries` et `getBusyDays` deviennent des appels de plage sur un mois —
une seule règle de bornes, pas deux. Trois allers-retours Google à chaque
ouverture de la vue seraient payés par l'utilisateur à chaque bascule ; et
comme aujourd'hui, une lecture d'agenda qui échoue rend une liste vide et la
page s'affiche normalement.

### La densité

`MonthCalendar` reçoit une prop :

```ts
densite?: 'NORMALE' | 'COMPACTE'   // NORMALE par défaut
```

**Un seul composant, jamais une copie.** Deux dessins de la même grille
divergeraient au premier correctif — c'est exactement ce que la note d'`Aplat`
et de `CoinEclate` dit déjà à propos du tableau et du calendrier.

En `COMPACTE`, la case perd ce qui ne survit pas à la réduction :

| Conservé | Retiré |
|---|---|
| l'aplat de la prestation et sa couleur | le libellé d'heures |
| le numéro du jour | le libellé de créneau |
| le marqueur de prévisionnel | la quantité en toutes lettres |
| le marqueur d'occupation | — |
| le coin de journée éclatée | — |

La cinématique de clic, le glisser de plage et les raccourcis clavier sont
**identiques** : c'est une surface de saisie, pas un aperçu.

Chaque grille garde son en-tête de mois (`monthLabel`) et ses initiales de
jours en une lettre. `EngagementBar` reste sous l'ensemble, une seule fois :
elle lit l'engagement de la ligne sur toute sa durée, pas sur le mois affiché,
et l'empiler trois fois dirait trois fois le même chiffre.

### Ce qui écrit, et où

Les actions de saisie ne changent pas. `appliquerCase` et `saveCell`
revalident `/saisie/${args.month}` où `month` est **le mois d'ancrage de la
route**, pas celui de la case — et c'est correct : la route reste
`/saisie/<mois affiché>` quel que soit le mois où l'on clique.

Le partage réalisé / prévisionnel se fait comme toujours sur l'horloge du
**serveur** : les deux mois projetés tomberont naturellement en
`PREVISIONNEL`, sans qu'aucun code de vue n'ait à le décider.

---

## 7. F — Le gabarit s'élargit

[`PageShell`](../../../src/components/ui/PageShell.tsx) plafonne aujourd'hui le
contenu à `max-w-5xl` — 1024 points — avec `p-6` de marge, à côté d'un rail de
224. Sur un écran de 1920, plus d'un tiers de la largeur ne sert à rien, et la
vue 3 mois y serait à l'étroit sans raison.

```
mx-auto w-full max-w-[100rem] p-4 md:px-8 md:py-6
```

Deux effets, et ils vont dans le même sens :

- **1600 points de contenu** au lieu de 1024. Sur 1440, l'écran est rempli ; sur
  1920, il reste une respiration. Trois grilles de sept colonnes y disposent de
  ~50 à 70 points par case selon l'écran — petit, mais lisible, et au-dessus de
  la cible tactile.
- **La marge mobile passe de 24 à 16 points**, ce qui *ajoute* de la largeur là
  où elle manque le plus. La colonne du calendrier sur un écran de 375 passe de
  45,0 à 47,3 points, contre une cible de 44.

### Le test qui lit ce gabarit

[`MonthCalendar.test.tsx:1449`](../../../src/components/calendar/MonthCalendar.test.tsx)
**dérive le budget de largeur des cases en lisant `PageShell.tsx`** — il
extrait la marge par `/<main className="[^"]*\bp-(\d+)\b/` et lève si elle
disparaît. C'est un garde-fou, pas un obstacle : `p-4` continue de correspondre,
et `md:px-8` / `md:py-6` ne peuvent pas être capturés par erreur (le `\b`
avant `p-` exclut `px-` et `py-`). Le budget des 375 points reste donc mesuré
sur la marge qui s'y applique réellement.

Deux tests assertent la largeur littérale
(`admin/theme/page.test.tsx:110`, `saisie/[month]/page.test.tsx:141`). Ils
suivent la nouvelle valeur. Leur intention — *un seul gabarit pour tous les
écrans* — est conservée et reste vérifiée.

---

## 8. Ce qui se teste

La discipline du dépôt est le test d'abord ; ces points-là sont ceux qui
échouent silencieusement si personne ne les écrit.

**A — Suivi**
- Cocher « Validé » sans « Facturé » ne ramène pas les facturés.
- Le défaut masque `VALIDE` et `FACTURE`, et l'URL nue vaut le défaut.
- Zéro état coché rend un message, pas une liste vide muette.
- Le tableau n'offre **aucun** bouton de transition.

**B — Détail**
- Le CRA d'un autre utilisateur rend `notFound`, jamais son contenu.
- Les deux bandeaux d'avertissement précèdent les boutons de transition dans
  l'ordre du document.

**C/D — Génération**
- Un mois sans prévisionnel ne pose aucune question.
- « Valider » convertit l'échu **et** l'à-venir, et **rien** hors de la mission.
- « Supprimer » met bien chaque saisie en file `DELETE`.
- Un CRA déjà validé refuse la génération et ne touche à aucune saisie.
- L'échec de la création n'a laissé aucun prévisionnel converti ni supprimé.

**E — 3 mois**
- Les trois mois sont bien `month`, `+1`, `+2`.
- Une case cliquée sur le troisième mois écrit à la bonne date.
- La vue n'est pas atteignable sous `md`.
- La cible tactile est mesurée pour la densité compacte, à sa largeur réelle —
  et non exemptée du contrôle.

**F — Gabarit**
- Le budget des 375 points tient toujours, lu depuis `PageShell`.

---

## 9. Ordre de construction

Chaque étape laisse le produit utilisable ; aucune ne dépend d'une suivante.

1. **F** — le gabarit. Isolé, il déverrouille la place dont E a besoin.
2. **B** — la page de détail, alimentée par `getCra`. L'écran en cartes vit
   encore : rien n'est cassé.
3. **A** — le tableau, le filtre, le renommage. La carte disparaît une fois
   que son contenu a un ailleurs.
4. **D** — les deux fonctions de prévisionnel et `genererCra`, côté service,
   testées sans interface.
5. **C** — le bouton et le panneau dans la Saisie, puis retrait du formulaire
   « Ouvrir un CRA ».
6. **E** — la densité compacte, puis la vue 3 mois.
