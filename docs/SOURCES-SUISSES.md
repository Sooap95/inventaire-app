# Sources produit — décision du 19 novembre 2026

L’application reste une PWA statique sur GitHub Pages, sans proxy et sans abonnement.

## Conservé

Le catalogue familial local (`localStorage`, clé `inventaire-family-catalog-v1`) est consulté en premier. Une fiche confirmée par la famille n’est pas réécrite par une réponse externe. Il ne remplace pas Firestore : le stock actif reste la liste synchronisée. Un produit archivé ne peut pas être réactivé, les règles Firestore interdisent la mise à jour d’un document `deleted`. Le scan rouvre alors la fiche mémorisée et Enregistrer crée un nouveau document, ce qui est le seul chemin autorisé.

Open Food Facts reste la source alimentaire. Si la réponse indique un autre type de produit, ou si le code est inconnu, l’application interroge ensuite Open Beauty Facts, Open Products Facts et Open Pet Food Facts. Ces quatre API répondent avec `Access-Control-Allow-Origin: *`. Les photos affichées viennent uniquement des hôtes `images.` et `static.` de ces projets, en HTTPS. L’attribution reste visible à côté de la photo et dans le crédit déjà présent. Aucune image n’est copiée dans Firestore : le schéma `details` n’accepte que `category`, `aisle`, `notes` et `barcode`. Une photo prise par le téléphone n’est pas activée, car la stocker demanderait Firebase Storage ou un champ refusé par les règles.

## Écarté

**Coop.** `GET https://www.coop.ch/rest/v2/coopathome/products/search/{ean}` répond en JSON depuis un client hors navigateur, sans contrat d’API publique. La même requête avec l’en-tête `Origin: https://sooap95.github.io` reçoit `403` et le corps `Invalid CORS request`, sans `Access-Control-Allow-Origin`. La PWA ne peut pas lire cette réponse. Il n’y a pas d’ajout de proxy, ni de contournement. Les photos du site ne sont pas réutilisées.

**Migros.** Les recherches publiques testées (`product-display` et `onesearch-oc-seaapi`) répondent `403` par une page de protection, sans en-tête CORS. Il n’existe pas d’API officielle ouverte. Les outils qui lisent Migros le font depuis un serveur, avec un jeton invité non prévu pour un site tiers. Cette voie n’est pas intégrée.

**Yuka et MyFitnessPal.** Yuka utilise sa propre base depuis 2018, sans licence de réutilisation. L’API partenaire de MyFitnessPal est fermée aux nouvelles applications et ne donne pas le catalogue produit. Aucune des deux n’est une source branchable.

Les échecs de recherche externe laissent la saisie manuelle disponible, y compris hors ligne pour le stock et le catalogue déjà présents sur l’appareil.
