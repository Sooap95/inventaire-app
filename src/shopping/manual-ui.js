import {parseList,matchProduct,normalizeName,planBatch,project,automatic,active,removeContribution,toggleContribution,reviewTotal,inventorySignature} from './domain.js';
import {indexedStore} from './store.js';
import {shoppingRows,checkLine,checkAutomatic,shoppingText,rowText,outputWords} from './view.js';
import {createRestoreDialog} from './restore-ui.js';

if(!window.FAMILY_LAB_CONFIG){
const host=window.manualShoppingHost;
const WORDS={
 fr:{missing:'Produit associé supprimé. Choisir explicitement un autre produit, un article libre, ou retirer cet ajout. Le besoin automatique disparu ne sera pas transféré.',resolve:'Résoudre l’association',chooseAssociation:'Choisir une association',restore:'Restaurer les ajouts locaux',restored:'Restauration locale confirmée. Aucun stock modifié.',checkMeaning:'La case principale couvre le besoin automatique et tous les ajouts actifs. Une case partielle indique des sources cochées séparément. Ce marquage ne représente pas un achat.',copied:'Liste complète copiée.',copyFallback:'Sélectionner puis copier cette liste avec le menu du téléphone.',add:'Ajouter des articles',scope:'Ajouts manuels sur cet appareil uniquement — synchronisation familiale non activée.',export:'Exporter les ajouts locaux',title:'Ajouter ou coller une liste',text:'Une ligne par article',preview:'Préparer l’aperçu',reevaluate:'Réévaluer avec la liste actuelle',validate:'Valider les articles',cancel:'Annuler',name:'Nom',quantity:'Quantité',unit:'Unité',product:'Produit associé',free:'Article libre / produit distinct',suggest:'Proposition : ',associate:'Associer explicitement',alias:'Retenir cette correction sur cet appareil',default:'Quantité absente : 1 proposée, modifiable.',eggs:'Boîtes et œufs individuels restent distincts. Aucune conversion de conditionnement.',current:'Actuellement prévu',incoming:'Nouvelle quantité',keep:'Conserver la quantité actuelle',total:'Fixer le total',extra:'Ajouter en supplément',blocked:'Résoudre d’abord la ligne précédente.',ready:'Aperçu prêt. Vérifier chaque ligne et les doublons avant validation.',saved:'Articles validés localement. Aucun stock modifié.',repeat:'Cette saisie a déjà été validée. Vérifier les doublons ; aucune addition automatique.',local:'Manuel · local',auto:'Automatique',suggested:'À anticiper (facultatif)',details:'Contributions et actions',edit:'Modifier',remove:'Retirer cet ajout',checked:'Cocher sans achat ni modification de stock',review:'Quantité à revérifier',reviewAction:'Revoir le total',reviewTitle:'Revoir la quantité totale',last:'Dernier total confirmé',confirmTotal:'Confirmer ce total',empty:'Aucun article à acheter.',edited:'Édition : la quantité actuelle est calculée sans l’ancien ajout. Annuler conserve cet ajout.',loading:'Chargement des ajouts locaux…',unavailable:'Ajouts locaux indisponibles : aucune donnée existante n’a été remplacée.',partial:'Cocher un ajout ne constitue pas un achat. Les achats manuels et leurs effets sur le stock sont reportés.',errors:{quantity:'Quantité positive attendue, jusqu’à 6 décimales et 1 000 000.',units:'Unités incompatibles : préciser l’unité, le produit ou choisir un article libre distinct. Aucune conversion boîte/œuf, bouteille/L ou paquet/pièce.',precision:'Conversion trop précise : clarifier la quantité.',ambiguous:'Ligne ambiguë : corriger le nom, la quantité ou l’unité.',choice:'Choisir explicitement conserver, fixer le total ou supplément.',conflict:'La liste a changé dans un autre onglet. Réévaluer avant de valider.',inventory:'Le stock ou le produit a changé. Réévaluer avant de valider.',review:'Une décision de total est périmée. Revoir le total de cet article dans la liste.',identity:'Une autre ligne pourrait désigner ce produit. Clarifier son identité ou choisir explicitement un article libre distinct.',product:'Produit associé absent ou modifié. Choisir de nouveau le produit ou un article libre.',operation:'Identifiant de validation déjà utilisé avec un contenu différent : rouvrir un nouvel aperçu.',alias:'Cet alias désigne déjà un autre produit : clarification nécessaire.',limit:'Limite atteinte : 100 lignes, 20 000 caractères ou historique local trop volumineux. Exporter les ajouts.',format:'Format local inconnu : données conservées, aucune réinitialisation.',invalid:'Validation impossible : vérifier les champs.',storage:'Écriture locale non confirmée. Les modifications ne sont pas annoncées comme enregistrées.'}},
 de:{missing:'Zugeordnetes Produkt gelöscht. Anderes Produkt oder freien Artikel ausdrücklich wählen oder diesen Eintrag entfernen. Der frühere automatische Bedarf wird nicht übertragen.',resolve:'Zuordnung klären',chooseAssociation:'Zuordnung auswählen',restore:'Lokale Einträge wiederherstellen',restored:'Lokale Wiederherstellung bestätigt. Kein Bestand geändert.',checkMeaning:'Das Hauptkästchen umfasst den automatischen Bedarf und alle aktiven Einträge. Teilweise markiert bedeutet einzeln abgehakte Quellen. Dies ist kein Kauf.',copied:'Vollständige Liste kopiert.',copyFallback:'Diese Liste auswählen und über das Telefonmenü kopieren.',add:'Artikel hinzufügen',scope:'Manuelle Einträge nur auf diesem Gerät — keine gemeinsame Familiensynchronisierung.',export:'Lokale Einträge exportieren',title:'Liste eingeben oder einfügen',text:'Ein Artikel pro Zeile',preview:'Vorschau erstellen',reevaluate:'Mit der aktuellen Liste erneut prüfen',validate:'Artikel bestätigen',cancel:'Abbrechen',name:'Name',quantity:'Menge',unit:'Einheit',product:'Zugeordnetes Produkt',free:'Freier Artikel / anderes Produkt',suggest:'Vorschlag: ',associate:'Ausdrücklich zuordnen',alias:'Diese Korrektur auf diesem Gerät merken',default:'Ohne Mengenangabe: 1 vorgeschlagen, bearbeitbar.',eggs:'Schachteln und einzelne Eier bleiben getrennt. Keine Umrechnung ohne bekannte Packungsgröße.',current:'Aktuell vorgesehen',incoming:'Neue Menge',keep:'Aktuelle Menge behalten',total:'Gesamtmenge festlegen',extra:'Zusätzlich hinzufügen',blocked:'Zuerst die vorherige Zeile klären.',ready:'Vorschau bereit. Alle Zeilen und Dubletten vor dem Bestätigen prüfen.',saved:'Artikel lokal bestätigt. Kein Bestand geändert.',repeat:'Diese Eingabe wurde bereits bestätigt. Dubletten prüfen; keine automatische Addition.',local:'Manuell · lokal',auto:'Automatisch',suggested:'Vorausplanen (optional)',details:'Beiträge und Aktionen',edit:'Bearbeiten',remove:'Diesen Eintrag entfernen',checked:'Abhaken ohne Kauf oder Bestandsänderung',review:'Menge erneut prüfen',reviewAction:'Gesamtmenge prüfen',reviewTitle:'Gesamtmenge erneut prüfen',last:'Zuletzt bestätigte Gesamtmenge',confirmTotal:'Diese Gesamtmenge bestätigen',empty:'Keine Artikel einzukaufen.',edited:'Bearbeitung: Die aktuelle Menge enthält den bisherigen Eintrag nicht. Abbrechen behält ihn.',loading:'Lokale Einträge werden geladen…',unavailable:'Lokale Einträge nicht verfügbar. Vorhandene Daten wurden nicht ersetzt.',partial:'Abhaken ist kein Kauf. Manuelle Käufe und Bestandsänderungen folgen später.',errors:{quantity:'Positive Menge erwartet, bis 6 Dezimalstellen und 1 000 000.',units:'Unvereinbare Einheiten: Einheit oder Produkt klären oder ausdrücklich einen anderen freien Artikel wählen. Keine Umrechnung Schachtel/Ei, Flasche/L oder Packung/Stück.',precision:'Umrechnung zu genau: Menge klären.',ambiguous:'Unklare Zeile: Name, Menge oder Einheit korrigieren.',choice:'Ausdrücklich behalten, Gesamtmenge oder zusätzlich wählen.',conflict:'Die Liste wurde in einem anderen Tab geändert. Vor Bestätigung erneut prüfen.',inventory:'Bestand oder Produkt geändert. Erneut prüfen.',review:'Eine Gesamtentscheidung ist veraltet. Gesamtmenge in der Liste erneut prüfen.',identity:'Eine andere Zeile könnte dieses Produkt meinen. Zuordnung klären oder ausdrücklich einen anderen freien Artikel wählen.',product:'Zugeordnetes Produkt fehlt oder wurde geändert. Erneut zuordnen oder freien Artikel wählen.',operation:'Bestätigungs-ID bereits für anderen Inhalt verwendet. Neue Vorschau öffnen.',alias:'Dieser Alias bezeichnet bereits ein anderes Produkt.',limit:'Grenze erreicht: 100 Zeilen, 20 000 Zeichen oder zu großer lokaler Verlauf. Einträge exportieren.',format:'Unbekanntes lokales Format: Daten bleiben erhalten.',invalid:'Bestätigung nicht möglich. Felder prüfen.',storage:'Lokale Speicherung nicht bestätigt. Änderungen werden nicht als gespeichert angezeigt.'}}
};
const w=()=>WORDS[host.language()==='de'?'de':'fr'];
const errorText=code=>w().errors[code]||w().errors.storage;
const id=()=>crypto.randomUUID();
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,fn)=>{const e=node('button',text,'btn btn-outline btn-sm');e.type='button';e.addEventListener('click',async()=>{try{await fn();}catch{status.textContent=w().unavailable;}});return e;};
const label=(text,input)=>{const e=node('label',text);e.append(input);return e;};
let store,state=null,busy=false,rows=[],choices={},draftState,draftProducts,draftSignature,batchId,reviewId=null,focusBefore=null,stale=false;
const openDetails=new Set();
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('inventaire-shopping-local-v1'):null;
const panel=node('div',undefined,'sm-scope');panel.id='sm-scope';
const actions=node('div',undefined,'sm-actions');
const addButton=button(w().add,()=>openImport());addButton.id='sm-add';
const exportButton=button(w().export,()=>{
 if(!state)return;const url=URL.createObjectURL(new Blob([JSON.stringify({format:'inventaire-shopping-local',version:1,state},null,2)],{type:'application/json'}));
 const a=node('a');a.href=url;a.download='courses-ajouts-locaux-v1.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});exportButton.id='sm-export';
const restoreButton=button('',()=>restoreDialog.open());restoreButton.id='sm-restore';actions.append(addButton,exportButton,restoreButton);
const scopeText=node('p',w().loading),status=node('p');status.id='sm-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(scopeText,actions,status);
document.getElementById('shopping-list-view').before(panel);
const overlay=node('div',undefined,'modal-overlay hidden sm-overlay');overlay.id='sm-modal';
const modal=node('div',undefined,'modal sm-modal');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','sm-title');
const head=node('div',undefined,'modal-header'),title=node('h3');title.id='sm-title';head.append(title,button('✕',()=>close()));head.lastChild.setAttribute('aria-label',w().cancel);
const body=node('div',undefined,'modal-body'),input=node('textarea');input.id='sm-text';input.maxLength=20000;
const inputLabel=label(w().text,input),preview=node('div');preview.id='sm-preview';
const previewButton=button(w().preview,()=>prepare());previewButton.id='sm-prepare';
const reevaluate=button(w().reevaluate,async()=>{await reload();capture();choices={};stale=false;renderPreview();});reevaluate.id='sm-reevaluate';
const formError=node('p');formError.id='sm-error';formError.setAttribute('role','alert');
const footer=node('div',undefined,'modal-footer'),validate=button(w().validate,()=>save());validate.id='sm-validate';
footer.append(button(w().cancel,()=>close()),reevaluate,validate);body.append(inputLabel,previewButton,formError,preview);modal.append(head,body,footer);overlay.append(modal);document.body.append(overlay);
const restoreDialog=createRestoreDialog({read:()=>store.read(),products:host.products,language:host.language,
 commit:async(revision,operationId,signature,next)=>{
  const result=await store.commit(revision,operationId,signature,next);state=result.state;
  status.textContent=w().restored;channel?.postMessage({revision:state.revision});host.render();return result;
 }});

function header(){
 scopeText.textContent=state?w().scope:w().loading;addButton.textContent=w().add;exportButton.textContent=w().export;addButton.disabled=!state||busy;exportButton.disabled=!state;
 restoreButton.textContent=w().restore;restoreButton.disabled=!state||busy;
 const copy=document.querySelector('[onclick="copyShopping()"]'),print=document.querySelector('[onclick="printShopping()"]');
 if(copy)copy.textContent=host.copyLabel();
 if(print)print.textContent=host.printLabel();
}
function capture(){draftState=structuredClone(state);draftProducts=host.products();draftSignature=inventorySignature(draftProducts);}
async function reload(){state=await store.read();header();}
async function changed(){await reload();restoreDialog.changed();if(!overlay.classList.contains('hidden')){stale=true;formError.textContent=errorText('conflict');validate.disabled=true;}host.render();}
if(channel)channel.onmessage=()=>changed().catch(()=>{status.textContent=w().unavailable;});
window.addEventListener('focus',()=>{if(store)store.read().then(next=>{if(state&&next.revision!==state.revision)return changed();}).catch(()=>{});});
function open(){focusBefore=document.activeElement;overlay.classList.remove('hidden');formError.textContent='';stale=false;capture();head.lastChild.setAttribute('aria-label',w().cancel);footer.firstChild.textContent=w().cancel;reevaluate.textContent=w().reevaluate;}
async function openImport(edit=null){
 if(!state)return;await reload();open();reviewId=null;rows=[];choices={};batchId=id();title.textContent=w().title;
 inputLabel.hidden=false;previewButton.hidden=false;input.value='';inputLabel.firstChild.textContent=w().text;previewButton.textContent=w().preview;validate.textContent=w().validate;
 if(edit){
  const line=state.lines.find(l=>l.id===edit.lineId),c=line?.contributions.find(c=>c.id===edit.id&&c.active);if(!c){close();return;}
  rows=[{id:id(),editId:c.id,batchId,name:c.name,aliasName:c.name,raw:c.name,quantity:c.quantity,unit:c.unit,unitExplicit:true,ambiguous:false,productId:line.productId,candidates:[],distinctFree:!!line.distinctFree,requiresAssociation:!!line.productId&&!draftProducts.some(p=>p.id===line.productId)}];
  inputLabel.hidden=true;previewButton.hidden=true;
 }
 renderPreview();setTimeout(()=>{(edit?preview.querySelector('input'):input)?.focus();},0);
}
function close(){if(busy)return;overlay.classList.add('hidden');const key=focusBefore?.dataset.focusKey;const current=key?[...document.querySelectorAll('[data-focus-key]')].find(e=>e.dataset.focusKey===key):focusBefore;(current?.isConnected?current:addButton).focus();}
overlay.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.preventDefault();close();}
 if(event.key==='Tab'){
  const controls=[...overlay.querySelectorAll('button,input,select,textarea')].filter(e=>!e.disabled&&e.getClientRects().length);
  const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
});
function prepare(){
  try{capture();batchId=id();rows=parseList(input.value,draftProducts,state.aliases).map(r=>({...r,unit:host.language()==='de'&&!r.productId&&!r.unitExplicit&&r.unit==='article'?'Artikel':r.unit,batchId}));choices={};stale=false;renderPreview();}
 catch(e){formError.textContent=errorText(e.code);validate.disabled=true;}
}
function invalidate(){choices={};for(const radio of preview.querySelectorAll('input[type=radio]'))radio.checked=false;validate.disabled=true;}
function renderPreview(){
 preview.replaceChildren();formError.textContent=stale?errorText('conflict'):'';validate.disabled=!rows.length||stale;
 if(reviewId){renderReview();return;}
 const repeated=state.operations.some(op=>{try{const s=JSON.parse(op.signature);return s.kind==='import'&&s.source===normalizeName(input.value);}catch{return false;}});
 if(repeated)preview.append(node('p',w().repeat,'sm-note'));
 let plan;try{plan=planBatch(draftState,draftProducts,rows,choices);}catch(e){formError.textContent=errorText(e.code||'invalid');validate.disabled=true;return;}
 rows.forEach((row,index)=>{
  const section=node('section',undefined,'sm-preview-row');section.dataset.rowId=row.id;section.append(node('strong',String(index+1)));
  if(row.editId)section.append(node('p',w().edited,'sm-note'));
  if(row.requiresAssociation)section.append(node('p',w().missing,'sm-error'));
  const fields=node('div',undefined,'sm-fields');
  for(const [key,text]of [['name',w().name],['quantity',w().quantity],['unit',w().unit]]){
   const field=node('input');field.type='text';field.value=row[key];field.dataset.field=key;if(key==='quantity')field.inputMode='decimal';
   field.addEventListener('input',()=>{row[key]=field.value;row.ambiguous=false;if(key==='unit')row.unitExplicit=true;invalidate();});
   field.addEventListener('change',()=>{
    if(key==='name'&&!row.requiresAssociation){
     const match=matchProduct(row.name,draftProducts,state.aliases);row.productId=match.product?.id||null;row.candidates=match.candidates||[];row.distinctFree=false;
     if(!row.unitExplicit)row.unit=match.product?.unit||'article';
    }renderPreview();
   });fields.append(label(text,field));
  }section.append(fields);
  if(row.kind==='default')section.append(node('p',w().default,'sm-note'));
  if(/oeuf|eier/.test(normalizeName(row.name)))section.append(node('p',w().eggs,'sm-note'));
  const select=node('select');select.dataset.field='productId';const free=node('option',w().free);free.value='';select.append(free);
  for(const product of draftProducts){const option=node('option',product.name);option.value=product.id;select.append(option);}
  if(row.requiresAssociation){const missing=node('option',w().chooseAssociation);missing.value='__missing__';missing.disabled=true;select.prepend(missing);select.value='__missing__';}else select.value=row.productId||'';
  const associate=productId=>{row.requiresAssociation=false;row.productId=productId||null;row.distinctFree=!productId;if(productId&&!row.unitExplicit)row.unit=draftProducts.find(p=>p.id===productId).unit;invalidate();renderPreview();};
  select.addEventListener('change',()=>associate(select.value));section.append(label(w().product,select));
  if(!row.productId)for(const p of row.candidates||[])section.append(button(w().suggest+p.name+' — '+w().associate,()=>associate(p.id)));
  if(row.productId){const remember=node('input');remember.type='checkbox';remember.checked=!!row.rememberAlias;remember.addEventListener('change',()=>{row.rememberAlias=remember.checked;});section.append(label(w().alias,remember));}
  const step=plan.steps[index];
  if(!step)section.append(node('p',w().blocked,'sm-note'));
  else if(step.duplicate){
   const set=node('fieldset',undefined,'sm-choice');set.append(node('legend',`${w().current} : ${step.current} ${step.unit} · ${w().incoming} : ${step.incoming} ${step.unit}`));
   for(const [choice,text,value]of [['keep',w().keep,step.current],['set_total',w().total,step.incoming],['add_extra',w().extra,null]]){
    const radio=node('input');radio.type='radio';radio.name='choice-'+row.id;radio.value=choice;radio.checked=choices[row.id]===choice;
    if(choice==='keep'&&row.editId)radio.disabled=true;
    radio.addEventListener('change',()=>{choices[row.id]=choice;renderPreview();});
    set.append(label(`${text}${value!==null?' : '+value+' '+step.unit:' : +'+step.incoming+' '+step.unit}`,radio));
   }section.append(set);
   if(step.total!==undefined)section.append(node('p',`${w().total} : ${step.total} ${step.unit}`));
  }
  if(step?.error)section.append(node('p',errorText(step.error),'sm-error'));
  section.append(button(w().remove,()=>{rows.splice(index,1);choices={};renderPreview();}));preview.append(section);
 });
 validate.disabled=!rows.length||!!plan.error||stale;
 if(!plan.error&&rows.length&&!stale)formError.textContent=w().ready;
}
async function save(){
 if(busy||!draftState)return;
 try{
  if(stale)throw {code:'conflict'};
  if(draftSignature!==inventorySignature(host.products()))throw {code:'inventory'};
  let next,signature;
  if(reviewId){next=reviewTotal(draftState,draftProducts,reviewId,document.getElementById('sm-review-total').value);signature=JSON.stringify({kind:'review',lineId:reviewId,quantity:document.getElementById('sm-review-total').value});}
  else{const plan=planBatch(draftState,draftProducts,rows,choices);if(plan.error)throw {code:plan.error};next=plan.next;signature=JSON.stringify({kind:'import',source:normalizeName(input.value),rows:rows.map(({id,editId,productId,name,aliasName,quantity,unit,distinctFree,rememberAlias})=>({id,editId,productId,name,aliasName,quantity,unit,distinctFree,rememberAlias})),choices});}
  busy=true;validate.disabled=true;const result=await store.commit(draftState.revision,batchId,signature,next);state=result.state;
  busy=false;status.textContent=w().saved;channel?.postMessage({revision:state.revision});host.render();close();
 }catch(e){busy=false;formError.textContent=errorText(e.code||e.message);if(e.code==='conflict'||e.code==='inventory')stale=true;validate.disabled=stale;}
}
async function action(change){
 if(busy)return;const before=state,focusKey=document.activeElement?.dataset.focusKey;busy=true;
 try{const next=change(before);const changes=next.lines.filter(l=>JSON.stringify(l)!==JSON.stringify(before.lines.find(old=>old.id===l.id))).map(l=>({id:l.id,entries:l.contributions.map(c=>[c.id,c.revision,c.active,c.checked])}));const result=await store.commit(before.revision,id(),JSON.stringify({kind:'change',changes}),next);state=result.state;status.textContent=w().saved;channel?.postMessage({revision:state.revision});}
 catch(e){status.textContent=errorText(e.code||'storage');await reload();}
 finally{busy=false;host.render();if(focusKey)[...document.querySelectorAll('[data-focus-key]')].find(e=>e.dataset.focusKey===focusKey)?.focus();}
}
function openReview(line){
 open();reviewId=line.id;batchId=id();rows=[];title.textContent=w().reviewTitle;inputLabel.hidden=true;previewButton.hidden=true;validate.textContent=w().confirmTotal;renderReview();
}
function renderReview(){
 preview.replaceChildren();const line=draftState.lines.find(l=>l.id===reviewId);if(!line||!active(line).length){formError.textContent=errorText('conflict');validate.disabled=true;return;}
 let view;try{view=project(line,draftProducts);}catch{formError.textContent=errorText('units');validate.disabled=true;return;}
 preview.append(node('p',`${line.name} · ${w().last} : ${view.quantity} ${line.unit}`));
 if(view.automatic?.present)preview.append(node('p',`${w().auto} : ${view.automatic.quantity} ${view.automatic.unit}`));
 for(const c of active(line))preview.append(node('p',`${c.name} : ${c.quantity} ${c.unit}`));
 const field=node('input');field.id='sm-review-total';field.type='text';field.inputMode='decimal';preview.append(label(w().quantity,field));validate.disabled=stale;
}
function card(row,mode){
 const {product,line,view,auto,checks}=row;
 const item=node('div',undefined,'shopping-item sm-cart');if(product){item.id='sm-'+mode+'-'+product.id;item.dataset.productId=product.id;}if(line)item.dataset.lineId=line.id;
 const cs=line?active(line):[];const head=node('div',undefined,'sm-line-head');
 if(auto?.present)item.classList.add(auto.suggested?'suggested':globalThis.InventoryStock.getStatus(product)==='low'?'urgent':'needed');
 const check=node('input');check.type='checkbox';check.setAttribute('aria-label',w().checked);
 check.dataset.focusKey='line:'+(line?.id||product?.id)+':'+mode;
 check.checked=checks.checked;check.indeterminate=checks.indeterminate;
 check.setAttribute('aria-checked',checks.indeterminate?'mixed':String(checks.checked));
 if(row.needsReview)check.disabled=true;
 if(line){check.addEventListener('change',()=>action(s=>checkLine(s,line.id,auto,check.checked)));}
 else if(product){check.id='sm-auto-'+mode+'-'+product.id;check.addEventListener('change',()=>{host.toggleCheck(product.id,check);check.setAttribute('aria-checked',String(check.checked));});}
 const name=node('label',product?.name||line.name);if(check.id)name.htmlFor=check.id;else {check.id='sm-check-'+id();name.htmlFor=check.id;}
 head.append(check,name,node('span',`${row.quantity} ${row.unit}`,'sm-amount'));item.append(head);
 if(checks.checked)item.classList.add('checked');
 const origins=[];if(auto?.present)origins.push(`${auto.suggested?w().suggested:w().auto} : ${auto.quantity} ${auto.unit}`);if(cs.length)origins.push(w().local);
 item.append(node('p',origins.join(' · '),'sm-provenance'));
 if(view?.missingProduct)item.append(node('p',w().missing,'sm-error'));
 else if(view?.needsReview)item.append(node('p',w().review,'sm-error'),button(w().reviewAction,()=>openReview(line)));
 if(cs.length){
  const details=node('details');details.dataset.lineId=line.id;details.open=!!view?.missingProduct||openDetails.has(line.id);details.append(node('summary',w().details));
  details.append(node('p',w().checkMeaning,'sm-note'));
  if(auto?.present){
   const ac=node('input');ac.type='checkbox';ac.checked=checks.automaticChecked;ac.dataset.focusKey='auto:'+line.id;
   ac.addEventListener('change',()=>action(s=>checkAutomatic(s,line.id,auto,ac.checked)));
   details.append(label(`${w().auto} : ${auto.quantity} ${auto.unit}`,ac));
  }
  for(const c of cs){
   const box=node('div',undefined,'sm-contribution'),cb=node('input');cb.type='checkbox';cb.checked=c.checked;cb.dataset.focusKey='entry:'+c.id;cb.addEventListener('change',()=>action(s=>toggleContribution(s,line.id,c.id,cb.checked)));
   const edit=button(view?.missingProduct?w().resolve:w().edit,()=>openImport({lineId:line.id,id:c.id}));edit.dataset.focusKey='edit:'+c.id;
   box.append(label(`${c.name} · ${c.quantity} ${c.unit}`,cb),edit,button(w().remove,()=>action(s=>removeContribution(s,line.id,c.id))));details.append(box);
  }details.append(node('p',w().partial,'sm-note'));item.append(details);
 }else if(mode==='shop'&&product)item.append(button(host.buyLabel(),()=>host.openBuy(product.id)));
 return item;
}
function currentRows(){
 const cart=state||{lines:[]},context=host.shoppingContext(),legacyShop=context.view==='shop'&&!cart.lines.some(l=>active(l).length||l.autoCheck);
 return shoppingRows(cart,host.products(),{autoChecks:host.autoChecks(),aisleIndex:host.aisleIndex,
  ...(legacyShop?{productIds:context.snapshot,doneIds:context.done}:{})});
}
function render(targetId,mode){
 header();if(!state||!state.lines.some(l=>active(l).length||l.autoCheck))return false;
 const target=document.getElementById(targetId);for(const d of target.querySelectorAll('details[data-line-id]')){if(d.open)openDetails.add(d.dataset.lineId);else openDetails.delete(d.dataset.lineId);}target.replaceChildren();
 const rows=currentRows(),regular=rows.filter(r=>!r.suggested),suggested=rows.filter(r=>r.suggested);
 if(!rows.length){target.append(node('p',w().empty));return true;}
 const append=(items,parent)=>{
  let last=null;for(const item of items){if(item.aisle!==last){parent.append(node('div',host.aisleLabel(item.aisle),'shopping-section-title'));last=item.aisle;}parent.append(card(item,mode));}
 };
 append(regular,target);if(suggested.length){const section=node('div',undefined,'anticipate-section');section.append(node('div',w().suggested,'shopping-section-title'));append(suggested,section);target.append(section);}
 return true;
}
let copyFallback=null;
function copy(){
 const text=shoppingText(currentRows(),host.language(),host.aisleLabel);
 const fallback=()=>{
  if(!copyFallback){copyFallback=node('textarea');copyFallback.readOnly=true;copyFallback.className='sm-copy-fallback';panel.append(copyFallback);}
  copyFallback.setAttribute('aria-label',w().copyFallback);copyFallback.value=text;copyFallback.hidden=false;copyFallback.focus();copyFallback.select();status.textContent=w().copyFallback;
 };
 if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>{status.textContent=w().copied;if(copyFallback)copyFallback.hidden=true;}).catch(fallback);
 else fallback();
 return true;
}
function buildPrint(){
 const area=document.getElementById('print-area'),rows=currentRows();area.replaceChildren(node('h1',outputWords(host.language()).title,'print-title'));
 let last=null;for(const row of rows){
  const group=Number(row.suggested)+':'+row.aisle;
  if(group!==last){area.append(node('h2',(row.suggested?w().suggested+' · ':'')+host.aisleLabel(row.aisle),'print-aisle'));last=group;}
  area.append(node('div',rowText(row,host.language()),'print-item sm-print-item'));
 }
 if(!rows.length)area.append(node('p',w().empty));
 return true;
}
window.ManualShopping={render:()=>render('shopping-list-content','list'),renderShop:()=>render('shopping-mode-content','shop'),copy,buildPrint};
try{store=await indexedStore();await reload();host.render();}catch{state=null;scopeText.textContent=w().unavailable;addButton.disabled=true;exportButton.disabled=true;restoreButton.disabled=true;}

}
