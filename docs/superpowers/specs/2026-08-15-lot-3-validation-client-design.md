# Lot 3 — Validation du CRA par le client

**Date :** 2026-08-15
**Statut :** design proposé, non relu par le porteur du produit
**Prérequis :** lot 1a livré

---

## 1. Intention

Faire sortir le CRA de l'application et revenir signé, sans ressaisie et sans portail client.

Le lot 0 a livré la machine à états — `BROUILLON → ENVOYÉ → VALIDÉ` — avec des transitions **manuelles**. Ce lot ne l'étend pas : il **automatise le franchissement** de ces transitions déjà existantes. C'est ce qui garantit que l'application reste utilisable sans aucun outil de signature.

---

## 2. Pas de portail client

Décision prise dès le lot 0, rappelée ici parce qu'elle structure tout le reste : **le client n'a pas de compte**. Pas d'inscription, pas de mot de passe, pas d'écran à maintenir, pas de données personnelles à héberger.

Il reçoit un document, il le signe, un webhook revient. Tout un sous-système disparaît.

---

## 3. Le PDF

Un document par couple *(mission, mois)*, reprenant le périmètre exact du CRA :

- l'entête émetteur et le client ;
- le mois et la mission ;
- **le détail par ligne de prestation et par jour** — c'est ce que le client vérifie ;
- les totaux par ligne, en jours ;
- un emplacement de signature.

**Aucun montant.** Le CRA atteste du temps passé, pas d'une somme due. Y faire figurer un total en euros le transformerait en pré-facture, et ferait entrer par la fenêtre la facturation qu'on a sortie par la porte.

Le PDF est **regénérable à l'identique** depuis les données : il n'est pas stocké comme source de vérité, mais archivé une fois signé, parce qu'un document signé ne se regénère pas — il se conserve.

---

## 4. La signature, derrière une interface

`SignatureConnector` est déclaré dès le lot 0 comme point d'extension. Ce lot en écrit la première implémentation, **sans que le cœur sache lequel** :

```ts
interface SignatureConnector {
  send(cra: Cra, pdf: Buffer, destinataire: Contact): Promise<string>
  status(externalId: string): Promise<'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE'>
  download(externalId: string): Promise<Buffer>
}
```

**Documenso en première implémentation** — le porteur du produit en dispose déjà, auto-hébergé, avec une API et des webhooks. Le choix n'est pas structurant : c'est l'interface qui l'est.

**Sans connecteur configuré, le lot reste utile** : le PDF se génère et se télécharge, et les transitions du CRA restent manuelles comme au lot 0. C'est l'autoportance, encore.

---

## 5. Le circuit

1. Un CRA en `BROUILLON` peut être **envoyé**. L'application génère le PDF et le confie au connecteur de signature.
2. Le CRA passe à `ENVOYÉ`. La référence externe est enregistrée dans `ExternalLink`.
3. Le client signe. Un **webhook** revient et fait passer le CRA à `VALIDÉ`, ce qui **verrouille le mois** et — si le lot 2 est là — déclenche le push des temps vers Dolibarr.
4. Un refus fait passer à `REFUSÉ`, et le CRA redevient rouvrable.

**Le webhook est authentifié par signature de charge utile**, pas par un simple jeton dans l'URL : il fait franchir une transition qui verrouille un mois et peut déclencher une facturation en aval.

**Un webhook perdu ne bloque rien.** Un bouton de rafraîchissement interroge `status()` à la demande, et la transition manuelle reste toujours accessible. Un circuit qui dépend d'un webhook qui n'arrive jamais est un circuit cassé.

---

## 6. Le destinataire

**Un contact signataire par mission** : nom et adresse électronique, saisis dans l'application. Pas de synchronisation d'annuaire, pas de gestion de contacts multiples.

Le niveau mission est le bon, et il aligne le destinataire sur le document : un CRA est déjà produit par couple *(mission, mois)*. Un même client peut porter plusieurs missions avec des interlocuteurs différents — un chef de projet pour l'une, un responsable de service pour l'autre — et rattacher le signataire au client obligerait à ressaisir ou à se tromper.

Le lot 2, s'il est présent, peut proposer les contacts du tiers Dolibarr à la reprise — sans l'imposer.

---

## 7. Relances

Une relance automatique après un délai configurable, puis un abandon. Le déclenchement passe par le même endpoint de traitement de fond que les autres tâches asynchrones : autoportant par défaut, appelable par cron ou n8n.

Trois relances maximum. Au-delà, le CRA reste `ENVOYÉ` et remonte dans une liste des CRA en souffrance.

---

## 8. Règles métier

- **Aucun montant sur le CRA.** Le document atteste du temps, pas d'une somme.
- **Les transitions manuelles restent disponibles** en permanence, connecteur ou pas.
- **`VALIDÉ` verrouille le mois**, quelle que soit la voie empruntée pour y arriver.
- **Le webhook est authentifié par signature de charge utile.**
- **Un webhook perdu n'empêche jamais d'avancer** : rafraîchissement à la demande, transition manuelle.
- **Le PDF signé est archivé**, jamais regénéré.
- **Le client n'a pas de compte.**

---

## 9. Hors périmètre

- **Portail client.** Décision du lot 0, non rouverte.
- **Signature multi-parties** ou circuit d'approbation interne. Un signataire, un document.
- **Modèles de PDF personnalisables.** Un modèle, correct, en dur. La personnalisation viendra si le besoin se manifeste.
- **Facturation.** Toujours et définitivement hors produit.

---

## 10. Tests

- **Génération du PDF** : un CRA connu produit un document contenant le bon détail par ligne et par jour, et **aucun montant** — c'est le test qui protège la frontière du produit.
- **Connecteur contre un double** : aucun test n'appelle Documenso.
- **Webhook** : une charge utile mal signée est rejetée ; une charge utile valide fait franchir la transition et verrouille le mois.
- **Webhook rejoué deux fois** : la seconde n'a aucun effet.
- **Webhook perdu** : le rafraîchissement à la demande rattrape l'état, et la transition manuelle reste possible.
- **Un refus rouvre le CRA.**
- **Sans connecteur configuré**, la génération et le téléchargement du PDF fonctionnent, et les transitions manuelles aussi.

---

## 11. Décisions prises sans arbitrage du porteur

À contester si elles ne conviennent pas :

- **Aucun montant sur le CRA**, même en pied de page.
- **Un CRA par couple mission-mois**, jamais un document consolidé par client. Un client portant quatre missions reçoit quatre documents.
- **Un seul contact signataire par mission**, et non par client.
- **Trois relances puis abandon.**
- **Documenso en première implémentation**, l'interface restant le vrai livrable.
