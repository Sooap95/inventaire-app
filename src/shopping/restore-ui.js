import {inventorySignature} from './domain.js';
import {readBackup, backupOperation, planRestore, MAX_BACKUP_BYTES} from './backup.js';

const WORDS = {
  fr: {title: 'Restaurer les ajouts locaux', file: 'Choisir une sauvegarde JSON', cancel: 'Annuler',
    confirm: 'Restaurer les éléments annoncés', again: 'Réévaluer avec la liste actuelle',
    rule: 'Ajout de lignes entières uniquement. Aucun remplacement, aucune fusion de quantités. Un conflit bloque tout le fichier.',
    ack: 'J’ai vérifié cet aperçu et je confirme la restauration sans remplacer les données actuelles.',
    new: 'Nouvelle ligne', same: 'Déjà présente : inchangée', conflict: 'Conflit : restauration bloquée',
    review: 'Quantité à revérifier', inactive: 'Historique inactif', empty: 'Aucune nouvelle donnée à restaurer.',
    counts: (p) => `${p.added} lignes nouvelles · ${p.aliasCount} alias · ${p.operationCount} opérations historiques nouvelles.`,
    metadata: 'Conflit de métadonnées ou d’identifiants. Aucune donnée ne sera restaurée.',
    errors: {'restore-format': 'Fichier incorrect ou incohérent : aucune restauration.',
      'restore-version': 'Version de sauvegarde non prise en charge.', 'restore-size': 'Fichier trop volumineux (maximum 10 Mio).',
      conflict: 'La liste a changé dans un autre onglet. Réévaluer cet aperçu.',
      inventory: 'Les produits ou stocks ont changé. Réévaluer cet aperçu.',
      storage: 'Écriture locale non confirmée. Aucune réussite annoncée.'}},
  de: {title: 'Lokale Einträge wiederherstellen', file: 'JSON-Sicherung auswählen', cancel: 'Abbrechen',
    confirm: 'Angezeigte Elemente wiederherstellen', again: 'Mit der aktuellen Liste erneut prüfen',
    rule: 'Nur ganze zusätzliche Zeilen. Kein Ersetzen, keine Mengen zusammenführen. Ein Konflikt blockiert die gesamte Datei.',
    ack: 'Ich habe die Vorschau geprüft und bestätige die Wiederherstellung ohne vorhandene Daten zu ersetzen.',
    new: 'Neue Zeile', same: 'Bereits vorhanden: unverändert', conflict: 'Konflikt: Wiederherstellung blockiert',
    review: 'Menge erneut prüfen', inactive: 'Inaktiver Verlauf', empty: 'Keine neuen Daten wiederherzustellen.',
    counts: (p) => `${p.added} neue Zeilen · ${p.aliasCount} Aliase · ${p.operationCount} neue Verlaufsvorgänge.`,
    metadata: 'Konflikt bei Metadaten oder Kennungen. Keine Daten werden wiederhergestellt.',
    errors: {'restore-format': 'Fehlerhafte oder widersprüchliche Datei: keine Wiederherstellung.',
      'restore-version': 'Nicht unterstützte Sicherungsversion.', 'restore-size': 'Datei zu groß (maximal 10 MiB).',
      conflict: 'Die Liste wurde in einem anderen Tab geändert. Vorschau erneut prüfen.',
      inventory: 'Produkte oder Bestände wurden geändert. Vorschau erneut prüfen.',
      storage: 'Lokale Speicherung nicht bestätigt. Kein Erfolg gemeldet.'}}
};
const element = (tag, text, cls) => {
  const e = document.createElement(tag); if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls; return e;
};

