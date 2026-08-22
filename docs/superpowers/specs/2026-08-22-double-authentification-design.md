# Deux portes, un seul compte : mot de passe et Google

Se connecter à l'application par **mot de passe** ou par **Google**, au choix,
sur le même compte — comme le fait Dolibarr. Et, pour ceux qui passent par
Google, obtenir l'accès à leur agenda dans le même consentement.

## Ce que ça vaut

Trois choses, dont deux qui existent déjà à moitié.

**Un compte sans mot de passe peut enfin entrer.** La reprise des temps crée des
utilisateurs pour porter l'attribution des saisies importées ; ils naissent avec
une empreinte vide, donc incapables de se connecter. Aujourd'hui ce sont des
identités mortes. Avec la connexion Google — ou la réinitialisation par courriel
— elles deviennent des comptes utilisables.

**Un consentement au lieu de deux.** Entrer et connecter son agenda sont
aujourd'hui deux parcours, sur deux écrans, dont le second est si peu signalé
que le porteur ne l'a pas trouvé. Les fondre supprime le problème plutôt que de
le documenter.

**Un périmètre d'accès gratuit — le périmètre, pas les droits.** Le client OAuth
du porteur est de type **Interne** : seuls les comptes de son domaine Workspace
peuvent consentir. La porte filtre donc **qui** entre. Elle ne dit rien de ce
qu'on peut faire une fois entré : tant que les rôles ne sont pas appliqués, qui
entre peut tout. Voir « Les rôles sont posés, pas appliqués ».

## Ce qui reste vrai quoi qu'il arrive

**La connexion par mot de passe ne disparaît pas.** Ce n'est pas une précaution
de transition, c'est une propriété du produit. Le type « Interne » exige une
organisation Google Workspace ou Cloud Identity — mesuré le 22 août 2026 : un
compte `@gmail.com` personnel ne peut pas en créer. Un hébergeur sans Workspace
devrait donc faire valider son application par Google, le scope `auth/calendar`
étant classé sensible. L'application doit rester utilisable sans rien de tout
cela. Voir `docs/superpowers/EVOLUTIONS.md`.

**Ce lot pose le rôle, il ne le fait pas respecter.** `CONSULTANT` et `ADMIN`
voient encore la même chose : c'est l'affaire du lot des rôles, déjà spécifié.
Poser le bon rôle maintenant évite d'avoir à rattraper des comptes plus tard.

## Les arbitrages du porteur, rendus le 22 août 2026

| Question | Décision |
| --- | --- |
| Connexion Google sans compte local correspondant | **Créer le compte automatiquement**, et prévoir une réinitialisation de mot de passe par courriel pour que ce compte puisse aussi entrer par la première porte. |
| Portée du consentement Google | **Identité et agenda d'un coup.** Un seul écran de consentement donne les deux. |
| Rôle d'un compte créé automatiquement | **`CONSULTANT`**, jamais `ADMIN`. |
| La reprise des temps crée des `ADMIN` | **Corrigé dans ce lot** : même règle, `CONSULTANT`. |
| Durée d'un lien de réinitialisation | **10 minutes**, usage unique. |
| Création automatique alors que les rôles ne mordent pas | **Assumée**, et le lot des rôles — spécifié le 19 août — est **enchaîné immédiatement après** celui-ci. La fenêtre d'exposition dure le temps des deux lots, pendant lesquels le porteur est seul sur l'instance. |
| Désactiver un compte sans le détruire | **Avec le lot des rôles**, pas ici : c'est une question de droits. |

## L'architecture, et les deux voies écartées

**Retenu : le fournisseur Google d'Auth.js, en session JWT, la liaison écrite
par nous.**

Auth.js sait parler à Google ; il ne sait pas, seul, fusionner deux comptes.
L'application n'ayant **pas d'adaptateur de base**, il n'existe pas de table
`Account` dont le comportement par défaut refuserait une adresse déjà prise : la
règle de liaison est du code que nous écrivons, lisons et éprouvons.

**Écarté : l'adaptateur Prisma d'Auth.js.** Deux tables nouvelles pour un besoin
que `User.email` couvre déjà ; un second endroit où vivraient des jetons Google
alors que `ProviderCredential` existe, chiffré et par utilisateur ; et une fusion
pilotée par un drapeau nommé `allowDangerousEmailAccountLinking`, dont le nom est
un avertissement, au lieu d'un code qu'on peut relire.

**Écarté : bâtir la connexion sur le flux `/api/google/connect` existant.** Un
seul URI de retour à déclarer, mais il faudrait réimplémenter l'échange de
jeton, la vérification de l'émetteur et la protection contre le rejeu — que la
bibliothèque fait déjà.

