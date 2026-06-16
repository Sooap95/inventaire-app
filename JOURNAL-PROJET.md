# 📋 Journal du projet — Inventaire Maison

Résumé du travail effectué, des choix faits et des pistes pour la suite.

---

## 1. Contexte de départ

Une appli web maison (un seul fichier `.html`, sans framework ni build) pour gérer
l'inventaire domestique d'une famille à Olten (courses chez Coop) : produits, stocks,
seuils, liste de courses classée par rayon. Utilisée surtout sur téléphone.

Objectif de cette session : l'enrichir de plusieurs fonctionnalités, puis la rendre
utilisable par **3 personnes en même temps**, avec **synchro temps réel**.

---

## 2. Fonctionnalités ajoutées

| Fonctionnalité | Description | Pourquoi |
|---|---|---|
| **Export / Import JSON** | Bouton qui télécharge tout l'inventaire en `.json`, et un autre qui le réimporte en fusionnant par `id` (pas d'écrasement bête). | Sauvegarde manuelle simple, et filet de sécurité indépendant de Firebase. |
| **Mode "Faire les courses"** | Vue plein écran, gros boutons tactiles, produits groupés par rayon, bouton "✅ Acheté" qui remet le stock au niveau cible et enregistre la date. | Le mode liste classique n'est pas pratique à utiliser dans un magasin avec un caddie d'une main. |
| **Historique `lastRestocked`** | Chaque produit garde la date du dernier réapprovisionnement, affichée en relatif ("il y a 3 jours"). | Savoir si un produit "stagne" sans devoir s'en souvenir. |
| **Fréquence de consommation** + badge **"⏰ Bientôt"** | Champ `quotidien / hebdomadaire / mensuel / trimestriel` par produit ; un badge s'affiche si le produit risque de manquer avant le prochain passage en courses. | Anticiper plutôt que constater une rupture de stock. |
| **Impression optimisée** | Feuille d'impression dédiée à la liste de courses (2 colonnes, cases à cocher, groupée par rayon) — tout le reste de la page est masqué à l'impression. | Pratique pour qui préfère une liste papier au magasin. |
| **Scan de code-barres** | Remplace les QR codes par produit. Scanner un code connu ouvre directement l'ajustement de stock ; un code inconnu propose de l'associer à un produit existant ou d'en créer un nouveau. | Plus rapide et plus naturel que chercher le produit au clavier — surtout en magasin. Décision validée explicitement par toi (modale rapide / associer-ou-créer / un seul QR pour ouvrir l'appli). |
| **Synchro temps réel à 3 (Firebase Firestore)** | Chaque produit = un document dans la base. Toute modification (stock, ajout, suppression, import) est répercutée en direct sur les 3 téléphones. | Demande explicite : "il y aura trois utilisateurs de l'outil". Évite que chacun ait son propre inventaire désynchronisé. |
| **PWA installable + mode hors-ligne** | `manifest.json` + Service Worker réel (`sw.js`) : icône sur l'écran d'accueil, ouverture sans réseau. | Le scan caméra et la synchro nécessitent du https, ce qui imposait de toute façon un vrai déploiement (GitHub Pages) plutôt que le fichier local — l'installation PWA et le mode hors-ligne étaient quasi "gratuits" une fois ce choix fait. |

---

## 2bis. Session « 6 fonctionnalités » (juin 2026)

Deuxième vague de travail, toujours dans le **seul `index.html`** (+ `README.md` et ce
journal). Aucune régression : scan, mode courses, export/import, PWA et repli local
fonctionnent comme avant.

