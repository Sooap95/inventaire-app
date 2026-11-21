# Contrat proposé — quatre collections, un seul foyer

**Phase 5 actuelle :** Auth anonyme + liste d'appareils fermée, en émulation
uniquement. Voir le [rapport](../docs/PHASE-5-APPAREILS.md). Le choix de comptes
récupérables des phases 3–4 est remplacé, sans opération de production.

**Phase 4 :** contrat utilisé par le laboratoire familial local uniquement ;
voir les extensions ci-dessous et le [rapport](../docs/PHASE-4-INTEGRATION-FAMILIALE.md).

Contrat de laboratoire, non appliqué en production. Le client PWA historique
n'utilise pas ces documents et n'est pas compatible avec ces règles en écriture.

## Autorisation commune

Jeton avec `firebase.sign_in_provider == "anonymous"` et
`members/{request.auth.uid}` contenant `schemaVersion:2`, `uid` identique,
`role:"device"`, `authType:"anonymous"`, `status:"active"`. Sans cette fiche,
refus des données métier des trois autres collections, y compris pour un autre
fournisseur connu. Aucune fiche de membre v1 n'est autorisée implicitement.

Une identité anonyme peut lire son propre document de statut (même absent ou
révoqué), jamais celui d'un autre UID ni la liste. Aucune écriture de `members`
depuis un client, même autorisé. L'administration ajoute éventuellement `label`,
`revision`, `updatedAt`, `lastAdminOperationId`. Aucun rôle administratif côté PWA.
`recoverable` n'est plus un critère et aucune récupération par mot de passe n'est
promise. L'UID désigne une session persistante de navigateur, pas une attestation
matérielle du téléphone.

## products/{ID historique}

| Champs | Contrat |
| --- | --- |
| `schemaVersion`, `id` | 2, identique à l'ID du document ; ID conservé |
| `revision` | Entier, 1 à la création, puis +1 |
| `name`, `unit` | Chaînes non vides, 180/64 caractères maximum |
| `stockMicros`, `thresholdMicros`, `targetMicros` | Entiers 0 à 10¹² ; 10⁶ représente une unité |
| `frequency` | Vide ou valeurs historiques quotidien/hebdomadaire/mensuel/trimestriel |
| `lastRestocked` | Timestamp ou null |
| `deleted` | Archivage logique ; pas de suppression physique cliente ni de réactivation cliente |
| `legacy` | Snapshot des anciens champs, inchangé par les clients ; vide pour les nouveaux produits clients |
| `createdBy`, `authorUid` | Créateur conservé ; dernier auteur = UID de la requête |
| `updatedAt`, `lastOperationId` | Heure serveur et événement créé dans le même commit |

Les unités existantes sont verrouillées côté client dans ce contrat. Une
correction d'unité nécessite une procédure administrative revue, sans conversion
silencieuse des stocks. Les champs historiques inconnus et l'ancien historique
restent dans `legacy`. Ce snapshot n'est pas une seconde source de stock courant.
Le futur client doit adapter tous ses parcours, notamment import, suppression et
historique d'achats ; cet adaptateur complet n'est pas implémenté ici.

Les micros évitent de valider une addition décimale approximative dans les règles.
Le plan sec refuse une précision historique supérieure à six décimales au lieu
d'arrondir. Le calcul stock historique n'est pas changé : l'adaptateur de preuve
projette les micros vers les nombres historiques. La comparaison flottante
`threshold * 1.5` est conservée aussi dans les règles, y compris sa limite IEEE-754
à 0,6/0,9. Le besoin en micros est la différence exacte, lorsqu'il est présent.
Les suggestions gardent la fenêtre historique strictement inférieure à sept jours.

## shoppingLines/{groupe}

Un document regroupe les contributions d'une identité. Groupe associé :
`product_` + ID produit, donc un groupe par produit. Groupe libre : `free_` + ID
stable. Ce sont des identifiants de groupes nouveaux ; les IDs produits et les
IDs des contributions locales restent conservés dans le plan de migration.

| Champs | Contrat |
| --- | --- |
| `schemaVersion`, `id`, `revision` | 1 ; chemin identique ; révision de groupe incrémentée |
| `productId`, `name`, `unit` | Produit associé ou null ; nom de secours et unité du groupe |
| `contributions` | Map d'au plus 100 contributions, indexées par ID stable |
| Contribution | `id`, `revision`, `quantityMicros` positive, `status` active/ignored/removed, `createdBy`, `authorUid` |
| `checks`, `checkAll` | Exceptions booléennes par ID et valeur par défaut des coches manuelles |
| `automaticChecked` | Coche automatique séparée ; invalidée au réexamen d'un nouveau contexte |
| `automaticMicros`, `productRevision` | Besoin automatique et révision produit approuvés |
| `totalMicros` | Total confirmé, entier de 0 à 10¹² ; jamais une somme implicite des contributions |
| `needsReview` | Réexamen imposé notamment après retrait |
| `authorUid`, `updatedAt`, `lastOperationId` | UID réel, heure serveur, opération jointe |

