# 🌟 Suivi de Vie

Journal quotidien intelligent — **PWA** (fonctionne hors-ligne, installable sur mobile) avec **compte cloud Firebase** et synchronisation temps réel entre appareils.

## ✨ Fonctionnalités

- 🔐 **Connexion sécurisée** : e-mail / mot de passe ou Google (Firebase Authentication), avec mot de passe oublié, ou **mode local** sans compte
- ☁️ **Synchronisation cloud** : données par utilisateur dans Firestore, mises à jour en temps réel entre tous vos appareils, cache hors-ligne
- 📅 **Journal du jour** : sport, marche (pas estimés), heures de travail (calcul automatique avec pause), dépenses, activités et notes
- 🗓 **Calendrier** : vue mensuelle avec code couleur (complet / partiel / vide) et détail de chaque jour
- ✏️ **Modification complète d'un jour** : tous les champs, **ajout et suppression des dépenses et activités**, et **suppression de la journée entière** — rien n'est enregistré tant que vous ne validez pas
- 📋 **Historique** : recherche plein texte, filtre par mois, modification et suppression rapides
- 📊 **Statistiques** : semaine / mois / année avec graphiques
- 📆 **Planning hebdomadaire** : horaires types pré-remplis automatiquement
- 🎂 **Anniversaires** : compte à rebours, âge fêté, popup de célébration 🎉
- 🎯 **Objectifs** : pas, sport, budget, heures de travail avec barres de progression
- 🎨 **4 thèmes** (sombre, clair, bleu, vert), export **JSON / CSV**, import de sauvegarde

## 📁 Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de l'application (écran de connexion, vues, modales) |
| `style.css` | Styles et thèmes |
| `app.js` | Logique : auth, données, synchro, vues |
| `firebase-config.js` | **Votre configuration Firebase** (à remplir) |
| `service-worker.js` | Cache hors-ligne (PWA) |
| `manifest.webmanifest` / `icon.svg` | Installation sur mobile |

## 🚀 Mise en route

### 1. Configurer Firebase (recommandé)

1. Créez un projet sur [console.firebase.google.com](https://console.firebase.google.com) (ou utilisez votre projet existant).
2. **Authentication** → *Get started* → onglet **Sign-in method** :
   - activez **E-mail/Mot de passe** ;
   - activez **Google** (facultatif, pour le bouton « Continuer avec Google »).
3. **Firestore Database** → *Créer une base de données* (mode production).
4. Onglet **Règles** de Firestore → collez ces règles puis publiez :

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   > Chaque utilisateur ne peut lire et écrire **que ses propres données**.

5. ⚙️ **Paramètres du projet** → *Vos applications* → ajoutez une **application Web** et copiez l'objet `firebaseConfig`.
6. Collez-le dans **`firebase-config.js`** :

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza…",
     authDomain: "mon-projet.firebaseapp.com",
     projectId: "mon-projet",
     storageBucket: "mon-projet.appspot.com",
     messagingSenderId: "…",
     appId: "…"
   };
   ```

   💡 Alternative sans toucher au code : ouvrez l'application, dépliez « ☁️ Activer le compte cloud (Firebase) » sur l'écran de connexion et collez-y la configuration.

7. Si vous hébergez l'application (GitHub Pages…), ajoutez le domaine dans **Authentication → Settings → Authorized domains**.

### 2. Héberger l'application

- **GitHub Pages** : Settings → Pages → *Deploy from a branch* → branche `main`, dossier `/ (root)`. L'application sera servie en HTTPS (requis pour la PWA).
- **En local** : servez le dossier (ex. `npx serve .` ou `python3 -m http.server`) — l'ouverture directe en `file://` fonctionne mais sans service worker.

### 3. Mode local (sans compte)

Sans configuration Firebase, l'application fonctionne en **mode local** : connexion par prénom, données enregistrées dans le navigateur de l'appareil. Lors de la création d'un compte cloud, les données locales sont **importées automatiquement**.

## 🔒 Notes de sécurité

- La configuration Firebase (`apiKey`…) n'est **pas un secret** : elle identifie votre projet. La protection des données vient des **règles Firestore** ci-dessus et de l'authentification.
- Les contenus saisis sont échappés avant affichage (protection XSS).

## 🛠 Développement

- Après modification des fichiers, incrémentez `CACHE_NAME` dans `service-worker.js` pour que les utilisateurs reçoivent la mise à jour.
- Aucune dépendance à installer : HTML / CSS / JS vanilla + SDK Firebase (compat) chargé par CDN.
