// Façade publique historique : strictement émulateur, y compris les reprises.
import {assertEmulator} from './contracts.mjs';
import {emulatorPolicy} from './target-policy.mjs';
import {basicWriterCore} from './basic-writer-core.mjs';
export function emulatorWriter(db,uid){
 assertEmulator(db);const write=basicWriterCore(db,uid,emulatorPolicy());
 return command=>{assertEmulator(db);return write(command);};
}
