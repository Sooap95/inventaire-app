import {assertEmulator} from './contracts.mjs';
import {TargetPolicyError,assertPreprodDatabase,validateBinding} from '../../src/preprod/target.js';
import {assertLiveContext,assertLiveDatabase} from '../../src/preprod/live-target.js';
const checks=new WeakMap();
function issue(kind,check){const token=Object.freeze({kind});checks.set(token,check);return token;}
export const emulatorPolicy=()=>issue('emulator',assertEmulator);
export function preprodPolicy(binding){const copy=validateBinding(binding);return issue('preprod',db=>assertPreprodDatabase(db,copy));}
export function livePreprodPolicy(binding){const copy=assertLiveContext(binding);return issue('preprod-live',db=>assertLiveDatabase(db,copy));}
export function checkTarget(policy,db){
 const check=policy&&checks.get(policy);if(!check)throw new TargetPolicyError('EXPLICIT_TARGET_POLICY_REQUIRED');
 try{check(db);}catch(e){if(e instanceof TargetPolicyError)throw e;throw new TargetPolicyError(e.message);}
}