Une modification métier touche un seul ID de contribution ; la différence de
map ne peut contenir d'autres IDs. Le créateur et les autres contributions sont
conservés. Une nouvelle contribution ignore la valeur de coche globale en recevant
sa propre exception `false`. Une coche principale explicite change `checkAll`,
vide les exceptions et coche/décoche la partie automatique ; les événements
précédents gardent les anciennes valeurs. Aucune coche ne change les quantités.

Actions autorisées :

- `add` : choix explicite keep/set_total/add_extra. Avec base 2 et proposition 3,
  le total vaut 2/3/5. Keep archive la proposition comme ignored.
- `edit` : contribution versionnée, confirmation d'un total explicite obligatoire.
  Cette preuve impose set_total pour une édition, sans réaddition automatique.
- `remove` : marque removed, garde le dernier total et impose le réexamen.
- `check`, `checkAll` : ne changent ni quantité ni stock.
- `review` : nouveau choix explicite, même map métier et nouveau contexte vérifié.
  Une ancienne coche automatique n'est pas transférée à un nouveau stock.

Le futur consommateur doit calculer le réexamen effectif : drapeau enregistré,
produit absent/archivé, révision produit différente ou besoin automatique devenu
différent avec le temps. `groupNeedsReview()` le démontre. Une quantité ne peut
être réapprouvée implicitement en écrivant une nouvelle contribution.

La granularité par groupe sérialise deux modifications du même produit mais
permet deux groupes indépendants en parallèle. L'outbox et l'interface de
synchronisation ne sont pas encore intégrées à la PWA. La résolution locale d'un
produit supprimé est disponible ; son déplacement futur entre deux groupes
distants devra être une transaction multi-groupes avec tests dédiés. Cette preuve
ne prétend pas couvrir ce déplacement ni l'unicité sémantique globale des articles
libres/alias. Pas de rapprochement approximatif ou d'addition décidés par les règles.

## operations/{ID de commande}

Événement client immuable : `schemaVersion:1`, `id`, `authorUid`, `createdAt`,
`targetCollection`, `targetId`, `beforeRevision`, `afterRevision`, `action`,
`entryId` ou null, `choice`, `valueMicros`, `confirmed:true`, `requestHash`, `after`.

Chaque écriture comporte le document matérialisé et son événement dans la même
transaction. Le document exige un nouvel événement du même chemin/cible ; la
règle de création de l'événement exige à son tour `after == getAfter(cible).data`,
la révision précédente exacte et le même auteur. Un document seul, un événement
seul ou un événement réutilisé ne passent pas. Aucune mise à jour/suppression
cliente d'événement n'est autorisée, même avec un contenu identique.

`requestHash` SHA-256 sert au rejeu côté adaptateur ; les règles ne calculent pas
ce hash et il ne prouve pas une action humaine. Le serveur vérifie identité,
postimage, révisions, quantités et choix. Le booléen confirmed ne remplace pas
les confirmations de l'interface, qui restent obligatoires.

