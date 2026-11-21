import {normalizeName, unitInfo, active, convert, project, fail} from './domain.js';

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const bad = () => fail('restore-format');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function fields(value, required, optional = []) {
  if (!record(value) || required.some(k => !Object.hasOwn(value, k))
    || Object.keys(value).some(k => ![...required, ...optional].includes(k))) bad();
}
function text(value, max = 50000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) bad();
}
const bool = value => { if (typeof value !== 'boolean') bad(); };
const integer = value => { if (!Number.isSafeInteger(value) || value < 0) bad(); };
function amount(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) || Number(value) <= 0 || Number(value) > 1e12) bad();
}
const scaled = value => { const [a, b = ''] = value.split('.'); return BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0')); };
function signature(value, productId) {
  if (value === null) return;
  text(value);
  let sig; try { sig = JSON.parse(value); } catch { bad(); }
  if (!Array.isArray(sig) || sig.length !== 7 || sig[0] !== productId) bad();
  for (const n of sig.slice(1, 4)) if (!Number.isFinite(n) || n < 0) bad();
  if (!(typeof sig[4] === 'string' || sig[4] === null) || !['low', 'medium', 'ok'].includes(sig[5]) || typeof sig[6] !== 'boolean') bad();
}

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

export function validateState(state) {
  fields(state, ['formatVersion', 'revision', 'lines', 'aliases', 'operations']);
  if (state.formatVersion !== 1) fail('restore-version');
  integer(state.revision);
  for (const key of ['lines', 'aliases', 'operations']) if (!Array.isArray(state[key]) || state[key].length > 10000) bad();
  const lineIds = new Set(), versions = new Set(), activeIds = new Set(), decisions = new Set();
  let entries = 0;
  for (const line of state.lines) {
    fields(line, ['id', 'productId', 'name', 'unit', 'aisle', 'contributions', 'decisions'], ['distinctFree', 'baseline', 'approvedQuantity', 'autoCheck']);
    for (const key of ['id', 'name', 'unit']) text(line[key]);
    if (typeof line.aisle !== 'string' || line.aisle.length > 50000) bad();
    if (line.productId !== null) text(line.productId);
    if (Object.hasOwn(line, 'distinctFree')) bool(line.distinctFree);
    const expectedId = line.productId ? 'product:' + line.productId
      : 'free:' + normalizeName(line.name) + (line.distinctFree ? ':' + unitInfo(line.unit).dimension : '');
    if (line.id !== expectedId || lineIds.has(line.id)) bad(); lineIds.add(line.id);
    if (!Array.isArray(line.contributions) || !Array.isArray(line.decisions)) bad();
    entries += line.contributions.length + line.decisions.length;
    if (entries > 5000) bad();
    const localVersions = new Map(), sources = new Set();
    for (const c of line.contributions) {
      fields(c, ['id', 'revision', 'batchId', 'name', 'quantity', 'unit', 'active', 'checked', 'source']);
      for (const key of ['id', 'name', 'unit']) text(c[key]);
      if (c.batchId !== null) text(c.batchId);
      integer(c.revision); if (!c.revision || c.source !== 'manual') bad();
      amount(c.quantity); bool(c.active); bool(c.checked);
      const key = canonical([c.id, c.revision]);
      if (versions.has(key) || c.active && activeIds.has(c.id)) bad();
      versions.add(key); localVersions.set(key, c); if (c.active) activeIds.add(c.id);
    }
    for (const d of line.decisions) {
      fields(d, ['id', 'choice', 'quantity', 'sourceId'], ['sourceRevision']);
      text(d.id); amount(d.quantity);
      if (decisions.has(d.id) || !['add_extra', 'set_total'].includes(d.choice)) bad(); decisions.add(d.id);
      if (d.sourceId === null) { if (d.choice !== 'set_total' || Object.hasOwn(d, 'sourceRevision')) bad(); }
      else {
        text(d.sourceId); integer(d.sourceRevision);
        const key = canonical([d.sourceId, d.sourceRevision]), c = localVersions.get(key);
        if (!c || sources.has(key)) bad(); sources.add(key);
        // Les anciennes versions inactives peuvent utiliser une ancienne unité.
        if (c.active) { try { if (Number(convert(c.quantity, c.unit, line.unit)) !== Number(d.quantity)) bad(); } catch { bad(); } }
      }
    }
    if ([...localVersions.keys()].some(k => !sources.has(k))) bad();
    if (line.baseline !== undefined) {
      fields(line.baseline, ['automatic', 'contributions'], ['hasTotal']);
      signature(line.baseline.automatic, line.productId);
      text(line.baseline.contributions, 1000000);
      let sig; try { sig = JSON.parse(line.baseline.contributions); } catch { bad(); }
      if (!Array.isArray(sig) || sig.length > 2500) bad();
      const approvedSources = new Set();
      for (const item of sig) {
        if (!Array.isArray(item) || item.length !== 4) bad();
        text(item[0]); integer(item[1]); amount(item[2]); text(item[3]);
        const key = canonical(item.slice(0, 2)), c = localVersions.get(key);
        if (!c || c.quantity !== item[2] || c.unit !== item[3] || approvedSources.has(key)) bad();
        approvedSources.add(key);
      }
      if (line.baseline.hasTotal !== undefined) bool(line.baseline.hasTotal);
      amount(line.approvedQuantity);
      if (!approvedSources.size) bad();
      // Contrôle du dernier total approuvé avec son ancien contexte, sans lire
      // ni modifier l'inventaire courant. Le SHA sert à l'idempotence, pas à
      // authentifier l'auteur du fichier.
      let total = 0n, hasTotal = false;
      try {
        const a = line.baseline.automatic === null ? null : JSON.parse(line.baseline.automatic);
        if (a && (a[5] !== 'ok' || a[6])) {
          const need = Math.max(0, a[3] - a[1]), rounded = Number(need.toFixed(6));
          if (Math.abs(need - rounded) > Number.EPSILON * Math.max(1, Math.abs(need)) * 4) bad();
          total = scaled(convert(String(rounded), a[4] || 'article', line.unit));
        }
        for (const d of line.decisions) {
          if (!d.sourceId || approvedSources.has(canonical([d.sourceId, d.sourceRevision]))) {
            total = d.choice === 'set_total' ? scaled(d.quantity) : total + scaled(d.quantity);
            if (d.choice === 'set_total') hasTotal = true;
          }
        }
        if (total !== scaled(line.approvedQuantity)) bad();
        if (line.baseline.hasTotal !== undefined && line.baseline.hasTotal !== hasTotal) bad();
      } catch { bad(); }
    } else if (active(line).length || line.approvedQuantity !== undefined) bad();
    if (line.autoCheck !== undefined) {
      fields(line.autoCheck, ['signature', 'checked']); bool(line.autoCheck.checked);
      signature(line.autoCheck.signature, line.productId);
      if (!line.productId || line.autoCheck.signature === null) bad();
    }
  }
  const aliases = new Set(), operations = new Set();
  for (const alias of state.aliases) {
    fields(alias, ['name', 'productId']); text(alias.name); text(alias.productId);
    if (normalizeName(alias.name) !== alias.name || aliases.has(alias.name)) bad(); aliases.add(alias.name);
  }
  for (const op of state.operations) {
    fields(op, ['id', 'signature']); text(op.id); text(op.signature, 1000000);
    if (operations.has(op.id)) bad(); operations.add(op.id);
  }
  return state;
}

export function readBackup(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) fail('restore-size');
  let file; try { file = JSON.parse(raw); } catch { bad(); }
  fields(file, ['format', 'version', 'state']);
  if (file.format !== 'inventaire-shopping-local') bad();
  if (file.version !== 1) fail('restore-version');
  validateState(file.state);
  return file;
}

