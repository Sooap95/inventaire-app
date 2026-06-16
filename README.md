# 🏠 Inventaire Maison

Inventaire domestique partagé pour 3 utilisateurs : suivi des stocks, liste de courses
classée par rayon Coop, mode « Faire les courses », scan de code-barres, et **synchro
temps réel** entre les téléphones via Firebase.

**Nouveautés** : interface **🇫🇷 français / 🇩🇪 allemand**, accès Firestore **sécurisé par
authentification anonyme**, **identité par appareil** (« modifié par … »), **suggestions
d'achat** (« à anticiper »), onglet **📊 Stats** de consommation, **recherche vocale** 🎤
et **auto-complétion produit** via Open Food Facts. Voir « Fonctionnalités » en bas.

## 📦 Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | L'application entière (HTML + CSS + JS). C'est le seul fichier à modifier (config Firebase). |
| `manifest.json` | Métadonnées PWA (nom, icône, couleurs) pour l'installation sur l'écran d'accueil. |
| `sw.js` | Service Worker : met l'appli en cache pour un fonctionnement **hors-ligne**. |
| `README.md` | Ce guide. |

> ⚠️ **Le scan de code-barres et la synchro nécessitent https.** Ouvrir `index.html`
> directement (`file://`) fonctionne en **mode local** (chacun son inventaire, sans
> caméra). Pour tout activer, il faut déployer sur GitHub Pages (gratuit, https inclus).

---

## 🚀 Déploiement — 4 étapes (~15 min, une seule fois)

### Étape 1 — Mettre les fichiers sur GitHub

1. Crée un compte sur https://github.com (gratuit) si besoin.
2. Crée un nouveau dépôt **public** (ex. `inventaire-maison`).
3. Depuis ce dossier, en ligne de commande :

   ```bash
   cd "C:\Users\konig\Downloads\inventaire-app"
   git init
   git add .
   git commit -m "Inventaire maison"
   git branch -M main
   git remote add origin https://github.com/TON-PSEUDO/inventaire-maison.git
   git push -u origin main
   ```

4. Sur GitHub : **Settings → Pages → Source : `main` / `/ (root)` → Save**.
5. Au bout d'1-2 min, ton appli est en ligne sur :
   `https://TON-PSEUDO.github.io/inventaire-maison/`

À ce stade l'appli marche déjà (mode local sur chaque téléphone). On active maintenant la synchro.

### Étape 2 — Créer la base Firebase (synchro temps réel)

1. Va sur https://console.firebase.google.com → **Ajouter un projet** (ex. `inventaire-maison`).
   Tu peux désactiver Google Analytics (inutile ici).
2. Dans le menu **Build → Firestore Database → Créer une base de données**.
   - Choisis l'emplacement **`eur3 (europe-west)`** (proche de la Suisse).
   - Démarre en **mode production** (on règle les accès à l'étape 3).
3. Récupère ta config : ⚙️ **Paramètres du projet → Tes applications → Web (`</>`)**.
   - Donne un surnom, **sans** activer Hosting, puis **Enregistrer**.
   - Firebase affiche un objet `firebaseConfig = { apiKey: "...", ... }`. **Copie-le.**
4. **Active l'authentification anonyme** (elle sécurise l'accès à la base) :
   menu **Build → Authentication → Get started → onglet Sign-in method →
   Anonyme → Activer → Enregistrer**.
   - Aucune action côté utilisateur : l'appli se connecte toute seule, sans login ni
     mot de passe. C'est juste un jeton invisible qui prouve que la requête vient de
     l'appli, pas d'un inconnu qui aurait deviné l'adresse de la base.

### Étape 3 — Coller la config dans `index.html`

Ouvre `index.html`, tout en haut du `<script>` tu trouveras :

```js
const firebaseConfig = {
  apiKey: "TON_API_KEY",
  authDomain: "TON_PROJET.firebaseapp.com",
  ...
};
```

Remplace ce bloc par celui copié depuis Firebase. **Garde** la ligne
`const FB_COLLECTION = 'products';` juste en dessous.