L'archive administrative de migration est une autre variante, `kind:
"migration.archive"`, contenant empreinte, numéros de fragments et payload base64.
La création cliente de cette variante est refusée. Un futur administrateur pourra
la créer par son canal privilégié après validation de la sauvegarde ; aucune
procédure d'écriture privilégiée de production n'est fournie ici. Les clients ne
peuvent ni la modifier ni la supprimer. Le plan sec conserve toutes les décisions
et versions locales, sans inventer les UID des anciens auteurs nommés localement.

## members/{UID}

`schemaVersion:1`, `uid`, `role:"family"`, `status:"active"|"revoked"`,
`recoverable:true|false`. Métadonnées minimales ; pas d'adresse, mot de passe ou
jeton dans la configuration suivie par Git. Administration hors client, par le
propriétaire du projet, après vérification du compte et de sa récupération.
Les règles ne comptent pas les membres : la procédure administrative impose
exactement trois UID distincts approuvés. Les administrateurs IAM/Admin SDK
contournent les règles ; leur accès doit donc rester sous contrôle administratif.

## Limites de cette preuve

Un commit par cible, plus un événement ; pas de migration globale, achat partiel,
outbox persistante ou consolidation automatique des alias. Les événements gardent
une postimage complète pour rendre la preuve vérifiable : deux écritures et une
croissance du journal par action, plus les lectures de contrôle. La rétention,
les volumes et les quotas gratuits devront être mesurés avant activation, sans
autoriser ici de facturation ou de purge. Les suppressions logiques et archives
conservent les données ; pas de déduction d'achat depuis une simple coche.

## Extensions phase 4 — jamais appliquées à la production

### Produits

Champs optionnels `details` (map exacte `category`, `aisle`, `notes`, `barcode`,
limites respectives 64/128/1000/64 caractères) et `lastPurchaseId` (ID de reçu ou
null). `legacy`, unité et créateur restent inchangés. Le pointeur d'achat n'est
modifié que par un achat, une compensation validée ou une correction explicite
de date qui le remet à null.

### Groupes

`fulfilledMicros` optionnel, zéro implicite pour les anciens groupes. Les achats
réduisent `totalMicros`, qui désigne le reste confirmé, et augmentent ce compteur
de la demande satisfaite. Ils conservent exactement contributions et coches
individuelles. La compensation décrémente le compteur de la demande du reçu et
applique un choix explicite au reste. Aucun transfert automatique entre unités.
L'action `init` permet une coche automatique sans créer de contribution fictive.
Elle ne crée un groupe qu'avec contexte produit actuel et total automatique exact.
Les opérations ordinaires préservent le compteur d'achats.

### Événements v2

Les champs de tête restent identiques à la v1, avec `schemaVersion:2` et `receipt`
obligatoire (null pour les actions ordinaires). `after` est un résultat compact
validé exactement par les règles contre `getAfter(cible)` :

- Produit : révision, quantités, nom/unité/fréquence/date/archivage, `details`,
  pointeur du dernier achat. Pas de copie de `legacy`.
- Groupe : révision, reste, contexte, indicateur de revue, demande satisfaite,
  seule contribution concernée, seule coche concernée et deux états globaux.
  Pas de copie des 99 autres contributions.

Actions nouvelles : `purchase`, `purchaseFree`, `undoPurchase`, `undoPurchaseFree`.
`valueMicros` est la quantité réellement achetée ou compensée, strictement positive.
Le reçu comporte exactement :

```
groupId, groupBeforeRevision, groupAfterRevision, demandMicros, compensates,
previousPurchaseId, previousLastRestocked, rollbackPurchaseId,
rollbackRestocked, choiceValueMicros
```

`demandMicros = min(quantité achetée, reste avant achat)`. Les références de groupe
obligent son écriture jointe lorsque ce groupe existe. Pour un article libre,
la cible est directement le groupe et aucun produit n'est écrit. L'événement
immuable est créé dans la même transaction ; toute partie manquante est refusée.

Compensation : ID déterministe `undo_<achat>`, même cible et quantité que le reçu
original, un seul événement compensateur par achat. Aucun effacement du reçu.
L'identité d'auteur est celle de l'utilisateur qui compense, qui peut différer
de l'acheteur. Si un groupe existe, choix `keep`, `set_total` ou `add_extra`
obligatoire ; l'ajout explicite réintroduit exactement la demande satisfaite
par le reçu, pas l'éventuel surplus acheté. Stock négatif/produit archivé refusés.

Le client remonte au maximum 12 achats pour la date. Les règles vérifient un reçu
non annulé du même produit pour une date restaurée, sans parcourir toute la chaîne.
Les corrections manuelles de stock/date restent une autorité des membres et
sont journalisées. La v1 reste acceptée pour la preuve de phase 3 ; le nouveau
laboratoire émet uniquement la v2. Aucun changement des données v1 existantes.


## Phase 5 : rejeu des compensations et administration

Un reçu `undo_<achat>` déjà existant n'est acquitté que si cible/action, quantité
physique, choix, valeur de choix et contexte de révisions attendu coïncident.
L'auteur peut différer entre deux appareils pour une même décision concurrente.
Un choix différent, un total différent ou un contexte nouvellement confirmé donne
un conflit explicite, sans deuxième compensation de stock. Le reçu gagnant demeure
immuable. Une correction ultérieure de courses utilise une décision distincte.

Les outils administratifs fictifs de migration créent aussi des événements
`migration.record`/`migration.archive`, non créables ni modifiables par le client.
Ils conservent les anciens documents/décisions sans attribuer un prénom historique
à un UID Auth inventé. Les données métier restent celles des contrats ci-dessus ;
les règles d'authentification communes sont désormais celles de phase 5.

Les plans administratifs contrôlent empreinte et état antérieur en transaction.
Leurs checksums ne sont pas des credentials ni des signatures de confiance. Le
code de gestion des membres n'est pas servi au navigateur ; tout outil exécutable
refuse une cible hors du projet démo et des émulateurs locaux.
