/**
 * Texte du LISEZMOI livré à la racine de l'archive.
 *
 * Généré plutôt que recopié, pour deux raisons :
 *
 *  1. il nomme la plateforme de l'archive, et une archive macOS qui
 *     prétendrait tourner sous Windows serait un mensonge à la première ligne ;
 *  2. son contenu devient vérifiable — `src/distribution/lisezmoi.test.ts`
 *     tient la phrase sur la durabilité, l'ordre des sections et le paragraphe
 *     sur le port, qui sont la raison d'être de ce lot.
 *
 * Le corps est **sans accent**, délibérément : ce texte est écrit dans un
 * `LISEZMOI.txt` que le Bloc-notes Windows peut ouvrir en encodage local, où
 * les accents s'afficheraient abîmés.
 *
 * @param {{ plateforme: string, version: string }} options
 * @returns {string}
 */
export function texteLisezmoi({ plateforme, version }) {
  return `CRA ${version} — version portable pour ${plateforme}
==================================================================

Compte-rendu d'activite, a faire tourner sur ton ordinateur.
Cette archive est prevue pour ${plateforme} uniquement.


1. CE QU'IL FAUT AVOIR
----------------------
Node.js 20 ou plus. Pour verifier, ouvre un terminal et tape :

    node -v

Si la reponse commence par v20, v22 ou plus, tout va bien.
Sinon, installe Node.js depuis https://nodejs.org


2. DEMARRER
-----------
    ./demarrer.sh            (macOS, Linux)
    demarrer.cmd             (Windows)

Le navigateur s'ouvre tout seul. Au tout premier demarrage, l'application
te demande de creer un compte :

    ./creer-utilisateur.sh moi@exemple.fr "Mon Nom" monmotdepasse


3. ARRETER
----------
    ./arreter.sh             (macOS, Linux)
    arreter.cmd              (Windows)


4. OU SONT TES DONNEES
----------------------
Tout est dans le dossier donnees/, a cote de ce fichier.
Copier donnees/ ailleurs, c'est tout sauvegarder.
Pour une copie propre pendant que l'application tourne :

    ./sauvegarder.sh         (sauvegarder.cmd sous Windows)


5. ARRETER NE PERD RIEN
-----------------------
L'application ne perd aucune donnee quand tu l'arretes. Elle ecrit sur le
disque a chaque saisie validee, en journalisation WAL. Fermer la fenetre,
arreter le programme ou couper l'ordinateur ne fait perdre aucune saisie
deja enregistree. Tu peux eteindre sans y penser.


6. METTRE A JOUR
----------------
    1. ./arreter.sh
    2. dezippe la nouvelle archive dans un dossier neuf
    3. copie ton dossier donnees/ dans ce dossier neuf
    4. ./demarrer.sh — la base se met a jour toute seule

L'archive ne contient jamais de dossier donnees/ : meme en dezippant par
dessus ton installation actuelle, rien ne peut ecraser ta base. Avant
d'appliquer une mise a jour de la base, une copie de sauvegarde est ecrite
automatiquement dans donnees/sauvegardes/.


7. SI LE NAVIGATEUR NE S'OUVRE PAS
----------------------------------
L'adresse exacte est affichee dans le terminal au demarrage, sous la forme
http://127.0.0.1:3000 — saisis-la a la main. En cas de blocage, le journal
du demarrage est dans donnees/journal.log


8. SI LE NUMERO DE PORT A CHANGE
--------------------------------
Le 3000 est demande a chaque demarrage ; s'il etait pris, CRA prend le
suivant et le dit. Ce changement casse l'URL de retour enregistree chez
Google : le terminal affiche la ligne exacte a enregistrer dans la console
Google Cloud (http://localhost:3001/api/google/callback), que l'ecran
Administration > Google affiche aussi et ou elle se recopie -- aucun fichier
a ouvrir. Pour un port fixe, libere le 3000 ou impose CRA_PORT=3005.
`
}
