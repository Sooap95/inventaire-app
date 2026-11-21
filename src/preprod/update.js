export async function setupPreprodWorker(notify){
 if(!('serviceWorker'in navigator)){notify('worker-unavailable');return;}
 try{const r=await navigator.serviceWorker.register('sw.js',{updateViaCache:'none'});const waiting=()=>{if(r.waiting&&navigator.serviceWorker.controller)notify('update-waiting');};waiting();r.addEventListener('updatefound',()=>r.installing?.addEventListener('statechange',waiting));}catch{notify('worker-unavailable');}
}
export async function uninstallPreprodWorker(){
 if(window.FAMILY_LAB_CONFIG?.mode!=='preprod')throw Error('PREPROD_ONLY');
 for(const r of await navigator.serviceWorker.getRegistrations())if(r.scope===new URL('./',location.href).href&&[r.active,r.waiting,r.installing].some(w=>w.scriptURL===new URL('sw.js',location.href).href))await r.unregister();
 for(const key of await caches.keys())if(key.startsWith('inventaire-preprod-'))await caches.delete(key);
}