**Conséquence à assumer** : deux URI de retour déclarés chez Google.
`/api/auth/callback/google` pour la connexion, `/api/google/callback` — déjà
enregistré — pour le connecteur agenda, qui reste : quelqu'un qui entre par mot
de passe doit pouvoir connecter son agenda.

## Le modèle

**Ce qui s'ajoute.** Une table `PasswordReset` : `userId`, empreinte du jeton,
expiration, date d'usage. Le jeton est **haché au repos** — une base qui fuite ne
doit pas livrer des liens utilisables.

**Ce qui ne s'ajoute pas.** Ni `Account`, ni `Session`. La session reste un JWT,
le lien Google ↔ compte local est `User.email`, et aucun second stockage de
jeton Google n'apparaît.

**Ce qui se nomme enfin.** `passwordHash = ''` signifie déjà « pas de mot de
passe » : c'est l'état des utilisateurs créés par la reprise, et
`verifyPassword` refuse déjà l'empreinte vide — `verify('')` lève, le `catch`
rend `false`. Cette convention devient explicite, portée par une fonction qui la
dit, et éprouvée.

**Ce qu'on ne stocke pas.** La revendication `email_verified` de Google est
contrôlée **au moment de la connexion** et jetée. La copier en base créerait une
donnée qui vieillit — et c'est sur elle que repose la fusion des comptes.

**Le rôle, fermé comme classe et non comme cas.** Le défaut de colonne reste
`ADMIN`. Ce qui change, c'est qu'un contrôle refuse tout `prisma.user.create`
dans `src/` qui ne dise pas explicitement son rôle — à la manière de
`src/frontieres.test.ts` et de `src/db/gitignore.test.ts`. Corriger les deux
chemins connus laisserait le troisième répéter le défaut.

## Les deux portes

L'écran de connexion porte le formulaire actuel **et** un bouton Google. Le
fournisseur Google s'ajoute dans `src/auth.ts`, au côté de `Credentials` — jamais
dans `src/auth.config.ts`, qui doit rester sans Prisma ni code natif pour que le
middleware tourne en edge. Cette frontière ne bouge pas.

**Le consentement demandé** : identité, plus `https://www.googleapis.com/auth/calendar`,
avec `access_type=offline` et `prompt=consent`. Le second garantit qu'un jeton de
rafraîchissement revient **à chaque connexion** ; sans lui, Google ne le rend
qu'à la première autorisation, et un compte reconnecté après une révocation
resterait sans jeton, silencieusement.

**La règle de liaison**, dans le rappel de connexion, dans cet ordre :

1. refuser si Google ne déclare pas l'adresse vérifiée ;
2. chercher le compte par adresse, et le prendre s'il existe ;
3. le créer sinon, en `CONSULTANT`, avec une empreinte vide.

## L'agenda, pris au même consentement

Le jeton d'agenda est écrit dans `ProviderCredential`, exactement là où le
connecteur Calendar le lit déjà. La connexion par Google devient une **seconde
entrée vers le même stockage**.

**Le comportement en cas d'échec existe déjà, et il est bon.** `connectGoogle`
enregistre le jeton, crée l'agenda dédié, et **annule le premier si le second
échoue** — « un compte enregistré sans calendrier afficherait connecté tout en
étant inutilisable ». Il n'y a donc que deux états, et le second se répare d'un
clic depuis Synchro. Aucun troisième état, aucune bannière d'avertissement à
inventer.

**Un remaniement, et un seul.** `connectGoogle` prend un *code* d'autorisation et
fait l'échange lui-même ; dans le parcours Auth.js l'échange a déjà eu lieu et on
reçoit des *jetons*. La seconde moitié — enregistrer, créer l'agenda, annuler si
ça rate — est extraite dans une fonction que les deux entrées appellent. Une
seule implémentation du comportement, deux portes vers elle : c'est ce qui
garantit qu'elles ne divergeront pas.

**Le succès n'est pas couplé.** Le consentement l'est — c'est l'arbitrage du
porteur — mais entrer dans l'application ne dépend pas de la santé de l'API
Calendar. Une panne d'agenda ne doit pas empêcher de saisir des temps.

## Le client OAuth vit en base, pas dans l'environnement

**Le trou que la relecture de cette spec a trouvé.** Un fournisseur Auth.js se
déclare au chargement du module ; le client OAuth de l'instance — identifiant et
secret — est saisi dans Administration · Google et **stocké chiffré en base**.
Les deux ne se rencontrent pas.

**La forme paresseuse le résout.** La bibliothèque installée accepte une
fonction là où on attendrait un objet :

