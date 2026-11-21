import {getFirestore} from 'firebase/firestore';
import {identityController} from '../family/identity-core.js';
import {transportCore} from '../family/transport-core.js';
import {indexedStore} from '../family/store.js';
import {livePreprodPolicy} from '../../security/src/target-policy.mjs';
import {assertLiveContext,assertLiveDatabase} from './live-target.js';
export const runtimeInfo={kind:'preprod',simulated:false,diagnostics:true,media:false,barcodeScanner:true,externalLookup:false};
export const createStore=()=>indexedStore('inventaire-preprod-intentions-v1');
const binding=()=>assertLiveContext(window.PREPROD_BINDING);
const check=()=>{binding();};
const identity=identityController({check,config:()=>{const p=binding();return {projectId:p.projectId,...p.firebase};},name:'inventaire-preprod',lockName:'inventaire-preprod-identity',connect:()=>check()});
export const startIdentity=(changed,error)=>{check();return identity.start(changed,error);};
export function createTransport(app,uid){check();const p=binding(),db=getFirestore(app,p.databaseId);assertLiveDatabase(db,p);return transportCore(db,uid,livePreprodPolicy(p));}
export function mountRuntimeControls(){}
