import {assertProductionContext} from './target.js';
const message=document.createElement('p');message.id='production-status';message.setAttribute('role','status');document.querySelector('header').after(message);
try{assertProductionContext(window.PRODUCTION_BINDING);await import('./app.bundle.js');message.remove();}
catch{message.textContent='Connexion indisponible. Les données restent conservées. Recharger avec le réseau. / Verbindung nicht verfügbar. Daten bleiben erhalten. Mit Netzwerk neu laden.';}
if('serviceWorker' in navigator){
 try{const registration=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});const notice=()=>{if(!registration.waiting||!navigator.serviceWorker.controller)return;message.textContent='Mise à jour prête : fermer tous les onglets Inventaire puis rouvrir. / Update bereit: alle Inventar-Tabs schließen und erneut öffnen.';document.querySelector('header').after(message);};notice();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',notice));}
 catch{/* Online app remains available. Offline cache is never claimed as installed. */}
}
