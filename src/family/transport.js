// Façade historique Firestore : strictement démo/loopback, sans branche cloud.
import {getFirestore,connectFirestoreEmulator} from 'firebase/firestore';
import {PROJECT,assertEmulator} from '../../security/src/contracts.mjs';
import {emulatorPolicy} from '../../security/src/target-policy.mjs';
import {assertDeviceLab} from './identity.js';
import {validUid} from './state.js';
import {transportCore} from './transport-core.js';
export {jsonData} from './transport-core.js';
const databases=new WeakMap();
export function deviceTransport(app,uid){
 assertDeviceLab();if(!validUid(uid)||app.options.projectId!==PROJECT)throw Error('EMULATOR_ONLY');
 let db=databases.get(app);if(!db){db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8180);assertEmulator(db);databases.set(app,db);}
 assertEmulator(db);return transportCore(db,uid,emulatorPolicy());
}
