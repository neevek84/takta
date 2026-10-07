# Lot 3b — Le client valide et signe dans l'outil

**Date :** 2026-10-07
**Prolonge :** lot 3 (`2026-08-15-lot-3-validation-client-design.md`), fusionné.
**Affine :** la décision du lot 0 « Pas de portail client » (§ 9).

---

## 1. Le but

Aujourd'hui le CRA part chez Documenso, **Documenso** écrit au client, et le
client signe un PDF sur la page de Documenso. Ça marche, mais ça fait outil
tiers, et un PDF se vérifie mal.

Ce lot fait en sorte que **le client ne quitte jamais l'outil** : il reçoit un
courriel de l'outil, ouvre une page de l'outil, voit son CRA sous forme
visuelle — pas un fichier — et le signe ou le refuse **dans cette page**.
Documenso reste le tiers qui scelle la preuve ; il ne se montre plus.

**Critères de succès**

- Le client va du courriel à la signature sans jamais arriver sur un domaine
  Documenso visible, et sans compte.
- Ce que le client voit et signe est **exactement** ce qui était dans le CRA au
  moment de l'envoi, quoi qu'il se passe ensuite côté consultant.
- Une signature par la page produit le **même effet** qu'une validation
  manuelle : mois verrouillé, temps consommés en file vers Dolibarr.
- Un refus rend le mois modifiable, et se renvoie en un clic.
- Le consultant sait, CRA par CRA et envoi par envoi, ce qui s'est passé.

---

## 2. Le circuit

1. Le consultant envoie un CRA `BROUILLON` (ou renvoie un CRA `REFUSE`).
   L'application compose le PDF (`buildCraPdf`, inchangé), **fige le contenu**
   (§ 5), crée l'enveloppe chez Documenso **sans courriel**, crée un **lien
   client**, et passe le CRA à `ENVOYE`.
2. **L'outil** écrit au signataire de la mission : le CRA est prêt, voici le
   lien `{origine}/v/{jeton}` — l'origine publique déduite comme pour la
   réinitialisation de mot de passe.
3. Le client ouvre le lien. Un **code à 6 chiffres** lui est envoyé à cette même
   adresse. Il le saisit.
4. Il voit le CRA **en lecture seule**, rendu avec Encre : calendrier du mois,
   détail par ligne de prestation et par jour, totaux. **Aucun montant.**
5. Deux actions :
   - **« Valider et signer »** — le cadre de signature Documenso s'ouvre dans la
     page. À la signature, le webhook (ou le rafraîchissement) fait passer le
     CRA à `VALIDE` par `transitionCra`, comme aujourd'hui. La page affiche
     « Signé le … » et propose le PDF signé.
   - **« Refuser »** — un motif est demandé (obligatoire). Le refus passe par
     Documenso (`allowDocumentRejection`) pour que la preuve du refus soit
     scellée au même endroit que celle d'une signature ; le motif revient par
     le webhook. Le CRA passe à `REFUSE`.
6. Le lien **survit** à la signature, en lecture seule, pour retélécharger le
   PDF signé. Il meurt par révocation, par annulation de l'envoi, ou par un
   renvoi (un nouvel envoi crée un nouveau lien).

Ce qui ne change pas : la machine à états hors des deux points du § 3, le
rattrapage par « Rafraîchir », les transitions manuelles. **Sans Documenso
configuré, l'application se comporte exactement comme avant** — pas de lien
client, PDF téléchargeable, transitions manuelles. L'autoportance tient.

---

## 3. Machine à états et verrouillage

Trois changements, et seulement trois :

| Changement | Pourquoi |
|---|---|
| **`ENVOYE` verrouille la saisie du mois**, comme `VALIDE` | Sans ça, le consultant modifie ses jours pendant que le client relit ; le client signe l'ancienne version et le CRA passe `VALIDE` avec des chiffres qu'il n'a pas signés. Le défaut existe déjà au lot 3 ; ce lot le referme. |
| **Nouvelle transition `REFUSE → ENVOYE`** (`RENVOYER`) | Un refus doit se corriger et repartir en un geste, sans « Rouvrir » puis « Envoyer ». |
| **Nouvelle transition `ENVOYE → BROUILLON`** (`ANNULER_ENVOI`) | Corriger avant la réponse du client, sans laisser une enveloppe signable chez Documenso (voir « Annuler l'envoi » ci-dessous). |

`isLocked` porte aujourd'hui **deux sens** qu'il faut séparer :

- **la saisie est fermée** — `isLocked(status)`, vrai pour `ENVOYE` et `VALIDE`.
  Appelants : `cells`, `time-entries`, `rates`, `missions`, `sync/conflicts`. Ils
  en héritent sans modification ; un test par appelant prouve qu'une écriture
  est refusée sur un mois `ENVOYE`.
- **le mois est arrêté, ses temps peuvent partir** — nouveau `isArrete(status)`,
  vrai pour `VALIDE` seulement. Appelants : `dolibarr/push` et
  `dolibarr/rattrapage`, qui basculent sur lui. Sans cette séparation, le
  rattrapage pousserait vers Dolibarr les temps d'un CRA `ENVOYE` **avant** la
  signature du client ; un test le prouve.

**Conséquence assumée** : la synchronisation Google d'un mois `ENVOYE` se
comporte comme celle d'un mois `VALIDE` (les conflits ne déplacent plus de
temps). C'est le comportement voulu : le document est chez le client.