```ts
export default function NextAuth(
  config: NextAuthConfig | ((request: NextRequest | undefined) => Awaitable<NextAuthConfig>)
): NextAuthResult
```

La configuration est donc construite **par requête**, et lit le client comme le
connecteur le fait déjà.

**Une propriété qui en découle, et qu'il faut garder.** Quand aucun client n'est
enregistré, le fournisseur Google est simplement **absent** de la liste — et le
bouton disparaît de l'écran de connexion. La porte n'existe que lorsqu'elle
mène quelque part ; il n'y a rien à griser, rien à expliquer.

**Ce que ça coûte.** Une lecture par requête d'authentification. Le même prix
que `requireUser()` paie déjà, pour la même raison : une configuration qui dit
vrai vaut mieux qu'une configuration figée au démarrage.

## La réinitialisation par courriel

**Le parcours.** Sur l'écran de connexion, « Mot de passe oublié ». On saisit une
adresse ; l'écran répond **toujours la même chose**, que le compte existe ou non.
Sans cette précaution, le formulaire devient un annuaire : on y teste des
adresses jusqu'à savoir qui travaille ici. Le motif réel d'un non-envoi — compte
inconnu, SMTP non configuré — part au journal, jamais à l'écran.

**Le jeton.** 32 octets aléatoires dans l'URL ; en base, son empreinte
**SHA-256**. Une empreinte rapide suffit ici, contrairement aux mots de passe
qui restent en argon2 : un secret de 256 bits tiré au hasard n'a pas de
dictionnaire, donc rien à ralentir. Durée
**10 minutes**, usage unique, et l'usage annule les autres jetons en attente du
même compte.

**Un lien peut expirer avant d'être lu** si un courriel traîne dans une file
d'attente. Le remède est d'en redemander un ; l'écran le dit.

**Ce que ce parcours sert vraiment.** Pas seulement l'oubli : c'est par lui qu'un
compte né **sans** mot de passe s'en donne un — ceux que Google crée, ceux que la
reprise des temps a créés. Le libellé dira « définir » autant que
« réinitialiser ».

L'envoi réutilise l'existant : un gabarit pur dans `src/core/notify/templates.ts`,
expédié par `notify()`. Aucun second canal de courriel n'est créé.

## Ce que le lot ne fait pas, et ce que ça coûte

Chaque exclusion est tenable. Aucune n'est sans conséquence, et les taire
reviendrait à les découvrir en production.

### Aucun moyen de couper l'accès d'une personne

**Ce que ça veut dire.** Il n'existe ni bouton pour dissocier un compte de son
Google, ni **drapeau pour désactiver un compte**. `User` ne porte que
`id`, `email`, `name`, `passwordHash`, `role`, `createdAt`.

**Le cas d'usage.** Un consultant quitte la mission. Son compte Workspace est
désactivé, donc la porte Google se ferme d'elle-même — Google refusera. Mais
**s'il avait un mot de passe, la seconde porte reste ouverte**. Même chose si son
compte Google est compromis : l'attaquant entre par Google, et rien dans
l'application ne permet de l'en empêcher.

**Ce qu'il en coûte aujourd'hui.** Le seul geste disponible est la
**suppression** du compte — qui détruit ses saisies par cascade. Fermer une porte
oblige donc à détruire l'historique qu'elle protégeait.

**Le remède provisoire.** Changer l'adresse du compte en base pour qu'elle ne
corresponde plus à l'identité Google, et vider son empreinte de mot de passe.
C'est une manipulation directe, sans écran.

**Où le porteur l'a placé : avec le lot des rôles.** Couper un accès est une
question de droits, et le lot des rôles est de toute façon enchaîné juste après.

**Ce que ça y demandera, et c'est peu.** Un drapeau `disabled` sur `User`, refusé
par `requireUser()` — qui relit déjà l'utilisateur en base à chaque requête. La
révocation serait donc immédiate, et sur **les deux portes à la fois** : ni le
mot de passe ni Google ne rouvriraient. Un bouton dans Réglages · Données, à côté
de ceux des clients et des missions, suffirait à l'exposer.

**D'ici là**, couper un accès passe par une manipulation en base — changer
l'adresse pour qu'elle ne corresponde plus à l'identité Google, et vider
l'empreinte de mot de passe.

### L'adresse ne peut pas changer

**Ce que ça veut dire.** `User.email` est la clé de fusion. Rien ne permet de la
modifier depuis l'application.

**Le cas d'usage.** Un changement de nom, ou une migration de domaine —
`kreativpm.fr` vers autre chose. L'identité Google ne correspond alors plus au
compte local.

