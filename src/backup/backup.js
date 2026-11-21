// Aucun accès réseau ni stockage implicite. Les champs inconnus sont conservés.
export const FORMAT = 'inventaire-maison-backup';
export const MAX_BYTES = 10 * 1024 * 1024;
const copy = value => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
async function digest(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function validateProducts(products) {
  if (!Array.isArray(products)) throw new Error('Un tableau de produits est attendu.');
  const ids = new Set();
  for (const [i, p] of products.entries()) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`Produit ${i + 1} invalide.`);
    if (typeof p.id !== 'string' || !p.id.trim()) throw new Error(`Identifiant manquant au produit ${i + 1}. Aucune génération automatique.`);
    if (ids.has(p.id)) throw new Error(`Identifiant en double au produit ${i + 1}. Aucune fusion automatique.`);
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim()) throw new Error(`Nom invalide au produit ${i + 1}.`);
    for (const key of ['stock', 'threshold', 'target']) {
      if (!Number.isFinite(p[key]) || p[key] < 0) throw new Error(`Quantité ${key} invalide au produit ${i + 1}.`);
    }
    if (p.restockHistory !== undefined && !Array.isArray(p.restockHistory)) throw new Error(`Historique invalide au produit ${i + 1}.`);
  }
  return products;
}
export async function createBackup(products, createdAt = new Date().toISOString()) {
  validateProducts(products);
  const payload = {
    format: FORMAT, formatVersion: 1, createdAt,
    scope: 'provided-products-only',
    collections: { products: copy(products) }, counts: { products: products.length }
  };
  return { ...payload, checksum: { algorithm: 'SHA-256', value: await digest(payload) } };
}
export async function parseBackup(text) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Fichier trop volumineux (maximum 10 Mio).');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSON illisible.'); }
  if (Array.isArray(data)) {
    validateProducts(data);
    return { products: copy(data), legacy: true, warnings: ['Ancien export : aucune empreinte, exhaustivité cloud inconnue.'] };
  }
  if (!data || data.format !== FORMAT || data.formatVersion !== 1) throw new Error('Format ou version de sauvegarde non pris en charge.');
  if (data.scope !== 'provided-products-only' || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('Métadonnées de sauvegarde invalides.');
  if (!data.collections || Object.keys(data.collections).join(',') !== 'products') throw new Error('Collections inattendues : refus pour éviter une restauration incomplète.');
  validateProducts(data.collections.products);
  if (data.counts?.products !== data.collections.products.length) throw new Error('Comptage incohérent.');
  const { checksum, ...payload } = data;
  if (checksum?.algorithm !== 'SHA-256' || checksum.value !== await digest(payload)) throw new Error('Empreinte invalide : fichier modifié ou incomplet.');
  return { products: copy(data.collections.products), legacy: false, warnings: ['Empreinte vérifiée ; elle ne prouve ni authenticité ni exhaustivité cloud.'] };
}
export function restorationPreview(current, incoming) {
  validateProducts(current); validateProducts(incoming);
  const byId = new Map(current.map(p => [p.id, p]));
  const result = { added: [], identical: [], conflicts: [], retained: [] };
  const incomingIds = new Set(incoming.map(p => p.id));
  for (const p of incoming) {
    const previous = byId.get(p.id);
    if (!previous) result.added.push(p.id);
    else if (canonical(previous) === canonical(p)) result.identical.push(p.id);
    else result.conflicts.push(p.id);
  }
  result.retained = current.filter(p => !incomingIds.has(p.id)).map(p => p.id);
  return result;
}
// Restauration additive en mémoire : aucun document existant n'est remplacé.
// Les collisions sont refusées plutôt que résolues sans intervention humaine.
export function restoreIntoSandbox(current, incoming) {
  const preview = restorationPreview(current, incoming);
  if (preview.conflicts.length) throw new Error('Conflit : restauration refusée. Exporter le bac actuel ou utiliser un bac vide.');
  const ids = new Set(current.map(p => p.id));
  return copy([...current, ...incoming.filter(p => !ids.has(p.id))]);
}
