// Segmentation initiale par projection horizontale, à corriger visuellement.
// Aucun rapprochement de produits, aucune fusion, aucune écriture de courses.
export function segmentLines(image, width, height) {
  const active = [];
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = .299*image[i]+.587*image[i+1]+.114*image[i+2];
      if (luma < 150 && image[i+3] > 0) dark++;
    }
    if (dark > Math.max(2,width*.003)) active.push(y);
  }
  const ranges = [];
  const gap = Math.max(4,Math.round(height*.004));
  for (const y of active) {
    const last = ranges.at(-1);
    if (last && y-last.bottom <= gap) last.bottom = y;
    else ranges.push({top:y,bottom:y});
  }
  return ranges.filter(r=>r.bottom-r.top>=3).slice(0,40).map(r=>({
    top:Math.max(0,r.top-5)/height*100,
    bottom:Math.min(height,r.bottom+6)/height*100
  }));
}

const UNIT = '(kg|g|ml|mL|l|L|litres?|Liter|pièces?|pcs|Stk|paquets?|Packungen?|bouteilles?|Flaschen?)';
export function proposeLine(text) {
  const normalized = text.trim();
  const start = normalized.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*'+UNIT+'\\s+(.+)$','i'));
  if (start) return {name:start[3],quantity:start[1].replace(',','.'),unit:start[2],uncertain:true};
  const end = normalized.match(new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*'+UNIT+'$','i'));
  if (end) return {name:end[1],quantity:end[2].replace(',','.'),unit:end[3],uncertain:true};
  return {name:normalized,quantity:'',unit:'',uncertain:true};
}
export function validateConfirmed(rows) {
  if (!rows.length) throw new Error('Aucun article confirmé.');
  return rows.map(row=>{
    const quantity = Number(String(row.quantity).replace(',','.'));
    if (!row.confirmed || !row.name.trim() || !Number.isFinite(quantity) || quantity<=0 || !row.unit.trim()) {
      throw new Error('Chaque article doit être confirmé avec nom, quantité positive et unité.');
    }
    return {id:row.id,name:row.name.trim(),quantity,unit:row.unit.trim(),source:'paper'};
  });
}
export function levenshtein(a,b) {
  const left=Array.from(a),right=Array.from(b);
  let previous=Array.from({length:right.length+1},(_,i)=>i);
  for (let i=1;i<=left.length;i++) {
    const next=[i];
    for (let j=1;j<=right.length;j++) next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+(left[i-1]===right[j-1]?0:1));
    previous=next;
  }
  return previous[right.length];
}
export function accuracy(reference, candidate) {
  const clean = x=>x.normalize('NFC').trim().replace(/\s+/g,' ');
  const a=clean(reference),b=clean(candidate);
  return {exact:a===b, characterErrorRate:a.length ? levenshtein(a,b)/Array.from(a).length : null};
}