**Ce qu'il en coûte.** La connexion Google **crée un second compte**, en silence
et sans erreur. Les CRA, les saisies et les correspondances Dolibarr restent sur
l'ancien ; le nouveau est vide. Rien ne signale la scission — c'est la
conséquence la plus probable de cette liste, et la plus discrète.

**Le remède provisoire.** Modifier l'adresse en base **avant** la première
connexion sous la nouvelle identité.

### Le mot de passe est la surface d'attaque

**Ce que ça veut dire.** Pas de second facteur sur la porte mot de passe, et pas
de limitation de débit sur `/login`. La porte Google, elle, hérite du second
facteur que le Workspace impose déjà.

**Le cas d'usage.** L'instance est publiée sur un domaine — ce que la
distribution portable prévoit. `/login` devient atteignable depuis Internet.

**Ce qu'il en coûte.** Les deux absences se composent : sans limitation, un mot
de passe faible se casse ; sans second facteur, il n'y a rien derrière. La porte
Google est alors nettement mieux protégée que la porte locale, alors que les deux
mènent au même compte — la sécurité de l'ensemble est celle du maillon faible.

**Le remède provisoire, et il est réel.** Ne pas exposer l'instance
publiquement : la joindre par VPN, comme le porteur le fait déjà. Une porte
qu'on n'atteint pas ne se force pas.

**Une honnêteté supplémentaire.** La réponse uniforme du formulaire d'oubli
empêche l'énumération par le *message*, pas par le *temps* : une adresse connue
déclenche une écriture et un envoi de courriel, une inconnue non. L'écart est
mesurable par quelqu'un qui cherche. Le corriger demanderait un traitement à
durée constante, hors de ce lot.

### Les rôles sont posés, pas appliqués

**Ce que ça veut dire.** Ce lot écrit `CONSULTANT` dans la colonne. Aucun écran,
aucun service ne consulte encore ce rôle.

**Le cas d'usage.** Un collègue du domaine Workspace se connecte avec Google,
par curiosité ou parce qu'on lui a donné le lien.

**Ce qu'il en coûte — et c'est le point le plus lourd de cette liste.** Son
compte naît `CONSULTANT` et il voit **exactement ce que voit un administrateur** :
les réglages, le connecteur Dolibarr, la suppression des clients et des missions.
La création automatique de comptes, combinée à l'absence d'application des rôles,
ouvre donc l'instance entière à tout le domaine.

**Ce que ça corrige dans cette spec.** La section « Ce que ça vaut » présentait
le type Interne comme « un contrôle d'accès gratuit ». C'est vrai du périmètre —
seul le domaine entre — et faux des **droits** : qui entre peut tout faire. La
formule est corrigée plus haut.

**Ce que le porteur a tranché.** La création automatique est **assumée**, et le
lot des rôles est **enchaîné immédiatement après** celui-ci. La fenêtre
d'exposition ne dure donc que le temps des deux lots, pendant lesquels il est
seul sur l'instance — personne d'autre n'a de raison de se connecter.

**Ce que cela impose au lot suivant.** Il ne s'agit plus d'une évolution
souhaitable mais d'une **dette datée** : ce lot-ci ouvre une porte que seul le
lot des rôles referme. Le plan d'implémentation doit se terminer en le nommant.

### Pas de flux iCal ni de Microsoft 365

**Ce que ça veut dire.** L'agenda passe par Google, ou ne passe pas.

**Le cas d'usage.** Quelqu'un auto-héberge l'application sans Google Workspace.

**Ce qu'il en coûte.** Il devra faire valider son application par Google — le
scope `auth/calendar` étant sensible — ou se passer de l'agenda. La saisie, les
CRA et les PDF fonctionnent intégralement sans.

**Ce que ça appelle.** Le flux iCal, consigné dans `EVOLUTIONS.md`, qui
supprimerait cette dépendance pour la vue en lecture.

## Les épreuves

Au-delà du chemin heureux :

- une adresse que Google ne déclare pas vérifiée est **refusée** ;
- un compte existant est **retrouvé**, jamais dupliqué ;
- un compte créé reçoit `CONSULTANT` ;
- un jeton expiré, déjà utilisé, ou faux est refusé ;
- la base porte l'**empreinte**, jamais le jeton ;
- le formulaire d'oubli répond **identiquement** pour une adresse connue et une
  inconnue ;
- l'échec de création de l'agenda laisse le compte **non connecté**, pas à
  moitié connecté ;
- aucun `prisma.user.create` de `src/` n'est muet sur son rôle.

Chaque règle est éprouvée par mutation : un test qui survit à la suppression de
la règle qu'il prétend garder ne garde rien.

## Une note de mise en œuvre

Deux URI de retour à déclarer chez Google avant la recette, et le port en fait
partie :

```
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/google/callback
```
