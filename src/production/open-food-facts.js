// Historical OFF API and guessAisle mapping, with stale-response protection.
// Suggestions only: Save still uses the confirmed family operation journal.
let offGeneration=0,offSearchGeneration=0;
const offProductCache=new Map(),oldOffReset=offReset,oldOffSelect=offSelect;
document.getElementById('f-barcode').removeEventListener('change',offBarcodeLookup);
offReset=function(){offGeneration++;offSearchGeneration++;clearTimeout(offNameTimer);oldOffReset();};
function guessCategory(tags){
 if(!Array.isArray(tags))return '';
 const has=(...values)=>values.some(v=>tags.includes(v));
 if(has('en:baby-foods','en:baby-milks','en:infant-formulas'))return 'Bébé';
 if(has('en:dietary-supplements','en:food-supplements'))return 'Pharmacie';
 if(has('en:hygiene-products','en:personal-care'))return 'Hygiène';
 if(has('en:cleaning-products','en:household-products'))return 'Ménager';
 if(guessAisle(tags)&&!has('en:pet-foods'))return 'Alimentation';
 return '';
}
function offName(pr){return (currentLang==='de'?pr.product_name_de:pr.product_name_fr)||pr.product_name||pr.brands||'';}
async function offFetchProduct(code){
 if(!window.FamilyApp?.allowProductAction()||!window.FamilyApp?.externalLookup()||!navigator.onLine)return null;
 if(offProductCache.has(code))return offProductCache.get(code);
 const response=await fetch('https://world.openfoodfacts.org/api/v2/product/'+encodeURIComponent(code)+'.json?fields=product_name,product_name_fr,product_name_de,brands,categories_tags&lc='+currentLang,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('OFF_UNAVAILABLE');
 const data=await response.json(),product=data?.status===1?data.product:null;
 if(offProductCache.size>=30)offProductCache.delete(offProductCache.keys().next().value);
 offProductCache.set(code,product);return product;
}
offBarcodeLookup=async function(){
 if(!window.FamilyApp?.externalLookup())return;
 const code=document.getElementById('f-barcode').value.trim(),name=document.getElementById('f-name');
 if(!/^\d{8,13}$/.test(code)||name.value.trim()||!navigator.onLine)return;
 const token=++offGeneration,category=document.getElementById('f-cat').value,spinner=document.getElementById('off-spinner');
 const current=()=>token===offGeneration&&document.getElementById('f-barcode').value.trim()===code&&!document.getElementById('product-modal').classList.contains('hidden');
 spinner.classList.add('show');setOffBanner('','');
 try{const product=await offFetchProduct(code);if(!current())return;
  if(!product){setOffBanner(t('off_not_found'),'warn');return;}if(name.value.trim())return;
  if(!name.value.trim())name.value=offName(product);
  const notes=document.getElementById('f-notes');if(product.brands&&product.brands!==name.value&&!notes.value.trim())notes.value=product.brands;
  const aisle=guessAisle(product.categories_tags);if(aisle&&!document.getElementById('f-aisle').value)document.getElementById('f-aisle').value=aisle;
  const guess=guessCategory(product.categories_tags);if(guess&&document.getElementById('f-cat').value===category)document.getElementById('f-cat').value=guess;
  setOffBanner(t('off_found'),'ok');showOffCredit();
 }catch{if(current())setOffBanner(t('off_unavailable'),'warn');}
 finally{if(token===offGeneration)spinner.classList.remove('show');}
};
offSearchName=async function(q){
 if(!window.FamilyApp?.externalLookup()||!window.FamilyApp.allowProductAction()||!navigator.onLine)return;
 const token=++offSearchGeneration,generation=offGeneration;
 try{const response=await fetch('https://world.openfoodfacts.org/cgi/search.pl?search_terms='+encodeURIComponent(q)+'&search_simple=1&json=1&page_size=6&fields=product_name,product_name_fr,product_name_de,brands,code,categories_tags,quantity&lc='+currentLang+'&cc=ch',{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('OFF_UNAVAILABLE');const data=await response.json();
  if(token===offSearchGeneration&&generation===offGeneration&&document.getElementById('f-name').value.trim()===q&&!document.getElementById('product-modal').classList.contains('hidden'))renderOffDropdown(data.products||[]);
 }catch{if(token===offSearchGeneration)closeOffDropdown();}
};
offSelect=function(pr){oldOffSelect(pr);const category=guessCategory(pr?.categories_tags);if(category)document.getElementById('f-cat').value=category;offSearchGeneration++;};
async function lookupScannedBarcode(code,sequence){
 try{const pr=await offFetchProduct(code);if(!pr||sequence!==barcodeSequence||document.getElementById('barcode-manual-code').value!==code||document.getElementById('scan-modal').classList.contains('hidden'))return;
  const category=guessCategory(pr.categories_tags);document.getElementById('barcode-result').textContent=barcodeWords().code+' : '+code+' — '+[offName(pr),pr.brands,category?catLabel(category):''].filter(Boolean).join(' · ')+' · Open Food Facts';
 }catch{/* The recognized code and manual entry remain usable offline/on failure. */}
}
// Listener references installed by historical code must use the guarded versions.
document.getElementById('f-barcode').addEventListener('change',()=>offBarcodeLookup());
