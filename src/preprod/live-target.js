import approved from '../../config/environments/preprod-a2-live.json' with {type:'json'};
import {PREPROD,TargetPolicyError,validateBinding} from './target.js';
export const LIVE_BINDING=Object.freeze({...approved,firebase:Object.freeze({...approved.firebase})});
const fail=code=>{throw new TargetPolicyError(code);};
export function validateLiveBinding(input){
 const p=validateBinding(input);
 if(p.firebase.appId!=='1:319106753418:web:1cb076d86ed9face859e73'||p.firebase.apiKey!==LIVE_BINDING.firebase.apiKey||p.firebase.authDomain!==LIVE_BINDING.firebase.authDomain)fail('LIVE_WEB_BINDING');
 return p;
}
export function assertLiveContext(input){
 const p=validateLiveBinding(input);
 if(globalThis.location?.origin!==PREPROD.origin||globalThis.location?.protocol!=='https:')fail('LIVE_ORIGIN');
 return p;
}
export function assertLiveDatabase(db,binding){
 const p=assertLiveContext(binding),instance=db?._delegate||db,options=instance?.app?.options;
 if(options?.projectId!==p.projectId||options?.appId!==p.firebase.appId||options?.apiKey!==p.firebase.apiKey||options?.authDomain!==p.firebase.authDomain||instance?._databaseId?.database!==p.databaseId||instance?._settings?.host!=='firestore.googleapis.com'||instance?._settings?.ssl!==true)fail('LIVE_DATABASE');
}
