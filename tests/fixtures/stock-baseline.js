// Extrait sans modification du commit b2ff9c0650772d2463cfceca5d98a186375b9bad.
function getStatus(p) {
  if (p.stock <= p.threshold) return 'low';
  if (p.stock <= p.threshold * 1.5) return 'medium';
  return 'ok';
}

function freqDays(f) {
  return { quotidien: 1, hebdomadaire: 7, mensuel: 30, trimestriel: 90 }[f] || null;
}

function isDepletingSoon(p) {
  const d = freqDays(p.frequency);
  if (!d || !p.lastRestocked) return false;
  const next = new Date(p.lastRestocked).getTime();
  if (isNaN(next)) return false;
  const daysLeft = (next + d * 86400000 - Date.now()) / 86400000;
  return daysLeft < 7;
}

function isSuggested(p) {
  return getStatus(p) === 'ok' && isDepletingSoon(p);
}
