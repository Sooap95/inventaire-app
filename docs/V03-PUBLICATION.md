# V0.3 — compilation et publication

Cette branche prépare la publication. Elle ne la fait pas.

## Ce qui est déjà fait

- Sources V0.2 restaurées depuis l’archive `b49d365`, sans remplacer le scanner de `c0a5987`.
- Un seul onglet Courses : la bascule Liste / Faire les courses est retirée de la coquille.
- Bouton « Finaliser les courses », page « Vérifier mes achats », confirmation unique.
- Le lot devient des commandes `purchase` et `purchaseFree` déjà comprises par le journal et les règles actuelles.
- Les articles non cochés restent. Un ponctuel coché quitte la liste sans entrer dans l’inventaire.
- Un achat partiel augmente le stock de la quantité achetée et laisse le reste sur la ligne.
- La même opération n’est pas comptée deux fois.
- Un aperçu périmé est refusé, sans écraser le stock et sans annuler les autres intentions.
- Le worker change de nom de cache lorsque les empreintes changent. Il ne force pas la fermeture des onglets déjà ouverts.

## Ce qui n’a pas été fait

- Aucune fusion dans `main`.
- Aucune écriture Firestore de production.
- Aucune modification des règles Firestore.
- Aucun abandon des quatre intentions bloquées.
- Aucun dépôt privé séparé : il faut un accord sur son nom et sa visibilité. En attendant, les sources sont sur cette branche publique, sans données familiales.

## Compiler

```bash
npm install --prefix security esbuild@0.28.2 firebase@13.2.0
node security/scripts/build-production-bundle.mjs
cp dist/production/src/production/app.bundle.js src/production/app.bundle.js
cp dist/production/bundle-inputs.json bundle-inputs.json
```

Recalculer ensuite les empreintes de `sw.js` pour chaque fichier listé dans `ASSETS`. Le nom de cache doit changer, sinon le téléphone garde l’ancienne coquille.

## Publier, seulement après relecture

1. Lire la Pull Request et les différences avec `c0a5987`.
2. Vérifier `release.json` : `publishable` doit rester faux tant que la relecture n’est pas faite.
3. Fusionner la Pull Request dans `main`. GitHub Pages sert `main`.
4. Sur l’iPhone : ouvrir Safari, pas l’icône, à l’adresse `https://sooap95.github.io/inventaire-app/`.
5. Fermer tous les onglets Inventaire, puis rouvrir.
6. Si l’ancienne bascule Liste / Faire les courses est encore là : supprimer l’icône de l’écran d’accueil, effacer les données du site `sooap95.github.io` dans Réglages Safari, rouvrir l’adresse, puis la remettre sur l’écran d’accueil.

L’écran attendu affiche « Liste de courses », le texte « Une seule liste… » et le bouton « Finaliser les courses ».