**« Annuler l'envoi »** — nouveau bouton sur un CRA `ENVOYE` muni d'une
enveloppe. Il annule l'enveloppe chez Documenso (`cancel`), révoque le lien,
marque l'envoi `ANNULE`, puis passe le CRA à `BROUILLON` par une **nouvelle
transition `ANNULER_ENVOI` (`ENVOYE → BROUILLON`)**. `ROUVRIR` reste réservé à
`VALIDE` et `REFUSE` : la seule façon de sortir d'`ENVOYE` vers le brouillon est
celle qui annule aussi l'enveloppe. Si l'annulation chez
Documenso échoue, **le CRA ne change pas d'état** et le consultant voit
l'erreur : un CRA rouvert chez nous mais encore signable chez Documenso
validerait un mois en cours de modification.

`REFUSE` ne verrouille pas : le mois est modifiable dès le refus.

---

## 4. Documenso, en API v2

### 4.1 Prérequis

**Documenso ≥ 2.0.0** (API « enveloppes », novembre 2025). La signature
embarquée (`/embed/sign/{jeton}`) n'est soumise à aucune licence sur une
instance auto-hébergée **sans facturation** : le contrôle du code source est
`IS_BILLING_ENABLED() && !flags.embedSigning`. Une instance qui a activé Stripe
devra porter le droit `embedSigning`.

### 4.2 Le connecteur

`src/services/signature/documenso.ts` est réécrit sur `/api/v2`. Tout ce qui est
propre à Documenso reste enfermé dans ce fichier.

| Besoin | Appel |
|---|---|
| Créer | `POST /api/v2/envelope/create` (multipart : `payload` JSON + le PDF). `type: DOCUMENT`, `externalId: craId`, un destinataire `SIGNER` avec ses champs (conversion points → pourcentages inchangée, `core/signature/documenso-champs.ts`). |
| Distribuer sans courriel | `POST /api/v2/envelope/distribute`, `meta.distributionMethod: 'NONE'`. La réponse porte le destinataire **avec son jeton** : c'est lui que reçoit le cadre embarqué. |
| État | `GET /api/v2/envelope/{id}` — statut du document et des destinataires, **motif de refus** compris. |
| PDF signé | `GET /api/v2/envelope/item/{itemId}/download?version=signed` — document avec signatures et piste d'audit. |
| Renouveler un lien périmé | `POST /api/v2/envelope/redistribute` (rend un jeton rafraîchi). |
| Annuler | `POST /api/v2/envelope/cancel`. |

L'interface `SignatureConnector` (`core/signature/connector.ts`) évolue :

```ts
interface SignatureConnector {
  readonly provider: string
  /** confie le document, sans que le prestataire n'écrive à personne */
  send(envoi: SignatureEnvoi): Promise<{ externalId: string; jetonSignataire: string }>
  status(externalId: string): Promise<{ statut: SignatureStatus; motifRefus: string | null }>
  download(externalId: string): Promise<Uint8Array>
  /** renouvelle le lien de signature du destinataire et rend le jeton à jour */
  renouveler(externalId: string): Promise<string>
  annuler(externalId: string): Promise<void>
  /** l'adresse que le cadre embarqué doit charger pour ce jeton */
  urlEmbarquee(jetonSignataire: string): string
}
```

`remind` disparaît du connecteur : **c'est l'outil qui relance** (§ 7). Le cœur
ne sait toujours pas quel prestataire est branché.

### 4.3 Webhook — un défaut du lot 3 refermé

