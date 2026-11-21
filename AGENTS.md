# Inventaire Maison — instructions pour les agents

La branche `main` publiée sur GitHub Pages est une distribution. Les sources maintenables sont dans cette branche de travail. Ne jamais publier, fusionner ou écrire dans Firestore de production sans un accord explicite.

## Architecture

- `index.html`, `sw.js`, `src/production/app.bundle.js` : coquille installée sur le téléphone.
- `src/family/` : journal local, file d’intentions, interface familiale.
- `src/shopping/checkout.js` : préparation V0.3 d’un lot d’achats. Aucun accès réseau.
- `src/shopping/domain.js` : liste, unités et contributions.
- `security/src/family-writer-core.mjs` : transaction réelle `purchase` et `purchaseFree`. Ne pas la modifier pour changer le stock sans tests d’émulateur et accord.
- `security/firestore.rules` : règles de sécurité. Ne pas les déployer depuis ici.
- `src/production/scan-session.js`, `scan-catalog.js`, `product-sources.js` : correctif scanner du 19 novembre 2026, postérieur à l’archive V0.2. Ne pas les remplacer par l’archive.

Le téléphone exécute le bundle, pas `src/family/ui.js` directement. Après un changement d’interface familiale, reconstruire le bundle puis recalculer `sw.js`.

## Commandes

```bash
npm run test:v03
node security/scripts/build-production-bundle.mjs
```

Le build exige `esbuild` et le SDK Firebase dont le WebChannel a l’empreinte `ffb869dc24afd692dee8736f9052850cce4ff28ec65ab4de89a001a57a2d4655`. Installer ces dépendances dans `security/` sans les commiter. `node_modules/` est ignoré.

Puis copier `dist/production/src/production/app.bundle.js` vers `src/production/app.bundle.js`, mettre à jour `bundle-inputs.json`, et régénérer les empreintes de `sw.js` avec le script de publication documenté. Ne pas relancer `scripts/build_production.py` tel quel : il réécrit `index.html` et retire les scripts scanner ajoutés après l’archive.

## Tests obligatoires avant une publication

- `npm run test:v03` doit passer.
- Vérifier un achat partiel, un achat ponctuel, une seconde confirmation et un conflit d’aperçu.
- Vérifier que les intentions déjà en conflit restent dans la file, sans abandon automatique.
- Les tests `tests/shopping-sw.test.mjs` et une assertion de `tests/stock.test.mjs` décrivent l’ancien worker de laboratoire, pas le worker hashé de GitHub Pages. Ne pas « corriger » le worker de production pour les faire passer.
- `tests/scan-catalog.test.mjs` ne charge pas les exports attendus sous Node 22. Le scanner publié n’a pas été modifié par V0.3 ; ne pas le réécrire seulement pour ce test.

## Sécurité

- Aucune clé privée, compte de service, sauvegarde familiale ou donnée personnelle dans Git.
- `config/production/binding.json` contient uniquement la configuration web déjà visible dans l’application publiée.
- Ne pas effacer, rejouer ou migrer les intentions bloquées d’un appareil.
- Ne pas changer le schéma Firestore ni déployer `firestore.rules` sans validation explicite.
- Une commande d’achat doit rester idempotente par `operationId`.

## Publication et retour

La validation humaine précède toute mise à jour de `main`. Voir `docs/V03-PUBLICATION.md` et `docs/V03-RETOUR-ARRIERE.md`.
