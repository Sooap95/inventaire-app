import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/ui/art-deco.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const mobileBuilder = readFileSync(new URL('../scripts/build_mobile_ui.py', import.meta.url), 'utf8');

test('art déco : exactement quatre onglets en bas, Stock, Courses, Scanner et Plus', () => {
  const navigation = html.match(/<nav class="tabs bottom-tabs"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(navigation, 'la barre de navigation est absente');
  assert.deepEqual([...navigation.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]), ['inventory', 'shopping', 'qr', 'more']);
  for (const key of ['tab-inventory', 'tab-shopping', 'tab-qr', 'tab-stats', 'tab-more']) {
    assert.equal([...html.matchAll(new RegExp(`id="${key}"`, 'g'))].length, 1, `vue absente ou dupliquée : ${key}`);
  }
  assert.match(html, /onclick="switchTab\('stats'\)"/);
  assert.match(html, /onclick="switchTab\('more'\)"/);
  assert.match(html, /const TAB_LIST = \['inventory',\s*'shopping',\s*'qr',\s*'stats',\s*'more'\]/);
});

test('art déco : les actions métier existantes sont toujours accessibles', () => {
  for (const action of ['openAddModal()', 'openScanner()', 'openSettings()', 'exportData()', 'triggerImport()']) {
    assert.ok(html.includes(`onclick="${action}"`), `action perdue : ${action}`);
  }
  for (const action of ['stock', 'edit', 'delete']) {
    assert.ok(html.includes(`data-product-action="${action}"`), `action produit perdue : ${action}`);
  }
  assert.match(html, /<details class="product-card-details"><summary>/);
  assert.match(html, /id="search-input"/);
  assert.match(html, /id="shopping-list-content"/);
  assert.match(html, /id="app-qr-display"/);
});

test('art déco : traductions pour les nouveaux écrans dans les deux langues', () => {
  for (const key of ['tab_more', 'home_heading', 'home_note', 'home_open_courses', 'more_stats', 'product_details', 'product_edit', 'product_delete']) {
    const matches = [...html.matchAll(new RegExp(`\\b${key}:`, 'g'))];
    assert.ok(matches.length >= 2, `traduction FR/DE manquante : ${key}`);
  }
});

test('art déco : confort tactile, contraste de focus et mouvement réduit', () => {
  assert.match(css, /\.stock-btn\s*\{[^}]*width:44px;[^}]*height:44px;/);
  assert.match(css, /\.bottom-tabs \.tab\s*\{[^}]*min-height:62px;/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  for (const color of ['#174c3b', '#aa2f60', '#fff8ee', '#b8904a']) assert.ok(css.toLowerCase().includes(color));
});

test('art déco : feuille précachée, également livrée dans le paquet fictif', () => {
  assert.match(html, /href="src\/ui\/art-deco\.css"/);
  assert.match(sw, /'\.\/src\/ui\/art-deco\.css'/);
  assert.match(mobileBuilder, /'src\/ui\/art-deco\.css'/);
  assert.match(mobileBuilder, /subprocess\.run\(\['node',[^\n]*build-mobile-bundle\.mjs/);
  assert.doesNotMatch(mobileBuilder, /reuse.phase6.bundle/); // Toujours recompiler, aucune réutilisation du bundle ancien.
});

test('art déco : JavaScript historique syntaxiquement valide et IDs uniques', () => {
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline, 'script historique introuvable');
  assert.doesNotThrow(() => new vm.Script(inline, {filename:'index.html'}));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs HTML statiques dupliqués');
});
