# Utiliser Inventaire Maison V0.2

Ouvrir **https://sooap95.github.io/inventaire-app/**. Conserver les données du navigateur ; elles portent l’identité anonyme du profil et ses intentions en attente. Pour installer : Safari iPhone → Partager → Sur l’écran d’accueil ; Chrome Android → Installer l’application lorsque proposé.

## Première autorisation

Le profil s’identifie automatiquement. S’il attend l’autorisation, copier son identifiant avec le bouton prévu. Il s’agit d’un profil navigateur, pas d’un identifiant matériel permanent.

Dans sa session Cloud Shell habituelle, le propriétaire utilise le fichier de finalisation déjà remis :

```bash
python3 finaliser_inventaire_v02.py --autoriser IDENTIFIANT_COPIE
```

Le fichier vérifie le projet familial, l’existence d’un utilisateur anonyme non désactivé et la limite de trois profils actifs. Il ne crée pas de compte Auth. Pour révoquer : même commande avec `--revoquer`. Autoriser séparément un autre profil Safari, Chrome ou PWA si une identité différente est présentée. Après suppression des données du navigateur, la nouvelle identité doit être autorisée à nouveau ; les données familiales restent dans Firestore.

## Stock, scanner et courses

- **Stock** : les boutons +/− sont immédiats ; l’interface distingue les gestes en attente des écritures confirmées. Aucun stock négatif. En conflit, revoir explicitement l’intention ; ne pas recréer plusieurs fois la même opération.
- **Scanner** : autoriser la caméra, choisir si nécessaire la caméra arrière mémorisée, garder le code entier visible. Le code apparaît immédiatement ; la correspondance locale est prioritaire. Open Food Facts propose le nom, la marque, la catégorie et le rayon des produits inconnus. La saisie manuelle reste disponible ; seul Enregistrer crée ou modifie le produit. Arrêter libère la caméra. Aucun OCR manuscrit n’est activé.
- **Courses** : Ajouter des articles accepte plusieurs lignes saisies ou collées. Corriger l’aperçu, les quantités, les unités et les associations, puis confirmer. Un article libre ne crée pas un produit en stock. Les besoins calculés et contributions restent distincts ; un doublon demande un choix explicite (conserver, fixer le total, ajouter en supplément). Aucune addition automatique.
- Une **coche** ne modifie jamais le stock. **Enregistrer un achat** utilise la quantité réellement achetée. L’annulation est compensatrice et conserve son journal.
- Copier et imprimer utilisent la liste complète et ses quantités finales. Les besoins à revérifier sont signalés.
- **Plus** donne accès aux paramètres, QR, statistiques et sauvegardes. La recherche vocale suit la langue et les capacités du navigateur. Elle ne valide pas un achat.

## Hors ligne, sauvegarde et mise à jour

Après une première ouverture complète en ligne et une autorisation, l’application et le scanner local restent disponibles hors ligne. Les intentions durables attendent la reconnexion ; les conflits et accès révoqués restent explicites. Les recherches Open Food Facts nécessitent le réseau et peuvent être indisponibles ; saisir manuellement dans ce cas.

La sauvegarde depuis l’application exporte l’état local du profil, dont ses intentions et ses instantanés. La restauration contrôlée réimporte les intentions pour réexamen et ne réécrit pas silencieusement les stocks familiaux. La sauvegarde administrative complète et les avant/après de conversion sont privés chez le propriétaire. Ne pas réimporter un ancien inventaire JSON par-dessus le nouveau modèle.

Pour activer une mise à jour, fermer tous les onglets et fenêtres Inventaire puis rouvrir le lien. Le service worker ne force pas le remplacement d’un onglet en cours. Ne pas effacer Auth ou IndexedDB pour actualiser l’application.

## Coût et retour arrière

GitHub Pages et Firebase Spark, sans facturation liée, sans service payant ni analyse d’audience. Les photos de caméra sont décodées sur l’appareil. OFF reçoit seulement le code ou la recherche de produit demandée, sans photo ni cookies.

Le modèle V0.2 utilise `products`, `shoppingLines`, `operations`, `members`. Les anciens clients à écritures plates sont incompatibles. Après de nouveaux achats, privilégier une correction V0.2 : un retour de code vers l’ancienne application ne restaure pas les données. Toute restauration complète demande une sauvegarde actualisée, une comparaison des avant/après et une réconciliation des opérations et intentions ; aucun écrasement aveugle ni réouverture des règles.