**Documenso ne signe pas ses webhooks.** Il envoie le secret configuré, tel
quel, dans l'en-tête `X-Documenso-Secret` (`execute-webhook-call.ts`, et sa
documentation « Verification »). La route du lot 3 attend un HMAC dans
`x-documenso-signature` : **chaque webhook réel reçoit 401**, et un CRA signé
ne passe `VALIDE` que par « Rafraîchir » ou par le balayage planifié.

Ce lot :

- accepte `X-Documenso-Secret`, comparé au secret **à temps constant** ; l'HMAC
  `x-cra-signature` reste accepté (tests, intégrations maison) ;
- fait du webhook **un signal, plus une source de vérité** : il désigne une
  enveloppe, et l'application **redemande son état** au connecteur (`status()`)
  avant d'appliquer quoi que ce soit, par `applySignatureStatus`. Un secret
  ne prouve pas l'intégrité d'une charge ; une relecture chez le prestataire,
  si. Un webhook forgé ne peut donc rien valider ni refuser.

La correspondance se fait par `payload.envelopeId` sur l'envoi courant ; le
numérique (`payload.id`) reste reconnu pour les envois antérieurs (§ 4.4).
L'idempotence (`SignatureWebhookEvent`) ne change pas.

### 4.4 Les envois déjà partis

Un CRA envoyé en v1 avant la mise en production a un identifiant **numérique**.
Le connecteur le reconnaît à sa forme et le sert par les routes v2
`document/{id}` (dépréciées mais présentes) — état et téléchargement. Ces envois
gardent leur circuit d'origine : le client a reçu le courriel de Documenso, il
n'a pas de lien client. Aucune migration de données n'est nécessaire.

---

## 5. Données

### 5.1 L'envoi en cours, et les envois clos

Le lot 3 a choisi **une seule demande par CRA**, pour qu'aucune lecture n'ait à
décider laquelle fait foi ; une dizaine de lectures en dépendent. Ce lot garde
ce principe : `SignatureRequest` reste **l'envoi en cours**, unique par CRA. Elle
gagne :

| Champ | Rôle |
|---|---|
| `numero` | 1, 2, 3… — incrémenté à chaque renvoi |
| `externalId` | l'enveloppe de **cet** envoi (l'`ExternalLink` reste la correspondance du CRA, tenue à jour) |
| `motifRefus` | texte du client, tel quel |
| `contenuFige` | JSON du CRA envoyé (§ 5.2), écrit et lu en bloc |
| `empreinte` | SHA-256 hexadécimal de `contenuFige` |
| `origine` | l'adresse publique de l'outil au moment de l'envoi, pour les liens des relances |

`status` admet une valeur de plus : **`ANNULE`**.

Quand un envoi est **remplacé** — renvoi après refus, ou annulation — il est
d'abord recopié, tel quel, dans une nouvelle table **`SignatureEnvoiClos`**
(`craId`, `numero`, `status`, `motifRefus`, `signataireNom`, `signataireEmail`,
`sentAt`, `completedAt`, `empreinte`). Une ligne close ne change plus jamais :
il n'y a donc rien qui puisse diverger. L'historique de l'écran du CRA (§ 8)
lit l'envoi en cours plus les envois clos.

### 5.2 Le contenu figé

Au moment de l'envoi, la projection qui sert au PDF est sérialisée : mission,
client, mois, lignes de prestation, jours et quantités **déjà converties avec le
facteur de chaque saisie**, totaux. La page client ne lit **que** ce JSON — jamais
les saisies vivantes. Elle rend donc ce que le client a reçu, même si le CRA a
été rouvert entre-temps.

L'empreinte est affichée en pied de la page client et dans l'historique de
l'écran du CRA (« Empreinte du document : 3f9a…c21e »), et journalisée à
l'envoi.

### 5.3 Le lien client

Nouvelle table `LienClient` :

| Champ | Rôle |
|---|---|
| `id` | cuid |
| `craId`, `numero` | l'envoi qu'il sert ; unique ensemble |
| `jetonEmpreinte` | SHA-256 du jeton — **le jeton en clair n'est jamais stocké** |
| `jetonSignataire` | jeton Documenso du destinataire, pour le cadre embarqué |
| `revokedAt` | révocation explicite, annulation ou remplacement |
| `codeEmpreinte`, `codeExpireAt`, `codeEssais` | le code à 6 chiffres en cours |
| `derniereConsultationAt` | pour le suivi |

Le jeton du lien : 32 octets aléatoires, en hexadécimal, haché en SHA-256 —
exactement le procédé de la réinitialisation de mot de passe
(`core/auth/reinitialisation.ts`), réutilisé tel quel.

