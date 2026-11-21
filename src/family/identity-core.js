// Cycle Auth commun. Les façades imposent leurs gardes avant toute opération SDK.
import {initializeApp,deleteApp} from 'firebase/app';
import {initializeAuth,indexedDBLocalPersistence,setPersistence,onAuthStateChanged,signInAnonymously} from 'firebase/auth';
export function identityController({check,config,name,connect,lockName}){
 if(typeof check!=='function'||typeof config!=='function'||typeof connect!=='function'||!name||!lockName)throw Error('explicit-identity-policy-required');
 let instance,pending;
 async function start(changed,error){
  check();
  const initialize=async()=>{
   check();if(instance)return instance;if(pending)return pending;
   pending=(async()=>{
    check();const options=config();check();const app=initializeApp(options,name);let stop,closed=false;
    try{
     check();const auth=initializeAuth(app,{persistence:indexedDBLocalPersistence});check();connect(auth);check();
     await auth.authStateReady();check();await setPersistence(auth,indexedDBLocalPersistence);check();
     let busy=false,oldUid;
     const ensure=async()=>{
      if(busy||closed)return;busy=true;try{
       check();if(!auth.currentUser){check();await signInAnonymously(auth);check();}
       if(!auth.currentUser?.isAnonymous)throw Error('anonymous-identity-required');
      }catch(e){error(e);}finally{busy=false;}
     };
     check();stop=onAuthStateChanged(auth,user=>{
      if(closed)return;try{check();}catch(e){error(e);return;}
      if(!user){if(oldUid){oldUid=null;changed({app,uid:null});queueMicrotask(()=>ensure());}return;}
      if(!user.isAnonymous){error(Error('anonymous-identity-required'));return;}
      if(oldUid===user.uid)return;oldUid=user.uid;changed({app,uid:user.uid});
     },error);
     instance={app,auth,ensure,close:async()=>{closed=true;stop?.();await deleteApp(app);instance=null;}};
     await ensure();check();return instance;
    }catch(e){closed=true;stop?.();await deleteApp(app);instance=null;throw e;}
   })();try{return await pending;}finally{pending=null;}
  };
  return globalThis.navigator?.locks?.request?navigator.locks.request(lockName,initialize):initialize();
 }
 return {start};
}
