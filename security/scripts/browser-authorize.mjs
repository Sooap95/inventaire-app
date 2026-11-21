// Pont de recette pour la procédure administrative revue, jamais servi au navigateur.
import {withAdmin} from '../src/emulator-admin.mjs';
import {prepareDeviceAuthorization,applyDeviceAuthorization} from '../src/device-admin.mjs';
const [uid,action]=process.argv.slice(2);
await withAdmin(async db=>{const plan=await prepareDeviceAuthorization(db,{uid,action,label:'Appareil fictif de recette'});await applyDeviceAuthorization(db,plan,plan.checksum);});