Un lien dont le `numero` est inférieur à celui de l'envoi en cours est
**remplacé**. Un renvoi ou une annulation révoque les liens du CRA.

Tous les types restent portables SQLite/Postgres : chaînes, entiers, dates,
`Bytes`. Aucun enum, aucun tableau.

---

## 6. La page client `/v/{jeton}`

### 6.1 Accès

1. `GET /v/{jeton}` — le jeton est haché et cherché. Introuvable, révoqué ou
   remplacé : une page neutre (§ 6.4). Sinon : écran « Un code vous a été
   envoyé à k•••@exemple.fr », et un code part.
2. Le code : 6 chiffres, valable **10 minutes**, **5 essais**. Au-delà, il faut
   en demander un nouveau ; au plus **5 codes par heure et par lien**.
3. Code juste : un cookie `HttpOnly`, `Secure`, `SameSite=Lax`, signé par
   `AUTH_SECRET`, lié **à ce lien**, valable **2 heures**. Il ne donne accès à
   rien d'autre.

### 6.2 Ce qu'elle montre

- l'entête émetteur, le client, la mission, le mois ;
- le **calendrier** du mois et le **tableau par ligne de prestation et par
  jour**, en lecture seule, construits sur les composants Encre existants
  alimentés par le contenu figé ;
- les totaux ;
- l'état : à signer · signé le … (avec téléchargement du PDF signé) · refusé
  le … (avec le motif) · retiré · remplacé.

Aucun montant, aucun identifiant interne, aucun lien vers le reste de l'outil.

### 6.3 Le cadre de signature

Un composant client qui charge `urlEmbarquee(jetonSignataire)` dans un
`<iframe>`, avec nom et adresse verrouillés et refus autorisé. Il écoute les
messages `postMessage` du cadre (signé, refusé) **pour l'affichage seulement** :
la transition du CRA ne part **que** du webhook ou de `status()`, jamais d'un
message du navigateur. Après un message « signé », la page interroge
`status()` côté serveur ; si Documenso confirme, la transition est appliquée
par l'applicateur unique (`applySignatureStatus`).

Si le jeton Documenso a expiré, la page appelle `renouveler()` avant d'afficher
le cadre.

### 6.4 Sécurité

- **Seule route sans session** de l'application, ajoutée explicitement à
  `middleware.ts`, avec ses actions serveur.
- Réponse identique pour un jeton inconnu, révoqué ou remplacé — seule la
  formulation change pour un lien **valide** dont l'envoi est clos.
