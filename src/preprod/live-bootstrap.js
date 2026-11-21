import {assertLiveContext} from './live-target.js';
import {setupPreprodWorker,uninstallPreprodWorker} from './update.js';
const message=document.createElement('p');message.id='preprod-gate-status';message.setAttribute('role','status');document.querySelector('header').after(message);
message.style.cssText='margin:8px 10px;padding:10px 12px;border:1px solid #f7e2e8;border-radius:12px;color:#174c3b;font-size:14px;line-height:1.4';
const add=document.querySelector('header [onclick="openAddModal()"]');add?.setAttribute('disabled','');
const start=document.createElement('button');start.id='preprod-start-profile';start.type='button';start.style.minHeight='44px';start.style.maxWidth='100%';
start.className='btn btn-primary';start.style.margin='0 10px 8px';start.style.maxWidth='calc(100% - 20px)';
message.after(start);
let loading=false;
async function begin(){
 if(loading)return;loading=true;start.disabled=true;
 try{assertLiveContext(window.PREPROD_BINDING);localStorage.setItem('inventaire-preprod-profile-started','1');message.hidden=true;start.hidden=true;message.style.display='none';start.style.display='none';await import('./preprod.bundle.js');}
 catch(e){message.hidden=false;start.hidden=false;message.style.display='';start.style.display='';message.dataset.code=e.code==='target-policy-denied'?e.message:'LIVE_START_REFUSED';gateState='error';translate();}
 finally{loading=false;start.disabled=false;}
}
try{
 assertLiveContext(window.PREPROD_BINDING);
 start.onclick=begin;
 if(localStorage.getItem('inventaire-preprod-profile-started')==='1')queueMicrotask(()=>void begin());
}catch(e){start.disabled=true;message.dataset.code=e.code==='target-policy-denied'?e.message:'LIVE_CONTEXT_REFUSED';}
const tools=document.createElement('details'),summary=document.createElement('summary'),link=document.createElement('a'),remove=document.createElement('button'),worker=document.createElement('p');
link.href='guide';remove.type='button';remove.className='btn btn-outline btn-sm';remove.id='preprod-uninstall';remove.style.minHeight='44px';tools.style.cssText='margin:0 10px 8px;font-size:14px';
summary.style.minHeight='44px';summary.style.cursor='pointer';link.style.display='block';link.style.minHeight='44px';
const version=document.createElement('a');version.href='release.json';version.textContent='Version du paquet / Paketversion';version.style.display='block';version.style.minHeight='44px';
remove.onclick=async()=>{if(confirm('Retirer le cache de préproduction ? Intentions conservées. / Testcache entfernen? Absichten bleiben erhalten.')){await uninstallPreprodWorker();worker.textContent='Cache retiré ; intentions conservées. / Cache entfernt; Absichten bleiben erhalten.';}};
tools.append(summary,link,version,remove,worker);start.after(tools);
let gateState=message.dataset.code?'refused':'waiting';
function translate(){const de=window.familyHost?.language()==='de';start.textContent=de?'Browserprofil identifizieren':'Identifier ce profil';summary.textContent=de?'Testwerkzeuge':'Outils de préproduction';link.textContent=de?'Anleitung':'Guide';version.textContent=de?'Paketversion':'Version du paquet';remove.textContent=de?'Nur Testcache entfernen':'Retirer uniquement le cache';message.textContent=gateState==='refused'?(de?'Konfiguration oder Ursprung abgelehnt.':'Configuration ou origine refusée.'):gateState==='error'?(de?'Verbindung nicht verfügbar. Absichten bleiben erhalten. Mit Netzwerk erneut versuchen.':'Connexion indisponible : intentions conservées. Réessayer avec le réseau.'):(de?'VORPRODUKTION · Kein Inventarzugriff ohne Freigabe. Nur für den freigegebenen Test identifizieren.':'PRÉPRODUCTION · Aucun inventaire accessible avant autorisation. Identifier ce profil uniquement pour la recette approuvée.');}
document.addEventListener('inventaire-language',translate);translate();
setupPreprodWorker(code=>{worker.textContent=code==='update-waiting'?'Mise à jour : fermer tous les onglets de recette. / Update: alle Test-Tabs schließen.':'Cache hors ligne non confirmé. / Offline-Cache nicht bestätigt.';});
