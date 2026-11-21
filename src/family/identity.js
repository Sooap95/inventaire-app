// Façade historique Auth : les endpoints et contrôles d'émulation restent explicites.
import {connectAuthEmulator} from 'firebase/auth';
import {PROJECT} from '../../security/src/contracts.mjs';
import {identityController} from './identity-core.js';
export function assertDeviceLab(){
 if(!['127.0.0.1','localhost'].includes(location.hostname)||window.FAMILY_LAB_CONFIG?.projectId!==PROJECT)throw Error('EMULATOR_ONLY');
}
const controller=identityController({check:assertDeviceLab,config:()=>({projectId:PROJECT,apiKey:'fictional-emulator-key',appId:'fictional-family-lab'}),name:'family-device-lab',lockName:'inventaire-device-identity-init',connect:auth=>{assertDeviceLab();connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});}});
export function deviceIdentity(changed,error){assertDeviceLab();return controller.start(changed,error);}
