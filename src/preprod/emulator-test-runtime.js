// Uniquement pour les tests locaux ; interdit dans le ZIP niveau 2.
import {deviceIdentity} from '../family/identity.js';
import {deviceTransport} from '../family/transport.js';
import {indexedStore} from '../family/store.js';
export const runtimeInfo={kind:'preprod-emulator-test',simulated:false,diagnostics:true,media:false,externalLookup:false};
export const startIdentity=deviceIdentity;
export const createTransport=deviceTransport;
export const createStore=()=>indexedStore('inventaire-preprod-test-intentions-v1');
export function mountRuntimeControls(){}