- Limitation par IP sur la saisie du code, en plus du compteur par lien.
- En-têtes : `frame-src` limité à l'origine de `DOCUMENSO_URL` ;
  `frame-ancestors 'none'` sur la page elle-même ; `Referrer-Policy: no-referrer`
  (le jeton est dans l'URL) ; `noindex`.
- Le code et le jeton ne figurent dans aucun journal applicatif, seulement
  leurs empreintes.

---

## 7. Courriels

`Mailer` gagne des **pièces jointes** (`{ nom, type, octets }[]`). Les gabarits
sont en français, au format texte comme les gabarits existants.

| Événement | Au consultant | Au signataire |
|---|---|---|
| Envoi / renvoi | — | « Votre CRA de {mois} est prêt » + lien |
| Code | — | le code, sa durée de validité |
| Validation | « CRA {mois} validé par {nom} » + **PDF signé joint** | confirmation + **PDF signé joint** |
| Refus | « CRA {mois} refusé par {nom} » + motif + lien vers le CRA | accusé de réception + motif |
| Annulation | — | « CRA retiré, une nouvelle version suivra » |
| Relance | — | rappel + lien (cadence et plafond existants : `relanceJours`, `RELANCES_MAX`) |

Le consultant est l'utilisateur propriétaire du CRA (`User.email`).

**Le courriel ne commande rien.** SMTP absent ou en échec : la transition a lieu
quand même, l'échec est journalisé et affiché sur l'écran du CRA, et le lien
client y est **copiable** pour un envoi à la main. Un PDF signé pas encore
archivé au moment de la validation : le courriel part sans pièce jointe et le
dit ; le PDF reste disponible dans l'outil dès son archivage.

---

## 8. Suivi

Chaque étape est écrite au journal de preuve existant (`appendAudit`, chaîné, en
ajout seul). Le catalogue est un contrat public ; ces ajouts sont la décision de
ce lot. Nouveaux noms au catalogue `core/audit/events.ts` :

`signature.lien_ouvert` · `signature.code_envoye` · `signature.code_valide` ·
`signature.code_echoue` · `signature.annulee` · `signature.renvoyee` ·
`signature.courriel_envoye` · `signature.courriel_echoue`

`signature.envoyee`, `signature.recue` et `signature.refusee` existent déjà.
Les actions du client sont émises sous l'acteur système. **Ni le nom, ni
l'adresse du signataire, ni le motif de refus n'entrent au journal** — il est
conservé indéfiniment et poussé vers des URL tierces, règle posée au lot 3. Les
charges utiles portent le numéro d'envoi et l'identifiant du CRA ; le motif et
le destinataire restent lisibles sur l'envoi (`SignatureRequest`), qui ne sort
pas.

L'écran du CRA (`/cra/[craId]`) gagne un **historique par envoi** :

```
Envoi n° 2 · 06/10 · signé le 06/10 par Jeanne Martin        [PDF signé]
  ouvert 06/10 09:12 · code validé · signé 09:14
Envoi n° 1 · 01/10 · refusé le 03/10 par Jeanne Martin
  « Il manque la journée du 15. »
```

---

## 9. La décision « Pas de portail client », affinée

Elle tenait à ce que **le client n'ait pas de compte** : pas d'inscription, pas
de mot de passe, pas de gestion d'utilisateurs, pas d'espace client à maintenir.
Ce lot **garde tout cela** : un lien par envoi, un code par courriel, une page
en lecture seule sur un contenu figé. Il n'introduit ni compte, ni liste des CRA
du client, ni navigation.

`docs/decisions.md` et `ETAT.md` sont mis à jour : « **Pas de compte client.**
Le client reçoit un lien par CRA, s'identifie par un code à usage unique, voit
et signe ce document-là, rien d'autre. »

---

## 10. Hors périmètre

- Compte client, espace listant plusieurs CRA, historique côté client.
- Signature à plusieurs, circuit d'approbation interne.
- Commentaires jour par jour ou contestation ligne à ligne : le refus porte un
  motif libre.
- Autre prestataire que Documenso.
- Personnalisation des gabarits de courriel depuis l'administration.

---

## 11. Risques

| Risque | Parade |
|---|---|
| Instance Documenso < 2.0.0 | Le connecteur v2 échoue à l'envoi avec un message explicite (« Documenso 2.0 ou plus est requis ») ; rien ne change d'état. Vérification de version documentée dans `docs/integrations.md`. |
| Documenso refuse d'être embarqué (en-têtes de cadre) | Repli : le bouton ouvre la page de signature Documenso dans un nouvel onglet ; le reste du circuit est identique. Le composant détecte l'échec de chargement. |
| Le cadre change de protocole `postMessage` | Les messages ne servent qu'à l'affichage ; la vérité vient de `status()`. |
| Lien transféré | Le code part toujours à l'adresse du signataire figée à l'envoi. |
| Adresse publique mal déduite derrière un proxy | Le lien est bâti par `originePublique(AUTH_URL, en-têtes)`, la fonction de la réinitialisation de mot de passe ; elle est mémorisée sur l'envoi pour que les relances, qui n'ont pas de requête, réutilisent la même. |

---

## 12. Tests

- **Connecteur v2** : chaque appel sur des réponses enregistrées ; identifiant
  numérique hérité ; erreurs sans fuite de clé (le test existant est conservé).
- **Webhook** : `X-Documenso-Secret` juste, faux, absent ; un webhook dont la
  charge dit « signé » alors que `status()` dit « en attente » ne valide rien ;
  `envelopeId`, identifiant numérique hérité, rejeu.
- **Verrouillage** : chaque appelant de `isLocked` refuse d'écrire sur un mois
  `ENVOYE`.
- **Machine à états** : `RENVOYER` depuis `REFUSE` ; `ANNULER_ENVOI` depuis
  `ENVOYE` ; `ROUVRIR` toujours refusé depuis `ENVOYE` ; annulation Documenso en échec → état
  inchangé.
- **Contenu figé** : la page client rend les mêmes chiffres après une
  modification du CRA rouvert et après un changement de réglage de conversion
  (règle « le gel se casse en lecture »).
- **Page client** : jeton inconnu / révoqué / remplacé ; code juste, faux,
  expiré, cinquième essai, sixième code dans l'heure ; cookie d'un autre lien
  refusé ; aucun montant dans le rendu.
- **Effet Dolibarr** : une signature arrivée par la page met les temps
  consommés en file, comme une validation manuelle.
- **Courriels** : destinataires, pièces jointes, comportement sans SMTP.
- **Journal** : chaque étape émet son événement, une seule fois.
- **Sans Documenso** : aucune régression du mode manuel.
