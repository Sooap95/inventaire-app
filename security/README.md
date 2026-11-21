# Laboratoire Firestore et Auth — émulateurs uniquement

**Phase 5 :** le modèle actuel accepte exclusivement les appareils anonymes
explicitement autorisés. Les anciennes consignes de comptes récupérables et
l'absence d'Auth Emulator ci-dessous décrivent la phase 3/4 historique ; elles
sont remplacées par le [rapport actuel](../docs/PHASE-5-APPAREILS.md) et la
[procédure appareils](../docs/PHASE-5-AUTORISATION-APPAREILS.md).

Le laboratoire familial de phase 4 réutilise les contrats et transactions de ce
dossier dans son bundle d'émulation. Le client publié n'est pas raccordé.
Ce dossier ne lit aucune configuration Firebase de `index.html` et ne fournit
aucune commande de déploiement. Voir le [rapport de phase 4](../docs/PHASE-4-INTEGRATION-FAMILIALE.md).

Depuis la racine du dépôt, Node 24, Java 21 et Python 3 :

```sh
npm --prefix security ci --ignore-scripts --no-audit --no-fund
npm --prefix security run prepare:emulator
npm run test:security
```

Dans l'environnement cloud, si le cache npm par défaut n'est pas accessible,
ajouter `--cache /workspace/.cache/inventaire-phase3-npm` à la commande `ci`.
Sous Windows, si `python3` n'existe pas :
`py -3 security/scripts/prepare_emulator.py`.

La préparation télécharge volontairement le JAR officiel public et vérifie sa
taille/SHA-256 contre les métadonnées de `firebase-tools` verrouillé. Ni le JAR,
ni les dépendances ne sont versionnés. Le lancement des tests n'effectue aucun
téléchargement automatique, login ou découverte de projet.

Le lanceur démarre directement Java sur `127.0.0.1:8180`, projet fictif
`demo-inventaire-v02`, charge `firestore.rules`, exécute les tests puis arrête
l'émulateur. Un port occupé est refusé ; aucun service existant n'est réutilisé.
Une variable de projet non démo, un hôte inattendu ou des variables de credentials
sont refusés. Une garde limite les clients Node aux connexions loopback.

`firebase.emulator.json` est une configuration locale alternative, pas un
`firebase.json` de production. Le CLI Firebase n'est pas exécuté par la recette.
L'Auth Emulator est lancé depuis la phase 5 sur 127.0.0.1:9099. Les tests de règles
utilisent des contextes synthétiques et les nouvelles recettes utilisent aussi
le vrai SDK Auth contre cet émulateur. Seuls des comptes fictifs y sont créés,
sans activation d'un fournisseur de production.

Les résultats bruts fictifs restent dans `.cache/` (ignoré par Git). Les preuves
retenues sont dans `docs/phase3-results/`. Voir le
[rapport](../docs/PHASE-3-SECURITE.md), le [contrat](SCHEMA.md) et la
[transition proposée](../docs/PHASE-3-TRANSITION-COMPTES.md).

## Phase 4 : recette intégrée

```sh
npm run test:family-security
npm run test:family-browser
npm run lab:family
```

Les deux premières commandes arrêtent l'émulateur après les vérifications ;
la dernière démarre un nouvel émulateur, les fixtures, le bundle et le serveur
loopback jusqu'à `Ctrl+C`. Un seul lanceur à la fois. Les sélecteurs de compte
injectent des tokens synthétiques ; aucun Auth Emulator/fournisseur réel n'est activé.

`build-family-bundle.mjs` désactive uniquement la sonde de connectivité externe
WebChannel, sans modifier le traitement des erreurs et retries Firestore. Source verrouillée
par version, SHA-256 et remplacement unique ; les fichiers installés du SDK ne
sont pas modifiés. Une mise à jour amont exige revue et test de coupure réseau.
Les notices Apache-2.0 du SDK/Closure sont conservées dans le bundle.

`seed-family.mjs` ne peut cibler que le projet de démonstration sur 127.0.0.1:8180.
Ses actions `backup`, `restore`, `clear-for-restore`, `check-restore`, `revoke` et
`activate` concernent exclusivement les fixtures. Ce n'est pas un outil de
sauvegarde ou d'administration de production. Ne pas enlever ses gardes.
L'export complet exige des fixtures sans écritures pendant son exécution.


## Recette phase 5

```sh
npm run test:phase5-security
npm run test:device-browser
npm run test:device-lab-smoke
```

Le lanceur démarre maintenant aussi l'implémentation officielle Auth Emulator
embarquée dans firebase-tools 15.35.0 sur 127.0.0.1:9099, sans exécuter le CLI ni
ses fonctions de télémétrie. Les comptes créés par le SDK sont uniquement fictifs.
Les gardes Node refusent toute connexion non loopback. Pas de nouveaux paquets.
La préparation du JAR et les prérequis restent ceux indiqués plus haut.

Le mode `--lab` ne préautorise plus de membres. Le propriétaire doit employer
`device-admin.mjs` avec un UID copié et un plan vérifié ; les commandes sont dans
la procédure, avec les variables d'émulateur requises pour un second terminal.
La révocation se fait dans `members` ; le client ne peut pas la modifier.

`recovery.mjs` fournit les sauvegardes v2 typées, vérification, plans de restauration,
migration, retour arrière et audit des intentions d'un autre UID. Les exemples et
limites sont dans la [procédure données](../docs/PHASE-5-MIGRATION-RESTAURATION.md).
Les actions historiques `seed-family.mjs revoke/activate` ont été retirées : aucun
raccourci de préautorisation ne remplace la procédure du propriétaire.