export async function backupOperation(file) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(file)));
  return 'restore:' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

// Restauration additive de lignes entières disjointes. Une ligne différente au
// même ID n'est jamais fusionnée, même si une version paraît plus récente.
export function planRestore(current, file, products, now = Date.now()) {
  fields(file, ['format', 'version', 'state']);
  if (file.format !== 'inventaire-shopping-local') bad();
  if (file.version !== 1) fail('restore-version');
  validateState(current); validateState(file.state);
  const next = structuredClone(current), items = [], conflicts = [];
  let added = 0, aliasCount = 0, operationCount = 0;
  const conflict = (type, id) => conflicts.push({type, id});
  for (const incoming of file.state.lines) {
    const existing = next.lines.find(l => l.id === incoming.id);
    let kind = existing ? canonical(existing) === canonical(incoming) ? 'same' : 'conflict' : 'new';
    if (!existing) {
      const collision = current.lines.some(l => active(l).length && active(incoming).length
        && normalizeName(l.name) === normalizeName(incoming.name)
        && (!l.distinctFree && !incoming.distinctFree || unitInfo(l.unit).dimension === unitInfo(incoming.unit).dimension));
      if (collision) kind = 'conflict';
    }
    let quantity = incoming.approvedQuantity || '0', needsReview = false;
    if (active(incoming).length) {
      try { const view = project(incoming, products, now); quantity = view.quantity; needsReview = !!(view.needsReview || view.missingProduct); }
      catch { quantity = '?'; needsReview = true; }
    }
    items.push({id: incoming.id, name: incoming.name, unit: incoming.unit, quantity, kind, needsReview,
      active: active(incoming).length, contributions: incoming.contributions.length});
    if (kind === 'conflict') conflict('line', incoming.id);
    if (kind === 'new') { next.lines.push(structuredClone(incoming)); added++; }
  }
  for (const [key, identity, type] of [['aliases', 'name', 'alias'], ['operations', 'id', 'operation']]) {
    for (const entry of file.state[key]) {
      const old = next[key].find(x => x[identity] === entry[identity]);
      if (old && canonical(old) !== canonical(entry)) conflict(type, entry[identity]);
      else if (!old) { next[key].push(structuredClone(entry)); if (key === 'aliases') aliasCount++; else operationCount++; }
    }
  }
  // Détecte aussi les collisions d'identifiants de contributions/décisions
  // entre lignes différentes : pas seulement les noms ou IDs de ligne.
  if (!conflicts.length) { try { validateState(next); } catch { conflict('identity', ''); } }
  return {next: conflicts.length ? null : next, items, conflicts, added, aliasCount, operationCount,
    changes: added + aliasCount + operationCount};
}
