# IziNote

IziNote est une web app gratuite pour corriger les copies PDF de ses étudiants sur une tablette (stylet Samsung S Pen), avec grilles d'évaluation, commentaires dictés et envoi des corrections par e-mail.

![IziNote](assets/logo-complet.png)

Charte graphique : noir `#141414`, orange `#FF7828`, beige `#F5EDE0` · typographie Montserrat.

## Ce que fait l'appli

- **Rangement** : École › Classe › Devoir / projet › Étudiant. Tout s'ajoute à la main (bouton « + »). Les étudiants peuvent aussi être collés depuis un tableur.
- **Copies** : import un par un (📎) ou en lot. Fichiers acceptés : PDF, Word (.docx) et photos ; les fichiers Word et les photos sont convertis en PDF dans la tablette. L'appli devine l'étudiant d'après le nom du fichier, et vous vérifiez avant de valider. Plusieurs documents pour un même élève sont assemblés à la suite, et « 📎 Ajouter un document » dans l'écran de correction en ajoute d'autres sans perdre les annotations.
- **Correction au stylet** : stylo (4 couleurs + vos couleurs avec « ＋ », 4 épaisseurs qui restent les mêmes à l'écran quand on zoome), tampons 🏷️ (✓, ✗, ★, « Très bien », « À revoir »… vos propres tampons texte, et des tampons image comme un logo, importés avec « ＋ Tampon » › « Importer une image » ; touchez un tampon posé pour l'agrandir, le réduire ou le supprimer), surligneur, texte, gomme, annuler/rétablir, zoom. Avec « Stylet seul », le doigt sert à défiler et à zoomer (pincer) sans laisser de trace.
- **Commentaire oral** : bouton 🎙 pour dicter, retranscrit en texte (dictée gratuite de Chrome, il faut internet). Dites « virgule », « point » ou « à la ligne » pour la ponctuation.
- **Grilles d'évaluation** propres à chaque devoir :
  - *Notation* : critères avec un nombre de points, note ramenée sur 20 (ou autre) si vous le souhaitez, et des malus facultatifs (ex. « Excès d'IA » − 1) à cocher en corrigeant, retirés de la note finale ;
  - *Acquis / non acquis* : compétences avec des niveaux que vous choisissez (par défaut Non acquis / En cours d'acquisition / Acquis).
  - Les grilles modèles (« Grilles ») se réutilisent d'un devoir à l'autre.
- **Envoi** : quand la classe est corrigée, l'appli le signale et propose d'envoyer. Chaque étudiant reçoit sur son e-mail son PDF corrigé (annotations + une page « Fiche d'évaluation » avec la grille et votre commentaire). L'envoi passe par votre Gmail dédié.
- **Envoyer un document à la classe** : bouton « ✉ Envoyer un document » sur la page de la classe. Écrivez un objet et un message (ou dictez-le), joignez un ou plusieurs fichiers (25 Mo au total maximum), puis cochez les élèves. Un seul mail part, avec les élèves en copie cachée. Les envois sont listés en bas de la page de la classe.
- **Envois programmés** : dans la fenêtre d'envoi, cochez « ⏰ Programmer l'envoi » et choisissez la date et l'heure. Sans rien installer, IziNote envoie à l'heure prévue s'il est ouvert, sinon à la prochaine ouverture. Pour un envoi même tablette éteinte, installez une fois le « relais d'envoi programmé » (Réglages, environ 5 minutes) : un petit script Google gratuit dans votre Gmail dédié.
- **Devoirs à rendre et rappels** : sur la page d'un devoir, « Préparer le devoir ». Choisissez la date de rendu, écrivez (ou dictez) les consignes et ajoutez les documents de travail. Ensuite, « ✉ Envoyer aux élèves » envoie un seul mail avec les élèves en copie cachée, tout de suite ou à une date choisie. IziNote envoie aussi des rappels **1 semaine avant** et **le jour du rendu**, à l'heure choisie (8 h par défaut), avec les documents s'ils sont cochés. Si vous changez la date de rendu, les rappels suivent. Sans relais, les rappels partent quand IziNote est ouvert ; avec le relais, ils partent même tablette éteinte. Si vous avez installé le relais avant cette version, recopiez son code (Réglages), relancez la fonction « installer » (▶ Exécuter) puis, dans script.google.com, « Déployer › Gérer les déploiements › ✎ › Nouvelle version ».
- **Évaluation écrite en cours (contrôle)** : type « Évaluation écrite » à la création. Pas de grille à construire (une note sur 20 est prête, modifiable) ni de PDF obligatoire (« Joindre la copie scannée » reste possible). La note est obligatoire pour valider ; l'envoi des notes par mail est facultatif, la copie étant rendue en main propre. Sur la page du contrôle, « Préparer les rappels » : date du contrôle, ce qu'il faut réviser, le cours et les exercices à refaire en pièces jointes, puis « 🔔 Programmer les rappels » : les élèves reçoivent un mail **une semaine avant** et **la veille** (le jour J en option), avec une annonce immédiate en option.
- **Logo des écoles** : touchez le carré à gauche du nom de l'école. Vous pouvez choisir une image, ou donner l'adresse du site de l'école pour qu'IziNote récupère son logo. Le logo apparaît aussi sur les fiches PDF.
- **Grilles par matière** : chaque grille et chaque évaluation peut avoir une matière. Dans « Grilles », les modèles sont rangés par matière.
- **Importer une grille existante** : depuis un PDF ou une photo (bouton « Photographier »). IziNote lit le texte (aussi sans internet) et propose les critères avec leurs points. Vous les vérifiez avant de valider.
- **Oraux et travaux de groupe** : à la création d'une évaluation, choisissez le type « Oral » ou « Travail de groupe ».
  - Pour un groupe : créez les groupes, puis évaluez chaque groupe une seule fois. La note et le commentaire sont reportés sur la fiche de chaque membre.
  - Pour individualiser la note d'un élève, ouvrez sa ligne : il garde alors sa propre note.
- **Récap par étudiant** : bouton « Récap » dans la liste des étudiants. On y trouve les notes, la moyenne sur 20, les compétences et les commentaires, par période ou sur toute l'année. Le récap s'exporte en PDF pour remplir le livret scolaire.
- **Export Excel** : bouton « Exporter les notes » sur la page de la classe. Le fichier contient une ligne par élève : nom, prénom, puis une colonne par évaluation (titre et date) avec la note, et la moyenne. Une 2ᵉ feuille donne les compétences.
- **Semestres** : menu ⋮ de la classe › « Clôturer … ». La période en cours est archivée (toujours consultable en bas de la page de la classe) et une nouvelle commence.
- **Fin d'année** : sur la page de la classe, menu ⋮ › « Supprimer la classe ». Cela supprime ses étudiants, devoirs et copies. Pour confirmer, il faut retaper le nom de la classe.
- **Tablette en portrait** : l'écran de correction s'adapte. La barre d'outils passe sur deux lignes et le panneau d'évaluation se place sous la copie au lieu de la recouvrir.
- **Synchronisation entre appareils** : Réglages › « Synchronisation entre appareils ». Les données (classes, copies et leurs PDF, corrections, grilles, réglages) sont copiées dans un dossier caché du Google Drive du Gmail dédié. Vous les retrouvez ainsi sur la tablette et sur l'ordinateur. Ensuite, tout se fait seul pendant que l'appli est ouverte. Quand Google demande de reconfirmer la connexion (toutes les heures), le nuage en haut à droite a un point orange : touchez-le.
- **Sauvegarde** : Réglages › Exporter / Restaurer (un fichier .json à ranger dans Google Drive, par exemple).

Les données sont stockées dans le navigateur de chaque appareil. Rien n'est envoyé ailleurs, sauf les mails et, si vous l'activez, la synchronisation vers votre propre Google Drive. Pensez à exporter une sauvegarde de temps en temps.

## Synchronisation entre appareils (une fois, 2 minutes)

1. Dans le projet Google Cloud de la connexion Gmail, activez l'**API Google Drive** : <https://console.cloud.google.com/apis/library/drive.googleapis.com>, puis « Activer ».
2. Sur chaque appareil (tablette, ordinateur) : ouvrez IziNote à la même adresse, collez l'ID client dans Réglages, puis cochez « Synchroniser cet appareil ». Google demande d'autoriser l'accès au Drive : acceptez.

IziNote n'a accès qu'à son propre dossier caché (`appDataFolder`), pas au reste de votre Drive. Si vous travaillez sur deux appareils sans connexion, tout est rassemblé à la synchronisation suivante : pour un même élément, la version modifiée en dernier l'emporte.

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

- HTML/CSS/JavaScript sans framework ni étape de compilation. Les bibliothèques sont incluses dans `lib/` : [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (affichage), [pdf-lib](https://pdf-lib.js.org/) 1.17 (PDF corrigés et récaps), [SheetJS](https://sheetjs.com/) 0.18 (export Excel) et [Tesseract.js](https://tesseract.projectnaptha.com/) 5.1 avec le français (lecture des grilles en photo).
- Données dans IndexedDB ; `sw.js` met l'appli en cache pour qu'elle fonctionne hors ligne.
- Envoi par l'API Gmail (`gmail.send`) avec Google Identity Services, directement depuis le navigateur, sans serveur.
- Synchronisation (`js/sync.js`) par l'API Google Drive (`drive.appdata`) : un fichier `izinote-donnees.json` et un fichier par PDF de copie. Les suppressions sont gardées dans le magasin IndexedDB `tombstones` pour être reportées sur les autres appareils.
- Pour tester en local : `python3 -m http.server` dans ce dossier, puis <http://localhost:8000>.
