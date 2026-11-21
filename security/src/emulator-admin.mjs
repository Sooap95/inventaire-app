import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {PROJECT,EMULATOR,assertEmulator} from './contracts.mjs';
export function assertAdminLab(){
 if(process.env.FIRESTORE_EMULATOR_HOST!==EMULATOR||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_TOKEN)throw Error('EMULATOR_ADMIN_ONLY');
 for(const k of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[k]&&process.env[k]!==PROJECT)throw Error('EMULATOR_ADMIN_ONLY');
}
export async function withAdmin(fn){
 assertAdminLab();const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180}});
 try{let result;await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();assertEmulator(db);result=await fn(db);});return result;}finally{await env.cleanup();}
}
export async function fictionalAnonymousAccount(uid){
 assertAdminLab();const response=await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`,{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({localId:[uid]})});
 if(!response.ok)throw Error('auth-emulator-unavailable');const data=await response.json();
 const user=data.users?.find(u=>u.localId===uid);if(!user||user.email||user.phoneNumber||user.passwordHash||user.disabled||user.providerUserInfo?.length)throw Error('fictional-anonymous-account-required');
 return {uid:user.localId};
}
