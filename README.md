# IziNote

IziNote est une web app gratuite pour corriger les copies PDF de ses étudiants sur une tablette (stylet Samsung S Pen), avec grilles d'évaluation, commentaires dictés et envoi des corrections par e-mail.

![IziNote](assets/logo-complet.png)

Charte graphique : noir `#141414`, orange `#FF7828`, beige `#F5EDE0` · typographie Montserrat.

## Ce que fait l'appli

- **Rangement** : École › Classe › Devoir / projet › Étudiant. Tout s'ajoute à la main (bouton « + »). Les étudiants peuvent aussi être collés depuis un tableur.
- **Copies** : import des PDF un par un (📎) ou en lot. L'appli devine l'étudiant d'après le nom du fichier, et vous vérifiez avant de valider.
- **Correction au stylet** : stylo (4 couleurs, 3 épaisseurs), surligneur, texte, gomme, annuler/rétablir, zoom. Avec « Stylet seul », le doigt sert à défiler et à zoomer (pincer) sans laisser de trace.
- **Commentaire oral** : bouton 🎙 pour dicter, retranscrit en texte (dictée gratuite de Chrome, il faut internet). Dites « virgule », « point » ou « à la ligne » pour la ponctuation.
- **Grilles d'évaluation** propres à chaque devoir :
  - *Notation* : critères avec un nombre de points, note ramenée sur 20 (ou autre) si vous le souhaitez ;
  - *Acquis / non acquis* : compétences avec des niveaux que vous choisissez (par défaut Non acquis / En cours d'acquisition / Acquis).
  - Les grilles modèles (« Grilles ») se réutilisent d'un devoir à l'autre.
- **Envoi** : quand la classe est corrigée, l'appli le signale et propose d'envoyer. Chaque étudiant reçoit sur son e-mail son PDF corrigé (annotations + une page « Fiche d'évaluation » avec la grille et votre commentaire). L'envoi passe par votre Gmail dédié.
- **Fin d'année** : sur la page de la classe, menu ⋮ › « Supprimer la classe ». Cela supprime ses étudiants, devoirs et copies. Pour confirmer, il faut retaper le nom de la classe.
- **Sauvegarde** : Réglages › Exporter / Restaurer (un fichier .json à ranger dans Google Drive, par exemple).

Tout est stocké **sur la tablette** (dans le navigateur) : rien n'est envoyé ailleurs, sauf les mails. Pensez donc à exporter une sauvegarde de temps en temps.

## Mise en ligne (gratuite, avec GitHub Pages)

1. Dans ce dépôt GitHub : **Settings › Pages**, puis « Source : Deploy from a branch », branche `main`, dossier `/ (root)`, et **Save**.
2. Au bout d'une minute, l'appli est en ligne à l'adresse `https://<votre-identifiant>.github.io/<nom-du-dépôt>/`.

## Installation sur la tablette Samsung

1. Ouvrez l'adresse ci-dessus dans **Chrome**.
2. Menu ⋮ › **Ajouter à l'écran d'accueil** (ou « Installer l'application »).
3. L'appli s'ouvre alors en plein écran, comme une vraie application, et fonctionne même hors connexion (sauf la dictée et l'envoi des mails).

Utilisez toujours la même adresse et le même navigateur : les données sont liées à l'adresse de l'appli.

## Connexion Gmail (une seule fois, environ 10 minutes)

À faire de préférence sur un ordinateur, en étant connecté avec le **Gmail dédié** :

1. Ouvrez <https://console.cloud.google.com/projectcreate> et créez un projet, par exemple « Correction ».
2. Activez l'**API Gmail** : <https://console.cloud.google.com/apis/library/gmail.googleapis.com>, puis « Activer ».
3. Menu **Google Auth Platform** (anciennement « Écran de consentement OAuth ») › Commencer :
   - nom de l'application au choix, e-mail d'assistance = le Gmail dédié ;
   - audience : **Externe** ;
   - dans **Audience › Utilisateurs test**, ajoutez le Gmail dédié.
4. Menu **Clients** › **Créer un client** :
   - type : **Application Web** ;
   - « Origines JavaScript autorisées » : `https://<votre-identifiant>.github.io` (sans le nom du dépôt ni de `/` final).
5. Copiez l'**ID client** (il finit par `.apps.googleusercontent.com`).
6. Dans l'appli, ouvrez **Réglages**, collez l'ID client, enregistrez, puis cliquez sur « Envoyer un mail de test ».

Au premier envoi, Google affiche « Google n'a pas validé cette application ». C'est normal pour une application personnelle : cliquez sur « Continuer ». L'autorisation dure une heure ; après, Google redemande simplement de confirmer d'un clic.

C'est gratuit : un compte Gmail peut envoyer environ 500 mails par jour.

## Notes techniques

- HTML/CSS/JavaScript sans framework ni étape de compilation. Les bibliothèques sont incluses dans `lib/` : [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 pour l'affichage et [pdf-lib](https://pdf-lib.js.org/) 1.17 pour produire le PDF corrigé.
- Données dans IndexedDB ; `sw.js` met l'appli en cache pour qu'elle fonctionne hors ligne.
- Envoi par l'API Gmail (`gmail.send`) avec Google Identity Services, directement depuis le navigateur, sans serveur.
- Pour tester en local : `python3 -m http.server` dans ce dossier, puis <http://localhost:8000>.