| # | Fonctionnalité | Description | Décisions / notes |
|---|---|---|---|
| 1 | **Authentification anonyme Firebase** | SDK `firebase-auth-compat` ajouté ; `signInAnonymously()` appelé dans `startFirebase()` **avant** l'écoute Firestore. L'écoute ne démarre qu'une fois authentifié ; en cas d'échec → toast + mode local. | Sécurise l'accès sans aucune UI de login. Règles Firestore durcies en `if request.auth != null` (voir README). Repli local conservé. |
| 2 | **Identité par appareil** | Modale de bienvenue au 1er lancement (prénom obligatoire, bouton désactivé tant que vide), bouton **⚙️** pour le changer. Champ `lastEditedBy` écrit à chaque modif (`adjustStock`, `saveProduct`, `confirmBuy`, `saveQuickUpdate`, `linkToExisting`). Affiché « ✏️ Modifié par … · il y a … ». `relativeTime()` précisé sous 24h (min/heures). | Prénom en `localStorage` (par appareil), pas de comptes. |
| 3 | **Suggestions « à anticiper »** | `isSuggested(p)` = `getStatus==='ok'` ET `isDepletingSoon(p)`. Section visuelle distincte (bordure pointillée, fond légèrement différent), badge « Suggéré ». Présente dans la vue liste **et** le mode « Faire les courses ». | Réutilise la logique `isDepletingSoon()` existante. |
| 4 | **Stats de consommation** | Nouveau champ `restockHistory[]` (max 50 entrées) alimenté par `confirmBuy()` et `saveQuickUpdate()` quand le stock augmente. 4ᵉ onglet **📊 Stats** : sélecteur de produit + **graphique barres en canvas natif** (6 derniers mois, responsive via `devicePixelRatio`), nombre de rachats, dernier acheteur, fréquence réelle observée, bouton « Ajuster les seuils ». | **Aucune librairie de graphe** : canvas 2D natif. Migration douce `restockHistory: []`. |
| 5 | **Recherche vocale** | Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`). Bouton micro **appui-maintenu** à côté de la recherche + micro **flottant** en mode courses (surligne le produit dicté). Masqué si l'API est absente. Langue = langue de l'appli (`fr-FR`/`de-DE`). | Aucune dépendance, aucune clé. Repli silencieux. |
| 6 | **Internationalisation FR / DE** | Objet `TRANSLATIONS = { fr, de }` + fonction `t(clé, vars)` (interpolation `{x}` et pluriel `{s}`). Chaînes statiques via `data-i18n` / `data-i18n-ph` / `data-i18n-title` appliquées par `applyTranslations()` ; chaînes dynamiques via `t()`. Modale de choix de langue **avant** celle du prénom au 1er lancement ; toggle 🇫🇷/🇩🇪 dans ⚙️ (bascule à chaud, sans rechargement). Rayons Coop, fréquences, catégories et temps traduits. | **Valeurs stockées restent en français canonique** (rayons, fréquences, catégories) : seul l'affichage est traduit (`aisleLabel`/`freqLabel`/`catLabel`), pour ne pas casser les données existantes ni la synchro. |
| 7 | **Open Food Facts** | Lookup auto par **code-barres** (si `#f-name` vide) et **autocomplete par nom** (debounce 400 ms, ≥ 3 car., dropdown 6 résultats). Pré-remplit nom, marque (→ notes), code-barres et **rayon deviné** (`OFF_TO_AISLE` → `guessAisle`). Bandeaux de statut, crédit « 🌿 Données Open Food Facts ». | `fetch()` natif, sans clé. **Catch silencieux** : hors-ligne ou erreur réseau → désactivé sans bloquer la saisie. Champs restent éditables. |

---

## 2ter. Session « déploiement + correctif Open Food Facts mobile » (16 juin 2026)

Mise en ligne effective des 6 fonctionnalités, puis débogage d'un problème apparu
seulement **en conditions réelles** (téléphone + site déployé).

### Ce qu'on a fait

