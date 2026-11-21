import {getFirestore} from 'firebase/firestore';
import {identityController} from '../family/identity-core.js';
import {transportCore} from '../family/transport-core.js';
import {indexedStore} from '../family/store.js';
import {productionPolicy} from './policy.mjs';
import {assertProductionContext,assertProductionDatabase} from './target.js';
export const runtimeInfo={kind:'production',simulated:false,diagnostics:false,media:true,barcodeScanner:true,externalLookup:true};
export const createStore=()=>indexedStore('inventaire-production-intentions-v02');
const binding=()=>assertProductionContext(window.PRODUCTION_BINDING),check=()=>{binding();};
// Retain historical Firebase Auth persistence for this API key and default app.
const identity=identityController({check,config:()=>binding().firebase,name:'[DEFAULT]',lockName:'inventaire-production-identity',connect:()=>check()});
export const startIdentity=(changed,error)=>{check();return identity.start(changed,error);};
export function createTransport(app,uid){check();const p=binding(),db=getFirestore(app,p.databaseId);assertProductionDatabase(db,p);return transportCore(db,uid,productionPolicy(p));}
export function mountRuntimeControls(){}
