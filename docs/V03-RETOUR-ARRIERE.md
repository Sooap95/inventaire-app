# V0.3 — retour arrière

## Application

Le retour arrière de l’application est le commit `c0a5987ccdb1355026503d2cf75b682ac36b997a` sur `main`.

1. Ne pas supprimer le dépôt ni réécrire l’historique déjà publié.
2. Créer une branche depuis ce commit et ouvrir une Pull Request vers `main`, ou rétablir ces fichiers : `index.html`, `sw.js`, `release.json`, `bundle-inputs.json`, `src/production/app.bundle.js`, `src/production/target.js`, `src/family/family.css`.
3. Le worker de `c0a5987` a un autre nom de cache. Après publication du retour, fermer les onglets puis rouvrir Safari, comme pour une mise à jour.

Aucun des fichiers V0.3 ne doit être copié par-dessus `main` sans cette Pull Request.

## Données

V0.3 n’ajoute pas de collection ni de champ obligatoire. Les achats confirmés sont des opérations `purchase` et `purchaseFree` déjà prévues par les règles actuelles.

- Ne pas lancer de migration.
- Ne pas effacer le journal, les produits, les lignes ou les intentions.
- Un achat déjà synchronisé ne disparaît pas si l’on revient à l’ancienne application. L’annulation existante d’un reçu reste le moyen de compenser un achat.
- Les intentions bloquées, y compris `purchaseFree` et `checkAll`, ne sont ni abandonnées ni rejouées par cette version. Elles restent sur l’appareil jusqu’à une décision manuelle : réessayer ou abandonner dans le panneau familial.

## Règles Firestore

Aucun fichier `firestore.rules` n’est déployé par cette branche. Le retour arrière n’a donc pas de règle à restaurer dans la console Firebase.
