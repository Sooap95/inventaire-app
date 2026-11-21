import {assertPreprodContext} from './target.js';
import {setupPreprodWorker,uninstallPreprodWorker} from './update.js';
// Refus avant chargement/initialisation du SDK et avant toute identification.
const message=document.createElement('p');message.id='preprod-gate-status';message.setAttribute('role','status');document.querySelector('header').after(message);
try{
 assertPreprodContext(window.PREPROD_BINDING);
 await import('./preprod.bundle.js');
}catch(e){
 message.textContent='PRÉPRODUCTION — A2-L : connexion cloud désactivée. Configuration Web à vérifier avant les phases autorisées. / VORPRODUKTION — A2-L: Cloud-Verbindung deaktiviert.';
 message.dataset.code=e.code==='target-policy-denied'?e.message:'PREPROD_START_REFUSED';
 document.querySelector('header [onclick="openAddModal()"]')?.setAttribute('disabled','');
}
const tools=document.createElement('details'),summary=document.createElement('summary'),link=document.createElement('a'),remove=document.createElement('button'),worker=document.createElement('p');
summary.textContent='Outils du paquet inactif / Werkzeuge';link.href='guide';link.textContent='Guide A2-L / Anleitung';remove.type='button';remove.textContent='Retirer le cache de préproduction / Testcache entfernen';remove.id='preprod-uninstall';
remove.onclick=async()=>{if(confirm('Retirer uniquement le cache de préproduction ? / Nur den Testcache entfernen?')){await uninstallPreprodWorker();worker.textContent='Cache retiré ; données locales conservées. / Cache entfernt; lokale Daten bleiben erhalten.';}};
tools.append(summary,link,remove,worker);message.after(tools);setupPreprodWorker(code=>{worker.textContent=code==='update-waiting'?'Nouvelle version : fermer tous les onglets de cette recette. / Alle Test-Tabs schließen.':'Cache hors ligne non confirmé. / Offline-Cache nicht bestätigt.';});
