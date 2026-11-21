// A2-L : validation de liaison uniquement. L'exécution cloud reste fermée dans le code.
export const PREPROD=Object.freeze({projectId:'inventaire-v02-preprod-a1',projectNumber:'319106753418',databaseId:'(default)',location:'europe-west6',origin:'https://inventaire-maison-v02-recette-sync.pages.dev'});
export class TargetPolicyError extends Error{constructor(message){super(message);this.code='target-policy-denied';}}
const fail=code=>{throw new TargetPolicyError(code);};
export function validateBinding(input){
 const fields=['version','mode','projectId','projectNumber','databaseId','location','origin','firebase'];
 if(!input||Object.keys(input).length!==fields.length||!fields.every(k=>Object.hasOwn(input,k))||input.version!==1||input.mode!=='preprod')fail('PREPROD_CONFIG');
 for(const [key,value] of Object.entries(PREPROD))if(input[key]!==value)fail('PREPROD_BINDING');
 const f=input.firebase;
 if(!f||Object.keys(f).length!==3||!['apiKey','appId','authDomain'].every(k=>Object.hasOwn(f,k))||typeof f.apiKey!=='string'||!/^AIza[A-Za-z0-9_-]{35}$/.test(f.apiKey)||typeof f.appId!=='string'||!/^1:319106753418:web:[a-f0-9]{12,64}$/.test(f.appId)||f.authDomain!==PREPROD.projectId+'.firebaseapp.com')fail('PREPROD_WEB_APP_REQUIRED');
 return structuredClone(input);
}
export function assertPreprodContext(binding){
 validateBinding(binding);
 if(globalThis.location?.origin!==PREPROD.origin)fail('PREPROD_ORIGIN');
 // A2-C/D/S/P/A3 non autorisées. Aucun flag JSON/env ne peut ouvrir cette porte.
 fail('A2_L_CLOUD_DISABLED');
}
export function assertPreprodDatabase(db,binding){
 const p=validateBinding(binding),instance=db?._delegate||db,options=instance?.app?.options;
 if(options?.projectId!==p.projectId||options?.appId!==p.firebase.appId||options?.apiKey!==p.firebase.apiKey||options?.authDomain!==p.firebase.authDomain||instance?._databaseId?.database!==p.databaseId||instance?._settings?.host!=='firestore.googleapis.com'||instance?._settings?.ssl!==true)fail('PREPROD_DATABASE');
 assertPreprodContext(p);
}
