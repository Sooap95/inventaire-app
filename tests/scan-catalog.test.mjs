import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const Scan = require('../src/production/scan-catalog.js');
const Sources = require('../src/production/product-sources.js');

function memory() {
  const data = new Map();
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value))
  };
}

test('les boutons + et - changent la quantité affichée d’une unité, sans devenir négative', () => {
  assert.equal(Scan.stepQty('3', 1), '4');
  assert.equal(Scan.stepQty('3', -1), '2');
  assert.equal(Scan.stepQty('0', -1), '0');
  assert.equal(Scan.stepQty('1.5', 1), '2.5');
});

test('la saisie directe remplace le stock affiché et refuse une valeur invalide', () => {
  assert.equal(Scan.parseQty('12'), '12');
  assert.equal(Scan.parseQty('1,25'), '1.25');
  assert.equal(Scan.parseQty('-1'), null);
  assert.equal(Scan.parseQty('abc'), null);
  assert.equal(Scan.parseQty('1.1234567'), null);
});

test('un produit actif ouvre le réglage, un produit mémorisé est réintroduit, un inconnu est créé', () => {
  const active = [{ id: 'p1', name: 'Lait', barcode: '3017620422003' }];
  assert.equal(Scan.decide(active, null, '3017620422003').type, 'adjust');
  const known = { manual: true, name: 'Beurre', barcode: '7610000000004', active: false };
  assert.equal(Scan.decide([], known, '7610000000004').type, 'reintroduce');
  assert.equal(Scan.decide([], null, '7611111111115').type, 'create');
});

test('le même code encore devant la caméra ne rouvre pas la fenêtre', () => {
  assert.equal(Scan.noteFrame('3017620422003', { hold: '3017620422003', misses: 0 }).action, 'ignore');
  assert.equal(Scan.noteFrame('', { hold: '3017620422003', misses: 0 }).action, 'wait');
  assert.equal(Scan.noteFrame('', { hold: '3017620422003', misses: 7 }).action, 'clear');
  assert.equal(Scan.noteFrame('4000000000006', { hold: '3017620422003', misses: 2 }).action, 'open');
  assert.equal(Scan.noteFrame('123456789012', { hold: '0123456789012', misses: 0 }).action, 'ignore');
});

test('une correction familiale n’est pas écrasée par une source externe', () => {
  const merged = Scan.mergeExternal(
    { manual: true, name: 'Nom corrigé', brand: 'Marque maison', category: 'Alimentation', image: '' },
    { name: 'Nom OFF', brand: 'Autre', category: 'Hygiène', image: 'https://images.openfoodfacts.org/a.jpg', source: 'Open Food Facts' }
  );
  assert.equal(merged.name, 'Nom corrigé');
  assert.equal(merged.brand, 'Marque maison');
  assert.equal(merged.category, 'Alimentation');
  assert.equal(merged.image, 'https://images.openfoodfacts.org/a.jpg');
  assert.equal(merged.source, 'famille');
});

test('le catalogue retrouve un produit qui n’est plus dans le stock actif', () => {
  const storage = memory();
  Scan.rememberActive(storage, [{ id: 'p1', name: 'Farine', barcode: '3017620422003', category: 'Alimentation', unit: 'pcs', aisle: '', notes: '' }]);
  Scan.rememberActive(storage, []);
  const found = Scan.lookup(storage, '3017620422003');
  assert.equal(found.name, 'Farine');
  assert.equal(found.active, false);
  assert.equal(found.manual, true);
});

test('la photo Open Food Facts est retenue seulement si son hôte est autorisé', () => {
  const product = {
    product_name_fr: 'Nutella',
    brands: 'Ferrero',
    categories_tags: ['en:spreads'],
    selected_images: { front: { small: { fr: 'https://images.openfoodfacts.org/images/products/front.200.jpg' } } },
    image_front_url: 'https://evil.example/front.jpg'
  };
  const item = Sources.named(product, 'Open Food Facts', 'fr');
  assert.equal(item.name, 'Nutella');
  assert.equal(item.image, 'https://images.openfoodfacts.org/images/products/front.200.jpg');
  assert.equal(Sources.allowedImage('https://evil.example/front.jpg'), false);
  assert.equal(Sources.imagesFrom({ image_front_url: 'http://images.openfoodfacts.org/a.jpg' }).full, '');
});

test('un code alimentaire absent est orienté vers la base indiquée par Open Food Facts', () => {
  assert.equal(Sources.kindFromVerbose('product found with a different product type: beauty'), 'beauty');
  assert.equal(Sources.kindFromVerbose('product found with a different product type: pet food'), 'pet');
  assert.equal(Sources.kindFromVerbose('product found with a different product type: product'), 'product');
  assert.equal(Sources.kindFromVerbose('product not found'), '');
});

test('une photo externe complète le catalogue sans devenir une fiche ni écraser une image', () => {
  const storage = memory();
  Scan.rememberImage(storage, '3017620422003', 'https://images.openfoodfacts.org/a.jpg', 'Open Food Facts');
  const imageOnly = Scan.lookup(storage, '3017620422003');
  assert.equal(imageOnly.image, 'https://images.openfoodfacts.org/a.jpg');
  assert.equal(imageOnly.manual, false);
  assert.equal(Scan.decide([], imageOnly, '3017620422003').type, 'create');
  Scan.rememberImage(storage, '3017620422003', 'https://images.openfoodfacts.org/b.jpg', 'Open Food Facts');
  assert.equal(Scan.lookup(storage, '3017620422003').image, 'https://images.openfoodfacts.org/a.jpg');
  Scan.rememberConfirmed(storage, { barcode: '3017620422003', name: 'Nom maison', image: '' });
  const confirmed = Scan.lookup(storage, '3017620422003');
  assert.equal(confirmed.name, 'Nom maison');
  assert.equal(confirmed.image, 'https://images.openfoodfacts.org/a.jpg');
  assert.equal(confirmed.manual, true);
  assert.equal(Scan.decide([], confirmed, '3017620422003').type, 'reintroduce');
});

test('une quantité inchangée ne demande pas d’écriture', () => {
  assert.equal(Scan.sameQty('3', 3), true);
  assert.equal(Scan.sameQty('3.0', '3'), true);
  assert.equal(Scan.sameQty('3', '4'), false);
});