export function createRestoreDialog({read, commit, products, language}) {
  const words = () => WORDS[language() === 'de' ? 'de' : 'fr'];
  let file = null, operationId, snapshot, inventory, signature, plan, busy = false, stale = false, generation = 0, previousFocus;
  const overlay = element('div', undefined, 'modal-overlay hidden sm-overlay'); overlay.id = 'sm-restore-modal';
  const modal = element('div', undefined, 'modal sm-modal');
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'sm-restore-title');
  const header = element('div', undefined, 'modal-header'), title = element('h3'); title.id = 'sm-restore-title';
  const closeButton = element('button', '✕', 'btn btn-outline'); closeButton.type = 'button'; closeButton.onclick = close;
  header.append(title, closeButton);
  const body = element('div', undefined, 'modal-body'), rule = element('p'), label = element('label'), picker = element('input');
  picker.type = 'file'; picker.accept = '.json,application/json'; picker.id = 'sm-restore-file'; label.htmlFor = picker.id;
  const error = element('p'); error.id = 'sm-restore-error'; error.setAttribute('role', 'alert');
  const preview = element('div'); preview.id = 'sm-restore-preview';
  const acknowledgement = element('label', undefined, 'sm-check'), ack = element('input'), ackText = element('span');
  ack.type = 'checkbox'; ack.id = 'sm-restore-ack'; acknowledgement.append(ack, ackText);
  const footer = element('div', undefined, 'modal-footer'), cancel = element('button', undefined, 'btn btn-outline');
  const again = element('button', undefined, 'btn btn-outline'), confirm = element('button', undefined, 'btn btn-accent');
  again.id = 'sm-restore-reevaluate'; confirm.id = 'sm-restore-confirm';
  for (const b of [cancel, again, confirm]) b.type = 'button';
  cancel.onclick = close; again.onclick = () => evaluate().catch(showError); confirm.onclick = save;
  ack.onchange = update;
  body.append(rule, label, picker, error, preview, acknowledgement); footer.append(cancel, again, confirm);
  modal.append(header, body, footer); overlay.append(modal); document.body.append(overlay);

  function labels() {
    title.textContent = words().title; label.textContent = words().file; rule.textContent = words().rule;
    ackText.textContent = words().ack; closeButton.setAttribute('aria-label', words().cancel);
    cancel.textContent = words().cancel; again.textContent = words().again; confirm.textContent = words().confirm;
  }
  function update() {
    confirm.disabled = busy || stale || !plan?.next || !plan.changes || !ack.checked;
    picker.disabled = busy; again.disabled = busy || !file; ack.disabled = busy || stale || !plan?.next || !plan.changes;
    closeButton.disabled = busy; cancel.disabled = busy;
  }
  function showError(e) {
    error.textContent = words().errors[e.code] || words().errors.storage;
    if (e.code === 'conflict' || e.code === 'inventory') stale = true;
    update();
  }
  function draw() {
    preview.replaceChildren(); ack.checked = false;
    if (plan) {
      preview.append(element('p', words().counts(plan)));
      if (plan.conflicts.some(c => c.type !== 'line')) preview.append(element('p', words().metadata, 'sm-error'));
      for (const item of plan.items) {
        const row = element('section', undefined, 'sm-preview-row'); row.dataset.restoreKind = item.kind;
        row.append(element('strong', item.name), element('p', words()[item.kind]));
        row.append(element('p', item.active ? `${item.quantity} ${item.unit}` : words().inactive));
        if (item.needsReview) row.append(element('p', words().review, 'sm-error'));
        preview.append(row);
      }
      if (!plan.changes && !plan.conflicts.length) preview.append(element('p', words().empty));
    }
    update();
  }
  async function evaluate() {
    if (busy || !file) return;
    const token = ++generation; busy = true; update();
    try {
      const next = await read(); if (token !== generation) return;
      snapshot = next; inventory = products(); signature = inventorySignature(inventory);
      plan = planRestore(snapshot, file, inventory); stale = false; error.textContent = ''; draw();
    } catch (e) { plan = null; showError(e); }
    finally { busy = false; update(); }
  }
  picker.onchange = async () => {
    const selected = picker.files[0], token = ++generation;
    file = null; plan = null; error.textContent = ''; draw();
    if (!selected) return;
    busy = true; update();
    try {
      if (selected.size > MAX_BACKUP_BYTES) throw {code: 'restore-size'};
      const raw = await selected.text(); if (token !== generation) return;
      file = readBackup(raw); operationId = await backupOperation(file);
      if (token !== generation) return;
    } catch (e) { file = null; showError(e); }
    finally { busy = false; update(); }
    if (file && token === generation) await evaluate();
  };
  async function save() {
    if (confirm.disabled || busy || !plan?.next) return;
    if (signature !== inventorySignature(products())) { showError({code: 'inventory'}); return; }
    busy = true; update();
    try {
      await commit(snapshot.revision, operationId, JSON.stringify({kind: 'restore', operationId}), plan.next);
      busy = false; close();
    } catch (e) { busy = false; showError(e); }
    update();
  }
  function close() {
    if (busy) return;
    generation++; overlay.classList.add('hidden'); previousFocus?.focus();
    file = null; plan = null; picker.value = ''; preview.replaceChildren();
  }
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll('button,input')].filter(e => !e.disabled && e.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  return {
    open() { previousFocus = document.activeElement; labels(); file = null; plan = null; stale = false; error.textContent = ''; picker.value = ''; draw(); overlay.classList.remove('hidden'); picker.focus(); },
    changed() { if (!overlay.classList.contains('hidden')) { stale = true; ack.checked = false; showError({code: 'conflict'}); } }
  };
}
