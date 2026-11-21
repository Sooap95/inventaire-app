// Distribution émulateur : les protections de phase 5 restent dans ces adaptateurs.
import {deviceIdentity} from './identity.js';
import {deviceTransport} from './transport.js';
import {indexedStore} from './store.js';
export const runtimeInfo={kind:'emulator',simulated:false,media:false,externalLookup:false};
export const startIdentity=deviceIdentity;
export const createTransport=deviceTransport;
export const createStore=indexedStore;
export function mountRuntimeControls(){}