| Quoi | Comment | Pourquoi |
|---|---|---|
| **Déploiement Git** | Le dépôt Git a été (re)créé directement dans le **nouveau dossier de travail `D:\inventaire-app`** (l'utilisateur ne voulait pas de dépôt Git dans `Downloads`). `git init` → `add` → `commit` → `remote add origin` → `push` vers `github.com/Sooap95/inventaire-app`. | Garder le dossier `Downloads` propre ; centraliser la source du déploiement sur `D:`. |
| **Authentification GitHub** | Le mot de passe de compte est **refusé** par GitHub pour Git : il faut un **Personal Access Token** (classic, scope `repo`) saisi à la place du mot de passe. | GitHub a supprimé l'auth par mot de passe pour les opérations Git (sécurité). |
| **Bump du Service Worker** | `CACHE` dans `sw.js` incrémenté (`v1` → `v2` → `v3`) à chaque déploiement. | Sans ça, les téléphones (PWA installée) gardent l'ancienne version en cache et ne voient pas les nouveautés. |
| **Correctif Open Food Facts sur mobile** | OFF s'affichait « indisponible » sur le site déployé alors que l'API répond bien (vérifié : `HTTP 200`, `Access-Control-Allow-Origin: *`). Deux causes corrigées : (1) on **retire l'en-tête `User-Agent`** des `fetch()` — les navigateurs **interdisent** de le fixer depuis une page, ce qui faisait échouer la requête ; (2) on **exclut `openfoodfacts.org` du Service Worker** (comme Firestore) pour qu'il n'intercepte plus l'appel. Ajout d'un `console.warn` dans les `catch` pour diagnostiquer un éventuel futur échec. | L'en-tête `User-Agent` n'était utile que pour un client serveur ; en navigateur il est inutile (le navigateur envoie le sien) et nuisible. Le SW ne doit pas mettre en cache / perturber une API tierce. |

### Décisions / notes

- **Nouvelle source de vérité : `D:\inventaire-app`.** La copie dans `Downloads` est désormais **obsolète** — toute modification future se fait dans `D:`.
- **Piège à retenir :** une réécriture complète de `index.html` réinitialise le bloc `firebaseConfig` en placeholder `TON_…`. Toujours **recoller la vraie config Firebase** avant de redéployer.
- Si OFF venait à re-bloquer : ce ne serait plus le code mais l'appareil (bloqueur de pub type Brave/uBlock, VPN/filtrage). Le `console.warn` ajouté donne la raison exacte (F12 → Console).

---

## 3. Décisions structurantes et raisons

- **Un seul fichier `.html` conservé** comme cœur de l'appli (pas de framework, pas de build) — pour rester simple à maintenir et modifiable directement dans un éditeur de texte.
- **Hébergement : GitHub Pages**, plutôt que rester en local (`file://`). Raison double : le scan caméra exige un contexte sécurisé (https), et un Service Worker basé sur une Blob URL (essayé d'abord en local) est rejeté par le navigateur — il fallait un vrai fichier servi en http(s).
- **Synchro : Firebase Firestore**, choisi parmi 3 options proposées (Firebase / Supabase / Export-Import manuel uniquement). Firestore offre du temps réel "prêt à l'emploi" et un niveau gratuit largement suffisant pour un usage familial.
- **Un document Firestore par produit** (plutôt qu'un seul document contenant tout l'inventaire) — pour que deux personnes puissent modifier deux produits différents en même temps sans qu'une écriture n'écrase l'autre. Seule limite acceptée : si deux personnes modifient *le même* produit à la même seconde, la dernière écriture gagne.
- **Règles Firestore avec authentification anonyme** (`allow read, write: if request.auth != null`). Au départ ouvertes (`if true`) pour aller au plus simple, elles ont été durcies dans la session « 6 fonctionnalités » : l'auth anonyme protège l'inventaire d'un inconnu qui devinerait l'URL de la base, sans imposer de login aux utilisateurs.
- **Repli automatique en "Mode local"** : si la config Firebase n'est pas encore renseignée, l'appli continue de fonctionner avec `localStorage` (comme avant), pour ne jamais être bloquante pendant la mise en place.
- **Migration douce des données existantes** : les anciens produits stockés en `localStorage` reçoivent automatiquement des valeurs par défaut pour les nouveaux champs (`frequency`, `barcode`, etc.) sans rien casser.

---

## 4. Fichiers livrés

Dossier de travail / dépôt Git : **`D:\inventaire-app\`** (poussé sur
`github.com/Sooap95/inventaire-app`). ⚠️ L'ancienne copie `C:\Users\konig\Downloads\inventaire-app\`
est **obsolète** — ne plus l'éditer.

- `index.html` — l'application complète.
- `manifest.json` — métadonnées d'installation PWA.
- `sw.js` — Service Worker (cache hors-ligne).
- `README.md` — guide de déploiement pas à pas (GitHub Pages + Firebase).
- `JOURNAL-PROJET.md` — ce document.

Déploiement effectué : dépôt GitHub créé, Pages activé, projet Firebase + base Firestore
créés, auth anonyme activée, config collée dans `index.html`, règles publiées.
**Statut : déployé et opérationnel à 3, Open Food Facts compris (confirmé sur téléphone le 16 juin 2026).**

---

## 5. Idées d'amélioration pour plus tard

> ✅ Déjà livrées : authentification anonyme, identité « qui a fait quoi »
> (`lastEditedBy`), suggestions « à anticiper », stats de consommation, recherche vocale,
> bilingue FR/DE (§ 2bis), et déploiement + correctif OFF mobile (§ 2ter).

### Décisions prises sur les idées précédentes (avis utilisateur, 16 juin 2026)

- ❌ **Notifications** — *écartée.* L'utilisateur ne veut pas de notifications.
- ❌ **Gestion multi-foyers / multi-listes** — *écartée.* Une seule résidence, inutile.
- 🟢 **Photo produit (Open Food Facts)** — *retenue (bonne idée).* OFF renvoie déjà une vignette (`image_front_small_url`) ; l'afficher sur la carte produit serait peu coûteux. **Prochaine candidate prioritaire.**
- 🟡 **Sauvegarde automatique périodique** — *à considérer (« pourquoi pas »).* Export JSON automatique (ex. hebdomadaire) en complément de Firestore.
- ⏸️ **Bouton « associer plusieurs codes-barres »** — *en attente.* Indécis pour le moment ; à rediscuter si le besoin se présente (produits multi-formats/marques).
- ⏸️ **Stats avancées** — *reportée (« à voir plus tard »).* Tendance de consommation, alerte « tu rachètes ce produit plus souvent qu'avant ».

### 5 nouvelles idées potentielles

1. **Date de péremption + alerte « à consommer bientôt »** : champ optionnel `expiryDate` par produit (ou par lot), avec un badge « ⏳ Périme bientôt » et un tri dédié. Utile surtout pour le frais (crèmerie, viande). Complète bien la logique de stock existante.
2. **Quantité achetée modifiable au passage en caisse** : en mode « Faire les courses », pouvoir dire « j'en ai pris 2 » au lieu de toujours remettre au niveau cible. Rendrait le `restockHistory` (et donc les stats) plus fidèle à la réalité.
3. **Saisie de la quantité par la voix** : étendre la recherche vocale déjà en place pour dicter aussi une action complète (« ajoute 3 paquets de pâtes »), pratique les mains prises en cuisine/magasin.
4. **Regroupement « repas / recettes »** : définir des ensembles de produits (ex. « tacos », « petit-déj ») qu'on peut ajouter d'un coup à la liste de courses. Accélère la préparation des courses récurrentes.
5. **Mini tableau de bord d'accueil** : en haut de l'onglet Inventaire, un résumé « cette semaine » (nb d'articles achetés, par qui, montant estimé si on ajoute un prix indicatif) — une vue d'ensemble rapide sans aller dans l'onglet Stats.
