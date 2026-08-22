# Évolutions envisagées, pas encore ouvertes

Ce fichier garde les idées dont le porteur a validé le principe sans en
demander la construction. Chacune deviendra une spec le jour où elle sera
ouverte ; d'ici là, elle vit ici pour ne pas être reperdue.

Ce n'est **pas** une feuille de route : rien ici n'est promis, ni daté, ni
ordonné.

---

## Publier l'agenda en flux iCal, plutôt que d'y écrire

**L'idée du porteur, le 22 août 2026.** Exposer les jours saisis sous forme de
flux ICS auquel n'importe quel agenda s'abonne — « moins de sécu, mais plus
ouvert ».

**Pourquoi c'est plus qu'un repli.** Ce n'est pas un accès en écriture dégradé,
c'est un renversement du sens : au lieu que l'application écrive dans l'agenda
de la personne, elle **publie** ce que la personne vient lire. Aucun OAuth,
aucune validation Google à subir, aucun jeton à renouveler — et ça marche avec
Google, Outlook, Apple et Thunderbird sans écrire une ligne par fournisseur.

**Ce qu'il faut assumer, et écrire à l'écran le jour venu :**

- **Sens unique.** Le flux publie ; il ne lit pas. La détection de conflit avec
  les réunions existantes — le lot 1b — restera l'affaire du connecteur Google.
- **Fraîcheur subie.** L'abonné rafraîchit quand il veut. Google peut mettre
  plusieurs heures ; ce n'est pas réglable depuis l'émetteur.
- **L'URL est le secret.** Qui la connaît voit le contenu. Il faut donc un
  jeton long par utilisateur, révocable et régénérable, et ne jamais y mettre
  d'information qui ne supporterait pas d'être lue.

**Ce que ça débloque.** Un hébergeur sans Google Workspace — voir la note sur le
type « Interne » plus bas — peut offrir la vue agenda sans dépendre d'un client
OAuth validé.

---

## Connecter Microsoft 365

**L'idée du porteur, le 22 août 2026.** Un connecteur Microsoft 365, en
parallèle du connecteur Google.

**Ce qui rend la chose abordable.** Le port du connecteur Google existe déjà, et
le catalogue d'appels avec lui. L'écriture d'un événement Graph est très proche
de celle d'un événement Calendar ; l'essentiel du travail est ailleurs — un
second fournisseur d'identité, un second jeu de jetons, et surtout un écran qui
ne suppose plus qu'il n'existe qu'un agenda possible.

**Le point de vigilance.** Aujourd'hui, `ProviderCredential` porte un
fournisseur par utilisateur et les écrans disent « Google » en toutes lettres.
Ouvrir ce lot demandera de rendre le fournisseur d'agenda **choisi** plutôt que
supposé, partout — y compris dans la file de synchronisation, qui nomme son
fournisseur ligne par ligne.

---

## La contrainte qui motive les deux : « Interne » exige Workspace

**Mesuré le 22 août 2026**, dans la documentation de Google : le type
d'utilisateur **Interne** de l'écran de consentement n'est proposé que si le
projet Cloud appartient à une **organisation** — donc à un Google Workspace ou
un Cloud Identity. Un compte `@gmail.com` personnel ne peut pas en créer.

**Où porte la contrainte.** Sur **l'hébergeur de l'instance**, pas sur ses
utilisateurs. Une personne avec une simple adresse `@gmail.com` peut se
connecter et synchroniser son agenda — à condition que l'hébergeur ait déclaré
un client **Externe** et l'ait fait valider par Google, le scope
`auth/calendar` étant classé **sensible**.

**Ce que ça implique pour la distribution.** L'application est faite pour être
auto-hébergée. Un hébergeur sans Workspace devra donc choisir entre subir la
validation Google, ou se passer de l'agenda. C'est précisément le trou que le
flux iCal comblerait — et la raison pour laquelle la connexion par mot de passe
ne doit jamais disparaître au profit de la seule connexion Google.

Sources :
[Configure the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent),
[Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
