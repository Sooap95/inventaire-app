// Façade publique historique : aucune cible cloud acceptée.
import {assertEmulator} from './contracts.mjs';
import {emulatorPolicy} from './target-policy.mjs';
import {familyWriterCore} from './family-writer-core.mjs';
export function familyWriter(db,uid){
 assertEmulator(db);const write=familyWriterCore(db,uid,emulatorPolicy());
 return command=>{assertEmulator(db);return write(command);};
}
