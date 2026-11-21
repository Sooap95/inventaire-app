import '../domain/stock.js';
const Stock=globalThis.InventoryStock;
const clone=x=>structuredClone(x);
export class ShoppingError extends Error { constructor(code){super(code);this.code=code;} }
export const fail=code=>{throw new ShoppingError(code);};
export const normalizeName=s=>String(s).toLowerCase().replace(/œ/g,'oe').replace(/æ/g,'ae').replace(/ß/g,'ss').normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’']/g,' ').replace(/\s+/g,' ').trim();
const units=[
  ['L','volume',1000,['l','litre','litres','liter']],['mL','volume',1,['ml','millilitre','millilitres','milliliter']],
  ['kg','mass',1000,['kg','kilo','kilos','kilogramme','kilogrammes','kilogramm']],['g','mass',1,['g','gramme','grammes','gramm']],
  ['boîte','box',1,['boite','boites','box','boxen','schachtel','schachteln']],
  ['œuf','egg',1,['oeuf','oeufs','ei','eier']],
  ['paquet','pack',1,['paquet','paquets','packung','packungen']],
  ['bouteille','bottle',1,['bouteille','bouteilles','flasche','flaschen']],
  ['article','piece',1,['article','articles','artikel','pcs','piece','pieces','stk','stuck']],
];
export function unitInfo(text){
  const n=normalizeName(text);
  for(const [label,dimension,factor,aliases] of units)if(aliases.includes(n))return {label,dimension,factor,known:true};
  return {label:String(text).trim(),dimension:'custom:'+n,factor:1,known:false};
}
const SCALE=1000000n;
function decimal(value,positive=false){
  const text=typeof value==='number'&&Number.isFinite(value)?value.toFixed(6):String(value).trim().replace(',','.');
  if(!/^\d+(?:\.\d{1,6})?$/.test(text))fail('quantity');
  const [a,b='']=text.split('.');const n=BigInt(a)*SCALE+BigInt(b.padEnd(6,'0'));
  if(n>1000000000000n||positive&&n<=0n)fail('quantity');
  return n;
}
function format(n){return `${n/SCALE}${n%SCALE?'.'+String(n%SCALE).padStart(6,'0').replace(/0+$/,''):''}`;}
export function quantity(value){return format(decimal(value,true));}
export function convert(value,from,to){
  const a=unitInfo(from),b=unitInfo(to);
  if(!a.label||!b.label||a.dimension!==b.dimension)fail('units');
  const n=decimal(value)*BigInt(a.factor);
  if(n%BigInt(b.factor))fail('precision');
  return format(n/BigInt(b.factor));
}
const add=(a,b)=>format(decimal(a)+decimal(b));
function distance(a,b){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]!==b[j-1]));prev=next;}return prev[b.length];}
export function matchProduct(name,products,aliases=[],productId=null){
  if(productId){const product=products.find(p=>p.id===productId);if(!product)fail('product');return {product,type:'id'};}
  const n=normalizeName(name);const exact=products.filter(p=>normalizeName(p.name)===n);
  if(exact.length===1)return {product:exact[0],type:'exact'};
  const aliasIds=[...new Set(aliases.filter(a=>a.name===n).map(a=>a.productId))];
  if(aliasIds.length===1){const p=products.find(p=>p.id===aliasIds[0]);if(p)return {product:p,type:'alias'};}
  const candidates=products.filter(p=>{
    const pn=normalizeName(p.name);
    return pn.replace(/s$/,'')===n.replace(/s$/,'')||n.length>=4&&distance(n,pn)<=Math.max(1,Math.floor(n.length*.2));
  });
  return {product:null,type:exact.length>1?'ambiguous':'free',candidates};
}
export function parseList(text,products=[],aliases=[],idFactory=()=>crypto.randomUUID()){
  if(text.length>20000)fail('limit');
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(lines.length>100)fail('limit');
  return lines.map(raw=>{
    let name=raw,q='1',unit='',kind='default',ambiguous=false;
    const num='(\\d+(?:[.,]\\d+)?)';
    const multi=raw.match(new RegExp('^(.+?)(?:\\s+[xX]\\s*|\\s*×\\s*)'+num+'$'));
    const prefix=raw.match(new RegExp('^'+num+'\\s+(.+)$'));
    const suffix=raw.match(new RegExp('^(.+?)\\s+'+num+'(?:\\s*([^\\d\\s].*))?$'));
    const whole=products.some(p=>normalizeName(p.name)===normalizeName(raw));
    if(multi){name=multi[1].trim();q=multi[2];kind='multiplier';}
    else if(!whole&&prefix){
      q=prefix[1];name=prefix[2].trim();kind='prefix';
      const [token,...rest]=name.split(/\s+/);if(rest.length&&unitInfo(token).known){unit=token;name=rest.join(' ').replace(/^(?:de\s+|d[’'])/i,'');}
    }else if(!whole&&suffix){
      name=suffix[1];q=suffix[2];kind='suffix';
      if(suffix[3]){if(unitInfo(suffix[3]).known)unit=suffix[3];else ambiguous=true;}
    }else if(/(?:\s[x×]\s*[-+\d]|^[-+]?\d+\s|\b\d+\/\d+\b|\s\d+[.,]\s|\s[-+]\d)/i.test(raw)){ambiguous=true;q='';}
    const match=matchProduct(name,products,aliases);
    const eggs=['oeuf','oeufs','ei','eier'].includes(normalizeName(name));
    const unitExplicit=eggs||!!unit;
    if(!unit)unit=eggs?(kind==='default'||kind==='multiplier'?'boîte':'œuf'):(match.product?.unit||'article');
    try{q=quantity(q);}catch{ambiguous=true;}
    return {id:idFactory(),raw,name,quantity:q,unit,kind,ambiguous,productId:match.product?.id||null,
      matchType:match.type,candidates:match.candidates||[],distinctFree:false,rememberAlias:false,unitExplicit,aliasName:name};
  });
}
export const emptyState=()=>({formatVersion:1,revision:0,lines:[],aliases:[],operations:[]});
export const active=line=>line.contributions.filter(c=>c.active);
const contributionSignature=line=>JSON.stringify(active(line).map(c=>[c.id,c.revision,c.quantity,c.unit]));
export function automatic(product,now=Date.now()){
  if(!product)return null;
  const status=Stock.getStatus(product),suggested=Stock.isSuggested(product,now);
  return {productId:product.id,name:product.name,unit:product.unit||'article',quantity:String(Stock.quantityNeeded(product)),present:status!=='ok'||suggested,suggested,
    signature:JSON.stringify([product.id,product.stock,product.threshold,product.target,product.unit,status,suggested])};
}
function events(line){if(!active(line).length)return [];return line.decisions.filter(d=>!d.sourceId||active(line).some(c=>c.id===d.sourceId&&c.revision===d.sourceRevision));}
function automaticDecimal(value){
  const n=Number(value),rounded=Number(n.toFixed(6));
  // Corriger uniquement le bruit IEEE-754 pour l'arithmétique manuelle ;
  // aucune valeur d'inventaire ni le calcul/affichage automatique historique n'est modifié.
  if(!Number.isFinite(n)||Math.abs(n-rounded)>Number.EPSILON*Math.max(1,Math.abs(n))*4)fail('precision');
  return format(decimal(rounded));
}
export function project(line,products,now=Date.now(),ignoreStale=false){
  const product=products.find(p=>p.id===line.productId);const auto=automatic(product,now);
  const present=!!auto?.present;let q=present?convert(automaticDecimal(auto.quantity),auto.unit,line.unit):'0';
  const applied=events(line);for(const d of applied)q=d.choice==='set_total'?d.quantity:add(q,d.quantity);
  const hasTotal=applied.some(d=>d.choice==='set_total');
  const stale=active(line).length>0&&(hasTotal||line.baseline?.hasTotal)&&(
    line.baseline?.automatic!==(auto?.signature||null)||line.baseline?.contributions!==contributionSignature(line));
  const missingProduct=!!line.productId&&!product;
  const unresolved=active(line).length>0&&missingProduct;
  return {quantity:unresolved||stale&&!ignoreStale?line.approvedQuantity:q,calculatedQuantity:q,needsReview:!!(stale||unresolved),automatic:auto,present,hasTotal,missingProduct};
}
function baseline(line,products,now){const p=project(line,products,now,true);line.approvedQuantity=p.quantity;line.baseline={automatic:p.automatic?.signature||null,contributions:contributionSignature(line),hasTotal:p.hasTotal};}
export function inventorySignature(products){return JSON.stringify(products.map(p=>[p.id,p.name,p.stock,p.threshold,p.target,p.unit,p.frequency,p.lastRestocked]));}
export function planBatch(state,products,rows,choices={},now=Date.now()){
  const next=clone(state),steps=[];
  for(const row of rows){
    try{
      if(!row.name.trim()||!row.unit.trim()||row.ambiguous)fail('ambiguous');
      if(row.requiresAssociation)fail('product');
      const incoming=quantity(row.quantity);const product=row.productId?products.find(p=>p.id===row.productId):null;
      if(row.productId&&!product)fail('product');
      // Une édition remplace la version de sa contribution, jamais un produit.
      let old=null;
      if(row.editId)for(const l of next.lines){const c=l.contributions.find(c=>c.id===row.editId&&c.active);if(c){old=c;c.active=false;}}
      if(row.editId&&!old)fail('conflict');
      const key=product?'product:'+product.id:'free:'+normalizeName(row.name)+(row.distinctFree?':'+unitInfo(row.unit).dimension:'');
      // Pas de rapprochement silencieux entre une ancienne ligne libre et un produit.
      if(!row.distinctFree&&next.lines.some(l=>l.id!==key&&active(l).length&&normalizeName(l.name)===normalizeName(row.name)&&(!l.distinctFree||unitInfo(l.unit).dimension===unitInfo(row.unit).dimension)))fail('identity');
      let line=next.lines.find(l=>l.id===key);
      if(!line){line={id:key,productId:product?.id||null,name:product?.name||row.name,unit:product?.unit||row.unit,aisle:product?.aisle||'',distinctFree:!!row.distinctFree,contributions:[],decisions:[]};next.lines.push(line);}
      else if(!active(line).length)line.unit=product?.unit||row.unit;
      const view=project(line,products,now,!!row.editId);
      if(view.missingProduct)fail('product');
      if(view.needsReview&&!row.editId)fail('review');
      const q=convert(incoming,row.unit,line.unit);
      const duplicate=view.present||active(line).length>0;
      const step={id:row.id,duplicate,current:view.quantity,incoming:q,unit:line.unit,choice:choices[row.id]||null,lineId:key};
      if(duplicate&&!['keep','set_total','add_extra'].includes(step.choice)){steps.push({...step,error:'choice'});return {next:null,steps,error:'choice'};}
      if(step.choice==='keep'){
        if(old)fail('edit-keep'); // Annuler l'édition conserve l'ancienne contribution.
        step.total=view.quantity;steps.push(step);continue;
      }
      const mode=duplicate?step.choice:'add_extra';step.total=mode==='set_total'?q:add(view.quantity,q);
      const id=old?.id||row.id;const revision=(old?.revision||0)+1;
      if(line.contributions.some(c=>c.id===id&&c.active))fail('duplicate-id');
      line.contributions.push({id,revision,batchId:row.batchId||null,name:row.name,quantity:incoming,unit:row.unit,active:true,checked:false,source:'manual'});
      line.decisions.push({id:row.id+':'+revision,choice:mode,quantity:q,sourceId:id,sourceRevision:revision});
      baseline(line,products,now);steps.push(step);
      if(row.rememberAlias&&product){
        const name=normalizeName(row.aliasName||row.name);const previous=next.aliases.find(a=>a.name===name);
        if(previous&&previous.productId!==product.id)fail('alias');
        if(!previous)next.aliases.push({name,productId:product.id});
      }
    }catch(e){steps.push({id:row.id,error:e.code||'invalid'});return {next:null,steps,error:e.code||'invalid'};}
  }
  if(next.lines.reduce((n,l)=>n+l.contributions.length+l.decisions.length,0)>5000)fail('limit');
  return {next,steps,error:null};
}
export function removeContribution(state,lineId,id){
  const next=clone(state),line=next.lines.find(l=>l.id===lineId),c=line?.contributions.find(c=>c.id===id&&c.active);
  if(!c)fail('conflict');c.active=false;return next;
}
export function toggleContribution(state,lineId,id,checked){
  const next=clone(state),c=next.lines.find(l=>l.id===lineId)?.contributions.find(c=>c.id===id&&c.active);
  if(!c)fail('conflict');c.checked=!!checked;return next;
}
export function reviewTotal(state,products,lineId,total,now=Date.now()){
  const next=clone(state),line=next.lines.find(l=>l.id===lineId);if(!line||!active(line).length)fail('conflict');
  if(line.productId&&!products.some(p=>p.id===line.productId))fail('product');
  line.decisions.push({id:crypto.randomUUID(),choice:'set_total',quantity:quantity(total),sourceId:null});baseline(line,products,now);return next;
}
