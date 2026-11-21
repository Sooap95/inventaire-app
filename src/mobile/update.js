export async function setupMobileWorker(notify){
 if(!('serviceWorker'in navigator)){notify('worker-unavailable');return;}
 try{
  const registration=await navigator.serviceWorker.register('sw.js',{updateViaCache:'none'});
  const waiting=()=>{if(registration.waiting&&navigator.serviceWorker.controller)notify('update-waiting');};waiting();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',waiting));
 }catch{notify('worker-unavailable');}
}
export async function uninstallMobileWorker(){
 if(window.FAMILY_LAB_CONFIG?.mode!=='ui-fixture')throw Error('FIXTURE_ONLY');
 for(const r of await navigator.serviceWorker.getRegistrations())if(r.scope===new URL('./',location.href).href&&[r.active,r.waiting,r.installing].some(w=>w?.scriptURL===new URL('sw.js',location.href).href))await r.unregister();
 for(const key of await caches.keys())if(key.startsWith('inventaire-mobile-ui-'))await caches.delete(key);
}