Puis règle les accès Firestore : console Firebase → **Firestore → Règles**, colle ceci
et **Publier** :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /products/{productId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

> 🔒 **Sécurité.** `request.auth != null` exige que la requête soit **authentifiée**.
> Grâce à l'authentification anonyme (étape 2.4), l'appli s'authentifie automatiquement :
> tes 3 téléphones ont accès, mais **un inconnu qui devinerait l'adresse de la base ne
> peut ni lire ni modifier** l'inventaire. Si tu n'as **pas** activé l'auth anonyme, ces
> règles bloqueront tout : active-la, ou (déconseillé) reviens à `allow read, write: if true;`.

### Étape 4 — Republier

```bash
git add index.html
git commit -m "Config Firebase"
git push
```

Recharge l'appli sur ton téléphone : en haut tu dois voir **« ☁️ Synchronisé à HH:MM »**.
Les 3 téléphones partagent maintenant le même inventaire en direct. 🎉

---

## 📲 Installer sur les 3 téléphones

Ouvre `https://TON-PSEUDO.github.io/inventaire-maison/` dans le navigateur, puis :

- **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
- **Android (Chrome)** : menu ⋮ → *Installer l'application* / *Ajouter à l'écran d'accueil*.

L'appli s'ouvre alors en plein écran comme une vraie app, et fonctionne hors-ligne.
L'onglet **📷 Scan** contient aussi un QR code qui ouvre l'appli — pratique pour le
partager rapidement aux deux autres téléphones.

---

## 💡 Bon à savoir

- **Synchro** : chaque produit est un document Firestore. Deux personnes peuvent modifier
  des produits **différents** en même temps sans conflit. Si deux personnes modifient le
  **même** produit à la même seconde, c'est la dernière écriture qui gagne.
- **Hors-ligne** : l'appli s'ouvre sans réseau (Service Worker) et Firestore met les
  changements en file d'attente, synchronisés au retour du réseau.
- **Sauvegarde** : le bouton **💾 Export** télécharge un `.json` de tout l'inventaire ;
  **📂 Import** le réinjecte (fusion par produit). Pratique comme sauvegarde manuelle.
- **Mise à jour de l'appli** : après un `git push` qui modifie `index.html`, pense à
  **incrémenter `CACHE` dans `sw.js`** (`...-v1` → `...-v2`) pour forcer le rafraîchissement.
- **Gratuit** : l'usage d'une famille reste très largement dans le quota gratuit de Firestore.

---

## ✨ Fonctionnalités

- **🇫🇷 / 🇩🇪 Bilingue.** Au tout premier lancement, l'appli demande la **langue** puis ton
  **prénom**. Tu peux changer les deux à tout moment via le bouton **⚙️** du header. Tout
  l'écran bascule sans rechargement.
- **👤 Identité par appareil.** Chaque carte produit affiche **« ✏️ Modifié par … · il y a … »**.
  Le prénom est stocké sur l'appareil (pas de compte). Les délais récents sont précis
  (« il y a 2h », « il y a 45 min »).
- **⏰ Suggestions « à anticiper ».** En plus des produits sous le seuil, la liste et le mode
  courses proposent une section **À anticiper** : produits encore OK mais bientôt épuisés
  d'après leur **fréquence** de consommation et leur dernier réappro.
- **📊 Stats de consommation.** Onglet **Stats** : choisis un produit, vois un **graphique**
  des réappros des 6 derniers mois, le nombre de rachats, qui l'a fait en dernier et la
  **fréquence réelle** observée. Bouton « Ajuster les seuils » pour corriger directement.
- **🎤 Recherche vocale.** Bouton micro à côté de la recherche (et flottant en mode courses).
  **Appuie-maintiens** pour dicter. Masqué si le navigateur ne supporte pas la reconnaissance
  vocale. La langue suit celle de l'appli.
- **🌿 Auto-complétion Open Food Facts.** Dans « Ajouter un produit » : tape le **nom** (≥ 3
  lettres) pour une liste de suggestions, ou scanne/saisis un **code-barres** pour pré-remplir
  nom, marque et rayon. 100 % optionnel, sans clé API ; désactivé en silence si hors-ligne.

### Schéma produit (champs ajoutés)

```json
{
  "lastEditedBy": "Edouard",
  "restockHistory": [ { "date": "2026-06-16T...", "qty": 5, "by": "Edouard" } ]
}
```

Ces champs sont créés automatiquement (migration douce) sur les inventaires existants :
aucune action requise, rien n'est cassé.
