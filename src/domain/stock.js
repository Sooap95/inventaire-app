// Module classique volontairement compatible avec l'application sans build.
// Les conditions historiques sont conservées, y compris le seuil inclusif.
(function (root) {
  'use strict';
  function getStatus(p) {
    if (p.stock <= p.threshold) return 'low';
    if (p.stock <= p.threshold * 1.5) return 'medium';
    return 'ok';
  }
  function freqDays(f) {
    return { quotidien: 1, hebdomadaire: 7, mensuel: 30, trimestriel: 90 }[f] || null;
  }
  function isDepletingSoon(p, now = Date.now()) {
    const d = freqDays(p.frequency);
    if (!d || !p.lastRestocked) return false;
    const next = new Date(p.lastRestocked).getTime();
    if (isNaN(next)) return false;
    return (next + d * 86400000 - now) / 86400000 < 7;
  }
  function isSuggested(p, now = Date.now()) {
    return getStatus(p) === 'ok' && isDepletingSoon(p, now);
  }
  function quantityNeeded(p) { return Math.max(0, p.target - p.stock); }
  root.InventoryStock = Object.freeze({ getStatus, freqDays, isDepletingSoon, isSuggested, quantityNeeded });
})(globalThis);
